/*
 * QuoteFleet first-party conversion events.
 *
 * WHAT THIS IS
 *   Cloudflare Web Analytics — the pageview layer — supports no custom events
 *   on any plan. So the four flows that decide whether this business works are
 *   counted here instead: the homepage company finder, signup, the free profile
 *   claim, and the RFQ. One POST per conversion, to our own server, carrying a
 *   name from a fixed list and nothing else.
 *
 * WHAT IT NEVER SENDS
 *   No email, no company name, no USDOT, no query text, no form field of any
 *   kind, no id, no cookie, no storage of any sort. The request body is
 *   `{"event":"<one of eight fixed strings>"}`. That is the whole payload. The
 *   server records a per-day counter; there is no per-visitor record to make.
 *
 * WHY IT USES DELEGATED LISTENERS
 *   Every hook below is an attribute or id the pages ALREADY carry. Nothing in
 *   landing.html, claimPage.ts, rfq/pages.ts or signup.html was edited to add a
 *   tracking hook, so this file cannot break a flow by touching its markup, and
 *   deleting this file removes the feature completely. Listeners are bound to
 *   `document` in the capture phase, so they fire even when a flow's own
 *   handler calls stopPropagation() or preventDefault() on the way to a fetch.
 */
(function () {
  'use strict';

  // ── 1. REFUSALS ────────────────────────────────────────────────────────────
  // Each of these is a case where the honest answer is "do not measure this".

  // (a) THE WIDGET. /w/:slug and widget.html render inside third-party carrier
  //     websites. Tracking there would put QuoteFleet's measurement on someone
  //     else's visitors, on their domain, without their say. The widget does not
  //     load this file at all (it renders through none of the chrome paths that
  //     inject it) — this is the second of three independent guards, because the
  //     one that fails silently is the one that matters. Framing is checked too:
  //     an embed is an iframe, so a framed document is a widget context whatever
  //     its path says.
  var path = location.pathname || '';
  if (path.indexOf('/w/') === 0 || path === '/widget.html' || path === '/embed.js') return;
  try {
    if (window.top !== window.self) return;
  } catch (e) {
    return; // cross-origin framed → we are embedded → do not measure.
  }

  // (b) DO NOT TRACK / GLOBAL PRIVACY CONTROL. A visitor who has asked not to be
  //     tracked has asked plainly, and the request costs us one counter. Note
  //     that Cloudflare does not document DNT support for its beacon, so this
  //     gate is ours alone — which is exactly why the beacon must be installed
  //     in "JS snippet" mode rather than edge auto-injection: edge injection
  //     happens before any of this can run.
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes' || navigator.globalPrivacyControl === true) return;

  // (c) SAVE-DATA. A visitor on a metered or degraded connection has told the
  //     browser to spend their bytes on content. A conversion counter is not
  //     content.
  try {
    var conn = navigator.connection;
    if (conn && conn.saveData === true) return;
  } catch (e) { /* no NetworkInformation — proceed */ }

  var script = document.currentScript;
  var DEBUG = !!(script && script.getAttribute('data-qf-debug'));

  // ── 2. THE EVENT NAMES ─────────────────────────────────────────────────────
  // Mirrors CONVERSION_EVENTS in src/server/analytics.ts. The server rejects
  // anything outside its own copy of this list, so a drift here costs a dropped
  // event, never a bad row.
  var E = {
    FINDER_SEARCH: 'finder_search',
    FINDER_SELECT: 'finder_select',
    SIGNUP_SUBMIT: 'signup_submit',
    CLAIM_START: 'claim_start',
    CLAIM_VERIFY: 'claim_verify',
    CLAIM_TRIAL: 'claim_trial',
    RFQ_SUBMIT: 'rfq_submit',
    RFQ_QUOTE_SUBMIT: 'rfq_quote_submit'
  };

  // ── 3. SENDING ─────────────────────────────────────────────────────────────
  var ENDPOINT = '/api/analytics/event';

  // Once per event name per pageview. The finder fires on every keystroke burst
  // and a form can be resubmitted after a validation bounce; without this, one
  // visitor's single session would read as a dozen conversions and the funnel
  // numbers would be fiction.
  var sent = {};

  function track(name) {
    if (!name || sent[name]) return;
    sent[name] = true;

    var body = JSON.stringify({ event: name });
    var ok = false;
    // sendBeacon survives the page unloading, which matters because most of
    // these fire on a submit that immediately navigates away. A plain fetch on
    // a submit handler is routinely cancelled by the navigation.
    try {
      if (navigator.sendBeacon) {
        ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      }
    } catch (e) { ok = false; }
    if (!ok) {
      try {
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'omit'
        }).catch(function () { /* a dropped counter is never worth a console error */ });
      } catch (e) { /* ignore */ }
    }
    if (DEBUG && window.console) console.debug('[qf-analytics]', name);
    // A DOM event as well, so anything else on the page can observe a
    // conversion without this file needing to know about it.
    try {
      document.dispatchEvent(new CustomEvent('qf:conversion', { detail: { event: name } }));
    } catch (e) { /* ancient browser — the counter already went */ }
  }

  // ── 4. THE HOOKS ───────────────────────────────────────────────────────────
  // All delegated from document, all capture-phase, all keyed on markup the
  // pages already had.

  function closest(el, sel) {
    return el && el.closest ? el.closest(sel) : null;
  }

  // 4a. HOMEPAGE COMPANY FINDER — landing.html's [data-carrier-finder], whose
  //     input is #qf-finder-input and whose results land in #qf-finder-listbox.
  //     SEARCH fires once the visitor has typed a real query (the input's own
  //     minlength is 2); SELECT fires when they pick their company, which is the
  //     step that actually starts the claim funnel.
  var finderInput = document.getElementById('qf-finder-input');
  if (finderInput) {
    finderInput.addEventListener('input', function () {
      if ((finderInput.value || '').trim().length >= 2) track(E.FINDER_SEARCH);
    }, { passive: true });
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t) return;
    // The listbox option — role=option inside the finder's listbox.
    if (closest(t, '#qf-finder-listbox [role="option"], #qf-finder-listbox li a, #qf-finder-listbox li')) {
      track(E.FINDER_SELECT);
      return;
    }
    // 4b. CLAIM UPSELL — claimPage.ts's [data-activate-trial] button, the
    //     "Start my 30 free days" accept after a successful claim.
    if (closest(t, '[data-activate-trial]')) track(E.CLAIM_TRIAL);
  }, true);

  // The finder's listbox is keyboard-navigable (role=combobox), so a selection
  // made with Enter never produces a click. Without this, every keyboard user's
  // conversion would be missing from the funnel.
  if (finderInput) {
    finderInput.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var box = document.getElementById('qf-finder-listbox');
      if (box && !box.hasAttribute('hidden')) track(E.FINDER_SELECT);
    });
  }

  // 4c. FORM SUBMITS — signup, claim start/verify, the claim-page finder, RFQ
  //     send, and a carrier returning a quote into an RFQ.
  document.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || f.nodeName !== 'FORM') return;
    var action = f.getAttribute('action') || '';

    if (f.id === 'signup-form') return track(E.SIGNUP_SUBMIT);
    if (f.hasAttribute('data-claim-start')) return track(E.CLAIM_START);
    if (f.hasAttribute('data-claim-verify')) return track(E.CLAIM_VERIFY);
    if (f.hasAttribute('data-finder-form')) return track(E.FINDER_SEARCH);
    // RFQ: the shipper's multi-carrier send posts to exactly /directory/rfq;
    // a carrier's reply posts to /directory/rfq/quote/<token>. Ordered so the
    // more specific path is tested first.
    if (action.indexOf('/directory/rfq/quote/') === 0) return track(E.RFQ_QUOTE_SUBMIT);
    if (action === '/directory/rfq') return track(E.RFQ_SUBMIT);
  }, true);
})();
