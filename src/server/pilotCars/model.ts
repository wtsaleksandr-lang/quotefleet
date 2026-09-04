/**
 * THE PILOT-CAR OPERATOR RECORD — validation, normalisation and the public
 * projection. PURE: no database, no clock beyond an injected `now`, no I/O.
 *
 * Split out from the store and the routes so the shape can be tested without a
 * database, which matters more here than usual: the dev Neon branch is over
 * quota, so anything that can only be exercised against a live table cannot be
 * exercised at all right now.
 *
 * ── THE TWO RULES THAT SHAPE EVERYTHING BELOW ─────────────────────────────
 *
 * 1. OPT-IN ONLY. A record exists because the operator submitted it. Nothing
 *    here imports, scrapes or seeds from another directory, and there is no
 *    code path that creates a record from anything but a submission carrying
 *    `consentPublicListing: true`. `SubmissionSchema` refuses the literal
 *    `false`, so an un-consented record cannot be constructed even by a caller
 *    that means well.
 *
 * 2. A CLAIM IS NOT A VERIFICATION. `verificationTier` defaults to
 *    `'self-asserted'` and the submission schema CANNOT SET IT — the field is
 *    absent from the schema entirely, so no request body can promote a record.
 *    Only a moderator action moves a record up a tier, and the public
 *    projection carries the tier on every operator so a page can never render a
 *    self-reported claim with the styling of a checked one. That is the precise
 *    failure of both incumbent directories: truckinfo.net prints self-asserted
 *    certifications with no indication that nobody checked them.
 *
 * ── WHY CERTIFICATION IS AN ARRAY OF PER-STATE ROWS ───────────────────────
 * Because "certified" is not a property of an operator. It is a property of an
 * (operator, state) pair with its own issue date, its own expiry and its own
 * evidence, and the states disagree with each other about whether it is even
 * required — see `src/calc/osow/pilotCar/certification.ts`, which records two
 * pages of the same Virginia DMV contradicting each other. A boolean column
 * cannot express "certified in Washington, expired in Georgia, and Kentucky
 * does not certify anyone", and that sentence is the product.
 */
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { PILOT_CAR_STATE_CODES, certificationFor } from '../../calc/osow/pilotCar/certification.js';

const STATE_SET: ReadonlySet<string> = new Set(PILOT_CAR_STATE_CODES);

/** How much we actually know about a record's claims. Ordered weakest first. */
export const VERIFICATION_TIERS = ['self-asserted', 'document-on-file', 'registry-verified'] as const;
export type VerificationTier = (typeof VERIFICATION_TIERS)[number];

/**
 * The words that go on the page for each tier, and the words that go under
 * them. Held here so the listing card, the profile, the JSON API and the tests
 * cannot describe the same tier three different ways.
 *
 * NOTE WHAT `self-asserted` SAYS. It does not say "unverified" and stop there —
 * it says who said it and that nobody checked, because a reader skimming a card
 * needs the attribution more than the adjective.
 */
export const VERIFICATION_LABEL: Readonly<Record<VerificationTier, { label: string; meaning: string }>> =
  Object.freeze({
    'self-asserted': {
      label: 'Self-reported',
      meaning:
        'Entered by the operator. QuoteFleet has not checked it against any state record. Ask for the certificate and the insurance certificate before you dispatch.',
    },
    'document-on-file': {
      label: 'Document seen',
      meaning:
        'The operator sent a certificate or insurance document and a person here looked at it on the date shown. We are not the issuer and we cannot confirm it is still in force today.',
    },
    'registry-verified': {
      label: 'Checked against the state register',
      meaning:
        'Checked against the issuing state\'s own published register on the date shown, with the register linked. This is the only tier where a claim was confirmed by its issuer.',
    },
  });

