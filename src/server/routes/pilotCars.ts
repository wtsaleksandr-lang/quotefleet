/**
 * THE PILOT CAR / ESCORT OPERATOR DIRECTORY — opt-in, structured, filterable.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────
 * QuoteFleet already publishes, with citations, WHAT ESCORTS A LOAD REQUIRES:
 * `src/calc/osow/escortRules.ts`, surfaced at `/tools/oversize-permits` and
 * `/tools/heavy-haul-quote`. A dispatcher who arrives here from a quote that
 * said "Kentucky requires 1 certified escort" is not browsing — they have a
 * load, a lane and a gap. That is the whole design constraint: this directory
 * is the second half of a sentence the quote tools already started, and the
 * links from those tools arrive PRE-FILTERED to the states and certifications
 * that load actually needs (`escortDirectoryHref`).
 *
 * ── THE GAP IN WHAT EXISTS TODAY ──────────────────────────────────────────
 * Every attribute that decides whether an operator can legally take a job is,
 * on the existing directories, free text — which means unfilterable. So the
 * whole product here is that `states_covered`, per-state certification with its
 * own expiry, equipment, escort-vehicle GVWR and insurance are COLUMNS, and the
 * filter reads them. Nothing on this page searches prose.
 *
 * ── THE THREE RULES THAT OVERRIDE EVERY OTHER CONSIDERATION ───────────────
 *
 * 1. OPT-IN ONLY. No record here was scraped, imported or seeded from any other
 *    directory. A record exists because that operator submitted it and ticked a
 *    consent box the schema will not accept as false. There is no ingest job in
 *    this feature and there is nowhere for one to write.
 *
 * 2. A SELF-REPORTED CLAIM NEVER WEARS A VERIFIED BADGE. Every operator card
 *    and every profile carries its verification tier, and the default tier says
 *    in words that the operator entered it and nobody checked. That is the
 *    precise failure of the incumbents — one of them publishes self-asserted
 *    certifications with no indication that they are self-asserted — and it is
 *    the one thing a directory cannot get wrong and still be worth reading.
 *
 * 3. WITH THE DATABASE DOWN, EVERY PAGE STILL RENDERS, AND IT SAYS "WE CANNOT
 *    REACH THE DIRECTORY", NEVER "NO OPERATORS FOUND". The dev Neon branch is
 *    over quota and 500s today. `store.ts` returns `unavailable: true` rather
 *    than throwing or returning an empty list, and the templates below branch on
 *    it. An absence of data presented as an absence of operators would send a
 *    dispatcher looking somewhere else for a supplier who is right here.
 *
 * ── ROUTES ────────────────────────────────────────────────────────────────
 *   GET  /pilot-cars                 — the filterable index (no account).
 *   GET  /pilot-cars/join            — the submission form.
 *   GET  /pilot-cars/manage/:token   — the operator's own record: edit, withdraw, delete.
 *   GET  /pilot-cars/:slug           — one operator's public profile.
 *   POST /api/pilot-cars             — submit. Rate-limited.
 *   POST /api/pilot-cars/manage/:token        — update own record. Rate-limited.
 *   POST /api/pilot-cars/manage/:token/delete — delete own record. Rate-limited.
 *   GET  /api/pilot-cars             — JSON mirror of the filtered list.
 *   GET  /api/admin/pilot-cars       — moderation queue (super-admin).
 *   POST /api/admin/pilot-cars/:slug — moderate (super-admin).
 *
 * The FILTER IS A GET FORM with no JavaScript. Every filtered view is a URL a
 * dispatcher can paste into an email, and the page works with scripts blocked —
 * which the quote-tool deep links depend on being true.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { todayIso } from '../../calc/osow/provenance.js';
import {
  CERTIFICATION_LABEL,
  PILOT_CAR_CERTIFICATION,
  PILOT_CAR_STATE_CODES,
  certificationFor,
  statesRequiringCertification,
} from '../../calc/osow/pilotCar/certification.js';
import {
  EQUIPMENT_KEYS,
  EQUIPMENT_LABEL,
  OPERATORS_PER_PAGE,
  SubmissionSchema,
  VEHICLE_CLASSES,
  VEHICLE_CLASS_LABEL,
  VERIFICATION_LABEL,
  VERIFICATION_TIERS,
  filtersToQuery,
  hasAnyFilter,
  parseFilters,
  type OperatorFilters,
  type PublicOperator,
} from '../pilotCars/model.js';
import {
  createOperator,
  deleteOperatorByToken,
  getOperatorBySlug,
  getOperatorByToken,
  listForModeration,
  listOperators,
  moderateOperator,
  setListingStatusByToken,
  updateOperatorByToken,
} from '../pilotCars/store.js';
import { publicCalcLimiter, publicLeadLimiter } from '../rateLimits.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import { stateByCode } from '../directory/usStates.js';
import { FULL_SITE_HEADER, PREMIUM_FOOTER, HEADER_SCRIPTS } from '../siteChrome.js';
import { requireAuth, requireSuperAdmin } from '../middleware.js';
import { OSOW_TOOL_PATH } from './osowPermits.js';

const SITE = 'https://quotefleet.net';
export const PILOT_CAR_PATH = '/pilot-cars';
export const PILOT_CAR_JOIN_PATH = '/pilot-cars/join';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string,
  );
}

function stateName(code: string): string {
  return stateByCode(code)?.name ?? code;
}

/**
 * The escort-vehicle mass filters, in POUNDS because the stored column is
 * pounds, labelled in BOTH units because the rules that motivate them are
 * written in both.
 *
 * The Tennessee figure is the one we hold a citation for
 * (`certification.ts`, Tenn. Comp. R. & Regs. 1680-07-01-.21: GVWR under
 * 18,000 lb). The metric bands exist because several Canadian provinces cap the
 * escort vehicle by mass rather than by certification — and the page says in
 * terms that those provincial figures are NOT in our cited corpus and must be
 * confirmed with the province. A filter is a tool for narrowing a list; it is
 * not us asserting a limit.
 */
const GVWR_BANDS: ReadonlyArray<{ lbs: number; label: string }> = [
  { lbs: 9_920, label: 'Up to 4,500 kg (9,920 lb)' },
  { lbs: 13_227, label: 'Up to 6,000 kg (13,227 lb)' },
  { lbs: 17_636, label: 'Up to 8,000 kg (17,636 lb)' },
  { lbs: 17_999, label: 'Under 18,000 lb — Tennessee’s cited cap' },
];

const INSURANCE_BANDS: ReadonlyArray<{ usd: number; label: string }> = [
  { usd: 100_000, label: '$100,000+' },
  { usd: 300_000, label: '$300,000+' },
  { usd: 1_000_000, label: '$1,000,000+' },
];

// ── CSS ────────────────────────────────────────────────────────────────────
//
// Lives here rather than in public/*.css for the same reason OSOW_CSS and
// SEASONAL_CSS do: the page is server-rendered from one file and its styles
// travel with it. Every colour is a token from style.css, so light and dark
// both work with no `data-theme` block of our own and no raw hex anywhere.

