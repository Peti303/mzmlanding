// A szerkesztőben mentett tartalom (szövegek, képek, méretek, sorrend, beállítások) ráhelyezése az oldalra.
import { normalizeContent, buildRules } from './content-core.js';

const cfg = window.MZM_CONFIG || {};
const apiBase = typeof cfg.apiBase === 'string' ? cfg.apiBase.replace(/\/$/, '') : null;
const root = document.documentElement;
const EDIT = root.classList.contains('is-edit');

/** 'uploads/x.webp' -> az API-t kiszolgáló szerver címe; 'img/..' marad relatív */
export function resolveSrc(src) {
  if (/^uploads\//.test(src)) return (apiBase !== null ? apiBase : '') + '/' + src;
  return src;
}

const orig = new WeakMap();
function original(el) {
  let o = orig.get(el);
  if (!o) {
    o = { html: el.innerHTML, src: el.getAttribute('src'), alt: el.getAttribute('alt'), count: el.getAttribute('data-count') };
    orig.set(el, o);
  }
  return o;
}

let sheet = null;
let fallbackStyle = null;
function setRules(rules) {
  const text = rules.join('\n');
  try {
    if (!sheet && 'adoptedStyleSheets' in document) {
      sheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    if (sheet) return void sheet.replaceSync(text);
  } catch (_) { /* tovább a tartalékra */ }
  if (!fallbackStyle) {
    fallbackStyle = document.createElement('style');
    document.head.append(fallbackStyle);
  }
  fallbackStyle.textContent = text;
}

let defaultOrder = null;
const baseTitle = document.title;
const metaDesc = document.querySelector('meta[name="description"]');
const baseDesc = metaDesc ? metaDesc.getAttribute('content') : '';

export function apply(raw, opts = {}) {
  const content = normalizeContent(raw);
  window.MZM_CONTENT = content;

  for (const el of document.querySelectorAll('[data-e]')) {
    if (opts.skip && opts.skip === el) continue;
    const key = el.getAttribute('data-e');
    const e = content.els[key] || {};
    const o = original(el);
    if (el.tagName === 'IMG') {
      const src = e.src ? resolveSrc(e.src) : o.src;
      if (src && el.getAttribute('src') !== src) el.setAttribute('src', src);
      if (e.alt !== undefined) el.setAttribute('alt', e.alt);
      else if (o.alt !== null) el.setAttribute('alt', o.alt);
    } else if (el.hasAttribute('data-bg')) {
      if (e.src) el.style.setProperty('--hero-image', `url("${resolveSrc(e.src)}")`);
      else el.style.removeProperty('--hero-image');
    } else if (e.html !== undefined) {
      o.touched = true; // csak a szövegesen módosított elemeket állítjuk vissza (a tárolók gyerekeit nem írjuk felül)
      if (el.innerHTML !== e.html) el.innerHTML = e.html;
      el.removeAttribute('data-count'); // a számláló ne írja felül a kézzel megadott értéket
    } else if (o.touched && !el.isContentEditable) {
      o.touched = false;
      el.innerHTML = o.html;
      if (o.count !== null) el.setAttribute('data-count', o.count);
    }
  }

  // szekciók sorrendje
  const main = document.querySelector('main');
  if (main) {
    const secs = [...main.querySelectorAll(':scope > [data-s]')];
    if (!defaultOrder) defaultOrder = secs.map((s) => s.getAttribute('data-s'));
    const order = content.sections.order && content.sections.order.length ? content.sections.order : defaultOrder;
    const rest = defaultOrder.filter((id) => !order.includes(id));
    for (const id of [...order, ...rest]) {
      const s = main.querySelector(`:scope > [data-s="${id}"]`);
      if (s) main.append(s);
    }
  }

  // oldalszintű beállítások
  const st = content.settings;
  document.title = st.title || baseTitle;
  if (metaDesc) metaDesc.setAttribute('content', st.description || baseDesc);
  for (const [label, url] of [['Facebook', st.facebook], ['Instagram', st.instagram]]) {
    const a = document.querySelector(`.social a[aria-label="${label}"]`);
    if (a) a.setAttribute('href', url || '#');
  }

  setRules(buildRules(content, { ghost: !!opts.ghost }));
  document.dispatchEvent(new CustomEvent('mzm:content', { detail: content }));
  return content;
}

async function loadPublished() {
  // szerverrel: onnan töltünk; szerver nélkül (pl. GitHub Pages): a repóba tett content/site.json
  const sources = [apiBase !== null ? apiBase + '/api/content' : 'content/site.json'];
  for (const url of sources) {
    try {
      const r = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.v) return j;
    } catch (_) { /* következő forrás */ }
  }
  return null;
}

window.MZMContent = { apply, resolveSrc, original };

if (!EDIT) {
  loadPublished()
    .then((c) => c && apply(c))
    .finally(() => root.classList.remove('content-pending'));
}
