#!/bin/sh
# macOS: open the Drive Dashboard.  Double-click, or in Terminal:  sh /Volumes/<drive>/Drive_Dashboard/Start-Dashboard.command
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! python3 -c 'import sys' >/dev/null 2>&1; then
  echo "Python 3 is needed. A window will offer to install Apple's command line tools; accept it, then run this again."
  xcode-select --install
  exit 1
fi
nohup python3 "$DIR/server.py" >/dev/null 2>&1 &
sleep 1
osascript -e 'tell application "Terminal" to close (every window whose name contains "Start-Dashboard")' >/dev/null 2>&1 &
exit 0
