/**
 * AI email drafter — Phase 2 of the AI Outreach Engine.
 *
 * Turns a `CompanyProfile` (from enrichCompany) + the prospect's own branded
 * demo URL into a personalized, freight-literate, CASL/CAN-SPAM-compliant cold
 * email: `{ subject, bodyHtml, bodyText, unsubscribeToken }`.
 *
 * Design goals (from the research):
 *   - SUBJECT: short (≤ ~8 words), specific, research-signaling — names THEIR
 *     company + their primary mode/lane. Never salesy/generic.
 *   - BODY: ~2 short paragraphs, < ~10 sentences total. Opens with a SPECIFIC
 *     observation about their business (their modes/lanes), ties QuoteFleet to a
 *     real pain (slow/manual quoting loses loads; first-to-respond wins), links
 *     to THEIR OWN branded demo, and cites AT MOST 1-2 credible KPIs framed as
 *     "the same dynamic applies to freight quoting". One low-friction CTA.
 *   - Tone: peer-to-peer, confident, concise — not marketing fluff.
 *
 * Compliance (REQUIRED on every email): sender identity ("QuoteFleet"), the
 * physical mailing address, and a working one-click unsubscribe link built from
 * a per-recipient `unsubscribeToken`. Present in BOTH the HTML and plaintext.
 *
 * Graceful degrade: with no Anthropic key we return a solid, deterministic
 * TEMPLATE email (still personalized from the deterministic profile fields), so
 * this never hard-fails. The AI is an enhancement, never a dependency.
 *
 * Pure + injectable: `aiComplete` and `anthropicKey` are injected so tests run
 * without the network or the AI vendor.
 */
import { nanoid } from 'nanoid';
import { complete } from '../../ai/client.js';
import type { CompanyProfile } from './enrichCompany.js';

// ─── Compliance constants (CASL / CAN-SPAM) ──────────────────────────────
/** Sender identity shown in every footer. */
export const SENDER_NAME = 'QuoteFleet';
/** Physical mailing address — a hard CAN-SPAM / CASL requirement. */
export const SENDER_ADDRESS = '30 Angus Road, Hamilton, ON L8K 6L1, Canada';

/**
 * Curated, SAFE stat-stack the AI may cite (framed as "the same dynamic applies
 * to freight quoting"). These are general B2B lead-response findings, NOT
 * fabricated freight win-rates. The prompt forbids inventing freight-specific
 * percentages.
 */
export const SAFE_STATS: string[] = [
  'HBR / Lead Response Management: the odds of qualifying a lead drop ~400% when the first response slips from 5 minutes to 10 minutes.',
  'The "5-minute rule": contacting a lead within 5 minutes makes you ~21x more likely to qualify it than waiting 30.',
  'Average B2B first-response time is ~42 hours.',
  'Freightos: a manual freight quote can take ~90 hours to turn around.',
  'Rippey AI: only ~31% of freight quote requests ever get a response.',
];

// ─── Options + result ─────────────────────────────────────────────────────
export interface DraftEmailOpts {
  /** Injected Anthropic wrapper — defaults to the app client. */
  aiComplete?: typeof complete;
  /** Presence of this gates the AI step. Defaults to the env key. */
  anthropicKey?: string;
  /** Base URL for the unsubscribe link. Defaults to PUBLIC_BASE_URL at call site. */
  publicBaseUrl?: string;
  /** Reuse an existing per-recipient token (e.g. re-draft). New one if absent. */
  unsubscribeToken?: string;
  /** Who this is addressed to — used only for a light greeting when present. */
  recipientName?: string | null;
}

export interface DraftedEmail {
  subject: string;
  bodyHtml: string;
  bodyText: string;
  unsubscribeToken: string;
  /** True when the AI wrote the copy; false when the template fallback was used. */
  aiGenerated: boolean;
}

// ─── Small profile pickers ────────────────────────────────────────────────
const MODE_LABELS: Record<string, string> = {
  FTL: 'full-truckload',
  LTL: 'LTL',
  drayage: 'drayage',
  reefer: 'reefer',
  flatbed: 'flatbed',
  hotshot: 'hotshot',
  expedited: 'expedited',
  intermodal: 'intermodal',
  'cross-border': 'cross-border',
  transload: 'transload',
};

/** A human, freight-literate label for the prospect's primary mode. */
export function primaryModeLabel(profile: CompanyProfile): string {
  const ai = profile.ai?.suggestedCalculator?.mode?.trim();
  if (ai) return MODE_LABELS[ai] ?? ai.toLowerCase();
  const detected = profile.serviceModes?.[0];
  if (detected) return MODE_LABELS[detected] ?? String(detected).toLowerCase();
  return 'freight';
}

