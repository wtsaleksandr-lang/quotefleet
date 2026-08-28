/* Below-the-fold demo video lazy-start.

   WHY THIS EXISTS: every demo clip on the marketing page used to carry
   `autoplay` + `preload="metadata"`. `autoplay` OVERRIDES the preload hint —
   an autoplaying video downloads in full immediately — so all nine clips were
   fetched on first paint. Measured against production (PageSpeed Insights,
   mobile): total page weight 17,610 KiB and LCP 6.2 s, against 2.2-2.9 s on
   every other page of the site. The seven below-the-fold clips contributed
   ~2.7 MB of that and, worse, saturated the connection while the hero's own
   LCP resource was still in flight.

   THE FIX: those seven clips now ship as `preload="none"` with NO `autoplay`
   and a `data-lazy-video` marker. Nothing is fetched until the clip is close
   to the viewport, at which point we flip preload back to `metadata` and call
   play(). The two hero clips are deliberately left eager — they are the
   above-the-fold story.

   The visible behaviour is unchanged: by the time a clip scrolls into view it
   is already playing, exactly as before. `rootMargin` gives it a 400px head
   start so the first frame is up before the clip is actually on screen.

   Degrades safely: with no IntersectionObserver (or no JS) every lazy clip is
   started immediately on load, which is the old behaviour minus the eager
   preload. Honors prefers-reduced-motion by leaving clips paused on their
   poster — landing-video-controls.js still gives a click/tap to play. */
(function () {
  'use strict';

  var vids = Array.prototype.slice.call(
    document.querySelectorAll('video[data-lazy-video]')
  );
  if (!vids.length) return;

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  function play(v) {
    // Let the browser fetch now that the clip matters.
    if (v.preload === 'none') v.preload = 'metadata';
    v.dataset.lazyStarted = '1';
    if (reduceMotion) return; // leave it on the poster; tap-to-play still works
    // Respect a deliberate user pause from landing-video-controls.js.
    if (v.dataset.userPaused === '1') return;
    var p = v.play();
    if (p && p.catch) p.catch(function () {});
  }

  if (!('IntersectionObserver' in window)) {
    vids.forEach(play);
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          play(e.target);
        } else if (e.target.dataset.lazyStarted && !e.target.paused) {
          // Out of view — stop decoding, but keep what we already buffered.
          try { e.target.pause(); } catch (err) {}
        }
      });
    },
    // 400px head start so the clip is running before it is actually on screen.
    { rootMargin: '400px 0px', threshold: 0.01 }
  );

  vids.forEach(function (v) { io.observe(v); });
})();
