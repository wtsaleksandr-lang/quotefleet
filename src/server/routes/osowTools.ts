/**
 * TWO PUBLIC CALCULATORS OVER THE BRIDGE-FORMULA ENGINE.
 *
 *   GET  /tools/bridge-formula     — the federal formula, forward solve.
 *   GET  /tools/axle-weights       — the same engine plus a state's own axle
 *                                    and gross limits, with per-group headroom.
 *   POST /api/tools/bridge-formula — JSON, rate-limited, no account.
 *   POST /api/tools/axle-weights   — JSON, rate-limited, no account.
 *
 * ── WHY TWO PAGES OVER ONE ENGINE ─────────────────────────────────────────
 * They answer different questions and a reader arrives at them with different
 * things in hand. "Is this axle group over the federal bridge formula" is a
 * pure computation on geometry and needs no state at all. "Is my rig legal in
 * Ohio" needs the state's own single-axle, tandem and gross limits, which are
 * cited data with effective dates and which sometimes disagree with each other.
 * Merging them would have meant one page that asks for a state it does not need
 * or omits one it does.
 *
 * ── WHAT MAKES THESE DIFFERENT FROM THE OTHER FREE CALCULATORS OUT THERE ──
 * Two things, and neither is the arithmetic.
 *
 *   1. **Every group is checked, not the obvious three.** Compliance is not
 *      "steer, drives, trailer tandems" — it is every group of two or more
 *      CONSECUTIVE axles, all N(N−1)/2 of them. A five-axle tractor-semitrailer
 *      has ten. The classic failure is a rig whose every named group passes and
 *      whose axles 2-through-5 span does not, and that is exactly the interior
 *      group a bridge cares about. `groupsChecked` is returned so a reader can
 *      see the count rather than take it on trust.
 *   2. **Every state verdict line carries its statute AND that document's own
 *      revision date.** A free calculator that prints "Ohio: 20,000 lb" is
 *      telling you a number; one that prints the rule, its revision date and
 *      our retrieval date is telling you something you can check. Where two of
 *      a state's own documents disagree, the line says so and refuses to pick.
 *
 * ── NO DATABASE, NO PAID API, NO ACCOUNT ──────────────────────────────────
 * Every input is in the request and every limit is in the compiled jurisdiction
 * data, so both pages render and both endpoints answer correctly with the
 * database unreachable. Neither calls anything billable.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
  FEDERAL_SINGLE_AXLE_LIMIT_LBS,
  FEDERAL_TANDEM_AXLE_LIMIT_LBS,
  TANDEM_MAX_SPACING_FT,
  checkBridgeFormula,
  groupMaxWeightLbs,
} from '../../calc/osow/bridgeFormula.js';
import type { Axle, BridgeViolation } from '../../calc/osow/bridgeFormula.js';
import { osowRulesFor } from '../../calc/osow/jurisdictions/index.js';
import { todayIso } from '../../calc/osow/provenance.js';
import type { IsoDate } from '../../calc/osow/provenance.js';
import { publicCalcLimiter } from '../rateLimits.js';
import { setPublicDirectoryCache } from '../directory/httpCache.js';
import {
  HUB_COVERED_STATES,
  OSOW_HUB_PATH,
  cellFrom,
  fmtLbs,
} from '../osow/hubData.js';
import type { HubCell } from '../osow/hubData.js';
import {
  esc,
  hubPage,
  jsonLdBreadcrumb,
  jsonLdFaq,
  jsonLdWebApplication,
} from '../osow/hubShell.js';

export const BRIDGE_TOOL_PATH = '/tools/bridge-formula';
export const AXLE_TOOL_PATH = '/tools/axle-weights';
const OSOW_TOOL = '/tools/oversize-permits';

/** More axles than any legal combination on a US highway, by a wide margin. */
const MAX_AXLES = 13;

const AxleSchema = z.object({
  positionFt: z.number().finite().min(0).max(200),
  weightLbs: z.number().finite().min(0).max(400000),
  label: z.string().max(40).optional(),
});

