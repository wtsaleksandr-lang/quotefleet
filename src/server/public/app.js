// QuoteFleet — tenant dashboard SPA. Vanilla JS.
(function () {
  'use strict';

  function $(s, root) { return (root || document).querySelector(s); }
  function $$(s, root) { return Array.from((root || document).querySelectorAll(s)); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return e;
  }
  function fmtMoney(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) { var err = new Error(j.error || ('HTTP ' + r.status)); err.status = r.status; throw err; }
        return j;
      });
    });
  }

  // ── Toast helper ──────────────────────────────────────────────
  // Replaces native alert() and silent .then() — gives users visible
  // feedback for save actions. Auto-dismisses after 2.5s for success,
  // 5s for error. Stacks vertically in the corner.
  function ensureToastRoot() {
    var t = document.getElementById('qf-toasts');
    if (t) return t;
    t = document.createElement('div');
    t.id = 'qf-toasts';
    t.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(t);
    return t;
  }
  function toast(msg, kind) {
    var root = ensureToastRoot();
    var bg = kind === 'error' ? '#b91c1c' : (kind === 'warn' ? '#b45309' : '#059669');
    var node = document.createElement('div');
    node.textContent = msg;
    node.style.cssText =
      'background:' + bg + ';color:#fff;padding:10px 14px;border-radius:8px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.25);font-size:13px;font-weight:500;' +
      'pointer-events:auto;max-width:340px;opacity:0;transform:translateY(8px);' +
      'transition:opacity 0.18s ease, transform 0.18s ease;';
    root.appendChild(node);
    requestAnimationFrame(function () { node.style.opacity = '1'; node.style.transform = 'translateY(0)'; });
    var ttl = kind === 'error' ? 5000 : 2500;
    setTimeout(function () {
      node.style.opacity = '0'; node.style.transform = 'translateY(8px)';
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 250);
    }, ttl);
  }
  function toastErr(err) { toast(err && err.message ? err.message : String(err || 'Error'), 'error'); }
  function toastOk(msg) { toast(msg || 'Saved', 'success'); }
  // Wrap a save promise so blur-handlers get visible feedback.
  function saved(p, okMsg) {
    return p.then(function (r) { toastOk(okMsg); return r; }, function (e) { toastErr(e); throw e; });
  }
  // Expose to inline handlers + future use.
  window.qfToast = toast;
  window.qfToastErr = toastErr;
  window.qfToastOk = toastOk;
  window.qfSaved = saved;

  var state = { me: null, route: null };

  function setActiveNav(route) {
    $$('.sidebar .nav-item').forEach(function (b) {
      b.classList.toggle('active', b.dataset.route === route);
    });
  }

  function go(route) {
    state.route = route;
    setActiveNav(route);
    history.pushState({}, '', '/app/' + route);
    var c = $('#page-content');
    c.innerHTML = '<div class="muted">Loading…</div>';
    if (route === 'overview') return renderOverview(c);
    if (route === 'leads') return renderLeads(c);
    if (route === 'rates') return renderRates(c);
    if (route === 'accessorials') return renderAccessorials(c);
    if (route === 'zones') return renderZones(c);
    if (route === 'ai') return renderAi(c);
    if (route === 'ingest') return renderIngest(c);
    if (route === 'brand') return renderBrand(c);
    if (route === 'embed') return renderEmbed(c);
    if (route === 'audit') return renderAudit(c);
    if (route === 'account') return renderAccount(c);
    if (route === 'callbacks') return renderCallbacks(c);
  }

  // ── Theme toggle ──────────────────────────────────────────────
  // Lucide-style line icons (stroke=currentColor so they theme with the UI).
  var SUN_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var WRENCH_SVG = '<svg class="qf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  function wireThemeToggle() {
    var btn = document.getElementById('qf-theme-toggle');
    var icon = document.getElementById('qf-theme-icon');
    var label = document.getElementById('qf-theme-label');
    if (!btn) return;
    function paint() {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      // Icon + label both reflect the CURRENT theme.
      icon.innerHTML = isLight ? SUN_SVG : MOON_SVG;
      label.textContent = isLight ? 'Light' : 'Dark';
      btn.setAttribute('aria-label', 'Switch to ' + (isLight ? 'dark' : 'light') + ' theme');
    }
    paint();
    btn.addEventListener('click', function () {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('qf-theme', 'dark'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        try { localStorage.setItem('qf-theme', 'light'); } catch (e) {}
      }
      paint();
    });
  }

  // ── Account page ──────────────────────────────────────────────
  // Lets the user change name / email / phone / password and sign out
  // every other session. All endpoints under /api/auth/* (server-side
  // additions in routes/auth.ts).
  function renderAccount(c) {
    api('/api/auth/me').then(function (r) {
      if (!r.user) { location.href = '/login'; return; }
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Account' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Profile, password, and session management.' }));

      // Profile card
      var pCard = el('div', { class: 'card' });
      pCard.appendChild(el('div', { class: 'card-title', text: 'Profile' }));
      function profileRow(labelText, key, type) {
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: labelText }));
        var inp = el('input', { class: 'input', value: r.user[key] || (r.tenant && r.tenant[key]) || '', type: type || 'text' });
        inp.dataset.key = key;
        f.appendChild(inp);
        return f;
      }
      pCard.appendChild(profileRow('Name', 'name'));
      pCard.appendChild(profileRow('Email', 'email', 'email'));
      var saveProfile = el('button', { class: 'btn btn-primary', text: 'Save profile', style: { marginTop: '8px' } });
      saveProfile.addEventListener('click', function () {
        var body = {};
        $$('input[data-key]', pCard).forEach(function (i) { body[i.dataset.key] = i.value; });
        saved(api('/api/auth/profile', { method: 'PUT', body: body }), 'Profile saved');
      });
      pCard.appendChild(saveProfile);
      c.appendChild(pCard);

      // Password card
      var pwd = el('div', { class: 'card', style: { marginTop: '14px' } });
      pwd.appendChild(el('div', { class: 'card-title', text: 'Change password' }));
      function pwdField(labelText, name) {
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: labelText }));
        var inp = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
        inp.dataset.name = name;
        f.appendChild(inp);
        return f;
      }
      pwd.appendChild(pwdField('Current password', 'current'));
      pwd.appendChild(pwdField('New password (10+ chars)', 'next'));
      pwd.appendChild(pwdField('Confirm new password', 'confirm'));
      var pwdBtn = el('button', { class: 'btn btn-primary', text: 'Update password', style: { marginTop: '8px' } });
      pwdBtn.addEventListener('click', function () {
        var fields = {};
        $$('input[data-name]', pwd).forEach(function (i) { fields[i.dataset.name] = i.value; });
        if (!fields.current || !fields.next) return toastErr({ message: 'Both current and new password required.' });
        if (fields.next !== fields.confirm) return toastErr({ message: 'New password and confirmation do not match.' });
        if (fields.next.length < 10) return toastErr({ message: 'New password must be at least 10 characters.' });
        saved(
          api('/api/auth/password', { method: 'PUT', body: { current: fields.current, next: fields.next } }),
          'Password updated. You stay signed in here.'
        ).then(function () { $$('input[data-name]', pwd).forEach(function (i) { i.value = ''; }); });
      });
      pwd.appendChild(pwdBtn);
      c.appendChild(pwd);

      // Sessions card
      var sess = el('div', { class: 'card', style: { marginTop: '14px' } });
      sess.appendChild(el('div', { class: 'card-title', text: 'Active sessions' }));
      sess.appendChild(el('p', { class: 'muted', style: { marginTop: 0 }, text: 'Sign out from every device, including this one. You will be returned to the login page.' }));
      var soa = el('button', { class: 'btn btn-danger', text: 'Sign out everywhere' });
      soa.addEventListener('click', function () {
        if (!confirm('Sign out of every device including this one?')) return;
        api('/api/auth/sign-out-all', { method: 'POST' }).finally(function () { location.href = '/login'; });
      });
      sess.appendChild(soa);
      c.appendChild(sess);
    }).catch(showErr(c));
  }

  // ── Overview ──────────────────────────────────────────────────
  function renderOverview(c) {
    api('/api/tenant/overview').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Overview' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Welcome back to ' + (d.tenant.name || 'your dashboard') + '.' }));
      var stats = el('div', { class: 'features', style: { margin: '0 0 24px 0' } });
      [
        ['Leads (all time)', d.stats.totalLeads],
        ['New / unactioned', d.stats.newLeads],
        ['Won', d.stats.wonLeads],
        ['Avg. quote', '$' + fmtMoney(d.stats.avgQuote)],
      ].forEach(function (s) {
        var card = el('div', { class: 'feature' });
        card.appendChild(el('div', { class: 'muted-small', text: s[0] }));
        card.appendChild(el('div', { style: { fontSize: '28px', fontWeight: '800', letterSpacing: '-0.02em' }, text: String(s[1]) }));
        stats.appendChild(card);
      });
      c.appendChild(stats);

      c.appendChild(el('h2', { text: 'Recent leads' }));
      if (!d.recentLeads.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No leads yet. Share your widget link to get your first.' }));
      } else {
        var tbl = el('table', { class: 'table' });
        tbl.innerHTML =
          '<thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Lane</th><th style="text-align:right;">Total</th><th>When</th><th>Status</th></tr></thead><tbody></tbody>';
        var tb = $('tbody', tbl);
        d.recentLeads.forEach(function (l) {
          tb.innerHTML += '<tr>' +
            '<td><a href="/app/leads/' + encodeURIComponent(l.refId) + '" data-route="leads/' + encodeURIComponent(l.refId) + '">' + l.refId + '</a></td>' +
            '<td>' + (l.customerName || '—') + '<br><span class="muted-small">' + (l.customerEmail || '') + '</span></td>' +
            '<td>' + (l.service || '') + ' / ' + (l.equipment || '') + '</td>' +
            '<td>' + (l.pickupCity || '?') + ' → ' + (l.deliveryCity || '?') + '<br><span class="muted-small">' + (l.distanceMiles ? Math.round(l.distanceMiles) + ' mi' : '') + '</span></td>' +
            '<td style="text-align:right;font-variant-numeric:tabular-nums;">$' + fmtMoney(l.quotedTotal) + '</td>' +
            '<td><span class="muted-small">' + fmtDate(l.createdAt) + '</span></td>' +
            '<td><span class="badge ' + statusClass(l.status) + '">' + l.status + '</span></td>' +
            '</tr>';
        });
        c.appendChild(tbl);
      }

      c.appendChild(el('h2', { text: 'Recent AI / manual edits', style: { marginTop: '32px' } }));
      if (!d.audit.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No edits yet.' }));
      } else {
        var ul = el('div', { class: 'card' });
        d.audit.forEach(function (a) {
          ul.appendChild(el('div', {
            class: 'card-row',
            html: '<div><strong>' + a.action + '</strong> <span class="badge ' +
              (a.actorKind === 'ai_agent' ? 'badge-info' : 'badge-muted') + '">' + a.actorKind +
              '</span><br><span class="muted-small">' + (a.detailsJson && a.detailsJson.reason ? a.detailsJson.reason : '') + '</span></div>' +
              '<span class="muted-small">' + fmtDate(a.createdAt) + '</span>',
          }));
        });
        c.appendChild(ul);
      }
    }).catch(showErr(c));
  }

  function statusClass(s) {
    return ({
      new: 'badge-info', draft: 'badge-muted', replied: 'badge-info',
      won: 'badge-success', lost: 'badge-error', spam: 'badge-error',
    })[s] || 'badge-muted';
  }

  // ── Leads ─────────────────────────────────────────────────────
  function renderLeads(c) {
    var inner = location.pathname.split('/app/leads/')[1];
    if (inner) return renderLeadDetail(c, inner);
    api('/api/tenant/leads').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Leads' }));
      c.appendChild(el('p', { class: 'page-sub', text: d.leads.length + ' total' }));
      if (!d.leads.length) {
        c.appendChild(el('div', {
          class: 'notice',
          html: 'No leads yet. Copy your <a href="/app/embed">embed code</a> and add it to your website to start collecting quotes.',
        }));
        return;
      }
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Lane</th><th style="text-align:right;">Total</th><th>Status</th><th>When</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.leads.forEach(function (l) {
        tb.appendChild(el('tr', {
          on: { click: function () { go('leads/' + l.refId); } },
          style: { cursor: 'pointer' },
          html: '<td><strong>' + l.refId + '</strong></td>' +
                '<td>' + (l.customerName || '—') + '<br><span class="muted-small">' + (l.customerEmail || '') + '</span></td>' +
                '<td>' + (l.service || '') + ' / ' + (l.equipment || '') + '</td>' +
                '<td>' + (l.pickupCity || '?') + ' → ' + (l.deliveryCity || '?') + '</td>' +
                '<td style="text-align:right;">$' + fmtMoney(l.quotedTotal) + '</td>' +
                '<td><span class="badge ' + statusClass(l.status) + '">' + l.status + '</span></td>' +
                '<td><span class="muted-small">' + fmtDate(l.createdAt) + '</span></td>',
        }));
      });
      c.appendChild(tbl);
    }).catch(showErr(c));
  }

  function renderLeadDetail(c, refId) {
    api('/api/tenant/leads/' + encodeURIComponent(refId)).then(function (d) {
      var l = d.lead;
      c.innerHTML = '';
      c.appendChild(el('a', { href: '#', class: 'muted-small', text: '← Back to leads', on: { click: function (e) { e.preventDefault(); go('leads'); } } }));
      c.appendChild(el('h1', { text: l.refId }));
      var grid = el('div', { class: 'grid-2' });

      var leftCard = el('div', { class: 'card' });
      leftCard.appendChild(el('div', { class: 'card-title', text: 'Customer' }));
      leftCard.innerHTML += '<div><strong>' + (l.customerName || '—') + '</strong></div>' +
        '<div class="muted">' + (l.customerEmail || '') + '</div>' +
        (l.customerPhone ? '<div class="muted">' + l.customerPhone + '</div>' : '') +
        (l.customerCompany ? '<div class="muted">' + l.customerCompany + '</div>' : '');

      var rightCard = el('div', { class: 'card' });
      rightCard.appendChild(el('div', { class: 'card-title', text: 'Shipment' }));
      rightCard.innerHTML += '<div><strong>' + (l.service || '') + '</strong> / ' + (l.equipment || '') + '</div>' +
        '<div class="muted">' + (l.pickupCity || '?') + ', ' + (l.pickupState || '') + ' → ' + (l.deliveryCity || '?') + ', ' + (l.deliveryState || '') + '</div>' +
        '<div class="muted">' + (l.distanceMiles ? Math.round(l.distanceMiles) + ' mi' : '') + (l.weightLbs ? ' · ' + l.weightLbs + ' lbs' : '') + '</div>' +
        '<div class="muted">' + (l.pickupDate ? 'Pickup: ' + l.pickupDate : '') + '</div>';

      grid.appendChild(leftCard);
      grid.appendChild(rightCard);
      c.appendChild(grid);

      // Quote card
      var quoteCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      quoteCard.appendChild(el('div', { class: 'card-title', text: 'Quote — $' + fmtMoney(l.quotedTotal) }));
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>Line</th><th style="text-align:right;">Amount</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      (l.breakdownJson || []).forEach(function (b) {
        tb.innerHTML += '<tr><td>' + b.name + '</td><td style="text-align:right;">$' + fmtMoney(b.amount) + '</td></tr>';
      });
      quoteCard.appendChild(tbl);
      c.appendChild(quoteCard);

      // Status / notes
      var statusCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      statusCard.appendChild(el('div', { class: 'card-title', text: 'Status & notes' }));
      statusCard.appendChild(el('div', { class: 'grid-2' }, [
        (function () {
          var f = el('div', { class: 'field' });
          f.appendChild(el('label', { class: 'field-label', text: 'Status' }));
          var sel = el('select', { class: 'select' });
          ['draft', 'new', 'replied', 'won', 'lost', 'spam'].forEach(function (s) {
            var o = document.createElement('option'); o.value = s; o.textContent = s; if (l.status === s) o.selected = true; sel.appendChild(o);
          });
          sel.addEventListener('change', function () { api('/api/tenant/leads/' + encodeURIComponent(l.refId), { method: 'PATCH', body: { status: sel.value } }).catch(toastErr); });
          f.appendChild(sel);
          return f;
        })(),
      ]));
      statusCard.appendChild(el('div', { class: 'field', style: { marginTop: '12px' } }, [
        el('label', { class: 'field-label', text: 'Internal notes' }),
        (function () {
          var ta = el('textarea', { class: 'textarea', placeholder: 'Notes for your team…' });
          ta.value = l.notes || '';
          ta.addEventListener('blur', function () { api('/api/tenant/leads/' + encodeURIComponent(l.refId), { method: 'PATCH', body: { notes: ta.value } }).catch(toastErr); });
          return ta;
        })(),
      ]));
      c.appendChild(statusCard);

      // AI summary
      if (l.aiSummary) {
        var aiCard = el('div', { class: 'card', style: { marginTop: '14px' } });
        aiCard.appendChild(el('div', { class: 'card-title', text: 'AI auto-reply (sent to customer)' }));
        aiCard.appendChild(el('pre', { class: 'code', text: l.aiSummary }));
        c.appendChild(aiCard);
      }

      // Conversation
      if (d.conversations && d.conversations.length) {
        var convCard = el('div', { class: 'card', style: { marginTop: '14px' } });
        convCard.appendChild(el('div', { class: 'card-title', text: 'Customer chat (' + d.conversations.length + ' messages)' }));
        var msgs = el('div', { class: 'chat-panel', style: { height: '320px' } });
        var msgList = el('div', { class: 'chat-messages' });
        d.conversations.forEach(function (m) {
          msgList.appendChild(el('div', { class: 'chat-bubble ' + (m.role === 'assistant' ? 'assistant' : 'user'), text: m.content }));
        });
        msgs.appendChild(msgList);
        convCard.appendChild(msgs);
        c.appendChild(convCard);
      }
    }).catch(showErr(c));
  }

  // ── Callbacks ─────────────────────────────────────────────────
  // Inbox of human-callback requests. Defaults to "needs attention"
  // (open + in_progress). Operator can flip status / add notes inline.
  var CALLBACK_STATUSES = ['open', 'in_progress', 'completed', 'no_answer', 'cancelled'];
  function renderCallbacks(c) {
    api('/api/tenant/callbacks').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Callbacks' }));
      var open = (d.callbacks || []).filter(function (cb) { return cb.status === 'open'; });
      c.appendChild(el('p', {
        class: 'page-sub',
        text: open.length + ' open · ' + (d.callbacks || []).length + ' total',
      }));
      if (!d.callbacks || !d.callbacks.length) {
        c.appendChild(el('div', {
          class: 'notice',
          text: "No callback requests yet. They'll appear here when a visitor taps 'Ask for a callback' on a quote.",
        }));
        return;
      }
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr>' +
        '<th>Customer</th><th>Phone</th><th>Quote</th><th>Topic / preferred time</th>' +
        '<th>Status</th><th>When</th><th></th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.callbacks.forEach(function (cb) {
        var row = el('tr', {});
        var topicLine = (cb.topic || '').slice(0, 80);
        if (cb.preferredTime) topicLine = topicLine ? topicLine + ' · ' + cb.preferredTime : cb.preferredTime;
        row.innerHTML =
          '<td><strong>' + (cb.customerName || '—') + '</strong>' +
            (cb.customerCompany ? '<br><span class="muted-small">' + cb.customerCompany + '</span>' : '') + '</td>' +
          '<td><a href="tel:' + encodeURIComponent(cb.customerPhone) + '">' + cb.customerPhone + '</a>' +
            (cb.customerEmail ? '<br><span class="muted-small">' + cb.customerEmail + '</span>' : '') + '</td>' +
          '<td>' + (cb.leadRefId ? '<a href="/app/leads/' + encodeURIComponent(cb.leadRefId) + '" data-route="leads/' + encodeURIComponent(cb.leadRefId) + '">' + cb.leadRefId + '</a>' : '<span class="muted-small">—</span>') + '</td>' +
          '<td><span class="muted-small">' + (topicLine || '—') + '</span>' +
            (cb.triggerSource === 'chat_escalation' ? '<br><span class="badge">from chat</span>' : '') + '</td>' +
          '<td></td>' +
          '<td><span class="muted-small">' + fmtDate(cb.createdAt) + '</span></td>' +
          '<td></td>';
        // Status select.
        var statusCell = row.children[4];
        var sel = el('select', { class: 'select' });
        CALLBACK_STATUSES.forEach(function (s) {
          var o = document.createElement('option'); o.value = s; o.textContent = s; if (cb.status === s) o.selected = true; sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
          api('/api/tenant/callbacks/' + cb.id, { method: 'PATCH', body: { status: sel.value } })
            .then(function () { setTimeout(function () { renderCallbacks(c); }, 80); })
            .catch(toastErr);
        });
        statusCell.appendChild(sel);
        // Notes editor — inline expandable textarea. Replaces the old
        // window.prompt() flow (which violated the title-in-field +
        // top-left help-cue UI rule and offered no dark-mode contrast).
        var actCell = row.children[6];
        var notesBtn = el('button', {
          class: 'btn-link',
          text: cb.notes ? 'Edit notes' : 'Add notes',
        });
        actCell.appendChild(notesBtn);
        tb.appendChild(row);

        // Editor row — always present in DOM, hidden until expanded so
        // the show/hide is a CSS toggle (no re-render flicker on save).
        // 2px gap to the row above is the project's UI-rule baseline.
        var editorTr = el('tr', { class: 'callback-notes-editor' });
        var editorTd = el('td', {
          colspan: '7',
          style: { padding: '2px 12px 12px 12px' },
        });
        var field = el('div', { class: 'field', style: { gap: '2px' } });
        var labelRow = el('div', {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '12px',
          },
        });
        labelRow.appendChild(el('label', { class: 'field-label', text: 'Notes' }));
        labelRow.appendChild(el('span', {
          class: 'field-hint',
          text: 'Visible only to your team · ⌘/Ctrl+Enter to save',
          style: { fontSize: '11px' },
        }));
        field.appendChild(labelRow);
        var ta = el('textarea', {
          class: 'textarea',
          rows: '3',
          placeholder: 'Call outcome, follow-ups, etc.',
        });
        ta.value = cb.notes || '';
        field.appendChild(ta);
        editorTd.appendChild(field);
        editorTr.appendChild(editorTd);
        editorTr.style.display = cb.notes ? '' : 'none';
        tb.appendChild(editorTr);

        function saveNotes() {
          var next = ta.value;
          if (next === (cb.notes || '')) return;
          api('/api/tenant/callbacks/' + cb.id, { method: 'PATCH', body: { notes: next } })
            .then(function () {
              cb.notes = next;
              notesBtn.textContent = next ? 'Edit notes' : 'Add notes';
              toastOk();
            })
            .catch(toastErr);
        }
        ta.addEventListener('blur', saveNotes);
        ta.addEventListener('keydown', function (ev) {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            saveNotes();
            ta.blur();
          }
        });
        notesBtn.addEventListener('click', function () {
          var hidden = editorTr.style.display === 'none';
          editorTr.style.display = hidden ? '' : 'none';
          if (hidden) ta.focus();
        });
      });
      c.appendChild(tbl);
    }).catch(showErr(c));
  }

  // ── Rate cards ────────────────────────────────────────────────
  // Service tabs on the rate cards page. The first tab is "All" (every
  // row); each subsequent tab filters to one service. Rendered count
  // shown in tab label so the operator sees at a glance where they have
  // data. Tab + per-column filter choice persists in localStorage.
  var SERVICES = ['drayage', 'ftl', 'ltl', 'expedited', 'hotshot'];
  function getRatesView() {
    try { return JSON.parse(localStorage.getItem('qf-rates-view') || '{}'); }
    catch (e) { return {}; }
  }
  function setRatesView(v) {
    try { localStorage.setItem('qf-rates-view', JSON.stringify(v)); } catch (e) {}
  }

  function renderRates(c) {
    api('/api/tenant/rate-cards').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Rate cards' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'One row per service × equipment. Edit cells, blur to save.' }));
      c.appendChild(el('div', { class: 'notice', html: 'Tip: ask the AI agent to bulk-update these → <a href="#" data-route="ai">open AI panel</a>' }));
      var hasDrayage = (d.rateCards || []).some(function (r) { return r.service === 'drayage'; });
      if (hasDrayage) {
        c.appendChild(el('div', {
          class: 'notice',
          style: { marginTop: '8px' },
          html: 'For drayage you also need to configure <strong>per-port flat tariffs</strong> (e.g. LAX → 50mi zone = $475). Set those on <a href="#" data-route="zones">Drayage zones →</a>.'
        }));
      }

      // ── Service tabs ─────────────────────────────────────────────
      var view = getRatesView();
      var activeTab = view.tab || 'all';
      var tabsBar = el('div', { class: 'qf-tabs' });
      function tab(id, labelText, count) {
        var b = el('button', { class: 'qf-tab' + (activeTab === id ? ' active' : ''), text: labelText + ' (' + count + ')' });
        b.addEventListener('click', function () {
          view.tab = id; setRatesView(view); renderRates(c);
        });
        return b;
      }
      tabsBar.appendChild(tab('all', 'All', d.rateCards.length));
      SERVICES.forEach(function (s) {
        var n = d.rateCards.filter(function (r) { return r.service === s; }).length;
        tabsBar.appendChild(tab(s, s.charAt(0).toUpperCase() + s.slice(1), n));
      });
      c.appendChild(tabsBar);

      // Filter rows by active service tab.
      var rows = activeTab === 'all'
        ? d.rateCards
        : d.rateCards.filter(function (r) { return r.service === activeTab; });

      var tbl = el('table', { class: 'table', style: { marginTop: '12px' } });
      var thead = el('thead');
      thead.innerHTML =
        '<tr><th data-col="service">Service</th><th data-col="equipment">Equipment</th><th data-col="label">Label</th>' +
        '<th data-col="ratePerMile" style="text-align:right;">$/mi</th><th data-col="minimumCharge" style="text-align:right;">Min</th>' +
        '<th data-col="flatFee" style="text-align:right;">Flat</th><th data-col="fuelSurchargePct" style="text-align:right;">Fuel %</th>' +
        '<th data-col="marginPct" style="text-align:right;">Margin %</th><th data-col="enabled">Enabled</th><th></th></tr>';
      // ── Per-column filter row ─────────────────────────────────────
      // Light-touch: a small input under each header that filters the
      // currently rendered rows. Pure client-side, instant feedback.
      var filterTr = el('tr', { class: 'qf-filter-row' });
      var filterCols = ['service', 'equipment', 'label', 'ratePerMile', 'minimumCharge', 'flatFee', 'fuelSurchargePct', 'marginPct', 'enabled'];
      var filters = view.filters || {};
      filterCols.forEach(function (col) {
        var th = el('th', { style: { padding: '4px 8px' } });
        var inp = el('input', {
          class: 'input',
          placeholder: '⌕',
          value: filters[col] || '',
          style: { padding: '4px 8px', fontSize: '12px', width: '100%' },
        });
        inp.addEventListener('input', function () {
          filters[col] = inp.value;
          view.filters = filters;
          setRatesView(view);
          applyFilters();
        });
        th.appendChild(inp);
        filterTr.appendChild(th);
      });
      filterTr.appendChild(el('th'));
      thead.appendChild(filterTr);
      tbl.appendChild(thead);

      var tb = el('tbody');
      tbl.appendChild(tb);
      rows.forEach(function (r) {
        var tr = rateRow(r);
        // Tag each <tr> with its source data so we can text-match for filtering.
        tr.dataset.row = JSON.stringify({
          service: r.service, equipment: r.equipment, label: r.label || '',
          ratePerMile: r.ratePerMile, minimumCharge: r.minimumCharge,
          flatFee: r.flatFee, fuelSurchargePct: r.fuelSurchargePct,
          marginPct: r.marginPct, enabled: r.enabled ? 'yes' : 'no',
        });
        tb.appendChild(tr);
      });

      function applyFilters() {
        var active = Object.keys(filters).filter(function (k) { return (filters[k] || '').trim() !== ''; });
        $$('tr', tb).forEach(function (tr) {
          var data; try { data = JSON.parse(tr.dataset.row || '{}'); } catch (e) { data = {}; }
          var hide = active.some(function (k) {
            var f = (filters[k] || '').toLowerCase().trim();
            var v = String(data[k] == null ? '' : data[k]).toLowerCase();
            return v.indexOf(f) === -1;
          });
          tr.style.display = hide ? 'none' : '';
        });
      }
      applyFilters();
      c.appendChild(tbl);

      // ── Add row ──────────────────────────────────────────────────
      var addBtn = el('button', { class: 'btn btn-secondary', text: '+ Add rate card', style: { marginTop: '14px' } });
      addBtn.addEventListener('click', function () {
        // If a service tab is active, default the new row to that service.
        var svc = activeTab !== 'all' ? activeTab : 'ftl';
        api('/api/tenant/rate-cards', {
          method: 'POST',
          body: { service: svc, equipment: 'dryvan', label: 'New rate', ratePerMile: 2.5 },
        }).then(function () { renderRates(c); }).catch(toastErr);
      });
      c.appendChild(addBtn);
    }).catch(showErr(c));
  }

  function rateRow(r) {
    var tr = el('tr');
    function inputCell(field, val, opts) {
      var inp = el('input', { class: 'input', value: val == null ? '' : val });
      if (opts && opts.type) inp.type = opts.type;
      if (opts && opts.step) inp.step = opts.step;
      inp.style.width = (opts && opts.w) || '90px';
      if (opts && opts.right) inp.style.textAlign = 'right';
      inp.addEventListener('blur', function () {
        var v = inp.value;
        if (opts && opts.type === 'number') v = v === '' ? null : Number(v);
        api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: (function () { var p = {}; p[field] = v; return p; })() }).catch(toastErr);
      });
      var td = el('td'); td.appendChild(inp); return td;
    }
    function selectCell(field, val, options) {
      var sel = el('select', { class: 'select' });
      sel.style.width = '120px';
      options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (val === o) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { var p = {}; p[field] = sel.value; api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: p }).catch(toastErr); });
      var td = el('td'); td.appendChild(sel); return td;
    }
    tr.appendChild(selectCell('service', r.service, ['drayage', 'ftl', 'ltl', 'expedited', 'hotshot']));
    tr.appendChild(selectCell('equipment', r.equipment, [
      'dryvan', 'reefer', 'flatbed', 'step_deck', 'conestoga',
      'container_20', 'container_40', 'container_40hc', 'container_45',
      'sprinter', 'box_truck', 'tractor_only', 'pallet']));
    tr.appendChild(inputCell('label', r.label, { w: '160px' }));
    tr.appendChild(inputCell('ratePerMile', r.ratePerMile, { type: 'number', step: '0.01', right: true, w: '80px' }));
    tr.appendChild(inputCell('minimumCharge', r.minimumCharge, { type: 'number', step: '1', right: true, w: '80px' }));
    tr.appendChild(inputCell('flatFee', r.flatFee, { type: 'number', step: '1', right: true, w: '80px' }));
    tr.appendChild(inputCell('fuelSurchargePct', r.fuelSurchargePct, { type: 'number', step: '0.5', right: true, w: '70px' }));
    tr.appendChild(inputCell('marginPct', r.marginPct, { type: 'number', step: '0.5', right: true, w: '70px' }));
    var chk = el('input', { type: 'checkbox' });
    chk.checked = r.enabled;
    chk.addEventListener('change', function () { api('/api/tenant/rate-cards/' + r.id, { method: 'PUT', body: { enabled: chk.checked } }).catch(toastErr); });
    tr.appendChild(el('td', null, [chk]));
    var del = el('button', { class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!confirm('Delete rate card "' + (r.label || r.equipment) + '"?')) return;
      api('/api/tenant/rate-cards/' + r.id, { method: 'DELETE' }).then(function () { tr.remove(); }).catch(toastErr);
    });
    tr.appendChild(el('td', null, [del]));
    return tr;
  }

  // ── Add-ons (accessorials) ────────────────────────────────────
  // Stupid-simple editor. All the technical jargon (raw `code`, the internal
  // `kind`/`trigger` enums, SCAC-ish fields) is hidden behind plain-English
  // labels. The data model + quote logic are untouched: we still store the
  // real enum values and auto-derive a `code` from the name on create.
  var ADDON_KINDS = [
    { value: 'flat', label: 'Flat fee ($)', unit: '$' },
    { value: 'per_hour', label: 'Per hour', unit: '$/hr' },
    { value: 'per_day', label: 'Per day', unit: '$/day' },
    { value: 'per_mile', label: 'Per mile', unit: '$/mi' },
    { value: 'pct_of_base', label: '% of base rate', unit: '%' },
  ];
  var ADDON_TRIGGERS = [
    { value: 'optional', label: 'Customer can add it' },
    { value: 'auto', label: 'Always applied' },
    { value: 'auto_if_hazmat', label: 'Auto for hazmat' },
    { value: 'auto_if_weight_over', label: 'Auto over a weight' },
    { value: 'auto_if_residential', label: 'Auto for residential' },
    { value: 'auto_if_temp_controlled', label: 'Auto for temp-controlled' },
  ];
  function addonUnit(kind) {
    for (var i = 0; i < ADDON_KINDS.length; i++) if (ADDON_KINDS[i].value === kind) return ADDON_KINDS[i].unit;
    return '$';
  }
  function slugifyCode(name) {
    return String(name || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'addon';
  }
  function uniqueCode(base, taken) {
    var code = base, n = 2;
    while (taken.indexOf(code) >= 0) { code = base + '_' + n; n++; }
    return code;
  }
  function friendlySelect(options, current, onChange) {
    var sel = el('select', { class: 'select qf-addon-select' });
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      if (current === o.value) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }

  function renderAccessorials(c) {
    api('/api/tenant/accessorials').then(function (d) {
      var list = d.accessorials || [];
      c.innerHTML = '';
      var root = el('div', { class: 'qf-addons', 'data-qf-addons': '1' });
      c.appendChild(root);
      root.appendChild(el('h1', { text: 'Add-ons' }));
      root.appendChild(el('p', { class: 'page-sub', text: 'Extra charges customers can add to a shipment — or that apply automatically. Set a price and choose when each one applies.' }));

      // ── Add-an-add-on: prominent button that reveals a simple form ──
      var addBar = el('div', { class: 'qf-addons-addbar' });
      var addBtn = el('button', { class: 'qf-addons-add-btn', type: 'button', text: '+ Add an add-on' });
      addBar.appendChild(addBtn);
      root.appendChild(addBar);

      var form = el('div', { class: 'qf-addons-form', hidden: 'hidden' });
      var fName = el('input', { class: 'input', type: 'text', placeholder: 'e.g. Liftgate service' });
      var fPrice = el('input', { class: 'input', type: 'number', step: '0.5', min: '0', placeholder: '0' });
      var fKind = friendlySelect(ADDON_KINDS, 'flat', function () { fUnit.textContent = addonUnit(fKind.value); });
      var fTrigger = friendlySelect(ADDON_TRIGGERS, 'optional', function () {});
      var fUnit = el('span', { class: 'qf-addon-unit', text: '$' });
      form.appendChild(fieldWrap('Name', fName));
      var priceWrap = el('div', { class: 'qf-addon-pricewrap' }, [fUnit, fPrice]);
      form.appendChild(fieldWrap('Price', priceWrap));
      form.appendChild(fieldWrap("How it's charged", fKind));
      form.appendChild(fieldWrap('When it applies', fTrigger));
      var formActions = el('div', { class: 'qf-addons-form-actions' });
      var saveBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Add' });
      var cancelBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'Cancel' });
      formActions.appendChild(saveBtn); formActions.appendChild(cancelBtn);
      form.appendChild(formActions);
      root.appendChild(form);

      function closeForm() { form.hidden = true; fName.value = ''; fPrice.value = ''; }
      addBtn.addEventListener('click', function () {
        form.hidden = !form.hidden;
        if (!form.hidden) fName.focus();
      });
      cancelBtn.addEventListener('click', closeForm);
      saveBtn.addEventListener('click', function () {
        var name = fName.value.trim();
        if (!name) { fName.focus(); return; }
        var taken = list.map(function (x) { return x.code; });
        var body = {
          code: uniqueCode(slugifyCode(name), taken),
          label: name,
          kind: fKind.value,
          amount: fPrice.value === '' ? 0 : Number(fPrice.value),
          trigger: fTrigger.value,
        };
        api('/api/tenant/accessorials', { method: 'POST', body: body })
          .then(function () { toastOk('Add-on added'); renderAccessorials(c); })
          .catch(toastErr);
      });

      // ── List of the tenant's add-ons ────────────────────────────
      var listWrap = el('div', { class: 'qf-addons-list' });
      if (!list.length) {
        listWrap.appendChild(el('div', { class: 'qf-addons-empty', text: 'No add-ons yet. Use “+ Add an add-on” to create your first one.' }));
      } else {
        list.forEach(function (a) { listWrap.appendChild(addonCard(a, c)); });
      }
      root.appendChild(listWrap);
    }).catch(showErr(c));
  }

  function fieldWrap(label, control) {
    var f = el('div', { class: 'qf-addon-field' });
    f.appendChild(el('label', { class: 'qf-addon-flabel', text: label }));
    f.appendChild(control);
    return f;
  }

  function addonCard(a, c) {
    var card = el('div', { class: 'qf-addon-card' });
    function save(patch) { return api('/api/tenant/accessorials/' + a.id, { method: 'PUT', body: patch }).catch(toastErr); }

    // Top row: name · price · on/off · delete
    var top = el('div', { class: 'qf-addon-top' });
    var name = el('input', { class: 'input qf-addon-name', type: 'text', value: a.label || '' });
    name.addEventListener('blur', function () { if (name.value.trim() !== (a.label || '')) { a.label = name.value.trim(); save({ label: a.label }); } });

    var unit = el('span', { class: 'qf-addon-unit', text: addonUnit(a.kind) });
    var price = el('input', { class: 'input qf-addon-price', type: 'number', step: '0.5', min: '0', value: a.amount == null ? '' : a.amount });
    price.addEventListener('blur', function () {
      var v = price.value === '' ? 0 : Number(price.value);
      if (v !== a.amount) { a.amount = v; save({ amount: v }); }
    });
    var priceBox = el('div', { class: 'qf-addon-pricebox' }, [unit, price]);

    var toggle = el('label', { class: 'qf-addon-toggle', title: 'Show this add-on in quotes' });
    var chk = el('input', { type: 'checkbox' });
    chk.checked = !!a.enabled;
    var toggleTxt = el('span', { text: chk.checked ? 'On' : 'Off' });
    chk.addEventListener('change', function () { toggleTxt.textContent = chk.checked ? 'On' : 'Off'; save({ enabled: chk.checked }); });
    toggle.appendChild(chk); toggle.appendChild(toggleTxt);

    var del = el('button', { class: 'qf-addon-del', type: 'button', title: 'Delete add-on', 'aria-label': 'Delete add-on', text: '✕' });
    del.addEventListener('click', function () {
      if (!confirm('Delete “' + (a.label || 'this add-on') + '”?')) return;
      api('/api/tenant/accessorials/' + a.id, { method: 'DELETE' })
        .then(function () { card.remove(); toastOk('Add-on removed'); })
        .catch(toastErr);
    });

    top.appendChild(name);
    top.appendChild(priceBox);
    top.appendChild(toggle);
    top.appendChild(del);
    card.appendChild(top);

    // Bottom row: how charged · when applies · (weight threshold)
    var bottom = el('div', { class: 'qf-addon-bottom' });
    var kindSel = friendlySelect(ADDON_KINDS, a.kind, function (v) {
      a.kind = v; unit.textContent = addonUnit(v); save({ kind: v });
    });
    var weightWrap = el('div', { class: 'qf-addon-weight', hidden: 'hidden' });
    var weightInp = el('input', { class: 'input', type: 'number', min: '0', step: '500', placeholder: 'e.g. 42000' });
    var initialWeight = a.conditionJson && typeof a.conditionJson.weightLbsOver === 'number' ? a.conditionJson.weightLbsOver : '';
    weightInp.value = initialWeight;
    weightWrap.appendChild(el('span', { class: 'qf-addon-weight-lbl', text: 'Apply when weight is over' }));
    weightWrap.appendChild(weightInp);
    weightWrap.appendChild(el('span', { class: 'qf-addon-weight-unit', text: 'lbs' }));
    weightInp.addEventListener('blur', function () {
      var v = weightInp.value === '' ? null : Number(weightInp.value);
      var cond = v == null ? null : { weightLbsOver: v };
      a.conditionJson = cond; save({ conditionJson: cond });
    });
    function syncWeight(trig) { weightWrap.hidden = trig !== 'auto_if_weight_over'; }
    var trigSel = friendlySelect(ADDON_TRIGGERS, a.trigger, function (v) {
      a.trigger = v; syncWeight(v); save({ trigger: v });
    });
    syncWeight(a.trigger);

    bottom.appendChild(fieldWrap("How it's charged", kindSel));
    bottom.appendChild(fieldWrap('When it applies', trigSel));
    bottom.appendChild(weightWrap);
    card.appendChild(bottom);

    return card;
  }

  // ── Lane zones ────────────────────────────────────────────────
  function renderZones(c) {
    api('/api/tenant/lane-zones').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Drayage zones' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Flat-tariff pricing within a radius of an anchor port. Smallest matching zone wins.' }));
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>Label</th><th>Anchor</th><th>Radius (mi)</th><th>Flat $</th><th>Enabled</th><th></th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.laneZones.forEach(function (z) { tb.appendChild(zoneRow(z)); });
      c.appendChild(tbl);
      // Inline add-zone form. Replaces 4 stacked window.prompt() dialogs
      // (which violated the title-in-field + top-left help-cue UI rule and
      // had no dark-mode contrast). Hidden until the user clicks + Add zone.
      var addBtn = el('button', { class: 'btn btn-secondary', text: '+ Add zone', style: { marginTop: '14px' } });

      var form = el('div', {
        class: 'add-zone-form',
        style: {
          display: 'none',
          marginTop: '14px',
          padding: '14px',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          background: 'var(--surface-2, var(--surface))',
        },
      });
      var grid = el('div', { class: 'grid-2', style: { gap: '14px' } });

      function newField(labelText, hintText, inputOpts) {
        var f = el('div', { class: 'field', style: { gap: '2px' } });
        var labelRow = el('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' },
        });
        labelRow.appendChild(el('label', { class: 'field-label', text: labelText }));
        if (hintText) {
          labelRow.appendChild(el('span', {
            class: 'field-hint',
            text: hintText,
            style: { fontSize: '11px' },
          }));
        }
        f.appendChild(labelRow);
        var i = el('input', { class: 'input' });
        if (inputOpts && inputOpts.type) i.type = inputOpts.type;
        if (inputOpts && inputOpts.step) i.step = inputOpts.step;
        if (inputOpts && inputOpts.placeholder) i.placeholder = inputOpts.placeholder;
        if (inputOpts && inputOpts.value != null) i.value = inputOpts.value;
        f.appendChild(i);
        return { field: f, input: i };
      }

      var labelF = newField('Zone label', '⌘/Ctrl+Enter to save', { placeholder: 'Houston → 50mi' });
      var portF = newField('Anchor port', 'Optional', { placeholder: 'USHOU' });
      var radiusF = newField('Radius (miles)', null, { type: 'number', step: '1', value: '50' });
      var priceF = newField('Flat price (USD)', null, { type: 'number', step: '1', value: '500' });
      grid.appendChild(labelF.field);
      grid.appendChild(portF.field);
      grid.appendChild(radiusF.field);
      grid.appendChild(priceF.field);
      form.appendChild(grid);

      var actions = el('div', {
        style: { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' },
      });
      var cancelBtn = el('button', { class: 'btn btn-secondary', text: 'Cancel' });
      var saveBtn = el('button', { class: 'btn btn-primary', text: 'Save zone' });
      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      form.appendChild(actions);

      function resetForm() {
        labelF.input.value = '';
        portF.input.value = '';
        radiusF.input.value = '50';
        priceF.input.value = '500';
      }
      function closeForm() {
        form.style.display = 'none';
        addBtn.style.display = '';
      }
      function submitForm() {
        var label = labelF.input.value.trim();
        if (!label) { labelF.input.focus(); return; }
        var port = portF.input.value.trim() || null;
        var radius = Number(radiusF.input.value || 0);
        var price = Number(priceF.input.value || 0);
        api('/api/tenant/lane-zones', {
          method: 'POST',
          body: { label: label, anchorPortCode: port, radiusMiles: radius, flatPrice: price },
        }).then(function () {
          resetForm();
          closeForm();
          renderZones(c);
        }).catch(toastErr);
      }
      saveBtn.addEventListener('click', submitForm);
      cancelBtn.addEventListener('click', function () { resetForm(); closeForm(); });
      [labelF.input, portF.input, radiusF.input, priceF.input].forEach(function (inp) {
        inp.addEventListener('keydown', function (ev) {
          if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
            ev.preventDefault();
            submitForm();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            closeForm();
          }
        });
      });

      addBtn.addEventListener('click', function () {
        form.style.display = '';
        addBtn.style.display = 'none';
        labelF.input.focus();
      });
      c.appendChild(addBtn);
      c.appendChild(form);
    }).catch(showErr(c));
  }
  function zoneRow(z) {
    var tr = el('tr');
    function inp(field, val, opts) {
      var i = el('input', { class: 'input', value: val == null ? '' : val });
      if (opts && opts.type) i.type = opts.type; if (opts && opts.right) i.style.textAlign = 'right';
      i.style.width = (opts && opts.w) || '120px';
      i.addEventListener('blur', function () { var v = i.value; if (opts && opts.type === 'number') v = Number(v); var p = {}; p[field] = v; api('/api/tenant/lane-zones/' + z.id, { method: 'PUT', body: p }).catch(toastErr); });
      var td = el('td'); td.appendChild(i); return td;
    }
    tr.appendChild(inp('label', z.label, { w: '300px' }));
    tr.appendChild(inp('anchorPortCode', z.anchorPortCode, { w: '90px' }));
    tr.appendChild(inp('radiusMiles', z.radiusMiles, { type: 'number', right: true, w: '80px' }));
    tr.appendChild(inp('flatPrice', z.flatPrice, { type: 'number', right: true, w: '90px' }));
    var chk = el('input', { type: 'checkbox' }); chk.checked = z.enabled;
    chk.addEventListener('change', function () { api('/api/tenant/lane-zones/' + z.id, { method: 'PUT', body: { enabled: chk.checked } }).catch(toastErr); });
    tr.appendChild(el('td', null, [chk]));
    var del = el('button', { class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', function () { if (!confirm('Delete zone?')) return; api('/api/tenant/lane-zones/' + z.id, { method: 'DELETE' }).then(function () { tr.remove(); }).catch(toastErr); });
    tr.appendChild(el('td', null, [del]));
    return tr;
  }

  // ── AI agent panel ────────────────────────────────────────────
  function renderAi(c) {
    Promise.all([
      api('/api/tenant/ai-config'),
      api('/api/ai/rate-chat'),
    ]).then(function (out) {
      var cfg = out[0].aiConfig; var hist = out[1].messages;
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'AI agent' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Tune your rates by chatting in plain English. Try: "raise reefer minimums to $600 and add a $50 hazmat surcharge".' }));

      var grid = el('div', { class: 'grid-2', style: { alignItems: 'start' } });

      // Chat panel
      var leftCol = el('div');
      var chat = el('div', { class: 'chat-panel' });
      var msgList = el('div', { class: 'chat-messages', id: 'rate-chat-msgs' });
      hist.forEach(function (m) {
        msgList.appendChild(el('div', { class: 'chat-bubble ' + (m.role === 'assistant' ? 'assistant' : 'user'), text: m.content }));
      });
      if (!hist.length) {
        msgList.appendChild(el('div', { class: 'chat-bubble assistant', text: 'Hi — I can update your rate cards, accessorials, and lane zones. Tell me what to change.' }));
      }
      chat.appendChild(msgList);
      var input = el('textarea', { class: 'textarea', rows: '2', placeholder: 'e.g. "raise dryvan rate to $2.65/mi and disable LTL"' });
      var sendBtn = el('button', { class: 'btn btn-primary', text: 'Send' });
      sendBtn.addEventListener('click', sendChat);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendChat(); });
      chat.appendChild(el('div', { class: 'chat-input-row' }, [input, sendBtn]));
      leftCol.appendChild(chat);

      function sendChat() {
        var msg = input.value.trim(); if (!msg) return;
        input.value = ''; sendBtn.disabled = true;
        msgList.appendChild(el('div', { class: 'chat-bubble user', text: msg }));
        msgList.scrollTop = msgList.scrollHeight;
        var pending = el('div', { class: 'chat-bubble assistant', text: '…' });
        msgList.appendChild(pending);
        api('/api/ai/rate-chat', { method: 'POST', body: { message: msg } })
          .then(function (r) {
            sendBtn.disabled = false;
            pending.textContent = r.reply || '(no reply)';
            if (r.toolResults && r.toolResults.length) {
              r.toolResults.forEach(function (t) {
                var tag = el('div', { class: 'chat-bubble tool' }, [
                  el('span', { class: 'qf-tool-ico', html: WRENCH_SVG, 'aria-hidden': 'true' }),
                  ' ' + t.tool + ': ' + t.result.message
                ]);
                msgList.appendChild(tag);
              });
            }
            msgList.scrollTop = msgList.scrollHeight;
          })
          .catch(function (err) { sendBtn.disabled = false; pending.textContent = 'Error: ' + err.message; });
      }

      // Right column: AI config form
      var rightCol = el('div');
      var cfgCard = el('div', { class: 'card' });
      cfgCard.appendChild(el('div', { class: 'card-title', text: 'AI behaviour' }));
      cfgCard.appendChild(el('div', { class: 'card-subtitle', text: 'Edits apply immediately.' }));

      function renderField(label, child) {
        return el('div', { class: 'field', style: { marginBottom: '12px' } }, [el('label', { class: 'field-label', text: label }), child]);
      }
      var promptTa = el('textarea', { class: 'textarea', rows: '8', placeholder: 'System prompt' });
      promptTa.value = (cfg && cfg.systemPrompt) || '';
      promptTa.addEventListener('blur', function () { api('/api/tenant/ai-config', { method: 'PUT', body: { systemPrompt: promptTa.value } }).catch(toastErr); });
      cfgCard.appendChild(renderField('System prompt (your AI persona)', promptTa));

      var toneSel = el('select', { class: 'select' });
      ['professional', 'friendly', 'concise', 'enthusiastic'].forEach(function (t) { var o = document.createElement('option'); o.value = t; o.textContent = t; if ((cfg && cfg.tone) === t) o.selected = true; toneSel.appendChild(o); });
      toneSel.addEventListener('change', function () { api('/api/tenant/ai-config', { method: 'PUT', body: { tone: toneSel.value } }).catch(toastErr); });
      cfgCard.appendChild(renderField('Tone', toneSel));

      function toggle(key, label, def) {
        var wrap = el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' } });
        var c2 = el('input', { type: 'checkbox' }); c2.checked = (cfg && cfg[key] != null) ? !!cfg[key] : def;
        c2.addEventListener('change', function () { var p = {}; p[key] = c2.checked; api('/api/tenant/ai-config', { method: 'PUT', body: p }).catch(toastErr); });
        wrap.appendChild(c2); wrap.appendChild(el('span', { text: label })); return wrap;
      }
      cfgCard.appendChild(toggle('autoReplyEnabled', 'Auto-reply email to leads', true));
      cfgCard.appendChild(toggle('chatEnabled', 'Customer-service chat after quote', true));

      // BYO key
      var keyCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      keyCard.appendChild(el('div', { class: 'card-title', text: 'Bring your own Anthropic key (optional)' }));
      keyCard.appendChild(el('div', { class: 'card-subtitle', text: 'When set, your AI calls run on your account — separate billing, your usage limits.' }));
      var keyInp = el('input', { class: 'input', placeholder: 'sk-ant-…', type: 'password' });
      var keyBtn = el('button', { class: 'btn btn-secondary', text: 'Save key', style: { marginTop: '8px' } });
      keyBtn.addEventListener('click', function () {
        if (!keyInp.value) return;
        api('/api/tenant/anthropic-key', { method: 'PUT', body: { apiKey: keyInp.value } })
          .then(function () { keyInp.value = ''; alert('Key saved.'); }).catch(toastErr);
      });
      keyCard.appendChild(keyInp); keyCard.appendChild(keyBtn);
      var clearBtn = el('button', { class: 'btn btn-ghost', text: 'Clear stored key', style: { marginTop: '8px' } });
      clearBtn.addEventListener('click', function () { if (!confirm('Remove your Anthropic key?')) return; api('/api/tenant/anthropic-key', { method: 'DELETE' }).then(function () { alert('Cleared.'); }).catch(toastErr); });
      keyCard.appendChild(clearBtn);

      rightCol.appendChild(cfgCard);
      rightCol.appendChild(keyCard);
      grid.appendChild(leftCol); grid.appendChild(rightCol);
      c.appendChild(grid);
    }).catch(showErr(c));
  }

  // ── Customize (rebuilt Brand surface — Wave 2) ─────────────────
  // A single-purpose "Customize your calculator" page: theme presets, accent,
  // font, logo upload, name/tagline — beside a LIVE preview of the tenant's
  // real widget (/w/<slug>). Every change is debounce-saved via the brand PUT
  // then the preview iframe reloads to reflect it. The legacy readiness /
  // setup-question / preview-mock / scanner injectors are suppressed on this
  // route (see de-clutter guards in dashboard-setup.js, share-readiness.js,
  // dashboard-preview.js, brand-editor.js, brand-studio-preview.js and the
  // scoped rules in customize-panel.css).
  function renderBrand(c) {
    var slug = (state.me && state.me.tenant && state.me.tenant.slug) || '';
    // Fetch a signed owner-preview URL alongside the brand config so the live
    // preview renders the REAL calculator even when the tenant is private.
    Promise.all([api('/api/tenant/brand'), api('/api/tenant/preview-url')]).then(function (results) {
      var d = results[0];
      var previewUrl = (results[1] && results[1].previewUrl) || ('/w/' + encodeURIComponent(slug));
      var b = d.brand || {};
      var presets = d.presets || [];
      var fonts = d.fonts || [];
      c.innerHTML = '';

      var root = el('div', { class: 'qf-customize', 'data-qf-customize': '1' });
      c.appendChild(root);
      root.appendChild(el('h1', { text: 'Customize your calculator' }));
      root.appendChild(el('p', { class: 'page-sub', text: 'Pick a look, add your logo, and watch your live calculator update on the right.' }));

      var layout = el('div', { class: 'qf-cz-layout' });
      var controls = el('div', { class: 'qf-cz-controls' });
      var previewCol = el('div', { class: 'qf-cz-preview-col' });
      layout.appendChild(controls);
      layout.appendChild(previewCol);
      root.appendChild(layout);

      // ── save queue (debounced) + preview reload ─────────────────
      function kv(k, v) { var o = {}; o[k] = v; return o; }
      function previewSrc() { return previewUrl; }
      var iframe = null;
      var pending = {}, saveTimer = null, previewTimer = null;
      function reloadPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
          if (!iframe) return;
          var base = previewSrc();
          iframe.src = base + (base.indexOf('?') > -1 ? '&' : '?') + '_t=' + Date.now();
        }, 250);
      }
      function flush() {
        if (!Object.keys(pending).length) return;
        var body = pending; pending = {};
        api('/api/tenant/brand', { method: 'PUT', body: body })
          .then(function () { reloadPreview(); })
          .catch(function (e) {
            if (e && e.status === 403) toast('A custom logo is a Core/Vital feature — upgrade to add your own logo.', 'warn');
            else toastErr(e);
          });
      }
      function queueSave(patch, immediate) {
        Object.assign(pending, patch);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, immediate ? 0 : 450);
      }

      // ── live preview column ─────────────────────────────────────
      var pcard = el('div', { class: 'card qf-cz-preview' });
      pcard.appendChild(el('div', { class: 'qf-cz-preview-head' }, [
        el('span', { class: 'qf-cz-preview-title', text: 'Live preview' }),
        el('a', { href: previewSrc(), target: '_blank', rel: 'noopener', class: 'qf-cz-preview-open', text: 'Open ↗' }),
      ]));
      var frameWrap = el('div', { class: 'qf-cz-frame-wrap' });
      iframe = el('iframe', { class: 'qf-cz-frame', src: previewSrc(), title: 'Your live calculator', loading: 'lazy' });
      frameWrap.appendChild(iframe);
      pcard.appendChild(frameWrap);
      pcard.appendChild(el('div', { class: 'qf-cz-preview-note', text: 'This is exactly what your customers see. It updates as you make changes.' }));
      previewCol.appendChild(pcard);

      // ── Your company (name + tagline) ───────────────────────────
      function textField(label, key, val, hint) {
        var f = el('div', { class: 'qf-cz-field' });
        f.appendChild(el('label', { class: 'qf-cz-label', text: label }));
        var inp = el('input', { class: 'input', type: 'text' });
        inp.value = val || '';
        inp.addEventListener('input', function () { queueSave(kv(key, inp.value)); });
        inp.addEventListener('blur', function () { queueSave(kv(key, inp.value), true); });
        f.appendChild(inp);
        if (hint) f.appendChild(el('div', { class: 'qf-cz-hint', text: hint }));
        return f;
      }
      var company = el('div', { class: 'card qf-cz-section' });
      company.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Your company' }));
      company.appendChild(textField('Company name', 'displayName', b.displayName, 'Shown above your calculator.'));
      company.appendChild(textField('Tagline', 'tagline', b.tagline, 'One short line under your name.'));
      controls.appendChild(company);

      // ── Theme presets ───────────────────────────────────────────
      var themeSec = el('div', { class: 'card qf-cz-section' });
      themeSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Theme' }));
      themeSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'A curated look — sets the background, surfaces, and default accent.' }));
      var grid = el('div', { class: 'qf-cz-preset-grid' });
      var currentPreset = b.themePreset || 'midnight';
      presets.forEach(function (p) {
        var on = p.id === currentPreset;
        var btn = el('button', { type: 'button', class: 'qf-cz-preset' + (on ? ' is-selected' : ''), 'data-preset': p.id, 'aria-pressed': on ? 'true' : 'false', title: p.description || p.label });
        var sw = el('div', { class: 'qf-cz-preset-swatch', style: { background: p.bg } });
        sw.appendChild(el('div', { class: 'qf-cz-preset-surface', style: { background: p.surface } }));
        sw.appendChild(el('div', { class: 'qf-cz-preset-accent', style: { background: p.accent } }));
        btn.appendChild(sw);
        btn.appendChild(el('div', { class: 'qf-cz-preset-name', text: p.label }));
        btn.addEventListener('click', function () {
          currentPreset = p.id;
          $$('.qf-cz-preset', grid).forEach(function (n) {
            var sel = n.getAttribute('data-preset') === p.id;
            n.classList.toggle('is-selected', sel);
            n.setAttribute('aria-pressed', sel ? 'true' : 'false');
          });
          queueSave({ themePreset: p.id }, true);
        });
        grid.appendChild(btn);
      });
      themeSec.appendChild(grid);
      controls.appendChild(themeSec);

      // ── Accent color ────────────────────────────────────────────
      var accentSec = el('div', { class: 'card qf-cz-section' });
      accentSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Accent color' }));
      accentSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Your buttons and highlights. Keep "Theme default" to match the preset.' }));
      var accentRow = el('div', { class: 'qf-cz-accent-row' });
      // Curated accent options — brand cobalt/periwinkle first. No teal.
      var ACCENTS = ['#0D3CFC', '#6E8BFF', '#2563EB', '#059669', '#D14343', '#F59E0B', '#7C3AED'];
      var currentAccent = b.accentOverride || null; // null = theme default
      var colorInput = null;
      function paintAccent() {
        $$('.qf-cz-swatch', accentRow).forEach(function (n) {
          var v = n.getAttribute('data-accent');
          var sel = (v === '__default__' && !currentAccent) ||
            (!!v && v !== '__default__' && !!currentAccent && v.toLowerCase() === currentAccent.toLowerCase());
          n.classList.toggle('is-selected', sel);
        });
        if (colorInput && currentAccent) colorInput.value = currentAccent;
      }
      var defChip = el('button', { type: 'button', class: 'qf-cz-swatch qf-cz-swatch-default', 'data-accent': '__default__', title: 'Use the theme accent' });
      defChip.appendChild(el('span', { text: 'Theme default' }));
      defChip.addEventListener('click', function () { currentAccent = null; paintAccent(); queueSave({ accentOverride: null }, true); });
      accentRow.appendChild(defChip);
      ACCENTS.forEach(function (hex) {
        var sw = el('button', { type: 'button', class: 'qf-cz-swatch', 'data-accent': hex, title: hex, style: { background: hex } });
        sw.addEventListener('click', function () { currentAccent = hex; paintAccent(); queueSave({ accentOverride: hex }, true); });
        accentRow.appendChild(sw);
      });
      var customWrap = el('label', { class: 'qf-cz-swatch qf-cz-swatch-custom', title: 'Pick a custom color' });
      colorInput = el('input', { type: 'color', value: currentAccent || '#0D3CFC' });
      colorInput.addEventListener('input', function () { currentAccent = colorInput.value; paintAccent(); queueSave({ accentOverride: colorInput.value }); });
      customWrap.appendChild(colorInput);
      customWrap.appendChild(el('span', { text: 'Custom' }));
      accentRow.appendChild(customWrap);
      accentSec.appendChild(accentRow);
      controls.appendChild(accentSec);
      paintAccent();

      // ── Font ────────────────────────────────────────────────────
      var fontSec = el('div', { class: 'card qf-cz-section' });
      fontSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Font' }));
      var sel = el('select', { class: 'input qf-cz-select' });
      var curFont = b.fontFamily || 'satoshi';
      fonts.forEach(function (f) {
        var opt = el('option', { value: f.id, text: f.label + (f.id === 'satoshi' ? ' (default)' : '') });
        if (f.id === curFont) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { queueSave({ fontFamily: sel.value }, true); });
      fontSec.appendChild(sel);
      controls.appendChild(fontSec);

      // ── Logo (drag-drop + client downscale to a small data-URL) ──
      var logoSec = el('div', { class: 'card qf-cz-section' });
      logoSec.appendChild(el('div', { class: 'qf-cz-section-title', text: 'Logo' }));
      logoSec.appendChild(el('div', { class: 'qf-cz-hint', text: 'Drop an image or choose a file. We shrink it automatically so your page loads fast.' }));

      var logoPreview = el('div', { class: 'qf-cz-logo-current' });
      function paintLogo(url) {
        logoPreview.innerHTML = '';
        if (url) {
          logoPreview.appendChild(el('img', { class: 'qf-cz-logo-img', src: url, alt: 'Current logo' }));
          var rm = el('button', { type: 'button', class: 'btn btn-secondary qf-cz-logo-remove', text: 'Remove logo' });
          rm.addEventListener('click', function () { queueSave({ logoUrl: null }, true); paintLogo(''); });
          logoPreview.appendChild(rm);
        } else {
          logoPreview.appendChild(el('span', { class: 'qf-cz-hint', text: 'No logo yet.' }));
        }
      }

      function processLogo(file) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onerror = reject;
          reader.onload = function () {
            var src = String(reader.result || '');
            // SVG is already tiny + vector — keep as-is (canvas would rasterize).
            if (file.type === 'image/svg+xml') { resolve(src); return; }
            var img = new Image();
            img.onload = function () {
              var max = 256;
              var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
              var w = Math.max(1, Math.round((img.width || max) * scale));
              var h = Math.max(1, Math.round((img.height || max) * scale));
              var canvas = document.createElement('canvas');
              canvas.width = w; canvas.height = h;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, w, h);
              var out = '';
              try { out = canvas.toDataURL('image/webp', 0.85); } catch (_e) { out = ''; }
              if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
              resolve(out);
            };
            img.onerror = reject;
            img.src = src;
          };
          reader.readAsDataURL(file);
        });
      }

      function handleFile(file) {
        if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file.', 'warn'); return; }
        processLogo(file).then(function (dataUrl) {
          if (dataUrl.length > 150 * 1024) { toast('That image is too large even after shrinking. Try a simpler logo.', 'warn'); return; }
          queueSave({ logoUrl: dataUrl }, true);
          paintLogo(dataUrl);
        }).catch(function () { toast('Could not read that image.', 'error'); });
      }

      var drop = el('div', { class: 'qf-cz-dropzone', tabindex: '0' });
      drop.appendChild(el('div', { class: 'qf-cz-dropzone-title', text: 'Drag & drop your logo here' }));
      drop.appendChild(el('div', { class: 'qf-cz-hint', text: 'PNG, JPG, SVG or WebP' }));
      var fileInput = el('input', { type: 'file', accept: 'image/*', class: 'qf-cz-file' });
      var pickBtn = el('button', { type: 'button', class: 'btn btn-secondary qf-cz-pick', text: 'Choose file' });
      pickBtn.addEventListener('click', function () { fileInput.click(); });
      drop.appendChild(pickBtn);
      drop.appendChild(fileInput);
      fileInput.addEventListener('change', function () { if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]); });
      ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-drag'); }); });
      ['dragleave', 'dragend'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-drag'); }); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('is-drag');
        var dt = e.dataTransfer;
        if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
      });
      logoSec.appendChild(drop);
      logoSec.appendChild(logoPreview);
      controls.appendChild(logoSec);
      paintLogo(b.logoUrl || '');
    }).catch(showErr(c));
  }

  // ── Embed ─────────────────────────────────────────────────────
  function renderEmbed(c) {
    Promise.all([
      api('/api/tenant/embed'),
      api('/api/tenant/brand'),
      api('/api/tenant/access'),
      api('/api/tenant/preview-url'),
    ]).then(function (results) {
      var d = results[0];
      var b = (results[1] && results[1].brand) || {};
      var access = results[2] || { accessMode: 'public', links: [] };
      var previewUrl = (results[3] && results[3].previewUrl) || (d.directLink || '/');
      c.innerHTML = '';
      // De-clutter marker — the scoped :has() net in embed-panel.css hides the
      // legacy injected clutter (launch workspace, setup coach, share-readiness,
      // preview-publish mock) on this page only; the JS injectors are also
      // guarded to skip /app/embed. Same pattern as Customize + Add-ons.
      var root = el('div', { class: 'qf-embed', 'data-qf-embed': '1' });
      c.appendChild(root);
      c = root;
      c.appendChild(el('h1', { text: 'Embed code' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Drop one line of HTML on any page of your website.' }));

      // Preview card — show the live widget so brand changes are visible
      // without opening a new tab. Sandbox attribute on the iframe limits
      // what the embedded page can do (no top-nav, no popups).
      var preview = el('div', { class: 'card' });
      preview.appendChild(el('div', { class: 'card-title', text: 'Live preview' }));
      preview.appendChild(el('div', { class: 'card-subtitle', text: 'This is exactly what your customers see at ' + (d.directLink || '') }));
      // Point at the signed owner-preview URL (same as Customize) so the real
      // calculator renders here even for a PRIVATE tenant — and so the frame is
      // never blank (the bare directLink root serves the landing page, not the
      // widget, on hosts without a subdomain).
      var iframe = el('iframe', {
        src: previewUrl + (previewUrl.indexOf('?') > -1 ? '&' : '?') + 'embed=1&preview=1',
        style: {
          width: '100%',
          height: '680px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          marginTop: '8px',
          background: '#fff',
        },
        loading: 'lazy',
        title: 'QuoteFleet widget preview',
      });
      preview.appendChild(iframe);
      var openBtn0 = el('a', {
        href: d.directLink || '#',
        target: '_blank',
        rel: 'noopener',
        class: 'btn btn-secondary',
        text: 'Open in new tab ↗',
        style: { marginTop: '10px', display: 'inline-flex' },
      });
      preview.appendChild(openBtn0);
      c.appendChild(preview);

      // ── Widget settings ─────────────────────────────────────────
      // These map 1:1 onto brand_configs columns and save via
      // PUT /api/tenant/brand (the same endpoint the Customize page uses).
      // Appearance (theme/accent/font/logo/company) lives on Customize and
      // is intentionally NOT duplicated here — this page owns behaviour + copy.
      function saveBrand(patch) {
        return api('/api/tenant/brand', { method: 'PUT', body: patch });
      }
      // A labelled text/textarea input that saves on blur (only when changed).
      function settingField(label, key, opts) {
        opts = opts || {};
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: label }));
        var inp = opts.textarea
          ? el('textarea', { class: 'textarea', rows: '2' })
          : el('input', { class: 'input', type: 'text' });
        if (opts.placeholder) inp.setAttribute('placeholder', opts.placeholder);
        inp.value = (b[key] != null ? b[key] : '');
        inp.addEventListener('blur', function () {
          var next = inp.value;
          if (next === (b[key] != null ? b[key] : '')) return; // no change
          var p = {}; p[key] = next;
          saveBrand(p).then(function () { b[key] = next; toastOk('Saved'); }).catch(toastErr);
        });
        f.appendChild(inp);
        if (opts.hint) f.appendChild(el('span', { class: 'field-hint', text: opts.hint }));
        return f;
      }
      // A toggle row (label + description + checkbox) that saves on change.
      function settingToggle(label, key, defaultVal, hint, gate) {
        var wrap = el('label', {
          style: {
            display: 'flex', gap: '12px', alignItems: 'flex-start',
            padding: '12px 0', borderTop: '1px solid var(--border)',
            cursor: gate && !gate.allowed ? 'not-allowed' : 'pointer',
          },
        });
        var cb = el('input', { type: 'checkbox', style: { marginTop: '3px', flex: '0 0 auto' } });
        cb.checked = (b[key] !== undefined && b[key] !== null) ? !!b[key] : defaultVal;
        cb.addEventListener('change', function () {
          var next = cb.checked;
          var p = {}; p[key] = next;
          saveBrand(p).then(function () { b[key] = next; toastOk('Saved'); }).catch(function (e) {
            cb.checked = !next; // revert on failure
            if (e && e.status === 403 && gate) toast(gate.upgradeMsg, 'warn');
            else toastErr(e);
          });
        });
        var txt = el('div', { style: { flex: '1 1 auto' } }, [
          el('div', { text: label, style: { fontWeight: '600' } }),
          hint ? el('div', { class: 'field-hint', text: hint, style: { marginTop: '2px' } }) : null,
        ]);
        wrap.appendChild(cb);
        wrap.appendChild(txt);
        return wrap;
      }

      // Plan gate for the "Powered by" badge (removing it is a Vital+ perk;
      // trialing tenants resolve to Pro and pass). Mirrors the backend gate.
      var meTenant = (state.me && state.me.tenant) || {};
      var meTrial = (state.me && state.me.trial) || null;
      var meRole = (state.me && state.me.user && state.me.user.role) || '';
      var hasCore =
        meRole === 'super_admin' ||
        (meTrial && meTrial.status === 'trial') ||
        meTenant.plan === 'vital' ||
        meTenant.plan === 'pro';

      // Card 1 — Lead capture & copy.
      var lc = el('div', { class: 'card', style: { marginTop: '14px' } });
      lc.appendChild(el('div', { class: 'card-title', text: 'Widget settings — lead capture & copy' }));
      lc.appendChild(el('div', { class: 'card-subtitle', text: 'Control what contact details a customer must provide and the copy shown on your widget.' }));
      lc.appendChild(settingToggle(
        'Require email',
        'requireEmail',
        true,
        'When on, a lead cannot be submitted without an email address.'
      ));
      lc.appendChild(settingToggle(
        'Require phone',
        'requirePhone',
        false,
        'When on, a lead cannot be submitted without a phone number. Useful if you prefer to call back.'
      ));
      lc.appendChild(settingToggle(
        'Show price before asking for contact info',
        'showQuoteBeforeContact',
        false,
        'When on, the customer sees the quoted price first; contact details are asked only when they click “Claim this quote”.'
      ));
      // Powered-by toggle (plan-gated: removing the badge needs Vital+).
      lc.appendChild(settingToggle(
        'Show “Powered by QuoteFleet” footer',
        'showPoweredBy',
        true,
        hasCore
          ? 'Turn off to remove QuoteFleet branding from the bottom of your widget.'
          : 'Removing the QuoteFleet badge is a Vital plan feature — upgrade to hide it.',
        { allowed: hasCore, upgradeMsg: 'Removing the “Powered by” badge is a Vital feature — upgrade to hide it.' }
      ));
      // Copy fields sit below the toggles, separated by a hairline.
      var copyWrap = el('div', { style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' } });
      copyWrap.appendChild(settingField('CTA button text', 'ctaText', {
        placeholder: 'Get instant quote',
        hint: 'The label on your widget’s main call-to-action button.',
      }));
      copyWrap.appendChild(settingField('Footer note', 'footerNote', {
        textarea: true,
        placeholder: 'e.g. Quotes are estimates — final pricing confirmed by our team.',
        hint: 'Optional line shown under the widget (e.g. a disclaimer or hours).',
      }));
      lc.appendChild(copyWrap);
      c.appendChild(lc);

      // Card 2 — Embedding (allowed domains). Sits just above the snippet
      // because it governs where that snippet is allowed to run.
      var emb = el('div', { class: 'card', style: { marginTop: '14px' } });
      emb.appendChild(el('div', { class: 'card-title', text: 'Widget settings — embedding' }));
      emb.appendChild(el('div', { class: 'card-subtitle', text: 'Restrict which websites are allowed to load your widget. Leave blank to allow any site.' }));
      emb.appendChild(settingField('Allowed domains', 'allowedDomains', {
        placeholder: 'acmeco.com, acmeco.ca',
        hint: 'Comma-separated list of domains permitted to embed the widget. Blank = no restriction.',
      }));
      c.appendChild(emb);

      // Card 2b — Access (public vs private invite-only calculator).
      var accCard = el('div', { class: 'card', style: { marginTop: '14px' } });
      c.appendChild(accCard);
      renderAccessCard(accCard, access);

      var card = el('div', { class: 'card', style: { marginTop: '14px' } });
      card.appendChild(el('div', { class: 'card-title', text: 'Recommended — JS embed (auto-resize)' }));
      var pre = el('div', { class: 'code', text: d.snippet });
      card.appendChild(pre);
      var copy = el('button', { class: 'btn btn-primary', text: 'Copy snippet', style: { marginTop: '8px' } });
      copy.addEventListener('click', function () {
        navigator.clipboard.writeText(d.snippet).then(function () {
          copy.textContent = 'Copied ✓';
          toastOk('Copied to clipboard');
          setTimeout(function () { copy.textContent = 'Copy snippet'; }, 1500);
        });
      });
      card.appendChild(copy);
      c.appendChild(card);

      var card2 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card2.appendChild(el('div', { class: 'card-title', text: 'Iframe-only (fallback)' }));
      card2.appendChild(el('div', { class: 'code', text: d.iframeFallback }));
      c.appendChild(card2);

      var card3 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card3.appendChild(el('div', { class: 'card-title', text: 'Direct hosted link' }));
      card3.innerHTML += '<p>Send your customers directly to:</p>';
      card3.appendChild(el('div', { class: 'code', text: d.directLink }));
      var openBtn = el('a', { href: d.directLink, target: '_blank', class: 'btn btn-secondary', text: 'Open public widget ↗', style: { marginTop: '8px', display: 'inline-flex' } });
      card3.appendChild(openBtn);
      c.appendChild(card3);

      var card4 = el('div', { class: 'card', style: { marginTop: '14px' } });
      card4.appendChild(el('div', { class: 'card-title', text: 'Regenerate embed token' }));
      card4.appendChild(el('div', { class: 'card-subtitle', text: 'Existing embeds will stop working. Use only if your token leaked.' }));
      var rg = el('button', { class: 'btn btn-danger', text: 'Regenerate token' });
      rg.addEventListener('click', function () {
        if (!confirm('Regenerate embed token? Existing embeds will break.')) return;
        api('/api/tenant/regenerate-embed', { method: 'POST' }).then(function () { go('embed'); }).catch(toastErr);
      });
      card4.appendChild(rg);
      c.appendChild(card4);
    }).catch(showErr(c));
  }

  // ── Access control card (public vs private invite-only) ────────
  function renderAccessCard(card, access) {
    card.innerHTML = '';
    card.appendChild(el('div', { class: 'card-title', text: 'Widget settings — access' }));
    card.appendChild(el('div', { class: 'card-subtitle', text: 'Choose who can open your rate calculator.' }));

    var mode = access.accessMode === 'private' ? 'private' : 'public';

    function optionRow(value, title, desc) {
      var wrap = el('label', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' } });
      var r = el('input', { type: 'radio', name: 'qf-access-mode', style: { marginTop: '3px', flex: '0 0 auto' } });
      r.value = value; r.checked = (mode === value);
      r.addEventListener('change', function () {
        if (!r.checked) return;
        api('/api/tenant/access', { method: 'PUT', body: { accessMode: value } }).then(function () {
          access.accessMode = value; toastOk('Saved'); renderAccessCard(card, access);
        }).catch(function (e) { r.checked = (mode === value); toastErr(e); });
      });
      var txt = el('div', { style: { flex: '1 1 auto' } }, [
        el('div', { text: title, style: { fontWeight: '600' } }),
        el('div', { class: 'field-hint', text: desc, style: { marginTop: '2px' } }),
      ]);
      wrap.appendChild(r); wrap.appendChild(txt);
      return wrap;
    }
    card.appendChild(optionRow('public', 'Public', 'Anyone with your link can open the calculator and get a quote.'));
    card.appendChild(optionRow('private', 'Private — invite only', 'Only people you invite (via a unique link) can open the calculator. Everyone else sees a locked page.'));

    if (mode !== 'private') return;

    var sec = el('div', { style: { marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--border)' } });
    sec.appendChild(el('div', { text: 'Invite links', style: { fontWeight: '600', marginBottom: '4px' } }));
    sec.appendChild(el('div', { class: 'field-hint', text: 'Create one link per customer. Share it privately. Revoke any time — it stops working immediately.' }));

    var list = el('div', { style: { marginTop: '12px' } });
    sec.appendChild(list);

    function fmtDate(s) { if (!s) return 'never'; try { return new Date(s).toLocaleDateString(); } catch (e) { return 'never'; } }

    function renderList() {
      list.innerHTML = '';
      var links = access.links || [];
      if (!links.length) {
        list.appendChild(el('div', { class: 'field-hint', text: 'No invite links yet. Create one below.' }));
      }
      links.forEach(function (l) {
        var row = el('div', { style: { border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', marginBottom: '8px', opacity: l.active ? '1' : '0.55' } });
        var head = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } });
        head.appendChild(el('div', { text: l.label + (l.active ? '' : ' (revoked)'), style: { fontWeight: '600' } }));
        head.appendChild(el('div', { class: 'field-hint', text: 'Opened ' + (l.useCount || 0) + '× · last ' + fmtDate(l.lastUsedAt) }));
        row.appendChild(head);
        var urlRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', flexWrap: 'wrap' } });
        var urlBox = el('input', { class: 'input', type: 'text', style: { flex: '1 1 220px', fontSize: '12px' } });
        urlBox.value = l.url; urlBox.readOnly = true;
        urlRow.appendChild(urlBox);
        if (l.active) {
          var copyBtn = el('button', { class: 'btn btn-secondary', text: 'Copy' });
          copyBtn.addEventListener('click', function () { navigator.clipboard.writeText(l.url).then(function () { copyBtn.textContent = 'Copied ✓'; toastOk('Copied'); setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500); }); });
          urlRow.appendChild(copyBtn);
          var revBtn = el('button', { class: 'btn btn-danger', text: 'Revoke' });
          revBtn.addEventListener('click', function () {
            if (!confirm('Revoke "' + l.label + '"? This link will stop working immediately.')) return;
            api('/api/tenant/access/links/' + l.id + '/revoke', { method: 'POST' }).then(function () {
              l.active = false; toastOk('Revoked'); renderList();
            }).catch(toastErr);
          });
          urlRow.appendChild(revBtn);
        }
        row.appendChild(urlRow);
        list.appendChild(row);
      });
    }
    renderList();

    var createRow = el('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } });
    var nameInp = el('input', { class: 'input', type: 'text', placeholder: 'Customer or company name', style: { flex: '1 1 220px' } });
    var createBtn = el('button', { class: 'btn btn-primary', text: '+ Create invite link' });
    createBtn.addEventListener('click', function () {
      var label = (nameInp.value || '').trim();
      if (!label) { toast('Enter a name for the link', 'warn'); nameInp.focus(); return; }
      createBtn.disabled = true;
      api('/api/tenant/access/links', { method: 'POST', body: { label: label } }).then(function (r) {
        access.links = access.links || [];
        access.links.unshift(r.link);
        nameInp.value = ''; createBtn.disabled = false; toastOk('Invite link created'); renderList();
      }).catch(function (e) { createBtn.disabled = false; toastErr(e); });
    });
    createRow.appendChild(nameInp); createRow.appendChild(createBtn);
    sec.appendChild(createRow);
    card.appendChild(sec);
  }

  // ── Audit log ─────────────────────────────────────────────────
  function renderAudit(c) {
    api('/api/tenant/audit').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Audit log' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Every change made by you, your team, or the AI agent.' }));
      if (!d.audit.length) {
        c.appendChild(el('p', { class: 'muted', text: 'No edits yet.' }));
        return;
      }
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>When</th><th>Action</th><th>By</th><th>Reason / details</th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.audit.forEach(function (a) {
        var reason = (a.detailsJson && a.detailsJson.reason) ? a.detailsJson.reason : (a.detailsJson ? JSON.stringify(a.detailsJson).slice(0, 140) : '');
        tb.innerHTML += '<tr><td><span class="muted-small">' + fmtDate(a.createdAt) + '</span></td>' +
          '<td><strong>' + a.action + '</strong></td>' +
          '<td><span class="badge ' + (a.actorKind === 'ai_agent' ? 'badge-info' : 'badge-muted') + '">' + a.actorKind + '</span></td>' +
          '<td><span class="muted-small">' + reason + '</span></td></tr>';
      });
      c.appendChild(tbl);
    }).catch(showErr(c));
  }

  // ── helpers ────────────────────────────────────────────────────
  function showErr(c) { return function (err) { c.innerHTML = '<div class="notice error">' + (err.message || 'Failed') + '</div>'; }; }

  // ── AI Import (rate-sheet ingest) ─────────────────────────────
  function renderIngest(c) {
    c.innerHTML = '';
    c.appendChild(el('h1', { text: 'AI import' }));
    c.appendChild(el('p', { class: 'page-sub', text: 'Upload a rate sheet — PDF, image, Excel, email — and the AI extracts rate cards, accessorials, and lane zones for review.' }));

    // ── Upload card ────────────────────────────────────────
    var dropCard = el('div', { class: 'card', style: { padding: '14px 18px' } });
    var drop = el('div', {
      class: 'qf-dropzone',
      style: {
        border: '2px dashed var(--border-strong)',
        borderRadius: '12px',
        padding: '36px 20px',
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        color: 'var(--muted)',
      },
      text: '',
    });
    drop.innerHTML = '<div style="font-size:18px; color:var(--ink); margin-bottom:6px;">Drop a rate sheet here</div>'
      + '<div style="font-size:13px; color:var(--muted);">PDF · PNG · JPEG · Excel (.xlsx) · Email (.eml) · CSV · Up to 5 MB</div>'
      + '<div style="margin-top:12px; font-family:var(--font-mono); font-size:11px; color:var(--muted-soft); letter-spacing:0.06em;">OR CLICK TO BROWSE</div>';
    var fileInput = el('input', { type: 'file', style: { display: 'none' }, accept: '.pdf,.png,.jpg,.jpeg,.webp,.gif,.xlsx,.xls,.eml,.csv,.txt' });

    drop.appendChild(fileInput);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('dragover', function (ev) { ev.preventDefault(); drop.style.background = 'var(--accent-soft)'; drop.style.borderColor = 'var(--accent)'; });
    drop.addEventListener('dragleave', function () { drop.style.background = ''; drop.style.borderColor = 'var(--border-strong)'; });
    drop.addEventListener('drop', function (ev) {
      ev.preventDefault(); drop.style.background = ''; drop.style.borderColor = 'var(--border-strong)';
      var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    });

    var statusBox = el('div', { style: { marginTop: '14px', minHeight: '24px' } });
    dropCard.appendChild(drop);
    dropCard.appendChild(statusBox);
    c.appendChild(dropCard);

    // ── Recent jobs list ────────────────────────────────
    var listCard = el('div', { class: 'card', style: { marginTop: '20px', padding: '14px 18px' } });
    listCard.appendChild(el('h2', { text: 'Recent uploads', style: { marginBottom: '12px' } }));
    var listBody = el('div', {});
    listCard.appendChild(listBody);
    c.appendChild(listCard);

    // ── Review pane (toggled when a job is selected) ────────
    var reviewBox = el('div', { id: 'ingest-review', style: { marginTop: '20px' } });
    c.appendChild(reviewBox);

    refreshList();

    function handleFile(file) {
      if (file.size > 5 * 1024 * 1024) {
        statusBox.innerHTML = '<div class="notice error">File is bigger than 5 MB — split it into smaller chunks.</div>';
        return;
      }
      statusBox.innerHTML = '<div class="muted-small">Uploading <strong>' + escapeHtml(file.name) + '</strong>…</div>';
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = reader.result || '';
        // strip "data:<mime>;base64," prefix
        var idx = dataUrl.indexOf(',');
        var b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
        api('/api/tenant/ingest', {
          method: 'POST',
          body: { filename: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: b64 },
        }).then(function (r) {
          statusBox.innerHTML = '<div class="muted-small">Parsing <span class="dots"></span></div>';
          pollJob(r.jobId, 0);
        }).catch(function (err) {
          statusBox.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Upload failed') + '</div>';
        });
      };
      reader.onerror = function () {
        statusBox.innerHTML = '<div class="notice error">Could not read file.</div>';
      };
      reader.readAsDataURL(file);
    }

    function pollJob(jobId, attempt) {
      if (attempt > 60) { statusBox.innerHTML = '<div class="notice warn">Still parsing — check back in a minute (job #' + jobId + ').</div>'; refreshList(); return; }
      api('/api/tenant/ingest/' + jobId).then(function (r) {
        var job = r.job;
        if (job.status === 'parsing') {
          setTimeout(function () { pollJob(jobId, attempt + 1); }, 1500);
          return;
        }
        if (job.status === 'failed') {
          statusBox.innerHTML = '<div class="notice error">Parse failed: ' + escapeHtml(job.errorMessage || 'unknown error') + '</div>';
          refreshList();
          return;
        }
        // ready_for_review
        statusBox.innerHTML = '<div class="notice">Parsed — review below ↓</div>';
        refreshList();
        showReview(job);
      }).catch(function (err) {
        statusBox.innerHTML = '<div class="notice error">' + escapeHtml(err.message || 'Lost the job') + '</div>';
      });
    }

    function refreshList() {
      api('/api/tenant/ingest').then(function (r) {
        listBody.innerHTML = '';
        if (!r.jobs || !r.jobs.length) {
          listBody.appendChild(el('div', { class: 'muted-small', text: 'No uploads yet.' }));
          return;
        }
        var tbl = el('table', { class: 'table', style: { background: 'transparent' } });
        var thead = el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'File' }),
            el('th', { text: 'Status' }),
            el('th', { text: 'When' }),
            el('th', { text: '' }),
          ]),
        ]);
        tbl.appendChild(thead);
        var tbody = el('tbody', {});
        r.jobs.forEach(function (j) {
          var statusBadge = el('span', { class: 'badge ' + statusClass(j.status), text: j.status });
          var openBtn = el('button', {
            class: 'btn btn-ghost btn-sm',
            text: j.status === 'ready_for_review' ? 'Review' : 'View',
            on: { click: function () {
              api('/api/tenant/ingest/' + j.id).then(function (r) { showReview(r.job); window.scrollTo(0, document.body.scrollHeight); });
            } }
          });
          tbody.appendChild(el('tr', {}, [
            el('td', { text: j.filename }),
            el('td', {}, [statusBadge]),
            el('td', { text: fmtDate(j.createdAt) }),
            el('td', {}, [openBtn]),
          ]));
        });
        tbl.appendChild(tbody);
        listBody.appendChild(tbl);
      }).catch(showErr(listBody));
    }

    function statusClass(s) {
      if (s === 'applied') return 'badge-success';
      if (s === 'ready_for_review') return 'badge-info';
      if (s === 'failed') return 'badge-error';
      if (s === 'rejected') return 'badge-muted';
      return 'badge-muted';
    }

    function showReview(job) {
      reviewBox.innerHTML = '';
      var parsed = job.parsed || {};
      var card = el('div', { class: 'card', style: { padding: '18px 22px' } });

      card.appendChild(el('h2', { text: 'Review: ' + job.filename }));
      if (parsed.summary) card.appendChild(el('p', { class: 'muted', text: parsed.summary, style: { marginBottom: '10px' } }));

      if (parsed.confidence) {
        var conf = parsed.confidence;
        var badgeClass = conf === 'high' ? 'badge-success' : conf === 'medium' ? 'badge-warn' : 'badge-error';
        card.appendChild(el('span', { class: 'badge ' + badgeClass, text: 'Confidence: ' + conf, style: { marginRight: '8px' } }));
      }
      if (parsed.warnings && parsed.warnings.length) {
        var warn = el('div', { class: 'notice warn', style: { marginTop: '12px' } });
        warn.innerHTML = '<strong>Warnings:</strong><ul style="margin:6px 0 0 18px;">' +
          parsed.warnings.map(function (w) { return '<li>' + escapeHtml(String(w)) + '</li>'; }).join('') +
          '</ul>';
        card.appendChild(warn);
      }

      if (job.status !== 'ready_for_review') {
        card.appendChild(el('div', { class: 'muted-small', style: { marginTop: '14px' }, text: 'Status: ' + job.status + '. No further action available.' }));
        reviewBox.appendChild(card);
        return;
      }

      // Editable selection per item type.
      var rcSelections = renderItemList(card, 'Rate cards', parsed.rateCards || [], rateCardSummary);
      var accSelections = renderItemList(card, 'Accessorials', parsed.accessorials || [], accSummary);
      var lzSelections = renderItemList(card, 'Lane zones', parsed.laneZones || [], laneZoneSummary);

      var actionRow = el('div', { style: { marginTop: '20px', display: 'flex', gap: '10px' } });
      var applyBtn = el('button', {
        class: 'btn btn-primary',
        text: 'Apply selected',
        on: { click: function () {
          var body = {
            rateCards: rcSelections.selected(),
            accessorials: accSelections.selected(),
            laneZones: lzSelections.selected(),
          };
          var total = body.rateCards.length + body.accessorials.length + body.laneZones.length;
          if (total === 0) { alert('Tick at least one item to apply.'); return; }
          if (!confirm('Apply ' + total + ' item(s) to your rate book?')) return;
          applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
          api('/api/tenant/ingest/' + job.id + '/apply', {
            method: 'POST', body: body,
          }).then(function (r) {
            reviewBox.innerHTML = '<div class="notice"><strong>Applied.</strong> ' +
              r.inserted.rateCards + ' rate cards · ' +
              r.inserted.accessorials + ' accessorials · ' +
              r.inserted.laneZones + ' lane zones</div>';
            refreshList();
          }).catch(function (err) {
            applyBtn.disabled = false; applyBtn.textContent = 'Apply selected';
            alert(err.message || 'Apply failed.');
          });
        } }
      });
      var rejectBtn = el('button', {
        class: 'btn btn-danger',
        text: 'Reject',
        on: { click: function () {
          if (!confirm('Discard this parsed result?')) return;
          api('/api/tenant/ingest/' + job.id + '/reject', { method: 'POST' }).then(function () {
            reviewBox.innerHTML = '';
            refreshList();
          });
        } }
      });
      actionRow.appendChild(applyBtn);
      actionRow.appendChild(rejectBtn);
      card.appendChild(actionRow);
      reviewBox.appendChild(card);
    }

    function renderItemList(parent, title, items, summarize) {
      var section = el('div', { style: { marginTop: '20px' } });
      section.appendChild(el('h3', { text: title + ' (' + items.length + ')', style: { fontSize: '15px', marginBottom: '8px' } }));
      if (!items.length) {
        section.appendChild(el('div', { class: 'muted-small', text: '— none extracted —' }));
        parent.appendChild(section);
        return { selected: function () { return []; } };
      }
      var checks = [];
      items.forEach(function (item, i) {
        var wrap = el('label', { style: { display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer' } });
        var cb = el('input', { type: 'checkbox', checked: 'checked', style: { marginTop: '3px' } });
        var info = el('div', { style: { flex: '1' } });
        info.innerHTML = summarize(item);
        wrap.appendChild(cb); wrap.appendChild(info);
        section.appendChild(wrap);
        checks.push({ cb: cb, item: item });
      });
      parent.appendChild(section);
      return {
        selected: function () { return checks.filter(function (x) { return x.cb.checked; }).map(function (x) { return x.item; }); },
      };
    }

    function rateCardSummary(c) {
      var bits = [c.label || (c.equipment + ' / ' + c.service)];
      if (c.ratePerMile != null) bits.push('$' + c.ratePerMile + '/mi');
      if (c.minimumCharge != null) bits.push('min $' + c.minimumCharge);
      if (c.fuelSurchargePct != null) bits.push(c.fuelSurchargePct + '% fuel');
      return '<strong>' + escapeHtml(bits.shift()) + '</strong>'
        + '<div class="muted-small">' + escapeHtml(bits.join(' · ')) + '</div>';
    }
    function accSummary(a) {
      return '<strong>' + escapeHtml(a.label || a.code) + '</strong>'
        + '<div class="muted-small">' + escapeHtml((a.kind || 'flat') + ' · $' + (a.amount ?? 0)) + '</div>';
    }
    function laneZoneSummary(z) {
      return '<strong>' + escapeHtml(z.label || (z.anchorPortCode || z.anchorCity || 'zone')) + '</strong>'
        + '<div class="muted-small">' + escapeHtml('within ' + (z.radiusMiles ?? '?') + ' mi · $' + (z.flatPrice ?? '?')) + '</div>';
    }
    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
        return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : m === '"' ? '&quot;' : '&#39;';
      });
    }
  }

  // ── Trial banner ──────────────────────────────────────────────
  function renderTrialBanner(trial, tenant) {
    if (!trial) return;
    var bar = document.getElementById('qf-trial-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'qf-trial-bar';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.style.cssText =
      'padding:9px 18px; font-family: var(--font-mono); font-size:11.5px;' +
      'letter-spacing:0.08em; text-transform:uppercase; text-align:center;' +
      'border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100;';
    if (trial.status === 'trial') {
      var color = trial.daysLeft <= 3 ? 'var(--warn)' : 'var(--accent)';
      bar.style.background = 'var(--surface)';
      bar.style.color = color;
      // All-inclusive trial: every Pro feature unlocked, no lead cap.
      bar.innerHTML =
        'Trial — ' + trial.daysLeft + ' day' + (trial.daysLeft === 1 ? '' : 's') + ' left · ' +
        'all features unlocked &nbsp;·&nbsp; ' +
        '<a href="/pricing" style="color: var(--accent); text-decoration: underline;">Manage plan →</a>';
      document.body.classList.remove('qf-trial-locked');
    } else if (trial.status === 'trial_expired') {
      bar.style.background = 'var(--error-bg)';
      bar.style.color = 'var(--error)';
      bar.innerHTML =
        'Trial ended — your widget is read-only. ' +
        '<a href="/pricing" style="color: var(--error); text-decoration: underline;">Choose a plan to keep capturing leads →</a>';
      // Add the trial-locked body class so CSS disables every editable
      // control inside .app-main. Keeps users from typing into a field
      // whose backend write would fail anyway.
      document.body.classList.add('qf-trial-locked');
    } else if (trial.status === 'paid') {
      bar.remove();
      document.body.classList.remove('qf-trial-locked');
    }
  }

  // Sidebar toggle — works at every width.
  // - Mobile (<900px): hamburger slides the off-canvas sidebar in/out.
  // - Desktop (>=900px): hamburger collapses the sidebar so the content
  //   gets the full window width. Click again to bring it back.
  function wireMobileNav() {
    var toggle = document.getElementById('qf-mobile-nav-toggle');
    var shell = document.getElementById('app-shell');
    if (!toggle || !shell) return;
    function isDesktop() { return window.innerWidth >= 901; }
    function setOpenMobile(open) {
      shell.classList.toggle('qf-nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    }
    function setCollapsedDesktop(collapsed) {
      shell.classList.toggle('qf-nav-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Show sidebar' : 'Hide sidebar');
    }
    toggle.addEventListener('click', function () {
      if (isDesktop()) {
        setCollapsedDesktop(!shell.classList.contains('qf-nav-collapsed'));
      } else {
        setOpenMobile(!shell.classList.contains('qf-nav-open'));
      }
    });
    // Auto-close mobile drawer after picking a nav item.
    $$('.sidebar .nav-item').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!isDesktop()) setOpenMobile(false);
      });
    });
    // Tap outside (anywhere in main) closes the mobile drawer.
    document.querySelector('.app-main').addEventListener('click', function () {
      if (!isDesktop()) setOpenMobile(false);
    });
  }

  // ── boot ───────────────────────────────────────────────────────
  function boot() {
    api('/api/auth/me').then(function (r) {
      if (!r.user) { location.href = '/login'; return; }
      if (r.user.role === 'super_admin' && !location.search.includes('mode=tenant')) {
        // Super admin defaults to admin dashboard
        location.href = '/admin';
        return;
      }
      state.me = r;
      $('#sb-tenant-name').textContent = (r.tenant && r.tenant.name) || r.user.name || r.user.email;
      $('#sb-tenant-slug').textContent =
        (r.tenant && r.tenant.hostedUrl)
          ? r.tenant.hostedUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
          : (r.tenant && '/w/' + r.tenant.slug) || '';
      $('#loading').style.display = 'none';
      $('#app-shell').hidden = false;
      renderTrialBanner(r.trial, r.tenant);
      // Reveal the hamburger and wire its toggle now that the shell is visible.
      var t = document.getElementById('qf-mobile-nav-toggle');
      if (t) t.hidden = false;
      wireMobileNav();
      wireThemeToggle();

      $$('.sidebar [data-route]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.dataset.route); });
      });
      $('#sb-logout').addEventListener('click', function () {
        api('/api/auth/logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
      });

      // Route from URL
      var initial = (location.pathname.split('/app/')[1] || 'overview').split('/')[0];
      go(initial);
    }).catch(function (e) {
      // Only bounce to /login on a genuine auth failure (401). Any other
      // thrown error (e.g. a rendering bug) must NOT masquerade as logout —
      // surface it instead of locking the tenant out of the dashboard.
      if (e && e.status === 401) { location.href = '/login'; return; }
      console.error('[boot] dashboard init failed', e);
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-route]');
    if (a) { e.preventDefault(); go(a.dataset.route); }
  });
  window.addEventListener('popstate', function () {
    var r = (location.pathname.split('/app/')[1] || 'overview').split('/')[0];
    go(r);
  });

  boot();
})();
