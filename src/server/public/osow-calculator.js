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
 *   3. Escorts render as a COUNT with "cost not included" spelled out. The
 *      engine can say how many pilot cars a state requires; it holds no rates.
 *   4. A state flagged for manual review shows every note the engine recorded
 *      for it, in full and expanded — the reason is in there, so it is never
 *      hidden behind a toggle.
 *   5. `totalPermitUsd === null` is NOT $0. It means something on the lane
 *      cannot be priced, and it renders as a refusal with the cause named.
 *   6. COVERED IS NOT PRICED. A state can be covered — we hold its schedule —
 *      and still come back unpriceable for this load, and the summary tile must
 *      not report the second as the first. See `renderFlags`.
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

  function renderTotal(data) {
    var q = data.quote;
    var priced = pricedCount(q);
    var value = usd(q.totalPermitUsd);

    var head;
    if (value) {
      head =
        '<p class="ow-tl">State permit fees — ' + priced + ' state' + (priced === 1 ? '' : 's') + '</p>' +
        '<p class="ow-tv">' + value + '</p>';
    } else {
      // null is not zero. Say which it is and why.
      head =
        '<p class="ow-tl">No lane total</p>' +
        '<p class="ow-tv">Not priceable</p>';
    }

    var sub = value
      ? 'State permit fees only. Not a freight quote — no line haul, no fuel, no escort cost, no margin.'
      : 'Part of this lane has no published price, so there is no honest lane total. The states below that could be priced still show their own fees.';

    return '<div class="ow-total">' + head + '<p class="ow-tsub">' + esc(sub) + '</p>' + renderFlags(data) + '</div>';
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

  function renderLines(j) {
    var rows = j.lines.map(function (l) {
      var amount = l.amountUsd === null ? 'Not priceable' : usd(l.amountUsd);
      var range = (l.lowUsd !== undefined && l.highUsd !== undefined && l.lowUsd !== l.highUsd)
        ? '<span class="ln">Sources disagree: ' + esc(usd(l.lowUsd)) + ' to ' + esc(usd(l.highUsd)) + '</span>' : '';
      var n = l.note ? '<span class="ln">' + esc(l.note) + '</span>' : '';
      return '<tr><td>' + esc(l.name) + n + range + '</td><td class="num">' + esc(amount) + '</td></tr>';
    }).join('');
    var sub = j.subtotalUsd === null ? 'Not priceable' : usd(j.subtotalUsd);
    return '<div class="ow-tablewrap"><table class="ow-lines">' +
      '<thead><tr><th>Fee</th><th class="num">Amount</th></tr></thead><tbody>' + rows +
      '<tr class="sub"><td>' + esc(j.jurisdictionName) + ' subtotal</td><td class="num">' + esc(sub) + '</td></tr>' +
      '</tbody></table></div>';
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
    var over = '';
    if (escortCount > 0) {
      over += '<p class="ow-over"><strong>' + esc(j.jurisdictionName) + ' requires ' + escortCount +
        ' certified escort' + (escortCount === 1 ? '' : 's') +
        '. The escort COST is not included in any figure on this page</strong> — the state sets the requirement, not the price.</p>';
    }
    if (j.overDimension && j.overDimension.details && j.overDimension.details.length) {
      over += '<p class="ow-over">Over ' + esc(j.jurisdictionName) + '’s legal limits: ' +
        esc(j.overDimension.details.join(' · ')) + '</p>';
    }
    // The grid is two columns wide, so an ODD count leaves one badge alone on
    // the last row. Pad with the as-of badge, which is worth stating anyway.
    if (badges.length % 2 === 1) badges.push('<span class="ow-badge">As of ' + esc(j.asOf) + '</span>');

    var why = '';
    if (j.requiresManualReview && reviewEntry && reviewEntry.notes.length) {
      why = '<div class="ow-why"><h4>Why ' + esc(j.jurisdictionName) + ' needs a human — every note on file (' + reviewEntry.notes.length + ')</h4><ol>' +
        reviewEntry.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') +
        '</ol></div>';
    } else if (j.warnings && j.warnings.length) {
      why = '<details class="ow-cites"><summary>' + j.warnings.length + ' note' + (j.warnings.length === 1 ? '' : 's') + ' on ' + esc(j.jurisdictionName) + '</summary><ul>' +
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

  function renderNotIncluded(data) {
    var items = data.notIncluded.map(function (n) {
      return '<li><strong>' + esc(n.item) + '.</strong> ' + esc(n.why) + '</li>';
    }).join('');
    return note('', 'What this total never includes', '<ul>' + items + '</ul>');
  }

  function renderMileage(data) {
    return note('', 'Where these miles came from', '<p>' + esc(data.mileage.note) + '</p><p>Lane total supplied: <strong>' + esc(data.mileage.totalMiles.toLocaleString('en-US')) + ' mi</strong>. Fee schedules read as of ' + esc(data.asOf) + '.</p>');
  }

  function render(data) {
    var q = data.quote;
    var byCodeReview = {};
    data.review.byState.forEach(function (r) { byCodeReview[r.code] = r; });
    var byCodeEscort = {};
    data.escorts.byState.forEach(function (r) { byCodeEscort[r.code] = r; });

    var states = q.jurisdictions.map(function (j) {
      return renderState(j, byCodeReview[j.jurisdiction], byCodeEscort[j.jurisdiction]);
    }).join('');

    var escortNote = note(
      data.escorts.maxRequiredOnAnyState > 0 ? 'warn' : '',
      'Pilot cars / escorts',
      '<p>' + esc(data.escorts.note) + '</p>' +
      (data.escorts.maxRequiredOnAnyState > 0
        ? '<ul>' + data.escorts.byState.filter(function (s) { return s.required > 0; }).map(function (s) {
            return '<li><strong>' + esc(s.name) + '</strong> requires ' + s.required + ' certified escort' + (s.required === 1 ? '' : 's') + '. Cost not included.</li>';
          }).join('') + '</ul>'
        : '<p>No state on this lane requires a pilot car for the dimensions you entered. Several states can still impose one at the permitting office’s discretion.</p>'),
    );

    resultsEl.innerHTML =
      renderTotal(data) +
      renderUncovered(data) +
      escortNote +
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
    var el = resultsEl.querySelector('.ow-note');
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

  // Expose the unit helper for the page's own tests / console checks.
  window.__owFtIn = ftIn;
})();
