(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function tenantSlug() {
    const slug = document.getElementById('sb-tenant-slug')?.textContent?.trim();
    return slug && slug !== '…' ? slug : 'your-company';
  }

  function tenantName() {
    const name = document.getElementById('sb-tenant-name')?.textContent?.trim();
    return name && name !== '…' ? name : 'Your company';
  }

  // The ONE canonical customer link — the hosted widget URL (<slug>.<hostDomain>)
  // exactly as the Embed page + live widget use it. Published by app.js boot as
  // window.__qfWidget. Falls back to the same-origin /w/:slug only if that
  // hasn't loaded yet (never a fake `…yourquote.net`).
  function widget() {
    const w = window.__qfWidget;
    if (w && w.url) return { url: w.url, host: w.host };
    const slug = tenantSlug();
    return {
      url: new URL('/w/' + encodeURIComponent(slug), window.location.origin).toString(),
      host: slug,
    };
  }

  async function copyLink() {
    const url = widget().url;
    try {
      await navigator.clipboard.writeText(url);
      const ev = new CustomEvent('qf:toast', { detail: { message: 'Calculator link copied.' } });
      window.dispatchEvent(ev);
    } catch (e) {
      window.prompt('Copy calculator link', url);
    }
  }

  function previewCard() {
    if (content.querySelector('.qf-preview-card')) return;
    const name = tenantName();
    const card = document.createElement('section');
    card.className = 'qf-preview-card';
    card.innerHTML = `
      <div class="qf-preview-top">
        <div>
          <div class="qf-preview-kicker">Customer preview</div>
          <h2>See what customers open from your link.</h2>
          <p>Use this as a quick preview while you edit rates, charges, zones, brand, or AI settings.</p>
        </div>
        <div class="qf-preview-actions">
          <a href="${widget().url}" target="_blank" rel="noopener">Open calculator</a>
          <button type="button" data-copy-preview>Copy link</button>
          <button type="button" data-go-preview="embed">Share setup</button>
        </div>
      </div>
      <div class="qf-preview-body">
        <div class="qf-preview-url">
          <span>Your customer link</span>
          <code>${widget().host}</code>
        </div>
        <div class="qf-preview-phone" aria-label="Calculator preview mockup">
          <div class="qf-preview-screen">
            <div class="qf-preview-brand">
              <div style="display:flex;gap:10px;align-items:center"><div class="qf-preview-logo"></div><div><strong>${name}</strong><small>Rate calculator</small></div></div>
              <span class="qf-preview-pill">LIVE</span>
            </div>
            <div class="qf-preview-fields">
              <div class="qf-preview-field">Pickup location</div>
              <div class="qf-preview-field">Delivery location</div>
              <div class="qf-preview-field">Service + equipment</div>
            </div>
            <div class="qf-preview-result"><span>Estimated rate</span><strong>$371.11</strong></div>
            <div class="qf-preview-mini-actions"><span>PDF quote</span><span>AI chat</span><span>Callback</span></div>
          </div>
        </div>
      </div>`;

    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-copy-preview]')) copyLink();
      const go = event.target.closest('[data-go-preview]');
      if (go) document.querySelector('.sidebar [data-route="' + go.dataset.goPreview + '"]')?.click();
    });

    const setup = content.querySelector('.qf-setup-panel');
    if (setup && setup.nextSibling) setup.parentNode.insertBefore(card, setup.nextSibling);
    else content.prepend(card);
  }

  function currentRoute() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function enhance() {
    const route = currentRoute();
    // The dedicated stupid-simple Add-ons editor owns its own surface — no
    // injected customer-preview card there.
    if (content.querySelector('[data-qf-addons]')) return;
    // The customer-preview phone mockup only belongs on the Overview and the
    // Public-link (embed) surfaces. Editor surfaces (rates/accessorials/zones/
    // ai) own their own layout and stay table/form-first — no injected mockup.
    // 'brand' also omitted: the Customize panel (Wave 2) has its own live preview.
    if (['overview', 'embed'].includes(route)) previewCard();
  }

  let timer;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  });
  observer.observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 450);
})();
