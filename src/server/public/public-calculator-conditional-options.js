(() => {
  function $(id) { return document.getElementById(id); }
  function isReefer(value, label) {
    return /reefer|refrigerated/i.test(String(value || '') + ' ' + String(label || ''));
  }
  function sync() {
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
  document.addEventListener('change', (event) => {
    if (event.target && ['qf-equipment', 'qf-hazmat'].includes(event.target.id)) sync();
  });
  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  setTimeout(sync, 250);
  setTimeout(sync, 900);
})();
