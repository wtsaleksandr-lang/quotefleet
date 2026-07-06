(() => {
  const PANEL_CLASS = 'qf-result-guide';

  function text(id) {
    const node = document.getElementById(id);
    return node ? (node.textContent || '').trim() : '';
  }

  function buildGuide() {
    const result = document.getElementById('qf-result');
    if (!result || result.style.display === 'none') return;
    if (result.querySelector(`.${PANEL_CLASS}`)) return;

    const meta = text('qf-meta');
    const total = text('qf-total');
    const service = meta.split('·')[1]?.trim() || 'freight move';

    const guide = document.createElement('div');
    guide.className = PANEL_CLASS;
    guide.innerHTML = `
      <div class="qf-result-guide-head">
        <span class="qf-result-pill">Estimate ready</span>
        <strong>$${total}</strong>
      </div>
      <div class="qf-result-next">
        <b>Next step:</b> send this in writing so the team can confirm availability, timing, and any accessorials before dispatch.
      </div>
      <div class="qf-result-mini-grid" aria-label="Quote readiness checklist">
        <span>Rate estimate</span>
        <span>${service}</span>
        <span>Written follow-up</span>
      </div>
    `;

    const actions = result.querySelector('.qf-result-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', guide);
    else result.appendChild(guide);
  }

  const observer = new MutationObserver(buildGuide);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  document.addEventListener('click', () => setTimeout(buildGuide, 0), true);
  buildGuide();
})();