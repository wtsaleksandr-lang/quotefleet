/**
 * Server-rendered SEO "service / category" pages for the carrier directory.
 *
 *   GET /services            → hub listing the six drayage service categories.
 *   GET /services/:slug      → one category page (intro + explainer + a real
 *                              FMCSA carrier sample + FAQ + related links).
 *
 * Programmatic-SEO surface described in DIRECTORY-BLUEPRINT.md ("Service-page
 * taxonomy"). Every page reuses the directory shell (layout/carrierCard/CSS
 * from pages.ts) and the ONE shared query layer (queries.ts) so the carrier
 * samples never drift from the browsable directory.
 *
 * ── DATA HONESTY (hard rule) ───────────────────────────────────────────────
 * FMCSA public data — which is all we ingest today — reliably gives us the
 * drayage / intermodal flag (Census crgo_intermodal), state, fleet, authority
 * and safety rating. It does NOT give per-carrier UIIA / TWIC / C-TPAT /
 * hazmat-endorsement / reefer / oversize flags. So:
 *
 *   • dataMode 'fmcsa'  (hazmat-drayage, drayage base) — we show a REAL sample
 *     of FMCSA-registered drayage / intermodal carriers, and tell the reader the
 *     specific endorsement is verified per carrier on SAFER.
 *   • dataMode 'proxy'  (reefer, oversize) — same real drayage slice, but the
 *     banner states the capability is self-declared and NOT verified here.
 *   • dataMode 'claim'  (uiia, twic, bonded) — NOT FMCSA-derivable at all: a
 *     prominent "carriers self-declare — claim your profile" panel leads, and
 *     any carriers shown are labelled plainly as drayage carriers whose
 *     UIIA/TWIC/C-TPAT status is NOT verified. We NEVER assert the credential.
 */
import type { Express, Request, Response } from 'express';
import { listCarriers, type VisibleCarrier } from './queries.js';
import { CONTAINER_PORTS, portByCode } from './containerPorts.js';
import { layout, carrierCard, esc } from './pages.js';
import { setPublicDirectoryCache } from './httpCache.js';

const SITE = 'https://quotefleet.net';

/** How honestly-backed a category's carrier sample is (see file header). */
type DataMode = 'fmcsa' | 'proxy' | 'claim';

interface ServiceDef {
  slug: string;
  /** Short category noun, e.g. "Hazmat" — feeds H1 "{Category} Drayage Carriers". */
  category: string;
  /** Title qualifier, e.g. "FMCSA Drayage & Intermodal". */
  qualifier: string;
  /** One-line hub-card summary. */
  blurb: string;
  dataMode: DataMode;
  /** Our own intro paragraph — what the credential/capability is + why it matters. */
  intro: string;
  /** Our own short explainer — how to read the sample / how we source it. */
  explainer: string;
  faqs: Array<{ q: string; a: string }>;
  /** Related container-port codes to cross-link (3–4). */
  ports: string[];
}

