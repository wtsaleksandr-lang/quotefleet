(() => {
  function isRates() {
    return location.pathname.replace(/\/$/, '') === '/app/rates';
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function rows(root) {
    if (!isRates()) return [];
    var table = one('table.table', root);
    if (!table) return [];
    return all('tbody tr', table).filter(function (row) { return row.children.length > 0; });
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase().replace(/\s+/g, ' ');
  }

  function visibleCount(list) {
    return list.filter(function (row) { return !row.classList.contains('qf-rate-search-hidden') && !row.hidden; }).length;
  }

  function applySearch(root, query) {
    var list = rows(root);
    var value = String(query || '').trim().toLowerCase();
    list.forEach(function (row) {
      var show = !value || rowText(row).indexOf(value) >= 0;
      row.classList.toggle('qf-rate-search-hidden', !show);
    });
    var count = one('.qf-rate-search-count', root);
    if (count) count.textContent = visibleCount(list) + ' visible';
    var empty = one('.qf-rate-search-empty', root);
    if (!visibleCount(list) && value) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'qf-rate-search-empty';
        var bar = one('.qf-rate-searchbar', root);
        if (bar) bar.insertAdjacentElement('afterend', empty);
      }
      empty.textContent = 'No rate cards found for “' + value + '”.';
    } else if (empty) {
      empty.remove();
    }
  }

  function mount() {
    if (!isRates()) return;
    var root = one('#page-content');
    if (!root || root.dataset.qfRateSearch === '1') return;
    var table = one('table.table', root);
    var list = rows(root);
    if (!table || !list.length) return;

    root.dataset.qfRateSearch = '1';
    root.classList.add('qf-rate-card-search-page');

    var section = document.createElement('section');
    section.className = 'qf-rate-searchbar';
    section.innerHTML = '<div><strong>Rate card control</strong><span>Search by service, equipment, lane, status, price, or notes.</span></div><label><span>Search rate cards</span><input type="search" placeholder="Search service, lane, equipment, price…"></label><b class="qf-rate-search-count">' + list.length + ' visible</b>';

    var scan = one('.qf-rate-scan', root);
    if (scan) scan.insertAdjacentElement('afterend', section);
    else table.insertAdjacentElement('beforebegin', section);

    var input = one('input', section);
    input.addEventListener('input', function () { applySearch(root, input.value); });
  }

  var observer = new MutationObserver(mount);
  window.addEventListener('load', function () {
    mount();
    var root = one('#page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
  });
  document.addEventListener('click', function () { setTimeout(mount, 50); }, true);
  window.addEventListener('popstate', function () { setTimeout(mount, 50); });
})();
