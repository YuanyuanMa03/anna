# Anna installer for Windows.
#   irm https://anna.mayuanyuan.top/install.ps1 | iex
# Files downloaded by PowerShell carry no Mark-of-the-Web, so SmartScreen does not block the unsigned app.
# The download is checked against the SHA-256 in latest.json before anything is installed.
$ErrorActionPreference = 'Stop'
$Base = if ($env:ANNA_RELEASE_BASE) { $env:ANNA_RELEASE_BASE } else { 'https://anna.mayuanyuan.top' }
function Fail($Message) { Write-Error "Anna 安装失败：$Message"; exit 1 }

$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
$Key = "win32-$Arch"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try { $Manifest = Invoke-RestMethod -UseBasicParsing "$Base/latest.json" } catch { Fail "无法获取版本信息 $Base/latest.json" }
$Asset = $Manifest.assets.$Key
if (-not $Asset) { Fail "版本 $($Manifest.version) 还没有 $Key 的安装包" }
if (-not $Asset.url.StartsWith('https://')) { Fail "下载地址必须是 HTTPS：$($Asset.url)" }

$Work = Join-Path ([IO.Path]::GetTempPath()) ("anna-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Work | Out-Null
try {
  Write-Host "正在下载 Anna $($Manifest.version)（${Key}）…"
  $Archive = Join-Path $Work 'anna.zip'
  Invoke-WebRequest -UseBasicParsing $Asset.url -OutFile $Archive
  $Actual = (Get-FileHash -Algorithm SHA256 $Archive).Hash.ToLowerInvariant()
  if ($Actual -ne $Asset.sha256.ToLowerInvariant()) { Fail '校验失败：下载的文件与发布记录不一致，已停止安装' }
  Expand-Archive -Path $Archive -DestinationPath (Join-Path $Work 'unpacked') -Force
  $Source = Join-Path $Work 'unpacked\Anna'
  if (-not (Test-Path (Join-Path $Source 'Anna.exe'))) { Fail '安装包里没有 Anna\Anna.exe' }

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
  Write-Host "Anna $($Manifest.version) 已安装到 ${Dest}，开始菜单里可以找到它。"
  if (-not $env:ANNA_INSTALL_NO_OPEN) { Start-Process (Join-Path $Dest 'Anna.exe') }
}
finally { Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue }
