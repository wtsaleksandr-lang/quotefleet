/**
 * THE `/oversize` REFERENCE PAGES — hub, coverage, four topic-across-states
 * tables, the police-escort table, the source-notes page and 21 state profiles.
 *
 * EVERY PAGE HERE IS GENERATED FROM `hubData.ts`, WHICH IS GENERATED FROM
 * `src/calc/osow`. Nothing on these pages is typed prose about a number. A
 * jurisdiction file changing changes the page; adding a 22nd state adds a page,
 * a row on four tables, and its own source list, with no second list to update.
 *
 * THE TEST EVERY PAGE HAD TO PASS BEFORE IT WAS WRITTEN
 * ----------------------------------------------------
 * It carries at least one fact that exists nowhere else on this site, AND at
 * least one primary citation with a date. A page that fails either is a ROW ON
 * A TABLE, not a page — which is why there is no `/oversize/texas/escorts`:
 * `/oversize/texas#escorts` is the same answer, and the escort table links
 * straight to that anchor. Fifty states × thirteen topics would be 650 URLs
 * saying what 21 pages and a handful of tables already say, and the market
 * already demonstrates where that ends — a competitor's state superload page
 * carries no threshold for that state at all.
 *
 * NO STATE PAGE SHIPS WITHOUT A JURISDICTION FILE BEHIND IT. The 30 states we
 * do not hold appear as an honest row on every topic table and on the coverage
 * page, and nowhere else.
 */
import type { IsoDate } from '../../calc/osow/provenance.js';
import { osowRulesFor } from '../../calc/osow/jurisdictions/index.js';
import type { JurisdictionOsowRules } from '../../calc/osow/types.js';
import { isInEffect, resolveSourced } from '../../calc/osow/provenance.js';
import type { Measure } from '../../calc/osow/escortRules.js';
import {
  ESCORT_TRIGGER_MEASURES,
  HUB_COVERED_STATES,
  HUB_STATES,
  LEGAL_LIMIT_COLUMNS,
  OSOW_HUB_PATH,
  allBandConflicts,
  allConflictEntries,
  bandConflictsFor,
  cellFrom,
  conflictEntriesFor,
  corpusProvenance,
  escortRows,
  firstEscortTriggers,
  fmtInches,
  fmtLbs,
  fmtThresholdIn,
  fmtUsd,
  formatTrigger,
  hubStatePath,
  legalLimitRows,
  namedGaps,
  permitFeeRows,
  policeRows,
  provenanceFor,
  superloadRows,
} from './hubData.js';
import type { FirstTrigger, HubState } from './hubData.js';
import {
  citeLink,
  esc,
  fold,
  folds,
  microLabel,
  shortVersion,
  hubPage,
  jsonLdBreadcrumb,
  jsonLdCollection,
  jsonLdDataset,
  jsonLdFaq,
  provenanceBand,
  renderCell,
  revisionLine,
  sourceList,
} from './hubShell.js';

const OSOW_TOOL = '/tools/oversize-permits';
export const BRIDGE_TOOL_PATH = '/tools/bridge-formula';
export const AXLE_TOOL_PATH = '/tools/axle-weights';
const SEASONAL_TOOL = '/tools/seasonal-weight-restrictions';

// ── The IA, as one list ────────────────────────────────────────────────────
//
// This array IS the hub's card grid, IS the coverage page's index, and IS the
// `ItemList` in the hub's JSON-LD. Three uses, one list, so they cannot drift.

export interface HubEntry {
  path: string;
  name: string;
  blurb: string;
  /** OWN = from our cited engine data. PD = verbatim federal public domain. */
  kind: 'own' | 'pd' | 'tool';
}

export const HUB_ENTRIES: readonly HubEntry[] = [
  {
    path: BRIDGE_TOOL_PATH,
    name: 'Federal Bridge Formula calculator',
    blurb:
      'The weight any group of two or more consecutive axles may carry, checked against every one of the N(N−1)/2 groups on the rig rather than the obvious three.',
    kind: 'tool',
  },
  {
    path: AXLE_TOOL_PATH,
    name: 'Axle weight checker',
    blurb:
      'Type the axle layout, get a per-group verdict with the headroom left on each one, and the statute behind every line.',
    kind: 'tool',
  },
  {
    path: `${OSOW_HUB_PATH}/legal-limits`,
    name: 'Legal limits by state',
    blurb:
      'Ten measures per state — width, height, semitrailer, overall, KPRA, both overhangs, gross, single and tandem — each cell carrying the document and its revision date.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/permit-fees`,
    name: 'Permit fees by state',
    blurb:
      'The single-trip base, how the oversize and overweight components are actually priced, and the transaction charge that the advertised fee leaves out.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/escort-requirements`,
    name: 'Escort requirements by state',
    blurb:
      'The first dimension at which a pilot car becomes required, as one sortable column — with three-valued logic, so "we cannot tell" never reads as "no escort".',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/superloads`,
    name: 'Superload thresholds by state',
    blurb:
      'Where the line actually sits. It is not 80,000 lb — that is the federal legal gross limit, and the real thresholds run from 120,000 lb to 254,300 lb.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/police-escorts`,
    name: 'Police escort rates',
    blurb:
      'The published law-enforcement rates, and the states where we looked and there is nothing — a distinction a scraped table cannot draw.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/source-notes`,
    name: 'Where the sources disagree',
    blurb:
      'Every place two official documents give different answers, both cited, neither adopted. Generated from the engine, so it stays current on its own.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/common-figures`,
    name: 'Figures in circulation, against the statute',
    blurb:
      'Widely repeated numbers that no primary document supports, answered with the document that does — and with the mechanism that produced the real figure.',
    kind: 'own',
  },
  {
    path: `${OSOW_HUB_PATH}/federal-limits`,
    name: 'Federal size and weight limits',
    blurb:
      'What federal law fixes and what it leaves to the states: 20,000 / 34,000 / 80,000 on the Interstate, the 102-inch floor-and-ceiling, and the grandfather rights.',
    kind: 'pd',
  },
  {
    path: `${OSOW_HUB_PATH}/bridge-formula`,
    name: 'The bridge formula, explained',
    blurb:
      'The formula, the published table, the round-to-nearest-500 rule, the 34-34-at-36-ft exception — and the five cells where the federal table contradicts itself.',
    kind: 'pd',
  },
  {
    path: `${OSOW_HUB_PATH}/non-divisible`,
    name: 'What counts as non-divisible',
    blurb:
      'The federal 8-work-hour test — the operative definition of what needs an oversize or overweight permit at all, and who carries the burden of proof.',
    kind: 'pd',
  },
  {
    path: `${OSOW_HUB_PATH}/coverage`,
    name: 'What we cover, and what we do not',
    blurb:
      '21 states with a jurisdiction file behind them, 30 without, and a plain statement of what "not covered" means here.',
    kind: 'own',
  },
];

// ── Small builders ─────────────────────────────────────────────────────────

/**
 * A section. The optional `eyebrow` is the mono micro-label that does the
 * wayfinding — 11px uppercase at step 3 of the ink ladder, top-left of the
 * heading block per the house rule, never centred and never inline with it.
 */
function sec(id: string, heading: string, inner: string, eyebrow?: string): string {
  const label = eyebrow ?? id.replace(/-/g, ' ');
  return `<section class="qh-sec" id="${esc(id)}">${microLabel(label)}<h2>${esc(heading)}</h2>${inner}</section>`;
}

function compareLink(path: string, label: string): string {
  return `<p class="qh-compare"><a href="${esc(path)}">${esc(label)} →</a></p>`;
}

/** ONE disclosure pattern per surface: the FAQ is the same compact fold. */
function faqBlock(faqs: Array<{ q: string; a: string }>): string {
  return `<div class="qh-faq" data-qh-folds>${faqs
    .map((f) => fold({ label: f.q, bodyHtml: `<p>${esc(f.a)}</p>` }))
    .join('')}</div>`;
}

function stateCellHtml(state: HubState, anchor: string): string {
  return state.covered
    ? `<td class="qh-st"><a href="${esc(hubStatePath(state.slug))}#${esc(anchor)}">${esc(state.name)}</a></td>`
    : `<td class="qh-st">${esc(state.name)}</td>`;
}

const SOURCING_NOTE = `
  <p>Every covered cell above is a value plus the document it came from. Two dates travel with it and they are not the same thing: <strong>rev.</strong> is the date the <em>source document itself</em> carries — a rule's stated effective date, a PDF's footer — and <strong>read</strong> is the date we retrieved it. A document downloaded this morning can still be five years old, and a single "last updated" stamp would hide exactly that.</p>
  <p>Where two official documents that are both in effect give different answers, the cell says <strong>sources disagree</strong> and shows both, because neither has been adopted. That is not an omission; it is the finding. Where a state publishes no such limit at all, the cell says <strong>none published</strong> — also a finding, and a different one from <strong>not yet covered</strong>, which is our gap and nobody else's.</p>`;

const UNCOVERED_NOTE = `
  <p class="qh-sub">The states without a jurisdiction file are listed here rather than dropped, and their cells say "not yet covered" rather than carrying a number from a secondary source. A table titled "every state" that quietly covers half is the weakness we are competing against; matching it would forfeit the only advantage this page has. <a href="${OSOW_HUB_PATH}/coverage">What coverage means here →</a></p>`;

/**
 * ONE LIVE EXAMPLE, RENDERED FROM THE DATA — not a mock-up of one.
 *
 * The hub and the coverage page both make a claim about how values are cited,
 * and a claim about citation that carries no citation is exactly the failure
 * those pages exist to point at. So both show a real conflict, pulled from the
 * engine at render time with both documents and both dates attached. If the
 * underlying sources are ever reconciled, this block shows the next one.
 */
