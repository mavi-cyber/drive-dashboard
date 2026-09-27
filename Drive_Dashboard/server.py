#!/usr/bin/env python3
"""
Drive Dashboard server for Linux and macOS (also runs on Windows).

Same web UI and JSON API as server.ps1. Standard library only, Python 3.6+.

Security model (Ciampa, Security+ Guide ch. 5, web application attacks):
  * binds 127.0.0.1 only - nothing on the network can reach it
  * every API call needs a random per-session token (cross-site request forgery)
  * Host header must be localhost/127.0.0.1:<port> (DNS rebinding)
  * paths are canonicalised and must stay inside the drive (directory traversal)
  * drive files are served with a sandbox CSP so an .html on the drive can't script the UI
"""
import json
import os
import re
import secrets
import shutil
import stat
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.realpath(os.path.dirname(APP_DIR))       # the drive's mount point
WEB_DIR = os.path.join(APP_DIR, 'web')
IS_WIN = os.name == 'nt'
IS_MAC = sys.platform == 'darwin'
PLATFORM = 'windows' if IS_WIN else 'mac' if IS_MAC else 'linux'
HIDDEN_NAMES = {'$RECYCLE.BIN', 'System Volume Information', 'lost+found', '.drive-id', '.DS_Store',
                '.Spotlight-V100', '.fseventsd', '.Trashes', '.TemporaryItems', '.DocumentRevisions-V100',
                '.dashboard-trash'}


def state_dir():
    if IS_MAC:
        base = os.path.expanduser('~/Library/Application Support/DriveDashboard')
    elif IS_WIN:
        base = os.path.join(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')), 'DriveDashboard')
    else:
        base = os.path.join(os.environ.get('XDG_STATE_HOME') or os.path.expanduser('~/.local/state'), 'drive-dashboard')
    os.makedirs(base, exist_ok=True)
    return base


def read_drive_id():
    """This drive's random identity. Created on the first run; if the drive is read-only here
    (e.g. NTFS on macOS) a stable stand-in derived from the mount point is used instead."""
    path = os.path.join(APP_DIR, '.drive-id')
    try:
        with open(path) as f:
            value = f.read().strip()
            if value:
                return value
    except OSError:
        pass
    value = secrets.token_hex(16)
    try:
        with open(path, 'x') as f:
            f.write(value)
        if IS_WIN:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(path, 0x2)   # hidden
        return value
    except OSError:
        import hashlib
        return 'ro-' + hashlib.sha1(ROOT.encode('utf-8')).hexdigest()[:29]


def drive_label():
    if not os.path.ismount(ROOT):                  # dashboard copied into a sub-folder
        return os.path.basename(ROOT.rstrip('\\/')) or ROOT
    if IS_WIN:
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(261)
            if ctypes.windll.kernel32.GetVolumeInformationW(ROOT, buf, 261, None, None, None, None, 0):
                return buf.value or ROOT
        except Exception:
            pass
        return ROOT
    return os.path.basename(ROOT.rstrip('/')) or ROOT


DRIVE_ID = read_drive_id()
STATE_DIR = state_dir()
SESSION_FILE = os.path.join(STATE_DIR, 'session-%s.json' % DRIVE_ID)
LOG_FILE = os.path.join(STATE_DIR, 'server-py.log')


def log(msg):
    try:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write('%s  %s\n' % (datetime.now().isoformat(timespec='seconds'), msg))
    except OSError:
        pass


# catalog.json holds this drive's folder descriptions. It doesn't ship with the dashboard:
# on the first run on a drive the web UI generates it from the drive's contents.
CATALOG_FILE = os.path.join(APP_DIR, 'catalog.json')
CATALOG_EXISTS = os.path.isfile(CATALOG_FILE)


def load_catalog():
    if not CATALOG_EXISTS:
        return {}
    try:
        with open(CATALOG_FILE, encoding='utf-8-sig') as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        log('catalog.json: %s' % e)
        return {}


CATALOG_RAW = load_catalog()                                  # original key case, for saving
CATALOG = {k.lower(): v for k, v in CATALOG_RAW.items()}     # case-insensitive lookups

TYPE_GROUPS = {
    'Disk images': 'iso img vdi vhd vhdx vmdk wim esd dmg',
    'Installers': 'exe msi deb rpm appimage apk msix pkg',
    'Archives': 'zip rar 7z tar gz bz2 xz tgz whl cab',
    'Video': 'mp4 mkv avi mov webm wmv flv m4v',
    'Audio': 'mp3 wav flac m4a ogg aac wma',
    'Images': 'png jpg jpeg gif bmp webp svg ico heic',
    'Documents': 'pdf doc docx odt txt md ppt pptx xls xlsx ods csv rtf epub',
    'Code': 'py js ts html css java c cpp h cs ps1 sh bat json xml asm mac ipynb sql',
}
EXT_GROUP = {e: g for g, exts in TYPE_GROUPS.items() for e in exts.split()}
MIME = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp',
    'bmp': 'image/bmp', 'ico': 'image/x-icon', 'mp4': 'video/mp4', 'm4v': 'video/mp4', 'webm': 'video/webm',
    'mkv': 'video/x-matroska', 'mov': 'video/quicktime', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
    'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'flac': 'audio/flac', 'pdf': 'application/pdf',
}
TEXT_EXT = set('txt log md json csv ps1 sh bat cmd py js ts css html htm xml c cpp h java asm mac ini cfg conf '
               'yaml yml sha256 sql svg command'.split())
STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/files.js': ('files.js', 'text/javascript; charset=utf-8'),
    '/notepad.js': ('notepad.js', 'text/javascript; charset=utf-8'),
    '/catalog.js': ('catalog.js', 'text/javascript; charset=utf-8'),
    '/style.css': ('style.css', 'text/css; charset=utf-8'),
    '/icon.svg': ('icon.svg', 'image/svg+xml'),
    '/favicon.ico': (os.path.join('..', 'drive.ico'), 'image/x-icon'),
}
TRASH = os.path.join(ROOT, '.dashboard-trash')
TRASH_ID = re.compile(r'^\d{17}-[0-9a-f]{6}$')
MAX_EDIT_BYTES = 10 * 1024 * 1024
BAD_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]|[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$', re.I)
ENCODINGS = {   # name -> (python codec, BOM)
    'utf-8': ('utf-8', b''), 'utf-8-bom': ('utf-8', b'\xef\xbb\xbf'),
    'utf-16le': ('utf-16-le', b'\xff\xfe'), 'utf-16be': ('utf-16-be', b'\xfe\xff'), 'ansi': ('cp1252', b''),
}


class ApiError(Exception):
    def __init__(self, code, msg, **extra):
        Exception.__init__(self, msg)
        self.code, self.extra = code, extra


def probe_read_only():
    """macOS mounts NTFS read-only; some Linux setups do too. Find out once at startup."""
    probe = os.path.join(APP_DIR, '.write-probe-%d' % os.getpid())
    try:
        with open(probe, 'w') as f:
            f.write('x')
        os.remove(probe)
        return False
    except OSError:
        return True


READ_ONLY = probe_read_only()


def first_run_setup():
    """Drive icon in Windows Explorer: autorun.inf with an icon line only (it never runs anything)."""
    autorun = os.path.join(ROOT, 'autorun.inf')
    if READ_ONLY or not os.path.ismount(ROOT) or os.path.exists(autorun) \
            or not os.path.isfile(os.path.join(APP_DIR, 'drive.ico')):
        return
    try:
        with open(autorun, 'w', newline='\r\n') as f:
            f.write('[autorun]\nicon=Drive_Dashboard\\drive.ico\n')
        if IS_WIN:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(autorun, 0x2 | 0x1)   # hidden, read-only
    except OSError as e:
        log('autorun.inf: %s' % e)


first_run_setup()


def assert_writable():
    if READ_ONLY:
        raise ApiError(409, 'This drive is read-only on this computer (macOS can only read NTFS drives).')


def assert_name(name):
    if (not isinstance(name, str) or not name or len(name) > 255 or name in ('.', '..') or BAD_NAME.search(name)
            or name.lower() in ('.dashboard-trash', '.drive-id')):
        raise ApiError(400, 'That name is not allowed. Avoid \\ / : * ? " < > | and names ending in a dot or space.')


def assert_mutable(full):
    """The drive root, the dashboard itself and the trash can't be renamed, moved or deleted."""
    rel = rel_of(full)
    low = rel.lower()
    if rel == '' or low == 'drive_dashboard' or low.startswith('drive_dashboard/') or low.startswith('.dashboard-trash'):
        raise ApiError(403, "'%s' is protected" % rel)


def unique_path(folder, name, is_dir):
    p = os.path.join(folder, name)
    if not os.path.lexists(p):
        return p
    base, ext = (name, '') if is_dir else os.path.splitext(name)
    i = 2
    while True:
        p = os.path.join(folder, '%s (%d)%s' % (base, i, ext))
        if not os.path.lexists(p):
            return p
        i += 1


def tree_size(p):
    if os.path.isfile(p):
        return os.path.getsize(p)
    total = 0
    for dirpath, _dirs, files in os.walk(p):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, f))
            except OSError:
                pass
    return total


def remove_tree(p):
    def on_error(func, path, _exc):          # read-only files: clear the flag and retry
        os.chmod(path, stat.S_IWRITE | stat.S_IREAD)
        func(path)
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p, onerror=on_error)
    else:
        try:
            os.remove(p)
        except PermissionError:
            os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
            os.remove(p)


def file_version(full):
    st = os.stat(full)
    return '%d-%d' % (st.st_size, st.st_mtime_ns)


def write_atomic(full, data):
    """Journaling idea (Silberschatz ch. 14): write a temp file, flush it to the device, then
    atomically swap it in - an unplug mid-save leaves the old or the new file, never half of one."""
    tmp = '%s.saving-%s' % (full, secrets.token_hex(4))
    try:
        with open(tmp, 'xb') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, full)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def item_json(full):
    is_dir = os.path.isdir(full)
    st = os.stat(full)
    rel = rel_of(full)
    return catalog_fields({'name': os.path.basename(full), 'path': rel, 'dir': is_dir,
                           'size': None if is_dir else st.st_size, 'count': None, 'mtime': mtime_iso(st.st_mtime)}, rel)
