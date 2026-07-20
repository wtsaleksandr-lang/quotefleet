/* ─────────────────────────────────────────────────────────────────────────
   Post-signup guided onboarding wizard (client).

   A full-bleed overlay shown once, right after signup, gated by the SERVER
   flag `tenant.needsOnboarding` (set in app.js boot). Four short steps:
     1. What do you haul?   → freight verticals (MULTI-select; seeds all of them)
     2. How do you price?   → pricing mode
     3. Where do you operate? → service area (nationwide US / nationwide CA /
                                cross-border / states+provinces / radius)
     4. Confirm top rates   → tweak headline prices + copy the share link

   Why multi-select: carriers routinely run several modes (dry van + reefer +
   flatbed is ordinary). Seeding a single "main" vertical left the calculator
   unable to quote most of their business.

   Why a service area, not a lane: carriers describe coverage as regions, states
   or provinces, or nationwide. Asking for one origin→destination lane implied we
   thought they ran a single truck on a single route. The area is stored for AI
   context / examples / carrier profile — it never blocks an incoming quote.

   There is no brand-color step: it isn't needed to produce a working calculator,
   and the dashboard already nudges for branding via setup-status.

   Leaving step 3 (service area) POSTs /api/tenant/onboarding/apply (reseeds the
   tenant with the UNION of the picked verticals when the seed is still pristine);
   on success it GETs /api/tenant/rate-cards (after the reseed ran) and shows the
   confirm step. Step 4 "Finish" PUTs any edited rate rows, then closes and hands
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

  // Where the carrier operates. Carriers describe coverage as regions, states /
  // provinces, or nationwide — asking for ONE origin→destination lane implied we
  // thought they ran a single truck on a single route.
  var AREAS = [
    { id: 'nationwide_us', label: 'Nationwide — USA', blurb: 'You run loads anywhere in the lower 48.' },
    { id: 'nationwide_ca', label: 'Nationwide — Canada', blurb: 'You run loads across the Canadian provinces.' },
    { id: 'cross_border', label: 'Cross-border US ⇄ Canada', blurb: 'You run both countries, including border crossings.' },
    { id: 'regions', label: 'Specific states / provinces', blurb: 'Pick the ones you cover — add or change them any time.' },
    { id: 'radius', label: 'Within a radius of my base', blurb: 'Regional work measured out from your home terminal.' }
  ];

  var US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
  var CA_PROVINCES = ['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'];

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
      // Multi-select: most carriers run more than one mode (dry van + reefer +
      // flatbed is ordinary). Seeding a single vertical left them with a
      // calculator that couldn't quote the rest of their business.
      verticals: [],
      pricing: null,
      areaKind: null,
      regions: [],
      radiusMiles: 300,
      baseCity: '',
      rates: null,
      ratesLoaded: false,
      submitting: false
    };
    // 4 steps: modes → pricing → service area → confirm rates. The brand-color
    // step was removed — it isn't needed to produce a working calculator, and
    // the dashboard already nudges for branding via setup-status.
    var STEPS = 4;

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
    // Lock the page behind the modal. The overlay is position:fixed and covers
    // the viewport, but the underlying dashboard shell stays in the document
    // flow — without this, a user could scroll the ~tens of px of page underflow
    // and reveal a sliver of the dashboard sidebar peeking below the overlay
    // (also what showed as a stray dark rectangle at the bottom of full-page
    // screenshots). The overlay itself scrolls internally (overflow-y:auto), so
    // locking the body never traps the wizard's own content.
    document.documentElement.classList.add('qf-ob-open');

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
        body.appendChild(el('h1', 'qf-ob-title', 'What do you haul?'));
        body.appendChild(el('p', 'qf-ob-sub', 'Select every mode you run — we seed rates for all of them, so your customers can quote anything you actually haul.'));
        var grid = el('div', 'qf-ob-cards is-two');
        VERTICALS.forEach(function (v) {
          var on = state.verticals.indexOf(v.id) !== -1;
          grid.appendChild(optionCard(v, on, function () {
            var i = state.verticals.indexOf(v.id);
            if (i === -1) state.verticals.push(v.id);
            else state.verticals.splice(i, 1);
            // Default the pricing model from the FIRST mode picked; the tenant
            // can still override it on the next step.
            if (state.verticals.length === 1) state.pricing = v.pricing;
            if (state.verticals.length === 0) state.pricing = null;
            render();
          }));
        });
        body.appendChild(grid);
        if (state.verticals.length > 1) {
          body.appendChild(el('p', 'qf-ob-sub', state.verticals.length + ' modes selected — rates will be seeded for each.'));
        }
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
        body.appendChild(el('h1', 'qf-ob-title', 'Where do you operate?'));
        body.appendChild(el('p', 'qf-ob-sub', 'Your coverage area. This tunes examples and your carrier profile — it never blocks a customer from requesting a quote.'));
        var agrid = el('div', 'qf-ob-cards');
        AREAS.forEach(function (a) {
          agrid.appendChild(optionCard(a, state.areaKind === a.id, function () {
            state.areaKind = a.id;
            render();
          }));
        });
        body.appendChild(agrid);

        if (state.areaKind === 'regions') {
          var rf = el('div', 'qf-ob-field');
          rf.appendChild(el('label', null, 'States / provinces you cover'));
          var chips = el('div', 'qf-ob-regions');
          var addGroup = function (codes, groupLabel) {
            chips.appendChild(el('div', 'qf-ob-region-group', groupLabel));
            var row = el('div', 'qf-ob-region-row');
            codes.forEach(function (code) {
              var on = state.regions.indexOf(code) !== -1;
              var c = el('button', 'qf-ob-region' + (on ? ' is-selected' : ''), code);
              c.type = 'button';
              c.setAttribute('aria-pressed', on ? 'true' : 'false');
              c.addEventListener('click', function () {
                var i = state.regions.indexOf(code);
                if (i === -1) state.regions.push(code);
                else state.regions.splice(i, 1);
                render();
              });
              row.appendChild(c);
            });
            chips.appendChild(row);
          };
          addGroup(US_STATES, 'United States');
          addGroup(CA_PROVINCES, 'Canada');
          rf.appendChild(chips);
          body.appendChild(rf);
        } else if (state.areaKind === 'radius') {
          var radWrap = el('div', 'qf-ob-lane');
          var milesWrap = el('div', 'qf-ob-field');
          milesWrap.appendChild(el('label', null, 'Radius (miles)'));
          var milesIn = el('input', 'qf-ob-input');
          milesIn.type = 'number';
          milesIn.min = '1';
          milesIn.max = '3000';
          milesIn.inputMode = 'numeric';
          milesIn.value = state.radiusMiles;
          milesIn.addEventListener('input', function () {
            var n = parseInt(milesIn.value, 10);
            state.radiusMiles = isNaN(n) ? 0 : n;
            gateNext();
          });
          milesWrap.appendChild(milesIn);
          radWrap.appendChild(milesWrap);
          radWrap.appendChild(el('div', 'qf-ob-lane-arrow', 'of'));
          var baseWrap = el('div', 'qf-ob-field');
          baseWrap.appendChild(el('label', null, 'Base city'));
          var baseIn = el('input', 'qf-ob-input');
          baseIn.type = 'text';
          baseIn.placeholder = 'e.g. Long Beach, CA';
          baseIn.value = state.baseCity;
          baseIn.addEventListener('input', function () { state.baseCity = baseIn.value; gateNext(); });
          baseWrap.appendChild(baseIn);
          radWrap.appendChild(baseWrap);
          body.appendChild(radWrap);
        }
      } else if (state.step === 3) {
        body.appendChild(el('div', 'qf-ob-kicker', 'Step 4 of 4'));
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

      gateNext();
    }

    // Gate Continue on the required steps. Split out of render() so the radius
    // inputs can re-gate on each keystroke without a full re-render (which would
    // steal focus from the field being typed in).
    function gateNext() {
      var blocked = false;
      if (state.step === 0) blocked = state.verticals.length === 0;
      else if (state.step === 1) blocked = !state.pricing;
      else if (state.step === 2) {
        if (!state.areaKind) blocked = true;
        else if (state.areaKind === 'regions') blocked = state.regions.length === 0;
        else if (state.areaKind === 'radius') {
          blocked = !(state.radiusMiles > 0) || state.baseCity.trim() === '';
        }
      }
      nextBtn.disabled = blocked || state.submitting;
    }

    function onNext() {
      if (state.submitting) return;
      // Leaving the service-area step (step 3 of 4): commit the setup, then load
      // the reseeded rate cards and advance to the confirm-rates step.
      if (state.step === 2) { applyAndLoadRates(); return; }
      if (state.step < STEPS - 1) { state.step++; render(); return; }
      // Confirm-rates step: persist any edits, then finish.
      finishRates();
    }

    function showError(msg) {
      var old = body.querySelector('.qf-ob-error');
      if (old) old.remove();
      body.appendChild(el('div', 'qf-ob-error', msg));
    }

    // Shape the service-area answer for the API — only the fields that belong to
    // the picked kind, so we never persist a stale radius from a switched choice.
    function buildServiceArea() {
      if (!state.areaKind) return null;
      if (state.areaKind === 'regions') {
        return { kind: 'regions', regions: state.regions.slice() };
      }
      if (state.areaKind === 'radius') {
        return {
          kind: 'radius',
          radiusMiles: state.radiusMiles,
          baseCity: state.baseCity.trim() || null
        };
      }
      return { kind: state.areaKind };
    }

    // Step 3 → 4: POST the setup, then GET the (reseeded) rate cards. The rate
    // fetch MUST run AFTER apply so the pristine-seed reseed has already run.
    function applyAndLoadRates() {
      if (state.submitting) return;
      state.submitting = true;
      nextBtn.disabled = true;
      skipBtn.disabled = true;

      var payload = {
        // Send BOTH: freightVerticals is the real selection, freightVertical is
        // the primary — kept so an older server still understands the request.
        freightVerticals: state.verticals.slice(),
        freightVertical: state.verticals[0],
        pricingMode: state.pricing,
        serviceArea: buildServiceArea()
      };

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
          state.step = 3; // confirm-rates is the last step (index 3 of 4)
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
      // Release the scroll-lock added on mount.
      document.documentElement.classList.remove('qf-ob-open');
    }

    render();
  }

  window.QFOnboardingWizard = { open: open };
})();
