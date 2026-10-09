// Demo adatok generálása a dashboard kipróbálásához:
//   DATA_DIR=./data-demo node scripts/seed-demo.js && DATA_DIR=./data-demo npm start
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../lib/env.js';
import { dayKey } from '../lib/dates.js';

fs.mkdirSync(config.dataDir, { recursive: true });
const file = path.join(config.dataDir, 'events.jsonl');
const lines = [];
const DAY = 86400000;
const now = Date.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const weighted = (pairs) => {
  let r = Math.random() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};

for (let back = 70; back >= 0; back--) {
  const base = now - back * DAY;
  const dow = new Date(base).getUTCDay();
  const growth = 1 + (70 - back) / 70; // lassú növekedés
  const visitors = Math.round(rnd(30, 55) * growth * (dow === 0 || dow === 6 ? 1.35 : 1));
  for (let i = 0; i < visitors; i++) {
    const hour = weighted([[8, 2], [12, 3], [18, 4], [20, 6], [21, 6], [22, 4], [23, 2], [10, 2], [15, 3]]);
    const t = new Date(base).setUTCHours(hour - 1, Math.floor(rnd(0, 60)), Math.floor(rnd(0, 60)));
    if (t > now) continue;
    const v = crypto.randomBytes(7).toString('hex');
    const s = weighted([['facebook', 46], ['instagram', 34], ['direct', 10], ['google', 6], ['other', 4]]);
    const dv = weighted([['mobile', 78], ['desktop', 17], ['tablet', 5]]);
    const cm = s === 'facebook' || s === 'instagram' ? pick(['Tavaszi_felujitas', 'Csaladi_haz_video', 'Retarget_30nap']) : undefined;
    const pv = { t, d: dayKey(t), v, k: 'pv', s, dv, ...(cm ? { cm } : {}) };
    lines.push(pv);
    if (Math.random() < 0.34) lines.push({ ...pv, t: t + 60000 * rnd(1, 4), k: 'cta', c: pick(['hero', 'hero', 'sticky', 'elotte-utana', 'velemeny', 'folyamat', 'zaro']), cm: undefined, d: pv.d });
  }
}
fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
console.log(`${lines.length} demo esemény -> ${file}`);
