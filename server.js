import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config, ROOT } from './lib/env.js';
import { addEvent, flush, eventsForDay } from './lib/store.js';
import { getStats } from './lib/analytics.js';
import { dayKey } from './lib/dates.js';
import { isBot, deviceType, classifySource, clean } from './lib/classify.js';
import {
  verifyLogin,
  createSession,
  readSession,
  visitorHash,
  RateLimiter,
} from './lib/auth.js';

const PUBLIC_DIR = path.join(ROOT, 'docs');
const ADMIN_PATH = '/mzm-admin';
const COOKIE = 'mzm_admin';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const trackLimiter = new RateLimiter(90, 60_000);
const loginLimiter = new RateLimiter(5, 15 * 60_000);
setInterval(() => {
  trackLimiter.sweep();
  loginLimiter.sweep();
}, 5 * 60_000).unref();

/* ---------------- segédek ---------------- */
function clientIp(req) {
  if (config.trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

const isHttps = (req) => config.trustProxy && req.headers['x-forwarded-proto'] === 'https';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const sameOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
};

/* ---------------- statikus fájlok ---------------- */
const gzCache = new Map();

function serveFile(req, res, baseDir, rel, extraHeaders = {}) {
  let filePath;
  try {
    filePath = path.join(baseDir, path.normalize(decodeURIComponent(rel)));
  } catch {
    return send(res, 400, 'Bad request');
  }
  if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir) return send(res, 403, 'Forbidden');

  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
  } catch {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const cache =
    ext === '.html'
      ? 'no-cache'
      : ext === '.woff2' || ext === '.jpg' || ext === '.webp' || ext === '.svg'
        ? 'public, max-age=2592000'
        : 'public, max-age=3600';
  const headers = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, ...extraHeaders };

  if (req.headers['if-none-match'] === etag) {
    send(res, 304, '', headers);
    return true;
  }

  let body = null;
  let encoding = null;
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    let hit = gzCache.get(filePath);
    if (!hit || hit.etag !== etag) {
      hit = { etag, buf: zlib.gzipSync(fs.readFileSync(filePath), { level: 9 }) };
      gzCache.set(filePath, hit);
    }
    body = hit.buf;
    encoding = 'gzip';
  }
  if (encoding) {
    headers['Content-Encoding'] = encoding;
    headers.Vary = 'Accept-Encoding';
  }
  if (req.method === 'HEAD') {
    send(res, 200, '', headers);
    return true;
  }
  if (body) {
    headers['Content-Length'] = body.length;
    send(res, 200, body, headers);
  } else {
    res.writeHead(200, { ...SECURITY_HEADERS, ...headers, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
  return true;
}

/* ---------------- látogatás-követés ---------------- */
async function handleTrack(req, res) {
  if (!sameOrigin(req)) return send(res, 403, '');
  const ip = clientIp(req);
  if (!trackLimiter.take(ip)) return send(res, 429, '');
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  let data;
  try {
    data = await readJson(req, 2048);
  } catch (e) {
    return send(res, e.status || 400, '');
  }
  // DNT esetén és botoknál nem számolunk – de a kliensnek mindig 204
  if (isBot(ua) || req.headers.dnt === '1') return send(res, 204, '');

  const kind = data.type === 'cta' ? 'cta' : data.type === 'pv' ? 'pv' : null;
  if (!kind) return send(res, 400, '');

  const { source, campaign } = classifySource(
    { search: data.search, referrer: data.referrer },
    ua,
  );
  const ev = {
    v: visitorHash(ip, ua, dayKey(Date.now()).slice(0, 7)),
    k: kind,
    s: source,
    dv: deviceType(ua, Number(data.width)),
  };
  if (campaign) ev.cm = campaign;
  if (kind === 'cta') ev.c = clean(data.cta || '', 24) || 'ismeretlen';
  addEvent(ev);
  return send(res, 204, '');
}

/* ---------------- admin ---------------- */
function getSession(req) {
  const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
  return readSession(m ? m[1] : parseCookies(req)[COOKIE]);
}

function cookieHeader(req, value, maxAgeSec) {
  return [
    `${COOKIE}=${value}`,
    `Path=${ADMIN_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
    isHttps(req) ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

async function handleAdminApi(req, res, route) {
  if (route === '/api/me' && req.method === 'GET') {
    return sendJson(res, 200, { authenticated: !!getSession(req) });
  }

  if (route === '/api/login' && req.method === 'POST') {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Tiltott kérés.' });
    const ip = clientIp(req);
    if (!loginLimiter.check(ip))
      return sendJson(res, 429, { error: 'Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.' });
    let body;
    try {
      body = await readJson(req, 1024);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: 'Hibás kérés.' });
    }
    if (!verifyLogin(body.username ?? '', body.password ?? '')) {
      loginLimiter.take(ip);
      return sendJson(res, 401, { error: 'Hibás felhasználónév vagy jelszó.' });
    }
    loginLimiter.reset(ip);
    const token = createSession();
    return sendJson(res, 200, { ok: true, token }, {
      'Set-Cookie': cookieHeader(req, token, Math.floor(config.sessionTtlMs / 1000)),
    });
  }

  if (route === '/api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
  }

  if (route === '/api/stats' && req.method === 'GET') {
    if (!getSession(req)) return sendJson(res, 401, { error: 'Nincs bejelentkezve.' });
    const url = new URL(req.url, 'http://x');
    const period = url.searchParams.get('period') === 'month' ? 'month' : 'week';
    const offset = Math.min(0, Math.max(-60, parseInt(url.searchParams.get('offset') || '0', 10) || 0));
    return sendJson(res, 200, getStats(period, offset, Date.now(), eventsForDay));
  }

  return sendJson(res, 404, { error: 'Nem található.' });
}

function handleAdmin(req, res, pathname) {
  const route = pathname.slice(ADMIN_PATH.length) || '/';
  if (route.startsWith('/api/')) return handleAdminApi(req, res, route);
  if (pathname === ADMIN_PATH) {
    res.writeHead(301, { Location: ADMIN_PATH + '/' });
    return res.end();
  }
  // az admin felület statikus fájl (docs/mzm-admin/), a kereső ne indexelje
  return (
    serveFile(req, res, PUBLIC_DIR, pathname, { 'X-Robots-Tag': 'noindex, nofollow' }) ||
    send(res, 404, 'Not found')
  );
}

/* ---------------- fő kezelő ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');

    if (pathname === '/api/track' && req.method === 'POST') return await handleTrack(req, res);
    if (pathname === '/healthz') return sendJson(res, 200, { ok: true });
    if (pathname === ADMIN_PATH || pathname.startsWith(ADMIN_PATH + '/')) return await handleAdmin(req, res, pathname);

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (serveFile(req, res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname)) return;
    return send(res, 404, 'Nem található', { 'Content-Type': 'text/plain; charset=utf-8' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) send(res, 500, 'Szerverhiba');
  }
});

server.listen(config.port, () => {
  console.log(`MZM landing:  http://localhost:${config.port}`);
  console.log(`Admin:        http://localhost:${config.port}${ADMIN_PATH}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    server.close();
    await flush();
    process.exit(0);
  });
}
