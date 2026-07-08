(() => {
  const content = document.getElementById('page-content');
  if (!content) return;

  const presets = {
    services: 'Services offered: answer only for the freight services configured by the carrier. Ask for pickup, delivery, equipment, cargo weight, and timing before detailed guidance.',
    limits: 'Answer limits: do not guarantee final price, pickup time, transit time, equipment availability, terminal status, booking, or dispatch confirmation. Final confirmation belongs to the carrier team.',
    handoff: 'Human handoff: suggest a callback when details are missing, pricing is complex, the customer asks for a firm quote, or the shipment needs human review.',
    written: 'Written quote: suggest the written quote flow when the customer has lane, service, equipment, cargo, and contact details. A printable estimate is not a binding booking.',
    questions: 'Common questions: explain accessorials in plain language. For billing, claims, legal, customs, or safety-sensitive questions, route to the carrier team.'
  };

  function route() {
    return (location.pathname.split('/app/')[1] || 'overview').split('/')[0] || 'overview';
  }

  function go(target) {
    document.querySelector('.sidebar [data-route="' + target + '"]')?.click();
  }

  function promptBox() {
    const fields = Array.from(content.querySelectorAll('textarea'));
    return fields.find((field) => /system prompt/i.test(field.closest('.field')?.textContent || '')) || fields[0];
  }

  function addPreset(key) {
    const field = promptBox();
    if (!field || !presets[key]) return;
    const next = field.value.trim() ? field.value.trim() + '\n\n' + presets[key] : presets[key];
    field.value = next;
    field.focus();
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    if (window.qfToastOk) window.qfToastOk('AI preset added');
  }

  function panel() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-setup')) return;
    const section = document.createElement('section');
    section.className = 'qf-ai-setup';
    section.innerHTML = `
      <div class="qf-ai-top">
        <div>
          <div class="qf-ai-kicker">AI setup</div>
          <h2>Give the assistant clear rules before customers use it.</h2>
          <p>Set the basics once: what your company does, what the assistant can answer, and when it should send the customer to your team.</p>
        </div>
        <div class="qf-ai-actions">
          <button type="button" data-ai-go="brand">Brand page</button>
          <button type="button" data-ai-go="embed">Share setup</button>
          <button type="button" data-ai-go="ingest">Import info</button>
        </div>
      </div>
      <div class="qf-ai-grid">
        <div class="qf-ai-card"><span>Company rules</span><strong>How your team works</strong><p>Service area, business hours, quote process, and what details customers must provide.</p></div>
        <div class="qf-ai-card"><span>Services offered</span><strong>What customers can ask about</strong><p>Drayage, FTL, local delivery, accessorials, equipment, and quote requirements.</p></div>
        <div class="qf-ai-card"><span>Do not promise</span><strong>Keep answers safe</strong><p>No guaranteed price, transit time, equipment availability, or booking confirmation unless your team confirms it.</p></div>
        <div class="qf-ai-card"><span>Callback trigger</span><strong>When to route to team</strong><p>Use callback when details are missing, pricing is complex, or the customer asks for a firm quote.</p></div>
        <div class="qf-ai-card"><span>Written quote trigger</span><strong>When to create a document</strong><p>Suggest a written quote after the customer has enough lane, service, and contact details.</p></div>
        <div class="qf-ai-card"><span>Common questions</span><strong>Answer repeated questions</strong><p>Accessorials, service coverage, quote validity, contact method, and required shipment details.</p></div>
      </div>`;
    section.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ai-go]');
      if (btn) go(btn.dataset.aiGo);
    });
    const sub = content.querySelector('.page-sub');
    if (sub && sub.nextSibling) sub.parentNode.insertBefore(section, sub.nextSibling);
    else content.prepend(section);
  }

  function presetsPanel() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-presets')) return;
    const el = document.createElement('section');
    el.className = 'qf-ai-presets';
    el.innerHTML = `
      <div>
        <div class="qf-ai-kicker">Launch presets</div>
        <strong>Add guardrails to the system prompt.</strong>
        <p>Click a preset, review the prompt, then leave the field to save. These rules keep customer answers helpful without making final freight promises.</p>
      </div>
      <div class="qf-ai-preset-buttons">
        <button type="button" data-ai-preset="services">Services offered</button>
        <button type="button" data-ai-preset="limits">Answer limits</button>
        <button type="button" data-ai-preset="handoff">Callback handoff</button>
        <button type="button" data-ai-preset="written">Written quote</button>
        <button type="button" data-ai-preset="questions">Common questions</button>
      </div>`;
    el.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ai-preset]');
      if (btn) addPreset(btn.dataset.aiPreset);
    });
    const safety = content.querySelector('.qf-ai-safety');
    if (safety && safety.nextSibling) safety.parentNode.insertBefore(el, safety.nextSibling);
  }

  function safetyNote() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-safety')) return;
    const el = document.createElement('div');
    el.className = 'qf-ai-safety';
    el.innerHTML = '<b>Safety rule:</b> The assistant should help customers move forward, not make final promises. Keep final rate, booking, and availability confirmation with your team.';
    const panelEl = content.querySelector('.qf-ai-setup');
    if (panelEl && panelEl.nextSibling) panelEl.parentNode.insertBefore(el, panelEl.nextSibling);
  }

  function chatMock() {
    if (route() !== 'ai' || content.querySelector('.qf-ai-chat-mock')) return;
    const el = document.createElement('section');
    el.className = 'qf-ai-chat-mock';
    el.innerHTML = `
      <strong>Example customer conversation</strong>
      <div class="qf-ai-bubbles">
        <div class="qf-ai-bubble customer">Can you guarantee pickup today?</div>
        <div class="qf-ai-bubble agent">I can help collect the details, but final pickup availability must be confirmed by the team. Please send pickup location, delivery location, equipment type, and preferred time.</div>
        <div class="qf-ai-bubble customer">Can I get a written quote?</div>
        <div class="qf-ai-bubble agent">Yes. After you provide the required shipment details, you can request a written quote or ask for a callback.</div>
      </div>`;
    const presets = content.querySelector('.qf-ai-presets') || content.querySelector('.qf-ai-safety');
    if (presets && presets.nextSibling) presets.parentNode.insertBefore(el, presets.nextSibling);
  }

  function enhance() {
    if (route() !== 'ai') return;
    panel();
    safetyNote();
    presetsPanel();
    chatMock();
  }

  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(enhance, 120);
  }).observe(content, { childList: true, subtree: false });
  setTimeout(enhance, 500);
})();