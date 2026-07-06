(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function isLeadsList() {
    return location.pathname.replace(/\/$/, '') === '/app/leads';
  }

  function moneyNumber(text) {
    const n = Number(String(text || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function rows() {
    if (!isLeadsList()) return [];
    const table = content.querySelector('table.table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr')).filter((row) => row.children.length >= 7);
  }

  function rowData(row) {
    const status = (row.children[5]?.textContent || '').trim().toLowerCase();
    const total = moneyNumber(row.children[4]?.textContent || '');
    const created = Date.parse(row.children[6]?.textContent || '');
    const ageHours = Number.isFinite(created) ? (Date.now() - created) / 36e5 : null;
    const customer = (row.children[1]?.textContent || '').trim();
    const needsAttention = ['new', 'draft', 'replied'].includes(status);
    const hot = needsAttention || total >= 1000 || (ageHours !== null && ageHours <= 24);
    return { status, total, ageHours, customer, needsAttention, hot };
  }

  function labelFor(filter) {
    return ({ all: 'All', attention: 'Needs attention', high: '$1k+', recent: 'Last 24h', won: 'Won', lost: 'Lost' })[filter] || filter;
  }

  function matches(data, filter) {
    if (filter === 'attention') return data.needsAttention;
    if (filter === 'high') return data.total >= 1000;
    if (filter === 'recent') return data.ageHours !== null && data.ageHours <= 24;
    if (filter === 'won') return data.status === 'won';
    if (filter === 'lost') return data.status === 'lost';
    return true;
  }

  function addFocus(allRows) {
    if (content.querySelector('.qf-leads-focus')) return;
    const data = allRows.map(rowData);
    const attention = data.filter((d) => d.needsAttention).length;
    const high = data.filter((d) => d.total >= 1000).length;
    const recent = data.filter((d) => d.ageHours !== null && d.ageHours <= 24).length;
    const won = data.filter((d) => d.status === 'won').length;

    const panel = document.createElement('section');
    panel.className = 'qf-leads-focus';
    panel.innerHTML = `
      <div class="qf-leads-focus-head">
        <div>
          <div class="qf-leads-focus-kicker">Lead queue</div>
          <h2>Work the hottest leads first</h2>
          <p>Use this as the daily dispatch view: new quotes, high-value lanes, recent activity, and wins.</p>
        </div>
        <button type="button" data-qf-filter="attention">Show attention</button>
      </div>
      <div class="qf-leads-focus-grid">
        <div class="qf-leads-focus-card"><span>Needs attention</span><strong>${attention}</strong><b>new / draft / replied</b></div>
        <div class="qf-leads-focus-card"><span>High value</span><strong>${high}</strong><b>$1,000+ quotes</b></div>
        <div class="qf-leads-focus-card"><span>Recent</span><strong>${recent}</strong><b>created in 24h</b></div>
        <div class="qf-leads-focus-card"><span>Won</span><strong>${won}</strong><b>closed revenue</b></div>
      </div>`;
    const sub = content.querySelector('.page-sub');
    if (sub?.nextSibling) sub.parentNode.insertBefore(panel, sub.nextSibling);
    else content.prepend(panel);
  }

  function addToolbar(table, allRows) {
    if (content.querySelector('.qf-leads-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'qf-leads-toolbar';
    ['all', 'attention', 'high', 'recent', 'won', 'lost'].forEach((filter) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qf-leads-filter' + (filter === 'all' ? ' is-active' : '');
      btn.dataset.qfFilter = filter;
      btn.textContent = labelFor(filter);
      bar.appendChild(btn);
    });
    table.parentNode.insertBefore(bar, table);
    bar.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-qf-filter]');
      if (!btn) return;
      applyFilter(btn.dataset.qfFilter, allRows);
    });
  }

  function applyFilter(filter, allRows) {
    content.querySelectorAll('.qf-leads-filter').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.qfFilter === filter);
    });
    let visible = 0;
    allRows.forEach((row) => {
      const show = matches(rowData(row), filter);
      row.classList.toggle('qf-lead-hidden', !show);
      if (show) visible += 1;
    });
    let empty = content.querySelector('.qf-leads-empty-filter');
    if (!visible) {
      if (!empty) {
        empty = document.createElement('div');
        empty.className = 'qf-leads-empty-filter';
        content.querySelector('.qf-leads-toolbar')?.after(empty);
      }
      empty.textContent = 'No leads match “' + labelFor(filter) + '” right now.';
    } else if (empty) {
      empty.remove();
    }
  }

  function markRows(allRows) {
    allRows.forEach((row) => {
      const data = rowData(row);
      row.classList.toggle('qf-lead-hot-row', data.hot);
      row.title = data.hot ? 'Priority lead: review next action' : 'Open lead';
    });
  }

  function enhance() {
    const allRows = rows();
    if (!allRows.length) return;
    const table = content.querySelector('table.table');
    addFocus(allRows);
    addToolbar(table, allRows);
    markRows(allRows);
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
