(() => {
  function isOverview() {
    return location.pathname === '/app' || location.pathname === '/app/' || location.pathname === '/app/overview';
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function cleanText(node) {
    return (node && node.textContent ? node.textContent : '').trim();
  }

  function statIcon(label) {
    var value = String(label || '').toLowerCase();
    if (value.indexOf('new') >= 0) return '↗';
    if (value.indexOf('won') >= 0) return '✓';
    if (value.indexOf('avg') >= 0) return '$';
    return '●';
  }

  function enhanceStats(stats) {
    stats.classList.add('qf-overview-stat-grid');
    all('.feature', stats).forEach(function (card) {
      if (card.dataset.qfExecutiveStat === '1') return;
      var label = cleanText(one('.muted-small', card));
      card.dataset.qfExecutiveStat = '1';
      card.classList.add('qf-overview-stat');
      var icon = document.createElement('span');
      icon.className = 'qf-overview-stat-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = statIcon(label);
      card.insertAdjacentElement('afterbegin', icon);
      if (label.toLowerCase().indexOf('new') >= 0) card.dataset.qfTone = 'attention';
      if (label.toLowerCase().indexOf('won') >= 0) card.dataset.qfTone = 'success';
      if (label.toLowerCase().indexOf('avg') >= 0) card.dataset.qfTone = 'money';
    });
  }

  function mount() {
    if (!isOverview()) return;
    var root = one('#page-content');
    if (!root || root.dataset.qfExecutiveOverview === '1') return;
    var title = one('h1', root);
    var subtitle = one('.page-sub', root);
    var stats = one('.features', root);
    if (!title || !subtitle || !stats) return;

    root.dataset.qfExecutiveOverview = '1';
    root.classList.add('qf-overview-executive');
    enhanceStats(stats);

    var hero = document.createElement('section');
    hero.className = 'qf-overview-hero';
    hero.innerHTML = '<div class="qf-overview-hero-copy"><span>Freight quote command center</span><strong>' +
      (cleanText(title) || 'Overview') + '</strong><p>' +
      (cleanText(subtitle) || 'Track quote activity, lead follow-up, and setup readiness from one place.') +
      '</p></div><div class="qf-overview-hero-actions"><a class="btn btn-primary" href="/app/leads" data-route="leads">Review leads</a><a class="btn btn-secondary" href="/app/embed" data-route="embed">Install widget</a><a class="btn btn-ghost" href="/">View public widget</a></div>';

    title.classList.add('qf-overview-original-title');
    subtitle.classList.add('qf-overview-original-subtitle');
    stats.insertAdjacentElement('beforebegin', hero);
  }

  var observer = new MutationObserver(mount);
  window.addEventListener('load', function () {
    mount();
    var root = one('#page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
  });
  document.addEventListener('click', function () { setTimeout(mount, 40); }, true);
  window.addEventListener('popstate', function () { setTimeout(mount, 40); });
})();
