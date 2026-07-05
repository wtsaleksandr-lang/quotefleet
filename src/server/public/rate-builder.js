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
    tableWrap();
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
