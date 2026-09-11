(() => {
  /* `again` re-appends a sheet that is ALREADY linked in the static head, so it
     also occupies a late cascade position. Only nav-ia.css needs it, and the
     reason is in landing.html: that sheet is render-blocking there so the first
     paint is already collapsed on a phone, but the dedupe below then meant it
     never got re-added AFTER the sheets injected here — so the homepage's own
     bundle silently out-cascaded it at every equal specificity, which is how
     the header came out translucent and the footer light-on-light on the first
     pass of the chrome wave. Two <link>s, one request, the late one wins. */
  function loadStylesheet(href, again) {
    if (!again && document.querySelector('link[href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  loadStylesheet('/landing-wefixtrades-cleanup.css');
  loadStylesheet('/public-blue-fixes.css');
  loadStylesheet('/maersk-radius-system.css');
  loadStylesheet('/quotefleet-color-system.css');
  loadStylesheet('/landing-home-fixes.css');
  /* landing-hero-redesign.css is now a static <link> in landing.html's <head>
     (loads reliably, no FOUC) — no longer injected here. */

  /* Premium glass material — injected LAST so it out-cascades every cleanup
     sheet above (it re-glasses the light-mode nav/dropdown those sheets flatten
     and applies the glass card/toggle treatment). See landing-glass.css. */
  loadStylesheet('/landing-glass.css');

  /* Navigation / information-architecture rebuild — injected AFTER the glass
     sheet so the homepage's single nav collapse point, the drawer's group
     structure and the audience-toggle alignment win the cascade without
     needing !important on every layout declaration. See nav-ia.css. */
  loadStylesheet('/nav-ia.css', true);

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