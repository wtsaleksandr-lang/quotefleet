/**
 * Client for the free OS/OW state-permit calculator (/tools/oversize-permits).
 *
 * Server-rendered page + this one script. No framework, no build step, no
 * external request beyond the same-origin POST — the same shape as the other
 * free tools on the site.
 *
 * THE RENDERING RULES THIS FILE EXISTS TO ENFORCE, all of them honesty rules:
 *
 *   1. The total is labelled STATE PERMIT FEES, never "quote" or "cost", and
 *      the exclusions sit beside it rather than under a footnote.
 *   2. An uncovered state renders as its own named block. Never $0, never a
 *      silent omission, never a total that quietly leaves it out.
 *   3. Escorts render as a COUNT with the cost stated. Where the caller supplied
 *      their OWN pilot-car rate the figure is drawn as theirs — dashed outline,
 *      a YOUR RATE tag, never on the same surface as a cited fee. Where a state
 *      publishes a LAW-ENFORCEMENT rate that figure is cited like a permit fee.
 *      Neither is ever inside `totalPermitUsd`.
 *   4. A state flagged for manual review shows the MANUAL REVIEW badge and its
 *      first recorded reason VERBATIM AND VISIBLE, with every remaining note one
 *      click away in a disclosure that contains all of them. Nothing is dropped,
 *      nothing is summarised and nothing is paraphrased — the same words one
 *      click away are exactly as honest, and Tennessee's fourteen notes at full
 *      length were 2,798px of a 7,931px result for a $320 line.
 *   5. `totalPermitUsd === null` is NOT $0. Where SOME states priced, the page
 *      shows their sum as an explicitly PARTIAL figure that names what is
 *      missing and is labelled as not a lane total. Where none did, it refuses.
 *   6. COVERED IS NOT PRICED. A state can be covered — we hold its schedule —
 *      and still come back unpriceable for this load, and the summary tile must
 *      not report the second as the first. See `renderFlags`.
 *   7. THE SUMMARY TABLE IS A SECOND VIEW, NOT A SUBSTITUTE. Every state on the
 *      lane gets a row, uncovered ones included and named; the money in it is
 *      the engine's own per-line output re-bucketed, never re-derived.
 */