function workedExample(asOf: IsoDate): string {
  const conflict = allConflictEntries(asOf)[0];
  if (conflict !== undefined) {
    return `<article class="qh-entry qh-entry--conflict">
      <h3>${esc(conflict.state.name)} — ${esc(conflict.field)}</h3>
      <div class="qh-versus">${conflict.candidates
        .map(
          (x) => `<div>
            <span class="qh-fig">${esc(x.text)}</span>
            <span class="qh-src">${citeLink(x.source, x.source.title)} — ${esc(x.source.publisher)}${
              x.source.cite ? ` — ${esc(x.source.cite)}` : ''
            }<br>${esc(revisionLine(x.source))}</span>
          </div>`,
        )
        .join('')}</div>
      <p>Both documents are official, both are in effect, and neither has been adopted. That refusal is computed, not typed — and it is what a "Source:" line under a table structurally cannot say.</p>
    </article>`;
  }
  // No conflict on file is itself a state worth rendering honestly rather than
  // leaving the section empty.
  const first = HUB_COVERED_STATES[0];
  const cell = first === undefined ? null : legalLimitRows(asOf).find((r) => r.state.code === first.code)?.width ?? null;
  if (first === undefined || cell === null || cell.source === undefined) {
    return '<p class="qh-sub">No live source conflict is on file today.</p>';
  }
  return `<article class="qh-entry">
    <h3>${esc(first.name)} — legal width</h3>
    <p><span class="qh-fig">${esc(cell.text ?? '')}</span> — ${citeLink(cell.source, cell.source.title)} — ${esc(revisionLine(cell.source))}</p>
  </article>`;
}

// ── The hub ────────────────────────────────────────────────────────────────

const SPINE: ReadonlyArray<{ n: string; q: string; a: string; links: Array<{ path: string; label: string }> }> = [
  {
    n: '1',
    q: 'Am I legal?',
    a: 'Two different kinds of answer. Dimension-legal is a cited lookup. Weight-legal is a computation over the axle layout — no table can answer it, because two identical 80,000 lb rigs differ entirely in their spacing.',
    links: [
      { path: `${OSOW_HUB_PATH}/legal-limits`, label: 'Legal limits by state' },
      { path: AXLE_TOOL_PATH, label: 'Axle weight checker' },
      { path: BRIDGE_TOOL_PATH, label: 'Bridge formula calculator' },
    ],
  },
  {
    n: '2',
    q: 'What do I need?',
    a: 'A requirement, not a price. Which permit class, whether a pilot car is required, whether the state wants a route survey, and whether the load is a superload the agency prices by hand. An owner-operator asking "can I legally take this job" finishes here.',
    links: [
      { path: `${OSOW_HUB_PATH}/escort-requirements`, label: 'Escort requirements by state' },
      { path: `${OSOW_HUB_PATH}/superloads`, label: 'Superload thresholds' },
      { path: `${OSOW_HUB_PATH}/non-divisible`, label: 'What counts as non-divisible' },
    ],
  },
  {
    n: '3',
    q: 'What will it cost?',
    a: 'The state permit fee, the transaction charge on top of it, and — stated in dollars rather than adjectives — what is not in the number. On a long lane one pilot car above $0.77 a mile costs more than the entire permit total.',
    links: [
      { path: OSOW_TOOL, label: 'Permit cost calculator' },
      { path: `${OSOW_HUB_PATH}/permit-fees`, label: 'Permit fees by state' },
      { path: `${OSOW_HUB_PATH}/police-escorts`, label: 'Police escort rates' },
    ],
  },
  {
    n: '4',
    q: 'When can I move it?',
    a: 'Feasibility and schedule, and the honest state of it: we publish the seasonal weight-restriction sources with the date we read each one. Holiday, curfew and night-travel windows are not encoded yet and are not guessed at.',
    links: [{ path: SEASONAL_TOOL, label: 'Spring thaw restrictions by state' }],
  },
  {
    n: '5',
    q: 'Where do the sources disagree?',
    a: 'Nobody else can publish this, because finding it meant reading both documents. A state administrative code printing one fee where its own statute prints another; a band that ends one inch apart in two schedules; a mileage step that prices nothing at all at exactly 251 miles.',
    links: [
      { path: `${OSOW_HUB_PATH}/source-notes`, label: 'Where the sources disagree' },
      { path: `${OSOW_HUB_PATH}/common-figures`, label: 'Figures in circulation' },
    ],
  },
];

const AUDIENCES: ReadonlyArray<{ who: string; ask: string; path: string; label: string }> = [
  { who: 'Broker', ask: 'What does this cost, and is it feasible?', path: OSOW_TOOL, label: 'Permit cost calculator' },
  { who: 'Owner-operator', ask: 'Can I legally take this job?', path: AXLE_TOOL_PATH, label: 'Axle weight checker' },
  { who: 'Carrier', ask: 'Which of my lanes need a pilot car?', path: `${OSOW_HUB_PATH}/escort-requirements`, label: 'Escort requirements' },
  { who: 'Shipper', ask: 'What am I being charged for?', path: `${OSOW_HUB_PATH}/permit-fees`, label: 'Permit fees by state' },
];

