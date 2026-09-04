/**
 * PARSERS — one per state whose publication is structured enough to yield rows.
 *
 * Everything here is PURE: body text in, `ParsedSource` out. No fetching, no
 * database, no clock beyond the `retrievedOn` the caller supplies. That is what
 * lets every one of these run against a committed fixture with zero live calls
 * (see `fixtures/`), which is the only way a parser for somebody else's HTML
 * stays honest — the fixture is the contract, and when the state changes its
 * markup the fixture is what tells us.
 *
 * ── THE RULE EVERY ADAPTER OBEYS ──────────────────────────────────────────
 * A parser may return NO ROWS in exactly two circumstances, and it must say
 * which one it is:
 *
 *   verifiedClear: true   the source POSITIVELY said nothing is restricted —
 *                         North Dakota served all 504 segments and flagged none
 *                         `InEffect=Y`; Minnesota's zone table parsed and no
 *                         window covers today; Michigan's latest bulletin says
 *                         in its own words that it lifts the remaining
 *                         restrictions statewide.
 *   verifiedClear: false  we read the source and COULD NOT TELL. Michigan
 *                         writes prose, and an unrecognised sentence is not a
 *                         green light.
 *
 * And it must THROW `SeasonalParseError` when the payload is implausible — an
 * empty FeatureCollection, a table with no rows, a bulletin page with no
 * bulletins. This is the `ingestSoftFailure` rule applied to a new source: a
 * 200 with nothing in it is a FAILED FETCH, not an authoritative emptiness, and
 * the one thing it must never do is overwrite good data with a confident zero.
 */
import type { IsoDate } from '../../calc/osow/provenance.js';
import type { SeasonalSourceSpec } from '../../calc/osow/seasonal/sources.js';
import type { SeasonalRestriction } from '../../calc/osow/seasonal/types.js';

/** An implausible payload. Always a FAILURE — never an empty answer. */
export class SeasonalParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonalParseError';
  }
}

export interface ParsedSource {
  rows: SeasonalRestriction[];
  /** The date the document itself carries. `null` when it states none. */
  bulletinDate: IsoDate | null;
  /** See the module header — the difference between "clear" and "unknown". */
  verifiedClear: boolean;
  /** How many records the SOURCE contained, before filtering to in-force. */
  recordCount: number;
  /** True when `rows` was capped. The count is still `recordCount`. */
  truncated: boolean;
}

export type AdapterFn = (
  body: string,
  spec: SeasonalSourceSpec,
  retrievedOn: IsoDate,
) => ParsedSource;

/**
 * Rows kept per state.
 *
 * North Dakota can post several hundred segments at the peak of the thaw, and
 * the whole snapshot is stored as one JSONB document and rendered on one page.
 * The cap bounds both. `recordCount` still reports the true total, so the page
 * can say "showing 250 of 431" rather than quietly under-reporting — the same
 * discipline as never reporting a failed fetch as a zero.
 */
export const MAX_ROWS_PER_STATE = 250;

