(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const setupRoutes = ['rates', 'accessorials', 'zones', 'brand', 'ai', 'embed'];
  const routeLabels = {
    rates: ['Rate cards', 'Add your base pricing.'],
    accessorials: ['Accessorials', 'Add chassis, liftgate, hazmat, detention, and other charges.'],
    zones: ['Zones', 'Add port or local flat-tariff areas.'],
    brand: ['Brand page', 'Make the calculator look like your company.'],
    ai: ['AI agent', 'Teach the assistant how to answer customers.'],
    embed: ['Public link', 'Copy the link, add it to signature, or place it on your site.'],
  };

  const routeCoach = {
    rates: {
      title: 'Start with your most common lane.',
      text: 'Add one reliable base rate first. You can layer accessorials and drayage zones after the first rate card is saved.',
      next: 'Next: add common extra charges.',
      primary: ['Add accessorials', 'accessorials'],
      secondary: ['Import rates', 'ingest'],
    },
    accessorials: {
      title: 'Add charges customers ask about.',
      text: 'Start with chassis, residential, liftgate, hazmat, storage, detention, and reefer-related charges. Keep labels customer friendly.',
      next: 'Next: add drayage zones if you quote port work.',
      primary: ['Add zones', 'zones'],
      secondary: ['Back to rates', 'rates'],
    },
    zones: {
      title: 'Set up local port pricing.',
      text: 'Use zones for common port/ramp radius pricing. If you do not quote drayage, you can skip this step and publish the link.',
      next: 'Next: brand the customer page.',
      primary: ['Brand page', 'brand'],
      secondary: ['Back to accessorials', 'accessorials'],
    },
    brand: {
      title: 'Make the page feel like your company.',
      text: 'Check logo, display name, colors, contact requirements, and the customer-facing headline before sharing the link.',
      next: 'Next: set AI guardrails or publish the link.',
      primary: ['AI setup', 'ai'],
      secondary: ['Public link', 'embed'],
    },
    ai: {
      title: 'Keep AI helpful and safe.',
      text: 'Add company rules, services offered, what AI should not promise, and when it should suggest a human callback.',
      next: 'Next: copy the public link.',
      primary: ['Public link', 'embed'],
      secondary: ['Brand page', 'brand'],
    },
    embed: {
      title: 'Share the rate page where customers already are.',
      text: 'Copy the hosted link into email signatures, messages, ads, or your website. Do one live test before sending traffic.',
      next: 'Next: send a test quote and review it in Leads.',
      primary: ['Open leads', 'leads'],
      secondary: ['Preview page', 'overview'],
    },
  };

  function go(route) {
    const btn = document.querySelector('.sidebar [data-route="' + route + '"]');
    if (btn) btn.click();
    else window.location.href = '/app/' + route;
  }

  function currentRoute() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function hasTableRows() {
    return content.querySelectorAll('tbody tr').length > 0;
  }

  function isProbablyDone(route) {
    if (route === 'rates' || route === 'accessorials' || route === 'zones') return hasTableRows();
    if (route === 'brand' || route === 'ai' || route === 'embed') return true;
    return false;
  }

  function estimateProgress() {
    const route = currentRoute();
    let done = 1;
    if (route === 'rates' && hasTableRows()) done = 2;
    if (route === 'accessorials' && hasTableRows()) done = 3;
    if (route === 'zones' && hasTableRows()) done = 4;
    if (route === 'brand') done = 4;
    if (route === 'ai') done = 5;
    if (route === 'embed') done = 6;
    return Math.max(1, Math.min(6, done));
  }

  function setupPanel() {
    if (content.querySelector('.qf-setup-panel')) return;
    const done = estimateProgress();
    const panel = document.createElement('section');
    panel.className = 'qf-setup-panel';
    panel.style.setProperty('--qf-setup-pct', Math.round(done / 6 * 100) + '%');
    panel.innerHTML = `
      <div class="qf-setup-head">
        <div>
          <div class="qf-setup-kicker">Calculator setup</div>
          <h2>Get your rate page ready in a few focused steps.</h2>
          <p>Start with rates, add the charges customers ask about, then publish your branded link.</p>
        </div>
        <div class="qf-setup-meter">
          <span class="qf-setup-score">${done}/6</span>
          <small>setup areas touched</small>
          <div class="qf-setup-bar"><span></span></div>
        </div>
      </div>
      <div class="qf-setup-steps"></div>
      <div class="qf-setup-launch-note"><strong>Launch order:</strong> rates first, then accessorials, optional zones, brand, AI guardrails, and finally the public link.</div>
      <div class="qf-quick-actions">
        <button type="button" data-go="rates">Edit rates</button>
        <button type="button" data-go="accessorials">Add charges</button>
        <button type="button" data-go="brand">Brand page</button>
        <button type="button" data-go="embed">Share link</button>
      </div>`;

    const steps = panel.querySelector('.qf-setup-steps');
    setupRoutes.forEach((route, index) => {
      const [title, text] = routeLabels[route];
      const doneClass = index < done ? ' is-done' : '';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'qf-setup-step' + doneClass;
      item.dataset.go = route;
      item.innerHTML = `<span class="qf-setup-dot">${index < done ? '✓' : index + 1}</span><span><strong>${title}</strong><small>${text}</small></span>`;
      steps.appendChild(item);
    });

    panel.addEventListener('click', (event) => {
      const target = event.target.closest('[data-go]');
      if (target) go(target.dataset.go);
    });

    const first = content.querySelector('h1');
    if (first && first.nextSibling) first.parentNode.insertBefore(panel, first.nextSibling.nextSibling || first.nextSibling);
    else content.prepend(panel);
  }

  function setupCoach(route) {
    if (!setupRoutes.includes(route) || content.querySelector('.qf-setup-coach')) return;
    const copy = routeCoach[route];
    if (!copy) return;
    const coach = document.createElement('section');
    coach.className = 'qf-setup-coach';
    coach.innerHTML = `
      <div>
        <span>Current setup step</span>
        <strong>${copy.title}</strong>
        <p>${copy.text}</p>
      </div>
      <div class="qf-setup-coach-next">
        <small>${copy.next}</small>
        <div class="qf-empty-actions">
          <button type="button" data-go="${copy.primary[1]}">${copy.primary[0]}</button>
          <button type="button" data-go="${copy.secondary[1]}">${copy.secondary[0]}</button>
        </div>
      </div>`;
    coach.addEventListener('click', (event) => {
      const target = event.target.closest('[data-go]');
      if (target) go(target.dataset.go);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(coach, sub.nextSibling);
    else {
      const h1 = content.querySelector('h1');
      if (h1 && h1.nextSibling) h1.parentNode.insertBefore(coach, h1.nextSibling);
      else content.prepend(coach);
    }
  }

  function emptyState(route) {
    if (!['rates', 'accessorials', 'zones'].includes(route)) return;
    if (hasTableRows() || content.querySelector('.qf-setup-empty')) return;
    const copy = {
      rates: ['No rate cards yet.', 'Add one base rate for the service customers request most often. A simple first rate is enough to test the public calculator.', [['Add rate card', 'rates'], ['Import with AI', 'ingest'], ['Review QA matrix', 'overview']]],
      accessorials: ['No extra charges yet.', 'Add the fees customers usually ask about: chassis, liftgate, detention, hazmat, storage, reefer, or residential delivery.', [['Add accessorial', 'accessorials'], ['Ask AI to import', 'ingest'], ['Back to rates', 'rates']]],
      zones: ['No drayage zones yet.', 'Add your common port or ramp radius zones so local pricing works without manual math. Skip this if you do not quote drayage.', [['Add zone', 'zones'], ['Back to rates', 'rates'], ['Brand page', 'brand']]],
    }[route];
    const box = document.createElement('div');
    box.className = 'qf-setup-empty';
    box.innerHTML = `<strong>${copy[0]}</strong><p>${copy[1]}</p><div class="qf-setup-empty-checks"><span>Start small</span><span>Save once</span><span>Test a quote</span></div><div class="qf-empty-actions"></div>`;
    const actions = box.querySelector('.qf-empty-actions');
    copy[2].forEach(([label, target]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.go = target;
      actions.appendChild(btn);
    });
    box.addEventListener('click', (event) => {
      const target = event.target.closest('[data-go]');
      if (target) go(target.dataset.go);
    });
    const coach = content.querySelector('.qf-setup-coach');
    if (coach && coach.nextSibling) coach.parentNode.insertBefore(box, coach.nextSibling);
    else {
      const sub = content.querySelector('.page-sub');
      if (sub && sub.nextSibling) sub.parentNode.insertBefore(box, sub.nextSibling);
      else content.prepend(box);
    }
  }

  function enhance() {
    const route = currentRoute();
    if (route === 'overview') setupPanel();
    if (setupRoutes.includes(route)) {
      const h1 = content.querySelector('h1');
      if (h1 && !content.querySelector('.qf-setup-kicker-inline')) {
        const label = document.createElement('div');
        label.className = 'qf-setup-kicker qf-setup-kicker-inline';
        label.textContent = 'Calculator setup';
        h1.parentNode.insertBefore(label, h1);
      }
      setupCoach(route);
      emptyState(route);
    }
  }

  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 80);
  });
  observer.observe(content, { childList: true, subtree: false });
  window.addEventListener('popstate', () => setTimeout(enhance, 80));
  setTimeout(enhance, 300);
})();