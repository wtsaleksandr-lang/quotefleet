(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function countJobs(status) {
    const rows = Array.from(content.querySelectorAll('table tbody tr'));
    if (!rows.length) return 0;
    return rows.filter((row) => {
      const text = row.textContent || '';
      if (status === 'all') return true;
      return text.includes(status);
    }).length;
  }

  function readinessPanel() {
    if (route() !== 'ingest' || content.querySelector('.qf-import-readiness')) return;
    const section = document.createElement('section');
    section.className = 'qf-import-readiness';
    section.innerHTML = `
      <div class="qf-import-readiness-top">
        <div>
          <div class="qf-import-kicker">AI import readiness</div>
          <h2>Review extracted pricing before it touches the rate book.</h2>
          <p>Use AI import for messy rate sheets, but treat every parsed item as a draft until price, service, equipment, and coverage are checked.</p>
        </div>
        <div class="qf-import-actions">
          <button type="button" data-import-filter="all">All uploads</button>
          <button type="button" data-import-filter="ready_for_review">Ready</button>
          <button type="button" data-import-filter="failed">Failed</button>
          <button type="button" data-import-go="ai">AI rules</button>
        </div>
      </div>
      <div class="qf-import-grid">
        <div class="qf-import-card"><span>Total uploads</span><strong data-import-count="all">0</strong></div>
        <div class="qf-import-card"><span>Ready to review</span><strong data-import-count="ready_for_review">0</strong></div>
        <div class="qf-import-card"><span>Parsing / waiting</span><strong data-import-count="parsing">0</strong></div>
        <div class="qf-import-card"><span>Needs attention</span><strong data-import-count="failed">0</strong></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-import-go]');
      if (nav) return go(nav.dataset.importGo);
      const filter = event.target.closest('[data-import-filter]');
      if (filter) applyUploadFilter(filter.dataset.importFilter, filter);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function checklist() {
    if (route() !== 'ingest' || content.querySelector('.qf-import-checklist')) return;
    const el = document.createElement('section');
    el.className = 'qf-import-checklist';
    el.innerHTML = `
      <div class="qf-import-step"><small>1</small><strong>Upload clean source</strong><span>Prefer a rate sheet with visible service names, equipment types, price columns, and effective notes.</span></div>
      <div class="qf-import-step"><small>2</small><strong>Check extracted items</strong><span>Untick anything vague, duplicated, missing price, or not ready for customers.</span></div>
      <div class="qf-import-step"><small>3</small><strong>Apply only reviewed data</strong><span>After applying, spot-check Rate cards, Accessorials, and Drayage zones before sharing the widget.</span></div>`;
    const panel = content.querySelector('.qf-import-readiness');
    if (panel && panel.nextSibling) panel.parentNode.insertBefore(el, panel.nextSibling);
  }

  function applyUploadFilter(status, button) {
    const rows = Array.from(content.querySelectorAll('table tbody tr'));
    rows.forEach((row) => {
      const text = row.textContent || '';
      row.hidden = status !== 'all' && !text.includes(status);
      row.classList.toggle('qf-import-row-focus', !row.hidden && status !== 'all');
    });
    content.querySelectorAll('[data-import-filter]').forEach((btn) => btn.classList.toggle('is-active', btn === button));
  }

  function updateCounts() {
    if (route() !== 'ingest') return;
    content.querySelectorAll('[data-import-count]').forEach((node) => {
      node.textContent = String(countJobs(node.dataset.importCount));
    });
  }

  function safeApplyNote() {
    if (route() !== 'ingest' || content.querySelector('.qf-import-safe-apply')) return;
    const review = document.getElementById('ingest-review');
    if (!review || !review.textContent.includes('Apply selected')) return;
    const note = document.createElement('div');
    note.className = 'qf-import-safe-apply';
    note.innerHTML = '<b>Before applying:</b> confirm missing prices, duplicate accessorials, lane radius, equipment type, and whether each imported item should be customer-visible.';
    const actionBtn = Array.from(review.querySelectorAll('button')).find((btn) => (btn.textContent || '').includes('Apply selected'));
    if (actionBtn && actionBtn.parentElement) actionBtn.parentElement.parentElement.insertBefore(note, actionBtn.parentElement);
  }

  function enhance() {
    if (route() !== 'ingest') return;
    readinessPanel();
    checklist();
    updateCounts();
    safeApplyNote();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: true });
  setTimeout(enhance, 500);
})();
