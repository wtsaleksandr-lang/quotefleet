/**
 * THE OS/OW HUB'S GUARD TESTS.
 *
 * These do not test that HTML renders — the smoke suite does that. They test
 * the four claims the hub's whole value rests on, each of which is exactly the
 * kind of thing that regresses silently:
 *
 *   1. **`src/calc/osow` is read, never written.** The hub is a rendering layer,
 *      and the moment a page needs a value the engine does not have, the
 *      temptation is to add it in the page. The test asserts that no module
 *      under `src/server/osow` writes into the calc tree.
 *   2. **No page invents a value.** Every rendered figure traces to a
 *      `SourceDoc`, and an unresolved field renders as one of three distinct
 *      absences rather than as a blank or a guess.
 *   3. **A conflict stays a conflict.** `resolveSourced` refuses to pick when
 *      two in-effect documents disagree, and the hub must render that refusal
 *      rather than quietly choosing the newer one.
 *   4. **`dateModified` is traceable.** It is `max(retrievedOn)` over the
 *      sources actually on the page, never a deploy timestamp — the one lie
 *      that would cost the pages their entire differentiator.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESCORT_TRIGGER_MEASURES,
  HUB_COVERED_STATES,
  HUB_STATES,
  LEGAL_LIMIT_COLUMNS,
  allBandConflicts,
  allConflictEntries,
  collectSources,
  conflictEntriesFor,
  corpusProvenance,
  escortRows,
  hubStateBySlug,
  legalLimitRows,
  namedGaps,
  permitFeeRows,
  policeRows,
  provenanceFor,
  superloadRows,
} from './hubData.js';
import type { HubCell } from './hubData.js';
import { renderCell } from './hubShell.js';
import {
  renderCoverage,
  renderEscortRequirements,
  renderHub,
  renderLegalLimits,
  renderPermitFees,
  renderPoliceEscorts,
  renderSourceNotes,
  renderStatePage,
  renderSuperloads,
} from './hubPages.js';
import {
  bridgeTableRows,
  renderBridgeFormulaExplainer,
  renderCommonFigures,
  renderFederalLimits,
  renderNonDivisible,
} from './federalPages.js';
import { OSOW_JURISDICTIONS } from '../../calc/osow/jurisdictions/index.js';
import { FHWA_TABLE_ERRATA, groupMaxWeightLbs } from '../../calc/osow/bridgeFormula.js';

const ASOF = '2026-09-05';

describe('hub coverage', () => {
  it('covers exactly the states with a jurisdiction file, and no others', () => {
    expect(HUB_COVERED_STATES.map((s) => s.code).sort()).toEqual(
      Object.keys(OSOW_JURISDICTIONS).sort(),
    );
  });

  /**
   * PHASE 9. The hub walks `SourceDoc`s structurally, so a new jurisdiction is
   * picked up for free — but "for free" is a claim, and this is the assertion
   * that makes it one. All four cross-state tables must carry a real row for
   * each of the three states added, and the two new structural fields must
   * reach the conflicts page rather than being visible only inside a quote.
   */
  it('renders all twenty-four covered states in every cross-state table', () => {
    expect(HUB_COVERED_STATES).toHaveLength(24);
    for (const code of ['MI', 'MS', 'SC']) {
      expect(HUB_COVERED_STATES.some((s) => s.code === code), code).toBe(true);
      const limits = legalLimitRows(ASOF).find((r) => r.state.code === code)!;
      expect(limits.width.text, `${code} width`).not.toBeNull();
      expect(limits.height.text, `${code} height`).not.toBeNull();
      const fees = permitFeeRows(ASOF).find((r) => r.state.code === code)!;
      expect(fees.base.text, `${code} base fee`).not.toBeNull();
      expect(fees.overweightMechanism.text, `${code} overweight mechanism`).not.toBeNull();
      const escorts = escortRows(ASOF).find((r) => r.state.code === code)!;
      expect(escorts.ruleCount, `${code} escort rules`).toBeGreaterThan(0);
      expect(superloadRows(ASOF).some((r) => r.state.code === code), code).toBe(true);
      // And the state page renders without throwing.
      const page = renderStatePage(HUB_COVERED_STATES.find((s) => s.code === code)!, ASOF);
      expect(page.length, code).toBeGreaterThan(2000);
    }

    // Michigan publishes no gross-weight superload threshold: the cell says
    // "none published", which is a finding, not our gap.
    const mi = superloadRows(ASOF).find((r) => r.state.code === 'MI')!;
    expect(mi.gross.absence).toBe('not-published');
      expect(mi.width.text).toBe("over 16'");
    // Mississippi's contradicts itself, so the cell shows both readings.
    const ms = superloadRows(ASOF).find((r) => r.state.code === 'MS')!;
    expect(ms.gross.absence).toBe('conflict');
    expect(ms.gross.conflict).toHaveLength(2);
    // South Carolina resolves cleanly.
    const sc = superloadRows(ASOF).find((r) => r.state.code === 'SC')!;
    expect(sc.gross.text).toBe('over 130,000 lb');

    // The two Phase 9 structural fields reach the conflicts page. Michigan's
    // statute and MDOT's T-1 print the same axle table with two different
    // answers, and that must be visible here as well as inside a quote.
    const miConflicts = conflictEntriesFor(
      HUB_COVERED_STATES.find((s) => s.code === 'MI')!,
      ASOF,
    ).map((c) => c.field);
    expect(miConflicts).toContain('axle-load table by axle spacing');
    // Mississippi's 80,000-vs-57,650 gross disagreement, likewise.
    const msConflicts = conflictEntriesFor(
      HUB_COVERED_STATES.find((s) => s.code === 'MS')!,
      ASOF,
    ).map((c) => c.field);
    expect(msConflicts).toContain('legal gross weight');
  });

  it('lists the 50 states plus DC and no territories', () => {
    expect(HUB_STATES).toHaveLength(51);
    for (const t of ['PR', 'VI', 'GU']) {
      expect(HUB_STATES.some((s) => s.code === t)).toBe(false);
    }
  });

  /**
   * THE HARD RULE FROM THE PLAN: no state page ships without a jurisdiction
   * file behind it. A page shaped like an answer that contains no thresholds is
   * the exact failure mode this whole hub was built to avoid, so it is a test
   * and not a convention.
   */
  it('resolves a slug only for a state with data behind it', () => {
    const wy = hubStateBySlug('wyoming');
    expect(wy).not.toBeNull();
    expect(wy?.covered).toBe(false);
    expect(hubStateBySlug('texas')?.covered).toBe(true);
    expect(hubStateBySlug('not-a-state')).toBeNull();
  });
});

describe('provenance', () => {
  it('finds source documents wherever they sit in the model', () => {
    const p = corpusProvenance();
    expect(p.count).toBeGreaterThan(150);
    expect(p.lastRetrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.oldestRevision).not.toBeNull();
  });

  it('does not double-count a document reachable by two paths', () => {
    const doc = {
      id: 'dup',
      title: 't',
      url: 'https://example.gov/x',
      publisher: 'p',
      revisedOn: '2020-01-01',
      retrievedOn: '2026-01-01',
    };
    const found = collectSources({ a: doc, b: [doc, { nested: doc }] });
    expect(found.size).toBe(1);
  });

  /**
   * `dateModified` MUST be `max(retrievedOn)` over the sources on the page. A
   * deploy timestamp would be a freshness claim we cannot substantiate per
   * fact, which is the one lie that costs the pages their differentiator.
   */
  it('derives every page date from a retrieval date, never from now', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const html of [
      renderHub(ASOF),
      renderLegalLimits(ASOF),
      renderPermitFees(ASOF),
      renderEscortRequirements(ASOF),
      renderSuperloads(ASOF),
      renderStatePage(HUB_COVERED_STATES[0]!, ASOF),
    ]) {
      const m = /<meta name="last-modified" content="([^"]+)"/.exec(html);
      expect(m).not.toBeNull();
      const stamp = m![1] as string;
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // THE STAMP MUST BE A RETRIEVAL DATE THE CORPUS ACTUALLY HOLDS, and the
      // way to assert that is to require it to BE one — not to require it to be
      // in the past. Phase 9 broke the older `stamp < today` form on the day it
      // landed: Michigan, Mississippi and South Carolina were retrieved on
      // 2026-09-05 and the pages correctly stamped 2026-09-05, so a test that
      // demanded yesterday would have been satisfied only by back-dating three
      // datasets. Matching against the retrieval dates on file is the stronger
      // check anyway — a deploy timestamp fails it on any day the corpus was
      // not read, instead of only on days after the last research drop.
      const retrievals = new Set(
        [...collectSources(OSOW_JURISDICTIONS).values()].map((d) => d.retrievedOn),
      );
      expect(retrievals.has(stamp), `${stamp} is not a retrieval date on file`).toBe(true);
      expect(stamp <= today).toBe(true);
    }
  });
});

describe('cells never invent a value', () => {
  const allCells = (): HubCell[] => {
    const out: HubCell[] = [];
    for (const r of legalLimitRows(ASOF)) {
      for (const c of LEGAL_LIMIT_COLUMNS) out.push(r[c.key]);
    }
    for (const r of permitFeeRows(ASOF)) {
      out.push(r.base, r.overweightMechanism, r.transaction, r.routeAnalysis);
    }
    for (const r of superloadRows(ASOF)) {
      out.push(r.gross, r.width, r.height, r.length, r.shortSpacing);
    }
    return out;
  };

  it('gives every value a source document, or an explicit reason it has none', () => {
    for (const cell of allCells()) {
      if (cell.text === null) {
        expect(['no-data', 'not-published', 'conflict']).toContain(cell.absence);
        if (cell.absence === 'conflict') {
          expect(cell.conflict?.length ?? 0).toBeGreaterThan(1);
        }
      } else {
        expect(cell.source?.url).toMatch(/^https?:\/\//);
        expect(cell.source?.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('renders an uncovered state as "not yet covered", never as a blank', () => {
    const wy = legalLimitRows(ASOF).find((r) => r.state.code === 'WY');
    expect(wy).toBeDefined();
    for (const c of LEGAL_LIMIT_COLUMNS) {
      expect(wy![c.key].text).toBeNull();
      expect(wy![c.key].absence).toBe('no-data');
      expect(renderCell(wy![c.key])).toContain('Not yet covered');
    }
  });

  /**
   * The three absences mean different things to a dispatcher and must not
   * render identically. "None published" is a finding about the state; "not yet
   * covered" is a gap of ours; "sources disagree" is two live documents.
   */
  it('renders the three absences distinguishably', () => {
    expect(renderCell({ text: null, absence: 'no-data' })).toContain('Not yet covered');
    expect(renderCell({ text: null, absence: 'not-published' })).toContain('None published');
    const doc = (id: string) => ({
      id,
      title: id,
      url: `https://example.gov/${id}`,
      publisher: 'p',
      revisedOn: '2020-01-01',
      retrievedOn: '2026-01-01',
    });
    const html = renderCell({
      text: null,
      absence: 'conflict',
      conflict: [
        { text: '$8', source: doc('a') },
        { text: '$10', source: doc('b') },
      ],
    });
    expect(html).toContain('Sources disagree');
    expect(html).toContain('$8');
    expect(html).toContain('$10');
    expect(html).toContain('is-conflict');
  });
});

describe('conflicts are held open, not adjudicated', () => {
  it('finds live disagreements across the covered states', () => {
    const conflicts = allConflictEntries(ASOF);
    expect(conflicts.length).toBeGreaterThan(5);
    for (const c of conflicts) {
      expect(c.candidates.length).toBeGreaterThan(1);
      const texts = new Set(c.candidates.map((x) => x.text));
      expect(texts.size).toBeGreaterThan(1);
      for (const cand of c.candidates) expect(cand.source.url).toMatch(/^https?:\/\//);
    }
  });

  /**
   * Louisiana's $8-versus-$10 and Pennsylvania's statutory-versus-current fee
   * live inside `oversizeFeeBands`, so they are invisible to a whole-list
   * resolve — the engine only sees them once a load has selected a band.
   * Grouping by the band's bounds reproduces that selection without a load,
   * and losing it would quietly drop the two best entries on the page.
   */
  it('surfaces band-level fee disagreements, which a whole-list resolve misses', () => {
    const bands = allBandConflicts(ASOF);
    expect(bands.length).toBeGreaterThan(0);
    expect(bands.some((b) => b.state.code === 'LA')).toBe(true);
    expect(bands.some((b) => b.state.code === 'PA')).toBe(true);
    for (const b of bands) {
      expect(new Set(b.candidates.map((c) => c.text)).size).toBeGreaterThan(1);
    }
  });

  it('carries the named gaps, each pointing at a real constant', () => {
    const gaps = namedGaps();
    expect(gaps.length).toBeGreaterThanOrEqual(5);
    for (const g of gaps) {
      expect(g.detail.length).toBeGreaterThan(40);
      expect(HUB_COVERED_STATES.some((s) => s.code === g.code)).toBe(true);
    }
    expect(gaps.some((g) => g.constantName === 'ARKANSAS_251_MILE_GAP')).toBe(true);
    expect(gaps.some((g) => g.constantName === 'WASHINGTON_999_POUND_GAP')).toBe(true);
  });

  it('shows the source-notes page every conflict and every gap', () => {
    const html = renderSourceNotes(ASOF);
    for (const g of namedGaps()) expect(html).toContain(g.constantName);
    for (const c of allConflictEntries(ASOF)) expect(html).toContain(c.field);
  });
});

describe('escort triggers', () => {
  it('derives a first-escort trigger from the rules, not from a column', () => {
    const rows = escortRows(ASOF).filter((r) => r.state.covered);
    const withWidth = rows.filter((r) => r.triggers.widthIn !== undefined);
    expect(withWidth.length).toBeGreaterThan(15);
    for (const r of withWidth) {
      const t = r.triggers.widthIn!;
      // Nobody requires an escort below 8 ft, and nobody waits past 20 ft.
      expect(t.value).toBeGreaterThan(96);
      expect(t.value).toBeLessThan(240);
      expect(t.rule.jurisdiction).toBe(r.state.code);
      expect(t.rule.source.url).toMatch(/^https?:\/\//);
    }
  });

  it('marks a trigger that only holds on some road classes', () => {
    const rows = escortRows(ASOF).filter((r) => r.state.covered);
    expect(rows.some((r) => r.triggers.widthIn?.routeDependent === true)).toBe(true);
  });

  it('renders every trigger measure as a column', () => {
    const html = renderEscortRequirements(ASOF);
    for (const m of ESCORT_TRIGGER_MEASURES) expect(html).toContain(`>${m.label}<`);
  });
});

describe('police escorts', () => {
  it('separates a published rate from a positive "nothing published" finding', () => {
    const rows = policeRows(ASOF);
    const priced = rows.filter((r) => r.rate !== null);
    const findings = rows.filter((r) => r.rate === null && r.finding !== null);
    expect(priced.length).toBeGreaterThan(3);
    expect(findings.length).toBeGreaterThan(10);
    // A state is one or the other, never both and never neither.
    for (const r of rows) expect(r.rate !== null || r.finding !== null).toBe(true);
  });

  it('renders both kinds of "no published rate", which are not the same fact', () => {
    const html = renderPoliceEscorts(ASOF);
    expect(html).toContain('No schedule exists');
    expect(html).toContain('Charges exist, nothing published');
  });
});

describe('the bridge formula pages', () => {
  it('reproduces the published table rather than the bare formula', () => {
    const rows = bridgeTableRows();
    const at = (span: number, n: number) =>
      rows.find((r) => r.spanFt === span)?.cells[[2, 3, 4, 5, 6, 7, 8, 9].indexOf(n)] ?? null;
    // The two-axle column flattens at 40,000 because two axles can never carry
    // more, even though the raw formula climbs past it.
    expect(at(11, 2)).toBe(40000);
    expect(at(20, 2)).toBe(40000);
    // Short spans are the statutory tandem limit, by span not by axle count.
    expect(at(8, 2)).toBe(34000);
    expect(at(8, 3)).toBe(34000);
    // And the table runs well past the federal gross limit.
    expect(at(60, 9)).toBe(105500);
  });

  it('follows the formula in the cells where the published table is wrong', () => {
    for (const e of FHWA_TABLE_ERRATA) {
      expect(groupMaxWeightLbs(e.spanFt, e.axleCount, Number.MAX_SAFE_INTEGER)).toBe(e.ourLbs);
      expect(e.ourLbs - e.publishedLbs).toBe(500);
    }
    const html = renderBridgeFormulaExplainer();
    for (const e of FHWA_TABLE_ERRATA) {
      expect(html).toContain(e.publishedLbs.toLocaleString('en-US'));
    }
  });
});

describe('the corrections page', () => {
  const html = renderCommonFigures(ASOF);

  /**
   * THE TONE RULE, AS A TEST. The claim is "here is what the statute says",
   * never "site X is wrong" — naming anyone would pass equity, invite a dispute
   * over content whose value is that it is impersonal, and make a factual page
   * an adversarial one.
   */
  it('names no competitor and links to none', () => {
    const forbidden = [
      'oversizeloadassistant',
      'wcspermits',
      'osowloads',
      'freightsidekick',
      'bahlogistics',
      'heavyhaulers',
      'truckinfo',
      'oversize.io',
    ];
    const lower = html.toLowerCase();
    for (const f of forbidden) expect(lower).not.toContain(f);
  });

  it('uses impersonal constructions rather than accusations', () => {
    expect(html).toMatch(/circulate|in circulation/i);
    expect(html).not.toMatch(/\bthey are wrong\b|\bincorrectly claims\b/i);
  });

  it('answers each figure with a dated citation from our own data', () => {
    expect(html).toContain('rev.');
    expect(html).toContain('read 20');
    // The superload entry has to state the real reason 80,000 is not the line.
    expect(html).toContain('80,000 lb');
  });

  it('publishes the mechanism, not only the corrected number', () => {
    expect(html).toMatch(/surcharge/i);
    expect(html).toMatch(/adjust/i);
  });
});

describe('the pages themselves', () => {
  const pages: Array<[string, string]> = [
    ['hub', renderHub(ASOF)],
    ['coverage', renderCoverage(ASOF)],
    ['legal limits', renderLegalLimits(ASOF)],
    ['permit fees', renderPermitFees(ASOF)],
    ['escorts', renderEscortRequirements(ASOF)],
    ['superloads', renderSuperloads(ASOF)],
    ['police escorts', renderPoliceEscorts(ASOF)],
    ['source notes', renderSourceNotes(ASOF)],
    ['common figures', renderCommonFigures(ASOF)],
    ['federal limits', renderFederalLimits()],
    ['bridge formula', renderBridgeFormulaExplainer()],
    ['non-divisible', renderNonDivisible()],
    ...HUB_COVERED_STATES.map(
      (s) => [`state:${s.code}`, renderStatePage(s, ASOF)] as [string, string],
    ),
  ];

  it.each(pages)('%s has one H1, a canonical and a breadcrumb', (_name, html) => {
    expect((html.match(/<h1[ >]/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/quotefleet\.net\//);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  /**
   * The page's own test, from the plan: at least one primary citation with a
   * date. A page without one is a row on a table, not a page.
   */
  it.each(pages)('%s carries at least one dated primary citation', (_name, html) => {
    expect(html).toMatch(/(rev\.\s*\d{4}|FHWA|23 CFR|23 U\.S\.C\.)/);
  });

  it.each(pages)('%s emits only valid JSON-LD', (_name, html) => {
    const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const json = b.replace(/^<script type="application\/ld\+json">/, '').replace(/<\/script>$/, '');
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  it.each(pages)('%s wraps every table in its own horizontal scroller', (_name, html) => {
    const tables = (html.match(/<table/g) ?? []).length;
    const wraps = (html.match(/class="qh-tablewrap"/g) ?? []).length;
    expect(wraps).toBeGreaterThanOrEqual(tables);
  });

  it('links every topic table to the state anchor it belongs to', () => {
    expect(renderLegalLimits(ASOF)).toContain('/oversize/texas#legal-limits');
    expect(renderPermitFees(ASOF)).toContain('/oversize/texas#fees');
    expect(renderEscortRequirements(ASOF)).toContain('/oversize/texas#escorts');
    expect(renderSuperloads(ASOF)).toContain('/oversize/texas#superload');
  });

  it('links every state section back to its topic table', () => {
    const tx = renderStatePage(hubStateBySlug('texas')!, ASOF);
    for (const p of ['legal-limits', 'permit-fees', 'escort-requirements', 'superloads']) {
      expect(tx).toContain(`/oversize/${p}`);
    }
  });

  it('renders the conflict section only for a state that has one', () => {
    const tn = renderStatePage(hubStateBySlug('tennessee')!, ASOF);
    expect(tn).toContain('id="conflicts"');
    const al = renderStatePage(hubStateBySlug('alabama')!, ASOF);
    if (allConflictEntries(ASOF).every((c) => c.state.code !== 'AL')) {
      expect(al).not.toContain('id="conflicts"');
    }
  });

  it('defers permit-office contacts rather than publishing a stale list', () => {
    const tx = renderStatePage(hubStateBySlug('texas')!, ASOF);
    expect(tx).toContain('not</strong> publishing per-state permit-office phone numbers');
    // And no phone number is rendered anywhere on a state page.
    expect(tx).not.toMatch(/\b\d{3}-\d{3}-\d{4}\b/);
  });
});

describe('the hub reads the engine and never writes to it', () => {
  /**
   * The engine is the source of truth and the hub is a rendering layer. The
   * moment a page needs a value the engine does not hold, the cheap fix is to
   * type it into the page — and then the calculator and the page disagree.
   */
  it('imports from src/calc/osow with type-only or read-only bindings', () => {
    const root = join(process.cwd(), 'src', 'server', 'osow');
    for (const f of ['hubData.ts', 'hubPages.ts', 'federalPages.ts', 'hubShell.ts']) {
      const src = readFileSync(join(root, f), 'utf8');
      // No assignment into anything imported from the calc tree.
      expect(src).not.toMatch(/OSOW_JURISDICTIONS\s*\[[^\]]*\]\s*=/);
      expect(src).not.toMatch(/\.legalLimits\s*=/);
      expect(src).not.toMatch(/\.escortRules\s*=[^=]/);
      expect(src).not.toMatch(/\.push\(\s*\{\s*value:/);
    }
  });
});
