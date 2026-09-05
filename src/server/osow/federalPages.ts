/**
 * THE FEDERAL PAGES, AND THE CORRECTIONS PAGE.
 *
 * ── WHY THE FEDERAL PAGES CAN QUOTE VERBATIM ──────────────────────────────
 * Works of the United States Government are not subject to copyright (17
 * U.S.C. §105). FHWA's size-and-weight compilation, its bridge-formula
 * brochure and the Code of Federal Regulations are therefore quotable in full,
 * and quoting them beats paraphrasing them: the operative federal definition of
 * a non-divisible load is a test with a number in it, and any rewording of "more
 * than 8 work hours to dismantle" makes it weaker. Every quote below carries the
 * document AND its date, because a federal document being public domain does
 * not make it current.
 *
 * ── WHY THE CORRECTIONS PAGE NAMES NOBODY ─────────────────────────────────
 * The claim on `/oversize/common-figures` is "here is what the statute says",
 * never "site X is wrong". That is a deliberate constraint and it is the
 * stronger position on all three axes that matter: it is more defensible, it is
 * more useful to a reader who arrived with the wrong number from anywhere at
 * all, and it does not pass equity to a competitor or convert a factual page
 * into a dispute. Impersonal constructions throughout — "a figure of $36
 * circulates", never an attribution.
 *
 * Two further rules the page holds itself to. **Every entry carries our own
 * retrieval date**, so the page is falsifiable against us too — that symmetry
 * is what makes it read as reference rather than as attack. And **the mechanism
 * is published, not just the number**: a state that CPI-adjusts its permit fee
 * on a fixed cycle will not match any figure copied last year, so printing a
 * bare corrected figure would repeat the exact mistake being corrected.
 *
 * ── AND WHERE A "CORRECTION" IS REALLY A CONFLICT ─────────────────────────
 * If two official documents disagree, it belongs on `/oversize/source-notes`,
 * not here. Getting that classification right is the difference between
 * authority and embarrassment: one state's administrative code printing $8
 * where its own statute prints $10 LOOKS like an error and is actually a live,
 * unresolved disagreement between two current documents. This page links there
 * rather than adjudicating it.
 */
import type { IsoDate } from '../../calc/osow/provenance.js';
import {
  FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
  FEDERAL_SINGLE_AXLE_LIMIT_LBS,
  FEDERAL_TANDEM_AXLE_LIMIT_LBS,
  FHWA_TABLE_ERRATA,
  TANDEM_MAX_SPACING_FT,
  TANDEM_PAIR_EXCEPTION_SPAN_FT,
  TANDEM_PAIR_EXCEPTION_WEIGHT_LBS,
  bridgeFormulaRawLbs,
  groupMaxWeightLbs,
} from '../../calc/osow/bridgeFormula.js';
import {
  HUB_STATES,
  OSOW_HUB_PATH,
  bandConflictsFor,
  fmtLbs,
  hubStatePath,
  legalLimitRows,
  permitFeeRows,
  provenanceFor,
  superloadRows,
} from './hubData.js';
import type { HubCell } from './hubData.js';
import {
  citeLink,
  esc,
  fold,
  folds,
  microLabel,
  shortVersion,
  hubPage,
  jsonLdBreadcrumb,
  jsonLdDataset,
  jsonLdFaq,
  provenanceBand,
  revisionLine,
} from './hubShell.js';

export const BRIDGE_TOOL_PATH = '/tools/bridge-formula';
export const AXLE_TOOL_PATH = '/tools/axle-weights';

/**
 * A section, with a MONO MICRO-LABEL as its eyebrow.
 *
 * The label falls back to the section's own id ("compliance-clause" →
 * "COMPLIANCE CLAUSE") rather than being typed twice: every section here
 * already carries a semantic id because it is a rail anchor, so the eyebrow is
 * free and can never drift out of step with the link that points at it. Pass
 * `eyebrow` only where the id would read badly. Top-left of the heading block,
 * per the house rule — never centred, never inline with the H2.
 */
function sec(id: string, heading: string, inner: string, eyebrow?: string): string {
  const label = eyebrow ?? id.replace(/-/g, ' ');
  return `<section class="qh-sec" id="${esc(id)}">${microLabel(label)}<h2>${esc(heading)}</h2>${inner}</section>`;
}

/** ONE disclosure pattern per surface: the FAQ is the same compact fold. */
function faqBlock(faqs: Array<{ q: string; a: string }>): string {
  return `<div class="qh-faq" data-qh-folds>${faqs
    .map((f) => fold({ label: f.q, bodyHtml: `<p>${esc(f.a)}</p>` }))
    .join('')}</div>`;
}

/**
 * A VERBATIM FEDERAL QUOTE, FOLDED — but folded the right way round.
 *
 * The passages on these pages run 300–900 characters each and there are five of
 * them on `/oversize/federal-limits` alone, which is most of the page's height
 * before a reader has met a single one of our own sentences. Summary-first says
 * the CITATION is what must stay visible: a reader has to be able to see which
 * document is being relied on, and how old it is, without opening anything.
 * So the citation is the summary and the passage is what folds, with a mono
 * VERBATIM tag saying what is inside. Nothing leaves the DOM, so the quote is
 * still indexed and still findable with the browser's own find-in-page once
 * expanded.
 */
function quote(text: string, cite: string): string {
  return fold({
    label: cite,
    count: 'verbatim',
    bodyHtml: `<blockquote class="qh-quote"><p>${text}</p></blockquote>`,
    capped: true,
  }).replace('class="qh-fold"', 'class="qh-fold qh-fold--quote"');
}

/** A run of quotes, so the page can offer one expand-all over the lot. */
function quotes(...items: string[]): string {
  return `<div class="qh-folds" data-qh-folds>${items.join('')}</div>`;
}

// ── /oversize/federal-limits ───────────────────────────────────────────────

const COMPLIANCE_CLAUSE_STATES = [
  'Connecticut',
  'Hawaii',
  'Nebraska',
  'Nevada',
  'New Jersey',
  'New York',
  'Washington',
  'Wyoming',
];

