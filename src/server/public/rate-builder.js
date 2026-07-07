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

  function savePanel() {
    if (route() !== 'rates' || content.querySelector('.qf-rate-save-panel')) return;
    const card = document.createElement('section');
    card.className = 'qf-rate-save-panel';
    card.innerHTML = `
      <div>
        <div class="qf-builder-kicker">Save states</div>
        <strong>Inline edits save when you leave a field.</strong>
        <p>Use Duplicate to copy a similar service/equipment row. Duplicates are created as disabled drafts so they do not publish by accident.</p>
      </div>
      <div class="qf-rate-live" role="status" aria-live="polite">Ready for edits</div>`;
    const scan = content.querySelector('.qf-rate-scan');
    if (scan && scan.nextSibling) scan.parentNode.insertBefore(card, scan.nextSibling);
  }

  function liveStatus(text, mode) {
    const live = content.querySelector('.qf-rate-live');
    if (!live) return;
    live.textContent = text;
    live.dataset.mode = mode || 'idle';
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

  function readRateRow(row) {
    const selects = Array.from(row.querySelectorAll('select'));
    const inputs = Array.from(row.querySelectorAll('input.input'));
    const enabled = row.querySelector('input[type="checkbox"]');
    function num(index) {
      const value = inputs[index] && inputs[index].value !== '' ? Number(inputs[index].value) : 0;
      return Number.isFinite(value) ? value : 0;
    }
    const service = selects[0] ? selects[0].value : 'ftl';
    const equipment = selects[1] ? selects[1].value : 'dryvan';
    const label = inputs[0] && inputs[0].value ? inputs[0].value.trim() : service + ' ' + equipment;
    return {
      service,
      equipment,
      label: label + ' copy',
      ratePerMile: num(1),
      minimumCharge: num(2),
      flatFee: num(3),
      fuelSurchargePct: num(4),
      marginPct: num(5),
      enabled: false,
    };
  }

  function duplicateRate(row, button) {
    const body = readRateRow(row);
    const old = button.textContent;
    button.disabled = true;
    button.textContent = 'Copying…';
    liveStatus('Copying rate card…', 'saving');
    fetch('/api/tenant/rate-cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.json().then((json) => {
        if (!res.ok) throw new Error(json.error || 'Could not duplicate rate card');
        return json;
      }))
      .then(() => {
        if (window.qfToastOk) window.qfToastOk('Rate card duplicated as disabled draft');
        liveStatus('Duplicated as disabled draft', 'saved');
        setTimeout(() => go('rates'), 250);
      })
      .catch((err) => {
        if (window.qfToastErr) window.qfToastErr(err);
        liveStatus('Duplicate failed', 'error');
        button.disabled = false;
        button.textContent = old;
      });
  }

  function duplicateActions() {
    if (route() !== 'rates') return;
    rows().forEach((row) => {
      if (row.querySelector('.qf-rate-duplicate-btn')) return;
      const cell = row.querySelector('td:last-child');
      if (!cell) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm qf-rate-duplicate-btn';
      btn.textContent = 'Duplicate';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        duplicateRate(row, btn);
      });
      cell.insertBefore(btn, cell.firstChild);
    });
  }

  function wireSaveFeedback() {
    if (content.dataset.qfRateSaveFeedback === '1') return;
    content.dataset.qfRateSaveFeedback = '1';
    content.addEventListener('change', (event) => {
      if (route() !== 'rates') return;
      if (!event.target.closest('.qf-rate-table-wrap')) return;
      liveStatus('Saving change…', 'saving');
      setTimeout(() => liveStatus('Saved a moment ago', 'saved'), 700);
    }, true);
    content.addEventListener('blur', (event) => {
      if (route() !== 'rates') return;
      if (!event.target.closest('.qf-rate-table-wrap')) return;
      if (!event.target.matches('input, select')) return;
      liveStatus('Saving change…', 'saving');
      setTimeout(() => liveStatus('Saved a moment ago', 'saved'), 700);
    }, true);
  }

  function enhance() {
    if (route() !== 'rates') return;
    hero();
    guide();
    scanPanel();
    savePanel();
    tableWrap();
    decorateRows();
    duplicateActions();
    wireSaveFeedback();
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