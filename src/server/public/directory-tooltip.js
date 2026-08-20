/*
 * directory-tooltip.js — body-level tooltip for carrier-card credential badges.
 *
 * Replaces the pure-CSS `.cp-tip[data-tip]::after` tooltip (which was clipped by
 * the badge row's `overflow-x: clip` ancestors) with a single reusable element
 * appended to <body> and positioned `fixed`, so it escapes every clipping
 * ancestor. It also lets us render the embedded "✓" of "✓ FMCSA-verified." in
 * the green success token — impossible with a one-colour CSS attr() tooltip.
 *
 * No dependencies. Progressive enhancement: we flag <html> with `js-tips` so the
 * old CSS tooltip is disabled ONLY when this script runs; no-JS users keep it.
 * The badge's aria-label carries the accessible name either way.
 */
(function () {
  'use strict';
  var docEl = document.documentElement;
  docEl.classList.add('js-tips');

  var GAP = 8; // px — 8px grid
  var EDGE = 8; // viewport clamp margin
  var tip = null;
  var current = null;

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'qf-tip';
    tip.setAttribute('role', 'presentation');
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
    return tip;
  }

  // Fill the tooltip from data-tip WITHOUT innerHTML of raw data: split on the
  // "✓" character, appending plain text nodes for the rest and a green-checked
  // <span> for each "✓". This escapes all user/data content by construction.
  function fill(el, text) {
    el.textContent = '';
    var parts = String(text).split('✓'); // ✓ U+2713
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) el.appendChild(document.createTextNode(parts[i]));
      if (i < parts.length - 1) {
        var chk = document.createElement('span');
        chk.className = 'qf-tip-check';
        chk.textContent = '✓';
        el.appendChild(chk);
      }
    }
  }

  function place(anchor) {
    var t = ensureTip();
    var r = anchor.getBoundingClientRect();
    // Measure at natural size first.
    t.style.left = '0px';
    t.style.top = '0px';
    t.style.visibility = 'hidden';
    t.style.display = 'block';
    var tw = t.offsetWidth;
    var th = t.offsetHeight;

    var above = r.top - th - GAP;
    var pos = 'above';
    var top = above;
    if (above < EDGE) {
      top = r.bottom + GAP; // flip below
      pos = 'below';
    }

    var center = r.left + r.width / 2;
    var left = center - tw / 2;
    var maxLeft = window.innerWidth - tw - EDGE;
    if (left > maxLeft) left = maxLeft;
    if (left < EDGE) left = EDGE;

    // Arrow points at the anchor centre regardless of horizontal clamping.
    var arrowX = center - left;
    if (arrowX < 12) arrowX = 12;
    if (arrowX > tw - 12) arrowX = tw - 12;

    t.style.setProperty('--tip-arrow-x', arrowX + 'px');
    t.setAttribute('data-pos', pos);
    t.style.left = Math.round(left) + 'px';
    t.style.top = Math.round(top) + 'px';
    t.style.visibility = 'visible';
    t.classList.add('is-open');
  }

  function show(anchor) {
    var text = anchor.getAttribute('data-tip');
    if (!text) return;
    current = anchor;
    fill(ensureTip(), text);
    place(anchor);
  }

  function hide() {
    current = null;
    if (tip) {
      tip.classList.remove('is-open');
      tip.style.visibility = 'hidden';
    }
  }

  function anchorFrom(target) {
    return target && target.closest ? target.closest('[data-tip]') : null;
  }

  document.addEventListener('mouseover', function (e) {
    var a = anchorFrom(e.target);
    if (a && a !== current) show(a);
  });
  document.addEventListener('mouseout', function (e) {
    var a = anchorFrom(e.target);
    if (!a) return;
    // Leaving the anchor entirely (not moving to a child).
    if (!e.relatedTarget || !a.contains(e.relatedTarget)) hide();
  });
  // Keyboard accessibility: focusin/out bubble, so delegation works.
  document.addEventListener('focusin', function (e) {
    var a = anchorFrom(e.target);
    if (a) show(a);
  });
  document.addEventListener('focusout', function () {
    hide();
  });
  // Any scroll or resize invalidates the fixed position — just hide.
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hide();
  });
})();
