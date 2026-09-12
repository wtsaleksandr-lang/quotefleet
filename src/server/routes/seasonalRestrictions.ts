/**
 * THE PUBLIC SEASONAL-RESTRICTION REFERENCE — one page per state, and an index.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 * A dispatcher planning a March move through the northern tier has one
 * question — "is this road posted right now?" — and the honest answer has
 * three parts: what the state's own publication says, when we last read it,
 * and a link to the state so they can check us. This page gives all three and
 * refuses to give a fourth: it never tells anyone a road is clear on our
 * authority.
 *
 * ── WHY IT ALSO PUBLISHES THE STATES THAT DO *NOT* RESTRICT ───────────────
 * Because the aggregator sites get that wrong, and the wrong answer is
 * expensive in both directions. Ohio, Indiana, Illinois, Missouri and New York
 * are routinely listed as "frost law states". Their STATE SYSTEMS are not
 * seasonally restricted at all — the restriction a truck meets is posted by a
 * county engineer or a township, road by road. Telling a dispatcher to watch
 * an ODOT bulletin that does not exist sends them looking in the wrong place;
 * telling them Ohio has no frost laws sends them onto a posted county road.
 * The page says exactly which it is, per state, with the link.
 *
 * ── AND WHY EVERY ROW SHOWS THE PLUMBING ──────────────────────────────────
 * Format, machine-readability and polling cadence are ON THE PAGE. That is not
 * developer trivia leaking into a customer surface: it is the reader's basis
 * for deciding how much weight to put on our copy. "GeoJSON, machine-readable,
 * polled every 3 hours in season" and "map viewer, not machine-readable, we
 * watch the page for change" deserve different amounts of trust, and hiding
 * the difference behind one uniform green tick would be the dishonest choice.
 *
 * NO PER-USER STATE. The HTML is byte-identical for every visitor, so it takes
 * `setPublicDirectoryCache` like the other free tools. The DATABASE IS
 * OPTIONAL: with the store unreachable the page still renders in full from the
 * compiled registry, and every state simply reads "we hold no current data"
 * with its authoritative link — which is the honest output and the one a
 * dispatcher can still act on.
 */
import type { Express, Request, Response } from 'express';
import { todayIso } from '../../calc/osow/provenance.js';
import { cadenceFor } from '../../calc/osow/seasonal/schedule.js';
import { SEASONAL_SOURCES, seasonalSourceFor } from '../../calc/osow/seasonal/sources.js';
import type { SeasonalSourceSpec } from '../../calc/osow/seasonal/sources.js';
import { activeRestrictions } from '../../calc/osow/seasonal/advisory.js';
import type { StateSeasonalSnapshot } from '../../calc/osow/seasonal/types.js';
import {
  IN_SEASON_INTERVAL_MS,
  OFF_SEASON_INTERVAL_MS,
  SHOULDER_DAYS,
  SHOULDER_INTERVAL_MS,
} from '../../calc/osow/seasonal/schedule.js';
import { loadSeasonalContext } from '../seasonal/store.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import {
  esc,
  hubPage,
  jsonLdBreadcrumb,
  jsonLdCollection,
  jsonLdFaq,
  jsonLdWebApplication,
} from '../osow/hubShell.js';
import { factList, toolPage } from '../tools/toolPage.js';
import { OSOW_HUB_PATH } from '../osow/hubData.js';
import { OSOW_TOOL_PATH } from './osowPermits.js';

const SITE = 'https://quotefleet.net';
export const SEASONAL_TOOL_PATH = '/tools/seasonal-weight-restrictions';
const AXLE_TOOL = '/tools/axle-weights';
const BRIDGE_TOOL = '/tools/bridge-formula';
/** Where the header band's "embed this tool" affordance points today. */
const EMBED_SURFACE = '/pricing';

/** Hours, from the scheduler's own millisecond constants — never retyped. */
const HOURS = (ms: number) => Math.round(ms / (60 * 60 * 1000));
const DAYS = (ms: number) => Math.round(ms / (24 * 60 * 60 * 1000));

/** `/tools/seasonal-weight-restrictions/north-dakota` */
export function seasonalStatePath(spec: SeasonalSourceSpec): string {
  return `${SEASONAL_TOOL_PATH}/${spec.name.toLowerCase().replace(/\s+/g, '-')}`;
}

