#!/bin/sh
# Linux / macOS: make the dashboard open automatically when this drive is plugged in.
#   sh install-autolaunch.sh          turn on
#   sh install-autolaunch.sh --uninstall   turn off
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed first (Linux: sudo apt install python3 | macOS: xcode-select --install)."
  exit 1
fi
python3 "$DIR/install_autolaunch.py" "$@"
