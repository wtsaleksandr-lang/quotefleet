(() => {
  const DEMO_BRAND_KEY = 'qf-demo-brand-preview-v1';
  const FUTURE_CHARGE_RE = /\bdetention\b|\blayover\b|\btonu\b|truck ordered|waiting time|wait time/i;
  const PREVIEW_HOST_RE = /(^localhost$|\.localhost$|\.replit\.dev$|\.repl\.co$|\.picard\.replit\.dev$)/i;

  function shouldRedirectPreviewToDemo() {
    if (window.QF_TENANT_SLUG) return false;
    if (/^\/w\//i.test(location.pathname)) return false;
    if (!PREVIEW_HOST_RE.test(location.hostname)) return false;
    return true;
  }

  if (shouldRedirectPreviewToDemo()) {
    location.replace('/w/demo' + location.search + location.hash);
    return;
  }

  function $(id) { return document.getElementById(id); }
  function loadStylesheet(href) {
    if (document.querySelector('link[href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }
  function readBrand() {
    const fallback = {
      name: 'Your company name',
      phone: 'Phone number',
      email: 'dispatch@yourcompany.com',
      address: 'Company address',
      usdot: 'USDOT #',
      mc: 'MC #',
      logo: '',
    };
    try {
      return Object.assign(fallback, JSON.parse(localStorage.getItem(DEMO_BRAND_KEY) || '{}'));
    } catch (_) {
      return fallback;
    }
  }
  function writeBrand(data) {
    try { localStorage.setItem(DEMO_BRAND_KEY, JSON.stringify(data)); } catch (_) {}
  }
  function isDemoExperience() {
    const headerName = document.querySelector('#qf-header .brand-name');
    const text = headerName ? headerName.textContent || '' : '';
    return /\/w\/demo\b/i.test(location.pathname) || /^demo\b/i.test(text) || /drayage\s*&\s*trucking/i.test(text);
  }
  function ensureLogoSlot(header) {
    let slot = header.querySelector('.qf-demo-logo-slot');
    if (!slot) {
      slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'qf-demo-logo-slot';
      slot.setAttribute('aria-label', 'Customize demo branding');
      slot.addEventListener('click', toggleBrandEditor);
      header.insertBefore(slot, header.firstChild);
    }
    return slot;
  }
  function renderLogoSlot(slot, data) {
    const nextHtml = data.logo ? '<em aria-hidden="true">✎</em>' : '<span>Your logo</span><em aria-hidden="true">✎</em>';
    if (slot.innerHTML !== nextHtml) slot.innerHTML = nextHtml;
    const nextBg = data.logo ? 'url(' + data.logo + ')' : '';
    if (slot.style.backgroundImage !== nextBg) slot.style.backgroundImage = nextBg;
  }
  function toggleBrandEditor() {
    const data = readBrand();
    ensureBrandEditor(data);
    const editor = document.querySelector('.qf-demo-brand-editor');
    if (!editor) return;
    const isOpen = !editor.hidden;
    editor.hidden = isOpen;
    document.body.classList.toggle('qf-demo-brand-editor-open', !isOpen);
    if (isOpen) return;
    const first = editor.querySelector('[data-demo-brand="name"]');
    if (first) setTimeout(() => first.focus(), 40);
    postHeight();
  }
  function applyDemoBrand() {
    if (!isDemoExperience()) return;
    document.body.classList.add('qf-demo-brand-preview');
    const data = readBrand();
    const header = $('qf-header');
    const name = header && header.querySelector('.brand-name');
    if (name && name.textContent !== (data.name || 'Your company name')) name.textContent = data.name || 'Your company name';
    if (header) {
      header.querySelectorAll('img').forEach((img) => img.style.display = 'none');
      const slot = ensureLogoSlot(header);
      renderLogoSlot(slot, data);
    }
    renderBrandTrust(data);
    ensureBrandEditor(data);
  }
  function renderBrandTrust(data) {
    const header = $('qf-header');
    if (!header) return;
    let card = document.querySelector('.qf-demo-brand-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'qf-demo-brand-card';
      header.insertAdjacentElement('afterend', card);
    }
    const mcText = [data.usdot, data.mc].filter(Boolean).join(' · ');
    const nextHtml = [
      data.phone ? '<span>' + escapeHtml(data.phone) + '</span>' : '',
      data.email ? '<span>' + escapeHtml(data.email) + '</span>' : '',
      data.address ? '<span>' + escapeHtml(data.address) + '</span>' : '',
      mcText ? '<span>' + escapeHtml(mcText) + '</span>' : '',
    ].filter(Boolean).join('');
    if (card.innerHTML !== nextHtml) card.innerHTML = nextHtml;
  }
  function ensureBrandEditor(data) {
    if (document.querySelector('.qf-demo-brand-editor')) return;
    const anchor = document.querySelector('.qf-demo-brand-card') || $('qf-header');
    if (!anchor) return;
    const editor = document.createElement('div');
    editor.className = 'qf-demo-brand-editor';
    editor.hidden = true;
    editor.innerHTML = '<div class="qf-demo-brand-editor-head"><strong>Brand preview</strong><button type="button" data-demo-brand-close aria-label="Close branding editor">×</button></div>' +
      '<div class="qf-demo-brand-grid">' +
      '<label>Company name<input class="qf-input" data-demo-brand="name" placeholder="Your company name"></label>' +
      '<label>Phone<input class="qf-input" data-demo-brand="phone" placeholder="(555) 555-1234"></label>' +
      '<label>Email<input class="qf-input" data-demo-brand="email" placeholder="dispatch@yourcompany.com"></label>' +
      '<label>Address<input class="qf-input" data-demo-brand="address" placeholder="City, State"></label>' +
      '<label>USDOT<input class="qf-input" data-demo-brand="usdot" placeholder="USDOT #"></label>' +
      '<label>MC<input class="qf-input" data-demo-brand="mc" placeholder="MC #"></label>' +
      '<label class="qf-demo-logo-upload">Logo preview<input type="file" accept="image/*" data-demo-logo></label>' +
      '</div>';
    anchor.insertAdjacentElement('afterend', editor);
    Object.keys(data).forEach((key) => {
      const input = editor.querySelector('[data-demo-brand="' + key + '"]');
      if (input) input.value = data[key] || '';
    });
    const close = editor.querySelector('[data-demo-brand-close]');
    if (close) close.addEventListener('click', () => {
      editor.hidden = true;
      document.body.classList.remove('qf-demo-brand-editor-open');
      postHeight();
    });
    editor.addEventListener('input', (event) => {
      const key = event.target && event.target.getAttribute('data-demo-brand');
      if (!key) return;
      const next = readBrand();
      next[key] = event.target.value;
      writeBrand(next);
      applyDemoBrand();
      postHeight();
    });
    const logo = editor.querySelector('[data-demo-logo]');
    if (logo) {
      logo.addEventListener('change', () => {
        const file = logo.files && logo.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const next = readBrand();
          next.logo = String(reader.result || '');
          writeBrand(next);
          applyDemoBrand();
          postHeight();
        };
        reader.readAsDataURL(file);
      });
    }
  }
  function removeFutureChargeAddons() {
    document.querySelectorAll('#qf-accessorials .qf-acc-chip').forEach((chip) => {
      if (FUTURE_CHARGE_RE.test(chip.textContent || '') || FUTURE_CHARGE_RE.test(chip.title || '')) {
        chip.remove();
      }
    });
  }
  function simplifyHeader() {
    document.body.classList.add('qf-app-calculator');
    const name = document.querySelector('#qf-header .brand-name');
    if (name && !isDemoExperience()) {
      const current = (name.textContent || '').trim();
      if (!current) name.textContent = 'Instant rate';
    }
    const tagline = $('qf-tagline');
    if (tagline && tagline.textContent) tagline.textContent = '';
    applyDemoBrand();
  }
  function isReefer(value, label) {
    return /reefer|refrigerated/i.test(String(value || '') + ' ' + String(label || ''));
  }
  function sync() {
    simplifyHeader();
    removeFutureChargeAddons();
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
    postHeight();
  }
  function scheduleSync() {
    clearTimeout(scheduleSync.timer);
    scheduleSync.timer = setTimeout(sync, 60);
  }
  function postHeight() {
    try {
      if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'QF_WIDGET_HEIGHT', height: document.documentElement.scrollHeight }, '*');
    } catch (_) {}
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  loadStylesheet('/widget-theme.css');
  loadStylesheet('/public-calculator-mobile-cleanup.css');
  loadStylesheet('/public-calculator-app-style.css');
  loadStylesheet('/public-calculator-brand-preview.css');
  loadStylesheet('/maersk-radius-system.css');
  loadStylesheet('/quotefleet-color-system.css');
  loadStylesheet('/public-calculator-no-gradients.css');
  simplifyHeader();
  document.addEventListener('change', (event) => {
    if (event.target && ['qf-equipment', 'qf-hazmat'].includes(event.target.id)) sync();
  });
  new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true });
  setTimeout(sync, 100);
  setTimeout(sync, 450);
  setTimeout(sync, 900);
})();