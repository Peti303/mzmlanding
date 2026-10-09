import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './env.js';
import { normalizeContent, tooLarge } from '../docs/js/content-core.js';

const contentFile = path.join(config.dataDir, 'content.json');
const historyDir = path.join(config.dataDir, 'content-history');
export const uploadsDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(historyDir, { recursive: true });

let cache = null;

export function getContent() {
  if (cache) return cache;
  try {
    cache = normalizeContent(JSON.parse(fs.readFileSync(contentFile, 'utf8')));
  } catch {
    cache = null;
    return {}; // még nincs mentett tartalom
  }
  return cache;
}

/** Normalizálja, elmenti (az előzőt a content-history-ba teszi) és visszaadja a mentett tartalmat. */
export function saveContent(raw) {
  const clean = normalizeContent(raw);
  if (tooLarge(clean)) throw Object.assign(new Error('too large'), { status: 413 });
  if (fs.existsSync(contentFile)) {
    fs.copyFileSync(contentFile, path.join(historyDir, `${Date.now()}.json`));
    const old = fs.readdirSync(historyDir).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.rmSync(path.join(historyDir, f), { force: true });
  }
  const tmp = contentFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(clean));
  fs.renameSync(tmp, contentFile);
  cache = clean;
  return clean;
}

/* ---------- feltöltött képek ---------- */
const MAGIC = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['gif', (b) => b.slice(0, 4).toString('latin1') === 'GIF8'],
  ['webp', (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'],
  ['avif', (b) => b.slice(4, 12).toString('latin1') === 'ftypavif'],
];
export const UPLOAD_MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
export const UPLOAD_NAME = /^[a-f0-9]{24}\.(jpg|png|gif|webp|avif)$/;
export const MAX_UPLOAD = 6 * 1024 * 1024;

/** @returns {string} a mentett fájl neve (tartalom-hash alapú, ezért örökre gyorsítótárazható) */
export function saveUpload(buf) {
  if (!buf.length || buf.length > MAX_UPLOAD) throw Object.assign(new Error('bad size'), { status: 413 });
  const kind = MAGIC.find(([, test]) => test(buf));
  if (!kind) throw Object.assign(new Error('unsupported image'), { status: 415 });
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24) + '.' + kind[0];
  const file = path.join(uploadsDir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return name;
}