/** Where a record is in the moderation queue. */
export const LISTING_STATUSES = ['pending', 'published', 'rejected', 'withdrawn'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Per-state certification status an operator can claim. */
export const CERT_STATUSES = ['certified', 'reciprocity', 'not-required', 'none'] as const;
export type CertStatus = (typeof CERT_STATUSES)[number];

/**
 * The escort VEHICLE, as a body class.
 *
 * Kept SEPARATE from `vehicleGvwrLbs` because the two restrictions in the wild
 * are different kinds of rule. Tennessee caps the escort vehicle by GVWR — under
 * 18,000 lb and over 2,000 lb, cited in the certification registry — which is a
 * mass test. Ontario is published as full-size pickups only, which is a body
 * test no mass figure resolves. An operator filtered on one is not filtered on
 * the other, so both are asked for and both are stored.
 */
export const VEHICLE_CLASSES = [
  'car',
  'suv',
  'pickup-full-size',
  'pickup-compact',
  'van',
  'other',
] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];

export const VEHICLE_CLASS_LABEL: Readonly<Record<VehicleClass, string>> = Object.freeze({
  car: 'Car',
  suv: 'SUV',
  'pickup-full-size': 'Full-size pickup',
  'pickup-compact': 'Compact pickup',
  van: 'Van',
  other: 'Other',
});

/** The equipment flags a filter can ask for. One key per stored column. */
export const EQUIPMENT_KEYS = [
  'heightPole',
  'oversizeSigns',
  'flags',
  'amberLightBar',
  'twoWayRadio',
] as const;
export type EquipmentKey = (typeof EQUIPMENT_KEYS)[number];

export const EQUIPMENT_LABEL: Readonly<Record<EquipmentKey, string>> = Object.freeze({
  heightPole: 'Height pole',
  oversizeSigns: 'OVERSIZE LOAD signs',
  flags: 'Flags',
  amberLightBar: 'Amber light bar',
  twoWayRadio: 'Two-way radio / CB',
});

// ── Submission ─────────────────────────────────────────────────────────────

const stateCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => STATE_SET.has(v), { message: 'Not a US state code this directory covers.' });

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.');

/**
 * One state's certification fact.
 *
 * `expiresOn` IS ASKED FOR AND NEVER INVENTED. A certificate with no expiry on
 * file is recorded with `expiresOn: null` and rendered as "no expiry date on
 * file", not as "current". Colorado's runs four years, Oklahoma's five,
 * Washington's three — there is no safe default to fill in, and filling one in
 * is how a lapsed card comes back as valid.
 */
const CertificationSchema = z.object({
  state: stateCode,
  status: z.enum(CERT_STATUSES),
  /** The issuing state, where the operator works on another state's card. */
  issuedByState: stateCode.optional(),
  issuedOn: isoDate.nullish(),
  expiresOn: isoDate.nullish(),
});

export type CertificationClaim = z.infer<typeof CertificationSchema>;

const trimmed = (max: number) => z.string().trim().max(max);