// ── shared helpers ─────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** `Mar. 20, 2026` / `May 15, 2026` → `2026-03-20`. `null` when unreadable. */
export function parseUsLongDate(text: string): IsoDate | null {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})/.exec(String(text ?? ''));
  if (!m) return null;
  const mm = MONTHS[(m[1] as string).slice(0, 3).toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${String(m[2]).padStart(2, '0')}`;
}

/** `05/15/2026` → `2026-05-15`. `null` when unreadable. */
export function parseUsSlashDate(text: string): IsoDate | null {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(text ?? ''));
  if (!m) return null;
  return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/** Strip tags and collapse whitespace. Entity handling is deliberately minimal
 *  — these are government pages, not user input, and the text is only ever
 *  rendered back out through the page's own escaper. */
export function textOf(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "7 Ton" → 14000 lb. Returns undefined for anything that is not "N Ton". */
export function tonsToPounds(desc: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*ton/i.exec(String(desc ?? ''));
  if (!m) return undefined;
  const tons = Number(m[1]);
  return Number.isFinite(tons) ? Math.round(tons * 2000) : undefined;
}

function sourceDoc(spec: SeasonalSourceSpec, retrievedOn: IsoDate, revisedOn: IsoDate | null, cite?: string) {
  return {
    id: spec.sourceId,
    title: spec.authorityTitle,
    url: spec.authorityUrl,
    publisher: spec.publisher,
    revisedOn,
    retrievedOn,
    ...(cite ? { cite } : {}),
  };
}

// ── North Dakota: GeoJSON, the best source in the registry ─────────────────

interface NdProps {
  InEffect?: string;
  Restriction_Code_Desc?: string;
  LR_Order?: string;
  LR_Order_Effective_DateTime?: string;
  LR_Order_Created_DateTime?: string;
  HwyDesc?: string;
  MPFrom?: number;
  MPTo?: number;
  PublicFrom?: string;
  PublicTo?: string;
  DistrictName?: string;
}

/**
 * NDDOT publishes every PUBLISHED SEGMENT of the state system, restricted or
 * not, with `InEffect` as the flag. That shape is what makes a verified clear
 * possible: a July fetch returns 504 features with zero in effect, and that is
 * a real answer rather than an absence.
 *
 * It is also what makes the soft-failure check meaningful. An empty
 * FeatureCollection is NOT "North Dakota lifted everything" — it is a broken
 * publish, and treating it as an answer would clear every restriction in the
 * state on the strength of a bad minute upstream.
 */
export const parseNdGeoJson: AdapterFn = (body, spec, retrievedOn) => {
  let doc: { type?: string; features?: Array<{ properties?: NdProps }> };
  try {
    doc = JSON.parse(body) as typeof doc;
  } catch (err) {
    throw new SeasonalParseError(`NDDOT load-restriction feed is not valid JSON: ${String(err)}`);
  }
  const features = Array.isArray(doc.features) ? doc.features : null;
  if (features === null) {
    throw new SeasonalParseError('NDDOT feed has no `features` array — not a FeatureCollection.');
  }
  if (features.length === 0) {
    throw new SeasonalParseError(
      'NDDOT feed returned an EMPTY FeatureCollection. The state publishes every segment ' +
        'whether restricted or not, so zero features is a failed publish, not a lifted ' +
        'restriction. Treating this as a failure so it cannot clear good data.',
    );
  }

  const inEffect = features
    .map((f) => f.properties ?? {})
    .filter((p) => String(p.InEffect ?? '').trim().toUpperCase() === 'Y');

  // The newest order-creation date across the whole feed — the document's own
  // date, not ours. Taken from every feature, not just the restricted ones, so
  // a clear feed still carries the date NDDOT last touched it.
  let bulletinDate: IsoDate | null = null;
  for (const f of features) {
    const created = String(f.properties?.LR_Order_Created_DateTime ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(created) && (bulletinDate === null || created > bulletinDate)) {
      bulletinDate = created;
    }
  }

  const kept = inEffect.slice(0, MAX_ROWS_PER_STATE);
  const rows: SeasonalRestriction[] = kept.map((p) => {
    const effective = String(p.LR_Order_Effective_DateTime ?? '').slice(0, 10);
    const limit = String(p.Restriction_Code_Desc ?? 'restricted').trim();
    const mp =
      typeof p.MPFrom === 'number' && typeof p.MPTo === 'number'
        ? ` MP ${p.MPFrom}-${p.MPTo}`
        : '';
    const axle = tonsToPounds(limit);
    return {
      value: {
        scope: 'route-segment' as const,
        area: `${String(p.HwyDesc ?? 'state highway').trim()}${mp}${p.DistrictName ? ` (${p.DistrictName} district)` : ''}`,
        limit,
        ...(axle === undefined ? {} : { axleLimitLbs: axle }),
        ...(p.LR_Order ? { orderRef: `Order ${p.LR_Order}` } : {}),
      },
      source: sourceDoc(
        spec,
        retrievedOn,
        bulletinDate,
        p.LR_Order ? `NDDOT load-restriction order ${p.LR_Order}` : undefined,
      ),
      // The order's OWN effective date when it states one. Falling back to our
      // retrieval date is honest here and only here: the feed only carries a
      // segment while the order is live, so "in effect no later than the day we
      // read it" is a true statement about a row that is present.
      effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(effective) ? effective : retrievedOn,
      // NDDOT publishes no lift date — a segment simply leaves the in-effect
      // set when the next order releases it. Open-ended is the truth, and it is
      // why this source's stale failure OVER-restricts.
      effectiveTo: null,
      ...(p.PublicFrom && p.PublicTo
        ? { note: `${p.PublicFrom} to ${p.PublicTo}` }
        : {}),
    };
  });

  return {
    rows,
    bulletinDate,
    verifiedClear: inEffect.length === 0,
    recordCount: inEffect.length,
    truncated: inEffect.length > kept.length,
  };
};

// ── Minnesota: the zone table ──────────────────────────────────────────────

/**
 * MnDOT prints ONE table carrying FOUR different programmes, and two of them
 * move in opposite directions. Winter Load Increases RAISE limits; Spring Load
 * Restrictions LOWER them; the other two are permit seasons. Parsing the table
 * without tracking which section a row belongs to would publish the winter
 * INCREASE as a restriction — a restriction that does not exist, over a window
 * in which the state is actually more permissive than normal.
 *
 * So the section label is tracked from the `rowspan` heading cell, and only the
 * Spring Load Restrictions block is read.
 */
export const parseMnZoneTable: AdapterFn = (body, spec, retrievedOn) => {
  const rowsHtml = String(body ?? '').match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  if (rowsHtml.length === 0) {
    throw new SeasonalParseError('MnDOT load-limits page contained no table rows.');
  }

  let section = '';
  const zones: Array<{ zone: string; from: IsoDate; to: IsoDate }> = [];
  let slrRowsSeen = 0;

  for (const tr of rowsHtml) {
    const cells = tr.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? [];
    if (cells.length === 0) continue;
    let offset = 0;
    if (/rowspan\s*=/i.test(cells[0] as string)) {
      section = textOf(cells[0] as string).toLowerCase();
      offset = 1;
    }
    if (!section.includes('spring load restriction')) continue;
    const zone = textOf(cells[offset] ?? '');
    const from = parseUsLongDate(textOf(cells[offset + 1] ?? ''));
    const to = parseUsLongDate(textOf(cells[offset + 2] ?? ''));
    if (zone === '' || from === null || to === null) continue;
    slrRowsSeen++;
    zones.push({ zone, from, to });
  }

  if (slrRowsSeen === 0) {
    throw new SeasonalParseError(
      'MnDOT load-limits page parsed with ZERO Spring Load Restriction rows. The state ' +
        'publishes six frost zones every year, so zero is a markup change or a bad ' +
        'response — a failure, never a lifted season.',
    );
  }

  const rows: SeasonalRestriction[] = zones.map((z) => ({
    value: {
      scope: 'zone' as const,
      area: `${z.zone} frost zone`,
      limit: 'Spring load restrictions in force (MnDOT posts 5-ton or 7-ton axle limits by route within the zone)',
      orderRef: `${z.zone} zone, ${z.from} to ${z.to}`,
    },
    source: sourceDoc(spec, retrievedOn, null, `Seasonal load limits, ${z.zone} zone`),
    effectiveFrom: z.from,
    // MnDOT publishes the END date up front, which is exactly why a stale
    // Minnesota snapshot UNDER-restricts: it expires itself on schedule and a
    // newly extended window never appears.
    effectiveTo: z.to,
    note: 'MnDOT announces each zone change at least three calendar days in advance. The per-route limit within a zone is on the state\'s own zone map.',
  }));

  const today = retrievedOn;
  const anyLive = zones.some((z) => today >= z.from && today <= z.to);

  return {
    rows,
    // The page carries no revision date of its own; recording that is the
    // point of `revisedOn: null` rather than stamping it with today.
    bulletinDate: null,
    // A real verified clear: we read the state's own published windows and
    // none covers today.
    verifiedClear: !anyLive,
    recordCount: zones.length,
    truncated: false,
  };
};

// ── Michigan: numbered prose bulletins ─────────────────────────────────────

/**
 * MDOT's bulletins are PROSE. The structure — the number, the date, the body —
 * is machine-readable; the meaning is not.
 *
 * So this adapter reads the structure and refuses to invent the meaning. It
 * classifies the latest bulletin into exactly three outcomes:
 *
 *   an explicit statewide LIFT   → no rows, `verifiedClear: true`
 *   any other bulletin that talks about restrictions → ONE row, quoting MDOT
 *                                  verbatim, effective from the bulletin's own
 *                                  date, with no end date (MDOT does not state
 *                                  one — the next bulletin is the end)
 *   anything else                → no rows, `verifiedClear: FALSE`
 *
 * The third case is the one that matters. "We could not classify this
 * bulletin" is NOT "Michigan has no restrictions", and the flag is what keeps
 * the two apart all the way to the warning text.
 *
 * A PARTIAL lift ("restrictions are lifted in the southern Lower Peninsula")
 * deliberately falls into the second case, not the first: something is still
 * restricted somewhere, and over-stating on a source whose stale failure
 * already over-restricts is the consistent direction.
 */
const MI_LIFT_ALL = [/\blift/i, /\bremaining\b/i, /all state trunkline/i];

export const parseMiBulletins: AdapterFn = (body, spec, retrievedOn) => {
  const html = String(body ?? '');
  const blocks = html.match(
    /<h3>\s*Title:\s*Spring Weight Restriction Bulletin\s*#(\d+)\s*<\/h3>[\s\S]{0,400}?<span>\s*Date:\s*([\d/]+)\s*<\/span>[\s\S]{0,2000}?<p class="swbodycontent">([\s\S]{0,4000}?)<\/p>/gi,
  );
  if (blocks === null || blocks.length === 0) {
    throw new SeasonalParseError(
      'MDOT Spring Weight Restriction Bulletin page contained no recognisable bulletin ' +
        'blocks. MDOT publishes a numbered series every year and keeps prior years online, ' +
        'so zero is a markup change or a bad response — a failure, never an empty season.',
    );
  }

  const parsed = blocks.map((b) => {
    const num = /Bulletin\s*#(\d+)/i.exec(b)?.[1] ?? '?';
    const date = parseUsSlashDate(/Date:\s*([\d/]+)/i.exec(b)?.[1] ?? '');
    const text = textOf(/<p class="swbodycontent">([\s\S]*?)<\/p>/i.exec(b)?.[1] ?? '');
    return { num, date, text };
  });

  // Newest by the bulletin's OWN date; undated bulletins sort last, the same
  // ranking `resolveSourced` applies to undated documents.
  const ranked = [...parsed].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const latest = ranked[0] as { num: string; date: IsoDate | null; text: string };

  const liftsAll = MI_LIFT_ALL.every((re) => re.test(latest.text));
  const mentionsRestriction = /restriction/i.test(latest.text);

  if (liftsAll) {
    return {
      rows: [],
      bulletinDate: latest.date,
      verifiedClear: true,
      recordCount: parsed.length,
      truncated: false,
    };
  }

  if (!mentionsRestriction) {
    return {
      rows: [],
      bulletinDate: latest.date,
      // NOT a clear. We read the page and could not tell what it says.
      verifiedClear: false,
      recordCount: parsed.length,
      truncated: false,
    };
  }

  const quote = latest.text.length > 420 ? `${latest.text.slice(0, 417)}...` : latest.text;
  return {
    rows: [
      {
        value: {
          scope: 'route-class',
          area: 'State trunkline highways posted "Seasonal" on the MDOT Truck Operators Map',
          limit:
            'Reduced axle weight on Seasonal routes — MDOT states 25% on rigid pavement and 35% on flexible. Which applies is a property of each mile of road, so we do not compute it.',
          reductionPct: 25,
          orderRef: `Spring Weight Restriction Bulletin #${latest.num}`,
        },
        source: sourceDoc(spec, retrievedOn, latest.date, `Bulletin #${latest.num}`),
        effectiveFrom: latest.date ?? retrievedOn,
        // MDOT states no lift date; the NEXT bulletin is the lift. Open-ended,
        // which is why a stale Michigan snapshot over-restricts.
        effectiveTo: null,
        note: `MDOT, verbatim: "${quote}"`,
      },
    ],
    bulletinDate: latest.date,
    verifiedClear: false,
    recordCount: parsed.length,
    truncated: false,
  };
};

