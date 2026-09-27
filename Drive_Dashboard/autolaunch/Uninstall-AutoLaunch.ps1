<#
  Removes the auto-launch watcher from this PC. The dashboard itself stays on the drive and
  can still be opened with Start-Dashboard.bat.
#>
$Dir = Join-Path $env:LOCALAPPDATA 'DriveDashboard'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Drive Dashboard watcher.lnk'

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*DriveDashboard\watcher.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-Item $lnk -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Dir 'watcher.ps1'), (Join-Path $Dir 'config.json') -ErrorAction SilentlyContinue
Write-Host 'Auto-launch removed from this PC.'
