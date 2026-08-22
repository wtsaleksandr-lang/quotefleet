/**
 * AI RFQ email drafter — the personalized, per-carrier rate request.
 *
 * The multi-carrier RFQ used to fan out ONE static template to every filtered
 * carrier ("Hello <carrierName>, a shipper is requesting a rate…"). This drafter
 * replaces that with an INDIVIDUAL letter per carrier:
 *
 *   - Addressed specifically to them — "Dear <Company Name>," (never a generic
 *     "Dear sales team"). It must feel exclusive, like it went only to them.
 *   - Personalized from the carrier's own directory facts (their equipment/cargo
 *     mode, their city/state, drayage/intermodal + nearest port) AND the shipper's
 *     lane/shipment — so paragraph 1 references what THEY actually run.
 *   - Written to sound HUMAN, not AI: short, concrete, businesslike, peer-to-peer
 *     freight-operator tone. The system prompt BANS the AI-ish filler the owner
 *     called out ("I hope this email finds you well", "I'm excited to",
 *     "Furthermore", exclamation gush, etc.).
 *   - MODEL-B SAFE: this is the shipper REQUESTING a rate FROM the carrier — the
 *     carrier replies to the shipper, who contracts directly. The copy never sets
 *     a binding rate, guarantees payment, or offers a per-load fee.
 *
 * Modeled closely on outreach/draftEmail.ts: an injected `complete()` AI client,
 * a tight system prompt, accept-time validation, and a DETERMINISTIC TEMPLATE
 * FALLBACK (personalized from the same facts) whenever the AI key is absent or
 * the AI reply is unusable — the drafter never blocks the flow.
 *
 * The greeting ("Dear <Company>,") and a plain sign-off are assembled
 * DETERMINISTICALLY around the AI/template middle, so the owner's exact
 * addressing is guaranteed regardless of what the model returns.
 *
 * Pure + injectable: `aiComplete` and `anthropicKey` are injected so tests run
 * with no network and no AI vendor.
 */
import { complete } from '../../ai/client.js';
import { ALL_HUBS } from '../directory/containerPorts.js';
import type { RfqRequest } from '../../db/schema.js';

// ─── Carrier facts the drafter personalizes from ───────────────────────────
/** The directory-sourced facts about ONE carrier the drafter references. Every
 *  field is optional so a sparse row (or a hand-built fixture) still drafts. */
export interface RfqCarrierFacts {
  /** Display name (DBA or legal) — drives "Dear <Company>,". */
  name: string;
  city?: string | null;
  state?: string | null;
  /** Container / drayage / intermodal capability (crgo_intermodal). */
  intermodal?: boolean;
  hazmat?: boolean;
  dryVan?: boolean;
  reefer?: boolean;
  tanker?: boolean;
  flatbed?: boolean;
  dryBulk?: boolean;
  householdGoods?: boolean;
  beverages?: boolean;
  produce?: boolean;
  motorVehicles?: boolean;
  livestock?: boolean;
  grainFeed?: boolean;
  oilfield?: boolean;
  meat?: boolean;
  paper?: boolean;
  construction?: boolean;
  farmSupplies?: boolean;
  coalCoke?: boolean;
  buildingMaterials?: boolean;
  /** Nearest US/CA container port code (e.g. 'USLAX'). */
  nearestPortCode?: string | null;
}

export interface DraftRfqOpts {
  /** Injected AI client — defaults to the app client. */
  aiComplete?: typeof complete;
  /** Presence gates the AI step. Defaults to the env key. */
  anthropicKey?: string;
}

export interface DraftedRfqEmail {
  subject: string;
  /** The full plaintext letter: "Dear <Company>," + body + plain sign-off.
   *  This is what the shipper reviews/edits and what the send path renders. */
  body: string;
  /** True when the AI wrote the middle; false when the template fallback did. */
  aiGenerated: boolean;
}

// ─── Anti-AI-voice bans (the owner's hard "sound human, not AI" rule) ──────
/**
 * Phrases that read as AI/marketing filler. If the model's copy contains any of
 * these (case-insensitive substring) we REJECT it and fall back to the plain
 * template — so a chatty/gushy draft never reaches the shipper. The same list is
 * named in the system prompt so the model avoids them in the first place.
 */
