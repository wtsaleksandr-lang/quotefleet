/* QuoteFleet — display-currency localization (marketing pages only).
 *
 * DISPLAY ONLY. Billing is USD-only (Stripe single-currency; PLAN_PRICES_USD
 * in src/server/plans.ts). This converts the *shown* price for visitors whose
 * region defaults to another currency, and always surfaces a "billed in USD"
 * note so the charge currency is never ambiguous. It never touches checkout,
 * Stripe, or plan logic.
 *
 * Wiring:
 *   - Price spots use <span class="qf-price" data-usd="14.80">$14.80</span>.
 *     The inner text is the no-JS USD fallback.
 *   - "Billed in USD" notes use any element with a [data-usd-note] attribute.
 *   - A compact <select class="qf-currency-switch"> is injected into the nav.
 *
 * Exposes window.QFCurrency = { get, set, render, currencies }.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "qf-currency";
  var BASE = "USD";

  /* Static FX table — USD base. Approximate; update periodically. */
  var FX = {
    USD: 1,
    CAD: 1.37,
    EUR: 0.92,
    GBP: 0.79,
    AUD: 1.52
  };

  /* Symbol + display order. Symbols are fixed here (not locale-derived) so the
   * shown symbol is deterministic regardless of the viewer's browser locale. */
  var META = {
    USD: { symbol: "$",   label: "USD" },
    CAD: { symbol: "CA$", label: "CAD" },
    EUR: { symbol: "€",  label: "EUR" }, /* € */
    GBP: { symbol: "£",  label: "GBP" }, /* £ */
    AUD: { symbol: "A$",  label: "AUD" }
  };
  var ORDER = ["USD", "CAD", "EUR", "GBP", "AUD"];

  /* Region / language → default currency for geo detection. */
  var CAD_REGIONS = ["CA"];
  var GBP_REGIONS = ["GB", "UK"];
  var AUD_REGIONS = ["AU"];
  var EUR_REGIONS = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR",
    "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK", "HR"];
  var EUR_LANGS = ["de", "fr", "it", "nl", "pt", "es", "el", "ga", "et",
    "fi", "sl", "sk", "lv", "lt", "mt", "hr"];

  function isValid(code) {
    return typeof code === "string" && Object.prototype.hasOwnProperty.call(FX, code);
  }

  /* Best-effort default from navigator.language(s). Defaults to USD on any
   * uncertainty. Region wins over language (so fr-CA → CAD, not EUR). */
  function geoDefault() {
    var nav = (typeof navigator !== "undefined") ? navigator : {};
    var langs = (nav.languages && nav.languages.length)
      ? nav.languages
      : [nav.language || "en-US"];
    for (var i = 0; i < langs.length; i++) {
      var raw = langs[i];
      if (!raw) continue;
      var parts = String(raw).split("-");
      var lang = parts[0].toLowerCase();
      var region = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
      if (region) {
        if (CAD_REGIONS.indexOf(region) >= 0) return "CAD";
        if (GBP_REGIONS.indexOf(region) >= 0) return "GBP";
        if (AUD_REGIONS.indexOf(region) >= 0) return "AUD";
        if (region === "US") return "USD";
        if (EUR_REGIONS.indexOf(region) >= 0) return "EUR";
        /* Unknown region — fall through to language heuristic below. */
      }
      if (lang === "en") return "USD";
      if (EUR_LANGS.indexOf(lang) >= 0) return "EUR";
    }
    return "USD";
  }

  function readStored() {
    try {
      var v = window.localStorage.getItem(STORAGE_KEY);
      return isValid(v) ? v : null;
    } catch (e) { return null; }
  }

  function writeStored(code) {
    try { window.localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* ignore */ }
  }

  var active = null; /* resolved on init */

  function resolveInitial() {
    var stored = readStored();
    if (stored) return stored;
    return geoDefault();
  }

  /* Format a USD base amount into the active currency string.
   * USD is exact ("$14.80", 2 decimals). Non-USD is an approximate converted
   * figure, so round it to a whole number for a cleaner read ("≈ CA$20", no
   * cents). The "≈" prefix already signals it is not the exact charge. */
  function format(usdAmount, code) {
    var rate = FX[code] || 1;
    var meta = META[code] || META[BASE];
    var value = (parseFloat(usdAmount) * rate);
    if (!isFinite(value)) value = parseFloat(usdAmount) || 0;
    var amount = (code === BASE) ? value.toFixed(2) : String(Math.round(value));
    var prefix = (code === BASE) ? "" : "≈ "; /* ≈ */
    return prefix + meta.symbol + amount;
  }

  function renderPrices(code) {
    var nodes = document.querySelectorAll("[data-usd]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var usd = el.getAttribute("data-usd");
      if (usd == null || usd === "") continue;
      el.textContent = format(usd, code);
    }
  }

  function renderNotes(code) {
    var nodes = document.querySelectorAll("[data-usd-note]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (code === BASE) {
        el.textContent = "";
        el.hidden = true;
      } else {
        var label = (META[code] || META[BASE]).label;
        el.textContent = "Prices shown in " + label + " · billed in USD"; /* · */
        el.hidden = false;
      }
    }
  }

  function render(code) {
    var c = isValid(code) ? code : active;
    renderPrices(c);
    renderNotes(c);
    syncSwitches(c);
  }

  /* ── Currency switch (responsive: header on desktop, footer on mobile) ──
   * On desktop (>720px) the switch lives in the header, next to the CTA/burger.
   * On mobile (≤720px) the mobile header row is already near-full, so mounting
   * the switch there pushes total width past the viewport (horizontal scroll +
   * a clipped burger/CTA). Instead we relocate it to the page footer — a
   * standard, expected home for a currency control — and keep exactly ONE
   * instance mounted at a time. Pages with no footer (e.g. signup) fall back to
   * the header, which is uncrowded there and does not overflow. */

  var MOBILE_MQ = "(max-width: 720px)";
  var currentSwitch = null; /* the single active <select>, or null */
  var currentMode = null;   /* "header" | "footer" | null */

  function buildSwitch() {
    var sel = document.createElement("select");
    sel.className = "qf-currency-switch";
    sel.setAttribute("aria-label", "Currency");
    for (var i = 0; i < ORDER.length; i++) {
      var code = ORDER[i];
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = META[code].label;
      sel.appendChild(opt);
    }
    sel.value = active;
    sel.addEventListener("change", function () {
      set(sel.value);
    });
    return sel;
  }

  function syncSwitches(code) {
    if (currentSwitch && currentSwitch.value !== code) currentSwitch.value = code;
  }

  /* Where the header switch goes on each page layout. */
  function headerTarget() {
    var actions = document.querySelector(".site-actions"); /* landing header */
    if (actions) {
      return { parent: actions, before: actions.querySelector(".site-burger") };
    }
    var topnav = document.querySelector(".topnav-inner"); /* pricing/signup/tools */
    if (topnav) {
      return { parent: topnav, before: topnav.querySelector(".btn") };
    }
    var nav = document.querySelector(".site-nav");
    if (nav) return { parent: nav, before: null };
    var header = document.querySelector("header");
    if (header) return { parent: header, before: null };
    return null;
  }

  /* A stable existing footer container to host the compact mobile switch. */
  function footerContainer() {
    return document.querySelector(".footer-bottom")        /* landing bottom bar */
      || document.querySelector(".premium-footer-inner")   /* landing grid       */
      || document.querySelector(".site-footer")            /* pricing / tools    */
      || document.querySelector("footer");
  }

  function mountHeader() {
    var t = headerTarget();
    if (!t) return false;
    var sw = buildSwitch();
    if (t.before) t.parent.insertBefore(sw, t.before);
    else t.parent.appendChild(sw);
    currentSwitch = sw;
    currentMode = "header";
    return true;
  }

  function mountFooter() {
    var fc = footerContainer();
    if (!fc) return false;
    var wrap = document.createElement("div");
    wrap.className = "qf-currency-footer";
    var label = document.createElement("span");
    label.className = "qf-currency-footer-label";
    label.textContent = "Currency";
    var sw = buildSwitch();
    wrap.appendChild(label);
    wrap.appendChild(sw);
    fc.appendChild(wrap);
    currentSwitch = sw;
    currentMode = "footer";
    return true;
  }

  function removeSwitch() {
    if (!currentSwitch) return;
    var node = currentSwitch;
    var wrap = node.parentNode;
    if (currentMode === "footer" && wrap &&
        wrap.className && wrap.className.indexOf("qf-currency-footer") >= 0) {
      node = wrap; /* remove the footer wrapper (label + select) as a unit */
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    currentSwitch = null;
    currentMode = null;
  }

  function isMobile() {
    return (typeof window.matchMedia === "function")
      ? window.matchMedia(MOBILE_MQ).matches
      : (window.innerWidth <= 720);
  }

  /* Mount (or re-mount) the switch for the current viewport. Idempotent: does
   * nothing if the correct instance is already mounted. */
  function mountForViewport() {
    var want = (isMobile() && footerContainer()) ? "footer" : "header";
    if (currentMode === want && currentSwitch) return;
    removeSwitch();
    var ok = (want === "footer") ? mountFooter() : mountHeader();
    if (!ok) { /* fall back to the other location */
      ok = (want === "footer") ? mountHeader() : mountFooter();
    }
    if (currentSwitch) currentSwitch.value = active;
  }

  var resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(mountForViewport, 150);
  }

  /* ── Public API ───────────────────────────────────────────────────────── */

  function set(code) {
    if (!isValid(code)) return;
    active = code;
    writeStored(code);
    render(code);
  }

  function get() { return active; }

  function init() {
    active = resolveInitial();
    mountForViewport();
    render(active);
    if (window.addEventListener) window.addEventListener("resize", onResize);
  }

  window.QFCurrency = {
    get: get,
    set: set,
    render: function () { render(active); },
    currencies: ORDER.slice()
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
