# Drive Dashboard

A web dashboard that lives **on your external drive** and opens in your browser: see everything on the
drive grouped by what it's for, search it, preview files, manage files (with a Trash you can restore
from), and edit text files in a built-in Notepad. Works on **Windows, Linux and macOS**, needs nothing
installed on Windows (Python 3 on Linux/macOS), and never talks to the internet.

## Put it on a drive
1. Copy the `Drive_Dashboard` folder to the **top level** of your drive (e.g. `F:\Drive_Dashboard`).
2. Open it:
   - Windows: double-click `Start-Dashboard.bat`
   - macOS: double-click `Start-Dashboard.command`
   - Linux: `sh start-dashboard.sh`
3. **First run:** the dashboard looks at what's on the drive and writes a description for folders it
   recognises (common apps and installers, Windows/Linux ISOs, folders of photos, videos, documents…).
   Fix or add any description with right-click › **Edit description…**.
4. Optional, once per computer: run the installer in `Drive_Dashboard/autolaunch` so the dashboard
   opens by itself whenever the drive is plugged in. (No operating system lets a drive do that without
   your permission - that's what stops USB viruses.)

Details for end users are in `Drive_Dashboard/README.txt`.

## Features
- Overview of the drive: space used/free, space by folder, largest files, file types
- Browse, search the whole drive, preview images/video/audio/PDF/text, open or reveal in the file manager
- Create, rename, move, copy, upload (drag & drop), download, delete to a restorable Trash
- Notepad: tabs, find/replace, go to line, encodings (UTF-8/UTF-16/ANSI), line endings, session restore
- Light/dark theme, works on narrow screens

## Security
Listens on `localhost` only, every request needs a random per-session key, paths can't leave the drive,
files from the drive are sandboxed when previewed, and saves are crash-safe (write to a temp file, then
swap). Deleting moves to the drive's Trash; nothing is gone until you empty it.

## Development
`tools/Deploy-ToDrive.ps1` installs or updates a drive without touching its own `catalog.json`/`.drive-id`.

## License
This project is licensed under the [MIT License](LICENSE).