PAGE_CSP = ("default-src 'self'; img-src 'self' data:; media-src 'self'; frame-src 'self'; "
            "object-src 'none'; base-uri 'none'; form-action 'none'")
RAW_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"


def is_hidden(entry):
    name = entry.name
    # Hide OS clutter only; ordinary dot-folders (.git, .venv...) stay visible and counted.
    if name in HIDDEN_NAMES or name.startswith('._') or name.startswith('.Trash-'):
        return True
    if IS_WIN:
        try:
            attrs = entry.stat(follow_symlinks=False).st_file_attributes
            return (attrs & 6) == 6                      # hidden + system
        except (OSError, AttributeError):
            return False
    return False


def rel_of(full):
    r = os.path.relpath(full, ROOT)
    return '' if r == '.' else r.replace(os.sep, '/')


def resolve(rel):
    rel = (rel or '').replace('\\', '/').strip('/')
    if '\x00' in rel or (IS_WIN and ':' in rel):
        raise ValueError('Invalid path')
    if rel.lower().startswith('.dashboard-trash'):
        raise ApiError(403, 'Use the Trash view for deleted items')
    parts = [p for p in rel.split('/') if p]
    full = os.path.realpath(os.path.join(ROOT, *parts))
    prefix = ROOT if ROOT.endswith(os.sep) else ROOT + os.sep
    if full != ROOT and not full.startswith(prefix):
        raise ValueError('Invalid path')
    return full


def catalog_fields(o, rel):
    c = CATALOG.get(rel.lower())
    if c:
        for k in ('title', 'desc', 'icon', 'warn'):
            o[k] = c.get(k)
    return o


def mtime_iso(ts):
    return datetime.fromtimestamp(ts).isoformat(timespec='seconds')


# ---------------- state ----------------
class State:
    def __init__(self):
        self.token = secrets.token_hex(24)
        self.port = None
        self.index = None
        self.dir_size = None
        self.stats = None
        self.index_state = 'idle'
        self.indexed_at = None
        self.reindex = False
        self.lock = threading.Lock()
        self.httpd = None


S = State()


def build_index():
    """(Re)build the index. Changes made while a scan runs trigger one more pass."""
    with S.lock:
        S.reindex = True
        if S.index_state == 'building':
            return
        S.index_state = 'building'
    try:
        while True:
            with S.lock:
                S.reindex = False
            _scan_once()
            with S.lock:
                if not S.reindex:
                    S.index_state = 'ready'
                    return
    except Exception as e:  # noqa: BLE001 - surface any failure in the UI
        S.index_state = 'error: %s' % e


def request_reindex():
    threading.Thread(target=build_index, daemon=True).start()


def _scan_once():
    items, sizes = [], {}
    stack = [ROOT]
    while stack:
        d = stack.pop()
        try:
            it = os.scandir(d)
        except OSError:
            continue
        with it:
            for e in it:
                if is_hidden(e):
                    continue
                try:
                    if e.is_symlink():
                        continue
                    is_dir = e.is_dir(follow_symlinks=False)
                    st = e.stat(follow_symlinks=False)
                except OSError:
                    continue
                rel = rel_of(e.path)
                size = 0
                if is_dir:
                    stack.append(e.path)
                else:
                    size = st.st_size
                    i = rel.rfind('/')
                    while i > 0:
                        k = rel[:i].lower()
                        sizes[k] = sizes.get(k, 0) + size
                        i = k.rfind('/')
                items.append({'p': rel, 'n': e.name, 'l': e.name.lower(), 'd': is_dir, 's': size, 'm': mtime_iso(st.st_mtime)})

    types, files = {}, []
    for f in items:
        if f['d']:
            continue
        files.append(f)
        ext = os.path.splitext(f['n'])[1][1:].lower()
        g = EXT_GROUP.get(ext, 'Other')
        t = types.setdefault(g, {'group': g, 'count': 0, 'size': 0})
        t['count'] += 1
        t['size'] += f['s']
    cats = []
    for f in items:
        if f['d'] and '/' not in f['p']:
            c = CATALOG.get(f['p'].lower()) or {}
            cats.append({'path': f['p'], 'name': f['n'], 'size': sizes.get(f['p'].lower(), 0),
                         'title': c.get('title'), 'desc': c.get('desc'), 'icon': c.get('icon')})
    largest = sorted(files, key=lambda f: f['s'], reverse=True)[:10]
    S.stats = {
        'fileCount': len(files), 'folderCount': len(items) - len(files),
        'categories': sorted(cats, key=lambda c: c['size'], reverse=True),
        'types': sorted(types.values(), key=lambda t: t['size'], reverse=True),
        'largest': [{'path': f['p'], 'name': f['n'], 'size': f['s']} for f in largest],
    }
    S.index, S.dir_size = items, sizes
    S.indexed_at = datetime.now().isoformat(timespec='seconds')


# ---------------- OS actions ----------------
def _spawn(args):
    subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     cwd=os.path.expanduser('~'), **({} if IS_WIN else {'start_new_session': True}))


