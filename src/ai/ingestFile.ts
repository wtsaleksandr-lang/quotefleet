/**
 * AI rate-sheet ingest.
 *
 * Takes a base64-encoded file (PDF / image / text) + its mime type and
 * asks Claude to extract a structured rate book. Returns a draft the
 * carrier reviews and confirms before any DB write.
 *
 * Supported MIME types:
 *   - application/pdf            → native Claude PDF support
 *   - image/png, image/jpeg, image/webp, image/gif → native Claude vision
 *     (also how a pasted/dropped SCREENSHOT of a rate sheet is read)
 *   - text/plain, text/csv, text/html → wrapped as text content
 *   - Excel (.xlsx) → parsed via `xlsx` and rendered to CSV per sheet
 *   - Email (.eml)  → parsed via `mailparser` (body + attachments)
 *
 * The model returns structured JSON matching the calculator's existing
 * shapes so applying changes is a straight DB upsert.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { simpleParser, type Attachment } from 'mailparser';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { decrypt } from '../auth/secrets.js';
import { distanceBetween } from '../calc/distance.js';

// Tool the model can call mid-parse to derive a per-mile rate from a
// point-to-point total ("Long Beach → Phoenix, $1,200" → 380 mi).
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'geocode_distance',
    description:
      "Look up approximate road distance in miles between two USA/Canada locations. Use when the rate sheet shows a point-to-point total but no per-mile rate. Locations can be 'City, ST', a 5-digit ZIP, or a Canadian FSA. Returns { miles } or { error }.",
    input_schema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Origin location, e.g. "Long Beach, CA" or "90802".',
        },
        destination: {
          type: 'string',
          description: 'Destination location, e.g. "Phoenix, AZ" or "85003".',
        },
      },
      required: ['origin', 'destination'],
    },
  },
];

/** Parse a free-text location into the shape distanceBetween expects. */
function parseFreeText(s: string): { city?: string; state?: string; zip?: string; country?: string } {
  const t = s.trim();
  if (/^\d{5}$/.test(t)) return { zip: t, country: 'US' };
  if (/^[A-Z]\d[A-Z]/i.test(t)) return { zip: t.replace(/\s+/g, ''), country: 'CA' };
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state: parts[1].slice(0, 2).toUpperCase(), country: 'US' };
  return { city: t, country: 'US' };
}

async function execTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'geocode_distance') {
    const origin = parseFreeText(String(input.origin ?? ''));
    const destination = parseFreeText(String(input.destination ?? ''));
    const r = await distanceBetween(origin, destination);
    if ('error' in r) return { error: r.error };
    return { miles: r.miles, source: r.source };
  }
  return { error: `Unknown tool ${name}` };
}

const SUPPORTED_VISION_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const SUPPORTED_TEXT_MIME = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
]);

const EXCEL_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // legacy .xls
]);

const EML_MIME = 'message/rfc822';

