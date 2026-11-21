#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$HostZip,
  [Parameter(Mandatory=$true)][string]$HarnessRoot,
  [string]$Output = 'iis-identity.json',
  [switch]$InstallPrerequisites
)
$ErrorActionPreference = 'Stop'
if ($InstallPrerequisites) {
  $features = Install-WindowsFeature Web-Server,Web-Asp-Net45 -IncludeManagementTools
  if (!$features.Success) { throw 'IIS/ASP.NET role installation failed' }
}
Import-Module WebAdministration
Start-Service W3SVC
$probeId = [guid]::NewGuid().ToString('N')
$pool = "ChelmProbe-$probeId"
$site = "ChelmProbe-$probeId"
$probeRoot = Join-Path $env:ProgramData $pool
$webRoot = Join-Path $probeRoot 'web'
$privateRoot = Join-Path $probeRoot 'private'
$port = Get-Random -Minimum 48000 -Maximum 59000
$nodeExe = (Get-Command node).Source
$pythonExe = (Get-Command python).Source
$gitExe = (Get-Command git).Source
$destination = [System.IO.Path]::GetFullPath($Output)
try {
  New-Item -ItemType Directory -Path $webRoot,$privateRoot -Force | Out-Null
  Expand-Archive -LiteralPath ([System.IO.Path]::GetFullPath($HostZip)) -DestinationPath $probeRoot
  $package = Join-Path $probeRoot 'chelm-host'
  Copy-Item -LiteralPath ([System.IO.Path]::GetFullPath($HarnessRoot)) -Destination (Join-Path $probeRoot 'golem-harness') -Recurse
  $settings = @{ runtime=(Join-Path $privateRoot 'runtime'); harness=(Join-Path $probeRoot 'golem-harness'); python=$pythonExe; git=$gitExe }
  $settingsPath = Join-Path $probeRoot 'probe-config.json'
  [System.IO.File]::WriteAllText($settingsPath,($settings | ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
  $script = Join-Path $package 'tools/service-probe.mjs'
  # Paths below are administrator-generated; the endpoint accepts no input or commands.
  $handler = @'
<%@ WebHandler Language="C#" Class="ChelmProbe" %>
using System;
using System.Web;
using System.Diagnostics;
using System.Security.Principal;
public class ChelmProbe : IHttpHandler {
  public bool IsReusable { get { return false; } }
  public void ProcessRequest(HttpContext context) {
    context.Response.ContentType = "application/json";
    var info = new ProcessStartInfo(@"NODE_EXE", "\"SCRIPT_PATH\" \"CONFIG_PATH\"");
    info.UseShellExecute = false; info.CreateNoWindow = true;
    info.RedirectStandardOutput = true; info.RedirectStandardError = true;
    var process = Process.Start(info);
    var output = process.StandardOutput.ReadToEndAsync();
    var error = process.StandardError.ReadToEndAsync();
    if (!process.WaitForExit(180000)) { process.Kill(); throw new Exception("Probe timed out"); }
    if (process.ExitCode != 0) { context.Response.StatusCode = 500; }
    context.Response.Write("{\"iis_identity\":\"" + HttpUtility.JavaScriptStringEncode(WindowsIdentity.GetCurrent().Name) + "\",\"probe\":" + output.Result.Trim() + "}");
  }
}
'@
  $handler = $handler.Replace('NODE_EXE',$nodeExe.Replace('"','""')).Replace('SCRIPT_PATH',$script.Replace('\','\\')).Replace('CONFIG_PATH',$settingsPath.Replace('\','\\'))
  [System.IO.File]::WriteAllText((Join-Path $webRoot 'probe.ashx'),$handler,[System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $webRoot 'web.config'),'<configuration><system.web><identity impersonate="false"/><compilation targetFramework="4.8"/><httpRuntime targetFramework="4.8" executionTimeout="240"/></system.web></configuration>')
  New-WebAppPool -Name $pool | Out-Null
  Set-ItemProperty "IIS:\AppPools\$pool" -Name 'processModel.identityType' -Value 'ApplicationPoolIdentity'
  Set-ItemProperty "IIS:\AppPools\$pool" -Name 'processModel.loadUserProfile' -Value $false
  & icacls.exe $probeRoot /grant "IIS AppPool\${pool}:(OI)(CI)RX" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant read/execute access to the probe package' }
  & icacls.exe $privateRoot /grant "IIS AppPool\${pool}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime modify access' }
  New-Website -Name $site -PhysicalPath $webRoot -IPAddress '127.0.0.1' -Port $port -ApplicationPool $pool | Out-Null
  if ((Get-WebAppPoolState -Name $pool).Value -ne 'Started') { Start-WebAppPool $pool }
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/probe.ashx" -TimeoutSec 240
  if (!$response.probe.passed -or $response.iis_identity -ne "IIS APPPOOL\$pool") { throw 'The probe did not execute successfully as ApplicationPoolIdentity' }
  $poolState = Get-Item "IIS:\AppPools\$pool"
  $evidence = @{ recorded_at=[DateTime]::UtcNow.ToString('o'); os=(Get-CimInstance Win32_OperatingSystem).Caption; identity_type=[string]$poolState.processModel.identityType; load_user_profile=[bool]$poolState.processModel.loadUserProfile; result=$response }
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  [System.IO.File]::WriteAllText($destination,($evidence | ConvertTo-Json -Depth 10),[System.Text.UTF8Encoding]::new($false))
  Write-Host ($evidence | ConvertTo-Json -Depth 10)
} finally {
  if (Test-Path "IIS:\Sites\$site") { Remove-Website $site }
  if (Test-Path "IIS:\AppPools\$pool") { Stop-WebAppPool $pool -ErrorAction SilentlyContinue; Remove-WebAppPool $pool }
  if (Test-Path $probeRoot) { Remove-Item -LiteralPath $probeRoot -Recurse -Force }
}
