(function () {
  var d = document.documentElement;
  d.classList.add('js');
  // a szerkesztő iframe-jében ne várjunk a tartalomra, és ne fusson animáció/mérés
  var edit = /[?&]mzm-edit=1/.test(location.search) && window.parent !== window;
  if (edit) { d.classList.add('is-edit'); return; }
  // amíg a mentett szövegek betöltődnek, ne villanjon fel az eredeti (max. 1,2 mp)
  d.classList.add('content-pending');
  setTimeout(function () { d.classList.remove('content-pending'); }, 1200);
})();
