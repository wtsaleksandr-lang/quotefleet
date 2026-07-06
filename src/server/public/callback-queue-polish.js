(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  function currentRoute() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(route) {
    document.querySelector('.sidebar [data-route="' + route + '"]')?.click();
  }

  function findRows() {
    return Array.from(content.querySelectorAll('tbody tr'));
  }

  function rowText(row) {
    return (row.textContent || '').toLowerCase();
  }

  function classify(row) {
    const text = rowText(row);
    if (/today|now|urgent|overdue|new|requested/.test(text)) return 'Call first';
    if (/quote|pdf|estimate|price|rate/.test(text)) return 'Confirm quote';
    if (/won|lost|closed|done/.test(text)) return 'Closed';
    return 'Follow up';
  }

  function phoneEmailCounts(rows) {
    const joined = rows.map((row) => row.textContent || '').join(' ');
    return {
      phone: (joined.match(/\+?\d[\d\s().-]{7,}\d/g) || []).length,
      email: (joined.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).length
    };
  }

  function addCommand() {
    if (currentRoute() !== 'callbacks' || content.querySelector('.qf-callback-command')) return;
    const rows = findRows();
    const counts = phoneEmailCounts(rows);
    const buckets = rows.reduce((acc, row) => {
      const key = classify(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const section = document.createElement('section');
    section.className = 'qf-callback-command';
    section.innerHTML = `
      <div class="qf-callback-command__top">
        <div>
          <div class="qf-callback-command__kicker">Daily call desk</div>
          <h2>Callback queue</h2>
          <p>Work callbacks like a dispatch board: call the hottest request first, confirm the quote context, then move the lead to waiting, won, or lost.</p>
        </div>
        <div class="qf-callback-actions">
          <button type="button" data-qf-callback-action="highlight">Highlight call-first</button>
          <button type="button" data-qf-callback-go="leads">Open leads</button>
          <button type="button" data-qf-callback-go="overview">Overview</button>
        </div>
      </div>
      <div class="qf-callback-scoreboard">
        <div class="qf-callback-metric"><span>Total callbacks</span><strong>${rows.length || '—'}</strong></div>
        <div class="qf-callback-metric"><span>Call first</span><strong>${buckets['Call first'] || 0}</strong></div>
        <div class="qf-callback-metric"><span>Quote context</span><strong>${buckets['Confirm quote'] || 0}</strong></div>
        <div class="qf-callback-metric"><span>Contact signals</span><strong>${counts.phone + counts.email}</strong></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const nav = event.target.closest('[data-qf-callback-go]');
      if (nav) go(nav.dataset.qfCallbackGo);
      if (event.target.closest('[data-qf-callback-action="highlight"]')) highlightRows();
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function addPlan() {
    if (currentRoute() !== 'callbacks' || content.querySelector('.qf-callback-plan')) return;
    const plan = document.createElement('section');
    plan.className = 'qf-callback-plan';
    plan.innerHTML = `
      <div class="qf-callback-card">
        <h3>Call flow</h3>
        <div class="qf-callback-step"><b>1</b><div><strong>Open the quote before calling</strong><span>Check lane, equipment, price, and accessorial assumptions so the call starts with context.</span></div></div>
        <div class="qf-callback-step"><b>2</b><div><strong>Ask one closing question</strong><span>Example: “Do you want me to send the PDF quote, book the truck, or revise the lane?”</span></div></div>
        <div class="qf-callback-step"><b>3</b><div><strong>Update the lead status</strong><span>Leave every call as waiting, won, lost, or needs follow-up. No dead-end callbacks.</span></div></div>
      </div>
      <div class="qf-callback-card">
        <h3>Priority tags</h3>
        <div class="qf-callback-chip-row">
          <span class="qf-callback-chip">Call first</span>
          <span class="qf-callback-chip">Quote sent</span>
          <span class="qf-callback-chip">Needs revision</span>
          <span class="qf-callback-chip">Waiting customer</span>
          <span class="qf-callback-chip">Close / lost</span>
        </div>
        <div class="qf-callback-note"><b>Rule:</b> The callback queue should answer “who do I call next and why?” without opening every lead one by one.</div>
      </div>`;
    const command = content.querySelector('.qf-callback-command');
    if (command && command.nextSibling) command.parentNode.insertBefore(plan, command.nextSibling);
  }

  function highlightRows() {
    findRows().forEach((row) => {
      const hot = classify(row) === 'Call first';
      row.classList.toggle('qf-callback-highlight', hot);
    });
    window.qfToast?.('Call-first callbacks highlighted.', 'success', 'Callback queue');
  }

  function enhance() {
    if (currentRoute() !== 'callbacks') return;
    addCommand();
    addPlan();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 140);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();
