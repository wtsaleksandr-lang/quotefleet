(function () {
  'use strict';

  function refFromUrl() {
    var m = location.pathname.match(/\/quote\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function line(text) {
    var s = document.createElement('span');
    s.className = 'qdoc-line';
    s.textContent = text;
    return s;
  }
  function mailLine(label, value, hrefPrefix) {
    var s = document.createElement('span');
    s.className = 'qdoc-line';
    if (label) s.appendChild(document.createTextNode(label));
    var a = document.createElement('a');
    a.href = hrefPrefix + value;
    a.textContent = value;
    s.appendChild(a);
    return s;
  }
  function compact(arr) {
    return arr.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  }
  function render(data) {
    var profile = data.carrierProfile || {};
    var carrierDetails = document.getElementById('qdoc-carrier-details');
    if (carrierDetails) {
      var hasProfile = compact([profile.addressLine1, profile.city, profile.state, profile.postalCode, profile.country, profile.scac, profile.websiteUrl]).length > 0;
      if (hasProfile) {
        carrierDetails.dataset.polished = '1';
        carrierDetails.textContent = '';
        var cityLine = compact([profile.city, profile.state, profile.postalCode]).join(', ');
        compact([profile.addressLine1, profile.addressLine2, cityLine, profile.country]).forEach(function (txt) {
          carrierDetails.appendChild(line(txt));
        });
        var contact = compact([data.tenant && data.tenant.contactPhone, data.tenant && data.tenant.contactEmail]).join('   ');
        if (contact) carrierDetails.appendChild(line(contact));
        var ids = compact([
          data.tenant && data.tenant.mcNumber ? 'MC: ' + data.tenant.mcNumber : '',
          data.tenant && data.tenant.dotNumber ? 'US DOT: ' + data.tenant.dotNumber : '',
          profile.scac ? 'SCAC: ' + profile.scac : '',
        ]).join('   ');
        if (ids) carrierDetails.appendChild(line(ids));
        if (profile.websiteUrl) carrierDetails.appendChild(mailLine('', profile.websiteUrl, ''));
      }
    }
    var issued = document.getElementById('qdoc-issued-by');
    if (issued && profile.quoteContactName) {
      issued.dataset.polished = '1';
      issued.textContent = compact([profile.quoteContactName, data.tenant && data.tenant.contactEmail, data.tenant && data.tenant.contactPhone]).join(' · ');
    }
    if (profile.quoteFooterText) {
      var footer = document.querySelector('.qdoc-footer p');
      if (footer) footer.textContent = profile.quoteFooterText;
    }
  }

  var refId = refFromUrl();
  if (!refId) return;
  document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/public/quote-doc/' + encodeURIComponent(refId))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) render(data); })
      .catch(function () {});
  });
})();
