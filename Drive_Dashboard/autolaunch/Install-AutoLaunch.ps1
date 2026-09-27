<#
  Makes the dashboard open automatically whenever THIS drive is plugged into this PC.
  Per-user only (no admin): copies watcher.ps1 to %LOCALAPPDATA%\DriveDashboard and adds a
  shortcut to your Startup folder. Undo with Uninstall-AutoLaunch.bat.
#>
$ErrorActionPreference = 'Stop'
$Root   = [IO.Path]::GetPathRoot($PSScriptRoot)
$Serial = (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($Root.Substring(0, 2))'").VolumeSerialNumber
$Dir    = Join-Path $env:LOCALAPPDATA 'DriveDashboard'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

Copy-Item (Join-Path $PSScriptRoot 'watcher.ps1') (Join-Path $Dir 'watcher.ps1') -Force

$cfgPath = Join-Path $Dir 'config.json'
$serials = @()
if (Test-Path $cfgPath) { try { $serials = @((Get-Content $cfgPath -Raw | ConvertFrom-Json).serials) } catch {} }
if ($serials -notcontains $Serial) { $serials += $Serial }
@{ serials = $serials } | ConvertTo-Json | Set-Content $cfgPath -Encoding UTF8

$ps  = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Dir\watcher.ps1`""
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Drive Dashboard watcher.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $ps
$sc.Arguments = $arg
$sc.WorkingDirectory = $env:TEMP
$sc.WindowStyle = 7
$sc.Description = 'Opens Drive Dashboard when a trusted drive is plugged in'
$sc.Save()

# Start it now so it works without logging out.
$running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*DriveDashboard\watcher.ps1*' }
if (-not $running) { Start-Process $ps -ArgumentList $arg -WindowStyle Hidden -WorkingDirectory $env:TEMP }

Write-Host "Auto-launch installed for drive $Root (serial $Serial)."
Write-Host "Watcher: $Dir\watcher.ps1"
Write-Host "Startup shortcut: $lnk"
