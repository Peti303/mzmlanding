// A szerkesztő által mentett tartalom (content.json) közös, tiszta logikája.
// Ugyanezt használja a böngésző (az oldal és a szerkesztő), a Node szerver és a Cloudflare Worker is,
// ezért nincs benne semmilyen DOM- vagy Node-specifikus hívás.
//
// Séma:
// {
//   v: 1,
//   els: {                       // kulcs = a data-e attribútum az index.html-ben
//     "hero.h1": {
//       html: "Új <em>szöveg</em>",   // szöveges elem tartalma (csak em/b/strong/i/br engedett)
//       src: "uploads/abc.webp",      // képnél: új kép
//       alt: "Leírás",
//       css: { d: {...}, t: {...}, m: {...} }   // eszközönként: d = asztali, t = tablet, m = mobil
//     }
//   },
//   sections: { order: ["hero", "miert", ...] },
//   settings: { accent, ctaUrl, facebook, instagram, title, description }
// }

export const BREAKPOINTS = {
  // minden eszközhöz külön tartomány: a nem szerkesztett eszközök az eredeti, reszponzív megjelenést kapják
  d: '(min-width: 1000px)',
  t: '(min-width: 640px) and (max-width: 999px)',
  m: '(max-width: 639px)',
};

const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,3})\s*)?\)|transparent)$/;
const LEN = /^-?\d{1,4}(\.\d{1,2})?(px|%|rem|em)$/;

/** Engedélyezett CSS-tulajdonságok és az értékeik ellenőrzése. */
export const CSS_RULES = {
  'font-size': /^\d{1,3}(\.\d{1,2})?(px|rem)$/,
  'font-weight': /^(400|500|600|700|800)$/,
  'line-height': /^\d(\.\d{1,2})?$/,
  'letter-spacing': /^-?\d(\.\d{1,2})?(px|em)$/,
  color: COLOR,
  'text-align': /^(left|center|right)$/,
  'margin-top': LEN,
  'margin-bottom': LEN,
  'padding-top': /^\d{1,3}(\.\d{1,2})?px$/,
  'padding-bottom': /^\d{1,3}(\.\d{1,2})?px$/,
  width: /^(auto|\d{1,4}(\.\d{1,2})?(px|%))$/,
  'max-width': /^(none|\d{1,4}(\.\d{1,2})?(px|%))$/,
  height: /^(auto|\d{1,4}(\.\d{1,2})?(px|%))$/,
  'aspect-ratio': /^(auto|\d{1,2} \/ \d{1,2})$/,
  'border-radius': /^\d{1,3}(\.\d{1,2})?px$/,
  'object-fit': /^(cover|contain|fill)$/,
  'object-position': /^\d{1,3}% \d{1,3}%$/,
  opacity: /^(0|1|0?\.\d{1,2})$/,
  'background-color': COLOR,
  display: /^none$/,
};