export const SubmissionSchema = z
  .object({
    businessName: trimmed(120).min(2, 'Enter the name your customers book you under.'),
    contactName: trimmed(120).optional(),
    email: z.string().trim().toLowerCase().email('Enter an email we can reach you at.').max(200),
    phone: trimmed(40).optional(),
    website: z
      .string()
      .trim()
      .max(300)
      .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Start the website with http:// or https://')
      .optional(),
    homeBaseCity: trimmed(80).optional(),
    homeBaseState: stateCode.optional(),
    serviceRadiusMi: z.number().int().min(0).max(3_000).nullish(),
    statesCovered: z.array(stateCode).min(1, 'Pick at least one state you actually run in.').max(51),
    certifications: z.array(CertificationSchema).max(51).default([]),
    /**
     * States the operator BELIEVES will accept a certificate they hold. Stored
     * apart from `certifications` and never merged into `certifiedStates`: it is
     * the operator's reading of a reciprocity table, and the states themselves
     * publish those tables asymmetrically and sometimes not at all.
     */
    reciprocityClaimedStates: z.array(stateCode).max(51).default([]),
    languages: z.array(trimmed(40)).max(10).default([]),
    hasHeightPole: z.boolean().default(false),
    /** Measured pole height in inches. Only meaningful with `hasHeightPole`. */
    heightPoleMaxIn: z.number().int().min(0).max(400).nullish(),
    hasOversizeSigns: z.boolean().default(false),
    hasFlags: z.boolean().default(false),
    hasAmberLightBar: z.boolean().default(false),
    hasTwoWayRadio: z.boolean().default(false),
    vehicleClass: z.enum(VEHICLE_CLASSES).nullish(),
    vehicleGvwrLbs: z.number().int().min(500).max(80_000).nullish(),
    takesSuperloads: z.boolean().default(false),
    takesNightMoves: z.boolean().default(false),
    insuranceLiabilityUsd: z.number().int().min(0).max(100_000_000).nullish(),
    insuranceExpiresOn: isoDate.nullish(),
    /** Per field, because a public listing is the operator's choice per field. */
    publishEmail: z.boolean().default(false),
    publishPhone: z.boolean().default(false),
    publishContactName: z.boolean().default(false),
    /**
     * THE OPT-IN. `z.literal(true)` and not `z.boolean()`: a submission without
     * it is not a record with a flag turned off, it is not a record.
     */
    consentPublicListing: z.literal(true),
  })
  .superRefine((v, ctx) => {
    // A pole height with no pole is a contradiction, and the contradiction
    // matters: several states specify the pole rather than merely require one,
    // so "10 ft pole, no pole" is not a harmless inconsistency to store.
    if (!v.hasHeightPole && v.heightPoleMaxIn != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['heightPoleMaxIn'],
        message: 'You entered a pole height but did not tick "carries a height pole".',
      });
    }
    // A certification row must name the state it was issued by when the
    // operator is working on someone else's card, or the reciprocity question
    // has no subject.
    for (const [i, c] of v.certifications.entries()) {
      if (c.status === 'reciprocity' && !c.issuedByState) {
        ctx.addIssue({
          code: 'custom',
          path: ['certifications', i, 'issuedByState'],
          message: 'Say which state issued the certificate you are working on here.',
        });
      }
    }
    // Publishing nothing reachable makes a listing that cannot be booked. We
    // refuse it at submission rather than publishing a dead end.
    if (!v.publishEmail && !v.publishPhone) {
      ctx.addIssue({
        code: 'custom',
        path: ['publishPhone'],
        message:
          'Publish at least one of your phone number or your email, or nobody can book you. Everything else stays private.',
      });
    }
  });

export type Submission = z.infer<typeof SubmissionSchema>;

// ── Derivation ─────────────────────────────────────────────────────────────

/**
 * The states an operator may be filtered as CERTIFIED in.
 *
 * ONLY `status === 'certified'` counts, and expiry is checked against `asOf`.
 * `'reciprocity'` deliberately does NOT count: the operator holds another
 * state's card and whether this state takes it is the working state's call, not
 * theirs — Oklahoma publishes no reciprocal list at all and New York accepts
 * nobody. A reciprocity claim is stored, shown and labelled as a claim; it is
 * never allowed to satisfy a "certified in KY" filter.
 */
export function certifiedStatesFrom(
  certifications: readonly CertificationClaim[],
  asOf: string,
): string[] {
  const out = new Set<string>();
  for (const c of certifications) {
    if (c.status !== 'certified') continue;
    if (c.expiresOn != null && c.expiresOn < asOf) continue;
    out.add(c.state);
  }
  return [...out].sort();
}

