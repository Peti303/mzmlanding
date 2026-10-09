import fs from 'node:fs';
import path from 'node:path';
import { config } from './env.js';
import { dayKey } from './dates.js';

/**
 * Egyszerű, függőségmentes eseménytár: append-only JSONL fájl + memóriabeli napi index.
 * Egy esemény: { t, d, v, k, s, dv, cm?, c? }
 *   t = időbélyeg (ms), d = Budapest-i nap, v = anonim látogatói hash,
 *   k = 'pv' (oldalmegtekintés) | 'cta' (ajánlatkérés gomb), s = forrás, dv = eszköz,
 *   cm = kampány, c = gomb azonosító
 */
const file = path.join(config.dataDir, 'events.jsonl');
fs.mkdirSync(config.dataDir, { recursive: true });

/** @type {Map<string, any[]>} */
const byDay = new Map();
let total = 0;

function index(ev) {
  let list = byDay.get(ev.d);
  if (!list) byDay.set(ev.d, (list = []));
  list.push(ev);
  total++;
}

if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      index(JSON.parse(line));
    } catch {
      /* sérült sor kihagyása */
    }
  }
}

const out = fs.createWriteStream(file, { flags: 'a' });
out.on('error', (e) => console.error('[store] írási hiba:', e.message));

export function addEvent(ev) {
  const full = { t: Date.now(), ...ev };
  full.d = dayKey(full.t);
  index(full);
  out.write(JSON.stringify(full) + '\n');
  return full;
}

export function eventsForDay(day) {
  return byDay.get(day) || [];
}

export function totalEvents() {
  return total;
}

export function flush() {
  return new Promise((res) => out.end(res));
}
