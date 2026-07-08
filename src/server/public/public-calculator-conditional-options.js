(() => {
  function $(id) { return document.getElementById(id); }
  function loadStylesheet(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  function simplifyHeader() {
    document.body.classList.add('qf-app-calculator');
    const header = $('qf-header');
    const name = header && header.querySelector('.brand-name');
    if (name) {
      const current = (name.textContent || '').trim();
      if (!current || /^demo\b/i.test(current) || /drayage\s*&\s*trucking/i.test(current)) {
        name.textContent = 'Instant rate';
      }
    }
    const tagline = $('qf-tagline');
    if (tagline) tagline.textContent = '';
  }
  function isReefer(value, label) {
    return /reefer|refrigerated/i.test(String(value || '') + ' ' + String(label || ''));
  }
  function sync() {
    simplifyHeader();
    const equipment = $('qf-equipment');
    const genset = $('qf-genset-panel');
    const hazmat = $('qf-hazmat');
    const hazmatPanel = $('qf-hazmat-panel');
    if (equipment && genset) {
      const selected = equipment.options[equipment.selectedIndex];
      const showGenset = isReefer(equipment.value, selected && selected.textContent);
      genset.style.display = showGenset ? '' : 'none';
      if (!showGenset && $('qf-genset')) $('qf-genset').checked = false;
    }
    if (hazmat && hazmatPanel) {
      hazmatPanel.style.display = hazmat.checked ? '' : 'none';
      if (!hazmat.checked && $('qf-hazmat-class')) $('qf-hazmat-class').value = '';
    }
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'QF_WIDGET_HEIGHT', height: document.documentElement.scrollHeight }, '*');
    } catch (_) {}
  }
  loadStylesheet('/public-calculator-mobile-cleanup.css');
  loadStylesheet('/public-calculator-app-style.css');
  simplifyHeader();
  document.addEventListener('change', (event) => {
    if (event.target && ['qf-equipment', 'qf-hazmat'].includes(event.target.id)) sync();
  });
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  setTimeout(sync, 100);
  setTimeout(sync, 450);
  setTimeout(sync, 900);
})();
