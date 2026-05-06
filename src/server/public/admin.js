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

  var state = { route: null };

  function setActive(r) { $$('.sidebar [data-route]').forEach(function (b) { b.classList.toggle('active', b.dataset.route === r); }); }
  function go(r) {
    state.route = r; setActive(r);
    history.pushState({}, '', '/admin/' + r);
    var c = $('#page-content');
    c.innerHTML = '<div class="muted">Loading…</div>';
    if (r === 'overview') return renderOverview(c);
    if (r === 'tenants') return renderTenants(c);
    if (r.indexOf('tenants/') === 0) return renderTenantDetail(c, r.split('/')[1]);
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
      tbl.innerHTML = '<thead><tr><th>Slug</th><th>Name</th><th>Plan</th><th>Status</th><th>Country</th><th>Leads</th><th>Created</th></tr></thead><tbody></tbody>';
      var tb = tbl.querySelector('tbody');
      ts.tenants.slice(0, 25).forEach(function (t) {
        var tr = el('tr', { style: { cursor: 'pointer' }, on: { click: function () { go('tenants/' + t.slug); } } });
        tr.innerHTML =
          '<td><strong>' + t.slug + '</strong></td>' +
          '<td>' + t.name + '<br><span class="muted-small">' + t.contactEmail + '</span></td>' +
          '<td><span class="badge badge-info">' + t.plan + '</span></td>' +
          '<td><span class="badge ' + (t.status === 'active' ? 'badge-success' : 'badge-error') + '">' + t.status + '</span></td>' +
          '<td>' + t.countryFocus + '</td>' +
          '<td>' + t.leadCount + '</td>' +
          '<td><span class="muted-small">' + fmtDate(t.createdAt) + '</span></td>';
        tb.appendChild(tr);
      });
      c.appendChild(tbl);
    }).catch(function (err) { c.innerHTML = '<div class="notice error">' + err.message + '</div>'; });
  }

  function renderTenants(c) {
    api('/api/admin/tenants').then(function (d) {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'All tenants' }));
      c.appendChild(el('p', { class: 'page-sub', text: d.tenants.length + ' tenants on this platform' }));
      var tbl = el('table', { class: 'table' });
      tbl.innerHTML = '<thead><tr><th>Slug</th><th>Name</th><th>Plan</th><th>Status</th><th>Country</th><th>Leads</th><th>Created</th></tr></thead><tbody></tbody>';
      var tb = tbl.querySelector('tbody');
      d.tenants.forEach(function (t) {
        var tr = el('tr', { style: { cursor: 'pointer' }, on: { click: function () { go('tenants/' + t.slug); } } });
        tr.innerHTML =
          '<td><strong>' + t.slug + '</strong></td>' +
          '<td>' + t.name + '<br><span class="muted-small">' + t.contactEmail + '</span></td>' +
          '<td><span class="badge badge-info">' + t.plan + '</span></td>' +
          '<td><span class="badge ' + (t.status === 'active' ? 'badge-success' : 'badge-error') + '">' + t.status + '</span></td>' +
          '<td>' + t.countryFocus + '</td>' +
          '<td>' + t.leadCount + '</td>' +
          '<td><span class="muted-small">' + fmtDate(t.createdAt) + '</span></td>';
        tb.appendChild(tr);
      });
      c.appendChild(tbl);
    }).catch(function (err) { c.innerHTML = '<div class="notice error">' + err.message + '</div>'; });
  }

  function renderTenantDetail(c, slug) {
    api('/api/admin/tenants/' + encodeURIComponent(slug)).then(function (d) {
      var t = d.tenant;
      c.innerHTML = '';
      c.appendChild(el('a', { href: '#', class: 'muted-small', text: '← All tenants', on: { click: function (e) { e.preventDefault(); go('tenants'); } } }));
      c.appendChild(el('h1', { text: t.name + ' (' + t.slug + ')' }));

      var card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'card-title', text: 'Manage' }));

      function field(label, key, options) {
        var f = el('div', { class: 'field', style: { marginBottom: '10px' } });
        f.appendChild(el('label', { class: 'field-label', text: label }));
        var inp;
        if (options) {
          inp = el('select', { class: 'select' });
          options.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; if (t[key] === o) op.selected = true; inp.appendChild(op); });
          inp.addEventListener('change', function () { var p = {}; p[key] = inp.value; api('/api/admin/tenants/' + slug, { method: 'PATCH', body: p }).catch(alert); });
        } else {
          inp = el('input', { class: 'input', value: t[key] || '' });
          inp.addEventListener('blur', function () { var p = {}; p[key] = inp.value; api('/api/admin/tenants/' + slug, { method: 'PATCH', body: p }).catch(alert); });
        }
        f.appendChild(inp);
        return f;
      }
      card.appendChild(el('div', { class: 'grid-2' }, [
        field('Plan', 'plan', ['free', 'starter', 'pro', 'enterprise']),
        field('Status', 'status', ['active', 'suspended', 'churned']),
      ]));
      card.appendChild(field('Display name', 'name'));
      card.appendChild(field('Contact email', 'contactEmail'));
      c.appendChild(card);

      c.appendChild(el('h2', { text: 'Users (' + d.users.length + ')', style: { marginTop: '20px' } }));
      var ut = el('table', { class: 'table' });
      ut.innerHTML = '<thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Last login</th></tr></thead><tbody></tbody>';
      var utb = ut.querySelector('tbody');
      d.users.forEach(function (u) {
        utb.innerHTML += '<tr><td>' + u.email + '</td><td>' + (u.name || '—') + '</td><td><span class="badge badge-muted">' + u.role + '</span></td><td>' + fmtDate(u.lastLoginAt) + '</td></tr>';
      });
      c.appendChild(ut);

      c.appendChild(el('h2', { text: 'Recent leads (' + d.leads.length + ')', style: { marginTop: '20px' } }));
      var lt = el('table', { class: 'table' });
      lt.innerHTML = '<thead><tr><th>Ref</th><th>Customer</th><th>Service</th><th>Total</th><th>When</th></tr></thead><tbody></tbody>';
      var ltb = lt.querySelector('tbody');
      d.leads.forEach(function (l) {
        ltb.innerHTML += '<tr><td>' + l.refId + '</td><td>' + (l.customerName || '') + '</td><td>' + l.service + '</td><td>$' + (l.quotedTotal || 0) + '</td><td><span class="muted-small">' + fmtDate(l.createdAt) + '</span></td></tr>';
      });
      c.appendChild(lt);

      c.appendChild(el('h2', { text: 'Audit (' + d.audit.length + ')', style: { marginTop: '20px' } }));
      var at = el('table', { class: 'table' });
      at.innerHTML = '<thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead><tbody></tbody>';
      var atb = at.querySelector('tbody');
      d.audit.forEach(function (a) {
        atb.innerHTML += '<tr><td><span class="muted-small">' + fmtDate(a.createdAt) + '</span></td><td>' + a.action + '</td><td>' + a.actorKind + '</td></tr>';
      });
      c.appendChild(at);
    }).catch(function (err) { c.innerHTML = '<div class="notice error">' + err.message + '</div>'; });
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
        var slug = prompt('Tenant slug to view (will use the tenant dashboard, scoped to that tenant):');
        if (slug) location.href = '/app?mode=tenant&slug=' + encodeURIComponent(slug);
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
