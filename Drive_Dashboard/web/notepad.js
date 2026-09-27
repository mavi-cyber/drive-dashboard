'use strict';
/* =====================================================================
   Notepad: a Windows 11 Notepad-style editor for text files on the drive.
   Tabs, File/Edit/View menus, find & replace, go to line, zoom, word wrap,
   encodings (UTF-8 / UTF-8 BOM / UTF-16 LE/BE / ANSI), line endings
   (CRLF / LF / CR), session restore. Runs in the browser, so it works the
   same on Windows, Linux and macOS.
   ===================================================================== */
const Notepad = (() => {
  const EDITABLE = new Set(('txt md log sha256 ini cfg conf yaml yml py js ts html htm css java c cpp h cs ps1 sh bat cmd json ' +
    'xml asm mac sql csv tsv svg reg inf nfo srt vtt toml properties gitignore env command lst diz').split(' '));
  const MAX = 10 * 1024 * 1024;
  const ENC = { 'utf-8': 'UTF-8', 'utf-8-bom': 'UTF-8 with BOM', 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', ansi: 'ANSI' };
  const EOL = { crlf: 'Windows (CRLF)', lf: 'Unix (LF)', cr: 'Macintosh (CR)' };
  const FONTS = {
    mono: { label: 'Consolas (monospace)', css: 'Consolas, "Cascadia Mono", "SF Mono", Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace' },
    sans: { label: 'Segoe UI (sans-serif)', css: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Noto Sans", sans-serif' },
    serif: { label: 'Georgia (serif)', css: 'Georgia, "Times New Roman", "Noto Serif", serif' },
  };
  const SETTINGS_KEY = 'dd-np-settings';

  let root, tabBar, host, findBar, findInp, replInp, replRow, findCount, caseBtn;
  let posEl, charsEl, zoomEl, eolBtn, encBtn, statusBar, mirror;
  let tabs = [];
  let active = null;
  let seq = 1;
  let visible = false;
  let lastDir = '';
  let settings = { wrap: true, zoom: 100, status: true, font: 'mono', matchCase: false };

  const defaultEol = () => (state.info?.platform === 'windows' ? 'crlf' : 'lf');
  const parentOf = (p) => (p && p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const isDirty = (t) => t.ta.value !== t.saved || t.encoding !== t.savedEnc || t.eol !== t.savedEol;
  const sessionKey = () => 'dd-np-session-' + (state.info?.label || 'drive');

  function canEdit(item) {
    if (!item || item.dir || (item.size || 0) > MAX) return false;
    const ext = extOf(item.name);
    return ext === '' || EDITABLE.has(ext);
  }

  /* ---------------- tabs ---------------- */
  function makeTab({ path = null, name = 'Untitled', text = '', encoding = 'utf-8', eol = defaultEol(), version = null, readOnly = false }) {
    const ta = h('textarea', { class: 'np-text', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Text' });
    ta.value = text;
    const t = { id: seq++, path, name, ta, saved: ta.value, encoding, eol, savedEnc: encoding, savedEol: eol, version, readOnly };
    ta.addEventListener('input', () => onChange(t));
    for (const ev of ['keyup', 'mouseup', 'select', 'focus']) ta.addEventListener(ev, updateStatus);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); insertText(ta, '\t'); }
    });
    ta.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 10 : -10);
    }, { passive: false });
    ta.hidden = true;
    applyLook(ta);
    host.append(ta);
    tabs.push(t);
    return t;
  }
  function activate(t) {
    active = t;
    for (const x of tabs) x.ta.hidden = x !== t;
    renderTabs();
    updateStatus();
    updateTitle();
    if (visible) t.ta.focus();
    persist();
  }
  function newTab() { activate(makeTab({})); }
  function removeTab(t) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    tabs.splice(i, 1);
    t.ta.remove();
    if (active === t) active = null;
    if (!tabs.length) {
      // Like Windows 11 Notepad: closing the last tab closes Notepad (back to where you were).
      if (visible) { persist(); location.hash = state.lastView || '#/'; } else newTab();
    }
    else if (!active) activate(tabs[Math.min(i, tabs.length - 1)]);
    else renderTabs();
    persist();
  }
  async function closeTab(t = active) {
    if (!t) return;
    if (isDirty(t)) {
      activate(t);
      const r = await Files.dialog({ title: 'Notepad', message: `Do you want to save changes to ${t.name}?`,
        buttons: [{ text: 'Save', value: 'save', primary: true }, { text: "Don't save", value: 'discard' }, { text: 'Cancel', value: 'cancel' }] });
      if (!r || r.button === 'cancel') return;
      if (r.button === 'save' && !await save(t)) return;
    }
    removeTab(t);
  }
  function renderTabs() {
    tabBar.replaceChildren(...tabs.map((t) => h('div', {
      class: 'np-tab' + (t === active ? ' on' : ''), role: 'tab', 'aria-selected': String(t === active), tabindex: '0',
      title: t.path ? fullPath(t.path) : t.name,
      onclick: () => activate(t),
      onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } },
      onkeydown: (e) => { if (e.key === 'Enter') activate(t); },
    },
    h('span', { class: 'np-tab-name', text: t.name }),
    h('button', { class: 'np-tab-x' + (isDirty(t) ? ' dirty' : ''), title: isDirty(t) ? 'Unsaved changes - close tab' : 'Close tab',
      'aria-label': 'Close ' + t.name, onclick: (e) => { e.stopPropagation(); closeTab(t); } },
    h('span', { class: 'np-dot' }), icon('x')))),
    h('button', { class: 'np-newtab', title: 'New tab (Ctrl+Alt+N)', 'aria-label': 'New tab', onclick: newTab }, icon('plus')));
  }
  function onChange(t) {
    const tab = tabBar.querySelectorAll('.np-tab')[tabs.indexOf(t)];
    tab?.querySelector('.np-tab-x')?.classList.toggle('dirty', isDirty(t));
    updateStatus();
    updateTitle();
    updateBadge();
    persist();
  }
  function updateTitle() {
    if (!visible || !active) return;
    document.title = (isDirty(active) ? '• ' : '') + active.name + ' - Notepad';
  }
  function badge() {
    const n = tabs.filter(isDirty).length;
    return n ? `${n} unsaved` : '';
  }
  function updateBadge() { const b = $('npBadge'); if (b) b.textContent = badge(); }

  /* ---------------- open / save ---------------- */
  async function openFile(path) {
    if (!visible) location.hash = '#~notepad';
    const existing = tabs.find((t) => t.path === path);
    if (existing) { activate(existing); return; }
    try {
      const r = await api('/api/read?path=' + encodeURIComponent(path));
      const blank = active && !active.path && active.ta.value === '' && !isDirty(active) ? active : null;
      const t = makeTab({ path: r.path, name: r.name, text: r.text, encoding: r.encoding, eol: r.eol, version: r.version, readOnly: r.readOnly });
      lastDir = parentOf(r.path);
      activate(t);
      if (blank) removeTab(blank);
      if (r.readOnly) toast(`${r.name} is read-only here - you can edit and download a copy`);
    } catch (e) { handleError(e); }
  }
  async function openDialog() {
    const p = await Files.browse({ title: 'Open', okText: 'Open', start: lastDir, mode: 'open', filter: canEdit });
    if (p) openFile(p);
  }
  async function reload(t = active) {
    if (!t?.path) return;
    try {
      const r = await api('/api/read?path=' + encodeURIComponent(t.path));
      t.ta.value = r.text;
      Object.assign(t, { saved: t.ta.value, encoding: r.encoding, eol: r.eol, savedEnc: r.encoding, savedEol: r.eol, version: r.version });
      onChange(t);
      renderTabs();
      toast('Reloaded ' + t.name);
    } catch (e) { handleError(e); }
  }
  // Returns true when saved.
  async function save(t = active, saveAs = false) {
    if (!t) return false;
    if (state.info?.readOnly) { toast('This drive is read-only here - use File › Download a copy'); return false; }
    const req = { text: t.ta.value, encoding: t.encoding, eol: t.eol };
    if (t.path && !saveAs) {
      req.path = t.path;
      req.version = t.version;
    } else {
      const suggested = t.path ? t.name : (t.name === 'Untitled' ? 'Untitled.txt' : t.name);
      const r = await Files.browse({ title: 'Save as', okText: 'Save', start: t.path ? parentOf(t.path) : lastDir, mode: 'save', fileName: suggested });
      if (!r) return false;
      req.dir = r.dir;
      req.name = /\.[^.]+$/.test(r.name) ? r.name : r.name + '.txt';   // like Notepad, default to .txt
    }
    for (;;) {
      try {
        const res = await post('/api/save', req);
        Object.assign(t, { path: res.path, name: res.name, version: res.version, saved: t.ta.value, savedEnc: t.encoding, savedEol: t.eol, readOnly: false });
        lastDir = parentOf(res.path);
        renderTabs(); onChange(t);
        toast('Saved ' + res.name);
        return true;
      } catch (e) {
        const d = e.data || {};
        if (e.status === 409 && d.conflict) {
          const c = await Files.dialog({ title: 'File changed on disk', message: `${t.name} was changed by another program since you opened it. Overwrite those changes with yours?`,
            buttons: [{ text: 'Overwrite', value: 'force', primary: true, danger: true }, { text: 'Reload from disk', value: 'reload' }, { text: 'Cancel', value: 'cancel' }] });
          if (c?.button === 'force') { req.force = true; continue; }
          if (c?.button === 'reload') reload(t);
          return false;
        }
        if (e.status === 409 && d.exists) {
          if (await Files.confirmBox('Confirm Save As', `${req.name} already exists. Do you want to replace it?`, 'Replace', true)) { req.overwrite = true; continue; }
          return false;
        }
        if (e.status === 422 && d.lossy) {
          const c = await Files.dialog({ title: 'Encoding', message: 'This file contains characters that ANSI can\'t store. Save as UTF-8 instead (recommended), or save as ANSI and lose them?',
            buttons: [{ text: 'Save as UTF-8', value: 'utf8', primary: true }, { text: 'Save as ANSI', value: 'lossy', danger: true }, { text: 'Cancel', value: 'cancel' }] });
          if (c?.button === 'utf8') { t.encoding = req.encoding = 'utf-8'; continue; }
          if (c?.button === 'lossy') { req.lossy = true; continue; }
          return false;
        }
        if (e.status === 404 && req.path) return save(t, true);
        handleError(e);
        return false;
      }
    }
  }
  async function saveAll() {
    for (const t of tabs.filter(isDirty)) { activate(t); if (!await save(t)) return; }
  }
  // Client-side copy in the chosen encoding (used when the drive is read-only).
  function downloadCopy(t = active) {
    let text = t.ta.value.replace(/\r\n?/g, '\n');
    if (t.eol === 'crlf') text = text.replace(/\n/g, '\r\n'); else if (t.eol === 'cr') text = text.replace(/\n/g, '\r');
    let parts;
    if (t.encoding === 'utf-16le' || t.encoding === 'utf-16be') {
      const le = t.encoding === 'utf-16le';
      const buf = new Uint8Array(2 + text.length * 2);
      buf[0] = le ? 0xFF : 0xFE; buf[1] = le ? 0xFE : 0xFF;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        buf[2 + i * 2 + (le ? 0 : 1)] = c & 0xFF;
        buf[2 + i * 2 + (le ? 1 : 0)] = c >> 8;
      }
      parts = [buf];
    } else {
      parts = [t.encoding === 'utf-8-bom' ? '﻿' + text : text];   // ANSI copies are downloaded as UTF-8
    }
    const url = URL.createObjectURL(new Blob(parts, { type: 'text/plain' }));
    const a = h('a', { href: url, download: /\.[^.]+$/.test(t.name) ? t.name : t.name + '.txt' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------------- editing helpers ---------------- */
  function insertText(ta, s) {
    ta.focus();
    // execCommand keeps the browser's undo stack intact; setRangeText is the fallback.
    if (!document.execCommand('insertText', false, s)) {
      ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }
  function scrollToCaret(ta) {
    if (!mirror) { mirror = h('div', { class: 'np-mirror', 'aria-hidden': 'true' }); host.append(mirror); }
    const cs = getComputedStyle(ta);
    for (const p of ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'letterSpacing', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak']) mirror.style[p] = cs[p];
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, ta.selectionStart);
    const mark = h('span', { text: '​' });
    mirror.append(mark);
    const top = mark.offsetTop;
    const left = mark.offsetLeft;
    if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - 40) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
    if (!settings.wrap && (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - 40)) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
    mirror.textContent = '';
  }
  function selectRange(ta, a, b) {
    ta.focus();
    ta.setSelectionRange(a, b);
    scrollToCaret(ta);
    updateStatus();
  }
  function timeDate() {
    const d = new Date();
    insertText(active.ta, d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ' + d.toLocaleDateString());
  }
  async function goToLine() {
    const ta = active.ta;
    const total = ta.value.split('\n').length;
    const r = await Files.dialog({ title: 'Go to line', message: `Line number (1 – ${fmtNum(total)})`, input: { value: String(lineOf(ta.value, ta.selectionStart)) },
      buttons: [{ text: 'Cancel', value: 'no' }, { text: 'Go to', value: 'ok', primary: true }] });
    if (!r || r.button !== 'ok') return;
    const n = parseInt(r.value, 10);
    if (!(n >= 1 && n <= total)) { toast('The line number is beyond the total number of lines'); return; }
    let pos = 0;
    for (let i = 1; i < n; i++) pos = ta.value.indexOf('\n', pos) + 1;
    selectRange(ta, pos, pos);
  }
  function lineOf(v, p) {
    let ln = 1;
    for (let i = v.indexOf('\n'); i !== -1 && i < p; i = v.indexOf('\n', i + 1)) ln++;
    return ln;
  }

  /* ---------------- find & replace ---------------- */
  function openFind(withReplace) {
    findBar.hidden = false;
    replRow.hidden = !withReplace;
    const s = active.ta.value.slice(active.ta.selectionStart, active.ta.selectionEnd);
    if (s && !s.includes('\n')) findInp.value = s;
    findInp.focus(); findInp.select();
    updateCount();
  }
  function closeFind() { findBar.hidden = true; active?.ta.focus(); }
  function norm(s) { return settings.matchCase ? s : s.toLowerCase(); }
  function find(dir = 1) {
    const q = findInp.value;
    if (!q) return false;
    const ta = active.ta;
    const hay = norm(ta.value);
    const needle = norm(q);
    let i;
    if (dir > 0) { i = hay.indexOf(needle, ta.selectionEnd); if (i < 0) i = hay.indexOf(needle); }
    else { i = ta.selectionStart > 0 ? hay.lastIndexOf(needle, ta.selectionStart - 1) : -1; if (i < 0) i = hay.lastIndexOf(needle); }
    if (i < 0) { findCount.textContent = 'No results'; findCount.classList.add('none'); return false; }
    selectRange(ta, i, i + q.length);
    updateCount();
    return true;
  }
  function updateCount() {
    const q = findInp.value;
    findCount.classList.remove('none');
    if (!q) { findCount.textContent = ''; return; }
    const hay = norm(active.ta.value);
    const needle = norm(q);
    let n = 0; let cur = 0;
    for (let i = hay.indexOf(needle); i !== -1 && n < 99999; i = hay.indexOf(needle, i + needle.length)) {
      n++;
      if (i === active.ta.selectionStart) cur = n;
    }
    findCount.textContent = n ? (cur ? `${cur} of ${n}` : `${n} found`) : 'No results';
    findCount.classList.toggle('none', !n);
  }
  function replaceOne() {
    const ta = active.ta;
    const q = findInp.value;
    if (!q) return;
    if (norm(ta.value.slice(ta.selectionStart, ta.selectionEnd)) === norm(q)) insertText(ta, replInp.value);
    find(1);
  }
  function replaceAll() {
    const ta = active.ta;
    const q = findInp.value;
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), settings.matchCase ? 'g' : 'gi');
    const count = (ta.value.match(re) || []).length;
    if (!count) { toast('No matches'); return; }
    const next = ta.value.replace(re, () => replInp.value);
    const top = ta.scrollTop;
    ta.focus(); ta.select();
    insertText(ta, next);                       // one undo step
    ta.setSelectionRange(0, 0); ta.scrollTop = top;
    updateCount();
    toast(`Replaced ${fmtNum(count)} occurrence${count === 1 ? '' : 's'}`);
  }

  /* ---------------- view settings ---------------- */
  function applyLook(ta) {
    ta.wrap = settings.wrap ? 'soft' : 'off';
    ta.classList.toggle('nowrap', !settings.wrap);
    ta.style.fontFamily = FONTS[settings.font].css;
    ta.style.fontSize = (14.5 * settings.zoom / 100).toFixed(2) + 'px';
  }
  function applySettings() {
    tabs.forEach((t) => applyLook(t.ta));
    statusBar.hidden = !settings.status;
    caseBtn.classList.toggle('on', settings.matchCase);
    caseBtn.setAttribute('aria-pressed', String(settings.matchCase));
    store.set(SETTINGS_KEY, JSON.stringify(settings));
    updateStatus();
  }
  function zoom(delta) {
    settings.zoom = delta === 0 ? 100 : Math.max(10, Math.min(500, settings.zoom + delta));
    applySettings();
  }
  let raf = 0;
  function updateStatus() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const t = active;
      if (!t) return;
      const v = t.ta.value;
      const p = t.ta.selectionStart;
      const lineStart = v.lastIndexOf('\n', p - 1) + 1;
      posEl.textContent = `Ln ${fmtNum(lineOf(v, p))}, Col ${fmtNum(p - lineStart + 1)}`;
      const selLen = Math.abs(t.ta.selectionEnd - p);
      charsEl.textContent = selLen ? `${fmtNum(selLen)} of ${fmtNum(v.length)} characters` : `${fmtNum(v.length)} characters`;
      zoomEl.textContent = settings.zoom + '%';
      eolBtn.textContent = EOL[t.eol];
      encBtn.textContent = ENC[t.encoding];
    });
  }

  /* ---------------- menus ---------------- */
  function menuFor(btn, entries) {
    const r = btn.getBoundingClientRect();
    Files.openMenu(r.left, r.bottom + 2, entries);
  }
  const ro = () => !!state.info?.readOnly;
  function fileMenu(btn) {
    menuFor(btn, [
      { label: 'New tab', icon: 'plus', shortcut: 'Ctrl+Alt+N', onclick: newTab },
      { label: 'Open…', icon: 'folder', shortcut: 'Ctrl+O', onclick: openDialog },
      '-',
      { label: 'Save', icon: 'save', shortcut: 'Ctrl+S', disabled: ro(), onclick: () => save() },
      { label: 'Save as…', shortcut: 'Ctrl+Shift+S', disabled: ro(), onclick: () => save(active, true) },
      { label: 'Save all', disabled: ro() || !tabs.some(isDirty), onclick: saveAll },
      { label: 'Download a copy', icon: 'download', onclick: () => downloadCopy() },
      '-',
      active.path && { label: 'Reload from disk', icon: 'refresh', onclick: async () => {
        if (!isDirty(active) || await Files.confirmBox('Reload from disk?', 'Your unsaved changes in this tab will be lost.', 'Reload', true)) reload();
      } },
      active.path && { label: revealLabel(), icon: 'reveal', onclick: () => revealItem({ path: active.path }) },
      active.path && { label: 'Open containing folder in dashboard', icon: 'folder', onclick: () => { location.hash = '#/' + encPath(parentOf(active.path)); } },
      '-',
      { label: 'Close tab', icon: 'x', shortcut: 'Ctrl+Alt+W', onclick: () => closeTab() },
    ]);
  }
  function editMenu(btn) {
    const ta = active.ta;
    const hasSel = ta.selectionEnd > ta.selectionStart;
    const exec = (cmd) => () => { ta.focus(); document.execCommand(cmd); };
    menuFor(btn, [
      { label: 'Undo', shortcut: 'Ctrl+Z', onclick: exec('undo') },
      { label: 'Redo', shortcut: 'Ctrl+Y', onclick: exec('redo') },
      '-',
      { label: 'Cut', shortcut: 'Ctrl+X', disabled: !hasSel, onclick: exec('cut') },
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', disabled: !hasSel, onclick: exec('copy') },
      { label: 'Paste', shortcut: 'Ctrl+V', onclick: async () => {
        try { insertText(ta, await navigator.clipboard.readText()); } catch (_) { toast('Press Ctrl+V to paste (the browser blocked menu paste)'); ta.focus(); }
      } },
      { label: 'Delete', shortcut: 'Del', disabled: !hasSel, onclick: () => insertText(ta, '') },
      '-',
      { label: 'Find…', icon: 'search', shortcut: 'Ctrl+F', onclick: () => openFind(false) },
      { label: 'Find next', shortcut: 'F3', onclick: () => (findInp.value ? find(1) : openFind(false)) },
      { label: 'Find previous', shortcut: 'Shift+F3', onclick: () => (findInp.value ? find(-1) : openFind(false)) },
      { label: 'Replace…', shortcut: 'Ctrl+H', onclick: () => openFind(true) },
      { label: 'Go to…', shortcut: 'Ctrl+G', onclick: goToLine },
      '-',
      { label: 'Select all', shortcut: 'Ctrl+A', onclick: () => { ta.focus(); ta.select(); updateStatus(); } },
      { label: 'Time/Date', shortcut: 'F5', onclick: timeDate },
    ]);
  }
  function viewMenu(btn) {
    menuFor(btn, [
      { label: 'Zoom in', shortcut: 'Ctrl+Plus', onclick: () => zoom(10) },
      { label: 'Zoom out', shortcut: 'Ctrl+Minus', onclick: () => zoom(-10) },
      { label: 'Restore default zoom', shortcut: 'Ctrl+0', onclick: () => zoom(0) },
      '-',
      { label: 'Status bar', checked: settings.status, onclick: () => { settings.status = !settings.status; applySettings(); } },
      { label: 'Word wrap', checked: settings.wrap, onclick: () => { settings.wrap = !settings.wrap; applySettings(); } },
      '-',
      ...Object.entries(FONTS).map(([k, f]) => ({ label: f.label, checked: settings.font === k, onclick: () => { settings.font = k; applySettings(); } })),
    ]);
  }
  function eolMenu(btn) {
    const r = btn.getBoundingClientRect();
    Files.openMenu(r.left, r.top - 4 - 3 * 34, Object.entries(EOL).map(([k, label]) => ({ label, checked: active.eol === k,
      onclick: () => { active.eol = k; onChange(active); } })));
  }
  function encMenu(btn) {
    const r = btn.getBoundingClientRect();
    Files.openMenu(r.left, r.top - 4 - 5 * 34, Object.entries(ENC).map(([k, label]) => ({ label, checked: active.encoding === k,
      onclick: () => { active.encoding = k; onChange(active); } })));
  }

  /* ---------------- session restore (like Windows 11 Notepad) ---------------- */
  let persistTimer = 0;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const data = {
        active: tabs.indexOf(active),
        lastDir,
        tabs: tabs.map((t) => {
          const dirty = isDirty(t);
          return { path: t.path, name: t.name, encoding: t.encoding, eol: t.eol, version: t.version,
            text: dirty && t.ta.value.length < 2e6 ? t.ta.value : null, dirty };
        }).filter((t) => t.path || t.text),
      };
      try { localStorage.setItem(sessionKey(), JSON.stringify(data)); } catch (_) { /* quota / private mode */ }
    }, 700);
  }
  async function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(sessionKey()) || 'null'); } catch (_) {}
    if (!data?.tabs?.length) return;
    lastDir = data.lastDir || '';
    for (const s of data.tabs) {
      let t = null;
      if (s.path) {
        try {
          const r = await api('/api/read?path=' + encodeURIComponent(s.path));
          t = makeTab({ path: r.path, name: r.name, text: r.text, encoding: r.encoding, eol: r.eol, version: r.version, readOnly: r.readOnly });
          if (s.text !== null && s.text !== undefined) {
            // unsaved edits from last time; keep the version we started from so a save still detects outside changes
            t.ta.value = s.text; t.encoding = s.encoding; t.eol = s.eol; t.version = s.version;
          }
        } catch (e) {
          if (e instanceof AuthError || e instanceof TypeError) return;
          if (s.text) { t = makeTab({ name: s.name, text: s.text, encoding: s.encoding, eol: s.eol }); t.saved = ''; }
        }
      } else if (s.text) {
        t = makeTab({ name: s.name, text: s.text, encoding: s.encoding, eol: s.eol });
        t.saved = '';
      }
    }
    const blank = tabs.find((t) => !t.path && t.ta.value === '' && !isDirty(t));
    if (blank && tabs.length > 1) removeTab(blank);
    activate(tabs[Math.max(0, Math.min(data.active, tabs.length - 1))] || tabs[0]);
    updateBadge();
  }

  /* ---------------- public ---------------- */
  function show() {
    visible = true;
    root.hidden = false;
    $('view').hidden = true;
    document.body.classList.add('np-open');
    Files.setListing([], null);
    renderCrumbs('', 'Notepad');
    if (!tabs.length) newTab(); else activate(active || tabs[0]);
  }
  function hide() {
    if (!visible) return;
    visible = false;
    root.hidden = true;
    $('view').hidden = false;
    document.body.classList.remove('np-open');
    document.title = (state.info?.label || 'Drive') + ' · Dashboard';
  }
  function pathChanged(oldPath, newPath) {
    for (const t of tabs) {
      if (t.path === oldPath || (t.path && t.path.startsWith(oldPath + '/'))) {
        t.path = newPath + t.path.slice(oldPath.length);
        t.name = t.path.split('/').pop();
      }
    }
    renderTabs(); persist();
  }
  function onKey(e) {
    if (!visible || document.querySelector('.dlg-back')) return false;
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const done = (fn) => { e.preventDefault(); e.stopPropagation(); fn(); return true; };
    if (mod && e.altKey && k === 'n') return done(newTab);
    if (mod && e.altKey && k === 'w') return done(() => closeTab());
    if (mod && !e.altKey) {
      if (k === 's') return done(() => save(active, e.shiftKey));
      if (k === 'o') return done(openDialog);
      if (k === 'f') return done(() => openFind(false));
      if (k === 'h') return done(() => openFind(true));
      if (k === 'g') return done(goToLine);
      if (k === '=' || k === '+') return done(() => zoom(10));
      if (k === '-') return done(() => zoom(-10));
      if (k === '0') return done(() => zoom(0));
    }
    if (e.key === 'F3') return done(() => (findInp.value ? find(e.shiftKey ? -1 : 1) : openFind(false)));
    if (e.key === 'F5') return done(timeDate);
    if (e.key === 'Escape' && !findBar.hidden) return done(closeFind);
    return false;
  }

  function init() {
    try { Object.assign(settings, JSON.parse(store.get(SETTINGS_KEY, '{}'))); } catch (_) {}
    if (!FONTS[settings.font]) settings.font = 'mono';
    root = $('notepad');
    tabBar = h('div', { class: 'np-tabs', role: 'tablist' });
    const menuBtn = (label, fn) => { const b = h('button', { class: 'np-menu-btn', 'aria-haspopup': 'menu' }, label); b.onclick = () => fn(b); return b; };
    const menubar = h('div', { class: 'np-menubar' },
      menuBtn('File', fileMenu), menuBtn('Edit', editMenu), menuBtn('View', viewMenu),
      h('span', { class: 'grow' }),
      h('button', { class: 'np-icon-btn', title: 'Save (Ctrl+S)', 'aria-label': 'Save', onclick: () => save() }, icon('save')),
      h('button', { class: 'np-icon-btn', title: 'Find (Ctrl+F)', 'aria-label': 'Find', onclick: () => openFind(false) }, icon('search')));

    findInp = h('input', { class: 'np-input', type: 'text', placeholder: 'Find', spellcheck: 'false', 'aria-label': 'Find' });
    replInp = h('input', { class: 'np-input', type: 'text', placeholder: 'Replace', spellcheck: 'false', 'aria-label': 'Replace with' });
    findCount = h('span', { class: 'np-count' });
    caseBtn = h('button', { class: 'np-icon-btn np-case', title: 'Match case', 'aria-label': 'Match case', 'aria-pressed': 'false',
      onclick: () => { settings.matchCase = !settings.matchCase; applySettings(); updateCount(); } }, 'Aa');
    const toggleRepl = h('button', { class: 'np-icon-btn', title: 'Toggle replace', 'aria-label': 'Toggle replace',
      onclick: () => { replRow.hidden = !replRow.hidden; if (!replRow.hidden) replInp.focus(); } }, icon('chev'));
    replRow = h('div', { class: 'np-find-row np-repl' }, h('span', { class: 'np-find-spacer' }), replInp,
      h('button', { class: 'btn', onclick: replaceOne }, 'Replace'),
      h('button', { class: 'btn', onclick: replaceAll }, 'Replace all'));
    replRow.hidden = true;
    findBar = h('div', { class: 'np-find' },
      h('div', { class: 'np-find-row' }, toggleRepl, findInp, findCount,
        h('button', { class: 'np-icon-btn', title: 'Previous (Shift+F3)', 'aria-label': 'Previous match', onclick: () => find(-1) }, icon('up')),
        h('button', { class: 'np-icon-btn', title: 'Next (F3)', 'aria-label': 'Next match', onclick: () => find(1) }, icon('down')),
        caseBtn,
        h('button', { class: 'np-icon-btn', title: 'Close (Esc)', 'aria-label': 'Close find', onclick: closeFind }, icon('x'))),
      replRow);
    findBar.hidden = true;
    findInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Tab' && !e.shiftKey && !replRow.hidden) { e.preventDefault(); replInp.focus(); replInp.select(); }
    });
    findInp.addEventListener('input', updateCount);
    replInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });

    host = h('div', { class: 'np-editor' });
    posEl = h('span');
    charsEl = h('span');
    zoomEl = h('span');
    eolBtn = h('button', { class: 'np-status-btn', title: 'Line endings used when saving' });
    encBtn = h('button', { class: 'np-status-btn', title: 'Encoding used when saving' });
    eolBtn.onclick = () => eolMenu(eolBtn);
    encBtn.onclick = () => encMenu(encBtn);
    statusBar = h('div', { class: 'np-status' }, posEl, h('i'), charsEl, h('span', { class: 'grow' }), zoomEl, h('i'), eolBtn, h('i'), encBtn);

    root.replaceChildren(tabBar, menubar, findBar, host, statusBar);
    applySettings();
    window.addEventListener('beforeunload', (e) => {
      if (tabs.some(isDirty)) { persist(); e.preventDefault(); e.returnValue = ''; }
    });
  }

  return { init, restore, show, hide, openFile, canEdit, onKey, badge, pathChanged };
})();
