/* Hero device RESTING COMPOSITION.

   The hero pair no longer swaps between a lone laptop and a phone-forward stage.
   The RESTING pose is now the premium depth composition Alex asked for: the phone
   SHARP in the foreground, the desktop VISIBLE-BUT-BLURRED behind it (the
   `stage-phone` pose, tuned in landing-hero-devices.css + landing-hero-fixes-v2.css
   for desktop, tablet and mobile). Both device videos keep looping continuously so
   the whole story stays alive — the laptop clip plays softly behind the phone, the
   phone clip plays sharp in front.

   This script only pins the `stage-phone` class on `.qf-hero-devices--video` and
   keeps both <video>s playing (pausing while the hero is scrolled out of view). If
   it never runs, the markup falls back to the static side-by-side layout, so the
   hero is never blank. window.qfHeroSwap stays exposed so landing-video-controls.js
   can play/pause both hero videos as one unit. */
(function () {
  'use strict';

  var wrap = document.querySelector('.qf-hero-devices--video');
  if (!wrap) return;
  var lapV = wrap.querySelector('.qf-hero-laptop video');
  var phV = wrap.querySelector('.qf-hero-vphone video');
  if (!lapV || !phV) return;

  // Both clips loop independently; muted so autoplay is allowed.
  lapV.loop = true; phV.loop = true;
  lapV.muted = true; phV.muted = true;

  // Phone foreground is the standing pose — never swap back to a lone laptop.
  function stagePhone() {
    wrap.classList.remove('stage-laptop');
    wrap.classList.add('stage-phone');
  }
  stagePhone();

  var userPaused = false;

  function playBoth() {
    if (userPaused) return;
    var a = lapV.play(); if (a && a.catch) a.catch(function () {});
    var b = phV.play(); if (b && b.catch) b.catch(function () {});
  }
  function pauseBoth() {
    try { lapV.pause(); } catch (e) {}
    try { phV.pause(); } catch (e) {}
  }

  // User play/pause — driven by landing-video-controls.js. Controls BOTH videos
  // as one choreographed unit so the resting composition freezes/resumes together.
  window.qfHeroSwap = {
    isPaused: function () { return userPaused; },
    pause: function () { userPaused = true; pauseBoth(); },
    resume: function () { userPaused = false; playBoth(); },
    toggle: function () { if (userPaused) { this.resume(); } else { this.pause(); } return !userPaused; }
  };

  // Pause the loops when the hero scrolls out of view (saves work; resumes clean).
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var e = entries[0];
      if (!e || userPaused) return;
      if (e.isIntersecting) playBoth(); else pauseBoth();
    }, { threshold: 0.15 });
    io.observe(wrap);
  }

  function start() {
    stagePhone();
    playBoth();
  }
  if (lapV.readyState >= 1 || phV.readyState >= 1) start();
  else {
    lapV.addEventListener('loadedmetadata', start, { once: true });
    phV.addEventListener('loadedmetadata', start, { once: true });
  }
})();
