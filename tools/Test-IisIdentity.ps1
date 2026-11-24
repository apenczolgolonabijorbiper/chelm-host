#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$HostZip,
  [Parameter(Mandatory=$true)][string]$HarnessRoot,
  [string]$Output = 'iis-identity.json',
  [switch]$InstallPrerequisites,
  [switch]$MemoryProvider,
  [ValidateSet('FullIis','IisExpress')][string]$Mode = 'FullIis'
)
$ErrorActionPreference = 'Stop'
if ($Mode -eq 'FullIis' -and $InstallPrerequisites) {
  $features = Install-WindowsFeature Web-Server,Web-Asp-Net45 -IncludeManagementTools
  if (!$features.Success) { throw 'IIS/ASP.NET role installation failed' }
}
if ($Mode -eq 'FullIis') {
  Import-Module WebAdministration
  Start-Service W3SVC
}
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
$expressProcess = $null
try {
  New-Item -ItemType Directory -Path $webRoot,$privateRoot -Force | Out-Null
  Expand-Archive -LiteralPath ([System.IO.Path]::GetFullPath($HostZip)) -DestinationPath $probeRoot
  $package = Join-Path $probeRoot 'chelm-host'
  Copy-Item -LiteralPath ([System.IO.Path]::GetFullPath($HarnessRoot)) -Destination (Join-Path $probeRoot 'golem-harness') -Recurse
  $settings = @{ runtime=(Join-Path $privateRoot 'runtime'); harness=(Join-Path $probeRoot 'golem-harness'); python=$pythonExe; git=$gitExe; provider=[bool]$MemoryProvider }
  $settingsPath = Join-Path $probeRoot 'probe-config.json'
  [System.IO.File]::WriteAllText($settingsPath,($settings | ConvertTo-Json),[System.Text.UTF8Encoding]::new($false))
  $script = Join-Path $package 'tools/service-probe.mjs'
  # Paths below are administrator-generated; the endpoint accepts no input or commands.
  $handler = @'
<%@ WebHandler Language="C#" Class="ChelmProbe" %>
<%@ Assembly Name="System.Web.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35" %>
using System;
using System.Web;
using System.Diagnostics;
using System.IO;
using System.Collections.Generic;
using System.Security.Principal;
public class ChelmProbe : IHttpHandler {
  public bool IsReusable { get { return false; } }
  private Dictionary<string, object> Refresh() {
    var info = new ProcessStartInfo(@"NODE_EXE", "\"SCRIPT_PATH\" \"CONFIG_PATH\" --refresh");
    info.UseShellExecute = false; info.CreateNoWindow = true;
    info.RedirectStandardOutput = true; info.RedirectStandardError = true;
    var child = Process.Start(info);
    var output = child.StandardOutput.ReadToEndAsync();
    var error = child.StandardError.ReadToEndAsync();
    if (!child.WaitForExit(180000)) { child.Kill(); child.WaitForExit(5000); System.Threading.Tasks.Task.WaitAll(new System.Threading.Tasks.Task[] { output, error }, 5000); throw new Exception("Refresh timed out; owned command supervisor cleans descendants"); }
    var result = new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(output.Result) as Dictionary<string, object>;
    if (result == null || !result.ContainsKey("refreshed")) throw new Exception("Invalid refresh response: " + output.Result + " " + error.Result);
    if ((child.ExitCode == 0) != (bool)result["refreshed"]) throw new Exception("Inconsistent refresh exit status");
    return result;
  }
  public void ProcessRequest(HttpContext context) {
    context.Response.ContentType = "application/json";
    var info = new ProcessStartInfo(@"NODE_EXE", "\"SCRIPT_PATH\" \"CONFIG_PATH\"");
    info.UseShellExecute = false; info.CreateNoWindow = true;
    info.RedirectStandardOutput = true; info.RedirectStandardError = true;
    var process = Process.Start(info);
    var output = process.StandardOutput.ReadToEndAsync();
    var error = process.StandardError.ReadToEndAsync();
    if (!process.WaitForExit(180000)) { process.Kill(); process.WaitForExit(5000); System.Threading.Tasks.Task.WaitAll(new System.Threading.Tasks.Task[] { output, error }, 5000); throw new Exception("Probe timed out; owned command supervisor cleans descendants"); }
    if (process.ExitCode != 0) throw new Exception("Service probe failed: " + output.Result + " " + error.Result);
    // Exercise a deliberately long-held reader. Windows may exhaust bounded
    // rename retries even with delete-sharing; the old object must stay intact.
    string taskText;
    bool readerBlocked;
    using (var stream = new FileStream(@"TASK_VIEW_PATH", FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) {
      var attempt = Refresh();
      readerBlocked = !(bool)attempt["refreshed"];
      if (readerBlocked) {
        var failure = attempt["error"] as Dictionary<string, object>;
        var code = failure == null ? "" : (string)failure["code"];
        var diagnostic = failure == null ? "" : (string)failure["message"];
        if ((code != "EPERM" && code != "EACCES" && code != "EBUSY") || !diagnostic.Contains("rename") || !diagnostic.Contains("tasks.json"))
          throw new Exception("Unexpected refresh failure: " + diagnostic);
      }
      using (var reader = new StreamReader(stream)) { taskText = reader.ReadToEnd(); }
    }
    // Application readers close promptly and never wait for writes while open.
    // An explicit retry after the held handle closes must fully refresh views.
    if (readerBlocked && !(bool)Refresh()["refreshed"]) throw new Exception("Refresh did not recover after closing the task reader");
    var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
    var taskView = serializer.DeserializeObject(taskText) as Dictionary<string, object>;
    if (taskView == null || !taskView.ContainsKey("data") || !taskView.ContainsKey("head")) throw new Exception("Invalid task view");
    var rows = taskView["data"] as System.Collections.IList;
    var row = rows != null && rows.Count == 1 ? rows[0] as Dictionary<string, object> : null;
    if (row == null || (string)row["state"] != "completed" || row["receipt"] == null) throw new Exception("Completed cognitive task missing");
    var replacement = serializer.DeserializeObject(File.ReadAllText(@"TASK_VIEW_PATH")) as Dictionary<string, object>;
    if (replacement == null || (string)replacement["head"] != (string)taskView["head"]) throw new Exception("Replacement view binding changed");
    var replacementRows = replacement["data"] as System.Collections.IList;
    var replacementRow = replacementRows != null && replacementRows.Count == 1 ? replacementRows[0] as Dictionary<string, object> : null;
    if (replacementRow == null || (string)replacementRow["state"] != "completed" || serializer.Serialize(replacementRow["receipt"]) != serializer.Serialize(row["receipt"]))
      throw new Exception("Task result/receipt changed during reader recovery");
    context.Response.Write("{\"iis_identity\":\"" + HttpUtility.JavaScriptStringEncode(WindowsIdentity.GetCurrent().Name) + "\",\"task_view_read\":true,\"task_view_refresh_recovered\":true,\"task_view_reader_blocked\":" + (readerBlocked ? "true" : "false") + ",\"probe\":" + output.Result.Trim() + "}");
  }
}
'@
  $handler = $handler.Replace('TASK_VIEW_PATH', (Join-Path $privateRoot 'runtime/host/read-model/tasks.json').Replace('"','""'))
  $handler = $handler.Replace('NODE_EXE',$nodeExe.Replace('"','""')).Replace('SCRIPT_PATH',$script.Replace('\','\\')).Replace('CONFIG_PATH',$settingsPath.Replace('\','\\'))
  [System.IO.File]::WriteAllText((Join-Path $webRoot 'probe.ashx'),$handler,[System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $webRoot 'web.config'),'<configuration><system.web><identity impersonate="false"/><compilation targetFramework="4.8"/><httpRuntime targetFramework="4.8" executionTimeout="240"/></system.web></configuration>')
  if ($Mode -eq 'FullIis') {
    New-WebAppPool -Name $pool | Out-Null
    Set-ItemProperty "IIS:\AppPools\$pool" -Name 'processModel.identityType' -Value 'ApplicationPoolIdentity'
    Set-ItemProperty "IIS:\AppPools\$pool" -Name 'processModel.loadUserProfile' -Value $false
    & icacls.exe $probeRoot /grant "IIS AppPool\${pool}:(OI)(CI)RX" /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant read/execute access to the probe package' }
    & icacls.exe $privateRoot /grant "IIS AppPool\${pool}:(OI)(CI)M" /T /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not grant runtime modify access' }
    New-Website -Name $site -PhysicalPath $webRoot -IPAddress '127.0.0.1' -Port $port -ApplicationPool $pool | Out-Null
    if ((Get-WebAppPoolState -Name $pool).Value -ne 'Started') { Start-WebAppPool $pool }
    $expectedIdentity = "IIS APPPOOL\$pool"
    $poolState = Get-Item "IIS:\AppPools\$pool"
    $identityType = [string]$poolState.processModel.identityType
    $profileLoaded = [bool]$poolState.processModel.loadUserProfile
  } else {
    $expressExe = Join-Path $env:ProgramFiles 'IIS Express/iisexpress.exe'
    if (!(Test-Path $expressExe)) { throw 'IIS Express must be installed for the Express acceptance path' }
    $expressProcess = Start-Process -FilePath $expressExe -ArgumentList "/path:`"$webRoot`"","/port:$port",'/clr:v4.0','/systray:false' -PassThru -RedirectStandardOutput (Join-Path $probeRoot 'express.stdout') -RedirectStandardError (Join-Path $probeRoot 'express.stderr')
    $expectedIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $identityType = 'InteractiveDeveloper'
    $profileLoaded = $null
    [System.IO.File]::WriteAllText((Join-Path $webRoot 'ready.txt'),'ready')
    # Wait only for the static file; never repeat the mutating synthetic probe.
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
      try { Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$port/ready.txt" -TimeoutSec 1 | Out-Null; $ready=$true; break } catch {}
      if ($expressProcess.HasExited) { throw ('IIS Express exited: '+(Get-Content (Join-Path $probeRoot 'express.stderr') -Raw)) }
      Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw 'IIS Express did not become ready' }
  }
  $probeHost = if ($Mode -eq 'FullIis') { '127.0.0.1' } else { 'localhost' }
  $response = Invoke-RestMethod -Uri "http://${probeHost}:$port/probe.ashx" -TimeoutSec 240
  if (!$response.probe.passed -or $response.iis_identity -ne $expectedIdentity) { throw 'The probe did not execute successfully as the expected Windows identity' }
  if ($MemoryProvider -and (!$response.probe.memory_provider.semantic_only -or $response.probe.memory_provider.worker_contract -ne 3)) { throw 'Provider-mode semantic acceptance missing' }
  $evidence = @{ recorded_at=[DateTime]::UtcNow.ToString('o'); os=(Get-CimInstance Win32_OperatingSystem).Caption; host_archive_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $HostZip).Hash.ToLowerInvariant(); mode=$Mode; provider_mode=[bool]$MemoryProvider; identity_type=$identityType; load_user_profile=$profileLoaded; result=$response }
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  [System.IO.File]::WriteAllText($destination,($evidence | ConvertTo-Json -Depth 10),[System.Text.UTF8Encoding]::new($false))
  Write-Host ($evidence | ConvertTo-Json -Depth 10)
} finally {
  if ($expressProcess -and !$expressProcess.HasExited) { Stop-Process -Id $expressProcess.Id -Force; $expressProcess.WaitForExit() }
  if ($Mode -eq 'FullIis' -and (Test-Path "IIS:\Sites\$site")) { Remove-Website $site }
  if ($Mode -eq 'FullIis' -and (Test-Path "IIS:\AppPools\$pool")) { Stop-WebAppPool $pool -ErrorAction SilentlyContinue; Remove-WebAppPool $pool }
  if (Test-Path $probeRoot) { Remove-Item -LiteralPath $probeRoot -Recurse -Force }
}
