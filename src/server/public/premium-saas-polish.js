(() => {
  function loadAsset(tag, attrs) {
    const selector = attrs.href ? `${tag}[href="${attrs.href}"]` : `${tag}[src="${attrs.src}"]`;
    if (document.querySelector(selector)) return;
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    document.head.appendChild(el);
  }

  loadAsset('link', { rel: 'stylesheet', href: '/followup-workspace.css' });
  loadAsset('link', { rel: 'stylesheet', href: '/lead-crm-polish.css' });
  loadAsset('link', { rel: 'stylesheet', href: '/leads-list-focus.css' });
  loadAsset('link', { rel: 'stylesheet', href: '/drayage-zone-polish.css' });
  loadAsset('link', { rel: 'stylesheet', href: '/ai-import-polish.css' });
  loadAsset('link', { rel: 'stylesheet', href: '/share-readiness.css' });
  window.addEventListener('load', () => loadAsset('script', { src: '/followup-workspace.js' }));
  window.addEventListener('load', () => loadAsset('script', { src: '/lead-crm-polish.js' }));
  window.addEventListener('load', () => loadAsset('script', { src: '/leads-list-focus.js' }));
  window.addEventListener('load', () => loadAsset('script', { src: '/drayage-zone-polish.js' }));
  window.addEventListener('load', () => loadAsset('script', { src: '/ai-import-polish.js' }));
  window.addEventListener('load', () => loadAsset('script', { src: '/share-readiness.js' }));

  function toast(message, tone = 'success', title = 'QuoteFleet') {
    let stack = document.querySelector('.qf-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'qf-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const item = document.createElement('div');
    item.className = 'qf-toast ' + tone;
    item.innerHTML = `<strong>${title}</strong><small>${message}</small>`;
    stack.appendChild(item);
    setTimeout(() => item.remove(), 4200);
  }

  function ensureModal() {
    let modal = document.querySelector('.qf-modal-backdrop');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'qf-modal-backdrop';
    modal.innerHTML = `<div class="qf-modal-card" role="dialog" aria-modal="true"><h3>Confirm action</h3><p>This action needs confirmation.</p><div class="qf-modal-actions"><button type="button" class="btn qf-modal-cancel">Cancel</button><button type="button" class="btn btn-primary qf-modal-confirm">Continue</button></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal || event.target.closest('.qf-modal-cancel')) modal.classList.remove('is-open');
    });
    return modal;
  }

  window.qfToast = toast;
  window.qfConfirm = function qfConfirm({ title = 'Confirm action', message = 'Continue?', confirm = 'Continue' } = {}) {
    const modal = ensureModal();
    modal.querySelector('h3').textContent = title;
    modal.querySelector('p').textContent = message;
    modal.querySelector('.qf-modal-confirm').textContent = confirm;
    modal.classList.add('is-open');
    return new Promise((resolve) => {
      const confirmBtn = modal.querySelector('.qf-modal-confirm');
      const done = (value) => {
        modal.classList.remove('is-open');
        confirmBtn.removeEventListener('click', onConfirm);
        resolve(value);
      };
      const onConfirm = () => done(true);
      confirmBtn.addEventListener('click', onConfirm, { once: true });
    });
  };

  window.addEventListener('qf:toast', (event) => {
    const detail = event.detail || {};
    toast(detail.message || 'Saved.', detail.tone || 'success', detail.title || 'QuoteFleet');
  });

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('.app-main button');
    if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;
    const text = (btn.textContent || '').trim();
    if (/save|add|update|send|copy|publish/i.test(text)) {
      btn.classList.add('is-loading');
      setTimeout(() => btn.classList.remove('is-loading'), 700);
    }
  }, true);

  const loading = document.getElementById('loading');
  if (loading) {
    const skeleton = document.createElement('div');
    skeleton.className = 'qf-page-skeleton';
    skeleton.innerHTML = '<span></span><span></span><span></span>';
    loading.querySelector('div')?.appendChild(skeleton);
  }
})();
