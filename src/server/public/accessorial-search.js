(() => {
  function isAccessorials() {
    var h1 = document.querySelector('#page-content h1');
    return !!h1 && /accessorials/i.test(h1.textContent || '');
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function rows(root) {
    if (!isAccessorials()) return [];
    var table = one('table', root);
    if (!table) return [];
    return all('tbody tr', table).filter(function (row) { return row.children.length > 0; });
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase().replace(/\s+/g, ' ');
  }

  function visibleCount(list) {
    return list.filter(function (row) { return !row.classList.contains('qf-accessorial-search-hidden') && row.style.display !== 'none'; }).length;
  }

  function applySearch(root, query) {
    var list = rows(root);
    var value = String(query || '').trim().toLowerCase();
    list.forEach(function (row) {
      var show = !value || rowText(row).indexOf(value) >= 0;
      row.classList.toggle('qf-accessorial-search-hidden', !show);
    });
    var count = one('.qf-accessorial-search-count', root);
    if (count) count.textContent = visibleCount(list) + ' visible';
    var empty = one('.qf-accessorial-search-empty', root);
    if (!visibleCount(list) && value) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'qf-accessorial-search-empty';
        var bar = one('.qf-accessorial-searchbar', root);
        if (bar) bar.insertAdjacentElement('afterend', empty);
      }
      empty.textContent = 'No accessorial charges found for “' + value + '”.';
    } else if (empty) {
      empty.remove();
    }
  }

  function mount() {
    var root = one('#page-content');
    if (!root || !isAccessorials() || root.dataset.qfAccessorialSearch === '1') return;
    var table = one('table', root);
    var list = rows(root);
    if (!table || !list.length) return;

    root.dataset.qfAccessorialSearch = '1';
    root.classList.add('qf-accessorial-search-page');

    var section = document.createElement('section');
    section.className = 'qf-accessorial-searchbar';
    section.innerHTML = '<div><strong>Accessorial control</strong><span>Search by charge name, service type, amount, status, or setup note.</span></div><label><span>Search charges</span><input type="search" placeholder="Search chassis, detention, liftgate, hazmat…"></label><b class="qf-accessorial-search-count">' + list.length + ' visible</b>';

    var tools = one('.qf-acc-tools', root);
    if (tools) tools.insertAdjacentElement('afterend', section);
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
