#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$HostZip,
  [Parameter(Mandatory=$true)][string]$HarnessRoot,
  [string]$Output = 'iis-https-proxy.json',
  [switch]$InstallPrerequisites,
  [switch]$DisposableServer
)
$ErrorActionPreference = 'Stop'
# ARR settings are server-wide. This fixture is for disposable test servers only.
if (!$DisposableServer) { throw 'Use -DisposableServer on an isolated test server; ARR settings are server-wide' }
$probeId = 'ChelmHttps-' + [guid]::NewGuid().ToString('N')
$probeRoot = Join-Path $env:ProgramData $probeId
$webRoot = Join-Path $probeRoot 'web'
$logs = Join-Path $probeRoot 'logs'
$destination = [System.IO.Path]::GetFullPath($Output)
$certificate = $null
$proxyBefore = $null
$oldCa = $env:NODE_EXTRA_CA_CERTS
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Install-MicrosoftMsi([string]$Uri, [string]$Name) {
  $installer = Join-Path $probeRoot "$Name.msi"
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $installer
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "Untrusted Microsoft installer: $Name"
  }
  $process = Start-Process msiexec.exe -ArgumentList '/i',"`"$installer`"",'/quiet','/norestart' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer $Name exited $($process.ExitCode); finish prerequisites before testing" }
}
try {
  New-Item -ItemType Directory -Path $probeRoot,$webRoot,$logs -Force | Out-Null
  if ($InstallPrerequisites) {
    $features = Install-WindowsFeature Web-Server,Web-Mgmt-Tools -IncludeManagementTools
    if (!$features.Success) { throw 'IIS role installation failed' }
    # Official IIS download links. Validate Authenticode before executing either MSI.
    if (!(Test-Path "$env:windir\System32\inetsrv\rewrite.dll")) {
      Install-MicrosoftMsi 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' 'rewrite'
    }
    if (!(Test-Path "$env:windir\System32\inetsrv\requestRouter.dll")) {
      Install-MicrosoftMsi 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi' 'arr'
    }
  }
  Import-Module WebAdministration
  Add-Type -Path "$env:windir\System32\inetsrv\Microsoft.Web.Administration.dll"
  Start-Service W3SVC
  $manager = New-Object Microsoft.Web.Administration.ServerManager
  try {
    $proxy = $manager.GetApplicationHostConfiguration().GetSection('system.webServer/proxy')
    $proxyBefore = @{}
    foreach ($name in @('enabled','preserveHostHeader','reverseRewriteHostInResponseHeaders','timeout')) { $proxyBefore[$name] = $proxy.GetAttributeValue($name) }
    $proxy.SetAttributeValue('enabled',$true)
    $proxy.SetAttributeValue('preserveHostHeader',$true)
    $proxy.SetAttributeValue('reverseRewriteHostInResponseHeaders',$false)
    $proxy.SetAttributeValue('timeout',[TimeSpan]::FromSeconds(180))
    $manager.CommitChanges()
  } finally { $manager.Dispose() }
  Expand-Archive -LiteralPath ([System.IO.Path]::GetFullPath($HostZip)) -DestinationPath $probeRoot
  $package = Join-Path $probeRoot 'chelm-host'
  & node (Join-Path $package 'integration/install-dependencies.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Packaged locked dependency restore failed' }
  $backendPort = Get-FreePort
  do { $tlsPort = Get-FreePort } while ($tlsPort -eq $backendPort)
  $config = @"
<configuration><system.webServer>
  <httpErrors existingResponse="PassThrough" />
  <security><requestFiltering><requestLimits maxAllowedContentLength="270336" /></requestFiltering></security>
  <rewrite><rules><clear />
    <rule name="Chelm worker endpoints" stopProcessing="true">
      <match url="^(mcp(/.*)?|\.well-known/oauth-protected-resource(/mcp)?)$" />
      <action type="Rewrite" url="http://127.0.0.1:$backendPort/{R:0}" appendQueryString="true" />
    </rule>
  </rules></rewrite>
</system.webServer></configuration>
"@
  [System.IO.File]::WriteAllText((Join-Path $webRoot 'web.config'), $config, $utf8)
  New-WebAppPool -Name $probeId | Out-Null
  Set-ItemProperty "IIS:\AppPools\$probeId" -Name 'processModel.loadUserProfile' -Value $false
  & icacls.exe $webRoot /grant "IIS AppPool\${probeId}:(OI)(CI)RX" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant test-site read access' }
  $certificate = New-SelfSignedCertificate -Subject 'CN=localhost' -CertStoreLocation 'Cert:\LocalMachine\My' `
    -KeyAlgorithm RSA -KeyLength 2048 -NotAfter ([DateTime]::Now.AddDays(1)) `
    -TextExtension @('2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1')
  $ca = Join-Path $probeRoot 'test-ca.pem'
  $pem = "-----BEGIN CERTIFICATE-----`n" + [Convert]::ToBase64String($certificate.RawData,[Base64FormattingOptions]::InsertLineBreaks) + "`n-----END CERTIFICATE-----`n"
  [System.IO.File]::WriteAllText($ca, $pem, $utf8)
  New-Website -Name $probeId -PhysicalPath $webRoot -IPAddress '127.0.0.1' -Port $tlsPort -Ssl -ApplicationPool $probeId | Out-Null
  (Get-WebBinding -Name $probeId -Protocol https).AddSslCertificate($certificate.Thumbprint, 'My')
  Set-ItemProperty "IIS:\Sites\$probeId" -Name 'logFile.directory' -Value $logs
  Set-ItemProperty "IIS:\Sites\$probeId" -Name 'logFile.logFormat' -Value 'W3C'
  Set-ItemProperty "IIS:\Sites\$probeId" -Name 'logFile.logExtFileFlags' -Value 'Date,Time,Method,UriStem,HttpStatus,HttpSubStatus,Win32Status,TimeTaken'
  # Explicitly disable request tracing and inherited custom header log fields.
  Set-ItemProperty "IIS:\Sites\$probeId" -Name 'traceFailedRequestsLogging.enabled' -Value $false
  Clear-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter "system.applicationHost/sites/site[@name='$probeId']/logFile/customFields"
  $env:NODE_EXTRA_CA_CERTS = $ca
  $transportReport = Join-Path $probeRoot 'transport.json'
  & node (Join-Path $package 'tools/https-proxy-acceptance.mjs') --url "https://127.0.0.1:$tlsPort/mcp" --backend-port $backendPort --harness ([System.IO.Path]::GetFullPath($HarnessRoot)) --output $transportReport
  if ($LASTEXITCODE -ne 0) { throw 'HTTPS/ARR MCP acceptance failed; no deployment success is claimed' }
  & netsh.exe http flush logbuffer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not flush HTTP access logs' }
  $logText = ''
  for ($attempt=0; $attempt -lt 30; $attempt++) {
    $files = @(Get-ChildItem -LiteralPath $logs -Filter '*.log' -Recurse)
    $logText = ($files | ForEach-Object {
      # HTTP.sys keeps the active W3C file open for writing. A reader must allow
      # that writer (and rotation) to retain its handle while we inspect it.
      $stream = [System.IO.File]::Open($_.FullName, [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read, ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))
      $reader = [System.IO.StreamReader]::new($stream)
      try { $reader.ReadToEnd() } finally { $reader.Dispose() }
    }) -join "`n"
    if ($logText -match ' /mcp/app 200 ' -and $logText -match ' 401 ') { break }
    Start-Sleep -Milliseconds 200
  }
  if ($logText -notmatch ' /mcp/app 200 ' -or $logText -notmatch ' 401 ') { throw 'Actual IIS request log evidence is missing' }
  if ($logText -match 'chelm-https-(secret|observation|upload)-|Authorization:|Bearer ') { throw 'Private canary found in IIS logs' }
  if ($logText -match '(?im)^#Fields:.*(cs-uri-query|cs\(User-Agent\)|cs\(Cookie\)|cs\(Referer\)|Authorization)') { throw 'Unsafe IIS access log fields' }
  $result = Get-Content -LiteralPath $transportReport -Raw | ConvertFrom-Json
  $result.checks += @{name='iis_access_log_redaction';pass=$true}
  $evidence = @{schema_version=1;kind='iis-https-proxy-acceptance';ok=$true;recorded_at=[DateTime]::UtcNow.ToString('o');
    os=(Get-CimInstance Win32_OperatingSystem).Caption;os_build=[Environment]::OSVersion.Version.ToString();
    host_archive_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $HostZip).Hash.ToLowerInvariant();
    proxy='IIS ARR / URL Rewrite';tls='Certificate and hostname verified with isolated test CA';
    backend='127.0.0.1 only';result=$result}
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  [System.IO.File]::WriteAllText($destination,($evidence | ConvertTo-Json -Depth 15),$utf8)
  Write-Host ($evidence | ConvertTo-Json -Depth 15)
} finally {
  $env:NODE_EXTRA_CA_CERTS = $oldCa
  if (Get-PSDrive -Name IIS -ErrorAction SilentlyContinue) {
    if (Test-Path "IIS:\Sites\$probeId") { Remove-Website $probeId }
    if (Test-Path "IIS:\AppPools\$probeId") { Remove-WebAppPool $probeId }
    if ($tlsPort -and (Test-Path "IIS:\SslBindings\127.0.0.1!$tlsPort")) { Remove-Item "IIS:\SslBindings\127.0.0.1!$tlsPort" }
  }
  if ($certificate) { Remove-Item -LiteralPath "Cert:\LocalMachine\My\$($certificate.Thumbprint)" }
  if ($proxyBefore) {
    $manager = New-Object Microsoft.Web.Administration.ServerManager
    try {
      $proxy = $manager.GetApplicationHostConfiguration().GetSection('system.webServer/proxy')
      foreach ($name in $proxyBefore.Keys) { $proxy.SetAttributeValue($name,$proxyBefore[$name]) }
      $manager.CommitChanges()
    } finally { $manager.Dispose() }
  }
  if (Test-Path $probeRoot) { Remove-Item -LiteralPath $probeRoot -Recurse -Force }
}
