#!/usr/bin/env python3
"""
Turn Drive Dashboard auto-open on (or off with --uninstall) for this user on Linux or macOS.

  Linux: copies watcher.py to ~/.local/state/drive-dashboard and adds
         ~/.config/autostart/drive-dashboard-watcher.desktop (works in GNOME, KDE, XFCE, Cinnamon, MATE...)
  macOS: copies watcher.py to ~/Library/Application Support/DriveDashboard and adds a LaunchAgent
         ~/Library/LaunchAgents/com.drivedashboard.watcher.plist

No administrator rights needed.
"""
import json
import os
import shutil
import signal
import subprocess
import sys

IS_MAC = sys.platform == 'darwin'
HERE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(HERE)
LABEL = 'com.drivedashboard.watcher'

if IS_MAC:
    STATE = os.path.expanduser('~/Library/Application Support/DriveDashboard')
    AGENT = os.path.expanduser('~/Library/LaunchAgents/%s.plist' % LABEL)
else:
    STATE = os.path.join(os.environ.get('XDG_STATE_HOME') or os.path.expanduser('~/.local/state'), 'drive-dashboard')
    AGENT = os.path.join(os.environ.get('XDG_CONFIG_HOME') or os.path.expanduser('~/.config'),
                         'autostart', 'drive-dashboard-watcher.desktop')
WATCHER = os.path.join(STATE, 'watcher.py')
CONFIG = os.path.join(STATE, 'config.json')
PIDFILE = os.path.join(STATE, 'watcher.pid')


def stop_running_watcher():
    try:
        with open(PIDFILE) as f:
            os.kill(int(f.read().strip()), signal.SIGTERM)
    except (OSError, ValueError):
        pass


def launchctl(*args):
    return subprocess.run(['launchctl'] + list(args), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def install():
    if sys.platform.startswith('win'):
        sys.exit('On Windows use autolaunch\\Install-AutoLaunch.bat instead.')
    with open(os.path.join(APP_DIR, '.drive-id')) as f:
        drive_id = f.read().strip()
    os.makedirs(STATE, exist_ok=True)
    shutil.copyfile(os.path.join(HERE, 'watcher.py'), WATCHER)

    ids = []
    try:
        with open(CONFIG) as f:
            ids = json.load(f).get('ids', [])
    except (OSError, ValueError):
        pass
    if drive_id not in ids:
        ids.append(drive_id)
    with open(CONFIG, 'w') as f:
        json.dump({'ids': ids}, f)

    python = sys.executable
    os.makedirs(os.path.dirname(AGENT), exist_ok=True)
    stop_running_watcher()
    if IS_MAC:
        with open(AGENT, 'w') as f:
            f.write('''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array><string>%s</string><string>%s</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
''' % (LABEL, python, WATCHER))
        uid = str(os.getuid())
        launchctl('bootout', 'gui/' + uid, AGENT)
        if launchctl('bootstrap', 'gui/' + uid, AGENT) != 0:
            launchctl('load', '-w', AGENT)
    else:
        with open(AGENT, 'w') as f:
            f.write('[Desktop Entry]\nType=Application\nName=Drive Dashboard watcher\n'
                    'Comment=Opens Drive Dashboard when a trusted drive is plugged in\n'
                    'Exec="%s" "%s"\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n' % (python, WATCHER))
        subprocess.Popen([python, WATCHER], cwd=os.path.expanduser('~'), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)

    print('Auto-open is ON for this drive (id %s...).' % drive_id[:8])
    print('Watcher:  ' + WATCHER)
    print('Startup:  ' + AGENT)
    if IS_MAC:
        print('\nIf macOS asks whether Python may access files on a removable volume, click Allow.')


def uninstall():
    stop_running_watcher()
    if IS_MAC:
        launchctl('bootout', 'gui/%d' % os.getuid(), AGENT)
        launchctl('unload', '-w', AGENT)
    for p in (AGENT, WATCHER, CONFIG, PIDFILE, os.path.join(STATE, 'watcher.lock')):
        try:
            os.remove(p)
        except OSError:
            pass
    print('Auto-open is OFF on this computer. Start-Dashboard still works by hand.')


if __name__ == '__main__':
    uninstall() if '--uninstall' in sys.argv else install()