export function renderFederalLimits(): string {
  const ours = COMPLIANCE_CLAUSE_STATES.filter((n) =>
    HUB_STATES.some((s) => s.name === n && s.covered),
  );

  const faqs = [
    {
      q: 'Do federal weight limits apply on every road?',
      a: 'No. The federal single-axle, tandem-axle and gross limits apply on the Interstate System. Off the Interstate, states set their own commercial vehicle weight standards, which is why a state statute can print a higher axle figure and both numbers can be correct.',
    },
    {
      q: 'Why is 102 inches the magic width?',
      a: 'Because on the National Network federal law makes it a floor and a ceiling at once: a state may not impose a width limit of more or less than 102 inches. Safety devices such as mirrors and handholds are excluded from the measurement.',
    },
    {
      q: 'Is there a federal height limit?',
      a: 'No federal vehicle height limit exists. State standards range from about 13 ft 6 in to 14 ft 6 in, which is why height is one of the columns that varies most across the state table.',
    },
    {
      q: 'What is a grandfather right?',
      a: 'An allowance for a state to keep weight limits that were lawful before the federal standards were adopted. Successive provisions in 1956, 1974 and 1991, plus other exceptions, leave 37 states and the District of Columbia with some allowance to exceed federal weight limits on their Interstate highways — in many cases a very limited one.',
    },
  ];

  const body = [
    sec(
      'weights',
      'Federal weight limits on the Interstate System',
      quotes(quote(
        `"Federal weight standards apply to commercial vehicle operations only on the Interstate Highway System, which consists of approximately 50,000 miles of limited access, divided highways that span the Nation. <strong>Off the Interstate Highway System, States may set their own commercial vehicle weight standards.</strong> Federal standards for commercial vehicle maximum weights on the Interstate Highway System are as follows: Single Axle – 20,000 lbs.; Tandem Axle – 34,000 lbs.; GVW – 80,000 lbs."`,
        'Compilation of Existing State Truck Size and Weight Limit Laws, Exhibit 2 — Federal Highway Administration, May 2015. Public domain (17 U.S.C. §105).',
      ) +
        quote(
          `"In addition to Bridge Formula weight limits, Federal law states that single axles are limited to 20,000 pounds, and <strong>axles spaced more than 40 inches and not more than 96 inches apart (tandem axles)</strong> are limited to 34,000 pounds. Gross vehicle weight is limited to 80,000 pounds (23 U.S.C. 127)."`,
          'Bridge Formula Weights, FHWA-HOP-19-028, p. 2 — Federal Highway Administration, August 2019. Public domain.',
        )) +
        `<p><strong>Note the 40-inch lower bound.</strong> A tandem is defined by a spacing range, not just a maximum — axles closer together than 40 inches are not a tandem under federal law. Our own engine captures the 96-inch (${TANDEM_MAX_SPACING_FT} ft) upper bound and does not yet model the lower one; that is a real edge, it is stated here rather than hidden, and it affects only unusually tight axle groups.</p>`,
    ),
    sec(
      'sizes',
      'Federal size limits on the National Network',
      quote(
        `<strong>Overall length:</strong> "No Federal length limit exists for most truck tractor-semitrailers operating on the NN. Exception: … vehicles designed and used specifically to carry automobiles or boats in specially designed racks may not exceed a maximum overall vehicle length of 65 feet, or 75 feet, depending on the type of connection…"<br><br>
         <strong>Trailer length:</strong> "no State may impose a length limit of less than 48 feet … on a semitrailer … Similarly … no State may impose a length limit of less than 28 feet on a semitrailer or trailer operating in a truck tractor-semitrailer-trailer (twin-trailer) combination."<br><br>
         <strong>Width:</strong> "On the NN, no State may impose a width limit of more than or less than 102 inches. Safety devices (e.g., mirrors, handholds) necessary for the safe and efficient operation of motor vehicles may not be included in the calculation of width."<br><br>
         <strong>Height:</strong> "No Federal vehicle height limit exists. State standards range from 13.6 feet to 14.6 feet."`,
        'Compilation of Existing State Truck Size and Weight Limit Laws, Exhibit 2 — FHWA, May 2015. Public domain.',
      ) +
        `<p>The width rule is the unusual one: it is a <strong>floor and a ceiling simultaneously</strong>. A state may not go under 102 inches and may not go over it either, which is why 102 inches is the same number in every state column on our <a href="${OSOW_HUB_PATH}/legal-limits">legal limits table</a> and height is the column that varies most.</p>`,
    ),
    sec(
      'grandfather',
      'Grandfather rights, and why a state statute can read higher',
      quote(
        `"There are three different grandfather clauses in Title 23 USC §127."<br><br>
         "When the Interstate System axle and gross weight limits were adopted in 1956, and amended in 1975, States were allowed to keep or 'grandfather' weight limits that were higher."<br><br>
         "When considered together, the successive grandfather provisions provided by Congress in 1956, 1974, and 1991 and other exceptions results in <strong>37 States and the District of Columbia</strong> having allowances to exceed Federal weight limits on their Interstate highways (in many States these exceptions are very limited)."<br><br>
         "For those States that have claimed general exceptions to Federal limits on Interstate highways (such as higher single or tandem axle limits); these higher limits <strong>also apply to non-Interstate elements of the NHS</strong>."`,
        'FHWA-HOP-19-028 (Aug 2019) and Compilation of Existing State Truck Size and Weight Limit Laws, pp. 15–16 — FHWA, May 2015. Public domain.',
      ),
    ),
    sec(
      'compliance-clause',
      'The compliance-clause trap — eight states, and we cover three of them',
      quote(
        `"the United States Secretary of Transportation shall <strong>withhold 50 percent of appropriated funds</strong> from a State that sets weight limits for Interstate travel that are higher or lower than the standard Federal limits for Interstate highways, with some exceptions" (23 U.S.C. §127[a]).<br><br>
         "Although most States explicitly establish two sets of weight limits, one for State highways and one for Interstate highways, others do not explicitly draw out separate limits for Interstates in statute. In at least eight such States (<strong>${COMPLIANCE_CLAUSE_STATES.join(', ')}</strong>), the weight limits given in statute are higher than the standard Federal limits for Interstate highways, but a Federal compliance clause is in place that implies that the standard Federal weight limits would apply to Interstate travel…"`,
        'Compilation of Existing State Truck Size and Weight Limit Laws, p. 17 — FHWA, May 2015. Public domain.',
      ) +
        `<p><strong>This is the single most actionable paragraph on the page, and it applies directly to our own data.</strong> ${
          ours.length === 0
            ? 'None of the eight is currently in our covered set.'
            : `${ours.length} of the eight are in our covered set — ${ours.join(', ')} — and their statutory axle figures read above the federal Interstate limits.`
        } A reader taking a state's statutory single-axle figure and applying it to an Interstate lane will misprice the move. Read the state statute for the state system, and ${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} / ${FEDERAL_TANDEM_AXLE_LIMIT_LBS.toLocaleString('en-US')} / ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb for the Interstate itself.</p>
         <p><a href="${OSOW_HUB_PATH}/legal-limits">See what each state's own statute says →</a></p>`,
    ),
    sec(
      'history',
      'How the numbers got where they are',
      quote(
        `"The first laws establishing limits on truck weight in the United States were enacted by several States in <strong>1913</strong>. By 1933, all States had established some laws… The Federal Government began regulating truck size and weight in <strong>1956</strong>… The first Federal truck size and weight regulations limited combination trucks to an overall gross vehicle weight of <strong>73,280 lbs.</strong>, limited single axle weights to <strong>18,000 lbs.</strong>, and restricted tandem axle weights to <strong>32,000 lbs.</strong> Trucks were limited to a width of 8 feet (96 inches)…"<br><br>
         "In <strong>1974</strong>, Congress passed a bill allowing States to increase weight limits … to a maximum of 80,000 lbs. GVW … 20,000 lbs. on a single axle and 34,000 lbs. on a tandem axle. The increase, however, <strong>was not a mandate</strong>… In <strong>1982</strong>, Congress passed the Surface Transportation Assistance Act (STAA), which imposed the Federal 80,000 lb. limit as a mandate across the entire Interstate Highway System."`,
        'Compilation of Existing State Truck Size and Weight Limit Laws, p. 4 — FHWA, May 2015. Public domain.',
      ) +
        `<p>The 1956 → 1974 → 1982 sequence is why grandfather rights exist at all: states that were already lawfully running heavier were not made to come down.</p>`,
    ),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  return hubPage({
    title: 'Federal Truck Size & Weight Limits — What Federal Law Actually Fixes | QuoteFleet',
    description:
      'The federal single-axle, tandem and gross limits on the Interstate System, the 102-inch width floor-and-ceiling on the National Network, grandfather rights, and the eight states whose statutory weights read higher than federal. Quoted verbatim from FHWA, with dates.',
    path: `${OSOW_HUB_PATH}/federal-limits`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Federal limits' }],
    eyebrow: 'Federal reference · public domain',
    h1: 'Federal size and weight limits',
    lead: 'What federal law fixes, what it leaves to the states, and the trap in between — quoted verbatim from the federal documents, each with its own date.',
    bandHtml: provenanceBand(
      {
        sources: [],
        count: 3,
        oldestRevision: '2015-05',
        newestRevision: '2019-08',
        lastRetrieved: '2026-09-03',
      },
      ['Public domain — 17 U.S.C. §105', 'Quoted, not paraphrased'],
    ),
    rail: [
      { id: 'weights', label: 'Weight limits' },
      { id: 'sizes', label: 'Size limits' },
      { id: 'grandfather', label: 'Grandfather rights' },
      { id: 'compliance-clause', label: 'The compliance clause' },
      { id: 'history', label: 'How we got here' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml:
      shortVersion(
        `federal weight limits — ${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb single axle, ${FEDERAL_TANDEM_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb tandem, ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb gross — bind on the <strong>Interstate System</strong> and nowhere else; off it, a state sets its own. Width on the National Network is fixed at <strong>102 inches</strong>, a floor and a ceiling at once. There is <strong>no federal height limit</strong>. And ${ours.length === 0 ? 'several states' : `${ours.length} of the states we cover`} print statutory weights <em>above</em> the federal figures because of grandfather rights or a compliance clause — which is the trap this page exists for. Every passage below is quoted verbatim from FHWA and folded behind its own citation.`,
      ) + body,
    dateModified: '2026-09-03',
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Federal limits', path: `${OSOW_HUB_PATH}/federal-limits` },
      ]),
      jsonLdFaq(faqs),
    ],
  });
}

