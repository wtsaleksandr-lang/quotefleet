(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function text(id, value) { var el = $(id); if (el) el.textContent = value == null || value === '' ? '—' : String(value); }
  function money(n, currency) {
    var value = typeof n === 'number' && !isNaN(n) ? n : 0;
    return value.toLocaleString('en-US', { style: 'currency', currency: currency || 'USD' });
  }
  function date(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function titleize(value) {
    return String(value || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function bool(value) { return value ? 'Yes' : 'No'; }
  function byKind(lines, kind) { return (lines || []).filter(function (l) { return l.kind === kind; }); }

  // Multi-recipient email share (parity with the widget share bar). Kept in
  // sync with the server cap (MAX_SHARE_RECIPIENTS in routes/quoteDoc.ts).
  var MAX_SHARE_RECIPIENTS = 10;
  var SHARE_EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
  function parseEmailList(raw) {
    return String(raw || '')
      .split(/[\s,;]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function refFromUrl() {
    var m = location.pathname.match(/\/quote\/([^/?#]+)/);
    if (m) return decodeURIComponent(m[1]);
    return new URLSearchParams(location.search).get('refId') || '';
  }

  var state = { data: null };
  var refId = refFromUrl();
  if (!refId) fail('Missing quote reference.');
  else load(refId);

  function load(ref) {
    fetch('/api/public/quote-doc/' + encodeURIComponent(ref))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) return fail(data.error);
        state.data = data;
        render(data);
      })
      .catch(function () { fail('Could not load this quote. Please refresh or contact the carrier.'); });
  }

  function fail(msg) {
    $('qdoc-loading').hidden = true;
    var e = $('qdoc-error');
    e.hidden = false;
    e.textContent = msg;
  }

  function render(data) {
    $('qdoc-loading').hidden = true;
    $('qdoc').hidden = false;

    // Expose the service so downstream polish (quote-polish.js) can keep
    // pricing labels service-aware — no drayage terminology on FTL/LTL.
    var svc = (data.shipment && data.shipment.service) || '';
    var qdocEl = $('qdoc');
    if (qdocEl) qdocEl.dataset.service = svc;

    var brand = data.brand || {};
    var root = document.documentElement;
    if (brand.primaryColor) root.style.setProperty('--qdoc-primary', brand.primaryColor);
    if (brand.accentColor) root.style.setProperty('--qdoc-accent', brand.accentColor);

    if (brand.logoUrl) {
      var logo = $('qdoc-logo');
      logo.src = brand.logoUrl;
      logo.hidden = false;
    }
    // With no logo the hidden <img> drops out of the carrier grid, collapsing
    // the name into the fixed logo column (mid-word wrapping). Switch to a
    // single-column layout so the name uses the full width.
    var carrierEl = document.querySelector('.qdoc-carrier');
    if (carrierEl) carrierEl.classList.toggle('qdoc-carrier--nologo', !brand.logoUrl);

    var displayName = brand.displayName || data.tenant.name;
    text('qdoc-carrier-name', displayName);
    text('qdoc-carrier-details', [
      data.tenant.contactPhone,
      data.tenant.contactEmail,
      data.tenant.mcNumber ? 'MC: ' + data.tenant.mcNumber : '',
      data.tenant.dotNumber ? 'US DOT: ' + data.tenant.dotNumber : '',
    ].filter(Boolean).join('  ·  '));

    text('qdoc-ref', data.quote.refId);
    text('qdoc-generated', date(data.quote.generatedAt));
    text('qdoc-expires', date(data.quote.expiresAt));
    text('qdoc-top-total', money(data.quote.total, data.quote.currency));
    text('qdoc-grand-total', money(data.quote.total, data.quote.currency));
    var transitRow = $('qdoc-transit-row');
    if (transitRow) {
      if (data.quote.transit && data.quote.transit.text) {
        text('qdoc-transit', data.quote.transit.text);
        transitRow.hidden = false;
      } else {
        transitRow.hidden = true;
      }
    }
    text('qdoc-pickup-title', data.lane.pickup.title);
    text('qdoc-pickup-subtitle', data.lane.pickup.subtitle || data.lane.pickup.zip || '');
    text('qdoc-delivery-title', data.lane.delivery.title);
    text('qdoc-delivery-subtitle', data.lane.delivery.subtitle || data.lane.delivery.zip || '');
    text('qdoc-miles', data.quote.distanceMiles ? Math.round(data.quote.distanceMiles) + ' miles' : 'Mileage unavailable');
    text('qdoc-issued-by', [displayName, data.issuedBy.email, data.issuedBy.phone].filter(Boolean).join(' · '));
    text('qdoc-print-url', data.quote.quoteUrl || location.href);

    // Terms / disclaimer — small print at the bottom of the quote (prints too).
    // Server resolves the carrier's own text or the platform default.
    var termsPanel = $('qdoc-terms-panel');
    if (termsPanel) {
      var terms = (data.quote && data.quote.disclaimer) || '';
      if (terms) { text('qdoc-terms', terms); termsPanel.hidden = false; }
      else termsPanel.hidden = true;
    }

    var chat = $('qdoc-chat');
    chat.href = data.quote.chatUrl || ('/chat/' + encodeURIComponent(data.quote.refId));

    renderDetails(data);
    renderPricing(data);
    renderMap(data);
    renderAccessorials(data);
    renderAiSummary(data);
    wireActions(data);

    // Progressive interactive enhancements (quote-interactive.js) — transit
    // conditions note, tap-to-explore map modal, line-item explanations, and
    // the total unfold. Guarded so the quote still renders if it's absent.
    if (window.qfQuoteEnhance) window.qfQuoteEnhance(data);
  }

  function renderDetails(data) {
    var s = data.shipment || {};
    var codes = s.accessorialCodes || [];
    var isDrayage = s.service === 'drayage';
    var rows = [
      ['Shipment Type', s.equipmentLabel || titleize(s.equipment || s.service)],
      ['Hazardous', bool(codes.indexOf('hazmat') >= 0)],
      ['Refrigerated / Reefer', bool(/reefer|refrigerated/i.test(String(s.equipment || '')) || codes.indexOf('reefer') >= 0)],
    ];
    // Drayage-only fields — never leak ocean/container terminology onto an
    // FTL / LTL / expedite / hotshot quote.
    if (isDrayage) {
      rows.splice(1, 0,
        ['Steamship Line', s.oceanCarrier || 'Not specified'],
        ['Overweight', bool(s.weightLbs && Number(s.weightLbs) > 44000)],
        ['Tri-axle', bool(codes.indexOf('tri_axle') >= 0 || codes.indexOf('triaxle') >= 0)]
      );
    }
    if (s.pickupDate) rows.push(['Pickup Date', s.pickupDate]);
    if (s.deliveryDate) rows.push(['Delivery Date', s.deliveryDate]);
    if (s.commodity) rows.push(['Commodity', s.commodity]);
    if (s.weightLbs) rows.push(['Weight', Number(s.weightLbs).toLocaleString('en-US') + ' lb']);
    // LTL size/weight rating — the basis behind the class-aware price.
    if (s.service === 'ltl') {
      if (s.lengthIn && s.widthIn && s.heightIn) {
        rows.push(['Dimensions', Math.round(s.lengthIn) + ' × ' + Math.round(s.widthIn) + ' × ' + Math.round(s.heightIn) + ' in']);
      }
      if (s.freightClass != null) {
        var fc = 'Class ' + s.freightClass;
        if (s.densityPcf) fc += ' (' + Number(s.densityPcf).toFixed(1) + ' lb/ft³)';
        rows.push(['Freight Class', fc]);
      }
      if (s.palletized != null) rows.push(['Palletized', bool(!!s.palletized)]);
      if (s.loadedFromDock != null) rows.push(['Dock Loading', s.loadedFromDock ? 'Dock' : 'No dock (liftgate)']);
    }
    if (s.bookingNumber) rows.push(['Booking #', s.bookingNumber]);
    if (s.billOfLadingNumber) rows.push(['B/L #', s.billOfLadingNumber]);
    if (s.containerNumbers) rows.push(['Container #', s.containerNumbers]);
    if (s.notes) rows.push(['Notes', s.notes]);

    var dl = $('qdoc-details');
    dl.innerHTML = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1] == null || r[1] === '' ? '—' : String(r[1]);
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  function renderPricing(data) {
    var wrap = $('qdoc-price-lines');
    wrap.innerHTML = '';
    var lines = data.quote.breakdown || [];
    // Generic, service-neutral headings. Margin is folded into the linehaul
    // line server-side (customerFacingLines) and never rendered to customers.
    var groups = [
      ['Line Haul', byKind(lines, 'linehaul').concat(byKind(lines, 'minimum'))],
      ['Accessorials', byKind(lines, 'accessorial')],
      ['Fuel', byKind(lines, 'fuel')],
      ['Notes', byKind(lines, 'note')],
    ];
    groups.forEach(function (group) {
      if (!group[1].length) return;
      var heading = document.createElement('div');
      heading.className = 'qdoc-price-heading';
      heading.textContent = group[0];
      wrap.appendChild(heading);
      group[1].forEach(function (line) {
        var row = document.createElement('div');
        row.className = 'qdoc-price-row';
        var name = document.createElement('span');
        name.textContent = line.name || 'Charge';
        if (line.note) {
          var note = document.createElement('small');
          note.textContent = line.note;
          name.appendChild(note);
        }
        var amt = document.createElement('strong');
        amt.textContent = money(Number(line.amount || 0), data.quote.currency);
        row.appendChild(name); row.appendChild(amt);
        wrap.appendChild(row);
      });
    });
    if (!lines.length) {
      var empty = document.createElement('p');
      empty.className = 'qdoc-muted';
      empty.textContent = 'No pricing breakdown is available for this quote.';
      wrap.appendChild(empty);
    }
  }

  function renderMap(data) {
    var img = $('qdoc-map');
    var fallback = $('qdoc-map-fallback');
    var wrap = $('qdoc-map-wrap');
    var caption = $('qdoc-map-caption');
    if (data.lane.mapImageUrl) {
      img.src = data.lane.mapImageUrl;
      img.hidden = false;
      fallback.hidden = true;
      if (wrap) wrap.classList.remove('is-empty');
      if (caption) {
        var miles = data.lane.mapDistanceMiles;
        caption.textContent =
          'Estimated route' + (miles != null ? ' · ' + Number(miles).toLocaleString('en-US') + ' mi' : '');
        caption.hidden = false;
      }
    } else {
      img.hidden = true;
      fallback.hidden = false;
      // Soften + shrink the fallback so a missing map reads as a compact note,
      // not a big unfinished gray void.
      if (wrap) wrap.classList.add('is-empty');
      if (caption) caption.hidden = true;
    }
  }

  // `currency` is the quote's own currency (data.quote.currency) — accessorial
  // rate units must wear the SAME label as the totals, never a hardcoded US $.
  function accessorialAmount(a, currency) {
    if (a.amount == null) return '';
    if (a.kind === 'pct_of_base') return Number(a.amount).toFixed(1) + '%';
    if (a.kind === 'per_mile') return money(Number(a.amount), currency) + ' / mi';
    if (a.kind === 'per_day') return money(Number(a.amount), currency) + ' / day';
    if (a.kind === 'per_hour') return money(Number(a.amount), currency) + ' / hr';
    return money(Number(a.amount), currency);
  }

  function renderAccessorials(data) {
    var currency = data.quote.currency;
    var selected = new Set(data.shipment.accessorialCodes || []);
    var wrap = $('qdoc-accessorials');
    wrap.innerHTML = '';
    var items = (data.possibleAccessorials || []).filter(function (a) {
      if (!a.appliesToServices || !a.appliesToServices.length) return true;
      return a.appliesToServices.indexOf(data.shipment.service) >= 0;
    });
    if (!items.length) {
      var p = document.createElement('p');
      p.className = 'qdoc-muted';
      p.textContent = 'No accessorial list is configured for this carrier yet.';
      wrap.appendChild(p);
      return;
    }
    items.forEach(function (a) {
      var card = document.createElement('div');
      card.className = 'qdoc-accessorial' + (selected.has(a.code) ? ' included' : '');
      var name = document.createElement('strong');
      name.textContent = a.label || titleize(a.code);
      var amt = document.createElement('span');
      amt.textContent = accessorialAmount(a, currency);
      var desc = document.createElement('small');
      desc.textContent = selected.has(a.code) ? 'Included/selected on this quote' : (a.description || 'May apply if required');
      card.appendChild(name); card.appendChild(amt); card.appendChild(desc);
      wrap.appendChild(card);
    });
  }

  function renderAiSummary(data) {
    if (!data.quote.aiSummary) return;
    var box = $('qdoc-ai-summary');
    box.hidden = false;
    box.textContent = data.quote.aiSummary;
  }

  function wireActions(data) {
    $('qdoc-print').onclick = function () { window.print(); };
    // "Download PDF" — one click → the server-rendered branded PDF file. Streams
    // from GET /api/public/quote-doc/:refId/pdf (Content-Disposition: attachment),
    // preserving any ?key= access grant on the current URL so a private quote's
    // PDF stays gated. Falls back to window.print() if the ref is unknown.
    $('qdoc-pdf').onclick = function () { downloadPdf(data); };
    // Legacy deep-link (?print=1) still triggers the browser print dialog for
    // any old widget builds that open the hosted quote to save a PDF.
    try {
      if (new URLSearchParams(location.search).get('print') === '1') {
        setTimeout(function () { window.print(); }, 400);
      }
    } catch (e) { /* ignore */ }
    // "Email" — reveal the multi-recipient share panel (parity with the widget
    // share bar). Sends the carrier-branded quote to several addresses via the
    // shared POST /api/public/quote-doc/:refId/share endpoint. Prefills the
    // customer's own address when known.
    var emailPanel = $('qdoc-email-panel');
    var emailInput = $('qdoc-email-input');
    var emailHint = $('qdoc-email-hint');
    if (emailHint) emailHint.textContent = 'Add up to ' + MAX_SHARE_RECIPIENTS + ' addresses, separated by commas. Each person gets the full quote.';
    $('qdoc-email').onclick = function () {
      if (!emailPanel) return;
      emailPanel.hidden = !emailPanel.hidden;
      if (!emailPanel.hidden) {
        setShareMsg('', '');
        if (emailInput) {
          var known = data.customer && data.customer.email;
          if (!emailInput.value && known && SHARE_EMAIL_RE.test(known)) emailInput.value = known;
          emailInput.focus();
        }
      }
    };
    var emailCancel = $('qdoc-email-cancel');
    if (emailCancel) emailCancel.onclick = function () { if (emailPanel) emailPanel.hidden = true; setShareMsg('', ''); };
    var emailSend = $('qdoc-email-send');
    if (emailSend) emailSend.onclick = function () { sendShareEmail(data); };
    $('qdoc-copy').onclick = function () {
      var url = data.quote.quoteUrl || location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { $('qdoc-copy').textContent = 'Copied'; });
      } else {
        window.prompt('Copy quote link:', url);
      }
    };
    $('qdoc-callback-open').onclick = function () {
      var box = $('qdoc-callback');
      box.hidden = !box.hidden;
      if (!box.hidden && data.customer.phone) $('qdoc-callback-phone').value = data.customer.phone;
    };
    $('qdoc-callback-cancel').onclick = function () {
      $('qdoc-callback').hidden = true;
      $('qdoc-callback-msg').textContent = '';
    };
    $('qdoc-callback-send').onclick = function () { sendCallback(data); };

    var acceptOpen = $('qdoc-accept-open');
    var acceptBox = $('qdoc-accept');
    if (acceptOpen && acceptBox) {
      acceptOpen.onclick = function () {
        acceptBox.hidden = !acceptBox.hidden;
        if (!acceptBox.hidden) { var d = $('qdoc-accept-date'); if (d) d.focus(); }
      };
      var acceptCancel = $('qdoc-accept-cancel');
      if (acceptCancel) acceptCancel.onclick = function () {
        acceptBox.hidden = true;
        var m = $('qdoc-accept-msg'); if (m) { m.textContent = ''; m.className = 'qdoc-accept-msg'; }
      };
      var acceptSend = $('qdoc-accept-send');
      if (acceptSend) acceptSend.onclick = function () { sendAccept(data); };
    }
  }

  function downloadPdf(data) {
    var ref = (data && data.quote && data.quote.refId) || refId;
    if (!ref) { window.print(); return; }
    // Carry a ?key= access grant (private calculators) through to the PDF route.
    var key = '';
    try { key = new URLSearchParams(location.search).get('key') || ''; } catch (e) {}
    var url = '/api/public/quote-doc/' + encodeURIComponent(ref) + '/pdf' + (key ? '?key=' + encodeURIComponent(key) : '');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'quote-' + ref + '.pdf';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
  }

  function sendAccept(data) {
    var msg = $('qdoc-accept-msg');
    var btn = $('qdoc-accept-send');
    var dateEl = $('qdoc-accept-date');
    var noteEl = $('qdoc-accept-note');
    if (msg) { msg.textContent = 'Sending…'; msg.className = 'qdoc-accept-msg'; }
    if (btn) btn.disabled = true;
    fetch('/api/public/accept/' + encodeURIComponent(data.quote.refId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: (data.customer && data.customer.name) || undefined,
        customerEmail: (data.customer && data.customer.email) || undefined,
        preferredDate: (dateEl && dateEl.value.trim()) || undefined,
        note: (noteEl && noteEl.value.trim()) || undefined,
      }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.body && res.body.error)) throw new Error((res.body && res.body.error) || 'Could not submit your booking request.');
        // Replace the whole CTA block with a clear confirmation.
        var book = document.querySelector('.qdoc-book');
        if (book) {
          book.innerHTML = '';
          var ok = document.createElement('div');
          ok.className = 'qdoc-book-confirmed';
          ok.innerHTML = '<strong>✓ Booking requested</strong><span>The carrier has been notified and will confirm pickup details with you shortly.</span>';
          book.appendChild(ok);
        }
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        if (msg) { msg.textContent = err.message || 'Could not submit your booking request.'; msg.className = 'qdoc-accept-msg error'; }
      });
  }

  function setShareMsg(msg, kind) {
    var el = $('qdoc-email-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'qdoc-accept-msg' + (kind ? ' ' + kind : '');
  }

  function sendShareEmail(data) {
    var input = $('qdoc-email-input');
    var btn = $('qdoc-email-send');
    var recipients = parseEmailList(input ? input.value : '');
    if (!recipients.length) { setShareMsg('Please enter at least one email address.', 'error'); return; }
    if (recipients.length > MAX_SHARE_RECIPIENTS) {
      setShareMsg('You can share with at most ' + MAX_SHARE_RECIPIENTS + ' people at a time.', 'error');
      return;
    }
    var bad = recipients.filter(function (e) { return !SHARE_EMAIL_RE.test(e); });
    if (bad.length) { setShareMsg('That email looks invalid: ' + bad[0], 'error'); return; }
    var old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    setShareMsg('', '');
    fetch('/api/public/quote-doc/' + encodeURIComponent(data.quote.refId) + '/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipients: recipients }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = old; }
        if (res.ok && res.body && res.body.sent) {
          setShareMsg('Sent to ' + res.body.sent + (res.body.sent === 1 ? ' recipient.' : ' recipients.'), 'ok');
          if (input) input.value = '';
        } else {
          setShareMsg((res.body && res.body.message) || 'Could not send — please try again.', 'error');
        }
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = old; }
        setShareMsg('Network error — please try again.', 'error');
      });
  }

  function sendCallback(data) {
    var msg = $('qdoc-callback-msg');
    var phone = $('qdoc-callback-phone').value.trim();
    var topic = $('qdoc-callback-topic').value.trim();
    if (!phone) {
      msg.textContent = 'Please enter a phone number.';
      msg.className = 'qdoc-callback-msg error';
      return;
    }
    msg.textContent = 'Sending…';
    msg.className = 'qdoc-callback-msg';
    fetch('/api/public/callback/' + encodeURIComponent(data.quote.refId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: data.customer.name || 'Quote customer',
        customerPhone: phone,
        customerEmail: data.customer.email || undefined,
        customerCompany: data.customer.company || undefined,
        topic: topic || 'Callback requested from hosted quote page',
        triggerSource: 'visitor_button',
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        if (resp.error) throw new Error(resp.error);
        msg.textContent = 'Callback request sent.';
        msg.className = 'qdoc-callback-msg ok';
      })
      .catch(function (err) {
        msg.textContent = err.message || 'Could not send callback request.';
        msg.className = 'qdoc-callback-msg error';
      });
  }
})();
