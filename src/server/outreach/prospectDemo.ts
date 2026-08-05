/**
 * Prospect-demo logic — the pure core of the AI Outreach Engine's
 * demo-provisioner (Phase 1 centerpiece).
 *
 * Turns an enrichment `CompanyProfile` into a shareable, on-brand LIVE demo:
 * a mode-appropriate sample calculator config + brand identity that the REAL
 * customer widget renders unchanged. NOTHING here touches the database or a
 * tenant — a prospect demo is a `prospect_demos` row, isolated by construction
 * from tenants / MRR / trials / leads (see src/db/schema.ts).
 *
 * Three responsibilities, all pure + unit-tested:
 *   1. deriveDemoConfig(profile)       — pick the best-fit mode + SAMPLE rates.
 *   2. buildProspectWidgetConfig(demo) — synthesize the EXACT shape the widget's
 *      `/api/public/widget/:slug` endpoint returns, so widget.js works unforked
 *      (the demo page just sets its slug to the demo token).
 *   3. buildSampleRateCards / computeProspectQuote — run the SAME calc engine
 *      (src/calc/engine.ts) over the stored sample rates so the demo quotes
 *      realistic numbers with no DB writes.
 */
import type { RateCard } from '../../db/schema.js';
import type {
  ProspectDemoBrand,
  ProspectDemoConfig,
  ProspectDemoSampleCard,
} from '../../db/schema.js';
import type { CompanyProfile } from './enrichCompany.js';
import { calculate, type CalcRequest, type CalcResult } from '../../calc/engine.js';
import { resolveWidgetTheme } from '../widgetThemes.js';
import { resolveQuoteDisclaimer } from '../quoteDisclaimer.js';
import { resolveFeatures, resolveBookingConfig } from '../features.js';

// ─── Sample freight ports (drayage) ──────────────────────────────────────
// A tiny built-in set with coordinates so a drayage demo is fully functional
// WITHOUT depending on the deployed `ports` table: the demo quote route can
// resolve these port codes to lat/lng directly. Real tenants still use the DB
// ports; these are demo-only.
export interface DemoPort {
  code: string;
  name: string;
  city: string;
  state: string;
  country: string;
  lat: number;
  lng: number;
}
export const DEMO_PORTS: DemoPort[] = [
  { code: 'USLAX', name: 'Port of Los Angeles', city: 'Los Angeles', state: 'CA', country: 'US', lat: 33.7395, lng: -118.2597 },
  { code: 'USLGB', name: 'Port of Long Beach', city: 'Long Beach', state: 'CA', country: 'US', lat: 33.7550, lng: -118.2160 },
  { code: 'USNYC', name: 'Port of New York & New Jersey', city: 'Newark', state: 'NJ', country: 'US', lat: 40.6840, lng: -74.1454 },
];

// ─── Canonical modes + sample rate sets ──────────────────────────────────
/** The calculator modes we have a bespoke sample-rate set for. */
export type DemoMode = 'ftl' | 'ltl' | 'drayage' | 'reefer' | 'flatbed' | 'hotshot';

interface DemoServiceSpec {
  service: DemoMode;
  label: string;
  equipments: Array<{ equipment: string; label: string }>;
  cards: ProspectDemoSampleCard[];
  /** Default input fields when the AI didn't suggest any. */
  fields: string[];
}

/** Sensible, freight-literate SAMPLE rates per mode. These are demo defaults —
 *  realistic enough to quote credible numbers, never a real carrier's pricing. */
