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
  function yesNo(value, detail) {
    return value ? 'Yes' + (detail ? ' · ' + detail : '') : 'No';
  }
  function nextAction(summary) {
    var counts = summary.counts || {};
    if (summary.callbackRequested) return ['Call requested', 'Customer asked for a callback. Call first, then update the quote status.'];
    if (summary.chatOpened) return ['Review chat', 'Customer opened chat. Check if the AI conversation needs a human reply.'];
    if (summary.pdfSaved) return ['Follow PDF', 'Customer saved the PDF. Follow up while the quote is fresh.'];
    if (summary.viewed || counts.view) return ['Send follow-up', 'Quote was opened. Send a short follow-up or confirm the lane details.'];
    if (summary.copied) return ['Watch shared link', 'Quote link was copied. Wait for opens or send a reminder.'];
    return ['No customer signal yet', 'Use the hosted quote link or PDF action to create the next touchpoint.'];
  }
  function timeline(summary) {
    var counts = summary.counts || {};
    var items = [
      ['Viewed quote', yesNo(summary.viewed || counts.view, (counts.view || 0) + 'x'), summary.lastViewedAt],
      ['Copied link', yesNo(summary.copied), summary.lastCopiedAt],
      ['PDF saved', yesNo(summary.pdfSaved), summary.lastPdfSavedAt],
      ['Chat opened', yesNo(summary.chatOpened), summary.lastChatOpenedAt],
      ['Callback requested', yesNo(summary.callbackRequested), summary.lastCallbackRequestedAt]
    ];
    return items.map(function (item) {
      var active = !/^No$/.test(item[1]);
      return '<div class="qf-activity-step ' + (active ? 'is-active' : '') + '">' +
        '<span aria-hidden="true"></span><div><strong>' + item[0] + '</strong><small>' + item[1] + '</small></div><em>' + fmt(item[2]) + '</em>' +
      '</div>';
    }).join('');
  }
  function render(refId, data) {
    var page = document.getElementById('page-content');
    if (!page || page.querySelector('[data-qf-events]')) return;
    var anchor = page.querySelector('.qf-quote-actions') || page.querySelector('h1');
    if (!anchor) return;
    var s = data.summary || {};
    var action = nextAction(s);
    var card = document.createElement('section');
    card.className = 'card qf-activity-card';
    card.dataset.qfEvents = '1';
    card.innerHTML = '<div class="qf-activity-head"><div><div class="card-title">Quote activity</div>' +
      '<div class="card-subtitle">Hosted quote actions for ' + refId + '.</div></div>' +
      '<div class="qf-activity-status"><span>Next action</span><strong>' + action[0] + '</strong></div></div>' +
      '<div class="qf-activity-next"><b>' + action[0] + '</b><p>' + action[1] + '</p></div>' +
      '<div class="qf-activity-timeline">' + timeline(s) + '</div>';
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
