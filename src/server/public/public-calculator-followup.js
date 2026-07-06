(() => {
  const PANEL_CLASS = 'qf-followup-choice-panel';

  function mount() {
    const thanks = document.getElementById('qf-step-thanks');
    const actions = document.querySelector('.qf-thanks-actions');
    if (!thanks || !actions || thanks.querySelector(`.${PANEL_CLASS}`)) return;

    const panel = document.createElement('section');
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="qf-followup-choice-head">
        <span>Need help?</span>
        <strong>Choose the fastest follow-up path</strong>
      </div>
      <div class="qf-followup-choice-grid">
        <div>
          <b>Ask AI</b>
          <small>Best for transit time, accessorials, paperwork, or quote questions.</small>
        </div>
        <div>
          <b>Request callback</b>
          <small>Best when timing, pickup readiness, or special handling needs a dispatcher.</small>
        </div>
      </div>
    `;

    actions.insertAdjacentElement('beforebegin', panel);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(mount, 0), true);
  mount();
})();