// ─── Category catalogue (6, per blueprint) — all copy is ORIGINAL ──────────
const SERVICES: ServiceDef[] = [
  {
    slug: 'hazmat-drayage',
    category: 'Hazmat',
    qualifier: 'FMCSA Drayage & Intermodal',
    blurb: 'Container drayage carriers for placarded and hazardous-material loads.',
    dataMode: 'fmcsa',
    intro:
      'Hazmat drayage is the short-haul movement of ocean containers carrying hazardous materials between a port or rail ramp and a nearby warehouse, plant, or transload facility. It demands drivers with a hazardous-materials endorsement, correct placarding and shipping papers, and a carrier authorized to haul the specific hazard class. Getting the credential and paperwork right is what keeps a hazmat container moving instead of held at the terminal gate.',
    explainer:
      'The carriers below are FMCSA-registered drayage / intermodal operators near major US container gateways — the pool hazmat drayage is sourced from. A per-carrier hazmat endorsement and active hazardous-materials authority are verified on the FMCSA record, so always confirm a specific carrier on SAFER before you tender a placarded load.',
    faqs: [
      {
        q: 'What makes a drayage carrier "hazmat" capable?',
        a: 'The driver holds a hazardous-materials (H) endorsement on their CDL and the carrier has active operating authority to transport the relevant hazard class, with the right placarding, shipping papers, and emergency-response information for each move.',
      },
      {
        q: 'How do I verify a carrier can legally haul my hazmat container?',
        a: 'Look the carrier up by USDOT or MC number on FMCSA SAFER — or use the live lookup on our Compliance page — to confirm active authority, insurance on file, and that they are allowed to operate before you book.',
      },
      {
        q: 'Does QuoteFleet flag hazmat endorsement per carrier?',
        a: 'We show real FMCSA drayage / intermodal carriers, but we do not assert a per-carrier hazmat endorsement as fact — that is a credential you confirm on the FMCSA record for each carrier and load.',
      },
    ],
    ports: ['USLAX', 'USLGB', 'USNYC', 'USHOU'],
  },
  {
    slug: 'reefer-drayage',
    category: 'Reefer',
    qualifier: 'Refrigerated Container Drayage',
    blurb: 'Drayage carriers that move temperature-controlled refrigerated containers.',
    dataMode: 'proxy',
    intro:
      'Reefer drayage moves refrigerated ocean containers — produce, seafood, pharmaceuticals, and other cold-chain freight — from the port to cold storage or a distribution center while holding a set temperature. It needs genset-equipped chassis or plug-in monitoring, tight appointment discipline, and drivers who watch the reefer while the box is in transit so the cold chain is never broken.',
    explainer:
      'Reefer capability is self-declared: FMCSA public data does not carry a reliable per-carrier refrigerated flag, so the sample below is our real drayage / intermodal slice rather than a verified reefer list. Treat it as a starting pool of port drayage carriers and confirm refrigerated equipment directly with the carrier or by claiming a profile.',
    faqs: [
      {
        q: 'What equipment does reefer drayage require?',
        a: 'A refrigerated container paired with either a diesel genset on the chassis or a monitored plug-in at the yard, plus continuous temperature tracking so the cold chain holds from the terminal to the delivery door.',
      },
      {
        q: 'Is the reefer list here FMCSA-verified?',
        a: 'No. FMCSA data does not include a dependable per-carrier reefer flag, so we show real FMCSA drayage carriers and clearly label refrigerated capability as self-declared — confirm it with the carrier before booking.',
      },
      {
        q: 'How can a reefer carrier get listed as refrigerated?',
        a: 'Claim your carrier profile on QuoteFleet and self-declare your refrigerated equipment and lanes — that is how verified capability flags will populate as the marketplace opens.',
      },
    ],
    ports: ['USLAX', 'USMIA', 'USSAV', 'USNYC'],
  },
  {
    slug: 'oversize-drayage',
    category: 'Oversize',
    qualifier: 'Out-of-Gauge & Heavy-Haul Drayage',
    blurb: 'Drayage carriers for out-of-gauge, over-dimensional and heavy container loads.',
    dataMode: 'proxy',
    intro:
      'Oversize drayage handles out-of-gauge and over-dimensional container freight — flat racks, open tops, break-bulk on special chassis, and loads that exceed standard legal limits. These moves often need permits, specific chassis or lowboys, escort or route planning, and a carrier that knows the port and state rules for heavy or wide loads.',
    explainer:
      'Oversize / heavy-haul capability is self-declared: FMCSA public data has no per-carrier over-dimensional flag, so the sample below is our real drayage / intermodal slice, not a verified oversize roster. Use it as a pool of port drayage carriers and confirm permits, chassis, and heavy-haul experience directly.',
    faqs: [
      {
        q: 'What counts as an oversize drayage move?',
        a: 'A container or break-bulk load that exceeds standard legal dimensions or weight — out-of-gauge cargo on flat racks or open tops, or heavy loads that need special chassis, permits, and sometimes escorts.',
      },
      {
        q: 'Are the carriers shown verified for oversize loads?',
        a: 'No. There is no FMCSA over-dimensional flag, so we show real drayage carriers and label oversize capability as self-declared. Confirm permits, equipment, and route experience with the carrier before tendering.',
      },
      {
        q: 'Do oversize moves need special permits?',
        a: 'Usually yes — over-dimensional and overweight loads typically require state permits and approved routing, which the carrier arranges as part of the move.',
      },
    ],
    ports: ['USHOU', 'USNYC', 'USBAL', 'USSEA'],
  },
  {
    slug: 'uiia-carriers',
    category: 'UIIA',
    qualifier: 'Intermodal Interchange (Self-Declared)',
    blurb: 'Carriers that self-declare UIIA membership for equipment interchange.',
    dataMode: 'claim',
    intro:
      'The Uniform Intermodal Interchange Agreement (UIIA) is the standard contract that lets a motor carrier interchange containers and chassis with ocean carriers, leasing companies, and railroads. A UIIA-registered carrier has met the agreement\u2019s insurance and equipment requirements, which is what allows them to pull an intermodal container off the ramp in the first place.',
    explainer:
      'UIIA membership is NOT part of FMCSA public data and cannot be verified from it — so we do not label any carrier here as a confirmed UIIA member. Verify membership on the official UIIA registry, or claim your carrier profile to self-declare it. The drayage carriers listed below are real FMCSA intermodal carriers shown only as a starting point.',
    faqs: [
      {
        q: 'What is the UIIA?',
        a: 'The Uniform Intermodal Interchange Agreement is the industry-standard contract governing how motor carriers interchange containers and chassis with equipment providers — ocean lines, leasing companies, and railroads.',
      },
      {
        q: 'Can QuoteFleet confirm a carrier is a UIIA member?',
        a: 'No. UIIA membership is not in FMCSA public data, so we never assert it as verified. Check the official UIIA registry directly, or ask the carrier for their UIIA status.',
      },
      {
        q: 'I run a UIIA-registered fleet — how do I show it?',
        a: 'Claim your carrier profile on QuoteFleet and self-declare your UIIA membership. Self-declared credentials will surface on your profile as the marketplace opens.',
      },
    ],
    ports: ['USLAX', 'USLGB', 'USCHI', 'USNYC'],
  },
  {
    slug: 'twic-certified',
    category: 'TWIC',
    qualifier: 'Port-Access Credential (Self-Declared)',
    blurb: 'Carriers whose drivers self-declare a TWIC for secure port access.',
    dataMode: 'claim',
    intro:
      'A Transportation Worker Identification Credential (TWIC) is the TSA-issued card a driver needs for unescorted access to secure areas of maritime ports and terminals. For port drayage it is effectively table stakes: without a TWIC-holding driver, a carrier cannot pick up or drop a container inside a secured marine terminal.',
    explainer:
      'TWIC is a per-driver TSA credential, not a carrier attribute in FMCSA data — so it cannot be verified from the sources we ingest, and we never label a carrier as "TWIC certified" as fact. The carriers below are real FMCSA drayage carriers shown as a starting pool; confirm driver TWIC status with the carrier, or claim a profile to self-declare it.',
    faqs: [
      {
        q: 'What is a TWIC and who needs one?',
        a: 'The Transportation Worker Identification Credential is a TSA-issued biometric card required for unescorted access to secure port and terminal areas — every drayage driver entering a marine terminal needs one.',
      },
      {
        q: 'Does QuoteFleet verify TWIC status?',
        a: 'No. TWIC is a per-driver credential held by TSA, not carrier data in FMCSA, so we do not assert it. Confirm TWIC coverage directly with the carrier.',
      },
      {
        q: 'How does a carrier show its drivers hold TWICs?',
        a: 'Claim your carrier profile and self-declare TWIC coverage — it will appear on your profile as a self-reported capability, not a QuoteFleet-verified fact.',
      },
    ],
    ports: ['USNYC', 'USHOU', 'USSAV', 'USCHS'],
  },
  {
    slug: 'bonded-carriers',
    category: 'Bonded',
    qualifier: 'C-TPAT & Customs-Bonded (Self-Declared)',
    blurb: 'Carriers that self-declare customs-bonded / C-TPAT status for in-bond moves.',
    dataMode: 'claim',
    intro:
      'A bonded carrier is authorized to move cargo that has not yet cleared US Customs — in-bond freight travelling under a customs bond from the port to a bonded warehouse or an inland customs point. Many are also C-TPAT (Customs-Trade Partnership Against Terrorism) members, a voluntary supply-chain-security program that can speed cargo through inspection.',
    explainer:
      'Customs-bonded and C-TPAT status are not part of FMCSA public data, so we cannot verify them and never present a carrier as bonded or C-TPAT as fact. Confirm bonded authority with US Customs (CBP) or the carrier, or claim a profile to self-declare it. The carriers below are real FMCSA drayage carriers shown only as a starting point.',
    faqs: [
      {
        q: 'What is a bonded carrier?',
        a: 'A carrier authorized under a customs bond to transport in-bond cargo — freight that has not cleared US Customs — between a port and a bonded facility or inland customs location.',
      },
      {
        q: 'What is C-TPAT?',
        a: 'The Customs-Trade Partnership Against Terrorism is a voluntary CBP supply-chain-security program; members meet security criteria that can reduce inspections and speed cargo release.',
      },
      {
        q: 'Can QuoteFleet confirm bonded or C-TPAT status?',
        a: 'No. Neither is in FMCSA public data, so we never assert it. Verify bonded authority through CBP or the carrier directly, or claim a profile to self-declare it.',
      },
    ],
    ports: ['USNYC', 'USLAX', 'USBAL', 'USCHS'],
  },
];

