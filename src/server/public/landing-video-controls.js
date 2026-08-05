/* Landing video play/pause controls.

   Wires a subtle click / tap (and keyboard) play-pause toggle onto every
   autoplaying demo video on the marketing page — the two hero mockups
   (laptop + phone) plus the how-it-works / flow clips. On toggle a small
   centered badge fades in (play glyph when the video is now playing, pause
   glyph when it is now paused) and fades out again after ~700ms.

   The two hero videos are choreographed by landing-hero-swap.js, so rather
   than poke them directly we drive that controller through window.qfHeroSwap:
   a pause freezes the whole laptop <-> phone story, and a resume restarts it
   from the current stage. Every other video is a plain autoplay+loop clip and
   toggles on its own.

   Degrades safely: without JS the videos just autoplay as before. Honors
   prefers-reduced-motion by skipping the badge fade (it still toggles). */
(function () {
  'use strict';

  var HIDE_MS = 700;

  var PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72c0 .8.87 1.28 1.54.85l10.5-6.86a1 1 0 0 0 0-1.7L9.54 4.29A1 1 0 0 0 8 5.14z"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

  var videos = Array.prototype.slice.call(
    document.querySelectorAll('main video[autoplay]')
  );
  if (!videos.length) return;

  videos.forEach(function (video) {
    var host = video.parentElement;
    if (!host) return;

    // Make the host the interactive, focusable surface WITHOUT wrapping the
    // video — wrapping would break the swap-choreography CSS selectors that
    // target the exact parent/child structure.
    try {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch (e) {}
    host.classList.add('qf-vidctl-host');
    host.setAttribute('tabindex', '0');
    host.setAttribute('role', 'button');
    host.setAttribute('aria-label', 'Pause video');

    var overlay = document.createElement('div');
    overlay.className = 'qf-vidctl-overlay';
    var badge = document.createElement('span');
    badge.className = 'qf-vidctl-badge';
    overlay.appendChild(badge);
    host.appendChild(overlay);

    var hideTimer = null;
    function flash(nowPlaying) {
      badge.innerHTML = nowPlaying ? PLAY_SVG : PAUSE_SVG;
      // Force the fade to restart even on a rapid re-toggle.
      badge.classList.remove('is-show');
      void badge.offsetWidth;
      badge.classList.add('is-show');
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { badge.classList.remove('is-show'); }, HIDE_MS);
    }

    var isHero = !!video.closest('.qf-hero-devices--video');

    function toggle() {
      var nowPlaying;
      if (isHero && window.qfHeroSwap) {
        // One shared choreography drives both hero videos.
        nowPlaying = window.qfHeroSwap.toggle();
      } else if (video.paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
        nowPlaying = true;
      } else {
        video.pause();
        nowPlaying = false;
      }
      host.setAttribute('aria-label', nowPlaying ? 'Pause video' : 'Play video');
      host.setAttribute('aria-pressed', nowPlaying ? 'false' : 'true');
      flash(nowPlaying);
    }

    host.addEventListener('click', function (e) {
      // Let real interactive children (future links/buttons in the frame) win.
      if (e.target.closest('a, button')) return;
      toggle();
    });
    host.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
        e.preventDefault();
        toggle();
      }
    });
  });
})();