export const AI_VOICE_BANS: readonly string[] = [
  'i hope this email finds you well',
  'i hope this finds you well',
  'hope this email finds you',
  'hope you are doing well',
  "i'm excited to",
  'i am excited to',
  'we are excited to',
  "we're excited to",
  'delighted',
  'thrilled',
  'furthermore',
  'moreover',
  'in addition,',
  'at your earliest convenience',
  'look no further',
  'rest assured',
  'game-changer',
  'game changer',
  'cutting-edge',
  'cutting edge',
  'seamless',
  'seamlessly',
  'leverage',
  'synergy',
  'unlock',
  'elevate',
  'in today’s fast-paced',
  "in today's fast-paced",
  'we would be delighted',
  'it is my pleasure',
  'reaching out to you',
];

/**
 * MODEL-B legal bans: the shipper is REQUESTING a rate, not offering one. Copy
 * that promises payment / a fixed rate / a per-load fee would make QuoteFleet the
 * counterparty. Any of these (case-insensitive) rejects the AI copy → template.
 */
export const MODEL_B_BANS: readonly string[] = [
  "we'll pay",
  'we will pay',
  'we guarantee',
  'guaranteed payment',
  'guaranteed rate',
  'we pay you',
  'per-load fee',
  'per load fee',
  'flat fee per load',
  'we are offering you',
];

/** True when `text` trips any anti-AI-voice OR model-B ban (case-insensitive),
 *  or contains an exclamation mark (freight peer tone has no exclamation gush). */
export function violatesRfqVoice(text: string): boolean {
  const hay = String(text ?? '').toLowerCase();
  if (hay.includes('!')) return true;
  if (AI_VOICE_BANS.some((p) => hay.includes(p))) return true;
  if (MODEL_B_BANS.some((p) => hay.includes(p))) return true;
  return false;
}

