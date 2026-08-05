(function () {
  'use strict';
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.from(document.querySelectorAll(s)); }
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
  function fmtDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
  function fmtMoney(n) {
    var v = Number(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    return fetch(path, opts).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        return j;
      });
    });
  }

  // SAFE row helper — every cell value goes through textContent (via el), so
  // tenant-controlled fields cannot inject HTML. Cells can be:
  //   - a string  → wrapped as a text node
  //   - a DOM node → appended verbatim
  function row(tbody, cells, opts) {
    var tr = el('tr', opts || {});
    cells.forEach(function (c) {
      var td = document.createElement('td');
      if (c == null) {
        // empty cell
      } else if (typeof c === 'string' || typeof c === 'number') {
        td.textContent = String(c);
      } else if (Array.isArray(c)) {
        c.forEach(function (n) { td.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); });
      } else {
        td.appendChild(c);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    return tr;
  }
  function badge(text, kind) { return el('span', { class: 'badge ' + (kind || 'badge-muted'), text: String(text || '') }); }
  function muted(text) { return el('span', { class: 'muted-small', text: String(text || '') }); }

  var state = { route: null };

  function setActive(r) { $$('.sidebar [data-route]').forEach(function (b) { b.classList.toggle('active', b.dataset.route === r); }); }
  function go(r) {
    state.route = r; setActive(r);
    history.pushState({}, '', '/admin/' + r);
    var c = $('#page-content');
    c.innerHTML = '<div class="muted">Loading…</div>';
    if (r === 'overview') return renderOverview(c);
    if (r === 'tenants') return renderTenants(c);
    if (r === 'outreach') return renderOutreach(c);
    if (r.indexOf('tenants/') === 0) return renderTenantDetail(c, r.split('/')[1]);
  }

  // Minimal super-admin trigger for the Phase-1 company-enrichment service.
  // Type a freight company's domain → POST /api/admin/outreach/enrich → show
  // the returned CompanyProfile JSON. The rich provisioning UI comes later.
  function renderOutreach(c) {
    c.innerHTML = '';
    c.appendChild(el('h1', { text: 'Company enrichment' }));
    c.appendChild(el('p', {
      class: 'page-sub',
      text: 'Turn a freight company domain into a structured profile (deterministic parse + AI + optional FMCSA). Profile generation only — no email is sent.',
    }));

    var card = el('div', { class: 'card' });
    var f = el('div', { class: 'field' });
    f.appendChild(el('label', { class: 'field-label', text: 'Company domain' }));
    var input = el('input', {
      class: 'input',
      type: 'text',
      placeholder: 'acme-freight.com',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    f.appendChild(input);
    card.appendChild(f);
    var actions = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    var goBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Enrich' });
    var demoBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Generate branded demo' });
    actions.appendChild(demoBtn);
    actions.appendChild(goBtn);
    card.appendChild(actions);
    c.appendChild(card);

    var out = el('div', { style: { marginTop: '16px' } });
    c.appendChild(out);

    function currentDomain() { return (input.value || '').trim(); }

    function run() {
      var domain = currentDomain();
      if (!domain) { input.focus(); return; }
      goBtn.disabled = true; demoBtn.disabled = true;
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'muted', text: 'Enriching ' + domain + '…' }));
      api('/api/admin/outreach/enrich', { method: 'POST', body: { domain: domain } })
        .then(function (d) { showResult(null, d.profile); })
        .catch(function (err) { showError(err); })
        .finally(function () { goBtn.disabled = false; demoBtn.disabled = false; });
    }

    // Provision (or refresh) the shareable branded demo page, then show the link.
    function provision() {
      var domain = currentDomain();
      if (!domain) { input.focus(); return; }
      goBtn.disabled = true; demoBtn.disabled = true;
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'muted', text: 'Building a branded demo for ' + domain + '…' }));
      api('/api/admin/outreach/provision', { method: 'POST', body: { domain: domain } })
        .then(function (d) { showResult(d.demoUrl, d.profile); })
        .catch(function (err) { showError(err); })
        .finally(function () { goBtn.disabled = false; demoBtn.disabled = false; });
    }

    function showError(err) {
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'notice error', text: err.message }));
    }

    function showResult(demoUrl, profile) {
      out.innerHTML = '';
      if (demoUrl) {
        var linkCard = el('div', { class: 'card', style: { marginBottom: '16px' } });
        linkCard.appendChild(el('div', { class: 'field-label', text: 'Shareable demo link' }));
        var link = el('a', { href: demoUrl, text: demoUrl, target: '_blank', rel: 'noopener', style: { wordBreak: 'break-all' } });
        linkCard.appendChild(link);
        var linkActions = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } });
        var openBtn = el('a', { class: 'btn btn-primary', href: demoUrl, target: '_blank', rel: 'noopener', text: 'Open demo ↗' });
        var copyBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Copy link' });
        copyBtn.addEventListener('click', function () {
          try {
            navigator.clipboard.writeText(demoUrl).then(function () {
              copyBtn.textContent = 'Copied ✓';
              setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1600);
            });
          } catch (e) { /* clipboard unavailable */ }
        });
        linkActions.appendChild(openBtn);
        linkActions.appendChild(copyBtn);
        linkCard.appendChild(linkActions);
        out.appendChild(linkCard);
      }
      var pre = el('pre', {
        class: 'input',
        style: { whiteSpace: 'pre-wrap', overflowX: 'auto', fontVariantNumeric: 'tabular-nums' },
        text: JSON.stringify(profile, null, 2),
      });
      out.appendChild(pre);
    }

    goBtn.addEventListener('click', run);
    demoBtn.addEventListener('click', provision);
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); provision(); } });
    input.focus();
  }

  function renderOverview(c) {
    Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/tenants'),
    ]).then(function (out) {
      var s = out[0]; var ts = out[1];
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Platform overview' }));
      c.appendChild(el('p', { class: 'page-sub', text: 'A view across all tenants on this deployment.' }));
      var grid = el('div', { class: 'features', style: { margin: '0 0 24px 0' } });

      // ── MRR tile — real recognized revenue, with per-plan breakdown and a
      //    muted trial-pipeline line (NOT counted in MRR). Money figures use
      //    tabular-nums so they align; the whole tile reuses the stat-tile
      //    `.feature` styling the counts below use. ──────────────────────────
      var byPlan = s.byPlan || { vital: { count: 0 }, pro: { count: 0 } };
      var vitalN = (byPlan.vital && byPlan.vital.count) || 0;
      var proN = (byPlan.pro && byPlan.pro.count) || 0;
      var trialN = s.trialingCount || 0;
      var mrrCard = el('div', { class: 'feature' });
      mrrCard.appendChild(el('div', { class: 'muted-small', text: 'Monthly recurring revenue' }));
      mrrCard.appendChild(el('div', {
        style: { fontSize: '32px', fontWeight: '800', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
        text: fmtMoney(s.mrr) + '/mo',
      }));
      mrrCard.appendChild(el('div', {
        class: 'muted-small',
        style: { marginTop: '4px' },
        text: vitalN + ' Vital · ' + proN + ' Pro',
      }));
      mrrCard.appendChild(el('div', {
        class: 'muted-small',
        style: { marginTop: '4px' },
        text: trialN + ' in trial (potential ' + fmtMoney(s.potentialTrialMrr) + ')',
      }));
      grid.appendChild(mrrCard);

      [
        ['Tenants', s.tenants],
        ['Users', s.users],
        ['Total leads', s.leads],
      ].forEach(function (st) {
        var card = el('div', { class: 'feature' });
        card.appendChild(el('div', { class: 'muted-small', text: st[0] }));
        card.appendChild(el('div', { style: { fontSize: '32px', fontWeight: '800', letterSpacing: '-0.02em' }, text: String(st[1]) }));
        grid.appendChild(card);
      });
      c.appendChild(grid);
      c.appendChild(el('h2', { text: 'Recent tenants' }));
      var tbl = el('table', { class: 'table' });
      tbl.appendChild(el('thead', { html: '<tr><th>Slug</th><th>Name</th><th>Plan</th><th>Status</th><th>Country</th><th>Leads</th><th>Created</th></tr>' }));
      var tb = el('tbody');
      tbl.appendChild(tb);
      ts.tenants.slice(0, 25).forEach(function (t) {
        var nameCell = el('div');
        nameCell.appendChild(document.createTextNode(t.name || ''));
        nameCell.appendChild(el('br'));
        nameCell.appendChild(muted(t.contactEmail));
        row(tb, [
          el('strong', { text: t.slug || '' }),
          nameCell,
          badge(t.plan, 'badge-info'),
          badge(t.status, t.status === 'active' ? 'badge-success' : 'badge-error'),
          t.countryFocus,
          String(t.leadCount),
          muted(fmtDate(t.createdAt)),
        ], { style: { cursor: 'pointer' }, on: { click: function () { go('tenants/' + encodeURIComponent(t.slug)); } } });
      });
      c.appendChild(tbl);
    }).catch(function (err) {
      c.innerHTML = '';
      c.appendChild(el('div', { class: 'notice error', text: err.message }));
    });
  }

  function renderTenants(c) {
    api('/api/admin/tenants').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'All tenants' }));
      c.appendChild(el('p', { class: 'page-sub', text: d.tenants.length + ' tenants on this platform' }));
      var tbl = el('table', { class: 'table' });
      tbl.appendChild(el('thead', { html: '<tr><th>Slug</th><th>Name</th><th>Plan</th><th>Status</th><th>Country</th><th>Leads</th><th>Created</th></tr>' }));
      var tb = el('tbody');
      tbl.appendChild(tb);
      d.tenants.forEach(function (t) {
        var nameCell = el('div');
        nameCell.appendChild(document.createTextNode(t.name || ''));
        nameCell.appendChild(el('br'));
        nameCell.appendChild(muted(t.contactEmail));
        row(tb, [
          el('strong', { text: t.slug || '' }),
          nameCell,
          badge(t.plan, 'badge-info'),
          badge(t.status, t.status === 'active' ? 'badge-success' : 'badge-error'),
          t.countryFocus,
          String(t.leadCount),
          muted(fmtDate(t.createdAt)),
        ], { style: { cursor: 'pointer' }, on: { click: function () { go('tenants/' + encodeURIComponent(t.slug)); } } });
      });
      c.appendChild(tbl);
    }).catch(function (err) {
      c.innerHTML = '';
      c.appendChild(el('div', { class: 'notice error', text: err.message }));
    });
  }

  function renderTenantDetail(c, slug) {
    api('/api/admin/tenants/' + encodeURIComponent(slug)).then(function (d) {
      var t = d.tenant;
      c.innerHTML = '';
      c.appendChild(el('a', { href: '#', class: 'muted-small', text: '← All tenants', on: { click: function (e) { e.preventDefault(); go('tenants'); } } }));
      c.appendChild(el('h1', { text: (t.name || '') + ' (' + (t.slug || '') + ')' }));

      var card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'card-title', text: 'Manage' }));

      function field(label, key, options) {
        var f = el('div', { class: 'field', style: { marginBottom: '10px' } });
        f.appendChild(el('label', { class: 'field-label', text: label }));
        var inp;
        if (options) {
          inp = el('select', { class: 'select' });
          options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (t[key] === o) op.selected = true; inp.appendChild(op); });
          inp.addEventListener('change', function () { var p = {}; p[key] = inp.value; api('/api/admin/tenants/' + encodeURIComponent(slug), { method: 'PATCH', body: p }).catch(function (e) { alert(e.message); }); });
        } else {
          inp = el('input', { class: 'input', value: t[key] || '' });
          inp.addEventListener('blur', function () { var p = {}; p[key] = inp.value; api('/api/admin/tenants/' + encodeURIComponent(slug), { method: 'PATCH', body: p }).catch(function (e) { alert(e.message); }); });
        }
        f.appendChild(inp);
        return f;
      }
      card.appendChild(el('div', { class: 'grid-2' }, [
        field('Plan', 'plan', ['free', 'vital', 'pro']),
        field('Status', 'status', ['active', 'suspended', 'churned']),
      ]));
      card.appendChild(field('Display name', 'name'));
      card.appendChild(field('Contact email', 'contactEmail'));
      c.appendChild(card);

      c.appendChild(el('h2', { text: 'Users (' + d.users.length + ')', style: { marginTop: '20px' } }));
      var ut = el('table', { class: 'table' });
      ut.appendChild(el('thead', { html: '<tr><th>Email</th><th>Name</th><th>Role</th><th>Last login</th></tr>' }));
      var utb = el('tbody');
      ut.appendChild(utb);
      d.users.forEach(function (u) {
        row(utb, [
          u.email || '',
          u.name || '—',
          badge(u.role, 'badge-muted'),
          fmtDate(u.lastLoginAt),
        ]);
      });
      c.appendChild(ut);

      c.appendChild(el('h2', { text: 'Recent leads (' + d.leads.length + ')', style: { marginTop: '20px' } }));
      var lt = el('table', { class: 'table' });
      lt.appendChild(el('thead', { html: '<tr><th>Ref</th><th>Customer</th><th>Service</th><th>Total</th><th>When</th></tr>' }));
      var ltb = el('tbody');
      lt.appendChild(ltb);
      d.leads.forEach(function (l) {
        row(ltb, [
          l.refId || '',
          l.customerName || '',
          l.service || '',
          '$' + (l.quotedTotal || 0),
          muted(fmtDate(l.createdAt)),
        ]);
      });
      c.appendChild(lt);

      c.appendChild(el('h2', { text: 'Audit (' + d.audit.length + ')', style: { marginTop: '20px' } }));
      var at = el('table', { class: 'table' });
      at.appendChild(el('thead', { html: '<tr><th>When</th><th>Action</th><th>By</th></tr>' }));
      var atb = el('tbody');
      at.appendChild(atb);
      d.audit.forEach(function (a) {
        row(atb, [
          muted(fmtDate(a.createdAt)),
          a.action || '',
          a.actorKind || '',
        ]);
      });
      c.appendChild(at);
    }).catch(function (err) {
      c.innerHTML = '';
      c.appendChild(el('div', { class: 'notice error', text: err.message }));
    });
  }

  function boot() {
    api('/api/auth/me').then(function (r) {
      if (!r.user || r.user.role !== 'super_admin') { location.href = '/login'; return; }
      $('#loading').style.display = 'none';
      $('#app-shell').hidden = false;
      $$('.sidebar [data-route]').forEach(function (b) {
        b.addEventListener('click', function () { go(b.dataset.route); });
      });
      $('#switch-tenant').addEventListener('click', function () {
        var btn = this;
        // Inline slug entry (replaces window.prompt) — matches the app's
        // inline-edit pattern: input + Go, submit on Enter, cancel on Escape
        // / blur. Avoids the blocking browser prompt() dialog.
        function open(slug) {
          slug = (slug || '').trim().toLowerCase();
          if (slug) location.href = '/app?mode=tenant&slug=' + encodeURIComponent(slug);
        }
        var input = el('input', {
          class: 'input',
          type: 'text',
          placeholder: 'tenant slug…',
          autocomplete: 'off',
          spellcheck: 'false',
          style: { flex: '1', minWidth: '0' },
        });
        var goBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Go' });
        var box = el('div', {
          class: 'nav-item',
          style: { display: 'flex', gap: '6px', alignItems: 'center' },
        }, [input, goBtn]);
        var restored = false;
        function restore() { if (restored) return; restored = true; box.replaceWith(btn); }
        goBtn.addEventListener('click', function () { open(input.value); });
        input.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); open(input.value); }
          else if (ev.key === 'Escape') { ev.preventDefault(); restore(); }
        });
        input.addEventListener('blur', function () { setTimeout(restore, 120); });
        btn.replaceWith(box);
        input.focus();
      });
      $('#logout').addEventListener('click', function () {
        api('/api/auth/logout', { method: 'POST' }).finally(function () { location.href = '/login'; });
      });
      var initial = (location.pathname.split('/admin/')[1] || 'overview');
      go(initial.indexOf('tenants/') === 0 ? initial : initial.split('/')[0]);
    }).catch(function () { location.href = '/login'; });
  }

  window.addEventListener('popstate', function () {
    var r = (location.pathname.split('/admin/')[1] || 'overview');
    go(r.indexOf('tenants/') === 0 ? r : r.split('/')[0]);
  });

  boot();
})();
