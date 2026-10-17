# Anna installer for Windows.
#   irm https://anna.mayuanyuan.top/install.ps1 | iex
# Files downloaded by PowerShell carry no Mark-of-the-Web, so SmartScreen does not block the unsigned app.
# The download is checked against the SHA-256 in latest.json before anything is installed.
$ErrorActionPreference = 'Stop'
$Base = if ($env:ANNA_RELEASE_BASE) { $env:ANNA_RELEASE_BASE } else { 'https://anna.mayuanyuan.top' }
function Fail($Message) { Write-Error "Anna install failed: $Message"; exit 1 }

$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
$Key = "win32-$Arch"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try { $Manifest = Invoke-RestMethod -UseBasicParsing "$Base/latest.json" } catch { Fail "could not fetch release info from $Base/latest.json" }
$Asset = $Manifest.assets.$Key
if (-not $Asset) { Fail "version $($Manifest.version) has no package for $Key yet" }
if (-not $Asset.url.StartsWith('https://')) { Fail "download URL must be HTTPS: $($Asset.url)" }

$Work = Join-Path ([IO.Path]::GetTempPath()) ("anna-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  Write-Host "Downloading Anna $($Manifest.version) ($Key)..."
  $Archive = Join-Path $Work 'anna.zip'
  Invoke-WebRequest -UseBasicParsing $Asset.url -OutFile $Archive
  $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
  if ($Actual -ne $Asset.sha256.ToLowerInvariant()) { Fail 'checksum mismatch: the download does not match the published release, nothing was installed' }
  Expand-Archive -Path $Archive -DestinationPath (Join-Path $Work 'unpacked') -Force
  $Source = Join-Path $Work 'unpacked\Anna'
  if (-not (Test-Path (Join-Path $Source 'Anna.exe'))) { Fail 'the package does not contain Anna\Anna.exe' }

  $Dest = Join-Path $env:LOCALAPPDATA 'Programs\Anna'
  Get-Process -Name 'Anna' -ErrorAction SilentlyContinue | Stop-Process -Force
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  New-Item -ItemType Directory -Path (Split-Path $Dest) -Force | Out-Null
  Move-Item $Source $Dest
  Get-ChildItem -Recurse $Dest | Unblock-File

  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Anna.lnk'))
  $Shortcut.TargetPath = Join-Path $Dest 'Anna.exe'
  $Shortcut.WorkingDirectory = $Dest
  $Shortcut.Save()
  Write-Host "Anna $($Manifest.version) installed to $Dest. You can find it in the Start menu."
  if (-not $env:ANNA_INSTALL_NO_OPEN) { Start-Process (Join-Path $Dest 'Anna.exe') }
}
finally { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
