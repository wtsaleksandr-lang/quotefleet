(function () {
  'use strict';

  // Company contact + address moved to Account → Company details (one
  // clear home for what customers see). This card keeps only the
  // quote-document presentation fields. The carrier-profile PUT merges,
  // so saving here never wipes the address set on the Account page.
  var FIELDS = [
    ['quoteContactName', 'Quote contact name'],
    ['scac', 'SCAC'],
    ['websiteUrl', 'Website URL'],
  ];

  function pageIsBrand() {
    var h1 = document.querySelector('#page-content h1');
    return h1 && /brand/i.test(h1.textContent || '');
  }
  function field(label, key, value, textarea) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.style.marginBottom = '10px';
    var lab = document.createElement('label');
    lab.className = 'field-label';
    lab.textContent = label;
    var input = document.createElement(textarea ? 'textarea' : 'input');
    input.className = textarea ? 'textarea' : 'input';
    if (textarea) input.rows = 3;
    input.value = value || '';
    input.dataset.profileKey = key;
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function values(card) {
    var body = {};
    card.querySelectorAll('[data-profile-key]').forEach(function (inp) {
      body[inp.dataset.profileKey] = inp.value || null;
    });
    return body;
  }
  function install() {
    var page = document.getElementById('page-content');
    if (!page || !pageIsBrand() || page.querySelector('[data-qf-carrier-profile]')) return;
    // Reserve the guard synchronously — append the (empty) card BEFORE the
    // async fetch resolves. Otherwise the MutationObserver fires again while
    // the fetch is still in flight, the guard selector finds nothing, and a
    // second (third, …) card mounts. Populate the card once data arrives.
    var card = document.createElement('div');
    card.className = 'card';
    card.dataset.qfCarrierProfile = '1';
    card.style.marginTop = '14px';
    page.appendChild(card);
    fetch('/api/tenant/carrier-profile')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!card.isConnected) return;
        var profile = data.profile || {};
        card.innerHTML = '<div class="card-title">Quote document details</div><div class="card-subtitle">Contact name, SCAC and website shown on hosted quotes. Company phone, email and address live in Account → Company details.</div>';
        var grid = document.createElement('div');
        grid.className = 'grid-2';
        grid.style.gap = '12px';
        FIELDS.forEach(function (item) { grid.appendChild(field(item[1], item[0], profile[item[0]])); });
        card.appendChild(grid);
        card.appendChild(field('Quote footer text', 'quoteFooterText', profile.quoteFooterText, true));
        card.appendChild(field('Quote terms / disclaimer text', 'quoteTermsText', profile.quoteTermsText, true));
        var save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = 'Save carrier profile';
        save.addEventListener('click', function () {
          fetch('/api/tenant/carrier-profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values(card)),
          }).then(function (r) {
            if (!r.ok) throw new Error('Could not save carrier profile');
            if (window.qfToastOk) window.qfToastOk('Carrier profile saved');
          }).catch(function (err) { if (window.qfToastErr) window.qfToastErr(err); });
        });
        card.appendChild(save);
      })
      .catch(function () { card.remove(); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('page-content') || document.body;
    new MutationObserver(function () { install(); }).observe(root, { childList: true, subtree: true });
    install();
  });
})();
