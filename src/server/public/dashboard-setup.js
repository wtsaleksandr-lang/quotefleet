(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const setupRoutes = ['rates', 'accessorials', 'zones', 'brand', 'ai', 'embed'];
  const routeLabels = {
    rates: ['Rate cards', 'Add your base pricing.'],
    accessorials: ['Accessorials', 'Add chassis, liftgate, hazmat, detention, and other charges.'],
    zones: ['Zones', 'Add port or local flat-tariff areas.'],
    brand: ['Brand page', 'Make the calculator look like your company.'],
    ai: ['AI agent', 'Teach the assistant how to answer customers.'],
    embed: ['Public link', 'Copy the link, add it to signature, or place it on your site.'],
  };

  const routeCoach = {
    rates: { title: 'Start with your most common lane.', text: 'Add one reliable base rate first. You can layer accessorials and drayage zones after the first rate card is saved.', next: 'Next: add common extra charges.', primary: ['Add accessorials', 'accessorials'], secondary: ['Import rates', 'ingest'] },
    accessorials: { title: 'Add charges customers ask about.', text: 'Start with chassis, residential, liftgate, hazmat, storage, detention, and reefer-related charges. Keep labels customer friendly.', next: 'Next: add drayage zones if you quote port work.', primary: ['Add zones', 'zones'], secondary: ['Back to rates', 'rates'] },
    zones: { title: 'Set up local port pricing.', text: 'Use zones for common port/ramp radius pricing. If you do not quote drayage, you can skip this step and publish the link.', next: 'Next: brand the customer page.', primary: ['Brand page', 'brand'], secondary: ['Back to accessorials', 'accessorials'] },
    brand: { title: 'Make the page feel like your company.', text: 'Check logo, display name, colors, contact requirements, and the customer-facing headline before sharing the link.', next: 'Next: set AI guardrails or publish the link.', primary: ['AI setup', 'ai'], secondary: ['Public link', 'embed'] },
    ai: { title: 'Keep AI helpful and safe.', text: 'Answer the onboarding questions below so the calculator assistant follows the carrier rules instead of guessing.', next: 'Next: copy the public link.', primary: ['Public link', 'embed'], secondary: ['Brand page', 'brand'] },
    embed: { title: 'Share the rate page where customers already are.', text: 'Copy the hosted link into email signatures, messages, ads, or your website. Do one live test before sending traffic.', next: 'Next: send a test quote and review it in Leads.', primary: ['Open leads', 'leads'], secondary: ['Preview page', 'overview'] },
  };

  const onboardingQuestions = {
    rates: [
      { id: 'primaryService', q: 'Which service should the calculator quote first?', options: ['FTL dry van', 'LTL', 'Drayage', 'Reefer', 'Hotshot'] },
      { id: 'pricingModel', q: 'How do you usually price that service?', options: ['Rate per mile', 'Flat lane price', 'Minimum charge plus mileage', 'Zone tariff', 'Manual review first'] },
    ],
    accessorials: [
      { id: 'commonCharges', q: 'Which extra charges should customers see most often?', options: ['Liftgate', 'Residential', 'Hazmat', 'Chassis', 'Storage / detention'] },
      { id: 'chargeStyle', q: 'How should extra charges be explained?', options: ['Plain customer language', 'Dispatcher terminology', 'Short labels only', 'Show only when selected'] },
    ],
    zones: [
      { id: 'drayageScope', q: 'Do you quote port or rail ramp work?', options: ['Marine terminals', 'Rail ramps', 'Both port and rail', 'Not right now'] },
      { id: 'zoneMethod', q: 'How do you want zones organized?', options: ['By port code', 'By city radius', 'By terminal', 'By customer lane'] },
    ],
    brand: [
      { id: 'brandVoice', q: 'What should the customer page sound like?', options: ['Professional', 'Friendly', 'Fast and direct', 'Premium / enterprise'] },
      { id: 'contactRules', q: 'What contact info should be required?', options: ['Email required', 'Phone required', 'Email or phone', 'Both email and phone'] },
    ],
    ai: [
      { id: 'aiServices', q: 'What should the AI agent say your company offers?', options: ['FTL and LTL', 'Drayage', 'Reefer / temp-control', 'Local delivery', 'Warehousing support'] },
      { id: 'aiLimits', q: 'What must the AI agent never promise?', options: ['Final price', 'Pickup time', 'Equipment availability', 'Customs or terminal release', 'Delivery date'] },
      { id: 'aiHandoff', q: 'When should AI route the customer to your team?', options: ['Customer asks for firm quote', 'Missing shipment details', 'Hazmat or temp-control', 'Port or terminal issue', 'Anything complex'] },
      { id: 'aiTone', q: 'What tone should the AI agent use?', options: ['Professional', 'Friendly', 'Concise', 'Very detailed', 'Dispatcher-style'] },
    ],
    embed: [
      { id: 'shareWhere', q: 'Where will customers find this calculator?', options: ['Website', 'Email signature', 'Sales messages', 'Google/ads landing page', 'Customer portal'] },
      { id: 'launchTest', q: 'What should be tested before sharing?', options: ['Mobile quote flow', 'Written quote request', 'Callback request', 'AI question flow', 'Print quote output'] },
    ],
  };

  function go(route) {
    const btn = document.querySelector('.sidebar [data-route="' + route + '"]');
    if (btn) btn.click();
    else window.location.href = '/app/' + route;
  }

  function currentRoute() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function hasTableRows() { return content.querySelectorAll('tbody tr').length > 0; }

  // ── real-config progress ──────────────────────────────────────
  // The setup meter reflects the tenant's ACTUAL saved configuration
  // (fetched from the server), not per-browser guided answers — so a
  // tenant who set up rates/brand/AI through the real UI no longer reads
  // 0/6, and the meter is consistent across devices. The guided Q&A
  // below stays as the walkthrough.
  //
  // rates/accessorials/zones ship with working seed defaults at signup,
  // so those areas read "ready" out of the box; brand and AI only count
  // once customized beyond the seed; zones can also be "explicitly
  // skipped" and the public-link step is a local viewed/copied signal.
  const STATUS_FLAG = { zones: 'qf-zones-skipped', embed: 'qf-embed-viewed' };
  function localFlag(key) { try { return localStorage.getItem(key) === '1'; } catch (_e) { return false; } }
  function setLocalFlag(key) { try { localStorage.setItem(key, '1'); } catch (_e) {} }

  function fetchSetupStatus() {
    return fetch('/api/tenant/setup-status', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  // Merge server real-state with the two inherently client-side signals:
  // zones "explicitly skipped" and the public link being "viewed/copied".
  function doneFromStatus(status) {
    status = status || {};
    const zonesSkipped = localFlag(STATUS_FLAG.zones) || getAnswers('zones').drayageScope === 'Not right now';
    return {
      rates: !!status.rates,
      accessorials: !!status.accessorials,
      zones: !!status.zones || zonesSkipped,
      brand: !!status.brand,
      ai: !!status.ai,
      embed: localFlag(STATUS_FLAG.embed),
    };
  }

  function getAnswers(route) {
    try { return JSON.parse(localStorage.getItem('qf-onboarding-' + route) || '{}'); }
    catch (_err) { return {}; }
  }

  function saveAnswer(route, id, value) {
    const answers = getAnswers(route);
    answers[id] = value;
    try { localStorage.setItem('qf-onboarding-' + route, JSON.stringify(answers)); } catch (_err) {}
  }

  function setupPanel() {
    if (content.querySelector('.qf-setup-panel')) return;
    fetchSetupStatus().then((status) => {
      if (currentRoute() !== 'overview') return;
      if (content.querySelector('.qf-setup-panel')) return;
      renderSetupPanel(doneFromStatus(status));
    });
  }

  function renderSetupPanel(doneMap) {
    const total = setupRoutes.length;
    const done = setupRoutes.filter((route) => doneMap[route]);
    const count = done.length;
    const complete = count >= total;
    const nextRoute = setupRoutes.find((route) => !done.includes(route)) || 'embed';
    const nextTitle = routeLabels[nextRoute][0];
    const panel = document.createElement('section');
    panel.className = 'qf-setup-panel' + (complete ? ' is-complete' : '');
    panel.style.setProperty('--qf-setup-pct', Math.round(count / total * 100) + '%');
    if (complete) {
      panel.innerHTML = `
        <div class="qf-setup-live">
          <div class="qf-setup-live-badge"><span class="qf-setup-live-dot">✓</span>You're live</div>
          <h2>Your rate page is ready to share.</h2>
          <p>All ${total} setup areas are ready. Copy your public link and start collecting quotes — you can keep refining rates any time.</p>
          <div class="qf-quick-actions"><button type="button" class="is-primary" data-go="embed">Share your link</button><button type="button" data-go="brand">Fine-tune brand</button><button type="button" data-go="rates">Edit rates</button></div>
        </div>`;
    } else {
      panel.innerHTML = `
        <div class="qf-setup-head"><div><div class="qf-setup-kicker">Calculator setup</div><h2>Get your rate page ready in a few focused steps.</h2><p>Start with rates, add the charges customers ask about, then publish your branded link.</p></div><div class="qf-setup-meter"><span class="qf-setup-score">${count}<small>/${total}</small></span><small>setup areas ready</small><div class="qf-setup-bar" role="progressbar" aria-valuenow="${count}" aria-valuemin="0" aria-valuemax="${total}"><span></span></div></div></div>
        <div class="qf-setup-steps"></div>
        <div class="qf-setup-launch-note"><strong>Next up:</strong> ${nextTitle}. Launch order — rates, accessorials, optional zones, brand, AI guardrails, then the public link.</div>
        <div class="qf-quick-actions"><button type="button" class="is-primary" data-go="${nextRoute}">Continue: ${nextTitle}</button><button type="button" data-go="rates">Edit rates</button><button type="button" data-go="brand">Brand page</button><button type="button" data-go="embed">Share link</button></div>`;
      const steps = panel.querySelector('.qf-setup-steps');
      setupRoutes.forEach((route, index) => {
        const [title, text] = routeLabels[route];
        const isDone = done.includes(route);
        const isCurrent = !isDone && route === nextRoute;
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qf-setup-step' + (isDone ? ' is-done' : (isCurrent ? ' is-current' : ''));
        item.dataset.go = route;
        item.innerHTML = `<span class="qf-setup-dot">${isDone ? '✓' : index + 1}</span><span><strong>${title}</strong><small>${text}</small></span>`;
        steps.appendChild(item);
      });
    }
    panel.addEventListener('click', (event) => { const target = event.target.closest('[data-go]'); if (target) go(target.dataset.go); });
    const first = content.querySelector('h1');
    if (first && first.nextSibling) first.parentNode.insertBefore(panel, first.nextSibling.nextSibling || first.nextSibling);
    else content.prepend(panel);
  }

  function setupCoach(route) {
    if (!setupRoutes.includes(route) || content.querySelector('.qf-setup-coach')) return;
    const copy = routeCoach[route];
    if (!copy) return;
    const coach = document.createElement('section');
    coach.className = 'qf-setup-coach';
    coach.innerHTML = `<div><span>Current setup step</span><strong>${copy.title}</strong><p>${copy.text}</p></div><div class="qf-setup-coach-next"><small>${copy.next}</small><div class="qf-empty-actions"><button type="button" data-go="${copy.primary[1]}">${copy.primary[0]}</button><button type="button" data-go="${copy.secondary[1]}">${copy.secondary[0]}</button></div></div>`;
    coach.addEventListener('click', (event) => { const target = event.target.closest('[data-go]'); if (target) go(target.dataset.go); });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(coach, sub.nextSibling);
    else content.prepend(coach);
  }

  function emptyState(route) {
    if (!['rates', 'accessorials', 'zones'].includes(route)) return;
    if (hasTableRows() || content.querySelector('.qf-setup-empty')) return;
    const copy = {
      rates: ['No rate cards yet.', 'Add one base rate for the service customers request most often. A simple first rate is enough to test the public calculator.', [['Add rate card', 'rates'], ['Import with AI', 'ingest'], ['Review QA matrix', 'overview']]],
      accessorials: ['No extra charges yet.', 'Add the fees customers usually ask about: chassis, liftgate, detention, hazmat, storage, reefer, or residential delivery.', [['Add accessorial', 'accessorials'], ['Ask AI to import', 'ingest'], ['Back to rates', 'rates']]],
      zones: ['No drayage zones yet.', 'Add your common port or ramp radius zones so local pricing works without manual math. Skip this if you do not quote drayage.', [['Add zone', 'zones'], ['Back to rates', 'rates'], ['Brand page', 'brand']]],
    }[route];
    const box = document.createElement('div');
    box.className = 'qf-setup-empty';
    box.innerHTML = `<strong>${copy[0]}</strong><p>${copy[1]}</p><div class="qf-setup-empty-checks"><span>Start small</span><span>Save once</span><span>Test a quote</span></div><div class="qf-empty-actions"></div>`;
    const actions = box.querySelector('.qf-empty-actions');
    copy[2].forEach(([label, target]) => { const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = label; btn.dataset.go = target; actions.appendChild(btn); });
    box.addEventListener('click', (event) => { const target = event.target.closest('[data-go]'); if (target) go(target.dataset.go); });
    const coach = content.querySelector('.qf-setup-coach');
    if (coach && coach.nextSibling) coach.parentNode.insertBefore(box, coach.nextSibling);
    else content.prepend(box);
  }

  function buildSummary(route) {
    const answers = getAnswers(route);
    const questions = onboardingQuestions[route] || [];
    return questions.map((item) => item.q + ' ' + (answers[item.id] || 'Not answered yet')).join('\n');
  }

  function applyAiAnswers() {
    const prompt = Array.from(content.querySelectorAll('textarea')).find((field) => /system prompt/i.test(field.closest('.field')?.textContent || '')) || content.querySelector('textarea');
    if (!prompt) return;
    const block = 'AI agent onboarding answers:\n' + buildSummary('ai') + '\n\nRules: never guarantee final rate, equipment availability, pickup time, delivery date, customs release, terminal status, or dispatch confirmation. Suggest callback or written quote when the request needs human review.';
    prompt.value = prompt.value.trim() ? prompt.value.trim() + '\n\n' + block : block;
    prompt.dispatchEvent(new Event('blur', { bubbles: true }));
    if (window.qfToastOk) window.qfToastOk('AI onboarding answers added');
  }

  function onboardingPanel(route) {
    if (!setupRoutes.includes(route) || content.querySelector('.qf-onboarding-panel')) return;
    const questions = onboardingQuestions[route] || [];
    if (!questions.length) return;
    const answers = getAnswers(route);
    const panel = document.createElement('section');
    panel.className = 'qf-onboarding-panel';
    panel.innerHTML = `<div class="qf-onboarding-head"><div><div class="qf-setup-kicker">Guided onboarding</div><h3>${route === 'ai' ? 'Train this customer AI agent.' : 'Answer a few setup questions.'}</h3><p>Pick a quick answer or write a custom answer. Your choices stay in this browser as setup guidance.</p></div>${route === 'ai' ? '<button type="button" class="qf-onboarding-apply">Apply to AI prompt</button>' : ''}</div><div class="qf-onboarding-list"></div>`;
    const list = panel.querySelector('.qf-onboarding-list');
    questions.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'qf-onboarding-question';
      card.dataset.question = item.id;
      card.innerHTML = `<strong>${item.q}</strong><div class="qf-onboarding-options"></div><div class="qf-onboarding-custom"><input class="input" placeholder="Custom answer"><button type="button">Save custom</button></div><small>${answers[item.id] ? 'Selected: ' + answers[item.id] : 'No answer selected yet.'}</small>`;
      const opts = card.querySelector('.qf-onboarding-options');
      item.options.forEach((option) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = option;
        btn.className = answers[item.id] === option ? 'is-selected' : '';
        btn.addEventListener('click', () => { saveAnswer(route, item.id, option); panel.remove(); onboardingPanel(route); });
        opts.appendChild(btn);
      });
      const input = card.querySelector('input');
      const customBtn = card.querySelector('.qf-onboarding-custom button');
      customBtn.addEventListener('click', () => { const value = input.value.trim(); if (!value) return; saveAnswer(route, item.id, value); panel.remove(); onboardingPanel(route); });
      list.appendChild(card);
    });
    const apply = panel.querySelector('.qf-onboarding-apply');
    if (apply) apply.addEventListener('click', applyAiAnswers);
    const coach = content.querySelector('.qf-setup-coach');
    if (coach && coach.nextSibling) coach.parentNode.insertBefore(panel, coach.nextSibling);
    else content.prepend(panel);
  }

  function enhance() {
    const route = currentRoute();
    // Visiting the public-link page counts as "viewed/copied" — the last
    // guided-setup step and the trigger for the "You're live" state.
    if (route === 'embed') setLocalFlag(STATUS_FLAG.embed);
    if (route === 'overview') setupPanel();
    // The brand route is now the dedicated "Customize" panel (Wave 2), and the
    // accessorials route is now the dedicated "Add-ons" panel — both own their
    // own layout, so do NOT inject the setup kicker / coach / onboarding
    // questions there. They stay in setupRoutes so the Overview meter still
    // counts them as setup areas.
    if (setupRoutes.includes(route) && route !== 'brand' && route !== 'accessorials') {
      const h1 = content.querySelector('h1');
      if (h1 && !content.querySelector('.qf-setup-kicker-inline')) {
        const label = document.createElement('div');
        label.className = 'qf-setup-kicker qf-setup-kicker-inline';
        label.textContent = 'Calculator setup';
        h1.parentNode.insertBefore(label, h1);
      }
      setupCoach(route);
      onboardingPanel(route);
      emptyState(route);
    }
  }

  let timer;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(enhance, 80); });
  observer.observe(content, { childList: true, subtree: false });
  window.addEventListener('popstate', () => setTimeout(enhance, 80));
  setTimeout(enhance, 300);
})();