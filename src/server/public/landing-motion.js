(() => {
  const cleanupHref = '/landing-wefixtrades-cleanup.css';
  if (!document.querySelector('link[href="' + cleanupHref + '"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cleanupHref;
    document.head.appendChild(link);
  }

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