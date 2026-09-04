/**
 * Client for the free heavy-haul / OOG delivered-cost estimator
 * (/tools/heavy-haul-quote).
 *
 * Server-rendered page + this one script. No framework, no build step, no
 * external request beyond the same-origin POST — the same shape as the other
 * free tools on the site.
 *
 * ── WHO THIS FORM IS FOR, AND WHAT THAT CHANGED ───────────────────────────
 *
 * Shippers, cargo owners and freight forwarders. They know the cargo and two
 * addresses and nothing else, so the form asks for the cargo and two addresses
 * and nothing else. Axle count, trailer class, route class and per-state
 * mileage are DERIVED by the engine from the weight and the dimensions
 * (src/calc/heavyHaul/market/derive.ts) rather than asked for — asking a
 * forwarder how many axles his carrier will run is asking him to do the
 * carrier's job. Every one of those inputs is still reachable, behind one
 * collapsed disclosure, because a forwarder with a negotiated rate has a real
 * number and a band is not one; anything entered there REPLACES ours and the
 * line says the basis is his.
 *
 * ── THE RENDERING RULES THIS FILE EXISTS TO ENFORCE, all honesty rules ────
 *
 *   1. EVERY CHARGE CARRIES ITS ACCURACY RATING, and the rating decides how
 *      the money is drawn. A CITED figure renders as ONE number with no range,
 *      because a statute states it. A BENCHMARK renders as a RANGE and never
 *      as a point, because the market has no point value. A REFUSED line
 *      carries no money at all and says what to do instead.
 *   2. BRIEF IN THE CARD, ARGUMENT BEHIND "READ MORE". The engine splits a
 *      ≤240-character `hover` from a long `detail` (market/accuracy.ts) and
 *      this renders them exactly that way — a hover card nobody finishes
 *      reading is worse than no hover card.
 *   3. A CITED FIGURE AND A FIGURE FROM THE USER'S OWN RATE ARE NEVER DRAWN
 *      THE SAME. Money from a rate the caller typed gets an italic amount and
 *      a dashed `YOUR RATE` pill; the subtotals stay apart.
 *   4. `amountUsd === null` IS NOT $0. It renders as "not priced" in warn
 *      colour with the reason beside it, and the total is marked PARTIAL.
 *   5. DETENTION AND LAYOVER ARE DISCLOSED AND NOT ADDED. At 13 axles
 *      detention is $605/hr against the $50–100 a shipper carries in his head.
 *      Visible, with its own rating, and outside the total.
 *   6. THE CONFIDENCE SCORE IS ALWAYS DECOMPOSED.
 *   7. DO NOT STACK CARDS. Related lines are GROUPED — seven permit rows are
 *      one claim and render as one row with the states one click inside it.
 *      That is what paid for putting a rating on every charge without the
 *      result block growing.
 */