export function specBySlug(slug: string): SeasonalSourceSpec | null {
  const want = String(slug ?? '').trim().toLowerCase();
  return (
    SEASONAL_SOURCES.find((s) => s.name.toLowerCase().replace(/\s+/g, '-') === want) ??
    seasonalSourceFor(want)
  );
}

const READABILITY_LABEL: Record<string, string> = {
  full: 'Machine-readable',
  partial: 'Partly machine-readable',
  none: 'Not machine-readable',
};

const FORMAT_LABEL: Record<string, string> = {
  geojson: 'GeoJSON feed',
  'json-api': 'JSON API',
  'html-bulletin': 'HTML bulletin',
  'html-table': 'HTML table',
  'pdf-bulletin': 'PDF bulletin',
  'map-viewer': 'Map viewer',
  'email-list': 'Email list',
  'phone-recording': 'Phone recording',
  none: 'No seasonal publication',
};

// ── CSS ────────────────────────────────────────────────────────────────────
//
// Lives here rather than in public/*.css for the same reason OSOW_CSS does —
// the page is server-rendered from one file and its styles travel with it.
// Every colour is a token from style.css, so light and dark both work with no
// `data-theme` block of our own and no raw hex anywhere.

const SEASONAL_CSS = `
  /* Honesty banner. Solid, never glass — body text sits on it. */
  .sr-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 0 0 24px; }
  .sr-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .sr-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .sr-truth strong { color: var(--ink); }

  /* A group of states INSIDE the tool card. h3, because the block's own h2 is
     the template's and there is exactly one h2 per block on this page. */
  .sr-grp + .sr-grp { margin-top: 32px; }
  .sr-grp h3 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .sr-grp p.sr-sub { margin: 0 0 16px; color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 720px; }

  /* THE COLUMN COUNT IS STATED, NEVER auto-fill. auto-fill sizes tracks from a
     min width, so the same card count lands 3-up at one width and 2-up at
     another with no rule saying when — and at a hair over 2 x 320px it drops a
     card onto a row by itself. 3 / 2 / 1, declared. */
  .sr-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .sr-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .sr-card h3 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .sr-card h3 a { color: inherit; text-decoration: none; }
  .sr-card h3 a:hover, .sr-card h3 a:focus-visible { text-decoration: underline; }
  .sr-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .sr-card .sr-meta { color: var(--muted); font-size: 12px; font-family: var(--font-mono); }

  /* Status + capability pills. OUTLINE, never a bright fill. Groups are laid
     out so a run of pills never leaves one alone on its own line.

     'white-space: nowrap' USED TO BE HERE and it put the document into
     horizontal scroll at 320px: "GeoJSON feed · Machine-readable" measured
     294.8px inside a card ~288px wide, so the pill pushed the page 25px past
     the viewport. A pill is a label, not a token that must stay on one line —
     it wraps, and the page never does. */
  .sr-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .sr-pill { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; line-height: 1.2; padding: 4px 10px; white-space: normal; overflow-wrap: anywhere; }
  .sr-pill.is-live { border-color: var(--warn); color: var(--warn); }
  /* THE GREEN IS A BORDER, NOT THE LABEL. '--success' is #059669 in light
     theme, which measured 3.77:1 against the card — fine for a 1px boundary
     (the 3:1 UI floor) and under the 4.5:1 floor for the 12px text it was
     painting. The status still reads green; the words are now legible. */
  .sr-pill.is-clear { border-color: var(--success); color: var(--ink-soft); }
  .sr-pill.is-unknown { border-color: var(--border-strong); color: var(--muted); }
  .sr-pill.is-machine { border-color: var(--accent); color: var(--accent); }

  .sr-link { color: var(--accent); font-size: 13px; word-break: break-word; }

  /* The per-state page. */
  .sr-detail { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .sr-detail + .sr-detail { margin-top: 16px; }
  .sr-detail h2 { font-size: 16px; margin: 0 0 8px; color: var(--ink); text-align: left; }
  .sr-dl { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 8px 16px; margin: 0; font-size: 14px; }
  .sr-dl dt { color: var(--muted); }
  .sr-dl dd { margin: 0; color: var(--ink-soft); }

  .sr-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .sr-rows li { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--surface-3); }
  .sr-rows .sr-area { color: var(--ink); font-size: 14px; margin: 0 0 2px; }
  .sr-rows .sr-limit { color: var(--ink-soft); font-size: 13px; margin: 0 0 2px; }
  .sr-rows .sr-when { color: var(--muted); font-size: 12px; font-family: var(--font-mono); margin: 0; }

  .sr-empty { color: var(--muted); font-size: 14px; margin: 0; }

  /* THE ONE ANIMATION GUARD FOR THE PER-STATE PAGE.
     The index is a '.qtt' page and the tool template's own reduce block already
     covers it. The per-state page sits on the bare shell, so it carries this —
     the shell's chevron transition is otherwise unguarded here. 'body.sr-page'
     comes from hubShell's additive 'bodyClass' option. */
  @media (prefers-reduced-motion: reduce) {
    .sr-page *, .sr-page *::before, .sr-page *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  /* A REAL focus ring on the per-state page too, for the same reason the tool
     template ships one: the shell's default is the browser's 1px auto outline,
     which on this ground is all but invisible. 2px accent at 2px offset, and
     ':focus-visible' so a mouse click does not paint it. */
  .sr-page main a:focus-visible,
  .sr-page main summary:focus-visible,
  .sr-page main button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-btn);
  }

  @media (max-width: 980px) {
    .sr-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    .sr-cards { grid-template-columns: minmax(0, 1fr); }
    .sr-dl { grid-template-columns: minmax(0, 1fr); gap: 2px; }
    .sr-dl dd { margin: 0 0 8px; }
  }
`;