(function () {
  'use strict';

  /**
   * The API's own ceiling, mirrored. `legs` is `z.array(...).max(20)` server
   * side, and an Add button with no limit let the user build a 39-row form
   * whose only feedback was a 400. The state is prevented rather than
   * explained: the button stops at the cap and says why.
   */
  var MAX_LEGS = 20;

  var form = document.getElementById('ow-form');
  var legsEl = document.getElementById('ow-legs');
  var resultsEl = document.getElementById('ow-results');
  var tpl = document.getElementById('ow-leg-tpl');
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

  function num(id) {
    var el = document.getElementById(id);
    if (!el) return undefined;
    var raw = String(el.value == null ? '' : el.value).trim();
    if (raw === '') return undefined;
    var v = Number(raw);
    return isFinite(v) ? v : undefined;
  }

  /** Feet + inches -> inches. undefined when neither box was filled. */
  function inches(ftId, inId) {
    var ft = num(ftId);
    var i = num(inId);
    if (ft === undefined && i === undefined) return undefined;
    return (ft || 0) * 12 + (i || 0);
  }

  function ftIn(totalInches) {
    if (typeof totalInches !== 'number' || !isFinite(totalInches)) return '';
    var ft = Math.floor(totalInches / 12);
    var i = Math.round((totalInches - ft * 12) * 10) / 10;
    return ft + "'" + i + '"';
  }

  // ── leg rows ─────────────────────────────────────────────────────────────

  var addBtn = document.getElementById('ow-add');
  var capHint = document.getElementById('ow-cap');

  function legRows() { return legsEl.querySelectorAll('.ow-leg'); }

  /** Keep the Add control and the cap notice in step with the row count. */
  function syncCap() {
    var full = legRows().length >= MAX_LEGS;
    if (addBtn) {
      addBtn.disabled = full;
      addBtn.setAttribute('aria-disabled', full ? 'true' : 'false');
      // SHORT. `.btn` is an inline-flex box at a fixed width, so a longer label
      // overflows its own button at 320-375px instead of wrapping — measured at
      // 147px of text in a 121px box. The sentence lives in `#ow-cap`, which is
      // revealed at the same moment.
      addBtn.textContent = full ? 'Limit: ' + MAX_LEGS + ' states' : 'Add a state';
    }
    if (capHint) capHint.hidden = !full;
  }

  function addLeg(stateCode, miles) {
    if (legRows().length >= MAX_LEGS) { syncCap(); return; }
    var node = tpl.content.firstElementChild.cloneNode(true);
    var sel = node.querySelector('.ow-leg-state');
    var mi = node.querySelector('.ow-leg-miles');
    if (stateCode && sel) sel.value = stateCode;
    if (miles !== undefined && miles !== null && mi) mi.value = String(miles);
    var drop = node.querySelector('.ow-legdrop');
    if (drop) {
      drop.addEventListener('click', function () {
        node.remove();
        if (!legsEl.querySelector('.ow-leg')) addLeg();
        syncCap();
      });
    }
    legsEl.appendChild(node);
    syncCap();
  }

  if (addBtn) addBtn.addEventListener('click', function () { addLeg(); });
  addLeg();
  addLeg();

  // ── route-class pills (single select; selected = outline, not a fill) ─────

  var pillWrap = document.getElementById('ow-routeclass');
  if (pillWrap) {
    pillWrap.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.ow-pill') : null;
      if (!btn) return;
      var value = btn.getAttribute('data-route');
      var already = btn.getAttribute('aria-pressed') === 'true';
      var all = pillWrap.querySelectorAll('.ow-pill');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', 'false');
      if (already) {
        routeClass = null;
      } else {
        btn.setAttribute('aria-pressed', 'true');
        routeClass = value;
      }
    });
  }

  // ── help cues (one pattern, always top-left of the section header) ────────

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.ow-cue') : null;
    if (!btn) return;
    var body = document.getElementById(btn.getAttribute('data-cue'));
    if (!body) return;
    var open = body.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // ── rendering ────────────────────────────────────────────────────────────

  function card(html) { return '<div class="ow-card">' + html + '</div>'; }

  function note(kind, title, inner) {
    var cls = kind ? ' ow-note--' + kind : '';
    return '<div class="ow-note' + cls + '"><h3>' + esc(title) + '</h3>' + inner + '</div>';
  }

  /**
   * States that came back with an actual figure.
   *
   * NOT `jurisdictions.length`. A jurisdiction is in that list because we HOLD
   * the state's fee schedule, which is a different fact from having priced this
   * load with it: Florida returns a covered jurisdiction with a null subtotal
   * whenever the oversize band cannot be selected, and Illinois and Arkansas do
   * the same on other inputs. Counting the list rendered "2 of 2 — every state
   * on this lane is covered" directly above a block reading "Not priceable",
   * which invites a dispatcher to read the missing total as a display glitch.
   */
  function pricedCount(q) {
    var n = 0;
    for (var i = 0; i < q.jurisdictions.length; i++) {
      if (q.jurisdictions[i].subtotalUsd !== null) n++;
    }
    return n;
  }

  /**
   * The lane's partially-priced picture, or `null` when there is nothing partial
   * to say.
   *
   * WHY A PARTIAL FIGURE IS MORE HONEST THAN NO FIGURE. A lane touching one
   * uncovered state used to print "Not priceable" and no number at all, while
   * the states we DID price sat below it each carrying a real, cited subtotal a
   * reader could add up by hand. Withholding their sum protected nobody: it just
   * moved the arithmetic off the page, and the reader who did it got the same
   * number with none of the caveats attached.
   *
   * So the sum is shown, and it is labelled for exactly what it is — a partial,
   * never a lane total — with the states it does not cover NAMED beside it. The
   * refusal is intact: `q.totalPermitUsd` is still null, the label still says so,
   * and the uncovered block below still names every state in full.
   */
  function partialOf(data) {
    var q = data.quote;
    if (q.totalPermitUsd !== null) return null;
    var priced = 0;
    var sum = 0;
    var unpriced = [];
    for (var i = 0; i < q.jurisdictions.length; i++) {
      var j = q.jurisdictions[i];
      if (j.subtotalUsd === null) unpriced.push(j.jurisdictionName);
      else { priced++; sum += j.subtotalUsd; }
    }
    for (var k = 0; k < data.uncovered.length; k++) unpriced.push(data.uncovered[k].name);
    // Nothing priced is not a partial, it is a refusal. Keep the refusal.
    if (priced === 0) return null;
    return {
      usd: Math.round(sum * 100) / 100,
      priced: priced,
      onLane: q.jurisdictions.length + data.uncovered.length,
      unpriced: unpriced,
    };
  }

  function renderTotal(data) {
    var q = data.quote;
    var priced = pricedCount(q);
    var value = usd(q.totalPermitUsd);
    var partial = partialOf(data);

    var head;
    var sub;
    var cls = '';
    if (value) {
      head =
        '<p class="ow-tl">State permit fees — ' + priced + ' state' + (priced === 1 ? '' : 's') + '</p>' +
        '<p class="ow-tv">' + value + '</p>';
      sub = 'State permit fees only. Not a freight quote — no line haul, no fuel, no escort cost, no margin.';
    } else if (partial) {
      // THE LABEL DOES THE WORK. The figure is large because it is useful; the
      // line above it says in as many words that it is NOT the lane total, and
      // the line below names every state the figure leaves out.
      cls = ' ow-total--partial';
      head =
        '<p class="ow-tl">Partial — NOT a lane total</p>' +
        '<p class="ow-tv">' + usd(partial.usd) + '</p>' +
        '<p class="ow-tpart">' + partial.priced + ' of ' + partial.onLane + ' states priced · ' +
        partial.unpriced.length + ' unpriced</p>';
      sub =
        'There is no lane total for this lane. ' + usd(partial.usd) + ' is the sum of the ' +
        partial.priced + ' state' + (partial.priced === 1 ? '' : 's') +
        ' we could price; ' + partial.unpriced.join(', ') +
        (partial.unpriced.length === 1 ? ' is' : ' are') +
        ' not in it and cannot be inferred from a neighbour. State permit fees only. Not a freight quote — no line haul, no fuel, no escort cost, no margin.';
    } else {
      // null is not zero, and nothing priced is not a partial. Refuse.
      head =
        '<p class="ow-tl">No lane total</p>' +
        '<p class="ow-tv">Not priceable</p>';
      sub = 'Part of this lane has no published price, so there is no honest lane total. The states below that could be priced still show their own fees.';
    }

    return '<div class="ow-total' + cls + '">' + head + '<p class="ow-tsub">' + esc(sub) + '</p>' + renderFlags(data) + '</div>';
  }

  /** Exactly four tiles in a 2-column grid — 2x2, never a lone tile on a row. */
  function renderFlags(data) {
    var q = data.quote;
    var esc1 = data.escorts.maxRequiredOnAnyState;
    var absorbed = data.absorbedConflicts.items.length;

    // PRICED, COVERED AND ON THE LANE ARE THREE DIFFERENT COUNTS. The tile
    // reports the first and names the other two, because "covered" is the fact
    // a reader will otherwise assume from a priced total.
    var priced = pricedCount(q);
    var onLane = q.jurisdictions.length + data.uncovered.length;
    var unpriced = q.jurisdictions.length - priced;
    var gaps = [];
    if (unpriced > 0) {
      gaps.push(unpriced + ' covered but not priceable for this load');
    }
    if (data.uncovered.length) {
      gaps.push(data.uncovered.length + ' not covered at all');
    }

    var escortStates = data.escorts.byState.filter(function (s) { return s.required > 0; }).length;

    var tiles = [
      {
        k: 'States priced',
        v: priced + ' of ' + onLane,
        n: gaps.length
          ? gaps.join(', ') + ' — each named below'
          : 'Every state on this lane returned a priced permit fee',
      },
      {
        // A PER-STATE MAXIMUM, NOT A LANE TOTAL. `maxRequiredOnAnyState` is a
        // Math.max across the states, so a lane where Florida and Georgia each
        // require one escort reports 1 — which reads as one pilot car for the
        // whole move when it is two, one per state. The list below is right;
        // the tile has to say which number it is showing.
        k: 'Escorts, per state',
        v: esc1 === 0 ? 'None' : 'Up to ' + esc1 + ' per state',
        n: esc1 === 0
          ? 'Cost NOT included — states set the requirement, not the price'
          : 'The most any ONE state requires, not a lane total — ' + escortStates + ' state' +
            (escortStates === 1 ? '' : 's') + ' below each require their own. Cost NOT included.',
      },
      {
        k: 'Manual review',
        v: q.requiresManualReview ? 'Required' : 'Not flagged',
        n: q.requiresManualReview ? 'At least one state has an unsettled fact — reasons below' : 'No unsettled fee or rule on this lane',
      },
      {
        k: 'Rounded-up conflicts',
        v: absorbed === 0 ? 'None' : absorbed + ' fee' + (absorbed === 1 ? '' : 's'),
        n: absorbed === 0 ? 'No official sources disagreed on this load' : usd(data.absorbedConflicts.totalUsd) + ' of source disagreement, quoted high',
      },
    ];
    return '<div class="ow-flags">' + tiles.map(function (t) {
      return '<div class="ow-flag"><span class="k">' + esc(t.k) + '</span><span class="v">' + esc(t.v) + '</span><span class="n">' + esc(t.n) + '</span></div>';
    }).join('') + '</div>';
  }

  // ── The all-states summary table ─────────────────────────────────────────
  //
  // THE ONE STRUCTURAL IDEA WORTH TAKING FROM THE COMPETITION. Their state pages
  // fit four states and a totals row in ~380px; ours put seven states across
  // 7,931px of scrolling with no place to see them together. This is that view,
  // built out of the engine's OWN per-line output — nothing here is re-derived,
  // re-rounded or re-summed from anything but `j.lines` and `j.subtotalUsd`.
  //
  // BUCKETS ARE EXHAUSTIVE ON PURPOSE. `osow_oversize` and `osow_overweight`
  // get their own columns; EVERY other code — base, service fee, supervision,
  // greater-of, and any code added later — falls into "Base & fees". A line the
  // table did not know about must never go missing from it, so the default is
  // "count it" rather than "drop it", and the Subtotal column is the engine's
  // own figure so the row can be checked against itself.
  var ESTIMATE_BY_CODE = {};

  /**
   * How many states on THIS lane recorded each note, verbatim.
   *
   * Used for one thing: choosing which note to show as the visible reason. The
   * engine raises `requiresManualReview` from ~35 sites and does not tag which
   * one fired, and some notes are properties of the LOAD rather than the state —
   * "axle positions and per-axle weights were not supplied" is recorded
   * identically against every jurisdiction on the lane. Printing that under "Why
   * Tennessee needs a human" answers a question nobody asked about Tennessee.
   *
   * So the visible reason is the first note the server ranked that NO other
   * state on this lane also recorded. That is a fact about the response, not an
   * editorial judgement: it does not re-rank, it filters, and it falls back to
   * `notes[0]` when every note is shared. The fold below still lists all of
   * them, in the server's order, verbatim.
   */
  var NOTE_FREQ = {};

  function visibleReason(notes) {
    for (var i = 0; i < notes.length; i++) {
      if (NOTE_FREQ[notes[i]] === 1) return notes[i];
    }
    return notes[0];
  }

  function bucketOf(code) {
    if (code === 'osow_oversize') return 'oversize';
    if (code === 'osow_overweight') return 'overweight';
    return 'fees';
  }

  /** Sum a jurisdiction's lines into the three columns, keeping nulls visible. */
  function bucketLines(j) {
    var out = {
      oversize: { sum: 0, n: 0, anyNull: false },
      overweight: { sum: 0, n: 0, anyNull: false },
      fees: { sum: 0, n: 0, anyNull: false },
    };
    for (var i = 0; i < j.lines.length; i++) {
      var l = j.lines[i];
      var b = out[bucketOf(l.code)];
      b.n++;
      // A NULL LINE IS NOT A ZERO. It poisons its own column rather than being
      // skipped, so a column can never quietly under-report a state.
      if (l.amountUsd === null) b.anyNull = true;
      else b.sum += l.amountUsd;
    }
    return out;
  }

  function moneyCell(b) {
    if (b.n === 0) return '<td class="num nil">—</td>';
    if (b.anyNull) return '<td class="num nil">Not priceable</td>';
    return '<td class="num">' + esc(usd(Math.round(b.sum * 100) / 100)) + '</td>';
  }

  /**
   * The escort cell. NEVER $0 against a required escort, and a figure derived
   * from the caller's own rate is marked as theirs in the cell itself — italic
   * plus the word "yours" — because every other number in this table traces to a
   * statute and this one traces to a text box.
   */
  function escortCell(code, required) {
    if (!required) return '<td class="nil">None required</td>';
    var label = required + ' car' + (required === 1 ? '' : 's');
    var e = ESTIMATE_BY_CODE[code];
    if (e && e.pilotCarBasis === 'userSupplied' && e.pilotCarUsd !== null) {
      return '<td class="mine">' + esc(label) + ' · ' + esc(usd(e.pilotCarUsd)) + ' (yours)</td>';
    }
    return '<td>' + esc(label) + ' · cost unknown</td>';
  }

  /**
   * SHORT ON PURPOSE. The chip is `white-space: nowrap` — an outlined pill split
   * across two lines reads as a rendering fault — and this is the seventh column
   * in a table that has to fit a 554px results column without an inner
   * scrollbar on desktop. "Review" under a header reading STATUS is unambiguous,
   * and the state's own block below still carries the full MANUAL REVIEW badge
   * with the reason beside it.
   */
  function statusCell(kind, text) {
    return '<td class="st"><span class="ow-st' + (kind ? ' ow-st--' + kind : '') + '">' + esc(text) + '</span></td>';
  }

  function renderSummary(data) {
    var q = data.quote;
    var byCodeEscort = {};
    data.escorts.byState.forEach(function (r) { byCodeEscort[r.code] = r; });

    var tot = {
      oversize: { sum: 0, n: 0, anyNull: false },
      overweight: { sum: 0, n: 0, anyNull: false },
      fees: { sum: 0, n: 0, anyNull: false },
    };
    var totCars = 0;
    var totYours = 0;
    var yoursComplete = true;
    var anyYours = false;

    var rows = q.jurisdictions.map(function (j) {
      var b = bucketLines(j);
      ['oversize', 'overweight', 'fees'].forEach(function (key) {
        tot[key].n += b[key].n;
        tot[key].sum += b[key].sum;
        if (b[key].anyNull) tot[key].anyNull = true;
      });
      var required = byCodeEscort[j.jurisdiction] ? byCodeEscort[j.jurisdiction].required : 0;
      totCars += required;
      var est = ESTIMATE_BY_CODE[j.jurisdiction];
      if (required > 0) {
        if (est && est.pilotCarBasis === 'userSupplied' && est.pilotCarUsd !== null) {
          anyYours = true;
          totYours += est.pilotCarUsd;
        } else if (est && est.pilotCarBasis === 'userSupplied') {
          yoursComplete = false;
        }
      }

      var status = j.subtotalUsd === null
        ? statusCell('np', 'Not priced')
        : j.requiresManualReview
          ? statusCell('review', 'Review')
          : statusCell('', 'Priced');

      return '<tr><td>' + esc(j.jurisdictionName) + '</td>' +
        moneyCell(b.oversize) + moneyCell(b.overweight) + moneyCell(b.fees) +
        escortCell(j.jurisdiction, required) +
        '<td class="num">' + esc(j.subtotalUsd === null ? 'Not priceable' : usd(j.subtotalUsd)) + '</td>' +
        status + '</tr>';
    }).join('');

    // UNCOVERED STATES GET A ROW. They are on the lane, so they are in the
    // table — named, with every money cell an em dash rather than a zero. A
    // summary that silently held 7 rows for a 9-state lane would be the single
    // most misleading thing this page could print.
    var uncoveredRows = data.uncovered.map(function (s) {
      return '<tr><td>' + esc(s.name) + '</td>' +
        '<td class="num nil">—</td><td class="num nil">—</td><td class="num nil">—</td>' +
        '<td class="nil">—</td><td class="num nil">—</td>' +
        statusCell('none', 'Not covered') + '</tr>';
    }).join('');

    var partial = partialOf(data);
    var totalText = q.totalPermitUsd !== null
      ? usd(q.totalPermitUsd)
      : partial ? usd(partial.usd) : 'Not priceable';
    var totalStatus = q.totalPermitUsd !== null
      ? statusCell('', 'Permits only')
      : partial ? statusCell('np', 'Partial') : statusCell('np', 'No total');

    // SHORT. This is the widest cell in the table and it is the one that decides
    // whether seven columns fit the results column without an inner scrollbar.
    var carsCell = totCars === 0
      ? '<td class="nil">None required</td>'
      : anyYours && yoursComplete
        ? '<td class="mine">' + totCars + ' crossing' + (totCars === 1 ? '' : 's') + ' · ' + esc(usd(Math.round(totYours * 100) / 100)) + ' (yours)</td>'
        : '<td>' + totCars + ' crossing' + (totCars === 1 ? '' : 's') + (anyYours ? ' · partly priced' : ' · cost unknown') + '</td>';

    var totalRow = '<tr class="ow-sumtot"><td>' +
      (q.totalPermitUsd !== null ? 'All states' : 'Priced states only') + '</td>' +
      moneyCell(tot.oversize) + moneyCell(tot.overweight) + moneyCell(tot.fees) +
      carsCell +
      '<td class="num">' + esc(totalText) + '</td>' + totalStatus + '</tr>';

    return '<div class="ow-summary">' +
      '<h3>Every state on this lane</h3>' +
      '<p class="ow-hint">Permit fees only. The escort column is beside the subtotal and is NEVER inside it — no escort money is in any figure in the Subtotal column. Full detail, notes and citations for each state are below.</p>' +
      '<div class="ow-sumwrap"><table class="ow-sum">' +
      '<thead><tr><th>State</th><th class="num">Oversize</th><th class="num">Overweight</th>' +
      '<th class="num">Base &amp; fees</th><th>Escorts</th><th class="num">Subtotal</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + uncoveredRows + totalRow + '</tbody></table></div>' +
      '<p class="ow-hint">Narrow screen? This table scrolls sideways on its own — the page does not.</p>' +
      '</div>';
  }

  function renderUncovered(data) {
    if (!data.uncovered.length) return '';
    var items = data.uncovered.map(function (s) {
      return '<li><strong>' + esc(s.name) + ' (' + esc(s.code) + ')</strong> — we hold no oversize/overweight fee schedule for this state, so nothing is charged for it and nothing is assumed. Its permit is not in the total above.</li>';
    }).join('');
    return note(
      'error',
      data.uncovered.length + ' state' + (data.uncovered.length === 1 ? '' : 's') + ' on this lane ' + (data.uncovered.length === 1 ? 'is' : 'are') + ' not covered',
      '<ul>' + items + '</ul><p>Permit fees, escort rules and superload thresholds cannot be inferred from a neighbouring state. Apply to these states directly — the total above is incomplete without them.</p>',
    );
  }

  /**
   * The per-line fee breakdown, FOLDED behind a summary that names what is
   * inside it and what it comes to.
   *
   * THIS IS THE SECOND HALF OF THE SAME TRADE THE SUMMARY TABLE MAKES. Every
   * figure in here now also appears in the all-states table above — bucketed
   * into oversize / overweight / base-and-fees, with the engine's own subtotal
   * beside it — so a reader who wants "what does Ohio cost" has it without
   * opening anything. What only lives here is the PROVENANCE: which statute
   * produced which line, the per-line note, and the low/high where two official
   * sources disagreed. That is worth a click and is not worth 190px per state
   * on a seven-state lane, which is what it cost before.
   *
   * NOTHING IS DROPPED. Every line, every note, every range still renders — the
   * subtotal row included, so the fold can be checked against the table above.
   */
  function renderLines(j) {
    var rows = j.lines.map(function (l) {
      var amount = l.amountUsd === null ? 'Not priceable' : usd(l.amountUsd);
      var range = (l.lowUsd !== undefined && l.highUsd !== undefined && l.lowUsd !== l.highUsd)
        ? '<span class="ln">Sources disagree: ' + esc(usd(l.lowUsd)) + ' to ' + esc(usd(l.highUsd)) + '</span>' : '';
      var n = l.note ? '<span class="ln">' + esc(l.note) + '</span>' : '';
      return '<tr><td>' + esc(l.name) + n + range + '</td><td class="num">' + esc(amount) + '</td></tr>';
    }).join('');
    var sub = j.subtotalUsd === null ? 'Not priceable' : usd(j.subtotalUsd);

    // The over-dimension explanation travels WITH the fee lines it explains —
    // it is the answer to "why is there a permit here at all", and reading it
    // beside the lines is better than reading it above a table it introduces.
    var over = (j.overDimension && j.overDimension.details && j.overDimension.details.length)
      ? '<p class="ow-over">Over ' + esc(j.jurisdictionName) + '’s legal limits: ' +
        esc(j.overDimension.details.join(' · ')) + '</p>'
      : '';

    return '<details class="ow-fold ow-linefold"><summary>' + j.lines.length + ' cited fee line' +
      (j.lines.length === 1 ? '' : 's') + ' for ' + esc(j.jurisdictionName) + ' — ' + esc(sub) +
      '</summary>' + over +
      '<div class="ow-tablewrap"><table class="ow-lines">' +
      '<thead><tr><th>Fee</th><th class="num">Amount</th></tr></thead><tbody>' + rows +
      '<tr class="sub"><td>' + esc(j.jurisdictionName) + ' subtotal</td><td class="num">' + esc(sub) + '</td></tr>' +
      '</tbody></table></div></details>';
  }

  function renderCites(j) {
    if (!j.sources || !j.sources.length) return '';
    var items = j.sources.map(function (s) {
      var rev = s.revisedOn ? 'rev. ' + s.revisedOn : 'no revision date stated';
      var pin = s.cite ? ', ' + s.cite : '';
      return '<li>' + esc(s.publisher) + ' — <a href="' + esc(s.url) + '" rel="nofollow noopener" target="_blank">' + esc(s.title) + '</a> (' + esc(rev) + esc(pin) + ')</li>';
    }).join('');
    return '<details class="ow-cites"><summary>Sources for ' + esc(j.jurisdictionName) + ' (' + j.sources.length + ')</summary><ul>' + items + '</ul></details>';
  }

  function renderState(j, reviewEntry, escortEntry) {
    // BADGES STAY SHORT. They are `white-space: nowrap` and sit in a 2-column
    // grid, so a long one overflows its column at 375px. Anything that needs a
    // sentence — above all the escort-cost exclusion — goes in the wrapping
    // text line directly beneath, where it is still adjacent to the number it
    // qualifies rather than buried further down the page.
    var badges = [];
    if (j.requiresManualReview) badges.push('<span class="ow-badge ow-badge--review">Manual review</span>');
    var escortCount = escortEntry ? escortEntry.required : 0;
    if (escortCount > 0) {
      badges.push('<span class="ow-badge ow-badge--escort">' + escortCount + ' escort' + (escortCount === 1 ? '' : 's') + '</span>');
    }
    if (j.superload) badges.push('<span class="ow-badge ow-badge--review">Superload</span>');
    if (j.routeInspectionRequired) badges.push('<span class="ow-badge">Route inspection</span>');
    if (!j.permitRequired) badges.push('<span class="ow-badge">No permit needed</span>');

    // NOT a badge. Badges are `white-space: nowrap`, and this is a joined list
    // that reached 1,510px on a seven-state lane — it forced horizontal scroll
    // on the whole document at every viewport width. It wraps as body text.
    //
    // THE ESCORT EXCLUSION STAYS VISIBLE while the over-dimension detail moves
    // inside the fee-line fold. They are not the same kind of statement: one
    // restates what the user typed, the other is the single sentence that stops
    // a reader taking this subtotal for the cost of moving through the state.
    // NO MONEY IN THIS LINE, EVER — not even the caller's own. A figure derived
    // from their rate lives on `.ow-yours` and in the summary table's escort
    // column, both of which are drawn as user-sourced. Putting one here would
    // put a number the state did not set inside the state's own block.
    var over = '';
    if (escortCount > 0) {
      over += '<p class="ow-over"><strong>' + esc(j.jurisdictionName) + ' requires ' + escortCount +
        ' certified escort' + (escortCount === 1 ? '' : 's') +
        '. The escort COST is not included in any figure on this page</strong> — the state sets the requirement, not the price.</p>';
    }
    // The grid is two columns wide, so an ODD count leaves one badge alone on
    // the last row. Pad with the as-of badge, which is worth stating anyway.
    if (badges.length % 2 === 1) badges.push('<span class="ow-badge">As of ' + esc(j.asOf) + '</span>');

    /**
     * THE REVIEW BLOCK, FOLDED — and the fold is the whole point of this change.
     *
     * Tennessee's fourteen notes rendered at full length were 2,798px, 35% of a
     * 7,931px result, attached to a $320 line. That length bought no additional
     * candour: a reader who needs the New York Thruway paragraph needs it just as
     * much one click away, and a reader who does not was paying for it in scroll.
     *
     * WHAT STAYS VISIBLE is the part that changes a decision — the MANUAL REVIEW
     * badge above, and the FIRST recorded note verbatim. `unsettledFirst` on the
     * server has already put the unsettled facts ahead of the advisory ones, so
     * the first note is the strongest claim the engine has about this state.
     *
     * WHAT FOLDS is everything, INCLUDING that first note, so the disclosure is
     * a complete record rather than a remainder — `notes.length` is on the
     * summary line, and the list inside is `notes` untouched, in order, verbatim.
     * Nothing is dropped, shortened, merged or paraphrased.
     */
    var why = '';
    if (j.requiresManualReview && reviewEntry && reviewEntry.notes.length) {
      why = '<div class="ow-why">' +
        '<h4>Why ' + esc(j.jurisdictionName) + ' needs a human</h4>' +
        '<p class="ow-reason">' + esc(visibleReason(reviewEntry.notes)) + '</p>' +
        '<details class="ow-fold"><summary>Read it in full, and every other note on file for ' +
        esc(j.jurisdictionName) + ' (' + reviewEntry.notes.length + ') — nothing is dropped</summary><ol>' +
        reviewEntry.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
        '</ol></details></div>';
    } else if (j.warnings && j.warnings.length) {
      why = '<details class="ow-fold"><summary>' + j.warnings.length + ' note' + (j.warnings.length === 1 ? '' : 's') + ' on ' + esc(j.jurisdictionName) + '</summary><ul>' +
        j.warnings.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></details>';
    }

    var amt = j.subtotalUsd === null ? 'Not priceable' : usd(j.subtotalUsd);
    return '<div class="ow-state' + (j.requiresManualReview ? ' ow-state--review' : '') + '">' +
      '<div class="ow-sh"><h3>' + esc(j.jurisdictionName) + '</h3><span class="amt">' + esc(amt) + '</span></div>' +
      (badges.length ? '<div class="ow-badges">' + badges.join('') + '</div>' : '') + over +
      renderLines(j) + why + renderCites(j) +
      '</div>';
  }

  function renderAbsorbed(data) {
    if (!data.absorbedConflicts.items.length) return '';
    var items = data.absorbedConflicts.items.map(function (a) {
      return '<li><strong>' + esc(a.field) + '</strong> — quoted at ' + esc(usd(a.adoptedUsd)) +
        ', the higher of ' + esc(usd(a.lowUsd)) + ' and ' + esc(usd(a.highUsd)) +
        ' (' + esc(usd(a.spreadUsd)) + ' apart).</li>';
    }).join('');
    return note('warn', 'Fees rounded up because official sources disagreed', '<ul>' + items + '</ul><p>' + esc(data.absorbedConflicts.note) + '</p>');
  }

  /**
   * FOLDED, AND ONLY BECAUSE THE HEADLINE DISCLAIMER IS NOT.
   *
   * `.ow-total .ow-tsub` states the exclusion in one line 4px under the number
   * and above the fold, which is where the honesty obligation actually lands.
   * This is the five-item long form of the same claim, and it was the third
   * restatement of "this is not a freight quote" on a page that already had two.
   * The count is on the summary line so it does not read as fewer than it is.
   */
  function renderNotIncluded(data) {
    var items = data.notIncluded.map(function (n) {
      return '<li><strong>' + esc(n.item) + '.</strong> ' + esc(n.why) + '</li>';
    }).join('');
    return '<details class="ow-note ow-notincluded ow-fold"><summary>What this total never includes (' +
      data.notIncluded.length + ')</summary><ul>' + items + '</ul></details>';
  }

  function renderMileage(data) {
    return note('', 'Where these miles came from', '<p>' + esc(data.mileage.note) + '</p><p>Lane total supplied: <strong>' + esc(data.mileage.totalMiles.toLocaleString('en-US')) + ' mi</strong>. Fee schedules read as of ' + esc(data.asOf) + '.</p>');
  }

  /**
   * A CITED source list, in the same shape the per-state citations use, so a
   * police-escort rate looks exactly as sourced as a permit fee — because it is.
   */
  function citeList(sources) {
    return sources.map(function (s) {
      var rev = s.revisedOn ? 'rev. ' + s.revisedOn : 'no revision date stated';
      var pin = s.cite ? ', ' + s.cite : '';
      return '<li>' + esc(s.publisher) + ' — <a href="' + esc(s.url) + '" rel="nofollow noopener" target="_blank">' +
        esc(s.title) + '</a> (' + esc(rev) + esc(pin) + ')</li>';
    }).join('');
  }

  /**
   * ESCORTS, IN TWO CHANNELS THAT NEVER TOUCH — and drawn so a reader cannot
   * mistake one for the other.
   *
   *   SOURCED. Six of the twenty-one jurisdictions publish a law-enforcement
   *   rate (AL, IL, IN, LA, NY, TN). Those are cited, effective-dated and
   *   resolved through the same conflict machinery as a permit fee, so they get
   *   the same surface a permit fee gets, with their citations attached.
   *   Illinois and Indiana resolve to NO FLOOR and say why — Illinois because
   *   two live schedules charge on different bases, Indiana because its schedule
   *   states no minimum at all, so there is nothing to floor.
   *
   *   THE CALLER'S OWN. A pilot-car figure computed from the rate typed into
   *   this page is drawn on `.ow-yours`: dashed outline, no surface of its own,
   *   and a literal YOUR RATE tag. We did not source it and must never let it
   *   borrow the authority of the numbers we did.
   *
   * NEITHER IS EVER ADDED TO THE OTHER, and neither is inside the permit total.
   */
  function renderEscorts(data) {
    var required = data.escorts.byState.filter(function (s) { return s.required > 0; });
    var est = data.escortEstimate ? data.escortEstimate.estimate : null;

    var head = '<p>' + esc(data.escorts.note) + '</p>' +
      (required.length
        ? '<ul>' + required.map(function (s) {
            return '<li><strong>' + esc(s.name) + '</strong> requires ' + s.required + ' certified escort' +
              (s.required === 1 ? '' : 's') + '.</li>';
          }).join('') + '</ul>'
        : '<p>No state on this lane requires a pilot car for the dimensions you entered. Several states can still impose one at the permitting office’s discretion.</p>');

    // ── The caller's own pilot-car arithmetic, marked as theirs.
    var yours = '';
    if (est && est.pilotCarsRequired > 0) {
      if (est.pilotCarBasis === 'userSupplied') {
        var perState = est.byJurisdiction.filter(function (e) { return e.pilotCars > 0; }).map(function (e) {
          var amt = e.pilotCarUsd === null
            ? 'not priceable from the rate you gave — see the notes below'
            : esc(usd(e.pilotCarUsd));
          return '<li><strong>' + esc(e.jurisdictionName) + '</strong> — ' + e.pilotCars + ' car' +
            (e.pilotCars === 1 ? '' : 's') + ' over ' +
            (e.milesInJurisdiction === null ? 'the miles you supplied' : esc(e.milesInJurisdiction) + ' mi') +
            ': ' + amt + '</li>';
        }).join('');
        yours = '<div class="ow-yours">' +
          '<span class="ow-yourtag">Your rate — not a figure we source</span>' +
          '<p class="ow-yourv">' +
          (est.pilotCarUsd === null ? 'Not priceable' : esc(usd(est.pilotCarUsd))) +
          '</p>' +
          '<p>' + esc(est.disclaimer) + '</p>' +
          '<ul>' + perState + '</ul>' +
          '</div>';
      } else {
        // The honest default. NEVER $0 — the cost is unknown, not nothing.
        yours = '<div class="ow-yours">' +
          '<span class="ow-yourtag">No pilot-car rate supplied</span>' +
          '<p class="ow-yourv">Cost unknown</p>' +
          '<p>' + esc(est.disclaimer) + '</p>' +
          '<p>Enter your own $/mile or $/day pilot-car rate in the form and it is applied to these counts, as its own figure beside the permit total and never inside it.</p>' +
          '</div>';
      }
    }

    // ── Law enforcement: cited, and on a cited surface.
    var police = '';
    if (est) {
      var policeStates = est.byJurisdiction.filter(function (e) { return e.policeRequired; });
      if (policeStates.length) {
        var items = policeStates.map(function (e) {
          var floor = e.policeFloorUsd === null
            ? '<strong>no floor can be derived</strong> — the published schedule states no minimum, or two schedules disagree about the basis'
            : 'published FLOOR for ' + e.policeOfficers + ' officer' + (e.policeOfficers === 1 ? '' : 's') +
              ': <strong>' + esc(usd(e.policeFloorUsd)) + '</strong>, before mileage and before any hour past the minimum';
          var range = (e.policeFloorLowUsd !== null && e.policeFloorHighUsd !== null && e.policeFloorLowUsd !== e.policeFloorHighUsd)
            ? ' Sources disagree: ' + esc(usd(e.policeFloorLowUsd)) + ' to ' + esc(usd(e.policeFloorHighUsd)) + '.'
            : '';
          var perMile = e.policePerMileUsd === null
            ? ''
            : ' The state also publishes ' + esc(usd(e.policePerMileUsd)) +
              ' per mile, measured from the officer’s own station — a distance we do not hold, so it is yours to apply and is not in the floor.';
          return '<li><strong>' + esc(e.jurisdictionName) + '</strong> — ' + floor + '.' + range + perMile + '</li>';
        }).join('');
        police = note(
          '',
          'Law-enforcement escorts — the rates the states publish',
          '<ul>' + items + '</ul>' +
          '<p>These are CITED figures, effective-dated and resolved exactly like a permit fee — a floor, never a total, because the hours are set by the agency on the day. No police money is inside the permit total either.</p>' +
          (est.policeSources.length
            ? '<details class="ow-fold"><summary>Sources for these escort rates (' + est.policeSources.length + ')</summary><ul>' + citeList(est.policeSources) + '</ul></details>'
            : ''),
        );
      }
    }

    var notes = '';
    if (est && est.warnings.length) {
      notes = '<details class="ow-fold"><summary>Every escort note on file (' + est.warnings.length +
        ') — nothing is dropped</summary><ul>' +
        est.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></details>';
    }

    return note(
      data.escorts.maxRequiredOnAnyState > 0 ? 'warn' : '',
      'Pilot cars / escorts',
      head + yours + notes,
    ) + police;
  }

  function render(data) {
    var q = data.quote;
    var byCodeReview = {};
    data.review.byState.forEach(function (r) { byCodeReview[r.code] = r; });
    var byCodeEscort = {};
    data.escorts.byState.forEach(function (r) { byCodeEscort[r.code] = r; });

    NOTE_FREQ = {};
    data.review.byState.forEach(function (r) {
      r.notes.forEach(function (n) { NOTE_FREQ[n] = (NOTE_FREQ[n] || 0) + 1; });
    });

    ESTIMATE_BY_CODE = {};
    if (data.escortEstimate && data.escortEstimate.estimate) {
      data.escortEstimate.estimate.byJurisdiction.forEach(function (e) {
        ESTIMATE_BY_CODE[e.jurisdiction] = e;
      });
    }

    var states = q.jurisdictions.map(function (j) {
      return renderState(j, byCodeReview[j.jurisdiction], byCodeEscort[j.jurisdiction]);
    }).join('');

    resultsEl.classList.remove('is-empty');
    resultsEl.innerHTML =
      renderTotal(data) +
      renderSummary(data) +
      renderUncovered(data) +
      renderEscorts(data) +
      states +
      renderAbsorbed(data) +
      renderMileage(data) +
      renderNotIncluded(data);
    resultsEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showMessage(kind, title, text) {
    resultsEl.innerHTML = note(kind, title, '<p>' + esc(text) + '</p>') + renderNotIncludedStatic();
  }

  /**
   * The server already rendered the exclusions block into the results column.
   * Capture it once and reuse it on the error path rather than keeping a second
   * copy of the same five sentences here — a copy that drifts the first time
   * OSOW_NOT_INCLUDED changes, and drifts on the ONE surface where the user has
   * no priced result to read instead.
   */
  var STATIC_NOT_INCLUDED = (function () {
    var el = resultsEl.querySelector('.ow-notincluded');
    return el ? el.outerHTML : '';
  })();

  function renderNotIncludedStatic() {
    return STATIC_NOT_INCLUDED;
  }

  // ── submit ───────────────────────────────────────────────────────────────

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var weight = num('ow-weight');
    if (weight === undefined || weight <= 0) {
      showMessage('error', 'Gross weight is needed', 'Every state prices the overweight permit from gross weight. Enter the loaded gross weight in pounds.');
      return;
    }

    var legs = [];
    var rows = legsEl.querySelectorAll('.ow-leg');
    for (var i = 0; i < rows.length; i++) {
      var sel = rows[i].querySelector('.ow-leg-state');
      var mi = rows[i].querySelector('.ow-leg-miles');
      var code = sel ? String(sel.value || '').trim().toUpperCase() : '';
      var rawMiles = mi ? String(mi.value == null ? '' : mi.value).trim() : '';
      if (!code) continue;
      if (rawMiles === '') {
        showMessage('error', 'Miles are missing for ' + code, 'Several states price the permit on miles travelled inside that state. We do not estimate them — enter the per-state mileage from your own routing software, the same figure that goes on the permit application.');
        return;
      }
      var milesVal = Number(rawMiles);
      // ZERO IS NOT A POSITIVE NUMBER, and the copy right here already said so.
      // A 0-mile leg used to price: Pennsylvania returned its base fee with a
      // $0.00 distance charge and reported the lane as priced, which understates
      // a per-mile state without saying anything is missing.
      if (!isFinite(milesVal) || milesVal <= 0) {
        showMessage('error', 'Miles for ' + code + ' are not a usable distance', 'Enter the in-state mileage as a positive number. Zero miles is an empty row, not a state the load crosses for free — remove the row if the load does not enter ' + code + '.');
        return;
      }
      legs.push({ state: code, miles: milesVal });
    }

    if (!legs.length) {
      showMessage('error', 'Add at least one state', 'Pick the states the load crosses and the miles it runs inside each one.');
      return;
    }

    if (legs.length > MAX_LEGS) {
      showMessage('error', 'Too many states on one lane', 'This calculator prices at most ' + MAX_LEGS + ' states in a single lane. Remove a state and try again.');
      return;
    }

    var payload = {
      load: { grossWeightLbs: weight },
      legs: legs,
    };

    /**
     * THE CALLER'S OWN PILOT-CAR RATE — sent only when they actually gave one.
     *
     * `pilotCarRate` is omitted entirely rather than sent as an empty object,
     * because an empty object is not "no rate" to the API: `hasUserRate` needs a
     * $/mile or a $/day, and sending `{}` would look like an attempt to price
     * with nothing. With the key absent the answer stays "we hold no pilot-car
     * rates", which is the correct answer and not a failure.
     *
     * `useInternalPilotCarBand` IS NEVER SENT. QuoteFleet's own fallback band is
     * our estimate, not a published figure, and this page does not offer to
     * substitute it for a rate the operator has not given us.
     */
    var pcMile = num('ow-pc-mile');
    var pcDay = num('ow-pc-day');
    var pcDays = num('ow-pc-days');
    var pcMin = num('ow-pc-min');
    if ((pcMile !== undefined && pcMile > 0) || (pcDay !== undefined && pcDay > 0)) {
      // A DAY RATE WITHOUT A DAY COUNT IS NOT A PRICE, and one day is not a safe
      // default — a five-day crossing billed as one is an order-of-magnitude
      // understatement. Refuse it here with the same words the help cue used
      // rather than shipping a request the API will answer with a null leg.
      if (pcDay !== undefined && pcDay > 0 && (pcDays === undefined || pcDays <= 0)) {
        showMessage(
          'error',
          'A pilot-car day rate needs a day count',
          'You entered a $/day pilot-car rate but no number of days per state. A day rate without a day count is not a price, and one day is not a safe default — a five-day crossing would be billed as one. Enter the days billed per state, or price the escorts per mile instead.',
        );
        return;
      }
      var rate = {};
      if (pcMile !== undefined && pcMile > 0) rate.usdPerMile = pcMile;
      if (pcDay !== undefined && pcDay > 0) {
        rate.usdPerDay = pcDay;
        rate.daysPerJurisdiction = pcDays;
      }
      if (pcMin !== undefined && pcMin > 0) rate.minimumUsdPerJurisdiction = pcMin;
      payload.pilotCarRate = rate;
    }
    var w = inches('ow-width-ft', 'ow-width-in');
    var h = inches('ow-height-ft', 'ow-height-in');
    var l = inches('ow-length-ft', 'ow-length-in');
    var kpra = num('ow-kpra-ft');
    var axles = num('ow-axles');
    if (w !== undefined) payload.load.widthIn = w;
    if (h !== undefined) payload.load.heightIn = h;
    if (l !== undefined) payload.load.overallLengthIn = l;
    if (kpra !== undefined) payload.load.kingpinToRearAxleIn = kpra * 12;
    if (axles !== undefined) payload.load.axleCount = Math.round(axles);
    if (routeClass) payload.load.routeClass = routeClass;

    var go = document.getElementById('ow-go');
    if (go) { go.disabled = true; go.textContent = 'Calculating…'; }
    resultsEl.innerHTML = card('<p class="ow-busy">Reading each state’s fee schedule…</p>');

    fetch('/api/tools/osow-permits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
      })
      .then(function (r) {
        if (!r.ok) {
          var msg = (r.body && r.body.error) || 'That request could not be priced.';
          if (r.status === 429) msg = 'Too many requests from this address. Wait a minute and try again.';
          showMessage('error', 'Nothing was calculated', msg);
          return;
        }
        render(r.body);
      })
      .catch(function () {
        showMessage('error', 'The calculator could not be reached', 'The request did not complete. Check your connection and try again — nothing was submitted or stored.');
      })
      .finally(function () {
        if (go) { go.disabled = false; go.textContent = 'Calculate permits'; }
      });
  });

  // ── The worked example ───────────────────────────────────────────────────
  //
  // A first-time visitor met three restatements of "this is not a freight quote"
  // and roughly two dozen empty fields before anything on this page produced a
  // number. One click now fills a real, priced lane — Houston to Buffalo, the
  // same fixture the test suite prices at $1,223.18 — so the output can be read
  // before anything is typed.
  //
  // IT FILLS THE FORM, IT DOES NOT FAKE A RESULT. Every field is set to a value
  // the user can see and edit, and the lane goes through the same POST any other
  // lane does, so what appears is the real engine's answer and not a mock.
  var EXAMPLE_LOAD = [
    ['ow-weight', '120000'],
    ['ow-width-ft', '12'], ['ow-width-in', '6'],
    ['ow-height-ft', '14'], ['ow-height-in', '6'],
    ['ow-length-ft', '85'], ['ow-length-in', '0'],
    ['ow-axles', '8'],
  ];
  var EXAMPLE_LEGS = [
    ['TX', 215], ['AR', 337], ['TN', 250], ['KY', 62.4],
    ['OH', 145], ['PA', 46], ['NY', 60],
  ];

  var exampleBtn = document.getElementById('ow-example');
  if (exampleBtn) {
    exampleBtn.addEventListener('click', function () {
      for (var i = 0; i < EXAMPLE_LOAD.length; i++) {
        var el = document.getElementById(EXAMPLE_LOAD[i][0]);
        if (el) el.value = EXAMPLE_LOAD[i][1];
      }
      var interstate = pillWrap ? pillWrap.querySelector('.ow-pill[data-route="interstate"]') : null;
      if (interstate && interstate.getAttribute('aria-pressed') !== 'true') interstate.click();

      var rows = legRows();
      for (var r = rows.length - 1; r >= 0; r--) rows[r].remove();
      for (var k = 0; k < EXAMPLE_LEGS.length; k++) addLeg(EXAMPLE_LEGS[k][0], EXAMPLE_LEGS[k][1]);
      syncCap();

      // The same submit path as the button, so nothing about the example is a
      // second code path that could drift from the real one.
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  // Expose the unit helper for the page's own tests / console checks.
  window.__owFtIn = ftIn;
})();
