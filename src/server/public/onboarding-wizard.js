/* ─────────────────────────────────────────────────────────────────────────
   Post-signup guided onboarding wizard (client).

   A full-bleed overlay shown once, right after signup, gated by the SERVER
   flag `tenant.needsOnboarding` (set in app.js boot). Five short steps:
     1. What do you haul?   → freight vertical  (seeds the calculator)
     2. How do you price?   → pricing mode
     3. Main lane           → from / to
     4. Brand (optional)    → primary color / accent
     5. Confirm top 3 rates → tweak headline prices + copy the share link

   Leaving step 4 (brand) POSTs /api/tenant/onboarding/apply (reseeds the tenant
   with the picked vertical's subset when the seed is still pristine); on success
   it GETs /api/tenant/rate-cards (after the reseed ran) and shows the top-3
   confirm step. Step 5 "Finish" PUTs any edited rate rows, then closes and hands
   control back to the dashboard. "Skip for now" posts { skip:true } and falls
   straight through to the dashboard.

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
      rates: null,
      ratesLoaded: false,
      submitting: false
    };
    var STEPS = 5;

    // Which of ratePerMile / flatFee / minimumCharge is the "headline" price for
    // a seeded row — the first non-zero wins so we never surface an editable 0
    // that isn't actually part of this vertical's pricing model.
    var PRICE_FIELDS = ['ratePerMile', 'flatFee', 'minimumCharge'];
    var PRICE_FIELD_LABELS = { ratePerMile: '$ / mile', flatFee: 'Flat fee', minimumCharge: 'Minimum' };
    function primaryPriceField(row) {
      for (var i = 0; i < PRICE_FIELDS.length; i++) {
        if (Number(row[PRICE_FIELDS[i]])) return PRICE_FIELDS[i];
      }
      return 'ratePerMile';
    }
    function rowName(row) {
      if (row.label) return row.label;
      var s = row.service || 'Rate';
      return row.equipment ? s + ' · ' + row.equipment : s;
    }

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
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 1 of 5'));
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
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 2 of 5'));
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
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 3 of 5'));
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
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 4 of 5'));
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
      } else if (state.step === 4) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 5 of 5'));
        body.appendChild(el('h1', 'qf-ob-title', 'Confirm your top 3 rates'));
        body.appendChild(el('p', 'qf-ob-sub', 'These seeded from your pick. Tweak the headline price on each, then copy your calculator link to share it.'));

        var rows = state.rates || [];
        if (rows.length === 0) {
          body.appendChild(el('p', 'qf-ob-sub', 'No rates to confirm yet — you can add them from the dashboard.'));
        }
        var list = el('div', 'qf-ob-rates');
        rows.forEach(function (row) {
          var fieldKey = row.__field || primaryPriceField(row);
          row.__field = fieldKey;
          var rowEl = el('div', 'qf-ob-rate-row');

          var name = el('div', 'qf-ob-rate-name');
          name.appendChild(el('span', 'qf-ob-rate-label', rowName(row)));
          name.appendChild(el('span', 'qf-ob-rate-unit', PRICE_FIELD_LABELS[fieldKey] || fieldKey));
          rowEl.appendChild(name);

          var priceWrap = el('div', 'qf-ob-rate-price');
          priceWrap.appendChild(el('span', 'qf-ob-rate-money', '$'));
          var price = el('input', 'qf-ob-input');
          price.type = 'number';
          price.min = '0';
          price.step = 'any';
          price.inputMode = 'decimal';
          price.value = row[fieldKey] != null ? row[fieldKey] : 0;
          price.setAttribute('aria-label', rowName(row) + ' ' + (PRICE_FIELD_LABELS[fieldKey] || fieldKey));
          price.addEventListener('input', function () {
            var n = parseFloat(price.value);
            row[fieldKey] = isNaN(n) ? 0 : n;
            row.__dirty = true;
          });
          priceWrap.appendChild(price);
          rowEl.appendChild(priceWrap);
          list.appendChild(rowEl);
        });
        body.appendChild(list);

        // Share link (copy-to-clipboard). Prefer the hosted vanity URL; fall
        // back to the generic /w/<slug> embed route if it's not present.
        var me = opts.me || {};
        var t = me.tenant || {};
        var link = t.hostedUrl || new URL('/w/' + encodeURIComponent(t.slug || ''), location.origin).toString();

        var copyField = el('div', 'qf-ob-field');
        copyField.appendChild(el('label', null, 'Your calculator link'));
        var copyRow = el('div', 'qf-ob-copyrow');
        var linkIn = el('input', 'qf-ob-input');
        linkIn.type = 'text';
        linkIn.readOnly = true;
        linkIn.value = link;
        copyRow.appendChild(linkIn);
        var copyBtn = el('button', 'qf-ob-copy-btn', 'Copy link');
        copyBtn.type = 'button';
        copyBtn.addEventListener('click', function () {
          var done = function () {
            try { localStorage.setItem('qf-embed-viewed', '1'); } catch (e) {}
            copyBtn.textContent = 'Copied ✓';
            setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1500);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(link).then(done, function () {
              linkIn.focus(); linkIn.select(); done();
            });
          } else {
            // Graceful fallback when the async Clipboard API is unavailable.
            linkIn.focus(); linkIn.select();
            try { document.execCommand('copy'); } catch (e) {}
            done();
          }
        });
        copyRow.appendChild(copyBtn);
        copyField.appendChild(copyRow);
        body.appendChild(copyField);
      }

      // gate Continue on the required steps
      if (state.step === 0) nextBtn.disabled = !state.vertical;
      else if (state.step === 1) nextBtn.disabled = !state.pricing;
      else nextBtn.disabled = false;
      nextBtn.disabled = nextBtn.disabled || state.submitting;
    }

    function onNext() {
      if (state.submitting) return;
      // Leaving the brand step (step 4 of 5): commit the setup, then load the
      // reseeded rate cards and advance to the confirm-rates step.
      if (state.step === 3) { applyAndLoadRates(); return; }
      if (state.step < STEPS - 1) { state.step++; render(); return; }
      // Confirm-rates step: persist any edits, then finish.
      finishRates();
    }

    function showError(msg) {
      var old = body.querySelector('.qf-ob-error');
      if (old) old.remove();
      body.appendChild(el('div', 'qf-ob-error', msg));
    }

    // Step 4 → 5: POST the setup, then GET the (reseeded) rate cards. The rate
    // fetch MUST run AFTER apply so the pristine-seed reseed has already run.
    function applyAndLoadRates() {
      if (state.submitting) return;
      state.submitting = true;
      nextBtn.disabled = true;
      skipBtn.disabled = true;

      var payload = {
        freightVertical: state.vertical,
        pricingMode: state.pricing,
        mainLane: { from: state.laneFrom.trim() || null, to: state.laneTo.trim() || null }
      };
      if (state.brandColor) payload.brand = { primaryColor: state.brandColor };

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
          return fetch('/api/tenant/rate-cards', { headers: { Accept: 'application/json' } });
        })
        .then(function (r) {
          if (!r.ok) throw new Error('rate-cards load failed (' + r.status + ')');
          return r.json();
        })
        .then(function (data) {
          var rows = (data && data.rateCards) || [];
          rows.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
          state.rates = rows.slice(0, 3);
          state.ratesLoaded = true;
          state.submitting = false;
          skipBtn.disabled = false;
          state.step = 4;
          render();
        })
        .catch(function () {
          state.submitting = false;
          nextBtn.disabled = false;
          skipBtn.disabled = false;
          showError('Something went wrong saving your setup. Please try again, or Skip for now.');
        });
    }

    // Step 5 "Finish": PUT only the rows whose headline price was edited (never
    // delete a row — that would flip setup-status.rates back to false), then
    // close and hand control to the dashboard.
    function finishRates() {
      if (state.submitting) return;
      state.submitting = true;
      nextBtn.disabled = true;
      skipBtn.disabled = true;

      var puts = (state.rates || [])
        .filter(function (row) { return row.__dirty && row.__field; })
        .map(function (row) {
          var patch = {};
          patch[row.__field] = Number(row[row.__field]) || 0;
          return fetch('/api/tenant/rate-cards/' + row.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch)
          }).then(function (r) {
            if (!r.ok) throw new Error('save failed (' + r.status + ')');
          });
        });

      Promise.all(puts)
        .then(function () { close(); onDone(); })
        .catch(function () {
          state.submitting = false;
          nextBtn.disabled = false;
          skipBtn.disabled = false;
          showError('Couldn’t save your rate edits. Please try again, or Skip for now.');
        });
    }

    // Skip from any step: record the skip and fall straight through.
    function finish(skip) {
      if (state.submitting) return;
      state.submitting = true;
      nextBtn.disabled = true;
      skipBtn.disabled = true;

      fetch('/api/tenant/onboarding/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ skip: !!skip })
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