def os_open(path):
    if IS_WIN:
        os.startfile(path)  # noqa: S606 - user-initiated, token-protected
    elif IS_MAC:
        _spawn(['open', path])
    else:
        _spawn(['xdg-open', path])


def os_reveal(path):
    if IS_WIN:
        _spawn(['explorer', '/select,', path])
    elif IS_MAC:
        _spawn(['open', '-R', path])
    else:
        uri = 'file://' + urllib.parse.quote(path)
        try:
            r = subprocess.run(['dbus-send', '--session', '--dest=org.freedesktop.FileManager1', '--type=method_call',
                                '/org/freedesktop/FileManager1', 'org.freedesktop.FileManager1.ShowItems',
                                'array:string:' + uri, 'string:'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            if r.returncode == 0:
                return
        except (OSError, subprocess.TimeoutExpired):
            pass
        _spawn(['xdg-open', os.path.dirname(path)])


# ---------------- HTTP ----------------
class Handler(BaseHTTPRequestHandler):
    server_version = 'DriveDashboard'
    sys_version = ''

    def log_message(self, *args):
        pass

    # -- responses --
    def send_bytes(self, body, ctype, code=200, headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send_bytes(json.dumps(obj, separators=(',', ':')).encode('utf-8'), 'application/json; charset=utf-8', code)

    def err(self, code, msg):
        self.send_json({'error': msg}, code)

    # -- dispatch --
    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def dispatch(self):
        try:
            if self.client_address[0] not in ('127.0.0.1', '::1'):
                return self.err(403, 'Local access only')
            if self.headers.get('Host') not in ('localhost:%d' % S.port, '127.0.0.1:%d' % S.port):
                return self.err(421, 'Bad host')
            url = urllib.parse.urlsplit(self.path)
            path = url.path
            q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query, keep_blank_values=True).items()}

            if not path.startswith('/api/') and path != '/raw':
                entry = STATIC.get(path)
                if not entry:
                    return self.err(404, 'Not found')
                with open(os.path.join(WEB_DIR, entry[0]), 'rb') as f:
                    body = f.read()
                extra = {'Content-Security-Policy': PAGE_CSP, 'Referrer-Policy': 'no-referrer'} if path == '/' else None
                return self.send_bytes(body, entry[1], 200, extra)

            tok = q.get('t', '') if path == '/raw' else self.headers.get('X-Token', '')
            if not secrets.compare_digest(tok, S.token):
                return self.err(401, 'Unauthorized')

            body = None
            if self.command == 'POST':
                origin = self.headers.get('Origin')
                if origin and origin not in ('http://localhost:%d' % S.port, 'http://127.0.0.1:%d' % S.port):
                    return self.err(403, 'Bad origin')
                ctype = self.headers.get('Content-Type') or ''
                if path == '/api/upload':
                    if not ctype.startswith('application/octet-stream'):
                        return self.err(415, 'Binary body required')   # streamed by the route itself
                else:
                    if not ctype.startswith('application/json'):
                        return self.err(415, 'JSON required')
                    n = int(self.headers.get('Content-Length') or 0)
                    if n > 48 * 1024 * 1024:
                        return self.err(413, 'Request too large')
                    body = json.loads(self.rfile.read(n) or b'{}') if n else {}

            route = ROUTES.get((self.command, path))
            if not route:
                return self.err(404, 'Not found')
            return route(self, q, body)
        except ApiError as e:
            payload = {'error': str(e)}
            payload.update(e.extra)
            self.send_json(payload, e.code)
        except ValueError as e:
            self.err(400, str(e) or 'Bad request')
        except (BrokenPipeError, ConnectionResetError):
            pass
        except FileExistsError:
            self.err(409, 'Something with that name already exists here')
        except FileNotFoundError:
            self.err(404, 'Not found')
        except PermissionError:
            self.err(403, 'Access denied by the file system (is it open in another program or read-only?)')
        except Exception as e:  # noqa: BLE001
            try:
                self.err(500, str(e))
            except OSError:
                pass

    # -- routes --
    def api_ping(self, q, body):
        self.send_json({'ok': True, 'serial': DRIVE_ID})

    def api_info(self, q, body):
        du = shutil.disk_usage(ROOT)
        self.send_json({'label': drive_label(), 'root': ROOT, 'rootLabel': ('Drive ' + ROOT.rstrip('\\')) if IS_WIN else ROOT,
                        'sep': os.sep, 'platform': PLATFORM, 'readOnly': READ_ONLY, 'firstRun': not CATALOG_EXISTS,
                        'total': du.total, 'free': du.free,
                        'indexState': S.index_state, 'indexedAt': S.indexed_at, 'stats': S.stats})

    def api_list(self, q, body):
        full = resolve(q.get('path', ''))
        if not os.path.isdir(full):
            return self.err(404, 'Folder not found')
        items = []
        with os.scandir(full) as it:
            for e in it:
                if is_hidden(e):
                    continue
                try:
                    is_dir = e.is_dir()
                    st = e.stat()
                except OSError:
                    continue
                rel = rel_of(e.path)
                o = {'name': e.name, 'path': rel, 'dir': is_dir, 'size': None, 'count': None, 'mtime': mtime_iso(st.st_mtime)}
                if is_dir:
                    if S.dir_size is not None:
                        o['size'] = S.dir_size.get(rel.lower(), 0)
                    try:
                        o['count'] = len(os.listdir(e.path))
                    except OSError:
                        pass
                else:
                    o['size'] = st.st_size
                items.append(catalog_fields(o, rel))
        here = catalog_fields({'path': rel_of(full)}, rel_of(full))
        self.send_json({'folder': here, 'items': items})

    def api_search(self, q, body):
        if S.index is None:     # an older index keeps search working during a rebuild
            return self.send_json({'state': S.index_state, 'total': 0, 'items': []})
        terms = q.get('q', '').lower().split()
        scope = q.get('scope', '').strip('/').lower()
        out, total = [], 0
        if terms:
            for f in S.index:
                if scope and not f['p'].lower().startswith(scope + '/'):
                    continue
                if all(t in f['l'] for t in terms):
                    total += 1
                    if len(out) < 300:
                        size = S.dir_size.get(f['p'].lower(), 0) if f['d'] else f['s']
                        out.append(catalog_fields({'name': f['n'], 'path': f['p'], 'dir': f['d'], 'size': size, 'mtime': f['m']}, f['p']))
        self.send_json({'state': 'ready', 'total': total, 'items': out})

    def raw(self, q, body):
        full = resolve(q.get('path', ''))
        if not os.path.isfile(full):
            return self.err(404, 'File not found')
        ext = os.path.splitext(full)[1][1:].lower()
        mime = MIME.get(ext) or ('text/plain; charset=utf-8' if (ext == '' or ext in TEXT_EXT) else 'application/octet-stream')
        length = os.path.getsize(full)
        start, end = 0, length - 1
        # Byte ranges let video seek (cf. Tanenbaum's file-server byte-range exercise).
        m = re.match(r'^bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
        code = 200
        if m:
            if m.group(1):
                start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), length - 1)
            elif m.group(2):
                start = max(0, length - int(m.group(2)))
            if start >= length or start > end:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % length)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            code = 206
        self.send_response(code)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(max(0, end - start + 1)))
        self.send_header('Accept-Ranges', 'bytes')
        if q.get('download') == '1':
            fn = os.path.basename(full)
            ascii_name = re.sub(r'[^\x20-\x7e]|["\\]', '_', fn)
            self.send_header('Content-Disposition', 'attachment; filename="%s"; filename*=UTF-8\'\'%s'
                             % (ascii_name, urllib.parse.quote(fn, safe='')))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        if code == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, length))
        if ext != 'pdf':   # the browser's PDF viewer refuses to run inside a sandbox
            self.send_header('Content-Security-Policy', RAW_CSP)
        self.end_headers()
        remain = end - start + 1
        with open(full, 'rb') as f:
            f.seek(start)
            while remain > 0:
                chunk = f.read(min(262144, remain))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remain -= len(chunk)

    def api_open(self, q, body):
        full = resolve((body or {}).get('path', ''))
        if not os.path.exists(full):
            return self.err(404, 'Not found')
        os_open(full)
        self.send_json({'ok': True})

    def api_reveal(self, q, body):
        full = resolve((body or {}).get('path', ''))
        if not os.path.exists(full):
            return self.err(404, 'Not found')
        os_reveal(full)
        self.send_json({'ok': True})

    def api_rescan(self, q, body):
        threading.Thread(target=build_index, daemon=True).start()
        self.send_json({'ok': True, 'state': 'building'})

    def api_shutdown(self, q, body):
        self.send_json({'ok': True})
        threading.Thread(target=stop, daemon=True).start()

    # ======================= Create / Update / Delete =======================
    def _existing_dir(self, rel, what='Folder not found'):
        d = resolve(rel)
        if not os.path.isdir(d):
            raise ApiError(404, what)
        return d

    def api_mkdir(self, q, body):
        assert_writable()
        assert_name(body.get('name'))
        t = os.path.join(self._existing_dir(body.get('path')), body['name'])
        if os.path.lexists(t):
            raise ApiError(409, 'Something with that name already exists here')
        os.mkdir(t)
        request_reindex()
        self.send_json({'ok': True, 'item': item_json(t)})

    def api_newfile(self, q, body):
        assert_writable()
        assert_name(body.get('name'))
        t = os.path.join(self._existing_dir(body.get('path')), body['name'])
        with open(t, 'xb'):
            pass
        request_reindex()
        self.send_json({'ok': True, 'item': item_json(t)})

    def api_rename(self, q, body):
        assert_writable()
        assert_name(body.get('name'))
        full = resolve(body.get('path'))
        if not os.path.lexists(full):
            raise ApiError(404, 'Not found')
        assert_mutable(full)
        t = os.path.join(os.path.dirname(full), body['name'])
        if t != full:
            if os.path.lexists(t) and not (t.lower() == full.lower() and os.path.samefile(t, full)):
                raise ApiError(409, 'Something with that name already exists here')
            if t.lower() == full.lower():     # case-only rename on a case-insensitive file system
                tmp = '%s.rename-%s' % (full, secrets.token_hex(3))
                os.rename(full, tmp)
                os.rename(tmp, t)
            else:
                os.rename(full, t)
            request_reindex()
        self.send_json({'ok': True, 'item': item_json(t)})

    def _move_or_copy(self, body, is_move):
        assert_writable()
        dest = self._existing_dir(body.get('dest'), 'Destination folder not found')
        done, skipped = [], []
        for p in body.get('paths') or []:
            full = resolve(p)
            if not os.path.lexists(full):
                skipped.append('%s (not found)' % p)
                continue
            if is_move:
                assert_mutable(full)
            elif rel_of(full) == '':
                raise ApiError(403, 'Cannot copy the whole drive')
            is_dir = os.path.isdir(full)
            if is_dir and (dest + os.sep).lower().startswith(full.rstrip(os.sep).lower() + os.sep):
                skipped.append("%s (a folder can't go inside itself)" % p)
                continue
            if is_move and os.path.dirname(full).rstrip(os.sep).lower() == dest.rstrip(os.sep).lower():
                skipped.append('%s (already here)' % p)
                continue
            t = unique_path(dest, os.path.basename(full), is_dir)
            if is_move:
                shutil.move(full, t)
            elif is_dir:
                shutil.copytree(full, t, symlinks=True)
            else:
                shutil.copy2(full, t)
            done.append(rel_of(t))
        if done:
            request_reindex()
        self.send_json({'ok': True, 'done': done, 'skipped': skipped})

    def api_move(self, q, body):
        self._move_or_copy(body, True)

    def api_copy(self, q, body):
        self._move_or_copy(body, False)

    def api_delete(self, q, body):
        """'Delete' moves items into the drive's hidden .dashboard-trash so they can be restored."""
        assert_writable()
        os.makedirs(TRASH, exist_ok=True)
        if IS_WIN:
            try:
                import ctypes
                ctypes.windll.kernel32.SetFileAttributesW(TRASH, 0x2)   # hidden
            except Exception:  # noqa: BLE001
                pass
        n = 0
        for p in body.get('paths') or []:
            full = resolve(p)
            if not os.path.lexists(full):
                continue
            assert_mutable(full)
            rel = rel_of(full)
            is_dir = os.path.isdir(full)
            size = tree_size(full)   # measured now: the index's cached sizes can be stale after edits
            tid = datetime.now().strftime('%Y%m%d%H%M%S%f')[:17] + '-' + secrets.token_hex(3)
            holder = os.path.join(TRASH, tid)
            os.mkdir(holder)
            os.rename(full, os.path.join(holder, os.path.basename(full)))
            meta = {'id': tid, 'name': os.path.basename(full), 'from': rel, 'dir': is_dir, 'size': size,
                    'deleted': datetime.now().isoformat(timespec='seconds')}
            with open(holder + '.json', 'w', encoding='utf-8') as f:
                json.dump(meta, f)
            n += 1
        if n:
            request_reindex()
        self.send_json({'ok': True, 'count': n})

    def _trash_meta(self, tid):
        if not isinstance(tid, str) or not TRASH_ID.match(tid):
            return None
        try:
            with open(os.path.join(TRASH, tid + '.json'), encoding='utf-8-sig') as f:
                return json.load(f)
        except (OSError, ValueError):
            return None

    def api_trash(self, q, body):
        items, total = [], 0
        if os.path.isdir(TRASH):
            for fn in os.listdir(TRASH):
                if fn.endswith('.json'):
                    m = self._trash_meta(fn[:-5])
                    if m and os.path.lexists(os.path.join(TRASH, m['id'], m['name'])):
                        items.append(m)
                        total += m.get('size') or 0
        items.sort(key=lambda m: m.get('deleted', ''), reverse=True)
        self.send_json({'items': items, 'total': total})

    def api_restore(self, q, body):
        assert_writable()
        done = []
        for tid in body.get('ids') or []:
            m = self._trash_meta(tid)
            if not m:
                continue
            holder = os.path.join(TRASH, tid)
            src = os.path.join(holder, m['name'])
            if not os.path.lexists(src):
                continue
            parent = os.path.dirname(resolve(m['from']))
            os.makedirs(parent, exist_ok=True)
            t = unique_path(parent, m['name'], bool(m.get('dir')))
            os.rename(src, t)
            os.rmdir(holder)
            os.remove(holder + '.json')
            done.append(rel_of(t))
        if done:
            request_reindex()
        self.send_json({'ok': True, 'done': done})

    def api_purge(self, q, body):
        assert_writable()
        ids = body.get('ids') or []
        if body.get('all') and os.path.isdir(TRASH):
            ids = [fn[:-5] for fn in os.listdir(TRASH) if fn.endswith('.json')]
        n = 0
        for tid in ids:
            if not isinstance(tid, str) or not TRASH_ID.match(tid):
                continue
            holder = os.path.join(TRASH, tid)
            if os.path.lexists(holder):
                remove_tree(holder)
            if os.path.exists(holder + '.json'):
                os.remove(holder + '.json')
            n += 1
        self.send_json({'ok': True, 'count': n})

    def api_upload(self, q, body):
        assert_writable()
        name = q.get('name', '')
        assert_name(name)
        folder = self._existing_dir(q.get('path', ''))
        length = self.headers.get('Content-Length')
        if length is None:
            raise ApiError(411, 'Content-Length required')
        remain = int(length)
        t = unique_path(folder, name, False)
        tmp = '%s.uploading-%s' % (t, secrets.token_hex(4))
        try:
            with open(tmp, 'xb') as f:
                while remain > 0:
                    chunk = self.rfile.read(min(1048576, remain))
                    if not chunk:
                        raise ApiError(400, 'Upload was interrupted')
                    f.write(chunk)
                    remain -= len(chunk)
            os.replace(tmp, t)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        request_reindex()
        self.send_json({'ok': True, 'item': item_json(t)})

    # ======================= Catalog (folder descriptions) =======================
    def api_catalog_get(self, q, body):
        self.send_json({'entries': CATALOG_RAW, 'exists': CATALOG_EXISTS, 'readOnly': READ_ONLY})

    def api_catalog_set(self, q, body):
        """body.set = {"<folder path>": {title, desc, icon, cat, warn, auto} | null}"""
        global CATALOG_RAW, CATALOG, CATALOG_EXISTS
        new = {} if body.get('replace') else dict(CATALOG_RAW)
        for key, entry in (body.get('set') or {}).items():
            key = str(key).strip('/')
            if len(key) > 1024 or '..' in key.split('/'):
                continue
            new = {k: v for k, v in new.items() if k.lower() != key.lower()}
            if not isinstance(entry, dict):
                continue
            clean = {f: str(entry[f])[:600] for f in ('title', 'desc', 'icon', 'cat', 'warn') if entry.get(f)}
            if entry.get('auto'):
                clean['auto'] = True
            if clean:
                new[key] = clean
        CATALOG_RAW = new
        CATALOG = {k.lower(): v for k, v in new.items()}
        saved = False
        if not READ_ONLY:
            write_atomic(CATALOG_FILE, json.dumps(dict(sorted(new.items())), indent=2, ensure_ascii=False).encode('utf-8'))
            CATALOG_EXISTS = saved = True
        self.send_json({'ok': True, 'saved': saved, 'count': len(new)})

    def api_tree(self, q, body):
        """Folders down to 3 levels with (up to 60 of) their direct files: input for describing folders."""
        index = S.index
        if index is None:
            return self.send_json({'state': S.index_state, 'dirs': []})
        dirs = {}
        for f in index:
            if f['d'] and f['p'].count('/') < 3:
                dirs[f['p']] = {'path': f['p'], 'name': f['n'], 'files': [], 'dirs': [], 'fileCount': 0,
                                'size': (S.dir_size or {}).get(f['p'].lower(), 0)}
        for f in index:
            i = f['p'].rfind('/')
            node = dirs.get(f['p'][:i] if i >= 0 else '')
            if node is None:
                continue
            if f['d']:
                node['dirs'].append(f['n'])
            else:
                node['fileCount'] += 1
                if len(node['files']) < 60:
                    node['files'].append({'n': f['n'], 's': f['s']})
        self.send_json({'state': 'ready', 'dirs': list(dirs.values())})

    # ======================= Notepad =======================
    def api_read(self, q, body):
        full = resolve(q.get('path', ''))
        if not os.path.isfile(full):
            raise ApiError(404, 'File not found')
        size = os.path.getsize(full)
        if size > MAX_EDIT_BYTES:
            raise ApiError(413, 'This file is too big for Notepad (over 10 MB)')
        with open(full, 'rb') as f:
            b = f.read()
        if b.startswith(b'\xef\xbb\xbf'):
            enc, text = 'utf-8-bom', b[3:].decode('utf-8', 'replace')
        elif b.startswith(b'\xff\xfe'):
            enc, text = 'utf-16le', b[2:].decode('utf-16-le', 'replace')
        elif b.startswith(b'\xfe\xff'):
            enc, text = 'utf-16be', b[2:].decode('utf-16-be', 'replace')
        else:
            if b'\x00' in b[:8192]:
                raise ApiError(415, 'This looks like a binary file, not text')
            try:
                enc, text = 'utf-8', b.decode('utf-8')
            except UnicodeDecodeError:
                enc, text = 'ansi', b.decode('cp1252', 'replace')
        crlf = text.count('\r\n')
        lf = text.count('\n') - crlf
        cr = text.count('\r') - crlf
        eol = 'crlf'
        if lf > crlf and lf >= cr:
            eol = 'lf'
        elif cr > crlf and cr > lf:
            eol = 'cr'
        self.send_json({'path': rel_of(full), 'name': os.path.basename(full), 'text': text, 'encoding': enc, 'eol': eol,
                        'version': file_version(full), 'readOnly': READ_ONLY or not os.access(full, os.W_OK), 'size': size})

    def api_save(self, q, body):
        assert_writable()
        if body.get('path'):
            full = resolve(body['path'])
            if not os.path.isfile(full):
                raise ApiError(404, 'File not found - it may have been moved or deleted. Use Save As.')
            # Consistency check (Silberschatz 15.7): never silently overwrite someone else's change.
            if body.get('version') and not body.get('force') and file_version(full) != body['version']:
                raise ApiError(409, 'This file was changed outside Notepad since you opened it.', conflict=True)
        else:
            assert_name(body.get('name'))
            full = os.path.join(self._existing_dir(body.get('dir')), body['name'])
            if os.path.isdir(full):
                raise ApiError(409, 'A folder with that name already exists')
            if os.path.exists(full) and not body.get('overwrite'):
                raise ApiError(409, '%s already exists.' % body['name'], exists=True)
        if os.path.exists(full) and not os.access(full, os.W_OK):
            raise ApiError(403, 'The file is marked read-only')
        text = str(body.get('text') or '').replace('\r\n', '\n').replace('\r', '\n')
        eol = body.get('eol')
        if eol == 'crlf':
            text = text.replace('\n', '\r\n')
        elif eol == 'cr':
            text = text.replace('\n', '\r')
        if body.get('encoding') not in ENCODINGS:
            raise ApiError(400, 'Unknown encoding')
        codec, bom = ENCODINGS[body['encoding']]
        try:
            data = text.encode(codec)
        except UnicodeEncodeError:
            if not body.get('lossy'):
                raise ApiError(422, "Some characters can't be stored as ANSI and would be lost.", lossy=True)
            data = text.encode(codec, 'replace')
        is_new = not os.path.exists(full)
        write_atomic(full, bom + data)
        if is_new:
            request_reindex()
        self.send_json({'ok': True, 'path': rel_of(full), 'name': os.path.basename(full),
                        'version': file_version(full), 'size': len(bom) + len(data)})


