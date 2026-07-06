(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const routeCopy = {
    brand: {
      title: 'Public widget readiness',
      text: 'Check the customer-facing basics before sharing your calculator link or embedding it on a website.',
      primary: 'Embed code',
      primaryRoute: 'embed'
    },
    embed: {
      title: 'Ready to share',
      text: 'Use this workspace to confirm the hosted link, embed snippet, and customer preview are ready before publishing.',
      primary: 'Brand setup',
      primaryRoute: 'brand'
    }
  };

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function tenantSlug() {
    const slug = document.getElementById('sb-tenant-slug')?.textContent?.trim();
    return slug && slug !== '…' ? slug : 'your-company';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function hasValue(selector) {
    return Array.from(content.querySelectorAll(selector)).some((el) => (el.value || el.textContent || '').trim().length > 0);
  }

  function readiness() {
    const current = route();
    const copy = routeCopy[current];
    if (!copy || content.querySelector('.qf-share-readiness')) return;

    const directLink = '/w/' + encodeURIComponent(tenantSlug());
    const hasPreview = !!content.querySelector('iframe[title="QuoteFleet widget preview"]');
    const hasCode = hasValue('.code');
    const hasBrandFields = current === 'brand' || hasValue('input, textarea');
    const checks = [hasBrandFields, hasPreview || current === 'brand', hasCode || current === 'brand'];
    const readyCount = checks.filter(Boolean).length;
    const statusClass = readyCount >= 2 ? '' : ' warn';
    const statusText = readyCount >= 2 ? 'Share-ready' : 'Needs review';

    const section = document.createElement('section');
    section.className = 'qf-share-readiness';
    section.innerHTML = `
      <div class="qf-share-readiness-top">
        <div>
          <div class="qf-share-kicker">Publish checklist</div>
          <h2>${copy.title}</h2>
          <p>${copy.text}</p>
        </div>
        <div class="qf-share-actions">
          <span class="qf-share-status${statusClass}">${statusText}</span>
          <button type="button" data-share-go="${copy.primaryRoute}">${copy.primary}</button>
          <a href="${directLink}" target="_blank" rel="noopener">Open public page</a>
        </div>
      </div>
      <div class="qf-share-grid">
        <div class="qf-share-metric"><span>Public link</span><strong>${tenantSlug()}</strong></div>
        <div class="qf-share-metric"><span>Preview</span><strong>${hasPreview || current === 'brand' ? 'Available' : 'Check embed'}</strong></div>
        <div class="qf-share-metric"><span>Install method</span><strong>${current === 'embed' ? 'JS + iframe' : 'Hosted link'}</strong></div>
        <div class="qf-share-metric"><span>Before sharing</span><strong>${readyCount}/3 checks</strong></div>
      </div>
      <div class="qf-share-flow">
        <div class="qf-share-step"><small>1</small><span>Brand trust</span><strong>Name, logo, CTA, footer</strong></div>
        <div class="qf-share-step"><small>2</small><span>Customer test</span><strong>Open link and run quote</strong></div>
        <div class="qf-share-step"><small>3</small><span>Website install</span><strong>Copy embed and verify page</strong></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-share-go]');
      if (btn) go(btn.dataset.shareGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function tip() {
    const current = route();
    if (!routeCopy[current] || content.querySelector('.qf-share-tip')) return;
    const el = document.createElement('div');
    el.className = 'qf-share-tip';
    el.innerHTML = '<b>Launch rule:</b> before sending the link to customers, open the public page once, complete a test quote, and confirm the lead appears in the dashboard.';
    const panel = content.querySelector('.qf-share-readiness');
    if (panel && panel.nextSibling) panel.parentNode.insertBefore(el, panel.nextSibling);
  }

  function enhance() {
    if (!routeCopy[route()]) return;
    readiness();
    tip();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
