(() => {
  function ensureMark() {
    const header = document.getElementById('qf-header');
    if (!header || header.querySelector('img') || header.querySelector('.qf-brand-mark')) return;
    const mark = document.createElement('span');
    mark.className = 'qf-brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = 'QF';
    header.insertAdjacentElement('afterbegin', mark);
  }

  const observer = new MutationObserver(ensureMark);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', ensureMark);
  ensureMark();
})();