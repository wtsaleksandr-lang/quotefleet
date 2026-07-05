(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function tenantName() {
    const name = document.getElementById('sb-tenant-name')?.textContent?.trim();
    return name && name !== '…' ? name : 'Your company';
  }

  function tenantSlug() {
    const slug = document.getElementById('sb-tenant-slug')?.textContent?.trim();
    return slug && slug !== '…' ? slug : 'your-company';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function publicPath() {
    return '/w/' + encodeURIComponent(tenantSlug());
  }

  function editor() {
    if (route() !== 'brand' || content.querySelector('.qf-brand-editor')) return;
    const name = tenantName();
    const section = document.createElement('section');
    section.className = 'qf-brand-editor';
    section.innerHTML = `
      <div class="qf-brand-editor-top">
        <div>
          <div class="qf-brand-kicker">Brand page editor</div>
          <h2>Make the calculator look like your company.</h2>
          <p>Customers should feel they opened your page, not a generic form. Keep it clean, branded, and easy to trust.</p>
        </div>
        <div class="qf-brand-actions">
          <button type="button" data-brand-go="rates">Rates</button>
          <button type="button" data-brand-go="ai">AI setup</button>
          <a href="${publicPath()}" target="_blank" rel="noopener">Open page</a>
        </div>
      </div>
      <div class="qf-brand-editor-body">
        <div class="qf-brand-checklist">
          <strong>Brand setup checklist</strong>
          <ul>
            <li>Company name and logo feel recognizable.</li>
            <li>Accent color matches your brand or fleet style.</li>
            <li>Headline tells customers what they can check.</li>
            <li>Contact details are clear before they request a quote.</li>
            <li>Public link is ready to share in email signature.</li>
          </ul>
        </div>
        <div class="qf-brand-preview">
          <strong>Customer page preview</strong>
          <div class="qf-brand-page-mock" aria-label="Branded page preview">
            <div class="qf-brand-page-top">
              <div style="display:flex;gap:10px;align-items:center"><div class="qf-brand-logo"></div><div><strong>${name}</strong><small>${tenantSlug()}.yourquote.net</small></div></div>
              <span class="qf-brand-page-chip">BRANDED</span>
            </div>
            <div class="qf-brand-page-body">
              <h3>Check your rate</h3>
              <p>Get a fast estimate, request a PDF quote, or ask a question before booking.</p>
              <div class="qf-brand-page-fields"><span>Pickup</span><span>Delivery</span><span>Service</span><span>Get rate</span></div>
            </div>
          </div>
        </div>
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-brand-go]');
      if (btn) go(btn.dataset.brandGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function tip() {
    if (route() !== 'brand' || content.querySelector('.qf-brand-publish-tip')) return;
    const el = document.createElement('div');
    el.className = 'qf-brand-publish-tip';
    el.innerHTML = '<b>Tip:</b> Keep this page simple. A customer should understand who you are, what they can check, and how to contact you in a few seconds.';
    const editorCard = content.querySelector('.qf-brand-editor');
    if (editorCard && editorCard.nextSibling) editorCard.parentNode.insertBefore(el, editorCard.nextSibling);
  }

  function enhance() {
    if (route() !== 'brand') return;
    editor();
    tip();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
