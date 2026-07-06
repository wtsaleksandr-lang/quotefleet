(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function routeParts() {
    return location.pathname.split('/app/leads/');
  }

  function isLeadDetail() {
    return routeParts().length > 1 && !!routeParts()[1];
  }

  function text(sel, root = content) {
    return (root.querySelector(sel)?.textContent || '').trim();
  }

  function selectStatus() {
    const statusCard = Array.from(content.querySelectorAll('.card')).find((card) =>
      text('.card-title', card).toLowerCase().includes('status')
    );
    return statusCard?.querySelector('select')?.value || 'new';
  }

  function hasConversation() {
    return Array.from(content.querySelectorAll('.card-title')).some((title) =>
      title.textContent.toLowerCase().includes('customer chat')
    );
  }

  function hasAiReply() {
    return Array.from(content.querySelectorAll('.card-title')).some((title) =>
      title.textContent.toLowerCase().includes('ai auto-reply')
    );
  }

  function money() {
    const quoteTitle = Array.from(content.querySelectorAll('.card-title')).find((title) =>
      title.textContent.toLowerCase().startsWith('quote')
    );
    const match = quoteTitle?.textContent.match(/\$[0-9,.]+/);
    return match ? match[0] : 'quote total';
  }

  function nextAction(status) {
    if (status === 'won') return ['Won', 'Confirm handoff, booking details, and final documents.'];
    if (status === 'lost') return ['Lost', 'Keep notes on why the customer did not move forward.'];
    if (status === 'spam') return ['Ignore', 'No sales follow-up needed unless this was marked by mistake.'];
    if (hasConversation()) return ['Review chat', 'Customer messages exist. Check whether a human reply is needed.'];
    if (hasAiReply()) return ['Audit AI reply', 'Review the sent answer before sending a final quote or calling.'];
    if (status === 'replied') return ['Follow up', 'Customer was already contacted. Check for reply or quote open activity.'];
    return ['First response', 'Send a PDF quote or call while the request is still warm.'];
  }

  function insertBar() {
    if (!isLeadDetail()) return;
    if (content.querySelector('.qf-lead-crm-bar')) return;
    const h1 = content.querySelector('h1');
    if (!h1 || !content.querySelector('.grid-2')) return;
    const status = selectStatus();
    const [action, explanation] = nextAction(status);
    const bar = document.createElement('section');
    bar.className = 'qf-lead-crm-bar';
    bar.innerHTML = `
      <div class="qf-lead-crm-top">
        <div>
          <div class="qf-lead-crm-kicker">Lead workspace</div>
          <h2>${action}</h2>
          <p>${explanation}</p>
        </div>
        <div class="qf-lead-crm-pills" aria-label="Lead summary">
          <span class="qf-lead-crm-pill">Status: <strong>${status}</strong></span>
          <span class="qf-lead-crm-pill">Value: <strong>${money()}</strong></span>
          <span class="qf-lead-crm-pill">Owner: <strong>Unassigned</strong></span>
          <span class="qf-lead-crm-pill">Priority: <strong>${status === 'new' || status === 'draft' ? 'High' : 'Normal'}</strong></span>
        </div>
      </div>
      <div class="qf-lead-crm-actions">
        <div class="qf-lead-crm-action"><b>1. Verify details</b><span>Check lane, service, equipment, weight, and pickup date.</span></div>
        <div class="qf-lead-crm-action"><b>2. Choose contact</b><span>Send PDF, email, or call depending on urgency.</span></div>
        <div class="qf-lead-crm-action"><b>3. Update status</b><span>Use replied, won, lost, or spam so the queue stays clean.</span></div>
        <div class="qf-lead-crm-action"><b>4. Add notes</b><span>Record customer objections, target rate, and next follow-up.</span></div>
      </div>
      <div class="qf-lead-crm-suggestion"><b>CRM tip:</b> keep every lead with one clear next action, one current status, and one internal note.</div>`;
    h1.insertAdjacentElement('afterend', bar);
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(insertBar, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(insertBar, 500);
})();