/** A specific lane/corridor to name, when the enrichment found one. */
export function primaryLane(profile: CompanyProfile): string | null {
  const lane = (profile.regionsLanes ?? []).find((l) => / to | corridor|coast/i.test(l));
  return lane ?? profile.regionsLanes?.[0] ?? null;
}

/** The company's display name, with a safe fallback to the domain. */
export function companyDisplayName(profile: CompanyProfile): string {
  return (profile.companyName || '').trim() || profile.domain;
}

/** Their sharpest pain point, from the AI, else a freight-generic default. */
function primaryPain(profile: CompanyProfile): string {
  const p = profile.ai?.painPoints?.find((x) => typeof x === 'string' && x.trim());
  return p?.trim() || 'quoting by hand means shippers wait — and the first carrier to reply usually wins the load';
}

// ─── Compliance footer builders ───────────────────────────────────────────
function unsubscribeUrl(base: string, token: string): string {
  return `${(base || '').replace(/\/$/, '')}/outreach/unsubscribe/${token}`;
}

function footerText(unsubUrl: string): string {
  return [
    '—',
    `${SENDER_NAME}`,
    `${SENDER_ADDRESS}`,
    `Unsubscribe: ${unsubUrl}`,
  ].join('\n');
}

function footerHtml(unsubUrl: string): string {
  return (
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;` +
    `font-size:12px;line-height:1.5;color:#6b7280;">` +
    `<div>${escapeHtml(SENDER_NAME)}</div>` +
    `<div>${escapeHtml(SENDER_ADDRESS)}</div>` +
    `<div style="margin-top:8px;">` +
    `<a href="${escapeAttr(unsubUrl)}" style="color:#6b7280;">Unsubscribe</a>` +
    ` from these emails.</div>` +
    `</div>`
  );
}

// ─── HTML helpers ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** Split a plaintext body into paragraphs on blank lines. */
function toParagraphs(bodyText: string): string[] {
  return bodyText
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Linkify a bare demo URL inside an escaped paragraph so the HTML email has a
 * real clickable link (plaintext keeps the raw URL). Only the exact demoUrl is
 * linked — no general URL parsing.
 */
function linkifyDemo(escapedParagraph: string, demoUrl: string): string {
  const escUrl = escapeHtml(demoUrl);
  if (!escUrl || !escapedParagraph.includes(escUrl)) return escapedParagraph;
  return escapedParagraph.replace(
    escUrl,
    `<a href="${escapeAttr(demoUrl)}" style="color:#0d3cfc;">${escUrl}</a>`,
  );
}

/** Assemble the final HTML document from paragraphs + the compliance footer. */
function assembleHtml(paragraphs: string[], demoUrl: string, unsubUrl: string): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px 0;">${linkifyDemo(escapeHtml(p), demoUrl)}</p>`)
    .join('\n');
  return (
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.6;color:#0b0f14;max-width:560px;">\n` +
    `${body}\n` +
    `${footerHtml(unsubUrl)}\n` +
    `</div>`
  );
}

/** Assemble the plaintext version from paragraphs + the compliance footer. */
function assembleText(paragraphs: string[], unsubUrl: string): string {
  return `${paragraphs.join('\n\n')}\n\n${footerText(unsubUrl)}`;
}

// ─── AI prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(): string {
  return [
    'You are a founder-led B2B sales writer for QuoteFleet, an embeddable instant-quote',
    'calculator + AI dispatcher for freight carriers (drayage & trucking) in the USA/Canada.',
    'You write ONE cold email to a freight company you have researched. It must feel like a',
    'peer wrote it — freight-literate, specific, confident, concise. NOT marketing fluff.',
    '',
    'HARD RULES:',
    '1. SUBJECT: <= 8 words, specific, research-signaling. Name their company AND their primary',
    '   mode or lane. e.g. "Instant quotes for {Company} drayage" or "A branded quote tool for',
    '   {Company}". Never generic ("Grow your business") or salesy ("Amazing offer!").',
    '2. BODY: exactly 2 short paragraphs, UNDER 10 sentences total. Paragraph 1 OPENS with a',
    '   SPECIFIC observation about THEIR business (their actual modes/lanes/niche from the facts) —',
    '   never "I see you\'re in logistics". Then tie it to a real pain: manual/slow quoting loses',
    '   loads; the first carrier to respond usually wins. Paragraph 2 introduces the demo you built',
    '   for them and includes the EXACT demo URL provided, phrased like "I built you a working',
    '   preview — {demoUrl}". End with ONE low-friction CTA (a quick reply, or a look at the demo).',
    '3. You may cite AT MOST 1-2 of the provided SAFE stats, framed as "the same dynamic applies to',
    '   freight quoting". Do NOT invent freight-specific win-rate percentages or any number not in',
    '   the provided stats.',
    '4. Use their real company name. Do not fabricate facts not present in the input.',
    '5. Do NOT add a signature, greeting salutation is optional and short, and do NOT add an',
    '   unsubscribe line or mailing address — those are appended automatically.',
    '',
    'Return ONLY minified JSON, no markdown fences, EXACTLY:',
    '{"subject": string, "bodyText": string}',
    'where bodyText is the plaintext body with the two paragraphs separated by a blank line.',
  ].join('\n');
}

