/**
 * Turns a tenant's post-signup onboarding answers into a short, natural-language
 * context block for the AI prompts.
 *
 * The onboarding wizard asks the carrier which freight modes they run, how they
 * price, and where they operate — and until this helper existed those answers
 * were written to `tenants.onboardingJson` and never read by anything except the
 * "should we show the wizard?" gate. Every prompt was therefore generic. This is
 * the piece that makes the schema comment ("also feed the AI context") true.
 *
 * Design notes:
 *  - PURE function of the tenant row. No DB, no network, no clock — trivially
 *    testable and safe to call on every prompt build.
 *  - Degrades to '' (empty string) on missing/partial data. Most existing
 *    tenants predate the wizard and read `onboardingJson: null`; they must get
 *    an unchanged prompt, never a half sentence or a stray "undefined".
 *  - The region list is capped so a carrier who ticks 50 states can't balloon
 *    the system prompt.
 */
import type { Tenant } from '../db/schema.js';

/** The stored onboarding record, minus the null. */
type Onboarding = NonNullable<Tenant['onboardingJson']>;
type ServiceArea = NonNullable<Onboarding['serviceArea']>;

/** Only the fields this helper reads — keeps it callable from tests with a
 *  small literal instead of a full 40-column tenant row. */
export interface CarrierContextInput {
  name?: string | null;
  onboardingJson?: Onboarding | null;
}

/** Max region codes listed inline before we collapse to "and N more". */
export const MAX_LISTED_REGIONS = 12;

/** Prose labels for the six wizard verticals (see calc/seedTemplates.ts). */
const VERTICAL_PHRASES: Record<string, string> = {
  // No internal " and " in these labels — joinList() uses "and" as the list
  // conjunction, so "flatbed and open-deck" would read as two separate modes.
  drayage: 'port/rail drayage',
  dryvan_ftl: 'dry van FTL',
  reefer: 'reefer (temperature-controlled)',
  ltl: 'LTL/partial loads',
  hotshot: 'hotshot/expedited',
  flatbed: 'flatbed/open-deck',
};

/** Prose for the pricing modes. Slots into "They price ___." */
const PRICING_PHRASES: Record<string, string> = {
  per_mile: 'primarily per mile',
  flat: 'primarily as a flat rate per load',
  min_mileage: 'per mile with a minimum-mileage floor',
  zone: 'from a zone tariff',
};

/** Fallback for a code we don't have prose for: 'dry_van' -> 'dry van'. */
function humanize(code: string): string {
  return code.trim().replace(/[_-]+/g, ' ').toLowerCase();
}

/** "a", "a and b", "a, b and c" */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Deduped, trimmed, non-empty strings — onboarding payloads come from a
 *  browser POST, so treat them as untrusted. */
function cleanStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Every mode the carrier runs. Prefers the multi-select `freightVerticals`;
 *  falls back to the legacy single `freightVertical` for older rows. */
function modePhrases(ob: Onboarding): string[] {
  let codes = cleanStrings(ob.freightVerticals);
  if (!codes.length && typeof ob.freightVertical === 'string') {
    codes = cleanStrings([ob.freightVertical]);
  }
  return codes.map((c) => VERTICAL_PHRASES[c] ?? humanize(c));
}

/** One sentence describing where they run, or '' if the area is unusable. */
function serviceAreaSentence(area: ServiceArea | undefined): string {
  if (!area || typeof area.kind !== 'string') return '';
  switch (area.kind) {
    case 'nationwide_us':
      return 'They run nationwide across the United States.';
    case 'nationwide_ca':
      return 'They run nationwide across Canada.';
    case 'cross_border':
      return 'They run cross-border freight between the United States and Canada.';
    case 'regions': {
      const regions = cleanStrings(area.regions);
      // An empty region list tells us nothing — omit rather than emit
      // "They operate across: ." with a dangling colon.
      if (!regions.length) return '';
      const shown = regions.slice(0, MAX_LISTED_REGIONS);
      const hidden = regions.length - shown.length;
      const list = shown.join(', ') + (hidden > 0 ? `, and ${hidden} more` : '');
      return `They operate in specific states/provinces: ${list}.`;
    }
    case 'radius': {
      const miles =
        typeof area.radiusMiles === 'number' && Number.isFinite(area.radiusMiles) && area.radiusMiles > 0
          ? Math.round(area.radiusMiles)
          : null;
      const city = typeof area.baseCity === 'string' && area.baseCity.trim() ? area.baseCity.trim() : null;
      if (miles && city) return `They operate within ${miles} miles of ${city}.`;
      if (miles) return `They operate within a ${miles}-mile radius of their home base.`;
      if (city) return `They operate regionally around ${city}.`;
      return '';
    }
    default:
      return '';
  }
}

/**
 * Build the carrier context block. Returns '' when there is nothing useful to
 * say — callers should skip the whole prompt section in that case.
 *
 * Example (multi-mode, regions):
 *   "Harbor Link Logistics hauls dry van FTL, reefer (temperature-controlled)
 *    and flatbed/open-deck. They operate in specific states/provinces: CA, AZ,
 *    NV, ON. They price primarily per mile."
 */
export function buildCarrierContext(tenant: CarrierContextInput | null | undefined): string {
  const ob = tenant?.onboardingJson;
  if (!ob || typeof ob !== 'object') return '';

  const who = typeof tenant?.name === 'string' && tenant.name.trim() ? tenant.name.trim() : 'The carrier';
  const sentences: string[] = [];

  const modes = modePhrases(ob);
  if (modes.length) sentences.push(`${who} hauls ${joinList(modes)}.`);

  const area = serviceAreaSentence(ob.serviceArea);
  if (area) sentences.push(area);

  const pricing =
    typeof ob.pricingMode === 'string' && ob.pricingMode.trim()
      ? (PRICING_PHRASES[ob.pricingMode.trim()] ?? `primarily by ${humanize(ob.pricingMode)}`)
      : '';
  if (pricing) sentences.push(`They price ${pricing}.`);

  return sentences.join(' ');
}

/**
 * The context wrapped as a labelled prompt section, or '' when there is no
 * context. Prompt builders concatenate this so a pre-wizard tenant's prompt is
 * byte-for-byte what it was before.
 */
export function carrierContextSection(tenant: CarrierContextInput | null | undefined): string {
  const ctx = buildCarrierContext(tenant);
  if (!ctx) return '';
  return `\n\nCarrier operations profile (from their onboarding answers — treat as fact and keep your answers specific to this operation):\n${ctx}`;
}
