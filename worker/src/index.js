// Cloudflare Worker: ugyanaz az API, mint a Node szerveren (server.js), D1 adatbázissal.
//   POST /api/track              – látogatás / ajánlatkérés-kattintás mérése
//   POST /mzm-admin/api/login    – belépés (visszaad egy Bearer tokent)
//   GET  /mzm-admin/api/me, /stats, POST /logout
//   GET  /api/content (nyilvános) · PUT /mzm-admin/api/content · POST /mzm-admin/api/upload · GET /uploads/<név>
import { getStats, statsSpan } from '../../lib/analytics.js';
import { dayKey, eachDay } from '../../lib/dates.js';
import { isBot, deviceType, classifySource, clean } from '../../lib/classify.js';
import { normalizeContent, tooLarge } from '../../docs/js/content-core.js';

const enc = new TextEncoder();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 5;

/* ---------- segédek ---------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function secretBytes(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET (min. 32 karakter) nincs beállítva');
  return enc.encode(env.SESSION_SECRET);
}

async function createSession(env, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ u: env.ADMIN_USERNAME, exp: now + SESSION_TTL_MS })));
  const sig = b64u(await hmac(secretBytes(env), payload));
  return `${payload}.${sig}`;
}

async function readSession(env, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64u(await hmac(secretBytes(env), payload));
  if (!(await safeEqual(sig, expected))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return data.exp > now && data.u === env.ADMIN_USERNAME ? data : null;
  } catch {
    return null;
  }
}

async function visitorHash(env, ip, ua, month) {
  const salt = await hmac(secretBytes(env), 'visitor:' + month);
  const h = await hmac(salt, `${ip}|${ua}`);
  return [...h.slice(0, 7)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- válaszok + CORS ---------- */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const json = (data, status, cors) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors },
  });
const empty = (status, cors) => new Response(null, { status, headers: cors });

/* ---------- végpontok ---------- */
async function handleTrack(request, env, cors) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return empty(403, cors);
  const ua = (request.headers.get('User-Agent') || '').slice(0, 300);
  const raw = await request.text();
  if (raw.length > 2048) return empty(413, cors);
  let data;
  try { data = JSON.parse(raw || '{}'); } catch { return empty(400, cors); }
  if (isBot(ua) || request.headers.get('DNT') === '1') return empty(204, cors);
  const kind = data.type === 'cta' ? 'cta' : data.type === 'pv' ? 'pv' : null;
  if (!kind) return empty(400, cors);

  const { source, campaign } = classifySource({ search: data.search, referrer: data.referrer }, ua);
  const now = Date.now();
  const day = dayKey(now);
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const v = await visitorHash(env, ip, ua, day.slice(0, 7));
  const cta = kind === 'cta' ? clean(data.cta || '', 24) || 'ismeretlen' : null;
  await env.DB.prepare('INSERT INTO events (t, d, v, k, s, dv, cm, c) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(now, day, v, kind, source, deviceType(ua, Number(data.width)), campaign || null, cta)
    .run();
  return empty(204, cors);
}

async function handleLogin(request, env, cors) {
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const now = Date.now();
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE ip = ? AND t > ?').bind(ip, now - LOGIN_WINDOW_MS).all();
  if (results[0].n >= LOGIN_MAX_FAILS) return json({ error: 'Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.' }, 429, cors);
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 1024) || '{}'); } catch { return json({ error: 'Hibás kérés.' }, 400, cors); }
  const userOk = await safeEqual(String(body.username ?? ''), env.ADMIN_USERNAME);
  const passOk = env.ADMIN_PASSWORD ? await safeEqual(String(body.password ?? ''), env.ADMIN_PASSWORD) : false;
  if (!(userOk && passOk)) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO login_fails (ip, t) VALUES (?, ?)').bind(ip, now),
      env.DB.prepare('DELETE FROM login_fails WHERE t < ?').bind(now - LOGIN_WINDOW_MS),
    ]);
    return json({ error: 'Hibás felhasználónév vagy jelszó.' }, 401, cors);
  }
  await env.DB.prepare('DELETE FROM login_fails WHERE ip = ?').bind(ip).run();
  return json({ ok: true, token: await createSession(env) }, 200, cors);
}

async function handleStats(request, env, cors, url) {
  const period = url.searchParams.get('period') === 'month' ? 'month' : 'week';
  const offset = Math.min(0, Math.max(-60, parseInt(url.searchParams.get('offset') || '0', 10) || 0));
  const now = Date.now();
  const { start, end } = statsSpan(period, offset, now);
  const { results } = await env.DB.prepare('SELECT t, d, v, k, s, dv, cm, c FROM events WHERE d >= ? AND d <= ?').bind(start, end).all();
  const byDay = new Map();
  for (const r of results) {
    const ev = { t: r.t, d: r.d, v: r.v, k: r.k, s: r.s, dv: r.dv };
    if (r.cm) ev.cm = r.cm;
    if (r.c) ev.c = r.c;
    if (!byDay.has(r.d)) byDay.set(r.d, []);
    byDay.get(r.d).push(ev);
  }
  return json(getStats(period, offset, now, (d) => byDay.get(d) || []), 200, cors);
}

