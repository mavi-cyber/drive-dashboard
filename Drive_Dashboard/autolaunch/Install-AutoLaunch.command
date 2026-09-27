#!/bin/sh
# macOS: double-click to make the dashboard open automatically when this drive is plugged in.
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! python3 -c 'import sys' >/dev/null 2>&1; then
  echo "Python 3 is needed. Accept the install window that appears, then double-click this again."
  xcode-select --install
  exit 1
fi
python3 "$DIR/install_autolaunch.py"
echo
echo "You can close this window."