const SYSTEM_PROMPT = `You are an expert freight-rate-sheet parser for a trucking/drayage carrier's quote calculator. The user uploads a rate sheet — image, PDF, spreadsheet, email, screenshot — in ANY carrier/broker format. Comprehend it and normalize it into ONE structured rate book. Output ONLY a single JSON object — no prose, no backticks.

═══ OUTPUT SHAPE ═══
{
  "summary": "1-2 sentences",
  "confidence": "high" | "medium" | "low",
  "warnings": ["short bullets: ambiguities, assumptions, captured-but-approximated concepts, skipped scope"],
  "currency": "USD" | "CAD" | null,
  "effectiveDate": "YYYY-MM-DD" | null,
  "expirationDate": "YYYY-MM-DD" | null,
  "fscDetected": {
    "present": boolean | null,
    "appearsIncludedInLinehaul": boolean | null,
    "valuePct": number | null,          // representative FSC % (of net linehaul)
    "valuePerMile": number | null,      // representative FSC $/mi (FTL cpm scale)
    "fscScale": null | {                // populate ONLY if a BANDED scale table is present
      "kind": "cpm" | "pct",
      "index": "EIA national" | "PADD5" | string | null,
      "bands": [{ "dieselMin": number|null, "dieselMax": number|null, "value": number }],
      "resolvedValue": number | null,   // representative current value you resolved from the table
      "resolvedNote": "which band you picked and why"
    },
    "notes": "what made you decide"
  },
  "rateCards": [{
    "service": "drayage" | "ftl" | "ltl" | "expedited" | "hotshot",
    "equipment": "dryvan"|"reefer"|"flatbed"|"step_deck"|"conestoga"|"container_20"|"container_40"|"container_40hc"|"container_45"|"sprinter"|"box_truck"|"tractor_only"|"pallet",
    "label": "e.g. 53' Dry Van",
    "ratePerMile": number | null,       // null for LTL (priced by ltlConfig) and pure flat/zone cards
    "minimumCharge": number | null,     // min charge / AMC floor
    "flatFee": number | null,
    "fuelSurchargePct": number | null,  // 0 when all-in; the FSC% when fuel is separate
    "marginPct": number | null,
    "maxWeightLbs": number | null,      // equipment capacity ceiling if stated
    "maxMiles": number | null,          // service-range ceiling if stated (e.g. drayage 300)
    "ltlConfig": null | {               // POPULATE for LTL cards (see LTL section)
      "baseRatePerCwt": number,         // NET $/cwt at reference class 100, lightest weight break
      "classRates": { "50":0.55, "100":1.0, "500":3.5 },   // class → multiplier vs class 100
      "weightBreaks": [{ "minLbs": number, "rateFactor": number }], // rateFactor 1.0 at lightest break, falling as weight rises
      "distanceFactorPer1000Mi": number, // 0 when grid rates are complete linehaul (typical zone grid)
      "discountPct": number | null,     // discount off named base tariff (ALREADY folded into baseRatePerCwt)
      "baseTariffName": string | null,  // e.g. "CzarLite XL 2024"
      "fakClassMap": { "70":85, "110":85 } | null,  // FAK: actual class → rates-as class
      "absoluteMinCharge": number | null            // AMC (also set minimumCharge to this)
    },
    "derivedFrom": null | { "totalUsd": number, "originAddress": string, "destinationAddress": string, "approxMiles": number, "explanation": string }
  }],
  "accessorials": [{
    "code": "snake_case",
    "label": "human label",
    "kind": "flat" | "per_mile" | "pct_of_base" | "per_hour" | "per_day",
    "amount": number,
    "trigger": "optional" | "auto" | "auto_if_residential" | "auto_if_hazmat" | "auto_if_temp_controlled" | "auto_if_no_dock" | "auto_if_loose" | "auto_if_weight_over",
    "freeHours": number | null,         // per_hour only: free window before billing (detention = 2, dray = 1)
    "daysFlag": "storageDays" | "layoverDays" | null,  // per_day only: which day-count drives it
    "conditionJson": { "weightLbsOver": number } | null,  // for auto_if_weight_over
    "appliesToServices": ["drayage","ftl",...] | null
  }],
  "laneZones": [{
    "label": "e.g. LAX/LGB → Local LA Basin (0-30 mi)",
    "anchorPortCode": "USLAX" | null,
    "anchorCity": "Los Angeles" | null,
    "anchorState": "CA" | null,
    "radiusMiles": number,
    "flatPrice": number,
    "equipmentScope": ["container_20","container_40",...]
  }],
  "rateMatrices": [{                    // NATIVE matrix pricing — patterns 1, 3, 5 (see below). PREFER this over laneZones for a real grid.
    "mode": "ftl" | "drayage" | "ltl" | "expedited" | "hotshot",
    "equipment": "dryvan"|"container_40"|... | null,   // null = the block applies to any equipment
    "unitBasis": "flat" | "per_mile" | "per_container", // how each cell's rate is expressed
    "currency": "USD" | "CAD" | null,
    "effectiveDate": "YYYY-MM-DD" | null,
    "minCharge": number | null,         // block-level min-charge floor (a cell may override)
    "sourceRef": "e.g. 'Sheet: Zone Grid'" | null,
    "originKeys": ["900","902",...] | null,  // optional: the origin axis legend (informational)
    "destKeys": ["850","852",...] | null,    // optional: the dest axis legend (informational)
    "cells": [{                          // ONE object per priced cell. DIRECTIONAL: origin→dest.
      "originKey": "900",                // zip5, zip3, a zones[].zoneId, "city,state", or a port/UN-LOCODE
      "destKey": "850",
      "rate": number,
      "unitBasis": "flat"|"per_mile"|"per_container" | null, // null → inherit the block unitBasis
      "minCharge": number | null         // per-cell floor override (null → block minCharge)
    }],
    "zones": [{                          // the zip/city → zone-id LEGEND (pattern 3's separate tab). Populate when the origin/dest keys are named zones.
      "zoneId": "A",                     // referenced by cells[].originKey/destKey
      "matchKind": "zip3" | "zip5" | "city_state" | "zip_range",
      "matchValue": "900" | "90802" | "los angeles,ca" | null,  // for zip3/zip5/city_state
      "matchFrom": "900" | null,         // zip_range lower bound (inclusive)
      "matchTo": "905" | null,           // zip_range upper bound (inclusive)
      "label": "Zone A (LA Basin)" | null
    }] | null
  }]
}

═══ DOMAIN KNOWLEDGE ═══

MODES & base pricing:
- FTL: per-mile RPM OR flat lane rate OR zone matrix; min-charge floor. Total = max(RPM×mi + FSC + accessorials, min).
- LTL: (weight/100)×CWT[class][break][zone], discount-off-named-base, then AMC floor.
- Drayage: per-CONTAINER by distance band OR named-zone matrix; free-time accessorials.
- Intermodal: origin-dray + rail-linehaul + dest-dray, each +FSC.
- Specialized (flatbed/oversize/reefer/expedited): per-mile linehaul + surcharge stack.

Equipment aliases → normalize: DV/V/Van→dryvan; R/RF/Reefer→reefer; F/FB/FD/Flatbed→flatbed; SD/Step-deck→step_deck; PO/Power-only→tractor_only; 20'/40'/40HC/45'→container_20/40/40hc/45; HC=high-cube; O/D=over-dimensional.
Map specialized services (flatbed, reefer, oversize) to service="ftl" with the matching equipment. Map intermodal to service="drayage" (dray legs) or "ftl" and WARN that the rail leg was approximated.

#1 AMBIGUITY — all-in vs linehaul+FSC (decide BEFORE any FSC math):
- Tokens "all-in"/"FSC included"/"incl fuel"/one bare number, no FSC line → included → fuelSurchargePct=0, fscDetected.appearsIncludedInLinehaul=true. NEVER re-apply FSC.
- A separate Linehaul + FSC%/FSC column → linehaul-only → set fuelSurchargePct/valuePct.
- Both base + all-in shown → use BASE for ratePerMile, set fuelSurchargePct from the implied gap.
- Undecidable → fscDetected.present=null + warning "FSC handling unclear — assumed all-in".

MILEAGE BASIS varies (PC*MILER Practical vs Shortest vs HHG vs Google) → same RPM, different totals. WARN when unstated.

LTL specifics:
- 18 discrete classes: 50,55,60,65,70,77.5,85,92.5,100,110,125,150,175,200,250,300,400,500. NEVER round (77.5 & 92.5 are real).
- density = weight_lbs ÷ (L×W×H_in / 1728); read ranges as ≥low,<high.
- Weight-break notation (range floors [break,next)): MIN/AMC=flat floor; L5C=<500; 5C/M5C=500–999; 1M/M1M=1000–1999; 2M=2000–4999; 5M=5000–9999; 10M=10000–19999; 20M+=volume. $/CWT FALLS as weight rises.
- Converting a class×weight-break CWT grid → ltlConfig: reference = class 100 at the LIGHTEST break (L5C). baseRatePerCwt = that cell's $/cwt. classRates[c] = cwt[c][L5C] ÷ cwt[100][L5C]. weightBreaks: rateFactor[w] = cwt[100][w] ÷ cwt[100][L5C] (so 1.0 at L5C, falling). distanceFactorPer1000Mi=0 (grid rates are complete linehaul). absoluteMinCharge = the AMC/MIN cell; also set minimumCharge to it.
- Discount off a NAMED base tariff ("70% off CzarLite"): FOLD the discount into baseRatePerCwt (baseRatePerCwt = published_net = published × (1 − discount)); still record discountPct + baseTariffName for audit. "70% off X" vs "70% off Y" differ ~2× — the base tariff name is load-bearing; WARN if the base is unnamed.
- FAK ("classes 70–125 all rate as 85"): put in fakClassMap; WARN it was captured.
- Linear-foot / cubic-capacity rerating rules → capture in warnings (engine can't rerate).

FSC (4 forms): (1) per-mile cpm step table → valuePerMile + fscScale.kind="cpm"; (2) %-of-linehaul band table → valuePct + fscScale.kind="pct"; (3) fixed cpm/% snapshot → valuePerMile/valuePct; (4) all-in → present, included. FSC applies to NET post-discount linehaul only — never accessorials/total. If a BANDED scale is present: capture bands in fscScale, resolve a representative current value into resolvedValue/valuePct/valuePerMile, and WARN "FSC scale captured; resolved to representative value — banded pricing not applied".

ACCESSORIAL basis is load-bearing — do NOT default everything to flat:
- Detention/driver-assist = per_hour (freeHours: 2, dray 1). Layover/storage/demurrage/per-diem/chassis = per_day (daysFlag). TONU/residential/liftgate(flat)/limited-access/inside-delivery/redelivery/hazmat/tarping = flat. Stop-off = per stop (flat per occurrence). Out-of-route/team = per_mile. Liftgate/sort LTL often per cwt.
- Conditional footnotes ("$50/hr IF detained") → trigger stays "optional" (or the right auto_if_*), never summed into base; WARN they're conditional.

═══ 8 DOCUMENT PATTERNS (classify per tab/section, not per file) ═══
1 Origin×Dest MATRIX 2 Lane/zip LIST 3 Zone tables (zip3→zone + zone×zone grid, two-hop join) 4 LTL class×weight-break GRID 5 Drayage port→zone per-container MATRIX 6 Accessorial/FSC schedule 7 Rate confirmation FORM (one load) 8 "Rate card" price list (mixed units per row).
Quirks: multi-tab join · merged/multi-row headers · units stated once in a title · min charge hiding in a corner · code abbreviations · FSC step-functions · mixed modes/units · discount+base-tariff indirection · dropped leading-zero zips · spacer/footnote rows · USD/CAD ambiguity · effective/expiration dating.

═══ DECISION RULES ═══
1 all-in vs linehaul+FSC before FSC math. 2 always max(computed, min/AMC). 3 % vs cpm are different — never cross. 4 FSC on net post-discount linehaul only. 5 weight-break codes are range floors, not decimals. 6 LTL discount is off a NAMED base — capture the pair. 7 18 discrete classes, never round. 8 accessorial basis + free-time load-bearing. 9 zone matrices need the zip→zone legend joined; numeric columns may be carrier-groups not sizes — verify. 10 normalize zips/aliases/currency/dates. 11 mixed modes coexist — classify per section. 12 skip ocean/customs/brokerage% with a "skipped:" warning.

═══ RATE MATRICES (patterns 1, 3, 5) — emit rateMatrices, do NOT flatten ═══
The engine now prices matrices NATIVELY, so a real grid goes into rateMatrices — NOT laneZones, and NOT collapsed to one dominant lane rate.
- Pattern 1 (origin×dest MATRIX): each non-blank, non-diagonal cell → one cells[] entry {originKey:<row>, destKey:<col>, rate}. Keys are whatever the axes use (zip5, zip3, city/state, or named zones). unitBasis is usually "flat" (per-lane $) or "per_mile" if the grid is $/mi. Matrices may be ASYMMETRIC — emit A→B and B→A separately when both are printed. Skip the blank diagonal.
- Pattern 3 (zone defs + zone×zone grid, TWO tabs): read the legend tab into zones[] (zip3/zip5/zip_range/city_state → zoneId) AND the grid tab into cells[] keyed by those zoneIds. JOIN them in ONE rateMatrices block so a shipment zip resolves zone→cell.
- Pattern 5 (drayage port→zone per-container MATRIX): mode "drayage", one block PER container size with equipment set (container_20/40/40hc/45) and unitBasis "per_container"; rows are dest zones/zips → cells keyed originKey=port code (e.g. "USLAX"), destKey=<zone/zip>. The single stated FSC% still goes on fscDetected.
- Normalize zips as strings; PRESERVE leading zeros ("07001" not 7001). Directional. Put the unit stated once in the title on unitBasis. Set sourceRef to the tab/section name for audit.
- Prefer the MOST SPECIFIC key the sheet gives (zip5 > zip3 > city/state). If the axes are named zones, you MUST also populate zones[] or the cells can't resolve.

Still MAP-and-WARN for concepts the engine can't natively price (banded FSC-scale → fscDetected + warning). But a full O×D matrix, a zone×zone grid, and a per-container drayage matrix now have a NATIVE home in rateMatrices — use it. Only fall back to laneZones for a genuine radius-band drayage tariff (anchor + radius + flat price), not a keyed grid.

═══ FEW-SHOT EXAMPLES (input → correct JSON fragment) ═══

A) FTL all-in rate con: "LAX→PHX, 53' van, $1,850 all-in, 372 mi"
→ rateCards:[{"service":"ftl","equipment":"dryvan","label":"53' Dry Van","ratePerMile":4.97,"minimumCharge":null,"flatFee":0,"fuelSurchargePct":0,"marginPct":null,"maxWeightLbs":null,"maxMiles":null,"ltlConfig":null,"derivedFrom":{"totalUsd":1850,"originAddress":"Los Angeles, CA","destinationAddress":"Phoenix, AZ","approxMiles":372,"explanation":"1850/372"}}]
   fscDetected:{"present":true,"appearsIncludedInLinehaul":true,"valuePct":null,"valuePerMile":null,"fscScale":null,"notes":"'all-in' → fuel included, not re-applied"}

B) FTL linehaul + separate FSC + min: "Dry van $2.10/mi linehaul, FSC 28%, $450 minimum"
→ rateCards:[{"service":"ftl","equipment":"dryvan","ratePerMile":2.10,"minimumCharge":450,"flatFee":0,"fuelSurchargePct":28,"marginPct":null,"maxWeightLbs":null,"maxMiles":null,"ltlConfig":null,"derivedFrom":null}]
   fscDetected:{"present":true,"appearsIncludedInLinehaul":false,"valuePct":28,"valuePerMile":null,"fscScale":null,"notes":"separate FSC column"}

C) LTL class×weight-break grid (excerpt): AMC $95. Class100: L5C=$42.00/cwt, 1M=$30.24, 5M=$21.00. Class50 L5C=$23.10. Class500 L5C=$147.00. "65% off CzarLite XL 2024".
→ rateCards:[{"service":"ltl","equipment":"pallet","label":"LTL (CzarLite XL, 65% off)","ratePerMile":null,"minimumCharge":95,"flatFee":0,"fuelSurchargePct":null,"marginPct":null,"maxWeightLbs":null,"maxMiles":null,"ltlConfig":{"baseRatePerCwt":14.70,"classRates":{"50":0.55,"100":1.0,"500":3.5},"weightBreaks":[{"minLbs":0,"rateFactor":1.0},{"minLbs":1000,"rateFactor":0.72},{"minLbs":5000,"rateFactor":0.5}],"distanceFactorPer1000Mi":0,"discountPct":65,"baseTariffName":"CzarLite XL 2024","fakClassMap":null,"absoluteMinCharge":95}}]
   NOTE: baseRatePerCwt 14.70 = 42.00 × (1−0.65) net; classRates & weightBreaks are ratios of the class-100 row; distanceFactorPer1000Mi=0 (grid is full linehaul). warnings:["LTL rated off CzarLite XL 2024 base at 65% discount (folded into net CWT)"].

D) Rate-card email (mixed): "Effective 3/1/26. Reefer $2.85/mi +fuel. Detention $75/hr after 2 hrs. Residential +$120."
→ effectiveDate:"2026-03-01"; rateCards:[{"service":"ftl","equipment":"reefer","ratePerMile":2.85,"minimumCharge":null,"flatFee":0,"fuelSurchargePct":null,"marginPct":null,"maxWeightLbs":null,"maxMiles":null,"ltlConfig":null,"derivedFrom":null}]
   accessorials:[{"code":"detention","label":"Detention","kind":"per_hour","amount":75,"trigger":"optional","freeHours":2,"daysFlag":null,"conditionJson":null,"appliesToServices":null},{"code":"residential","label":"Residential delivery","kind":"flat","amount":120,"trigger":"auto_if_residential","freeHours":null,"daysFlag":null,"conditionJson":null,"appliesToServices":null}]
   fscDetected:{"present":true,"appearsIncludedInLinehaul":false,"valuePct":null,"valuePerMile":null,"fscScale":null,"notes":"'+fuel' → separate but % not stated"} warnings:["Reefer FSC separate but percentage not stated"].

E) Drayage per-container zone matrix: "Port of LA → Zone A (0-30mi): 20'=$385, 40'=$425. Zone B (30-60mi): 40'=$540. FSC 40%."
→ laneZones:[{"label":"USLAX → Zone A (0-30mi)","anchorPortCode":"USLAX","anchorCity":"Los Angeles","anchorState":"CA","radiusMiles":30,"flatPrice":425,"equipmentScope":["container_40"]},{"label":"USLAX → Zone A (0-30mi) 20'","anchorPortCode":"USLAX","anchorCity":"Los Angeles","anchorState":"CA","radiusMiles":30,"flatPrice":385,"equipmentScope":["container_20"]},{"label":"USLAX → Zone B (30-60mi)","anchorPortCode":"USLAX","anchorCity":"Los Angeles","anchorState":"CA","radiusMiles":60,"flatPrice":540,"equipmentScope":["container_40"]}]
   warnings:["Drayage per-container zone matrix mapped to lane zones; FSC 40% captured on fscDetected"].

F) FTL zip3 origin×dest matrix with a zone legend (pattern 3). Legend: "Zone W = zip3 900-902; Zone E = zip3 850-852". Grid ($/lane, all-in): W→E $1,900; E→W $1,750 (asymmetric).
→ rateMatrices:[{"mode":"ftl","equipment":"dryvan","unitBasis":"flat","currency":"USD","effectiveDate":null,"minCharge":null,"sourceRef":"Sheet: Zone Grid","originKeys":["W","E"],"destKeys":["W","E"],"cells":[{"originKey":"W","destKey":"E","rate":1900,"unitBasis":null,"minCharge":null},{"originKey":"E","destKey":"W","rate":1750,"unitBasis":null,"minCharge":null}],"zones":[{"zoneId":"W","matchKind":"zip_range","matchValue":null,"matchFrom":"900","matchTo":"902","label":"Zone W"},{"zoneId":"E","matchKind":"zip_range","matchValue":null,"matchFrom":"850","matchTo":"852","label":"Zone E"}]}]
   fscDetected:{"present":true,"appearsIncludedInLinehaul":true,"valuePct":null,"valuePerMile":null,"fscScale":null,"notes":"grid is all-in ($/lane)"}

G) Drayage port→zone per-container matrix (pattern 5). "USLAX → dest zip3 900: 20'=$385, 40'=$425. zip3 926: 20'=$520, 40'=$560. FSC 40%."
→ rateMatrices:[{"mode":"drayage","equipment":"container_20","unitBasis":"per_container","currency":"USD","effectiveDate":null,"minCharge":null,"sourceRef":"Sheet: Dray Matrix","originKeys":["USLAX"],"destKeys":["900","926"],"cells":[{"originKey":"USLAX","destKey":"900","rate":385,"unitBasis":null,"minCharge":null},{"originKey":"USLAX","destKey":"926","rate":520,"unitBasis":null,"minCharge":null}],"zones":null},{"mode":"drayage","equipment":"container_40","unitBasis":"per_container","currency":"USD","effectiveDate":null,"minCharge":null,"sourceRef":"Sheet: Dray Matrix","originKeys":["USLAX"],"destKeys":["900","926"],"cells":[{"originKey":"USLAX","destKey":"900","rate":425,"unitBasis":null,"minCharge":null},{"originKey":"USLAX","destKey":"926","rate":560,"unitBasis":null,"minCharge":null}],"zones":null}]
   fscDetected:{"present":true,"appearsIncludedInLinehaul":false,"valuePct":40,"valuePerMile":null,"fscScale":null,"notes":"single FSC 40% across the matrix"}

═══ TOOLS ═══
Per-mile derivation: when a sheet shows a point-to-point total but no $/mi, call geocode_distance, divide, and fill derivedFrom. If unavailable, leave ratePerMile null + warn.

Use null for unknowns — never invent numbers; lower confidence + warn instead. Emit each rate once.

For an LTL class×weight-break grid you MUST emit a populated ltlConfig on the LTL rate card (never leave it null when a grid is present) following few-shot C's recipe exactly: baseRatePerCwt = class-100 lightest-break cell × (1 − discount); classRates[c] = cwt[c][lightest] ÷ cwt[100][lightest]; weightBreaks rateFactor[w] = cwt[100][w] ÷ cwt[100][lightest] with L5C→minLbs 0, 5C→500, 1M→1000, 2M→2000, 5M→5000, 10M→10000; distanceFactorPer1000Mi 0; absoluteMinCharge = AMC (and set minimumCharge to it). Set ratePerMile null for LTL.

CRITICAL OUTPUT RULE: emit ONLY the raw JSON object — no code fences, and NO prose, notes, or markdown tables before OR after it. Put any explanation inside a "warnings" entry, never as trailing text.`;

