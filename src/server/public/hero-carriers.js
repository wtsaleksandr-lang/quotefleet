/* Homepage hero — real carrier social proof.

   The shipper hero's right column ships with three HARDCODED demo carrier cards
   (see landing.html `.qf-shipper-preview`). Those static cards are the no-JS /
   loading / fetch-failure fallback so SEO + no-JS visitors always see something
   credible. This script fetches a small, random set of REAL directory carriers
   and swaps them in — live social proof + free advertising for listed carriers,
   varying on every load (the endpoint re-randomizes per request).

   Fails silent: any network/JSON error or an empty result leaves the static
   fallback cards untouched. Matches the exact `.qf-dir-card` markup/classes so
   styling is unchanged; the cards become links to each carrier's profile. */
(function () {
  'use strict';

  var preview = document.querySelector('.qf-shipper-preview');
  if (!preview) return;

  function text(el, s) { el.textContent = s == null ? '' : String(s); }

  function buildCard(c, featured) {
    var a = document.createElement('a');
    a.className = 'qf-dir-card' + (featured ? ' qf-dir-card--featured' : '');
    a.href = '/directory/carrier/' + encodeURIComponent(c.slug);

    var head = document.createElement('div');
    head.className = 'qf-dir-card__head';
    var name = document.createElement('span');
    name.className = 'qf-dir-card__name';
    text(name, c.name);
    head.appendChild(name);
    if (c.ids) {
      var ids = document.createElement('span');
      ids.className = 'qf-dir-card__ids';
      text(ids, c.ids);
      head.appendChild(ids);
    }
    a.appendChild(head);

    var chips = Array.isArray(c.chips) ? c.chips : [];
    if (chips.length) {
      var row = document.createElement('div');
      row.className = 'qf-dir-card__chips';
      chips.forEach(function (chip) {
        if (!chip || !chip.label) return;
        var el = document.createElement('span');
        el.className = 'qf-dir-chip' + (chip.muted ? ' qf-dir-chip--muted' : '');
        text(el, chip.label);
        row.appendChild(el);
      });
      if (row.childNodes.length) a.appendChild(row);
    }

    if (c.locLabel && c.locValue) {
      var loc = document.createElement('div');
      loc.className = 'qf-dir-card__port';
      var lab = document.createElement('span');
      text(lab, c.locLabel);
      loc.appendChild(lab);
      loc.appendChild(document.createTextNode(' ' + c.locValue));
      a.appendChild(loc);
    }
    return a;
  }

  function render(carriers) {
    var cards = carriers.slice(0, 3).map(function (c, i) { return buildCard(c, i === 0); });
    if (!cards.length) return;

    // Update the section label to reflect the live directory (no longer a fixed
    // "Los Angeles / Long Beach" claim now that the carriers vary nationwide).
    var label = preview.querySelector('.qf-shipper-preview__label');
    if (label) label.textContent = 'Featured · Live from the directory';

    // Drop the static demo cards; keep the label.
    var old = preview.querySelectorAll('.qf-dir-card');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    cards.forEach(function (card) { preview.appendChild(card); });

    // The static preview was decorative (aria-hidden); the real, linked carrier
    // cards are meaningful content, so expose them to assistive tech.
    preview.removeAttribute('aria-hidden');
  }

  function load() {
    var done = false;
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) try { ctrl.abort(); } catch (e) {} }, 6000);
    fetch('/api/directory/hero-carriers', {
      headers: { Accept: 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        var carriers = data && Array.isArray(data.carriers) ? data.carriers : [];
        if (carriers.length) render(carriers);
      })
      .catch(function () { clearTimeout(timer); /* keep static fallback */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load, { once: true });
  } else {
    load();
  }
})();
