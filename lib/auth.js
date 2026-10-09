import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/* ---------- titkok ---------- */
function loadSecret() {
  if (config.sessionSecret.length >= 32) return config.sessionSecret;
  const f = path.join(config.dataDir, 'secret.json');
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')).secret;
  } catch {
    const secret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(f, JSON.stringify({ secret }), { mode: 0o600 });
    return secret;
  }
}
export const SECRET = loadSecret();

/* ---------- admin hitelesítő adatok ---------- */
function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('base64'), hash: hash.toString('base64') };
}

function loadCredentials() {
  if (config.adminPassword) {
    return { username: config.adminUsername, ...hashPassword(config.adminPassword) };
  }
  const f = path.join(config.dataDir, 'admin.json');
  try {
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { ...saved, username: config.adminUsername || saved.username };
  } catch {
    const password = crypto.randomBytes(12).toString('base64url');
    const creds = { username: config.adminUsername, ...hashPassword(password) };
    fs.writeFileSync(f, JSON.stringify(creds), { mode: 0o600 });
    const bar = '='.repeat(62);
    console.log(
      `\n${bar}\n  ADMIN BEJELENTKEZÉS (/mzm-admin) – első indulás\n  felhasználónév: ${creds.username}\n  jelszó:         ${password}\n  Ezt most látod utoljára! Saját jelszóhoz állítsd be az\n  ADMIN_PASSWORD környezeti változót.\n${bar}\n`,
    );
    return creds;
  }
}
const creds = loadCredentials();

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

export function verifyLogin(username, password) {
  // mindig lefuttatjuk a scrypt-et, hogy a válaszidő ne áruljon el semmit
  const calc = crypto.scryptSync(String(password), Buffer.from(creds.salt, 'base64'), 64, {
    N: 16384,
    r: 8,
    p: 1,
  });
  const passOk = crypto.timingSafeEqual(calc, Buffer.from(creds.hash, 'base64'));
  const userOk = safeEqual(String(username), creds.username);
  return passOk && userOk;
}

/* ---------- munkamenet (aláírt, állapotmentes token) ---------- */
const sign = (data) => b64u(crypto.createHmac('sha256', SECRET).update(data).digest());

export function createSession(now = Date.now()) {
  const payload = b64u(JSON.stringify({ u: creds.username, exp: now + config.sessionTtlMs }));
  return `${payload}.${sign(payload)}`;
}

export function readSession(token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > now && data.u === creds.username ? data : null;
  } catch {
    return null;
  }
}

/* ---------- látogatói azonosító (süti nélküli, havonta forgó hash) ---------- */
export function visitorHash(ip, ua, monthKey) {
  const salt = crypto.createHmac('sha256', SECRET).update('visitor:' + monthKey).digest();
  return crypto.createHmac('sha256', salt).update(`${ip}|${ua}`).digest('hex').slice(0, 14);
}

/* ---------- egyszerű sebességkorlát ---------- */
export class RateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  /** @returns {boolean} true, ha a kérés még engedélyezett (és beleszámít) */
  take(key, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
  check(key, now = Date.now()) {
    return (this.hits.get(key) || []).filter((t) => now - t < this.windowMs).length < this.max;
  }
  reset(key) {
    this.hits.delete(key);
  }
  sweep(now = Date.now()) {
    for (const [k, arr] of this.hits) {
      const live = arr.filter((t) => now - t < this.windowMs);
      if (live.length) this.hits.set(k, live);
      else this.hits.delete(k);
    }
  }
}
