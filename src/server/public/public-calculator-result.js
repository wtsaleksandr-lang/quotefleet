(() => {
  // Print helper for the quote estimate. The old readiness guide card (a mini
  // grid + its own Print button) was retired for the minimal result — the
  // widget's compact "Print / PDF" action calls window.qfPrintQuote directly.
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

  window.qfPrintQuote = printQuote;
})();