const PC_CSS = `
  .pc-shell { max-width: 1180px; margin: 0 auto; padding: 8px 24px 24px; }
  /* Shared .hero centres its text. Left-align it and centre the same column the
     body uses, so the H1 starts on the body's left edge. */
  .pc-hero { padding: 48px 24px 16px; text-align: left; }
  .pc-hero .container-narrow { max-width: 1132px; margin: 0 auto; padding: 0; }
  .pc-eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; text-align: left; }
  .pc-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; text-align: left; text-wrap: balance; }
  .pc-hero p.lead { max-width: 780px; margin: 0; text-align: left; text-wrap: pretty; }

  /* Honesty banner. Solid, never glass — body text sits on it. */
  .pc-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .pc-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .pc-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .pc-truth strong { color: var(--ink); }
  .pc-truth + .pc-truth { margin-top: 12px; }

  /* THE DATABASE-DOWN BANNER. Its own treatment, and its own words: this is
     "we cannot reach the directory", which is a different sentence from "no
     operators match". Drawn as an error rather than as an empty state so it can
     never be mistaken for a result. */
  .pc-down { background: var(--surface); border: 1px solid var(--error); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .pc-down h2 { font-size: 16px; margin: 0 0 4px; color: var(--error); text-align: left; }
  .pc-down p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }

  .pc-grid { display: grid; grid-template-columns: minmax(0, 300px) minmax(0, 1fr); gap: 24px; align-items: start; margin-top: 16px; }

  /* ── Filters. A plain GET form: every view is a shareable URL. ─────────── */
  .pc-filters { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: grid; gap: 16px; }
  .pc-filters h2 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .pc-fset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
  .pc-fset > legend { padding: 0; font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  /* The help cue is TOP-LEFT of its group and never inline with a control. */
  .pc-help { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .pc-checks { display: grid; gap: 4px; }
  .pc-check { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; color: var(--ink-soft); min-height: 24px; }
  .pc-check input { margin: 4px 0 0; min-width: 16px; min-height: 16px; accent-color: var(--accent); }

  /* Input title IN the field, help text above and left, 2px between the two. */
  .pc-field { position: relative; display: block; }
  .pc-field select, .pc-field input { width: 100%; min-height: 48px; padding: 20px 12px 8px; background: var(--surface-3); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--ink); font-size: 14px; font-family: inherit; appearance: none; }
  .pc-field select:focus-visible, .pc-field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pc-lab { position: absolute; top: 6px; left: 12px; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); pointer-events: none; }
  .pc-field + .pc-help { margin-top: 2px; }
  /* A MULTI-SELECT IS A LIST BOX, AND PADDING-TOP DOES NOT MOVE ITS ROWS.
     The in-field title is absolutely positioned, so on a multiple-select it
     printed straight over the first option — "STATES COVERED" sitting on top of
     "Hawaii". The field's BORDER moves to the wrapper and the select loses its
     own box, so the title occupies real space above the rows and the control
     still reads as one field with its title inside it. */
  .pc-field--list { position: relative; background: var(--surface-3); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 24px 4px 4px; display: block; }
  .pc-field--list select { width: 100%; min-height: 132px; padding: 0 8px; background: transparent; border: 0; color: var(--ink); font-size: 14px; font-family: inherit; }
  .pc-field--list select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pc-field--list + .pc-help { margin-top: 2px; }

  .pc-actions { display: grid; gap: 8px; }
  .pc-actions .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }

  /* ── Results. ─────────────────────────────────────────────────────────── */
  .pc-results { display: grid; gap: 16px; }
  .pc-count { margin: 0; font-size: 13px; color: var(--muted); font-family: var(--font-mono); }
  .pc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .pc-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .pc-card h3 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .pc-card h3 a { color: inherit; text-decoration: none; }
  .pc-card h3 a:hover, .pc-card h3 a:focus-visible { text-decoration: underline; }
  .pc-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .pc-meta { color: var(--muted); font-size: 12px; font-family: var(--font-mono); }

  /* PILLS ARE OUTLINE, NEVER A BRIGHT FILL, and a pill never wraps in half. The
     groups below are laid out so a run never strands one pill alone on a line —
     they either sit together or stack evenly. */
  .pc-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .pc-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; line-height: 1.2; padding: 4px 10px; white-space: nowrap; }
  .pc-pill.is-cert { border-color: var(--accent); color: var(--accent); }
  .pc-pill.is-warn { border-color: var(--warn); color: var(--warn); }
  .pc-pill.is-lapsed { border-color: var(--error); color: var(--error); }

  /* THE VERIFICATION TIER. A self-reported claim gets a DASHED outline and the
     word "self-reported" — it is the operator's statement, we did not check it,
     and it must never borrow the styling of one we did. A checked claim gets a
     solid outline and the register's own link. Neither is ever a filled badge. */
  .pc-tier { display: inline-flex; align-items: center; gap: 6px; border-radius: var(--radius-pill); padding: 4px 10px; font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; border: 1px dashed var(--muted); color: var(--muted); background: transparent; }
  .pc-tier.is-doc { border-style: solid; border-color: var(--warn); color: var(--warn); }
  .pc-tier.is-registry { border-style: solid; border-color: var(--success); color: var(--success); }
  .pc-tiernote { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }

  .pc-empty { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .pc-empty h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .pc-empty p { margin: 0 0 8px; font-size: 14px; line-height: 1.55; color: var(--ink-soft); }
  .pc-empty ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .pc-empty li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); }

  .pc-sec { margin: 28px 0 0; }
  .pc-sec h2 { font-size: 20px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .pc-sec p.pc-sub { margin: 0 0 12px; color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 780px; }

  /* The state certification reference table. Scrolls INSIDE its own box at
     narrow widths — the wrapper is what scrolls, so document.scrollWidth never
     moves, which the e2e suite asserts rather than eyeballs. overflow-x: auto,
     never hidden, so nothing sticky inside it is broken. */
  .pc-tablewrap { overflow-x: auto; }
  .pc-table { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 13px; }
  .pc-table th, .pc-table td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--border); color: var(--ink-soft); vertical-align: top; }
  .pc-table th { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
  .pc-table tbody tr:last-child td { border-bottom: none; }

  .pc-detail { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .pc-detail + .pc-detail { margin-top: 16px; }
  .pc-detail h2 { font-size: 16px; margin: 0 0 8px; color: var(--ink); text-align: left; }
  .pc-dl { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: 8px 16px; margin: 0; font-size: 14px; }
  .pc-dl dt { color: var(--muted); }
  .pc-dl dd { margin: 0; color: var(--ink-soft); overflow-wrap: anywhere; }

  .pc-link { color: var(--accent); font-size: 13px; overflow-wrap: anywhere; }

  /* ── The submission / manage form. ────────────────────────────────────── */
  .pc-form { max-width: 780px; display: grid; gap: 16px; }
  .pc-card--form { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: grid; gap: 12px; }
  .pc-card--form h2 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .pc-row2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .pc-statebox { max-height: 260px; overflow-y: auto; overflow-x: clip; border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .pc-note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .pc-say { margin: 0; font-size: 14px; line-height: 1.55; padding: 12px; border-radius: var(--radius); border: 1px solid var(--border-strong); color: var(--ink-soft); }
  .pc-say.is-err { border-color: var(--error); color: var(--error); }
  .pc-say.is-ok { border-color: var(--success); color: var(--ink-soft); }
  .pc-token { font-family: var(--font-mono); font-size: 13px; overflow-wrap: anywhere; color: var(--ink); }

  @media (max-width: 960px) {
    .pc-grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .pc-hero h1 { font-size: 28px; }
    .pc-hero { padding: 32px 16px 12px; }
    /* 80px of bottom clearance so the last line never ends up under the fixed
       chat launcher, which sits bottom-right at phone widths. */
    .pc-shell { padding: 8px 16px 80px; }
    .pc-cards { grid-template-columns: minmax(0, 1fr); }
    .pc-dl { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .pc-dl dd { margin: 0 0 8px; }
    .pc-row2 { grid-template-columns: minmax(0, 1fr); }
    /* TWO COLUMNS, NOT THREE. At 375px a three-column state grid leaves the
       last row holding one checkbox beside two empty cells; 51 codes over two
       columns ends 26/25, which reads as a list rather than as a fault. */
    .pc-statebox { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pc-field select, .pc-field input { font-size: 16px; }
  }
`;

