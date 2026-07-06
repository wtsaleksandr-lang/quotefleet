(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function rows() {
    return Array.from(content.querySelectorAll('tbody tr'));
  }

  function rowText(row) {
    return (row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function hasMoney(row) {
    return /\$\s?\d|cad\s?\d|usd\s?\d|\d+\.\d{2}/i.test(row.textContent || '');
  }

  function isDisabled(row) {
    return /inactive|disabled|draft|hidden|paused|off/i.test(row.textContent || '');
  }

  function hasSetupGap(row) {
    const text = rowText(row);
    if (!text) return false;
    return !hasMoney(row) || /missing|incomplete|blank|not set|tbd|todo/i.test(text);
  }

  function tableWrap() {
    const table = content.querySelector('.table');
    if (!table || table.closest('.qf-rate-table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'qf-rate-table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }

  function detectServiceTypes() {
    const text = rows().map((tr) => tr.textContent || '').join(' ').toLowerCase();
    const types = [];
    if (text.includes('drayage')) types.push('Drayage');
    if (text.includes('ftl')) types.push('FTL');
    if (text.includes('ltl')) types.push('LTL');
    if (text.includes('reefer')) types.push('Reefer');
    if (text.includes('hazmat')) types.push('Hazmat');
    return types.length ? types.join(', ') : 'Add service types';
  }

  function scanStats() {
    const list = rows();
    const disabled = list.filter(isDisabled).length;
    const gaps = list.filter((row) => !isDisabled(row) && hasSetupGap(row)).length;
    const ready = Math.max(0, list.length - disabled - gaps);
    return { total: list.length, disabled, gaps, ready };
  }

  function hero() {
    if (route() !== 'rates' || content.querySelector('.qf-builder-hero')) return;
    const count = rows().length;
    const built = count > 0;
    const card = document.createElement('section');
    card.className = 'qf-builder-hero';
    card.innerHTML = `
      <div class="qf-builder-hero-top">
        <div>
          <div class="qf-builder-kicker">Rate builder</div>
          <h2>${built ? 'Your calculator has rate cards.' : 'Start with one simple rate card.'}</h2>
          <p>${built ? 'Keep common services organized so customers can check rates without waiting for a manual email.' : 'Add the service you quote most often first. You can add lanes, equipment, and extra rules later.'}</p>
        </div>
        <div class="qf-builder-actions">
          <button type="button" data-rate-go="accessorials">Add charges</button>
          <button type="button" data-rate-go="zones">Add zones</button>
          <button type="button" data-rate-go="embed">Share calculator</button>
        </div>
      </div>
      <div class="qf-builder-stats">
        <div class="qf-builder-stat"><span>Rate cards</span><strong>${count}</strong></div>
        <div class="qf-builder-stat"><span>Services detected</span><strong>${detectServiceTypes()}</strong></div>
        <div class="qf-builder-stat"><span>Next setup</span><strong>${built ? 'Charges' : 'Base rate'}</strong></div>
        <div class="qf-builder-stat"><span>Customer output</span><strong>PDF + link</strong></div>
      </div>`;
    card.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-rate-go]');
      if (btn) go(btn.dataset.rateGo);
    });
    const h1 = content.querySelector('h1');
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(card, sub.nextSibling);
    else if (h1 && h1.nextSibling) h1.parentNode.insertBefore(card, h1.nextSibling);
    else content.prepend(card);
  }

  function guide() {
    if (route() !== 'rates' || content.querySelector('.qf-builder-guide')) return;
    const card = document.createElement('section');
    card.className = 'qf-builder-guide';
    card.innerHTML = `
      <strong>Simple setup path</strong>
      <ol>
        <li data-step="1">Add your base service and rate.</li>
        <li data-step="2">Add common extra charges.</li>
        <li data-step="3">Preview and share your customer calculator.</li>
      </ol>`;
    const heroCard = content.querySelector('.qf-builder-hero');
    if (heroCard && heroCard.nextSibling) heroCard.parentNode.insertBefore(card, heroCard.nextSibling);
  }

  function scanPanel() {
    if (route() !== 'rates' || content.querySelector('.qf-rate-scan')) return;
    const stats = scanStats();
    const card = document.createElement('section');
    card.className = 'qf-rate-scan';
    card.innerHTML = `
      <div>
        <div class="qf-builder-kicker">Rate health</div>
        <h3>Scan pricing gaps before sharing.</h3>
        <p>Use this as a quick checklist for cards that still need a base price, extra charges, or visibility review.</p>
      </div>
      <div class="qf-rate-scan-stats">
        <button type="button" data-rate-scan="all"><span>Total</span><strong>${stats.total}</strong></button>
        <button type="button" data-rate-scan="gap"><span>Needs price</span><strong>${stats.gaps}</strong></button>
        <button type="button" data-rate-scan="disabled"><span>Disabled/draft</span><strong>${stats.disabled}</strong></button>
        <button type="button" data-rate-scan="ready"><span>Looks ready</span><strong>${stats.ready}</strong></button>
      </div>`;
    card.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-rate-scan]');
      if (!btn) return;
      filterRows(btn.dataset.rateScan);
    });
    const guideCard = content.querySelector('.qf-builder-guide');
    if (guideCard && guideCard.nextSibling) guideCard.parentNode.insertBefore(card, guideCard.nextSibling);
  }

  function decorateRows() {
    rows().forEach((row) => {
      row.classList.remove('qf-rate-row-gap', 'qf-rate-row-disabled', 'qf-rate-row-ready');
      const disabled = isDisabled(row);
      const gap = !disabled && hasSetupGap(row);
      row.classList.add(disabled ? 'qf-rate-row-disabled' : gap ? 'qf-rate-row-gap' : 'qf-rate-row-ready');
      if (!row.querySelector('.qf-rate-row-status')) {
        const cell = row.querySelector('td:last-child');
        if (cell) {
          const tag = document.createElement('span');
          tag.className = 'qf-rate-row-status';
          cell.appendChild(tag);
        }
      }
      const tag = row.querySelector('.qf-rate-row-status');
      if (tag) tag.textContent = disabled ? 'Review visibility' : gap ? 'Needs price' : 'Ready';
    });
  }

  function filterRows(mode = 'all') {
    rows().forEach((row) => {
      const show = mode === 'all' ||
        (mode === 'gap' && row.classList.contains('qf-rate-row-gap')) ||
        (mode === 'disabled' && row.classList.contains('qf-rate-row-disabled')) ||
        (mode === 'ready' && row.classList.contains('qf-rate-row-ready'));
      row.hidden = !show;
    });
    content.querySelectorAll('[data-rate-scan]').forEach((btn) => btn.classList.toggle('active', btn.dataset.rateScan === mode));
  }

  function saveNote() {
    if (route() !== 'rates' || content.querySelector('.qf-rate-save-note')) return;
    const buttons = Array.from(content.querySelectorAll('button'));
    const save = buttons.find((btn) => /save|update|add/i.test(btn.textContent || ''));
    if (!save) return;
    const note = document.createElement('span');
    note.className = 'qf-rate-save-note';
    note.textContent = 'Changes save to this calculator';
    save.insertAdjacentElement('afterend', note);
  }

  function enhance() {
    if (route() !== 'rates') return;
    hero();
    guide();
    scanPanel();
    tableWrap();
    decorateRows();
    saveNote();
  }

  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  });
  observer.observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
