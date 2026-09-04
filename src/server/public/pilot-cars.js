/**
 * The pilot-car directory's only client script.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: the filtering. The index is a plain GET form
 * that the server renders, so every filtered view is a URL a dispatcher can
 * paste into an email, the page works with scripts blocked, and the deep links
 * the quote tools emit resolve without JavaScript. This file exists only for the
 * two things a GET form cannot do — submit a structured record, and delete one.
 *
 * ES5-flavoured on purpose, matching osow-calculator.js: these pages are served
 * as static files with no build step, and the audience includes dispatch offices
 * on old machines.
 */
(function () {
  'use strict';

  var form = document.getElementById('pc-join');
  var say = document.getElementById('pc-say');

  function tell(msg, kind) {
    if (!say) return;
    say.hidden = false;
    say.className = 'pc-say' + (kind ? ' is-' + kind : '');
    say.innerHTML = msg;
    say.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function val(id) {
    var el = document.getElementById(id);
    if (!el) return '';
    return String(el.value || '').trim();
  }

  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function num(id) {
    var raw = val(id);
    if (raw === '') return null;
    var n = Number(raw);
    return isFinite(n) ? Math.trunc(n) : null;
  }

  function group(name) {
    var out = [];
    var boxes = document.querySelectorAll('input[data-group="' + name + '"]:checked');
    for (var i = 0; i < boxes.length; i++) out.push(boxes[i].value);
    return out;
  }

  /**
   * Certifications are built as ONE ROW PER STATE, which is the whole point of
   * the schema: certification is a per-state fact with its own expiry, not a
   * property of the operator. The form collects one expiry for convenience and
   * says so; the manage link is where they diverge.
   *
   * An empty expiry becomes `null` — "no expiry on file" — and never today's
   * date. Defaulting it would publish a lapsed card as current.
   */
  function certifications() {
    var expiry = val('pc-cert-expiry');
    return group('certified').map(function (state) {
      var row = { state: state, status: 'certified' };
      if (expiry) row.expiresOn = expiry;
      return row;
    });
  }

  function payload() {
    var body = {
      businessName: val('pc-name'),
      email: val('pc-email'),
      statesCovered: group('states'),
      certifications: certifications(),
      reciprocityClaimedStates: group('reciprocity'),
      languages: [],
      hasHeightPole: checked('pc-eq-pole'),
      hasOversizeSigns: checked('pc-eq-signs'),
      hasFlags: checked('pc-eq-flags'),
      hasAmberLightBar: checked('pc-eq-amber'),
      hasTwoWayRadio: checked('pc-eq-radio'),
      takesSuperloads: checked('pc-superload'),
      takesNightMoves: checked('pc-night'),
      publishEmail: checked('pc-pub-email'),
      publishPhone: checked('pc-pub-phone'),
      publishContactName: checked('pc-pub-contact'),
      consentPublicListing: checked('pc-consent')
    };
    // Optional strings are OMITTED rather than sent empty: the schema treats an
    // absent field as "not stated" and an empty string as a value, and "not
    // stated" is the honest record for a box nobody filled in.
    if (val('pc-contact')) body.contactName = val('pc-contact');
    if (val('pc-phone')) body.phone = val('pc-phone');
    if (val('pc-website')) body.website = val('pc-website');
    if (val('pc-city')) body.homeBaseCity = val('pc-city');
    if (val('pc-homestate')) body.homeBaseState = val('pc-homestate');
    if (val('pc-vclass')) body.vehicleClass = val('pc-vclass');
    if (val('pc-ins-exp')) body.insuranceExpiresOn = val('pc-ins-exp');
    var radius = num('pc-radius');
    if (radius !== null) body.serviceRadiusMi = radius;
    var pole = num('pc-pole-in');
    if (pole !== null) body.heightPoleMaxIn = pole;
    var gvwr = num('pc-gvwr');
    if (gvwr !== null) body.vehicleGvwrLbs = gvwr;
    var ins = num('pc-ins-usd');
    if (ins !== null) body.insuranceLiabilityUsd = ins;
    return body;
  }

  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = document.getElementById('pc-submit');
      if (btn) btn.disabled = true;
      tell('Submitting…');

      fetch('/api/pilot-cars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload())
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { status: r.status, body: j };
          });
        })
        .then(function (res) {
          if (btn) btn.disabled = false;
          if (res.status === 503) {
            // NOT "thanks, we'll be in touch". Nothing was stored and the
            // operator has to know that, or they wait for a review that will
            // never happen.
            tell(
              '<strong>Your listing was NOT saved.</strong> We could not reach the directory database, so nothing was stored. Please try again in a minute — your details are still in the form.',
              'err'
            );
            return;
          }
          if (res.status !== 201) {
            tell(esc(res.body && res.body.error ? res.body.error : 'That did not go through.'), 'err');
            return;
          }
          tell(
            '<strong>Submitted, and queued for review.</strong>' +
              '<br><br>Save this manage link now — it is the only way back to your record, and we store only a hash of it, so we cannot send it to you again:' +
              '<br><br><span class="pc-token">' +
              esc(res.body.manageUrl) +
              '</span>' +
              '<br><br>Your listing will show as <em>Self-reported</em> until we have actually checked a document. That is not a downgrade — it is what every new record says here.',
            'ok'
          );
          if (form) form.reset();
        })
        .catch(function () {
          if (btn) btn.disabled = false;
          tell('We could not reach the server, so nothing was saved. Try again in a minute.', 'err');
        });
    });
  }

  // ── The manage page: withdraw and delete. ────────────────────────────────

  function post(url, onOk) {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) {
        return r.json().then(function (j) {
          return { status: r.status, body: j };
        });
      })
      .then(function (res) {
        if (res.status >= 400) {
          tell(esc(res.body && res.body.error ? res.body.error : 'That did not go through.'), 'err');
          return;
        }
        onOk(res.body);
      })
      .catch(function () {
        tell('We could not reach the server, so nothing was changed.', 'err');
      });
  }

  var withdraw = document.getElementById('pc-withdraw');
  if (withdraw) {
    withdraw.addEventListener('click', function () {
      post('/api/pilot-cars/manage/' + encodeURIComponent(withdraw.getAttribute('data-token')) + '/withdraw', function () {
        tell('Withdrawn. The listing is off the directory and the record is still here — this link still works.', 'ok');
      });
    });
  }

  var del = document.getElementById('pc-delete');
  if (del) {
    del.addEventListener('click', function () {
      // A confirm() for a genuinely irreversible action on the user's OWN
      // personal data. Everything else on this page is reversible and gets no
      // dialog; this one deletes the row and invalidates the only link back.
      var ok = window.confirm(
        'Delete this record permanently?\n\nYour business name, your name, your email and your phone number are removed from the database. There is no archive copy, this cannot be undone, and this manage link will stop working.'
      );
      if (!ok) return;
      post('/api/pilot-cars/manage/' + encodeURIComponent(del.getAttribute('data-token')) + '/delete', function (body) {
        tell('<strong>Deleted.</strong> ' + esc(body && body.note ? body.note : ''), 'ok');
        del.disabled = true;
        if (withdraw) withdraw.disabled = true;
      });
    });
  }
})();
