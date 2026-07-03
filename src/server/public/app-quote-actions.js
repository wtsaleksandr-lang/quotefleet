(function () {
  'use strict';

  function quoteUrl(refId) {
    return '/quote/' + encodeURIComponent(refId);
  }
  function chatUrl(refId) {
    return '/chat/' + encodeURIComponent(refId);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    window.prompt('Copy link:', text);
    return Promise.resolve();
  }
  function looksLikeRef(text) {
    return /^QF[-A-Z0-9_]+/i.test(String(text || '').trim());
  }

  function enhanceLeadDetail() {
    var path = location.pathname;
    var m = path.match(/\/app\/leads\/([^/?#]+)/);
    if (!m) return;
    var refId = decodeURIComponent(m[1]);
    var page = document.getElementById('page-content');
    if (!page || page.querySelector('.qf-quote-actions')) return;
    var h1 = page.querySelector('h1');
    if (!h1 || !looksLikeRef(h1.textContent)) return;

    var url = location.origin + quoteUrl(refId);
    var bar = document.createElement('div');
    bar.className = 'qf-quote-actions';
    bar.innerHTML = '' +
      '<a class="primary" target="_blank" rel="noopener" href="' + quoteUrl(refId) + '">Open hosted quote</a>' +
      '<a target="_blank" rel="noopener" href="' + chatUrl(refId) + '">Open customer chat</a>' +
      '<button type="button">Copy quote link</button>';
    bar.querySelector('button').addEventListener('click', function () {
      copyText(url).then(function () {
        if (window.qfToastOk) window.qfToastOk('Quote link copied');
      });
    });
    h1.insertAdjacentElement('afterend', bar);
  }

  function enhanceLeadTables() {
    var page = document.getElementById('page-content');
    if (!page) return;
    var links = page.querySelectorAll('a[href^="/app/leads/"]');
    links.forEach(function (leadLink) {
      var refId = decodeURIComponent((leadLink.getAttribute('href') || '').split('/app/leads/')[1] || '').trim();
      if (!refId || leadLink.parentElement.querySelector('.qf-mini-quote-link')) return;
      var mini = document.createElement('a');
      mini.href = quoteUrl(refId);
      mini.target = '_blank';
      mini.rel = 'noopener';
      mini.className = 'qf-mini-quote-link';
      mini.textContent = 'Hosted quote';
      mini.addEventListener('click', function (e) { e.stopPropagation(); });
      leadLink.parentElement.appendChild(document.createElement('br'));
      leadLink.parentElement.appendChild(mini);
    });

    page.querySelectorAll('tbody tr').forEach(function (row) {
      var first = row.children && row.children[0];
      if (!first || first.querySelector('.qf-mini-quote-link')) return;
      var refText = (first.textContent || '').trim().split(/\s+/)[0];
      if (!looksLikeRef(refText)) return;
      var mini = document.createElement('a');
      mini.href = quoteUrl(refText);
      mini.target = '_blank';
      mini.rel = 'noopener';
      mini.className = 'qf-mini-quote-link';
      mini.textContent = 'Hosted quote';
      mini.addEventListener('click', function (e) { e.stopPropagation(); });
      first.appendChild(document.createElement('br'));
      first.appendChild(mini);
    });
  }

  function run() {
    enhanceLeadDetail();
    enhanceLeadTables();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('page-content') || document.body;
    var obs = new MutationObserver(function () { run(); });
    obs.observe(root, { childList: true, subtree: true });
    run();
  });
})();
