<#
  Drive Dashboard auto-launch watcher.

  Installed into %LOCALAPPDATA%\DriveDashboard and started at logon. When a *trusted* drive is
  plugged in, it starts that drive's Drive_Dashboard\server.ps1, which opens the browser.

  Trusted = the drive's volume serial number is listed in config.json (written by the installer).
  Windows disabled USB AutoRun because any stick could run code on insert; checking the serial keeps
  that door closed for every drive except yours.
#>
$ErrorActionPreference = 'Continue'
Set-Location $env:TEMP
$CfgPath = Join-Path $PSScriptRoot 'config.json'

$mutex = New-Object Threading.Mutex($false, 'Local\DriveDashboardWatcher')
if (-not $mutex.WaitOne(0)) { exit }   # already running

function Get-TrustedSerials {
    try { @((Get-Content $CfgPath -Raw | ConvertFrom-Json).serials) } catch { @() }
}
function Get-PresentDashboards {
    $found = @{}
    $trusted = Get-TrustedSerials
    foreach ($d in Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2 OR DriveType=3') {
        if ($trusted -contains $d.VolumeSerialNumber) {
            $srv = "$($d.DeviceID)\Drive_Dashboard\server.ps1"
            if (Test-Path -LiteralPath $srv) { $found[$d.VolumeSerialNumber] = $srv }
        }
    }
    $found
}
function Start-Dashboard([string]$server) {
    Start-Process powershell.exe -WindowStyle Hidden -WorkingDirectory $env:TEMP `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$server`""
}

$seen = Get-PresentDashboards
foreach ($k in $seen.Keys) { Start-Dashboard $seen[$k] }   # drive already connected at logon

Register-CimIndicationEvent -Query 'SELECT * FROM Win32_VolumeChangeEvent' -SourceIdentifier DDVolume | Out-Null
while ($true) {
    $e = Wait-Event -SourceIdentifier DDVolume -Timeout 60      # 60 s fallback poll
    if ($e) {
        Start-Sleep -Seconds 2                                   # let the volume finish mounting
        Get-Event -SourceIdentifier DDVolume -ErrorAction SilentlyContinue | Remove-Event
    }
    $now = Get-PresentDashboards
    foreach ($k in $now.Keys) { if (-not $seen.ContainsKey($k)) { Start-Dashboard $now[$k] } }
    $seen = $now
}
