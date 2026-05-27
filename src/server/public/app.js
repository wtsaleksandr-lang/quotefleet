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
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
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
  function wireThemeToggle() {
    var btn = document.getElementById('qf-theme-toggle');
    var icon = document.getElementById('qf-theme-icon');
    var label = document.getElementById('qf-theme-label');
    if (!btn) return;
    function paint() {
      var isLight = document.documentElement.getAttribute('data-theme') === 'light';
      icon.textContent = isLight ? '☀️' : '🌙';
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

  // ── Accessorials ──────────────────────────────────────────────
  function renderAccessorials(c) {
    api('/api/tenant/accessorials').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Accessorials' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Optional add-ons (chassis, liftgate, etc.) and auto-triggered fees (hazmat, overweight).' }));
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML =
        '<thead><tr><th>Code</th><th>Label</th><th>Kind</th>' +
        '<th style="text-align:right;">Amount</th><th>Trigger</th><th>Enabled</th><th></th></tr></thead><tbody></tbody>';
      var tb = $('tbody', tbl);
      d.accessorials.forEach(function (a) { tb.appendChild(accRow(a)); });
      c.appendChild(tbl);

      var addBtn = el('button', { class: 'btn btn-secondary', text: '+ Add accessorial', style: { marginTop: '14px' } });
      addBtn.addEventListener('click', function () {
        api('/api/tenant/accessorials', {
          method: 'POST',
          body: { code: 'new_' + Math.random().toString(36).slice(2, 6), label: 'New accessorial', kind: 'flat', amount: 50, trigger: 'optional' },
        }).then(function () { renderAccessorials(c); }).catch(toastErr);
      });
      c.appendChild(addBtn);
    }).catch(showErr(c));
  }
  function accRow(a) {
    var tr = el('tr');
    function inputCell(field, val, opts) {
      var inp = el('input', { class: 'input', value: val == null ? '' : val });
      if (opts && opts.type) inp.type = opts.type; if (opts && opts.step) inp.step = opts.step;
      inp.style.width = (opts && opts.w) || '120px';
      if (opts && opts.right) inp.style.textAlign = 'right';
      inp.addEventListener('blur', function () {
        var v = inp.value; if (opts && opts.type === 'number') v = v === '' ? null : Number(v);
        var p = {}; p[field] = v; api('/api/tenant/accessorials/' + a.id, { method: 'PUT', body: p }).catch(toastErr);
      });
      var td = el('td'); td.appendChild(inp); return td;
    }
    function selectCell(field, val, options) {
      var sel = el('select', { class: 'select' });
      sel.style.width = '140px';
      options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (val === o) op.selected = true; sel.appendChild(op); });
      sel.addEventListener('change', function () { var p = {}; p[field] = sel.value; api('/api/tenant/accessorials/' + a.id, { method: 'PUT', body: p }).catch(toastErr); });
      var td = el('td'); td.appendChild(sel); return td;
    }
    tr.appendChild(inputCell('code', a.code, { w: '110px' }));
    tr.appendChild(inputCell('label', a.label, { w: '180px' }));
    tr.appendChild(selectCell('kind', a.kind, ['flat', 'per_mile', 'pct_of_base', 'per_day', 'per_hour']));
    tr.appendChild(inputCell('amount', a.amount, { type: 'number', step: '0.5', right: true, w: '80px' }));
    tr.appendChild(selectCell('trigger', a.trigger, ['optional', 'auto', 'auto_if_residential', 'auto_if_hazmat', 'auto_if_temp_controlled', 'auto_if_weight_over']));
    var chk = el('input', { type: 'checkbox' });
    chk.checked = a.enabled;
    chk.addEventListener('change', function () { api('/api/tenant/accessorials/' + a.id, { method: 'PUT', body: { enabled: chk.checked } }).catch(toastErr); });
    tr.appendChild(el('td', null, [chk]));
    var del = el('button', { class: 'btn btn-danger btn-sm', text: 'Delete' });
    del.addEventListener('click', function () {
      if (!confirm('Delete accessorial?')) return;
      api('/api/tenant/accessorials/' + a.id, { method: 'DELETE' }).then(function () { tr.remove(); }).catch(toastErr);
    });
    tr.appendChild(el('td', null, [del]));
    return tr;
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
                var tag = el('div', { class: 'chat-bubble tool', text: '🛠 ' + t.tool + ': ' + t.result.message });
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

  // ── Brand ─────────────────────────────────────────────────────
  function renderBrand(c) {
    api('/api/tenant/brand').then(function (d) {
      var b = d.brand || {};
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Brand' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Customise how the widget looks on your site.' }));
      var card = el('div', { class: 'card' });
      function field(label, key, opts) {
        opts = opts || {};
        var f = el('div', { class: 'field', style: { marginBottom: '12px' } });
        f.appendChild(el('label', { class: 'field-label', text: label }));
        var inp;
        if (opts.textarea) inp = el('textarea', { class: 'textarea', rows: '3' });
        else inp = el('input', { class: 'input', type: opts.type || 'text' });
        inp.value = b[key] || '';
        inp.addEventListener('blur', function () { var p = {}; p[key] = inp.value; api('/api/tenant/brand', { method: 'PUT', body: p }).catch(toastErr); });
        f.appendChild(inp);
        if (opts.hint) f.appendChild(el('span', { class: 'field-hint', text: opts.hint }));
        return f;
      }
      card.appendChild(field('Display name', 'displayName'));
      card.appendChild(field('Tagline', 'tagline'));
      card.appendChild(el('div', { class: 'grid-2' }, [
        field('Primary color', 'primaryColor', { hint: 'Hex code, e.g. #2563eb' }),
        field('Accent color', 'accentColor', { hint: 'Hex code, e.g. #06b6d4' }),
      ]));
      card.appendChild(field('Logo URL', 'logoUrl', { hint: 'Hosted image URL — kept simple for MVP.' }));
      card.appendChild(field('CTA button text', 'ctaText'));
      card.appendChild(field('Footer note', 'footerNote', { textarea: true }));
      var togWrap = el('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' } });
      var tog = el('input', { type: 'checkbox' }); tog.checked = b.showPoweredBy !== false;
      tog.addEventListener('change', function () { api('/api/tenant/brand', { method: 'PUT', body: { showPoweredBy: tog.checked } }).catch(toastErr); });
      togWrap.appendChild(tog); togWrap.appendChild(el('span', { text: 'Show "Powered by QuoteFleet" footer' }));
      card.appendChild(togWrap);
      card.appendChild(field('Allowed domains (CSV, optional)', 'allowedDomains', { hint: 'e.g. acmeco.com,acmeco.ca — restricts widget to these origins.' }));
      c.appendChild(card);

      // ── Lead capture controls ───────────────────────────────────
      var capture = el('div', { class: 'card', style: { marginTop: '14px' } });
      capture.appendChild(el('div', { class: 'card-title', text: 'Lead capture' }));
      capture.appendChild(el('div', { class: 'card-subtitle', text: 'Choose what contact info the customer must provide before you receive a lead.' }));
      function toggleRow(label, key, defaultVal, hint) {
        var wrap = el('label', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' } });
        var cb = el('input', { type: 'checkbox', style: { marginTop: '3px' } });
        cb.checked = (b[key] !== undefined && b[key] !== null) ? !!b[key] : defaultVal;
        cb.addEventListener('change', function () {
          var p = {}; p[key] = cb.checked;
          api('/api/tenant/brand', { method: 'PUT', body: p }).catch(toastErr);
        });
        wrap.appendChild(cb);
        var txt = el('div', {}, [
          el('div', { text: label, style: { fontWeight: '600' } }),
          el('div', { class: 'field-hint', text: hint, style: { marginTop: '2px' } }),
        ]);
        wrap.appendChild(txt);
        return wrap;
      }
      capture.appendChild(toggleRow(
        'Require email',
        'requireEmail',
        true,
        'When ON, the widget will not submit a lead without an email address.'
      ));
      capture.appendChild(toggleRow(
        'Require phone',
        'requirePhone',
        false,
        'When ON, the widget will not submit a lead without a phone number. Useful for carriers who prefer to call back.'
      ));
      capture.appendChild(toggleRow(
        'Show price before contact info',
        'showQuoteBeforeContact',
        false,
        'When ON, the customer sees the quoted price first; contact details are asked only when they click "Claim this quote".'
      ));
      c.appendChild(capture);
    }).catch(showErr(c));
  }

  // ── Embed ─────────────────────────────────────────────────────
  function renderEmbed(c) {
    api('/api/tenant/embed').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Embed code' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'Drop one line of HTML on any page of your website.' }));

      // Preview card — show the live widget so brand changes are visible
      // without opening a new tab. Sandbox attribute on the iframe limits
      // what the embedded page can do (no top-nav, no popups).
      var preview = el('div', { class: 'card' });
      preview.appendChild(el('div', { class: 'card-title', text: 'Live preview' }));
      preview.appendChild(el('div', { class: 'card-subtitle', text: 'This is exactly what your customers see at ' + (d.directLink || '') }));
      var iframe = el('iframe', {
        src: (d.directLink || '/') + (d.directLink && d.directLink.indexOf('?') > -1 ? '&' : '?') + 'embed=1&preview=1',
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
        api('/api/tenant/regenerate-embed', { method: 'POST' }).then(function () { renderEmbed(c); }).catch(toastErr);
      });
      card4.appendChild(rg);
      c.appendChild(card4);
    }).catch(showErr(c));
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
      var used = trial.leadsUsed + ' / ' + trial.leadsLimit + ' leads';
      bar.innerHTML =
        'Trial — ' + trial.daysLeft + ' day' + (trial.daysLeft === 1 ? '' : 's') + ' left · ' +
        used + ' used &nbsp;·&nbsp; ' +
        '<a href="/pricing" style="color: var(--accent); text-decoration: underline;">Upgrade →</a>';
    } else if (trial.status === 'trial_expired') {
      bar.style.background = 'var(--error-bg)';
      bar.style.color = 'var(--error)';
      bar.innerHTML =
        'Trial ended — your widget is read-only. ' +
        '<a href="/pricing" style="color: var(--error); text-decoration: underline;">Upgrade to keep capturing leads →</a>';
      // Add the trial-locked body class so CSS disables every editable
      // control inside .app-main. Keeps users from typing into a field
      // whose backend write would fail anyway.
      document.body.classList.add('qf-trial-locked');
    } else if (trial.status === 'paid') {
      bar.remove();
      document.body.classList.remove('qf-trial-locked');
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
    }).catch(function () { location.href = '/login'; });
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