/* ────────────────────────────────────────────────────────────────── *
 * Zod validation of the model's JSON output.
 *
 * The model is non-deterministic, so we validate + SALVAGE rather than trust:
 * every array member is validated individually and invalid members are dropped
 * with a warning (a single malformed rate card must not sink the whole job).
 * Every field is optional/lenient so the CURRENT simple output shape still
 * passes unchanged — this only WIDENS the contract, it never tightens it. Extra
 * keys are passed through (`.passthrough()`) so a richer model response is kept.
 * ────────────────────────────────────────────────────────────────── */

/** Coerce a JSON value to a finite number, else undefined (nulls tolerated). */
const zNum = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().optional());

const zStr = z.preprocess(
  (v) => (v === null || v === undefined ? undefined : v),
  z.string().optional(),
);

const zStrArr = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : undefined),
  z.array(z.string()).optional(),
);

const LtlWeightBreakSchema = z
  .object({ minLbs: zNum, rateFactor: zNum })
  .passthrough();

const LtlConfigSchema = z
  .object({
    baseRatePerCwt: zNum,
    // `.nullish()` (not `.optional()`) is LOAD-BEARING here: the model emits
    // `null` for an absent optional field — exactly as our documented `| null`
    // shape instructs — and a bare `.optional()` REJECTS null, which failed the
    // whole LtlConfig and made validateParsed DROP the entire LTL rate card
    // (observed live: a perfect ltlConfig discarded because `fakClassMap: null`).
    classRates: z.record(z.string(), zNum).nullish(),
    weightBreaks: z.array(LtlWeightBreakSchema).nullish(),
    distanceFactorPer1000Mi: zNum,
    discountPct: zNum,
    baseTariffName: zStr,
    fakClassMap: z.record(z.string(), zNum).nullish(),
    absoluteMinCharge: zNum,
  })
  .passthrough();