// ── Shared page shell ──────────────────────────────────────────────────────

function page(title: string, description: string, path: string, body: string, extra = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${path}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <link rel="stylesheet" href="/nav-unify.css">
  <style>${PC_CSS}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${extra}
</head>
<body>
  ${FULL_SITE_HEADER}
  ${body}
  ${PREMIUM_FOOTER}
  ${HEADER_SCRIPTS}
  <script src="/pilot-cars.js" defer></script>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
}

/** The banner that says the DATABASE is unreachable — never "none found". */
const DB_DOWN_HTML = `<div class="pc-down" id="pc-unavailable">
  <h2>We cannot reach the directory right now</h2>
  <p><strong>This is not "no operators found".</strong> Our operator database is unreachable, so we cannot tell you who is listed — refresh in a minute. Everything else on this page is compiled data and is unaffected: the per-state certification rules below are correct as shown. If you need an escort today, the state DOT permit office for each state on your route keeps its own list of certified operators.</p>
</div>`;

// ── Verification, rendered ─────────────────────────────────────────────────

/**
 * THE TIER PILL AND THE SENTENCE UNDER IT, never one without the other.
 *
 * A tier word on its own is a badge, and a badge is what a reader pattern-matches
 * to "approved". The `meaning` line is what makes "Self-reported" mean something,
 * so the two are emitted together by one function and there is no way to render
 * the pill alone.
 */
function tierBlock(op: PublicOperator): string {
  const meta = VERIFICATION_LABEL[op.verificationTier];
  const cls =
    op.verificationTier === 'registry-verified'
      ? ' is-registry'
      : op.verificationTier === 'document-on-file'
        ? ' is-doc'
        : '';
  const on = op.verifiedOn ? ` on ${esc(op.verifiedOn)}` : '';
  const src = op.verificationSourceUrl
    ? ` <a class="pc-link" href="${esc(op.verificationSourceUrl)}" rel="nofollow noopener" target="_blank">the register we checked</a>.`
    : '';
  return `<span class="pc-tier${cls}">${esc(meta.label)}</span>
    <p class="pc-tiernote">${esc(meta.meaning)}${op.verificationTier === 'self-asserted' ? '' : esc(on)}${src}</p>`;
}

/**
 * The per-state certification pills for one operator.
 *
 * A LAPSED CERTIFICATE IS SHOWN AS LAPSED, not hidden and not shown as held.
 * Hiding it would make the operator look like they never claimed it; showing it
 * plain would make an expired card read as current. Either way a dispatcher
 * books someone who cannot legally run the leg.
 */
function certPills(op: PublicOperator): string {
  if (op.certifications.length === 0) {
    return '<div class="pc-pills"><span class="pc-pill">No certification stated</span></div>';
  }
  const pills = op.certifications
    .slice(0, 12)
    .map((c) => {
      if (c.status === 'certified') {
        return c.expired
          ? `<span class="pc-pill is-lapsed">${esc(c.state)} certificate lapsed${c.expiresOn ? ` ${esc(c.expiresOn)}` : ''}</span>`
          : `<span class="pc-pill is-cert">${esc(c.state)} certified${c.expiresOn ? ` to ${esc(c.expiresOn)}` : ' · no expiry on file'}</span>`;
      }
      if (c.status === 'reciprocity') {
        return `<span class="pc-pill is-warn">${esc(c.state)} on a ${esc(c.issuedByState ?? '')} card — claim</span>`;
      }
      if (c.status === 'not-required') {
        return `<span class="pc-pill">${esc(c.state)} certifies nobody</span>`;
      }
      return `<span class="pc-pill">${esc(c.state)} not certified</span>`;
    })
    .join('');
  return `<div class="pc-pills">${pills}</div>`;
}

function operatorCard(op: PublicOperator): string {
  const where = [op.homeBaseCity, op.homeBaseState].filter(Boolean).join(', ');
  const covers = op.statesCovered.slice(0, 10).join(' · ');
  const more = op.statesCovered.length > 10 ? ` +${op.statesCovered.length - 10} more` : '';
  const equip = EQUIPMENT_KEYS.filter((k) => op.equipment[k]).map((k) => EQUIPMENT_LABEL[k]);
  return `<article class="pc-card">
    <h3><a href="${esc(PILOT_CAR_PATH)}/${esc(op.slug)}">${esc(op.businessName)}</a></h3>
    ${tierBlock(op)}
    ${where ? `<p class="pc-meta">${esc(where)}${op.serviceRadiusMi != null ? ` · ${esc(op.serviceRadiusMi)} mi radius` : ''}</p>` : ''}
    <p><strong>Runs in:</strong> ${esc(covers)}${esc(more)}</p>
    ${certPills(op)}
    ${equip.length > 0 ? `<p class="pc-meta">${esc(equip.join(' · '))}</p>` : '<p class="pc-meta">No equipment stated</p>'}
    ${
      op.vehicleGvwrLbs != null
        ? `<p class="pc-meta">Escort vehicle ${esc(op.vehicleGvwrLbs.toLocaleString('en-US'))} lb GVWR${op.vehicleClass ? ` · ${esc(VEHICLE_CLASS_LABEL[op.vehicleClass])}` : ''}</p>`
        : '<p class="pc-meta">Escort vehicle GVWR not stated</p>'
    }
  </article>`;
}

// ── The index ──────────────────────────────────────────────────────────────

function stateOptions(selected: string[]): string {
  return PILOT_CAR_STATE_CODES.map(
    (c) =>
      `<option value="${esc(c)}"${selected.includes(c) ? ' selected' : ''}>${esc(stateName(c))}</option>`,
  ).join('');
}

