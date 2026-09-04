/**
 * Client for the free heavy-haul delivered-cost estimator
 * (/tools/heavy-haul-quote).
 *
 * Server-rendered page + this one script. No framework, no build step, no
 * external request beyond the same-origin POST — the same shape as the other
 * free tools on the site.
 *
 * THE RENDERING RULES THIS FILE EXISTS TO ENFORCE, all of them honesty rules:
 *
 *   1. A CITED FIGURE AND A FIGURE FROM THE USER'S OWN RATE ARE NEVER DRAWN
 *      THE SAME. Money from a rate the caller typed gets an italic amount and a
 *      dashed `YOUR RATE` pill; a cited permit fee sits on the normal surface
 *      with its statute behind it. The three subtotals are shown apart and the
 *      delivered figure states that it is a sum of all three.
 *   2. `amountUsd === null` IS NOT $0. A component that applies and cannot be
 *      priced renders as "not priced" in warn colour with the reason beside it,
 *      and the delivered total is marked PARTIAL and names what is missing.
 *   3. THE CONFIDENCE SCORE IS ALWAYS DECOMPOSED. The number never appears
 *      without the list of what took points off it; the top three are visible
 *      and the rest are one click away, in full, verbatim.
 *   4. AT A TIER THAT CANNOT PRICE PERMITS, THE PAGE ASKS. The corridor states
 *      render as chips with a button that turns them into mileage rows, so the
 *      refusal becomes the one question that collects the authoritative figure.
 *   5. NOTHING IS SUMMARISED AWAY. Every engine note and every citation is
 *      still on the page, folded, with its count on the summary so nothing
 *      looks smaller than it is.
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

  /** Feet + inches → inches. undefined when neither box was filled. */
  function inches(ftId, inId) {
    var ft = num(ftId);
    var i = inId ? num(inId) : undefined;
    if (ft === undefined && i === undefined) return undefined;
    return (ft || 0) * 12 + (i || 0);
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

  // ── request ──────────────────────────────────────────────────────────────

  function buildRequest() {
    var weight = num('hh-weight');
    if (weight === undefined || weight <= 0) {
      return { error: 'Enter the gross weight in pounds — every state prices the overweight permit from it.' };
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
    var w = inches('hh-width-ft', 'hh-width-in');
    var h = inches('hh-height-ft', 'hh-height-in');
    var l = inches('hh-length-ft', null);
    var axles = num('hh-axles');
    if (w !== undefined) cargo.widthIn = w;
    if (h !== undefined) cargo.heightIn = h;
    if (l !== undefined) cargo.overallLengthIn = l;
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

    var body = { cargo: cargo, originAddress: origin, destinationAddress: destination };
    if (parsedLegs.legs.length > 0) body.legs = parsedLegs.legs;
    if (Object.keys(rates).length > 0) body.rates = rates;
    return { body: body };
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
      : '<p class="hh-tsub">Sourced permit fees, your own line-haul and pilot-car rates, and an EIA-index fuel surcharge. No margin is included.</p>';

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
      '</span><span class="n">State permit fees, published police-escort floors and filed tariff charges, each cited to a statute or fee schedule.</span></div>' +
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

  function renderLines(q) {
    var rows = q.lines
      .map(function (l) {
        var mine = l.basis === 'yours';
        var amount =
          l.amountUsd === null
            ? '<td class="num nil">not priced</td>'
            : '<td class="num' + (mine ? ' mine' : '') + '">' + esc(usd(l.amountUsd)) + '</td>';
        // The BASIS goes on the name, above the clamped note, because "whose
        // number is this" must never be the sentence that got clipped.
        var tag = mine
          ? '<span class="hh-tag">Your rate — not a figure we source</span>'
          : l.basis === 'derived'
            ? '<span class="hh-tag hh-tag--derived">EIA index · our peg &amp; mpg</span>'
            : '';
        return (
          '<tr><td>' +
          esc(l.name) +
          tag +
          (l.note ? '<span class="hh-ln">' + esc(l.note) + '</span>' : '') +
          '</td>' +
          amount +
          '</tr>'
        );
      })
      .join('');

    var total =
      q.deliveredUsd === null
        ? ''
        : '<tr class="hh-tot"><td>' +
          (q.partial ? 'Partial total — see what is missing above' : 'Delivered cost estimate') +
          '</td><td class="num">' +
          esc(usd(q.deliveredUsd)) +
          '</td></tr>';

    return (
      '<div class="hh-linesbox"><h3>The breakdown</h3><div class="hh-tablewrap"><table class="hh-lines"><thead><tr><th>Component</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows +
      total +
      '</tbody></table></div></div>'
    );
  }

  function renderMileage(q) {
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
      '<div class="hh-note"><h3>Mileage — ' +
      esc(m.tierLabel) +
      '</h3><p>' +
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
      ')</summary><ul>' +
      states +
      '</ul></details>'
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

  function renderLane(res) {
    return (
      '<div class="hh-note"><h3>The lane we measured</h3><p>Pickup matched to <strong>' +
      esc(res.lane.origin.matched) +
      '</strong>; delivery matched to <strong>' +
      esc(res.lane.destination.matched) +
      '</strong>. Check them — the lane distance is measured from these two points, and an address the US Census geocoder cannot place is refused rather than matched to somewhere else.</p></div>'
    );
  }

  function render(res) {
    var q = res.quote;
    resultsEl.classList.remove('is-empty');
    resultsEl.innerHTML =
      renderTotal(q) +
      renderCorridor(res) +
      renderLines(q) +
      renderMileage(q) +
      renderEscortDirectory(res) +
      renderLane(res) +
      renderPermitDetail(q) +
      renderNotIncluded(q);

    var fill = document.getElementById('hh-fill-corridor');
    if (fill) {
      fill.addEventListener('click', function () {
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
    if (!cue) return;
    var body = document.getElementById(cue.getAttribute('data-cue'));
    if (!body) return;
    var open = body.classList.toggle('is-open');
    cue.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  /**
   * THE WORKED EXAMPLE. Houston to Buffalo — the same load and the same seven
   * legs the permits calculator prices at $1,223.18, plus a line-haul rate and
   * a pilot-car rate so the delivered figure has every component in it. Both
   * endpoints are pre-resolved server-side, so this makes no geocoder call.
   */
  var example = document.getElementById('hh-example');
  if (example) {
    example.addEventListener('click', function () {
      document.getElementById('hh-weight').value = '120000';
      document.getElementById('hh-width-ft').value = '12';
      document.getElementById('hh-width-in').value = '6';
      document.getElementById('hh-height-ft').value = '14';
      document.getElementById('hh-height-in').value = '6';
      document.getElementById('hh-length-ft').value = '85';
      document.getElementById('hh-axles').value = '8';
      document.getElementById('hh-origin').value = '1500 McKinney St, Houston, TX 77010';
      document.getElementById('hh-destination').value = '403 Main St, Buffalo, NY 14203';
      document.getElementById('hh-linehaul').value = '4.85';
      document.getElementById('hh-pc-mile').value = '1.95';
      var interstate = document.querySelector('.hh-pill[data-route="interstate"]');
      if (interstate) {
        var all = document.querySelectorAll('.hh-pill');
        for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
        interstate.setAttribute('aria-pressed', 'true');
        routeClass = 'interstate';
      }
      legsEl.innerHTML = '';
      var legs = [
        ['TX', 214.98], ['AR', 337], ['TN', 250], ['KY', 62.4],
        ['OH', 145], ['PA', 46], ['NY', 60],
      ];
      for (var j = 0; j < legs.length; j++) addLeg(legs[j][0], legs[j][1]);
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }

  syncCap();
})();
