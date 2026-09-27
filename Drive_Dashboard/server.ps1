<#
  Drive Dashboard - local web interface for this drive.

  Serves web\ on http://localhost:<port>/ and a small JSON API for browsing, searching,
  previewing and opening files on the drive this script lives on.

  Security model (see Ciampa, Security+ Guide ch. 5, "web application attacks"):
    * Listens on localhost only - nothing on the network can reach it.
    * Every API call needs a random per-session token, so other websites open in the
      browser cannot drive it (cross-site request forgery).
    * Host header must be localhost:<port> (blocks DNS-rebinding).
    * Every path is canonicalised and must stay inside the drive root (directory traversal).
    * Files from the drive are served with a sandbox CSP so an .html/.svg on the drive
      can never run script in the dashboard's origin.
#>
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
# Don't keep a working directory on the drive, or Windows refuses "Safely Remove".
Set-Location $env:TEMP
[Environment]::CurrentDirectory = $env:TEMP

$AppDir    = $PSScriptRoot
# The "drive" is the folder that holds Drive_Dashboard - normally a drive root like E:\
# (same rule as server.py, and it lets the dashboard be tested inside any folder).
$Root      = (Split-Path $AppDir -Parent).TrimEnd('\') + '\'
$DriveRoot = [IO.Path]::GetPathRoot($AppDir)
$AtDriveRoot = ($Root -ieq $DriveRoot)
$Letter    = $DriveRoot.Substring(0, 2)
$Disk      = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$Letter'"
$Serial    = $Disk.VolumeSerialNumber
# one session per dashboard copy (the serial alone would clash for copies in sub-folders)
$SessionKey = $(if ($AtDriveRoot) { $Serial } else {
    $md5 = [Security.Cryptography.MD5]::Create()
    "$Serial-" + (-join ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())) | Select-Object -First 4 | ForEach-Object { $_.ToString('x2') })) })
$StateDir = Join-Path $env:LOCALAPPDATA 'DriveDashboard'
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
$SessionFile = Join-Path $StateDir "session-$SessionKey.json"
$LogFile     = Join-Path $StateDir 'server.log'

function Write-Log([string]$msg) {
    try { Add-Content -Path $LogFile -Value "$(Get-Date -Format s)  $msg" -Encoding UTF8 } catch {}
}

# ---- Single instance: if a server for this drive is already up, just open the browser ----
if (Test-Path $SessionFile) {
    try {
        $old = Get-Content $SessionFile -Raw | ConvertFrom-Json
        $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://localhost:$($old.port)/api/ping" -Headers @{ 'X-Token' = $old.token }
        if (($r.Content | ConvertFrom-Json).serial -eq $SessionKey) {
            if (-not $NoBrowser) { Start-Process "http://localhost:$($old.port)/#t=$($old.token)" }
            return
        }
    } catch {}
}

