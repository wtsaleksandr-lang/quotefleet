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

  // Scene boundaries measured from the REAL published loop (qf-hero-phone.mp4 /
  // .webm, both 33.566s), verified frame-by-frame with ffmpeg:
  //   0  self-quote form + instant $3,950 quote  → 0.000 … ~11.3s
  //   1  built-in AI answers the estimate        → ~11.3 … ~20.4s
  //   2  "Almost done" lead-capture + confirm    → ~20.4 … ~26.5s
  //   3  deposit / booking (Stripe & PayPal)      → ~26.5 … end
  // Stored as PROPORTIONS of the clip's duration (not hardcoded seconds) so the
  // sync survives a re-encode at different pacing — the windows are rebuilt from
  // the live video.duration. FRACTS[i] is scene i's start; scene i spans
  // [FRACTS[i], FRACTS[i+1]) with an implicit 1.0 after the last.
  var FRACTS = [0, 0.337, 0.608, 0.789];
  var MEASURED_DURATION = 33.566; // fallback if video.duration isn't ready yet

  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function duration() {
    var d = video.duration;
    return (typeof d === 'number' && isFinite(d) && d > 0) ? d : MEASURED_DURATION;
  }

  function sceneAt(t) {
    var dur = duration();
    for (var i = 0; i < FRACTS.length; i++) {
      var t1 = (i + 1 < FRACTS.length) ? FRACTS[i + 1] * dur : dur + 1;
      if (t >= FRACTS[i] * dur && t < t1) return i;
    }
    return FRACTS.length - 1;
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
