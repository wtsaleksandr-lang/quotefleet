/* Hosted-quote interactive enhancements — layered on top of quote.js's render.
 * quote.js calls window.qfQuoteEnhance(data) at the end of render(), handing us
 * the full quote payload. We progressively enhance the already-rendered DOM:
 *   1. Transit — a tap-to-reveal "subject to conditions" note.
 *   2. Map — tap the route map to open an interactive (pan/zoom) modal, with a
 *      one-tap handoff to full Google Maps directions.
 *   3. Line items — tap an Accessorials/Fuel/Line-haul row to unfold a plain-
 *      English explanation of what the charge is based on.
 *   4. Total — tap the Estimated Total to unfold a compact subtotal recap.
 * Everything degrades safely: if an element is missing we skip that piece.
 * All of it is screen-only chrome; the printed quote is unaffected. */
(function () {
  'use strict';

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function money(n, currency) {
    var v = Number(n || 0);
    try { return v.toLocaleString('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }); }
    catch (e) { return '$' + Math.round(v).toLocaleString('en-US'); }
  }

  // ── 1. Transit conditions note ──────────────────────────────────────────
  function enhanceTransit() {
    var row = document.getElementById('qdoc-transit-row');
    if (!row || row.hidden) return;
    var val = document.getElementById('qdoc-transit');
    if (!val || val.querySelector('.qf-info-btn')) return;
    var btn = el('button', {
      type: 'button', class: 'qf-info-btn no-print',
      'aria-expanded': 'false', 'aria-label': 'What affects transit time', text: 'i',
    });
    val.appendChild(btn);
    var note = el('div', {
      class: 'qf-transit-note no-print', hidden: 'hidden',
      text: 'Estimate based on lane distance and service type. Actual transit can vary with pickup timing, carrier availability, weather, traffic, hours-of-service limits, and appointment or terminal availability. Not guaranteed.',
    });
    // Place the note directly under the summary box so it spans the width.
    var box = row.closest('.qdoc-summary-box') || row.parentNode;
    if (box && box.parentNode) box.parentNode.insertBefore(note, box.nextSibling);
    else row.parentNode.appendChild(note);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var open = note.hasAttribute('hidden');
      if (open) note.removeAttribute('hidden'); else note.setAttribute('hidden', 'hidden');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.classList.toggle('is-open', open);
    });
  }

  // ── 2. Interactive map modal ────────────────────────────────────────────
  function laneText(loc) {
    if (!loc) return '';
    return [loc.title, loc.subtitle || loc.zip].filter(Boolean).join(' ').trim();
  }
  function enhanceMap(data) {
    var img = document.getElementById('qdoc-map');
    var wrap = document.getElementById('qdoc-map-wrap');
    if (!wrap || !img || img.hidden) return;
    if (wrap.querySelector('.qf-map-cue')) return;

    var origin = laneText(data && data.lane && data.lane.pickup);
    var dest = laneText(data && data.lane && data.lane.delivery);
    var gmapsUrl = 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + encodeURIComponent(origin) +
      '&destination=' + encodeURIComponent(dest) + '&travelmode=driving';

    wrap.classList.add('qf-map-tappable');
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'Open interactive route map');
    wrap.appendChild(el('span', { class: 'qf-map-cue no-print', html: '<span class="qf-map-cue-ic" aria-hidden="true">⤢</span> Tap to explore route' }));

    function open() { openMapModal(img.src, origin, dest, gmapsUrl); }
    wrap.addEventListener('click', open);
    wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }

  var modalEl = null;
  function openMapModal(src, origin, dest, gmapsUrl) {
    closeMapModal();
    var scale = 1, tx = 0, ty = 0, dragging = false, sx = 0, sy = 0;
    var pic = el('img', { class: 'qf-mapm-img', src: src, alt: 'Route from ' + origin + ' to ' + dest, draggable: 'false' });
    function apply() { pic.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
    function zoom(f) { scale = Math.max(1, Math.min(5, scale * f)); if (scale === 1) { tx = 0; ty = 0; } apply(); }

    var stage = el('div', { class: 'qf-mapm-stage' }, [pic]);
    stage.addEventListener('wheel', function (e) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 0.87); }, { passive: false });
    stage.addEventListener('pointerdown', function (e) { if (scale === 1) return; dragging = true; sx = e.clientX - tx; sy = e.clientY - ty; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', function (e) { if (!dragging) return; tx = e.clientX - sx; ty = e.clientY - sy; apply(); });
    stage.addEventListener('pointerup', function () { dragging = false; });
    stage.addEventListener('dblclick', function () { zoom(scale >= 3 ? 0.3 : 1.8); });

    var controls = el('div', { class: 'qf-mapm-controls' }, [
      el('button', { type: 'button', class: 'qf-mapm-zbtn', 'aria-label': 'Zoom out', text: '−' }),
      el('button', { type: 'button', class: 'qf-mapm-zbtn', 'aria-label': 'Zoom in', text: '+' }),
    ]);
    controls.children[0].addEventListener('click', function () { zoom(0.7); });
    controls.children[1].addEventListener('click', function () { zoom(1.4); });

    var head = el('div', { class: 'qf-mapm-head' }, [
      el('div', { class: 'qf-mapm-lane' }, [
        el('span', { class: 'qf-mapm-o', text: origin || 'Pickup' }),
        el('span', { class: 'qf-mapm-arrow', 'aria-hidden': 'true', text: '→' }),
        el('span', { class: 'qf-mapm-d', text: dest || 'Delivery' }),
      ]),
      el('button', { type: 'button', class: 'qf-mapm-close', 'aria-label': 'Close map', text: '×' }),
    ]);
    var foot = el('div', { class: 'qf-mapm-foot' }, [
      el('span', { class: 'qf-mapm-hint', text: 'Scroll or use − / + to zoom · drag to pan' }),
      el('a', { class: 'qf-mapm-open', href: gmapsUrl, target: '_blank', rel: 'noopener', html: 'Open in Google Maps ↗' }),
    ]);
    var panel = el('div', { class: 'qf-mapm-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Interactive route map' }, [head, stage, controls, foot]);
    modalEl = el('div', { class: 'qf-mapm-backdrop' }, [panel]);
    head.querySelector('.qf-mapm-close').addEventListener('click', closeMapModal);
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeMapModal(); });
    document.addEventListener('keydown', escClose);
    document.body.appendChild(modalEl);
    apply();
    requestAnimationFrame(function () { modalEl.classList.add('is-open'); });
  }
  function escClose(e) { if (e.key === 'Escape') closeMapModal(); }
  function closeMapModal() {
    document.removeEventListener('keydown', escClose);
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  // ── 3. Line-item explanations ───────────────────────────────────────────
  // Name-based (not heading-based): quote-polish.js rebuilds #qdoc-price-lines
  // and drops the group headings, so we key off each row's own label and skip
  // the subtotal / total rows it injects.
  var SKIP_ROW = /^(sub\s?total|total|grand\s?total)\b/i;
  var GENERIC_ACC = 'An added service charge for this shipment. It applies only when that service is actually required.';
  var NAME_EXPLAIN = [
    [/line\s?haul|linehaul|minimum/i, 'The base transportation cost for this lane — distance × the carrier’s per-mile (or flat) rate for this equipment. Any minimum charge for short hauls is applied here.'],
    [/fuel/i, 'A fuel surcharge that adjusts with diesel prices and lane distance. It moves up or down with the national average diesel price, so the quote reflects current fuel cost.'],
    [/liftgate/i, 'A liftgate charge — for pickups or deliveries with no dock, the driver uses the truck’s hydraulic lift to lower freight to ground level.'],
    [/residential/i, 'A residential charge — deliveries to a home or non-commercial address take longer and need special equipment.'],
    [/detention|wait/i, 'Detention — paid time when the truck waits at a facility beyond the free loading/unloading window.'],
    [/tarp/i, 'A tarping charge — covering and securing exposed or weather-sensitive freight on flatbed equipment.'],
    [/chassis/i, 'A chassis fee — the wheeled frame rented to haul the ocean container over the road.'],
    [/drayage/i, 'Drayage — the short-haul move of an ocean container between the port/rail terminal and the delivery point.'],
    [/detour|out.?of.?route|reroute/i, 'Extra mileage beyond the direct route, priced per mile.'],
    [/layover/i, 'Layover — an overnight hold when a load can’t be delivered same-day through no fault of the carrier.'],
    [/after.?hours|weekend|holiday/i, 'A surcharge for pickup or delivery outside standard business hours.'],
    [/hazmat|hazardous/i, 'A hazardous-materials charge — certified handling, placarding, and paperwork for regulated freight.'],
    [/reefer|refriger/i, 'Temperature-controlled service — running the reefer unit to hold the required temperature in transit.'],
    [/oversize|overweight|permit/i, 'Permits and special routing required when the load exceeds legal size or weight limits.'],
  ];
  function explainFor(name) {
    var n = String(name || '');
    if (!n || SKIP_ROW.test(n.trim())) return null;
    for (var i = 0; i < NAME_EXPLAIN.length; i++) if (NAME_EXPLAIN[i][0].test(n)) return NAME_EXPLAIN[i][1];
    return GENERIC_ACC;
  }
  function enhancePricing() {
    var wrap = document.getElementById('qdoc-price-lines');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.qdoc-price-row'), function (node) {
      if (node.querySelector('.qf-exp-toggle')) return;
      var nameEl = node.querySelector('span');
      var name = nameEl ? (nameEl.childNodes[0] ? nameEl.childNodes[0].textContent : nameEl.textContent) : '';
      var explanation = explainFor(name);
      if (!explanation) return;
      node.classList.add('qf-exp-row');
      var toggle = el('button', { type: 'button', class: 'qf-exp-toggle no-print', 'aria-expanded': 'false', 'aria-label': 'Why this charge', text: '?' });
      if (nameEl) nameEl.appendChild(toggle);
      var body = el('div', { class: 'qf-exp-body', hidden: 'hidden', text: explanation });
      node.appendChild(body);
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var open = body.hasAttribute('hidden');
        if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', 'hidden');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.classList.toggle('is-open', open);
      });
    });
  }

  // ── 4. Total unfold (compact subtotal recap) ────────────────────────────
  function enhanceTotal(data) {
    var box = document.querySelector('.qdoc-total-box');
    var note = document.getElementById('qdoc-total-note');
    if (!box || !note || box.querySelector('.qf-total-recap')) return;
    var lines = (data && data.quote && data.quote.breakdown) || [];
    if (!lines.length) return;
    var currency = data.quote.currency;
    function sum(kinds) {
      return lines.filter(function (l) { return kinds.indexOf(l.kind) >= 0; })
        .reduce(function (s, l) { return s + Number(l.amount || 0); }, 0);
    }
    var parts = [
      ['Line haul', sum(['linehaul', 'minimum'])],
      ['Accessorials', sum(['accessorial'])],
      ['Fuel', sum(['fuel'])],
    ].filter(function (p) { return p[1] > 0; });
    if (parts.length < 2) return; // nothing meaningful to unfold

    var recap = el('div', { class: 'qf-total-recap', hidden: 'hidden' },
      parts.map(function (p) {
        return el('div', { class: 'qf-total-recap-row' }, [
          el('span', { text: p[0] }), el('strong', { text: money(p[1], currency) }),
        ]);
      }).concat([
        el('div', { class: 'qf-total-recap-row qf-total-recap-sum' }, [
          el('span', { text: 'Estimated total' }),
          el('strong', { text: money(data.quote.total, currency) }),
        ]),
      ])
    );
    box.appendChild(recap);

    note.classList.add('qf-total-toggle', 'no-print');
    note.setAttribute('role', 'button');
    note.setAttribute('tabindex', '0');
    note.setAttribute('aria-expanded', 'false');
    note.textContent = 'See how this total is built';
    var caret = el('span', { class: 'qf-total-caret', 'aria-hidden': 'true', text: '›' });
    note.appendChild(caret);
    function toggle() {
      var open = recap.hasAttribute('hidden');
      if (open) recap.removeAttribute('hidden'); else recap.setAttribute('hidden', 'hidden');
      note.setAttribute('aria-expanded', open ? 'true' : 'false');
      note.classList.toggle('is-open', open);
      note.firstChild.textContent = open ? 'Hide the breakdown ' : 'See how this total is built ';
    }
    note.addEventListener('click', toggle);
    note.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }

  window.qfQuoteEnhance = function (data) {
    try { enhanceTransit(); } catch (e) { }
    try { enhanceMap(data); } catch (e) { }
    try { enhancePricing(); } catch (e) { }
    try { enhanceTotal(data); } catch (e) { }
    // quote-polish.js rebuilds #qdoc-price-lines asynchronously (regrouping +
    // subtotals), which would wipe our per-line toggles. Re-apply whenever the
    // price list's direct children change. subtree:false + our edits landing in
    // row descendants means our own mutations never re-trigger this (no loop).
    try {
      var lines = document.getElementById('qdoc-price-lines');
      if (lines && 'MutationObserver' in window) {
        new MutationObserver(function () {
          try { enhancePricing(); } catch (e) { }
        }).observe(lines, { childList: true });
      }
    } catch (e) { }
  };
})();