function filterForm(f: OperatorFilters): string {
  const equipChecks = EQUIPMENT_KEYS.map(
    (k) =>
      `<label class="pc-check"><input type="checkbox" name="equip" value="${esc(k)}"${f.equipment.includes(k) ? ' checked' : ''}><span>${esc(EQUIPMENT_LABEL[k])}</span></label>`,
  ).join('');

  const gvwrOptions = GVWR_BANDS.map(
    (b) => `<option value="${b.lbs}"${f.maxGvwrLbs === b.lbs ? ' selected' : ''}>${esc(b.label)}</option>`,
  ).join('');

  const insuranceOptions = INSURANCE_BANDS.map(
    (b) => `<option value="${b.usd}"${f.minInsuranceUsd === b.usd ? ' selected' : ''}>${esc(b.label)}</option>`,
  ).join('');

  const tierOptions = VERIFICATION_TIERS.map(
    (t) => `<option value="${esc(t)}"${f.minTier === t ? ' selected' : ''}>${esc(VERIFICATION_LABEL[t].label)} or better</option>`,
  ).join('');

  const classOptions = VEHICLE_CLASSES.map(
    (c) => `<option value="${esc(c)}"${f.vehicleClass === c ? ' selected' : ''}>${esc(VEHICLE_CLASS_LABEL[c])}</option>`,
  ).join('');

  return `<form class="pc-filters" method="get" action="${esc(PILOT_CAR_PATH)}">
    <h2>Filter by what the job needs</h2>

    <div class="pc-fset">
      <p class="pc-help">An operator must cover EVERY state you pick — a lane is an AND, not a shortlist. Hold Ctrl (or Cmd) to pick more than one.</p>
      <label class="pc-field--list"><span class="pc-lab">States on the route</span><select name="states" multiple size="6">${stateOptions(f.states)}</select></label>
    </div>

    <div class="pc-fset">
      <p class="pc-help">Only a current, unexpired certificate in that state counts. A card from a state that reciprocates is shown on the profile but never satisfies this filter — whether it is accepted is the working state's call, not the operator's.</p>
      <label class="pc-field--list"><span class="pc-lab">Must be certified in</span><select name="certin" multiple size="5">${stateOptions(f.certifiedIn)}</select></label>
    </div>

    <fieldset class="pc-fset">
      <legend>Equipment carried</legend>
      <p class="pc-help">Self-reported by the operator unless the profile says otherwise.</p>
      <div class="pc-checks">${equipChecks}</div>
    </fieldset>

    <fieldset class="pc-fset">
      <legend>Escort vehicle</legend>
      <p class="pc-help">An operator can be certified and still illegal: several jurisdictions cap the escort vehicle itself. Operators who have not stated a GVWR are excluded from this filter rather than assumed to fit.</p>
      <label class="pc-field"><select name="maxgvwr" aria-label="Maximum GVWR"><option value="">Any GVWR</option>${gvwrOptions}</select><span class="pc-lab">Max GVWR</span></label>
      <label class="pc-field"><select name="vclass" aria-label="Vehicle type"><option value="">Any vehicle type</option>${classOptions}</select><span class="pc-lab">Vehicle type</span></label>
    </fieldset>

    <fieldset class="pc-fset">
      <legend>Cover and capability</legend>
      <p class="pc-help">Insurance limits are as the operator states them. Ask for the certificate before you dispatch.</p>
      <label class="pc-field"><select name="mininsurance" aria-label="Minimum liability cover"><option value="">Any cover</option>${insuranceOptions}</select><span class="pc-lab">Liability cover</span></label>
      <div class="pc-checks">
        <label class="pc-check"><input type="checkbox" name="superload" value="1"${f.superloads ? ' checked' : ''}><span>Takes superloads</span></label>
        <label class="pc-check"><input type="checkbox" name="night" value="1"${f.nightMoves ? ' checked' : ''}><span>Runs night moves</span></label>
      </div>
    </fieldset>

    <fieldset class="pc-fset">
      <legend>How much we checked</legend>
      <p class="pc-help">Most records are self-reported, and that is the honest default. Raise this to see only the records where somebody here looked at a document or at the issuing state's own register.</p>
      <label class="pc-field"><select name="tier" aria-label="Verification level"><option value="">Any verification level</option>${tierOptions}</select><span class="pc-lab">Verification</span></label>
    </fieldset>

    <div class="pc-actions">
      <button type="submit" class="btn btn-primary">Apply filters</button>
      <a class="btn btn-secondary" href="${esc(PILOT_CAR_PATH)}">Clear all</a>
    </div>
  </form>`;
}

/**
 * The empty state.
 *
 * TWO DIFFERENT EMPTIES, and conflating them is the bug this whole feature is
 * careful about. `unavailable` is handled by the caller with its own banner;
 * this one only ever renders for a query that genuinely matched nothing, and it
 * says which filter is most likely to be the reason — an AND over seven states
 * is a narrow ask and the reader deserves to be told that rather than left to
 * conclude the trade has no operators in it.
 */
function emptyState(f: OperatorFilters): string {
  const perState = f.states
    .map(
      (s) =>
        `<li><a class="pc-link" href="${esc(PILOT_CAR_PATH)}?states=${esc(s)}">Operators who run in ${esc(stateName(s))} alone</a></li>`,
    )
    .join('');
  return `<div class="pc-empty">
    <h2>No listed operator matches all of that</h2>
    <p>${
      f.states.length > 1
        ? `You asked for one operator who covers all ${f.states.length} states on the route. Most pilot-car outfits work a region, so a long lane is usually two or three operators handing off rather than one.`
        : 'Nothing in the directory matches those filters yet. This directory is opt-in and new — every record is here because that operator submitted it.'
    }</p>
    ${perState ? `<ul>${perState}</ul>` : ''}
    <p><a class="pc-link" href="${esc(PILOT_CAR_JOIN_PATH)}">Run pilot cars? List your service — free, and you keep the record.</a></p>
  </div>`;
}

