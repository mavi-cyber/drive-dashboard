'use strict';
/* =====================================================================
   Files: create / rename / move / copy / delete (to Trash) / upload /
   download, plus selection, context menus, dialogs and the Trash view.
   Uses helpers from app.js (h, icon, api, post, toast, state, route...).
   ===================================================================== */
const Files = (() => {
  let listing = [];          // items shown in the current folder / search view
  let listingPath = null;    // folder those items live in ('' = drive root, null = search results)
  let lastClicked = null;    // anchor for shift-click range selection
  const sel = new Set();     // selected item paths

  const writable = () => !state.info?.readOnly;
  const isProtected = (p) => p === '' || p === 'Drive_Dashboard' || p.startsWith('Drive_Dashboard/');
  const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const selectedItems = () => listing.filter((i) => sel.has(i.path));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------------- dialogs ---------------- */
  // buttons: [{ text, value, primary, danger }]; resolves { button, value } or null (Esc / backdrop)
  function dialog({ title, message, input = null, buttons, body = null, wide = false, focusCancel = false }) {
    return new Promise((resolve) => {
      const inp = input ? h('input', { class: 'dlg-input', type: 'text', spellcheck: 'false', autocomplete: 'off' }) : null;
      if (inp) inp.value = input.value || '';
      const close = (btn) => {
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(btn === null ? null : { button: btn, value: inp ? inp.value : null });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && !focusCancel && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'TEXTAREA') {
          const def = buttons.find((b) => b.primary);
          if (def) { e.preventDefault(); e.stopPropagation(); close(def.value); }
        }
      };
      const back = h('div', { class: 'dlg-back', onmousedown: (e) => { if (e.target === back) close(null); } },
        h('div', { class: 'dlg' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h3', { text: title }),
          message && h('p', { class: 'dlg-msg', text: message }),
          inp, body,
          h('div', { class: 'dlg-btns' }, ...buttons.map((b) =>
            h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(b.value) }, b.text)))));
      document.body.append(back);
      document.addEventListener('keydown', onKey, true);
      if (inp) {
        inp.focus();
        if (input.select) inp.setSelectionRange(input.select[0], input.select[1]); else inp.select();
      } else (focusCancel ? back.querySelector('.btn:not(.primary)') : back.querySelector('.btn.primary') || back.querySelector('.btn'))?.focus();
    });
  }
  async function askName(title, value, okText, selectBase) {
    const dot = value.lastIndexOf('.');
    const select = selectBase && dot > 0 ? [0, dot] : null;
    const r = await dialog({ title, input: { value, select }, buttons: [{ text: 'Cancel', value: 'no' }, { text: okText, value: 'ok', primary: true }] });
    return r && r.button === 'ok' && r.value.trim() ? r.value.trim() : null;
  }
  // irreversible = true focuses Cancel, so a stray Enter can't destroy anything
  async function confirmBox(title, message, okText, danger, irreversible = false) {
    const r = await dialog({ title, message, focusCancel: irreversible, buttons: [{ text: 'Cancel', value: 'no' }, { text: okText, value: 'ok', primary: true, danger }] });
    return !!r && r.button === 'ok';
  }

  /* ---------------- browse dialog (folder picker / open / save as) ---------------- */
  // mode 'folder' -> resolves folder path; 'open' -> file path; 'save' -> { dir, name }
  function browse({ title, okText, start = '', mode = 'folder', fileName = '', filter = null }) {
    return new Promise((resolve) => {
      let cur = start;
      let chosen = null;
      const list = h('div', { class: 'pick-list' });
      const crumbs = h('div', { class: 'pick-crumbs' });
      const nameInp = mode === 'save' ? h('input', { class: 'dlg-input', type: 'text', spellcheck: 'false', 'aria-label': 'File name' }) : null;
      if (nameInp) nameInp.value = fileName;
      const okBtn = h('button', { class: 'btn primary' }, okText);
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const finish = () => {
        if (mode === 'folder') close(cur);
        else if (mode === 'open') { if (chosen) close(chosen); else toast('Pick a file first'); }
        else {
          const n = nameInp.value.trim();
          if (!n) { nameInp.focus(); return; }
          close({ dir: cur, name: n });
        }
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
        else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); finish(); }
      };
      okBtn.onclick = finish;

      async function load(p) {
        cur = p; chosen = null;
        const parts = p ? p.split('/') : [];
        crumbs.replaceChildren(
          h('button', { class: 'crumb', onclick: () => load('') }, logo(), state.info?.label || 'Drive'),
          ...parts.flatMap((part, i) => [h('span', { class: 'sep' }, icon('chev')),
            h('button', { class: 'crumb', onclick: () => load(parts.slice(0, i + 1).join('/')) }, part)]));
        list.replaceChildren(h('div', { class: 'note', text: 'Loading…' }));
        try {
          const r = await api('/api/list?path=' + encodeURIComponent(p));
          const cmp = (a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          const items = r.items.filter((i) => i.dir || (mode !== 'folder' && (!filter || filter(i)))).sort(cmp);
          list.replaceChildren(...(items.length ? items.map((i) => {
            const t = typeOf(i);
            const el = h('button', { class: 'pick-item', title: i.name }, h('span', { class: 'ftype ' + (i.dir ? 'card-icon folder' : t.cls) }, icon(t.icon)),
              h('span', { class: 'pick-name', text: i.name }), !i.dir && h('span', { class: 'pick-size', text: fmtSize(i.size) }));
            el.onclick = () => {
              if (i.dir) { load(i.path); return; }
              list.querySelectorAll('.pick-item.on').forEach((x) => x.classList.remove('on'));
              el.classList.add('on');
              chosen = i.path;
              if (nameInp) nameInp.value = i.name;
            };
            el.ondblclick = () => { if (!i.dir) { chosen = i.path; if (nameInp) nameInp.value = i.name; finish(); } };
            return el;
          }) : [h('div', { class: 'note', text: mode === 'folder' ? 'No subfolders here.' : 'Empty folder.' })]));
        } catch (e) { handleError(e); }
      }
      const newFolderBtn = writable() && mode !== 'open' && h('button', { class: 'btn', onclick: async () => {
        const name = await askName('New folder', 'New folder', 'Create');
        if (!name) return;
        try { await post('/api/mkdir', { path: cur, name }); load(cur ? cur + '/' + name : name); } catch (e) { handleError(e); }
      } }, icon('folder-plus'), 'New folder');

      const back = h('div', { class: 'dlg-back', onmousedown: (e) => { if (e.target === back) close(null); } },
        h('div', { class: 'dlg wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('h3', { text: title }), crumbs, list,
          nameInp && h('label', { class: 'pick-label' }, 'File name', nameInp),
          h('div', { class: 'dlg-btns' }, newFolderBtn, h('span', { class: 'grow' }),
            h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), okBtn)));
      document.body.append(back);
      document.addEventListener('keydown', onKey, true);
      load(start);
      (nameInp || okBtn).focus();
      if (nameInp) { const d = fileName.lastIndexOf('.'); nameInp.setSelectionRange(0, d > 0 ? d : fileName.length); }
    });
  }

  /* ---------------- context menu ---------------- */
  let menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  // entries: [{ label, icon, onclick, disabled, danger, shortcut, checked } | '-']
  function openMenu(x, y, entries) {
    closeMenu();
    const items = [];
    for (const e of entries) {
      if (!e) continue;
      if (e === '-') { if (items.length && items[items.length - 1] !== '-') items.push('-'); continue; }
      items.push(e);
    }
    while (items[items.length - 1] === '-') items.pop();
    menuEl = h('div', { class: 'menu', role: 'menu' }, ...items.map((e) => e === '-' ? h('div', { class: 'menu-sep' }) :
      h('button', { class: 'menu-item' + (e.danger ? ' danger' : ''), role: 'menuitem', disabled: !!e.disabled,
        onclick: (ev) => { ev.stopPropagation(); closeMenu(); e.onclick(); } },
        h('span', { class: 'menu-icon' }, e.checked ? icon('check') : e.icon ? icon(e.icon) : null),
        h('span', { class: 'menu-label', text: e.label }),
        e.shortcut && h('span', { class: 'menu-key', text: e.shortcut }))));
    document.body.append(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    menuEl.querySelector('.menu-item:not([disabled])')?.focus();
  }
  function menuAt(ev) {
    if (ev.type === 'contextmenu' || ev.clientX) return [ev.clientX, ev.clientY];
    const r = ev.currentTarget.getBoundingClientRect();
    return [r.left, r.bottom + 4];
  }

  function itemMenu(item, ev) {
    ev.preventDefault();
    if (!sel.has(item.path)) { sel.clear(); sel.add(item.path); syncSelection(); }
    const targets = selectedItems().length > 1 ? selectedItems() : [item];
    const one = targets.length === 1;
    const anyProtected = targets.some((t) => isProtected(t.path));
    const w = writable();
    const [x, y] = menuAt(ev);
    openMenu(x, y, [
      one && item.dir && { label: 'Open', icon: 'folder', onclick: () => { location.hash = '#/' + encPath(item.path); } },
      one && !item.dir && { label: typeOf(item).preview ? 'Preview' : 'Details', icon: 'eye', onclick: () => preview(item) },
      one && Notepad.canEdit(item) && { label: 'Edit in Notepad', icon: 'edit', onclick: () => Notepad.openFile(item.path) },
      one && { label: item.dir ? 'Open in file manager' : (RUNNABLE.has(extOf(item.name)) ? 'Run' : 'Open with default app'), icon: 'open', onclick: () => openItem(item) },
      one && !item.dir && { label: 'Download', icon: 'download', onclick: () => download(item) },
      one && { label: revealLabel(), icon: 'reveal', onclick: () => revealItem(item) },
      '-',
      one && { label: 'Rename', icon: 'edit', shortcut: 'F2', disabled: !w || anyProtected, onclick: () => rename(item) },
      one && item.dir && { label: 'Edit description…', icon: 'notepad', onclick: () => Catalog.edit(item) },
      { label: 'Copy to…', icon: 'copy', disabled: !w, onclick: () => transfer(targets, 'copy') },
      { label: 'Move to…', icon: 'move', disabled: !w || anyProtected, onclick: () => transfer(targets, 'move') },
      one && { label: 'Duplicate', icon: 'copy', disabled: !w, onclick: () => duplicate(item) },
      '-',
      { label: one ? 'Delete' : `Delete ${targets.length} items`, icon: 'trash', shortcut: 'Del', danger: true, disabled: !w || anyProtected, onclick: () => remove(targets) },
    ]);
  }
  function backgroundMenu(ev) {
    if (listingPath === null) return;
    ev.preventDefault();
    const w = writable();
    openMenu(ev.clientX, ev.clientY, [
      { label: 'New folder', icon: 'folder-plus', disabled: !w, onclick: () => newFolder(listingPath) },
      { label: 'New text file', icon: 'file-plus', disabled: !w, onclick: () => newFile(listingPath) },
      { label: 'Upload files…', icon: 'upload', disabled: !w, onclick: () => pickUpload(listingPath) },
      '-',
      { label: 'Select all', shortcut: 'Ctrl+A', onclick: selectAll },
      { label: 'Refresh', icon: 'refresh', onclick: () => route() },
    ]);
  }

  /* ---------------- selection ---------------- */
  function decorate(el, item) {
    el.dataset.path = item.path;
    el.classList.add('selectable');
    if (sel.has(item.path)) el.classList.add('selected');
    const box = h('span', { class: 'sel-box', role: 'checkbox', 'aria-label': 'Select ' + item.name, 'aria-checked': String(sel.has(item.path)), title: 'Select' }, icon('check'));
    box.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggle(item, e.shiftKey); });
    const iconHost = el.querySelector('.card-icon, .ftype');
    if (iconHost) iconHost.append(box); else el.prepend(box);
    // Ctrl/Cmd/Shift + click selects instead of opening
    el.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); toggle(item, e.shiftKey); }
    }, true);
    el.addEventListener('contextmenu', (e) => itemMenu(item, e));
    if (item.dir && el.classList.contains('card')) {
      el.querySelector('.card-top')?.append(h('button', { class: 'card-more', title: 'More actions', 'aria-label': 'More actions',
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); itemMenu(item, e); } }, icon('more')));
    }
    return el;
  }
  function toggle(item, range) {
    if (range && lastClicked) {
      const a = listing.findIndex((i) => i.path === lastClicked);
      const b = listing.findIndex((i) => i.path === item.path);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) sel.add(listing[i].path);
        syncSelection();
        return;
      }
    }
    if (sel.has(item.path)) sel.delete(item.path); else sel.add(item.path);
    lastClicked = item.path;
    syncSelection();
  }
  function selectAll() { listing.forEach((i) => sel.add(i.path)); syncSelection(); }
  function clearSelection() { sel.clear(); syncSelection(); }
  function syncSelection() {
    document.querySelectorAll('.selectable').forEach((el) => {
      const on = sel.has(el.dataset.path);
      el.classList.toggle('selected', on);
      el.querySelector('.sel-box')?.setAttribute('aria-checked', String(on));
    });
    document.body.classList.toggle('has-selection', sel.size > 0);
    const bar = $('selBar');
    if (!sel.size) { bar.hidden = true; return; }
    const items = selectedItems();
    const w = writable();
    const prot = items.some((i) => isProtected(i.path));
    bar.replaceChildren(...[
      h('span', { class: 'sel-count', text: `${items.length} selected` }),
      h('button', { class: 'btn', disabled: !w, onclick: () => transfer(items, 'copy') }, icon('copy'), 'Copy to…'),
      h('button', { class: 'btn', disabled: !w || prot, onclick: () => transfer(items, 'move') }, icon('move'), 'Move to…'),
      items.length === 1 && !items[0].dir && h('button', { class: 'btn', onclick: () => download(items[0]) }, icon('download'), 'Download'),
      h('button', { class: 'btn danger', disabled: !w || prot, onclick: () => remove(items) }, icon('trash'), 'Delete'),
      h('button', { class: 'icon-btn', title: 'Clear selection', 'aria-label': 'Clear selection', onclick: clearSelection }, icon('x')),
    ].filter(Boolean));   // replaceChildren would print a skipped `false` as text
    bar.hidden = false;
  }
  function setListing(items, path) {
    listing = items;
    listingPath = path;
    for (const p of [...sel]) if (!items.some((i) => i.path === p)) sel.delete(p);
    lastClicked = null;
    queueMicrotask(syncSelection);
  }

  /* ---------------- operations ---------------- */
  async function run(fn, okMsg) {
    // The drive can be slow (USB, or busy re-indexing), so acknowledge the action right away.
    const slow = setTimeout(() => toastBusy('Working…'), 250);
    try {
      const r = await fn();
      clearTimeout(slow);
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      sel.clear();
      await route();
      loadRoots().catch(() => {});
      pollIndex();
      return r;
    } catch (e) { clearTimeout(slow); handleError(e); return null; }
  }
  async function newFolder(path) {
    const name = await askName('New folder', 'New folder', 'Create');
    if (name) run(() => post('/api/mkdir', { path, name }), `Created “${name}”`);
  }
  async function newFile(path) {
    const name = await askName('New text file', 'New Text Document.txt', 'Create', true);
    if (!name) return;
    const r = await run(() => post('/api/newfile', { path, name }), `Created “${name}”`);
    if (r) Notepad.openFile(r.item.path);
  }
  async function rename(item) {
    if (isProtected(item.path)) { toast('The dashboard folder is protected'); return; }
    const name = await askName('Rename', item.name, 'Rename', !item.dir);
    if (!name || name === item.name) return;
    const r = await run(() => post('/api/rename', { path: item.path, name }), `Renamed to “${name}”`);
    if (r) Notepad.pathChanged(item.path, r.item.path);
  }
  async function duplicate(item) {
    run(() => post('/api/copy', { paths: [item.path], dest: parentOf(item.path) }), 'Duplicated');
  }
  async function transfer(items, mode) {
    const verb = mode === 'move' ? 'Move' : 'Copy';
    const dest = await browse({ title: `${verb} ${items.length === 1 ? '“' + items[0].name + '”' : items.length + ' items'} to…`,
      okText: `${verb} here`, start: listingPath ?? parentOf(items[0].path), mode: 'folder' });
    if (dest === null) return;
    const busy = toastBusy(`${mode === 'move' ? 'Moving' : 'Copying'}…`);
    const r = await run(() => post('/api/' + mode, { paths: items.map((i) => i.path), dest }),
      (res) => `${mode === 'move' ? 'Moved' : 'Copied'} ${plural(res.done.length, 'item')}` + (res.skipped.length ? ` · skipped: ${res.skipped.join(', ')}` : ''));
    busy();
    // done[] lines up with items only when nothing was skipped
    if (r && mode === 'move' && r.done.length === items.length) items.forEach((it, i) => Notepad.pathChanged(it.path, r.done[i]));
  }
  async function remove(items) {
    items = items.filter((i) => !isProtected(i.path));
    if (!items.length) return;
    const what = items.length === 1 ? `“${items[0].name}”` : plural(items.length, 'item');
    if (!await confirmBox(`Delete ${what}?`, 'It will be moved to the Trash on this drive. You can restore it from Trash until you empty it.', 'Move to Trash', true)) return;
    run(() => post('/api/delete', { paths: items.map((i) => i.path) }), (r) => `Moved ${plural(r.count, 'item')} to Trash`);
  }
  function download(item) {
    const a = h('a', { href: rawUrl(item.path) + '&download=1', download: item.name });
    document.body.append(a); a.click(); a.remove();
  }
  function toastBusy(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t);
    return () => {};
  }

  /* ---------------- upload ---------------- */
  function pickUpload(path) {
    const inp = h('input', { type: 'file', multiple: true, style: 'display:none' });
    inp.onchange = () => { upload([...inp.files], path); inp.remove(); };
    document.body.append(inp);
    inp.click();
  }
  function uploadOne(file, path, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader('X-Token', token);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let j = {};
        try { j = JSON.parse(xhr.responseText); } catch (_) {}
        if (xhr.status === 401) reject(new AuthError());
        else if (xhr.status >= 200 && xhr.status < 300) resolve(j);
        else reject(new Error(j.error || xhr.statusText));
      };
      xhr.onerror = () => reject(new TypeError('Network error'));
      xhr.send(file);
    });
  }
  async function upload(files, path) {
    if (!files.length) return;
    if (!writable()) { toast('This drive is read-only here'); return; }
    const panel = $('uploadPanel');
    const rows = files.map((f) => {
      const bar = h('span', { class: 'up-fill' });
      const row = h('div', { class: 'up-row' }, h('div', { class: 'up-name', text: f.name }),
        h('div', { class: 'up-bar' }, bar), h('div', { class: 'up-state', text: fmtSize(f.size) }));
      return { f, row, bar, state: row.lastChild };
    });
    panel.replaceChildren(h('div', { class: 'up-head', text: `Uploading ${plural(files.length, 'file')} to /${path}` }), ...rows.map((r) => r.row));
    panel.hidden = false;
    let ok = 0;
    for (const r of rows) {
      try {
        await uploadOne(r.f, path, (p) => { r.bar.style.width = (p * 100).toFixed(1) + '%'; r.state.textContent = Math.round(p * 100) + '%'; });
        r.bar.style.width = '100%'; r.state.textContent = 'Done'; r.row.classList.add('ok'); ok++;
      } catch (e) {
        if (e instanceof AuthError || e instanceof TypeError) { handleError(e); return; }
        r.state.textContent = 'Failed'; r.row.classList.add('fail'); r.row.title = e.message;
      }
    }
    toast(`Uploaded ${ok} of ${plural(files.length, 'file')}`);
    setTimeout(() => { panel.hidden = true; }, ok === files.length ? 1800 : 6000);
    sel.clear();
    route();
    pollIndex();
  }
  function initDragDrop() {
    const main = document.querySelector('.main');
    const over = $('dropOverlay');
    let depth = 0;
    const canDrop = (e) => listingPath !== null && writable() && [...(e.dataTransfer?.types || [])].includes('Files') && !state.special;
    main.addEventListener('dragenter', (e) => { if (!canDrop(e)) return; e.preventDefault(); depth++;
      over.querySelector('.drop-text').textContent = `Drop to upload to /${listingPath}`; over.hidden = false; });
    main.addEventListener('dragover', (e) => { if (canDrop(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    main.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; over.hidden = true; } });
    main.addEventListener('drop', (e) => {
      depth = 0; over.hidden = true;
      if (!canDrop(e)) return;
      e.preventDefault();
      const items = [...e.dataTransfer.items];
      if (items.some((it) => it.webkitGetAsEntry?.()?.isDirectory)) toast('Folders are skipped - drop files (or zip the folder first)');
      const files = items.filter((it) => it.kind === 'file' && !it.webkitGetAsEntry?.()?.isDirectory).map((it) => it.getAsFile()).filter(Boolean);
      upload(files, listingPath);
    });
  }

  /* ---------------- toolbar ---------------- */
  function toolbar(path) {
    if (!writable()) {
      return h('div', { class: 'toolbar' }, h('span', { class: 'ro-badge' }, icon('shield'), 'Read-only on this computer - browsing and downloading still work'));
    }
    return h('div', { class: 'toolbar' },
      h('button', { class: 'btn', onclick: () => newFolder(path) }, icon('folder-plus'), 'New folder'),
      h('button', { class: 'btn', onclick: () => newFile(path) }, icon('file-plus'), 'New text file'),
      h('button', { class: 'btn', onclick: () => pickUpload(path) }, icon('upload'), 'Upload'),
      h('span', { class: 'toolbar-hint', text: 'Tip: drag files here to upload · right-click for more' }));
  }

  /* ---------------- trash view ---------------- */
  async function renderTrash(my) {
    renderCrumbs('', 'Trash');
    setListing([], null);
    const r = await api('/api/trash');
    if (isStale(my)) return;
    const w = writable();
    const restore = (ids) => run(() => post('/api/restore', { ids }), (res) => `Restored ${plural(res.done.length, 'item')}`);
    const purge = async (ids, label) => {
      if (!await confirmBox(`Permanently delete ${label}?`, 'This cannot be undone.', 'Delete forever', true, true)) return;
      run(() => post('/api/purge', ids === 'all' ? { all: true } : { ids }), (res) => `Deleted ${plural(res.count, 'item')} forever`);
    };
    const head = h('div', { class: 'page-head', style: 'align-items:center' },
      h('div', { class: 'page-icon' }, icon('trash')),
      h('div', { style: 'min-width:0' }, h('h1', { text: 'Trash' }),
        h('p', { text: r.items.length ? `${plural(r.items.length, 'item')} · ${fmtSize(r.total)}. Deleted items stay on the drive (and use space) until you empty the Trash.`
          : 'Items you delete from the dashboard land here, so you can restore them.' })),
      r.items.length > 0 && w && h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: () => restore(r.items.map((i) => i.id)) }, icon('restore'), 'Restore all'),
        h('button', { class: 'btn danger', onclick: () => purge('all', 'everything in the Trash') }, icon('trash'), 'Empty Trash')));
    const rows = r.items.map((m) => {
      const t = typeOf({ name: m.name, dir: m.dir });
      return h('div', { class: 'row trash-row' },
        h('div', { class: 'name-cell' }, h('div', { class: 'ftype ' + (m.dir ? 'card-icon folder' : t.cls) }, icon(t.icon)),
          h('div', { class: 'name-text' }, h('div', { class: 'n', text: m.name }), h('div', { class: 'p', text: 'from /' + parentOf(m.from) }))),
        h('div', { class: 'cell-muted col-date', text: new Date(m.deleted).toLocaleString() }),
        h('div', { class: 'cell-muted col-size', text: fmtSize(m.size) }),
        h('div', { class: 'actions' },
          h('button', { title: 'Restore', 'aria-label': 'Restore', disabled: !w, onclick: () => restore([m.id]) }, icon('restore')),
          h('button', { title: 'Delete forever', 'aria-label': 'Delete forever', class: 'danger', disabled: !w, onclick: () => purge([m.id], `“${m.name}”`) }, icon('trash'))));
    });
    $('view').replaceChildren(head, rows.length
      ? h('div', { class: 'table' }, h('div', { class: 'row head trash-row' }, h('div', { text: 'Name' }), h('div', { class: 'col-date', text: 'Deleted' }), h('div', { class: 'col-size', text: 'Size' }), h('div')), ...rows)
      : h('div', { class: 'empty' }, icon('trash'), h('div', { text: 'Trash is empty.' })));
  }

  /* ---------------- keyboard ---------------- */
  function onKey(e) {
    if (e.key === 'Escape' && menuEl) { closeMenu(); return true; }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if (typing || !$('modal').hidden || document.querySelector('.dlg-back') || listingPath === null && !sel.size) return false;
    if (e.key === 'Escape' && sel.size) { clearSelection(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && listing.length) { e.preventDefault(); selectAll(); return true; }
    const items = selectedItems();
    if (!items.length || !writable()) return false;
    if (e.key === 'Delete') { e.preventDefault(); remove(items); return true; }
    if (e.key === 'F2' && items.length === 1) { e.preventDefault(); rename(items[0]); return true; }
    return false;
  }

  function init() {
    document.addEventListener('mousedown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
    window.addEventListener('blur', closeMenu);
    $('view').addEventListener('scroll', closeMenu, { passive: true });
    $('view').addEventListener('contextmenu', (e) => { if (!e.target.closest('.selectable, input, textarea, a, button')) backgroundMenu(e); });
    initDragDrop();
  }

  return { init, decorate, setListing, toolbar, itemMenu, openMenu, closeMenu, renderTrash, download, dialog, confirmBox, askName, browse, onKey };
})();
