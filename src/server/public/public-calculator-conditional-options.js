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
  // Defaults for the "brand it yourself" preview come from the carrier's REAL
  // resolved widget config (exposed by widget.js as window.QF_WIDGET_CONFIG),
  // so the demo opens on a credible, filled-in sample carrier (name, logo,
  // phone, dispatch email, address, USDOT/MC) instead of blank "Your company
  // name" / "Your logo" placeholders that read as an unconfigured shell. Any
  // value the prospect types is saved to localStorage and overrides the
  // default.
  function configDefaults() {
    const cfg = (typeof window !== 'undefined' && window.QF_WIDGET_CONFIG) || {};
    const b = cfg.brand || {};
    const c = cfg.contact || {};
    const t = cfg.tenant || {};
    return {
      name: b.displayName || t.name || 'Your company name',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      usdot: c.dotNumber || '',
      mc: c.mcNumber || '',
      logo: b.logoUrl || '',
    };
  }
  // URL-param prefill layer for the "Find your company" hero. When the demo is
  // opened as /w/demo?company=…&usdot=…&mc=…&city=…&state=…&phone=…, these map
  // onto the brand fields so the demo reads as THAT carrier. Only fields present
  // in the URL are returned (so a param-less load falls straight through to
  // localStorage → configDefaults() → the default demo, unchanged). This is a
  // read-only layer — it is NOT written to localStorage, so it never "sticks"
  // past a param-less reload.
  function urlBrand() {
    const out = {};
    try {
      const p = new URLSearchParams(location.search);
      const company = (p.get('company') || '').trim();
      if (company) out.name = company;
      const usdot = (p.get('usdot') || '').trim();
      if (usdot) out.usdot = usdot;
      const mc = (p.get('mc') || '').trim();
      if (mc) out.mc = mc;
      const phone = (p.get('phone') || '').trim();
      if (phone) out.phone = phone;
      const city = (p.get('city') || '').trim();
      const state = (p.get('state') || '').trim();
      const address = [city, state].filter(Boolean).join(', ');
      if (address) out.address = address;
    } catch (_) {}
    return out;
  }
  function readBrand() {
    const fallback = configDefaults();
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(DEMO_BRAND_KEY) || '{}'); } catch (_) {}
    // Priority: URL params (highest) > localStorage > configDefaults().
    return Object.assign(fallback, stored, urlBrand());
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
    // Paint the logo via a CSS custom property (not a direct background-image):
    // `public-calculator-no-gradients.css` forces `.qf-header * { background-image:
    // none !important }`, which would otherwise wipe a direct inline background.
    // A dedicated higher-specificity rule reads this var (see brand-preview.css).
    const nextBg = data.logo ? 'url("' + data.logo + '")' : '';
    if (slot.style.getPropertyValue('--qf-demo-logo-img') !== nextBg) {
      slot.style.setProperty('--qf-demo-logo-img', nextBg);
    }
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
  // When the demo is opened as THIS visitor's carrier (/w/demo?company=…&usdot=…
  // &mc=…&city=…&state=…&phone=… from the landing "Find your company" hero), the
  // visible header NAME is handled by applyDemoBrand below, but the credential
  // block (address · USDOT · MC · phone · email) is rendered separately by
  // widget.js renderCredMeta() straight from window.QF_WIDGET_CONFIG.contact —
  // i.e. the demo-tenant (Harbor Link) values. Patch that config IN PLACE with
  // the URL carrier identity, then re-render the header, so the credentials read
  // as the visitor instead of Harbor Link. Idempotent + loop-safe (a signature
  // guard skips the rebuild once the live config already carries it). With no
  // carrier params we never touch the config → the default demo is unchanged.
  function applyUrlCarrierCredentials() {
    const u = urlBrand();
    const personalizing = !!(u.name || u.usdot || u.mc || u.phone || u.address);
    if (!personalizing) return;
    const cfg = (typeof window !== 'undefined' && window.QF_WIDGET_CONFIG) || null;
    if (!cfg) return;
    const c = cfg.contact || (cfg.contact = {});
    const sig = [u.usdot || '', u.mc || '', u.phone || '', u.address || ''].join('|');
    // Already applied to the live config → nothing to rebuild (also breaks the
    // render → MutationObserver → sync → render loop). Re-applies after a soft
    // config refetch resets contact back to the Harbor Link default.
    if (c.__qfCarrierSig === sig && c.email === '') return;
    // Replace the demo-tenant identity wholesale so NO Harbor Link credential
    // leaks under the visitor's name: each field from the URL (blank when the
    // FMCSA record omits it), and CLEAR email (the visitor's is unknown).
    c.dotNumber = u.usdot || '';
    c.mcNumber = u.mc || '';
    c.phone = u.phone || '';
    c.address = u.address || '';
    c.email = '';
    c.__qfCarrierSig = sig;
    if (typeof window.QF_RERENDER_HEADER === 'function') window.QF_RERENDER_HEADER();
  }
  function applyDemoBrand() {
    if (!isDemoExperience()) return;
    document.body.classList.add('qf-demo-brand-preview');
    // Patch the widget config's contact block from the URL carrier params BEFORE
    // reading/setting the visible name, so a header re-render triggered here
    // can't leave Harbor Link's name (the name set below re-asserts the visitor).
    applyUrlCarrierCredentials();
    const data = readBrand();
    const header = $('qf-header');
    const name = header && header.querySelector('.brand-name');
    if (name && name.textContent !== (data.name || 'Your company name')) name.textContent = data.name || 'Your company name';
    if (header) {
      header.querySelectorAll('img').forEach((img) => img.style.display = 'none');
      const slot = ensureLogoSlot(header);
      renderLogoSlot(slot, data);
    }
    // The demo trust card below the header now carries the (real) contact
    // details, so hide the widget's own contact block to avoid showing the
    // same phone/email/address/authority twice.
    const contactBox = $('qf-contact');
    if (contactBox) contactBox.style.display = 'none';
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
    // De-dup with the calculator header credential meta-lines. When
    // brand.headerShowCredentials !== false (the default), widget.js's
    // renderCredMeta already prints the FULL identity unit under the company
    // name — address (line 1), USDOT/MC (line 2), phone/email (line 3) — so
    // repeating ANY of them on this trust card shows the same values twice (the
    // live-demo bug: the address orphaned in a grey pill above the header block
    // that already carries it). renderCredMeta now owns the address too, so in
    // the default (creds-in-header) case this card has nothing unique to add and
    // stays out of the flow. Only with credentials hidden in the header (toggle
    // off) does the full set — address included — return here as the fallback, so
    // nothing is ever lost and nothing is ever shown twice. Mirrors renderContact().
    const cfg = (typeof window !== 'undefined' && window.QF_WIDGET_CONFIG) || {};
    const credsInHeader = !cfg.brand || cfg.brand.headerShowCredentials !== false;
    const mcText = [data.usdot ? 'USDOT ' + data.usdot : '', data.mc ? 'MC ' + data.mc : ''].filter(Boolean).join(' · ');
    const nextHtml = [
      !credsInHeader && data.phone ? '<span>' + escapeHtml(data.phone) + '</span>' : '',
      !credsInHeader && data.email ? '<span>' + escapeHtml(data.email) + '</span>' : '',
      !credsInHeader && data.address ? '<span>' + escapeHtml(data.address) + '</span>' : '',
      !credsInHeader && mcText ? '<span>' + escapeHtml(mcText) + '</span>' : '',
    ].filter(Boolean).join('');
    // Nothing unique to show (creds live in the header, no address set) → keep the
    // card out of the flow entirely so it leaves no empty gap.
    card.style.display = nextHtml ? '' : 'none';
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