const SERVICE_BY_SLUG = new Map(SERVICES.map((s) => [s.slug, s]));

// ─── Small view helpers ────────────────────────────────────────────────────
const fmtNum = (n: number | null | undefined): string =>
  n == null ? '—' : Number(n).toLocaleString('en-US');

function jsonLdScript(obj: unknown): string {
  // JSON-LD in <body> is valid HTML5 and indexed by search engines. Escape "<"
  // so the payload can never break out of the <script> element.
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

function breadcrumbLd(trail: Array<{ name: string; path: string }>): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: `${SITE}${t.path}`,
    })),
  };
}

function faqLd(faqs: Array<{ q: string; a: string }>): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function breadcrumbHtml(trail: Array<{ name: string; path: string | null }>): string {
  const parts = trail.map((t, i) => {
    const last = i === trail.length - 1;
    const label = esc(t.name);
    const node =
      last || !t.path ? `<span aria-current="page">${label}</span>` : `<a href="${esc(t.path)}">${label}</a>`;
    return node;
  });
  return `<nav class="svc-crumb" aria-label="Breadcrumb">${parts.join('<span class="sep">/</span>')}</nav>`;
}

/** Honesty banner tuned to how well FMCSA data backs the sample. */
function honestyBanner(mode: DataMode, category: string): string {
  if (mode === 'fmcsa') {
    return `<div class="svc-note svc-note-ok"><b>FMCSA-sourced sample.</b> These are real FMCSA-registered drayage / intermodal carriers near major US ports. Confirm each carrier's active ${esc(
      category,
    )} authority and endorsement on FMCSA SAFER before you book.</div>`;
  }
  if (mode === 'proxy') {
    return `<div class="svc-note svc-note-proxy"><b>Based on FMCSA drayage data — ${esc(
      category,
    )} capability is self-declared.</b> FMCSA public data has no reliable per-carrier ${esc(
      category,
    )} flag, so the carriers below are our real drayage / intermodal slice, not a verified ${esc(
      category,
    )} list. Confirm the specific capability with the carrier.</div>`;
  }
  return `<div class="svc-note svc-note-claim"><b>${esc(
    category,
  )} is self-declared — we do not verify it.</b> This credential is not part of FMCSA public data, so no carrier here is confirmed as ${esc(
    category,
  )}. The carriers shown are real FMCSA drayage carriers listed only as a starting point. Run a fleet? <a href="/signup?claim=1">Claim your profile</a> to self-declare it.</div>`;
}