export const SAMPLE_SERVICES: Record<DemoMode, DemoServiceSpec> = {
  ftl: {
    service: 'ftl',
    label: 'Full Truckload',
    equipments: [
      { equipment: 'dryvan', label: "53' Dry Van" },
      { equipment: 'reefer', label: "53' Reefer" },
    ],
    cards: [
      { service: 'ftl', equipment: 'dryvan', label: "53' Dry Van", ratePerMile: 2.75, minimumCharge: 350, flatFee: 0, fuelSurchargePct: 24, marginPct: 12, maxMiles: null, maxWeightLbs: 45000 },
      { service: 'ftl', equipment: 'reefer', label: "53' Reefer", ratePerMile: 3.35, minimumCharge: 450, flatFee: 0, fuelSurchargePct: 26, marginPct: 12, maxMiles: null, maxWeightLbs: 43000 },
    ],
    fields: ['pickup', 'delivery', 'weight', 'equipment'],
  },
  ltl: {
    service: 'ltl',
    label: 'LTL (Less-than-Truckload)',
    equipments: [{ equipment: 'ltl', label: 'Palletized LTL' }],
    cards: [
      { service: 'ltl', equipment: 'ltl', label: 'Palletized LTL', ratePerMile: 0, minimumCharge: 95, flatFee: 0, fuelSurchargePct: 0, marginPct: 12, maxMiles: null, maxWeightLbs: 15000 },
    ],
    fields: ['pickup', 'delivery', 'pallets', 'class', 'weight'],
  },
  drayage: {
    service: 'drayage',
    label: 'Port Drayage',
    equipments: [
      { equipment: 'container_40hc', label: "40' HC Container" },
      { equipment: 'container_20', label: "20' Container" },
    ],
    cards: [
      { service: 'drayage', equipment: 'container_40hc', label: "40' HC Container", ratePerMile: 4.25, minimumCharge: 375, flatFee: 45, fuelSurchargePct: 18, marginPct: 10, maxMiles: 250, maxWeightLbs: 44000 },
      { service: 'drayage', equipment: 'container_20', label: "20' Container", ratePerMile: 3.95, minimumCharge: 350, flatFee: 45, fuelSurchargePct: 18, marginPct: 10, maxMiles: 250, maxWeightLbs: 44000 },
    ],
    fields: ['port', 'terminal', 'container', 'chassis'],
  },
  reefer: {
    service: 'reefer',
    label: 'Refrigerated (Reefer)',
    equipments: [{ equipment: 'reefer_53', label: "53' Reefer" }],
    cards: [
      { service: 'reefer', equipment: 'reefer_53', label: "53' Reefer", ratePerMile: 3.35, minimumCharge: 450, flatFee: 0, fuelSurchargePct: 26, marginPct: 12, maxMiles: null, maxWeightLbs: 43000 },
    ],
    fields: ['pickup', 'delivery', 'set-temp', 'protect-from-freeze', 'weight'],
  },
  flatbed: {
    service: 'flatbed',
    label: 'Flatbed / Step Deck',
    equipments: [
      { equipment: 'flatbed_48', label: "48' Flatbed" },
      { equipment: 'stepdeck', label: "48' Step Deck" },
    ],
    cards: [
      { service: 'flatbed', equipment: 'flatbed_48', label: "48' Flatbed", ratePerMile: 3.05, minimumCharge: 425, flatFee: 0, fuelSurchargePct: 24, marginPct: 12, maxMiles: null, maxWeightLbs: 48000 },
      { service: 'flatbed', equipment: 'stepdeck', label: "48' Step Deck", ratePerMile: 3.25, minimumCharge: 475, flatFee: 0, fuelSurchargePct: 24, marginPct: 12, maxMiles: null, maxWeightLbs: 45000 },
    ],
    fields: ['pickup', 'delivery', 'length', 'tarps', 'weight'],
  },
  hotshot: {
    service: 'hotshot',
    label: 'Hotshot / Expedited',
    equipments: [{ equipment: 'hotshot_40', label: "40' Gooseneck" }],
    cards: [
      { service: 'hotshot', equipment: 'hotshot_40', label: "40' Gooseneck", ratePerMile: 1.95, minimumCharge: 250, flatFee: 0, fuelSurchargePct: 20, marginPct: 12, maxMiles: null, maxWeightLbs: 16500 },
    ],
    fields: ['pickup', 'delivery', 'weight'],
  },
};

/** Map enrichment mode strings (AI-suggested or detected) → a canonical mode we
 *  have sample rates for. Unknown / empty → 'ftl' (the safe universal default). */