/** `Bay State Escorts` + `TX` → `bay-state-escorts-tx`. */
export function slugify(businessName: string, homeBaseState?: string | null): string {
  const base = String(businessName ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const st = String(homeBaseState ?? '').trim().toLowerCase();
  const slug = st ? `${base}-${st}` : base;
  return slug.replace(/^-+|-+$/g, '') || 'operator';
}

/**
 * The manage token. 32 random bytes, base64url.
 *
 * Returned to the operator ONCE, in the response to their own submission, and
 * stored only as a SHA-256. A database read therefore cannot produce a working
 * manage link — which is the property that lets the record hold a phone number
 * and an email without the table becoming a set of account credentials.
 */
export function newManageToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashManageToken(token: string): string {
  return createHash('sha256').update(String(token ?? ''), 'utf8').digest('hex');
}

// ── The public projection ──────────────────────────────────────────────────

/** What a certification looks like once it is on a page. */
export interface PublicCertification {
  state: string;
  status: CertStatus;
  issuedByState: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  /** Computed against `asOf`, so a lapsed card reads as lapsed and not as held. */
  expired: boolean;
  /** What the STATE says about certification, from the cited registry. */
  stateRequirement: string;
}

export interface PublicOperator {
  slug: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  homeBaseCity: string | null;
  homeBaseState: string | null;
  serviceRadiusMi: number | null;
  statesCovered: string[];
  certifiedStates: string[];
  certifications: PublicCertification[];
  reciprocityClaimedStates: string[];
  languages: string[];
  equipment: Record<EquipmentKey, boolean>;
  heightPoleMaxIn: number | null;
  vehicleClass: VehicleClass | null;
  vehicleGvwrLbs: number | null;
  takesSuperloads: boolean;
  takesNightMoves: boolean;
  insuranceLiabilityUsd: number | null;
  insuranceExpiresOn: string | null;
  insuranceExpired: boolean;
  verificationTier: VerificationTier;
  verificationNote: string | null;
  verificationSourceUrl: string | null;
  verifiedOn: string | null;
  updatedAt: string | null;
  lastConfirmedAt: string | null;
}

/** The stored row, as the store hands it over. */
export interface OperatorRow {
  public_slug: string;
  business_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  home_base_city: string | null;
  home_base_state: string | null;
  service_radius_mi: number | null;
  states_covered: unknown;
  certified_states: unknown;
  certifications_json: unknown;
  reciprocity_claimed_states: unknown;
  languages: unknown;
  has_height_pole: boolean;
  height_pole_max_in: number | null;
  has_oversize_signs: boolean;
  has_flags: boolean;
  has_amber_light_bar: boolean;
  has_two_way_radio: boolean;
  vehicle_class: string | null;
  vehicle_gvwr_lbs: number | null;
  takes_superloads: boolean;
  takes_night_moves: boolean;
  insurance_liability_usd: number | null;
  insurance_expires_on: string | Date | null;
  verification_tier: string;
  verification_note: string | null;
  verification_source_url: string | null;
  verified_on: string | Date | null;
  publish_email: boolean;
  publish_phone: boolean;
  publish_contact_name: boolean;
  listing_status: string;
  updated_at: string | Date | null;
  last_confirmed_at: string | Date | null;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asCerts(v: unknown): CertificationClaim[] {
  const raw: unknown = typeof v === 'string' ? safeJson(v) : v;
  if (!Array.isArray(raw)) return [];
  const out: CertificationClaim[] = [];
  for (const item of raw) {
    const parsed = CertificationSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** A date column that may arrive as a Date or as a string. `null` stays null. */
function isoOf(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function tierOf(v: string): VerificationTier {
  return (VERIFICATION_TIERS as readonly string[]).includes(v) ? (v as VerificationTier) : 'self-asserted';
}

/**
 * Row → page. THE ONLY PLACE a private field can become a public one.
 *
 * Contact fields are gated on their own `publish_*` flag and returned as `null`
 * otherwise — not omitted, so a consumer that forgets to check gets a null
 * rather than an undefined it can coalesce into something. `contact_name` is
 * treated as contact data, not as a business name: a sole trader's listing is
 * their own name and their choice whether it appears.
 */
export function toPublicOperator(row: OperatorRow, asOf: string): PublicOperator {
  const certs = asCerts(row.certifications_json);
  const insuranceExpiresOn = isoOf(row.insurance_expires_on);
  return {
    slug: row.public_slug,
    businessName: row.business_name,
    contactName: row.publish_contact_name ? row.contact_name : null,
    email: row.publish_email ? row.email : null,
    phone: row.publish_phone ? row.phone : null,
    website: row.website,
    homeBaseCity: row.home_base_city,
    homeBaseState: row.home_base_state,
    serviceRadiusMi: row.service_radius_mi,
    statesCovered: asArray(row.states_covered),
    certifiedStates: asArray(row.certified_states),
    certifications: certs.map((c) => ({
      state: c.state,
      status: c.status,
      issuedByState: c.issuedByState ?? null,
      issuedOn: c.issuedOn ?? null,
      expiresOn: c.expiresOn ?? null,
      expired: c.expiresOn != null && c.expiresOn < asOf,
      stateRequirement: certificationFor(c.state)?.requirement ?? 'unknown',
    })),
    reciprocityClaimedStates: asArray(row.reciprocity_claimed_states),
    languages: asArray(row.languages),
    equipment: {
      heightPole: row.has_height_pole === true,
      oversizeSigns: row.has_oversize_signs === true,
      flags: row.has_flags === true,
      amberLightBar: row.has_amber_light_bar === true,
      twoWayRadio: row.has_two_way_radio === true,
    },
    heightPoleMaxIn: row.height_pole_max_in,
    vehicleClass: (VEHICLE_CLASSES as readonly string[]).includes(String(row.vehicle_class))
      ? (row.vehicle_class as VehicleClass)
      : null,
    vehicleGvwrLbs: row.vehicle_gvwr_lbs,
    takesSuperloads: row.takes_superloads === true,
    takesNightMoves: row.takes_night_moves === true,
    insuranceLiabilityUsd: row.insurance_liability_usd,
    insuranceExpiresOn,
    insuranceExpired: insuranceExpiresOn != null && insuranceExpiresOn < asOf,
    verificationTier: tierOf(row.verification_tier),
    verificationNote: row.verification_note,
    verificationSourceUrl: row.verification_source_url,
    verifiedOn: isoOf(row.verified_on),
    updatedAt: isoOf(row.updated_at),
    lastConfirmedAt: isoOf(row.last_confirmed_at),
  };
}

// ── Filters ────────────────────────────────────────────────────────────────

/**
 * A parsed, validated filter set. Every field maps to a stored column — there
 * is no free-text bucket here on purpose, because "searchable prose" is the
 * incumbent design and the reason neither incumbent can answer a real question.
 */
export interface OperatorFilters {
  /** Operator must cover EVERY state listed. A lane is an AND, not an OR. */
  states: string[];
  /** Operator must hold a live certificate in EVERY state listed. */
  certifiedIn: string[];
  equipment: EquipmentKey[];
  /** Escort vehicle at or under this GVWR, in pounds. */
  maxGvwrLbs: number | null;
  vehicleClass: VehicleClass | null;
  superloads: boolean;
  nightMoves: boolean;
  /** At least this much liability cover, in whole dollars. */
  minInsuranceUsd: number | null;
  /** Minimum verification tier, by index into VERIFICATION_TIERS. */
  minTier: VerificationTier | null;
  page: number;
}

export const OPERATORS_PER_PAGE = 24;

/**
 * State codes from a query value, in EITHER of the two shapes this page emits.
 *
 * A native `<select multiple name="states">` submits one parameter PER selected
 * option — `?states=KY&states=TN` — which Express hands over as an array. The
 * canonical links this module builds use the comma form — `?states=KY,TN` —
 * because it survives a copy-paste into an email intact. Both are valid URLs
 * for this page and both must parse identically, so this flattens an array,
 * splits on commas, and does neither by accident: relying on `String(array)`
 * happening to produce a comma list works until a nested value arrives and
 * silently yields "KY,TN,[object Object]".
 */
function codeList(raw: unknown, limit = 12): string[] {
  const flat: string[] = Array.isArray(raw)
    ? raw.flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    : String(raw ?? '').split(',');
  const parts = flat.map((s) => s.trim().toUpperCase()).filter((s) => STATE_SET.has(s));
  return [...new Set(parts)].slice(0, limit);
}

function intOrNull(raw: unknown, min: number, max: number): number | null {
  // AN ABSENT PARAMETER IS NOT ZERO. `Number('')` is 0, so without this guard an
  // untouched "Any cover" select parsed as `minInsuranceUsd: 0` — a filter whose
  // `>= 0` comparison silently EXCLUDED every operator with no stated cover,
  // from a form the user never touched.
  const text = String(raw ?? '').replace(/[,\s$]/g, '');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= min && i <= max ? i : null;
}

/**
 * Parse a query string into filters. NEVER THROWS and never 400s: an
 * unrecognised value is dropped, because a shared link with a stale parameter
 * should render the directory, not an error page.
 *
 * The AND semantics on `states` is the one decision worth arguing with. A lane
 * that crosses seven states needs an operator who can work all seven, and an OR
 * would return the operator who works one of them as a match — which reads as
 * an answer and is not one. The empty state says so and offers the per-state
 * links, so nobody is left at a dead end.
 */
export function parseFilters(query: Record<string, unknown>): OperatorFilters {
  // Same two shapes again: the checkbox group posts one `equip` per box.
  const equipRaw: string[] = Array.isArray(query.equip)
    ? query.equip.flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    : String(query.equip ?? '').split(',');
  const equip = equipRaw
    .map((s) => s.trim())
    .filter((s): s is EquipmentKey => (EQUIPMENT_KEYS as readonly string[]).includes(s));
  const tier = String(query.tier ?? '');
  const vclass = String(query.vclass ?? '');
  return {
    states: codeList(query.states ?? query.state),
    certifiedIn: codeList(query.certin),
    equipment: [...new Set(equip)],
    maxGvwrLbs: intOrNull(query.maxgvwr, 500, 80_000),
    vehicleClass: (VEHICLE_CLASSES as readonly string[]).includes(vclass) ? (vclass as VehicleClass) : null,
    superloads: String(query.superload ?? '') === '1',
    nightMoves: String(query.night ?? '') === '1',
    minInsuranceUsd: intOrNull(query.mininsurance, 0, 100_000_000),
    minTier: (VERIFICATION_TIERS as readonly string[]).includes(tier) ? (tier as VerificationTier) : null,
    page: Math.max(1, intOrNull(query.page, 1, 500) ?? 1),
  };
}

/** Rebuild a canonical query string from filters. Empty for "no filters". */
export function filtersToQuery(f: OperatorFilters): string {
  const p = new URLSearchParams();
  if (f.states.length) p.set('states', f.states.join(','));
  if (f.certifiedIn.length) p.set('certin', f.certifiedIn.join(','));
  if (f.equipment.length) p.set('equip', f.equipment.join(','));
  if (f.maxGvwrLbs != null) p.set('maxgvwr', String(f.maxGvwrLbs));
  if (f.vehicleClass) p.set('vclass', f.vehicleClass);
  if (f.superloads) p.set('superload', '1');
  if (f.nightMoves) p.set('night', '1');
  if (f.minInsuranceUsd != null) p.set('mininsurance', String(f.minInsuranceUsd));
  if (f.minTier) p.set('tier', f.minTier);
  if (f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function hasAnyFilter(f: OperatorFilters): boolean {
  return (
    f.states.length > 0 ||
    f.certifiedIn.length > 0 ||
    f.equipment.length > 0 ||
    f.maxGvwrLbs != null ||
    f.vehicleClass != null ||
    f.superloads ||
    f.nightMoves ||
    f.minInsuranceUsd != null ||
    f.minTier != null
  );
}

/**
 * The deep link a quote tool sends a dispatcher to.
 *
 * `certIn` is intersected with the states that actually certify, from the cited
 * registry — sending someone to "certified in Kentucky" would be filtering on a
 * certificate Kentucky does not issue, and would return zero operators forever.
 * That intersection is the whole reason this helper exists rather than the
 * caller building a query string.
 */
export function escortDirectoryHref(
  lanStates: readonly string[],
  opts: { certifiedOnly?: boolean } = {},
): string {
  const states = [...new Set(lanStates.map((s) => String(s).toUpperCase()))].filter((s) =>
    STATE_SET.has(s),
  );
  const p = new URLSearchParams();
  if (states.length) p.set('states', states.join(','));
  if (opts.certifiedOnly !== false) {
    const certIn = states.filter((s) => {
      const r = certificationFor(s)?.requirement;
      return r === 'required' || r === 'disputed';
    });
    if (certIn.length) p.set('certin', certIn.join(','));
  }
  const q = p.toString();
  return `/pilot-cars${q ? `?${q}` : ''}`;
}
