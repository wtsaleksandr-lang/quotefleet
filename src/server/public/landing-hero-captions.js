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
    { t0: 0.0,  t1: 6.0,  kicker: 'Rate import',    title: 'Any rate sheet in. A calculator out.' },
    { t0: 6.0,  t1: 11.2, kicker: 'AI review',      title: 'Read and organized in seconds.' },
    { t0: 11.2, t1: 20.9, kicker: 'Customize',      title: 'Your logo. Your colors. Live.' },
    { t0: 20.9, t1: 24.9, kicker: 'Share & embed', title: 'One link. Share or embed anywhere.' },
    { t0: 24.9, t1: 29.3, kicker: 'Leads',          title: 'Every quote, a lead in your inbox.' },
    { t0: 29.3, t1: 999,  kicker: 'Auto follow-up', title: 'Follow-ups on autopilot.' }
  ];
  var PHONE_BEATS = [
    { t0: 0.0,  t1: 12.8, kicker: 'Instant quote',  title: 'Customers self-quote in seconds.' },
    { t0: 12.8, t1: 20.0, kicker: 'AI assistant',   title: 'Built-in AI answers instantly.' },
    { t0: 20.0, t1: 23.8, kicker: 'Lead capture',   title: 'Every request, a qualified lead.' },
    { t0: 23.8, t1: 999,  kicker: 'Payments',       title: 'Integrated with Stripe & PayPal.' }
  ];

  var wrap = document.querySelector('.qf-hero-devices--video');
  if (!wrap) return;

  var reduceGlobal = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function beatIndexAt(beats, t) {
    for (var i = 0; i < beats.length; i++) {
      if (t >= beats[i].t0 && t < beats[i].t1) return i;
    }
    return beats.length - 1;
  }

  // ── Mobile HEADLINE caption ──
  // On mobile the static hero H1 is visually hidden (CSS) and this single caption
  // node — pinned above the mockup where the H1 was — narrates the CURRENT clip.
  // It mirrors whichever device is foreground: laptop beats during the rate-import
  // clip, phone beats during the instant-quote clip. Cross-fades on beat change,
  // exactly like the in-device captions. No-ops if the node is absent.
  var hl = document.querySelector('.qf-hero-cap--headline');
  var hlKicker = hl && hl.querySelector('.qf-hero-cap__kicker');
  var hlTitle = hl && hl.querySelector('.qf-hero-cap__title');
  if (hlKicker) { try { hlKicker.style.setProperty('font-family', "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace", 'important'); } catch (e) {} }
  var hlKey = '';       // dedupe by kicker|title so identical beats don't re-fade
  var hlSwapping = false;
  function setHeadline(beat) {
    if (!hl || !hlKicker || !hlTitle) return;
    var key = beat.kicker + '|' + beat.title;
    if (key === hlKey || hlSwapping) return;
    var first = hlKey === '';
    hlKey = key;
    if (reduceGlobal || first) {
      hlKicker.textContent = beat.kicker;
      hlTitle.textContent = beat.title;
      hl.setAttribute('data-show', '1');
      return;
    }
    hlSwapping = true;
    hl.setAttribute('data-show', '0');
    window.setTimeout(function () {
      hlKicker.textContent = beat.kicker;
      hlTitle.textContent = beat.title;
      hl.setAttribute('data-show', '1');
      hlSwapping = false;
    }, 260);
  }

  // Wire one device: find its <video> + caption node, keep the caption in sync.
  // stageClass = the foreground marker for this device ('stage-laptop' /
  // 'stage-phone'); while it's set on wrap this device drives the mobile headline.
  function wire(videoSel, capSel, beats, stageClass) {
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
      // Headline tracks the FOREGROUND clip on every tick (its own dedupe makes
      // this cheap). Kept OUT of the in-device early-return below so a stage swap
      // back to the same beat index still refreshes the headline from the other
      // device's text. Only the foreground video fires timeupdate, and the stage
      // guard covers the reduced-motion case where both loop at once.
      if (stageClass && wrap.classList.contains(stageClass)) setHeadline(beats[idx]);
      if (idx === current || swapping) return;
      if (current === -1) show(idx);       // first paint — no fade
      else change(idx);                    // beat change — cross-fade
    }

    video.addEventListener('timeupdate', onTime);
    // Re-seek to a fresh loop (currentTime jumps back to ~0) → snap to beat 0.
    video.addEventListener('seeked', onTime);
    // Initial paint (covers the case where timeupdate hasn't fired yet).
    show(beatIndexAt(beats, video.currentTime || 0));
    if (stageClass && wrap.classList.contains(stageClass)) setHeadline(beats[beatIndexAt(beats, video.currentTime || 0)]);
  }

  wire('.qf-hero-laptop video', '.qf-hero-cap--laptop', LAPTOP_BEATS, 'stage-laptop');
  wire('.qf-hero-vphone video', '.qf-hero-cap--phone', PHONE_BEATS, 'stage-phone');
  // Seed the mobile headline immediately if no stage class is set yet (script
  // order with landing-hero-swap.js) so it's never blank before the first tick.
  if (hl && hlKey === '') setHeadline(LAPTOP_BEATS[0]);
})();