/* ---------- szerkesztő: tartalom és képek ---------- */
const MAX_UPLOAD = 1_200_000; // a D1 sorméret-korlátja (2 MB) miatt, base64-ben tárolva
const MAGIC = [
  ['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', 'image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['gif', 'image/gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ['webp', 'image/webp', (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'],
  ['avif', 'image/avif', (b) => String.fromCharCode(...b.slice(4, 12)) === 'ftypavif'],
];
const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function handleGetContent(env, cors) {
  const row = await env.DB.prepare("SELECT v FROM kv WHERE k = 'content'").first();
  return json(row ? JSON.parse(row.v) : {}, 200, cors);
}

async function handlePutContent(request, env, cors) {
  const raw = await request.text();
  if (raw.length > 320 * 1024) return json({ error: 'Hibás vagy túl nagy kérés.' }, 413, cors);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Hibás kérés.' }, 400, cors); }
  const clean = normalizeContent(body);
  if (tooLarge(clean)) return json({ error: 'Hibás vagy túl nagy kérés.' }, 413, cors);
  const prev = await env.DB.prepare("SELECT v FROM kv WHERE k = 'content'").first();
  const stmts = [env.DB.prepare("INSERT INTO kv (k, v) VALUES ('content', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(clean))];
  if (prev) stmts.push(env.DB.prepare("INSERT INTO kv (k, v) VALUES ('content_prev', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(prev.v));
  await env.DB.batch(stmts);
  return json({ ok: true, content: clean }, 200, cors);
}

async function handleUpload(request, env, cors) {
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length || buf.length > MAX_UPLOAD) return json({ error: 'A kép túl nagy vagy hibás (max. kb. 1,2 MB – a szerkesztő automatikusan kicsinyít).' }, 413, cors);
  const kind = MAGIC.find(([, , test]) => test(buf));
  if (!kind) return json({ error: 'Csak JPG, PNG, WebP, GIF vagy AVIF kép tölthető fel.' }, 415, cors);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const name = [...hash.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('') + '.' + kind[0];
  await env.DB.prepare('INSERT OR IGNORE INTO media (name, mime, data) VALUES (?, ?, ?)').bind(name, kind[1], toB64(buf)).run();
  return json({ ok: true, src: `uploads/${name}` }, 200, cors);
}

async function handleMedia(name, env, cors) {
  if (!/^[a-f0-9]{24}\.(jpg|png|gif|webp|avif)$/.test(name)) return json({ error: 'Nem található.' }, 404, cors);
  const row = await env.DB.prepare('SELECT mime, data FROM media WHERE name = ?').bind(name).first();
  if (!row) return json({ error: 'Nem található.' }, 404, cors);
  return new Response(fromB64(row.data), {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return empty(204, cors);
      if (url.pathname === '/healthz') return json({ ok: true }, 200, cors);
      if (url.pathname === '/api/content' && request.method === 'GET') return await handleGetContent(env, cors);
      if (url.pathname.startsWith('/uploads/') && request.method === 'GET') return await handleMedia(url.pathname.slice('/uploads/'.length), env, cors);
      if (url.pathname === '/api/track' && request.method === 'POST') return await handleTrack(request, env, cors);

      if (url.pathname.startsWith('/mzm-admin/api/')) {
        const route = url.pathname.slice('/mzm-admin/api'.length);
        if (request.headers.get('Origin') && request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json({ error: 'Tiltott kérés.' }, 403, cors);
        const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
        const session = m ? await readSession(env, m[1]) : null;
        if (route === '/login' && request.method === 'POST') return await handleLogin(request, env, cors);
        if (route === '/me' && request.method === 'GET') return json({ authenticated: !!session }, 200, cors);
        if (route === '/logout' && request.method === 'POST') return json({ ok: true }, 200, cors);
        if (route === '/content' && request.method === 'PUT') {
          if (!session) return json({ error: 'Nincs bejelentkezve.' }, 401, cors);
          return await handlePutContent(request, env, cors);
        }
        if (route === '/upload' && request.method === 'POST') {
          if (!session) return json({ error: 'Nincs bejelentkezve.' }, 401, cors);
          return await handleUpload(request, env, cors);
        }
        if (route === '/stats' && request.method === 'GET') {
          if (!session) return json({ error: 'Nincs bejelentkezve.' }, 401, cors);
          return await handleStats(request, env, cors, url);
        }
      }
      return json({ error: 'Nem található.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'Szerverhiba.' }, 500, cors);
    }
  },
};
