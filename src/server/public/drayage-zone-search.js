(() => {
  function isZones() {
    return location.pathname.replace(/\/$/, '') === '/app/zones';
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function rows(root) {
    var table = one('table', root);
    if (!isZones() || !table) return [];
    return all('tbody tr', table).filter(function (row) { return row.querySelector('input'); });
  }

  function rowValue(row) {
    var typed = all('input', row).map(function (input) {
      if (input.type === 'checkbox') return input.checked ? 'enabled' : 'disabled';
      return input.value || '';
    }).join(' ');
    return ((row.textContent || '') + ' ' + typed).toLowerCase().replace(/\s+/g, ' ');
  }

  function countShown(list) {
    return list.filter(function (row) {
      return !row.classList.contains('qf-zone-search-hidden') && !row.classList.contains('qf-zone-hidden-by-filter');
    }).length;
  }

  function search(root, query) {
    var list = rows(root);
    var value = String(query || '').trim().toLowerCase();
    list.forEach(function (row) {
      row.classList.toggle('qf-zone-search-hidden', !!value && rowValue(row).indexOf(value) < 0);
    });
    var count = one('.qf-zone-search-count', root);
    if (count) count.textContent = countShown(list) + ' visible';
  }

  function mount() {
    var root = one('#page-content');
    if (!root || !isZones() || root.dataset.qfZoneSearch === '1') return;
    var table = one('table', root);
    var list = rows(root);
    if (!table || !list.length) return;

    root.dataset.qfZoneSearch = '1';
    root.classList.add('qf-zone-search-page');

    var section = document.createElement('section');
    section.className = 'qf-zone-searchbar';
    section.innerHTML = '<div><strong>Zone control</strong><span>Search by zone name, anchor, radius, amount, or status.</span></div><label><span>Search zones</span><input type="search" placeholder="Search zone, anchor, radius, amount…"></label><b class="qf-zone-search-count">' + list.length + ' visible</b>';

    var health = one('.qf-zone-health', root);
    if (health) health.insertAdjacentElement('afterend', section);
    else table.insertAdjacentElement('beforebegin', section);

    var input = one('input', section);
    input.addEventListener('input', function () { search(root, input.value); });
  }

  var observer = new MutationObserver(mount);
  window.addEventListener('load', function () {
    mount();
    var root = one('#page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
  });
  document.addEventListener('click', function () { setTimeout(mount, 50); }, true);
})();
