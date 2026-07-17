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

  function accessorialAmount(a) {
    if (a.amount == null) return '';
    if (a.kind === 'pct_of_base') return Number(a.amount).toFixed(1) + '%';
    if (a.kind === 'per_mile') return money(Number(a.amount), 'USD') + ' / mi';
    if (a.kind === 'per_day') return money(Number(a.amount), 'USD') + ' / day';
    if (a.kind === 'per_hour') return money(Number(a.amount), 'USD') + ' / hr';
    return money(Number(a.amount), 'USD');
  }

  function renderAccessorials(data) {
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
      amt.textContent = accessorialAmount(a);
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
    $('qdoc-pdf').onclick = function () { window.print(); };
    // Deep-link auto-print: the widget's "Download PDF" action opens this page
    // with ?print=1 to trigger the browser's Save-as-PDF dialog on the branded
    // quote doc (no server-side PDF renderer is a dependency). Fires once the
    // doc has rendered so the print captures the full quote.
    try {
      if (new URLSearchParams(location.search).get('print') === '1') {
        setTimeout(function () { window.print(); }, 400);
      }
    } catch (e) { /* ignore */ }
    $('qdoc-email').onclick = function () {
      var subject = 'Quote ' + data.quote.refId + ' from ' + ((data.brand && data.brand.displayName) || data.tenant.name);
      var body = 'View quote ' + data.quote.refId + ': ' + (data.quote.quoteUrl || location.href) + '\n\nEstimated total: ' + money(data.quote.total, data.quote.currency);
      location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    };
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