// ── Washington: the Traveler Information API ───────────────────────────────

interface WaRestriction {
  BridgeName?: string | null;
  DateEffective?: string | null;
  DateExpires?: string | null;
  DatePosted?: string | null;
  IsPermanentRestriction?: boolean;
  LocationDescription?: string | null;
  LocationName?: string | null;
  RestrictionComment?: string | null;
  RestrictionType?: number;
  MaximumGrossVehicleWeightInPounds?: number | null;
  RestrictionWeightInPounds?: number | null;
  StateRouteID?: string | null;
}

/**
 * WSDOT serves .NET JSON dates — `/Date(1740787200000-0800)/`. Returns the ISO
 * DAY in UTC, or null. Anything unreadable is null rather than epoch zero,
 * because a restriction dated 1970 would look permanently in effect.
 */
export function parseDotNetDate(value: string | null | undefined): IsoDate | null {
  const m = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(String(value ?? ''));
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * WSDOT's commercial-vehicle restriction feed carries BOTH permanent structural
 * limits (a bridge posted at 40 tons all year) and seasonal ones. Only the
 * seasonal rows belong here: publishing a permanent bridge posting as a
 * "spring thaw restriction" would be false in eleven months out of twelve.
 * `IsPermanentRestriction` is WSDOT's own flag for the distinction, and a row
 * that carries no effective date at all is treated as permanent — an undated
 * restriction is not evidence of a season.
 */
export const parseWaCvRestrictions: AdapterFn = (body, spec, retrievedOn) => {
  let list: WaRestriction[];
  try {
    list = JSON.parse(body) as WaRestriction[];
  } catch (err) {
    throw new SeasonalParseError(`WSDOT CVRestrictions response is not valid JSON: ${String(err)}`);
  }
  if (!Array.isArray(list)) {
    throw new SeasonalParseError('WSDOT CVRestrictions response was not an array.');
  }
  if (list.length === 0) {
    throw new SeasonalParseError(
      'WSDOT CVRestrictions returned an EMPTY array. Washington posts permanent bridge ' +
        'restrictions year-round, so an empty feed is an upstream failure, not a state ' +
        'with no restrictions.',
    );
  }

  const seasonal = list.filter((r) => {
    if (r.IsPermanentRestriction === true) return false;
    return parseDotNetDate(r.DateEffective) !== null;
  });

  const kept = seasonal.slice(0, MAX_ROWS_PER_STATE);
  const rows: SeasonalRestriction[] = kept.map((r) => {
    const from = parseDotNetDate(r.DateEffective) as IsoDate;
    const to = parseDotNetDate(r.DateExpires);
    const lbs = r.RestrictionWeightInPounds ?? r.MaximumGrossVehicleWeightInPounds ?? null;
    const where =
      r.LocationDescription ??
      r.LocationName ??
      (r.StateRouteID ? `SR ${r.StateRouteID}` : 'Washington state highway');
    return {
      value: {
        scope: 'route-segment' as const,
        area: String(where),
        limit: String(r.RestrictionComment ?? (lbs ? `${lbs} lb limit` : 'weight restriction')),
        ...(lbs ? { grossLimitLbs: lbs } : {}),
        ...(r.DatePosted ? { orderRef: `posted ${parseDotNetDate(r.DatePosted) ?? 'date unstated'}` } : {}),
      },
      source: sourceDoc(spec, retrievedOn, parseDotNetDate(r.DatePosted), 'WSDOT CVRestrictions'),
      effectiveFrom: from,
      effectiveTo: to,
    };
  });

  return {
    rows,
    bulletinDate: null,
    // The feed is a presence list for seasonal rows: none present, after a
    // plausible non-empty response, is a real clear.
    verifiedClear: seasonal.length === 0,
    recordCount: seasonal.length,
    truncated: seasonal.length > kept.length,
  };
};

export const SEASONAL_ADAPTERS: Record<string, AdapterFn> = {
  'nd-geojson': parseNdGeoJson,
  'mn-zone-table': parseMnZoneTable,
  'mi-bulletin': parseMiBulletins,
  'wa-cvrestrictions': parseWaCvRestrictions,
};