export function canonicalMode(input: string | null | undefined): DemoMode {
  const s = (input || '').toString().trim().toLowerCase();
  if (!s) return 'ftl';
  if (/drayage|container|\bport\b|intermodal|transload/.test(s)) return 'drayage';
  if (/reefer|refrigerat|temperature|cold\s*chain/.test(s)) return 'reefer';
  if (/flat\s*bed|flatbed|step\s*deck|stepdeck|conestoga/.test(s)) return 'flatbed';
  if (/hot\s*shot|hotshot|expedit/.test(s)) return 'hotshot';
  if (/\bltl\b|less[-\s]?than/.test(s)) return 'ltl';
  if (/\bftl\b|full[-\s]?truck|truckload|dry\s*van|van\b/.test(s)) return 'ftl';
  return 'ftl';
}

// ─── Config derivation ───────────────────────────────────────────────────
/**
 * From an enrichment `CompanyProfile`, derive the demo calculator config: the
 * best-fit primary mode (AI suggestion first, then detected modes), plus any
 * other detected modes we support — so a multi-mode carrier sees multiple
 * buttons. Sample rates + fields come from SAMPLE_SERVICES.
 */
export function deriveDemoConfig(profile: CompanyProfile): ProspectDemoConfig {
  const suggested = profile.ai?.suggestedCalculator?.mode;
  const detected = Array.isArray(profile.serviceModes) ? profile.serviceModes : [];
  const primaryMode = canonicalMode(suggested || detected[0] || 'ftl');

  // Primary first, then other detected modes we support — deduped, capped at 3
  // so the demo stays focused.
  const ordered: DemoMode[] = [primaryMode];
  for (const m of detected) {
    const c = canonicalMode(m);
    if (!ordered.includes(c)) ordered.push(c);
    if (ordered.length >= 3) break;
  }

  const services = ordered.map((m) => {
    const spec = SAMPLE_SERVICES[m];
    return {
      service: spec.service,
      label: spec.label,
      equipments: spec.equipments.map((e) => ({ ...e })),
    };
  });
  const sampleCards: ProspectDemoSampleCard[] = ordered.flatMap((m) =>
    SAMPLE_SERVICES[m].cards.map((c) => ({ ...c }))
  );

  const aiFields = profile.ai?.suggestedCalculator?.fields;
  const fields =
    Array.isArray(aiFields) && aiFields.length > 0
      ? aiFields.filter((f) => typeof f === 'string')
      : SAMPLE_SERVICES[primaryMode].fields.slice();

  const countryFocus = inferCountryFocus(profile);

  return { primaryMode, services, sampleCards, fields, countryFocus };
}

function inferCountryFocus(profile: CompanyProfile): 'US' | 'CA' {
  const hay = [profile.mailingAddress ?? '', ...(profile.regionsLanes ?? [])].join(' ').toLowerCase();
  if (/\bcanada\b|\bontario\b|\bquebec\b|\bcanadian\b/.test(hay)) return 'CA';
  return 'US';
}

/** Brand identity extracted from a profile (persisted as `brand_json`). */
export function deriveDemoBrand(profile: CompanyProfile): ProspectDemoBrand {
  return {
    primary: profile.brandColors?.primary ?? null,
    secondary: profile.brandColors?.secondary ?? null,
    logoUrl: profile.logoUrl ?? null,
    companyName: profile.companyName ?? null,
  };
}

// ─── Sample rate cards → full RateCard rows (in-memory only) ──────────────
const RATE_EPOCH = new Date('2026-01-01T00:00:00Z');

/** Expand the stored sample cards into full `RateCard` objects the calc engine
 *  can price against. Never persisted — id/tenantId are synthetic. */
export function buildSampleRateCards(config: ProspectDemoConfig | null | undefined): RateCard[] {
  const cards = config?.sampleCards ?? [];
  return cards.map((c, i) => ({
    id: i + 1,
    tenantId: 0,
    service: c.service,
    equipment: c.equipment,
    label: c.label,
    ratePerMile: c.ratePerMile,
    minimumCharge: c.minimumCharge,
    flatFee: c.flatFee,
    fuelSurchargePct: c.fuelSurchargePct,
    marginPct: c.marginPct,
    maxWeightLbs: c.maxWeightLbs,
    maxMiles: c.maxMiles,
    ltlConfig: null,
    enabled: true,
    sortOrder: i,
    notes: null,
    lastAiEditAt: null,
    lastAiEditReason: null,
    createdAt: RATE_EPOCH,
    updatedAt: RATE_EPOCH,
  }));
}

