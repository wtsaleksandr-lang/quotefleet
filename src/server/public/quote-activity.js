(function () {
  'use strict';

  function refFromUrl() {
    var m = location.pathname.match(/\/quote\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  var refId = refFromUrl();
  if (!refId) return;

  var sentView = false;
  function send(eventName) {
    if (!eventName) return;
    var payload = JSON.stringify({ event: eventName, pageUrl: location.href });
    var url = '/api/public/quote-activity/' + encodeURIComponent(refId);
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(function () {});
  }

  function viewOnce() {
    if (sentView) return;
    sentView = true;
    send('view');
  }

  function click(id, eventName) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener('click', function () { send(eventName); }, true);
  }

  document.addEventListener('DOMContentLoaded', function () {
    viewOnce();
    click('qdoc-copy', 'copy_link');
    click('qdoc-print', 'print');
    click('qdoc-pdf', 'save_pdf');
    click('qdoc-email', 'email_click');
    click('qdoc-chat', 'chat_open');
    click('qdoc-callback-open', 'callback_open');
    click('qdoc-callback-send', 'callback_submit');
  });
})();
