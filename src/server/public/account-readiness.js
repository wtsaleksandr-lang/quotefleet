(() => {
  const PANEL_CLASS = 'qf-account-readiness';

  function text(root, selector) {
    const node = root.querySelector(selector);
    return node ? (node.value || node.textContent || '').trim() : '';
  }

  function findCardByTitle(title) {
    return Array.from(document.querySelectorAll('.card')).find((card) => {
      const cardTitle = card.querySelector('.card-title');
      return cardTitle && cardTitle.textContent.trim().toLowerCase() === title.toLowerCase();
    });
  }

  function accountSignals() {
    const profile = findCardByTitle('Profile');
    const password = findCardByTitle('Change password');
    const sessions = findCardByTitle('Active sessions');
    const name = profile ? text(profile, 'input[data-key="name"]') : '';
    const email = profile ? text(profile, 'input[data-key="email"]') : '';
    return {
      hasProfile: Boolean(name && email),
      hasSecurity: Boolean(password && password.querySelector('input[type="password"]')),
      hasSessionControl: Boolean(sessions && sessions.querySelector('.btn-danger')),
    };
  }

  function buildCheck(title, detail, ready) {
    const div = document.createElement('div');
    div.className = 'qf-account-check';
    div.innerHTML = `<strong>${ready ? '✓' : '•'} ${title}</strong><span>${detail}</span>`;
    return div;
  }

  function go(route) {
    const target = `/app/${route}`;
    const nav = document.querySelector(`[data-route="${route}"]`);
    if (nav) nav.click();
    else window.location.href = target;
  }

  function mount() {
    if (!location.pathname.startsWith('/app/account')) return;
    const page = document.querySelector('#page-content');
    if (!page || page.querySelector(`.${PANEL_CLASS}`)) return;
    const subtitle = page.querySelector('.page-sub');
    const profile = findCardByTitle('Profile');
    if (!subtitle || !profile) return;

    const signals = accountSignals();
    const readyCount = [signals.hasProfile, signals.hasSecurity, signals.hasSessionControl].filter(Boolean).length;
    const ready = readyCount === 3;

    const panel = document.createElement('section');
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="qf-account-readiness-head">
        <div>
          <h2>Account readiness</h2>
          <p>Confirm the basics before sharing the widget with customers or adding it to your website.</p>
        </div>
        <span class="qf-account-status ${ready ? 'ready' : 'warn'}">${ready ? 'Ready for launch' : `${readyCount}/3 ready`}</span>
      </div>
      <div class="qf-account-checks"></div>
      <div class="qf-account-actions">
        <button type="button" class="btn" data-account-go="brand">Review brand</button>
        <button type="button" class="btn" data-account-go="embed">Get embed code</button>
        <button type="button" class="btn" data-account-go="overview">View dashboard</button>
      </div>
      <div class="qf-account-tip">Launch rule: profile identity, password access, and session controls should be clear before a customer-facing rollout.</div>
    `;

    const checks = panel.querySelector('.qf-account-checks');
    checks.appendChild(buildCheck('Profile identity', signals.hasProfile ? 'Name and email are available for account recovery and customer trust.' : 'Add a clear name and email so your team knows who owns the workspace.', signals.hasProfile));
    checks.appendChild(buildCheck('Password access', signals.hasSecurity ? 'Password tools are available on this page.' : 'Password controls were not detected yet.', signals.hasSecurity));
    checks.appendChild(buildCheck('Session control', signals.hasSessionControl ? 'You can sign out every active session if access needs to be reset.' : 'Session reset control was not detected yet.', signals.hasSessionControl));

    panel.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-account-go]');
      if (!btn) return;
      go(btn.dataset.accountGo);
    });

    subtitle.insertAdjacentElement('afterend', panel);
  }

  const observer = new MutationObserver(() => mount());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', () => setTimeout(mount, 0));
  document.addEventListener('click', () => setTimeout(mount, 0), true);
  mount();
})();
