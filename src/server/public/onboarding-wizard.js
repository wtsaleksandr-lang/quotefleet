/* ─────────────────────────────────────────────────────────────────────────
   Post-signup guided onboarding wizard (client).

   A full-bleed overlay shown once, right after signup, gated by the SERVER
   flag `tenant.needsOnboarding` (set in app.js boot). Four short steps:
     1. What do you haul?   → freight vertical  (seeds the calculator)
     2. How do you price?   → pricing mode
     3. Main lane           → from / to
     4. Brand (optional)    → primary color / accent

   On FINISH it POSTs /api/tenant/onboarding/apply (reseeds the tenant with the
   picked vertical's subset when the seed is still pristine), then closes and
   hands control back to the dashboard. "Skip for now" posts { skip:true } and
   falls straight through to the dashboard.

   Exposes window.QFOnboardingWizard.open({ me, onDone }).
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Kept in sync with src/calc/seedTemplates.ts (display copy only; the server
  // owns the actual seed selection).
  var VERTICALS = [
    { id: 'drayage', label: 'Drayage / Port containers', blurb: 'Pull containers from the port or rail ramp on a zone tariff.', pricing: 'zone' },
    { id: 'dryvan_ftl', label: 'Dry-Van FTL', blurb: 'Full truckloads in a 53′ dry van, priced by the mile.', pricing: 'per_mile' },
    { id: 'reefer', label: 'Reefer / Temp-controlled', blurb: 'Refrigerated truckloads with genset, priced by the mile.', pricing: 'per_mile' },
    { id: 'ltl', label: 'LTL / Partial', blurb: 'Less-than-truckload, class-rated with a minimum plus mileage.', pricing: 'min_mileage' },
    { id: 'hotshot', label: 'Hotshot / Expedited', blurb: 'Hotshot dually plus sprinter / box truck, priced by the mile.', pricing: 'per_mile' },
    { id: 'flatbed', label: 'Flatbed / Open-deck', blurb: 'Flatbed, step-deck and Conestoga loads, priced by the mile.', pricing: 'per_mile' }
  ];

  var PRICING = [
    { id: 'per_mile', label: 'Rate per mile', blurb: 'Miles × your $/mile, with a minimum.' },
    { id: 'flat', label: 'Flat lane price', blurb: 'One flat price for the whole move.' },
    { id: 'min_mileage', label: 'Minimum + mileage', blurb: 'A floor charge, then per-mile above it.' },
    { id: 'zone', label: 'Zone tariff', blurb: 'Flat price by port / radius zone.' }
  ];

  // Preset brand colors (hex lives in JS, not CSS — no theme token needed for a
  // color the user is literally picking). WCAG-safe brand hues.
  var SWATCHES = ['#0D3CFC', '#2563EB', '#0F766E', '#B91C1C', '#B45309', '#7C3AED', '#0891B2', '#334155'];

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function open(opts) {
    opts = opts || {};
    var onDone = typeof opts.onDone === 'function' ? opts.onDone : function () {};
    if (document.getElementById('qf-ob-overlay')) return; // singleton

    var state = {
      step: 0,
      vertical: null,
      pricing: null,
      laneFrom: '',
      laneTo: '',
      brandColor: null,
      submitting: false
    };
    var STEPS = 4;

    var overlay = el('div', 'qf-ob-overlay');
    overlay.id = 'qf-ob-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Set up your calculator');

    var shell = el('div', 'qf-ob-shell');
    overlay.appendChild(shell);

    // Header
    var head = el('div', 'qf-ob-head');
    head.appendChild(el('div', 'qf-ob-brand', 'QuoteFleet setup'));
    var skipBtn = el('button', 'qf-ob-skip', 'Skip for now');
    skipBtn.type = 'button';
    skipBtn.addEventListener('click', function () { finish(true); });
    head.appendChild(skipBtn);
    shell.appendChild(head);

    // Progress
    var progress = el('div', 'qf-ob-progress');
    for (var i = 0; i < STEPS; i++) progress.appendChild(el('span'));
    shell.appendChild(progress);

    // Body + footer
    var body = el('div', 'qf-ob-body');
    shell.appendChild(body);
    var foot = el('div', 'qf-ob-foot');
    var backBtn = el('button', 'qf-ob-btn qf-ob-btn-back', 'Back');
    backBtn.type = 'button';
    backBtn.addEventListener('click', function () { if (state.step > 0) { state.step--; render(); } });
    var nextBtn = el('button', 'qf-ob-btn qf-ob-btn-next', 'Continue');
    nextBtn.type = 'button';
    nextBtn.addEventListener('click', onNext);
    foot.appendChild(backBtn);
    foot.appendChild(nextBtn);
    shell.appendChild(foot);

    document.body.appendChild(overlay);

    function setProgress() {
      var spans = progress.querySelectorAll('span');
      for (var s = 0; s < spans.length; s++) {
        if (s <= state.step) spans[s].classList.add('is-active');
        else spans[s].classList.remove('is-active');
      }
    }

    function optionCard(item, selected, onClick) {
      var card = el('button', 'qf-ob-card' + (selected ? ' is-selected' : ''));
      card.type = 'button';
      var title = el('div', 'qf-ob-card-title');
      title.appendChild(el('span', null, item.label));
      title.appendChild(el('span', 'qf-ob-check', selected ? '✓' : ''));
      card.appendChild(title);
      if (item.blurb) card.appendChild(el('div', 'qf-ob-card-blurb', item.blurb));
      card.addEventListener('click', onClick);
      return card;
    }

    function render() {
      setProgress();
      backBtn.style.visibility = state.step === 0 ? 'hidden' : 'visible';
      nextBtn.textContent = state.step === STEPS - 1 ? 'Finish' : 'Continue';
      body.innerHTML = '';

      if (state.step === 0) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 1 of 4'));
        body.appendChild(el('h1', 'qf-ob-title', 'What do you haul most?'));
        body.appendChild(el('p', 'qf-ob-sub', 'Pick your main freight so we tailor the calculator to it — you can add the others later.'));
        var grid = el('div', 'qf-ob-cards is-two');
        VERTICALS.forEach(function (v) {
          grid.appendChild(optionCard(v, state.vertical === v.id, function () {
            state.vertical = v.id;
            if (!state.pricing) state.pricing = v.pricing; // sensible default
            render();
          }));
        });
        body.appendChild(grid);
      } else if (state.step === 1) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 2 of 4'));
        body.appendChild(el('h1', 'qf-ob-title', 'How do you price it?'));
        body.appendChild(el('p', 'qf-ob-sub', 'This sets your default. You can fine-tune every rate afterward.'));
        var pgrid = el('div', 'qf-ob-cards is-two');
        PRICING.forEach(function (p) {
          pgrid.appendChild(optionCard(p, state.pricing === p.id, function () {
            state.pricing = p.id;
            render();
          }));
        });
        body.appendChild(pgrid);
      } else if (state.step === 2) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 3 of 4'));
        body.appendChild(el('h1', 'qf-ob-title', 'Your main lane?'));
        body.appendChild(el('p', 'qf-ob-sub', 'Optional — the lane you run most. It helps us pre-tune examples. Skip either field if unsure.'));
        var lane = el('div', 'qf-ob-lane');
        var fromWrap = el('div', 'qf-ob-field');
        fromWrap.appendChild(el('label', null, 'From'));
        var fromIn = el('input', 'qf-ob-input');
        fromIn.type = 'text';
        fromIn.placeholder = 'e.g. Los Angeles, CA';
        fromIn.value = state.laneFrom;
        fromIn.addEventListener('input', function () { state.laneFrom = fromIn.value; });
        fromWrap.appendChild(fromIn);
        lane.appendChild(fromWrap);
        lane.appendChild(el('div', 'qf-ob-lane-arrow', '→'));
        var toWrap = el('div', 'qf-ob-field');
        toWrap.appendChild(el('label', null, 'To'));
        var toIn = el('input', 'qf-ob-input');
        toIn.type = 'text';
        toIn.placeholder = 'e.g. Phoenix, AZ';
        toIn.value = state.laneTo;
        toIn.addEventListener('input', function () { state.laneTo = toIn.value; });
        toWrap.appendChild(toIn);
        lane.appendChild(toWrap);
        body.appendChild(lane);
      } else if (state.step === 3) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 4 of 4'));
        body.appendChild(el('h1', 'qf-ob-title', 'Make it yours'));
        body.appendChild(el('p', 'qf-ob-sub', 'Optional — pick a brand color for your customer-facing calculator. You can refine the full brand later.'));
        var field = el('div', 'qf-ob-field');
        field.appendChild(el('label', null, 'Brand color'));
        var sw = el('div', 'qf-ob-swatches');
        SWATCHES.forEach(function (hex) {
          var b = el('button', 'qf-ob-swatch' + (state.brandColor === hex ? ' is-selected' : ''));
          b.type = 'button';
          b.style.background = hex;
          b.setAttribute('aria-label', 'Brand color ' + hex);
          b.addEventListener('click', function () { state.brandColor = hex; render(); });
          sw.appendChild(b);
        });
        field.appendChild(sw);
        body.appendChild(field);
      }

      // gate Continue on the required steps
      if (state.step === 0) nextBtn.disabled = !state.vertical;
      else if (state.step === 1) nextBtn.disabled = !state.pricing;
      else nextBtn.disabled = false;
      nextBtn.disabled = nextBtn.disabled || state.submitting;
    }

    function onNext() {
      if (state.step < STEPS - 1) { state.step++; render(); return; }
      finish(false);
    }

    function showError(msg) {
      var old = body.querySelector('.qf-ob-error');
      if (old) old.remove();
      body.appendChild(el('div', 'qf-ob-error', msg));
    }

    function finish(skip) {
      if (state.submitting) return;
      state.submitting = true;
      nextBtn.disabled = true;
      skipBtn.disabled = true;

      var payload;
      if (skip) {
        payload = { skip: true };
      } else {
        payload = {
          freightVertical: state.vertical,
          pricingMode: state.pricing,
          mainLane: { from: state.laneFrom.trim() || null, to: state.laneTo.trim() || null }
        };
        if (state.brandColor) payload.brand = { primaryColor: state.brandColor };
      }

      fetch('/api/tenant/onboarding/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) {
          if (!r.ok) throw new Error('apply failed (' + r.status + ')');
          return r.json().catch(function () { return {}; });
        })
        .then(function () {
          close();
          onDone();
        })
        .catch(function () {
          state.submitting = false;
          nextBtn.disabled = false;
          skipBtn.disabled = false;
          showError('Something went wrong saving your setup. Please try again, or Skip for now.');
        });
    }

    function close() {
      var o = document.getElementById('qf-ob-overlay');
      if (o && o.parentNode) o.parentNode.removeChild(o);
    }

    render();
  }

  window.QFOnboardingWizard = { open: open };
})();