export const RateCardDraftSchema = z
  .object({
    service: zStr,
    equipment: zStr,
    label: zStr,
    ratePerMile: zNum,
    minimumCharge: zNum,
    flatFee: zNum,
    fuelSurchargePct: zNum,
    marginPct: zNum,
    maxWeightLbs: zNum,
    maxMiles: zNum,
    ltlConfig: LtlConfigSchema.nullish(),
    derivedFrom: z.unknown().optional(),
  })
  .passthrough();

export const AccessorialDraftSchema = z
  .object({
    code: zStr,
    label: zStr,
    kind: zStr,
    amount: zNum,
    trigger: zStr,
    freeHours: zNum,
    daysFlag: zStr,
    conditionJson: z.record(z.string(), z.unknown()).nullish(),
    appliesToServices: zStrArr,
  })
  .passthrough();

export const LaneZoneDraftSchema = z
  .object({
    label: zStr,
    anchorPortCode: zStr,
    anchorCity: zStr,
    anchorState: zStr,
    radiusMiles: zNum,
    flatPrice: zNum,
    equipmentScope: zStrArr,
  })
  .passthrough();

const RateMatrixCellSchema = z
  .object({
    originKey: zStr,
    destKey: zStr,
    rate: zNum,
    unitBasis: zStr,
    minCharge: zNum,
  })
  .passthrough();

