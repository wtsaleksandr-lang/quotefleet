(function () {
  'use strict';
  function fmt(value) {
    if (!value) return '—';
    var d = new Date(value);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }
  function refFromPath() {
    var m = location.pathname.match(/\/app\/leads\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function row(label, value) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--border);padding:8px 0;"><span class="muted-small">' + label + '</span><strong style="font-size:13px;">' + value + '</strong></div>';
  }
  function render(refId, data) {
    var page = document.getElementById('page-content');
    if (!page || page.querySelector('[data-qf-events]')) return;
    var anchor = page.querySelector('.qf-quote-actions') || page.querySelector('h1');
    if (!anchor) return;
    var s = data.summary || {};
    var counts = s.counts || {};
    var card = document.createElement('div');
    card.className = 'card';
    card.dataset.qfEvents = '1';
    card.style.marginTop = '14px';
    card.innerHTML = '<div class="card-title">Quote activity</div>' +
      '<div class="card-subtitle">Hosted quote actions for ' + refId + '.</div>' +
      row('Viewed quote', s.viewed ? 'Yes · ' + (counts.view || 0) + 'x' : 'No') +
      row('Last viewed', fmt(s.lastViewedAt)) +
      row('Copied link', s.copied ? 'Yes' : 'No') +
      row('PDF saved', s.pdfSaved ? 'Yes' : 'No') +
      row('Chat opened', s.chatOpened ? 'Yes' : 'No') +
      row('Callback requested', s.callbackRequested ? 'Yes' : 'No');
    anchor.insertAdjacentElement('afterend', card);
  }
  function run() {
    var refId = refFromPath();
    if (!refId) return;
    var page = document.getElementById('page-content');
    if (!page || page.querySelector('[data-qf-events]')) return;
    fetch('/api/tenant/quote-activity/' + encodeURIComponent(refId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) render(refId, data); })
      .catch(function () {});
  }
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('page-content') || document.body;
    new MutationObserver(function () { run(); }).observe(root, { childList: true, subtree: true });
    run();
  });
})();
