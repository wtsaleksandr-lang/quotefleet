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
import { loadSeasonalContext } from '../seasonal/store.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import { FULL_SITE_HEADER, PREMIUM_FOOTER, HEADER_SCRIPTS } from '../siteChrome.js';
import { OSOW_TOOL_PATH } from './osowPermits.js';

const SITE = 'https://quotefleet.net';
export const SEASONAL_TOOL_PATH = '/tools/seasonal-weight-restrictions';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string,
  );
}

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
  .sr-shell { max-width: 1080px; margin: 0 auto; padding: 24px; }
  /* Shared .hero centres its text. Left-align it and centre the same column the
     body uses, so the H1 starts on the body's left edge. */
  .sr-hero { padding: 48px 24px 16px; text-align: left; }
  .sr-hero .container-narrow { max-width: 1032px; margin: 0 auto; padding: 0; }
  .sr-eyebrow { color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; text-align: left; }
  .sr-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 8px; text-align: left; text-wrap: balance; }
  .sr-hero p.lead { max-width: 780px; margin: 0; text-align: left; text-wrap: pretty; }

  /* Honesty banner. Solid, never glass — body text sits on it. */
  .sr-truth { background: var(--warn-bg); border: 1px solid var(--warn); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0 0; }
  .sr-truth h2 { font-size: 16px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .sr-truth p { margin: 0; color: var(--ink-soft); font-size: 14px; line-height: 1.55; }
  .sr-truth strong { color: var(--ink); }

  .sr-sec { margin: 32px 0 0; }
  .sr-sec h2 { font-size: 20px; margin: 0 0 4px; color: var(--ink); text-align: left; }
  .sr-sec p.sr-sub { margin: 0 0 12px; color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 780px; }

  .sr-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .sr-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .sr-card h3 { font-size: 16px; margin: 0; color: var(--ink); text-align: left; }
  .sr-card h3 a { color: inherit; text-decoration: none; }
  .sr-card h3 a:hover, .sr-card h3 a:focus-visible { text-decoration: underline; }
  .sr-card p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ink-soft); }
  .sr-card .sr-meta { color: var(--muted); font-size: 12px; font-family: var(--font-mono); }

  /* Status + capability pills. OUTLINE, never a bright fill. Groups are laid
     out so a run of pills never leaves one alone on its own line. */
  .sr-pills { display: flex; flex-wrap: wrap; gap: 6px; }
  .sr-pill { display: inline-flex; align-items: center; gap: 4px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; line-height: 1.2; padding: 4px 10px; white-space: nowrap; }
  .sr-pill.is-live { border-color: var(--warn); color: var(--warn); }
  .sr-pill.is-clear { border-color: var(--success); color: var(--success); }
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

  @media (max-width: 760px) {
    .sr-hero h1 { font-size: 28px; }
    .sr-hero { padding: 32px 16px 12px; }
    .sr-shell { padding: 16px; }
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

function capabilityPills(spec: SeasonalSourceSpec, now: Date): string {
  const cadence = cadenceFor(spec, now);
  const pills: string[] = [
    `<span class="sr-pill">${esc(FORMAT_LABEL[spec.format] ?? spec.format)}</span>`,
    `<span class="sr-pill${spec.machineReadable === 'full' ? ' is-machine' : ''}">${esc(READABILITY_LABEL[spec.machineReadable] ?? spec.machineReadable)}</span>`,
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

  const body = `
  <section class="hero sr-hero">
    <div class="container-narrow">
      <p class="sr-eyebrow">Free reference &middot; no account needed</p>
      <h1>Spring Thaw Weight Restrictions by State</h1>
      <p class="lead">Which states cut axle and gross weight during the spring thaw, what each one publishes, when we last read it, and a direct link to the state's own bulletin. A load that is legal on a road in July can be illegal on the same road in March.</p>
      <div class="sr-truth">
        <h2>The state's own page is the authority. This one is a mirror with a timestamp.</h2>
        <p><strong>We never tell you a road is clear.</strong> Restrictions are posted road by road and lift with a few days' notice, so we publish what each state's own document says, the date we read it, and the link. Where a state publishes only a map or a PDF we say so rather than inventing a limit from it, and where our copy is old we say how old and which way that errs.</p>
      </div>
    </div>
  </section>

  <main class="sr-shell">
    <section class="sr-sec">
      <h2>States that restrict the state highway system</h2>
      <p class="sr-sub">${statewide.length} states whose DOT posts and lifts restrictions on the roads it maintains. Each is polled on its own cadence, derived from that state's published season — a statute where one exists, otherwise its own bulletin history.</p>
      <div class="sr-cards">${statewide.map(card).join('')}</div>
    </section>

    <section class="sr-sec">
      <h2>States where the restriction is local, or absent</h2>
      <p class="sr-sub">These are routinely listed as "frost law states", and for most of them that is true of the county roads and false of the state system. Knowing which it is decides who you have to call.</p>
      <div class="sr-cards">${other.map(card).join('')}</div>
    </section>

    <section class="sr-sec">
      <h2>Pricing a permit through one of these states</h2>
      <p class="sr-sub">The <a class="sr-link" href="${esc(OSOW_TOOL_PATH)}">oversize &amp; overweight permit calculator</a> prices single-trip state permit fees for 21 states and raises a cited warning on any leg crossing a state with a restriction in force. It does not reprice the permit for a restriction, and the reason is on that warning: the restriction applies to specific roads, and a quote priced from state codes does not know the route.</p>
    </section>
  </main>`;

  const title = `Spring Thaw Weight Restrictions by State (Frost Laws) | QuoteFleet`;
  const description = `Which US states impose spring thaw weight restrictions, what each DOT publishes, and when we last read it — with a direct link to every state's own bulletin. Free, no account.`;
  return page(title, description, SEASONAL_TOOL_PATH, body);
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
  <section class="hero sr-hero">
    <div class="container-narrow">
      <p class="sr-eyebrow">Spring thaw restrictions &middot; ${esc(spec.name)}</p>
      <h1>${esc(spec.name)} Spring Thaw Weight Restrictions</h1>
      <p class="lead">${esc(spec.note)}</p>
      <div class="sr-truth">
        <h2>Check ${esc(spec.authorityTitle)} before you dispatch.</h2>
        <p><strong>This page mirrors the state's publication with a timestamp; it is not the authority.</strong> ${freshnessLine(snap)} <a class="sr-link" href="${esc(spec.authorityUrl)}" rel="nofollow noopener" target="_blank">Open the state's own page</a>.</p>
      </div>
    </div>
  </section>

  <main class="sr-shell">
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
    </section>
  </main>`;

  const title = `${spec.name} Spring Thaw Weight Restrictions (Frost Laws) | QuoteFleet`;
  const description = `${spec.name} seasonal weight restrictions: what ${spec.publisher} publishes, what is in force, when we last read it, and a direct link to the state's own bulletin.`;
  return page(title, description, seasonalStatePath(spec), body);
}

function page(title: string, description: string, path: string, body: string): string {
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
  <style>${SEASONAL_CSS}</style>
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
</head>
<body>
  ${FULL_SITE_HEADER}
  ${body}
  ${PREMIUM_FOOTER}
  ${HEADER_SCRIPTS}
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
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
