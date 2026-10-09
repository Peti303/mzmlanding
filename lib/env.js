import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimális .env betöltő (külső függőség nélkül). A már beállított env nem íródik felül.
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadDotEnv();

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  trustProxy: process.env.TRUST_PROXY === '1',
  timeZone: 'Europe/Budapest',
  sessionTtlMs: 12 * 60 * 60 * 1000,
};
