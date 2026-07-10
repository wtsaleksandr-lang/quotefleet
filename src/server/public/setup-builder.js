(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const configs = {
    accessorials: {
      label: 'Charge builder',
      title: 'Add the charges customers usually ask about.',
      text: 'Keep chassis, hazmat, detention, liftgate, reefer, residential, and waiting time clear before customers request a PDF quote.',
      cards: [['Common charges', 'Chassis · Detention'], ['Next step', 'Zones'], ['Customer output', 'Cleaner quotes']],
      actions: [['Back to rates', 'rates'], ['Add zones', 'zones'], ['Preview link', 'embed']],
      tip: '<b>Tip:</b> Start with the fees your team explains most often by email. The calculator should answer those first.'
    },
    zones: {
      label: 'Zone builder',
      title: 'Build local zones for faster drayage pricing.',
      text: 'Use zones for common port, rail, city, or radius pricing so local quotes do not need manual math every time.',
      cards: [['Best for', 'Ports · Rail'], ['Next step', 'Brand page'], ['Customer output', 'Local pricing']],
      actions: [['Back to charges', 'accessorials'], ['Brand page', 'brand'], ['Preview link', 'embed']],
      tip: '<b>Tip:</b> Add your busiest local lanes first. You can expand coverage after the calculator is live.'
    }
  };

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function rows() {
    return Array.from(content.querySelectorAll('tbody tr'));
  }

  function builder() {
    const current = route();
    const cfg = configs[current];
    if (!cfg || content.querySelector('.qf-setup-builder')) return;
    const count = rows().length;
    const section = document.createElement('section');
    section.className = 'qf-setup-builder';
    section.innerHTML = `
      <div class="qf-setup-builder-top">
        <div>
          <div class="qf-setup-builder-kicker">${cfg.label}</div>
          <h2>${cfg.title}</h2>
          <p>${cfg.text}</p>
        </div>
        <div class="qf-setup-builder-actions">
          ${cfg.actions.map(([label, target]) => `<button type="button" data-go-builder="${target}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="qf-setup-builder-cards">
        <div class="qf-setup-builder-card"><span>Items added</span><strong>${count}</strong></div>
        ${cfg.cards.map(([label, value]) => `<div class="qf-setup-builder-card"><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-go-builder]');
      if (btn) go(btn.dataset.goBuilder);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function tip() {
    const current = route();
    const cfg = configs[current];
    if (!cfg || content.querySelector('.qf-setup-builder-tip')) return;
    const el = document.createElement('div');
    el.className = 'qf-setup-builder-tip';
    el.innerHTML = cfg.tip;
    const hero = content.querySelector('.qf-setup-builder');
    if (hero && hero.nextSibling) hero.parentNode.insertBefore(el, hero.nextSibling);
  }

  function wrapTable() {
    const current = route();
    const cfg = configs[current];
    if (!cfg) return;
    const table = content.querySelector('.table');
    if (!table || table.closest('.qf-setup-table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'qf-setup-table-wrap';
    wrap.dataset.label = cfg.label;
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  }

  function enhance() {
    // The dedicated stupid-simple Add-ons editor owns its own surface — never
    // inject the "Charge builder" card / tip / table-wrap there.
    if (content.querySelector('[data-qf-addons]')) return;
    if (!configs[route()]) return;
    builder();
    tip();
    wrapTable();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