(function () {
  'use strict';

  /** The API's own ceiling, mirrored so the Add button stops rather than 400s. */
  var MAX_LEGS = 20;

  var form = document.getElementById('hh-form');
  var legsEl = document.getElementById('hh-legs');
  var resultsEl = document.getElementById('hh-results');
  var tpl = document.getElementById('hh-leg-tpl');
  if (!form || !legsEl || !resultsEl || !tpl) return;

  var routeClass = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function usd(n) {
    if (n === null || n === undefined || typeof n !== 'number' || !isFinite(n)) return null;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function usd0(n) {
    if (n === null || n === undefined || typeof n !== 'number' || !isFinite(n)) return null;
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function num(id) {
    var el = document.getElementById(id);
    if (!el) return undefined;
    var raw = String(el.value == null ? '' : el.value).trim();
    if (raw === '') return undefined;
    var v = Number(raw);
    return isFinite(v) ? v : undefined;
  }

  function text(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    return String(el.value == null ? '' : el.value).trim();
  }

  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function setBusy(msg) {
    resultsEl.classList.remove('is-empty');
    resultsEl.innerHTML = '<div class="hh-card"><p class="hh-busy">' + esc(msg) + '</p></div>';
  }

  function setError(title, msg) {
    resultsEl.classList.remove('is-empty');
    resultsEl.innerHTML =
      '<div class="hh-note hh-note--error"><h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p></div>';
  }

  // ── UNITS ────────────────────────────────────────────────────────────────
  //
  // METRIC AND IMPERIAL, AND SWITCHING CONVERTS WHAT IS ALREADY TYPED.
  //
  // THE ROUND TRIP IS EXACT BY MEMORY, NOT BY ARITHMETIC — and that is the
  // whole design. Converting 120,000 lb to 54,431.08 kg and back through the
  // factor gives 120,000.04, because the displayed figure was rounded for a
  // human before it came back. So each field REMEMBERS the exact string it
  // held in the other system: switch away and back and you get your own
  // characters returned, not a re-derived approximation of them. Editing the
  // field in the new system drops the memo, because it is then stale, and the
  // next switch converts for real.
  //
  // Factors are the exact international definitions: 1 in = 0.0254 m and
  // 1 lb = 0.45359237 kg. The value POSTED is always imperial (inches and
  // pounds), rounded to four decimals so a metric entry cannot arrive as
  // 150.00000000000003 in.

  var LB_TO_KG = 0.45359237;
  var FT_TO_M = 0.3048;
  var IN_PER_FT = 12;
  var unitSystem = 'imperial';

  function unitFields() {
    return document.querySelectorAll('#hh-form input[data-unit]');
  }

  /** Trim a converted figure to a human number of places, with no trailing zeros. */
  function trimNum(value, places) {
    return String(Number(value.toFixed(places)));
  }

  function convert(kind, value, toSystem) {
    if (kind === 'weight') return toSystem === 'metric' ? value * LB_TO_KG : value / LB_TO_KG;
    return toSystem === 'metric' ? value * FT_TO_M : value / FT_TO_M;
  }

  function setUnits(next) {
    if (next !== 'imperial' && next !== 'metric') return;
    var previous = unitSystem;
    var fields = unitFields();
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      var kind = el.getAttribute('data-unit');
      var raw = String(el.value == null ? '' : el.value).trim();
      if (previous !== next) {
        if (raw === '') {
          // Nothing typed: there is nothing to convert and nothing to remember.
          delete el.dataset.alt;
          delete el.dataset.altFor;
        } else if (el.dataset.altFor === next && el.dataset.alt !== undefined) {
          // We have been here before and the field has not been edited since.
          // Hand back the exact characters, and remember the ones we are
          // leaving so the trip back is exact too.
          var restored = el.dataset.alt;
          el.dataset.alt = raw;
          el.dataset.altFor = previous;
          el.value = restored;
        } else {
          var n = Number(raw);
          if (isFinite(n)) {
            el.dataset.alt = raw;
            el.dataset.altFor = previous;
            // PRECISION IS NOT COSMETIC HERE. 14.5 ft is 4.4196 m, and
            // displaying that as 4.42 m is 0.02 in of height when it comes
            // back — enough to cross a state's fee band and move the quote.
            // Grams and tenths of a millimetre are both absurd to read and
            // cheap to carry, and `trimNum` drops the trailing zeros anyway.
            el.value = trimNum(convert(kind, n, next), kind === 'weight' ? 3 : 4);
          }
        }
      }
      var label = el.parentNode.querySelector('.hh-lab');
      var title = el.getAttribute('data-' + next);
      if (label && title) label.textContent = title;
    }
    unitSystem = next;
    var buttons = document.querySelectorAll('#hh-units .hh-pill');
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].setAttribute(
        'aria-pressed',
        buttons[j].getAttribute('data-units') === next ? 'true' : 'false',
      );
    }
  }

  /**
   * Round the canonical imperial value before it is posted.
   *
   * A metric entry arrives as 173.99999999999997 in or 119999.99999 lb, and
   * sending that would price a load a hair different from the identical one
   * typed in feet — which the permit engine can and does notice at a fee band.
   * A hundredth of an inch and a hundredth of a pound are both far finer than
   * anything a permit is written to, so snapping there is lossless in practice
   * and makes the two entry paths produce the same quote.
   */
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Cargo weight in POUNDS, whatever system it was typed in. */
  function weightLbs() {
    var v = num('hh-weight');
    if (v === undefined) return undefined;
    return unitSystem === 'metric' ? round2(v / LB_TO_KG) : round2(v);
  }

  /** A dimension in INCHES, whatever system it was typed in. */
  function dimensionIn(id) {
    var v = num(id);
    if (v === undefined) return undefined;
    return unitSystem === 'metric' ? round2((v / FT_TO_M) * IN_PER_FT) : round2(v * IN_PER_FT);
  }

  // ── mileage rows ─────────────────────────────────────────────────────────

  function legRows() {
    return legsEl.querySelectorAll('.hh-leg');
  }

  function syncCap() {
    var cap = document.getElementById('hh-cap');
    var add = document.getElementById('hh-add');
    var atCap = legRows().length >= MAX_LEGS;
    if (add) add.disabled = atCap;
    if (cap) cap.hidden = !atCap;
  }

  function addLeg(state, miles) {
    if (legRows().length >= MAX_LEGS) return null;
    var node = tpl.content.firstElementChild.cloneNode(true);
    legsEl.appendChild(node);
    if (state) node.querySelector('.hh-leg-state').value = state;
    if (miles !== undefined && miles !== null) node.querySelector('.hh-leg-miles').value = String(miles);
    node.querySelector('.hh-legdrop').addEventListener('click', function () {
      node.remove();
      syncCap();
    });
    syncCap();
    return node;
  }

  function readLegs() {
    var out = [];
    var rows = legRows();
    for (var i = 0; i < rows.length; i++) {
      var state = rows[i].querySelector('.hh-leg-state').value;
      var rawMiles = rows[i].querySelector('.hh-leg-miles').value;
      // A BLANK ROW IS AN EMPTY ROW, not a state at zero miles. Both blank is
      // skipped silently; one blank is a real error the user must see.
      if (!state && String(rawMiles).trim() === '') continue;
      if (!state) return { error: 'A mileage row has miles but no state. Pick the state or remove the row.' };
      var miles = Number(rawMiles);
      if (String(rawMiles).trim() === '' || !isFinite(miles) || miles <= 0) {
        return {
          error:
            'Enter the in-state mileage for ' + state + ' as a positive number — a leg of 0 mi is not a state the load crosses.',
        };
      }
      out.push({ state: state, miles: miles });
    }
    return { legs: out };
  }

  /** Open the override disclosure — used when something inside it needs seeing. */
  function openAdvanced() {
    var adv = document.getElementById('hh-adv');
    if (adv && !adv.open) adv.open = true;
  }

  // ── request ──────────────────────────────────────────────────────────────

  function buildRequest() {
    var weight = weightLbs();
    if (weight === undefined || weight <= 0) {
      return {
        error:
          'Enter the gross weight of the load — every state prices the overweight permit from it, and it is what tells us the trailer and the axle count.',
      };
    }
    var origin = text('hh-origin');
    var destination = text('hh-destination');
    if (!origin || !destination) {
      return {
        error:
          'Enter a full US street address at each end — number, street, city, state and ZIP. The geocoder matches street addresses, not landmarks or bare city names.',
      };
    }

    var parsedLegs = readLegs();
    if (parsedLegs.error) return { error: parsedLegs.error };

    var cargo = { grossWeightLbs: weight };
    var w = dimensionIn('hh-width');
    var h = dimensionIn('hh-height');
    var l = dimensionIn('hh-length');
    var axles = num('hh-axles');
    if (w !== undefined) cargo.widthIn = w;
    if (h !== undefined) cargo.heightIn = h;
    if (l !== undefined) cargo.overallLengthIn = l;
    // DERIVED UNLESS SUPPLIED. Both of these live behind the disclosure; a
    // caller who fills one wins over the engine's inference and the row says so.
    if (axles !== undefined) cargo.axleCount = axles;
    if (routeClass) cargo.routeClass = routeClass;

    var rates = {};
    var lh = num('hh-linehaul');
    var lhMin = num('hh-linehaul-min');
    var pcMile = num('hh-pc-mile');
    var pcDay = num('hh-pc-day');
    var pcDays = num('hh-pc-days');
    var pcMin = num('hh-pc-min');
    var fuelPeg = num('hh-fuel-peg');
    var fuelMpg = num('hh-fuel-mpg');
    if (lh !== undefined) rates.linehaulUsdPerMile = lh;
    if (lhMin !== undefined) rates.linehaulMinimumUsd = lhMin;
    if (pcMile !== undefined) rates.pilotCarUsdPerMile = pcMile;
    if (pcDay !== undefined) rates.pilotCarUsdPerDay = pcDay;
    if (pcDays !== undefined) rates.pilotCarDaysPerState = pcDays;
    if (pcMin !== undefined) rates.pilotCarMinimumPerState = pcMin;
    // The diesel PRICE stays sourced either way; these two are the assumptions
    // inside the surcharge, and the note says whose they are.
    if (fuelPeg !== undefined) rates.fuelPegUsdPerGal = fuelPeg;
    if (fuelMpg !== undefined) rates.fuelMpg = fuelMpg;

    // THE CHECKBOX IS "PROVIDED"; THE ENGINE FLAG IS "PRICE IT". They are
    // inverses, and the inversion lives here rather than in a confusingly
    // negative label. Ticked (the default) means somebody at that end has the
    // crane, so no crane is priced.
    var market = {
      loadingAtOrigin: !checked('hh-load-origin'),
      loadingAtDestination: !checked('hh-load-destination'),
    };
    if (checked('hh-tarping')) market.tarping = true;
    if (checked('hh-securement')) market.securementAllowance = true;
    var declared = num('hh-value');
    if (declared !== undefined) market.declaredValueUsd = declared;

    var body = {
      cargo: cargo,
      originAddress: origin,
      destinationAddress: destination,
      market: market,
    };
    if (parsedLegs.legs.length > 0) body.legs = parsedLegs.legs;
    if (Object.keys(rates).length > 0) body.rates = rates;
    return { body: body };
  }

  // ── THE ACCURACY RATING ──────────────────────────────────────────────────

  var TIER_LABELS = {
    cited: 'CITED',
    indexed: 'INDEXED',
    benchmark: 'BENCHMARK',
    refused: 'NOT PRICED',
  };

  var cardSeq = 0;

  /**
   * The tier pill and its hover card.
   *
   * The pill IS the button. Brief text in the card; the argument, the sample
   * and what the figure excludes are behind one subtle "read more", because
   * the engine already separates `hover` (≤240 chars, enforced) from `detail`
   * and rendering them as one block would waste that separation.
   *
   * A CITED pill carries no ± — a cited figure has no band and
   * `citedCarriesNoBand` in market/accuracy.ts fails the quote if one appears.
   */
  function tierChip(acc) {
    if (!acc) return '';
    var id = 'hh-card-' + ++cardSeq;
    var band = acc.tier === 'cited' || acc.tier === 'refused' ? '' : ' ±' + acc.bandPct + '%';
    var meta = [];
    if (acc.sample) meta.push('Sample: ' + acc.sample);
    if (acc.asOf) meta.push('Data dated ' + acc.asOf);
    var sources = (acc.marketSources || [])
      .map(function (src) {
        var name = src.publisher ? src.publisher + ' — ' + (src.title || '') : src.title || src.url || '';
        return src.url
          ? '<li><a href="' + esc(src.url) + '" rel="nofollow noopener" target="_blank">' + esc(name) + '</a></li>'
          : '<li>' + esc(name) + '</li>';
      })
      .join('');

    return (
      '<span class="hh-tierwrap">' +
      '<button type="button" class="hh-tier hh-tier--' +
      esc(acc.tier) +
      '" aria-expanded="false" aria-controls="' +
      id +
      '">' +
      esc(TIER_LABELS[acc.tier] || acc.tier) +
      esc(band) +
      '</button>' +
      '<div class="hh-hover" id="' +
      id +
      '" role="note"><p class="hh-hbrief">' +
      esc(acc.hover) +
      '</p>' +
      (meta.length > 0 ? '<p class="hh-hmeta">' + esc(meta.join(' · ')) + '</p>' : '') +
      (acc.detail
        ? '<button type="button" class="hh-more" aria-expanded="false">Read more</button>' +
          '<div class="hh-hdetail" hidden><p>' +
          esc(acc.detail) +
          '</p>' +
          (sources ? '<ul>' + sources + '</ul>' : '') +
          '</div>'
        : '') +
      '</div></span>'
    );
  }

  /**
   * The money cell.
   *
   * A BENCHMARK IS ALWAYS A RANGE. Presenting a market band as a point value
   * is the exact dishonesty the whole rating exists to prevent, so the range
   * is the headline and the single figure below it is labelled as nothing more
   * than the number the delivered total actually summed.
   *
   * A CITED figure is one number with NO range, because a statute states it.
   */
  function amountCell(line) {
    if (line.amountUsd === null || line.amountUsd === undefined) {
      return '<span class="hh-lamt is-nil">not priced</span>';
    }
    var acc = line.accuracy;
    if (acc && acc.tier === 'benchmark' && acc.lowUsd !== null && acc.highUsd !== null) {
      return (
        '<span class="hh-lamt"><span class="rng">' +
        esc(usd0(acc.lowUsd)) +
        ' – ' +
        esc(usd0(acc.highUsd)) +
        '</span><span class="mid">' +
        esc(usd(line.amountUsd)) +
        ' in the total</span></span>'
      );
    }
    return (
      '<span class="hh-lamt' +
      (line.basis === 'yours' ? ' is-mine' : '') +
      '">' +
      esc(usd(line.amountUsd)) +
      '</span>'
    );
  }

  function basisTag(line) {
    if (line.basis === 'yours') {
      return '<span class="hh-tag">Your rate — not a figure we source</span>';
    }
    if (line.basis === 'derived') {
      return '<span class="hh-tag hh-tag--derived">EIA index · our peg &amp; mpg</span>';
    }
    return '';
  }

  function renderLine(line) {
    return (
      '<li class="hh-line"><span class="hh-lname">' +
      esc(line.name) +
      '</span>' +
      amountCell(line) +
      '<span class="hh-lmeta">' +
      tierChip(line.accuracy) +
      basisTag(line) +
      '</span>' +
      (line.note ? '<p class="hh-ln">' + esc(line.note) + '</p>' : '') +
      '</li>'
    );
  }

  // ── GROUPING — related lines are one claim, not seven rows ───────────────

  var GROUPS = [
    { name: 'State OS/OW permits', kinds: ['permit'] },
    { name: 'Line haul', kinds: ['linehaul', 'minimum'] },
    { name: 'Fuel surcharge', kinds: ['fuel'] },
    { name: 'Escorts and pilot cars', kinds: ['escort'] },
    { name: 'Accessorials', kinds: ['accessorial'] },
  ];

  function sum(values) {
    var t = 0;
    for (var i = 0; i < values.length; i++) t += values[i];
    return Math.round(t * 100) / 100;
  }

  function renderGroup(name, lines) {
    if (lines.length === 0) return '';
    if (lines.length === 1) return renderLine(lines[0]);

    var priced = lines.filter(function (l) {
      return typeof l.amountUsd === 'number';
    });
    var unpriced = lines.length - priced.length;
    var total = sum(
      priced.map(function (l) {
        return l.amountUsd;
      }),
    );

    // A grouped BENCHMARK subtotal is still a band, so it renders as one.
    //
    // THE TIER IS THE TEST, NOT THE PRESENCE OF A LOW AND A HIGH — and getting
    // that wrong printed "$1,223 – $1,223" over the seven cited permit fees on
    // the reference lane. A CITED row legitimately carries low === high ===
    // the figure (`citedCarriesNoBand` accepts both that form and no band at
    // all), so keying on "has a low and a high" collapses a statute into a
    // range of width zero, which is exactly the rendering a cited figure is
    // supposed to be free of.
    var everyBanded =
      priced.length > 0 &&
      priced.every(function (l) {
        return (
          l.accuracy &&
          l.accuracy.tier === 'benchmark' &&
          l.accuracy.lowUsd !== null &&
          l.accuracy.highUsd !== null
        );
      });
    var amount;
    if (priced.length === 0) {
      amount = '<span class="hh-lamt is-nil">not priced</span>';
    } else if (everyBanded) {
      amount =
        '<span class="hh-lamt"><span class="rng">' +
        esc(
          usd0(
            sum(
              priced.map(function (l) {
                return l.accuracy.lowUsd;
              }),
            ),
          ),
        ) +
        ' – ' +
        esc(
          usd0(
            sum(
              priced.map(function (l) {
                return l.accuracy.highUsd;
              }),
            ),
          ),
        ) +
        '</span><span class="mid">' +
        esc(usd(total)) +
        ' in the total</span></span>';
    } else {
      amount = '<span class="hh-lamt">' + esc(usd(total)) + '</span>';
    }

    // ONE PILL ONLY WHEN THE WHOLE GROUP MAKES THE SAME KIND OF CLAIM, and it
    // is a LABEL rather than a card.
    //
    // Mixed tiers get no group pill at all: a pill over mixed evidence would be
    // a claim nothing in the group actually makes. And even a uniform group
    // gets no card and no band, because the band is per component — the
    // accessorials group spans a +-45% permit-service fee and a +-25% route
    // survey, and borrowing one member's hover text for the whole group would
    // caption five charges with the evidence behind one of them. Every member
    // keeps its own pill, its own band and its own card, one click inside.
    var tiers = {};
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].accuracy) tiers[lines[i].accuracy.tier] = lines[i].accuracy;
    }
    var keys = Object.keys(tiers);
    var groupChip =
      keys.length === 1
        ? '<span class="hh-tier is-static hh-tier--' +
          esc(keys[0]) +
          '">' +
          esc(TIER_LABELS[keys[0]] || keys[0]) +
          '</span>'
        : '';

    return (
      '<li class="hh-line"><span class="hh-lname">' +
      esc(name) +
      '</span>' +
      amount +
      '<span class="hh-lmeta">' +
      groupChip +
      (unpriced > 0
        ? '<span class="hh-nil">' + unpriced + ' not priced</span>'
        : '') +
      '</span>' +
      '<details class="hh-sub"><summary>' +
      lines.length +
      ' lines — every one with its own rating</summary><ul class="hh-lines">' +
      lines.map(renderLine).join('') +
      '</ul></details></li>'
    );
  }

  function renderBreakdown(q) {
    var used = {};
    var rows = '';
    for (var g = 0; g < GROUPS.length; g++) {
      var group = GROUPS[g];
      var members = q.lines.filter(function (l) {
        return group.kinds.indexOf(l.kind) !== -1;
      });
      for (var m = 0; m < members.length; m++) used[q.lines.indexOf(members[m])] = true;
      rows += renderGroup(group.name, members);
    }
    var leftovers = q.lines.filter(function (l, i) {
      return !used[i];
    });
    rows += leftovers.map(renderLine).join('');

    var total =
      q.deliveredUsd === null
        ? ''
        : '<li class="hh-line hh-tot"><span class="hh-lname">' +
          (q.partial ? 'Partial total — see what is missing above' : 'Delivered cost estimate') +
          '</span><span class="hh-lamt">' +
          esc(usd(q.deliveredUsd)) +
          '</span></li>';

    var legendTpl = document.getElementById('hh-tier-legend');
    var legend = legendTpl ? legendTpl.innerHTML : '';

    return (
      '<div class="hh-linesbox"><h3>The breakdown</h3><ul class="hh-lines">' +
      rows +
      total +
      '</ul>' +
      legend +
      '</div>'
    );
  }

  /**
   * REAL COSTS THAT ARE DISCLOSED AND NOT ADDED.
   *
   * Detention on a 13-axle rig is $605/hr and most shippers expect $50–100.
   * Adding a guess at the hours would inflate every quote on the page; leaving
   * it off entirely is how somebody gets a $2,400 surprise from four hours at
   * a receiver. So it is on the page, with its own rating, outside the total.
   */
  function renderRisk(q) {
    if (!q.riskLines || q.riskLines.length === 0) return '';
    var rows = q.riskLines
      .map(function (r) {
        return renderLine({
          name: r.name,
          amountUsd: r.headlineUsd,
          basis: 'market',
          accuracy: r.accuracy,
        });
      })
      .join('');
    return (
      '<div class="hh-risk" id="hh-risk"><h3>Disclosed, and NOT in the total</h3>' +
      '<p>Both of these are real, published and outside the estimate above, because the HOURS are set by whoever keeps the truck waiting and cannot be predicted. They are here so the number does not surprise you.</p>' +
      '<ul class="hh-lines">' +
      rows +
      '</ul></div>'
    );
  }

  /**
   * WHAT THE ENGINE WORKED OUT RATHER THAN ASKED FOR. Each says the fact it
   * was derived from, so an inference is never presented as an input.
   */
  function renderDerived(q) {
    if (!q.derived) return '';
    var d = q.derived;
    var items = [
      { k: 'Trailer class', v: d.equipmentClass },
      { k: 'Axles', v: d.axleCount },
      { k: 'Weight of the piece (lb)', v: d.cargoWeightLbs },
      { k: 'Route class', v: d.routeClass },
    ].filter(function (row) {
      return row.v;
    });
    if (items.length === 0) return '';
    var lis = items
      .map(function (row) {
        var val = row.v;
        return (
          '<li><strong>' +
          esc(row.k) +
          ': ' +
          esc(typeof val.value === 'number' ? val.value.toLocaleString('en-US') : val.value) +
          '</strong> — ' +
          (val.origin === 'derived' ? 'derived from ' + esc(val.from) + '. ' : '') +
          esc(val.note) +
          '</li>'
        );
      })
      .join('');
    return (
      '<details class="hh-fold" id="hh-derived"><summary>What we worked out from your cargo instead of asking (' +
      items.length +
      ')</summary><ul>' +
      lis +
      '</ul>' +
      (d.routeClassNote ? '<p class="hh-ln">' + esc(d.routeClassNote) + '</p>' : '') +
      '</details>'
    );
  }

  // ── rendering ────────────────────────────────────────────────────────────

  function renderTotal(q) {
    var value = q.deliveredUsd === null ? 'Not priced' : usd(q.deliveredUsd);
    var range =
      q.lowUsd === null || q.highUsd === null
        ? ''
        : '<p class="hh-trange">' + esc(usd0(q.lowUsd)) + ' – ' + esc(usd0(q.highUsd)) + ' at ' + esc(q.confidence.label) + ' confidence (±' + Math.round(q.confidence.band * 100) + '%)</p>';
    var partial = q.partial
      ? '<p class="hh-tpart">Partial — not a full delivered cost</p>'
      : '';
    var sub = q.partial
      ? '<p class="hh-tsub">This is the sum of what we COULD price, and it is missing: ' +
        esc(q.partialBecause.join('; ')) +
        '.</p>'
      : '<p class="hh-tsub">Cited state permit fees, a market band for the move itself, and an EIA-index fuel surcharge. No margin is included, and detention and layover are disclosed below rather than added.</p>';

    return (
      '<div class="hh-total' +
      (q.partial ? ' hh-total--partial' : '') +
      '" id="hh-total"><p class="hh-tl">Delivered cost estimate</p><p class="hh-tv">' +
      esc(value) +
      '</p>' +
      range +
      partial +
      sub +
      renderKpi(q) +
      renderSplit(q) +
      '</div>'
    );
  }

  function renderKpi(q) {
    var c = q.confidence;
    var visible = c.findings.slice(0, 3);
    var rest = c.findings.slice(3);

    var items = visible
      .map(function (f) {
        return (
          '<li><span class="pts">−' + f.points + '</span><span class="lab">' + esc(f.headline) + '</span></li>'
        );
      })
      .join('');
    if (items === '') {
      items =
        '<li><span class="pts">—</span><span class="lab">every component priced from a cited figure or a rate you supplied</span></li>';
    }

    var all = c.findings
      .map(function (f) {
        return (
          '<li><span class="hh-ground">' +
          esc(f.grounding) +
          '</span><strong>−' +
          f.points +
          ' · ' +
          esc(f.headline) +
          '.</strong> ' +
          esc(f.detail) +
          ' <em>Keys on: ' +
          esc(f.source) +
          '.</em></li>'
        );
      })
      .join('');

    var fold =
      c.findings.length === 0
        ? ''
        : '<details class="hh-whyfold" id="hh-whyfold"><summary>Every deduction, in full (' +
          c.findings.length +
          ')' +
          (rest.length > 0 ? ' — ' + rest.length + ' not shown above' : '') +
          '</summary><ol>' +
          all +
          '</ol></details>';

    return (
      '<div class="hh-kpi" id="hh-kpi"><div class="hh-kpihead"><span class="hh-kpiscore" id="hh-score">' +
      c.score +
      '%</span><span class="hh-kpilabel hh-kpilabel--' +
      esc(c.label) +
      '">' +
      esc(c.label) +
      ' confidence</span></div><div class="hh-bar hh-bar--' +
      esc(c.label) +
      '" role="img" aria-label="Confidence ' +
      c.score +
      ' out of 100"><span style="width:' +
      c.score +
      '%"></span></div><ul class="hh-why">' +
      items +
      '</ul>' +
      fold +
      '</div>'
    );
  }

  function renderSplit(q) {
    // A subtotal of 0 that has an UNPRICED line of the same basis is not zero
    // money — it is money we could not price. Printing "$0.00" under a caption
    // describing what sourced money is, is the one place this page would break
    // its own null-is-not-zero rule, and it is the part a dispatcher screenshots.
    function amountFor(total, basis) {
      var unpriced = q.lines.some(function (l) {
        return l.basis === basis && l.amountUsd === null;
      });
      return total === 0 && unpriced ? 'Not priced' : usd(total);
    }
    // The MARKET tile only appears when there is market money to show. It is a
    // fourth column rather than a re-labelling of an existing one because a
    // market band and a cited statute fee are different claims, and the whole
    // design of this page is that two different claims never read the same.
    var marketTile =
      q.subtotalMarketUsd > 0 || q.lines.some(function (l) { return l.basis === 'market'; })
        ? '<div class="hh-tile"><span class="k">Market estimate</span><span class="v">' +
          esc(amountFor(q.subtotalMarketUsd, 'market')) +
          '</span><span class="n">Line haul, pilot cars and accessorials from published market data. A band, never a quote — your own rates replace it.</span></div>'
        : '';
    return (
      '<div class="hh-split"><div class="hh-tile"><span class="k">Sourced</span><span class="v">' +
      esc(amountFor(q.subtotalSourcedUsd, 'sourced')) +
      '</span><span class="n">State permit fees and published police-escort floors, each cited to a statute or fee schedule. A fee here binds whoever hauls the load, and carries no range.</span></div>' +
      '<div class="hh-tile is-yours"><span class="k">Your rates</span><span class="v">' +
      esc(amountFor(q.subtotalYourRatesUsd, 'yours')) +
      '</span><span class="n">Line haul and pilot cars, computed from rates you entered. Not figures we source.</span></div>' +
      '<div class="hh-tile"><span class="k">Index-derived</span><span class="v">' +
      esc(amountFor(q.subtotalDerivedUsd, 'derived')) +
      '</span><span class="n">Fuel surcharge: EIA diesel price through a model whose peg and mpg are our assumptions.</span></div>' +
      marketTile +
      '</div>'
    );
  }

  /**
   * THE LANE AND THE MILEAGE, IN ONE NOTE. They were two cards and they are one
   * claim — where the load starts and ends, and how far that was measured to be.
   * Merging them is one of the several places this rebuild bought back the
   * height that the per-charge accuracy rating spends.
   */
  function renderLane(res) {
    var q = res.quote;
    var m = q.mileage;
    var cross = '';
    if (m.crossCheck) {
      var cc = m.crossCheck;
      cross =
        '<p>Cross-check: your filed ' +
        Math.round(cc.filedMiles).toLocaleString('en-US') +
        ' mi against a ' +
        Math.round(cc.scalarEstimateMiles).toLocaleString('en-US') +
        ' mi straight-line estimate — ' +
        (cc.differencePct > 0 ? '+' : '') +
        cc.differencePct +
        '%. ' +
        (cc.disagrees
          ? 'That is wide enough to be worth re-reading for a transposed digit. Nothing was changed.'
          : 'Consistent. Nothing was changed either way — the filed figures are what priced the permits.') +
        '</p>';
    }
    return (
      '<div class="hh-note"><h3>The lane we measured — ' +
      esc(m.tierLabel) +
      '</h3><p>Pickup matched to <strong>' +
      esc(res.lane.origin.matched) +
      '</strong>; delivery matched to <strong>' +
      esc(res.lane.destination.matched) +
      '</strong>. Check them — an address the US Census geocoder cannot place is refused rather than matched to somewhere else.</p><p class="hh-clamp">' +
      esc(m.notes.join(' ')) +
      '</p>' +
      cross +
      '</div>'
    );
  }

  function renderCorridor(res) {
    var q = res.quote;
    if (!q.corridor || q.corridor.states.length === 0) return '';
    var states = q.corridor.states;
    var chips = states
      .map(function (s) {
        var cls = !s.covered
          ? 'hh-chip hh-chip--none'
          : s.likelihood === 'endpoint'
            ? 'hh-chip hh-chip--endpoint'
            : s.likelihood === 'crosses'
              ? 'hh-chip hh-chip--likely'
              : 'hh-chip';
        var how =
          s.likelihood === 'endpoint'
            ? 'one end of the lane is here'
            : s.likelihood === 'crosses'
              ? 'the straight line runs through this state'
              : 'the straight line only clips this state';
        var title =
          (res.corridorNames[s.stateCode] || s.stateCode) +
          ' — ' +
          how +
          (s.covered ? '; fee schedule on file' : '; NO fee schedule on file');
        return '<span class="' + cls + '" title="' + esc(title) + '">' + esc(s.stateCode) + '</span>';
      })
      .join('');
    // A FIXED 4-COLUMN GRID CANNOT ORPHAN unless the count leaves one on the
    // last row. Pad to a multiple of 4 with invisible chips so it never does.
    var pad = (4 - (states.length % 4)) % 4;
    var padding = '';
    for (var i = 0; i < pad; i++) padding += '<span class="hh-chip hh-chip--pad" aria-hidden="true">·</span>';

    return (
      '<div class="hh-corridor" id="hh-corridor"><h3>Which states to give us miles for</h3><p>' +
      esc(q.corridor.disclaimer) +
      '</p><div class="hh-chips">' +
      chips +
      padding +
      '</div><button type="button" class="btn btn-secondary" id="hh-fill-corridor">Add these states to the mileage rows</button></div>'
    );
  }

  function renderPermitDetail(q) {
    if (!q.permits) return '';
    var states = q.permits.jurisdictions
      .map(function (j) {
        var lines = j.lines
          .map(function (l) {
            return (
              '<li>' +
              esc(l.name) +
              ' — ' +
              (l.amountUsd === null ? 'not priceable' : esc(usd(l.amountUsd))) +
              (l.note ? '. ' + esc(l.note) : '') +
              '</li>'
            );
          })
          .join('');
        var notes = j.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
        var cites = j.sources
          .map(function (s) {
            return (
              '<li>' +
              esc(s.publisher || '') +
              ' — ' +
              (s.url ? '<a href="' + esc(s.url) + '" rel="nofollow noopener" target="_blank">' + esc(s.title || s.url) + '</a>' : esc(s.title || '')) +
              (s.revisedOn ? ' (revised ' + esc(s.revisedOn) + ')' : '') +
              '</li>'
            );
          })
          .join('');
        return (
          '<li><strong>' +
          esc(j.jurisdictionName) +
          ' — ' +
          (j.subtotalUsd === null ? 'not priceable' : esc(usd(j.subtotalUsd))) +
          (j.requiresManualReview ? ' · flagged for manual review' : '') +
          '</strong><ul>' +
          lines +
          '</ul>' +
          (notes ? '<ul>' + notes + '</ul>' : '') +
          (cites ? '<ul>' + cites + '</ul>' : '') +
          '</li>'
        );
      })
      .join('');
    return (
      '<details class="hh-fold" id="hh-permit-detail"><summary>Every permit line and the statute behind it (' +
      q.permits.jurisdictions.length +
      ' state' +
      (q.permits.jurisdictions.length === 1 ? '' : 's') +
      ')</summary><div class="hh-tablewrap"><ul>' +
      states +
      '</ul></div></details>'
    );
  }

  function renderNotIncluded(q) {
    var items = q.notIncluded
      .map(function (n) {
        return '<li><strong>' + esc(n.item) + '.</strong> ' + esc(n.why) + '</li>';
      })
      .join('');
    return (
      '<details class="hh-fold" id="hh-notincluded"><summary>What this estimate never includes (' +
      q.notIncluded.length +
      ')</summary><ul>' +
      items +
      '</ul></details>'
    );
  }

  /**
   * WHERE TO GET THE PILOT CAR. The quote can say a state requires one; it
   * cannot say who can legally run it, and that is the sentence a dispatcher
   * actually has to finish. The href is built SERVER-side and pre-filtered to
   * the states that require an escort and to the ones that issue a certificate
   * — filtering on a certificate a state does not issue returns nothing.
   * Renders nothing at all when no escort is required.
   */
  function renderEscortDirectory(res) {
    if (!res.escortDirectoryHref) return '';
    return (
      '<div class="hh-note"><h3>Finding the pilot cars this lane needs</h3><p>' +
      '<a href="' +
      esc(res.escortDirectoryHref) +
      '">Escort operators who cover these states, filtered to the ones that require a certificate</a>. ' +
      'Records there are opt-in and self-reported unless the listing says we checked something, and each one says which.</p></div>'
    );
  }

  function render(res) {
    var q = res.quote;
    cardSeq = 0;
    resultsEl.classList.remove('is-empty');
    resultsEl.innerHTML =
      renderTotal(q) +
      renderCorridor(res) +
      renderBreakdown(q) +
      renderRisk(q) +
      renderLane(res) +
      renderDerived(q) +
      renderEscortDirectory(res) +
      renderPermitDetail(q) +
      renderNotIncluded(q);

    var fill = document.getElementById('hh-fill-corridor');
    if (fill) {
      fill.addEventListener('click', function () {
        openAdvanced();
        var existing = {};
        var rows = legRows();
        for (var i = 0; i < rows.length; i++) existing[rows[i].querySelector('.hh-leg-state').value] = true;
        var added = 0;
        for (var j = 0; j < q.corridor.states.length; j++) {
          var code = q.corridor.states[j].stateCode;
          if (existing[code]) continue;
          if (addLeg(code, '')) added++;
        }
        var first = legsEl.querySelector('.hh-leg-miles');
        if (first && added > 0) first.focus();
        legsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }

    var total = document.getElementById('hh-total');
    if (total) total.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── submit ───────────────────────────────────────────────────────────────

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var built = buildRequest();
    if (built.error) {
      setError('Check the form', built.error);
      return;
    }
    setBusy('Resolving both addresses and pricing the lane…');
    fetch('/api/tools/heavy-haul-quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.body),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          return { status: r.status, body: body };
        });
      })
      .then(function (out) {
        if (out.status !== 200) {
          setError(
            out.status === 422 ? 'We could not place one of the addresses' : 'That request was refused',
            out.body && out.body.error ? out.body.error : 'The request could not be priced.',
          );
          return;
        }
        render(out.body);
      })
      .catch(function () {
        setError(
          'The estimate could not be loaded',
          'The request did not complete. Nothing was stored, and nothing was priced from a guess — try again.',
        );
      });
  });

  // ── wiring ───────────────────────────────────────────────────────────────

  var add = document.getElementById('hh-add');
  if (add) add.addEventListener('click', function () { addLeg(); });

  var clear = document.getElementById('hh-clear-legs');
  if (clear) {
    clear.addEventListener('click', function () {
      legsEl.innerHTML = '';
      syncCap();
    });
  }

  var unitsEl = document.getElementById('hh-units');
  if (unitsEl) {
    unitsEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.hh-pill');
      if (!btn) return;
      setUnits(btn.getAttribute('data-units'));
    });
  }

  // AN EDIT INVALIDATES THE MEMO. The stored counterpart describes the value
  // that was there before the user changed it, so keeping it would hand back a
  // number nobody typed on the next switch.
  form.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el && el.getAttribute && el.getAttribute('data-unit')) {
      delete el.dataset.alt;
      delete el.dataset.altFor;
    }
  });

  var pills = document.getElementById('hh-routeclass');
  if (pills) {
    pills.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.hh-pill');
      if (!btn) return;
      var already = btn.getAttribute('aria-pressed') === 'true';
      var all = pills.querySelectorAll('.hh-pill');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
      // Selected = OUTLINE, never a bright fill (see the page CSS), and a
      // second click clears it, because "no answer" is a legitimate answer.
      btn.setAttribute('aria-pressed', already ? 'false' : 'true');
      routeClass = already ? null : btn.getAttribute('data-route');
    });
  }

  document.addEventListener('click', function (ev) {
    var cue = ev.target.closest('.hh-cue');
    if (cue) {
      var body = document.getElementById(cue.getAttribute('data-cue'));
      if (body) {
        var open = body.classList.toggle('is-open');
        cue.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      return;
    }

    // THE ACCURACY CARD. Click toggles it everywhere, because a card that only
    // opens on hover is a card a phone cannot open at all.
    var tier = ev.target.closest('.hh-tier');
    if (tier) {
      var card = document.getElementById(tier.getAttribute('aria-controls'));
      if (card) {
        var opened = card.classList.toggle('is-open');
        tier.setAttribute('aria-expanded', opened ? 'true' : 'false');
      }
      return;
    }

    // "READ MORE" — the long form, revealed inside the card it belongs to.
    var more = ev.target.closest('.hh-more');
    if (more) {
      var detail = more.parentNode.querySelector('.hh-hdetail');
      if (detail) {
        detail.hidden = !detail.hidden;
        more.setAttribute('aria-expanded', detail.hidden ? 'false' : 'true');
        more.textContent = detail.hidden ? 'Read more' : 'Show less';
      }
      return;
    }

    // A click anywhere else closes any card that was pinned open.
    if (!ev.target.closest('.hh-hover')) {
      var open2 = document.querySelectorAll('.hh-hover.is-open');
      for (var k = 0; k < open2.length; k++) {
        open2[k].classList.remove('is-open');
        var owner = document.querySelector('[aria-controls="' + open2[k].id + '"]');
        if (owner) owner.setAttribute('aria-expanded', 'false');
      }
    }
  });

  /**
   * THE WORKED EXAMPLE — a SHIPPER'S lane, which is the point.
   *
   * Houston to Buffalo, 120,000 lb, 12.5 ft × 14.5 ft × 85 ft, loading provided
   * at both ends. No axle count, no route class, no line-haul rate and no filed
   * miles: everything the old example typed into those boxes is what the engine
   * now works out for itself. The two endpoints are pre-resolved server-side,
   * so this makes no geocoder call at all.
   */
  var example = document.getElementById('hh-example');
  if (example) {
    example.addEventListener('click', function () {
      setUnits('imperial');
      document.getElementById('hh-weight').value = '120000';
      document.getElementById('hh-width').value = '12.5';
      document.getElementById('hh-height').value = '14.5';
      document.getElementById('hh-length').value = '85';
      document.getElementById('hh-origin').value = '1500 McKinney St, Houston, TX 77010';
      document.getElementById('hh-destination').value = '403 Main St, Buffalo, NY 14203';
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }

  syncCap();
})();
