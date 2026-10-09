(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EDIT = document.documentElement.classList.contains('is-edit'); // a szerkesztő iframe-jében vagyunk
  const resolveSrc = (src) => (window.MZMContent ? window.MZMContent.resolveSrc(src) : src);

  /* ---------------- látogatottság mérése (süti nélkül, anonim) ---------------- */
  const API_BASE = (window.MZM_CONFIG || {}).apiBase;
  function track(type, cta) {
    if (EDIT || typeof API_BASE !== 'string') return; // szerkesztőben / szerver nélkül nincs mérés
    try {
      const url = API_BASE.replace(/\/$/, '') + '/api/track';
      const body = JSON.stringify({
        type,
        cta,
        search: location.search.slice(0, 500),
        referrer: document.referrer.slice(0, 300),
        width: innerWidth,
      });
      // text/plain: így külön domainre küldve sem kell CORS-preflight
      if (!(navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' })))) {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body, keepalive: true });
      }
    } catch (_) { /* a mérés sosem akaszthatja meg az oldalt */ }
  }
  track('pv');

  /* ---------------- ajánlatkérés gombok: egyelőre az oldal elejére ugranak ---------------- */
  const toTop = () => scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-cta], [data-top]');
    if (!el) return;
    if (EDIT) return; // a szerkesztő kezeli a kattintást
    e.preventDefault();
    if (el.dataset.cta) track('cta', el.dataset.cta);
    // ha a szerkesztőben megadtak ajánlatkérés-linket, oda visz; különben az oldal tetejére
    const url = ((window.MZM_CONTENT || {}).settings || {}).ctaUrl;
    if (el.dataset.cta && url) {
      if (url.startsWith('#')) { const t = document.querySelector(url); t ? t.scrollIntoView({ behavior: 'smooth' }) : toTop(); }
      else location.href = url;
      return;
    }
    toTop();
  });

  /* ---------------- fejléc + mobil sticky CTA ---------------- */
  const header = $('#siteHeader');
  const sticky = $('#stickyCta');
  const stickyLink = $('a', sticky);
  let ticking = false;
  const onScroll = () => {
    ticking = false;
    const y = scrollY;
    header.classList.toggle('is-solid', y > 12);
    const on = y > 520;
    sticky.classList.toggle('is-on', on);
    sticky.setAttribute('aria-hidden', String(!on));
    stickyLink.tabIndex = on ? 0 : -1;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------- megjelenési animáció + számlálók ---------------- */
  const countUp = (el) => {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduceMotion || EDIT || !el.hasAttribute('data-count')) return;
    const t0 = performance.now();
    const dur = 1400;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        en.target.classList.add('in');
        $$('[data-count]', en.target).forEach(countUp);
        io.unobserve(en.target);
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach((el) => io.observe(el));
  } else {
    $$('.reveal').forEach((el) => el.classList.add('in'));
  }

  /* ---------------- előtte–utána csúszka ---------------- */
  const DEFAULT_PAIRS = [
    { render: 'img/projects/house-render.jpg', real: 'img/projects/house-real.jpg' },
    { render: 'img/projects/living-render.jpg', real: 'img/projects/living-real.jpg' },
    { render: 'img/projects/bath-render.jpg', real: 'img/projects/bath-real.jpg' },
  ];
  // a szerkesztőben lecserélt képek (ba0.render, ba1.real, …) felülírják az alapértelmezetteket
  const getPairs = () => {
    const els = ((window.MZM_CONTENT || {}).els) || {};
    return DEFAULT_PAIRS.map((p, i) => ({
      render: els[`ba${i}.render`]?.src ? resolveSrc(els[`ba${i}.render`].src) : p.render,
      real: els[`ba${i}.real`]?.src ? resolveSrc(els[`ba${i}.real`].src) : p.real,
    }));
  };
  const ba = $('#ba');
  if (ba) {
    const range = $('.ba-range', ba);
    const imgRender = $('.ba-render', ba);
    const imgReal = $('.ba-real .ba-img', ba);
    let target = 50;
    let current = 50;
    let raf = 0;
    let interacted = false;
    let demoTimers = [];

    const paint = () => {
      ba.style.setProperty('--pos', current.toFixed(2) + '%');
      ba.classList.toggle('hide-l', current < 22);
      ba.classList.toggle('hide-r', current > 78);
      range.value = current;
    };
    const loop = () => {
      const d = target - current;
      if (Math.abs(d) < 0.05) { current = target; paint(); raf = 0; return; }
      current += d * 0.32; // enyhe simítás: a vonal „tapad” a kurzorhoz
      paint();
      raf = requestAnimationFrame(loop);
    };
    const setTarget = (pct, instant = false) => {
      target = Math.max(0, Math.min(100, pct));
      if (instant || reduceMotion) { current = target; paint(); return; }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const pctFrom = (e) => {
      const r = ba.getBoundingClientRect();
      return ((e.clientX - r.left) / r.width) * 100;
    };
    const stopDemo = () => { demoTimers.forEach(clearTimeout); demoTimers = []; ba.classList.remove('is-demo'); };
    const touched = () => { interacted = true; stopDemo(); };

    // számítógép: a vonal automatikusan követi a kurzort (nyomás nélkül is)
    ba.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { touched(); setTarget(pctFrom(e)); } });
    ba.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { touched(); setTarget(pctFrom(e)); }
      else if (dragging) { setTarget(pctFrom(e), true); }
    });
    // érintés / toll: húzás
    let dragging = false;
    ba.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      touched(); dragging = true;
      try { ba.setPointerCapture(e.pointerId); } catch (_) {}
      setTarget(pctFrom(e), true);
    });
    const end = () => { dragging = false; };
    ba.addEventListener('pointerup', end);
    ba.addEventListener('pointercancel', end);
    // billentyűzet / hozzáférhetőség
    range.addEventListener('input', () => { touched(); target = current = Number(range.value); paint(); });

    // bemutató: első láthatóságkor „végigsöpör”, hogy látszódjon, hogy interaktív
    if (!reduceMotion && !EDIT && 'IntersectionObserver' in window) {
      const demoIO = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting || interacted) return;
        demoIO.disconnect();
        ba.classList.add('is-demo');
        [[300, 78], [1100, 22], [1900, 50]].forEach(([t, v]) =>
          demoTimers.push(setTimeout(() => !interacted && setTarget(v), t)));
        demoTimers.push(setTimeout(stopDemo, 2800));
      }, { threshold: 0.6 });
      demoIO.observe(ba);
    }

    // projekt-fülek
    const swap = (i) => {
      const pair = getPairs()[i];
      if (!pair) return;
      ba.classList.add('is-switching');
      setTimeout(() => {
        const done = new Promise((res) => {
          let n = 0;
          const ok = () => { if (++n === 2) res(); };
          imgRender.onload = imgReal.onload = ok;
          imgRender.onerror = imgReal.onerror = ok;
        });
        imgRender.src = pair.render;
        imgReal.src = pair.real;
        done.then(() => ba.classList.remove('is-switching'));
      }, 220);
    };
    const tabs = $$('.ba-tab');
    tabs.forEach((tab, i) => tab.addEventListener('click', () => {
      tabs.forEach((t) => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
      swap(i);
    }));
    // a többi képpár előtöltése, amint az oldal tétlen
    const preload = () => getPairs().slice(1).forEach((p) => { new Image().src = p.render; new Image().src = p.real; });
    ('requestIdleCallback' in window) ? requestIdleCallback(preload, { timeout: 4000 }) : setTimeout(preload, 2500);
    paint();
  }
})();
