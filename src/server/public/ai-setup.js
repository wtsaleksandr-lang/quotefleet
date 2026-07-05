(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function panel() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-setup')) return;
    const section = document.createElement('section');
    section.className = 'qf-ai-setup';
    section.innerHTML = `
      <div class="qf-ai-top">
        <div>
          <div class="qf-ai-kicker">AI setup</div>
          <h2>Give the assistant clear rules before customers use it.</h2>
          <p>Set the basics once: what your company does, what the assistant can answer, and when it should send the customer to your team.</p>
        </div>
        <div class="qf-ai-actions">
          <button type="button" data-ai-go="brand">Brand page</button>
          <button type="button" data-ai-go="embed">Share setup</button>
          <button type="button" data-ai-go="ingest">Import info</button>
        </div>
      </div>
      <div class="qf-ai-grid">
        <div class="qf-ai-card"><span>Company rules</span><strong>How your team works</strong><p>Service area, business hours, quote process, and what details customers must provide.</p></div>
        <div class="qf-ai-card"><span>Services offered</span><strong>What customers can ask about</strong><p>Drayage, FTL, local delivery, accessorials, equipment, and quote requirements.</p></div>
        <div class="qf-ai-card"><span>Do not promise</span><strong>Keep answers safe</strong><p>No guaranteed price, transit time, equipment availability, or booking confirmation unless your team confirms it.</p></div>
        <div class="qf-ai-card"><span>Callback trigger</span><strong>When to route to team</strong><p>Use callback when details are missing, pricing is complex, or the customer asks for a firm quote.</p></div>
        <div class="qf-ai-card"><span>PDF quote trigger</span><strong>When to create a document</strong><p>Suggest a PDF quote after the customer has enough lane, service, and contact details.</p></div>
        <div class="qf-ai-card"><span>Common questions</span><strong>Answer repeated questions</strong><p>Accessorials, service coverage, quote validity, contact method, and required shipment details.</p></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ai-go]');
      if (btn) go(btn.dataset.aiGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function safetyNote() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-safety')) return;
    const el = document.createElement('div');
    el.className = 'qf-ai-safety';
    el.innerHTML = '<b>Safety rule:</b> The assistant should help customers move forward, not make final promises. Keep final rate, booking, and availability confirmation with your team.';
    const panelEl = content.querySelector('.qf-ai-setup');
    if (panelEl && panelEl.nextSibling) panelEl.parentNode.insertBefore(el, panelEl.nextSibling);
  }

  function chatMock() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-chat-mock')) return;
    const el = document.createElement('section');
    el.className = 'qf-ai-chat-mock';
    el.innerHTML = `
      <strong>Example customer conversation</strong>
      <div class="qf-ai-bubbles">
        <div class="qf-ai-bubble customer">Can you guarantee pickup today?</div>
        <div class="qf-ai-bubble agent">I can help collect the details, but final pickup availability must be confirmed by the team. Please send pickup location, delivery location, equipment type, and preferred time.</div>
        <div class="qf-ai-bubble customer">Can I get a PDF quote?</div>
        <div class="qf-ai-bubble agent">Yes. After you provide the required shipment details, you can request a PDF quote or ask for a callback.</div>
      </div>`;
    const safety = content.querySelector('.qf-ai-safety');
    if (safety && safety.nextSibling) safety.parentNode.insertBefore(el, safety.nextSibling);
  }

  function enhance() {
    if (route() !== 'ai') return;
    panel();
    safetyNote();
    chatMock();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
