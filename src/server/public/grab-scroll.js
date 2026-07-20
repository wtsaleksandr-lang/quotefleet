// QuoteFleet — shared "grab to scroll" (drag-to-pan) utility.
// Vanilla JS, no build step. One implementation, reused by the customer widget
// (window scroll on the standalone /w/<slug> + /w/demo page) and the tenant
// dashboard (/app, panning the main scroll container).
//
// Behaviour: press-and-drag on a NON-interactive background area pans the
// scroll target like a hand/pan tool. Desktop mouse/pen only — touch already
// scrolls natively (that IS grab-to-scroll), so touch is left entirely to the
// browser (never hijacked, native momentum preserved). Light inertial glide on
// release, disabled under prefers-reduced-motion.
//
// Exposes: window.QFGrabScroll.attach(scrollTarget, opts)
//   scrollTarget : window | Element (the thing that scrolls)
//   opts.surface : Element that receives pointerdown (defaults to body for
//                  window targets, or the scrollTarget itself)
//   opts.exclude : CSS selector for interactive controls to never hijack
//   opts.threshold : px before a press becomes a drag (default 5)
(function () {
  'use strict';

  // Interactive / control selectors we must NEVER hijack. A press whose target
  // (or any ancestor up to the surface) matches these is left alone so the
  // control behaves normally — inputs select text, buttons click, tabs switch,
  // the map pans itself, sliders drag, modals stay modal.
  var DEFAULT_EXCLUDE = [
    'input', 'textarea', 'select', 'button', 'a', 'label',
    '[contenteditable]', '[contenteditable="true"]',
    '[role="slider"]', '[role="tab"]',
    '.qf-tabs', '.qf-tabs-ind',
    '.qf-map', '.qf-map-card', '.qf-map-canvas',
    '.qf-modal', '.qf-modal-card',
    '[data-no-grabscroll]'
  ].join(', ');

  function prefersReduce() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clamp(v, lo, hi) {
    if (hi < lo) hi = lo;
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // An element is "independently scrollable" if it has its own auto/scroll
  // overflow AND real overflowing content. Grabs that start inside such an
  // element are left to scroll that inner area, not the outer pan target.
  function isScrollable(node) {
    if (!node || node.nodeType !== 1) return false;
    var cs = window.getComputedStyle ? getComputedStyle(node) : null;
    if (!cs) return false;
    var oy = cs.overflowY, ox = cs.overflowX;
    var canY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1;
    var canX = (ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 1;
    return canY || canX;
  }

  function attach(scrollTarget, opts) {
    opts = opts || {};
    var isWindow = (scrollTarget === window || scrollTarget === document ||
      scrollTarget === document.documentElement || scrollTarget === document.body);
    var scroller = isWindow ? (document.scrollingElement || document.documentElement) : scrollTarget;
    var surface = opts.surface || (isWindow ? document.body : scrollTarget);
    if (!surface) return function () {};
    var exclude = opts.exclude || DEFAULT_EXCLUDE;
    var threshold = typeof opts.threshold === 'number' ? opts.threshold : 5;

    surface.classList.add('qf-grab-surface');

    var candidate = false, engaged = false, pointerId = null;
    var startX = 0, startY = 0, startLeft = 0, startTop = 0;
    var lastX = 0, lastY = 0, lastT = 0, vx = 0, vy = 0, rafId = null;

    function sLeft() { return isWindow ? (window.pageXOffset || scroller.scrollLeft || 0) : scroller.scrollLeft; }
    function sTop() { return isWindow ? (window.pageYOffset || scroller.scrollTop || 0) : scroller.scrollTop; }
    function scrollToXY(x, y) {
      if (isWindow) window.scrollTo(x, y);
      else { scroller.scrollLeft = x; scroller.scrollTop = y; }
    }
    function maxTop() {
      return isWindow ? (scroller.scrollHeight - window.innerHeight) : (scroller.scrollHeight - scroller.clientHeight);
    }
    function maxLeft() {
      return isWindow ? (scroller.scrollWidth - window.innerWidth) : (scroller.scrollWidth - scroller.clientWidth);
    }

    function cancelGlide() { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }

    function onDown(e) {
      // Custom-handle mouse/pen only. Touch scrolls natively — never hijack it.
      if (e.pointerType === 'touch') return;
      if (e.button != null && e.button !== 0) return; // primary button only
      var t = e.target;
      if (t && t.closest && t.closest(exclude)) return;
      // Skip if an ancestor (target → surface) is its own scroll pane; let it scroll.
      var node = t;
      while (node && node !== surface && node !== scroller && node !== document.body) {
        if (isScrollable(node)) return;
        node = node.parentNode;
      }
      cancelGlide();
      candidate = true; engaged = false; pointerId = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      startLeft = sLeft(); startTop = sTop();
      lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp || Date.now();
      vx = 0; vy = 0;
    }

    function engage() {
      engaged = true;
      document.documentElement.classList.add('qf-grabbing');
      try { if (surface.setPointerCapture && pointerId != null) surface.setPointerCapture(pointerId); } catch (_) { }
    }

    function onMove(e) {
      if (!candidate || e.pointerId !== pointerId) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!engaged) {
        if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
        engage();
      }
      var now = e.timeStamp || Date.now();
      var dt = now - lastT;
      if (dt > 0) { vx = (e.clientX - lastX) / dt; vy = (e.clientY - lastY) / dt; }
      lastX = e.clientX; lastY = e.clientY; lastT = now;
      // Hand/pan: dragging down moves content down (scroll position decreases).
      scrollToXY(clamp(startLeft - dx, 0, maxLeft()), clamp(startTop - dy, 0, maxTop()));
      if (e.cancelable) e.preventDefault();
    }

    function suppressNextClick() {
      var handler = function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        document.removeEventListener('click', handler, true);
      };
      document.addEventListener('click', handler, true);
      setTimeout(function () { document.removeEventListener('click', handler, true); }, 350);
    }

    function startGlide() {
      var friction = 0.94;
      function step() {
        vx *= friction; vy *= friction;
        if (Math.abs(vx) < 0.02 && Math.abs(vy) < 0.02) { rafId = null; return; }
        scrollToXY(clamp(sLeft() - vx * 16, 0, maxLeft()), clamp(sTop() - vy * 16, 0, maxTop()));
        rafId = requestAnimationFrame(step);
      }
      cancelGlide();
      rafId = requestAnimationFrame(step);
    }

    function onUp(e) {
      if (!candidate) return;
      if (pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
      var wasEngaged = engaged;
      candidate = false; engaged = false;
      try { if (surface.releasePointerCapture && pointerId != null) surface.releasePointerCapture(pointerId); } catch (_) { }
      pointerId = null;
      if (wasEngaged) {
        document.documentElement.classList.remove('qf-grabbing');
        // Movement passed the threshold → this was a drag, not a click. Swallow
        // the trailing click. A press under threshold never engages, so its
        // click passes through untouched (normal click behaviour preserved).
        suppressNextClick();
        if (!prefersReduce()) startGlide();
      }
    }

    surface.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    return function destroy() {
      cancelGlide();
      surface.classList.remove('qf-grab-surface');
      surface.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      document.documentElement.classList.remove('qf-grabbing');
    };
  }

  window.QFGrabScroll = { attach: attach, DEFAULT_EXCLUDE: DEFAULT_EXCLUDE };
})();