// ─── Page-specific CSS (small; layered on top of the directory shell CSS) ──
const SERVICE_CSS = `
  .svc-crumb { font-size: 12px; font-family: var(--font-mono); color: var(--muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .svc-crumb a { color: var(--muted); text-decoration: none; }
  .svc-crumb a:hover { color: var(--accent); }
  .svc-crumb .sep { opacity: 0.5; }
  .svc-crumb span[aria-current] { color: var(--ink-soft); }
  .svc-intro { max-width: 760px; }
  .svc-intro p { line-height: 1.65; margin: 0 0 14px; }
  .svc-explainer { max-width: 760px; color: var(--muted); line-height: 1.6; margin: 0 0 6px; }
  .svc-note { border-radius: var(--radius-lg); padding: 14px 16px; font-size: 13px; line-height: 1.55; margin: 18px 0; border: 1px solid var(--border); background: var(--surface); }
  .svc-note b { color: var(--ink); }
  .svc-note a { color: var(--accent); }
  .svc-note-ok { border-color: rgba(46, 160, 87, 0.4); background: rgba(46, 160, 87, 0.08); }
  .svc-note-proxy { border-color: rgba(214, 158, 46, 0.4); background: rgba(214, 158, 46, 0.08); }
  .svc-note-claim { border-color: rgba(214, 158, 46, 0.4); background: rgba(214, 158, 46, 0.08); }
  .svc-viewall { display: inline-flex; align-items: center; gap: 6px; margin-top: 18px; font-family: var(--font-mono); font-size: 13px; color: var(--accent); text-decoration: none; }
  .svc-viewall:hover { text-decoration: underline; }
  .svc-faq { max-width: 820px; }
  .svc-faq details { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: 4px 18px; margin-bottom: 10px; }
  .svc-faq summary { cursor: pointer; font-weight: 600; padding: 14px 0; list-style: none; font-size: 15px; }
  .svc-faq summary::-webkit-details-marker { display: none; }
  .svc-faq summary::after { content: '+'; float: right; color: var(--muted); font-family: var(--font-mono); }
  .svc-faq details[open] summary::after { content: '\u2212'; }
  .svc-faq details p { margin: 0 0 16px; color: var(--muted); line-height: 1.6; }
`;

