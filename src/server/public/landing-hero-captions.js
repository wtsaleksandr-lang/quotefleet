/* Hero scene callouts — sync the floating feature chips to each device loop's
   scene rotation.

   The hero composite plays TWO looping product <video>s:
     • the LAPTOP (`.qf-hero-laptop__vid`) — the OPERATOR flow (7 scenes: import
       a rate sheet → AI reads it → auto-quotes lanes → brand it → embed → leads
       → auto-follow-up). Its chips (`.qf-caps--laptop .qf-cap`) show on desktop.
     • the PHONE (`.qf-hero-vphone__vid`) — the CUSTOMER flow (4 scenes:
       self-quote → AI answer → lead capture → deposit/booking). Its chips
       (`.qf-caps--phone .qf-cap`) show on mobile.

   Each device is driven independently: this shows the chip for the CURRENT scene
   and hides the rest, so exactly one callout is on at a time (they never stack).
   Beat tables are stored as PROPORTIONS of the clip's live duration, so a
   re-encode at different pacing keeps the sync. Which set of chips is visible is
   decided purely by CSS media queries (laptop caps ≥1025px, phone caps ≤1024px);
   both drivers run, the hidden set just toggles invisibly.

   Defensive: if a video / its chips are missing it silently no-ops. Honors
   prefers-reduced-motion — no cycling, just the first chip shown statically. */
(function () {
  'use strict';

  var stage = document.querySelector('.qf-hero-stage');
  if (!stage) return;

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Wire one <video> to its ordered chips using a fractional beat table.
  // FRACTS[i] is scene i's start (proportion of duration); scene i spans
  // [FRACTS[i], FRACTS[i+1]) with an implicit 1.0 after the last.
  function sync(video, caps, fracts, measured) {
    if (!video || !caps.length) return;

    function duration() {
      var d = video.duration;
      return (typeof d === 'number' && isFinite(d) && d > 0) ? d : measured;
    }

    function sceneAt(t) {
      var dur = duration();
      for (var i = 0; i < fracts.length; i++) {
        var t1 = (i + 1 < fracts.length) ? fracts[i + 1] * dur : dur + 1;
        if (t >= fracts[i] * dur && t < t1) return i;
      }
      return fracts.length - 1;
    }

    function show(idx) {
      for (var i = 0; i < caps.length; i++) {
        var on = parseInt(caps[i].getAttribute('data-scene'), 10) === idx;
        caps[i].classList.toggle('is-on', on);
      }
    }

    if (reduce) { show(0); return; }

    var current = -1;
    function onTime() {
      var idx = sceneAt(video.currentTime || 0);
      if (idx === current) return;
      current = idx;
      show(idx);
    }

    video.addEventListener('timeupdate', onTime);
    // Re-seek to a fresh loop (currentTime jumps back to ~0) → snap to scene 0.
    video.addEventListener('seeked', onTime);
    // Initial paint (covers the case where timeupdate hasn't fired yet).
    show(sceneAt(video.currentTime || 0));
  }

  // LAPTOP — operator flow, 7 scenes over the 33.9s loop.
  //   0 import (0–4s) · 1 reading (4–7.5) · 2 rate cards (7.5–11) ·
  //   3 customize/live-preview (11–19) · 4 embed (19–23) · 5 leads (23–27) ·
  //   6 auto-follow-up (27–31); 31–33.9 loops back to import (no beat).
  sync(
    stage.querySelector('.qf-hero-laptop__vid'),
    Array.prototype.slice.call(stage.querySelectorAll('.qf-caps--laptop .qf-cap')),
    [0, 0.12, 0.22, 0.32, 0.56, 0.68, 0.80],
    33.9
  );

  // PHONE — customer flow, 4 scenes over the 33.566s loop (measured frame-by-frame).
  sync(
    stage.querySelector('.qf-hero-vphone__vid'),
    Array.prototype.slice.call(stage.querySelectorAll('.qf-caps--phone .qf-cap')),
    [0, 0.337, 0.608, 0.789],
    33.566
  );
})();
