(() => {
  const routeMatches = () => /^\/app\/?(?:overview)?$/.test(location.pathname) || location.pathname === '/app/overview';

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function safeText(node) {
    return (node?.textContent || '').trim();
  }

  function statusTone(status) {
    const value = String(status || '').toLowerCase();
    if (/new|draft|replied/.test(value)) return 'open';
    if (/won/.test(value)) return 'won';
    if (/lost|spam/.test(value)) return 'risk';
    return 'neutral';
  }

  function getOverviewBits(root) {
    const headings = qsa('h2', root);
    const leadsHeading = headings.find((heading) => safeText(heading).toLowerCase() === 'recent leads');
    const auditHeading = headings.find((heading) => safeText(heading).toLowerCase() === 'recent ai / manual edits');
    const leadsTable = leadsHeading ? leadsHeading.nextElementSibling : null;
    const auditCard = auditHeading ? auditHeading.nextElementSibling : null;
    return { leadsHeading, auditHeading, leadsTable, auditCard };
  }

  function buildActionQueue(root, leadsTable, auditCard) {
    const leadRows = leadsTable?.matches('table') ? qsa('tbody tr', leadsTable) : [];
    const auditRows = auditCard?.classList.contains('card') ? qsa('.card-row', auditCard) : [];
    const newRows = leadRows.filter((row) => /new|draft|replied/i.test(safeText(row)));
    const aiRows = auditRows.filter((row) => /ai_agent|ai/i.test(safeText(row)));
    const riskRows = leadRows.filter((row) => /lost|spam/i.test(safeText(row)));

    const panel = document.createElement('section');
    panel.className = 'qf-overview-command';
    panel.setAttribute('aria-label', 'Overview action queue');
    panel.innerHTML = `
      <div>
        <p class="qf-command-eyebrow">Command center</p>
        <h2>Today’s operating queue</h2>
        <p>Recent leads and edit activity are now grouped so dispatch can see what needs action first.</p>
      </div>
      <div class="qf-command-metrics">
        <button type="button" data-qf-overview-filter="open"><strong>${newRows.length}</strong><span>Open leads</span></button>
        <button type="button" data-qf-overview-filter="ai"><strong>${aiRows.length}</strong><span>AI edits</span></button>
        <button type="button" data-qf-overview-filter="risk"><strong>${riskRows.length}</strong><span>Risk rows</span></button>
      </div>
    `;

    panel.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-qf-overview-filter]');
      if (!btn) return;
      const mode = btn.dataset.qfOverviewFilter;
      root.classList.remove('qf-overview-filter-open', 'qf-overview-filter-ai', 'qf-overview-filter-risk');
      qsa('[data-qf-overview-filter]', panel).forEach((item) => item.classList.toggle('is-active', item === btn));
      root.classList.add(`qf-overview-filter-${mode}`);
    });

    leadRows.forEach((row) => row.dataset.qfStatusTone = statusTone(safeText(row)));
    auditRows.forEach((row) => row.dataset.qfAuditTone = /ai_agent|ai/i.test(safeText(row)) ? 'ai' : 'manual');
    return panel;
  }

  function enhanceOverview() {
    if (!routeMatches()) return;
    const root = qs('#page-content');
    if (!root || root.dataset.qfOverviewCommand === '1') return;
    const { leadsHeading, auditHeading, leadsTable, auditCard } = getOverviewBits(root);
    if (!leadsHeading || !auditHeading || !leadsTable || !auditCard) return;

    root.dataset.qfOverviewCommand = '1';
    root.classList.add('qf-overview-polish');

    const command = buildActionQueue(root, leadsTable, auditCard);
    const stats = qs('.features', root);
    if (stats) stats.insertAdjacentElement('afterend', command);

    const grid = document.createElement('section');
    grid.className = 'qf-overview-workgrid';
    const leadsPanel = document.createElement('div');
    leadsPanel.className = 'qf-overview-panel qf-overview-leads';
    const auditPanel = document.createElement('div');
    auditPanel.className = 'qf-overview-panel qf-overview-audit';

    leadsHeading.parentNode.insertBefore(grid, leadsHeading);
    grid.appendChild(leadsPanel);
    grid.appendChild(auditPanel);
    leadsPanel.appendChild(leadsHeading);
    leadsPanel.appendChild(leadsTable);
    auditPanel.appendChild(auditHeading);
    auditPanel.appendChild(auditCard);

    if (leadsTable.matches('table')) leadsTable.classList.add('qf-overview-lead-table');
    if (auditCard.classList.contains('card')) auditCard.classList.add('qf-overview-audit-card');
  }

  const observer = new MutationObserver(() => enhanceOverview());
  window.addEventListener('load', () => {
    enhanceOverview();
    const root = qs('#page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
  });
  window.addEventListener('popstate', () => setTimeout(enhanceOverview, 50));
  document.addEventListener('click', () => setTimeout(enhanceOverview, 50), true);
})();