// ─── Category card (hub) ────────────────────────────────────────────────────
function serviceHubCard(s: ServiceDef): string {
  const tag =
    s.dataMode === 'fmcsa'
      ? '<span class="pill pill-dray">FMCSA data</span>'
      : s.dataMode === 'proxy'
        ? '<span class="pill pill-warn">Self-declared</span>'
        : '<span class="pill pill-warn">Self-declared</span>';
  return `<a class="dir-card" href="/services/${esc(s.slug)}">
    <div class="dir-chips" style="margin: 0 0 8px;">${tag}</div>
    <h3>${esc(s.category)} Drayage Carriers</h3>
    <p class="sub" style="font-family: inherit; letter-spacing: 0; text-transform: none; color: var(--muted); line-height: 1.5;">${esc(
      s.blurb,
    )}</p>
    <span class="go" style="display:inline-block; margin-top:12px; font-size:12px; font-family: var(--font-mono); color: var(--accent);">View carriers →</span>
  </a>`;
}

// ─── Hub page: GET /services ───────────────────────────────────────────────
function renderServicesHub(drayTotal: number): string {
  const cards = SERVICES.map(serviceHubCard).join('\n');
  const body = `
  <style>${SERVICE_CSS}</style>
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${breadcrumbHtml([
        { name: 'Home', path: '/' },
        { name: 'Services', path: null },
      ])}
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 12px 0 10px;">Drayage services</div>
      <h1>Drayage carrier services by capability</h1>
      <p class="lead">Browse US container-drayage carriers by the capability your load needs — hazmat, reefer, oversize, plus interchange and port-access credentials. Carrier samples come from ${fmtNum(
        drayTotal,
      )} FMCSA-registered drayage / intermodal carriers; credentials that FMCSA doesn't publish are clearly marked self-declared.</p>
    </div>
  </section>
  <main class="dir-shell">
    <div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">${cards}</div>
    <div class="dir-section-h"><h2 style="font-size: 18px;">Browse the full directory</h2></div>
    <div class="dir-chips">
      <a class="dir-chip" href="/directory">All carriers</a>
      <a class="dir-chip" href="/directory?intermodal=1">Drayage / intermodal</a>
      <a class="dir-chip" href="/compliance">Compliance tools</a>
    </div>
  </main>
  ${jsonLdScript(
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Services', path: '/services' },
    ]),
  )}
  ${jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: SERVICES.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: `${s.category} Drayage Carriers`,
      url: `${SITE}/services/${s.slug}`,
    })),
  })}`;

  return layout({
    title: 'Drayage Carrier Services — Hazmat, Reefer, Oversize, UIIA, TWIC | QuoteFleet',
    description:
      'Find US container-drayage carriers by capability: hazmat, reefer, and oversize drayage, plus UIIA, TWIC and customs-bonded carriers. Real FMCSA carrier samples, honest labeling.',
    canonicalPath: '/services',
    bodyHtml: body,
  });
}