function statusPill(spec: SeasonalSourceSpec, snap: StateSeasonalSnapshot | undefined, asOf: string): string {
  if (spec.programme !== 'statewide') {
    return `<span class="sr-pill">${spec.programme === 'local-only' ? 'Local roads only' : 'No seasonal programme'}</span>`;
  }
  if (!snap || snap.retrievedOn === null) {
    return '<span class="sr-pill is-unknown">Status unknown — check the state</span>';
  }
  const active = activeRestrictions(snap, asOf);
  if (active.length > 0) {
    return `<span class="sr-pill is-live">${active.length} restriction${active.length === 1 ? '' : 's'} in force</span>`;
  }
  if (snap.verifiedClear && snap.fetchStatus === 'ok') {
    return '<span class="sr-pill is-clear">No restriction in force</span>';
  }
  return '<span class="sr-pill is-unknown">Status unknown — check the state</span>';
}

/**
 * Format+readability travel in ONE pill and the cadence in a second, so a card
 * never carries three pills that wrap 2 + 1. A group that leaves a single pill
 * alone on its own line is the recurring layout defect this codebase keeps
 * fixing; two pills either sit together or stack evenly, and neither reads as
 * broken. The two facts also belong together — "GeoJSON feed" and
 * "machine-readable" are one statement about the source, not two.
 */
function capabilityPills(spec: SeasonalSourceSpec, now: Date): string {
  const cadence = cadenceFor(spec, now);
  const source = `${FORMAT_LABEL[spec.format] ?? spec.format} · ${READABILITY_LABEL[spec.machineReadable] ?? spec.machineReadable}`;
  const pills: string[] = [
    `<span class="sr-pill${spec.machineReadable === 'full' ? ' is-machine' : ''}">${esc(source)}</span>`,
  ];
  if (spec.ingestion !== 'none') {
    pills.push(
      `<span class="sr-pill">${cadence.tier === 'in-season' ? 'Polled every 3h (in season)' : cadence.tier === 'shoulder' ? 'Polled every 12h (shoulder)' : 'Polled weekly (off season)'}</span>`,
    );
  }
  return `<div class="sr-pills">${pills.join('')}</div>`;
}

function freshnessLine(snap: StateSeasonalSnapshot | undefined): string {
  if (!snap || snap.retrievedOn === null) {
    return 'We hold no current reading of this source.';
  }
  const age = snap.ageDays === 0 ? 'today' : `${snap.ageDays} day(s) ago`;
  const bulletin = snap.bulletinDate
    ? ` The document itself is dated ${esc(snap.bulletinDate)}.`
    : ' The document states no date of its own.';
  const err = snap.lastError ? ` Last attempt failed: ${esc(snap.lastError)}` : '';
  return `Read ${esc(age)} (${esc(snap.retrievedOn)}).${bulletin}${err}`;
}

