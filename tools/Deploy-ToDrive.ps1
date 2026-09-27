<#
  Install or update Drive Dashboard on a drive.

    .\tools\Deploy-ToDrive.ps1 -Target F:\            # install / update on drive F:
    .\tools\Deploy-ToDrive.ps1 -Target F:\ -Start     # ...and open it

  Copies this project's Drive_Dashboard folder to <Target>\Drive_Dashboard. The drive's own
  files are never overwritten: catalog.json (its folder descriptions) and .drive-id (its identity).
  On a drive that has never run the dashboard, the first start creates both.
  A running dashboard picks up web\ changes on reload; server changes need a restart
  (Stop in the sidebar, then Start-Dashboard / replug).
#>
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [switch]$Start
)
$ErrorActionPreference = 'Stop'
$src = (Resolve-Path (Join-Path $PSScriptRoot '..\Drive_Dashboard')).Path
if (-not (Test-Path -LiteralPath $Target)) { throw "Target not found: $Target" }
$dst = Join-Path (Resolve-Path -LiteralPath $Target).Path 'Drive_Dashboard'
$fresh = -not (Test-Path -LiteralPath (Join-Path $dst 'catalog.json'))

robocopy $src $dst /E /XF catalog.json .drive-id *.pyc *.log /XD __pycache__ /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

Write-Host "Deployed to $dst"
if ($fresh) { Write-Host 'No catalog.json yet: the first start will describe this drive automatically.' }
else { Write-Host 'Kept the existing catalog.json and .drive-id.' }
if ($Start) { Start-Process (Join-Path $dst 'Start-Dashboard.bat') }
