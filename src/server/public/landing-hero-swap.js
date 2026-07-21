/* Hero device SWAP choreography.

   Instead of the laptop + phone looping side-by-side, they tell one story with a
   foreground/background depth swap:
     1. Laptop in front — the user drops in a rate sheet and QuoteFleet's AI
        accepts + processes it (the qf-hero-laptop clip).
     2. When that clip finishes, the laptop slides BACK and dims while the phone
        scales UP into the foreground.
     3. Phone in front — the live customer calculator produces an instant quote
        (the qf-hero-phone clip).
     4. When that finishes, it swaps back to the laptop and the loop repeats.

   The swap is CSS (transform/opacity/filter transitions on .qf-hero-laptop /
   .qf-hero-vphone); this file only toggles .stage-laptop / .stage-phone on
   .qf-hero-devices--video and drives playback off each clip's `ended` event
   (with a watchdog timer for browsers that stall). If this script never runs the
   markup falls back to the static side-by-side layout, so the hero is never
   blank. Honors prefers-reduced-motion by skipping the motion. */
(function () {
  'use strict';

  var wrap = document.querySelector('.qf-hero-devices--video');
  if (!wrap) return;
  var lapV = wrap.querySelector('.qf-hero-laptop video');
  var phV = wrap.querySelector('.qf-hero-vphone video');
  if (!lapV || !phV) return;

  // Pause on the finished payoff frame before the swap, so the key moment reads.
  var DWELL = 550;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Manual control — no independent looping. Keep muted so autoplay is allowed.
  lapV.loop = false; phV.loop = false;
  lapV.muted = true; phV.muted = true;

  var timer = null;
  function clearT() { if (timer) { clearTimeout(timer); timer = null; } }

  function stage(name) {
    wrap.classList.remove('stage-laptop', 'stage-phone');
    wrap.classList.add(name === 'phone' ? 'stage-phone' : 'stage-laptop');
  }

  // Prefer the real 'ended' event; a watchdog covers browsers that don't fire it.
  function schedule(video, next) {
    var done = false;
    function fire() {
      if (done) return;
      done = true;
      video.removeEventListener('ended', fire);
      next();
    }
    video.addEventListener('ended', fire, { once: true });
    var dur = (isFinite(video.duration) && video.duration > 0) ? video.duration : 10;
    timer = setTimeout(fire, (dur - (video.currentTime || 0) + 0.7) * 1000);
  }

  function playLaptop() {
    clearT();
    stage('laptop');
    try { phV.pause(); phV.currentTime = 0; } catch (e) {}
    try { lapV.currentTime = 0; } catch (e) {}
    var p = lapV.play(); if (p && p.catch) p.catch(function () {});
    schedule(lapV, function () { clearT(); timer = setTimeout(playPhone, DWELL); });
  }

  function playPhone() {
    clearT();
    stage('phone');
    try { lapV.pause(); } catch (e) {}
    try { phV.currentTime = 0; } catch (e) {}
    var p = phV.play(); if (p && p.catch) p.catch(function () {});
    schedule(phV, function () { clearT(); timer = setTimeout(playLaptop, DWELL); });
  }

  if (reduce) {
    // No motion: keep both playing gently in the static layout.
    lapV.loop = true; phV.loop = true; stage('laptop');
    var pl = lapV.play(); if (pl && pl.catch) pl.catch(function () {});
    var pp = phV.play(); if (pp && pp.catch) pp.catch(function () {});
    return;
  }

  // Pause the loop when the hero scrolls out of view (saves work; resumes clean).
  var io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      if (!e) return;
      if (e.isIntersecting) {
        if (!wrap.classList.contains('stage-phone')) { var q = lapV.play(); if (q && q.catch) q.catch(function () {}); }
        else { var r = phV.play(); if (r && r.catch) r.catch(function () {}); }
      } else {
        clearT(); try { lapV.pause(); } catch (e2) {} try { phV.pause(); } catch (e3) {}
      }
    }, { threshold: 0.15 });
    io.observe(wrap);
  }

  function start() {
    if (lapV.readyState >= 1) playLaptop();
    else lapV.addEventListener('loadedmetadata', playLaptop, { once: true });
  }
  start();
})();
