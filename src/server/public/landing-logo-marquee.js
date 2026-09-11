/* THE LOGO MARQUEE'S ONLY SCRIPT: RUN THE ANIMATION ONLY WHILE IT IS VISIBLE.
 *
 * landing-logo-marquee.css starts `qf-logo-marquee-scroll` PAUSED. This adds
 * `.is-inview` while the strip intersects the viewport and removes it again
 * when it leaves, so an infinite animation is never ticking behind the fold or
 * in a background tab.
 *
 * This file is loaded ONLY alongside a rendered marquee — src/server/home/
 * homeSections.ts emits the <script> tag with the section — so it can assume
 * there is something to observe, and it still no-ops harmlessly if there is not.
 *
 * Reduced motion needs no branch here: the media query in the stylesheet turns
 * the animation off outright and converts the strip into a scrollable row, so
 * `.is-inview` becomes inert rather than wrong.
 */
(function () {
  var strips = document.querySelectorAll('[data-qf-marquee]');
  if (!strips.length) return;

  // No IntersectionObserver (old Safari, some embedded webviews): let it run.
  // A continuously-scrolling strip is the component's normal state; degrading
  // to "always running" is better than degrading to "never moves".
  if (typeof IntersectionObserver !== 'function') {
    Array.prototype.forEach.call(strips, function (el) { el.classList.add('is-inview'); });
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-inview', entry.isIntersecting);
      });
    },
    // A little margin so the strip is already moving by the time it is read,
    // rather than visibly starting from a standstill as it enters.
    { rootMargin: '120px 0px' },
  );

  Array.prototype.forEach.call(strips, function (el) { io.observe(el); });
})();
