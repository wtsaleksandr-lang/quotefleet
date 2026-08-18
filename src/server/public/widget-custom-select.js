(function () {
  'use strict';

  // Replace native <select> popups (sharp-cornered, un-themeable) with a custom
  // branded dropdown that matches the widget's rounded inputs + suggestion lists.
  // The real <select> is kept in the DOM (visually hidden) so form submission and
  // all existing change/recalc logic + option lists stay intact. Options are read
  // live from the <select>, never hardcoded.
  // NOTE: qf-hazmat-class is intentionally NOT enhanced here — it is now a
  // hidden source-of-truth <select> driven by the morphing hazmat pill control
  // (widget-hazmat-pill.js), which renders its own themed listbox. Enhancing it
  // would surface a duplicate visible dropdown.
  var TARGETS = ['qf-equipment', 'qf-ocean-carrier'];

  function labelFor(opt) {
    return opt ? (opt.textContent || '').trim() : '';
  }

  // ── Equipment / container icons ────────────────────────────────────────────
  // A small monochrome glyph next to each equipment type in the equipment
  // dropdown (Alex: an icon of each relevant container next to its type title).
  // Matched by keyword off the option label; every type resolves to an icon so
  // the list stays visually consistent. currentColor → inherits the row color.
  var SVG_HEAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  // ── Premium container line-art (designed for the ~27px render) ───────────────
  // Every container shares one visual language so the dropdown reads as a set:
  //   • corrugated ribbing (evenly spaced vertical ribs, inset top/bottom → the
  //     gap reads as the top + bottom rails),
  //   • four cast-steel CORNER CASTINGS (small filled blocks at each corner),
  //   • a DOOR END on the right (vertical door seam + two locking bars).
  // Proportions carry the size: 20' short box, 40' long, 40'HQ / 45' high-cube
  // (taller, with an extra top band line), 45' longest with the most ribs.
  // CASTING = reusable filled-corner-block markup for a box (fill=currentColor).
  var CAST = function (x1, x2, yT, yB) {
    return '<g fill="currentColor" stroke="none">' +
      '<rect x="' + x1 + '" y="' + yT + '" width="1.5" height="1.4" rx="0.2"/>' +
      '<rect x="' + x2 + '" y="' + yT + '" width="1.5" height="1.4" rx="0.2"/>' +
      '<rect x="' + x1 + '" y="' + yB + '" width="1.5" height="1.4" rx="0.2"/>' +
      '<rect x="' + x2 + '" y="' + yB + '" width="1.5" height="1.4" rx="0.2"/></g>';
  };
  // 20' — short box.
  var IC_C20 = SVG_HEAD + '<rect x="4.6" y="8.4" width="14.8" height="7.6" rx="0.6"/>' +
    '<path d="M7.4 9.7v5M9.4 9.7v5M11.4 9.7v5M13.4 9.7v5" stroke-width="0.9"/>' +
    '<path d="M15.4 8.4v7.6" stroke-width="1"/><path d="M16.6 9.8v4.8M17.9 9.8v4.8" stroke-width="1"/>' +
    CAST('4.2', '18.3', '8', '14.6') + '</svg>';
  // 40' — long box.
  var IC_C40 = SVG_HEAD + '<rect x="2.6" y="8.4" width="18.8" height="7.6" rx="0.6"/>' +
    '<path d="M5.4 9.7v5M7.4 9.7v5M9.4 9.7v5M11.4 9.7v5M13.4 9.7v5M15.4 9.7v5" stroke-width="0.9"/>' +
    '<path d="M17.4 8.4v7.6" stroke-width="1"/><path d="M18.7 9.8v4.8M20 9.8v4.8" stroke-width="1"/>' +
    CAST('2.2', '20.3', '8', '14.6') + '</svg>';
  // 40'HQ — high-cube: taller box + a top band line marking the extra height.
  var IC_C40HC = SVG_HEAD + '<rect x="2.6" y="6.2" width="18.8" height="11.2" rx="0.6"/>' +
    '<path d="M2.6 8h18.8" stroke-width="0.9"/>' +
    '<path d="M5.4 8.4v8.2M7.4 8.4v8.2M9.4 8.4v8.2M11.4 8.4v8.2M13.4 8.4v8.2M15.4 8.4v8.2" stroke-width="0.9"/>' +
    '<path d="M17.4 6.2v11.2" stroke-width="1"/><path d="M18.7 8.4v7.8M20 8.4v7.8" stroke-width="1"/>' +
    CAST('2.2', '20.3', '5.8', '16') + '</svg>';
  // 45' — longest high-cube: most ribs + top band.
  var IC_C45HC = SVG_HEAD + '<rect x="2" y="6.2" width="20" height="11.2" rx="0.6"/>' +
    '<path d="M2 8h20" stroke-width="0.9"/>' +
    '<path d="M4.4 8.4v8.2M6.4 8.4v8.2M8.4 8.4v8.2M10.4 8.4v8.2M12.4 8.4v8.2M14.4 8.4v8.2M16.4 8.4v8.2" stroke-width="0.9"/>' +
    '<path d="M18 6.2v11.2" stroke-width="1"/><path d="M19.1 8.4v7.8M20.4 8.4v7.8" stroke-width="1"/>' +
    CAST('1.6', '20.9', '5.8', '16') + '</svg>';
  // Reefer: light body + blue LOUVRED refrigeration unit on one end (restrained
  // 2-tone), corrugation on the body, corner castings — reads unmistakably reefer.
  var IC_REEFER = '<svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2.6" y="7.8" width="18.8" height="8.4" rx="0.7" fill="#eef3ff" stroke="currentColor" stroke-width="1.7"/>' +
    '<rect x="3.4" y="8.7" width="3.6" height="6.6" rx="0.4" fill="#3f5cc0" stroke="none"/>' +
    '<path d="M4.1 10.1h2.2M4.1 11.4h2.2M4.1 12.7h2.2M4.1 14h2.2" stroke="#dbe4ff" stroke-width="0.8"/>' +
    '<path d="M9 9.4v5.2M11 9.4v5.2M13 9.4v5.2M15 9.4v5.2M17 9.4v5.2M19 9.4v5.2" stroke="currentColor" stroke-width="0.9"/>' +
    '<g fill="currentColor" stroke="none"><rect x="2.2" y="7.4" width="1.5" height="1.4" rx="0.2"/><rect x="20.3" y="7.4" width="1.5" height="1.4" rx="0.2"/><rect x="2.2" y="15.2" width="1.5" height="1.4" rx="0.2"/><rect x="20.3" y="15.2" width="1.5" height="1.4" rx="0.2"/></g></svg>';
  // Open-top: walls + floor + corrugation, but the top is a removable (dashed) lid.
  var IC_OPENTOP = SVG_HEAD + '<path d="M2.8 8.2v7.8M21.2 8.2v7.8M2.8 16h18.4"/>' +
    '<path d="M2.8 8.2h18.4" stroke-dasharray="2.2 2" stroke-width="1.3"/>' +
    '<path d="M5.6 9.6v5.4M7.6 9.6v5.4M9.6 9.6v5.4M11.6 9.6v5.4M13.6 9.6v5.4M15.6 9.6v5.4M17.6 9.6v5.4M19.4 9.6v5.4" stroke-width="0.9"/>' +
    '<g fill="currentColor" stroke="none"><rect x="2.4" y="15.2" width="1.5" height="1.4" rx="0.2"/><rect x="20.5" y="15.2" width="1.5" height="1.4" rx="0.2"/></g></svg>';
  // Flat rack: a container base with raised end posts (no walls, no wheels — it
  // rides on a chassis), corner castings under the deck set it apart from trailers.
  var IC_FLATRACK = SVG_HEAD + '<path d="M2.4 15.4h19.2" stroke-width="1.9"/>' +
    '<path d="M4.4 15.4V9.6M19.6 15.4V9.6" stroke-width="1.7"/>' +
    '<path d="M3.2 9.6h2.4M18.4 9.6h2.4" stroke-width="1.5"/>' +
    '<g fill="currentColor" stroke="none"><rect x="2.1" y="14.8" width="1.5" height="1.5" rx="0.2"/><rect x="20.4" y="14.8" width="1.5" height="1.5" rx="0.2"/></g></svg>';
  // Flatbed: low deck + headboard/rear post, stake pockets, hubbed wheels.
  var IC_FLAT = SVG_HEAD + '<path d="M2 13.6h20" stroke-width="1.9"/>' +
    '<path d="M4.4 13.6V11M19.6 13.6V11" stroke-width="1.2"/>' +
    '<path d="M8 13.6v-1.3M12 13.6v-1.3M16 13.6v-1.3" stroke-width="0.9"/>' +
    '<circle cx="7" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>' +
    '<circle cx="7" cy="17" r="0.4" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="0.4" fill="currentColor" stroke="none"/></svg>';
  // Step deck (drop deck): two-level profile — low rear deck, raised front over
  // the gooseneck; hubbed wheels only under the low deck.
  var IC_STEPDECK = SVG_HEAD + '<path d="M2.4 15.2h9.6v-3.8h7.8"/>' +
    '<path d="M19.8 11.4V9.4" stroke-width="1.2"/>' +
    '<circle cx="6" cy="17.2" r="1.5"/><circle cx="9.6" cy="17.2" r="1.5"/>' +
    '<circle cx="6" cy="17.2" r="0.35" fill="currentColor" stroke="none"/><circle cx="9.6" cy="17.2" r="0.35" fill="currentColor" stroke="none"/></svg>';
  // Conestoga: flat deck under a rolling-tarp canopy (arched cover with tarp bows).
  var IC_CONESTOGA = SVG_HEAD + '<path d="M3.4 15.6h17.2" stroke-width="1.7"/>' +
    '<path d="M4.6 15.6v-3.4a7.4 7.4 0 0 1 14.8 0v3.4"/>' +
    '<path d="M8.3 15.6V9.7M12 15.6V8.9M15.7 15.6V9.7" stroke-width="0.8"/>' +
    '<circle cx="7.4" cy="17.4" r="1.5"/><circle cx="16.6" cy="17.4" r="1.5"/></svg>';
  // Hotshot: a dually pickup towing a flat trailer — distinct from a full flatbed.
  // Shared cab: box body + window notch + hood step; wheels get hub dots.
  var IC_HOTSHOT = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.5 14v-1.6h2.4V14"/><path d="M9 14h12.5"/><circle cx="4.2" cy="16.4" r="1.3"/><circle cx="14" cy="16.4" r="1.3"/><circle cx="18" cy="16.4" r="1.3"/></svg>';
  // ── Hotshot trailer-type bands ─────────────────────────────────────
  // Each is the same dually-cab silhouette as IC_HOTSHOT (box cab + window notch),
  // differentiated by the trailer profile so the customer can tell them apart.
  // Bumper-pull: short flat deck hitched low at the bumper, single axle.
  var IC_HS_BUMPER = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.5 14h1.6"/><path d="M9 13.4h11.5"/><path d="M9 13.4V15M20.5 13.4V15"/><circle cx="4.2" cy="16.4" r="1.3"/><circle cx="16.3" cy="16.4" r="1.3"/></svg>';
  // Gooseneck: raised neck arches over the truck bed then drops to the deck.
  var IC_HS_GOOSE = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.6 10.3h1.8l1.3 3h10.8"/><circle cx="4.2" cy="16.4" r="1.3"/><circle cx="14.5" cy="16.4" r="1.3"/><circle cx="18" cy="16.4" r="1.3"/></svg>';
  // Gooseneck 40' (CDL): same neck, longer deck + triple axle (heavier).
  var IC_HS_GOOSE40 = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.6 10.3h1.8l1.3 3h11.8"/><circle cx="4.2" cy="16.4" r="1.3"/><circle cx="13.3" cy="16.4" r="1.3"/><circle cx="16.4" cy="16.4" r="1.3"/><circle cx="19.5" cy="16.4" r="1.3"/></svg>';
  // Dovetail / tilt: flat deck that slopes down to the ground at the rear.
  var IC_HS_DOVETAIL = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.5 14h1.6"/><path d="M9 13.5h8.5l3 2.8"/><circle cx="4.2" cy="16.4" r="1.3"/><circle cx="13" cy="16.4" r="1.3"/></svg>';
  // Step-deck / lowboy: high front deck over the neck, step down to a low rear
  // deck; wheels sit lower to read as the dropped deck.
  var IC_HS_STEPDECK = SVG_HEAD + '<rect x="2" y="9.5" width="4.5" height="4.5" rx="0.6"/><path d="M3.1 9.9h2.3v1.4" stroke-width="0.8"/><path d="M6.6 11.5h4.4l1.4 2.4h8.1"/><circle cx="4.2" cy="16.6" r="1.3"/><circle cx="15.5" cy="17" r="1.3"/><circle cx="18.6" cy="17" r="1.3"/></svg>';
  // LTL: a strapped box/load on a pallet (LTL ships palletized freight).
  var IC_PALLET = SVG_HEAD + '<rect x="5.6" y="6.6" width="12.8" height="6.4" rx="0.5"/>' +
    '<path d="M5.6 9.8h12.8" stroke-width="0.9"/>' +
    '<path d="M3.4 15.4h17.2M3.4 18h17.2" stroke-width="1.5"/>' +
    '<path d="M5 15.4v2.6M12 15.4v2.6M19 15.4v2.6" stroke-width="1.2"/></svg>';
  // Dry van / sprinter: box body + roof rail + rear door seam & handle, hubbed wheels.
  var IC_VAN = SVG_HEAD + '<rect x="2.4" y="6.6" width="15.4" height="9.6" rx="1"/>' +
    '<path d="M2.4 8.6h15.4" stroke-width="0.9"/>' +
    '<path d="M13.6 6.6v9.6" stroke-width="0.9"/><path d="M15.7 9.6v3.6" stroke-width="0.9"/>' +
    '<circle cx="6.4" cy="18.4" r="1.6"/><circle cx="13.6" cy="18.4" r="1.6"/>' +
    '<circle cx="6.4" cy="18.4" r="0.4" fill="currentColor" stroke="none"/><circle cx="13.6" cy="18.4" r="0.4" fill="currentColor" stroke="none"/></svg>';
  // Box / straight truck (also power-only fallback): box body + cab + roof rail.
  var IC_TRUCK = SVG_HEAD + '<path d="M2.6 7.2h9.2v8.6H2.6z"/>' +
    '<path d="M11.8 10.2h3.4l2.8 2.9v2.7h-6.2z"/>' +
    '<path d="M13 10.2v2.9h4.4" stroke-width="0.9"/><path d="M2.6 9h9.2" stroke-width="0.9"/>' +
    '<circle cx="6" cy="17.6" r="1.6"/><circle cx="15.4" cy="17.6" r="1.6"/>' +
    '<circle cx="6" cy="17.6" r="0.4" fill="currentColor" stroke="none"/><circle cx="15.4" cy="17.6" r="0.4" fill="currentColor" stroke="none"/></svg>';
  function equipIconSvg(label) {
    var t = (label || '').toLowerCase();
    if (/reefer|refriger|genset/.test(t)) return IC_REEFER;
    if (/open.?top/.test(t)) return IC_OPENTOP;
    // Hotshot trailer-type bands FIRST — their labels contain "flatbed" /
    // "step-deck" / "lowboy" tokens that the generic branches below also match,
    // so each distinct trailer icon must win before them.
    if (/bumper.?pull/.test(t)) return IC_HS_BUMPER;
    if (/dovetail|tilt/.test(t)) return IC_HS_DOVETAIL;
    if (/goose.?neck/.test(t)) return /\b40\b/.test(t) ? IC_HS_GOOSE40 : IC_HS_GOOSE;
    if (/low.?boy/.test(t)) return IC_HS_STEPDECK;
    // Flat family, each distinct. Order matters: "flat rack" contains "flat".
    if (/flat.?rack|flatrack/.test(t)) return IC_FLATRACK;
    if (/step.?deck|drop.?deck|lowboy|rgn/.test(t)) return IC_STEPDECK;
    if (/conestoga|curtain|roll.?tarp/.test(t)) return IC_CONESTOGA;
    // Hotshot / gooseneck BEFORE flatbed (the hotshot label contains "flatbed").
    if (/hotshot|hot ?shot|goose.?neck|dually/.test(t)) return IC_HOTSHOT;
    if (/flat.?bed|flatbed|flat.?deck|\bflat\b/.test(t)) return IC_FLAT;
    if (/\bltl\b|pallet|less.?than.?truck/.test(t)) return IC_PALLET;
    // Containers, sized — only when the label actually says container/HC/etc., so
    // a "40' Gooseneck" or "48' Flatbed" never gets mistaken for a container.
    if (/container|high.?cube|hi.?cube|highcube|\bhc\b|\bhq\b|40.?hq|intermodal|chassis|\bteu\b|drayage|ocean/.test(t)) {
      var hc = /high.?cube|hi.?cube|highcube|\bhc\b|\bhq\b|40.?hq/.test(t);
      if (/(^|\D)45(\D|$)/.test(t)) return IC_C45HC;
      if (/(^|\D)40(\D|$)/.test(t)) return hc ? IC_C40HC : IC_C40;
      if (/(^|\D)20(\D|$)/.test(t)) return IC_C20;
      return IC_C40;
    }
    if (/box.?truck|straight.?truck/.test(t)) return IC_TRUCK;
    if (/dry.?van|sprinter|cargo|\bvan\b|straight|\bbox\b/.test(t)) return IC_VAN;
    return IC_TRUCK;
  }
  // Compact display label for CONTAINER equipment only (Alex: icon + short size
  // code in the dropdown). Maps a container option's full label to its size code
  // — 20' / 40' / 40'HQ / 45' — while reefer / open-top / flat-rack containers
  // keep a short type name (they read by type, not size). Non-container equipment
  // (dry van, sprinter, flatbed, hotshot, LTL/pallet, box truck …) is returned
  // unchanged. Purely a DISPLAY transform: the underlying <option> value + label
  // stay intact, so the quote summary + lead still read the full label.
  function containerShortLabel(label) {
    var t = (label || '').toLowerCase();
    var isContainer = /container|high.?cube|hi.?cube|highcube|\bhc\b|\bhq\b|40.?hq|intermodal|\bteu\b|drayage|ocean/.test(t);
    if (!isContainer) return label;
    // Type-named container variants keep a short word, not a size code.
    if (/reefer|refriger|genset/.test(t)) return 'Reefer';
    if (/open.?top/.test(t)) return 'Open-Top';
    if (/flat.?rack|flatrack/.test(t)) return 'Flat-Rack';
    // Sized dry containers → size code. High-cube 40' → 40'HQ.
    var hc = /high.?cube|hi.?cube|highcube|\bhc\b|\bhq\b|40.?hq/.test(t);
    if (/(^|\D)45(\D|$)/.test(t)) return "45'";
    if (/(^|\D)40(\D|$)/.test(t)) return hc ? "40'HQ" : "40'";
    if (/(^|\D)20(\D|$)/.test(t)) return "20'";
    return label;
  }
  function makeIcon(label) {
    var span = document.createElement('span');
    span.className = 'qf-cs-ico';
    span.innerHTML = equipIconSvg(label);
    return span;
  }

  function enhance(select) {
    if (!select || select.dataset.csInstalled === '1') return;
    // Never touch the terminal select — it has its own search combobox.
    if (select.id === 'qf-pickup-terminal' || select.dataset.searchInstalled === '1') return;
    select.dataset.csInstalled = '1';

    var wrap = document.createElement('div');
    wrap.className = 'qf-cs';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-input qf-cs-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');

    var labelEl = document.createElement('span');
    labelEl.className = 'qf-cs-label';
    var chev = document.createElement('span');
    chev.className = 'qf-cs-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▾';
    btn.appendChild(labelEl);
    btn.appendChild(chev);

    var panel = document.createElement('div');
    panel.className = 'qf-suggestions qf-cs-panel';
    panel.setAttribute('role', 'listbox');

    // Insert wrapper, move the native select inside it (hidden but present).
    select.insertAdjacentElement('beforebegin', wrap);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    wrap.appendChild(select);
    select.classList.add('qf-cs-native');

    var activeIndex = -1;
    // Icons only on the equipment picker (container/trailer types).
    var withIcons = select.id === 'qf-equipment';

    // Set an element's content to (optional icon) + label text.
    function decorate(el, text) {
      if (!withIcons) { el.textContent = text; return; }
      el.textContent = '';
      el.classList.add('qf-cs-ico-row');
      el.appendChild(makeIcon(text)); // icon resolves off the FULL label
      var lab = document.createElement('span');
      lab.className = 'qf-cs-txt';
      lab.textContent = containerShortLabel(text); // containers show a short size code
      el.appendChild(lab);
    }

    function options() {
      return Array.prototype.slice.call(select.options || []);
    }
    function isOpen() {
      return panel.classList.contains('open');
    }
    function syncLabel() {
      var sel = options().find(function (o) { return o.value === select.value; }) || select.options[select.selectedIndex];
      decorate(labelEl, labelFor(sel) || labelFor(select.options[0]) || '');
    }
    function buildItems() {
      panel.innerHTML = '';
      options().forEach(function (opt, i) {
        var item = document.createElement('div');
        item.className = 'qf-suggestion qf-cs-opt';
        item.setAttribute('role', 'option');
        decorate(item, labelFor(opt));
        var selected = opt.value === select.value;
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
        item.dataset.index = String(i);
        item.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          choose(i);
        });
        panel.appendChild(item);
      });
    }
    function setActive(i) {
      var items = panel.querySelectorAll('.qf-cs-opt');
      if (!items.length) return;
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      activeIndex = i;
      items.forEach(function (el, idx) { el.classList.toggle('active', idx === i); });
      items[i].scrollIntoView({ block: 'nearest' });
    }
    function open() {
      if (isOpen()) return;
      buildItems();
      panel.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      var cur = options().findIndex(function (o) { return o.value === select.value; });
      setActive(cur >= 0 ? cur : 0);
      document.addEventListener('mousedown', onDocDown, true);
    }
    function close() {
      if (!isOpen()) return;
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      activeIndex = -1;
      document.removeEventListener('mousedown', onDocDown, true);
    }
    function choose(i) {
      var opt = select.options[i];
      if (!opt) return;
      if (select.value !== opt.value) {
        select.value = opt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncLabel();
      close();
      btn.focus();
    }
    function onDocDown(ev) {
      if (!wrap.contains(ev.target)) close();
    }

    btn.addEventListener('click', function () {
      if (isOpen()) close(); else open();
    });
    btn.addEventListener('keydown', function (ev) {
      var k = ev.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        ev.preventDefault();
        if (!isOpen()) { open(); return; }
        setActive(activeIndex + (k === 'ArrowDown' ? 1 : -1));
      } else if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        if (isOpen()) { ev.preventDefault(); if (activeIndex >= 0) choose(activeIndex); }
        else { ev.preventDefault(); open(); }
      } else if (k === 'Escape') {
        if (isOpen()) { ev.preventDefault(); close(); }
      } else if (k === 'Home' && isOpen()) {
        ev.preventDefault(); setActive(0);
      } else if (k === 'End' && isOpen()) {
        ev.preventDefault(); setActive(options().length - 1);
      }
    });

    // Keep label in sync if the value/options change from outside (e.g. tab
    // switch rebuilds the equipment options, or another script sets the value).
    select.addEventListener('change', function () { syncLabel(); if (isOpen()) buildItems(); });
    new MutationObserver(function () {
      syncLabel();
      if (isOpen()) buildItems();
    }).observe(select, { childList: true });

    syncLabel();
  }

  function installAll() {
    TARGETS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) enhance(el);
    });
  }

  document.addEventListener('DOMContentLoaded', installAll);
  new MutationObserver(installAll).observe(document.documentElement, { childList: true, subtree: true });
  installAll();
})();
