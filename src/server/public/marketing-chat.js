/**
 * Floating chat bubble for the QuoteFleet marketing site.
 *
 * Self-contained — no framework, no external deps. Inject by adding a
 * single <script src="/marketing-chat.js" defer></script> to any page
 * on the marketing site. NOT used inside the embeddable widget — that
 * widget has its own inline chat (no floating elements, since it lives
 * in an iframe on customer sites).
 *
 * Talks to POST /api/public/marketing-chat. Conversation history is
 * kept in-memory only — refreshing the page resets the chat.
 *
 * Premium redesign (2026-07): rounded-square gradient launcher with an
 * inline white SVG icon, a bright white panel with a cobalt gradient
 * header + brand avatar, gradient user bubbles, bounce-dot typing,
 * a square paper-plane send button, starter chips on first open, an
 * entrance animation, and a full-screen mobile sheet with a backdrop.
 * Brand cobalt #0D3CFC — a near-1:1 port of the WeFixTrades chat.
 *
 * NOTE ON CLASS NAMES: this widget deliberately AVOIDS the legacy class
 * names `.qf-mc-bubble`, `.qf-mc-bubble-msg`, `.qf-mc-send`, `.qf-mc-input`.
 * Several site-wide CSS "systems" (public-blue-fixes.css,
 * maersk-radius-system.css, quotefleet-color-system.css) are injected on
 * `body.qf-wft` pages and hard-force the OLD flat look onto those exact
 * class names with `!important` (pill launcher, solid fills, 8px card
 * radius, bordered send). Using fresh names (`qf-mc-fab`, `qf-mc-msg`,
 * `qf-mc-submit`, `qf-mc-field`) keeps this redesign fully self-contained
 * and immune to those overrides — no specificity war required.
 */
