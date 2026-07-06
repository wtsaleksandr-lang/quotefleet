(() => {
  const PANEL_CLASS = 'qf-embed-launch-studio';
  const GRID_CLASS = 'qf-embed-launch-grid';

  function cardTitle(card) {
    const title = card && card.querySelector('.card-title');
    return title ? (title.textContent || '').trim() : '';
  }

  function mount() {
    if (!location.pathname.startsWith('/app/embed')) return;
    const page = document.querySelector('#page-content');
    if (!page || page.querySelector(`.${PANEL_CLASS}`)) return;

    const cards = Array.from(page.querySelectorAll('.card'));
    const previewCard = cards.find((card) => /live preview/i.test(cardTitle(card)));
    const embedCard = cards.find((card) => /js embed/i.test(cardTitle(card)));
    if (!previewCard || !embedCard) return;

    const panel = document.createElement('section');
    panel.className = PANEL_CLASS;
    panel.innerHTML = `
      <div class="qf-embed-launch-head">
        <div>
          <span>Launch workspace</span>
          <strong>Preview, copy, and publish with confidence</strong>
        </div>
        <a href="/app/brand" class="btn btn-secondary">Review brand</a>
      </div>
      <div class="qf-embed-launch-steps">
        <div><b>1. Preview</b><small>Confirm the public calculator looks right before install.</small></div>
        <div><b>2. Copy</b><small>Use the auto-resize snippet for normal website pages.</small></div>
        <div><b>3. Test</b><small>Submit one internal quote request after publishing.</small></div>
      </div>
    `;

    const grid = document.createElement('div');
    grid.className = GRID_CLASS;
    previewCard.insertAdjacentElement('beforebegin', panel);
    panel.insertAdjacentElement('afterend', grid);
    grid.appendChild(previewCard);
    grid.appendChild(embedCard);
  }

  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => setTimeout(mount, 0), true);
  mount();
})();