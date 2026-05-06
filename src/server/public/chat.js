(function () {
  'use strict';
  var refId = location.pathname.split('/chat/')[1];
  if (!refId) {
    document.body.innerHTML = '<div class="card" style="margin:40px auto;max-width:520px;">Missing reference ID.</div>';
    return;
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { e.appendChild(k); });
    return e;
  }
  function fmtMoney(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
  }

  function loadLead() {
    fetch('/api/public/lead/' + encodeURIComponent(refId))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.error) {
          $('lead-card').innerHTML = '<div class="notice error">' + j.error + '</div>';
          return;
        }
        var l = j.lead;
        $('lead-title').textContent =
          'Quote ' + l.refId + ' — $' + fmtMoney(l.total);
        $('lead-subtitle').textContent =
          (l.service || '') + ' / ' + (l.equipment || '') +
          '  ·  ' + (l.pickup || '?') + ' → ' + (l.delivery || '?') +
          (l.miles ? '  ·  ~' + Math.round(l.miles) + ' mi' : '');
        var bd = $('lead-breakdown'); bd.innerHTML = '';
        if (l.aiSummary) {
          var sum = el('div', { class: 'notice', style: 'margin-top:10px;white-space:pre-wrap;' });
          sum.textContent = l.aiSummary;
          bd.appendChild(sum);
        } else if (l.breakdown && l.breakdown.length) {
          var ul = el('div');
          ul.innerHTML = '<table class="table" style="margin-top:10px;"><tbody></tbody></table>';
          var tbody = ul.querySelector('tbody');
          l.breakdown.forEach(function (b) {
            tbody.innerHTML += '<tr><td>' + b.name + '</td><td style="text-align:right;font-variant-numeric:tabular-nums;">$' + fmtMoney(b.amount) + '</td></tr>';
          });
          tbody.innerHTML += '<tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>$' + fmtMoney(l.total) + '</strong></td></tr>';
          bd.appendChild(ul);
        }
        // Greet
        addBubble('assistant',
          'Hi ' + (l.customerName || 'there') + ' — I have your quote ' + l.refId +
          ' open. Ask me anything about pickup, transit, accessorials, or booking.');
      });
  }

  function addBubble(role, text) {
    var msgs = $('chat-messages');
    var b = el('div', { class: 'chat-bubble ' + role, text: text });
    msgs.appendChild(b);
    msgs.scrollTop = msgs.scrollHeight;
    return b;
  }

  function send() {
    var input = $('chat-input');
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    addBubble('user', msg);
    var pending = addBubble('assistant', '…');
    var btn = $('chat-send'); btn.disabled = true;
    fetch('/api/public/chat/' + encodeURIComponent(refId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        btn.disabled = false;
        pending.textContent = j.reply || j.error || '(no reply)';
      })
      .catch(function () {
        btn.disabled = false;
        pending.textContent = 'Network error — please try again.';
      });
  }
  $('chat-send').addEventListener('click', send);
  $('chat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
  });

  loadLead();
})();
