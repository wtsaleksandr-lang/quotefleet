/* Audience toggle: switch the landing hero between the carrier quote-tool hero
   (default) and the shipper carrier-directory hero. Cross-fades the panels,
   keeps ARIA in sync, and swaps the header CTA contextually. Progressive
   enhancement — with JS off, the carrier panel is shown and the rest hidden. */
(function () {
  'use strict';
  var root = document.querySelector('[data-aud-hero]');
  if (!root) return;

  var segs = Array.prototype.slice.call(root.querySelectorAll('[data-aud]'));
  var panels = {
    carriers: root.querySelector('[data-aud-panel="carriers"]'),
    shippers: root.querySelector('[data-aud-panel="shippers"]'),
  };
  var headerCta = document.querySelector('[data-aud-cta]');
  var CTA = {
    carriers: { href: '/w/demo', label: 'View demo' },
    shippers: { href: '/directory', label: 'Browse directory' },
  };

  function select(aud) {
    if (!panels[aud]) return;
    root.setAttribute('data-audience', aud);

    segs.forEach(function (btn) {
      var on = btn.getAttribute('data-aud') === aud;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
    });

    Object.keys(panels).forEach(function (key) {
      var panel = panels[key];
      if (!panel) return;
      if (key === aud) {
        panel.hidden = false;
        panel.classList.remove('is-entering');
        // reflow so the animation re-triggers on every switch
        void panel.offsetWidth;
        panel.classList.add('is-entering');
      } else {
        panel.hidden = true;
        panel.classList.remove('is-entering');
      }
    });

    if (headerCta && CTA[aud]) {
      headerCta.setAttribute('href', CTA[aud].href);
      var arr = headerCta.querySelector('.arr');
      headerCta.textContent = CTA[aud].label + ' ';
      if (arr) headerCta.appendChild(arr);
      else {
        var s = document.createElement('span');
        s.className = 'arr';
        s.textContent = '→';
        headerCta.appendChild(s);
      }
    }
  }

  segs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      select(btn.getAttribute('data-aud'));
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      var idx = segs.indexOf(btn);
      var next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
      if (next < 0) next = segs.length - 1;
      if (next >= segs.length) next = 0;
      var target = segs[next];
      select(target.getAttribute('data-aud'));
      target.focus();
    });
  });
})();