/** Word count of a string (whitespace-split, ignoring empties). */
export function wordCount(text: string): number {
  const t = String(text ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Hard ceiling on the whole letter — the owner wants it SHORT. */
export const RFQ_MAX_WORDS = 120;

// ─── Fact → human phrase helpers ───────────────────────────────────────────
const EQUIP_LABEL: Array<[keyof RfqCarrierFacts, string]> = [
  ['reefer', 'reefer'],
  ['flatbed', 'flatbed'],
  ['dryVan', 'dry van'],
  ['tanker', 'tanker'],
  ['dryBulk', 'dry bulk'],
];

const CARGO_LABEL: Array<[keyof RfqCarrierFacts, string]> = [
  ['produce', 'produce'],
  ['beverages', 'beverages'],
  ['meat', 'refrigerated meat'],
  ['householdGoods', 'household goods'],
  ['motorVehicles', 'motor vehicles'],
  ['livestock', 'livestock'],
  ['grainFeed', 'grain and feed'],
  ['oilfield', 'oilfield'],
  ['paper', 'paper'],
  ['construction', 'construction'],
  ['farmSupplies', 'farm supplies'],
  ['coalCoke', 'coal and coke'],
  ['buildingMaterials', 'building materials'],
];

/** Port display name for a code (e.g. 'USLAX' → 'Port of Los Angeles'). */
export function portName(code: string | null | undefined): string | null {
  if (!code) return null;
  const hub = ALL_HUBS.find((h) => h.code === code);
  return hub ? hub.name : null;
}

/**
 * The single sharpest capability phrase to reference for this carrier — a real
 * peg for paragraph 1. Prefers drayage/intermodal (with the port when known),
 * then a specific equipment type, then a cargo specialty. Null when the row has
 * no useful flags (a sparse/unbackfilled carrier), so the copy stays generic
 * rather than inventing a capability.
 */
export function carrierCapabilityPhrase(facts: RfqCarrierFacts): string | null {
  if (facts.intermodal) {
    const port = portName(facts.nearestPortCode);
    return port ? `container drayage out of ${port}` : 'container drayage and intermodal';
  }
  for (const [key, label] of EQUIP_LABEL) {
    if (facts[key]) return `${label} freight`;
  }
  if (facts.hazmat) return 'hazmat freight';
  for (const [key, label] of CARGO_LABEL) {
    if (facts[key]) return `${label} hauls`;
  }
  return null;
}

/** "City, ST" when both are present, else whichever exists, else null. */
export function carrierLocation(facts: RfqCarrierFacts): string | null {
  const city = (facts.city ?? '').trim();
  const state = (facts.state ?? '').trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

/** A concise one-line lane summary. */
export function laneOf(request: Pick<RfqRequest, 'origin' | 'destination'>): string {
  return `${request.origin} → ${request.destination}`;
}

// ─── The shipment facts the drafter feeds the model / template ──────────────
function shipmentFacts(request: RfqRequest): Record<string, string> {
  const out: Record<string, string> = {
    origin: request.origin,
    destination: request.destination,
  };
  if (request.equipment) out.equipment = request.equipment;
  if (request.containerType) out.containerType = request.containerType;
  if (request.commodity) out.commodity = request.commodity;
  if (request.weight) out.weight = request.weight;
  if (request.readyDate) out.readyDate = request.readyDate;
  return out;
}

/** The shipper's display identity used in the sign-off. */
export function shipperIdentity(request: RfqRequest): string {
  return request.shipperCompany
    ? `${request.shipperName}, ${request.shipperCompany}`
    : request.shipperName;
}

// ─── AI prompt ─────────────────────────────────────────────────────────────
export function buildRfqSystemPrompt(): string {
  return [
    'You write ONE short rate-request email from a freight SHIPPER to a specific trucking',
    'company (carrier) the shipper found in a directory. The shipper is asking the carrier',
    'for a price on a specific shipment. It must read like a real freight operator wrote it',
    'to a peer — plain, direct, businesslike, and specific. NOT a marketing email.',
    '',
    'HARD RULES:',
    '1. SUBJECT: <= 8 words, concrete. Name the lane or the equipment. e.g.',
    '   "Rate request: Los Angeles to Dallas, reefer". Never generic or salesy.',
    '2. BODY: write ONLY the middle — do NOT write the "Dear <Company>," greeting and do NOT',
    '   write a sign-off/signature; both are added automatically. 2 short paragraphs, UNDER',
    '   70 words total. Paragraph 1: reference something SPECIFIC and TRUE about this carrier',
    '   from the facts (their equipment/mode, their city/state, their drayage/port) and state',
    '   the lane + shipment. Paragraph 2: ask them plainly for their all-in rate and when they',
    '   could cover it. One clear ask. Do not fabricate any capability not in the facts.',
    '3. SOUND HUMAN, NOT AI. BANNED — never use any of these or anything like them:',
    '   "I hope this email finds you well", "I hope this finds you well", "I\'m excited to",',
    '   "delighted", "thrilled", "Furthermore", "Moreover", "at your earliest convenience",',
    '   "seamless", "leverage", "unlock", "elevate", "cutting-edge", "game-changer",',
    '   "look no further", "rest assured". No exclamation marks. No em-dash gush. No flattery.',
    '   No "I came across your company and was impressed". Just the facts and the ask.',
    '4. MODEL-B / LEGAL: the shipper is REQUESTING the carrier\'s rate — the carrier replies and',
    '   contracts directly with the shipper. NEVER promise payment, guarantee a rate, set a',
    '   binding price, or offer a per-load fee. Phrase it as "requesting your rate", never',
    '   "we\'ll pay you $X".',
    '5. Use the carrier\'s real company name naturally if you name them, but remember the',
    '   greeting is added for you. Do not invent facts not present in the input.',
    '',
    'Return ONLY minified JSON, no markdown fences, EXACTLY:',
    '{"subject": string, "bodyText": string}',
    'where bodyText is the two-paragraph middle (no greeting, no sign-off), paragraphs',
    'separated by a blank line.',
  ].join('\n');
}

function buildRfqUserPayload(request: RfqRequest, facts: RfqCarrierFacts): string {
  const carrier = {
    companyName: facts.name,
    location: carrierLocation(facts),
    capability: carrierCapabilityPhrase(facts),
    drayageOrIntermodal: !!facts.intermodal,
    nearestPort: portName(facts.nearestPortCode),
  };
  const payload = {
    carrier,
    shipment: shipmentFacts(request),
    lane: laneOf(request),
  };
  return `Facts (JSON):\n${JSON.stringify(payload)}\n\nWrite the rate-request email now.`;
}

/** Pull the first JSON object out of a model reply (tolerates fences/prose). */
function extractJson(text: string): { subject?: unknown; bodyText?: unknown } | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── Deterministic template fallback (no AI) ────────────────────────────────
/**
 * A solid, personalized middle built purely from the facts — used when the AI
 * key is absent or the AI reply is unusable. Names a real capability + the lane
 * and asks plainly for the rate. Kept UNDER the anti-AI-voice bans by
 * construction (no banned phrases, no exclamation).
 */
export function buildRfqTemplateMiddle(request: RfqRequest, facts: RfqCarrierFacts): { subject: string; bodyText: string } {
  const lane = `${request.origin} to ${request.destination}`;
  const cap = carrierCapabilityPhrase(facts);
  const loc = carrierLocation(facts);
  const equip = (request.equipment ?? '').trim();

  const subject = `Rate request: ${lane}${equip ? `, ${equip}` : ''}`.replace(/\s+/g, ' ').trim();

  // Paragraph 1 — a specific, true peg + the shipment.
  const pegParts: string[] = [];
  if (cap) pegParts.push(`your ${cap}`);
  if (loc) pegParts.push(`your base in ${loc}`);
  const peg = pegParts.length
    ? `Saw ${pegParts.join(' and ')} in the carrier directory. `
    : `Found you in the carrier directory. `;

  const shipBits: string[] = [];
  if (equip) shipBits.push(equip.toLowerCase());
  if (request.commodity) shipBits.push(String(request.commodity).toLowerCase());
  if (request.weight) shipBits.push(String(request.weight));
  const shipTail = shipBits.length ? ` It is ${shipBits.join(', ')}` : '';
  const readyTail = request.readyDate ? `, ready ${request.readyDate}` : '';

  const para1 = `${peg}I have a load running ${lane} and wanted to see if it is a lane you cover.${shipTail}${readyTail}.`;

  // Paragraph 2 — the plain ask (request, never an offer).
  const para2 = `If you can run it, send your all-in rate and the soonest you could cover it. I am collecting rates and will follow up directly if yours works.`;

  return { subject, bodyText: `${para1}\n\n${para2}` };
}

/** Assemble the full letter: forced greeting + middle + plain sign-off. This
 *  guarantees the "Dear <Company>," addressing the owner requires, regardless of
 *  whether the AI or the template produced the middle. */
export function assembleRfqLetter(
  request: RfqRequest,
  facts: RfqCarrierFacts,
  middle: string,
): string {
  const company = (facts.name || '').trim() || 'there';
  const greeting = `Dear ${company},`;
  const signOff = shipperIdentity(request);
  return `${greeting}\n\n${middle.trim()}\n\n${signOff}`;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────
/**
 * Draft ONE carrier's personalized rate-request email.
 *
 * @param request  the shipper's RFQ (lane + shipment fields).
 * @param facts    the carrier's directory facts (equipment/cargo/mode/location/port).
 */
export async function draftRfqEmail(
  request: RfqRequest,
  facts: RfqCarrierFacts,
  opts: DraftRfqOpts = {},
): Promise<DraftedRfqEmail> {
  const aiComplete = opts.aiComplete ?? complete;
  const anthropicKey = opts.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? '';

  let subject: string | null = null;
  let middle: string | null = null;
  let aiGenerated = false;

  if (anthropicKey) {
    try {
      const out = await aiComplete({
        tenantId: null,
        system: buildRfqSystemPrompt(),
        messages: [{ role: 'user', content: buildRfqUserPayload(request, facts) }],
        maxTokens: 400,
      });
      const parsed = extractJson(out.text);
      const s = typeof parsed?.subject === 'string' ? parsed.subject.trim() : '';
      const b = typeof parsed?.bodyText === 'string' ? parsed.bodyText.trim() : '';
      // Accept the AI copy ONLY if it's usable AND passes the human-voice /
      // model-B guards AND the assembled letter stays under the word ceiling.
      // Otherwise fall through to the deterministic template.
      if (s && b && !violatesRfqVoice(`${s}\n${b}`)) {
        const candidate = assembleRfqLetter(request, facts, b);
        if (wordCount(candidate) <= RFQ_MAX_WORDS) {
          subject = s;
          middle = b;
          aiGenerated = true;
        }
      }
    } catch {
      // Never let an AI failure block the draft — fall through to the template.
    }
  }

  if (!subject || !middle) {
    const tmpl = buildRfqTemplateMiddle(request, facts);
    subject = tmpl.subject;
    middle = tmpl.bodyText;
    aiGenerated = false;
  }

  const body = assembleRfqLetter(request, facts, middle);
  return { subject, body, aiGenerated };
}
