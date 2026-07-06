(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || '').split('/')[0];
  }

  function num(input) {
    const value = Number((input && input.value) || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function text(input) {
    return ((input && input.value) || '').trim();
  }

  function rows() {
    if (route() !== 'zones') return [];
    return Array.from(content.querySelectorAll('table tbody tr')).filter((tr) => tr.querySelector('input'));
  }

  function classify(tr) {
    const inputs = tr.querySelectorAll('input');
    const label = text(inputs[0]);
    const anchor = text(inputs[1]);
    const radius = num(inputs[2]);
    const price = num(inputs[3]);
    const enabled = inputs[4] ? inputs[4].checked : true;
    if (!enabled) return { key: 'disabled', label: 'Disabled' };
    if (!label || !anchor) return { key: 'missing-anchor', label: 'Missing anchor' };
    if (radius <= 0) return { key: 'needs-radius', label: 'Needs radius' };
    if (price <= 0) return { key: 'needs-price', label: 'Needs price' };
    return { key: 'ready', label: 'Ready' };
  }

  function clearRow(tr) {
    tr.classList.remove('qf-zone-needs-price', 'qf-zone-needs-radius', 'qf-zone-missing-anchor', 'qf-zone-disabled', 'qf-zone-ready');
    tr.querySelector('.qf-zone-status')?.remove();
  }

  function tagRow(tr) {
    clearRow(tr);
    const state = classify(tr);
    tr.classList.add('qf-zone-' + state.key);
    const firstCell = tr.querySelector('td');
    if (firstCell) {
      const tag = document.createElement('span');
      tag.className = 'qf-zone-status ' + state.key;
      tag.textContent = state.label;
      firstCell.appendChild(tag);
    }
    return state.key;
  }

  function stats() {
    const tally = { total: 0, ready: 0, 'needs-price': 0, 'needs-radius': 0, 'missing-anchor': 0, disabled: 0 };
    rows().forEach((tr) => {
      const key = tagRow(tr);
      tally.total += 1;
      tally[key] = (tally[key] || 0) + 1;
    });
    return tally;
  }

  function applyFilter(key) {
    rows().forEach((tr) => {
      const state = classify(tr).key;
      const show = key === 'all' || state === key || (key === 'needs-work' && state !== 'ready');
      tr.classList.toggle('qf-zone-hidden-by-filter', !show);
    });
    content.querySelectorAll('[data-zone-filter]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.zoneFilter === key));
  }

  function ensurePanel() {
    if (route() !== 'zones') return;
    const table = content.querySelector('table');
    if (!table || content.querySelector('.qf-zone-health')) return;
    const data = stats();
    const panel = document.createElement('section');
    panel.className = 'qf-zone-health';
    panel.innerHTML = `
      <div class="qf-zone-health-head">
        <div>
          <div class="qf-zone-health-kicker">Zone coverage</div>
          <h2>Drayage zone readiness</h2>
          <p>Scan zone coverage before publishing flat drayage pricing. Missing anchors, zero radius, and zero prices are the biggest quote blockers.</p>
        </div>
        <div class="qf-zone-health-actions">
          <button type="button" data-zone-filter="all" class="is-active">All</button>
          <button type="button" data-zone-filter="needs-work">Needs work</button>
          <button type="button" data-zone-filter="missing-anchor">Missing anchor</button>
          <button type="button" data-zone-filter="needs-price">Needs price</button>
          <button type="button" data-zone-filter="ready">Ready</button>
        </div>
      </div>
      <div class="qf-zone-health-grid">
        <div class="qf-zone-health-card"><span>Total zones</span><strong>${data.total}</strong></div>
        <div class="qf-zone-health-card"><span>Needs setup</span><strong>${data['missing-anchor'] + data['needs-radius'] + data['needs-price']}</strong></div>
        <div class="qf-zone-health-card"><span>Disabled</span><strong>${data.disabled}</strong></div>
        <div class="qf-zone-health-card"><span>Ready</span><strong>${data.ready}</strong></div>
      </div>`;
    panel.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-zone-filter]');
      if (btn) applyFilter(btn.dataset.zoneFilter);
    });
    table.parentNode.insertBefore(panel, table);

    const note = document.createElement('div');
    note.className = 'qf-zone-note';
    note.innerHTML = '<b>Coverage tip:</b> keep anchor port codes consistent and use nested radiuses carefully because the smallest matching zone wins.';
    table.parentNode.insertBefore(note, table.nextSibling);
  }

  function refresh() {
    if (route() !== 'zones') return;
    const panel = content.querySelector('.qf-zone-health');
    if (!panel) return ensurePanel();
    stats();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ensurePanel();
      refresh();
    }, 120);
  }).observe(content, { childList: true, subtree: true });

  setTimeout(ensurePanel, 500);
})();
