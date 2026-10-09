// Budapest-i naptári napok kezelése (hét: hétfő–vasárnap, hónap: naptári hónap).
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Budapest',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Unix ms -> 'YYYY-MM-DD' Budapest idő szerint */
export function dayKey(ms) {
  return fmt.format(new Date(ms));
}

const toUTC = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);

export function addDays(key, n) {
  return fromUTC(toUTC(key) + n * 86400000);
}

export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** a napkulcs hétköznapja: 0 = hétfő … 6 = vasárnap */
export function weekdayIndex(key) {
  return (new Date(toUTC(key)).getUTCDay() + 6) % 7;
}

/**
 * Egy időszak (hét / hónap) kezdő- és záródátuma, offsettel (0 = jelenlegi, -1 = előző).
 * @returns {{start:string,end:string}}
 */
export function periodRange(period, offset, todayKey) {
  if (period === 'month') {
    const [y, m] = todayKey.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + offset, 1));
    const last = new Date(Date.UTC(y, m + offset, 0));
    return { start: fromUTC(first.getTime()), end: fromUTC(last.getTime()) };
  }
  const monday = addDays(todayKey, -weekdayIndex(todayKey) + offset * 7);
  return { start: monday, end: addDays(monday, 6) };
}

export function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