// ── The index page ─────────────────────────────────────────────────────────

function renderIndex(snapshots: ReadonlyMap<string, StateSeasonalSnapshot>, asOf: string, now: Date): string {
  const statewide = SEASONAL_SOURCES.filter((s) => s.programme === 'statewide');
  const other = SEASONAL_SOURCES.filter((s) => s.programme !== 'statewide');

  const card = (spec: SeasonalSourceSpec): string => {
    const snap = snapshots.get(spec.code);
    return `<article class="sr-card">
      <h3><a href="${esc(seasonalStatePath(spec))}">${esc(spec.name)}</a></h3>
      <div class="sr-pills">${statusPill(spec, snap, asOf)}</div>
      ${capabilityPills(spec, now)}
      <p>${esc(spec.note)}</p>
      <p class="sr-meta">${freshnessLine(snap)}</p>
      <p><a class="sr-link" href="${esc(spec.authorityUrl)}" rel="nofollow noopener" target="_blank">${esc(spec.authorityTitle)}</a></p>
    </article>`;
  };

  // The three honest classes of state, counted from the registry rather than
  // written down — sources.ts is the only place that decides what a state is.
  const localOnly = SEASONAL_SOURCES.filter((s) => s.programme === 'local-only');
  const noProgramme = SEASONAL_SOURCES.filter((s) => s.programme === 'none');
  const parsed = SEASONAL_SOURCES.filter((s) => s.ingestion === 'parse');
  const watched = SEASONAL_SOURCES.filter((s) => s.ingestion === 'change-detect');

  const title = `Spring Thaw Weight Restrictions by State (Frost Laws) | QuoteFleet`;
  const description = `Which US states impose spring thaw weight restrictions, what each DOT publishes, and when we last read it — with a direct link to every state's own bulletin. Free, no account.`;

  /**
   * FOUR QUESTIONS, AND NOT ONE OF THEM STATES A RULE.
   *
   * This page is compliance-adjacent: a frost-law limit is a legal requirement
   * that differs by jurisdiction AND by year, and a confidently wrong answer
   * here is worse than no answer. So every answer below is grounded in one of
   * exactly three things — what our own registry (`sources.ts`) records, what
   * our own scheduler (`schedule.ts`) does, or how this tool behaves. None of
   * them asserts what any state's rule IS, none carries a fixed date, and none
   * says anything about Canada, where we hold no data at all.
   */
  const faqs = [
    {
      q: 'Which states are covered, and what does "covered" mean here?',
      a: `All ${SEASONAL_SOURCES.length} states in our source registry, sorted into three classes. ${statewide.length} have a state-system programme: the DOT itself posts and lifts restrictions on the roads it maintains. ${localOnly.length} are local-only: the state system carries no seasonal restriction and the posting is done by counties or townships under their own authority. ${noProgramme.length} have no spring-thaw programme we can cite at any level. Every row names that state's own publication and links straight to it.`,
    },
    {
      q: 'If a state shows no restriction, is the road clear?',
      a: 'No, and this page never says it is. What it publishes is what that state\'s own document said when we last read it, together with the date we read it. A restriction can be posted between two readings, and county and township roads sit outside every statewide figure. The state\'s own page is the authority; this one is a mirror with a timestamp.',
    },
    {
      q: 'How current is any of this?',
      a: `Each source is read on a cadence derived from its own posting window rather than on one global interval: every ${HOURS(IN_SEASON_INTERVAL_MS)} hours inside that window, every ${HOURS(SHOULDER_INTERVAL_MS)} hours in the ${SHOULDER_DAYS} days either side of it, every ${DAYS(OFF_SEASON_INTERVAL_MS)} days the rest of the year, and never for a state with no programme to poll. Each state's own page prints the cadence it is on today, the date we last read the source, and the date the document itself states.`,
    },
    {
      q: 'Why do some states show a list of restrictions and others only a link?',
      a: `Because of what the state publishes, not how hard we tried. ${parsed.length} of these sources are structured enough to yield dated restriction rows, so we parse them. ${watched.length} publish a rendered map, a status page or a PDF, and a row cannot be produced from those without guessing — so we do not guess: we read them on the same schedule, report when the document changed, and link it. Each state's page says which of the two it is.`,
    },
  ];

  const tool = `<div class="sr-truth">
      <h2>The state's own page is the authority. This one is a mirror with a timestamp.</h2>
      <p><strong>We never tell you a road is clear.</strong> Restrictions are posted road by road and lift with a few days' notice, so we publish what each state's own document says, the date we read it, and the link. Where a state publishes only a map or a PDF we say so rather than inventing a limit from it, and where our copy is old we say how old and which way that errs.</p>
    </div>
    <div class="sr-grp">
      <h3>States that restrict the state highway system</h3>
      <p class="sr-sub">${statewide.length} states whose DOT posts and lifts restrictions on the roads it maintains. Each is polled on its own cadence, derived from that state's published season — a statute where one exists, otherwise its own bulletin history.</p>
      <div class="sr-cards">${statewide.map(card).join('')}</div>
    </div>
    <div class="sr-grp">
      <h3>States where the restriction is local, or absent</h3>
      <p class="sr-sub">These are routinely listed as "frost law states", and for most of them that is true of the county roads and false of the state system. Knowing which it is decides who you have to call.</p>
      <div class="sr-cards">${other.map(card).join('')}</div>
    </div>`;

  return toolPage({
    title,
    description,
    path: SEASONAL_TOOL_PATH,

    // ── 1 ── The page had NO breadcrumb at all before this.
    crumbs: [{ name: 'Free tools', path: '/tools' }, { name: 'Seasonal restrictions' }],
    eyebrow: 'Free reference · no account needed',
    h1: 'Spring thaw weight restrictions by state',
    lead: `Which states cut axle and gross weight during the spring thaw, what each one publishes, when we last read it, and a direct link to the state's own bulletin. A load that is legal on a road in July can be illegal on the same road in March.`,
    embed: { href: EMBED_SURFACE, label: 'Embed this tool' },

    // ── 2 ──
    toolHtml: tool,

    // ── 3 ── Coverage is the boundary that matters on a mirror: what we hold,
    // what we deliberately do not, and the fact that none of it is authority.
    limits: {
      head: {
        eyebrow: 'Scope',
        heading: 'What this holds, and where it stops',
        sub: 'A mirror with a timestamp is useful precisely because it says what it is not.',
      },
      facts: [
        {
          label: 'What it covers',
          bodyHtml: `${SEASONAL_SOURCES.length} US states, each named against <strong>its own issuing agency's publication</strong> — never an aggregator's summary of one. ${statewide.length} have a state-system programme, ${localOnly.length} post only at county or township level, and ${noProgramme.length} have no programme we can cite.`,
        },
        {
          label: 'What it does not cover',
          bodyHtml: `It never says a road is clear — only what the state's document said when we read it. County and township postings are outside every statewide figure, and specific bridge or culvert postings are outside all of them. <strong>US states only:</strong> we hold no Canadian provincial seasonal data and publish none.`,
        },
        {
          label: 'What it costs',
          bodyHtml: `Nothing, and no account. The same data is a JSON mirror at <a href="/api/tools/seasonal-restrictions">/api/tools/seasonal-restrictions</a> so a dispatcher's own TMS can poll it, and the page renders in full from the compiled registry with the database unreachable.`,
        },
      ],
    },

    // ── 4 ── A real three-step process, and every step is something we do
    // rather than something we claim about a jurisdiction.
    steps: {
      head: { eyebrow: 'How it works', heading: 'How a state gets onto this page' },
      items: [
        {
          title: 'Name the state\'s own publication',
          bodyHtml:
            'Every link is the issuing agency\'s. A commercial summary of a state bulletin is not a citation — it is somebody else\'s reading of one — so aggregators were used as a map to find these pages and appear nowhere in the data.',
        },
        {
          title: 'Read it on that state\'s own clock',
          bodyHtml: `The cadence comes from each source's published posting window, not from one global interval: ${HOURS(IN_SEASON_INTERVAL_MS)}-hourly in season, every ${HOURS(SHOULDER_INTERVAL_MS)} hours in the ${SHOULDER_DAYS}-day shoulder either side, weekly out of season.`,
        },
        {
          title: 'Print what it says — and what it does not',
          bodyHtml:
            'Structured sources become dated restriction rows. A map, a status page or a PDF becomes "this changed, here is the link", because a row invented from a map tile is a guess wearing a citation. Every row carries both dates: the document\'s own, and ours.',
        },
      ],
    },

    // ── 5 ──
    rows: {
      head: { eyebrow: 'Why this one', heading: 'Two things the aggregator lists get wrong' },
      items: [
        {
          heading: 'Three classes of state, not one',
          bodyHtml: `<p>"Which states have frost laws" has a worse answer than a single list suggests, and the wrong answer is expensive in both directions. Telling a dispatcher to watch a DOT bulletin that does not exist sends them looking in the wrong place; telling them the state has no frost laws sends them onto a posted county road.</p>
            <p>A local-only row is <strong>data, not a gap</strong>. It answers "does my lane have a state frost-law problem?" with a cited no, and points at the county-level reality instead of inventing a state bulletin.</p>`,
          figureHtml: factList([
            { label: 'State-system programme', value: String(statewide.length), unit: 'states' },
            { label: 'County or township only', value: String(localOnly.length), unit: 'states' },
            { label: 'No programme we can cite', value: String(noProgramme.length), unit: 'states' },
          ]),
        },
        {
          heading: 'The reading schedule is derived, not guessed',
          bodyHtml: `<p>These sources are dormant for most of the year and then move several times a week for six weeks. One fixed interval has to be wrong at one end or the other, so each state's cadence comes from its own posting window — a statute where one exists, otherwise that state's observed bulletin history — and the window is recorded with its basis.</p>
            <p>Every state's page prints the cadence it is on today and why, so the schedule is auditable rather than folkloric.</p>`,
          figureHtml: factList([
            { label: 'In season', value: `every ${HOURS(IN_SEASON_INTERVAL_MS)}`, unit: 'hours' },
            { label: `Shoulder, ±${SHOULDER_DAYS} days`, value: `every ${HOURS(SHOULDER_INTERVAL_MS)}`, unit: 'hours' },
            { label: 'Off season', value: `every ${DAYS(OFF_SEASON_INTERVAL_MS)}`, unit: 'days' },
          ]),
        },
      ],
    },

    // ── 6 ──
    related: {
      head: {
        eyebrow: 'Next',
        heading: 'A restriction changes what the rest of the move costs',
        sub: 'A seasonal limit can make a compliant axle group illegal on a specific road in March.',
      },
      items: [
        {
          href: AXLE_TOOL,
          title: 'Axle weight checker',
          blurb: "Your rig against a state's own cited axle and gross limits, with the statute on every line.",
        },
        {
          href: BRIDGE_TOOL,
          title: 'Bridge formula calculator',
          blurb: 'Every group of two or more consecutive axles against the federal formula.',
        },
        {
          href: OSOW_TOOL_PATH,
          title: 'Oversize permit calculator',
          blurb: 'Single-trip state permit fees, with a cited warning on any leg crossing a restricted state.',
        },
        {
          href: `${OSOW_HUB_PATH}/legal-limits`,
          title: 'Legal limits by state',
          blurb: 'The published axle, gross and dimension limits side by side, each with its source.',
        },
      ],
    },

    // ── 7 ──
    faq: { head: { eyebrow: 'FAQ', heading: 'Questions' }, items: faqs },

    extraCss: SEASONAL_CSS,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Free tools', path: '/tools' },
        { name: 'Seasonal restrictions', path: SEASONAL_TOOL_PATH },
      ]),
      jsonLdWebApplication({
        name: 'Spring Thaw Weight Restrictions by State',
        description:
          "Mirrors each US state's own seasonal weight-restriction publication with the date it was read and a link to the issuing agency.",
        path: SEASONAL_TOOL_PATH,
      }),
      jsonLdCollection({
        name: 'Spring thaw weight restrictions by state',
        description,
        path: SEASONAL_TOOL_PATH,
        items: SEASONAL_SOURCES.map((s) => ({ name: s.name, path: seasonalStatePath(s) })),
        dateModified: null,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── The per-state page ─────────────────────────────────────────────────────

function renderState(
  spec: SeasonalSourceSpec,
  snap: StateSeasonalSnapshot | undefined,
  asOf: string,
  now: Date,
): string {
  const active = snap ? activeRestrictions(snap, asOf) : [];
  const cadence = cadenceFor(spec, now);

  const rowsHtml =
    active.length > 0
      ? `<ul class="sr-rows">${active
          .map(
            (r) => `<li>
        <p class="sr-area">${esc(r.value.area)}</p>
        <p class="sr-limit">${esc(r.value.limit)}</p>
        <p class="sr-when">${esc(r.effectiveFrom)} to ${esc(r.effectiveTo ?? 'no published lift date')}${r.value.orderRef ? ` &middot; ${esc(r.value.orderRef)}` : ''}</p>
      </li>`,
          )
          .join('')}</ul>`
      : spec.programme !== 'statewide'
        ? `<p class="sr-empty">${esc(spec.name)} posts no seasonal restriction on the state highway system, so there is nothing here to list.</p>`
        : snap && snap.verifiedClear && snap.fetchStatus === 'ok'
          ? `<p class="sr-empty">We read ${esc(spec.authorityTitle)} on ${esc(snap.retrievedOn ?? '')} and it showed no restriction in force. Confirm on the state's own page before dispatch.</p>`
          : `<p class="sr-empty">We hold no confirmed restriction list for ${esc(spec.name)} right now. That is <strong>not</strong> the same as "no restrictions" — open the state's page below.</p>`;

  const body = `
    <section class="sr-detail">
      <h2>In force on ${esc(asOf)}</h2>
      <div class="sr-pills">${statusPill(spec, snap, asOf)}</div>
      ${rowsHtml}
    </section>

    <section class="sr-detail">
      <h2>The source, and how we read it</h2>
      ${capabilityPills(spec, now)}
      <dl class="sr-dl">
        <dt>Publisher</dt><dd>${esc(spec.publisher)}</dd>
        <dt>Authoritative page</dt><dd><a class="sr-link" href="${esc(spec.authorityUrl)}" rel="nofollow noopener" target="_blank">${esc(spec.authorityUrl)}</a></dd>
        ${spec.fetchUrl ? `<dt>Data endpoint</dt><dd><a class="sr-link" href="${esc(spec.fetchUrl)}" rel="nofollow noopener" target="_blank">${esc(spec.fetchUrl)}</a></dd>` : ''}
        <dt>Format</dt><dd>${esc(FORMAT_LABEL[spec.format] ?? spec.format)} &mdash; ${esc(READABILITY_LABEL[spec.machineReadable] ?? spec.machineReadable)}</dd>
        <dt>What we do with it</dt><dd>${
          spec.ingestion === 'parse'
            ? 'Parsed into dated restriction rows.'
            : spec.ingestion === 'change-detect'
              ? 'Watched for change and linked. We do not synthesise a limit from a map or a PDF.'
              : 'Nothing is fetched — there is no state feed, because there is no state programme.'
        }</dd>
        <dt>Posting season</dt><dd>${
          spec.ingestion === 'none'
            ? 'Not applicable.'
            : `${esc(spec.postingWindow.from)} to ${esc(spec.postingWindow.to)} &mdash; ${esc(spec.postingWindow.basis)}`
        }</dd>
        <dt>Polling cadence today</dt><dd>${esc(cadence.why)}</dd>
        <dt>If our copy goes stale</dt><dd>${
          spec.staleFailureDirection === 'over-restricts'
            ? 'It errs toward showing a restriction the state has already lifted, because this source publishes only what is currently in force.'
            : 'It errs toward missing a restriction posted since we last read it, because this source publishes a fixed end date that expires on its own.'
        }</dd>
      </dl>
    </section>

    <section class="sr-detail">
      <h2>Other states</h2>
      <p class="sr-empty"><a class="sr-link" href="${esc(SEASONAL_TOOL_PATH)}">All states and what each one publishes</a> &middot; <a class="sr-link" href="${esc(OSOW_TOOL_PATH)}">Oversize &amp; overweight permit calculator</a></p>
    </section>`;

  const title = `${spec.name} Spring Thaw Weight Restrictions (Frost Laws) | QuoteFleet`;
  const description = `${spec.name} seasonal weight restrictions: what ${spec.publisher} publishes, what is in force, when we last read it, and a direct link to the state's own bulletin.`;

  /**
   * THE PER-STATE PAGE IS NOT A TOOL PAGE, so it does not get the tool
   * template — it is one state's mirror, with no calculator, no three steps and
   * no FAQ we could answer without stating that state's rule. It does get the
   * SHARED SHELL, which is the point: the hand-rolled '<!doctype html>' this
   * file used to own is gone, so the index and the ~21 state pages now render
   * the same head, the same header, the same footer and the same theme boot as
   * the rest of the site, and the state pages gain a breadcrumb they never had.
   */
  return hubPage({
    title,
    description,
    path: seasonalStatePath(spec),
    crumbs: [
      { name: 'Free tools', path: '/tools' },
      { name: 'Seasonal restrictions', path: SEASONAL_TOOL_PATH },
      { name: spec.name },
    ],
    eyebrow: `Spring thaw restrictions · ${spec.name}`,
    h1: `${spec.name} Spring Thaw Weight Restrictions`,
    lead: esc(spec.note),
    truthHtml: `<div class="sr-truth">
        <h2>Check ${esc(spec.authorityTitle)} before you dispatch.</h2>
        <p><strong>This page mirrors the state's publication with a timestamp; it is not the authority.</strong> ${freshnessLine(snap)} <a class="sr-link" href="${esc(spec.authorityUrl)}" rel="nofollow noopener" target="_blank">Open the state's own page</a>.</p>
      </div>`,
    bodyClass: 'sr-page',
    bodyHtml: body,
    extraCss: SEASONAL_CSS,
    dateModified: snap?.retrievedOn ?? null,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Free tools', path: '/tools' },
        { name: 'Seasonal restrictions', path: SEASONAL_TOOL_PATH },
        { name: spec.name, path: seasonalStatePath(spec) },
      ]),
    ],
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerSeasonalRestrictionRoutes(app: Express) {
  app.get([SEASONAL_TOOL_PATH, `${SEASONAL_TOOL_PATH}/`], async (req: Request, res: Response, next) => {
    try {
      const now = new Date();
      const asOf = todayIso(now);
      // NEVER THROWS, and returns a full registry map even with the database
      // down — so the page renders identically minus the freshness lines.
      const ctx = await loadSeasonalContext(asOf, now);
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderIndex(ctx.snapshots, asOf, now));
    } catch (err) {
      next(err);
    }
  });

  app.get(`${SEASONAL_TOOL_PATH}/:state`, async (req: Request, res: Response, next) => {
    try {
      const spec = specBySlug(String(req.params.state ?? ''));
      if (spec === null) return next();
      const now = new Date();
      const asOf = todayIso(now);
      const ctx = await loadSeasonalContext(asOf, now);
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderState(spec, ctx.snapshots.get(spec.code), asOf, now));
    } catch (err) {
      next(err);
    }
  });

  /**
   * JSON mirror of the page. No auth and no rate limiter beyond the global one:
   * it is a read of a table with a couple of dozen rows, it is CDN-cacheable,
   * and a dispatcher's own TMS being able to poll it is the point.
   */
  app.get('/api/tools/seasonal-restrictions', async (req: Request, res: Response, next) => {
    try {
      const now = new Date();
      const asOf = todayIso(now);
      const ctx = await loadSeasonalContext(asOf, now);
      setPublicDirectoryCache(req, res);
      return res.json({
        asOf,
        storeUnavailable: ctx.storeUnavailable === true,
        disclaimer:
          'The state DOT publication is the authority. This mirrors what we last read from it, with the date we read it. Absence of a restriction here is not evidence that a road is clear.',
        states: SEASONAL_SOURCES.map((spec) => {
          const snap = ctx.snapshots.get(spec.code);
          return {
            code: spec.code,
            name: spec.name,
            programme: spec.programme,
            authorityUrl: spec.authorityUrl,
            authorityTitle: spec.authorityTitle,
            format: spec.format,
            machineReadable: spec.machineReadable,
            ingestion: spec.ingestion,
            postingWindow: spec.postingWindow,
            cadence: cadenceFor(spec, now),
            staleFailureDirection: spec.staleFailureDirection,
            retrievedOn: snap?.retrievedOn ?? null,
            bulletinDate: snap?.bulletinDate ?? null,
            fetchStatus: snap?.fetchStatus ?? 'never',
            verifiedClear: snap?.verifiedClear ?? false,
            lastError: snap?.lastError ?? null,
            active: snap ? activeRestrictions(snap, asOf) : [],
            page: `${SITE}${seasonalStatePath(spec)}`,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  });
}
