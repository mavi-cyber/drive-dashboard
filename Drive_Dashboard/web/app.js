'use strict';

/* ================= session token ================= */
const TOKEN_KEY = 'driveDashToken';
let token = null;
(function bootToken() {
  const m = location.hash.match(/[#&]t=([0-9a-f]{16,})/);
  if (m) {
    token = m[1];
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (_) {}
    history.replaceState(null, '', location.pathname + '#/');
  } else {
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch (_) {}
  }
})();

/* ================= helpers ================= */
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;   // CSSOM, allowed by the page's CSP (style attributes are not)
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function logo() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#logo');
  svg.setAttribute('class', 'logo');
  svg.append(use);
  return svg;
}
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function fmtSize(n) {
  if (n === null || n === undefined) return '-';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtNum(n) { return (n ?? 0).toLocaleString(); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const rawUrl = (p) => `/raw?path=${encodeURIComponent(p)}&t=${token}`;

function revealLabel() {
  const p = state.info?.platform;
  return p === 'mac' ? 'Show in Finder' : p === 'linux' ? 'Show in folder' : 'Show in Explorer';
}
function fullPath(rel) {
  const i = state.info || {};
  const sep = i.sep || '\\';
  const root = (i.root || '').replace(/[\\/]+$/, '');
  return root + sep + rel.split('/').join(sep);
}
const LAUNCH_HINT = 'Open it again with Start-Dashboard in the Drive_Dashboard folder on your drive (.bat on Windows, .command on Mac, .sh on Linux), or unplug and re-plug the drive.';

/* ================= file types ================= */
const TYPES = [
  { exts: 'iso', label: 'Disc image (ISO)', icon: 'disc', cls: 't-disk' },
  { exts: 'img', label: 'Disk image', icon: 'disc', cls: 't-disk' },
  { exts: 'vdi', label: 'VirtualBox disk', icon: 'vm', cls: 't-disk' },
  { exts: 'vhd vhdx vmdk qcow2', label: 'Virtual disk', icon: 'vm', cls: 't-disk' },
  { exts: 'wim esd', label: 'Windows image', icon: 'disc', cls: 't-disk' },
  { exts: 'exe', label: 'Windows program', icon: 'installer', cls: 't-inst' },
  { exts: 'msi msix', label: 'Windows installer', icon: 'installer', cls: 't-inst' },
  { exts: 'deb', label: 'Debian package', icon: 'box', cls: 't-inst' },
  { exts: 'appimage', label: 'Linux AppImage', icon: 'box', cls: 't-inst' },
  { exts: 'apk', label: 'Android app', icon: 'phone', cls: 't-inst' },
  { exts: 'zip', label: 'ZIP archive', icon: 'zip', cls: 't-arch' },
  { exts: 'rar', label: 'RAR archive', icon: 'zip', cls: 't-arch' },
  { exts: '7z', label: '7-Zip archive', icon: 'zip', cls: 't-arch' },
  { exts: 'tar gz bz2 xz tgz', label: 'Tar archive', icon: 'archive', cls: 't-arch' },
  { exts: 'whl', label: 'Python wheel', icon: 'archive', cls: 't-arch' },
  { exts: 'mp4 mkv avi mov webm wmv flv m4v', label: 'Video', icon: 'film', cls: 't-video', preview: 'video' },
  { exts: 'mp3 wav flac m4a ogg aac wma', label: 'Audio', icon: 'music', cls: 't-audio', preview: 'audio' },
  { exts: 'png jpg jpeg gif bmp webp ico', label: 'Image', icon: 'image', cls: 't-img', preview: 'image' },
  { exts: 'svg', label: 'SVG image', icon: 'image', cls: 't-img', preview: 'text' },
  { exts: 'pdf', label: 'PDF document', icon: 'pdf', cls: 't-doc', preview: 'pdf' },
  { exts: 'doc docx odt rtf', label: 'Document', icon: 'doc', cls: 't-doc' },
  { exts: 'xls xlsx ods csv', label: 'Spreadsheet', icon: 'doc', cls: 't-doc' },
  { exts: 'ppt pptx odp', label: 'Presentation', icon: 'doc', cls: 't-doc' },
  { exts: 'txt md log sha256 ini cfg conf yaml yml', label: 'Text', icon: 'doc', cls: 't-doc', preview: 'text' },
  { exts: 'py js ts html htm css java c cpp h cs ps1 sh bat cmd json xml asm mac sql', label: 'Code / script', icon: 'code', cls: 't-code', preview: 'text' },
];
const EXT_MAP = {};
for (const t of TYPES) for (const e of t.exts.split(' ')) EXT_MAP[e] = t;
const RUNNABLE = new Set(['exe', 'msi', 'msix', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'reg', 'lnk', 'scr', 'com', 'sh', 'command', 'run', 'appimage', 'pkg']);
function extOf(name) { const i = name.lastIndexOf('.'); return i > 0 ? name.slice(i + 1).toLowerCase() : ''; }
function typeOf(item) {
  if (item.dir) return { label: 'Folder', icon: item.icon || 'folder', cls: '' };
  const ext = extOf(item.name);
  return EXT_MAP[ext] || { label: ext ? ext.toUpperCase() + ' file' : 'File', icon: 'file', cls: '', preview: ext ? null : 'text' };
}

/* ================= API ================= */
class AuthError extends Error {}
async function api(path) {
  const r = await fetch(path, { headers: { 'X-Token': token || '' } });
  if (r.status === 401) throw new AuthError();
  const j = await r.json();
  if (!r.ok) throw apiError(r, j);
  return j;
}
function apiError(r, j) {
  const e = new Error((j && j.error) || r.statusText);
  e.status = r.status;
  e.data = j || {};
  return e;
}
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'X-Token': token || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (r.status === 401) throw new AuthError();
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw apiError(r, j);
  return j;
}

/* ================= state ================= */
const state = {
  info: null,
  special: null,
  roots: [],
  path: '',
  view: store.get('dd-view', 'grid'),
  query: '',
  searchScope: 'drive',
};

function fatal(title, msg) {
  // keep the icon sprite: every icon() on the page references its <symbol>s
  document.body.replaceChildren(document.querySelector('svg.sprite'), h('div', { class: 'fatal' },
    logo(),
    h('h1', { text: title }), h('p', { text: msg })));
}
function handleError(e) {
  if (e instanceof AuthError) {
    fatal('Session expired', LAUNCH_HINT);
  } else if (e instanceof TypeError) {
    fatal('Dashboard stopped', 'The dashboard server is not running (the drive may have been unplugged). ' + LAUNCH_HINT);
  } else {
    toast(e.message || String(e));
  }
}

/* ================= sidebar ================= */
async function loadInfo() {
  state.info = await api('/api/info');
  const i = state.info;
  $('driveLabel').textContent = i.label || 'Drive';
  $('driveRoot').textContent = i.rootLabel || i.root;
  if (state.special !== 'notepad') document.title = (i.label || 'Drive') + ' · Dashboard';   // Notepad owns the title while open
  const used = i.total - i.free;
  $('usageFill').style.width = (used / i.total * 100).toFixed(1) + '%';
  $('usageText').textContent = `${fmtSize(used)} used · ${fmtSize(i.free)} free of ${fmtSize(i.total)}`;
  if (i.firstRun && i.indexState === 'ready') Catalog.firstRun();   // new drive: build catalog.json
  const st = $('indexState');
  if (i.indexState === 'ready') {
    st.replaceChildren(h('span', { class: 'dot' }), `Indexed ${fmtNum(i.stats.fileCount)} files`);
  } else if (i.indexState === 'building' || i.indexState === 'idle') {
    st.replaceChildren(h('span', { class: 'dot busy' }), 'Indexing drive…');
  } else {
    st.replaceChildren(h('span', { class: 'dot busy' }), i.indexState);
  }
}
async function loadRoots() {
  const r = await api('/api/list?path=');
  state.roots = r.items.filter((x) => x.dir);
  renderNav();
}
function renderNav() {
  const nav = $('nav');
  const sizes = {};
  for (const c of state.info?.stats?.categories || []) sizes[c.path] = c.size;
  const top = state.path.split('/')[0];
  nav.replaceChildren(
    h('a', { href: '#/', class: state.path === '' && !state.query && !state.special ? 'active' : '' }, icon('home'), 'Overview'),
    h('div', { class: 'nav-label', text: 'Library' }),
    ...state.roots.map((f) =>
      h('a', { href: '#/' + encPath(f.path), class: top === f.path ? 'active' : '' },
        icon(f.icon || 'folder'),
        h('span', { text: f.title || f.name }),
        h('span', { class: 'nav-size', text: sizes[f.path] !== undefined ? fmtSize(sizes[f.path]) : '' }))),
    h('div', { class: 'nav-label', text: 'Tools' }),
    h('a', { href: '#~notepad', class: state.special === 'notepad' ? 'active' : '' },
      icon('notepad'), h('span', { text: 'Notepad' }), h('span', { class: 'nav-size', id: 'npBadge', text: Notepad.badge() })),
    h('a', { href: '#~trash', class: state.special === 'trash' ? 'active' : '' }, icon('trash'), h('span', { text: 'Trash' })),
  );
}

/* ================= breadcrumbs ================= */
function renderCrumbs(path, label) {
  const c = $('crumbs');
  const parts = path ? path.split('/') : [];
  const kids = [h('a', { href: '#/' }, 'Home')];
  if (label) {
    kids.push(h('span', { class: 'sep' }, icon('chev')), h('span', { class: 'cur', text: label }));
  } else {
    // Deep paths collapse to Home › … › parent › current so names stay readable.
    const first = parts.length > 2 ? parts.length - 2 : 0;
    if (first > 0) {
      kids.push(h('span', { class: 'sep' }, icon('chev')),
        h('a', { href: '#/' + encPath(parts.slice(0, first).join('/')), title: '/' + parts.slice(0, first).join('/'), text: '…' }));
    }
    parts.forEach((p, i) => {
      if (i < first) return;
      kids.push(h('span', { class: 'sep' }, icon('chev')));
      const sub = parts.slice(0, i + 1).join('/');
      kids.push(i === parts.length - 1 ? h('span', { class: 'cur', text: p }) : h('a', { href: '#/' + encPath(sub), text: p }));
    });
  }
  c._all = kids;
  c.replaceChildren(...kids);
  fitCrumbs();
}
// If the path still doesn't fit, drop crumbs from the left so the current folder stays readable.
function fitCrumbs() {
  const c = $('crumbs');
  if (!c._all) return;
  c.replaceChildren(...c._all);
  while (c.scrollWidth > c.clientWidth + 1 && c.querySelectorAll('a').length > 1) {
    const first = c.firstElementChild;
    const next = first.nextElementSibling;
    first.remove();
    if (next && next.classList.contains('sep')) next.remove();
  }
}
window.addEventListener('resize', () => requestAnimationFrame(fitCrumbs));

/* ================= actions ================= */
async function openItem(item) {
  if (!item.dir && RUNNABLE.has(extOf(item.name))) {
    if (!confirm(`Run "${item.name}"?\n\nThis starts the program on this computer.`)) return;
  }
  try { await post('/api/open', { path: item.path }); toast('Opening ' + item.name); }
  catch (e) { handleError(e); }
}
async function revealItem(item) {
  try { await post('/api/reveal', { path: item.path }); toast(revealLabel()); }
  catch (e) { handleError(e); }
}
function actionButtons(item) {
  const t = typeOf(item);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  return h('div', { class: 'actions' },
    !item.dir && h('button', { title: t.preview ? 'Preview' : 'Details', class: 'opt', onclick: stop(() => preview(item)) }, icon('eye')),
    h('button', { title: item.dir ? 'Open folder' : (RUNNABLE.has(extOf(item.name)) ? 'Run' : 'Open with default app'), onclick: stop(() => openItem(item)) }, icon('open')),
    h('button', { title: 'More actions', 'aria-label': 'More actions', onclick: (e) => { e.stopPropagation(); e.preventDefault(); Files.itemMenu(item, e); } }, icon('more')));
}
function activate(item) {
  if (item.dir) location.hash = '#/' + encPath(item.path);
  else preview(item);
}

/* ================= item renderers ================= */
function folderCard(item) {
  const warn = item.warn && h('span', { class: 'card-warn', title: item.warn }, icon('warn'));
  return Files.decorate(h('a', { class: 'card', href: '#/' + encPath(item.path) },
    h('div', { class: 'card-top' },
      h('div', { class: 'card-icon folder' }, icon(item.icon || 'folder')),
      h('div', { style: 'min-width:0;flex:1' },
        h('div', { class: 'card-title', text: item.title || item.name }),
        item.title && item.title !== item.name ? h('div', { class: 'card-sub', text: item.name }) : null),
      warn),
    item.desc && h('div', { class: 'card-desc', text: item.desc }),
    h('div', { class: 'card-foot' },
      item.size !== null && item.size !== undefined && h('span', { text: fmtSize(item.size) }),
      item.count !== null && item.count !== undefined && h('span', { text: item.count + (item.count === 1 ? ' item' : ' items') }))), item);
}
function fileCard(item) {
  const t = typeOf(item);
  return Files.decorate(h('div', { class: 'card', style: 'cursor:pointer', onclick: () => activate(item), title: item.name },
    h('div', { class: 'card-top' },
      h('div', { class: 'card-icon ' + t.cls }, icon(t.icon)),
      h('div', { style: 'min-width:0;flex:1' },
        h('div', { class: 'card-title', text: item.name }),
        h('div', { class: 'card-sub', text: t.label }))),
    h('div', { class: 'card-foot', style: 'align-items:center' },
      h('span', { text: fmtSize(item.size) }), h('span', { text: fmtDate(item.mtime) }),
      h('span', { style: 'margin-left:auto' }, actionButtons(item)))), item);
}
function tableRow(item, withPath) {
  const t = typeOf(item);
  const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
  return Files.decorate(h('div', { class: 'row' + (withPath ? ' search-row' : '') },
    h('div', { class: 'name-cell clickable', onclick: () => activate(item), title: item.path },
      h('div', { class: 'ftype ' + (item.dir ? 'card-icon folder' : t.cls) }, icon(t.icon)),
      h('div', { class: 'name-text' },
        h('div', { class: 'n', text: item.title && item.dir ? item.title : item.name }),
        withPath ? h('div', { class: 'p', text: '/' + parent })
          : (item.title && item.dir && item.title !== item.name ? h('div', { class: 'p', text: item.name }) : null))),
    h('div', { class: 'col-type' }, h('span', { class: 'badge', text: t.label })),
    h('div', { class: 'cell-muted col-size', text: item.dir && item.size === null ? '-' : fmtSize(item.size) }),
    !withPath && h('div', { class: 'cell-muted col-date', text: fmtDate(item.mtime) }),
    actionButtons(item)), item);
}
function table(items, withPath) {
  return h('div', { class: 'table' },
    h('div', { class: 'row head' + (withPath ? ' search-row' : '') },
      h('div', { text: 'Name' }), h('div', { class: 'col-type', text: 'Type' }), h('div', { class: 'col-size', text: 'Size' }),
      !withPath && h('div', { class: 'col-date', text: 'Modified' }), h('div')),
    ...items.map((i) => tableRow(i, withPath)));
}

/* ================= oil bar feathering ================= */
// Feathered joins: both sides of a join blend over the same distance (12px, or 30% of the thinner
// neighbour as actually drawn) and meet at a 50/50 mix, so colours flow smoothly into each other.
// Uses final on-screen widths (tiny categories are drawn at a 4px minimum), recomputed on resize.
function featherOil() {
  const inner = document.querySelector('.oil-inner');
  if (!inner) return;
  const segs = [...inner.querySelectorAll('.oil-seg')];
  const track = inner.clientWidth;
  const px = segs.map((s) => Math.max(4, parseFloat(s.style.width) / 100 * track));
  const join = (i) => Math.min(12, 0.3 * Math.min(px[i], px[i + 1]));   // join between i and i+1
  segs.forEach((s, i) => {
    const cur = s.dataset.color;
    const prev = segs[i - 1]?.dataset.color;
    const next = segs[i + 1]?.dataset.color;
    const L = prev ? join(i - 1) : 0;
    const R = next ? join(i) : 0;
    const stops = [
      prev ? `color-mix(in oklab, ${prev} 50%, ${cur}) 0px` : `${cur} 0px`,
      `${cur} ${L.toFixed(2)}px`,
      `${cur} calc(100% - ${R.toFixed(2)}px)`,
      next ? `color-mix(in oklab, ${cur} 50%, ${next}) 100%` : `${cur} 100%`,
    ];
    s.style.backgroundImage = OIL_GLOSS + `, linear-gradient(90deg, ${stops.join(', ')})`;
  });
}
let featherTimer = 0;
window.addEventListener('resize', () => { clearTimeout(featherTimer); featherTimer = setTimeout(featherOil, 120); });

/* ================= liquid stat tiles ================= */
// Each tile is a small tank: the liquid level shows the value's share, with a moving wave on top.
const liquidLevels = {};                    // last level per tile, so changes rise/fall from there
let countedUp = false;                      // numbers count up only on the first render
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function waveSvg(cls) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 20');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'wave ' + cls);
  const path = document.createElementNS(NS, 'path');
  // two identical periods, so sliding it by half its width loops seamlessly
  path.setAttribute('d', 'M0 10 Q25 2 50 10 T100 10 T150 10 T200 10 V20 H0 Z');
  svg.append(path);
  return svg;
}
function liquidStat(key, label, value, fmt, level, color, sub) {
  level = Math.max(0, Math.min(1, level || 0));
  const valueEl = h('div', { class: 'v', text: value === null ? '…' : fmt(value) });
  const fill = h('div', { class: 'liquid-fill', 'aria-hidden': 'true' },
    waveSvg('back'), waveSvg('front'), h('div', { class: 'liquid-body' }));
  fill.style.color = color;
  const from = liquidLevels[key] ?? 0;
  fill.style.height = (from * 100).toFixed(1) + '%';
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.height = (level * 100).toFixed(1) + '%'; }));
  liquidLevels[key] = level;
  if (value !== null && !countedUp && !reducedMotion()) {
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      const eased = 1 - Math.pow(1 - k, 3);
      valueEl.textContent = fmt(fmt === fmtNum ? Math.round(value * eased) : value * eased);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  const tile = h('div', { class: 'stat liquid', title: sub },
    fill,
    h('div', { class: 'splash-layer', 'aria-hidden': 'true' }),
    h('div', { class: 'stat-text' }, h('div', { class: 'k', text: label }), valueEl, h('div', { class: 'stat-sub', text: sub })));
  // Splashes: a big one when the pointer enters, small ones as it moves along the surface.
  let lastT = 0, lastX = -99;
  tile.addEventListener('pointerenter', (e) => splash(tile, color, level, e.clientX, true));
  tile.addEventListener('pointermove', (e) => {
    const now = performance.now();
    if (now - lastT < 90 || Math.abs(e.clientX - lastX) < 10) return;
    lastT = now; lastX = e.clientX;
    splash(tile, color, level, e.clientX, false);
  });
  return tile;
}
function splash(tile, color, level, clientX, big) {
  if (reducedMotion()) return;
  const layer = tile.querySelector('.splash-layer');
  if (!layer || layer.childElementCount > 60) return;      // cap in-flight droplets
  const r = tile.getBoundingClientRect();
  const x = clientX - r.left;
  const y = Math.min(r.height - 4, r.height * (1 - level));  // the liquid surface
  const drops = big ? 7 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < drops; i++) {
    const d = document.createElement('span');
    d.className = 'drop';
    const size = (big ? 3.5 : 2.5) + Math.random() * (big ? 4.5 : 3);
    d.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color}`;
    layer.append(d);
    const dx = (Math.random() - 0.5) * (big ? 80 : 44);
    const up = (big ? 16 : 9) + Math.random() * (big ? 34 : 18);
    const dur = 520 + Math.random() * 380;
    // rise decelerating, fall accelerating: a simple gravity arc
    d.animate([
      { transform: 'translate(-50%, -50%)', opacity: 0.85, easing: 'cubic-bezier(.2,.7,.4,1)' },
      { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% - ${up}px))`, opacity: 0.85, offset: 0.45, easing: 'cubic-bezier(.6,0,.9,.5)' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + 8px)) scale(.5)`, opacity: 0 },
    ], { duration: dur, fill: 'forwards' }).onfinish = () => d.remove();
  }
  const ring = document.createElement('span');
  ring.className = 'ripple';
  ring.style.cssText = `left:${x}px;top:${y}px;color:${color}`;
  layer.append(ring);
  ring.animate([
    { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0.7 },
    { transform: `translate(-50%, -50%) scale(${big ? 4 : 2.4})`, opacity: 0 },
  ], { duration: big ? 900 : 650, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = () => ring.remove();
}

/* ================= views ================= */
// glossy highlight on top, shade underneath: layered over the oil bar's colour gradient
const OIL_GLOSS = 'linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,.14) 34%, rgba(255,255,255,0) 52%, rgba(0,0,0,.22) 100%)';
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

async function renderHome(my) {
  renderCrumbs('', null);
  const v = $('view');
  const i = state.info;
  const used = i.total - i.free;
  const st = i.stats;
  const kids = [
    h('div', { class: 'page-head' },
      h('div', { class: 'page-icon logo-wrap' }, logo()),
      h('div', {},
        h('h1', { text: i.label || 'Drive' }),
        h('p', { text: 'Everything on this drive, grouped by what it is for. Click a category to browse, search with /, preview or open any file.' }))),
    ...[Catalog.welcomeCard()].filter(Boolean),   // shown after the first run on a drive
    h('div', { class: 'hero' }, ...(() => {
      const items = st ? st.fileCount + st.folderCount : 0;
      const pct = (x, of) => (of ? Math.round(x / of * 100) : 0);
      return [
        liquidStat('used', 'Used', used, fmtSize, used / i.total, 'var(--c1)', `${pct(used, i.total)}% of ${fmtSize(i.total)}`),
        liquidStat('free', 'Free', i.free, fmtSize, i.free / i.total, 'var(--liquid-free)', `${pct(i.free, i.total)}% available`),
        liquidStat('files', 'Files', st ? st.fileCount : null, fmtNum, st ? st.fileCount / items : 0, 'var(--c4)', st ? `${pct(st.fileCount, items)}% of all items` : 'Counting…'),
        liquidStat('folders', 'Folders', st ? st.folderCount : null, fmtNum, st ? st.folderCount / items : 0, 'var(--c3)', st ? `${pct(st.folderCount, items)}% of all items` : 'Counting…'),
      ];
    })()),
  ];

  if (st) {
    // names from the live folder list, so new or edited descriptions show without a rescan
    const nameOf = (c) => (state.roots.find((r) => r.path === c.path) || {}).title || c.name;
    const cats = st.categories.filter((c) => c.size > 0);
    kids.push(h('h2', { class: 'section', text: 'Space by category' }),
      h('div', { class: 'panel' },
        h('div', { class: 'stack oil' }, h('div', { class: 'oil-inner' }, ...cats.map((c, n) => {
          const seg = h('a', { class: 'oil-seg', href: '#/' + encPath(c.path), title: `${nameOf(c)}: ${fmtSize(c.size)}`,
            'aria-label': `${nameOf(c)}, ${fmtSize(c.size)}` });
          seg.style.width = (c.size / i.total * 100).toFixed(2) + '%';
          const cur = PALETTE[n % PALETTE.length];
          seg.dataset.color = cur;
          seg.style.backgroundColor = cur;
          seg.style.animationDelay = (n * 140) + 'ms';   // pour in one after another
          return seg;
        }))),
        h('div', { class: 'legend' }, ...cats.map((c, n) =>
          h('span', {}, h('i', { style: 'background:' + PALETTE[n % PALETTE.length] }), `${nameOf(c)} · ${fmtSize(c.size)}`)),
          h('span', {}, h('i', { style: 'background:var(--surface-2);outline:1px solid var(--border)' }), `Free · ${fmtSize(i.free)}`))));
  }

  const roots = await api('/api/list?path=');
  if (isStale(my)) return;
  const rootDirs = roots.items.filter((x) => x.dir);
  Files.setListing(rootDirs, '');
  kids.push(h('h2', { class: 'section', text: 'Categories' }), Files.toolbar(''),
    h('div', { class: 'cards' }, ...rootDirs.map(folderCard)));

  if (st) {
    const maxT = Math.max(...st.types.map((t) => t.size), 1);
    kids.push(h('div', { class: 'two-col', style: 'margin-top:26px' },
      h('div', {},
        h('h2', { class: 'section', text: 'By file type' }),
        h('div', { class: 'panel bars' }, ...st.types.map((t) =>
          h('div', { class: 'bar-row', title: `${fmtNum(t.count)} files` },
            h('span', { text: t.group }),
            h('div', { class: 'track' }, h('span', { style: `width:${(t.size / maxT * 100).toFixed(1)}%` })),
            h('span', { class: 'val', text: fmtSize(t.size) }))))),
      h('div', {},
        h('h2', { class: 'section', text: 'Largest files' }),
        h('div', { class: 'panel big-list' }, ...st.largest.map((f) => {
          const parent = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
          return h('a', { href: '#/' + encPath(parent), title: f.path },
            h('span', { class: 'n', text: f.name }), h('span', { class: 's', text: fmtSize(f.size) }));
        })))));
  } else {
    kids.push(h('p', { class: 'note', text: 'Indexing the drive - sizes, search and statistics appear in a moment.' }));
  }
  v.replaceChildren(...kids);
  featherOil();
  if (st) countedUp = true;
}

async function renderFolder(path, my) {
  renderCrumbs(path, null);
  const v = $('view');
  const r = await api('/api/list?path=' + encodeURIComponent(path));
  if (isStale(my)) return;
  const f = r.folder;
  const items = r.items.slice().sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const dirs = items.filter((x) => x.dir);
  const files = items.filter((x) => !x.dir);
  const name = path.split('/').pop();
  const total = state.info?.stats ? items.reduce((s, x) => s + (x.size || 0), 0) : null;

  const kids = [
    h('div', { class: 'page-head' },
      h('div', { class: 'page-icon' }, icon(f.icon || 'folder')),
      h('div', { style: 'min-width:0' },
        h('h1', { text: f.title || name }),
        f.desc ? h('p', { text: f.desc }) : (f.title ? null : h('p', { text: '/' + path }))),
      h('div', { class: 'page-meta' },
        h('b', { text: total !== null ? fmtSize(total) : '' }),
        `${dirs.length} folder${dirs.length === 1 ? '' : 's'} · ${files.length} file${files.length === 1 ? '' : 's'}`)),
  ];
  if (f.warn) kids.push(h('div', { class: 'warn-box' }, icon('warn'), h('span', { text: f.warn })));
  kids.push(Files.toolbar(path));
  Files.setListing(items, path);

  if (!items.length) {
    kids.push(h('div', { class: 'empty' }, icon('folder'), h('div', { text: 'This folder is empty.' })));
  } else if (state.view === 'list') {
    kids.push(table(items, false));
  } else {
    if (dirs.length) kids.push(h('h2', { class: 'section', text: dirs.every((d) => d.desc) ? 'Applications & sections' : 'Folders' }),
      h('div', { class: 'cards' }, ...dirs.map(folderCard)));
    if (files.length) kids.push(h('h2', { class: 'section', text: 'Files' }),
      files.length > 24 ? table(files, false) : h('div', { class: 'cards' }, ...files.map(fileCard)));
  }
  v.replaceChildren(...kids);
}

let searchSeq = 0;
async function renderSearch(my) {
  const q = state.query.trim();
  const scoped = state.searchScope === 'folder' && state.path;
  renderCrumbs('', `Search: ${q}`);
  const seq = ++searchSeq;
  const r = await api(`/api/search?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scoped ? state.path : '')}`);
  if (seq !== searchSeq || isStale(my)) return;
  const v = $('view');
  const scopeBtn = state.path && h('div', { class: 'seg', style: 'margin-left:auto' },
    h('button', { class: !scoped ? 'on' : '', style: 'padding:5px 10px', onclick: () => { state.searchScope = 'drive'; route(); } }, 'Whole drive'),
    h('button', { class: scoped ? 'on' : '', style: 'padding:5px 10px', onclick: () => { state.searchScope = 'folder'; route(); } }, 'This folder'));
  const head = h('div', { class: 'page-head', style: 'align-items:center' },
    h('div', { class: 'page-icon' }, icon('search')),
    h('div', {},
      h('h1', { text: `“${q}”` }),
      h('p', { text: r.state !== 'ready' ? 'The drive is still being indexed - try again in a few seconds.'
        : `${fmtNum(r.total)} match${r.total === 1 ? '' : 'es'}${scoped ? ' in /' + state.path : ' on the drive'}${r.total > r.items.length ? ` · showing first ${r.items.length}` : ''}` })),
    scopeBtn);
  const items = r.items.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  Files.setListing(items, null);
  v.replaceChildren(head, items.length ? table(items, true)
    : h('div', { class: 'empty' }, icon('search'), h('div', { text: 'Nothing found.' })));
}

/* ================= preview ================= */
async function preview(item) {
  const t = typeOf(item);
  const body = $('modalBody');
  $('modalTitle').textContent = item.name;
  $('modalActions').replaceChildren(...[
    Notepad.canEdit(item) && h('button', { class: 'btn', onclick: () => { closePreview(); Notepad.openFile(item.path); } }, icon('edit'), 'Edit'),
    h('button', { class: 'btn', onclick: () => Files.download(item) }, icon('download'), 'Download'),
    h('button', { class: 'btn', onclick: () => openItem(item) }, icon('open'), RUNNABLE.has(extOf(item.name)) ? 'Run' : 'Open'),
    h('button', { class: 'btn', onclick: () => revealItem(item) }, icon('reveal'), revealLabel()),
  ].filter(Boolean));
  const details = () => h('dl', { class: 'details' },
    h('dt', { text: 'Type' }), h('dd', { text: t.label }),
    h('dt', { text: 'Size' }), h('dd', { text: fmtSize(item.size) + (item.size >= 1024 ? ` (${fmtNum(item.size)} bytes)` : '') }),
    h('dt', { text: 'Modified' }), h('dd', { text: item.mtime ? new Date(item.mtime).toLocaleString() : '' }),
    h('dt', { text: 'Location' }), h('dd', { text: fullPath(item.path) }));

  const url = rawUrl(item.path);
  if (t.preview === 'image') body.replaceChildren(h('img', { src: url, alt: item.name }));
  else if (t.preview === 'video') body.replaceChildren(h('video', { src: url, controls: true, autoplay: true }));
  else if (t.preview === 'audio') body.replaceChildren(h('audio', { src: url, controls: true, autoplay: true }));
  else if (t.preview === 'pdf') body.replaceChildren(h('iframe', { src: url, title: item.name }));
  else if (t.preview === 'text' && item.size < 5 * 1024 * 1024) {
    body.replaceChildren(h('div', { class: 'skeleton', style: 'width:90%;margin:20px' }));
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-262143' } });
      if (r.status === 401) throw new AuthError();
      const txt = await r.text();
      body.replaceChildren(h('pre', { text: txt + (item.size > 262144 ? '\n\n… (first 256 KB shown)' : '') }));
    } catch (e) { handleError(e); }
  } else body.replaceChildren(details());
  $('modal').hidden = false;
  $('modalClose').focus();
}
function closePreview() {
  const m = $('modal');
  if (m.hidden) return;
  m.hidden = true;
  $('modalBody').replaceChildren();   // stops media playback
}

/* ================= routing ================= */
// Several things can trigger a re-render at once (user action, index poll...). Only the
// newest render may write to the page, so a slower, older one can't overwrite fresh data.
let routeSeq = 0;
const isStale = (my) => my !== routeSeq;
async function route() {
  const my = ++routeSeq;
  $('app').classList.remove('nav-open');
  const raw = location.hash.replace(/^#/, '');
  state.special = raw.startsWith('~') && !state.query.trim() ? raw.slice(1) : null;
  if (state.special !== 'notepad') state.lastView = location.hash || '#/';   // where closing Notepad returns to
  const hash = location.hash.replace(/^#\/?/, '');
  state.path = state.special ? '' : hash.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  renderNav();
  Files.closeMenu();
  if (state.special === 'notepad') { Notepad.show(); return; }
  Notepad.hide();
  $('view').replaceChildren(h('div', { class: 'cards' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
  try {
    if (state.query.trim()) await renderSearch(my);
    else if (state.special === 'trash') await Files.renderTrash(my);
    else if (!state.path) await renderHome(my);
    else await renderFolder(state.path, my);
    if (!isStale(my)) $('view').scrollTop = 0;
  } catch (e) {
    if (e instanceof AuthError || e instanceof TypeError) handleError(e);
    else if (!isStale(my)) $('view').replaceChildren(h('div', { class: 'empty' }, icon('warn'), h('div', { text: e.message })));
  }
}

/* ================= indexing poll ================= */
let pollTimer = null;
async function pollIndex() {
  clearTimeout(pollTimer);
  try {
    const was = state.info?.indexState;
    await loadInfo();
    renderNav();
    if (state.info.indexState === 'ready') {
      if (was !== 'ready') route();
    } else {
      pollTimer = setTimeout(pollIndex, 1500);
    }
  } catch (e) { handleError(e); }
}

/* ================= wiring ================= */
function setView(v) {
  state.view = v; store.set('dd-view', v);
  $('gridBtn').classList.toggle('on', v === 'grid');
  $('listBtn').classList.toggle('on', v === 'list');
}
function applyTheme(t) {
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

async function main() {
  if (!token) {
    fatal('Open from the drive', LAUNCH_HINT);
    return;
  }
  applyTheme(store.get('dd-theme', ''));
  setView(state.view);

  $('gridBtn').onclick = () => { setView('grid'); route(); };
  $('listBtn').onclick = () => { setView('list'); route(); };
  $('themeBtn').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    const next = dark ? 'light' : 'dark';
    store.set('dd-theme', next); applyTheme(next);
  };
  $('rescanBtn').onclick = async () => {
    try { await post('/api/rescan'); toast('Rescanning drive…'); pollIndex(); } catch (e) { handleError(e); }
  };
  $('stopBtn').onclick = async () => {
    if (!confirm('Stop the dashboard server?\n\nDo this before ejecting the drive.')) return;
    try { await post('/api/shutdown'); } catch (_) {}
    fatal('Dashboard stopped', 'You can now safely eject the drive. ' + LAUNCH_HINT);
  };
  $('menuBtn').onclick = () => $('app').classList.toggle('nav-open');
  $('scrim').onclick = () => $('app').classList.remove('nav-open');
  $('modalClose').onclick = closePreview;
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closePreview(); });

  let debounce;
  $('search').addEventListener('input', (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.query = e.target.value; route(); }, 220);
  });
  document.addEventListener('keydown', (e) => {
    if (Notepad.onKey(e) || Files.onKey(e)) return;
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (!$('modal').hidden) { closePreview(); return; }
      if (state.query) { $('search').value = ''; state.query = ''; route(); $('search').blur(); }
    } else if (e.key === '/' && !typing) {
      e.preventDefault(); $('search').focus(); $('search').select();
    } else if (e.key === 'Backspace' && !typing && $('modal').hidden && state.path) {
      const up = state.path.split('/').slice(0, -1).join('/');
      location.hash = '#/' + encPath(up);
    }
  });
  window.addEventListener('hashchange', () => {
    if (state.query) { state.query = ''; $('search').value = ''; }
    route();
  });
  Files.init();
  Notepad.init();

  try {
    await loadInfo();
    Notepad.restore().catch(() => {});   // needs the drive label for its saved-session key
    await loadRoots();
    await route();
    if (state.info.indexState !== 'ready') pollIndex();
  } catch (e) { handleError(e); }
}
// files.js and notepad.js load after this file (all deferred), so start once the DOM is ready.
document.addEventListener('DOMContentLoaded', main);
