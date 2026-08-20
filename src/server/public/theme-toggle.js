/* QuoteFleet theme toggle — dependency-free.
   Flips <html data-theme> between light/dark, persists to
   localStorage['qf-theme'], and reflects state on every .qf-theme-btn
   (aria-pressed + which icon shows is CSS-driven off data-theme).
   No-flash is handled by a tiny inline <head> script in each shell. */
(function () {
  var KEY = 'qf-theme';
  function current() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function apply(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
  }
  function sync(btns, theme) {
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
  }
  /* Brand logos ship in two cuts: `*-ondark.png` (light truck/wordmark, for the
     dark theme) and the default `*.png` (dark-outline truck, for light bg). Swap
     any /brand/*-ondark logo to its light cut in light mode so the mark stays
     legible on white, and restore it in dark. Both variants are captured once. */
  function swapLogos(theme) {
    var imgs = document.querySelectorAll('img[src*="/brand/"]');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (!img.hasAttribute('data-logo-dark')) {
        var s = img.getAttribute('src') || '';
        if (s.indexOf('-ondark') === -1) continue; // only theme-paired logos
        img.setAttribute('data-logo-dark', s);
        img.setAttribute('data-logo-light', s.replace('-ondark', ''));
      }
      var want = theme === 'light' ? img.getAttribute('data-logo-light') : img.getAttribute('data-logo-dark');
      if (want && img.getAttribute('src') !== want) img.setAttribute('src', want);
    }
  }
  function init() {
    swapLogos(current());
    var btns = document.querySelectorAll('.qf-theme-btn');
    if (!btns.length) return;
    sync(btns, current());
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var next = current() === 'light' ? 'dark' : 'light';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
        sync(document.querySelectorAll('.qf-theme-btn'), next);
        swapLogos(next);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
