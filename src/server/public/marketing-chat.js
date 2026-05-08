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
 */
(function () {
  'use strict';

  if (window.__qfMarketingChatLoaded) return;
  window.__qfMarketingChatLoaded = true;

  // ── styles ─────────────────────────────────────────────────────
  var css = `
    .qf-mc-bubble {
      position: fixed; right: 20px; bottom: 20px;
      width: 56px; height: 56px;
      border-radius: 50%;
      background: var(--accent, #5EEAD4);
      color: var(--accent-ink, #07232A);
      border: 0; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 6px 24px rgba(0,0,0,0.25);
      z-index: 9999;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      font-size: 24px; line-height: 1;
    }
    .qf-mc-bubble:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
    .qf-mc-bubble.open { background: var(--surface-2, #2A2A2D); color: var(--accent, #5EEAD4); }

    .qf-mc-panel {
      position: fixed; right: 20px; bottom: 90px;
      width: min(380px, calc(100vw - 40px));
      max-height: min(560px, calc(100vh - 120px));
      background: var(--surface, #1B2123);
      color: var(--ink-soft, #ECECEE);
      border: 1px solid var(--border-strong, #3E3F42);
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      z-index: 9999;
      display: none;
      flex-direction: column;
      font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
      overflow: hidden;
    }
    .qf-mc-panel.open { display: flex; }
    .qf-mc-head {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border, #2A2A2D);
      display: flex; align-items: center; gap: 10px;
    }
    .qf-mc-head .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--accent, #5EEAD4);
      box-shadow: 0 0 8px var(--accent, #5EEAD4);
    }
    .qf-mc-head .title { font-weight: 700; color: var(--ink, #fff); font-size: 15px; }
    .qf-mc-head .sub { font-size: 11px; color: var(--muted, #909192); margin-top: 2px;
                       font-family: var(--font-mono, monospace); letter-spacing: 0.06em; text-transform: uppercase; }
    .qf-mc-msgs {
      flex: 1; overflow-y: auto; padding: 14px 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .qf-mc-bubble-msg {
      padding: 9px 13px; border-radius: 12px;
      font-size: 13.5px; line-height: 1.5;
      max-width: 88%;
      word-wrap: break-word;
    }
    .qf-mc-bubble-msg.user {
      align-self: flex-end;
      background: var(--accent, #5EEAD4); color: var(--accent-ink, #07232A);
      border-bottom-right-radius: 4px;
    }
    .qf-mc-bubble-msg.assistant {
      align-self: flex-start;
      background: var(--surface-2, #2A2A2D); color: var(--ink-soft, #ECECEE);
      border-bottom-left-radius: 4px;
      border: 1px solid var(--border, #3E3F42);
    }
    .qf-mc-bubble-msg.thinking {
      align-self: flex-start;
      color: var(--muted, #909192); font-size: 12.5px; font-style: italic;
    }
    .qf-mc-input-row {
      display: flex; gap: 6px; padding: 12px 14px;
      border-top: 1px solid var(--border, #2A2A2D);
    }
    .qf-mc-input {
      flex: 1; padding: 9px 12px;
      background: var(--surface-2, #2A2A2D); color: var(--ink, #fff);
      border: 1px solid var(--border-strong, #3E3F42); border-radius: 8px;
      font-size: 13.5px; font-family: inherit;
    }
    .qf-mc-input:focus { outline: 0; border-color: var(--accent, #5EEAD4); }
    .qf-mc-send {
      padding: 8px 14px;
      background: var(--accent, #5EEAD4); color: var(--accent-ink, #07232A);
      border: 0; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.06em; text-transform: uppercase;
      font-family: var(--font-mono, monospace);
    }
    .qf-mc-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .qf-mc-foot {
      padding: 6px 14px 10px;
      font-size: 11px; color: var(--muted, #909192);
      text-align: center;
      font-family: var(--font-mono, monospace); letter-spacing: 0.06em; text-transform: uppercase;
    }
  `;
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ─────────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.className = 'qf-mc-bubble';
  btn.setAttribute('aria-label', 'Open chat with QuoteFleet');
  btn.innerHTML = '💬';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.className = 'qf-mc-panel';
  panel.innerHTML =
    '<div class="qf-mc-head">' +
      '<span class="dot"></span>' +
      '<div><div class="title">QuoteFleet</div><div class="sub">AI assistant — usually replies in seconds</div></div>' +
    '</div>' +
    '<div class="qf-mc-msgs" id="qf-mc-msgs"></div>' +
    '<div class="qf-mc-input-row">' +
      '<input class="qf-mc-input" id="qf-mc-input" placeholder="Ask about pricing, features, signup…" autocomplete="off">' +
      '<button class="qf-mc-send" id="qf-mc-send">Send</button>' +
    '</div>' +
    '<div class="qf-mc-foot">AI may make mistakes. For specifics: hello@quotefleet.net</div>';
  document.body.appendChild(panel);

  // ── State + handlers ────────────────────────────────────────────
  var open = false;
  var history = [];
  var msgs = panel.querySelector('#qf-mc-msgs');
  var input = panel.querySelector('#qf-mc-input');
  var sendBtn = panel.querySelector('#qf-mc-send');

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.innerHTML = open ? '✕' : '💬';
    if (open) {
      if (history.length === 0) {
        appendBubble('assistant', "Hi — I'm the QuoteFleet assistant. Ask me about pricing, features, who we're for, or how to get started.");
      }
      setTimeout(function () { input.focus(); }, 50);
    }
  }
  btn.addEventListener('click', toggle);

  function appendBubble(role, text) {
    var b = document.createElement('div');
    b.className = 'qf-mc-bubble-msg ' + role;
    b.textContent = text;
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function send() {
    var msg = (input.value || '').trim();
    if (!msg) return;
    appendBubble('user', msg);
    input.value = '';
    sendBtn.disabled = true;
    var thinking = appendBubble('thinking', 'Thinking…');

    var payload = {
      message: msg,
      history: history.slice(-12), // last 6 turns
    };

    fetch('/api/public/marketing-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (resp) {
        thinking.remove();
        sendBtn.disabled = false;
        if (resp.error) {
          appendBubble('assistant', resp.error);
          return;
        }
        var reply = resp.reply || '(no reply)';
        appendBubble('assistant', reply);
        history.push({ role: 'user', content: msg });
        history.push({ role: 'assistant', content: reply });
      })
      .catch(function () {
        thinking.remove();
        sendBtn.disabled = false;
        appendBubble('assistant', 'Connection error. Try again in a moment.');
      });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
})();
