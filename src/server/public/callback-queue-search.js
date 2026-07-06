(() => {
  function isCallbacks() {
    return location.pathname.replace(/\/$/, '') === '/app/callbacks';
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function rows(root) {
    if (!isCallbacks()) return [];
    var table = one('table.table', root);
    if (!table) return [];
    return all('tbody tr', table).filter(function (row) { return row.children.length >= 6; });
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase().replace(/\s+/g, ' ');
  }

  function visibleCount(list) {
    return list.filter(function (row) { return !row.classList.contains('qf-callback-search-hidden'); }).length;
  }

  function applySearch(root, query) {
    var list = rows(root);
    var value = String(query || '').trim().toLowerCase();
    list.forEach(function (row) {
      var show = !value || rowText(row).indexOf(value) >= 0;
      row.classList.toggle('qf-callback-search-hidden', !show);
    });
    var count = one('.qf-callback-search-count', root);
    if (count) count.textContent = visibleCount(list) + ' visible';
    var empty = one('.qf-callback-search-empty', root);
    if (!visibleCount(list) && value) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'qf-callback-search-empty';
        var bar = one('.qf-callback-searchbar', root);
        if (bar) bar.insertAdjacentElement('afterend', empty);
      }
      empty.textContent = 'No callback requests found for “' + value + '”.';
    } else if (empty) {
      empty.remove();
    }
  }

  function mount() {
    if (!isCallbacks()) return;
    var root = one('#page-content');
    if (!root || root.dataset.qfCallbackSearch === '1') return;
    var table = one('table.table', root);
    var list = rows(root);
    if (!table || !list.length) return;

    root.dataset.qfCallbackSearch = '1';
    root.classList.add('qf-callback-search-page');

    var section = document.createElement('section');
    section.className = 'qf-callback-searchbar';
    section.innerHTML = '<div><strong>Callback control</strong><span>Search by customer, phone, quote, topic, status, or time.</span></div><label><span>Search callbacks</span><input type="search" placeholder="Search customer, phone, quote, status…"></label><b class="qf-callback-search-count">' + list.length + ' visible</b>';

    var plan = one('.qf-callback-plan', root);
    if (plan) plan.insertAdjacentElement('afterend', section);
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
