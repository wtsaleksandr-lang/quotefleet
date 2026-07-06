(() => {
  function isLeadDetail() {
    return /^\/app\/leads\/.+/.test(location.pathname);
  }

  function one(selector, root) {
    return (root || document).querySelector(selector);
  }

  function all(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function cleanText(node) {
    return (node && node.textContent ? node.textContent : '').trim().replace(/\s+/g, ' ');
  }

  function cardByTitle(root, pattern) {
    return all('.card', root).find(function (card) {
      var title = cleanText(one('.card-title', card)).toLowerCase();
      return pattern.test(title);
    });
  }

  function cardValue(card, fallback) {
    if (!card) return fallback || '—';
    var clone = card.cloneNode(true);
    var title = one('.card-title', clone);
    if (title) title.remove();
    return cleanText(clone).slice(0, 110) || fallback || '—';
  }

  function addFact(grid, label, value) {
    var item = document.createElement('div');
    item.className = 'qf-lead-command-fact';
    var small = document.createElement('span');
    small.textContent = label;
    var strong = document.createElement('strong');
    strong.textContent = value || '—';
    item.appendChild(small);
    item.appendChild(strong);
    grid.appendChild(item);
  }

  function addAction(actions, label, card) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = !card;
    btn.addEventListener('click', function () {
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      card.classList.add('qf-lead-command-pulse');
      setTimeout(function () { card.classList.remove('qf-lead-command-pulse'); }, 900);
    });
    actions.appendChild(btn);
  }

  function mount() {
    if (!isLeadDetail()) return;
    var root = one('#page-content');
    if (!root || root.dataset.qfLeadCommand === '1') return;
    var title = one('h1', root);
    var grid = one('.grid-2', root);
    if (!title || !grid) return;

    var customer = cardByTitle(root, /customer/);
    var shipment = cardByTitle(root, /shipment/);
    var quote = cardByTitle(root, /quote/);
    var status = cardByTitle(root, /status/);
    var chat = cardByTitle(root, /customer chat/);

    [customer, shipment, quote, status, chat].forEach(function (card) {
      if (card) card.classList.add('qf-lead-command-card');
    });

    root.dataset.qfLeadCommand = '1';
    root.classList.add('qf-lead-detail-command-page');

    var section = document.createElement('section');
    section.className = 'qf-lead-command-desk';

    var head = document.createElement('div');
    head.className = 'qf-lead-command-head';
    var copy = document.createElement('div');
    copy.className = 'qf-lead-command-copy';
    var eyebrow = document.createElement('span');
    eyebrow.textContent = 'Lead command desk';
    var strong = document.createElement('strong');
    strong.textContent = cleanText(title) || 'Lead detail';
    var sub = document.createElement('p');
    sub.textContent = 'Work this quote from customer details to follow-up without losing the operational context.';
    copy.appendChild(eyebrow);
    copy.appendChild(strong);
    copy.appendChild(sub);

    var actions = document.createElement('div');
    actions.className = 'qf-lead-command-actions';
    addAction(actions, 'Customer', customer);
    addAction(actions, 'Shipment', shipment);
    addAction(actions, 'Quote', quote);
    addAction(actions, 'Status & notes', status);
    addAction(actions, 'Chat', chat);

    head.appendChild(copy);
    head.appendChild(actions);
    section.appendChild(head);

    var facts = document.createElement('div');
    facts.className = 'qf-lead-command-facts';
    addFact(facts, 'Customer', cardValue(customer, 'No customer yet'));
    addFact(facts, 'Shipment', cardValue(shipment, 'No shipment yet'));
    addFact(facts, 'Quote', cleanText(one('.card-title', quote)).replace(/^Quote\s*[—-]\s*/i, '') || 'No quote yet');
    addFact(facts, 'Status', cardValue(status, 'No status yet'));
    section.appendChild(facts);

    var after = one('.qf-lead-crm-bar', root) || title;
    after.insertAdjacentElement('afterend', section);
  }

  var observer = new MutationObserver(mount);
  window.addEventListener('load', function () {
    mount();
    var root = one('#page-content');
    if (root) observer.observe(root, { childList: true, subtree: true });
  });
  document.addEventListener('click', function () { setTimeout(mount, 50); }, true);
  window.addEventListener('popstate', function () { setTimeout(mount, 50); });
})();
