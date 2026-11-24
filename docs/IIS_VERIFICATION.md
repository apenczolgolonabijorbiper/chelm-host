# Default IIS deployment verification

Development: IIS Express, running as the interactive developer. Target: full IIS
on Windows Server 2022 Standard, default ApplicationPoolIdentity,
LoadUserProfile=false and no ASP.NET impersonation. Windows hosted CI uses the
Server 2022 runner SKU; it does not represent a test on your actual Standard
server. A non-profile-dependent host uses absolute Node/Python/Git executables,
a read-only vendor installation and a private runtime writable by the pool.

From an elevated Windows PowerShell 5.1 session on a disposable/test server:

```powershell
./tools/Test-IisIdentity.ps1 -HostZip ./dist/chelm-host-1.2.0.zip `
  -HarnessRoot C:/vendor/golem-harness -Output ./iis-identity.json
```

IIS and ASP.NET 4.x roles must already exist. For CI or a server where installing
those roles is intended, add -InstallPrerequisites. The script creates only a
uniquely named temporary application pool and loopback-bound site, grants that
pool read/execute to the extracted packages and Modify to its private runtime,
runs the synthetic probe through the IIS worker and removes its site/pool/files
in finally. Existing sites and app pools are not changed. Its evidence includes
actual Windows identity, configured LoadUserProfile and the synthetic operations.
A failed child operation fails the HTTP probe and CI.

The web handler is test-only, accepts no request input and is never an application
endpoint to deploy. Node and Python are found from the elevated caller's commands
and passed as absolute paths. Git is passed using init --git, so the worker does
not need the caller's PATH or profile. Do not grant Modify to vendor directories.
For application read-view handles, use FileShare.ReadWrite | FileShare.Delete,
as documented in READ_MODEL.md.

To check the same operations under an IIS Express/developer identity, run
`node tools/service-probe.mjs settings.json` as that identity with:

```json
{"runtime":"C:/Private/chelm-probe","harness":"C:/vendor/golem-harness","python":"C:/Python312/python.exe","git":"C:/Program Files/Git/cmd/git.exe"}
```

The runtime must be absent. It contains only synthetic test data and is kept for
inspection when the Node probe is run directly. A successful interactive probe
is not evidence of a full IIS application-pool identity run.

Runtime Git children ignore user/system global Git configuration and hooks;
instance-local Git configuration remains available. This avoids dependence on
reading a profile directory that the application-pool identity cannot access.

Without a loaded virtual-account profile, Node/libuv can fail os.userInfo().
Chelm falls back to the OS security ID from whoami.exe, recording the SID as the
actor/lease owner. The IIS evidence separately records the Windows principal name.
Do not configure USERNAME or enable a profile to bypass this check. For delegation
under such an identity, participants may list that recorded SID.

The 1.2.0 probe also completes a read-only cognitive task, checks its durable
receipt and reads the completed task view directly in C#. With FileShare.Delete
it holds the old view open while another Node process runs refresh. A bounded
sharing refusal must preserve the old complete object; after closing the reader,
refresh must recover with the same task binding/result/receipt. This is deterministic
service integration evidence; it does not claim to invoke a model under IIS.
