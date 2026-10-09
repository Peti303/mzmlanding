import test from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, weekdayIndex, addDays, dayKey } from '../lib/dates.js';
import { classifySource, isBot, deviceType } from '../lib/classify.js';

test('hét: hétfőtől vasárnapig', () => {
  // 2026-10-09 péntek
  assert.equal(weekdayIndex('2026-10-09'), 4);
  assert.deepEqual(periodRange('week', 0, '2026-10-09'), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(periodRange('week', -1, '2026-10-09'), { start: '2026-09-28', end: '2026-10-04' });
});

test('hónap: naptári hónap, év- és szökőnap-határokkal', () => {
  assert.deepEqual(periodRange('month', 0, '2026-10-09'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(periodRange('month', -1, '2026-01-15'), { start: '2025-12-01', end: '2025-12-31' });
  assert.deepEqual(periodRange('month', 0, '2028-02-10'), { start: '2028-02-01', end: '2028-02-29' });
});

test('addDays hónaphatáron', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('dayKey budapesti idő szerint számol', () => {
  // 2026-06-30 22:30 UTC = 2026-07-01 00:30 CEST
  assert.equal(dayKey(Date.UTC(2026, 5, 30, 22, 30)), '2026-07-01');
});

test('forrás-felismerés', () => {
  assert.equal(classifySource({ search: '?utm_source=ig&utm_campaign=Tavasz' }).source, 'instagram');
  assert.equal(classifySource({ search: '?utm_source=FB' }).source, 'facebook');
  assert.equal(classifySource({ search: '?fbclid=abc' }).source, 'facebook');
  assert.equal(classifySource({ referrer: 'https://l.instagram.com/?u=x' }).source, 'instagram');
  assert.equal(classifySource({ referrer: 'https://www.google.com/' }).source, 'google');
  assert.equal(classifySource({}).source, 'direct');
  assert.equal(classifySource({ referrer: 'https://valami.hu/' }).source, 'other');
  assert.equal(classifySource({}, 'Mozilla/5.0 [FBAN/FBIOS;FBAV/400]').source, 'facebook');
  assert.equal(classifySource({ search: '?utm_campaign=<script>' }).campaign, 'script');
});

test('bot- és eszközszűrés', () => {
  assert.ok(isBot('facebookexternalhit/1.1'));
  assert.ok(isBot('Googlebot/2.1'));
  assert.ok(isBot(''));
  assert.ok(!isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148 Instagram 300'));
  assert.equal(deviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 390), 'mobile');
  assert.equal(deviceType('Mozilla/5.0 (iPad; CPU OS 17_0)', 820), 'tablet');
  assert.equal(deviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 1440), 'desktop');
});

/* ---------- szerkesztő: tartalom-normalizálás ---------- */
import { sanitizeHtml, normalizeContent, buildRules, lighten, readableOn } from '../docs/js/content-core.js';

test('sanitizeHtml: csak a fehérlistás címkék maradnak', () => {
  assert.equal(sanitizeHtml('Szia <em>világ</em><br>'), 'Szia <em>világ</em><br>');
  assert.equal(sanitizeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(sanitizeHtml('<b onclick="x()">fet</b>'), '&lt;b onclick=&quot;x()&quot;&gt;fet</b>');
  assert.equal(sanitizeHtml('Tom &amp; Jerry'), 'Tom &amp; Jerry');
});

test('normalizeContent: ismeretlen/veszélyes mezők eldobása', () => {
  const c = normalizeContent({
    els: {
      'hero.h1-1': { html: 'Új <em>cím</em>', css: { d: { 'font-size': '40px', color: '#fff', 'background-image': 'url(javascript:1)', width: 'calc(1px)' }, x: { color: 'red' } } },
      'EVIL KEY': { html: 'x' },
      'ba0.render': { src: 'uploads/abc.webp' },
      'ba0.real': { src: 'https://evil.example/x.png' },
    },
    sections: { order: ['hero', 'miert', 'hero', '../x'] },
    settings: { accent: '#FF8000', ctaUrl: 'javascript:alert(1)', facebook: 'https://facebook.com/mzm', title: ' Cím ' },
  });
  assert.deepEqual(c.els['hero.h1-1'].css, { d: { 'font-size': '40px', color: '#fff' } });
  assert.equal(c.els['hero.h1-1'].html, 'Új <em>cím</em>');
  assert.equal(c.els['EVIL KEY'], undefined);
  assert.equal(c.els['ba0.render'].src, 'uploads/abc.webp');
  assert.equal(c.els['ba0.real'], undefined);
  assert.deepEqual(c.sections.order, ['hero', 'miert']);
  assert.equal(c.settings.accent, '#ff8000');
  assert.equal(c.settings.ctaUrl, undefined);
  assert.equal(c.settings.facebook, 'https://facebook.com/mzm');
  assert.equal(c.settings.title, 'Cím');
});

test('normalizeContent: érvénytelen bemenetből üres, érvényes tartalom lesz', () => {
  for (const bad of [null, undefined, 'x', 5, [], { els: 'x' }]) {
    const c = normalizeContent(bad);
    assert.equal(c.v, 1);
    assert.deepEqual(c.els, {});
  }
});

test('buildRules: eszközönkénti média-szabályok, ghost módban az elrejtés halvány', () => {
  const content = normalizeContent({ els: { 'a.b': { css: { m: { 'font-size': '20px' }, d: { display: 'none' } } } } });
  const rules = buildRules(content);
  assert.ok(rules.some((r) => r.includes('max-width: 639px') && r.includes('font-size:20px !important')));
  assert.ok(rules.some((r) => r.includes('display:none !important')));
  assert.ok(buildRules(content, { ghost: true }).some((r) => r.includes('opacity:0.18 !important')));
});

test('színsegédek', () => {
  assert.equal(lighten('#000000', 0.5), '#808080');
  assert.equal(readableOn('#ffcf00'), '#17181a');
  assert.equal(readableOn('#112233'), '#ffffff');
});