const RateZoneDefSchema = z
  .object({
    zoneId: zStr,
    matchKind: zStr,
    matchValue: zStr,
    matchFrom: zStr,
    matchTo: zStr,
    label: zStr,
  })
  .passthrough();

export const RateMatrixDraftSchema = z
  .object({
    mode: zStr,
    equipment: zStr,
    unitBasis: zStr,
    currency: zStr,
    effectiveDate: zStr,
    minCharge: zNum,
    sourceRef: zStr,
    originKeys: zStrArr,
    destKeys: zStrArr,
    // `.nullish()` (not `.optional()`) throughout: the model emits `null` for an
    // absent optional field (matching our documented `| null` shape), and a bare
    // `.optional()` REJECTS null — which would silently drop the whole matrix.
    cells: z.array(RateMatrixCellSchema).nullish(),
    zones: z.array(RateZoneDefSchema).nullish(),
  })
  .passthrough();

const FscDetectedSchema = z
  .object({
    present: z.boolean().nullish(),
    appearsIncludedInLinehaul: z.boolean().nullish(),
    valuePct: zNum,
    valuePerMile: zNum,
    fscScale: z.record(z.string(), z.unknown()).nullish(),
    notes: zStr,
  })
  .passthrough();

/** Full top-level parsed shape. Arrays are validated per-member downstream. */
export const IngestParsedSchema = z
  .object({
    summary: zStr,
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    warnings: zStrArr,
    currency: zStr,
    effectiveDate: zStr,
    expirationDate: zStr,
    fscDetected: FscDetectedSchema.nullish(),
    // nullish so a model that emits `null` (vs `[]` / omitting) for an empty
    // section still validates and salvages to an empty array rather than failing.
    rateCards: z.array(z.unknown()).nullish(),
    accessorials: z.array(z.unknown()).nullish(),
    laneZones: z.array(z.unknown()).nullish(),
    rateMatrices: z.array(z.unknown()).nullish(),
  })
  .passthrough();