const RequestSchema = z.object({
  axles: z.array(AxleSchema).min(2).max(MAX_AXLES),
  state: z.string().trim().length(2).optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type AxleToolRequest = z.infer<typeof RequestSchema>;

// ── The computation ────────────────────────────────────────────────────────

export interface GroupRow {
  firstAxle: number;
  lastAxle: number;
  axleCount: number;
  spanFt: number;
  actualLbs: number;
  allowedLbs: number;
  /** Positive = room left. Negative = over, and it is a violation. */
  headroomLbs: number;
  rule: 'bridge-formula' | 'tandem-axle';
}

export interface StateLimitLine {
  label: string;
  /** Formatted limit, or null when it does not resolve. */
  limit: string | null;
  absence: HubCell['absence'];
  actual: string;
  verdict: 'under' | 'over' | 'unknown';
  sourceTitle?: string;
  sourceUrl?: string;
  cite?: string;
  revisedOn?: string | null;
  retrievedOn?: string;
  /** Both readings, when the state's own documents disagree. */
  conflict?: Array<{ text: string; title: string; url: string }>;
}

export interface AxleToolResponse {
  asOf: IsoDate;
  compliant: boolean;
  grossWeightLbs: number;
  overallLengthFt: number;
  groupsChecked: number;
  axleCount: number;
  groups: GroupRow[];
  violations: BridgeViolation[];
  federal: { singleAxleLbs: number; tandemAxleLbs: number; grossLbs: number };
  state: { code: string; name: string; lines: StateLimitLine[] } | null;
  warnings: string[];
  requiresManualReview: boolean;
  notIncluded: string[];
}

const NOT_INCLUDED: readonly string[] = [
  'State permit fees — priced separately by the oversize permit calculator.',
  'Pilot cars, police escorts and route-survey engineering, which on a long lane routinely exceed the permit itself.',
  'Seasonal (spring thaw) weight restrictions, which are posted road by road and can make a legal axle group illegal on a specific route.',
  'Local bridge postings and toll, bridge or city authorities that issue their own permit inside the same state.',
];

/**
 * Every group of two or more consecutive axles, with the headroom left on each.
 *
 * The headroom column is the point of the axle tool. A pass/fail tells a
 * dispatcher nothing about what a thousand pounds of repositioned freight would
 * do; the group with 400 lb left on it is the one that decides whether the load
 * can be re-tarped, and it is invisible on a verdict-only readout.
 */
export function axleGroups(axles: Axle[]): GroupRow[] {
  const gross = axles.reduce((s, a) => s + a.weightLbs, 0);
  const out: GroupRow[] = [];
  for (let i = 0; i < axles.length; i += 1) {
    for (let j = i + 1; j < axles.length; j += 1) {
      const group = axles.slice(i, j + 1);
      const spanFt = (group[group.length - 1] as Axle).positionFt - (group[0] as Axle).positionFt;
      const actual = group.reduce((s, a) => s + a.weightLbs, 0);
      const allowed = groupMaxWeightLbs(spanFt, group.length, gross);
      out.push({
        firstAxle: i + 1,
        lastAxle: j + 1,
        axleCount: group.length,
        spanFt,
        actualLbs: actual,
        allowedLbs: allowed,
        headroomLbs: allowed - actual,
        rule: spanFt <= TANDEM_MAX_SPACING_FT ? 'tandem-axle' : 'bridge-formula',
      });
    }
  }
  return out;
}

/** The heaviest single axle, and the heaviest group spanning 8 ft or less. */
function heaviestSingle(axles: Axle[]): number {
  return axles.reduce((m, a) => Math.max(m, a.weightLbs), 0);
}

function heaviestTandem(axles: Axle[]): number {
  let max = 0;
  for (let i = 0; i < axles.length; i += 1) {
    for (let j = i + 1; j < axles.length; j += 1) {
      const span = (axles[j] as Axle).positionFt - (axles[i] as Axle).positionFt;
      if (span > TANDEM_MAX_SPACING_FT) break;
      const w = axles.slice(i, j + 1).reduce((s, a) => s + a.weightLbs, 0);
      if (w > max) max = w;
    }
  }
  return max;
}

function limitLine(
  label: string,
  cell: HubCell,
  actualLbs: number,
): StateLimitLine {
  const actual = fmtLbs(actualLbs);
  if (cell.absence === 'conflict' && cell.conflict) {
    return {
      label,
      limit: null,
      absence: 'conflict',
      actual,
      verdict: 'unknown',
      conflict: cell.conflict.map((c) => ({ text: c.text, title: c.source.title, url: c.source.url })),
    };
  }
  if (cell.text === null || cell.source === undefined) {
    return { label, limit: null, absence: cell.absence ?? 'no-data', actual, verdict: 'unknown' };
  }
  // `cell.text` is formatted; the numeric comparison uses the raw digits it was
  // built from, which is why the limit is re-parsed rather than re-resolved.
  const numeric = Number(cell.text.replace(/[^\d]/g, ''));
  return {
    label,
    limit: cell.text,
    absence: undefined,
    actual,
    verdict: Number.isFinite(numeric) && numeric > 0 ? (actualLbs > numeric ? 'over' : 'under') : 'unknown',
    sourceTitle: cell.source.title,
    sourceUrl: cell.source.url,
    ...(cell.source.cite ? { cite: cell.source.cite } : {}),
    revisedOn: cell.source.revisedOn,
    retrievedOn: cell.source.retrievedOn,
  };
}

export function evaluateAxles(input: AxleToolRequest): AxleToolResponse {
  const asOf = input.asOf ?? todayIso();
  const axles: Axle[] = input.axles.map((a) => ({
    positionFt: a.positionFt,
    weightLbs: a.weightLbs,
    ...(a.label ? { label: a.label } : {}),
  }));

  const result = checkBridgeFormula(axles);
  const warnings = [...result.warnings];

  let state: AxleToolResponse['state'] = null;
  if (input.state !== undefined) {
    const code = input.state.toUpperCase();
    const rules = osowRulesFor(code);
    if (rules === null) {
      warnings.push(
        `No jurisdiction file is on file for ${code}, so no state limits were applied. Only the federal limits above were checked.`,
      );
    } else {
      const l = rules.legalLimits;
      state = {
        code: rules.code,
        name: rules.name,
        lines: [
          limitLine(
            'Heaviest single axle',
            cellFrom('legal single-axle weight', l.singleAxleLbs, asOf, fmtLbs),
            heaviestSingle(axles),
          ),
          limitLine(
            'Heaviest tandem group',
            cellFrom('legal tandem-axle weight', l.tandemAxleLbs, asOf, fmtLbs),
            heaviestTandem(axles),
          ),
          limitLine(
            'Gross combination weight',
            cellFrom('legal gross weight', l.grossWeightLbs, asOf, fmtLbs),
            result.grossWeightLbs,
          ),
        ],
      };
      for (const line of state.lines) {
        if (line.absence === 'conflict') {
          warnings.push(
            `${rules.name}'s own documents disagree on the ${line.label.toLowerCase()}. Both readings are shown and neither has been adopted; confirm with the issuing agency before dispatch.`,
          );
        }
      }
    }
  }

  return {
    asOf,
    compliant: result.compliant,
    grossWeightLbs: result.grossWeightLbs,
    overallLengthFt: result.overallLengthFt,
    groupsChecked: result.groupsChecked,
    axleCount: axles.length,
    groups: result.groupsChecked === 0 ? [] : axleGroups(axles),
    violations: result.violations,
    federal: {
      singleAxleLbs: FEDERAL_SINGLE_AXLE_LIMIT_LBS,
      tandemAxleLbs: FEDERAL_TANDEM_AXLE_LIMIT_LBS,
      grossLbs: FEDERAL_GROSS_WEIGHT_LIMIT_LBS,
    },
    state,
    warnings,
    requiresManualReview: result.requiresManualReview || (state?.lines ?? []).some((l) => l.absence === 'conflict'),
    notIncluded: [...NOT_INCLUDED],
  };
}

// ── Presets ────────────────────────────────────────────────────────────────
//
// FOUR, on purpose, so the pill grid wraps 2 x 2 and a single pill can never
// sit alone on a line. Each is a real, common configuration rather than a
// demonstration of the maths.

export interface AxlePreset {
  id: string;
  label: string;
  hint: string;
  axles: Array<{ positionFt: number; weightLbs: number; label: string }>;
}

export const AXLE_PRESETS: readonly AxlePreset[] = [
  {
    id: 'five-axle',
    label: '5-axle tractor-semitrailer',
    hint: 'The standard 80,000 lb van. Legal only because of the 34-34-at-36-ft exception.',
    axles: [
      { positionFt: 0, weightLbs: 12000, label: 'steer' },
      { positionFt: 16, weightLbs: 17000, label: 'drive 1' },
      { positionFt: 20.33, weightLbs: 17000, label: 'drive 2' },
      { positionFt: 52, weightLbs: 17000, label: 'trailer 1' },
      { positionFt: 56.33, weightLbs: 17000, label: 'trailer 2' },
    ],
  },
  {
    id: 'six-axle',
    label: '6-axle with a spread',
    hint: 'A tri-axle trailer. More axles and more span buy allowance under the formula.',
    axles: [
      { positionFt: 0, weightLbs: 12000, label: 'steer' },
      { positionFt: 16, weightLbs: 17000, label: 'drive 1' },
      { positionFt: 20.33, weightLbs: 17000, label: 'drive 2' },
      { positionFt: 48, weightLbs: 15000, label: 'trailer 1' },
      { positionFt: 52.33, weightLbs: 15000, label: 'trailer 2' },
      { positionFt: 56.66, weightLbs: 15000, label: 'trailer 3' },
    ],
  },
  {
    id: 'three-axle',
    label: '3-axle dump truck',
    hint: 'The case a gross-weight-only check misses: short wheelbase, heavy on a tight group.',
    axles: [
      { positionFt: 0, weightLbs: 16000, label: 'steer' },
      { positionFt: 14, weightLbs: 20000, label: 'drive 1' },
      { positionFt: 18.33, weightLbs: 20000, label: 'drive 2' },
    ],
  },
  {
    id: 'nine-axle',
    label: '9-axle heavy haul',
    hint: 'A permitted move above the federal gross limit whose axle groups are all inside the formula — the case an 80,000 lb clamp gets wrong.',
    /**
     * 104,000 lb, and EVERY group is inside its bridge-formula allowance. Only
     * the flat federal gross limit is exceeded, which is exactly what the
     * overweight permit is for. The preset is chosen this way on purpose: it is
     * the configuration that exposes the clamping bug, because several of its
     * group allowances sit above 80,000 lb and a calculator that capped them
     * there would invent violations on a rig that has none.
     */
    axles: [
      { positionFt: 0, weightLbs: 12000, label: 'steer' },
      { positionFt: 17, weightLbs: 13000, label: 'drive 1' },
      { positionFt: 21.5, weightLbs: 13000, label: 'drive 2' },
      { positionFt: 38, weightLbs: 11000, label: 'trailer 1' },
      { positionFt: 43, weightLbs: 11000, label: 'trailer 2' },
      { positionFt: 48, weightLbs: 11000, label: 'trailer 3' },
      { positionFt: 53, weightLbs: 11000, label: 'trailer 4' },
      { positionFt: 58, weightLbs: 11000, label: 'trailer 5' },
      { positionFt: 63, weightLbs: 11000, label: 'trailer 6' },
    ],
  },
];

// ── Page CSS ───────────────────────────────────────────────────────────────

const TOOL_CSS = `
  .qt-grid { display: grid; grid-template-columns: minmax(0, 400px) minmax(0, 1fr); gap: 24px; align-items: start; }
  .qt-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; }
  .qt-card + .qt-card { margin-top: 16px; }

  /* Section header: help cue TOP-LEFT, never inline with a label. */
  .qt-sec { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
  .qt-cue { flex: 0 0 auto; width: 24px; height: 24px; min-width: 24px; min-height: 24px; border-radius: var(--radius-pill); border: 1px solid var(--border-strong); background: transparent; color: var(--muted); font-size: 12px; font-weight: 700; line-height: 1; cursor: pointer; padding: 0; }
  .qt-cue:hover, .qt-cue:focus-visible { border-color: var(--accent); color: var(--accent); }
  .qt-sec h2 { font-size: 15px; margin: 0; align-self: center; color: var(--ink); }
  .qt-cue-body { display: none; font-size: 13px; line-height: 1.55; color: var(--ink-soft); background: var(--surface-3); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; margin: 0 0 8px; }
  .qt-cue-body.is-open { display: block; }

  /* Inputs: label INSIDE the field, 2px between stacked components. */
  .qt-stack { display: grid; gap: 2px; }
  .qt-field { position: relative; display: block; }
  .qt-field input, .qt-field select { width: 100%; min-height: 48px; box-sizing: border-box; padding: 20px 12px 6px; font: inherit; font-size: 15px; color: var(--ink); background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); appearance: none; }
  .qt-field input:focus, .qt-field select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .qt-field .qt-lab { position: absolute; left: 12px; top: 6px; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); pointer-events: none; }
  .qt-field input:focus + .qt-lab, .qt-field select:focus + .qt-lab { color: var(--accent); }

  /* Preset pills: exactly four, in two columns, so they wrap 2x2 and none is
     ever left alone on a line. Selected = outline, never a bright fill. */
  .qt-pills { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; }
  .qt-pill { min-height: 44px; padding: 8px 12px; font: inherit; font-size: 13px; text-align: left; color: var(--ink-soft); background: transparent; border: 1px solid var(--border); border-radius: var(--radius); cursor: pointer; }
  .qt-pill:hover { border-color: var(--border-strong); }
  .qt-pill[aria-pressed="true"] { border-color: var(--accent); border-width: 2px; padding: 8px 12px; background: var(--accent-soft); color: var(--ink); }

  .qt-axles { display: grid; gap: 2px; }
  .qt-axle { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 44px; gap: 2px; }
  .qt-drop { min-height: 44px; min-width: 44px; border: 1px solid var(--border); border-radius: var(--radius); background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer; }
  .qt-drop:hover { border-color: var(--error); color: var(--error); }

  .qt-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .qt-actions .btn { width: 100%; min-height: 48px; display: inline-flex; align-items: center; justify-content: center; }
  .qt-actions .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .qt-hint { font-size: 12px; color: var(--muted); margin: 8px 0 0; line-height: 1.5; }

  /* Verdict. Flat ink, never the accent, so it cannot collide with its surface. */
  .qt-verdict { scroll-margin-top: 96px; background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px; }
  .qt-verdict.is-over { border-color: var(--warn); }
  .qt-verdict .qt-vl { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
  .qt-verdict .qt-vv { font-size: 32px; font-weight: 700; line-height: 1.1; color: var(--ink); margin: 0; }
  .qt-verdict .qt-vs { font-size: 13px; color: var(--ink-soft); margin: 4px 0 0; line-height: 1.55; }

  .qt-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  .qt-stat { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--bg); }
  .qt-stat .k { font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 4px; }
  .qt-stat .v { font-size: 16px; font-weight: 600; color: var(--ink); }

  .qt-note { border-radius: var(--radius-lg); padding: 16px; margin-top: 16px; border: 1px solid var(--border); background: var(--surface); }
  .qt-note h3 { font-size: 15px; margin: 0 0 8px; color: var(--ink); }
  .qt-note p, .qt-note li { font-size: 13px; line-height: 1.55; color: var(--ink-soft); overflow-wrap: anywhere; }
  .qt-note ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
  .qt-note--warn { border-color: var(--warn); background: var(--warn-bg); }

  .qt-empty { color: var(--muted); font-size: 14px; line-height: 1.6; margin: 0; }
  /* Over-limit rows: outline + faint tint, never a bright fill. */
  .qh-table tbody tr.is-over td { box-shadow: inset 0 1px 0 var(--warn), inset 0 -1px 0 var(--warn); background: var(--warn-bg); }
  .qh-table td.num, .qh-table th.num { text-align: right; font-family: var(--font-mono); white-space: nowrap; }

  @media (max-width: 980px) {
    .qt-grid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .qt-stats { grid-template-columns: minmax(0, 1fr); }
    .qt-actions { grid-template-columns: minmax(0, 1fr); }
  }
`;

// ── The client ─────────────────────────────────────────────────────────────
//
// One script serves both pages. `window.QT_MODE` decides whether the state
// selector is rendered and which endpoint is called; everything else — the
// axle editor, the group table, the headroom column — is identical, because it
// is the same computation.

function toolScript(mode: 'bridge' | 'axle'): string {
  return `<script>
(function(){
  var MODE = ${JSON.stringify(mode)};
  var ENDPOINT = MODE === 'bridge' ? '/api/tools/bridge-formula' : '/api/tools/axle-weights';
  var PRESETS = ${JSON.stringify(AXLE_PRESETS)};
  var axles = PRESETS[0].axles.map(function(a){ return { positionFt: a.positionFt, weightLbs: a.weightLbs, label: a.label }; });
  var activePreset = PRESETS[0].id;
  var firstRun = true;
  /**
   * THE FIRST RESULT IS COMPUTED ON THE SERVER AND SHIPPED WITH THE PAGE.
   *
   * It used to be fetched on load, and that was wrong three ways: a reader met
   * a "Checking…" flash before the tool said anything, every page view spent a
   * round trip to answer a question nobody had asked yet, and — the one that
   * actually bites — every view consumed a slot in the shared public-calculator
   * rate limit, so a crawler walking this page could throttle real users behind
   * the same egress address. Seeding the SAME renderer with a precomputed
   * payload removes all three without duplicating the renderer.
   */
  var seeded = null;
  try {
    var seedEl = document.getElementById('qt-initial');
    if (seedEl) seeded = JSON.parse(seedEl.textContent || 'null');
  } catch (e) { seeded = null; }

  function el(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }
  function lb(n){ return Number(n).toLocaleString('en-US') + ' lb'; }

  function renderAxles(){
    var wrap = el('qt-axles');
    if (!wrap) return;
    wrap.innerHTML = axles.map(function(a, i){
      return '<div class="qt-axle">'
        + '<label class="qt-field"><input type="number" step="0.01" min="0" inputmode="decimal" data-i="' + i + '" data-k="positionFt" value="' + a.positionFt + '" aria-label="Axle ' + (i+1) + ' position in feet from the steer axle"><span class="qt-lab">Axle ' + (i+1) + (a.label ? ' (' + esc(a.label) + ')' : '') + ' — ft from steer</span></label>'
        + '<label class="qt-field"><input type="number" step="100" min="0" inputmode="numeric" data-i="' + i + '" data-k="weightLbs" value="' + a.weightLbs + '" aria-label="Axle ' + (i+1) + ' weight in pounds"><span class="qt-lab">Weight (lb)</span></label>'
        + '<button type="button" class="qt-drop" data-drop="' + i + '" aria-label="Remove axle ' + (i+1) + '"' + (axles.length <= 2 ? ' disabled' : '') + '>&times;</button>'
        + '</div>';
    }).join('');
    var add = el('qt-add');
    if (add) add.disabled = axles.length >= ${MAX_AXLES};
  }

  function renderPresets(){
    var wrap = el('qt-presets');
    if (!wrap) return;
    wrap.innerHTML = PRESETS.map(function(p){
      return '<button type="button" class="qt-pill" data-preset="' + esc(p.id) + '" aria-pressed="' + (p.id === activePreset) + '" title="' + esc(p.hint) + '">' + esc(p.label) + '</button>';
    }).join('');
  }

  function groupsTable(groups){
    if (!groups.length) return '';
    var rows = groups.map(function(g){
      var over = g.headroomLbs < 0;
      return '<tr' + (over ? ' class="is-over"' : '') + '>'
        + '<td class="qh-st">Axles ' + g.firstAxle + '&ndash;' + g.lastAxle + '</td>'
        + '<td class="num">' + g.axleCount + '</td>'
        + '<td class="num">' + g.spanFt.toFixed(2).replace(/\\.?0+$/, '') + ' ft</td>'
        + '<td class="num">' + lb(g.actualLbs) + '</td>'
        + '<td class="num">' + lb(g.allowedLbs) + '</td>'
        + '<td class="num">' + (over ? '&minus;' + lb(-g.headroomLbs) : lb(g.headroomLbs)) + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="qh-tablewrap"><table class="qh-table"><thead><tr>'
      + '<th class="qh-st">Group</th><th class="num">Axles</th><th class="num">Span</th><th class="num">Carries</th><th class="num">Allowed</th><th class="num">Headroom</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function stateTable(state){
    if (!state) return '';
    var rows = state.lines.map(function(l){
      if (l.conflict) {
        return '<tr class="is-over"><td class="qh-st">' + esc(l.label) + '</td><td>' + esc(l.actual) + '</td>'
          + '<td class="is-conflict"><span class="qh-v">Sources disagree</span><span class="qh-rev">'
          + l.conflict.map(function(c){ return esc(c.text) + ' per <a href="' + esc(c.url) + '" rel="noopener" target="_blank">' + esc(c.title) + '</a>'; }).join(' &mdash; versus &mdash; ')
          + '</span></td><td>Cannot tell</td></tr>';
      }
      if (l.limit === null) {
        return '<tr><td class="qh-st">' + esc(l.label) + '</td><td>' + esc(l.actual) + '</td><td><span class="qh-none">Not on file</span></td><td>Cannot tell</td></tr>';
      }
      var cite = '<span class="qh-v"><a href="' + esc(l.sourceUrl) + '" rel="noopener" target="_blank" title="' + esc(l.cite || l.sourceTitle) + '">' + esc(l.limit) + '</a></span><span class="qh-rev">' + esc((l.revisedOn ? 'rev. ' + l.revisedOn : 'undated document') + ' \\u00b7 read ' + l.retrievedOn) + '</span>';
      return '<tr' + (l.verdict === 'over' ? ' class="is-over"' : '') + '><td class="qh-st">' + esc(l.label) + '</td><td>' + esc(l.actual) + '</td><td>' + cite + '</td><td>' + (l.verdict === 'over' ? 'Over &mdash; permit needed' : 'Under') + '</td></tr>';
    }).join('');
    return '<div class="qt-note"><h3>' + esc(state.name) + ' legal limits</h3>'
      + '<div class="qh-tablewrap"><table class="qh-table"><thead><tr><th class="qh-st">Limit</th><th>This rig</th><th>' + esc(state.name) + ' limit</th><th>Verdict</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function render(r){
    var out = el('qt-out');
    if (!out) return;
    var worst = null;
    r.violations.forEach(function(v){ if (!worst || v.overageLbs > worst.overageLbs) worst = v; });
    var html = '<div class="qt-verdict' + (r.compliant ? '' : ' is-over') + '" id="qt-verdict" tabindex="-1">'
      + '<p class="qt-vl">Federal bridge formula</p>'
      + '<p class="qt-vv">' + (r.compliant ? 'Compliant' : r.violations.length + ' violation' + (r.violations.length === 1 ? '' : 's')) + '</p>'
      + '<p class="qt-vs">' + (r.compliant
          ? 'All ' + r.groupsChecked + ' groups of two or more consecutive axles are within the formula, and the rig clears the flat federal single-axle, tandem and gross limits.'
          : (worst ? esc(worst.description) : '')) + '</p>'
      + '<div class="qt-stats">'
      + '<div class="qt-stat"><span class="k">Gross weight</span><span class="v">' + lb(r.grossWeightLbs) + '</span></div>'
      + '<div class="qt-stat"><span class="k">Outer wheelbase</span><span class="v">' + r.overallLengthFt.toFixed(2).replace(/\\.?0+$/, '') + ' ft</span></div>'
      + '<div class="qt-stat"><span class="k">Axles</span><span class="v">' + r.axleCount + '</span></div>'
      + '<div class="qt-stat"><span class="k">Groups checked</span><span class="v">' + r.groupsChecked + '</span></div>'
      + '</div></div>';

    if (r.violations.length) {
      html += '<div class="qt-note qt-note--warn"><h3>Every group that is over</h3><ul>'
        + r.violations.map(function(v){ return '<li>' + esc(v.description) + '</li>'; }).join('')
        + '</ul></div>';
    }
    if (r.warnings.length) {
      html += '<div class="qt-note qt-note--warn"><h3>Read this before you dispatch</h3><ul>'
        + r.warnings.map(function(w){ return '<li>' + esc(w) + '</li>'; }).join('')
        + '</ul></div>';
    }
    html += '<div class="qt-note"><h3>Every group of two or more consecutive axles</h3>'
      + '<p>All ' + r.groupsChecked + ' of them, not the obvious three. Headroom is what is left before that group is over.</p>'
      + groupsTable(r.groups) + '</div>';
    html += stateTable(r.state);
    html += '<div class="qt-note"><h3>What this does not answer</h3><ul>'
      + r.notIncluded.map(function(n){ return '<li>' + esc(n) + '</li>'; }).join('')
      + '</ul></div>';
    out.innerHTML = html;
    // Move focus to the verdict ONLY when the reader asked for it. The page
    // computes its preset on load so nobody meets an empty tool, and grabbing
    // focus for that first automatic run would move the caret and paint a focus
    // ring on a result the reader never requested.
    if (!firstRun) {
      var v = el('qt-verdict');
      if (v) v.focus({ preventScroll: false });
    }
    firstRun = false;
  }

  function submit(){
    var btn = el('qt-run');
    var out = el('qt-out');
    if (btn) btn.disabled = true;
    if (out) out.innerHTML = '<p class="qt-empty">Checking every axle group&hellip;</p>';
    var body = { axles: axles.map(function(a){ return { positionFt: Number(a.positionFt), weightLbs: Number(a.weightLbs), label: a.label }; }) };
    var sel = el('qt-state');
    if (MODE === 'axle' && sel && sel.value) body.state = sel.value;
    fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(res){ return res.json().then(function(j){ return { ok: res.ok, j: j }; }); })
      .then(function(x){
        if (!x.ok) { if (out) out.innerHTML = '<div class="qt-note qt-note--warn"><h3>That did not check out</h3><p>' + esc(x.j && x.j.error ? x.j.error : 'The axle layout could not be read.') + '</p></div>'; return; }
        render(x.j);
      })
      .catch(function(){ if (out) out.innerHTML = '<div class="qt-note qt-note--warn"><h3>Could not reach the calculator</h3><p>The request failed. Check the connection and try again.</p></div>'; })
      .then(function(){ if (btn) btn.disabled = false; });
  }

  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t || !t.closest) return;
    var preset = t.closest('[data-preset]');
    if (preset) {
      var p = PRESETS.filter(function(x){ return x.id === preset.getAttribute('data-preset'); })[0];
      if (p) { axles = p.axles.map(function(a){ return { positionFt: a.positionFt, weightLbs: a.weightLbs, label: a.label }; }); activePreset = p.id; renderPresets(); renderAxles(); }
      return;
    }
    var drop = t.closest('[data-drop]');
    if (drop) { var i = Number(drop.getAttribute('data-drop')); if (axles.length > 2) { axles.splice(i, 1); renderAxles(); } return; }
    if (t.closest('#qt-add')) {
      var last = axles[axles.length - 1];
      axles.push({ positionFt: Number(last.positionFt) + 4.33, weightLbs: last.weightLbs, label: '' });
      renderAxles();
      return;
    }
    if (t.closest('#qt-run')) { submit(); return; }
    var cue = t.closest('.qt-cue');
    if (cue) {
      var target = document.getElementById(cue.getAttribute('aria-controls'));
      if (target) { target.classList.toggle('is-open'); cue.setAttribute('aria-expanded', target.classList.contains('is-open') ? 'true' : 'false'); }
    }
  });

  document.addEventListener('input', function(e){
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var i = t.getAttribute('data-i');
    var k = t.getAttribute('data-k');
    if (i === null || k === null) return;
    axles[Number(i)][k] = t.value === '' ? 0 : Number(t.value);
  });

  renderPresets();
  renderAxles();
  if (seeded) { render(seeded); } else { submit(); }
})();
</script>`;
}

// ── The pages ──────────────────────────────────────────────────────────────

/**
 * The first preset's result, precomputed. Serialised into the page so the
 * client renders it immediately — see the client's `seeded` comment for why
 * this is not a fetch.
 */
function seedScript(): string {
  const seed = evaluateAxles({ axles: [...(AXLE_PRESETS[0] as AxlePreset).axles] });
  // A literal `<` inside the JSON could close the tag early — a `</script>`
  // in a source title would be enough. Escaping it as a JSON unicode sequence
  // is the standard fix: the bytes are inert in the document, and JSON.parse
  // reads the sequence straight back as `<`.
  const json = JSON.stringify(seed).replace(/</g, '\\u003c');
  return `<script type="application/json" id="qt-initial">${json}</script>`;
}

function formHtml(mode: 'bridge' | 'axle'): string {
  const stateField =
    mode === 'axle'
      ? `<div class="qt-card">
           <div class="qt-sec">
             <button type="button" class="qt-cue" aria-controls="qt-cue-state" aria-expanded="false" aria-label="About the state limits">?</button>
             <h2>State limits</h2>
           </div>
           <div class="qt-cue-body" id="qt-cue-state">Only the ${HUB_COVERED_STATES.length} states with a jurisdiction file are offered. Each verdict line carries the statute or rule it came from, that document's own revision date, and the date we read it. Where two of a state's own documents disagree, the line says so and refuses to pick a side.</div>
           <div class="qt-stack">
             <label class="qt-field">
               <select id="qt-state" aria-label="State to check against">
                 <option value="">Federal limits only</option>
                 ${HUB_COVERED_STATES.map((s) => `<option value="${esc(s.code)}">${esc(s.name)}</option>`).join('')}
               </select>
               <span class="qt-lab">State</span>
             </label>
           </div>
         </div>`
      : '';

  return `<div class="qt-card">
      <div class="qt-sec">
        <button type="button" class="qt-cue" aria-controls="qt-cue-preset" aria-expanded="false" aria-label="About the presets">?</button>
        <h2>Start from a common rig</h2>
      </div>
      <div class="qt-cue-body" id="qt-cue-preset">Four real configurations, not demonstrations. Pick the closest and then edit the positions and weights — a preset only fills the form.</div>
      <div class="qt-pills" id="qt-presets"></div>
    </div>
    <div class="qt-card">
      <div class="qt-sec">
        <button type="button" class="qt-cue" aria-controls="qt-cue-axles" aria-expanded="false" aria-label="How to measure axle positions">?</button>
        <h2>Axles, front to rear</h2>
      </div>
      <div class="qt-cue-body" id="qt-cue-axles">Position is the distance in feet from the steer axle, so the first axle is always 0. Measure centre to centre, and for a wheel cluster use the centre of the cluster. Weight is what that axle actually carries, not its rating.</div>
      <div class="qt-axles" id="qt-axles"></div>
      <div class="qt-actions">
        <button type="button" class="btn btn-secondary" id="qt-add">Add an axle</button>
        <button type="button" class="btn btn-primary" id="qt-run">Check the rig</button>
      </div>
      <p class="qt-hint">Up to ${MAX_AXLES} axles. Positions must increase front to rear; the calculator refuses to compute on impossible geometry rather than returning a number.</p>
    </div>
    ${stateField}`;
}

export function renderBridgeToolPage(): string {
  const faqs = [
    {
      q: 'How many axle groups does this check?',
      a: 'Every group of two or more consecutive axles — N(N−1)/2 of them. A five-axle tractor-semitrailer has ten groups; a nine-axle heavy haul has thirty-six. The count is shown in the result so you can see it rather than take it on trust.',
    },
    {
      q: 'Why does my legal 5-axle van pass with 34,000 lb on each tandem?',
      a: `Because of a statutory exception: two consecutive sets of tandem axles may each carry 34,000 lb — ${TANDEM_PAIR_EXCEPTION_TEXT} — provided the outer axles of the two tandems are at least 36 ft apart. The bare formula at that geometry allows only 66,000, so a calculator implementing the formula alone flags every legal van in the country.`,
    },
    {
      q: 'Does this work above 80,000 lb?',
      a: 'Yes, and that is deliberate. A group\'s bridge-formula allowance is capped by the vehicle\'s own gross weight, not by the federal 80,000 lb limit — clamping it at 80,000 fabricates overages of up to 25,500 lb on permitted heavy-haul loads whose groups are in fact compliant. The federal gross limit is still enforced, once, as a limit on the vehicle.',
    },
    {
      q: 'Does passing mean I need no permit?',
      a: 'Not on its own. This checks weight against federal limits. Size limits are set by each state, and several states publish axle or gross figures different from the federal ones. Use the axle weight checker to bring a state\'s own cited limits into the answer.',
    },
  ];

  const body = `<div class="qt-grid">
      <div>${formHtml('bridge')}</div>
      <div id="qt-out"><p class="qt-empty">Loading the calculator&hellip;</p></div>
    </div>
    ${seedScript()}
    <section class="qh-sec" id="how" style="margin-top:32px">
      <h2>How the answer is reached</h2>
      <p>Three checks, in order. Each single axle against the federal ${FEDERAL_SINGLE_AXLE_LIMIT_LBS.toLocaleString('en-US')} lb limit. Then every group of two or more consecutive axles against the bridge formula, with the tandem cap applied by span and the two-tandem exception applied by geometry. Then the whole vehicle against the federal ${FEDERAL_GROSS_WEIGHT_LIMIT_LBS.toLocaleString('en-US')} lb gross limit.</p>
      <p>The result is rounded to the nearest 500 lb with exact ties going <em>down</em>, which is what the statute and the published federal table both do — ordinary rounding sends halves up and would permit 500 lb the law does not.</p>
      <p><a href="${OSOW_HUB_PATH}/bridge-formula">The formula, the full table and the five cells where the published federal table contradicts the federal formula →</a></p>
    </section>
    <section class="qh-sec" id="next">
      <h2>Once you know you need a permit</h2>
      <ul>
        <li><a href="${AXLE_TOOL_PATH}">Check the same rig against a specific state's cited axle and gross limits</a></li>
        <li><a href="${OSOW_TOOL}">Price the permit across a multi-state lane</a></li>
        <li><a href="${OSOW_HUB_PATH}/escort-requirements">Find out whether it needs a pilot car</a> — usually the larger number</li>
      </ul>
    </section>
    <section class="qh-sec" id="faq"><h2>Questions</h2><div class="qh-faq">${faqs
      .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
      .join('')}</div></section>`;

  return hubPage({
    title: 'Federal Bridge Formula Calculator (Free, No Account) | QuoteFleet',
    description:
      'Check any axle layout against the Federal Bridge Formula — every group of two or more consecutive axles, not just the obvious three — with the headroom left on each group. Free, no sign-up, works above 80,000 lb.',
    path: BRIDGE_TOOL_PATH,
    crumbs: [{ name: 'Free tools', path: '/tools' }, { name: 'Bridge formula calculator' }],
    eyebrow: 'Free calculator · no account needed',
    h1: 'Federal bridge formula calculator',
    lead: 'Type the axle positions and weights. Every group of two or more consecutive axles is checked — all of them — with the headroom left on each one.',
    rail: [
      { id: 'how', label: 'How the answer is reached' },
      { id: 'next', label: 'What comes next' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    extraCss: TOOL_CSS,
    extraScripts: toolScript('bridge'),
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Free tools', path: '/tools' },
        { name: 'Bridge formula calculator', path: BRIDGE_TOOL_PATH },
      ]),
      jsonLdWebApplication({
        name: 'Federal Bridge Formula Calculator',
        description:
          'Checks an axle layout against 23 U.S.C. §127(a), testing every group of two or more consecutive axles.',
        path: BRIDGE_TOOL_PATH,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

const TANDEM_PAIR_EXCEPTION_TEXT = '68,000 lb between them';

export function renderAxleToolPage(): string {
  const faqs = [
    {
      q: 'What is different from the bridge formula calculator?',
      a: `This one brings a state's own limits into the answer. Pick one of the ${HUB_COVERED_STATES.length} covered states and the heaviest single axle, the heaviest tandem group and the gross are checked against that state's published figures, each verdict line carrying the rule and its revision date.`,
    },
    {
      q: 'Why does a state limit sometimes say "sources disagree"?',
      a: 'Because two of that state\'s own official documents give different figures and both are in effect. Neither has been adopted here — the line shows both with their citations and the verdict reads "cannot tell", which is the honest answer and the one that sends the question to the permit office rather than to a coin toss.',
    },
    {
      q: 'What does the headroom column tell me?',
      a: 'How much more that group could carry before it is over. A pass/fail says nothing about whether shifting a thousand pounds of freight breaks the rig, and the group with the least headroom is the one that decides how the load can be re-secured.',
    },
    {
      q: 'Does a state pass mean the whole route is legal?',
      a: 'No. Seasonal weight restrictions are posted road by road and can make a legal axle group illegal on a specific route in March, and local bridge postings are not in any statewide figure. Both are named in the "what this does not answer" list on the result.',
    },
  ];

  const body = `<div class="qt-grid">
      <div>${formHtml('axle')}</div>
      <div id="qt-out"><p class="qt-empty">Loading the calculator&hellip;</p></div>
    </div>
    ${seedScript()}
    <section class="qh-sec" id="how" style="margin-top:32px">
      <h2>What the verdict lines mean</h2>
      <p>Each state line compares one measurement from your rig against that state's published limit. The measurement is derived, not typed: the heaviest single axle is the heaviest one you entered, and the heaviest tandem group is the heaviest group spanning ${TANDEM_MAX_SPACING_FT} ft or less — the span that makes a group a tandem under federal law.</p>
      <p>Every limit links to the document it came from and carries two dates: the revision date the document itself states, and the date we retrieved it. They are different facts and a single "last updated" stamp would hide the difference — a schedule downloaded this morning can still be five years old.</p>
      <p><a href="${OSOW_HUB_PATH}/legal-limits">Compare legal limits across all states →</a></p>
    </section>
    <section class="qh-sec" id="next">
      <h2>What comes next</h2>
      <ul>
        <li><a href="${OSOW_TOOL}">Price the permit across a multi-state lane</a></li>
        <li><a href="${OSOW_HUB_PATH}/escort-requirements">Check whether it needs a pilot car</a></li>
        <li><a href="${OSOW_HUB_PATH}/superloads">Check whether it is a superload</a> — above that line there is usually no published fee at all</li>
      </ul>
    </section>
    <section class="qh-sec" id="faq"><h2>Questions</h2><div class="qh-faq">${faqs
      .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
      .join('')}</div></section>`;

  return hubPage({
    title: 'Axle Weight Calculator by State (Free, Cited) | QuoteFleet',
    description: `Check an axle layout against the federal bridge formula and a state's own single-axle, tandem and gross limits — with the statute and its revision date on every verdict line. ${HUB_COVERED_STATES.length} states, free, no account.`,
    path: AXLE_TOOL_PATH,
    crumbs: [{ name: 'Free tools', path: '/tools' }, { name: 'Axle weight checker' }],
    eyebrow: 'Free calculator · no account needed',
    h1: 'Axle weight checker',
    lead: `The federal bridge formula on every axle group, plus a state's own axle and gross limits — each verdict line carrying the statute behind it and the date that document was revised.`,
    rail: [
      { id: 'how', label: 'What the lines mean' },
      { id: 'next', label: 'What comes next' },
      { id: 'faq', label: 'Questions' },
    ],
    bodyHtml: body,
    extraCss: TOOL_CSS,
    extraScripts: toolScript('axle'),
    jsonLd: [
      jsonLdBreadcrumb([
        { name: 'Free tools', path: '/tools' },
        { name: 'Axle weight checker', path: AXLE_TOOL_PATH },
      ]),
      jsonLdWebApplication({
        name: 'Axle Weight Checker',
        description:
          "Checks an axle layout against the federal bridge formula and a state's own cited single-axle, tandem and gross weight limits.",
        path: AXLE_TOOL_PATH,
      }),
      jsonLdFaq(faqs),
    ],
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerOsowToolRoutes(app: Express) {
  app.get([BRIDGE_TOOL_PATH, `${BRIDGE_TOOL_PATH}/`], (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderBridgeToolPage());
    } catch (err) {
      next(err);
    }
  });

  app.get([AXLE_TOOL_PATH, `${AXLE_TOOL_PATH}/`], (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderAxleToolPage());
    } catch (err) {
      next(err);
    }
  });

  const handler = (req: Request, res: Response) => {
    const parsed = RequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error:
          'Supply between 2 and 13 axles, each with a position in feet from the steer axle and a weight in pounds.',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    return res.json(evaluateAxles(parsed.data));
  };

  app.post('/api/tools/bridge-formula', publicCalcLimiter, handler);
  app.post('/api/tools/axle-weights', publicCalcLimiter, handler);
}