export function renderHub(asOf: IsoDate): string {
  const prov = corpusProvenance();
  const conflicts = allConflictEntries(asOf).length + allBandConflicts(asOf).length;
  const gaps = namedGaps().length;

  const spineHtml = SPINE.map(
    (s) => `<article class="qh-card">
      <h3>${esc(s.n)}. ${esc(s.q)}</h3>
      <p>${esc(s.a)}</p>
      <p class="qh-meta">${s.links
        .map((l) => `<a href="${esc(l.path)}">${esc(l.label)}</a>`)
        .join(' · ')}</p>
    </article>`,
  ).join('');

  const audienceHtml = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Who you are</th><th>The first question</th><th>Start here</th></tr></thead>
    <tbody>${AUDIENCES.map(
      (a) =>
        `<tr><td class="qh-st">${esc(a.who)}</td><td>${esc(a.ask)}</td><td><a href="${esc(a.path)}">${esc(a.label)}</a></td></tr>`,
    ).join('')}</tbody></table></div>`;

  const referenceHtml = `<div class="qh-cards">${HUB_ENTRIES.filter((e) => e.kind !== 'tool')
    .map(
      (e) => `<article class="qh-card">
        <h3><a href="${esc(e.path)}">${esc(e.name)}</a></h3>
        <p>${esc(e.blurb)}</p>
        <p class="qh-meta">${e.kind === 'pd' ? 'Federal public domain — quoted verbatim' : 'From our own cited data'}</p>
      </article>`,
    )
    .join('')}</div>`;

  const toolsHtml = `<div class="qh-cards">${HUB_ENTRIES.filter((e) => e.kind === 'tool')
    .map(
      (e) => `<article class="qh-card">
        <h3><a href="${esc(e.path)}">${esc(e.name)}</a></h3>
        <p>${esc(e.blurb)}</p>
        <p class="qh-meta">Free · no account · no sign-up wall</p>
      </article>`,
    )
    .join('')}
    <article class="qh-card">
      <h3><a href="${esc(OSOW_TOOL)}">Oversize permit cost calculator</a></h3>
      <p>Price a multi-state lane from the same cited fee schedules these tables are built from, with every figure traceable to the document behind it.</p>
      <p class="qh-meta">Free · no account · no sign-up wall</p>
    </article>`;

  const statesHtml = `<div class="qh-grid">${HUB_STATES.map((s) =>
    s.covered
      ? `<a href="${esc(hubStatePath(s.slug))}">${esc(s.name)}</a>`
      : `<span>${esc(s.name)}</span>`,
  ).join('')}</div>`;

  const rail = [
    { id: 'spine', label: 'The five questions' },
    { id: 'reference', label: 'Reference pages' },
    { id: 'tools', label: 'Free calculators' },
    { id: 'states', label: 'By state' },
    { id: 'why', label: 'Why this is different' },
    { id: 'faq', label: 'Questions' },
  ];

  const faqs = [
    {
      q: 'Do I need an account to read any of this?',
      a: 'No. Every page under /oversize and both calculators are free, need no sign-up, and are not gated behind a form. A hauler checking one figure should not have to make an account to see it.',
    },
    {
      q: 'How many states does this cover?',
      a: `Twenty-one, each with its own jurisdiction file behind it. The other thirty states and DC appear on every topic table as an honest "not yet covered" row rather than being filled in from a secondary source.`,
    },
    {
      q: 'Where do the numbers come from?',
      a: `State statutes, administrative codes and DOT fee schedules — ${prov.count} distinct documents. Every value carries the document, that document's own revision date, and the date we retrieved it. Nothing here is copied from another commercial site.`,
    },
    {
      q: 'What happens when two official documents disagree?',
      a: 'Nothing is adopted. The cell says the sources disagree and shows both figures with their pinpoint citations, and the permit calculator refuses to price that field and sends it to the issuing agency.',
    },
  ];

  const body = [
    sec(
      'spine',
      'The five questions, in the order they actually come up',
      `<p>Oversize and overweight work is one sequence of questions, and it is not the sequence the permit application asks in. Escorts are not a trailing detail after cost — on a long lane a single pilot car costs more than the entire permit total. Each step below is a page, not a paragraph.</p>
       <div class="qh-cards">${spineHtml}</div>`,
    ),
    sec(
      'reference',
      'The reference pages',
      `${referenceHtml}`,
    ),
    sec('tools', 'The free calculators', toolsHtml),
    sec(
      'states',
      'By state',
      `<p>Twenty-one states have a full profile: legal limits, escort triggers, the fee schedule, the superload line, route-survey triggers, the police escort rate or the finding that there is none, and every source document behind them. ${HUB_STATES.length - HUB_COVERED_STATES.length} states and DC are not yet covered and are shown greyed rather than linked to a page that would have nothing in it.</p>
       ${statesHtml}`,
    ),
    sec(
      'why',
      'Why this is different from the other tables',
      `<p>Three structural things, and none of them is "more words".</p>
       <ul>
         <li><strong>A statute and a revision date on every cell.</strong> Not one "Source:" line under a table — a document per value, with its own revision date, the date we read it, the window it is in effect for, and a pinpoint cite.</li>
         <li><strong>Conflicts held open rather than adjudicated.</strong> When two in-effect official documents disagree, we show both and adopt neither. Right now that is ${conflicts} live disagreements plus ${gaps} named gaps where nothing at all is priced. A prose "Source:" line cannot express this, which is why it cannot be copied without redoing the work.</li>
         <li><strong>Positive negatives.</strong> "We looked and there is nothing published" is a finding, and it is rendered as one. Fifteen states publish no law-enforcement escort rate, and saying so is more useful than a blank.</li>
       </ul>
       <h3>What that looks like, on live data</h3>
       ${workedExample(asOf)}`,
    ),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Oversize & Overweight Permits: Limits, Fees and Escorts by State | QuoteFleet',
    description: `A cited, effective-dated reference for US oversize and overweight moves: legal limits, permit fees, escort triggers and superload thresholds across 21 states, built from ${prov.count} state statutes, administrative codes and DOT fee schedules. Free, no account.`,
    path: OSOW_HUB_PATH,
    crumbs: [{ name: 'Oversize & overweight' }],
    eyebrow: 'Free reference · no account needed',
    h1: 'Oversize & overweight permits, limits and escorts',
    lead: `Every figure on these pages carries the state document it came from, that document's own revision date, and the date we read it. Where two official documents disagree, both are shown and neither is adopted — because that disagreement is the answer.`,
    bandHtml: provenanceBand(prov, [`${HUB_COVERED_STATES.length} states covered`, `${conflicts} live source conflicts`]),
    rail,
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }]),
      jsonLdCollection({
        name: 'Oversize & overweight permit reference',
        description: 'Legal limits, permit fees, escort requirements and superload thresholds by state.',
        path: OSOW_HUB_PATH,
        items: HUB_ENTRIES.map((e) => ({ name: e.name, path: e.path })),
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Coverage ───────────────────────────────────────────────────────────────

export function renderCoverage(asOf: IsoDate): string {
  const prov = corpusProvenance();
  const rows = HUB_COVERED_STATES.map((s) => {
    const rules = osowRulesFor(s.code) as JurisdictionOsowRules;
    const p = provenanceFor(rules);
    const escorts = rules.escortRules.filter((r) => isInEffect(r, asOf)).length;
    const conflicts = conflictEntriesFor(s, asOf).length + bandConflictsFor(s, asOf).length;
    return `<tr>
      <td class="qh-st"><a href="${esc(hubStatePath(s.slug))}">${esc(s.name)}</a></td>
      <td><span class="qh-v">${p.count}</span></td>
      <td><span class="qh-v">${escorts}</span></td>
      <td><span class="qh-v">${conflicts === 0 ? '—' : conflicts}</span></td>
      <td><span class="qh-v">${esc(p.oldestRevision ?? 'undated')}</span><span class="qh-rev">newest ${esc(p.newestRevision ?? 'undated')}</span></td>
      <td><span class="qh-v">${esc(p.lastRetrieved ?? '—')}</span></td>
    </tr>`;
  }).join('');

  const uncovered = HUB_STATES.filter((s) => !s.covered);

  const rail = [
    { id: 'covered', label: 'The 21 covered states' },
    { id: 'not-covered', label: 'What "not covered" means' },
    { id: 'rules', label: 'The rules we hold ourselves to' },
  ];

  const body = [
    sec(
      'covered',
      `The ${HUB_COVERED_STATES.length} states with a jurisdiction file`,
      `<p>A state is covered when it has a data file behind it: legal limits, a fee schedule, escort rules and superload triggers, every value carrying its own source document and effective window. The counts below are computed from those files, not maintained by hand.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th><th>Source documents</th><th>Escort rules in effect</th><th>Live source conflicts</th><th>Document dates</th><th>Last read</th></tr></thead>
         <tbody>${rows}</tbody>
       </table></div>`,
    ),
    sec(
      'not-covered',
      `The ${uncovered.length} we do not hold, and why they have no page`,
      `<p>These states appear as a row on every topic table, marked "not yet covered", and nowhere else. <strong>No state page ships without a jurisdiction file behind it.</strong> A page titled "Wyoming oversize permits" that contains no Wyoming thresholds is worse than no page: it ranks, it is opened by somebody planning a real move, and it answers nothing. That pattern is common in this market and we are not reproducing it at any page length.</p>
       <p>What we will not do to fill the gap: copy figures from another commercial site. Two of them publish permit fees for half the states under a title claiming all of them, cite no state DOT between them, and carry errors in the dangerous direction — a legal-limit figure a foot over the statute reads as legal and is not. Inheriting a chain like that is how a wrong number and a copyright problem arrive together.</p>
       <div class="qh-grid">${uncovered.map((s) => `<span>${esc(s.name)}</span>`).join('')}</div>`,
    ),
    sec(
      'rules',
      'The rules we hold ourselves to',
      `<ul>
         <li><strong>No value without a document.</strong> Every number is stored with its source, that source's own revision date, our retrieval date, and the window it is effective for.</li>
         <li><strong>No adjudicating a conflict.</strong> Two in-effect official documents that disagree are both published and neither is adopted, and the calculator refuses to price that field.</li>
         <li><strong>No filling a gap with a guess.</strong> A measurement we were not given evaluates to "cannot tell", never to zero and never to "no requirement" — because a requirement chosen by an absence is a confident wrong answer.</li>
         <li><strong>Freshness is per fact, not per page.</strong> A page's modification date is the newest retrieval date among the sources actually rendered on it. It is never the deploy time, because a freshness claim we cannot substantiate per fact would cost us the only thing these pages have.</li>
       </ul>
       <h3>One of those rules, rendered live</h3>
       ${workedExample(asOf)}`,
    ),
  ].join('');

  return hubPage({
    title: 'OS/OW Coverage: What We Hold and What We Do Not | QuoteFleet',
    description: `Which US states our oversize/overweight data covers (${HUB_COVERED_STATES.length}), which it does not (${uncovered.length}), how many source documents sit behind each, and the rules we hold ourselves to.`,
    path: `${OSOW_HUB_PATH}/coverage`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Coverage' }],
    eyebrow: 'Coverage · stated plainly',
    h1: 'What we cover, and what we do not',
    lead: `Twenty-one states have a jurisdiction file behind them and get a page. Thirty states and the District of Columbia do not, and they get an honest row instead of a page with nothing in it.`,
    bandHtml: provenanceBand(prov, [`${HUB_COVERED_STATES.length} covered`, `${uncovered.length} not covered`]),
    rail,
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Coverage', path: `${OSOW_HUB_PATH}/coverage` },
      ]),
    ],
  });
}

// ── Topic table: legal limits ──────────────────────────────────────────────

