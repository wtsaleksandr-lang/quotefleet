(() => {
  function isLeadsList() {
    return location.pathname.replace(/\/$/, '') === '/app/leads';
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function rows(root) {
    if (!isLeadsList()) return [];
    var table = one('table.table', root);
    if (!table) return [];
    return all('tbody tr', table).filter(function (row) { return row.children.length >= 7; });
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase().replace(/\s+/g, ' ');
  }

  function countVisible(list) {
    return list.filter(function (row) { return row.style.display !== 'none' && !row.classList.contains('qf-lead-search-hidden'); }).length;
  }

  function applySearch(root, query) {
    var list = rows(root);
    var value = String(query || '').trim().toLowerCase();
    list.forEach(function (row) {
      var show = !value || rowText(row).indexOf(value) >= 0;
      row.classList.toggle('qf-lead-search-hidden', !show);
    });
    var count = one('.qf-lead-search-count', root);
    if (count) count.textContent = countVisible(list) + ' visible';
    var empty = one('.qf-lead-search-empty', root);
    if (!countVisible(list) && value) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'qf-lead-search-empty';
        var toolbar = one('.qf-lead-searchbar', root);
        if (toolbar) toolbar.insertAdjacentElement('afterend', empty);
      }
      empty.textContent = 'No leads found for “' + value + '”.';
    } else if (empty) {
      empty.remove();
    }
  }

  function mount() {
    if (!isLeadsList()) return;
    var root = one('#page-content');
    if (!root || root.dataset.qfLeadSearch === '1') return;
    var table = one('table.table', root);
    var list = rows(root);
    if (!table || !list.length) return;

    root.dataset.qfLeadSearch = '1';
    root.classList.add('qf-lead-queue-polish');

    var wrap = document.createElement('section');
    wrap.className = 'qf-lead-searchbar';
    wrap.innerHTML = '<div><strong>Lead queue control</strong><span>Search by ref, customer, service, lane, status, or amount.</span></div><label><span>Search leads</span><input type="search" placeholder="Search ref, company, lane, status…"></label><b class="qf-lead-search-count">' + list.length + ' visible</b>';

    var toolbar = one('.qf-leads-toolbar', root);
    if (toolbar) toolbar.insertAdjacentElement('beforebegin', wrap);
    else table.insertAdjacentElement('beforebegin', wrap);

    var input = one('input', wrap);
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
