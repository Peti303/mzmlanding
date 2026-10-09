import { dayKey, periodRange, eachDay, addDays, daysBetween } from './dates.js';

const hourFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Budapest' });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function summarize(days, eventsForDay) {
  const visitors = new Set();
  const ctaVisitors = new Set();
  let pageviews = 0;
  let ctaClicks = 0;
  for (const d of days) {
    for (const e of eventsForDay(d)) {
      if (e.k === 'pv') {
        pageviews++;
        visitors.add(e.v);
      } else if (e.k === 'cta') {
        ctaClicks++;
        ctaVisitors.add(e.v);
      }
    }
  }
  return { visitors: visitors.size, pageviews, ctaClicks, ctaVisitors: ctaVisitors.size };
}

/**
 * @param {(day:string)=>any[]} eventsForDay egy nap eseményei (a tár adja: fájl vagy adatbázis)
 * @param {'week'|'month'} period
 * @param {number} offset 0 = jelenlegi, -1 = előző, …
 */
export function getStats(period, offset, now = Date.now(), eventsForDay) {
  const today = dayKey(now);
  const { start, end } = periodRange(period, offset, today);
  const days = eachDay(start, end);
  const elapsed = days.filter((d) => d <= today);

  // egyedi látogatók: a hónapon belül stabil hash miatt a tartományra összesítve
  const visitors = new Set();
  const ctaVisitors = new Set();
  const perDay = new Map(days.map((d) => [d, { visitors: new Set(), pageviews: 0, cta: 0 }]));
  const sources = new Map();
  const devices = new Map();
  const campaigns = new Map();
  const ctas = new Map();
  const hours = new Array(24).fill(0);
  let pageviews = 0;
  let ctaClicks = 0;
  const visitorMeta = new Map(); // látogató -> {source, device} az első találat alapján

  for (const d of elapsed) {
    for (const e of eventsForDay(d)) {
      const day = perDay.get(d);
      if (e.k === 'pv') {
        pageviews++;
        visitors.add(e.v);
        day.pageviews++;
        day.visitors.add(e.v);
        hours[Number(hourFmt.format(new Date(e.t))) % 24]++;
        if (!visitorMeta.has(e.v)) visitorMeta.set(e.v, { s: e.s, dv: e.dv, cm: e.cm });
      } else if (e.k === 'cta') {
        ctaClicks++;
        ctaVisitors.add(e.v);
        day.cta++;
        ctas.set(e.c || 'ismeretlen', (ctas.get(e.c || 'ismeretlen') || 0) + 1);
      }
    }
  }
  for (const m of visitorMeta.values()) {
    sources.set(m.s, (sources.get(m.s) || 0) + 1);
    devices.set(m.dv, (devices.get(m.dv) || 0) + 1);
    if (m.cm) campaigns.set(m.cm, (campaigns.get(m.cm) || 0) + 1);
  }

  // előző, azonos hosszúságú időszak összehasonlításhoz
  const prevRange = periodRange(period, offset - 1, today);
  const spanDays = Math.max(elapsed.length, 1);
  const prevDays = eachDay(prevRange.start, prevRange.end).slice(0, spanDays);
  const prev = summarize(prevDays, eventsForDay);

  const rank = (map) =>
    [...map.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);

  const delta = (cur, before) => (before ? Math.round(((cur - before) / before) * 1000) / 10 : null);

  return {
    period,
    offset,
    range: { start, end },
    today,
    isCurrent: offset === 0,
    totals: {
      visitors: visitors.size,
      pageviews,
      ctaClicks,
      ctaVisitors: ctaVisitors.size,
      ctaRate: pct(ctaVisitors.size, visitors.size),
      avgPerDay: Math.round((visitors.size / spanDays) * 10) / 10,
    },
    previous: {
      range: { start: prevRange.start, end: prevDays[prevDays.length - 1] || prevRange.end },
      visitors: prev.visitors,
      pageviews: prev.pageviews,
      ctaClicks: prev.ctaClicks,
      visitorsDelta: delta(visitors.size, prev.visitors),
      pageviewsDelta: delta(pageviews, prev.pageviews),
      ctaDelta: delta(ctaClicks, prev.ctaClicks),
    },
    daily: days.map((d) => {
      const x = perDay.get(d);
      return { date: d, future: d > today, visitors: x.visitors.size, pageviews: x.pageviews, cta: x.cta };
    }),
    sources: rank(sources),
    devices: rank(devices),
    campaigns: rank(campaigns).slice(0, 8),
    ctas: rank(ctas),
    hours,
  };
}

/** Az a naptartomány, amit a getStats olvas (jelenlegi + előző időszak) – az adatbázis-lekérdezéshez. */
export function statsSpan(period, offset, now = Date.now()) {
  const today = dayKey(now);
  const cur = periodRange(period, offset, today);
  const prev = periodRange(period, offset - 1, today);
  return { start: prev.start, end: cur.end };
}

export { addDays, daysBetween };