(function () {
  'use strict';

  if (window.__qfMarketingChatLoaded) return;
  window.__qfMarketingChatLoaded = true;

  // ── inline SVGs (all self-contained, no external requests) ──────
  var ICON_CHAT =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
    '</svg>';
  // QuoteFleet calculator-tile mark, rendered in white for the header avatar.
  var MARK_QF =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">' +
    '<rect x="2"  y="2"  width="9" height="9" rx="2.2"/>' +
    '<rect x="13" y="2"  width="9" height="9" rx="2.2"/>' +
    '<rect x="2"  y="13" width="9" height="9" rx="2.2"/>' +
    '<rect x="13" y="13" width="9" height="9" rx="2.2" fill-opacity="0.75"/>' +
    '</svg>';
  var ICON_SEND =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="22" y1="2" x2="11" y2="13"/>' +
    '<polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
    '</svg>';
  var ICON_CLOSE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // ── styles ─────────────────────────────────────────────────────
  var css = `
    .qf-mc-fab {
      position: fixed; right: 20px; bottom: 20px;
      width: 56px; height: 56px;
      border-radius: 16px;
      background: linear-gradient(135deg, #0D3CFC, #0A2FC4);
      border: 0; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(13,60,252,0.28);
      z-index: 2147483000;
      transition: transform 0.16s cubic-bezier(0.4,0,0.2,1), box-shadow 0.16s ease;
    }
    .qf-mc-fab:hover { transform: scale(1.06); box-shadow: 0 6px 22px rgba(13,60,252,0.38); }
    .qf-mc-fab:focus-visible { outline: 3px solid rgba(13,60,252,0.4); outline-offset: 2px; }
    .qf-mc-fab.open { display: none; }
    .qf-mc-badge {
      position: absolute; top: -6px; right: -6px;
      min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 999px;
      background: #F97316;
      border: 2px solid #ffffff;
      color: #ffffff; font-weight: 800; font-size: 11px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .qf-mc-badge[hidden] { display: none; }

    .qf-mc-backdrop {
      position: fixed; inset: 0; z-index: 2147482999;
      background: rgba(0,0,0,0.4);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity 0.18s ease, visibility 0s linear 0.18s;
    }

    .qf-mc-panel {
      position: fixed; right: 20px; bottom: 20px;
      width: 400px; max-width: calc(100vw - 16px);
      height: 660px; max-height: 92vh;
      background: #ffffff;
      color: #1A1A2E;
      border: 0;
      border-radius: 16px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.08);
      z-index: 2147483001;
      display: flex; flex-direction: column;
      overflow: hidden;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
      opacity: 0; visibility: hidden;
      transform: translateY(12px) scale(0.96);
      transform-origin: bottom right;
      transition: opacity 0.18s cubic-bezier(0.4,0,0.2,1),
                  transform 0.18s cubic-bezier(0.4,0,0.2,1),
                  visibility 0s linear 0.18s;
    }
    .qf-mc-panel.open {
      opacity: 1; visibility: visible;
      transform: translateY(0) scale(1);
      transition: opacity 0.18s cubic-bezier(0.4,0,0.2,1),
                  transform 0.18s cubic-bezier(0.4,0,0.2,1),
                  visibility 0s linear 0s;
    }

    .qf-mc-head {
      padding: 14px 16px;
      background: linear-gradient(135deg, #0D3CFC, #0A2FC4);
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    .qf-mc-avatar {
      width: 34px; height: 34px; flex-shrink: 0;
      border-radius: 10px;
      background: rgba(255,255,255,0.14);
      border: 1.5px solid rgba(255,255,255,0.9);
      display: flex; align-items: center; justify-content: center;
    }
    .qf-mc-head .qf-mc-meta { flex: 1; min-width: 0; }
    .qf-mc-head .title {
      font-weight: 800; color: #ffffff; font-size: 15px; line-height: 1.2;
    }
    .qf-mc-head .sub {
      font-size: 12px; color: rgba(255,255,255,0.85); margin-top: 2px;
      display: flex; align-items: center; gap: 6px; line-height: 1.3;
    }
    .qf-mc-head .sub .live {
      width: 7px; height: 7px; border-radius: 50%;
      background: #34D399; box-shadow: 0 0 6px rgba(52,211,153,0.8);
      flex-shrink: 0;
    }
    .qf-mc-close {
      background: transparent; border: 0; cursor: pointer; padding: 4px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px; opacity: 0.7;
      transition: opacity 0.15s ease;
    }
    .qf-mc-close:hover { opacity: 1; }
    .qf-mc-close:focus-visible { outline: 2px solid rgba(255,255,255,0.7); opacity: 1; }

    .qf-mc-msgs {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
      background: #ffffff;
    }
    .qf-mc-msg {
      padding: 10px 14px;
      font-size: 13px; line-height: 1.5;
      word-wrap: break-word; white-space: pre-wrap;
    }
    .qf-mc-msg.user {
      align-self: flex-end; max-width: 82%;
      background: linear-gradient(135deg, #0D3CFC, #0A2FC4);
      color: #ffffff;
      border-radius: 14px 14px 4px 14px;
    }
    .qf-mc-msg.assistant {
      align-self: flex-start; max-width: 92%;
      background: #ffffff; color: #1A1A2E;
      border: 1px solid #E5E7EB;
      border-radius: 14px 14px 14px 4px;
    }

    .qf-mc-typing {
      align-self: flex-start;
      display: flex; align-items: center; gap: 5px;
      padding: 12px 14px;
      background: #ffffff; border: 1px solid #E5E7EB;
      border-radius: 14px 14px 14px 4px;
    }
    .qf-mc-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #0D3CFC;
      animation: qf-mc-bounce 1.4s ease-in-out infinite both;
    }
    .qf-mc-typing span:nth-child(2) { animation-delay: 0.2s; }
    .qf-mc-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes qf-mc-bounce {
      0%, 60%, 100% { transform: scale(0.6); opacity: 0.4; }
      30% { transform: scale(1); opacity: 1; }
    }

    .qf-mc-chips {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 4px;
    }
    .qf-mc-chip {
      padding: 8px 14px;
      background: #ffffff;
      border: 1px solid #C7D2FE;
      color: #0D3CFC;
      border-radius: 999px;
      font-size: 13px; font-weight: 600; line-height: 1.2;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .qf-mc-chip:hover { background: #EEF2FF; border-color: #0D3CFC; }
    .qf-mc-chip:focus-visible { outline: 2px solid rgba(13,60,252,0.4); outline-offset: 1px; }

    .qf-mc-input-row {
      display: flex; align-items: center; gap: 8px; padding: 12px 14px;
      border-top: 1px solid #E5E7EB;
      background: #ffffff; flex-shrink: 0;
    }
    .qf-mc-field {
      flex: 1; padding: 10px 12px;
      background: #ffffff; color: #1A1A2E;
      border: 1px solid #E5E7EB; border-radius: 10px;
      font-size: 13px; font-family: inherit; line-height: 1.4;
    }
    .qf-mc-field::placeholder { color: #9CA3AF; }
    .qf-mc-field:focus { outline: 0; border-color: #0D3CFC; box-shadow: 0 0 0 3px rgba(13,60,252,0.12); }
    .qf-mc-submit {
      width: 38px; height: 38px; flex-shrink: 0;
      background: linear-gradient(135deg, #0D3CFC, #0A2FC4);
      border: 0; border-radius: 10px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s ease, opacity 0.15s ease;
    }
    .qf-mc-submit:hover:not(:disabled) { transform: scale(1.05); }
    .qf-mc-submit:focus-visible { outline: 3px solid rgba(13,60,252,0.4); outline-offset: 1px; }
    .qf-mc-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .qf-mc-foot {
      padding: 8px 14px 12px;
      font-size: 11px; color: #6b7280;
      text-align: center; line-height: 1.4;
      background: #ffffff; flex-shrink: 0;
    }

    /* Full-screen sheet on phones, with a tappable blurred backdrop. */
    @media (max-width: 480px) {
      .qf-mc-fab {
        bottom: calc(84px + env(safe-area-inset-bottom, 0px));
      }
      .qf-mc-panel {
        top: 72px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); left: 8px;
        width: auto; height: auto; max-width: none; max-height: none;
      }
      .qf-mc-backdrop.open {
        opacity: 1; visibility: visible; pointer-events: auto;
        transition: opacity 0.18s ease, visibility 0s linear 0s;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .qf-mc-panel, .qf-mc-fab, .qf-mc-submit { transition: none; }
      .qf-mc-typing span { animation: none; opacity: 0.7; }
    }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'qf-mc-fab';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat with QuoteFleet');
  btn.innerHTML = ICON_CHAT + '<span class="qf-mc-badge">1</span>';
  document.body.appendChild(btn);

  var backdrop = document.createElement('div');
  backdrop.className = 'qf-mc-backdrop';
  document.body.appendChild(backdrop);

  var panel = document.createElement('div');
  panel.className = 'qf-mc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'QuoteFleet chat');
  panel.innerHTML =
    '<div class="qf-mc-head">' +
      '<div class="qf-mc-avatar">' + MARK_QF + '</div>' +
      '<div class="qf-mc-meta">' +
        '<div class="title">QuoteFleet</div>' +
        '<div class="sub"><span class="live"></span>Online · replies in seconds</div>' +
      '</div>' +
      '<button class="qf-mc-close" id="qf-mc-close" type="button" aria-label="Close chat">' + ICON_CLOSE + '</button>' +
    '</div>' +
    '<div class="qf-mc-msgs" id="qf-mc-msgs"></div>' +
    '<div class="qf-mc-input-row">' +
      '<input class="qf-mc-field" id="qf-mc-input" placeholder="Ask about pricing, features, signup…" autocomplete="off">' +
      '<button class="qf-mc-submit" id="qf-mc-send" type="button" aria-label="Send message">' + ICON_SEND + '</button>' +
    '</div>' +
    '<div class="qf-mc-foot">AI may make mistakes. For specifics, email hello@quotefleet.net</div>';
  document.body.appendChild(panel);

  // ── State + handlers ────────────────────────────────────────────
  var open = false;
  var history = [];
  var greeted = false;
  var msgs = panel.querySelector('#qf-mc-msgs');
  var input = panel.querySelector('#qf-mc-input');
  var sendBtn = panel.querySelector('#qf-mc-send');
  var closeBtn = panel.querySelector('#qf-mc-close');
  var badge = btn.querySelector('.qf-mc-badge');

  var STARTERS = [
    'What does it cost?',
    'How do I get started?',
    "Who's it for?",
    'What can it do?',
  ];

  function openPanel() {
    if (open) return;
    open = true;
    badge.hidden = true;
    if (!greeted) {
      greeted = true;
      appendBubble('assistant', "Hi — I'm the QuoteFleet assistant. Ask me about pricing, features, who we're for, or how to get started.");
      renderChips();
    }
    // Two-frame flip so the entrance animation runs from the hidden state.
    btn.classList.add('open');
    backdrop.classList.add('open');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { panel.classList.add('open'); });
    });
    setTimeout(function () { input.focus(); }, 200);
  }

  function closePanel() {
    if (!open) return;
    open = false;
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    btn.classList.remove('open');
    setTimeout(function () { btn.focus(); }, 0);
  }

  function toggle() { open ? closePanel() : openPanel(); }

  btn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closePanel();
  });

  function renderChips() {
    var wrap = document.createElement('div');
    wrap.className = 'qf-mc-chips';
    STARTERS.forEach(function (label) {
      var chip = document.createElement('button');
      chip.className = 'qf-mc-chip';
      chip.type = 'button';
      chip.textContent = label;
      chip.addEventListener('click', function () {
        input.value = label;
        send();
      });
      wrap.appendChild(chip);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function clearChips() {
    var wrap = msgs.querySelector('.qf-mc-chips');
    if (wrap) wrap.remove();
  }

  function appendBubble(role, text) {
    var b = document.createElement('div');
    b.className = 'qf-mc-msg ' + role;
    b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function appendTyping() {
    var t = document.createElement('div');
    t.className = 'qf-mc-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    msgs.appendChild(t);
    msgs.scrollTop = msgs.scrollHeight;
    return t;
  }

  function send() {
    var msg = (input.value || '').trim();
    if (!msg) return;
    clearChips();
    appendBubble('user', msg);
    input.value = '';
    sendBtn.disabled = true;
    var typing = appendTyping();
    var shownAt = Date.now();

    var payload = {
      message: msg,
      history: history.slice(-12), // last 6 turns
    };

    // Keep the typing indicator visible for at least ~500ms so it never flickers.
    function finish(fn) {
      var elapsed = Date.now() - shownAt;
      var wait = Math.max(0, 500 - elapsed);
      setTimeout(function () {
        typing.remove();
        sendBtn.disabled = false;
        fn();
      }, wait);
    }

    fetch('/api/public/marketing-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        finish(function () {
          if (resp.error) {
            appendBubble('assistant', resp.error);
            return;
          }
          var reply = resp.reply || '(no reply)';
          appendBubble('assistant', reply);
          history.push({ role: 'user', content: msg });
          history.push({ role: 'assistant', content: reply });
        });
      })
      .catch(function () {
        finish(function () {
          appendBubble('assistant', 'Connection error. Try again in a moment.');
        });
      });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
})();
