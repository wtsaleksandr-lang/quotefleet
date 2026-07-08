(() => {
  function loadStylesheet(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  loadStylesheet('/landing-wefixtrades-cleanup.css');
  loadStylesheet('/public-blue-fixes.css');
  loadStylesheet('/maersk-radius-system.css');
  loadStylesheet('/quotefleet-color-system.css');

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

  items.forEach((item) => observer.observe(item));
})();