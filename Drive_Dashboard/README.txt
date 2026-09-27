DRIVE DASHBOARD
===============

A web page for browsing this drive: categories with a description of every
application, search across all files, previews (images, video, audio, PDF,
text), Open / Show-in-folder buttons, and storage statistics.
Works on Windows, Linux and macOS.


PUT IT ON A DRIVE
-----------------
Copy the whole Drive_Dashboard folder to the top of any drive (e.g. F:\Drive_Dashboard) and open it.
The first time it runs on a drive it sets itself up:
  * describes the drive's folders from what's inside them (known apps and installers, Windows /
    Linux ISOs, folders of photos, videos, documents...) and saves that as catalog.json;
    folders it can't recognise just show their name
  * gives the drive its own ID (.drive-id) and, on Windows, the dashboard logo as its icon
  * shows a welcome card with how to turn on auto-open for the computer you're using
Change or add any description: right-click a folder > Edit description...
Your own descriptions are never overwritten.


OPEN IT BY HAND
---------------
  Windows   double-click  Start-Dashboard.bat
  macOS     double-click  Start-Dashboard.command
  Linux     double-click  start-dashboard.sh   (choose "Run"), or:  sh start-dashboard.sh

Windows needs nothing extra. Linux and macOS need Python 3:
  Linux: already installed on almost every distro (else: sudo apt install python3)
  macOS: the first time, a window offers to install Apple's command line tools. Accept it.

Keyboard:  /  search      Esc  close / clear      Backspace  up one folder


MANAGING FILES
--------------
  New folder / New text file / Upload    buttons above every folder (or drag files in)
  Right-click (or the ... button)        Open, Edit in Notepad, Download, Show in folder,
                                         Rename (F2), Copy to, Move to, Duplicate, Delete (Del)
  Select several                         Ctrl/Cmd+click or Shift+click, or tick the icon; Ctrl+A = all
  Delete                                 moves items to Trash (sidebar). Restore them from there.
                                         Nothing is gone for good until you click "Delete forever"
                                         or "Empty Trash". The trash lives on the drive, in the
                                         hidden folder .dashboard-trash, and still uses space.

The Drive_Dashboard folder itself is protected (can't be renamed, moved or deleted here).
On a Mac the drive is read-only (macOS can't write NTFS), so these buttons are switched off
there. Browsing, previewing and downloading still work.


NOTEPAD
-------
Sidebar > Notepad, or "Edit" on any text file. Works like Windows 11 Notepad:
  tabs (your open tabs and unsaved text come back next time), Find (Ctrl+F),
  Replace (Ctrl+H), F3 / Shift+F3, Go to line (Ctrl+G), Time/Date (F5),
  Zoom (Ctrl +/-/0 or Ctrl+wheel), word wrap, font, status bar.
  Click the line-ending or encoding in the status bar to change how the file is saved:
  Windows (CRLF) / Unix (LF) / Mac (CR); UTF-8, UTF-8 with BOM, UTF-16 LE/BE, ANSI.

  Save Ctrl+S   Save as Ctrl+Shift+S   Open Ctrl+O
  New tab Ctrl+Alt+N   Close tab Ctrl+Alt+W   (browsers reserve Ctrl+N / Ctrl+W)

Saving is crash-safe: the new text is written to a temporary file first and then swapped in,
so unplugging mid-save never leaves a half-written file. If another program changed the file
while you were editing, Notepad asks before overwriting.
Files up to 10 MB can be edited.


OPEN AUTOMATICALLY WHEN THE DRIVE IS PLUGGED IN
-----------------------------------------------
No operating system lets a drive start programs by itself when plugged in.
That is what stops USB viruses. So each computer must agree ONCE by running
the installer below. After that, plugging the drive in opens the dashboard.

                 turn ON                                  turn OFF
  Windows   autolaunch\Install-AutoLaunch.bat        autolaunch\Uninstall-AutoLaunch.bat
  macOS     autolaunch/Install-AutoLaunch.command    autolaunch/Uninstall-AutoLaunch.command
  Linux     sh autolaunch/install-autolaunch.sh      sh autolaunch/install-autolaunch.sh --uninstall

No admin rights needed. It installs a tiny helper for your user account only:
  Windows  %LOCALAPPDATA%\DriveDashboard + a shortcut in your Startup folder
  macOS    ~/Library/Application Support/DriveDashboard + a LaunchAgent
  Linux    ~/.local/state/drive-dashboard + ~/.config/autostart entry

The helper only reacts to THIS drive (Windows: volume serial number;
Linux/macOS: the random ID in Drive_Dashboard/.drive-id), so another USB
stick with a Drive_Dashboard folder can never run on your computer.

macOS: if asked whether Python may access files on a removable volume, click Allow.
macOS can read NTFS drives but not write to them. The dashboard only reads, so that's fine.


BEFORE EJECTING
---------------
Click "Stop" in the sidebar, then eject/safely remove the drive.
(If you just unplug it, the server notices and exits, but always ejecting
protects the drive's data.)


FILES
-----
  server.ps1         web server for Windows (PowerShell, built in)
  server.py          web server for Linux/macOS (Python 3.6+, standard library only)
  web\               the page itself (index.html, style.css, app.js,
                     files.js = file management, notepad.js = Notepad)
  catalog.json       this drive's folder titles and descriptions (created on the first
                     run). Easiest to change with right-click > Edit description; it's
                     plain JSON too, keys are folder paths like "Software/Tools/Rufus".
                     Entries marked "auto": true were generated.
  .drive-id          this drive's random ID (hidden). Don't copy it to other drives.
  drive.ico          the dashboard logo as a Windows icon. The hidden file autorun.inf at
                     the top of the drive (icon line only, it runs nothing) makes Explorer
                     show it as the drive's icon.
  autolaunch\        the optional plug-in helpers


SECURITY
--------
* Reachable only from this computer (localhost). Nothing is shared on the network.
* Every request needs a random key created at launch, so other websites
  can't use the dashboard behind your back.
* Paths can never leave this drive.
* "Run" on programs and scripts (.exe .msi .bat .sh .command ...) always asks first.