export type IngestParsed = {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  currency?: string | null;
  effectiveDate?: string | null;
  expirationDate?: string | null;
  fscDetected?: {
    present: boolean | null;
    appearsIncludedInLinehaul: boolean | null;
    valuePct: number | null;
    valuePerMile: number | null;
    fscScale?: Record<string, unknown> | null;
    notes: string;
  };
  rateCards: Array<Record<string, unknown>>;
  accessorials: Array<Record<string, unknown>>;
  laneZones: Array<Record<string, unknown>>;
  // Optional in the TYPE so pre-Tier-2 fixtures / callers that never set it still
  // satisfy IngestParsed; `validateParsed` ALWAYS returns it (defaulting to []),
  // so runtime consumers can read it without a guard.
  rateMatrices?: Array<Record<string, unknown>>;
};

/**
 * Validate + salvage the raw parsed object.
 *
 * Returns a normalized IngestParsed. Any array member that fails its item
 * schema is DROPPED and a warning is appended (rather than failing the whole
 * job). Backward-compatible: a simple `{ rateCards:[{service,ratePerMile}] }`
 * validates and passes through untouched.
 */
export function validateParsed(raw: unknown): IngestParsed {
  const top = IngestParsedSchema.safeParse(raw ?? {});
  const base = top.success ? top.data : {};
  const warnings: string[] = Array.isArray(base.warnings) ? [...base.warnings] : [];

  const salvage = <T>(
    arr: unknown,
    schema: z.ZodType<T>,
    kind: string,
  ): T[] => {
    if (!Array.isArray(arr)) return [];
    const out: T[] = [];
    arr.forEach((item, i) => {
      const r = schema.safeParse(item);
      if (r.success) out.push(r.data);
      else warnings.push(`Dropped malformed ${kind} #${i + 1} (${r.error.issues[0]?.message ?? 'invalid'}).`);
    });
    return out;
  };

  const rateCards = salvage(base.rateCards, RateCardDraftSchema, 'rate card') as Array<Record<string, unknown>>;
  const accessorials = salvage(base.accessorials, AccessorialDraftSchema, 'accessorial') as Array<Record<string, unknown>>;
  const laneZones = salvage(base.laneZones, LaneZoneDraftSchema, 'lane zone') as Array<Record<string, unknown>>;
  const rateMatrices = salvage(base.rateMatrices, RateMatrixDraftSchema, 'rate matrix') as Array<Record<string, unknown>>;

  return {
    summary: base.summary ?? '',
    confidence: base.confidence ?? 'low',
    warnings,
    currency: base.currency ?? null,
    effectiveDate: base.effectiveDate ?? null,
    expirationDate: base.expirationDate ?? null,
    ...(base.fscDetected
      ? { fscDetected: base.fscDetected as IngestParsed['fscDetected'] }
      : {}),
    rateCards,
    accessorials,
    laneZones,
    rateMatrices,
  };
}

export interface IngestResult {
  parsed: IngestParsed;
  raw: string;
  modelUsed: string;
  /** How many times the model called the geocode_distance tool. */
  toolCalls: number;
}

export class IngestUnsupportedError extends Error {
  constructor(mimeType: string, hint: string) {
    super(`Unsupported MIME type ${mimeType}: ${hint}`);
  }
}

