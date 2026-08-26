/* Hero scene callouts — sync floating feature captions to the phone mockup's
   scene rotation.

   The carriers-hero phone plays one looping product <video> (`.qf-hero-vphone__vid`)
   that walks through the quote flow scene-by-scene. Each scene has a matching
   floating caption (`.qf-scenecap[data-scene=i]`) that sits in the gutter BESIDE
   the phone (desktop, alternating left/right) or floats over it (mobile), with a
   little arrow pointing at the relevant part of the screen. This driver shows the
   caption for the CURRENT scene and hides the rest, so the callout is always in
   sync with what's on the phone right now — it fades in as its scene begins and
   fades out as the next one starts.

   Beat table is in FINAL (published) video seconds, derived from the encoded
   qf-hero-phone.webm (post trim + speed + crossfade-wrap). If the loop is
   re-encoded with different pacing, update SCENES.

   Defensive: if the markup / video is missing it silently no-ops (the hero still
   plays without callouts). Honors prefers-reduced-motion — no cycling, just the
   first caption shown statically. */
(function () {
  'use strict';

  var stage = document.querySelector('.qf-hero-stage');
  if (!stage) return;
  var video = stage.querySelector('.qf-hero-vphone__vid');
  var caps = Array.prototype.slice.call(stage.querySelectorAll('.qf-scenecap'));
  if (!video || !caps.length) return;

  // FINAL-video scene windows (seconds) — one per floating caption, in order.
  var SCENES = [
    { t0: 0.0,  t1: 12.8 }, // self-quote form
    { t0: 12.8, t1: 20.0 }, // AI assistant
    { t0: 20.0, t1: 23.8 }, // lead capture
    { t0: 23.8, t1: 1e9 }   // payments
  ];

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function sceneAt(t) {
    for (var i = 0; i < SCENES.length; i++) {
      if (t >= SCENES[i].t0 && t < SCENES[i].t1) return i;
    }
    return SCENES.length - 1;
  }

  function show(idx) {
    for (var i = 0; i < caps.length; i++) {
      var on = parseInt(caps[i].getAttribute('data-scene'), 10) === idx;
      caps[i].classList.toggle('is-on', on);
    }
  }

  // Reduced motion: no cycling — show only the first caption, statically.
  if (reduce) {
    show(0);
    return;
  }

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
})();
