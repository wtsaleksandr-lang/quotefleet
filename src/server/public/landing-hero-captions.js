/* Hero mockup captions — sync a per-device beat table to each hero <video>'s
   currentTime and cross-fade the caption on beat change.

   Each device (laptop / phone) has its own <video> (with two <source>s) and its
   own caption node inside the device, so the caption moves WITH the device and
   stays crisp (live text, never burned into the video). Visibility is gated in
   CSS to the FOREGROUND stage (.stage-laptop / .stage-phone) so the dimmed +
   blurred background device never shows a caption.

   Timestamps are in FINAL (published) video seconds — derived from the encoded
   qf-hero-*.webm (post trim + speed + crossfade-wrap), NOT the raw recorder
   waits. If the loops are re-encoded with different pacing, update the tables.

   Defensive: if the markup / videos are missing, it silently no-ops (the hero
   still plays without captions). */
(function () {
  'use strict';

  // ── FINAL-video beat tables (seconds) ──
  var LAPTOP_BEATS = [
    { t0: 0.0,  t1: 6.0,  kicker: 'Rate import',    title: 'Drop in any rate sheet — a secure AI engine builds your quote calculator.' },
    { t0: 6.0,  t1: 11.2, kicker: 'AI review',      title: 'Read and organized in seconds — no manual entry.' },
    { t0: 11.2, t1: 20.9, kicker: 'Customize',      title: 'Make it yours — logo, colors, live preview.' },
    { t0: 20.9, t1: 24.9, kicker: 'Share & embed', title: 'Your own link — share it anywhere, or embed it with one snippet.' },
    { t0: 24.9, t1: 29.3, kicker: 'Leads',          title: 'Every quote becomes a lead in your inbox.' },
    { t0: 29.3, t1: 999,  kicker: 'Auto follow-up', title: 'Automatic follow-ups on your schedule — no lead goes cold.' }
  ];
  var PHONE_BEATS = [
    { t0: 0.0,  t1: 12.8, kicker: 'Instant quote',  title: 'Your customers price their own load in seconds — fully your brand.' },
    { t0: 12.8, t1: 20.0, kicker: 'AI assistant',   title: 'A built-in AI agent answers their questions instantly.' },
    { t0: 20.0, t1: 23.8, kicker: 'Lead capture',   title: 'Every request lands with you as a qualified lead.' },
    { t0: 23.8, t1: 999,  kicker: 'Deposit to book', title: 'Optionally collect a deposit — or full payment — right inside the quote.' }
  ];

  var wrap = document.querySelector('.qf-hero-devices--video');
  if (!wrap) return;

  function beatIndexAt(beats, t) {
    for (var i = 0; i < beats.length; i++) {
      if (t >= beats[i].t0 && t < beats[i].t1) return i;
    }
    return beats.length - 1;
  }

  // Wire one device: find its <video> + caption node, keep the caption in sync.
  function wire(videoSel, capSel, beats) {
    var video = wrap.querySelector(videoSel);
    var cap = wrap.querySelector(capSel);
    if (!video || !cap) return;
    var kickerEl = cap.querySelector('.qf-hero-cap__kicker');
    var titleEl = cap.querySelector('.qf-hero-cap__title');
    if (!kickerEl || !titleEl) return;
    // Guarantee the mono kicker face wins over any broad hero font rule.
    try { kickerEl.style.setProperty('font-family', "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", 'important'); } catch (e) {}

    var current = -1;
    var swapping = false;
    var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function paint(idx) {
      var b = beats[idx];
      kickerEl.textContent = b.kicker;
      titleEl.textContent = b.title;
    }
    function show(idx) {
      current = idx;
      paint(idx);
      cap.setAttribute('data-show', '1');
    }
    function change(idx) {
      if (reduce) { show(idx); return; }
      // Cross-fade: hide, then swap text + show on the next tick.
      swapping = true;
      cap.setAttribute('data-show', '0');
      window.setTimeout(function () {
        show(idx);
        swapping = false;
      }, 300);
    }

    function onTime() {
      var idx = beatIndexAt(beats, video.currentTime || 0);
      if (idx === current || swapping) return;
      if (current === -1) show(idx);       // first paint — no fade
      else change(idx);                    // beat change — cross-fade
    }

    video.addEventListener('timeupdate', onTime);
    // Re-seek to a fresh loop (currentTime jumps back to ~0) → snap to beat 0.
    video.addEventListener('seeked', onTime);
    // Initial paint (covers the case where timeupdate hasn't fired yet).
    show(beatIndexAt(beats, video.currentTime || 0));
  }

  wire('.qf-hero-laptop video', '.qf-hero-cap--laptop', LAPTOP_BEATS);
  wire('.qf-hero-vphone video', '.qf-hero-cap--phone', PHONE_BEATS);
})();