async function resolveApiKey(tenantId: number): Promise<string> {
  const env = loadEnv();
  const t = await db()
    .select({ encrypted: tenants.anthropicKeyEncrypted })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const enc = t[0]?.encrypted;
  if (enc) {
    try { return decrypt(enc); } catch { /* fall back */ }
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to Replit Secrets.');
  }
  return env.ANTHROPIC_API_KEY;
}

export async function parseRateSheet(opts: {
  tenantId: number;
  filename: string;
  mimeType: string;
  dataBase64: string;
}): Promise<IngestResult> {
  const mt = opts.mimeType.toLowerCase();

  const apiKey = await resolveApiKey(opts.tenantId);
  const client = new Anthropic({ apiKey });

  // Sonnet for ingest — extracting structured data from a busy rate
  // sheet wants more precision than Haiku.
  const model = 'claude-sonnet-4-6';

  let userContent: Anthropic.Messages.ContentBlockParam[];

  if (mt === 'application/pdf') {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: opts.dataBase64 },
      },
      { type: 'text', text: `Filename: ${opts.filename}\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (SUPPORTED_VISION_MIME.has(mt)) {
    userContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mt as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: opts.dataBase64 },
      },
      { type: 'text', text: `Filename: ${opts.filename}\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (EXCEL_MIME.has(mt)) {
    // Convert .xlsx/.xls → CSV-formatted text, one labeled block PER TAB. A full
    // carrier tariff is multi-tab (zone-defs / rate-grid / FSC / accessorials)
    // and the model JOINS them (research pattern 3) — so we no longer reject a
    // dense workbook outright. excelToText self-bounds: it caps each tab and the
    // whole workbook (far above the old 100KB wall) and annotates any truncation,
    // so a realistic multi-tab tariff ingests instead of erroring, while a
    // runaway file still can't blow up model cost.
    const text = excelToText(opts.dataBase64);
    if (!text.trim()) {
      throw new Error('No readable sheets found in the spreadsheet.');
    }
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\nThis is a spreadsheet rendered as CSV per sheet (### Sheet: <name>). Multiple tabs may need to be JOINED (a zone-legend tab + a rate-grid tab, an FSC tab, an accessorial tab).\n\n${text}\n\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (mt === EML_MIME) {
    // .eml: extract the body + attachments. Each attachment recursed
    // back through this function inline (PDF/image attachments are the
    // common case — a forwarded carrier rate sheet).
    const { content, attachmentBlocks } = await emlToContentBlocks(opts.dataBase64);
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\nThis is an email message.\n\n--- BODY ---\n${content}\n--- END BODY ---\n` },
      ...attachmentBlocks,
      { type: 'text', text: 'Extract the rate sheet into JSON per the spec, drawing from the body AND any attachments above.' },
    ];
  } else if (SUPPORTED_TEXT_MIME.has(mt)) {
    const decoded = Buffer.from(opts.dataBase64, 'base64').toString('utf8');
    if (decoded.length > 50000) {
      throw new Error('Text file too large (>50KB). Try a smaller excerpt or convert to PDF.');
    }
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\n\n${decoded}\n\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else {
    throw new IngestUnsupportedError(mt, 'Supported types: PDF, PNG, JPEG, WEBP, GIF, plain text, CSV, HTML, Excel (.xlsx/.xls), email (.eml).');
  }

  // Multi-turn loop: model can call geocode_distance tool to derive
  // per-mile from totals. Hard-cap at MAX_TURNS to prevent runaway loops.
  const MAX_TURNS = 6;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: userContent }];
  let toolCalls = 0;
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Cache the static system prompt — it's ~1500 tokens and identical
    // across every ingest call. Anthropic ephemeral cache (5-min TTL)
    // makes subsequent calls within that window pay ~10% of the input
    // cost on the system block.
    // STREAM the completion rather than a single blocking create(). A large
    // multi-sheet / multi-port matrix workbook produces a big JSON body that can
    // take well over 60s to generate; a non-streaming create() with a 60s cap
    // aborted mid-generation, so those sheets (matrices especially) frequently
    // failed to ingest at all. Streaming keeps the socket alive receiving tokens
    // — no per-request wall — and we assemble the final message when it lands.
    // The SDK's default (10-min) request timeout is the only ceiling now.
    const res = await client.messages
      .stream({
        model,
        // Raised from 4096: LTL class×weight-break configs + banded FSC scales
        // + conditional accessorials make a comprehended rate book's JSON larger.
        max_tokens: 8192,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
        tools: TOOLS,
        messages,
      })
      .finalMessage();
    // Per-call usage telemetry — same shape as ai/client.ts so a single
    // grep over logs covers all AI cost centers.
    try {
      const u = res.usage;
      console.log(
        `[ai.usage] tenant=${opts.tenantId} model=${model} ` +
          `in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} ` +
          `cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0}`
      );
    } catch { /* swallow */ }

    if (res.stop_reason === 'tool_use') {
      const toolUses = res.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );
      // Append assistant message verbatim, then a user message with
      // tool_result blocks for each tool call.
      messages.push({ role: 'assistant', content: res.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const t of toolUses) {
        toolCalls++;
        try {
          const out = await execTool(t.name, (t.input as Record<string, unknown>) ?? {});
          toolResults.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({ error: (err as Error).message }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Terminal turn — text output expected.
    finalText = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    break;
  }

  if (!finalText) throw new Error('Model exhausted tool-use turns without producing JSON.');

  // Strip optional code fences (model sometimes adds them despite instructions)
  const cleaned = finalText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // parseModelJson tolerates a prose preamble/suffix; validateParsed then Zod-
  // validates + SALVAGES (drops malformed array members with a warning) and
  // applies defensive defaults, so callers can always rely on the shape.
  const parsed = validateParsed(parseModelJson(cleaned));

  return { parsed, raw: cleaned, modelUsed: model, toolCalls };
}

/**
 * Parse the model's JSON answer, tolerating a prose preamble/suffix.
 *
 * Despite the "output ONLY JSON" instruction, Sonnet occasionally wraps the
 * object in a sentence of reasoning ("No point-to-point totals are present…
 * { … }"). A bare JSON.parse of the whole string then throws and the whole
 * ingest job fails. We first try a direct parse, then fall back to extracting
 * the outermost brace-balanced object and parsing that.
 */
export function parseModelJson(cleaned: string): Record<string, unknown> {
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to extraction */
  }
  const start = cleaned.indexOf('{');
  if (start !== -1) {
    // Walk forward tracking brace depth (ignoring braces inside strings) to
    // find the matching close for the first '{'.
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = cleaned.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error(`Model returned non-JSON output. First 200 chars: ${cleaned.slice(0, 200)}`);
}

/* ────────────────────────────────────────────────────────────────── *
 * Excel → CSV-text rendering
 * ────────────────────────────────────────────────────────────────── */

/** Per-tab CSV cap (chars). A single dense grid rarely needs more, and it keeps
 *  one runaway tab from starving the others / the model budget. */
export const EXCEL_MAX_PER_SHEET = 120_000;
/** Whole-workbook cap (chars) — FAR above the old 100KB hard reject, so a real
 *  multi-tab carrier tariff (zone-defs + rate-grid + FSC + accessorials) reads,
 *  but a pathological file still can't run away with model cost. */
export const EXCEL_MAX_TOTAL = 500_000;

/**
 * Render an .xlsx/.xls workbook to labeled per-tab CSV text.
 *
 * Bounded, never throwing: each tab is truncated on a row boundary at
 * `maxPerSheet`, the whole workbook at `maxTotal`, and any truncation/omission
 * is annotated inline so the model knows data was cut (rather than silently
 * losing a tab). This is what lets a large multi-tab tariff ingest — the reader
 * classifies + carries every structurally-relevant tab and the model joins them.
 */
export function excelToText(
  dataBase64: string,
  opts?: { maxPerSheet?: number; maxTotal?: number },
): string {
  const maxPerSheet = opts?.maxPerSheet ?? EXCEL_MAX_PER_SHEET;
  const maxTotal = opts?.maxTotal ?? EXCEL_MAX_TOTAL;
  const buf = Buffer.from(dataBase64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  let used = 0;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    let csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (!csv.trim()) continue;
    if (csv.length > maxPerSheet) {
      // Cut on the last row boundary that fits, so we never split mid-row.
      const cut = csv.lastIndexOf('\n', maxPerSheet);
      csv = csv.slice(0, cut > 0 ? cut : maxPerSheet) +
        `\n[... tab "${sheetName}" truncated to ~${Math.round(maxPerSheet / 1000)}KB to fit the model context — request this tab alone for full detail ...]`;
    }
    const block = `### Sheet: ${sheetName}\n${csv}`;
    if (used + block.length > maxTotal) {
      const remaining = Math.max(0, maxTotal - used);
      if (remaining > 500) parts.push(block.slice(0, remaining));
      parts.push(
        `[... workbook exceeds the ~${Math.round(maxTotal / 1000)}KB read budget; remaining tab(s) omitted. Split the workbook or send the rate-grid + zone-legend tabs. ...]`,
      );
      break;
    }
    parts.push(block);
    used += block.length + 2; // +2 for the '\n\n' join
  }
  return parts.join('\n\n');
}

