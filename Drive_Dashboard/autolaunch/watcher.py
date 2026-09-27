#!/usr/bin/env python3
"""
Drive Dashboard auto-launch watcher for Linux and macOS.

Installed into the user's state folder by install_autolaunch.py and started at login.
Every few seconds it looks at mounted drives; when a *trusted* drive appears it starts that
drive's Drive_Dashboard/server.py, which opens the browser.

Trusted = the drive's Drive_Dashboard/.drive-id is listed in config.json (written by the
installer). Operating systems block USB auto-run because any stick could run code when
inserted; the ID check keeps that door closed for every drive except yours.
"""
import json
import os
import re
import subprocess
import sys
import time

IS_MAC = sys.platform == 'darwin'
HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'config.json')
PIDFILE = os.path.join(HERE, 'watcher.pid')
POLL_SECONDS = 3


def single_instance():
    """Hold an exclusive lock for our lifetime; exit if another watcher holds it."""
    import fcntl
    fh = open(os.path.join(HERE, 'watcher.lock'), 'w')
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit(0)
    with open(PIDFILE, 'w') as f:
        f.write(str(os.getpid()))
    return fh


def trusted_ids():
    try:
        with open(CONFIG) as f:
            return set(json.load(f).get('ids', []))
    except (OSError, ValueError):
        return set()


def mount_points():
    if IS_MAC:
        try:
            return [os.path.join('/Volumes', n) for n in os.listdir('/Volumes')]
        except OSError:
            return []
    points = []
    try:
        with open('/proc/self/mounts') as f:
            for line in f:
                parts = line.split()
                if len(parts) > 1:
                    # /proc/mounts escapes spaces etc. as \040
                    points.append(re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), parts[1]))
    except OSError:
        pass
    return [p for p in points if p.startswith(('/media/', '/run/media/', '/mnt/'))]


def present_dashboards():
    ids = trusted_ids()
    found = {}
    for mp in mount_points():
        app = os.path.join(mp, 'Drive_Dashboard')
        try:
            with open(os.path.join(app, '.drive-id')) as f:
                drive_id = f.read().strip()
        except OSError:
            continue
        server = os.path.join(app, 'server.py')
        if drive_id in ids and os.path.isfile(server):
            found[drive_id] = server
    return found


def launch(server):
    subprocess.Popen([sys.executable, server], cwd=os.path.expanduser('~'), stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def main():
    lock = single_instance()  # noqa: F841 - keep the lock alive
    seen = present_dashboards()
    for server in seen.values():      # drive already connected at login
        launch(server)
    while True:
        time.sleep(POLL_SECONDS)
        now = present_dashboards()
        for drive_id, server in now.items():
            if drive_id not in seen:
                time.sleep(1)             # let the mount settle
                launch(server)
        seen = now


if __name__ == '__main__':
    main()
