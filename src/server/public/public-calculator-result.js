(() => {
  const PANEL_CLASS = 'qf-result-guide';

  function text(id) {
    const node = document.getElementById(id);
    return node ? (node.textContent || '').trim() : '';
  }

  function buildPrintSummary() {
    const result = document.getElementById('qf-result');
    if (!result) return;
    let summary = result.querySelector('.qf-print-summary');
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'qf-print-summary';
      result.appendChild(summary);
    }
    summary.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'qf-print-head';
    const title = document.createElement('strong');
    title.textContent = text('qf-header') || 'QuoteFleet';
    const date = document.createElement('span');
    date.textContent = 'Quote estimate · ' + new Date().toLocaleString();
    head.appendChild(title);
    head.appendChild(date);
    const total = document.createElement('div');
    total.className = 'qf-print-total';
    total.textContent = '$' + text('qf-total');
    const meta = document.createElement('div');
    meta.className = 'qf-print-meta';
    meta.textContent = text('qf-meta');
    const note = document.createElement('p');
    note.className = 'qf-print-note';
    note.textContent = 'Estimate only. Final rate and pickup details are confirmed by the team.';
    summary.appendChild(head);
    summary.appendChild(total);
    summary.appendChild(meta);
    summary.appendChild(note);
  }

  function printQuote() {
    buildPrintSummary();
    document.documentElement.classList.add('qf-printing');
    setTimeout(function () { window.print(); }, 30);
    setTimeout(function () { document.documentElement.classList.remove('qf-printing'); }, 900);
  }

  function buildGuide() {
    const result = document.getElementById('qf-result');
    if (!result || result.style.display === 'none') return;

    const meta = text('qf-meta');
    const total = text('qf-total');
    // Never render a "$0" card: #qf-total counts up from 0 (widget.js
    // animateNumber, ~750ms) and this fires from a MutationObserver mid-count.
    // Wait for a real, non-zero total before building.
    if (!parseFloat(total.replace(/[^0-9.]/g, ''))) return;

    // If the guide already exists, keep its total in sync as the count-up
    // finishes (or the customer re-quotes). Guarded on change so we don't
    // re-trigger the observer in a loop. buildPrintSummary() is intentionally
    // NOT called here (it rewrites DOM and would re-arm the observer) —
    // printQuote() rebuilds the print summary fresh on demand.
    const existing = result.querySelector(`.${PANEL_CLASS}`);
    if (existing) {
      const strong = existing.querySelector('.qf-result-guide-head strong');
      const want = '$' + total;
      if (strong && strong.textContent !== want) strong.textContent = want;
      return;
    }
    buildPrintSummary();

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
      <div class="qf-pdf-actions">
        <button type="button" class="qf-cta qf-secondary qf-print-quote-btn">Print quote</button>
        <small>Use browser print to save a PDF copy.</small>
      </div>
    `;
    guide.querySelector('.qf-print-quote-btn')?.addEventListener('click', printQuote);

    const actions = result.querySelector('.qf-result-actions');
    if (actions) actions.insertAdjacentElement('beforebegin', guide);
    else result.appendChild(guide);
  }

  window.qfPrintQuote = printQuote;
  const observer = new MutationObserver(buildGuide);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  document.addEventListener('click', () => setTimeout(buildGuide, 0), true);
  buildGuide();
})();