// ── /oversize/bridge-formula ───────────────────────────────────────────────

const TABLE_MIN_SPAN_FT = 4;
const TABLE_MAX_SPAN_FT = 60;
const TABLE_AXLE_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9];
/** Reproducing the PUBLISHED table means no vehicle-gross cap is in play. */
const NO_GROSS_CAP = Number.MAX_SAFE_INTEGER;

export function bridgeTableRows(): Array<{ spanFt: number; cells: Array<number | null> }> {
  const out: Array<{ spanFt: number; cells: Array<number | null> }> = [];
  for (let l = TABLE_MIN_SPAN_FT; l <= TABLE_MAX_SPAN_FT; l += 1) {
    const cells = TABLE_AXLE_COUNTS.map((n) => {
      // A group of N axles cannot be shorter than roughly (N−1) × 4 ft in any
      // real geometry, and FHWA prints no cell there either. Rendering one
      // would put a number on a rig that cannot exist.
      if (l < (n - 1) * 4) return null;
      return groupMaxWeightLbs(l, n, NO_GROSS_CAP);
    });
    out.push({ spanFt: l, cells });
  }
  return out;
}

export function renderBridgeFormulaExplainer(): string {
  const rows = bridgeTableRows();
  const tableRows = rows
    .map(
      (r) =>
        `<tr><td class="qh-st">${r.spanFt} ft</td>${r.cells
          .map((c) =>
            c === null
              ? '<td><span class="qh-v qh-none">—</span></td>'
              : `<td><span class="qh-v">${c.toLocaleString('en-US')}</span></td>`,
          )
          .join('')}</tr>`,
    )
    .join('');

  const errataRows = FHWA_TABLE_ERRATA.map(
    (e) =>
      `<tr><td class="qh-st">${e.spanFt} ft, ${e.axleCount} axles</td><td><span class="qh-v">${bridgeFormulaRawLbs(
        e.spanFt,
        e.axleCount,
      ).toLocaleString('en-US')}</span></td><td><span class="qh-v">${e.ourLbs.toLocaleString('en-US')}</span></td><td><span class="qh-v">${e.publishedLbs.toLocaleString('en-US')}</span></td></tr>`,
  ).join('');

  const faqs = [
    {
      q: 'Which axle groups does the bridge formula apply to?',
      a: 'Every group of two or more consecutive axles — all N(N−1)/2 of them. A five-axle tractor-semitrailer has ten such groups. The classic failure is a rig whose steer, drives and trailer tandems each pass while an interior group spanning axles two through five does not; checking only the obvious three misses exactly the group a bridge cares about.',
    },
    {
      q: 'How is the result rounded?',
      a: 'To the nearest 500 pounds, with exact ties going DOWN. The statute says "to the nearest 500 pounds", and every exact tie in the published table rounds down — a raw 42,750 prints as 42,500. Ordinary rounding, which sends halves up, would permit 500 lb that the law does not.',
    },
    {
      q: 'Why is a five-axle van with 34,000 lb on each tandem legal?',
      a: `Because of a statutory carve-out: two consecutive sets of tandem axles may each carry ${TANDEM_PAIR_EXCEPTION_WEIGHT_LBS.toLocaleString('en-US')} lb between them provided the outer axles of the two tandems are at least ${TANDEM_PAIR_EXCEPTION_SPAN_FT} ft apart. The bare formula at that geometry yields 66,000 lb, so implementing the formula alone would flag every legal 5-axle van in the country as overweight.`,
    },
    {
      q: 'Does passing the bridge formula mean I need no permit?',
      a: `Not on its own. A vehicle also has to clear the flat statutory limits — ${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb on a single axle, ${FEDERAL_TANDEM_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb on a tandem, ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb gross — and it has to be legal on size. Above any of them you are in permit territory.`,
    },
  ];

  const body = [
    sec(
      'formula',
      'The formula',
      quote(
        `W = 500 × ( (L × N) / (N − 1) + 12N + 36 )<br><br>
         W = the maximum weight in pounds that can be carried on a group of two or more axles to the nearest 500 pounds<br>
         L = the distance in feet between the outer axles of any two or more consecutive axles<br>
         N = the number of axles being considered`,
        '23 U.S.C. §127(a) / 23 CFR Part 658, as published in Bridge Formula Weights, FHWA-HOP-19-028, August 2019. Public domain.',
      ) +
        `<p>The formula exists to keep a heavy load from concentrating its mass over a short span of bridge deck. Spread ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb over 51 ft and the bridge is fine; bunch it into 20 ft and it is not.</p>
         <p><a href="${BRIDGE_TOOL_PATH}">Run the formula on your own axle layout →</a></p>`,
    ),
    sec(
      'caps',
      'The three caps the formula alone does not tell you about',
      `<p>The published table is not the bare formula. Three limits sit on top of it, and omitting any one over-permits a real load.</p>
       <ol>
         <li><strong>${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb × N.</strong> No group may exceed its own axles' individual limits. This is why the two-axle column flattens at 40,000 lb: the raw formula at 11 ft with two axles gives 41,000, and two axles can never legally carry more than 40,000.</li>
         <li><strong>${FEDERAL_TANDEM_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb for any group spanning ${TANDEM_MAX_SPACING_FT} ft or less</strong> — the statutory tandem limit, applied by span rather than by axle count, which is how the published table shows 34,000 in both the two- and three-axle columns at short spans.</li>
         <li><strong>The vehicle's own gross weight.</strong> A group is a subset of the vehicle's axles, so it cannot carry more than the whole vehicle carries. That is arithmetic rather than statute, which is exactly why it is safe at any weight — including on a permitted load well above the federal gross limit.</li>
       </ol>
       <p>That third cap is the one that is easy to get wrong. Hard-coding it at the federal ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb gross limit fabricates bridge-formula overages of up to 25,500 lb on permitted loads whose axle groups are in fact compliant — on precisely the heavy-haul moves a permit calculator exists for. The federal gross limit is a limit on the <em>vehicle</em>, and it is enforced once, in its own place.</p>`,
    ),
    sec(
      'interval',
      'The one span where the table contradicts interpolation',
      `<p>The federal table prints whole-foot rows plus exactly one interval row: "over 8 but less than 9 feet", reading 38,000 lb at two axles and 42,000 lb at three. Those are precisely the formula's values <em>at</em> 8 ft — so across that whole open interval the published table holds the 8-foot value flat rather than letting the formula climb.</p>
       <p>Interpolating there over-permits: at 8.99 ft with two axles the bare formula gives 38,990, rounding to 39,000 — a full 1,000 lb more than the 38,000 the table prints for that exact span. Over-permitting is the dangerous direction, so the published flat value wins. This is <strong>not</strong> generalised to every fractional span: nowhere else does the table say anything about fractional feet, and the statute defines the weight as a continuous function of the span.</p>`,
    ),
    sec(
      'table',
      'The bridge formula table',
      `<p>Maximum gross weight in pounds on a group of consecutive axles, by the distance in feet between the outermost axles of the group and the number of axles in it. Computed from 23 U.S.C. §127(a) with the three caps above applied, rounded to the nearest 500 lb with ties down.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">Span (L)</th>${TABLE_AXLE_COUNTS.map((n) => `<th>${n} axles</th>`).join('')}</tr></thead>
         <tbody>${tableRows}</tbody>
       </table></div>
       <p class="qh-sub">A dash means no cell: a group of that many axles cannot physically span that short a distance, and the federal table prints nothing there either.</p>`,
    ),
    sec(
      'errata',
      `${FHWA_TABLE_ERRATA.length} cells where the federal table disagrees with the federal formula`,
      `<p>The statute defines the weight <em>by the formula</em>, "to the nearest 500 pounds". The printed table is a reader's aid derived from it, and in ${FHWA_TABLE_ERRATA.length} cells the derivation is simply wrong — each prints exactly 500 lb below the nearest-500 value while every neighbouring cell in the same column is correct.</p>
       <div class="qh-tablewrap"><table class="qh-table">
         <thead><tr><th class="qh-st">Cell</th><th>Raw formula</th><th>Nearest 500 (ours)</th><th>Published</th></tr></thead>
         <tbody>${errataRows}</tbody>
       </table></div>
       <p>The 56 ft, 9-axle cell settles it: 500 × (63 + 108 + 36) is 103,500 on the nose, an exact multiple of 500 with no rounding decision to make at all, and the table still prints 103,000. No rounding rule produces that. None of the five is an exact tie either, so ties-down does not explain them — and the 52 ft, 9-axle cell <em>is</em> an exact tie, and the table rounds it down correctly. These are typos in a table, not a rule anyone has failed to find.</p>
       <p><strong>We follow the formula.</strong> The disagreement is recorded in our code as a named constant, and a test walks all 265 published cells and expects exactly these five to differ by exactly +500 — so if the table is ever reprinted, the test says which way it moved.</p>`,
    ),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  return hubPage({
    title: 'Federal Bridge Formula — The Formula, the Table and the Caps | QuoteFleet',
    description:
      'The Federal Bridge Formula explained: the formula itself, the three caps layered on it, the round-to-nearest-500-ties-down rule, the 8-to-9-foot flat interval, the full weight table, and the five cells where the published federal table contradicts the federal formula.',
    path: `${OSOW_HUB_PATH}/bridge-formula`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Bridge formula' }],
    eyebrow: 'Federal reference · public domain',
    h1: 'The federal bridge formula',
    lead: 'The formula, the caps that sit on top of it, the rounding rule, and the table — plus the cells where the published federal table and the federal statute do not agree.',
    bandHtml: provenanceBand(
      {
        sources: [],
        count: 2,
        oldestRevision: '2015-05',
        newestRevision: '2019-08',
        lastRetrieved: '2026-09-03',
      },
      ['Public domain — 17 U.S.C. §105', `${FHWA_TABLE_ERRATA.length} published cells disputed`],
    ),
    rail: [
      { id: 'formula', label: 'The formula' },
      { id: 'caps', label: 'The three caps' },
      { id: 'interval', label: 'The 8–9 ft interval' },
      { id: 'table', label: 'The table' },
      { id: 'errata', label: 'Where the table is wrong' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml:
      shortVersion(
        `the bridge formula is not the whole rule. Three caps sit on top of it — ${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb per axle, ${FEDERAL_TANDEM_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb for any group spanning ${TANDEM_MAX_SPACING_FT} ft or less, and the vehicle's own gross weight — and omitting any one of them over-permits a real load. The published federal table also disagrees with the federal formula in ${FHWA_TABLE_ERRATA.length} cells; we follow the formula and record the disagreement. <a href="${BRIDGE_TOOL_PATH}">Run it on your own axle layout →</a>`,
      ) + body,
    dateModified: '2026-09-03',
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Bridge formula', path: `${OSOW_HUB_PATH}/bridge-formula` },
      ]),
      jsonLdDataset({
        name: 'Federal Bridge Formula weight table',
        description:
          'Maximum gross weight on a group of consecutive axles by outer-axle span and axle count, computed from 23 U.S.C. §127(a).',
        path: `${OSOW_HUB_PATH}/bridge-formula`,
        variableMeasured: ['Maximum group weight (lb)', 'Outer axle span (ft)', 'Axle count'],
        isBasedOn: [
          'https://ops.fhwa.dot.gov/freight/publications/brdg_frm_wghts/fhwa_hop_19_028.pdf',
        ],
        temporalCoverageFrom: '2019-08',
        dateModified: '2026-09-03',
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── /oversize/non-divisible ────────────────────────────────────────────────

export function renderNonDivisible(): string {
  const faqs = [
    {
      q: 'What makes a load non-divisible?',
      a: 'Federal law gives a three-part test: separating the load into smaller loads would compromise the intended use of the vehicle, destroy the value of the load or vehicle, or require more than 8 work hours to dismantle using appropriate equipment. Meeting any one of the three is enough.',
    },
    {
      q: 'Who has to prove it?',
      a: 'The applicant. The federal definition puts the burden of proof about the number of work hours on the person applying for the permit, not on the agency.',
    },
    {
      q: 'Does a divisible load ever get a permit?',
      a: 'Some states issue overweight permits for specific divisible commodities under their own statutes, but that is a state product and it is not what the federal non-divisible definition covers. The federal definition is what decides whether a load is eligible for an oversize/overweight permit on the Interstate at all.',
    },
    {
      q: 'What about emergency vehicles and military equipment?',
      a: 'Federal law lets a state treat emergency response vehicles, casks designed for the transport of spent nuclear materials, and military vehicles transporting marked military equipment or materiel as non-divisible — it permits that treatment rather than requiring it.',
    },
  ];

  const body = [
    sec(
      'definition',
      'The federal definition, verbatim',
      quote(
        `"any load or vehicle exceeding applicable length or weight limits, which, if separated into smaller loads or vehicles, would: (1) Compromise the intended use of the vehicle …; (2) Destroy the value of the load or vehicle …; or (3) <strong>Require more than 8 work hours to dismantle using appropriate equipment.</strong> The applicant for a non-divisible load permit has the burden of proof regarding the number of work hours required to dismantle the load. A State may treat emergency response vehicles, casks designed for the transport of spent nuclear materials, and military vehicles transporting marked military equipment or materiel as non-divisible vehicles or loads."`,
        '23 CFR §658.5, as quoted in the Glossary of Terms, Compilation of Existing State Truck Size and Weight Limit Laws — FHWA, May 2015. Public domain (17 U.S.C. §105).',
      ) +
        `<p>This is the operative federal definition of what needs an oversize or overweight permit at all, and the <strong>8-work-hour test</strong> is the part that decides most real arguments. It is a measurable threshold, not a judgement call, and it is the applicant who has to substantiate it.</p>`,
    ),
    sec(
      'divisible',
      'And what a divisible load is',
      quote(
        `"Definitions vary by State: generally, a divisible load is one that can be reduced in size or weight, or that is practically divided in a way that does not diminish value or inhibit its intended purpose."`,
        'Glossary of Terms, Compilation of Existing State Truck Size and Weight Limit Laws — FHWA, May 2015. Public domain.',
      ) +
        `<p>Note that the federal glossary itself says the definition varies by state. The non-divisible test above is the federal floor; a state can and does add its own products on top of it.</p>`,
    ),
    sec(
      'why',
      'Why this decides the whole quote',
      `<p>The non-divisible question comes before every other question on this site. If the load is divisible, the answer is not "how much is the permit" — it is "split the load", and no permit is available at all on the federal test. If it is non-divisible, everything else follows: which state permits, at what fee, with what escorts, under what restrictions.</p>
       <ul>
         <li><a href="${OSOW_HUB_PATH}/legal-limits">Is it over a legal limit?</a> — the dimension side.</li>
         <li><a href="${AXLE_TOOL_PATH}">Is it over on weight?</a> — the axle-group side, which no table can answer.</li>
         <li><a href="${OSOW_HUB_PATH}/permit-fees">What does the permit cost?</a></li>
         <li><a href="${OSOW_HUB_PATH}/escort-requirements">Does it need a pilot car?</a> — usually the larger number.</li>
       </ul>`,
    ),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  return hubPage({
    title: 'Non-Divisible Load Definition — The Federal 8-Work-Hour Test | QuoteFleet',
    description:
      'What counts as a non-divisible load under 23 CFR §658.5: the three-part federal test, the 8-work-hour threshold, who carries the burden of proof, and the emergency, nuclear-cask and military carve-outs. Quoted verbatim.',
    path: `${OSOW_HUB_PATH}/non-divisible`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Non-divisible loads' }],
    eyebrow: 'Federal reference · public domain',
    h1: 'What counts as a non-divisible load',
    lead: 'The federal test that decides whether a permit is available at all — three parts, one of them a measurable 8-work-hour threshold, with the burden of proof on the applicant.',
    bandHtml: provenanceBand(
      {
        sources: [],
        count: 1,
        oldestRevision: '2015-05',
        newestRevision: '2015-05',
        lastRetrieved: '2026-09-03',
      },
      ['23 CFR §658.5', 'Public domain — 17 U.S.C. §105'],
    ),
    rail: [
      { id: 'definition', label: 'The definition' },
      { id: 'divisible', label: 'Divisible loads' },
      { id: 'why', label: 'Why it decides the quote' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml:
      shortVersion(
        `a load is non-divisible if splitting it would compromise the vehicle's intended use, destroy the value of the load or vehicle, or take <strong>more than 8 work hours</strong> to dismantle with appropriate equipment — any one of the three is enough, and the <em>applicant</em> carries the burden of proof on the hours. If the load is divisible, there is no permit to price: the answer is to split it. Both federal passages are quoted verbatim below, behind their own citations.`,
      ) + body,
    dateModified: '2026-09-03',
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Non-divisible loads', path: `${OSOW_HUB_PATH}/non-divisible` },
      ]),
      jsonLdFaq(faqs),
    ],
  });
}

// ── /oversize/common-figures ───────────────────────────────────────────────

interface Correction {
  id: string;
  /** Stated impersonally. Never an attribution. */
  circulating: string;
  /** The state whose documents answer it, when one does. */
  code?: string;
  /** The cell from our own cited data that answers it. */
  cell?: (asOf: IsoDate) => HubCell;
  /** The explanation, including the MECHANISM rather than just the number. */
  detail: string;
  /** Where on this site the reader can check it. */
  seeAlso?: { path: string; label: string };
}

function limitCell(code: string, key: 'height' | 'trailerLength' | 'overallLength' | 'singleAxle') {
  return (asOf: IsoDate): HubCell => {
    const row = legalLimitRows(asOf).find((r) => r.state.code === code);
    return row ? row[key] : { text: null, absence: 'no-data' };
  };
}

function feeCell(code: string, key: 'base' | 'transaction') {
  return (asOf: IsoDate): HubCell => {
    const row = permitFeeRows(asOf).find((r) => r.state.code === code);
    return row ? row[key] : { text: null, absence: 'no-data' };
  };
}

function superCell(code: string) {
  return (asOf: IsoDate): HubCell => {
    const row = superloadRows(asOf).find((r) => r.state.code === code);
    return row ? row.gross : { text: null, absence: 'no-data' };
  };
}

const CORRECTIONS: readonly Correction[] = [
  {
    id: 'superload-80000',
    circulating: 'A superload is anything "over 80,000 lb"',
    detail:
      '80,000 lb is the federal LEGAL gross limit on the Interstate System under 23 U.S.C. §127. Above it a load needs an overweight permit — an ordinary over-the-counter product. A superload is something else entirely: a move the state will not issue over the counter, and prices only after an engineering and route review. The published gross-weight lines in our own data start well above 100,000 lb and run past 250,000 lb, so treating 80,000 as the line misstates it by a multiple in every state that publishes one.',
    seeAlso: { path: `${OSOW_HUB_PATH}/superloads`, label: 'Superload thresholds by state' },
  },
  {
    id: 'ga-superload',
    circulating: "Georgia's superload line sits at 150,000 lb",
    code: 'GA',
    cell: superCell('GA'),
    detail:
      'Georgia\'s own rules define superload treatment above a gross vehicle weight of 180,000 pounds. 150,000 lb is where the FEE steps — a band edge in the fee schedule, not a classification threshold. The two are different kinds of number and a fee-band edge does not decide whether a move needs engineering review.',
  },
  {
    id: 'tn-trailer',
    circulating: 'Tennessee allows a 53 ft semitrailer',
    code: 'TN',
    cell: limitCell('TN', 'trailerLength'),
    detail:
      'The Tennessee statute states that the towed vehicle shall not exceed fifty-two feet. A standard 53 ft van therefore reads legal in Tennessee and is not. This is the dangerous direction of error — a figure a foot over the statute puts an illegal trailer on the road with the driver believing otherwise.',
    seeAlso: { path: hubStatePath('tennessee'), label: 'Tennessee legal limits, cited' },
  },
  {
    id: 'la-height',
    circulating: 'Louisiana allows 14 ft of height',
    code: 'LA',
    cell: limitCell('LA', 'height'),
    detail:
      'The general Louisiana height limit is 13 ft 6 in. Fourteen feet applies only on the interstate system, as an exception — so a 13 ft 9 in load reads legal on the general figure and is not legal on the state system. Publishing the exception as though it were the rule is again the dangerous direction.',
    seeAlso: { path: hubStatePath('louisiana'), label: 'Louisiana legal limits, cited' },
  },
  {
    id: 'co-height',
    circulating: 'Colorado allows 14 ft of height',
    code: 'CO',
    cell: limitCell('CO', 'height'),
    detail:
      'Colorado\'s statutory height limit is 14 ft 6 in. This one errs in the safe direction — a load built to 14 ft is legal — but it costs money in the other way, by sending a load to a permit it does not need.',
  },
  {
    id: 'ga-length',
    circulating: "Georgia's overall length limit is 65 ft",
    code: 'GA',
    cell: limitCell('GA', 'overallLength'),
    detail:
      'Georgia publishes an overall length limit of 100 ft including overhang. A 65 ft figure would send an ordinary legal combination to a permit it does not need.',
  },
  {
    id: 'ga-single-axle',
    circulating: "Georgia's single-axle limit is 20,000 lb",
    code: 'GA',
    cell: limitCell('GA', 'singleAxle'),
    detail:
      'This one is more interesting than a correction: Georgia\'s own documents do not agree with each other. A grandfathered figure above the federal 20,000 lb limit is corroborated by the federal compilation\'s own appendix, and another official source states the federal figure. Both are on file here and neither has been adopted — which is why this entry shows a disagreement rather than a corrected number.',
    seeAlso: { path: `${OSOW_HUB_PATH}/source-notes`, label: 'Where the sources disagree' },
  },
  {
    id: 'nj-transaction',
    circulating: 'New Jersey adds a "12% service charge" to a permit',
    code: 'NJ',
    cell: feeCell('NJ', 'transaction'),
    detail:
      'The New Jersey charge is a FLAT $12 per permit plus a percentage — not 12 percent. On a small permit the difference is roughly a doubling of the out-the-door cost, and it goes the wrong way for anyone budgeting from the smaller figure. Reading a flat dollar amount as a percentage is a specific and repeatable error, which is why the mechanism is published here alongside the number.',
  },
  {
    id: 'co-base',
    circulating: 'A Colorado single-trip oversize permit costs $15',
    code: 'CO',
    cell: feeCell('CO', 'base'),
    detail:
      'The $15 in the Colorado permit statute is never payable on its own: a separate statute imposes a surcharge equal to 100% of the fee, doubling it, and the state\'s own worked example runs $45 → $90 → $94 with the card charge. The figure we hold is the doubled one, because that is the amount actually charged. Publishing the mechanism — a statutory fee plus a 100% surcharge under a different statute — is what stops this figure going wrong again the next time either half moves.',
  },
  {
    id: 'tx-max',
    circulating: 'A Texas oversize/overweight permit tops out at $435',
    code: 'TX',
    detail:
      'Texas\'s own fee table prints a $60 base, a top maintenance band of $375 and a $35 vehicle supervision fee in the same cell — $470, not $435 — and the state\'s payment processing (a small flat amount plus a percentage) takes it above $480 out the door. The $35 supervision fee is the component most often dropped, and it is printed in the same table as the two figures that are kept.',
    seeAlso: { path: hubStatePath('texas'), label: 'Texas permit fees, cited' },
  },
  {
    id: 'pa-fee',
    circulating: 'A Pennsylvania single-trip oversize permit costs $36',
    code: 'PA',
    detail:
      'No document in the Pennsylvania record contains $36. Two figures do exist and both are official: the fee statute still prints $35, and PennDOT\'s current schedule prints $46 — because a separate section of the same title CPI-adjusts every fee in it every 24 months, and $46 is what that adjustment produced. This is therefore a live disagreement between two current documents rather than an error, and it is published as such. It is also why a bare "$46" would repeat the exact mistake being corrected: the figure is on a fixed adjustment cycle and will move again.',
    seeAlso: { path: `${OSOW_HUB_PATH}/source-notes`, label: 'Where the sources disagree' },
  },
  {
    id: 'permit-office-phone',
    circulating: 'A single published contact list gives every state permit office',
    detail:
      'The most widely-circulated federal contact list gives two different states the same telephone number, carries at least one legacy path, and stamps itself with a date computed from a file timestamp — with a fallback that prints today\'s date when the parse fails, so it always looks current. That is why we publish no per-state permit-office phone numbers yet: the seed lists are stale, and a wrong number on a reference page costs somebody a morning. The agency behind each individual figure on this site is linked from that figure instead.',
    seeAlso: { path: `${OSOW_HUB_PATH}/coverage`, label: 'What we cover, and what we do not' },
  },
];

export function renderCommonFigures(asOf: IsoDate): string {
  const paBands = bandConflictsFor(HUB_STATES.find((s) => s.code === 'PA')!, asOf);
  const prov = provenanceFor(
    CORRECTIONS.map((c) => (c.cell ? c.cell(asOf) : null)),
    paBands,
  );

  const entries = CORRECTIONS.map((c) => {
    const cell = c.cell ? c.cell(asOf) : null;
    const answer =
      cell === null
        ? ''
        : cell.absence === 'conflict' && cell.conflict
          ? `<div class="qh-versus">${cell.conflict
              .map(
                (x) =>
                  `<div><span class="qh-fig">${esc(x.text)}</span><span class="qh-src">${citeLink(x.source, x.source.title)}${
                    x.source.cite ? ` — ${esc(x.source.cite)}` : ''
                  }<br>${esc(revisionLine(x.source))}</span></div>`,
              )
              .join('')}</div>`
          : cell.text !== null && cell.source
            ? `<div class="qh-versus"><div><span class="qh-fig">${esc(cell.text)}</span><span class="qh-src">${citeLink(
                cell.source,
                cell.source.title,
              )}${cell.source.cite ? ` — ${esc(cell.source.cite)}` : ''}<br>${esc(revisionLine(cell.source))}</span></div></div>`
            : '';
    const link = c.seeAlso
      ? `<p class="qh-meta"><a href="${esc(c.seeAlso.path)}">${esc(c.seeAlso.label)} →</a></p>`
      : '';
    /* SUMMARY-FIRST, LITERALLY. The circulating claim and the corrected figure
       — with its citation and both dates — are unconditional. What folds is the
       MECHANISM: the surcharge statute, the CPI cycle, the dropped supervision
       fee. A reader who arrived with a wrong number gets the right one without
       a click; a reader who wants to know why it went wrong opens one. */
    return `<article class="qh-entry" id="${esc(c.id)}">
      <h3>${esc(c.circulating)}</h3>
      ${answer}
      ${fold({ label: 'What the documents actually say, and why the figure moved', bodyHtml: `<p>${esc(c.detail)}</p>` })}
      ${link}
    </article>`;
  }).join('');

  const faqs = [
    {
      q: 'Whose figures are these?',
      a: 'Deliberately unattributed. Each entry states a figure that circulates and answers it with the primary document, because the useful claim is "here is what the statute says" — a reader who arrived with a wrong number needs the right one, not a name.',
    },
    {
      q: 'How do I know YOUR figure is right?',
      a: 'You do not have to take it. Every corrected figure above links to the state document it came from and carries that document\'s own revision date beside the date we read it, so it is checkable against us as well as against anything else.',
    },
    {
      q: 'Why publish the mechanism as well as the number?',
      a: 'Because a corrected number goes stale the same way the original did. One state on this page adjusts its permit fee for inflation on a fixed 24-month cycle; another doubles its statutory fee under a separate surcharge statute. Publishing only the current figure would reproduce the fault being corrected.',
    },
    {
      q: 'What if two official documents disagree?',
      a: 'Then it is not a correction, and it belongs on the source-notes page instead. Several entries above are exactly that, and they show both documents rather than adopting one.',
    },
  ];

  const body = [
    sec(
      'intro',
      'How to read this page',
      `<p>Each entry states a figure that is in circulation, then gives what the primary documents actually say — with the document, its own revision date, and the date we read it.</p>
       ${folds([
         {
           label: 'Why nothing here is attributed',
           bodyHtml:
             '<p>Nothing here names or links to another site, and nothing here imputes intent: a number can circulate for years without anyone being at fault, and the useful thing is the statute, not the attribution.</p>',
         },
         {
           label: 'Errors versus genuine disagreements',
           bodyHtml:
             '<p>Where a figure turns out to be a genuine disagreement between two <em>official</em> documents rather than an error, it is marked as such and shows both. That distinction is the difference between authority and embarrassment, and there are entries below on both sides of it.</p>',
         },
       ])}`,
      'How to read this',
    ),
    sec('entries', `${CORRECTIONS.length} figures, against the documents`, `<div data-qh-folds>${entries}</div>`, 'The figures'),
    sec('faq', 'Questions', faqBlock(faqs), 'Common questions'),
  ].join('');

  return hubPage({
    title: 'OS/OW Figures in Circulation, Against the Statute | QuoteFleet',
    description: `${CORRECTIONS.length} widely-repeated oversize and overweight figures — superload thresholds, state legal limits, permit fees and transaction charges — answered with the primary state document, its revision date and the mechanism that produced the real number.`,
    path: `${OSOW_HUB_PATH}/common-figures`,
    crumbs: [{ name: 'Oversize & overweight', path: OSOW_HUB_PATH }, { name: 'Figures in circulation' }],
    eyebrow: 'Corrections · sourced, unattributed',
    h1: 'Figures in circulation, against the statute',
    lead: 'Numbers that circulate widely in oversize and overweight work, answered with the primary document — and with the mechanism that produced the real figure, so it degrades gracefully instead of going wrong again.',
    bandHtml: provenanceBand(prov, [`${CORRECTIONS.length} figures examined`, 'No site is named']),
    rail: [
      { id: 'intro', label: 'How to read this' },
      { id: 'entries', label: 'The figures' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml:
      shortVersion(
        `${CORRECTIONS.length} figures that circulate widely in oversize and overweight work are set against the primary document that governs them. Each entry shows the circulating claim, the figure the state's own document carries, and that document's revision date beside the date we read it — all of it visible without opening anything. The fold under each one holds the <em>mechanism</em>: the surcharge statute, the inflation cycle or the dropped line item that produced the gap.`,
      ) + body,
    dateModified: prov.lastRetrieved,
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Oversize & overweight', path: OSOW_HUB_PATH },
        { name: 'Figures in circulation', path: `${OSOW_HUB_PATH}/common-figures` },
      ]),
      jsonLdFaq(faqs),
    ],
  });
}