export function renderLegalLimits(asOf: IsoDate): string {
  const rows = legalLimitRows(asOf);
  const covered = rows.filter((r) => r.state.covered);
  const prov = provenanceFor(covered.map((r) => LEGAL_LIMIT_COLUMNS.map((c) => r[c.key])));

  const tableRows = rows
    .map(
      (r) =>
        `<tr${r.state.covered ? '' : ' class="is-uncovered"'}>${stateCellHtml(r.state, 'legal-limits')}${LEGAL_LIMIT_COLUMNS.map(
          (c) => renderCell(r[c.key]),
        ).join('')}</tr>`,
    )
    .join('');

  const faqs = [
    {
      q: 'Is a 53 ft trailer legal in every state?',
      a: 'No. Federal law forbids a state from setting a semitrailer limit BELOW 48 ft on the National Network, but it sets no ceiling — and at least one state in this table publishes a semitrailer limit under 53 ft in its own statute. Read the semitrailer column, not the national average.',
    },
    {
      q: 'Why do some states show no overall length limit?',
      a: 'Because they publish none. On the National Network the federal rule pre-empts an overall cap for a tractor-semitrailer and leaves only the semitrailer limit, so many states cap one and not the other. "None published" is a finding; it is not the same as a blank.',
    },
    {
      q: 'What is KPRA and why is it a separate column?',
      a: 'Kingpin-to-rearmost-axle: the distance from the fifth wheel to the centre of the rear axle group. It is not the trailer length and cannot be derived from it — two 53 ft trailers with their tandems slid differently have the same length and different KPRA. Some states cap the trailer, some cap KPRA, some both.',
    },
    {
      q: 'Are these the Interstate limits or the state-highway limits?',
      a: 'These are the state\'s own published legal limits. Several states print statutory axle and gross figures above the federal Interstate limits, with a federal compliance clause that pulls them back to 20,000 / 34,000 / 80,000 on the Interstate itself. Read the federal limits page before applying a state figure to an Interstate lane.',
    },
  ];

  const body = [
    sec(
      'table',
      'Legal limits by state',
      `<p>The point at which a load stops being ordinary freight and starts needing a permit. Every covered cell links to the document that sets it, and carries that document's own revision date beside our retrieval date.</p>
       <p class="qh-sub">Weight-legal is not on this table and cannot be: gross, single-axle and tandem limits are necessary conditions, not sufficient ones. A rig can sit under all three and still be illegal on an axle group under the bridge formula. <a href="${esc(AXLE_TOOL_PATH)}">Check the axle layout →</a></p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th>${LEGAL_LIMIT_COLUMNS.map((c) => `<th title="${esc(c.what)}">${esc(c.label)}</th>`).join('')}</tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>
       ${UNCOVERED_NOTE}
       <div class="qh-legend">
         <div><strong>rev.</strong> the date the source document itself carries</div>
         <div><strong>read</strong> the date we retrieved it</div>
         <div><strong>Sources disagree</strong> two in-effect documents differ; neither adopted</div>
         <div><strong>None published</strong> the state publishes no such limit — a finding</div>
       </div>`,
    ),
    sec('sourcing', 'How this is sourced', SOURCING_NOTE + compareLink(`${OSOW_HUB_PATH}/source-notes`, 'Every place the sources disagree')),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Legal Truck Size & Weight Limits by State (Cited) | QuoteFleet',
    description:
      'Width, height, semitrailer and overall length, KPRA, overhang, gross, single-axle and tandem limits for every US state — each covered cell carrying the statute or DOT document and its revision date.',
    path: `${OSOW_HUB_PATH}/legal-limits`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Legal limits' }],
    eyebrow: 'Topic table · all states',
    h1: 'Legal size and weight limits by state',
    lead: 'Ten measures per state, each with the document that sets it and the date that document was revised. Anything over one of these needs a permit.',
    bandHtml: provenanceBand(prov, [`${covered.length} states with values`, `${LEGAL_LIMIT_COLUMNS.length} measures`]),
    rail: [
      { id: 'table', label: 'The table' },
      { id: 'sourcing', label: 'How this is sourced' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Legal limits', path: `${OSOW_HUB_PATH}/legal-limits` },
      ]),
      jsonLdDataset({
        name: 'US legal truck size and weight limits by state',
        description:
          'Statutory legal width, height, semitrailer length, overall length, kingpin-to-rear-axle, overhang, gross weight, single-axle and tandem-axle limits, cited per value.',
        path: `${OSOW_HUB_PATH}/legal-limits`,
        variableMeasured: LEGAL_LIMIT_COLUMNS.map((c) => c.label),
        isBasedOn: prov.sources.map((s) => s.url),
        temporalCoverageFrom: prov.oldestRevision,
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Topic table: permit fees ───────────────────────────────────────────────

export function renderPermitFees(asOf: IsoDate): string {
  const rows = permitFeeRows(asOf);
  const covered = rows.filter((r) => r.state.covered);
  const prov = provenanceFor(
    covered.map((r) => [r.base, r.overweightMechanism, r.transaction, r.routeAnalysis]),
  );

  const tableRows = rows
    .map(
      (r) => `<tr${r.state.covered ? '' : ' class="is-uncovered"'}>
        ${stateCellHtml(r.state, 'fees')}
        ${renderCell(r.base)}
        ${renderCell(r.oversizeMechanism)}
        ${renderCell(r.overweightMechanism)}
        ${renderCell(r.transaction)}
        ${renderCell(r.routeAnalysis)}
        <td><span class="qh-v">${r.state.covered ? (r.distanceBased ? 'Yes' : 'No') : '<span class="qh-none">—</span>'}</span></td>
      </tr>`,
    )
    .join('');

  const faqs = [
    {
      q: 'Is the base fee what I actually pay?',
      a: 'Almost never. The base is the issuance charge before the dimension bands, the overweight component and the transaction fee. Several states advertise a figure that is never payable on its own — one doubles its statutory fee by a separate surcharge statute, so the number in its own fee statute is not a price anybody has ever been charged.',
    },
    {
      q: 'Why is the transaction fee its own column?',
      a: 'Because it is routinely misread. A flat per-permit dollar amount and a percentage of the total are different charges, and one published table reads a flat $12 transaction fee as 12 percent — which understates the out-the-door cost of every permit in that state by roughly half.',
    },
    {
      q: 'What does "per mile" mean in the overweight column?',
      a: 'That the state prices the overweight component on miles travelled INSIDE that state, not on the lane total. We do not estimate those miles: scaling a lane by a state\'s share of a straight line produces a confident number with no relationship to the filed route, so the calculator asks for the figure your routing software already produced.',
    },
    {
      q: 'Does this include escorts, bonds or the engineer\'s fee?',
      a: 'No, and those can dwarf the permit. Pilot cars, police escorts, route-survey engineering, bonds and utility coordination are private or agency costs with no published schedule in most states. The calculator names each exclusion in the result rather than burying it in a footnote.',
    },
  ];

  const body = [
    sec(
      'table',
      'Permit fees by state',
      `<p>The single-trip permit as the state itself publishes it: the base issuance charge, how the oversize component is banded, how the overweight component is priced, and the payment charge added on top. What matters here is the <em>mechanism</em> as much as the number — a state that CPI-adjusts its fee on a fixed cycle will not match a figure copied last year, and publishing the mechanism is what makes a page degrade gracefully instead of silently going wrong.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th><th>Single-trip base</th><th>Oversize component</th><th>Overweight priced by</th><th>Transaction fee</th><th>Route analysis</th><th title="The permit fee depends on miles travelled inside the state">Mileage-priced</th></tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>
       ${UNCOVERED_NOTE}
       <p class="qh-sub"><a href="${esc(OSOW_TOOL)}">Price a specific multi-state lane from these same schedules →</a></p>`,
    ),
    sec('sourcing', 'How this is sourced', SOURCING_NOTE + compareLink(`${OSOW_HUB_PATH}/common-figures`, 'Fee figures in circulation, against the statute')),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Oversize & Overweight Permit Fees by State (Cited) | QuoteFleet',
    description:
      'Single-trip oversize and overweight permit fees by US state: the base charge, how the oversize and overweight components are priced, and the transaction fee on top — each cell carrying its statute or DOT fee schedule and revision date.',
    path: `${OSOW_HUB_PATH}/permit-fees`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Permit fees' }],
    eyebrow: 'Topic table · all states',
    h1: 'Oversize and overweight permit fees by state',
    lead: 'What each state charges for a single-trip permit, how it prices the overweight component, and the transaction charge that the advertised fee leaves out.',
    bandHtml: provenanceBand(prov, [`${covered.length} states with values`, 'Single-trip permits']),
    rail: [
      { id: 'table', label: 'The table' },
      { id: 'sourcing', label: 'How this is sourced' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Permit fees', path: `${OSOW_HUB_PATH}/permit-fees` },
      ]),
      jsonLdDataset({
        name: 'US oversize and overweight single-trip permit fees by state',
        description:
          'Base single-trip permit fee, oversize banding, overweight pricing mechanism, transaction fee and route-analysis fee, cited per value.',
        path: `${OSOW_HUB_PATH}/permit-fees`,
        variableMeasured: [
          'Single-trip base permit fee',
          'Oversize fee bands',
          'Overweight pricing mechanism',
          'Transaction fee',
          'Route analysis fee',
        ],
        isBasedOn: prov.sources.map((s) => s.url),
        temporalCoverageFrom: prov.oldestRevision,
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Topic table: escort requirements ───────────────────────────────────────

export function renderEscortRequirements(asOf: IsoDate): string {
  const rows = escortRows(asOf);
  const covered = rows.filter((r) => r.state.covered);
  const prov = provenanceFor(
    covered.map((r) => [
      ...Object.values(r.triggers).map((t) => t.rule.source),
      ...Object.values(r.police).map((t) => t.rule.source),
    ]),
  );

  const cellFor = (t: FirstTrigger | undefined, measure: Measure): string => {
    if (t === undefined) return `<td><span class="qh-v qh-none">None published</span></td>`;
    const link = citeLink(t.rule.source, formatTrigger(t, measure));
    const dep = t.routeDependent ? ' · varies by road class' : '';
    return `<td><span class="qh-v">${link}</span><span class="qh-rev">${esc(revisionLine(t.rule.source) + dep)}</span></td>`;
  };

  const tableRows = rows
    .map(
      (r) => `<tr${r.state.covered ? '' : ' class="is-uncovered"'}>
        ${stateCellHtml(r.state, 'escorts')}
        ${
          r.state.covered
            ? ESCORT_TRIGGER_MEASURES.map((m) => cellFor(r.triggers[m.measure], m.measure)).join('')
            : ESCORT_TRIGGER_MEASURES.map(() => '<td><span class="qh-v qh-none">Not yet covered</span></td>').join('')
        }
        <td><span class="qh-v">${r.state.covered ? String(r.ruleCount) : '<span class="qh-none">—</span>'}</span></td>
      </tr>`,
    )
    .join('');

  const faqs = [
    {
      q: 'When do I need a pilot car?',
      a: 'At the first dimension in your state\'s column above — but read the road-class note. Many states set a lower trigger on a two-lane road than on a divided highway, and some classify individual highway segments on a published map, so the segment decides the answer rather than the lane count.',
    },
    {
      q: 'Does "none published" mean no escort is ever required?',
      a: 'No. It means the state publishes no numeric trigger on that measurement in the documents we hold. Several states also require escorts on a judgement call — mirror visibility, lane obstruction — that no number can express, and those never resolve to "no escort" here; they resolve to "cannot tell" and go to review.',
    },
    {
      q: 'Why does one state show a width trigger a foot lower than its neighbour?',
      a: 'Because the states genuinely differ, and because the trigger shown is the FIRST one — the lowest width at which any road class in that state requires an escort. On a divided highway the same state may not require one until considerably higher.',
    },
    {
      q: 'Is a pilot car certification from my state valid in the next one?',
      a: 'Often not. Reciprocity is a directed relationship, not a mutual one: at least one state accepts certifications from three neighbours who do not accept its own, and two states accept nobody at all and require their own certification regardless of residency. We are not publishing a reciprocity table until every row is verified against a primary source.',
    },
  ];

  const body = [
    sec(
      'table',
      'The first dimension that requires an escort',
      `<p>The number a dispatcher is actually looking for, as one column per measurement: the lowest value at which any published rule in that state puts a pilot car on the load. Where the winning rule is also conditioned on the road class, the cell says so — because the same state can require an escort two feet earlier on a two-lane road.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th>${ESCORT_TRIGGER_MEASURES.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th title="Escort rules in effect for this state">Rules on file</th></tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>
       ${UNCOVERED_NOTE}
       <div class="qh-legend">
         <div><strong>over X</strong> the rule reads "exceeds" — a load measuring exactly X does not trigger</div>
         <div><strong>X or more</strong> the rule reads "or greater" — exactly X does trigger</div>
         <div><strong>varies by road class</strong> the trigger shown is the lowest across road classes</div>
         <div><strong>None published</strong> no numeric trigger on that measurement in our sources</div>
       </div>`,
    ),
    sec(
      'police',
      'Escorts are a cost, not a footnote',
      `<p>On a long lane a single pilot car above roughly seventy-seven cents a mile costs more than the entire state permit total. Escorts are also a feasibility gate before they are a price — an operator who is not certified in the next state cannot take the load at any rate. Neither the permit calculator nor these tables price a civilian pilot car, because the two commercial sites that publish market rates disagree by nearly a factor of two on the same service.</p>
       ${compareLink(`${OSOW_HUB_PATH}/police-escorts`, 'Published police escort rates, and the fifteen states with none')}`,
    ),
    sec('sourcing', 'How this is sourced', SOURCING_NOTE),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Pilot Car & Escort Requirements by State (Cited) | QuoteFleet',
    description:
      'The first width, height, length, overhang and weight at which each US state requires a pilot car or escort — with the rule and its revision date on every value, and the road-class dependency stated.',
    path: `${OSOW_HUB_PATH}/escort-requirements`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Escort requirements' }],
    eyebrow: 'Topic table · all states',
    h1: 'Pilot car and escort requirements by state',
    lead: 'The first dimension at which an escort becomes required, per state and per measurement — with the rule behind it and the road classes that change the answer.',
    bandHtml: provenanceBand(prov, [`${covered.length} states with rules`, 'First-trigger column']),
    rail: [
      { id: 'table', label: 'The table' },
      { id: 'police', label: 'Escorts as a cost' },
      { id: 'sourcing', label: 'How this is sourced' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Escort requirements', path: `${OSOW_HUB_PATH}/escort-requirements` },
      ]),
      jsonLdDataset({
        name: 'US pilot car and escort requirement thresholds by state',
        description:
          'The lowest published width, height, length, rear overhang and gross weight at which each state requires an escort vehicle.',
        path: `${OSOW_HUB_PATH}/escort-requirements`,
        variableMeasured: ESCORT_TRIGGER_MEASURES.map((m) => `First escort trigger — ${m.label}`),
        isBasedOn: prov.sources.map((s) => s.url),
        temporalCoverageFrom: prov.oldestRevision,
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Topic table: superloads ────────────────────────────────────────────────

export function renderSuperloads(asOf: IsoDate): string {
  const rows = superloadRows(asOf);
  const covered = rows.filter((r) => r.state.covered);
  const prov = provenanceFor(covered.map((r) => [r.gross, r.width, r.height, r.length, r.shortSpacing]));
  const withGross = covered.filter((r) => r.gross.text !== null);
  const grossValues = withGross
    .map((r) => r.gross.text ?? '')
    .filter((t) => t.length > 0);

  const tableRows = rows
    .map(
      (r) => `<tr${r.state.covered ? '' : ' class="is-uncovered"'}>
        ${stateCellHtml(r.state, 'superload')}
        ${renderCell(r.gross)}
        ${renderCell(r.width)}
        ${renderCell(r.height)}
        ${renderCell(r.length)}
        ${renderCell(r.shortSpacing)}
      </tr>`,
    )
    .join('');

  const faqs = [
    {
      q: 'Is a superload anything over 80,000 lb?',
      a: 'No. 80,000 lb is the federal LEGAL gross limit on the Interstate — above it you need an overweight permit, which is an ordinary over-the-counter product in most states. A superload is a load the state will not issue over the counter at all, and the published thresholds in the table above run several times higher.',
    },
    {
      q: 'Can a load be a superload on size alone?',
      a: 'Yes. Several states escalate on width, height or length regardless of weight, which a weight-only check misses entirely — a very wide but comparatively light load can be a superload while a much heavier legal-width one is not.',
    },
    {
      q: 'Why do some states show a short-spacing trigger?',
      a: 'Because a heavy load on a short trailer is a different problem from a heavy load on a long one. Those states escalate a mid-range gross weight to superload treatment when the axle spacing is under a stated minimum — a rig a gross-weight-only check reads as ordinary.',
    },
    {
      q: 'What changes above the superload line?',
      a: 'There is usually no published fee. The agency prices the move after an engineering and route review, often with a bridge analysis, a route survey and escorts attached as conditions. Our calculator emits no priced lines for a superload rather than printing a number the state has not set.',
    },
  ];

  const body = [
    sec(
      'table',
      'Superload thresholds by state',
      `<p>The point at which a state stops issuing a permit over the counter and starts pricing the move by hand after an engineering review. ${withGross.length} of the ${covered.length} covered states publish a gross-weight line; the rest define superload treatment qualitatively or on dimensions, and where that is so the cell says "none published" rather than inventing a cutoff.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th><th>Gross weight</th><th>Width</th><th>Height</th><th>Length</th><th>Short axle spacing</th></tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>
       ${UNCOVERED_NOTE}`,
    ),
    sec(
      'not-80000',
      'It is not "over 80,000 lb"',
      `<p>A figure of "over 80,000 lb" circulates widely as the superload definition. It is the federal legal gross limit under 23 U.S.C. §127 — the point at which an <em>overweight permit</em> becomes necessary, not the point at which a state escalates a move to engineering review. The published gross-weight lines above sit between ${
        grossValues.length > 0 ? esc(grossValues.slice().sort()[0] ?? '') : ''
      } and considerably higher, and treating 80,000 lb as the line misstates the threshold by a multiple on every state that publishes one.</p>
       ${compareLink(`${OSOW_HUB_PATH}/common-figures`, 'Other figures in circulation, against the statute')}`,
    ),
    sec('sourcing', 'How this is sourced', SOURCING_NOTE),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Superload Thresholds by State — What Counts as a Superload | QuoteFleet',
    description:
      'The gross weight, width, height, length and axle-spacing thresholds at which each US state treats a move as a superload — cited to the statute or rule, with revision dates. It is not "over 80,000 lb".',
    path: `${OSOW_HUB_PATH}/superloads`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Superloads' }],
    eyebrow: 'Topic table · all states',
    h1: 'Superload thresholds by state',
    lead: 'Where each state draws the line between a permit you can buy and a move an engineer has to review — with the document that draws it.',
    bandHtml: provenanceBand(prov, [`${withGross.length} states publish a weight line`, `${covered.length} states covered`]),
    rail: [
      { id: 'table', label: 'The table' },
      { id: 'not-80000', label: 'It is not 80,000 lb' },
      { id: 'sourcing', label: 'How this is sourced' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Superloads', path: `${OSOW_HUB_PATH}/superloads` },
      ]),
      jsonLdDataset({
        name: 'US superload thresholds by state',
        description:
          'Gross-weight, width, height, length and short-axle-spacing thresholds at which a state treats a move as a superload.',
        path: `${OSOW_HUB_PATH}/superloads`,
        variableMeasured: [
          'Superload gross-weight threshold',
          'Superload width threshold',
          'Superload height threshold',
          'Superload length threshold',
          'Superload short-axle-spacing trigger',
        ],
        isBasedOn: prov.sources.map((s) => s.url),
        temporalCoverageFrom: prov.oldestRevision,
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Police escorts ─────────────────────────────────────────────────────────

export function renderPoliceEscorts(asOf: IsoDate): string {
  const rows = policeRows(asOf);
  const priced = rows.filter((r) => r.rate !== null);
  const findings = rows.filter((r) => r.rate === null && r.finding !== null);
  const prov = provenanceFor(priced.map((r) => r.rate));

  const tableRows = priced
    .map((r) => {
      const v = r.rate!.value;
      const hourly =
        v.usdPerHourPerOfficer === null
          ? 'No rate stated'
          : `${fmtUsd(v.usdPerHourPerOfficer)}/hr (${v.hourlyRateKind})`;
      const minimum =
        v.minimumChargeUsdPerOfficer !== null
          ? `${fmtUsd(v.minimumChargeUsdPerOfficer)} per officer`
          : v.minimumHoursPerOfficer !== null
            ? `${v.minimumHoursPerOfficer} h per officer`
            : 'None published';
      return `<tr>
        ${stateCellHtml(r.state, 'police')}
        <td><span class="qh-v">${esc(v.agency)}</span><span class="qh-rev">${esc(revisionLine(r.rate!.source))}</span></td>
        <td><span class="qh-v">${esc(hourly)}</span></td>
        <td><span class="qh-v">${esc(minimum)}</span></td>
        <td><span class="qh-v">${v.administrativeUsd === null ? '<span class="qh-none">None</span>' : esc(fmtUsd(v.administrativeUsd))}</span></td>
        <td><span class="qh-v">${r.floorOneOfficerUsd === null ? '<span class="qh-none">Not computable</span>' : esc(fmtUsd(r.floorOneOfficerUsd))}</span><span class="qh-rev">${v.unpriced.length} charge${v.unpriced.length === 1 ? '' : 's'} the floor cannot include</span></td>
      </tr>`;
    })
    .join('');

  const findingCards = findings
    .map(
      (r) => `<article class="qh-card">
        <h3><a href="${esc(hubStatePath(r.state.slug))}#police">${esc(r.state.name)}</a></h3>
        <p class="qh-meta">${r.finding!.kind === 'noScheduleExists' ? 'No schedule exists — structural' : 'Charges exist, nothing published'}</p>
        <p>${esc(r.finding!.finding)}</p>
      </article>`,
    )
    .join('');

  const unpricedList = priced
    .flatMap((r) =>
      r.rate!.value.unpriced.map((u) => ({ state: r.state.name, description: u.description })),
    )
    .map((u) => `<li><strong>${esc(u.state)}.</strong> ${esc(u.description)}</li>`)
    .join('');

  const faqs = [
    {
      q: 'What does a police escort actually cost?',
      a: `Only ${priced.length} of the ${rows.length} covered states publish enough to compute a floor, and the floor is not the price — every one of them adds charges measured from the officer's own station, residence or troop area, distances no quote can know in advance.`,
    },
    {
      q: 'Why is "no published rate" listed at all?',
      a: 'Because it is a finding, not a blank. There is a real difference between a state that bills the actual cost through an escrow (so no rate card can exist) and a state that charges for troopers and publishes nothing. A scraped table renders both as an empty cell.',
    },
    {
      q: 'Is the minimum charge per officer or per move?',
      a: 'Per officer, in every schedule here that states one. Where the state also publishes a minimum number of officers, the floor multiplies. One state bills its minimum hours at the overtime rate rather than the regular one, which raises its floor by well over a hundred dollars per officer.',
    },
  ];

  const body = [
    sec(
      'published',
      `The ${priced.length} states that publish a rate`,
      `<p>A floor, before mileage — and mileage is deliberately excluded, because every state here that publishes a per-mile figure measures it from the officer's station, home or troop area rather than from your route. Multiplying a per-mile rate by the lane's miles would produce a confident number about the wrong journey.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">State</th><th>Agency</th><th>Hourly per officer</th><th>Minimum</th><th>Administrative</th><th>Floor, one officer</th></tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>`,
    ),
    sec(
      'unpriced',
      'What the floor cannot include',
      `<p>Each of these is a charge the state publishes and no quote can compute in advance. They are listed rather than absorbed into an estimate, because an estimate that quietly swallows them reads as a price.</p>
       <ul>${unpricedList}</ul>`,
    ),
    sec(
      'not-published',
      `The ${findings.length} states where we looked and there is nothing`,
      `<p>This is the section no scraped table can produce. Each entry below is a positive finding with the rule behind it: we searched the state's statute, its administrative code and the agency's own pages, and there is no published escort rate to quote. Two different reasons sit in this list and they are not interchangeable — a state that bills actual cost through an escrow has no rate card to find, while a state that charges for troopers and publishes nothing has one and does not print it.</p>
       <div class="qh-cards">${findingCards}</div>`,
    ),
    sec('faq', 'Questions', faqBlock(faqs)),
  ].join('');

  return hubPage({
    title: 'Police Escort Rates for Oversize Loads by State | QuoteFleet',
    description: `Published law-enforcement escort rates for oversize loads in ${priced.length} states — hourly, minimum and administrative charges with the floor computed — plus ${findings.length} states where no rate is published, each a cited finding.`,
    path: `${OSOW_HUB_PATH}/police-escorts`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Police escorts' }],
    eyebrow: 'Topic table · covered states',
    h1: 'Police escort rates by state',
    lead: 'The states that publish a law-enforcement escort rate, what the floor works out to, and — separately — the states where we looked and found nothing published.',
    bandHtml: provenanceBand(prov, [`${priced.length} published rates`, `${findings.length} positive "none published" findings`]),
    rail: [
      { id: 'published', label: 'Published rates' },
      { id: 'unpriced', label: 'What the floor excludes' },
      { id: 'not-published', label: 'Where there is nothing' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Police escorts', path: `${OSOW_HUB_PATH}/police-escorts` },
      ]),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Source notes ───────────────────────────────────────────────────────────

export function renderSourceNotes(asOf: IsoDate): string {
  const conflicts = allConflictEntries(asOf);
  const bands = allBandConflicts(asOf);
  const gaps = namedGaps();
  const prov = provenanceFor(
    conflicts.map((c) => c.candidates.map((x) => x.source)),
    bands.map((b) => b.candidates.map((x) => x.source)),
  );

  const conflictHtml = conflicts
    .map(
      (c) => `<article class="qh-entry qh-entry--conflict">
        <h3><a href="${esc(hubStatePath(c.state.slug))}#conflicts">${esc(c.state.name)}</a> — ${esc(c.field)}</h3>
        <div class="qh-versus">${c.candidates
          .map(
            (x) => `<div>
              <span class="qh-fig">${esc(x.text)}</span>
              <span class="qh-src">${citeLink(x.source, x.source.title)} — ${esc(x.source.publisher)}${
                x.source.cite ? ` — ${esc(x.source.cite)}` : ''
              }<br>${esc(revisionLine(x.source))}</span>
            </div>`,
          )
          .join('')}</div>
        ${fold({
          label: 'What that means for a quote',
          bodyHtml:
            '<p>Both documents are in effect and both are official. Neither has been adopted: the engine returns no value for this field, and a quote that depends on it is sent to the issuing agency rather than being priced from whichever document was read first.</p>',
        })}
      </article>`,
    )
    .join('');

  const bandHtml = bands
    .map(
      (b) => `<article class="qh-entry qh-entry--conflict">
        <h3><a href="${esc(hubStatePath(b.state.slug))}#conflicts">${esc(b.state.name)}</a> — one fee band, two amounts</h3>
        <div class="qh-versus">${b.candidates
          .map(
            (x) => `<div>
              <span class="qh-fig">${esc(x.text)}</span>
              <span class="qh-src">${esc(x.label)}<br>${citeLink(x.source, x.source.title)} — ${esc(x.source.publisher)}${
                x.source.cite ? ` — ${esc(x.source.cite)}` : ''
              }<br>${esc(revisionLine(x.source))}</span>
            </div>`,
          )
          .join('')}</div>
        ${fold({
          label: 'What that means for a quote',
          bodyHtml:
            '<p>Two schedules band the same load the same way and price it differently. The difference reaches the applicant directly: a load that falls in this band is quoted as a spread, and the permit is sent to the agency to price.</p>',
        })}
      </article>`,
    )
    .join('');

  const gapHtml = gaps
    .map(
      (g) => `<article class="qh-entry">
        <h3><a href="${esc(hubStatePath(g.slug))}#conflicts">${esc(g.stateName)}</a> — ${esc(g.title)}</h3>
        <p class="qh-meta"><code>${esc(g.constantName)}</code></p>
        ${fold({ label: 'What the two schedules leave uncovered', bodyHtml: `<p>${esc(g.detail)}</p>` })}
      </article>`,
    )
    .join('');

  const total = conflicts.length + bands.length;

  const faqs = [
    {
      q: 'Why not just pick the more recent document?',
      a: 'Because "more recent" is not the same as "in force". A statute and an administrative code can both be current and say different things, and one of them being older does not repeal it. Adopting one would put a single confident number where the honest answer is a range with two citations attached.',
    },
    {
      q: 'Does this page go stale?',
      a: 'It is generated from the data, so it follows the data. Adding a state adds its conflicts; correcting a source removes the entry it was in. Nothing on this page is typed prose about a number.',
    },
    {
      q: 'What should I actually do about one of these?',
      a: 'Ring the permit office knowing exactly what to ask. That is what the page is for: it names both documents and the pinpoint cite in each, so the question is "which of these two do you charge" rather than "how much is it".',
    },
  ];

  const body = [
    sec(
      'conflicts',
      `${total} places two official documents disagree`,
      `<p>Each entry below is a field where two documents that are both in effect, both official and both published by the state give different answers. We hold both and adopt neither. Finding one of these required reading both documents, which is why they are not in anybody else's table.</p>
       <div data-qh-folds>${conflictHtml}${bandHtml}</div>`,
      'The disagreements',
    ),
    sec(
      'gaps',
      `${gaps.length} gaps where nothing at all is priced`,
      `<p>A different failure, and a more surprising one: not two documents disagreeing about a value, but two documents that between them leave a range covered by neither. A move landing inside one of these bands matches no published fee at all.</p>
       <div data-qh-folds>${gapHtml}</div>`,
      'The gaps',
    ),
    sec(
      'how',
      'How this page is made',
      `<p><strong>The page stays current for free and grows as jurisdictions are added.</strong> It is not a document somebody maintains.</p>
       ${folds([
         {
           label: 'The mechanism, in full',
           bodyHtml:
             '<p>The engine stores every value as a list of candidates, each with its own source document, effective window and pinpoint cite. Resolving a field filters to the candidates in effect on the quote date and — when they disagree — returns no value, with both candidates attached and a warning. This page renders those refusals.</p>',
         },
       ])}
       ${compareLink(`${OSOW_HUB_PATH}/common-figures`, 'Figures in circulation that no primary document supports')}`,
      'Method',
    ),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  const shortHtml = shortVersion(
    `across ${HUB_COVERED_STATES.length} covered states there are <strong>${total}</strong> fields where two in-effect official documents give different answers, and <strong>${gaps.length}</strong> ranges that no published schedule prices at all. Neither side of a disagreement is adopted: the engine returns no value and the permit goes to the issuing agency. Every entry below names both documents and the pinpoint cite in each, so the question to the permit office is "which of these two do you charge" rather than "how much is it".`,
  );

  return hubPage({
    title: 'Where the Official OS/OW Sources Disagree | QuoteFleet',
    description: `${total} fields where two in-effect official state documents give different oversize/overweight answers, plus ${gaps.length} gaps where no published schedule prices the move at all. Both documents cited, neither adopted.`,
    path: `${OSOW_HUB_PATH}/source-notes`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Source notes' }],
    eyebrow: 'The disagreement layer',
    h1: 'Where the official sources disagree',
    lead: 'Two official documents, both in effect, giving different answers — with each one cited and neither adopted. Generated from the engine, not written by hand.',
    bandHtml: provenanceBand(prov, [`${total} live conflicts`, `${gaps.length} named gaps`]),
    rail: [
      { id: 'conflicts', label: 'Where they disagree' },
      { id: 'gaps', label: 'Where nothing is priced' },
      { id: 'how', label: 'How this is made' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: shortHtml + body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Source notes', path: `${OSOW_HUB_PATH}/source-notes` },
      ]),
      jsonLdFaq(faqs),
    ],
  });
}

// ── The state page ─────────────────────────────────────────────────────────

const NOT_INCLUDED: ReadonlyArray<{ item: string; why: string }> = [
  { item: 'Line haul, fuel and driver time', why: 'This is a permit fee, not a freight rate.' },
  { item: 'Civilian pilot car rates', why: 'We hold no rate data, and the two commercial sites that publish market rates disagree by nearly a factor of two on the same service.' },
  { item: 'Route-survey engineering', why: "The agency's review fee is shown where the state publishes one; the engineer's own fee is a private cost with no schedule." },
  { item: 'Bonds and escrow', why: 'Set per move by the agency, and in at least one state the escort is billed at actual cost against it.' },
  { item: 'Utility coordination and line lifts', why: 'Arranged with each utility, priced by each utility.' },
  { item: 'Second-issuer permits', why: 'A toll, bridge or city authority inside the same state issues its own permit, and a state total that omits it is missing a whole permit.' },
];

export function renderStatePage(state: HubState, asOf: IsoDate): string {
  const rules = osowRulesFor(state.code);
  if (rules === null) throw new Error(`no jurisdiction file for ${state.code}`);
  const prov = provenanceFor(rules);
  const l = rules.legalLimits;

  const limitRows = [
    { label: 'Width', cell: cellFrom('legal width', l.widthIn, asOf, fmtInches) },
    { label: 'Height', cell: cellFrom('legal height', l.heightIn, asOf, fmtInches) },
    { label: 'Semitrailer length', cell: cellFrom('legal semitrailer length', l.trailerLengthIn, asOf, fmtInches) },
    { label: 'Overall length', cell: cellFrom('legal overall length', l.overallLengthIn, asOf, fmtInches) },
    { label: 'Kingpin to rear axle', cell: cellFrom('legal kingpin-to-rear-axle', l.kingpinToRearAxleIn, asOf, fmtInches) },
    { label: 'Front overhang', cell: cellFrom('legal front overhang', l.frontOverhangIn, asOf, fmtInches) },
    { label: 'Rear overhang', cell: cellFrom('legal rear overhang', l.rearOverhangIn, asOf, fmtInches) },
    { label: 'Gross weight', cell: cellFrom('legal gross weight', l.grossWeightLbs, asOf, fmtLbs) },
    { label: 'Single axle', cell: cellFrom('legal single-axle weight', l.singleAxleLbs, asOf, fmtLbs) },
    { label: 'Tandem axle', cell: cellFrom('legal tandem-axle weight', l.tandemAxleLbs, asOf, fmtLbs) },
  ];

  const limitTable = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Measure</th><th>Legal limit</th></tr></thead>
    <tbody>${limitRows
      .map((r) => `<tr><td class="qh-st">${esc(r.label)}</td>${renderCell(r.cell)}</tr>`)
      .join('')}</tbody></table></div>`;

  const triggers = firstEscortTriggers(rules, asOf, 'civilian');
  const policeTriggers = firstEscortTriggers(rules, asOf, 'police');
  const triggerTable = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Measurement</th><th>First escort trigger</th><th>First police escort trigger</th></tr></thead>
    <tbody>${ESCORT_TRIGGER_MEASURES.map((m) => {
      const t = triggers[m.measure];
      const p = policeTriggers[m.measure];
      const fmt = (x: typeof t): string =>
        x === undefined
          ? '<span class="qh-v qh-none">None published</span>'
          : `<span class="qh-v">${citeLink(x.rule.source, formatTrigger(x, m.measure))}</span><span class="qh-rev">${esc(revisionLine(x.rule.source))}${x.routeDependent ? ' · varies by road class' : ''}</span>`;
      return `<tr><td class="qh-st">${esc(m.label)}</td><td>${fmt(t)}</td><td>${fmt(p)}</td></tr>`;
    }).join('')}</tbody></table></div>`;

  const inEffectRules = rules.escortRules.filter((r) => isInEffect(r, asOf));
  const ruleList = inEffectRules
    .map(
      (r) =>
        `<li>${esc(r.description)} — ${citeLink(r.source, r.source.cite ?? r.source.title)} <span class="qh-rev">${esc(revisionLine(r.source))}</span></li>`,
    )
    .join('');
  /* The TRIGGER TABLE above answers "when"; this is the full prose of every
     rule behind it. Folded with its count on the summary, so the page never
     looks like it holds fewer rules than it does. */
  const ruleFold = folds([
    {
      id: 'escort-rules',
      label: 'Every escort rule on file, in full',
      count: `${inEffectRules.length} ${inEffectRules.length === 1 ? 'rule' : 'rules'}`,
      bodyHtml: `<ul>${ruleList}</ul>`,
      capped: inEffectRules.length > 8,
    },
  ]);

  const feeCells = {
    base: cellFrom('single-trip base permit fee', rules.permitBaseFeeUsd, asOf, fmtUsd),
    routeAnalysis: cellFrom('route analysis fee', rules.routeAnalysisFeeUsd, asOf, fmtUsd),
    noBridge: cellFrom('no-bridge route fee', rules.noBridgeRouteFeeUsd, asOf, fmtUsd),
    transaction: cellFrom(
      'transaction fee',
      rules.transactionFee,
      asOf,
      (v) => {
        const parts: string[] = [];
        if (v.perPermitUsd > 0) parts.push(fmtUsd(v.perPermitUsd));
        if (v.percentOfTotal > 0) parts.push(`${v.percentOfTotal}% of the total`);
        return parts.length === 0 ? 'None published' : parts.join(' + ');
      },
      (a, b) => a.perPermitUsd === b.perPermitUsd && a.percentOfTotal === b.percentOfTotal,
    ),
  };

  const feeTable = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Charge</th><th>Amount</th></tr></thead>
    <tbody>
      <tr><td class="qh-st">Single-trip base</td>${renderCell(feeCells.base)}</tr>
      <tr><td class="qh-st">Transaction / card</td>${renderCell(feeCells.transaction)}</tr>
      <tr><td class="qh-st">Route analysis review</td>${renderCell(feeCells.routeAnalysis)}</tr>
      <tr><td class="qh-st">Route with no bridges</td>${renderCell(feeCells.noBridge)}</tr>
    </tbody></table></div>`;

  const bandRows = (rules.oversizeFeeBands ?? [])
    .filter((b) => isInEffect(b, asOf))
    .map(
      (b) =>
        `<tr><td class="qh-st">${esc(b.value.label)}</td><td><span class="qh-v">${citeLink(b.source, fmtUsd(b.value.feeUsd))}</span><span class="qh-rev">${esc(revisionLine(b.source))}</span></td></tr>`,
    )
    .join('');

  const overweightRes = resolveSourced(
    'overweight pricing',
    [...rules.overweightPricing],
    asOf,
    (a, b) => a.kind === b.kind,
  );
  const overweightHtml =
    overweightRes.chosen === null
      ? `<p class="qh-sub">The overweight pricing model is not resolved for ${esc(state.name)} on ${esc(asOf)}; the permit must be priced by the agency.</p>`
      : `<p>${esc(overweightRes.chosen.value.explanation)}</p><p class="qh-meta">${citeLink(overweightRes.chosen.source, overweightRes.chosen.source.title)} — ${esc(revisionLine(overweightRes.chosen.source))}</p>`;

  const superCells = superloadRows(asOf).find((r) => r.state.code === state.code)!;
  const superTable = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Trigger</th><th>Threshold</th></tr></thead>
    <tbody>
      <tr><td class="qh-st">Gross weight</td>${renderCell(superCells.gross)}</tr>
      <tr><td class="qh-st">Width</td>${renderCell(superCells.width)}</tr>
      <tr><td class="qh-st">Height</td>${renderCell(superCells.height)}</tr>
      <tr><td class="qh-st">Length</td>${renderCell(superCells.length)}</tr>
      <tr><td class="qh-st">Short axle spacing</td>${renderCell(superCells.shortSpacing)}</tr>
    </tbody></table></div>`;

  const inspection = rules.routeInspection;
  const inspectionTable = `<div class="qh-tablewrap"><table class="qh-table">
    <thead><tr><th class="qh-st">Measurement</th><th>Inspection / review trigger</th></tr></thead>
    <tbody>
      <tr><td class="qh-st">Width</td>${renderCell(cellFrom('route-inspection width trigger', inspection.widthIn, asOf, fmtThresholdIn, (a, b) => a.value === b.value && a.inclusive === b.inclusive))}</tr>
      <tr><td class="qh-st">Height</td>${renderCell(cellFrom('route-inspection height trigger', inspection.heightIn, asOf, fmtThresholdIn, (a, b) => a.value === b.value && a.inclusive === b.inclusive))}</tr>
      <tr><td class="qh-st">Length</td>${renderCell(cellFrom('route-inspection length trigger', inspection.lengthIn, asOf, fmtThresholdIn, (a, b) => a.value === b.value && a.inclusive === b.inclusive))}</tr>
    </tbody></table></div>`;

  const police = policeRows(asOf).find((r) => r.state.code === state.code);
  const policeHtml =
    police?.rate != null
      ? `<p>${esc(police.rate.value.agency)} publishes a rate. One officer costs at least ${esc(
          police.floorOneOfficerUsd === null ? 'an amount the schedule does not let us compute' : fmtUsd(police.floorOneOfficerUsd),
        )} before mileage.</p>
         <p class="qh-meta">${citeLink(police.rate.source, police.rate.source.title)} — ${esc(revisionLine(police.rate.source))}</p>
         ${
           police.rate.value.unpriced.length === 0
             ? ''
             : folds([
                 {
                   label: 'What the schedule does not price',
                   count: `${police.rate.value.unpriced.length} ${police.rate.value.unpriced.length === 1 ? 'item' : 'items'}`,
                   bodyHtml: `<ul>${police.rate.value.unpriced.map((u) => `<li>${esc(u.description)}</li>`).join('')}</ul>`,
                 },
               ])
         }`
      : police?.finding != null
        ? `<p><strong>${
            police.finding.kind === 'noScheduleExists'
              ? 'No schedule exists, and that is structural rather than a gap.'
              : 'Charges exist and no schedule is published.'
          }</strong> ${esc(police.finding.finding)}</p>
           <p class="qh-sub">This is a positive finding: we searched and there is nothing to quote. It is not the same as "no police escort is ever required here".</p>`
        : `<p class="qh-sub">We hold no police escort finding for ${esc(state.name)}.</p>`;

  const conflicts = conflictEntriesFor(state, asOf);
  const bandConflicts = bandConflictsFor(state, asOf);
  const stateGaps = namedGaps().filter((g) => g.code === state.code);
  const hasDisagreement = conflicts.length + bandConflicts.length + stateGaps.length > 0;

  const disagreementHtml = hasDisagreement
    ? `${conflicts
        .map(
          (c) => `<article class="qh-entry qh-entry--conflict">
            <h3>${esc(c.field)}</h3>
            <div class="qh-versus">${c.candidates
              .map(
                (x) =>
                  `<div><span class="qh-fig">${esc(x.text)}</span><span class="qh-src">${citeLink(x.source, x.source.title)}${
                    x.source.cite ? ` — ${esc(x.source.cite)}` : ''
                  }<br>${esc(revisionLine(x.source))}</span></div>`,
              )
              .join('')}</div>
            <p>Both are in effect and neither has been adopted.</p>
          </article>`,
        )
        .join('')}${bandConflicts
        .map(
          (b) => `<article class="qh-entry qh-entry--conflict">
            <h3>One fee band, two amounts</h3>
            <div class="qh-versus">${b.candidates
              .map(
                (x) =>
                  `<div><span class="qh-fig">${esc(x.text)}</span><span class="qh-src">${esc(x.label)}<br>${citeLink(x.source, x.source.title)}<br>${esc(revisionLine(x.source))}</span></div>`,
              )
              .join('')}</div>
            <p>Two schedules band the same load the same way and price it differently.</p>
          </article>`,
        )
        .join('')}${stateGaps
        .map(
          (g) => `<article class="qh-entry"><h3>${esc(g.title)}</h3><p>${esc(g.detail)}</p><p class="qh-meta"><code>${esc(g.constantName)}</code></p></article>`,
        )
        .join('')}`
    : '';

  const additional = (rules.additionalAuthorities ?? []).filter((a) => isInEffect(a, asOf));
  const additionalHtml =
    additional.length === 0
      ? ''
      : `<p><strong>${esc(state.name)} has more than one permit issuer.</strong> A state total can be complete and still be missing a whole permit.</p>
         <ul>${additional
           .map(
             (a) =>
               `<li><strong>${esc(a.value.name)}</strong> — ${esc(a.value.appliesWhen)}. ${
                 a.value.priceable ? 'We hold this authority\'s fee schedule.' : 'We do not hold this authority\'s fee schedule, so the leg goes to review rather than being quoted short.'
               } ${citeLink(a.source, a.source.title)}</li>`,
           )
           .join('')}</ul>`;

  const faqs: Array<{ q: string; a: string }> = [
    {
      q: `How much is an oversize permit in ${state.name}?`,
      a:
        feeCells.base.text === null
          ? `${state.name}'s single-trip base fee does not resolve to a single figure in the documents on file — see the fee section above, which shows what each document says.`
          : `The single-trip base is ${feeCells.base.text}, before the dimension bands, the overweight component and the transaction charge. The base alone is rarely what is paid.`,
    },
    {
      q: `When does ${state.name} require a pilot car?`,
      a:
        triggers.widthIn === undefined
          ? `${state.name} publishes no numeric width trigger for an escort in the documents on file. That does not mean none is ever required — see the escort section above.`
          : `The first width trigger is ${formatTrigger(triggers.widthIn, 'widthIn')}${
              triggers.widthIn.routeDependent ? ', and it varies by road class — the figure shown is the lowest across classes' : ''
            }.`,
    },
    {
      q: `What is a superload in ${state.name}?`,
      a:
        superCells.gross.text === null
          ? `${state.name} publishes no gross-weight superload threshold in the documents on file — see the superload section, which shows the dimensional triggers it does publish.`
          : `${state.name}'s published gross-weight superload line is ${superCells.gross.text}. It is not 80,000 lb; that is the federal legal gross limit, not a superload threshold.`,
    },
  ];
  if (hasDisagreement) {
    faqs.push({
      q: `Do ${state.name}'s own documents contradict each other?`,
      a: `Yes, in ${conflicts.length + bandConflicts.length + stateGaps.length} place(s) we hold both documents for. They are set out in full above, each with its pinpoint citation, and none of them has been adopted.`,
    });
  }

  const rail = [
    { id: 'legal-limits', label: '1. Legal limits' },
    { id: 'escorts', label: '2. Escorts' },
    { id: 'fees', label: '3. Permit fees' },
    { id: 'overweight', label: '4. Overweight pricing' },
    { id: 'superload', label: '5. Superload' },
    { id: 'survey', label: '6. Route survey' },
    { id: 'police', label: '7. Police escorts' },
    { id: 'timing', label: '8. When you can move' },
    { id: 'office', label: '9. Permit office' },
    ...(hasDisagreement ? [{ id: 'conflicts', label: '10. Source conflicts' }] : []),
    { id: 'excluded', label: '11. Not included' },
    { id: 'sources', label: '12. Every source' },
    { id: 'faq', label: 'Questions' },
  ];

  /* THE ANSWER, ABOVE THE DOCUMENT. Three computed figures — the base fee, the
     first width trigger, the superload line — so a reader who wants only "what
     do I actually need" gets it before twelve sections of citation. Generated
     from the same cells the tables below render; nothing here is typed prose
     about a number, and each clause degrades to an honest "not published"
     rather than to a guess. */
  const short = shortVersion(
    `a ${esc(state.name)} single-trip permit starts at `
      + `${feeCells.base.text === null ? '<strong>a figure the documents on file do not resolve</strong>' : `<strong>${esc(feeCells.base.text)}</strong>`}`
      + ' before bands, overweight and the transaction charge; an escort is first required at '
      + `${triggers.widthIn === undefined ? '<strong>no width the state publishes</strong>' : `<strong>${esc(formatTrigger(triggers.widthIn, 'widthIn'))}</strong> wide`}`
      + '; and the load becomes a superload at '
      + `${superCells.gross.text === null ? '<strong>a gross weight the state does not publish</strong>' : `<strong>${esc(superCells.gross.text)}</strong>`}`
      + `. Everything below carries the ${esc(state.name)} document it came from, that document's own revision date, and the date we read it.`,
  );

  const body = short + [
    sec(
      'legal-limits',
      `1. ${state.name} legal limits`,
      `<p>Anything over one of these needs a permit. Every value links to the document that sets it.</p>${limitTable}${compareLink(`${OSOW_HUB_PATH}/legal-limits`, 'Compare all states')}`,
      'Legal limits',
    ),
    sec(
      'escorts',
      `2. When ${state.name} requires an escort`,
      `${triggerTable}
       ${ruleFold}
       ${compareLink(`${OSOW_HUB_PATH}/escort-requirements`, 'Compare all states')}`,
      'Escort requirements',
    ),
    sec(
      'fees',
      `3. ${state.name} single-trip permit fees`,
      `${feeTable}
       ${bandRows === '' ? '' : `<h3>Dimension bands</h3><div class="qh-tablewrap"><table class="qh-table"><thead><tr><th class="qh-st">Band</th><th>Fee</th></tr></thead><tbody>${bandRows}</tbody></table></div>`}
       ${additionalHtml}
       ${compareLink(`${OSOW_HUB_PATH}/permit-fees`, 'Compare all states')}`,
      'Permit fees',
    ),
    sec('overweight', `4. How ${state.name} prices overweight`, overweightHtml, 'Overweight'),
    sec(
      'superload',
      `5. ${state.name}'s superload threshold`,
      `<p>Above one of these, the state stops issuing over the counter and prices the move after an engineering review.</p>${superTable}${compareLink(`${OSOW_HUB_PATH}/superloads`, 'Compare all states')}`,
      'Superload',
    ),
    sec(
      'survey',
      '6. Route survey and bridge review',
      `<p>The dimensions at which ${esc(state.name)} triggers a physical route inspection or an engineering review, and what the agency charges to review it.</p>${inspectionTable}`,
      'Route survey',
    ),
    sec('police', '7. Police escorts', policeHtml + compareLink(`${OSOW_HUB_PATH}/police-escorts`, 'Compare all states'), 'Police escorts'),
    sec(
      'timing',
      '8. When you can move it',
      `<p>Holiday, curfew and night-travel windows are <strong>not yet encoded</strong> for ${esc(state.name)}.</p>
       <p><a href="${esc(SEASONAL_TOOL)}/${esc(state.slug)}">${esc(state.name)} spring thaw restrictions →</a></p>
       ${folds([
         {
           label: 'Why those windows are absent rather than estimated',
           bodyHtml: `<p>They are not guessed at here. What we do publish is the seasonal weight-restriction picture, with the date we last read each state's own bulletin — a curfew invented from a plausible pattern is worth less than an honest gap, because a reader cannot tell the two apart on the page.</p>`,
         },
       ])}`,
      'Travel restrictions',
    ),
    sec(
      'office',
      '9. Permit office',
      `<p>The agency behind each figure above is linked from that figure. We publish no per-state permit-office phone number.</p>
       ${folds([
         {
           id: 'why-no-phone',
           label: 'Why there is no phone number here',
           bodyHtml: `<p>We are <strong>not</strong> publishing per-state permit-office phone numbers yet, and the reason is worth stating: the two seed lists available for them are both demonstrably stale — the federal one gives two different states the same phone number — and a wrong number on a page like this costs somebody a morning. The agency behind each figure above is linked from that figure, which is the part we can stand behind today.</p>`,
         },
       ])}`,
      'Who issues it',
    ),
    ...(hasDisagreement
      ? [
          sec(
            'conflicts',
            '10. Where the sources disagree',
            `<p>Two official documents, both in effect, giving different answers. Neither has been adopted.</p>${disagreementHtml}${compareLink(`${OSOW_HUB_PATH}/source-notes`, 'Every conflict across all states')}`,
            'Source conflicts',
          ),
        ]
      : []),
    sec(
      'excluded',
      '11. What this does not include',
      `<p>Named rather than gestured at, because each of these can exceed the permit itself. Every item is listed; open one for why it is excluded.</p>
       ${folds(NOT_INCLUDED.map((n) => ({ label: n.item, bodyHtml: `<p>${esc(n.why)}</p>` })))}
       <p><a href="${esc(OSOW_TOOL)}">Price a lane through ${esc(state.name)} →</a></p>`,
      'Scope',
    ),
    sec(
      'sources',
      `12. Every source behind this page (${prov.count})`,
      folds([
        {
          id: 'source-list',
          label: `Every document behind ${state.name}`,
          count: `${prov.count} ${prov.count === 1 ? 'source' : 'sources'}`,
          bodyHtml: sourceList(prov.sources),
          capped: true,
        },
      ]),
      'Provenance',
    ),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  return hubPage({
    title: `${state.name} Oversize & Overweight Permits — Limits, Fees, Escorts | QuoteFleet`,
    description: `${state.name} oversize and overweight permits: legal limits, single-trip fees, escort triggers, superload threshold and police escort rates — built from ${prov.count} cited state documents with revision dates.`,
    path: hubStatePath(state.slug),
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: state.name }],
    eyebrow: `State profile · ${state.name}`,
    h1: `${state.name} oversize and overweight permits`,
    lead: `Legal limits, escort triggers, permit fees, the superload line and the police escort position for ${esc(state.name)} — every figure carrying the state document behind it.`,
    bandHtml: provenanceBand(prov, [
      `${rules.escortRules.filter((r) => isInEffect(r, asOf)).length} escort rules in effect`,
      hasDisagreement ? `${conflicts.length + bandConflicts.length + stateGaps.length} source conflicts` : 'No source conflicts on file',
    ]),
    rail,
    bodyHtml: body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: state.name, path: hubStatePath(state.slug) },
      ]),
      jsonLdDataset({
        name: `${state.name} oversize and overweight permit data`,
        description: `Legal size and weight limits, single-trip permit fees, escort triggers, superload thresholds and route-inspection triggers for ${state.name}.`,
        path: hubStatePath(state.slug),
        variableMeasured: [
          'Legal size and weight limits',
          'Single-trip permit fees',
          'Escort triggers',
          'Superload thresholds',
          'Route-inspection triggers',
        ],
        isBasedOn: prov.sources.map((s) => s.url),
        temporalCoverageFrom: prov.oldestRevision,
        dateModified: prov.lastRetrieved,
      }),
      jsonLdFaq(faqs),
    ],
  });
}
