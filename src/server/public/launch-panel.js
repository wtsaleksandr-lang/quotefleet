(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function slug() {
    const value = document.getElementById('sb-tenant-slug')?.textContent?.trim();
    return value && value !== '…' ? value : 'your-company';
  }

  // Canonical customer link (hosted <slug>.<hostDomain>), shared across the
  // dashboard via window.__qfWidget. Never a fake `…yourquote.net`.
  function widget() {
    const w = window.__qfWidget;
    if (w && w.url) return { url: w.url, host: w.host };
    const s = slug();
    return {
      url: new URL('/w/' + encodeURIComponent(s), window.location.origin).toString(),
      host: s,
    };
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  async function copyPublicLink() {
    const url = widget().url;
    try {
      await navigator.clipboard.writeText(url);
      window.qfToast?.('Calculator link copied.', 'success', 'Ready to share');
    } catch (e) {
      window.prompt('Copy calculator link', url);
    }
  }

  function panel() {
    if (route() !== 'embed' || content.querySelector('.qf-launch-panel')) return;
    const section = document.createElement('section');
    section.className = 'qf-launch-panel';
    section.innerHTML = `
      <div class="qf-launch-top">
        <div>
          <div class="qf-launch-kicker">Launch workspace</div>
          <h2>Put your calculator where customers already ask for rates.</h2>
          <p>Start with the public link, then add it to email signatures, saved replies, messages, and your website when ready.</p>
        </div>
        <div class="qf-launch-actions">
          <a href="${widget().url}" target="_blank" rel="noopener">Open calculator</a>
          <button type="button" data-launch-copy>Copy link</button>
          <button type="button" data-launch-go="brand">Brand page</button>
        </div>
      </div>
      <div class="qf-launch-grid">
        <div class="qf-launch-card"><span>Fastest start</span><strong>Share link</strong></div>
        <div class="qf-launch-card"><span>Daily use</span><strong>Email signature</strong></div>
        <div class="qf-launch-card"><span>Website option</span><strong>Embed later</strong></div>
        <div class="qf-launch-card"><span>Next check</span><strong>Customer view</strong></div>
      </div>`;
    section.addEventListener('click', (event) => {
      if (event.target.closest('[data-launch-copy]')) copyPublicLink();
      const btn = event.target.closest('[data-launch-go]');
      if (btn) go(btn.dataset.launchGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function steps() {
    if (route() !== 'embed' || content.querySelector('.qf-launch-steps')) return;
    const el = document.createElement('section');
    el.className = 'qf-launch-steps';
    el.innerHTML = `
      <div class="qf-launch-step"><small>1</small><strong>Copy the link</strong><span>Use the hosted calculator link first. No website work required.</span></div>
      <div class="qf-launch-step"><small>2</small><strong>Add to daily replies</strong><span>Place it in email signatures, quote replies, and customer messages.</span></div>
      <div class="qf-launch-step"><small>3</small><strong>Review activity</strong><span>Watch leads, callbacks, quote opens, and chat questions in the dashboard.</span></div>`;
    const panelEl = content.querySelector('.qf-launch-panel');
    if (panelEl && panelEl.nextSibling) panelEl.parentNode.insertBefore(el, panelEl.nextSibling);
  }

  function note() {
    if (route() !== 'embed' || content.querySelector('.qf-launch-note')) return;
    const el = document.createElement('div');
    el.className = 'qf-launch-note';
    el.innerHTML = '<b>Launch rule:</b> Get the link in front of customers first. Website embed can come after the calculator is already useful.';
    const stepsEl = content.querySelector('.qf-launch-steps');
    if (stepsEl && stepsEl.nextSibling) stepsEl.parentNode.insertBefore(el, stepsEl.nextSibling);
  }

  function enhance() {
    // De-clutter: the "Launch workspace" panel is retired from the Embed page —
    // it buried the real embed snippet + Widget-settings cards. Injector kept
    // (imported by app.html) but neutralised. See renderEmbed + embed-panel.css.
    return;
    // eslint-disable-next-line no-unreachable
    if (route() !== 'embed') return;
    panel();
    steps();
    note();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