ROUTES = {
    ('GET', '/api/ping'): Handler.api_ping,
    ('GET', '/api/info'): Handler.api_info,
    ('GET', '/api/list'): Handler.api_list,
    ('GET', '/api/search'): Handler.api_search,
    ('GET', '/raw'): Handler.raw,
    ('POST', '/api/open'): Handler.api_open,
    ('POST', '/api/reveal'): Handler.api_reveal,
    ('POST', '/api/rescan'): Handler.api_rescan,
    ('POST', '/api/shutdown'): Handler.api_shutdown,
    ('POST', '/api/mkdir'): Handler.api_mkdir,
    ('POST', '/api/newfile'): Handler.api_newfile,
    ('POST', '/api/rename'): Handler.api_rename,
    ('POST', '/api/move'): Handler.api_move,
    ('POST', '/api/copy'): Handler.api_copy,
    ('POST', '/api/delete'): Handler.api_delete,
    ('GET', '/api/trash'): Handler.api_trash,
    ('POST', '/api/restore'): Handler.api_restore,
    ('POST', '/api/purge'): Handler.api_purge,
    ('POST', '/api/upload'): Handler.api_upload,
    ('GET', '/api/read'): Handler.api_read,
    ('GET', '/api/catalog'): Handler.api_catalog_get,
    ('POST', '/api/catalog'): Handler.api_catalog_set,
    ('GET', '/api/tree'): Handler.api_tree,
    ('POST', '/api/save'): Handler.api_save,
}


