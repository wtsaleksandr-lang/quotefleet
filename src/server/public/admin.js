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
    if (r === 'subscriptions') return renderSubscriptions(c);
    if (r === 'importers') return renderImporters(c);
    if (r === 'outreach') return renderOutreach(c);
    if (r === 'affiliates') return renderAffiliates(c);
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
    var draftBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Draft email' });
    actions.appendChild(demoBtn);
    actions.appendChild(draftBtn);
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

    // Draft a personalized, CASL-compliant outreach email for review before send.
    function draftEmail() {
      var domain = currentDomain();
      if (!domain) { input.focus(); return; }
      goBtn.disabled = true; demoBtn.disabled = true; draftBtn.disabled = true;
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'muted', text: 'Drafting an outreach email for ' + domain + '…' }));
      api('/api/admin/outreach/draft-email', { method: 'POST', body: { domain: domain } })
        .then(function (d) { showEmail(d); })
        .catch(function (err) { showError(err); })
        .finally(function () { goBtn.disabled = false; demoBtn.disabled = false; draftBtn.disabled = false; });
    }

    // Render the drafted email for human review (subject + rendered body). The
    // body HTML is our own drafter output (compliance footer + unsubscribe link
    // already appended); we show it so a human approves before Phase 3 sends.
    function showEmail(d) {
      out.innerHTML = '';
      var emailCard = el('div', { class: 'card', style: { marginBottom: '16px' } });
      emailCard.appendChild(el('div', { class: 'field-label', text: 'Subject' }));
      emailCard.appendChild(el('div', { style: { fontWeight: '600', marginBottom: '16px' }, text: d.subject }));
      emailCard.appendChild(el('div', {
        class: 'field-label',
        text: d.aiGenerated ? 'Body (AI-personalized)' : 'Body (template fallback)',
      }));
      var body = el('div', { class: 'input', style: { padding: '16px', overflowX: 'auto' } });
      body.innerHTML = d.bodyHtml;
      emailCard.appendChild(body);
      if (d.demoUrl) {
        var demoLine = el('div', { class: 'muted', style: { marginTop: '12px', wordBreak: 'break-all' } });
        demoLine.appendChild(document.createTextNode('Linked demo: '));
        demoLine.appendChild(el('a', { href: d.demoUrl, text: d.demoUrl, target: '_blank', rel: 'noopener' }));
        emailCard.appendChild(demoLine);
      }
      out.appendChild(emailCard);

      // ── Send test — email the EXACT reviewed draft to a recipient. Honors
      //    suppression server-side (an opted-out address returns skipped). ──
      var sendCard = el('div', { class: 'card', style: { marginBottom: '16px' } });
      sendCard.appendChild(el('div', { class: 'field-label', text: 'Send test' }));
      var sendField = el('div', { class: 'field' });
      var toInput = el('input', {
        class: 'input',
        type: 'email',
        placeholder: 'you@example.com',
        autocomplete: 'off',
        spellcheck: 'false',
      });
      sendField.appendChild(toInput);
      sendCard.appendChild(sendField);
      var sendBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Send test email' });
      var sendStatus = el('div', { class: 'muted', style: { marginTop: '12px' } });
      sendCard.appendChild(sendBtn);
      sendCard.appendChild(sendStatus);
      out.appendChild(sendCard);

      function describeSend(r) {
        if (r.skipped === 'suppressed') return { cls: 'notice', text: 'Skipped — recipient is unsubscribed.' };
        if (r.skipped === 'no-recipient') return { cls: 'notice error', text: 'Skipped — no recipient address.' };
        if (r.status === 'sent') return { cls: 'notice', text: 'Sent ✓' + (r.providerId ? ' (' + r.providerId + ')' : '') };
        if (r.status === 'unconfigured') return { cls: 'notice', text: 'No email provider configured — logged only.' };
        return { cls: 'notice error', text: 'Failed' + (r.error ? ' — ' + r.error : '') };
      }

      function doSend() {
        var to = (toInput.value || '').trim();
        if (!to) { toInput.focus(); return; }
        sendBtn.disabled = true;
        sendStatus.innerHTML = '';
        sendStatus.appendChild(el('div', { class: 'muted', text: 'Sending…' }));
        var body = d.emailId ? { emailId: d.emailId, to: to } : { domain: currentDomain(), to: to };
        api('/api/admin/outreach/send', { method: 'POST', body: body })
          .then(function (r) {
            var m = describeSend(r);
            sendStatus.innerHTML = '';
            sendStatus.appendChild(el('div', { class: m.cls, text: m.text }));
          })
          .catch(function (err) {
            sendStatus.innerHTML = '';
            sendStatus.appendChild(el('div', { class: 'notice error', text: err.message }));
          })
          .finally(function () { sendBtn.disabled = false; });
      }
      sendBtn.addEventListener('click', doSend);
      toInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); doSend(); }
      });

      var pre = el('pre', {
        class: 'input',
        style: { whiteSpace: 'pre-wrap', overflowX: 'auto' },
        text: d.bodyText,
      });
      out.appendChild(pre);
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
    draftBtn.addEventListener('click', draftEmail);
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

      // ── MRR tile — TOTAL recognized revenue across ALL THREE products
      //    (QuoteFleet SaaS + Directory Pro + Manifest Privacy), with a
      //    per-product breakdown. Manifest annual prices are amortized to a
      //    monthly figure server-side so every line is comparable. Money uses
      //    tabular-nums so it aligns; reuses the stat-tile `.feature` styling. ──
      var byPlan = s.byPlan || { vital: { count: 0 }, pro: { count: 0 } };
      var vitalN = (byPlan.vital && byPlan.vital.count) || 0;
      var proN = (byPlan.pro && byPlan.pro.count) || 0;
      var trialN = s.trialingCount || 0;
      var bp = s.byProduct || {};
      var qf = bp.quotefleet || { mrr: s.mrr || 0 };
      var dir = bp.directory || { mrr: 0, activeCount: 0 };
      var man = bp.manifest || { mrr: 0, activeCount: 0 };
      // Fallback for older API shape: total = the three products, else s.mrr.
      var totalMrr = (typeof s.totalMrr === 'number') ? s.totalMrr : (s.mrr || 0);
      var mrrCard = el('div', { class: 'feature' });
      mrrCard.appendChild(el('div', { class: 'muted-small', text: 'Total monthly recurring revenue' }));
      mrrCard.appendChild(el('div', {
        style: { fontSize: '32px', fontWeight: '800', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' },
        text: fmtMoney(totalMrr) + '/mo',
      }));
      function mrrLine(label, amt, sub) {
        var line = el('div', { class: 'muted-small', style: { marginTop: '4px', display: 'flex', justifyContent: 'space-between', gap: '10px' } });
        line.appendChild(el('span', { text: label + (sub ? ' · ' + sub : '') }));
        line.appendChild(el('span', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: '600' }, text: fmtMoney(amt) }));
        return line;
      }
      mrrCard.appendChild(mrrLine('QuoteFleet', qf.mrr || 0, vitalN + ' Vital / ' + proN + ' Pro'));
      mrrCard.appendChild(mrrLine('Directory Pro', dir.mrr || 0, (dir.activeCount || 0) + ' active'));
      mrrCard.appendChild(mrrLine('Manifest Privacy', man.mrr || 0, (man.activeCount || 0) + ' active'));
      mrrCard.appendChild(el('div', {
        class: 'muted-small',
        style: { marginTop: '6px', opacity: '0.8' },
        text: trialN + ' QuoteFleet trials (potential ' + fmtMoney(s.potentialTrialMrr) + ')',
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

  // ── Affiliates — operator view over the self-serve affiliate program. ──
  // List + per-affiliate stats, with inline Activate/Suspend, a tier select and
  // a commission-rate edit that PATCH /api/admin/affiliates/:id and refresh the
  // list in place. Mirrors the tenant table/field idiom + existing CSS classes.
  function renderAffiliates(c) {
    var currentStatus = '';

    function pct(rate) { return (Number(rate) * 100).toFixed(0) + '%'; }

    function patchAffiliate(id, body) {
      return api('/api/admin/affiliates/' + encodeURIComponent(id), { method: 'PATCH', body: body })
        .then(function () { load(); })
        .catch(function (e) { alert(e.message); });
    }

    function renderTable(wrap, d) {
      wrap.innerHTML = '';
      var list = (d && d.data) || [];
      wrap.appendChild(el('p', { class: 'page-sub', text: (d.total || 0) + ' affiliate' + ((d.total === 1) ? '' : 's') }));
      if (!list.length) {
        wrap.appendChild(el('div', { class: 'muted', text: 'No affiliates yet.' }));
        return;
      }
      var tbl = el('table', { class: 'table' });
      tbl.appendChild(el('thead', { html: '<tr><th>Affiliate</th><th>Code</th><th>Tier</th><th>Status</th><th>Rate</th><th>Clicks / Signups</th><th>Commission</th></tr>' }));
      var tb = el('tbody');
      tbl.appendChild(tb);

      list.forEach(function (a) {
        // Affiliate identity cell (name + email).
        var idCell = el('div');
        idCell.appendChild(document.createTextNode(a.name || '—'));
        idCell.appendChild(el('br'));
        idCell.appendChild(muted(a.email || ''));

        // Tier select.
        var tierSel = el('select', { class: 'select aff-tier' });
        ['base', 'pro', 'partner'].forEach(function (o) {
          var op = document.createElement('option');
          op.value = o; op.textContent = o;
          if (a.tier === o) op.selected = true;
          tierSel.appendChild(op);
        });
        tierSel.addEventListener('change', function () { patchAffiliate(a.id, { tier: tierSel.value }); });

        // Status badge + Activate / Suspend actions.
        var statusCell = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
        statusCell.appendChild(badge(a.status, a.status === 'active' ? 'badge-success' : (a.status === 'suspended' ? 'badge-error' : 'badge-muted')));
        if (a.status !== 'active') {
          var actBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Activate', style: { padding: '4px 10px' } });
          actBtn.addEventListener('click', function () { patchAffiliate(a.id, { status: 'active' }); });
          statusCell.appendChild(actBtn);
        }
        if (a.status !== 'suspended') {
          var suspBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Suspend', style: { padding: '4px 10px' } });
          suspBtn.addEventListener('click', function () { patchAffiliate(a.id, { status: 'suspended' }); });
          statusCell.appendChild(suspBtn);
        }

        // Commission-rate edit (stored as a fraction; edited as a percent 0–100).
        var rateInput = el('input', {
          class: 'input',
          type: 'number',
          min: '0', max: '100', step: '1',
          value: String(Math.round(Number(a.commissionRate) * 100)),
          style: { width: '72px' },
        });
        function commitRate() {
          var pctVal = parseFloat(rateInput.value);
          if (isNaN(pctVal)) { rateInput.value = String(Math.round(Number(a.commissionRate) * 100)); return; }
          var frac = Math.max(0, Math.min(1, pctVal / 100));
          if (frac === Number(a.commissionRate)) return; // no-op
          patchAffiliate(a.id, { commissionRate: frac });
        }
        rateInput.addEventListener('blur', commitRate);
        rateInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); rateInput.blur(); } });
        var rateCell = el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [rateInput, el('span', { class: 'muted-small', text: '%' })]);

        var commCell = el('div');
        commCell.appendChild(document.createTextNode(fmtMoney((a.pendingCents || 0) / 100) + ' pending'));
        commCell.appendChild(el('br'));
        commCell.appendChild(muted(fmtMoney((a.paidCents || 0) / 100) + ' paid'));

        row(tb, [
          idCell,
          el('strong', { text: a.code || '' }),
          tierSel,
          statusCell,
          rateCell,
          String(a.clicks || 0) + ' / ' + String(a.signups || 0),
          commCell,
        ]);
      });
      wrap.appendChild(tbl);
    }

    function load() {
      c.innerHTML = '';
      c.appendChild(el('h1', { text: 'Affiliates' }));

      // Status filter.
      var filter = el('div', { class: 'field', style: { maxWidth: '220px', marginBottom: '12px' } });
      filter.appendChild(el('label', { class: 'field-label', text: 'Filter by status' }));
      var fsel = el('select', { class: 'select' });
      [['', 'All'], ['pending', 'Pending'], ['active', 'Active'], ['suspended', 'Suspended']].forEach(function (o) {
        var op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        if (currentStatus === o[0]) op.selected = true;
        fsel.appendChild(op);
      });
      fsel.addEventListener('change', function () { currentStatus = fsel.value; load(); });
      filter.appendChild(fsel);
      c.appendChild(filter);

      var wrap = el('div');
      wrap.appendChild(el('div', { class: 'muted', text: 'Loading…' }));
      c.appendChild(wrap);

      var q = currentStatus ? ('?status=' + encodeURIComponent(currentStatus)) : '';
      api('/api/admin/affiliates' + q)
        .then(function (d) { renderTable(wrap, d); })
        .catch(function (err) {
          wrap.innerHTML = '';
          wrap.appendChild(el('div', { class: 'notice error', text: err.message }));
        });
    }

    load();
  }

  // ── Subscriptions — the two per-shipper revenue lines (Directory Pro +
  //    Manifest Privacy) that live outside `tenants`. Visibility (who's
  //    subscribed to each product) + comp/free-grant + audited Stripe refund. ──
  function renderSubscriptions(c) {
    c.innerHTML = '';
    c.appendChild(el('h1', { text: 'Subscriptions' }));
    c.appendChild(el('p', { class: 'page-sub', text: 'Directory Pro ($19/mo) and Manifest Privacy (annual) subscribers. Comp grants show a Comp badge and are excluded from recognized MRR.' }));

    function subTable(wrap, title, d, kind) {
      wrap.innerHTML = '';
      var list = (d && d.data) || [];
      wrap.appendChild(el('h2', { text: title + ' (' + (d.total || 0) + ')', style: { marginTop: '8px' } }));
      if (!list.length) { wrap.appendChild(el('div', { class: 'muted', text: 'No subscribers yet.' })); return; }
      var tbl = el('table', { class: 'table' });
      var head = kind === 'manifest'
        ? '<tr><th>Customer</th><th>Tier</th><th>Status</th><th>Renews / expires</th><th>Stripe</th></tr>'
        : '<tr><th>Customer</th><th>Status</th><th>Renews / expires</th><th>Stripe</th></tr>';
      tbl.appendChild(el('thead', { html: head }));
      var tb = el('tbody');
      tbl.appendChild(tb);
      list.forEach(function (r) {
        var idCell = el('div');
        idCell.appendChild(document.createTextNode(r.email || ('user #' + r.userId)));
        if (r.name) { idCell.appendChild(el('br')); idCell.appendChild(muted(r.name)); }
        var statusCell = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
        statusCell.appendChild(badge(r.status, r.status === 'active' ? 'badge-success' : (r.status === 'past_due' ? 'badge-error' : 'badge-muted')));
        if (r.comp) statusCell.appendChild(badge('comp', 'badge-info'));
        var stripeCell = el('div');
        stripeCell.appendChild(muted(r.stripeSubscriptionId || (r.comp ? '(comp — no Stripe)' : '—')));
        var cells = kind === 'manifest'
          ? [idCell, badge(r.tier || 'basic', 'badge-info'), statusCell, muted(fmtDate(r.currentPeriodEnd)), stripeCell]
          : [idCell, statusCell, muted(fmtDate(r.currentPeriodEnd)), stripeCell];
        row(tb, cells);
      });
      wrap.appendChild(tbl);
    }

    var dirWrap = el('div', {}, [el('div', { class: 'muted', text: 'Loading…' })]);
    var manWrap = el('div', { style: { marginTop: '24px' } }, [el('div', { class: 'muted', text: 'Loading…' })]);
    c.appendChild(dirWrap);
    c.appendChild(manWrap);

    function loadLists() {
      api('/api/admin/subscriptions/directory').then(function (d) { subTable(dirWrap, 'Directory Pro', d, 'directory'); })
        .catch(function (e) { dirWrap.innerHTML = ''; dirWrap.appendChild(el('div', { class: 'notice error', text: e.message })); });
      api('/api/admin/subscriptions/manifest').then(function (d) { subTable(manWrap, 'Manifest Privacy', d, 'manifest'); })
        .catch(function (e) { manWrap.innerHTML = ''; manWrap.appendChild(el('div', { class: 'notice error', text: e.message })); });
    }
    loadLists();

    // ── Comp / free-grant form ──────────────────────────────────────────
    var compCard = el('div', { class: 'card', style: { marginTop: '28px' } });
    compCard.appendChild(el('div', { class: 'card-title', text: 'Comp a subscription (free grant)' }));
    compCard.appendChild(el('p', { class: 'muted-small', text: 'Grants an active entitlement to an existing user account by email. Comped rows are not counted as revenue.' }));
    function fieldRow(label, node) {
      var f = el('div', { class: 'field', style: { marginBottom: '10px' } });
      f.appendChild(el('label', { class: 'field-label', text: label }));
      f.appendChild(node);
      return f;
    }
    var compProduct = el('select', { class: 'select' });
    [['directory', 'Directory Pro'], ['manifest', 'Manifest Privacy']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; compProduct.appendChild(op); });
    var compEmail = el('input', { class: 'input', type: 'email', placeholder: 'customer@example.com', autocomplete: 'off' });
    var compTier = el('select', { class: 'select' });
    ['basic', 'professional', 'enterprise'].forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; compTier.appendChild(op); });
    var compTierField = fieldRow('Tier (Manifest only)', compTier);
    var compMonths = el('input', { class: 'input', type: 'number', min: '1', max: '120', value: '12' });
    var compNote = el('input', { class: 'input', type: 'text', placeholder: 'e.g. launch partner' });
    compProduct.addEventListener('change', function () { compTierField.style.display = compProduct.value === 'manifest' ? '' : 'none'; });
    compCard.appendChild(fieldRow('Product', compProduct));
    compCard.appendChild(fieldRow('Customer email', compEmail));
    compCard.appendChild(compTierField);
    compCard.appendChild(fieldRow('Months', compMonths));
    compCard.appendChild(fieldRow('Note (optional)', compNote));
    var compBtn = el('button', { class: 'btn btn-primary', type: 'button', text: 'Grant comp' });
    var compStatus = el('div', { class: 'muted', style: { marginTop: '10px' } });
    compCard.appendChild(compBtn);
    compCard.appendChild(compStatus);
    compBtn.addEventListener('click', function () {
      var email = (compEmail.value || '').trim();
      if (!email) { compEmail.focus(); return; }
      var body = { email: email, months: Math.max(1, parseInt(compMonths.value, 10) || 12) };
      if ((compNote.value || '').trim()) body.note = compNote.value.trim();
      if (compProduct.value === 'manifest') body.tier = compTier.value;
      compBtn.disabled = true; compStatus.innerHTML = ''; compStatus.appendChild(el('div', { class: 'muted', text: 'Granting…' }));
      api('/api/admin/subscriptions/' + compProduct.value + '/comp', { method: 'POST', body: body })
        .then(function () { compStatus.innerHTML = ''; compStatus.appendChild(el('div', { class: 'notice', text: 'Comp granted ✓' })); compEmail.value = ''; loadLists(); })
        .catch(function (e) { compStatus.innerHTML = ''; compStatus.appendChild(el('div', { class: 'notice error', text: e.message })); })
        .finally(function () { compBtn.disabled = false; });
    });
    compTierField.style.display = 'none';
    c.appendChild(compCard);

    // ── Refund form (REAL MONEY — audited) ──────────────────────────────
    var refCard = el('div', { class: 'card', style: { marginTop: '20px' } });
    refCard.appendChild(el('div', { class: 'card-title', text: 'Issue a Stripe refund' }));
    refCard.appendChild(el('p', { class: 'muted-small', text: 'Real money — every refund is audited. Enter a Stripe PaymentIntent (pi_…) or Charge (ch_…) id. Leave amount blank for a full refund.' }));
    var refPi = el('input', { class: 'input', type: 'text', placeholder: 'pi_… (PaymentIntent) or leave blank', autocomplete: 'off' });
    var refCh = el('input', { class: 'input', type: 'text', placeholder: 'ch_… (Charge) — optional if PaymentIntent set', autocomplete: 'off' });
    var refAmt = el('input', { class: 'input', type: 'number', min: '1', placeholder: 'amount in cents (blank = full)' });
    var refReason = el('select', { class: 'select' });
    [['', '(no reason)'], ['requested_by_customer', 'requested_by_customer'], ['duplicate', 'duplicate'], ['fraudulent', 'fraudulent']].forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; refReason.appendChild(op); });
    refCard.appendChild(fieldRow('PaymentIntent id', refPi));
    refCard.appendChild(fieldRow('Charge id', refCh));
    refCard.appendChild(fieldRow('Amount (cents)', refAmt));
    refCard.appendChild(fieldRow('Reason', refReason));
    var refBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Issue refund' });
    var refStatus = el('div', { class: 'muted', style: { marginTop: '10px' } });
    refCard.appendChild(refBtn);
    refCard.appendChild(refStatus);
    refBtn.addEventListener('click', function () {
      var pi = (refPi.value || '').trim(); var ch = (refCh.value || '').trim();
      if (!pi && !ch) { refStatus.innerHTML = ''; refStatus.appendChild(el('div', { class: 'notice error', text: 'Enter a PaymentIntent or Charge id.' })); return; }
      if (!window.confirm('Issue this refund? This moves real money.')) return;
      var body = {};
      if (pi) body.paymentIntentId = pi; if (ch) body.chargeId = ch;
      var amt = parseInt(refAmt.value, 10); if (!isNaN(amt) && amt > 0) body.amountCents = amt;
      if (refReason.value) body.reason = refReason.value;
      refBtn.disabled = true; refStatus.innerHTML = ''; refStatus.appendChild(el('div', { class: 'muted', text: 'Refunding…' }));
      api('/api/admin/refund', { method: 'POST', body: body })
        .then(function (r) { refStatus.innerHTML = ''; refStatus.appendChild(el('div', { class: 'notice', text: 'Refunded ✓ ' + (r.refundId || '') + ' (' + (r.status || '') + ')' })); })
        .catch(function (e) { refStatus.innerHTML = ''; refStatus.appendChild(el('div', { class: 'notice error', text: e.message })); })
        .finally(function () { refBtn.disabled = false; });
    });
    c.appendChild(refCard);
  }

  // ── Importers — credits/usage meter + cache purge for Importer Search. ──
  function renderImporters(c) {
    c.innerHTML = '';
    c.appendChild(el('h1', { text: 'Importer Search' }));
    c.appendChild(el('p', { class: 'page-sub', text: 'Live-pull credit meter (session) and the persistent BOL/contact caches that keep repeat searches free.' }));

    var grid = el('div', { class: 'features', style: { margin: '0 0 24px 0' } });
    c.appendChild(grid);
    function stat(label, value) {
      var card = el('div', { class: 'feature' });
      card.appendChild(el('div', { class: 'muted-small', text: label }));
      card.appendChild(el('div', { style: { fontSize: '28px', fontWeight: '800', letterSpacing: '-0.02em' }, text: String(value) }));
      grid.appendChild(card);
    }
    api('/api/admin/importers/usage').then(function (d) {
      var m = d.meter || {}; var cache = d.cache || {};
      stat('Live pulls (session)', m.sessionLivePulls != null ? m.sessionLivePulls : '—');
      stat('Credits remaining', m.lastCreditsRemaining != null ? m.lastCreditsRemaining : 'unknown');
      stat('BOL cache rows', cache.bolRows != null ? cache.bolRows : '—');
      stat('Contact cache rows', cache.contactRows != null ? cache.contactRows : '—');
    }).catch(function (e) { grid.appendChild(el('div', { class: 'notice error', text: e.message })); });

    var card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title', text: 'Purge cache by company' }));
    card.appendChild(el('p', { class: 'muted-small', text: 'Deletes the resolved-contact cache for a company (forces a fresh Hunter resolve on next open). Optionally purge one BOL result set by its exact search key.' }));
    function fld(label, node) { var f = el('div', { class: 'field', style: { marginBottom: '10px' } }); f.appendChild(el('label', { class: 'field-label', text: label })); f.appendChild(node); return f; }
    var coInput = el('input', { class: 'input', type: 'text', placeholder: 'Company name', autocomplete: 'off' });
    var skInput = el('input', { class: 'input', type: 'text', placeholder: 'BOL search key (optional)', autocomplete: 'off' });
    card.appendChild(fld('Company', coInput));
    card.appendChild(fld('Search key (optional)', skInput));
    var pBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'Purge cache' });
    var pStatus = el('div', { class: 'muted', style: { marginTop: '10px' } });
    card.appendChild(pBtn); card.appendChild(pStatus);
    pBtn.addEventListener('click', function () {
      var co = (coInput.value || '').trim(); var sk = (skInput.value || '').trim();
      if (!co && !sk) { coInput.focus(); return; }
      var body = {}; if (co) body.company = co; if (sk) body.searchKey = sk;
      pBtn.disabled = true; pStatus.innerHTML = ''; pStatus.appendChild(el('div', { class: 'muted', text: 'Purging…' }));
      api('/api/admin/importers/cache/purge', { method: 'POST', body: body })
        .then(function (r) { pStatus.innerHTML = ''; pStatus.appendChild(el('div', { class: 'notice', text: 'Purged ✓ ' + (r.contactPurged || 0) + ' contact, ' + (r.bolPurged || 0) + ' BOL rows' })); })
        .catch(function (e) { pStatus.innerHTML = ''; pStatus.appendChild(el('div', { class: 'notice error', text: e.message })); })
        .finally(function () { pBtn.disabled = false; });
    });
    c.appendChild(card);
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

      // ── Trial extension shortcut ──────────────────────────────────────
      //   Quick +7 / +14 / +21 / +30d buttons that POST to the admin
      //   extend-trial endpoint. Server extends from the LATER of now or the
      //   existing end, so a lapsed trial restarts and an active one adds on.
      //   The displayed trial-end line refreshes in place from the response.
      var trialField = el('div', { class: 'field', style: { marginBottom: '10px' } });
      trialField.appendChild(el('label', { class: 'field-label', text: 'Trial' }));
      var trialLine = el('div', { class: 'muted-small', style: { marginBottom: '8px' } });
      function renderTrialLine() {
        trialLine.textContent = t.trialEndsAt ? 'Trial ends ' + fmtDate(t.trialEndsAt) : 'Not on trial';
      }
      renderTrialLine();
      trialField.appendChild(trialLine);
      var trialActions = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } });
      var trialStatus = el('span', { class: 'muted-small' });
      function setTrialBtnsDisabled(v) {
        Array.prototype.forEach.call(trialActions.querySelectorAll('button'), function (b) { b.disabled = v; });
      }
      [7, 14, 21, 30].forEach(function (d) {
        var b = el('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: '+' + d + 'd',
          style: { padding: '4px 10px' },
        });
        b.addEventListener('click', function () {
          setTrialBtnsDisabled(true);
          trialStatus.textContent = 'Extending…';
          api('/api/admin/tenants/' + encodeURIComponent(slug) + '/extend-trial', { method: 'POST', body: { days: d } })
            .then(function (r) {
              t.trialEndsAt = r.trialEndsAt;
              renderTrialLine();
              trialStatus.textContent = 'Extended +' + d + 'd ✓';
              setTimeout(function () { trialStatus.textContent = ''; }, 2000);
            })
            .catch(function (e) { trialStatus.textContent = e.message; })
            .finally(function () { setTrialBtnsDisabled(false); });
        });
        trialActions.appendChild(b);
      });
      trialActions.appendChild(trialStatus);
      trialField.appendChild(trialActions);
      card.appendChild(trialField);

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