/** Run the REAL calc engine over the demo's sample rates. Manual FSC (each
 *  card's fixed %), no accessorials/zones/terminals — a clean sample quote. */
export function computeProspectQuote(config: ProspectDemoConfig | null | undefined, req: CalcRequest): CalcResult {
  const cards = buildSampleRateCards(config);
  return calculate(cards, [], [], req, [], { mode: 'manual' });
}

// ─── Widget config synthesis (matches /api/public/widget/:slug shape) ─────
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
function normalizeHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (!HEX_RE.test(s)) return null;
  return s.startsWith('#') ? s : '#' + s;
}

/** The record shape the widget-config + quote builders read (a `prospect_demos`
 *  row, or an equivalent in tests). */
export interface ProspectDemoRecord {
  token: string;
  domain: string;
  companyName: string | null;
  profileJson: Record<string, unknown> | null;
  brandJson: ProspectDemoBrand | null;
  configJson: ProspectDemoConfig | null;
  viewedAt?: Date | null;
}

/** Default light, premium preset for the demo — the prospect's brand colour is
 *  layered on top as the accent so the calculator reads as genuinely "theirs". */
export const DEMO_THEME_PRESET = 'cupertino';

/**
 * Synthesize the EXACT object shape `/api/public/widget/:slug` returns, from a
 * prospect demo record. widget.js consumes this unchanged — no fork. Brand
 * colours drive the theme accent; the demo shows the price BEFORE asking for
 * contact (showQuoteBeforeContact) so a prospect sees an instant quote.
 */
export function buildProspectWidgetConfig(rec: ProspectDemoRecord) {
  const brand = rec.brandJson ?? { primary: null, secondary: null, logoUrl: null, companyName: null };
  const cfg = rec.configJson ?? { primaryMode: 'ftl', services: [], sampleCards: [], fields: [], countryFocus: 'US' as const };
  const profile = (rec.profileJson ?? {}) as Record<string, unknown>;
  const displayName = brand.companyName || rec.companyName || rec.domain;
  const accent = normalizeHex(brand.primary);

  const theme = resolveWidgetTheme({
    themePreset: DEMO_THEME_PRESET,
    accentOverride: accent,
    primaryColor: accent,
  });

  const widgetBrand = {
    displayName,
    tagline: typeof profile.tagline === 'string' ? profile.tagline : null,
    logoUrl: brand.logoUrl,
    showPoweredBy: true,
    requireEmail: true,
    requirePhone: false,
    // Show the computed price first — the demo's job is to WOW, then convert.
    showQuoteBeforeContact: true,
    ctaText: 'Get instant quote',
    mapStyle: null as string | null,
    primaryColor: accent,
    accentColor: accent,
    allowedDomains: null as string | null,
    featuresJson: null as Record<string, boolean> | null,
  };

  const services = cfg.services.map((s) => s.service);
  const equipmentByService: Record<string, Array<{ equipment: string; label: string }>> = {};
  for (const s of cfg.services) {
    equipmentByService[s.service] = s.equipments.map((e) => ({ equipment: e.equipment, label: e.label }));
  }

  const hasDrayage = services.includes('drayage');
  const drayagePorts = hasDrayage
    ? DEMO_PORTS.map((p) => ({ code: p.code, name: p.name, city: p.city, state: p.state, country: p.country }))
    : [];

  const contact = {
    phone: typeof profile.phone === 'string' ? profile.phone : null,
    email: typeof profile.email === 'string' ? profile.email : null,
    address: typeof profile.mailingAddress === 'string' ? profile.mailingAddress : null,
    mcNumber: null as string | null,
    dotNumber: null as string | null,
    chat: null as string | null,
  };

  return {
    // A prospect preview — flagged so any consumer can tell it apart from a tenant.
    demo: true,
    tenant: { slug: rec.token, name: displayName, countryFocus: cfg.countryFocus },
    contact,
    disclaimer: resolveQuoteDisclaimer(null),
    features: resolveFeatures(null),
    booking: { ...resolveBookingConfig(null), chargeReady: false },
    brand: widgetBrand,
    theme,
    services,
    equipmentByService,
    accessorials: [] as Array<Record<string, unknown>>,
    drayagePorts,
    terminalsByPort: {} as Record<string, unknown>,
    hasZones: false,
  };
}
