// Cloudflare Worker: ugyanaz az API, mint a Node szerveren (server.js), D1 adatbázissal.
//   POST /api/track              – látogatás / ajánlatkérés-kattintás mérése
//   POST /mzm-admin/api/login    – belépés (visszaad egy Bearer tokent)
//   GET  /mzm-admin/api/me, /stats, POST /logout
import { getStats, statsSpan } from '../../lib/analytics.js';
import { dayKey, eachDay } from '../../lib/dates.js';
import { isBot, deviceType, classifySource, clean } from '../../lib/classify.js';

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
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
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

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return empty(204, cors);
      if (url.pathname === '/healthz') return json({ ok: true }, 200, cors);
      if (url.pathname === '/api/track' && request.method === 'POST') return await handleTrack(request, env, cors);

      if (url.pathname.startsWith('/mzm-admin/api/')) {
        const route = url.pathname.slice('/mzm-admin/api'.length);
        if (request.headers.get('Origin') && request.headers.get('Origin') !== env.ALLOWED_ORIGIN) return json({ error: 'Tiltott kérés.' }, 403, cors);
        const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
        const session = m ? await readSession(env, m[1]) : null;
        if (route === '/login' && request.method === 'POST') return await handleLogin(request, env, cors);
        if (route === '/me' && request.method === 'GET') return json({ authenticated: !!session }, 200, cors);
        if (route === '/logout' && request.method === 'POST') return json({ ok: true }, 200, cors);
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