class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def stop():
    time.sleep(0.3)
    if S.httpd:
        S.httpd.shutdown()


def watch_drive():
    """Exit when the drive is unplugged/unmounted."""
    marker = os.path.join(APP_DIR, 'server.py')
    while True:
        time.sleep(2)
        if not os.path.exists(marker):
            log('Drive gone, stopping')
            stop()
            return


def existing_session():
    try:
        with open(SESSION_FILE) as f:
            old = json.load(f)
        req = urllib.request.Request('http://127.0.0.1:%d/api/ping' % old['port'],
                                     headers={'X-Token': old['token'], 'Host': 'localhost:%d' % old['port']})
        with urllib.request.urlopen(req, timeout=2) as r:
            if json.loads(r.read().decode()).get('serial') == DRIVE_ID:
                return old
    except Exception:  # noqa: BLE001 - any failure means "no live session"
        pass
    return None


def main():
    no_browser = '--no-browser' in sys.argv
    os.chdir(os.path.expanduser('~'))   # never hold the drive busy, so it can be ejected

    old = existing_session()
    if old:
        if not no_browser:
            webbrowser.open('http://localhost:%d/#t=%s' % (old['port'], old['token']))
        return

    for port in range(8765, 8800):
        try:
            S.httpd = Server(('127.0.0.1', port), Handler)
            S.port = port
            break
        except OSError:
            continue
    if not S.httpd:
        log('No free port in 8765-8799')
        sys.exit(1)

    with open(SESSION_FILE, 'w') as f:
        json.dump({'port': S.port, 'token': S.token, 'pid': os.getpid()}, f)
    try:
        os.chmod(SESSION_FILE, 0o600)
    except OSError:
        pass

    threading.Thread(target=build_index, daemon=True).start()
    threading.Thread(target=watch_drive, daemon=True).start()
    log('Started on port %d for %s (%s)' % (S.port, ROOT, DRIVE_ID))
    if not no_browser:
        webbrowser.open('http://localhost:%d/#t=%s' % (S.port, S.token))
    try:
        S.httpd.serve_forever(poll_interval=0.5)
    finally:
        S.httpd.server_close()
        try:
            os.remove(SESSION_FILE)
        except OSError:
            pass
        log('Stopped')


if __name__ == '__main__':
    main()
