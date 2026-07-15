/* Hero phone mockup controller — mobile only.
   Drives the swipeable trucking-mode carousel: auto-advances through modes,
   replays each slide's build animation on entry, counts the rate up, and stays
   in sync with manual touch-swipes + tappable dots. No dependencies.
   Degrades safely: without JS the first slide shows statically and the track
   is still natively swipeable (CSS scroll-snap). */
(function () {
  'use strict';

  var phone = document.querySelector('.qf-phone');
  if (!phone) return;

  var track = phone.querySelector('.qf-phone__track');
  var slides = Array.prototype.slice.call(phone.querySelectorAll('.qf-slide'));
  var dots = Array.prototype.slice.call(phone.querySelectorAll('.qf-phone__dot'));
  if (!track || slides.length === 0) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var AUTO_MS = 4800;
  var current = -1;
  var timer = null;
  var resumeTimer = null;
  var inView = true;

  function fmt(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // Ease-out count-up on the active slide's rate figure.
  function countUp(slide) {
    var el = slide.querySelector('.qf-slide__rate');
    if (!el) return;
    var target = parseFloat(el.getAttribute('data-total')) || 0;
    if (reduce) { el.textContent = fmt(target); return; }
    var dur = 900;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1 && slide.classList.contains('is-playing')) requestAnimationFrame(step);
      else el.textContent = fmt(target);
    }
    // Delay the count to land just as the "calculating" shimmer clears (~1.15s).
    el.textContent = fmt(0);
    setTimeout(function () {
      if (slide.classList.contains('is-playing')) requestAnimationFrame(step);
    }, 1150);
  }

  function play(slide) {
    if (reduce) { countUp(slide); return; }
    slide.classList.remove('is-playing');
    // force reflow so the animations restart from 0
    void slide.offsetWidth;
    slide.classList.add('is-playing');
    countUp(slide);
  }

  function setActive(i, opts) {
    opts = opts || {};
    if (i === current) return;
    current = i;
    dots.forEach(function (d, di) { d.classList.toggle('is-on', di === i); });
    slides.forEach(function (s, si) { if (si !== i) s.classList.remove('is-playing'); });
    play(slides[i]);
    if (opts.scroll) {
      track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  function next() {
    setActive((current + 1) % slides.length, { scroll: true });
  }

  function startAuto() {
    if (reduce || timer) return;
    timer = setInterval(function () { if (inView) next(); }, AUTO_MS);
  }
  function stopAuto() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  // Pause auto-advance briefly after a manual interaction, then resume.
  function nudge() {
    stopAuto();
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(startAuto, 8000);
  }

  // Keep the active slide in sync when the user swipes the track by hand.
  var scrollRAF = null;
  track.addEventListener('scroll', function () {
    if (scrollRAF) return;
    scrollRAF = requestAnimationFrame(function () {
      scrollRAF = null;
      var w = track.clientWidth || 1;
      var i = Math.round(track.scrollLeft / w);
      i = Math.max(0, Math.min(slides.length - 1, i));
      if (i !== current) setActive(i, { scroll: false });
    });
  }, { passive: true });

  track.addEventListener('pointerdown', nudge, { passive: true });

  dots.forEach(function (d, i) {
    d.addEventListener('click', function () {
      nudge();
      setActive(i, { scroll: true });
    });
    d.setAttribute('aria-label', 'Show ' + (d.getAttribute('data-mode') || ('mode ' + (i + 1))) + ' quote');
  });

  // Only animate/auto-advance while the hero is on screen (perf + battery).
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
      if (inView) startAuto(); else stopAuto();
    }, { threshold: 0.25 });
    io.observe(phone);
  }

  // Kick off.
  setActive(0, { scroll: false });
  startAuto();
})();
