// MZM oldalszerkesztő – Elementor/Shopify-szerű, kattintással szerkeszthető nézet.
// A szerkesztett oldal egy iframe-ben fut (?mzm-edit=1), a módosításokat egy content.json írja le,
// amit az oldal betöltéskor ráhelyez az eredeti HTML-re (lásd docs/js/content.js).
(async () => {
  'use strict';
  const core = await import('../../js/content-core.js');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ================= segédek ================= */
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let toastTimer = 0;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'ed-toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isErr ? 5000 : 2200);
  }

  /* ================= API ================= */
  const BASE = (window.MZM_CONFIG || {}).apiBase;
  const hasBackend = typeof BASE === 'string';
  const CROSS = hasBackend && BASE !== '';
  const apiRoot = hasBackend ? BASE.replace(/\/$/, '') : '';
  const TOKEN_KEY = 'mzm_admin_token';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; } };
  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (CROSS && token()) headers.Authorization = 'Bearer ' + token();
    return fetch(apiRoot + path, { credentials: CROSS ? 'omit' : 'same-origin', ...opts, headers });
  }

  /* ================= állapot ================= */
  const blank = () => ({ v: 1, els: {}, sections: {}, settings: {} });
  let content = blank();
  let savedJson = JSON.stringify(core.normalizeContent(content));
  let device = 'd';
  let sel = null; // kijelölt elem az iframe-ben
  let frameReady = false;
  let canSave = false;

  const frame = $('#frame');
  let fwin, fdoc;
  const mc = () => fwin.MZMContent;

  /* ----- előzmények (visszavonás / újra) ----- */
  const snap = () => JSON.stringify(content);
  let hist = [snap()];
  let hi = 0;
  let lastCo = '';
  let lastT = 0;
  function commit(co) {
    const s = snap();
    if (s === hist[hi]) return;
    if (co && co === lastCo && Date.now() - lastT < 700) hist[hi] = s;
    else {
      hist.splice(hi + 1);
      hist.push(s);
      if (hist.length > 120) hist.shift();
      hi = hist.length - 1;
    }
    lastCo = co || '';
    lastT = Date.now();
    refreshState();
  }
  function restore(i) {
    hi = i;
    content = JSON.parse(hist[hi]);
    lastCo = '';
    afterChange();
  }
  const undo = () => hi > 0 && restore(hi - 1);
  const redo = () => hi < hist.length - 1 && restore(hi + 1);

  function dirty() {
    return JSON.stringify(core.normalizeContent(content)) !== savedJson;
  }
  function refreshState(text) {
    $('#undoBtn').disabled = hi <= 0;
    $('#redoBtn').disabled = hi >= hist.length - 1;
    const st = $('#saveState');
    const d = dirty();
    st.className = 'ed-state' + (d ? ' dirty' : '');
    st.textContent = text || (d ? 'Nem közzétett módosítások' : 'Nincs módosítás');
    $('#saveBtn').disabled = !d || !canSave;
  }

  function afterChange() {
    applyAll();
    renderElementPanel();
    renderSections();
    renderPage();
    refreshState();
  }
  function applyAll(skip) {
    if (!frameReady) return;
    mc().apply(content, { ghost: true, skip });
    placeOverlays();
  }

  /* ----- tartalom módosítók ----- */
  function ensure(key) { return (content.els[key] ||= {}); }
  function tidy(key) {
    const e = content.els[key];
    if (!e) return;
    if (e.css) {
      for (const d of Object.keys(e.css)) if (!Object.keys(e.css[d]).length) delete e.css[d];
      if (!Object.keys(e.css).length) delete e.css;
    }
    if (!Object.keys(e).length) delete content.els[key];
  }
  const getCss = (key, prop, dev = device) => content.els[key]?.css?.[dev]?.[prop];
  function setCss(key, prop, val, co) {
    const e = ensure(key);
    e.css ||= {};
    e.css[device] ||= {};
    if (val == null || val === '') delete e.css[device][prop];
    else e.css[device][prop] = val;
    tidy(key);
    commit(co || `css:${key}:${prop}:${device}`);
    applyAll();
  }
  function setField(key, field, val, co) {
    const e = ensure(key);
    if (val == null || val === '') delete e[field];
    else e[field] = val;
    tidy(key);
    commit(co || `f:${key}:${field}`);
    applyAll();
  }
  function setSetting(name, val, co) {
    content.settings ||= {};
    if (val == null || val === '') delete content.settings[name];
    else content.settings[name] = val;
    commit(co || 'set:' + name);
    applyAll();
  }

  /* ================= iframe: kijelölés, szerkesztés ================= */
  const TYPE = {
    text: 'text', img: 'img', bg: 'bg', ba: 'ba', section: 'section', box: 'box',
  };
  const INLINE = /^(EM|B|STRONG|I|BR)$/;
  function isTextLeaf(el) {
    return el.textContent.trim() !== '' && [...el.children].every((c) => INLINE.test(c.tagName));
  }
  function typeOf(el) {
    if (el.tagName === 'IMG') return TYPE.img;
    if (el.hasAttribute('data-bg')) return TYPE.bg;
    if (el.classList.contains('ba')) return TYPE.ba;
    if (el.hasAttribute('data-s')) return TYPE.section;
    if (isTextLeaf(el)) return TYPE.text;
    return TYPE.box;
  }
  const SEC_NAMES = {
    hero: 'Nyitó rész', miert: 'Miért az MZM', 'elotte-utana': 'Előtte–utána', szolgaltatasok: 'Szolgáltatások',
    folyamat: 'Folyamat', velemenyek: 'Vélemények', gyik: 'GYIK', zaro: 'Záró felhívás',
  };
  const CLS = {
    card: 'Kártya', service: 'Szolgáltatás', step: 'Lépés', review: 'Vélemény', 'track-card': 'Projektkártya',
    'final-card': 'Záró kártya', ba: 'Előtte–utána', kicker: 'Címke', lead: 'Bevezető', sub: 'Alszöveg', muted: 'Halvány szöveg',
  };
  const TAG = {
    H1: 'Főcím', H2: 'Cím', H3: 'Alcím', P: 'Bekezdés', BLOCKQUOTE: 'Idézet', DT: 'Szám', DD: 'Felirat', SMALL: 'Kis szöveg',
    B: 'Kiemelt szöveg', SPAN: 'Szöveg', A: 'Gomb', LI: 'Lista elem', BUTTON: 'Fül', IMG: 'Kép', SUMMARY: 'Kérdés',
    DETAILS: 'GYIK elem', FIGURE: 'Vélemény', ARTICLE: 'Kártya', ASIDE: 'Kártya', DIV: 'Doboz', FOOTER: 'Lábléc', HEADER: 'Fejléc',
  };
  function labelOf(el) {
    if (el.hasAttribute('data-s')) return SEC_NAMES[el.getAttribute('data-s')] || 'Szekció';
    if (el.getAttribute('data-e') === 'sec.footer') return 'Lábléc';
    if (el.hasAttribute('data-bg')) return 'Háttérkép';
    for (const c of el.classList) if (CLS[c]) return CLS[c];
    if (el.tagName === 'A' && el.classList.contains('btn')) return 'Gomb';
    return TAG[el.tagName] || el.tagName.toLowerCase();
  }
  const keyOf = (el) => el.getAttribute('data-e');
  const closestE = (n) => (n && n.closest ? n.closest('[data-e]') : null);

  let ui, ovHover, ovSel, chipSel, handle;
  let hoverEl = null;
  let editing = null;
  let rafId = 0;
  let last = '';

  function mountFrame() {
    fwin = frame.contentWindow;
    fdoc = frame.contentDocument;
    const link = fdoc.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('frame.css', location.href).href;
    fdoc.head.append(link);

    ui = fdoc.createElement('div');
    ui.className = 'mzm-ui';
    ovHover = fdoc.createElement('div');
    ovHover.className = 'mzm-ov mzm-hover';
    ovSel = fdoc.createElement('div');
    ovSel.className = 'mzm-ov mzm-sel';
    chipSel = fdoc.createElement('span');
    chipSel.className = 'mzm-chip';
    handle = fdoc.createElement('span');
    handle.className = 'mzm-handle';
    ovSel.append(chipSel, handle);
    ui.append(ovHover, ovSel);
    fdoc.body.append(ui);

    fdoc.addEventListener('mouseover', (e) => {
      if (editing) return;
      hoverEl = closestE(e.target);
    }, true);
    fdoc.addEventListener('mouseleave', () => (hoverEl = null));
    fdoc.addEventListener('click', onFrameClick, true);
    fdoc.addEventListener('dblclick', (e) => {
      const el = closestE(e.target);
      if (el && typeOf(el) === TYPE.text) { e.preventDefault(); select(el); startEdit(el); }
    }, true);
    fdoc.addEventListener('keydown', onFrameKey, true);
    fdoc.addEventListener('submit', (e) => e.preventDefault(), true);
    fdoc.addEventListener('dragstart', (e) => e.preventDefault(), true);
    handle.addEventListener('pointerdown', startResize);
    cancelAnimationFrame(rafId);
    const loop = () => { placeOverlays(); rafId = requestAnimationFrame(loop); };
    rafId = requestAnimationFrame(loop);
  }

  function onFrameClick(e) {
    if (!e.isTrusted) return; // a programozott kattintások (pl. fülváltás) menjenek át
    // a szövegszerkesztés közbeni kattintás maradjon a szövegben
    if (editing && editing.contains(e.target)) return;
    const el = closestE(e.target);
    if (!el) { select(null); return; }
    e.preventDefault();
    e.stopPropagation();
    if (editing) endEdit();
    // a kijelölt szövegre újra kattintva elindul a szerkesztés
    if (sel === el && typeOf(el) === TYPE.text) { startEdit(el); return; }
    select(el);
  }
  function onFrameKey(e) { handleKeys(e, true); }
  function handleKeys(e, inFrame) {
    const mod = e.ctrlKey || e.metaKey;
    if (editing && inFrame) {
      if (e.key === 'Escape') { e.preventDefault(); endEdit(); }
      else if (e.key === 'Enter') { e.preventDefault(); fdoc.execCommand('insertLineBreak'); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); endEdit(); save(); }
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape' && sel && inFrame) select(null);
  }
  addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !(e.ctrlKey || e.metaKey)) return;
    handleKeys(e, false);
  });

  function select(el) {
    if (editing && editing !== el) endEdit();
    sel = el;
    renderElementPanel();
    if (el) switchTab('element');
    placeOverlays();
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return r.width || r.height ? r : null;
  }
  function place(ov, el) {
    const r = el && el.isConnected ? rectOf(el) : null;
    if (!r) { ov.classList.remove('on'); return ''; }
    ov.classList.add('on');
    ov.style.left = r.left + 'px';
    ov.style.top = r.top + 'px';
    ov.style.width = r.width + 'px';
    ov.style.height = r.height + 'px';
    return `${r.left | 0},${r.top | 0},${r.width | 0},${r.height | 0}`;
  }
  function placeOverlays() {
    if (!frameReady || !ui) return;
    const h1 = hoverEl && hoverEl !== sel && !editing ? place(ovHover, hoverEl) : (ovHover.classList.remove('on'), '');
    const h2 = place(ovSel, sel);
    if (sel) {
      chipSel.textContent = labelOf(sel);
      const r = ovSel.getBoundingClientRect();
      chipSel.classList.toggle('below', r.top < 28);
      const t = typeOf(sel);
      handle.classList.toggle('on', t === TYPE.img || t === TYPE.ba);
      handle.classList.toggle('v', t === TYPE.ba);
    }
    last = h1 + '|' + h2;
  }

  /* ----- szövegszerkesztés közvetlenül az oldalon ----- */
  function startEdit(el) {
    if (editing === el) return;
    endEdit();
    editing = el;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const r = fdoc.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = fwin.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    el.addEventListener('input', onTextInput);
    el.addEventListener('paste', onPaste);
    el.addEventListener('blur', onBlurEdit);
    renderElementPanel();
  }
  function endEdit() {
    if (!editing) return;
    const el = editing;
    editing = null;
    saveText(el, true);
    el.removeAttribute('contenteditable');
    el.removeEventListener('input', onTextInput);
    el.removeEventListener('paste', onPaste);
    el.removeEventListener('blur', onBlurEdit);
    applyAll();
    renderElementPanel();
  }
  const onBlurEdit = () => setTimeout(() => { if (editing && fdoc.activeElement !== editing) endEdit(); }, 120);
  function onPaste(e) {
    e.preventDefault();
    const text = (e.clipboardData || fwin.clipboardData).getData('text/plain');
    fdoc.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
  }
  function onTextInput() { if (editing) saveText(editing, false); }
  function saveText(el, final) {
    const key = keyOf(el);
    const html = core.sanitizeHtml(el.innerHTML);
    const orig = core.sanitizeHtml(mc().original(el).html);
    const e = ensure(key);
    if (html === orig) delete e.html;
    else e.html = html;
    tidy(key);
    commit(final ? '' : 'text:' + key);
    refreshState();
  }
  /** B / sárga kiemelés a kijelölt szövegrészre */
  function fmt(kind) {
    if (!editing) return;
    editing.focus();
    if (kind === 'b') fdoc.execCommand('bold');
    else if (kind === 'br') fdoc.execCommand('insertLineBreak');
    else if (kind === 'em') {
      const s = fwin.getSelection();
      if (!s.rangeCount || s.isCollapsed) return toast('Jelölj ki egy szövegrészt a kiemeléshez');
      const range = s.getRangeAt(0);
      const anc = range.commonAncestorContainer;
      const inEm = (anc.nodeType === 1 ? anc : anc.parentElement)?.closest('em');
      if (inEm && editing.contains(inEm)) {
        const parent = inEm.parentNode;
        while (inEm.firstChild) parent.insertBefore(inEm.firstChild, inEm);
        inEm.remove();
      } else {
        const em = fdoc.createElement('em');
        try { range.surroundContents(em); } catch (_) { return toast('Ezt a részt nem lehet egyben kiemelni', true); }
      }
    }
    onTextInput();
  }

  /* ----- képek átméretezése húzással ----- */
  function startResize(e) {
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    const el = sel;
    const key = keyOf(el);
    const t = typeOf(el);
    const startX = e.clientX, startY = e.clientY;
    const r0 = el.getBoundingClientRect();
    const parentW = (el.parentElement?.getBoundingClientRect().width || r0.width) || 1;
    fdoc.documentElement.classList.add('mzm-dragging');
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (t === TYPE.ba) {
        const hgt = clamp(Math.round(r0.height + (ev.clientY - startY)), 160, 1400);
        const c = ensure(key);
        c.css ||= {}; c.css[device] ||= {};
        c.css[device]['aspect-ratio'] = 'auto';
        c.css[device].height = hgt + 'px';
      } else {
        const w = clamp(Math.round(((r0.width + (ev.clientX - startX)) / parentW) * 1000) / 10, 5, 100);
        const c = ensure(key);
        c.css ||= {}; c.css[device] ||= {};
        c.css[device].width = w + '%';
        if (!c.css[device].height) c.css[device].height = 'auto';
      }
      applyAll();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      fdoc.documentElement.classList.remove('mzm-dragging');
      tidy(key);
      commit('resize:' + key + Date.now());
      renderElementPanel();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  /* ================= vezérlők (panel) ================= */
  const computed = (prop) => (sel ? fwin.getComputedStyle(sel)[prop] : '');
  const num = (v) => parseFloat(v) || 0;

  function resetBtn(show, fn) {
    return h('button', { class: 'reset', type: 'button', title: 'Visszaállítás az eredetire', hidden: !show, onclick: fn }, '↺ alap');
  }

  /** csúszka egy CSS-tulajdonsághoz (az aktuális eszközre) */
  function slider({ key, prop, label, min, max, step = 1, unit = 'px', initial, fmtVal, map }) {
    const cur = getCss(key, prop);
    const has = cur !== undefined;
    const startVal = has ? num(cur) : initial !== undefined ? initial : num(computed(prop));
    const valEl = h('span', { class: 'val' }, (fmtVal || ((v) => v + unit))(Math.round(startVal * 100) / 100));
    const input = h('input', { class: 'ed-range', type: 'range', min, max, step, value: clamp(startVal, min, max) });
    const row = h('div', { class: 'ed-row' },
      h('div', { class: 'ed-lab' }, h('span', {}, label), valEl, resetBtn(has, () => { setCss(key, prop, null); if (map?.after) map.after(); renderElementPanel(); })),
      input);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valEl.textContent = (fmtVal || ((x) => x + unit))(v);
      setCss(key, prop, v + unit);
      if (map?.after) map.after(v);
    });
    return row;
  }
  function chips({ key, prop, label, options, current }) {
    const cur = getCss(key, prop);
    const active = cur ?? current ?? computed(prop);
    const row = h('div', { class: 'ed-row' },
      h('div', { class: 'ed-lab' }, h('span', {}, label), resetBtn(cur !== undefined, () => { setCss(key, prop, null); renderElementPanel(); })),
      h('div', { class: 'ed-chips' }, options.map(([val, text]) =>
        h('button', { type: 'button', class: String(active) === val ? 'on' : '', onclick: () => { setCss(key, prop, val); renderElementPanel(); } }, text))));
    return row;
  }
  function colorRow({ key, prop, label, swatches }) {
    const cur = getCss(key, prop);
    const wrap = h('div', { class: 'ed-swatches' });
    for (const [c, title] of swatches) {
      const b = h('button', { type: 'button', class: 'ed-sw' + (cur === c ? ' on' : ''), title, onclick: () => { setCss(key, prop, c); renderElementPanel(); } });
      b.style.background = c === 'transparent' ? 'repeating-conic-gradient(#555 0 25%, #333 0 50%) 50% / 10px 10px' : c;
      wrap.append(b);
    }
    const picker = h('input', { class: 'ed-color', type: 'color', title: 'Egyéni szín', value: /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#ffffff' });
    picker.addEventListener('input', () => setCss(key, prop, picker.value, `col:${key}:${prop}`));
    picker.addEventListener('change', () => renderElementPanel());
    wrap.append(picker);
    return h('div', { class: 'ed-row' },
      h('div', { class: 'ed-lab' }, h('span', {}, label), resetBtn(cur !== undefined, () => { setCss(key, prop, null); renderElementPanel(); })),
      wrap);
  }
  function toggleRow({ label, on, onclick }) {
    return h('div', { class: 'ed-row' }, h('button', { type: 'button', class: 'ed-toggle' + (on ? ' on' : ''), onclick }, h('span', {}, label), h('span', { class: 'sw' })));
  }
  const hideToggle = (key, label = 'Elrejtés ezen az eszközön') =>
    toggleRow({ label, on: getCss(key, 'display') === 'none', onclick: () => { setCss(key, 'display', getCss(key, 'display') === 'none' ? null : 'none'); renderElementPanel(); } });

  const DEVICE_NAME = { d: 'asztali', t: 'tablet', m: 'mobil' };
  const deviceNote = () => h('div', { class: 'ed-note' }, `A beállítások csak a(z) ${DEVICE_NAME[device]} nézetre érvényesek. A többi eszköz az eredeti, reszponzív megjelenést kapja – váltani fent lehet.`);

  const TEXT_COLORS = () => [['#ffffff', 'Fehér'], ['#b3b6bc', 'Szürke'], [content.settings?.accent || '#ffcf00', 'Akcentszín'], ['#17181a', 'Sötét'], ['#000000', 'Fekete']];
  const BG_COLORS = () => [['transparent', 'Átlátszó'], ['#17181a', 'Sötétszürke'], ['#1d1e21', 'Világosabb szürke'], ['#232427', 'Kártya szürke'], [content.settings?.accent || '#ffcf00', 'Akcentszín'], ['#ffffff', 'Fehér']];

  /* ----- fájlfeltöltés ----- */
  const fileInput = $('#fileInput');
  async function processImage(file, maxDim) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), hgt = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = hgt;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    // célméret ~1 MB alatt (a Cloudflare D1 sorméret-korlátja miatt); szükség esetén fokozatosan kisebb minőség/méret
    const LIMIT = 1_100_000;
    let blob = null;
    for (const [scale, q] of [[1, 0.86], [1, 0.72], [0.8, 0.72], [0.65, 0.7], [0.5, 0.65]]) {
      const c2 = document.createElement('canvas');
      c2.width = Math.max(1, Math.round(w * scale)); c2.height = Math.max(1, Math.round(hgt * scale));
      c2.getContext('2d').drawImage(cv, 0, 0, c2.width, c2.height);
      const tb = (type) => new Promise((res) => c2.toBlob(res, type, q));
      blob = await tb('image/webp');
      if (!blob || blob.type !== 'image/webp') blob = await tb(file.type === 'image/png' && scale === 1 && q > 0.8 ? 'image/png' : 'image/jpeg');
      if (blob.size <= LIMIT) break;
    }
    return blob;
  }
  /** Képválasztás + átméretezés + feltöltés; a kész 'uploads/…' útvonalat adja vissza */
  function pickAndUpload(maxDim = 2000) {
    return new Promise((resolve) => {
      if (!canSave) { toast('Képfeltöltéshez be kell állítani a szervert és be kell jelentkezni.', true); return resolve(null); }
      fileInput.value = '';
      fileInput.onchange = async () => {
        const f = fileInput.files[0];
        if (!f) return resolve(null);
        try {
          toast('Kép feltöltése…');
          const blob = await processImage(f, maxDim);
          const res = await api('/mzm-admin/api/upload', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.error || 'A feltöltés nem sikerült.');
          toast('Kép feltöltve ✓');
          resolve(j.src);
        } catch (err) {
          toast(err.message || 'A kép feldolgozása nem sikerült.', true);
          resolve(null);
        }
      };
      fileInput.click();
    });
  }
  const srcUrl = (src) => (src ? mc().resolveSrc(src) : '');

  /* ----- az „Elem” panel ----- */
  const panelEl = $('#panel-element');
  function breadcrumbs() {
    const chain = [];
    for (let n = sel; n; n = n.parentElement?.closest('[data-e]')) chain.unshift(n);
    return h('div', { class: 'ed-crumbs' }, chain.map((n) =>
      h('button', { type: 'button', class: n === sel ? 'cur' : '', onclick: () => n !== sel && select(n) }, labelOf(n))));
  }

  function renderElementPanel() {
    if (!frameReady) return;
    panelEl.replaceChildren();
    if (!sel || !sel.isConnected) {
      panelEl.append(h('div', { class: 'ed-empty' },
        h('b', {}, 'Kattints egy elemre'),
        'Válassz ki egy szöveget, képet vagy szekciót az oldalon a szerkesztéshez. Szöveget dupla kattintással lehet átírni.'));
      return;
    }
    const key = keyOf(sel);
    const t = typeOf(sel);
    panelEl.append(breadcrumbs());

    if (t === TYPE.text) {
      panelEl.append(h('div', { class: 'ed-h' }, 'Szöveg'));
      panelEl.append(h('div', { class: 'ed-row' },
        h('button', { class: 'ed-btn ghost block', type: 'button', onclick: () => startEdit(sel) }, editing ? 'Szerkesztés folyamatban…' : '✎ Szöveg átírása'),
      ));
      panelEl.append(h('div', { class: 'ed-row' },
        h('div', { class: 'ed-lab' }, h('span', {}, 'Formázás (szerkesztés közben)')),
        h('div', { class: 'ed-fmt' },
          h('button', { class: 'ed-btn ghost sm', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('b') }, 'Félkövér'),
          h('button', { class: 'ed-btn ghost sm', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('em') }, 'Kiemelés (akcentszín)'),
          h('button', { class: 'ed-btn ghost sm', type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => fmt('br') }, 'Sortörés'))));
      panelEl.append(deviceNote());
      panelEl.append(h('div', { class: 'ed-h' }, 'Betű'));
      panelEl.append(slider({ key, prop: 'font-size', label: 'Méret', min: 10, max: 120 }));
      panelEl.append(chips({ key, prop: 'font-weight', label: 'Vastagság', options: [['400', 'Normál'], ['500', 'Közepes'], ['600', 'Vastag'], ['700', 'Extra'], ['800', 'Fekete']] }));
      panelEl.append(chips({ key, prop: 'text-align', label: 'Igazítás', options: [['left', 'Balra'], ['center', 'Középre'], ['right', 'Jobbra']] }));
      panelEl.append(colorRow({ key, prop: 'color', label: 'Szín', swatches: TEXT_COLORS() }));
      panelEl.append(slider({ key, prop: 'line-height', label: 'Sormagasság', min: 1, max: 2.4, step: 0.05, unit: '', initial: 1.4, fmtVal: (v) => v.toFixed(2) }));
      panelEl.append(h('div', { class: 'ed-h' }, 'Térköz'));
      panelEl.append(slider({ key, prop: 'margin-top', label: 'Felül', min: -40, max: 160 }));
      panelEl.append(slider({ key, prop: 'margin-bottom', label: 'Alul', min: -40, max: 160 }));
      panelEl.append(h('div', { class: 'ed-h' }, 'Megjelenés'));
      panelEl.append(hideToggle(key));
    } else if (t === TYPE.img) {
      const isLogo = /logo/i.test(sel.getAttribute('src') || '');
      const e = content.els[key] || {};
      panelEl.append(h('div', { class: 'ed-h' }, 'Kép'));
      panelEl.append(h('img', { class: 'ed-thumb' + (isLogo ? ' logo' : ''), src: sel.currentSrc || sel.src, alt: '' }));
      panelEl.append(h('div', { class: 'ed-row' },
        h('button', { class: 'ed-btn block', type: 'button', onclick: async () => { const s = await pickAndUpload(isLogo ? 700 : 1800); if (s) { setField(key, 'src', s); renderElementPanel(); } } }, '⬆ Kép cseréje'),
        e.src ? h('button', { class: 'ed-btn ghost block sm', type: 'button', onclick: () => { setField(key, 'src', null); renderElementPanel(); } }, 'Eredeti kép visszaállítása') : null));
      panelEl.append(h('div', { class: 'ed-row' }, h('div', { class: 'ed-lab' }, h('span', {}, 'Alternatív szöveg (SEO, képolvasók)')),
        (() => { const i = h('input', { class: 'ed-input', type: 'text', maxlength: 200, value: e.alt ?? sel.getAttribute('alt') ?? '' }); i.addEventListener('input', () => setField(key, 'alt', i.value, 'alt:' + key)); return i; })()));
      panelEl.append(deviceNote());
      panelEl.append(h('div', { class: 'ed-h' }, 'Méret és illesztés'));
      panelEl.append(slider({ key, prop: 'width', label: 'Szélesség', min: 5, max: 100, unit: '%', initial: 100, map: { after: () => {} } }));
      panelEl.append(chips({ key, prop: 'object-fit', label: 'Illesztés', options: [['cover', 'Kitöltés'], ['contain', 'Befér'], ['fill', 'Nyújt']] }));
      panelEl.append(slider({ key, prop: 'height', label: 'Magasság (px)', min: 20, max: 900, initial: Math.round(sel.getBoundingClientRect().height) }));
      panelEl.append(slider({ key, prop: 'border-radius', label: 'Lekerekítés', min: 0, max: 80 }));
      panelEl.append(slider({ key, prop: 'opacity', label: 'Átlátszóság', min: 0.1, max: 1, step: 0.05, unit: '', initial: 1, fmtVal: (v) => Math.round(v * 100) + '%' }));
      panelEl.append(h('div', { class: 'ed-h' }, 'Térköz és megjelenés'));
      panelEl.append(slider({ key, prop: 'margin-top', label: 'Felül', min: -40, max: 160 }));
      panelEl.append(slider({ key, prop: 'margin-bottom', label: 'Alul', min: -40, max: 160 }));
      panelEl.append(hideToggle(key));
    } else if (t === TYPE.bg) {
      const e = content.els[key] || {};
      panelEl.append(h('div', { class: 'ed-h' }, 'Háttérkép'));
      panelEl.append(h('div', { class: 'ed-note' }, 'A nyitó rész háttérképe. Sötét, kontrasztos képet válassz, hogy a fehér szöveg olvasható maradjon.'));
      panelEl.append(h('div', { class: 'ed-row' },
        h('button', { class: 'ed-btn block', type: 'button', onclick: async () => { const s = await pickAndUpload(2400); if (s) { setField(key, 'src', s); renderElementPanel(); } } }, '⬆ Háttérkép cseréje'),
        e.src ? h('button', { class: 'ed-btn ghost block sm', type: 'button', onclick: () => { setField(key, 'src', null); renderElementPanel(); } }, 'Eredeti kép visszaállítása') : null));
      panelEl.append(h('div', { class: 'ed-h' }, 'Megjelenés'));
      panelEl.append(slider({ key, prop: 'opacity', label: 'Átlátszóság', min: 0, max: 1, step: 0.05, unit: '', initial: 1, fmtVal: (v) => Math.round(v * 100) + '%' }));
      panelEl.append(hideToggle(key));
    } else if (t === TYPE.ba) {
      renderBaPanel(key);
    } else {
      panelEl.append(h('div', { class: 'ed-h' }, labelOf(sel)));
      panelEl.append(deviceNote());
      if (t === TYPE.section) {
        panelEl.append(h('div', { class: 'ed-h' }, 'Szekció'));
        panelEl.append(slider({ key, prop: 'padding-top', label: 'Belső térköz felül', min: 0, max: 240 }));
        panelEl.append(slider({ key, prop: 'padding-bottom', label: 'Belső térköz alul', min: 0, max: 240 }));
        panelEl.append(colorRow({ key, prop: 'background-color', label: 'Háttérszín', swatches: BG_COLORS() }));
        const id = sel.getAttribute('data-s');
        panelEl.append(h('div', { class: 'ed-row' },
          h('div', { class: 'ed-lab' }, h('span', {}, 'Sorrend az oldalon')),
          h('div', { class: 'ed-fmt' },
            h('button', { class: 'ed-btn ghost sm', type: 'button', onclick: () => moveSection(id, -1) }, '▲ Feljebb'),
            h('button', { class: 'ed-btn ghost sm', type: 'button', onclick: () => moveSection(id, 1) }, '▼ Lejjebb'))));
      } else {
        panelEl.append(slider({ key, prop: 'margin-top', label: 'Külső térköz felül', min: -40, max: 160 }));
        panelEl.append(slider({ key, prop: 'margin-bottom', label: 'Külső térköz alul', min: -40, max: 160 }));
        panelEl.append(slider({ key, prop: 'padding-top', label: 'Belső térköz felül', min: 0, max: 120 }));
        panelEl.append(slider({ key, prop: 'padding-bottom', label: 'Belső térköz alul', min: 0, max: 120 }));
        panelEl.append(colorRow({ key, prop: 'background-color', label: 'Háttérszín', swatches: BG_COLORS() }));
        panelEl.append(slider({ key, prop: 'border-radius', label: 'Lekerekítés', min: 0, max: 60 }));
        panelEl.append(slider({ key, prop: 'max-width', label: 'Maximális szélesség', min: 200, max: 1400, initial: 1180 }));
      }
      panelEl.append(h('div', { class: 'ed-h' }, 'Megjelenés'));
      panelEl.append(hideToggle(key, t === TYPE.section ? 'Szekció elrejtése ezen az eszközön' : 'Elrejtés ezen az eszközön'));
    }
    panelEl.append(h('div', { class: 'ed-row' }, h('div', { class: 'ed-h' }, 'Elem'),
      content.els[key] ? h('button', { class: 'ed-btn danger sm block', type: 'button', onclick: () => resetElement(key) }, 'Az elem összes módosításának törlése') : h('div', { class: 'ed-note' }, 'Az elem az eredeti állapotban van.')));
  }

  function resetElement(key) {
    delete content.els[key];
    commit();
    applyAll();
    renderElementPanel();
  }

  /* ----- Előtte–utána panel ----- */
  let baPair = 0;
  function renderBaPanel(key) {
    const pairs = [['Családi ház', 'house'], ['Nappali', 'living'], ['Fürdőszoba', 'bath']];
    panelEl.append(h('div', { class: 'ed-h' }, 'Előtte–utána képpárok'));
    panelEl.append(h('div', { class: 'ed-note' }, 'Mindkét kép ugyanabból a kameraszögből készüljön, így a csúszka pontosan illeszkedik. Ajánlott méret: 1600×1000 px.'));
    panelEl.append(h('div', { class: 'ed-row' }, h('div', { class: 'ed-chips' }, pairs.map(([name], i) =>
      h('button', { type: 'button', class: i === baPair ? 'on' : '', onclick: () => { baPair = i; fdoc.querySelector(`.ba-tab[data-ba="${i}"]`)?.click(); renderElementPanel(); } }, name)))));
    const defaults = (kind) => `img/projects/${pairs[baPair][1]}-${kind}.jpg`;
    const card = (kind, title) => {
      const k = `ba${baPair}.${kind}`;
      const src = content.els[k]?.src;
      const url = src ? srcUrl(src) : new URL('../../' + defaults(kind), location.href).href;
      return h('div', {},
        h('div', { class: 'cap' }, title),
        h('img', { class: 'ed-thumb', src: url, alt: '' }),
        h('button', { class: 'ed-btn sm block', type: 'button', onclick: async () => {
          const s = await pickAndUpload(1800);
          if (!s) return;
          setField(k, 'src', s);
          fdoc.querySelector(`.ba-tab[data-ba="${baPair}"]`)?.click();
          renderElementPanel();
        } }, '⬆ Csere'),
        src ? h('button', { class: 'ed-btn ghost sm block', type: 'button', onclick: () => { setField(k, 'src', null); renderElementPanel(); } }, 'Eredeti') : null);
    };
    panelEl.append(h('div', { class: 'ed-pairs' }, card('render', 'Látványterv (bal)'), card('real', 'Megvalósult (jobb)')));
    panelEl.append(deviceNote());
    panelEl.append(h('div', { class: 'ed-h' }, 'Méret'));
    panelEl.append(chips({ key, prop: 'aspect-ratio', label: 'Képarány', current: '16 / 10', options: [['16 / 10', '16:10'], ['4 / 3', '4:3'], ['3 / 2', '3:2'], ['21 / 9', '21:9']] }));
    panelEl.append(slider({ key, prop: 'max-width', label: 'Maximális szélesség', min: 320, max: 1400, initial: 1180 }));
    panelEl.append(slider({ key, prop: 'border-radius', label: 'Lekerekítés', min: 0, max: 60, initial: 28 }));
    panelEl.append(h('div', { class: 'ed-h' }, 'Megjelenés'));
    panelEl.append(hideToggle(key));
  }

  /* ================= Szekciók fül ================= */
  const panelSec = $('#panel-sections');
  const defaultOrder = () => $$('main > [data-s]', fdoc).map((s) => s.getAttribute('data-s'));
  function currentOrder() {
    const base = frameReady ? mc() && (window.__defaultOrder ||= defaultOrder()) : [];
    const o = content.sections?.order;
    if (!o || !o.length) return base;
    return [...o, ...base.filter((x) => !o.includes(x))];
  }
  function moveSection(id, dir) {
    const order = currentOrder();
    const i = order.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    content.sections ||= {};
    content.sections.order = order;
    commit();
    applyAll();
    renderSections();
    const el = fdoc.querySelector(`[data-s="${id}"]`);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function renderSections() {
    if (!frameReady) return;
    panelSec.replaceChildren();
    panelSec.append(h('div', { class: 'ed-note' }, 'Szekciók sorrendje és láthatósága. A szemmel ki-be kapcsolhatod őket minden eszközön; a nyilakkal mozgathatók.'));
    const order = currentOrder();
    const list = h('div', { class: 'ed-list' });
    order.forEach((id, i) => {
      const key = `sec.${id}`;
      const hidden = ['d', 't', 'm'].every((d) => getCss(key, 'display', d) === 'none');
      list.append(h('div', { class: 'ed-sec' + (hidden ? ' hidden-sec' : '') },
        h('button', { class: 'nm', type: 'button', onclick: () => { const el = fdoc.querySelector(`[data-s="${id}"]`); if (el) { select(el); el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } } }, SEC_NAMES[id] || id),
        h('button', { class: 'ic', type: 'button', title: hidden ? 'Megjelenítés' : 'Elrejtés', onclick: () => toggleSection(key, hidden) }, hidden ? '🚫' : '👁'),
        h('button', { class: 'ic', type: 'button', title: 'Feljebb', disabled: i === 0, onclick: () => moveSection(id, -1) }, '▲'),
        h('button', { class: 'ic', type: 'button', title: 'Lejjebb', disabled: i === order.length - 1, onclick: () => moveSection(id, 1) }, '▼')));
    });
    panelSec.append(list);
  }
  function toggleSection(key, show) {
    const e = ensure(key);
    e.css ||= {};
    for (const d of ['d', 't', 'm']) {
      e.css[d] ||= {};
      if (show) delete e.css[d].display;
      else e.css[d].display = 'none';
    }
    tidy(key);
    commit();
    applyAll();
    renderSections();
    renderElementPanel();
  }

  /* ================= Oldal fül ================= */
  const panelPage = $('#panel-page');
  function textSetting(name, label, ph, help) {
    const i = h('input', { class: 'ed-input', type: 'text', placeholder: ph, value: content.settings?.[name] || '' });
    i.addEventListener('input', () => {
      const v = i.value.trim();
      const candidate = core.normalizeContent({ settings: { [name]: v } }).settings[name];
      i.setAttribute('aria-invalid', v && !candidate ? 'true' : 'false');
      if (!v || candidate) setSetting(name, v);
    });
    return h('div', { class: 'ed-row' }, h('div', { class: 'ed-lab' }, h('span', {}, label)), i, help ? h('div', { class: 'ed-note' }, help) : null);
  }
  function renderPage() {
    panelPage.replaceChildren();
    const accent = content.settings?.accent;
    const sw = h('div', { class: 'ed-swatches' });
    for (const [c, title] of [['#ffcf00', 'McLaren-sárga (alap)'], ['#ff8000', 'Papaya narancs'], ['#ff4d4d', 'Piros'], ['#3ddc84', 'Zöld'], ['#4da3ff', 'Kék'], ['#ffffff', 'Fehér']]) {
      const b = h('button', { type: 'button', class: 'ed-sw' + ((accent || '#ffcf00') === c ? ' on' : ''), title, onclick: () => { setSetting('accent', c === '#ffcf00' ? null : c); renderPage(); } });
      b.style.background = c;
      sw.append(b);
    }
    const picker = h('input', { class: 'ed-color', type: 'color', value: accent || '#ffcf00', title: 'Egyéni szín' });
    picker.addEventListener('input', () => setSetting('accent', picker.value, 'accent'));
    picker.addEventListener('change', renderPage);
    sw.append(picker);
    panelPage.append(
      h('div', { class: 'ed-h' }, 'Arculat'),
      h('div', { class: 'ed-row' }, h('div', { class: 'ed-lab' }, h('span', {}, 'Akcentszín (gombok, kiemelések)')), sw),
      h('div', { class: 'ed-h' }, 'Ajánlatkérés gombok'),
      textSetting('ctaUrl', 'Hová vigyenek a gombok?', 'https://… vagy tel:+36301234567 vagy mailto:info@…', 'Üresen hagyva a gombok az oldal tetejére ugranak. A „tel:” hívást, a „mailto:” e-mailt indít, a „#folyamat” egy szekcióhoz görget.'),
      h('div', { class: 'ed-h' }, 'Közösségi linkek (lábléc)'),
      textSetting('facebook', 'Facebook', 'https://facebook.com/…'),
      textSetting('instagram', 'Instagram', 'https://instagram.com/…'),
      h('div', { class: 'ed-h' }, 'Keresők és böngészőfül'),
      textSetting('title', 'Oldal címe', 'MZM Construction – …'),
      textSetting('description', 'Rövid leírás (Google találatban jelenik meg)', 'Családi házak építése és felújítása…'),
      h('div', { class: 'ed-h' }, 'Mentés és visszaállítás'),
      h('div', { class: 'ed-row' }, h('button', { class: 'ed-btn ghost block', type: 'button', onclick: exportJson }, '⬇ Letöltés (site.json)')),
      h('div', { class: 'ed-note' }, 'A letöltött fájlt a repóban a docs/content/site.json helyére teheted – ez szerver nélküli (pl. GitHub Pages) használatnál tartalék.'),
      h('div', { class: 'ed-row' }, h('button', { class: 'ed-btn danger block', type: 'button', onclick: resetAll }, 'Minden módosítás törlése (alaphelyzet)')));
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(core.normalizeContent(content), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'site.json' });
    document.body.append(a);
    a.click();
    a.remove();
  }
  function resetAll() {
    if (!confirm('Biztosan törlöd az összes módosítást? (A közzététel előtt még visszavonható.)')) return;
    content = blank();
    commit();
    afterChange();
    select(null);
  }

  /* ================= fülek, eszközök ================= */
  function switchTab(name) {
    for (const b of $$('.ed-tabs button')) {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    }
    for (const p of $$('.ed-panel')) p.hidden = p.id !== 'panel-' + name;
  }
  $$('.ed-tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  const FRAME_W = { d: 1280, t: 820, m: 390 };
  function fitFrame() {
    const stage = $('#stage');
    const box = $('#frameBox');
    const availW = stage.clientWidth - 32;
    const availH = stage.clientHeight - 32;
    const w = FRAME_W[device];
    const scale = Math.min(1, availW / w);
    frame.style.width = w + 'px';
    frame.style.height = Math.max(400, availH / scale) + 'px';
    frame.style.transform = `scale(${scale})`;
    box.style.width = w * scale + 'px';
    box.style.height = availH + 'px';
    placeOverlays();
  }
  $$('.ed-devices button').forEach((b) => b.addEventListener('click', () => {
    device = b.dataset.device;
    $$('.ed-devices button').forEach((x) => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    fitFrame();
    setTimeout(() => { renderElementPanel(); placeOverlays(); }, 60);
  }));
  addEventListener('resize', fitFrame);

  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#saveBtn').addEventListener('click', save);
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });

  /* ================= mentés ================= */
  async function save() {
    if (editing) endEdit();
    if (!canSave || !dirty()) return;
    const btn = $('#saveBtn');
    btn.disabled = true;
    $('#saveState').textContent = 'Mentés…';
    try {
      const res = await api('/mzm-admin/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(core.normalizeContent(content)) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('A munkamenet lejárt – jelentkezz be újra az admin felületen.');
      if (!res.ok) throw new Error(j.error || 'A mentés nem sikerült.');
      content = j.content && j.content.v ? j.content : content;
      savedJson = JSON.stringify(core.normalizeContent(content));
      const t = new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      refreshState('Közzétéve ' + t + ' ✓');
      $('#saveState').classList.add('ok');
      toast('Közzétéve – az oldal élesben frissült ✓');
    } catch (err) {
      toast(err.message || 'A mentés nem sikerült.', true);
      refreshState();
    }
  }

  /* ================= indulás ================= */
  function showGate(title, text, linkText, offline) {
    $('#gateTitle').textContent = title;
    $('#gateText').textContent = text;
    $('#gateLink').textContent = linkText;
    $('#gateOffline').hidden = !offline;
    $('#gate').hidden = false;
  }
  $('#gateOffline').addEventListener('click', () => { $('#gate').hidden = true; });

  async function loadContent() {
    const sources = [hasBackend ? apiRoot + '/api/content' : new URL('../../content/site.json', location.href).href];
    for (const u of sources) {
      try {
        const r = await fetch(u, { cache: 'no-cache', credentials: 'omit' });
        if (r.ok) { const j = await r.json(); if (j && j.v) return core.normalizeContent(j); }
      } catch (_) { /* következő */ }
    }
    return blank();
  }

  async function init() {
    if (!hasBackend) {
      showGate('A szerver még nincs beállítva', 'Mentéshez és képfeltöltéshez a statisztika-szervert is be kell állítani (lásd README). Addig is szerkesztheted az oldalt, és a módosításokat exportálhatod.', 'Vissza a vezérlőpultra', true);
    } else {
      try {
        const r = await api('/mzm-admin/api/me');
        const j = await r.json();
        canSave = !!j.authenticated;
      } catch (_) { canSave = false; }
      if (!canSave) showGate('Bejelentkezés szükséges', 'A szerkesztő használatához előbb jelentkezz be az admin felületen, majd nyisd meg újra.', 'Belépés', false);
    }
    content = await loadContent();
    savedJson = JSON.stringify(core.normalizeContent(content));
    hist = [snap()];
    hi = 0;
    refreshState();
    if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.MZMContent) onFrameLoad();
    else frame.addEventListener('load', onFrameLoad, { once: true });
  }

  async function onFrameLoad() {
    for (let i = 0; i < 60 && !(frame.contentWindow && frame.contentWindow.MZMContent); i++) await new Promise((r) => setTimeout(r, 100));
    if (!frame.contentWindow.MZMContent) return toast('Az oldal nem töltődött be.', true);
    mountFrame();
    frameReady = true;
    window.__defaultOrder = defaultOrder();
    applyAll();
    fitFrame();
    renderElementPanel();
    renderSections();
    renderPage();
    refreshState();
    // a képek betöltődése után az elrendezés megváltozhat
    setTimeout(fitFrame, 400);
  }

  window.__mzmEditor = { get content() { return content; }, select: (k) => { const el = fdoc.querySelector(`[data-e="${k}"]`); if (el) select(el); return !!el; }, setDevice: (d) => $(`.ed-devices [data-device="${d}"]`).click(), startEdit: () => sel && startEdit(sel), save, undo, redo, get sel() { return sel; } };
  init();
})();
