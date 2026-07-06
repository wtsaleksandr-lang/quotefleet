(() => {
  const PANEL_CLASS = 'qf-audit-polish';

  function classify(row) {
    const text = (row.textContent || '').toLowerCase();
    if (/ai_agent|ai agent|rate-chat|ingest|import/.test(text)) return 'ai';
    if (/auth|password|session|sign|login|logout|token|embed/.test(text)) return 'security';
    if (/rate|accessorial|zone|brand|config|profile|update|delete|create|apply/.test(text)) return 'change';
    return 'other';
  }

  function labelFor(type) {
    return {
      ai: 'AI / import',
      security: 'Security',
      change: 'Config change',
      other: 'Other',
    }[type] || 'Other';
  }

  function mount() {
    if (!location.pathname.startsWith('/app/audit')) return;
    const page = document.querySelector('#page-content');
    if (!page || page.querySelector(`.${PANEL_CLASS}`)) return;
    const subtitle = page.querySelector('.page-sub');
    const table = page.querySelector('table.table');
    if (!subtitle || !table) return;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (!rows.length) return;

    const counts = rows.reduce((acc, row) => {
      const type = classify(row);
      row.dataset.auditType = type;
      const actionCell = row.children[1];
      if (actionCell && !actionCell.querySelector('.qf-audit-tag')) {
        const tag = document.createElement('span');
        tag.className = `qf-audit-tag ${type}`;
        tag.textContent = labelFor(type);
        actionCell.appendChild(tag);
      }
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, { ai: 0, security: 0, change: 0, other: 0 });

    const panel = document.createElement('section');
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="qf-audit-head">
        <div>
          <h2>Audit activity scanner</h2>
          <p>Scan account, security, AI, and rate-book changes before troubleshooting customer-facing issues.</p>
        </div>
        <span class="qf-audit-status">${rows.length} events</span>
      </div>
      <div class="qf-audit-metrics">
        <button type="button" data-audit-filter="all"><strong>${rows.length}</strong><span>All events</span></button>
        <button type="button" data-audit-filter="security"><strong>${counts.security}</strong><span>Security</span></button>
        <button type="button" data-audit-filter="ai"><strong>${counts.ai}</strong><span>AI / import</span></button>
        <button type="button" data-audit-filter="change"><strong>${counts.change}</strong><span>Config changes</span></button>
      </div>
      <div class="qf-audit-tip">Audit rule: check security and token changes first, then AI/import changes, then manual rate-book edits.</div>
    `;

    panel.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-audit-filter]');
      if (!btn) return;
      const filter = btn.dataset.auditFilter;
      panel.querySelectorAll('[data-audit-filter]').forEach((item) => item.classList.toggle('active', item === btn));
      rows.forEach((row) => {
        row.hidden = filter !== 'all' && row.dataset.auditType !== filter;
      });
      table.classList.toggle('qf-audit-filtered', filter !== 'all');
    });

    subtitle.insertAdjacentElement('afterend', panel);
    panel.querySelector('[data-audit-filter="all"]')?.classList.add('active');
  }

  const observer = new MutationObserver(() => mount());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => setTimeout(mount, 0));
  document.addEventListener('click', () => setTimeout(mount, 0), true);
  mount();
})();