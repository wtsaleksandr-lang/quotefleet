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

    var brand = data.brand || {};
    var root = document.documentElement;
    if (brand.primaryColor) root.style.setProperty('--qdoc-primary', brand.primaryColor);
    if (brand.accentColor) root.style.setProperty('--qdoc-accent', brand.accentColor);

    if (brand.logoUrl) {
      var logo = $('qdoc-logo');
      logo.src = brand.logoUrl;
      logo.hidden = false;
    }

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
    text('qdoc-pickup-title', data.lane.pickup.title);
    text('qdoc-pickup-subtitle', data.lane.pickup.subtitle || data.lane.pickup.zip || '');
    text('qdoc-delivery-title', data.lane.delivery.title);
    text('qdoc-delivery-subtitle', data.lane.delivery.subtitle || data.lane.delivery.zip || '');
    text('qdoc-miles', data.quote.distanceMiles ? Math.round(data.quote.distanceMiles) + ' miles' : 'Mileage unavailable');
    text('qdoc-issued-by', [displayName, data.issuedBy.email, data.issuedBy.phone].filter(Boolean).join(' · '));
    text('qdoc-print-url', data.quote.quoteUrl || location.href);

    var chat = $('qdoc-chat');
    chat.href = data.quote.chatUrl || ('/chat/' + encodeURIComponent(data.quote.refId));

    renderDetails(data);
    renderPricing(data);
    renderMap(data);
    renderAccessorials(data);
    renderAiSummary(data);
    wireActions(data);
  }

  function renderDetails(data) {
    var s = data.shipment || {};
    var flags = {
      Overweight: s.weightLbs && Number(s.weightLbs) > 44000,
      Hazmat: (s.accessorialCodes || []).indexOf('hazmat') >= 0,
      Reefer: /reefer|refrigerated/i.test(String(s.equipment || '')),
    };
    var rows = [
      ['Service', titleize(s.service)],
      ['Equipment', titleize(s.equipment)],
      ['Commodity', s.commodity],
      ['Weight', s.weightLbs ? Number(s.weightLbs).toLocaleString('en-US') + ' lb' : 'Not specified'],
      ['Pickup Date', s.pickupDate || 'Not specified'],
      ['Delivery Date', s.deliveryDate || 'Not specified'],
      ['Steamship Line', s.oceanCarrier || 'Not specified'],
      ['Booking #', s.bookingNumber || 'Not specified'],
      ['B/L #', s.billOfLadingNumber || 'Not specified'],
      ['Container #', s.containerNumbers || 'Not specified'],
      ['Overweight', bool(flags.Overweight)],
      ['Hazardous', bool(flags.Hazmat)],
      ['Refrigerated / Reefer', bool(flags.Reefer)],
      ['Notes', s.notes || '—'],
    ];
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
    var groups = [
      ['Drayage / Linehaul', byKind(lines, 'linehaul').concat(byKind(lines, 'minimum'))],
      ['Accessorials', byKind(lines, 'accessorial')],
      ['Fuel', byKind(lines, 'fuel')],
      ['Margin', byKind(lines, 'margin')],
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
    if (data.lane.mapImageUrl) {
      img.src = data.lane.mapImageUrl;
      img.hidden = false;
      fallback.hidden = true;
    } else {
      img.hidden = true;
      fallback.hidden = false;
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
    $('qdoc-email').onclick = function () {
      var subject = 'Quote ' + data.quote.refId + ' from ' + (data.brand.displayName || data.tenant.name);
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
