#!/bin/sh
# Linux: open the Drive Dashboard.  Double-click (choose "Run"), or in a terminal:  sh start-dashboard.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed. Install it with your package manager, e.g.:  sudo apt install python3"
  exit 1
fi
nohup python3 "$DIR/server.py" >/dev/null 2>&1 &