function buildUserPayload(profile: CompanyProfile, demoUrl: string): string {
  const facts = {
    companyName: companyDisplayName(profile),
    domain: profile.domain,
    primaryMode: primaryModeLabel(profile),
    serviceModes: profile.serviceModes ?? [],
    lanes: profile.regionsLanes ?? [],
    tagline: profile.tagline,
    businessSummary: profile.ai?.businessSummary ?? null,
    painPoints: profile.ai?.painPoints ?? [],
    quoteFleetAngle: profile.ai?.quoteFleetAngle ?? null,
    demoUrl,
    safeStats: SAFE_STATS,
  };
  return `Company facts (JSON):\n${JSON.stringify(facts)}\n\nWrite the email now.`;
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

// ─── Template fallback (deterministic, no AI) ──────────────────────────────
/**
 * A solid, personalized email built purely from deterministic profile fields.
 * Used when the AI key is absent or the AI reply is unusable. Still names the
 * company + a mode, ties to a pain, links the demo, and cites one safe stat.
 */
export function buildTemplateEmail(profile: CompanyProfile, demoUrl: string): { subject: string; bodyText: string } {
  const company = companyDisplayName(profile);
  const modeLabel = primaryModeLabel(profile);
  const lane = primaryLane(profile);
  const pain = primaryPain(profile);
  const laneClause = lane ? ` and your ${lane} lanes` : '';

  const subject = `Instant quotes for ${company} ${modeLabel}`.replace(/\s+/g, ' ').trim();

  const para1 =
    `I came across ${company} and saw you run ${modeLabel} freight${laneClause}. ` +
    `In freight, ${pain}. The odds of winning a load drop sharply the longer a shipper waits — ` +
    `the same dynamic HBR found in B2B lead response, where reply speed swings qualification odds by ~400%.`;

  const para2 =
    `So I built you a working preview of an instant-quote tool in your own branding — ${demoUrl}. ` +
    `It quotes ${modeLabel} lanes in seconds and can capture the lead while a competitor is still ` +
    `typing up a PDF. Worth a quick look? Happy to tailor it to your rates if it is useful.`;

  return { subject, bodyText: `${para1}\n\n${para2}` };
}

// ─── Sentence-count guard (keeps the body from becoming a wall of text) ────
export function countSentences(text: string): number {
  const matches = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+/g);
  return matches ? matches.length : text.trim() ? 1 : 0;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────
/**
 * Draft a personalized, compliant outreach email for a prospect.
 *
 * @param profile  enrichment profile for the prospect (from enrichCompany).
 * @param demoUrl  the prospect's OWN branded demo URL (/demo/:token).
 */
export async function draftOutreachEmail(
  profile: CompanyProfile,
  demoUrl: string,
  opts: DraftEmailOpts = {},
): Promise<DraftedEmail> {
  const aiComplete = opts.aiComplete ?? complete;
  const anthropicKey = opts.anthropicKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const publicBaseUrl = opts.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';
  const unsubscribeToken = opts.unsubscribeToken || nanoid(24);
  const unsubUrl = unsubscribeUrl(publicBaseUrl, unsubscribeToken);

  let subject: string | null = null;
  let bodyText: string | null = null;
  let aiGenerated = false;

  if (anthropicKey) {
    try {
      const out = await aiComplete({
        tenantId: null,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPayload(profile, demoUrl) }],
        maxTokens: 700,
      });
      const parsed = extractJson(out.text);
      const s = typeof parsed?.subject === 'string' ? parsed.subject.trim() : '';
      const b = typeof parsed?.bodyText === 'string' ? parsed.bodyText.trim() : '';
      // Only accept the AI copy if it's usable AND actually contains the demo
      // URL (so the prospect always gets their own preview link).
      if (s && b && b.includes(demoUrl)) {
        subject = s;
        bodyText = b;
        aiGenerated = true;
      }
    } catch {
      // Never let an AI failure hard-fail the draft — fall through to template.
    }
  }

  if (!subject || !bodyText) {
    const tmpl = buildTemplateEmail(profile, demoUrl);
    subject = tmpl.subject;
    bodyText = tmpl.bodyText;
    aiGenerated = false;
  }

  const paragraphs = toParagraphs(bodyText);
  const bodyHtml = assembleHtml(paragraphs, demoUrl, unsubUrl);
  const finalText = assembleText(paragraphs, unsubUrl);

  return { subject, bodyHtml, bodyText: finalText, unsubscribeToken, aiGenerated };
}