const KEY = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const SRC = /^(uploads\/[A-Za-z0-9._-]{1,80}|img\/[A-Za-z0-9._\/-]{1,120})$/;
const URL_OK = /^(https?:\/\/|tel:|mailto:|#|\/)[^\s"'<>]{0,300}$/;
const SECTION = /^[a-z0-9-]{1,30}$/;
const MAX_KEYS = 900;
export const MAX_BYTES = 300 * 1024;

/**
 * Csak <em>, <b>, <strong>, <i> és <br> maradhat (attribútum nélkül), minden más szöveggé válik.
 * Az egész bemenetet előbb escape-eljük, utána engedjük vissza a fehérlistás címkéket.
 */
export function sanitizeHtml(input) {
  const s = String(input ?? '')
    .slice(0, 4000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return s
    .replace(/&lt;(\/?)(em|b|strong|i)&gt;/gi, (_, slash, tag) => `<${slash}${tag.toLowerCase()}>`)
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&amp;(nbsp|amp|lt|gt|quot);/g, '&$1;');
}

export function cleanCssBlock(block) {
  const out = {};
  if (!block || typeof block !== 'object') return out;
  for (const [prop, val] of Object.entries(block)) {
    const rule = CSS_RULES[prop];
    if (rule && typeof val === 'string' && rule.test(val.trim())) out[prop] = val.trim();
  }
  return out;
}

/** Ismeretlen vagy veszélyes elemek eldobása; mindig érvényes, normalizált tartalmat ad vissza. */
export function normalizeContent(raw) {
  const out = { v: 1, els: {}, sections: {}, settings: {} };
  if (!raw || typeof raw !== 'object') return out;

  const els = raw.els && typeof raw.els === 'object' ? raw.els : {};
  let n = 0;
  for (const [key, e] of Object.entries(els)) {
    if (!KEY.test(key) || !e || typeof e !== 'object' || ++n > MAX_KEYS) continue;
    const clean = {};
    if (typeof e.html === 'string') clean.html = sanitizeHtml(e.html);
    if (typeof e.src === 'string' && SRC.test(e.src)) clean.src = e.src;
    if (typeof e.alt === 'string') clean.alt = e.alt.slice(0, 200);
    if (e.css && typeof e.css === 'object') {
      const css = {};
      for (const dev of ['d', 't', 'm']) {
        const block = cleanCssBlock(e.css[dev]);
        if (Object.keys(block).length) css[dev] = block;
      }
      if (Object.keys(css).length) clean.css = css;
    }
    if (Object.keys(clean).length) out.els[key] = clean;
  }

  const s = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  if (Array.isArray(s.order)) {
    out.sections.order = [...new Set(s.order.filter((x) => typeof x === 'string' && SECTION.test(x)))].slice(0, 30);
  }

  const st = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  if (typeof st.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(st.accent)) out.settings.accent = st.accent.toLowerCase();
  for (const k of ['ctaUrl', 'facebook', 'instagram']) {
    if (typeof st[k] === 'string' && URL_OK.test(st[k].trim())) out.settings[k] = st[k].trim();
  }
  if (typeof st.title === 'string' && st.title.trim()) out.settings.title = st.title.trim().slice(0, 120);
  if (typeof st.description === 'string' && st.description.trim()) out.settings.description = st.description.trim().slice(0, 300);
  return out;
}

/** Szerver oldali védelem: ha túl nagy, elutasítjuk. */
export function tooLarge(obj) {
  return JSON.stringify(obj).length > MAX_BYTES;
}

/** Színárnyalat világosítása (a hover színhez): '#rrggbb' -> '#rrggbb' */
export function lighten(hex, amount = 0.22) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * amount);
  };
  return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
}

/** Olvashatósági szín a gombfelirathoz az akcentszínen (sötét vagy fehér). */
export function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#17181a' : '#ffffff';
}

/** A tartalomhoz tartozó CSS-szabályok (szöveg) – a böngésző CSSStyleSheet-be tölti. */
export function buildRules(content, { ghost = false } = {}) {
  const rules = [];
  const settings = content.settings || {};
  if (settings.accent) {
    rules.push(
      `:root{--yellow:${settings.accent} !important;--yellow-2:${lighten(settings.accent)} !important;--on-yellow:${readableOn(settings.accent)} !important}`,
    );
  }
  for (const [key, e] of Object.entries(content.els || {})) {
    if (!e.css) continue;
    for (const dev of ['d', 't', 'm']) {
      const block = e.css[dev];
      if (!block) continue;
      // szerkesztőben az elrejtett elem halványan látszik, hogy vissza lehessen kapcsolni
      const decl = Object.entries(block)
        .map(([p, v]) => (ghost && p === 'display' ? 'opacity:0.18 !important' : `${p}:${v} !important`))
        .join(';');
      rules.push(`@media ${BREAKPOINTS[dev]}{html body [data-e="${key}"]{${decl}}}`);
    }
  }
  return rules;
}
