(() => {
  const PANEL_CLASS = 'qf-brand-studio-preview';

  function fieldByLabel(labelText) {
    const labels = Array.from(document.querySelectorAll('.app-main .field-label'));
    const label = labels.find((node) => (node.textContent || '').trim().toLowerCase() === labelText.toLowerCase());
    if (!label) return null;
    return label.parentElement && label.parentElement.querySelector('input, textarea');
  }

  function value(labelText, fallback = '') {
    const input = fieldByLabel(labelText);
    return input && input.value ? input.value.trim() : fallback;
  }

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : fallback;
  }

  function render(panel) {
    const displayName = value('Display name', 'Your freight brand');
    const tagline = value('Tagline', 'Get an instant freight quote');
    const cta = value('CTA button text', 'Calculate estimate');
    const primary = safeColor(value('Primary color'), '#2563eb');
    const accent = safeColor(value('Accent color'), '#06b6d4');
    const logoUrl = value('Logo URL');

    panel.innerHTML = `
      <div class="qf-brand-preview-head">
        <span>Live brand feel</span>
        <strong>Widget preview</strong>
      </div>
      <div class="qf-brand-preview-card" style="--qf-brand-primary:${primary};--qf-brand-accent:${accent};">
        <div class="qf-brand-preview-top">
          ${logoUrl ? `<img src="${logoUrl}" alt="" loading="lazy">` : '<div class="qf-brand-preview-logo">QF</div>'}
          <div><b>${displayName}</b><small>${tagline}</small></div>
        </div>
        <div class="qf-brand-preview-route"><span>Pickup ZIP / city</span><span>Delivery ZIP / city</span></div>
        <button type="button">${cta}</button>
        <p>Contact info and follow-up options appear after the estimate.</p>
      </div>
    `;
  }

  function mount() {
    // Wave 2: the brand route is the dedicated "Customize" panel with its own
    // live widget preview, so this legacy "live brand feel" mock is retired.
    return;
    // eslint-disable-next-line no-unreachable
    if (!location.pathname.startsWith('/app/brand')) return;
    const page = document.querySelector('#page-content');
    const card = page && page.querySelector('.card');
    if (!page || !card || page.querySelector(`.${PANEL_CLASS}`)) return;

    const panel = document.createElement('aside');
    panel.className = PANEL_CLASS;
    render(panel);
    card.insertAdjacentElement('afterend', panel);

    page.addEventListener('input', () => render(panel), true);
    page.addEventListener('change', () => render(panel), true);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(mount, 0), true);
  mount();
})();