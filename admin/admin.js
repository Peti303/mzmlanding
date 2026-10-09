(() => {
  'use strict';
  const API = '/mzm-admin/api';
  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';

  const LABELS = {
    source: { facebook: 'Facebook', instagram: 'Instagram', direct: 'Közvetlen / ismeretlen', google: 'Google', youtube: 'YouTube', tiktok: 'TikTok', other: 'Egyéb oldal' },
    device: { mobile: 'Telefon', tablet: 'Táblagép', desktop: 'Számítógép' },
    cta: { fejlec: 'Fejléc', hero: 'Nyitó rész', 'elotte-utana': 'Előtte–utána', folyamat: 'Folyamat', velemeny: 'Vélemények', zaro: 'Záró felhívás', sticky: 'Mobil ragadós sáv', ismeretlen: 'Ismeretlen' },
  };
  const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  const WD = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  const nf = new Intl.NumberFormat('hu-HU');

  const state = { period: 'week', offset: 0, data: null };
  let timer = 0;

  /* ---------- nézetek ---------- */
  const show = (authed) => {
    $('loginView').hidden = authed;
    $('dashView').hidden = !authed;
    if (authed) { load(); clearInterval(timer); timer = setInterval(load, 60000); }
    else { clearInterval(timer); $('username').focus(); }
  };

  async function api(path, opts) {
    const res = await fetch(API + path, { credentials: 'same-origin', ...opts });
    if (res.status === 401 && path !== '/login') { show(false); throw new Error('unauth'); }
    return res;
  }

  /* ---------- bejelentkezés ---------- */
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('loginError'); err.hidden = true;
    const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Belépés…';
    try {
      const res = await api('/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('username').value, password: $('password').value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { err.textContent = j.error || 'Sikertelen belépés.'; err.hidden = false; $('password').select(); }
      else { $('password').value = ''; show(true); }
    } catch (_) { err.textContent = 'Hálózati hiba, próbáld újra.'; err.hidden = false; }
    btn.disabled = false; btn.textContent = 'Belépés';
  });
  $('logoutBtn').addEventListener('click', async () => {
    await fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    show(false);
  });

  /* ---------- vezérlők ---------- */
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.period = b.dataset.period; state.offset = 0;
    document.querySelectorAll('.seg button').forEach((x) => { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', String(x === b)); });
    load();
  }));
  $('prevBtn').addEventListener('click', () => { state.offset -= 1; load(); });
  $('nextBtn').addEventListener('click', () => { if (state.offset < 0) { state.offset += 1; load(); } });
  $('todayBtn').addEventListener('click', () => { state.offset = 0; load(); });

  async function load() {
    try {
      const res = await api(`/stats?period=${state.period}&offset=${state.offset}`);
      if (!res.ok) return;
      state.data = await res.json();
      render(state.data);
    } catch (_) { /* 401 esetén már a bejelentkezés látszik */ }
  }

  /* ---------- formázás ---------- */
  const parse = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const shortDate = (k) => { const d = parse(k); return `${MONTHS[d.getUTCMonth()].slice(0, 3)}. ${d.getUTCDate()}.`; };
  function rangeLabel(d) {
    if (d.period === 'month') { const x = parse(d.range.start); return `${x.getUTCFullYear()}. ${MONTHS[x.getUTCMonth()]}`; }
    const a = parse(d.range.start), b = parse(d.range.end);
    return `${a.getUTCFullYear()}. ${shortDate(d.range.start)} – ${a.getUTCMonth() === b.getUTCMonth() ? b.getUTCDate() + '.' : shortDate(d.range.end)}`;
  }
  function delta(el, val, label) {
    el.className = 'kpi-delta';
    if (val === null || val === undefined) { el.textContent = label ? 'nincs összehasonlítási alap' : ''; el.classList.add('flat'); return; }
    const arrow = val > 0 ? '▲' : val < 0 ? '▼' : '■';
    el.classList.add(val > 0 ? 'up' : val < 0 ? 'down' : 'flat');
    el.textContent = `${arrow} ${val > 0 ? '+' : ''}${String(val).replace('.', ',')}% az előző időszakhoz képest`;
  }

  /* ---------- megjelenítés ---------- */
  function render(d) {
    $('rangeLabel').textContent = rangeLabel(d);
    $('nextBtn').disabled = state.offset >= 0;
    $('todayBtn').hidden = state.offset >= 0;
    const t = d.totals;
    $('kVisitors').textContent = nf.format(t.visitors);
    $('kViews').textContent = nf.format(t.pageviews);
    $('kCta').textContent = nf.format(t.ctaClicks);
    $('kRate').textContent = `${String(t.ctaRate).replace('.', ',')}%`;
    delta($('dVisitors'), d.previous.visitorsDelta, true);
    delta($('dViews'), d.previous.pageviewsDelta);
    delta($('dCta'), d.previous.ctaDelta);
    $('nVisitors').textContent = `átlagosan ${String(t.avgPerDay).replace('.', ',')} / nap`;
    $('chartTitle').textContent = state.period === 'week' ? 'Látogatók naponta (ezen a héten)' : 'Látogatók naponta (ebben a hónapban)';
    if (state.offset !== 0) $('chartTitle').textContent = state.period === 'week' ? 'Látogatók naponta (a kiválasztott héten)' : 'Látogatók naponta (a kiválasztott hónapban)';
    $('chartSub').textContent = `összesen ${nf.format(t.visitors)} egyedi látogató`;
    drawChart(d);
    hbars($('srcBars'), d.sources, LABELS.source, t.visitors);
    hbars($('devBars'), d.devices, LABELS.device, t.visitors);
    hbars($('ctaBars'), d.ctas, LABELS.cta, t.ctaClicks, 'kattintás');
    hbars($('campBars'), d.campaigns, {}, t.visitors);
    drawHours(d.hours);
    $('updated').textContent = 'frissítve ' + new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  }

  function hbars(el, rows, labels, total, unit = '') {
    el.replaceChildren();
    if (!rows.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Ebben az időszakban még nincs adat.'; el.append(p); return; }
    const max = rows[0].value || 1;
    for (const r of rows) {
      const row = document.createElement('div'); row.className = 'hrow';
      const head = document.createElement('div'); head.className = 'hl';
      const name = document.createElement('b'); name.textContent = labels[r.key] || r.key.replaceAll('_', ' ');
      const val = document.createElement('span');
      const share = total ? Math.round((r.value / total) * 100) : 0;
      val.textContent = `${nf.format(r.value)}${unit ? ' ' + unit : ''} · ${share}%`;
      head.append(name, val);
      const track = document.createElement('div'); track.className = 'track';
      const fill = document.createElement('i'); fill.style.width = '0%'; track.append(fill);
      row.append(head, track); el.append(row);
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (r.value / max) * 100 + '%'; }));
    }
  }

  function drawHours(hours) {
    const el = $('hours'); el.replaceChildren();
    const max = Math.max(1, ...hours);
    hours.forEach((v, h) => {
      const c = document.createElement('div'); c.title = `${h}:00 – ${nf.format(v)} megtekintés`;
      const bar = document.createElement('i'); bar.style.height = Math.max(2, Math.round((v / max) * 108)) + 'px';
      const lab = document.createElement('span'); lab.textContent = h % 3 === 0 ? String(h) : '';
      c.append(bar, lab); el.append(c);
    });
  }

  function svg(tag, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function drawChart(d) {
    const host = $('chart'); const tip = $('tip');
    host.replaceChildren(); tip.hidden = true;
    const W = Math.max(host.clientWidth, 280), H = host.clientHeight || 280;
    const m = { t: 14, r: 8, b: 30, l: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const data = d.daily;
    const maxV = Math.max(...data.map((x) => x.visitors), 1);
    const step = niceStep(maxV);
    const top = Math.ceil(maxV / step) * step;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
    for (let v = 0; v <= top; v += step) {
      const y = m.t + ih - (v / top) * ih;
      s.append(svg('line', { class: 'grid-line', x1: m.l, x2: W - m.r, y1: y, y2: y }));
      s.append(svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' }, nf.format(v)));
    }
    const bw = iw / data.length;
    const gap = Math.min(10, bw * 0.28);
    const dense = data.length > 10;
    data.forEach((x, i) => {
      const h = (x.visitors / top) * ih;
      const bx = m.l + i * bw + gap / 2, by = m.t + ih - h;
      const g = svg('g');
      g.append(svg('rect', { class: 'hit', x: m.l + i * bw, y: m.t, width: bw, height: ih }));
      g.append(svg('rect', { class: 'bar' + (x.future ? ' future' : ''), x: bx, y: x.future ? m.t + ih - 3 : by, width: Math.max(bw - gap, 2), height: x.future ? 3 : Math.max(h, x.visitors ? 2 : 0), rx: Math.min(6, (bw - gap) / 3) }));
      const dt = parse(x.date);
      const wd = WD[(dt.getUTCDay() + 6) % 7];
      const label = dense ? (i % 2 === 0 || data.length < 16 ? String(dt.getUTCDate()) : '') : `${wd} ${dt.getUTCDate()}.`;
      if (label) s.append(svg('text', { x: bx + (bw - gap) / 2, y: H - 8, 'text-anchor': 'middle' }, label));
      if (!x.future) {
        g.addEventListener('mouseenter', (e) => showTip(e, x, wd));
        g.addEventListener('mousemove', (e) => moveTip(e));
        g.addEventListener('mouseleave', () => { tip.hidden = true; });
        g.addEventListener('click', (e) => showTip(e, x, wd));
      }
      s.append(g);
    });
    host.append(s);

    function showTip(e, x, wd) {
      tip.replaceChildren();
      const b = document.createElement('b'); b.textContent = `${shortDate(x.date)} (${wd})`; tip.append(b);
      for (const [k, v] of [['Látogatók', x.visitors], ['Megtekintés', x.pageviews], ['Ajánlatkérés', x.cta]]) {
        const r = document.createElement('div'); r.className = 'row';
        const a = document.createElement('span'); a.textContent = k;
        const c = document.createElement('span'); c.textContent = nf.format(v);
        r.append(a, c); tip.append(r);
      }
      tip.hidden = false; moveTip(e);
    }
    function moveTip(e) {
      const pad = 14, w = tip.offsetWidth;
      tip.style.left = Math.min(e.clientX + pad, innerWidth - w - 8) + 'px';
      tip.style.top = e.clientY + pad + 'px';
    }
  }
  function niceStep(max) {
    const raw = max / 4; const pow = 10 ** Math.floor(Math.log10(raw || 1));
    const n = raw / pow; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.data && drawChart(state.data), 120); });

  /* ---------- indulás ---------- */
  fetch(API + '/me', { credentials: 'same-origin' })
    .then((r) => r.json()).then((j) => show(!!j.authenticated)).catch(() => show(false));
})();
