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
  function init() {
    var btns = document.querySelectorAll('.qf-theme-btn');
    if (!btns.length) return;
    sync(btns, current());
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var next = current() === 'light' ? 'dark' : 'light';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
        sync(document.querySelectorAll('.qf-theme-btn'), next);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