/** The certification reference table — compiled data, so it renders DB or no DB. */
function certificationReference(): string {
  const rows = PILOT_CAR_STATE_CODES.filter((c) => PILOT_CAR_CERTIFICATION[c]?.requirement !== 'unknown')
    .map((c) => {
      const f = PILOT_CAR_CERTIFICATION[c]!;
      const inbound = f.inboundPublished
        ? f.acceptsCertificationFrom.length > 0
          ? f.acceptsCertificationFrom.join(', ')
          : 'Published, and the list is empty — no other state\'s card is accepted'
        : 'Not published';
      return `<tr>
        <td><a class="pc-link" href="${esc(PILOT_CAR_PATH)}?states=${esc(c)}${f.requirement === 'required' || f.requirement === 'disputed' ? `&amp;certin=${esc(c)}` : ''}">${esc(stateName(c))}</a></td>
        <td>${esc(CERTIFICATION_LABEL[f.requirement])}</td>
        <td>${esc(inbound)}</td>
        <td>${f.termYears == null ? 'Not published' : `${f.termYears} years`}</td>
        <td>${
          f.sourceUrl
            ? `<a class="pc-link" href="${esc(f.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(f.sourceTitle ?? f.sourceUrl)}</a>${f.sourceRevisedOn ? ` (revised ${esc(f.sourceRevisedOn)})` : ' (undated)'}`
            : '—'
        }</td>
      </tr>`;
    })
    .join('');
  const unknowns = PILOT_CAR_STATE_CODES.filter(
    (c) => PILOT_CAR_CERTIFICATION[c]?.requirement === 'unknown',
  );
  return `<section class="pc-sec">
    <h2>Which states certify pilot-car operators</h2>
    <p class="pc-sub">Compiled from the same cited state sources the permit calculator reads, and shown here because it is the fact that decides whether the operator you are about to call can legally take the job. Where a state's own pages contradict each other, this says so rather than picking one.</p>
    <div class="pc-tablewrap">
      <table class="pc-table">
        <thead><tr><th>State</th><th>Certification</th><th>Accepts cards from</th><th>Term</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="pc-sub" style="margin-top:12px;">We hold no certification source for ${unknowns.length} states — ${esc(unknowns.join(', '))}. <strong>That is not "no certification required."</strong> Several of them are named by other states as issuers whose cards they accept, which strongly implies a programme we simply have not sourced. Check with the state before you dispatch.</p>
  </section>`;
}

export function renderIndexPage(
  f: OperatorFilters,
  result: { operators: PublicOperator[]; total: number; unavailable: boolean },
): string {
  const filtered = hasAnyFilter(f);
  const showing = result.unavailable
    ? DB_DOWN_HTML
    : result.operators.length === 0
      ? emptyState(f)
      : `<p class="pc-count">${result.total} listed operator${result.total === 1 ? '' : 's'}${filtered ? ' match these filters' : ''} · page ${f.page} of ${Math.max(1, Math.ceil(result.total / OPERATORS_PER_PAGE))}</p>
         <div class="pc-cards">${result.operators.map(operatorCard).join('')}</div>`;

  const pages = Math.max(1, Math.ceil(result.total / OPERATORS_PER_PAGE));
  const pager =
    !result.unavailable && pages > 1
      ? `<div class="pc-pills">
          ${f.page > 1 ? `<a class="pc-pill" href="${esc(PILOT_CAR_PATH)}${esc(filtersToQuery({ ...f, page: f.page - 1 }))}">← Previous</a>` : ''}
          ${f.page < pages ? `<a class="pc-pill" href="${esc(PILOT_CAR_PATH)}${esc(filtersToQuery({ ...f, page: f.page + 1 }))}">Next →</a>` : ''}
        </div>`
      : '';

  const body = `
  <section class="hero pc-hero">
    <div class="container-narrow">
      <p class="pc-eyebrow">Free directory &middot; no account needed</p>
      <h1>Pilot Car &amp; Escort Operator Directory</h1>
      <p class="lead">Filter escort operators by the things that decide whether they can legally take your load: the states they run, the certificate they hold in each one and when it expires, the equipment on the truck, the escort vehicle's own weight rating, and their insurance.</p>
      <div class="pc-truth">
        <h2>Every record here is self-reported unless it says otherwise, and it says otherwise on the card.</h2>
        <p><strong>Operators list themselves; we do not import anyone.</strong> A record marked <em>Self-reported</em> is the operator's own statement and nobody here has checked it — ask for the certificate and the insurance certificate before you dispatch. Where we have checked something, the card says what we checked, when, and links the register we checked it against.</p>
      </div>
      <div class="pc-truth">
        <h2>Whether a state requires certification is genuinely disputed, and we publish the disagreement.</h2>
        <p>Two pages of the same Virginia DMV give different reciprocity answers and neither carries a date. Colorado, Oklahoma and Washington publish who they ACCEPT and no list of who accepts them. New York accepts nobody. The table below records each state's published position and links the document — it does not average them into a single confident answer.</p>
      </div>
    </div>
  </section>

  <main class="pc-shell">
    <div class="pc-grid">
      ${filterForm(f)}
      <section class="pc-results" aria-live="polite">
        ${showing}
        ${pager}
      </section>
    </div>

    ${certificationReference()}

    <section class="pc-sec">
      <h2>How many escorts does the load actually need?</h2>
      <p class="pc-sub">The <a class="pc-link" href="${esc(OSOW_TOOL_PATH)}">oversize &amp; overweight permit calculator</a> answers that per state from each state's own escort rules, with the statute behind every line, and links straight back here pre-filtered to the states and certificates that lane needs. The <a class="pc-link" href="/tools/heavy-haul-quote">heavy-haul quote tool</a> does the same inside a delivered-cost estimate.</p>
    </section>

    <section class="pc-sec">
      <h2>Run pilot cars?</h2>
      <p class="pc-sub">Listing is free and takes a few minutes. You get a private link that edits or deletes your record — including deleting it outright, which removes the row rather than hiding it. You choose per field whether your phone number and email are public.</p>
      <p><a class="btn btn-primary" href="${esc(PILOT_CAR_JOIN_PATH)}">List your escort service</a></p>
    </section>
  </main>`;

  const title = 'Pilot Car & Escort Operator Directory — Filter by State & Certification | QuoteFleet';
  const description =
    'Free, opt-in directory of pilot car and escort vehicle operators, filterable by states covered, per-state certification and expiry, equipment, escort-vehicle GVWR and insurance. Self-reported records are labelled as such.';
  const jsonLd = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Pilot Car & Escort Operator Directory',
    url: `${SITE}${PILOT_CAR_PATH}`,
    description,
    isAccessibleForFree: true,
  })}</script>`;
  return page(title, description, PILOT_CAR_PATH, body, jsonLd);
}

// ── The profile ────────────────────────────────────────────────────────────

export function renderProfilePage(op: PublicOperator): string {
  // Contact rows are built from the PROJECTION, which has already nulled every
  // field the operator did not tick. There is no `publish_*` check here on
  // purpose: one gate, in `toPublicOperator`, so a template cannot forget it.
  const rows: string[] = [];
  if (op.phone) rows.push(`<dt>Phone</dt><dd><a class="pc-link" href="tel:${esc(op.phone)}">${esc(op.phone)}</a></dd>`);
  if (op.email) rows.push(`<dt>Email</dt><dd><a class="pc-link" href="mailto:${esc(op.email)}">${esc(op.email)}</a></dd>`);
  if (op.contactName) rows.push(`<dt>Contact</dt><dd>${esc(op.contactName)}</dd>`);
  if (op.website)
    rows.push(
      `<dt>Website</dt><dd><a class="pc-link" href="${esc(op.website)}" rel="nofollow noopener" target="_blank">${esc(op.website)}</a></dd>`,
    );

  const certRows = op.certifications
    .map((c) => {
      const state = certificationFor(c.state);
      return `<tr>
        <td>${esc(stateName(c.state))}</td>
        <td>${
          c.status === 'certified'
            ? c.expired
              ? `Held, LAPSED${c.expiresOn ? ` ${esc(c.expiresOn)}` : ''}`
              : `Held${c.expiresOn ? `, expires ${esc(c.expiresOn)}` : ', no expiry on file'}`
            : c.status === 'reciprocity'
              ? `Works on a ${esc(c.issuedByState ?? 'another state')} card — operator's claim`
              : c.status === 'not-required'
                ? 'State certifies nobody'
                : 'Not certified'
        }</td>
        <td>${esc(CERTIFICATION_LABEL[state?.requirement ?? 'unknown'])}</td>
        <td>${
          state?.sourceUrl
            ? `<a class="pc-link" href="${esc(state.sourceUrl)}" rel="nofollow noopener" target="_blank">${esc(state.sourceTitle ?? state.sourceUrl)}</a>`
            : 'We hold no source'
        }</td>
      </tr>`;
    })
    .join('');

  const equip = EQUIPMENT_KEYS.map(
    (k) =>
      `<span class="pc-pill${op.equipment[k] ? ' is-cert' : ''}">${esc(EQUIPMENT_LABEL[k])}${op.equipment[k] ? '' : ' — not stated'}</span>`,
  ).join('');

  const body = `
  <section class="hero pc-hero">
    <div class="container-narrow">
      <p class="pc-eyebrow">Pilot car &amp; escort operator</p>
      <h1>${esc(op.businessName)}</h1>
      <p class="lead">${esc(
        [op.homeBaseCity, op.homeBaseState].filter(Boolean).join(', ') || 'Home base not stated',
      )}${op.serviceRadiusMi != null ? ` · works within about ${esc(op.serviceRadiusMi)} miles` : ''}.</p>
      <div class="pc-truth">
        <h2>What we checked, and what we did not</h2>
        ${tierBlock(op)}
      </div>
    </div>
  </section>

  <main class="pc-shell">
    <section class="pc-detail">
      <h2>Contact</h2>
      ${
        rows.length > 0
          ? `<dl class="pc-dl">${rows.join('')}</dl>`
          : '<p class="pc-note">This operator has not published a contact method. That is their choice, per field, and we do not override it.</p>'
      }
    </section>

    <section class="pc-detail">
      <h2>States covered</h2>
      <div class="pc-pills">${op.statesCovered.map((s) => `<span class="pc-pill">${esc(stateName(s))}</span>`).join('')}</div>
    </section>

    <section class="pc-detail">
      <h2>Certification, state by state</h2>
      ${
        op.certifications.length > 0
          ? `<div class="pc-tablewrap"><table class="pc-table">
              <thead><tr><th>State</th><th>What the operator states</th><th>What the state requires</th><th>Source for the state's rule</th></tr></thead>
              <tbody>${certRows}</tbody></table></div>`
          : '<p class="pc-note">No per-state certification stated. In a state that requires one, that is a reason to ask before you book, not a reason to assume.</p>'
      }
      ${
        op.reciprocityClaimedStates.length > 0
          ? `<p class="pc-note" style="margin-top:12px;">The operator also believes their certificate is accepted in ${esc(op.reciprocityClaimedStates.map(stateName).join(', '))}. <strong>That is their reading of a reciprocity table, not ours and not the state's</strong> — several states publish who they accept and no list of who accepts them, so confirm with the working state.</p>`
          : ''
      }
    </section>

    <section class="pc-detail">
      <h2>Equipment and escort vehicle</h2>
      <div class="pc-pills">${equip}</div>
      <dl class="pc-dl" style="margin-top:12px;">
        <dt>Height pole</dt><dd>${op.equipment.heightPole ? (op.heightPoleMaxIn != null ? `Yes — measured to ${esc(Math.floor(op.heightPoleMaxIn / 12))} ft ${esc(op.heightPoleMaxIn % 12)} in` : 'Yes — height not stated') : 'Not stated'}</dd>
        <dt>Escort vehicle</dt><dd>${op.vehicleClass ? esc(VEHICLE_CLASS_LABEL[op.vehicleClass]) : 'Not stated'}${op.vehicleGvwrLbs != null ? ` · ${esc(op.vehicleGvwrLbs.toLocaleString('en-US'))} lb GVWR` : ' · GVWR not stated'}</dd>
        <dt>Superloads</dt><dd>${op.takesSuperloads ? 'Takes superload work' : 'Does not state superload work'}</dd>
        <dt>Night moves</dt><dd>${op.takesNightMoves ? 'Runs night moves' : 'Does not state night moves'}</dd>
        <dt>Languages</dt><dd>${op.languages.length > 0 ? esc(op.languages.join(', ')) : 'Not stated'}</dd>
      </dl>
    </section>

    <section class="pc-detail">
      <h2>Insurance</h2>
      <p class="pc-note">${
        op.insuranceLiabilityUsd == null
          ? 'No liability limit stated. Ask for the certificate of insurance before you dispatch.'
          : `${esc(`$${op.insuranceLiabilityUsd.toLocaleString('en-US')}`)} of liability cover${op.insuranceExpiresOn ? `, stated to expire ${esc(op.insuranceExpiresOn)}${op.insuranceExpired ? ' — WHICH HAS PASSED' : ''}` : ', no expiry date on file'}. This is the operator's own figure; we have not seen the certificate unless the verification line above says we have.`
      }</p>
    </section>

    <section class="pc-sec">
      <h2>Other operators</h2>
      <p class="pc-sub"><a class="pc-link" href="${esc(PILOT_CAR_PATH)}?states=${esc(op.statesCovered[0] ?? '')}">Everyone listed in ${esc(stateName(op.statesCovered[0] ?? ''))}</a> &middot; <a class="pc-link" href="${esc(PILOT_CAR_PATH)}">The whole directory</a> &middot; <a class="pc-link" href="${esc(OSOW_TOOL_PATH)}">How many escorts your load needs</a></p>
    </section>

    <section class="pc-sec">
      <h2>Is this your listing?</h2>
      <p class="pc-sub">You were emailed a private manage link when you submitted it. It edits or deletes this record. Lost it? Write to <a class="pc-link" href="mailto:hello@quotefleet.net">hello@quotefleet.net</a> from the address on the listing and we will send it again — we will not send it anywhere else.</p>
    </section>
  </main>`;

  const title = `${op.businessName} — Pilot Car & Escort Operator | QuoteFleet`;
  const description = `${op.businessName}: states covered, per-state certification and expiry, equipment, escort-vehicle GVWR and insurance. ${VERIFICATION_LABEL[op.verificationTier].label}.`;
  return page(title, description, `${PILOT_CAR_PATH}/${op.slug}`, body);
}

// ── The submission form ────────────────────────────────────────────────────

function stateCheckboxes(name: string): string {
  return `<div class="pc-statebox">${PILOT_CAR_STATE_CODES.map(
    (c) =>
      `<label class="pc-check"><input type="checkbox" data-group="${esc(name)}" value="${esc(c)}"><span>${esc(c)}</span></label>`,
  ).join('')}</div>`;
}

export function renderJoinPage(): string {
  const certStates = statesRequiringCertification();
  const classOptions = VEHICLE_CLASSES.map(
    (c) => `<option value="${esc(c)}">${esc(VEHICLE_CLASS_LABEL[c])}</option>`,
  ).join('');

  const body = `
  <section class="hero pc-hero">
    <div class="container-narrow">
      <p class="pc-eyebrow">List your escort service &middot; free</p>
      <h1>Add your pilot car service to the directory</h1>
      <p class="lead">Dispatchers arrive here from a permit quote that already told them how many certified escorts their load needs in each state. Filling these fields in is what puts you in front of that search instead of underneath it.</p>
      <div class="pc-truth">
        <h2>What we do with this, in plain words</h2>
        <p><strong>Nothing is published until you tick the consent box below, and you choose per field whether your phone number and your email are public.</strong> Your name, email and phone are personal data: we hold them so buyers can reach you and so you can edit or delete the record. You will get a private manage link on the next screen — save it. It edits your listing, and it deletes it outright, which removes the row rather than hiding it. We never sell this and we never publish a field you did not tick.</p>
      </div>
      <div class="pc-truth">
        <h2>We publish your claims as YOUR claims</h2>
        <p>Everything you enter starts as <em>Self-reported</em> and the listing says so on its face. We do not tick a badge because you typed a number in a box — that is the thing wrong with the directories you are already in. If you send a certificate or an insurance certificate we will look at it and say we looked, with the date; where the issuing state publishes a register we can check, we check it and link it.</p>
      </div>
    </div>
  </section>

  <main class="pc-shell">
    <form class="pc-form" id="pc-join" novalidate>
      <div class="pc-card--form">
        <h2>Your business</h2>
        <p class="pc-help">The name a dispatcher will book you under.</p>
        <label class="pc-field"><input id="pc-name" type="text" maxlength="120" placeholder=" " autocomplete="organization"><span class="pc-lab">Business name</span></label>
        <div class="pc-row2">
          <label class="pc-field"><input id="pc-contact" type="text" maxlength="120" placeholder=" " autocomplete="name"><span class="pc-lab">Your name (optional)</span></label>
          <label class="pc-field"><input id="pc-website" type="url" maxlength="300" placeholder=" " autocomplete="url"><span class="pc-lab">Website (optional)</span></label>
        </div>
        <div class="pc-row2">
          <label class="pc-field"><input id="pc-email" type="email" maxlength="200" placeholder=" " autocomplete="email"><span class="pc-lab">Email</span></label>
          <label class="pc-field"><input id="pc-phone" type="tel" maxlength="40" placeholder=" " autocomplete="tel"><span class="pc-lab">Phone (optional)</span></label>
        </div>
        <div class="pc-row2">
          <label class="pc-field"><input id="pc-city" type="text" maxlength="80" placeholder=" " autocomplete="address-level2"><span class="pc-lab">Home base city</span></label>
          <label class="pc-field"><select id="pc-homestate"><option value="">—</option>${stateOptions([])}</select><span class="pc-lab">Home base state</span></label>
        </div>
        <label class="pc-field"><input id="pc-radius" type="number" min="0" max="3000" step="1" placeholder=" "><span class="pc-lab">Service radius (miles)</span></label>
      </div>

      <div class="pc-card--form">
        <h2>What you publish</h2>
        <p class="pc-help">Tick what may appear on your public listing. Everything you leave unticked is held privately and is used only to reach you about your own record. Publish at least one of phone or email, or nobody can book you.</p>
        <div class="pc-checks">
          <label class="pc-check"><input type="checkbox" id="pc-pub-phone"><span>Publish my phone number</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-pub-email"><span>Publish my email address</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-pub-contact"><span>Publish my name alongside the business name</span></label>
        </div>
      </div>

      <div class="pc-card--form">
        <h2>States you actually run in</h2>
        <p class="pc-help">Only the states you will physically take a job in. This is the filter dispatchers use first, and an over-claimed list gets you calls you have to turn down.</p>
        ${stateCheckboxes('states')}
      </div>

      <div class="pc-card--form">
        <h2>Certification, state by state</h2>
        <p class="pc-help">Tick each state where you hold a CURRENT certificate, then give its expiry. ${certStates.length} of the states we hold sources for require certification or have contradictory published sources about it: ${esc(certStates.join(', '))}. A certificate with no expiry on file is published as "no expiry on file" — we will not assume it is current.</p>
        ${stateCheckboxes('certified')}
        <label class="pc-field"><input id="pc-cert-expiry" type="date" placeholder=" "><span class="pc-lab">Certificate expiry (applies to the states ticked above)</span></label>
        <p class="pc-note">Different expiry dates per state? Submit with the earliest, then use your manage link to set each one — the record holds one row per state.</p>
      </div>

      <div class="pc-card--form">
        <h2>States you believe accept your card</h2>
        <p class="pc-help">Reciprocity, as you understand it. We store and show this as your claim and it never satisfies a "certified in" filter — Colorado, Oklahoma and Washington all publish who they accept and no list of who accepts them, so nobody can assert this on the state's behalf.</p>
        ${stateCheckboxes('reciprocity')}
      </div>

      <div class="pc-card--form">
        <h2>Equipment on the truck</h2>
        <p class="pc-help">Several states specify the equipment rather than merely require it — Kentucky sets the sign at 6 to 8 ft with 18-inch letters, Colorado and Georgia specify the pole.</p>
        <div class="pc-checks">
          <label class="pc-check"><input type="checkbox" id="pc-eq-pole"><span>Height pole</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-eq-signs"><span>OVERSIZE LOAD signs</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-eq-flags"><span>Flags</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-eq-amber"><span>Amber light bar / strobe</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-eq-radio"><span>Two-way radio / CB</span></label>
        </div>
        <label class="pc-field"><input id="pc-pole-in" type="number" min="0" max="400" step="1" placeholder=" "><span class="pc-lab">Height pole set to (inches)</span></label>
      </div>

      <div class="pc-card--form">
        <h2>The escort vehicle</h2>
        <p class="pc-help">This is a real filter, not a formality: Tennessee's cited rule refuses an escort vehicle rated at 18,000 lb GVWR or more whatever certificate the driver holds, and several Canadian provinces cap the escort vehicle by mass. An operator can be certified and still illegal.</p>
        <div class="pc-row2">
          <label class="pc-field"><select id="pc-vclass"><option value="">—</option>${classOptions}</select><span class="pc-lab">Vehicle type</span></label>
          <label class="pc-field"><input id="pc-gvwr" type="number" min="500" max="80000" step="1" placeholder=" "><span class="pc-lab">GVWR (lb)</span></label>
        </div>
        <div class="pc-checks">
          <label class="pc-check"><input type="checkbox" id="pc-superload"><span>I take superload work</span></label>
          <label class="pc-check"><input type="checkbox" id="pc-night"><span>I run night moves</span></label>
        </div>
      </div>

      <div class="pc-card--form">
        <h2>Insurance</h2>
        <p class="pc-help">Colorado requires $1,000,000 of commercial liability of its certified operators and Washington requires 100/300/50 of for-hire operators. Buyers filter on this.</p>
        <div class="pc-row2">
          <label class="pc-field"><input id="pc-ins-usd" type="number" min="0" max="100000000" step="1" placeholder=" "><span class="pc-lab">Liability cover ($)</span></label>
          <label class="pc-field"><input id="pc-ins-exp" type="date" placeholder=" "><span class="pc-lab">Policy expires</span></label>
        </div>
      </div>

      <div class="pc-card--form">
        <h2>Consent</h2>
        <p class="pc-help">Required. Without it there is no record — the submission is refused rather than stored unpublished.</p>
        <div class="pc-checks">
          <label class="pc-check"><input type="checkbox" id="pc-consent"><span>I run this business and I am asking QuoteFleet to publish this listing. I understand the fields I ticked above will be public and the rest will not, and that I can edit or delete the record at any time with the manage link.</span></label>
        </div>
        <button type="submit" class="btn btn-primary" id="pc-submit">Submit my listing</button>
        <p class="pc-note">We review new listings before they appear. That review is a sanity check on the record, not a verification of your certificates — the listing still says <em>Self-reported</em> until we have actually checked something.</p>
      </div>

      <div class="pc-say" id="pc-say" hidden></div>
    </form>
  </main>`;

  const title = 'List Your Pilot Car / Escort Service — Free | QuoteFleet';
  const description =
    'Add your pilot car or escort vehicle service to QuoteFleet\'s opt-in directory. Structured per-state certification, equipment and insurance fields. You choose what is public and you can delete the record at any time.';
  return page(title, description, PILOT_CAR_JOIN_PATH, body);
}

// ── The manage page ────────────────────────────────────────────────────────

export function renderManagePage(
  token: string,
  found: { operator: PublicOperator | null; unavailable: boolean; status: string | null },
): string {
  const inner = found.unavailable
    ? DB_DOWN_HTML
    : found.operator === null
      ? `<div class="pc-empty">
           <h2>That manage link does not match a listing</h2>
           <p>The link may have been used to delete the record — deletion here is permanent and the link stops working. If you believe the listing still exists, write to <a class="pc-link" href="mailto:hello@quotefleet.net">hello@quotefleet.net</a> from the address on it.</p>
         </div>`
      : `<section class="pc-detail">
           <h2>${esc(found.operator.businessName)}</h2>
           <p class="pc-note">Status: <strong>${esc(found.status ?? 'unknown')}</strong>. ${
             found.status === 'pending'
               ? 'Waiting on review. It is not public yet.'
               : found.status === 'published'
                 ? 'Live in the directory.'
                 : found.status === 'withdrawn'
                   ? 'Withdrawn at your request. The record is still here and you can delete it below.'
                   : 'Not published.'
           }</p>
           <dl class="pc-dl" style="margin-top:12px;">
             <dt>Email on file</dt><dd>${esc(found.operator.email ?? '—')}</dd>
             <dt>Phone on file</dt><dd>${esc(found.operator.phone ?? '—')}</dd>
             <dt>States covered</dt><dd>${esc(found.operator.statesCovered.join(', ') || '—')}</dd>
             <dt>Certified in</dt><dd>${esc(found.operator.certifiedStates.join(', ') || 'None stated')}</dd>
             <dt>Verification</dt><dd>${esc(VERIFICATION_LABEL[found.operator.verificationTier].label)}</dd>
           </dl>
         </section>

         <section class="pc-detail">
           <h2>Withdraw or delete</h2>
           <p class="pc-note"><strong>Withdraw</strong> takes the listing off the directory and keeps the record, so you can put it back. <strong>Delete</strong> removes the row — your name, email, phone and every field — and cannot be undone. This link stops working immediately after a delete. We keep no archive copy.</p>
           <div class="pc-actions" style="margin-top:12px;">
             <button type="button" class="btn btn-secondary" id="pc-withdraw" data-token="${esc(token)}">Withdraw my listing</button>
             <button type="button" class="btn btn-secondary" id="pc-delete" data-token="${esc(token)}">Delete my record permanently</button>
           </div>
           <div class="pc-say" id="pc-say" hidden></div>
         </section>

         <section class="pc-sec">
           <h2>Change the details</h2>
           <p class="pc-sub">Editing re-submits the record for review and resets it to <em>Self-reported</em> — the document we checked described the listing as it was, so a verified tier cannot survive a rewrite of the fields it verified. <a class="pc-link" href="${esc(PILOT_CAR_JOIN_PATH)}?edit=${esc(token)}">Open the form with your current details</a>.</p>
         </section>`;

  const body = `
  <section class="hero pc-hero">
    <div class="container-narrow">
      <p class="pc-eyebrow">Your listing &middot; private link</p>
      <h1>Manage your directory record</h1>
      <p class="lead">This page is reachable only from the link you were given. Do not share it — anyone holding it can edit or delete the listing.</p>
    </div>
  </section>
  <main class="pc-shell">${inner}</main>`;

  return page(
    'Manage your pilot car listing | QuoteFleet',
    'Edit, withdraw or permanently delete your pilot car directory listing.',
    PILOT_CAR_PATH,
    body,
    '<meta name="robots" content="noindex, nofollow">',
  );
}

// ── Routes ─────────────────────────────────────────────────────────────────

const ModerationSchema = z.object({
  status: z.enum(['published', 'rejected', 'pending']),
  tier: z.enum(['self-asserted', 'document-on-file', 'registry-verified']).optional(),
  note: z.string().trim().max(1_000).nullish(),
  sourceUrl: z.string().trim().url().max(500).nullish(),
});

export function registerPilotCarRoutes(app: Express) {
  /**
   * The index. CDN-cacheable per URL — the HTML is byte-identical for every
   * visitor at a given filter set, with no per-user branch — so it takes
   * `setPublicDirectoryCache` like the other free public surfaces.
   */
  app.get([PILOT_CAR_PATH, `${PILOT_CAR_PATH}/`], async (req: Request, res: Response, next) => {
    try {
      const filters = parseFilters(req.query as Record<string, unknown>);
      const asOf = todayIso();
      const result = await listOperators(filters, asOf);
      // A page rendered from an unreachable database must not be cached as if
      // it were the answer — the next visitor would get the outage.
      if (!result.unavailable) setPublicDirectoryCache(req, res);
      else res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(renderIndexPage(filters, result));
    } catch (err) {
      next(err);
    }
  });

  app.get(PILOT_CAR_JOIN_PATH, (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderJoinPage());
    } catch (err) {
      next(err);
    }
  });

  app.get(`${PILOT_CAR_PATH}/manage/:token`, async (req: Request, res: Response, next) => {
    try {
      const token = String(req.params.token ?? '');
      const found = await getOperatorByToken(token, todayIso());
      // NEVER cached and never indexed: it is a bearer link to one operator's
      // own personal data.
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(renderManagePage(token, found));
    } catch (err) {
      next(err);
    }
  });

  app.get(`${PILOT_CAR_PATH}/:slug`, async (req: Request, res: Response, next) => {
    try {
      const slug = String(req.params.slug ?? '');
      const asOf = todayIso();
      const found = await getOperatorBySlug(slug, asOf);
      if (found.unavailable) {
        // 503, not 404. "We cannot reach the directory" is not "this operator
        // does not exist", and a 404 would tell a crawler to drop the profile.
        res.status(503).setHeader('Cache-Control', 'no-store');
        return res.type('html').send(
          renderManagePage('', { operator: null, unavailable: true, status: null }),
        );
      }
      if (found.operator === null) return next();
      setPublicDirectoryCache(req, res);
      return res.type('html').send(renderProfilePage(found.operator));
    } catch (err) {
      return next(err);
    }
  });

  // ── API ──────────────────────────────────────────────────────────────────

  /** JSON mirror of the filtered list, so a TMS can read the same answer. */
  app.get('/api/pilot-cars', async (req: Request, res: Response, next) => {
    try {
      const filters = parseFilters(req.query as Record<string, unknown>);
      const asOf = todayIso();
      const result = await listOperators(filters, asOf);
      if (result.unavailable) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(503).json({
          error: 'The operator directory is unreachable right now. This is not an empty result.',
          storeUnavailable: true,
          filters,
        });
      }
      setPublicDirectoryCache(req, res);
      return res.json({
        asOf,
        filters,
        total: result.total,
        perPage: OPERATORS_PER_PAGE,
        disclaimer:
          'Every field is self-reported by the operator unless that record\'s verification tier says otherwise. QuoteFleet does not certify operators and is not the issuer of any certificate shown.',
        operators: result.operators,
      });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * Submit a listing. `publicLeadLimiter` — the same limiter the other
   * public write endpoints use, because this is the same shape of abuse
   * surface: an unauthenticated POST that creates a row holding an email.
   */
  app.post('/api/pilot-cars', publicLeadLimiter, async (req: Request, res: Response) => {
    const parsed = SubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({
        error: first ? first.message : 'Some of those details did not go through.',
        details: parsed.error.flatten(),
      });
    }
    const result = await createOperator(parsed.data, todayIso());
    if (result.unavailable) {
      return res.status(503).json({
        error:
          'We could not reach the directory database, so your listing was NOT saved. Nothing was stored — please try again in a minute.',
        storeUnavailable: true,
      });
    }
    if (!result.ok) return res.status(409).json({ error: result.error ?? 'That listing could not be created.' });
    return res.status(201).json({
      ok: true,
      slug: result.slug,
      // Shown ONCE. We store only its SHA-256, so we cannot resend this value —
      // which is exactly why the page tells the operator to save it now.
      manageToken: result.manageToken,
      manageUrl: `${SITE}${PILOT_CAR_PATH}/manage/${result.manageToken}`,
      status: 'pending',
      verificationTier: 'self-asserted',
      note: 'Your listing is queued for review. Save the manage link — it is the only way back to this record and we cannot send it again.',
    });
  });

  app.post('/api/pilot-cars/manage/:token', publicLeadLimiter, async (req: Request, res: Response) => {
    const parsed = SubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ error: first ? first.message : 'Invalid input' });
    }
    const result = await updateOperatorByToken(String(req.params.token ?? ''), parsed.data, todayIso());
    if (result.unavailable) {
      return res
        .status(503)
        .json({ error: 'We could not reach the database, so nothing was changed.', storeUnavailable: true });
    }
    if (!result.ok) return res.status(404).json({ error: result.error ?? 'That manage link does not match a listing.' });
    return res.json({ ok: true, status: 'pending', verificationTier: 'self-asserted' });
  });

  /** Withdraw — reversible, keeps the record. */
  app.post('/api/pilot-cars/manage/:token/withdraw', publicCalcLimiter, async (req: Request, res: Response) => {
    const result = await setListingStatusByToken(String(req.params.token ?? ''), 'withdrawn');
    if (result.unavailable) {
      return res.status(503).json({ error: 'We could not reach the database, so nothing was changed.' });
    }
    return res.json({ ok: true, status: 'withdrawn' });
  });

  /**
   * THE DELETION PATH — a hard delete of the row, reachable by the data
   * subject themselves without asking us for anything.
   */
  app.post('/api/pilot-cars/manage/:token/delete', publicCalcLimiter, async (req: Request, res: Response) => {
    const result = await deleteOperatorByToken(String(req.params.token ?? ''));
    if (result.unavailable) {
      return res.status(503).json({
        error: 'We could not reach the database, so nothing was deleted. Your record is unchanged — try again shortly.',
      });
    }
    return res.json({
      ok: true,
      deleted: true,
      note: 'The record is gone, including your name, email and phone number. There is no archive copy and this link no longer works.',
    });
  });

  // ── Moderation ───────────────────────────────────────────────────────────

  app.get('/api/admin/pilot-cars', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const status = String(req.query.status ?? 'pending');
    const found = await listForModeration(
      ['pending', 'published', 'rejected', 'withdrawn'].includes(status) ? status : 'pending',
      todayIso(),
    );
    if (found.unavailable) return res.status(503).json({ error: 'Directory database unreachable.' });
    return res.json({ status, rows: found.rows });
  });

  app.post('/api/admin/pilot-cars/:slug', requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = ModerationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const result = await moderateOperator(String(req.params.slug ?? ''), {
      status: parsed.data.status,
      ...(parsed.data.tier ? { tier: parsed.data.tier } : {}),
      note: parsed.data.note ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
    });
    if (result.unavailable) return res.status(503).json({ error: 'Directory database unreachable.' });
    if (!result.ok) return res.status(400).json({ error: result.error ?? 'That decision could not be recorded.' });
    return res.json({ ok: true });
  });
}
