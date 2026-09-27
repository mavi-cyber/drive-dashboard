#!/bin/sh
# macOS: double-click to stop the dashboard opening automatically on this Mac.
DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$DIR/install_autolaunch.py" --uninstall
echo
echo "You can close this window."