// ─── Category page: GET /services/:slug ────────────────────────────────────
function renderServicePage(s: ServiceDef, sample: VisibleCarrier[], drayTotal: number): string {
  const sampleCards = sample.length
    ? `<div class="dir-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">${sample
        .map(carrierCard)
        .join('\n')}</div>`
    : `<div class="dir-empty">The carrier directory is being set up — carriers are loading. Check back shortly.</div>`;

  // Related services (all others).
  const related = SERVICES.filter((o) => o.slug !== s.slug)
    .map((o) => `<a class="dir-chip" href="/services/${esc(o.slug)}">${esc(o.category)} drayage</a>`)
    .join('\n');

  // Related ports (3–4).
  const portChips = s.ports
    .map((code) => portByCode(code))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => `<a class="dir-chip" href="/directory/port/${esc(p.code)}">${esc(p.name)}</a>`)
    .join('\n');

  const faqHtml = s.faqs
    .map(
      (f) =>
        `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`,
    )
    .join('\n');

  const body = `
  <style>${SERVICE_CSS}</style>
  <section class="hero dir-hero">
    <div class="container-narrow">
      ${breadcrumbHtml([
        { name: 'Home', path: '/' },
        { name: 'Services', path: '/services' },
        { name: s.category, path: null },
      ])}
      <h1 style="margin-top: 12px;">${esc(s.category)} Drayage Carriers</h1>
      <div class="svc-intro" style="margin-top: 10px;"><p class="lead">${esc(s.intro)}</p></div>
    </div>
  </section>
  <main class="dir-shell">
    <p class="svc-explainer">${esc(s.explainer)}</p>
    ${honestyBanner(s.dataMode, s.category)}

    <div class="dir-section-h">
      <h2>Carrier sample</h2>
      <span class="muted-small">${sample.length ? `Showing ${sample.length}` : ''}</span>
    </div>
    ${sampleCards}
    <a class="svc-viewall" href="/directory?intermodal=1">View all ${fmtNum(drayTotal)} drayage carriers →</a>

    <div class="dir-section-h"><h2>Frequently asked</h2></div>
    <div class="svc-faq">${faqHtml}</div>

    <div class="dir-section-h"><h2 style="font-size: 18px;">Related drayage services</h2></div>
    <div class="dir-chips">${related}</div>

    <div class="dir-section-h"><h2 style="font-size: 18px;">Carriers by port</h2></div>
    <div class="dir-chips">${portChips}</div>
  </main>
  ${jsonLdScript(
    breadcrumbLd([
      { name: 'Home', path: '/' },
      { name: 'Services', path: '/services' },
      { name: `${s.category} Drayage Carriers`, path: `/services/${s.slug}` },
    ]),
  )}
  ${jsonLdScript(faqLd(s.faqs))}`;

  return layout({
    title: `${s.category} Carriers | ${s.qualifier} | QuoteFleet`,
    description:
      s.dataMode === 'claim'
        ? `${s.category} drayage carriers on QuoteFleet. ${s.category} status is self-declared, not FMCSA-verified — browse real FMCSA drayage carriers near major US ports and verify credentials before booking.`
        : `${s.category} drayage carriers near major US ports, from FMCSA public data. Fleet size, authority and safety ratings, with honest capability labeling. Free to browse.`,
    canonicalPath: `/services/${s.slug}`,
    bodyHtml: body,
  });
}

// ─── Route registration ────────────────────────────────────────────────────
export function registerServiceRoutes(app: Express) {
  // Hub.
  app.get(['/services', '/services/'], async (req: Request, res: Response, next) => {
    try {
      const dray = await listCarriers({ intermodal: true, perPage: 1 });
      // Byte-identical for every visitor (the only dynamic value is a global
      // carrier count), so it belongs on the shared CDN cache like the directory
      // hubs. Without this every crawler hit ran the listCarriers query.
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderServicesHub(dray.total));
    } catch (err) {
      next(err);
    }
  });

  // Category page.
  app.get('/services/:slug', async (req: Request, res: Response, next) => {
    try {
      const svc = SERVICE_BY_SLUG.get(String(req.params.slug).toLowerCase());
      if (!svc) return res.redirect(302, '/services');
      // Real, honest sample: the FMCSA drayage / intermodal slice (~18 rows).
      const list = await listCarriers({ intermodal: true, perPage: 18, page: 1 });
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderServicePage(svc, list.carriers, list.total));
    } catch (err) {
      next(err);
    }
  });
}

// Re-export for callers that want the catalogue without a second import.
export { SERVICES };
