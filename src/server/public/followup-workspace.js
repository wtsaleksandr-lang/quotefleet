(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const routeCopy = {
    overview: ['Follow-up workspace', 'Keep quote activity visible so warm leads do not disappear after the first estimate.'],
    leads: ['Lead follow-up', 'Turn quote requests, opens, and customer questions into clear next actions.'],
    callbacks: ['Callback workspace', 'Keep requested calls organized by priority, timing, and quote context.']
  };

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function workspace() {
    const current = route();
    if (!routeCopy[current] || content.querySelector('.qf-followup-workspace')) return;
    const [title, text] = routeCopy[current];
    const section = document.createElement('section');
    section.className = 'qf-followup-workspace';
    section.innerHTML = `
      <div class="qf-followup-top">
        <div>
          <div class="qf-followup-kicker">Activity follow-up</div>
          <h2>${title}</h2>
          <p>${text}</p>
        </div>
        <div class="qf-followup-actions">
          <button type="button" data-followup-go="leads">Leads</button>
          <button type="button" data-followup-go="callbacks">Callbacks</button>
          <button type="button" data-followup-go="embed">Share calculator</button>
        </div>
      </div>
      <div class="qf-followup-grid">
        <div class="qf-followup-card"><span>First action</span><strong>Reply fast</strong></div>
        <div class="qf-followup-card"><span>Best signal</span><strong>Quote opened</strong></div>
        <div class="qf-followup-card"><span>Next step</span><strong>PDF or call</strong></div>
        <div class="qf-followup-card"><span>Team view</span><strong>One queue</strong></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-followup-go]');
      if (btn) go(btn.dataset.followupGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function board() {
    const current = route();
    if (!routeCopy[current] || content.querySelector('.qf-followup-board')) return;
    const board = document.createElement('section');
    board.className = 'qf-followup-board';
    board.innerHTML = `
      <div class="qf-followup-column">
        <h3>New activity</h3>
        <div class="qf-followup-item"><small>Open</small><strong>Customer checked a rate</strong><span>Review lane, equipment, and accessorials.</span></div>
        <div class="qf-followup-item"><small>Question</small><strong>AI/chat needs attention</strong><span>Answer anything the assistant should not promise.</span></div>
      </div>
      <div class="qf-followup-column">
        <h3>Needs action</h3>
        <div class="qf-followup-item"><small>PDF</small><strong>Send written quote</strong><span>Confirm final details and send a branded quote.</span></div>
        <div class="qf-followup-item"><small>Call</small><strong>Callback requested</strong><span>Call when timing or quote details need confirmation.</span></div>
      </div>
      <div class="qf-followup-column">
        <h3>Done / waiting</h3>
        <div class="qf-followup-item"><small>Sent</small><strong>Quote delivered</strong><span>Watch for opens, replies, or new quote activity.</span></div>
        <div class="qf-followup-item"><small>Waiting</small><strong>Customer reviewing</strong><span>Follow up before the quote goes cold.</span></div>
      </div>`;
    const work = content.querySelector('.qf-followup-workspace');
    if (work && work.nextSibling) work.parentNode.insertBefore(board, work.nextSibling);
  }

  function tip() {
    const current = route();
    if (!routeCopy[current] || content.querySelector('.qf-followup-tip')) return;
    const el = document.createElement('div');
    el.className = 'qf-followup-tip';
    el.innerHTML = '<b>Follow-up rule:</b> A rate check is not finished until the customer has a clear next step: PDF quote, callback, chat reply, or close/waiting status.';
    const boardEl = content.querySelector('.qf-followup-board');
    if (boardEl && boardEl.nextSibling) boardEl.parentNode.insertBefore(el, boardEl.nextSibling);
  }

  function enhance() {
    if (!routeCopy[route()]) return;
    workspace();
    board();
    tip();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