# ---- Listener on the first free port ----
$Listener = $null
foreach ($p in 8765..8799) {
    $l = New-Object Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    try { $l.Start(); $Listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $Listener) { Write-Log 'No free port in 8765-8799'; exit 1 }

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 24; $rng.GetBytes($bytes)
$Token = -join ($bytes | ForEach-Object { $_.ToString('x2') })

# catalog.json holds this drive's folder descriptions. It doesn't ship with the dashboard:
# on the first run on a drive the web UI generates it from the drive's contents.
$CatalogFile = Join-Path $AppDir 'catalog.json'
$CatalogExists = Test-Path -LiteralPath $CatalogFile
$Catalog = @{}
if ($CatalogExists) {
    try {
        $raw = Get-Content $CatalogFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($prop in $raw.PSObject.Properties) { $Catalog[$prop.Name] = $prop.Value }
    } catch { Write-Log "catalog.json: $($_.Exception.Message)" }
}

# Can we write to this drive here? (e.g. BitLocker-locked or write-protected media can't.)
$ReadOnly = $false
try {
    $probe = Join-Path $AppDir ".write-probe-$PID"
    [IO.File]::WriteAllText($probe, 'x'); [IO.File]::Delete($probe)
} catch { $ReadOnly = $true }

# ---- First-run setup on a new drive ----
if (-not $ReadOnly) {
    # .drive-id: this drive's random identity (used by the Linux/macOS auto-open helper)
    $idFile = Join-Path $AppDir '.drive-id'
    if (-not (Test-Path -LiteralPath $idFile)) {
        $b = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
        [IO.File]::WriteAllText($idFile, (-join ($b | ForEach-Object { $_.ToString('x2') })))
        (Get-Item -LiteralPath $idFile -Force).Attributes = 'Hidden'
        Write-Log "Created .drive-id"
    }
    # Drive icon in Explorer: autorun.inf with an icon line only (Windows never runs anything from it)
    $autorun = Join-Path $Root 'autorun.inf'
    if ($AtDriveRoot -and (Test-Path -LiteralPath (Join-Path $AppDir 'drive.ico')) -and -not (Test-Path -LiteralPath $autorun)) {
        try {
            [IO.File]::WriteAllText($autorun, "[autorun]`r`nicon=Drive_Dashboard\drive.ico`r`n", [Text.Encoding]::ASCII)
            (Get-Item -LiteralPath $autorun -Force).Attributes = 'Hidden, ReadOnly'
            Write-Log "Created autorun.inf (drive icon)"
        } catch { Write-Log "autorun.inf: $($_.Exception.Message)" }
    }
}

$S = [hashtable]::Synchronized(@{
    Root = $Root; DriveRoot = $DriveRoot; AppDir = $AppDir; Web = (Join-Path $AppDir 'web'); Token = $Token; Port = $Port
    Serial = $SessionKey; Label = $(if ($AtDriveRoot) { $Disk.VolumeName } else { Split-Path $Root.TrimEnd('\') -Leaf })
    Catalog = $Catalog; CatalogFile = $CatalogFile; CatalogExists = $CatalogExists; ReadOnly = $ReadOnly
    Trash = (Join-Path $Root '.dashboard-trash')
    Index = $null; DirSize = $null; Stats = $null; IndexState = 'idle'; IndexedAt = $null
    IndexJobText = $null; IndexPs = $null; Reindex = $false; Stop = $false
})

@{ port = $Port; token = $Token; pid = $PID } | ConvertTo-Json | Set-Content $SessionFile -Encoding UTF8

# ---- Background indexer: every file on the drive + folder sizes + summary stats ----
$S.IndexJobText = {
    param($S)
    try {
      # Loop so that changes made while we were scanning trigger one more pass.
      do {
        $S.Reindex = $false
        $S.IndexState = 'building'
        $groups = @{
            'Disk images' = 'iso img vdi vhd vhdx vmdk wim esd'
            'Installers'  = 'exe msi deb appimage apk msix'
            'Archives'    = 'zip rar 7z tar gz bz2 xz tgz whl cab'
            'Video'       = 'mp4 mkv avi mov webm wmv flv m4v'
            'Audio'       = 'mp3 wav flac m4a ogg aac wma'
            'Images'      = 'png jpg jpeg gif bmp webp svg ico heic'
            'Documents'   = 'pdf doc docx odt txt md ppt pptx xls xlsx ods csv rtf epub'
            'Code'        = 'py js ts html css java c cpp h cs ps1 sh bat json xml asm mac ipynb sql'
        }
        $extGroup = @{}
        foreach ($g in $groups.Keys) { foreach ($e in $groups[$g].Split(' ')) { $extGroup[$e] = $g } }

        $list  = New-Object 'Collections.Generic.List[object]'
        $sizes = @{}
        $stack = New-Object Collections.Stack
        $stack.Push((New-Object IO.DirectoryInfo $S.Root))
        $rootLen = $S.Root.Length
        while ($stack.Count -gt 0) {
            $dir = $stack.Pop()
            try { $entries = $dir.GetFileSystemInfos() } catch { continue }
            foreach ($e in $entries) {
                $n = $e.Name
                if ($n -eq '$RECYCLE.BIN' -or $n -eq 'System Volume Information' -or $n -eq '.drive-id' -or $n -eq '.DS_Store' -or $n -eq '.dashboard-trash' -or $n.StartsWith('._') -or $n.StartsWith('.Trash-')) { continue }
                $a = [int]$e.Attributes
                if (($a -band 6) -eq 6) { continue }             # hidden + system
                $rel   = $e.FullName.Substring($rootLen).Replace('\', '/')
                $isDir = ($a -band 16) -ne 0
                $sz = 0
                if ($isDir) {
                    if (($a -band 1024) -eq 0) { $stack.Push($e) } # don't follow junctions
                } else {
                    $sz = $e.Length
                    $i = $rel.LastIndexOf('/')
                    while ($i -gt 0) {
                        $k = $rel.Substring(0, $i)
                        $sizes[$k] = [long]$sizes[$k] + $sz
                        $i = $k.LastIndexOf('/')
                    }
                }
                $list.Add([pscustomobject]@{ p = $rel; n = $n; l = $n.ToLowerInvariant(); d = $isDir; s = $sz; m = $e.LastWriteTime.ToString('s') })
            }
        }

        $types = @{}
        $files = New-Object 'Collections.Generic.List[object]'
        foreach ($f in $list) {
            if ($f.d) { continue }
            $files.Add($f)
            $ext = [IO.Path]::GetExtension($f.n).TrimStart('.').ToLowerInvariant()
            $g = $extGroup[$ext]; if (-not $g) { $g = 'Other' }
            if (-not $types[$g]) { $types[$g] = @{ group = $g; count = 0; size = [long]0 } }
            $types[$g].count++; $types[$g].size += $f.s
        }
        $cats = foreach ($f in $list) {
            if ($f.d -and $f.p.IndexOf('/') -lt 0) {
                $c = $S.Catalog[$f.p]
                [pscustomobject]@{ path = $f.p; name = $f.n; size = [long]$sizes[$f.p]
                    title = $(if ($c) { $c.title } else { $null }); desc = $(if ($c) { $c.desc } else { $null }); icon = $(if ($c) { $c.icon } else { $null }) }
            }
        }
        $largest = $files | Sort-Object s -Descending | Select-Object -First 10 |
            ForEach-Object { [pscustomobject]@{ path = $_.p; name = $_.n; size = $_.s } }

        $S.Stats = @{
            fileCount = $files.Count; folderCount = $list.Count - $files.Count
            categories = @($cats | Sort-Object size -Descending)
            types = @($types.Values | Sort-Object { $_.size } -Descending)
            largest = @($largest)
        }
        $S.Index = $list; $S.DirSize = $sizes
        $S.IndexedAt = (Get-Date).ToString('s')
      } while ($S.Reindex)
      $S.IndexState = 'ready'
    } catch { $S.IndexState = 'error: ' + $_.Exception.Message }
}.ToString()

function Start-Index {
    $ps = [powershell]::Create()
    [void]$ps.AddScript($S.IndexJobText).AddArgument($S)
    $S.IndexPs = @{ ps = $ps; h = $ps.BeginInvoke() }
}

# ---- Request handler (runs on a pool thread per request) ----
$Handler = {
    param($ctx, $S)
    $ErrorActionPreference = 'Stop'
    $req = $ctx.Request; $res = $ctx.Response
    $utf8 = New-Object Text.UTF8Encoding $false

    function Send-Bytes([byte[]]$b, [string]$type, [int]$code = 200) {
        $res.StatusCode = $code
        $res.ContentType = $type
        $res.Headers['X-Content-Type-Options'] = 'nosniff'
        $res.Headers['Cache-Control'] = 'no-store'
        $res.ContentLength64 = $b.Length
        $res.OutputStream.Write($b, 0, $b.Length)
    }
    function Send-Json($obj, [int]$code = 200) {
        Send-Bytes $utf8.GetBytes((ConvertTo-Json -InputObject $obj -Depth 6 -Compress)) 'application/json; charset=utf-8' $code
    }
    function Get-Query([string]$name) {
        foreach ($pair in $req.Url.Query.TrimStart('?').Split('&')) {
            $kv = $pair.Split('=', 2)
            if ($kv.Count -eq 2 -and [Uri]::UnescapeDataString($kv[0]) -eq $name) {
                return [Uri]::UnescapeDataString($kv[1].Replace('+', ' '))
            }
        }
        return ''
    }
    # Errors are thrown as "<http status>|<message>" and mapped in the catch block below.
    function Resolve-Safe([string]$rel) {
        $rel = ([string]$rel -replace '/', '\').Trim('\')
        if ($rel -match '[:*?"<>|]') { throw '400|Invalid path' }
        if ($rel -like '.dashboard-trash*') { throw '403|Use the Trash view for deleted items' }
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($S.Root, $rel)).TrimEnd('\')
        if ($full.Length -lt 3) { $full = $S.Root }
        if (-not ($full + '\').StartsWith($S.Root, [StringComparison]::OrdinalIgnoreCase)) { throw '400|Invalid path' }
        return $full
    }
    function Get-Rel([string]$full) { if ($full.Length -le $S.Root.Length) { return '' }; $full.Substring($S.Root.Length).TrimEnd('\').Replace('\', '/') }
    function Test-Hidden($fsi) {
        $n = $fsi.Name
        if ($n -eq '$RECYCLE.BIN' -or $n -eq 'System Volume Information' -or $n -eq '.drive-id' -or $n -eq '.DS_Store' -or $n -eq '.dashboard-trash' -or $n.StartsWith('._') -or $n.StartsWith('.Trash-')) { return $true }
        return (([int]$fsi.Attributes -band 6) -eq 6)
    }
    function Add-Catalog($o, [string]$rel) {
        $c = $S.Catalog[$rel]
        if ($c) { $o.title = $c.title; $o.desc = $c.desc; $o.icon = $c.icon; $o.warn = $c.warn }
    }
    function Get-ItemJson([string]$full) {
        $isDir = [IO.Directory]::Exists($full)
        $fi = $(if ($isDir) { New-Object IO.DirectoryInfo $full } else { New-Object IO.FileInfo $full })
        $o = [ordered]@{ name = $fi.Name; path = (Get-Rel $full); dir = $isDir; size = $(if ($isDir) { $null } else { $fi.Length }); count = $null; mtime = $fi.LastWriteTime.ToString('s') }
        Add-Catalog $o $o.path
        [pscustomobject]$o
    }

    # ---- write-side guards ----
    function Assert-Writable { if ($S.ReadOnly) { throw '409|This drive is read-only on this computer' } }
    function Assert-Name([string]$n) {
        if (-not $n -or $n.Length -gt 255 -or $n -match '[\\/:*?"<>|\x00-\x1f]' -or $n -eq '.' -or $n -eq '..' -or
            $n -match '[. ]$' -or $n -match '^(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$' -or $n -ieq '.dashboard-trash' -or $n -ieq '.drive-id') {
            throw '400|That name is not allowed. Avoid \ / : * ? " < > | and names ending in a dot or space.'
        }
    }
    # The drive root, the dashboard itself and the trash can't be renamed, moved or deleted.
    function Assert-Mutable([string]$full) {
        $rel = Get-Rel $full
        if ($rel -eq '' -or $rel -ieq 'Drive_Dashboard' -or $rel -like 'Drive_Dashboard/*' -or $rel -like '.dashboard-trash*') {
            throw "403|'$rel' is protected"
        }
    }
    function Test-Exists([string]$p) { [IO.File]::Exists($p) -or [IO.Directory]::Exists($p) }
    function Get-UniquePath([string]$dir, [string]$name, [bool]$isDir) {
        $p = Join-Path $dir $name
        if (-not (Test-Exists $p)) { return $p }
        $base = $(if ($isDir) { $name } else { [IO.Path]::GetFileNameWithoutExtension($name) })
        $ext  = $(if ($isDir) { '' } else { [IO.Path]::GetExtension($name) })
        for ($i = 2; ; $i++) { $p = Join-Path $dir "$base ($i)$ext"; if (-not (Test-Exists $p)) { return $p } }
    }
    function Move-Any([string]$src, [string]$dst) {
        if ([IO.Directory]::Exists($src)) { [IO.Directory]::Move($src, $dst) } else { [IO.File]::Move($src, $dst) }
    }
    function Copy-Tree([string]$src, [string]$dst) {
        [void][IO.Directory]::CreateDirectory($dst)
        foreach ($f in [IO.Directory]::GetFiles($src)) { [IO.File]::Copy($f, (Join-Path $dst ([IO.Path]::GetFileName($f)))) }
        foreach ($d in (New-Object IO.DirectoryInfo $src).GetDirectories()) {
            if ($d.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            Copy-Tree $d.FullName (Join-Path $dst $d.Name)
        }
    }
    # Deletes a tree without following junctions and even when files are read-only.
    function Remove-Tree([string]$p) {
        if ([IO.File]::Exists($p)) { [IO.File]::SetAttributes($p, 'Normal'); [IO.File]::Delete($p); return }
        $di = New-Object IO.DirectoryInfo $p
        if ($di.Attributes -band [IO.FileAttributes]::ReparsePoint) { $di.Delete(); return }
        foreach ($f in $di.GetFiles()) { $f.Attributes = 'Normal'; $f.Delete() }
        foreach ($d in $di.GetDirectories()) { Remove-Tree $d.FullName }
        $di.Attributes = 'Directory'; $di.Delete()
    }
    function Get-TreeSize([string]$p) {
        if ([IO.File]::Exists($p)) { return (New-Object IO.FileInfo $p).Length }
        $sum = [long]0
        try { foreach ($f in (New-Object IO.DirectoryInfo $p).EnumerateFiles('*', 'AllDirectories')) { $sum += $f.Length } } catch {}
        return $sum
    }
    function Request-Reindex {
        $S.Reindex = $true
        if ($S.IndexState -ne 'building') {
            $S.IndexState = 'building'
            $ps = [powershell]::Create()
            [void]$ps.AddScript($S.IndexJobText).AddArgument($S)
            $S.IndexPs = @{ ps = $ps; h = $ps.BeginInvoke() }
        }
    }
    function New-Id { (Get-Date).ToString('yyyyMMddHHmmssfff') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6)) }

    # ---- text files (Notepad) ----
    function Get-Version([string]$full) { $fi = New-Object IO.FileInfo $full; "$($fi.Length)-$($fi.LastWriteTimeUtc.Ticks)" }
    function Get-Encoder([string]$name) {
        switch ($name) {
            'utf-8'     { return @{ enc = (New-Object Text.UTF8Encoding $false); bom = [byte[]]@() } }
            'utf-8-bom' { return @{ enc = (New-Object Text.UTF8Encoding $false); bom = [byte[]]@(0xEF, 0xBB, 0xBF) } }
            'utf-16le'  { return @{ enc = (New-Object Text.UnicodeEncoding $false, $false); bom = [byte[]]@(0xFF, 0xFE) } }
            'utf-16be'  { return @{ enc = (New-Object Text.UnicodeEncoding $true, $false); bom = [byte[]]@(0xFE, 0xFF) } }
            'ansi'      { return @{ enc = [Text.Encoding]::GetEncoding(1252); bom = [byte[]]@() } }
            default     { throw '400|Unknown encoding' }
        }
    }
    # Journaling idea (Silberschatz ch. 14): write a temp file, then swap it in, so an unplug
    # mid-save leaves either the old or the new file - never a half-written one.
    function Write-Atomic([string]$full, [byte[]]$bytes) {
        $tmp = "$full.saving-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
        $fs = New-Object IO.FileStream($tmp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try { $fs.Write($bytes, 0, $bytes.Length); $fs.Flush($true) } finally { $fs.Dispose() }   # flush to the device
        try {
            if ([IO.File]::Exists($full)) {
                try { [IO.File]::Replace($tmp, $full, $null) }
                catch { [IO.File]::Delete($full); [IO.File]::Move($tmp, $full) }
            } else { [IO.File]::Move($tmp, $full) }
        } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
    }

    try {
        if (-not $req.IsLocal) { Send-Json @{ error = 'Local access only' } 403; return }
        if ($req.Headers['Host'] -ne "localhost:$($S.Port)") { Send-Json @{ error = 'Bad host' } 421; return }
        $path = $req.Url.AbsolutePath

        # ---- static UI ----
        if (-not $path.StartsWith('/api/') -and $path -ne '/raw') {
            $static = @{ '/' = 'index.html|text/html; charset=utf-8'; '/app.js' = 'app.js|text/javascript; charset=utf-8'
                         '/files.js' = 'files.js|text/javascript; charset=utf-8'; '/notepad.js' = 'notepad.js|text/javascript; charset=utf-8'
                         '/catalog.js' = 'catalog.js|text/javascript; charset=utf-8'
                         '/style.css' = 'style.css|text/css; charset=utf-8'; '/icon.svg' = 'icon.svg|image/svg+xml'
                         '/favicon.ico' = '..\drive.ico|image/x-icon' }
            $entry = $static[$path]
            if (-not $entry) { Send-Json @{ error = 'Not found' } 404; return }
            $file, $type = $entry.Split('|')
            if ($path -eq '/') {
                $res.Headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' data:; media-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"
                $res.Headers['Referrer-Policy'] = 'no-referrer'
            }
            Send-Bytes ([IO.File]::ReadAllBytes((Join-Path $S.Web $file))) $type
            return
        }

        # ---- auth ----
        $tok = $req.Headers['X-Token']
        if ($path -eq '/raw') { $tok = Get-Query 't' }
        if ($tok -ne $S.Token) { Send-Json @{ error = 'Unauthorized' } 401; return }
        $body = $null
        if ($req.HttpMethod -eq 'POST') {
            $origin = $req.Headers['Origin']
            if ($origin -and $origin -ne "http://localhost:$($S.Port)") { Send-Json @{ error = 'Bad origin' } 403; return }
            if ($path -eq '/api/upload') {
                # raw file bytes; streamed straight to disk below
                if ($req.ContentType -notlike 'application/octet-stream*') { Send-Json @{ error = 'Binary body required' } 415; return }
            } else {
                if ($req.ContentType -notlike 'application/json*') { Send-Json @{ error = 'JSON required' } 415; return }
                $body = (New-Object IO.StreamReader($req.InputStream, $utf8)).ReadToEnd() | ConvertFrom-Json
                if (-not $body) { $body = New-Object psobject }
            }
        }

        if ($path -eq '/api/ping') {
            Send-Json @{ ok = $true; serial = $S.Serial }
        }
        elseif ($path -eq '/api/info') {
            $di = New-Object IO.DriveInfo $S.DriveRoot
            $rl = $(if ($S.Root -ieq $S.DriveRoot) { 'Drive ' + $S.Root.TrimEnd('\') } else { $S.Root })
            Send-Json @{ label = $S.Label; root = $S.Root; rootLabel = $rl; sep = '\'; platform = 'windows'
                         firstRun = (-not $S.CatalogExists); readOnly = $S.ReadOnly; total = $di.TotalSize; free = $di.AvailableFreeSpace
                         indexState = $S.IndexState; indexedAt = $S.IndexedAt; stats = $S.Stats }
        }
        elseif ($path -eq '/api/list') {
            $full = Resolve-Safe (Get-Query 'path')
            if (-not [IO.Directory]::Exists($full)) { Send-Json @{ error = 'Folder not found' } 404; return }
            $items = New-Object Collections.ArrayList
            foreach ($e in (New-Object IO.DirectoryInfo $full).GetFileSystemInfos()) {
                if (Test-Hidden $e) { continue }
                $rel = Get-Rel $e.FullName
                $isDir = ([int]$e.Attributes -band 16) -ne 0
                $o = [ordered]@{ name = $e.Name; path = $rel; dir = $isDir; size = $null; count = $null; mtime = $e.LastWriteTime.ToString('s') }
                if ($isDir) {
                    if ($S.DirSize) { $o.size = [long]$S.DirSize[$rel] }
                    try { $o.count = @([IO.Directory]::EnumerateFileSystemEntries($e.FullName)).Count } catch {}
                } else { $o.size = $e.Length }
                Add-Catalog $o $rel
                [void]$items.Add([pscustomobject]$o)
            }
            $here = [ordered]@{ path = (Get-Rel $full) }
            Add-Catalog $here $here.path
            Send-Json @{ folder = [pscustomobject]$here; items = @($items) }
        }
        elseif ($path -eq '/api/search') {
            # A previous index keeps search working while a rebuild runs after changes.
            if (-not $S.Index) { Send-Json @{ state = $S.IndexState; total = 0; items = @() }; return }
            $terms = @((Get-Query 'q').ToLowerInvariant().Split(' ', [StringSplitOptions]::RemoveEmptyEntries))
            $scope = (Get-Query 'scope').Trim('/')
            $out = New-Object Collections.ArrayList; $total = 0
            if ($terms.Count -gt 0) {
                foreach ($f in $S.Index) {
                    if ($scope -and -not $f.p.StartsWith($scope + '/', [StringComparison]::OrdinalIgnoreCase)) { continue }
                    $ok = $true
                    foreach ($t in $terms) { if ($f.l.IndexOf($t) -lt 0) { $ok = $false; break } }
                    if (-not $ok) { continue }
                    $total++
                    if ($out.Count -lt 300) {
                        $o = [ordered]@{ name = $f.n; path = $f.p; dir = $f.d; size = $(if ($f.d) { [long]$S.DirSize[$f.p] } else { $f.s }); mtime = $f.m }
                        Add-Catalog $o $f.p
                        [void]$out.Add([pscustomobject]$o)
                    }
                }
            }
            Send-Json @{ state = 'ready'; total = $total; items = @($out) }
        }
        elseif ($path -eq '/raw') {
            $full = Resolve-Safe (Get-Query 'path')
            if (-not [IO.File]::Exists($full)) { Send-Json @{ error = 'File not found' } 404; return }
            $ext = [IO.Path]::GetExtension($full).TrimStart('.').ToLowerInvariant()
            $mime = @{ png = 'image/png'; jpg = 'image/jpeg'; jpeg = 'image/jpeg'; gif = 'image/gif'; webp = 'image/webp'; bmp = 'image/bmp'; ico = 'image/x-icon'
                       mp4 = 'video/mp4'; m4v = 'video/mp4'; webm = 'video/webm'; mkv = 'video/x-matroska'; mov = 'video/quicktime'
                       mp3 = 'audio/mpeg'; wav = 'audio/wav'; ogg = 'audio/ogg'; m4a = 'audio/mp4'; flac = 'audio/flac'; pdf = 'application/pdf' }[$ext]
            if (-not $mime) {
                $textExt = ' txt log md json csv ps1 sh bat cmd py js ts css html htm xml c cpp h java asm mac ini cfg conf yaml yml sha256 sql svg '
                $mime = $(if ($ext -eq '' -or $textExt.Contains(" $ext ")) { 'text/plain; charset=utf-8' } else { 'application/octet-stream' })
            }
            # PDFs need the browser's viewer (blocked inside a sandbox); everything else is sandboxed.
            if ($ext -ne 'pdf') { $res.Headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'" }
            $res.Headers['X-Content-Type-Options'] = 'nosniff'
            $res.Headers['Accept-Ranges'] = 'bytes'
            if ((Get-Query 'download') -eq '1') {
                $fn = [IO.Path]::GetFileName($full)
                $ascii = ($fn -replace '[^\x20-\x7e]', '_') -replace '["\\]', '_'
                $res.Headers['Content-Disposition'] = "attachment; filename=`"$ascii`"; filename*=UTF-8''" + [Uri]::EscapeDataString($fn)
            }
            $fs = [IO.File]::Open($full, 'Open', 'Read', 'ReadWrite')
            try {
                # Byte-range support so video can seek (cf. Tanenbaum's file-server byte-range exercise).
                $len = $fs.Length; $start = [long]0; $end = $len - 1
                $m = [regex]::Match([string]$req.Headers['Range'], '^bytes=(\d*)-(\d*)$')
                if ($m.Success) {
                    if ($m.Groups[1].Value -ne '') {
                        $start = [long]$m.Groups[1].Value
                        if ($m.Groups[2].Value -ne '') { $end = [Math]::Min([long]$m.Groups[2].Value, $len - 1) }
                    } elseif ($m.Groups[2].Value -ne '') {
                        $start = [Math]::Max([long]0, $len - [long]$m.Groups[2].Value)
                    }
                    if ($start -ge $len -or $start -gt $end) {
                        $res.StatusCode = 416; $res.Headers['Content-Range'] = "bytes */$len"; $res.ContentLength64 = 0; return
                    }
                    $res.StatusCode = 206
                    $res.Headers['Content-Range'] = "bytes $start-$end/$len"
                }
                $res.ContentType = $mime
                $remain = $end - $start + 1
                $res.ContentLength64 = [Math]::Max([long]0, $remain)
                [void]$fs.Seek($start, 'Begin')
                $buf = New-Object byte[] 262144
                while ($remain -gt 0) {
                    $n = $fs.Read($buf, 0, [int][Math]::Min($buf.Length, $remain))
                    if ($n -le 0) { break }
                    $res.OutputStream.Write($buf, 0, $n)
                    $remain -= $n
                }
            } finally { $fs.Dispose() }
        }
        elseif ($path -eq '/api/open' -and $body) {
            $full = Resolve-Safe $body.path
            if ([IO.Directory]::Exists($full)) { Start-Process explorer.exe -ArgumentList "`"$full`"" }
            elseif ([IO.File]::Exists($full)) { Start-Process -FilePath $full -WorkingDirectory ([IO.Path]::GetDirectoryName($full)) }
            else { Send-Json @{ error = 'Not found' } 404; return }
            Send-Json @{ ok = $true }
        }
        elseif ($path -eq '/api/reveal' -and $body) {
            $full = Resolve-Safe $body.path
            if (-not (Test-Path -LiteralPath $full)) { Send-Json @{ error = 'Not found' } 404; return }
            Start-Process explorer.exe -ArgumentList "/select,`"$full`""
            Send-Json @{ ok = $true }
        }
        elseif ($path -eq '/api/rescan' -and $req.HttpMethod -eq 'POST') {
            if ($S.IndexState -ne 'building') {
                $S.IndexState = 'building'
                $ps = [powershell]::Create()
                [void]$ps.AddScript($S.IndexJobText).AddArgument($S)
                $S.IndexPs = @{ ps = $ps; h = $ps.BeginInvoke() }
            }
            Send-Json @{ ok = $true; state = $S.IndexState }
        }
        elseif ($path -eq '/api/shutdown' -and $req.HttpMethod -eq 'POST') {
            $S.Stop = $true
            Send-Json @{ ok = $true }
        }

        # ======================= Create / Update / Delete =======================
        elseif ($path -eq '/api/mkdir' -and $body) {
            Assert-Writable; Assert-Name $body.name
            $dir = Resolve-Safe $body.path
            if (-not [IO.Directory]::Exists($dir)) { throw '404|Folder not found' }
            $t = Join-Path $dir $body.name
            if (Test-Exists $t) { throw '409|Something with that name already exists here' }
            [void][IO.Directory]::CreateDirectory($t)
            Request-Reindex
            Send-Json @{ ok = $true; item = (Get-ItemJson $t) }
        }
        elseif ($path -eq '/api/newfile' -and $body) {
            Assert-Writable; Assert-Name $body.name
            $dir = Resolve-Safe $body.path
            if (-not [IO.Directory]::Exists($dir)) { throw '404|Folder not found' }
            $t = Join-Path $dir $body.name
            if (Test-Exists $t) { throw '409|Something with that name already exists here' }
            [IO.File]::WriteAllBytes($t, [byte[]]@())
            Request-Reindex
            Send-Json @{ ok = $true; item = (Get-ItemJson $t) }
        }
        elseif ($path -eq '/api/rename' -and $body) {
            Assert-Writable; Assert-Name $body.name
            $full = Resolve-Safe $body.path
            if (-not (Test-Exists $full)) { throw '404|Not found' }
            Assert-Mutable $full
            $t = Join-Path ([IO.Path]::GetDirectoryName($full)) $body.name
            if ($t -ceq $full) { Send-Json @{ ok = $true; item = (Get-ItemJson $full) }; return }
            if ($t -ieq $full) {
                # case-only rename on a case-insensitive file system: go via a temporary name
                $tmp = "$full.rename-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
                Move-Any $full $tmp; Move-Any $tmp $t
            } else {
                if (Test-Exists $t) { throw '409|Something with that name already exists here' }
                Move-Any $full $t
            }
            Request-Reindex
            Send-Json @{ ok = $true; item = (Get-ItemJson $t) }
        }
        elseif (($path -eq '/api/move' -or $path -eq '/api/copy') -and $body) {
            Assert-Writable
            $dest = Resolve-Safe $body.dest
            if (-not [IO.Directory]::Exists($dest)) { throw '404|Destination folder not found' }
            $isMove = $path -eq '/api/move'
            $done = New-Object Collections.ArrayList; $skipped = New-Object Collections.ArrayList
            foreach ($p in @($body.paths)) {
                $full = Resolve-Safe $p
                if (-not (Test-Exists $full)) { [void]$skipped.Add("$p (not found)"); continue }
                if ($isMove) { Assert-Mutable $full } elseif ((Get-Rel $full) -eq '') { throw '403|Cannot copy the whole drive' }
                $isDir = [IO.Directory]::Exists($full)
                if ($isDir -and ($dest + '\').StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
                    [void]$skipped.Add("$p (a folder can't go inside itself)"); continue
                }
                if ($isMove -and ([IO.Path]::GetDirectoryName($full).TrimEnd('\') -ieq $dest.TrimEnd('\'))) { [void]$skipped.Add("$p (already here)"); continue }
                $t = Get-UniquePath $dest ([IO.Path]::GetFileName($full)) $isDir
                if ($isMove) { Move-Any $full $t } elseif ($isDir) { Copy-Tree $full $t } else { [IO.File]::Copy($full, $t) }
                [void]$done.Add((Get-Rel $t))
            }
            if ($done.Count) { Request-Reindex }
            Send-Json @{ ok = $true; done = @($done); skipped = @($skipped) }
        }
        elseif ($path -eq '/api/delete' -and $body) {
            # "Delete" = move into the drive's hidden .dashboard-trash so it can be restored.
            Assert-Writable
            if (-not [IO.Directory]::Exists($S.Trash)) {
                $td = [IO.Directory]::CreateDirectory($S.Trash)
                $td.Attributes = $td.Attributes -bor [IO.FileAttributes]::Hidden
            }
            $n = 0
            foreach ($p in @($body.paths)) {
                $full = Resolve-Safe $p
                if (-not (Test-Exists $full)) { continue }
                Assert-Mutable $full
                $isDir = [IO.Directory]::Exists($full)
                $rel = Get-Rel $full
                $size = Get-TreeSize $full   # measured now: the index's cached sizes can be stale after edits
                $id = New-Id
                $holder = Join-Path $S.Trash $id
                [void][IO.Directory]::CreateDirectory($holder)
                Move-Any $full (Join-Path $holder ([IO.Path]::GetFileName($full)))
                $meta = [ordered]@{ id = $id; name = [IO.Path]::GetFileName($full); from = $rel; dir = $isDir; size = $size; deleted = (Get-Date).ToString('s') }
                [IO.File]::WriteAllText("$holder.json", (ConvertTo-Json $meta -Compress), $utf8)
                $n++
            }
            if ($n) { Request-Reindex }
            Send-Json @{ ok = $true; count = $n }
        }
        elseif ($path -eq '/api/trash') {
            $items = New-Object Collections.ArrayList; $total = [long]0
            if ([IO.Directory]::Exists($S.Trash)) {
                foreach ($f in [IO.Directory]::GetFiles($S.Trash, '*.json')) {
                    try { $m = [IO.File]::ReadAllText($f, $utf8) | ConvertFrom-Json } catch { continue }
                    if (-not (Test-Exists (Join-Path (Join-Path $S.Trash $m.id) $m.name))) { continue }
                    [void]$items.Add($m); $total += [long]$m.size
                }
            }
            Send-Json @{ items = @($items | Sort-Object deleted -Descending); total = $total }
        }
        elseif ($path -eq '/api/restore' -and $body) {
            Assert-Writable
            $done = New-Object Collections.ArrayList
            foreach ($id in @($body.ids)) {
                if ($id -notmatch '^\d{17}-[0-9a-f]{6}$') { continue }
                $holder = Join-Path $S.Trash $id; $metaFile = "$holder.json"
                if (-not [IO.File]::Exists($metaFile)) { continue }
                $m = [IO.File]::ReadAllText($metaFile, $utf8) | ConvertFrom-Json
                $src = Join-Path $holder $m.name
                if (-not (Test-Exists $src)) { continue }
                $parent = [IO.Path]::GetDirectoryName((Resolve-Safe $m.from))
                [void][IO.Directory]::CreateDirectory($parent)
                $t = Get-UniquePath $parent $m.name ([bool]$m.dir)
                Move-Any $src $t
                [IO.Directory]::Delete($holder); [IO.File]::Delete($metaFile)
                [void]$done.Add((Get-Rel $t))
            }
            if ($done.Count) { Request-Reindex }
            Send-Json @{ ok = $true; done = @($done) }
        }
        elseif ($path -eq '/api/purge' -and $body) {
            Assert-Writable
            $ids = @($body.ids)
            if ($body.all -and [IO.Directory]::Exists($S.Trash)) {
                $ids = @([IO.Directory]::GetFiles($S.Trash, '*.json') | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_) })
            }
            $n = 0
            foreach ($id in $ids) {
                if ($id -notmatch '^\d{17}-[0-9a-f]{6}$') { continue }
                $holder = Join-Path $S.Trash $id
                if ([IO.Directory]::Exists($holder)) { Remove-Tree $holder }
                if ([IO.File]::Exists("$holder.json")) { [IO.File]::Delete("$holder.json") }
                $n++
            }
            Send-Json @{ ok = $true; count = $n }
        }
        elseif ($path -eq '/api/upload' -and $req.HttpMethod -eq 'POST') {
            Assert-Writable
            $name = Get-Query 'name'; Assert-Name $name
            $dir = Resolve-Safe (Get-Query 'path')
            if (-not [IO.Directory]::Exists($dir)) { throw '404|Folder not found' }
            $t = Get-UniquePath $dir $name $false
            $tmp = "$t.uploading-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
            $fs = [IO.File]::Create($tmp)
            try { $req.InputStream.CopyTo($fs, 1048576); $fs.Dispose() }
            catch { $fs.Dispose(); [IO.File]::Delete($tmp); throw }
            [IO.File]::Move($tmp, $t)
            Request-Reindex
            Send-Json @{ ok = $true; item = (Get-ItemJson $t) }
        }

        # ======================= Catalog (folder descriptions) =======================
        elseif ($path -eq '/api/catalog' -and $req.HttpMethod -eq 'GET') {
            Send-Json @{ entries = $S.Catalog; exists = $S.CatalogExists; readOnly = $S.ReadOnly }
        }
        elseif ($path -eq '/api/catalog' -and $body) {
            # body.set = { "<folder path>": {title, desc, icon, cat, warn, auto} | null }
            $new = @{}
            if (-not $body.replace) { foreach ($k in $S.Catalog.Keys) { $new[$k] = $S.Catalog[$k] } }
            if ($body.set) {
                foreach ($prop in $body.set.PSObject.Properties) {
                    $key = ([string]$prop.Name).Trim('/')
                    if ($key.Length -gt 1024 -or $key -match '(^|/)\.\.(/|$)') { continue }
                    $new.Remove($key)
                    if ($null -eq $prop.Value) { continue }
                    $e = [ordered]@{}
                    foreach ($f in 'title', 'desc', 'icon', 'cat', 'warn') {
                        $v = $prop.Value.$f
                        if ($v) { $e[$f] = ([string]$v).Substring(0, [Math]::Min(600, ([string]$v).Length)) }
                    }
                    if ($prop.Value.auto) { $e.auto = $true }
                    if ($e.Count) { $new[$key] = [pscustomobject]$e }
                }
            }
            $S.Catalog = $new
            $saved = $false
            if (-not $S.ReadOnly) {
                # one tidy line per folder - people edit this file by hand
                $lines = foreach ($k in ($new.Keys | Sort-Object)) {
                    '  ' + (ConvertTo-Json ([string]$k) -Compress) + ': ' + (ConvertTo-Json $new[$k] -Compress -Depth 3)
                }
                Write-Atomic $S.CatalogFile $utf8.GetBytes("{`n" + ($lines -join ",`n") + "`n}`n")
                $S.CatalogExists = $true
                $saved = $true
            }
            Send-Json @{ ok = $true; saved = $saved; count = $new.Count }
        }
        elseif ($path -eq '/api/tree') {
            # Folders down to 3 levels with (up to 60 of) their direct files: input for describing folders.
            if (-not $S.Index) { Send-Json @{ state = $S.IndexState; dirs = @() }; return }
            $dirs = @{}
            foreach ($f in $S.Index) {
                if ($f.d -and $f.p.Split('/').Length -le 3) {
                    $dirs[$f.p] = @{ path = $f.p; name = $f.n; files = (New-Object Collections.ArrayList); dirs = (New-Object Collections.ArrayList); fileCount = 0 }
                }
            }
            foreach ($f in $S.Index) {
                $i = $f.p.LastIndexOf('/')
                $parent = $(if ($i -lt 0) { '' } else { $f.p.Substring(0, $i) })
                $node = $dirs[$parent]
                if (-not $node) { continue }
                if ($f.d) { [void]$node.dirs.Add($f.n) }
                else { $node.fileCount++; if ($node.files.Count -lt 60) { [void]$node.files.Add(@{ n = $f.n; s = $f.s }) } }
            }
            $out = foreach ($d in $dirs.Values) {
                [pscustomobject]@{ path = $d.path; name = $d.name; fileCount = $d.fileCount; size = [long]$S.DirSize[$d.path]; files = @($d.files); dirs = @($d.dirs) }
            }
            Send-Json @{ state = 'ready'; dirs = @($out) }
        }

        # ======================= Notepad =======================
        elseif ($path -eq '/api/read') {
            $full = Resolve-Safe (Get-Query 'path')
            if (-not [IO.File]::Exists($full)) { throw '404|File not found' }
            $fi = New-Object IO.FileInfo $full
            if ($fi.Length -gt 10MB) { throw '413|This file is too big for Notepad (over 10 MB)' }
            $b = [IO.File]::ReadAllBytes($full)
            $encName = 'utf-8'
            if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $encName = 'utf-8-bom'; $text = $utf8.GetString($b, 3, $b.Length - 3) }
            elseif ($b.Length -ge 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xFE) { $encName = 'utf-16le'; $text = [Text.Encoding]::Unicode.GetString($b, 2, $b.Length - 2) }
            elseif ($b.Length -ge 2 -and $b[0] -eq 0xFE -and $b[1] -eq 0xFF) { $encName = 'utf-16be'; $text = [Text.Encoding]::BigEndianUnicode.GetString($b, 2, $b.Length - 2) }
            else {
                if ([Array]::IndexOf($b, [byte]0, 0, [Math]::Min($b.Length, 8192)) -ge 0) { throw '415|This looks like a binary file, not text' }
                try { $text = (New-Object Text.UTF8Encoding $false, $true).GetString($b) }
                catch { $encName = 'ansi'; $text = [Text.Encoding]::GetEncoding(1252).GetString($b) }
            }
            $crlf = [regex]::Matches($text, "`r`n").Count
            $lf   = [regex]::Matches($text, "(?<!`r)`n").Count
            $cr   = [regex]::Matches($text, "`r(?!`n)").Count
            $eol = 'crlf'
            if ($lf -gt $crlf -and $lf -ge $cr) { $eol = 'lf' } elseif ($cr -gt $crlf -and $cr -gt $lf) { $eol = 'cr' }
            Send-Json @{ path = (Get-Rel $full); name = $fi.Name; text = $text; encoding = $encName; eol = $eol
                         version = (Get-Version $full); readOnly = ($S.ReadOnly -or $fi.IsReadOnly); size = $fi.Length }
        }
        elseif ($path -eq '/api/save' -and $body) {
            Assert-Writable
            if ($body.path) {
                $full = Resolve-Safe $body.path
                if (-not [IO.File]::Exists($full)) { throw '404|File not found - it may have been moved or deleted. Use Save As.' }
                # Consistency check (Silberschatz 15.7): refuse to silently overwrite someone else's change.
                if ($body.version -and -not $body.force -and (Get-Version $full) -ne $body.version) {
                    Send-Json @{ error = 'This file was changed outside Notepad since you opened it.'; conflict = $true } 409; return
                }
            } else {
                Assert-Name $body.name
                $dir = Resolve-Safe $body.dir
                if (-not [IO.Directory]::Exists($dir)) { throw '404|Folder not found' }
                $full = Join-Path $dir $body.name
                if ([IO.Directory]::Exists($full)) { throw '409|A folder with that name already exists' }
                if ([IO.File]::Exists($full) -and -not $body.overwrite) { Send-Json @{ error = "$($body.name) already exists."; exists = $true } 409; return }
            }
            if ([IO.File]::Exists($full) -and (New-Object IO.FileInfo $full).IsReadOnly) { throw '403|The file is marked read-only' }
            $text = ([string]$body.text).Replace("`r`n", "`n").Replace("`r", "`n")
            if ($body.eol -eq 'crlf') { $text = $text.Replace("`n", "`r`n") } elseif ($body.eol -eq 'cr') { $text = $text.Replace("`n", "`r") }
            $e = Get-Encoder ([string]$body.encoding)
            $data = $e.enc.GetBytes($text)
            if ($body.encoding -eq 'ansi' -and -not $body.lossy -and $e.enc.GetString($data) -ne $text) {
                Send-Json @{ error = 'Some characters can''t be stored as ANSI and would be lost.'; lossy = $true } 422; return
            }
            $ms = New-Object IO.MemoryStream
            $ms.Write($e.bom, 0, $e.bom.Length); $ms.Write($data, 0, $data.Length)
            $isNew = -not [IO.File]::Exists($full)
            Write-Atomic $full $ms.ToArray()
            if ($isNew) { Request-Reindex }
            Send-Json @{ ok = $true; path = (Get-Rel $full); name = [IO.Path]::GetFileName($full); version = (Get-Version $full); size = $ms.Length }
        }
        else { Send-Json @{ error = 'Not found' } 404 }
    }
    catch {
        $msg = $_.Exception.Message; $code = 500
        if ($msg -match '^(\d{3})\|(.*)$') { $code = [int]$Matches[1]; $msg = $Matches[2] }
        elseif ($msg -match 'being used by another process') { $code = 409; $msg = 'It is open in another program. Close it and try again.' }
        elseif ($msg -match 'Access to the path .* is denied') { $code = 403; $msg = 'Access denied by the file system.' }
        try { Send-Json @{ error = $msg } $code } catch {}
    }
    finally {
        try { $res.Close() } catch {}
    }
}.ToString()

# ---- Main loop: accept requests, hand them to a bounded pool of worker runspaces ----
$Pool = [runspacefactory]::CreateRunspacePool(1, 8)
$Pool.Open()
$Jobs = New-Object Collections.ArrayList
Start-Index
Write-Log "Started on port $Port for $Root ($Serial)"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/#t=$Token" }

try {
    while (-not $S.Stop) {
        $task = $Listener.GetContextAsync()
        while (-not $task.AsyncWaitHandle.WaitOne(1000)) {
            if ($S.Stop -or -not (Test-Path -LiteralPath $Root)) { $S.Stop = $true; break }   # drive unplugged
            foreach ($j in @($Jobs)) {
                if ($j.h.IsCompleted) { try { [void]$j.ps.EndInvoke($j.h) } catch {}; $j.ps.Dispose(); $Jobs.Remove($j) }
            }
        }
        if ($S.Stop) { break }
        $ps = [powershell]::Create()
        $ps.RunspacePool = $Pool
        [void]$ps.AddScript($Handler).AddArgument($task.Result).AddArgument($S)
        [void]$Jobs.Add(@{ ps = $ps; h = $ps.BeginInvoke() })
    }
} catch {
    Write-Log "Main loop error: $($_.Exception.Message)"
} finally {
    Start-Sleep -Milliseconds 300   # let the shutdown response flush
    try { $Listener.Stop(); $Listener.Close() } catch {}
    try { $Pool.Close() } catch {}
    Remove-Item $SessionFile -ErrorAction SilentlyContinue
    Write-Log 'Stopped'
}