/* ────────────────────────────────────────────────────────────────── *
 * .eml → body text + attachment content blocks
 * ────────────────────────────────────────────────────────────────── */
async function emlToContentBlocks(dataBase64: string): Promise<{
  content: string;
  attachmentBlocks: Anthropic.Messages.ContentBlockParam[];
}> {
  const buf = Buffer.from(dataBase64, 'base64');
  const parsed = await simpleParser(buf);
  const headerLine =
    `Subject: ${parsed.subject ?? ''}\n` +
    `From: ${(parsed.from?.text) ?? ''}\n` +
    `To: ${(Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to?.text) ?? ''}\n` +
    `Date: ${parsed.date?.toISOString() ?? ''}\n`;
  const body = (parsed.text ?? parsed.html ?? '').toString().slice(0, 20_000);
  const content = headerLine + '\n' + body;

  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const att of parsed.attachments ?? []) {
    const block = attachmentToBlock(att);
    if (block) blocks.push(block);
  }
  return { content, attachmentBlocks: blocks };
}

function attachmentToBlock(att: Attachment): Anthropic.Messages.ContentBlockParam | null {
  const mt = (att.contentType ?? '').toLowerCase();
  const data = att.content?.toString('base64');
  if (!data) return null;

  if (mt === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }
  if (SUPPORTED_VISION_MIME.has(mt)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mt as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data },
    };
  }
  if (EXCEL_MIME.has(mt)) {
    const text = excelToText(data);
    return { type: 'text', text: `--- ATTACHMENT (${att.filename ?? 'untitled'}) ---\n${text}\n--- END ATTACHMENT ---` };
  }
  if (SUPPORTED_TEXT_MIME.has(mt)) {
    const txt = att.content!.toString('utf8').slice(0, 20_000);
    return { type: 'text', text: `--- ATTACHMENT (${att.filename ?? 'untitled'}) ---\n${txt}\n--- END ATTACHMENT ---` };
  }
  // Unsupported attachment type — note its presence but skip content.
  return {
    type: 'text',
    text: `[Skipped attachment "${att.filename ?? 'untitled'}" — unsupported type ${mt}.]`,
  };
}
