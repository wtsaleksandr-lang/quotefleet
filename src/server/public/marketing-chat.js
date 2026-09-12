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
 * Premium redesign (2026-07): rounded-square launcher with an inline
 * SVG icon, a panel with a flat accent header + brand avatar, accent user
 * bubbles, bounce-dot typing, a square paper-plane send button, starter
 * chips on first open, an entrance animation, and a full-screen mobile
 * sheet with a backdrop.
 *
 * 2026-09: de-gradiented. The launcher, the panel header, the user bubbles
 * and the send button each painted linear-gradient(135deg, #0D3CFC, #0A2FC4);
 * the launcher's was the only CSS gradient rendering anywhere on the site,
 * and the design system's rule is zero of them. All four are now the flat
 * site accent, taken from --accent-fill / --accent-ink via the widget-local
 * --qf-mc-accent tokens defined at the top of the stylesheet below.
 *
 * 2026-09 (panel theming): the panel used to hard-code #ffffff / #1A1A2E and
 * rendered byte-identically in light and dark — a white slab on the dark
 * site. Every panel surface, ink, hairline and hover wash now resolves
 * through the site theme tokens (--surface / --surface-2 / --ink / --muted /
 * --border-strong / --accent / --accent-soft) via the widget-local
 * --qf-mc-* layer below, so it flips with the page in all THREE theme states:
 * html[data-theme="dark"], html[data-theme="light"], and the un-stamped
 * default where only prefers-color-scheme decides. That last state works
 * because style.css defines the light values on bare :root and the dark
 * values under BOTH html[data-theme="dark"] and
 * @media (prefers-color-scheme: dark) :root:not([data-theme="light"]) —
 * this file never needs a media query of its own, and must not grow one.
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
  // Every glyph paints with currentColor, so the element that hosts it sets the
  // ink from a token (--qf-mc-accent-ink on the accent chrome). No hex here.
  var ICON_CHAT =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
    '</svg>';
  // QuoteFleet calculator-tile mark, painted in the header's ink.
  var MARK_QF =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<rect x="2"  y="2"  width="9" height="9" rx="2.2"/>' +
    '<rect x="13" y="2"  width="9" height="9" rx="2.2"/>' +
    '<rect x="2"  y="13" width="9" height="9" rx="2.2"/>' +
    '<rect x="13" y="13" width="9" height="9" rx="2.2" fill-opacity="0.75"/>' +
    '</svg>';
  var ICON_SEND =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="22" y1="2" x2="11" y2="13"/>' +
    '<polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
    '</svg>';
  var ICON_CLOSE =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  // ── styles ─────────────────────────────────────────────────────
  var css = `
    /* ── Widget token layer ───────────────────────────────────────────────
       Every literal in this file lives in THIS block, and only as a var()
       fallback so the widget still renders on a host page that somehow ships
       without style.css. Every rule below refers to a token, never to a hex.
       That claim is enforceable: grep this file for '#' outside this block.

       Two families, and the difference matters:

       • INVARIANT — --accent-fill / --accent-ink are identical under :root,
         [data-theme="light"] and [data-theme="dark"]. The launcher, its unread
         badge, the panel header and the user bubbles are painted from them, so
         their ground can never flip out from under the ink sitting on it
         (white on #3356EE = 5.67:1 in every theme state).
       • THEME-AWARE — --surface / --surface-2 / --ink / --muted /
         --border-strong / --accent / --accent-soft all flip. The panel body is
         painted from these, which is what makes it stop being a white slab on
         the dark site.

       Accent used as INK or as a hairline on a panel surface must use
       --qf-mc-accent-text, NOT --qf-mc-accent: the fixed #3356EE fill is only
       2.78:1 on the dark transcript ground — under the 3:1 floor for a hairline
       and far under 4.5:1 for chip text — while the lightened step clears
       6.58:1. Accent used as a FILL carrying --accent-ink keeps
       --qf-mc-accent. Do not swap them.

       --qf-mc-accent-text is declared LOCALLY below rather than read from the
       site's --accent, because on the marketing homepage (body.qf-wft)
       landing-wefixtrades-cleanup.css pins --accent to a flat #3356EE with
       !important in every theme — measured, not assumed. Same class of override
       the class-name note at the top of this file describes. Its two values
       mirror style.css's own --accent light/dark pair.
       (No backticks in this block: it lives inside a JS template literal.) */
    .qf-mc-fab, .qf-mc-panel, .qf-mc-backdrop {
      /* invariant accent pair — fills that carry --accent-ink */
      --qf-mc-accent:      var(--accent-fill, #3356EE);
      --qf-mc-accent-ink:  var(--accent-ink, #FFFFFF);
      /* theme-aware accent — accent as text / hairline / dot on a panel surface.
         LIGHT value, declared unconditionally so the un-stamped default state
         (no data-theme, no dark OS preference) is correct without a media query. */
      --qf-mc-accent-text: #3356EE;
      --qf-mc-accent-soft: rgba(51, 86, 238, 0.10);
      /* theme-aware panel surfaces + ink */
      --qf-mc-surface:     var(--surface, #FFFFFF);
      --qf-mc-surface-2:   var(--surface-2, #F2F4F7);
      --qf-mc-ink:         var(--ink, #020618);
      --qf-mc-muted:       var(--muted, #475467);
      --qf-mc-line:        var(--border-strong, #CAD5E2);
      /* on-accent chrome. The header ground is the invariant accent, so these
         are deliberately white-alpha in both themes — they sit on #3356EE, not
         on the page. */
      --qf-mc-on-accent-wash: rgba(255, 255, 255, 0.14);
      --qf-mc-on-accent-line: rgba(255, 255, 255, 0.90);
      --qf-mc-on-accent-sub:  rgba(255, 255, 255, 0.90);
      /* scrim behind the mobile sheet — a dimmer, not a surface */
      --qf-mc-scrim: rgba(0, 0, 0, 0.40);
      /* the ONE system shadow this widget uses */
      --qf-mc-shadow: var(--shadow-lg, 0 4px 24px rgba(165, 176, 204, 0.20));
      /* radii — the 6 / 8 / 12 scale plus the pill. --qf-mc-r-tail is the
         corner that points at the speaker; see .qf-mc-msg below. */
      --qf-mc-r:      var(--radius, 12px);
      --qf-mc-r-sm:   var(--radius-btn, 8px);
      --qf-mc-r-tail: 6px;
      --qf-mc-r-pill: var(--radius-pill, 9999px);
      /* motion — the site ships exactly two durations (.2s ×127, .3s ×29) and
         one easing (ease ×198). This widget uses one of each. */
      --qf-mc-dur:  .2s;
      --qf-mc-ease: ease;
      /* minimum comfortable hit area */
      --qf-mc-tap: var(--tap-target, 44px);
    }
    /* DARK re-declaration of the accent ink, under BOTH the explicit stamp and
       the OS preference. Both are required: a value declared only in the media
       query loses to an explicit data-theme="dark", and a value declared only
       under [data-theme] never fires in the un-stamped default. The light value
       above covers the third state. This is the only theme branch in the file;
       every other token flips because style.css already branches for it. */
    html[data-theme="dark"] .qf-mc-fab,
    html[data-theme="dark"] .qf-mc-panel,
    html[data-theme="dark"] .qf-mc-backdrop {
      --qf-mc-accent-text: #8DA2F9;
      --qf-mc-accent-soft: rgba(141, 162, 249, 0.16);
    }
    @media (prefers-color-scheme: dark) {
      html:not([data-theme="light"]) .qf-mc-fab,
      html:not([data-theme="light"]) .qf-mc-panel,
      html:not([data-theme="light"]) .qf-mc-backdrop {
        --qf-mc-accent-text: #8DA2F9;
        --qf-mc-accent-soft: rgba(141, 162, 249, 0.16);
      }
    }
    /* Flat, not a gradient: the design system has zero CSS gradients (the hero
       blues are rasters over a flat base precisely so none exists in CSS), and
       this launcher was the last one left rendering on the site. 12px, not the
       old 16px, snaps it onto the 6/8/12 radius scale; a rounded SQUARE rather
       than a 50% circle because that is the launcher's deliberate identity
       (see the header note) and because the unread badge is pinned to the
       bounding box's top-right corner — on a circle it would float free of the
       edge instead of sitting against it. */
    .qf-mc-fab {
      position: fixed; right: 12px; bottom: 12px;
      width: 56px; height: 56px;
      border-radius: var(--qf-mc-r);
      background: var(--qf-mc-accent);
      color: var(--qf-mc-accent-ink);
      border: 0; cursor: pointer; padding: 0;
      display: flex; align-items: center; justify-content: center;
      box-shadow: var(--qf-mc-shadow);
      z-index: 2147483000;
      transition: transform var(--qf-mc-dur) var(--qf-mc-ease);
    }
    .qf-mc-fab:hover { transform: scale(1.06); }
    .qf-mc-fab:focus-visible { outline: 2px solid var(--qf-mc-accent); outline-offset: 2px; }
    .qf-mc-fab.open { display: none; }
    /* Unread count. Was white on #F97316 — 2.8:1, a fail for 11px text, and a
       second hue in a single-accent system. Inverted instead: the accent as
       INK on the accent's own ink as ground is 5.67:1, clears AA for small
       text, and holds that exact ratio in both themes because neither token
       flips. The 2px ring is the same accent, so the chip stays separated from
       whatever page background it overhangs. */
    .qf-mc-badge {
      position: absolute; top: -6px; right: -6px;
      min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: var(--qf-mc-r-pill);
      background: var(--qf-mc-accent-ink);
      border: 2px solid var(--qf-mc-accent);
      color: var(--qf-mc-accent); font-weight: 800; font-size: 11px; line-height: 1;
      display: flex; align-items: center; justify-content: center;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .qf-mc-badge[hidden] { display: none; }

    .qf-mc-backdrop {
      position: fixed; inset: 0; z-index: 2147482999;
      background: var(--qf-mc-scrim);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      opacity: 0; visibility: hidden; pointer-events: none;
      transition: opacity var(--qf-mc-dur) var(--qf-mc-ease),
                  visibility 0s var(--qf-mc-ease) var(--qf-mc-dur);
    }

    /* The panel body is theme-aware end to end: --surface for the slab, a
       --surface-2 recess for the transcript, --ink for body copy. Nothing here
       may become a hex again — see the token block. */
    .qf-mc-panel {
      position: fixed; right: 16px; bottom: 16px;
      box-sizing: border-box;
      width: 400px; max-width: calc(100vw - 16px);
      height: 660px; max-height: 92vh;
      background: var(--qf-mc-surface);
      color: var(--qf-mc-ink);
      /* A hairline, not a heavier shadow: on the dark page the panel surface is
         only 1.4:1 against the page ground, and the system shadow is a light-
         theme lift that all but disappears there. The border is what actually
         draws the panel's edge in dark. */
      border: 1px solid var(--qf-mc-line);
      border-radius: var(--qf-mc-r);
      box-shadow: var(--qf-mc-shadow);
      z-index: 2147483001;
      display: flex; flex-direction: column;
      overflow: hidden;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif;
      opacity: 0; visibility: hidden;
      transform: translateY(12px) scale(0.96);
      transform-origin: bottom right;
      transition: opacity var(--qf-mc-dur) var(--qf-mc-ease),
                  transform var(--qf-mc-dur) var(--qf-mc-ease),
                  visibility 0s var(--qf-mc-ease) var(--qf-mc-dur);
    }
    .qf-mc-panel * { box-sizing: border-box; }
    .qf-mc-panel.open {
      opacity: 1; visibility: visible;
      transform: translateY(0) scale(1);
      transition: opacity var(--qf-mc-dur) var(--qf-mc-ease),
                  transform var(--qf-mc-dur) var(--qf-mc-ease),
                  visibility 0s var(--qf-mc-ease) 0s;
    }

    /* Header. Deliberately the INVARIANT accent in both themes — it is the
       brand band, and holding it fixed is what guarantees 5.67:1 for the ink
       sitting on it no matter which theme the host page is in. Everything in
       here inherits that ink via currentColor. Left-aligned, per the header rule. */
    .qf-mc-head {
      padding: 12px 16px;
      background: var(--qf-mc-accent);
      color: var(--qf-mc-accent-ink);
      display: flex; align-items: center; gap: 12px;
      flex-shrink: 0;
    }
    .qf-mc-avatar {
      width: 32px; height: 32px; flex-shrink: 0;
      border-radius: var(--qf-mc-r-sm);
      background: var(--qf-mc-on-accent-wash);
      border: 1px solid var(--qf-mc-on-accent-line);
      display: flex; align-items: center; justify-content: center;
    }
    .qf-mc-head .qf-mc-meta { flex: 1; min-width: 0; }
    .qf-mc-head .title {
      font-weight: 800; font-size: 15px; line-height: 1.2;
    }
    .qf-mc-head .sub {
      font-size: 12px; color: var(--qf-mc-on-accent-sub); margin-top: 4px;
      display: flex; align-items: center; gap: 8px; line-height: 1.3;
    }
    /* Status pip. Was #34D399 with a green glow — a second hue in a
       single-accent system, only 2.95:1 against the accent band, and a fourth
       shadow. It is decoration next to the word "Online", which carries the
       meaning, so it now paints in the header's own ink: 5.67:1, one hue,
       no glow. */
    .qf-mc-head .sub .live {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--qf-mc-accent-ink);
      flex-shrink: 0;
    }
    .qf-mc-close {
      background: transparent; border: 0; cursor: pointer; padding: 4px;
      color: inherit;
      display: flex; align-items: center; justify-content: center;
      border-radius: var(--qf-mc-r-sm); opacity: 0.8;
      transition: opacity var(--qf-mc-dur) var(--qf-mc-ease);
    }
    .qf-mc-close:hover { opacity: 1; }
    .qf-mc-close:focus-visible { outline: 2px solid var(--qf-mc-on-accent-line); opacity: 1; }

    /* Transcript sits in the --surface-2 recess so the input row below it and
       the header above it separate by a surface change, not by a divider rule. */
    .qf-mc-msgs {
      flex: 1; overflow-y: auto; padding: 16px;
      display: flex; flex-direction: column; gap: 8px;
      background: var(--qf-mc-surface-2);
    }
    .qf-mc-msg {
      padding: 8px 12px;
      font-size: 13px; line-height: 1.5;
      word-wrap: break-word; white-space: pre-wrap;
    }
    /* The odd corner on each bubble is a TAIL, not a stray radius: it is the
       corner nearest the speaker's edge of the panel — bottom-RIGHT on the
       right-aligned user bubble, bottom-LEFT on the left-aligned agent bubble.
       It was 4px against 14px, both off-system; it is now 6px against 12px,
       which keeps the tail unmistakable while putting every corner on the
       6/8/12 scale. Do not flatten it to a uniform radius. */
    .qf-mc-msg.user {
      align-self: flex-end; max-width: 82%;
      background: var(--qf-mc-accent);
      color: var(--qf-mc-accent-ink);
      border-radius: var(--qf-mc-r) var(--qf-mc-r) var(--qf-mc-r-tail) var(--qf-mc-r);
    }
    .qf-mc-msg.assistant {
      align-self: flex-start; max-width: 92%;
      background: var(--qf-mc-surface); color: var(--qf-mc-ink);
      border: 1px solid var(--qf-mc-line);
      border-radius: var(--qf-mc-r) var(--qf-mc-r) var(--qf-mc-r) var(--qf-mc-r-tail);
    }

    .qf-mc-typing {
      align-self: flex-start;
      display: flex; align-items: center; gap: 4px;
      padding: 12px;
      background: var(--qf-mc-surface); border: 1px solid var(--qf-mc-line);
      border-radius: var(--qf-mc-r) var(--qf-mc-r) var(--qf-mc-r) var(--qf-mc-r-tail);
    }
    /* Theme-AWARE accent, not the fixed fill: #3356EE dots on the dark bubble
       ground are 2.80:1, under the 3:1 floor for a non-text indicator. */
    .qf-mc-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--qf-mc-accent-text);
      animation: qf-mc-bounce 1.3s var(--qf-mc-ease) infinite both;
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
    /* Chips carry the theme-aware accent as both ink and hairline (5.16:1 light,
       6.58:1 dark against the transcript ground, so the outline itself clears
       the 3:1 non-text floor). Hover swaps the wash, not the border width, so
       nothing reflows. */
    .qf-mc-chip {
      padding: 8px 12px;
      background: transparent;
      border: 1px solid var(--qf-mc-accent-text);
      color: var(--qf-mc-accent-text);
      border-radius: var(--qf-mc-r-pill);
      font-size: 13px; font-weight: 600; line-height: 1.2;
      cursor: pointer;
      font-family: inherit;
      transition: background var(--qf-mc-dur) var(--qf-mc-ease);
    }
    .qf-mc-chip:hover { background: var(--qf-mc-accent-soft); }
    .qf-mc-chip:focus-visible { outline: 2px solid var(--qf-mc-accent-text); outline-offset: 1px; }

    /* No border-top: the transcript above is --surface-2 and this row is
       --surface, so the seam is a surface change. Dividers are gaps, not rules. */
    .qf-mc-input-row {
      display: flex; align-items: center; gap: 8px; padding: 12px 16px;
      background: var(--qf-mc-surface); flex-shrink: 0;
    }
    /* Site input convention (style.css .input): --surface-2 ground, hairline in
       --border-strong, --ink text, accent ring on focus. The placeholder is the
       field's only title — there is no label above it to duplicate — so it uses
       --muted, not --muted-soft: --muted-soft is 2.63:1 on white and reads as
       absent even though it is the site's default placeholder ink. */
    .qf-mc-field {
      flex: 1; min-width: 0; min-height: var(--qf-mc-tap);
      padding: 12px;
      background: var(--qf-mc-surface-2); color: var(--qf-mc-ink);
      border: 1px solid var(--qf-mc-line); border-radius: var(--qf-mc-r-sm);
      font-size: 13px; font-family: inherit; line-height: 1.4;
      transition: border-color var(--qf-mc-dur) var(--qf-mc-ease);
    }
    .qf-mc-field::placeholder { color: var(--qf-mc-muted); opacity: 1; }
    .qf-mc-field:focus {
      outline: 0;
      border-color: var(--qf-mc-accent-text);
      box-shadow: 0 0 0 3px var(--qf-mc-accent-soft);
    }
    .qf-mc-submit {
      width: var(--qf-mc-tap); height: var(--qf-mc-tap); flex-shrink: 0;
      background: var(--qf-mc-accent);
      color: var(--qf-mc-accent-ink);
      border: 0; border-radius: var(--qf-mc-r-sm); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: transform var(--qf-mc-dur) var(--qf-mc-ease),
                  opacity var(--qf-mc-dur) var(--qf-mc-ease);
    }
    .qf-mc-submit:hover:not(:disabled) { transform: scale(1.05); }
    .qf-mc-submit:focus-visible { outline: 2px solid var(--qf-mc-accent-text); outline-offset: 1px; }
    .qf-mc-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .qf-mc-foot {
      padding: 8px 16px 12px;
      font-size: 11px; color: var(--qf-mc-muted);
      text-align: left; line-height: 1.4;
      background: var(--qf-mc-surface); flex-shrink: 0;
    }

    /* Full-screen sheet on phones, with a tappable blurred backdrop.
       THE LAUNCHER STAYS IN THE CORNER. It used to be lifted 84px on phones to
       clear a bottom-anchored CTA, and then three separate rules put it back in
       the corner for landing, for directory pages with an action bar, and for
       the OS/OW calculator — because on each of those the lift parked it on top
       of real content instead.

       Three exceptions to one default is a default that is wrong more often
       than it is right, and the fourth case proved it: on the heavy-haul quote
       tool the lifted launcher sat over the delivery-address input at 375px,
       covering 1,330 square pixels of a field the user has to fill in.

       So the lift is gone rather than exception number four. The element it was
       protecting — the bottom dock nav — is not rendered by any page in this
       codebase; the .dock rules are dead CSS, so the lift was clearing an
       obstacle that
       no longer exists. The launcher now sits snug in the bottom-right corner
       everywhere, which is where Alex asked for it on each of the three pages
       that had to ask individually. Pages whose last line would sit under it
       add their own bottom padding, as the OS/OW tool already does. */
    @media (max-width: 480px) {
      .qf-mc-panel {
        top: 80px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); left: 8px;
        width: auto; height: auto; max-width: none; max-height: none;
      }
      .qf-mc-backdrop.open {
        opacity: 1; visibility: visible; pointer-events: auto;
        transition: opacity var(--qf-mc-dur) var(--qf-mc-ease),
                    visibility 0s var(--qf-mc-ease) 0s;
      }
    }

    /* Pages that opt in with body.qf-mc-hide-sm (signup, pricing) hide the
       floating launcher on narrow phones (<=420px). On those two funnel
       surfaces the fixed bottom-right bubble overlapped real content — the
       signup "Your link" slug field and the mobile pricing Vital feature list.
       Every link/action on both pages is reachable without the chat, so the
       cleanest fix is to drop the launcher (and any open panel) at phone width.
       Desktop and 421px+ are untouched (the 84px lift above still applies). */
    @media (max-width: 420px) {
      body.qf-mc-hide-sm .qf-mc-fab,
      body.qf-mc-hide-sm .qf-mc-panel,
      body.qf-mc-hide-sm .qf-mc-backdrop { display: none !important; }
    }

    /* Reduced motion. Everything that animates is listed here — the panel and
       backdrop entrance, the launcher / send / close / chip / field state
       transitions, the send-button scale, and the typing bounce. The bounce is
       the one keyframe animation in the widget; it is killed outright and the
       dots are pinned at a visible opacity so the indicator still reads.
       visibility is re-declared without its delay so a panel that stops
       animating still actually hides. */
    @media (prefers-reduced-motion: reduce) {
      .qf-mc-fab, .qf-mc-close, .qf-mc-chip, .qf-mc-field, .qf-mc-submit {
        transition: none;
      }
      .qf-mc-panel, .qf-mc-backdrop,
      .qf-mc-panel.open, .qf-mc-backdrop.open {
        transition: none;
      }
      .qf-mc-panel { transform: none; }
      .qf-mc-fab:hover, .qf-mc-submit:hover:not(:disabled) { transform: none; }
      .qf-mc-typing span { animation: none; opacity: 1; }
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
      '<input class="qf-mc-field" id="qf-mc-input" aria-label="Ask QuoteFleet a question" ' +
        'placeholder="Ask about pricing, features, signup…" autocomplete="off">' +
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
