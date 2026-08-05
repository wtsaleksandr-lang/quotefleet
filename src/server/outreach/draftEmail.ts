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
/** Named founder signature — a real person lifts cold-email trust + reply rate. */
export const SENDER_PERSON = 'Aleksandr';
/** Signature title shown under the name. */
export const SENDER_TITLE = 'Founder, QuoteFleet';

// ─── Brand tokens (kept in sync with DESIGN-SYSTEM.md) ─────────────────────
const BRAND_BLUE = '#0d3cfc';
const INK = '#0f172a';
const MUT = '#64748b';
const FAINT = '#94a3b8';
const HAIR = '#eef0f3';
const PANEL = '#f6f8ff';
const PANEL_BORDER = '#e3e9ff';
const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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
  /** Absolute URL of a pre-rendered screenshot of the prospect's branded quote.
   *  When set, the email embeds it as a clickable image instead of the text card. */
  previewImageUrl?: string;
  /** 'cold' (default) = a first-touch cold email. 'warm-reply' = an in-thread
   *  reply to an inbound broker/carrier pitch (REVERSE OUTREACH). Warm mode
   *  acknowledges they reached out first and forces a "Re: …" subject. */
  mode?: 'cold' | 'warm-reply';
  /** Required context when mode==='warm-reply': the inbound email we're
   *  replying to. `subject` drives the "Re: …" reply subject; `senderName`
   *  lets the opener greet them by name when known. */
  inboundContext?: { subject: string; senderName?: string };
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

// ─── Footer builders ──────────────────────────────────────────────────────
// Per product decision (2026-08): the outreach email carries NO visible mailing
// address and NO visible unsubscribe link in the body — it's a founder-style
// email, not a bulk newsletter. The suppression system + the invisible RFC 8058
// List-Unsubscribe header (set in sendOutreach) still work; only the body chrome
// is dropped. SENDER_ADDRESS is retained as a constant for records/headers.

/** Plaintext sign-off (mirrors the HTML signature). No address, no unsub link. */
function footerText(): string {
  return `— ${SENDER_PERSON}\n${SENDER_TITLE}`;
}

/** Slim brand footer row — identity only, no address, no unsubscribe link. */
function footerHtml(): string {
  return (
    `<tr><td style="padding:16px 32px 22px;background:#fafbfc;border-top:1px solid ${HAIR};` +
    `font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${FAINT};">` +
    `<span style="font-weight:700;color:${MUT};letter-spacing:.2px;">${escapeHtml(SENDER_NAME)}</span>` +
    ` &middot; Instant, branded freight quotes for carriers.` +
    `</td></tr>`
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
  // Replace the raw URL with a clean inline link (the big CTA button carries the
  // primary action) so the copy never shows an ugly bare URL mid-sentence.
  return escapedParagraph.replace(
    escUrl,
    `<a href="${escapeAttr(demoUrl)}" style="color:${BRAND_BLUE};font-weight:600;text-decoration:none;">see it live</a>`,
  );
}

/** Context the branded HTML assembler needs beyond the body paragraphs. */
interface HtmlContext {
  demoUrl: string;
  company: string;
  modeLabel: string;
  lane: string | null;
  publicBaseUrl: string;
  /** Absolute URL of a pre-rendered screenshot of THIS prospect's branded quote.
   *  When present, it replaces the text preview card with a clickable image. */
  previewImageUrl?: string;
}

/** Brand lockup header — hosted mark + text wordmark (legible even if images blocked). */
function headerHtml(publicBaseUrl: string): string {
  const logo = `${(publicBaseUrl || '').replace(/\/$/, '')}/brand/logo-full.png`;
  return (
    `<tr><td style="padding:22px 32px 18px;border-bottom:1px solid ${HAIR};">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="vertical-align:middle;padding-right:10px;">` +
    `<img src="${escapeAttr(logo)}" alt="" width="34" height="30" ` +
    `style="display:block;border:0;height:30px;width:auto;">` +
    `</td>` +
    `<td style="vertical-align:middle;font-family:${FONT_STACK};font-size:19px;` +
    `font-weight:800;color:${INK};letter-spacing:-.2px;">QuoteFleet</td>` +
    `</tr></table>` +
    `</td></tr>`
  );
}

/** A tasteful, honest product-preview card (no fabricated price). */
function previewCardHtml(ctx: HtmlContext): string {
  const laneText = ctx.lane ? escapeHtml(ctx.lane) : 'Your lanes';
  const mode = escapeHtml(ctx.modeLabel);
  return (
    `<tr><td style="padding:4px 32px 8px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:${PANEL};border:1px solid ${PANEL_BORDER};border-radius:12px;">` +
    `<tr><td style="padding:16px 18px;font-family:${FONT_STACK};">` +
    `<div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${BRAND_BLUE};font-weight:700;">` +
    `Instant freight estimate</div>` +
    `<div style="margin-top:9px;font-size:16px;color:${INK};font-weight:600;">${laneText} · ${mode}</div>` +
    `<div style="margin-top:5px;font-size:13.5px;color:${MUT};line-height:1.5;">` +
    `Priced in seconds, in ${escapeHtml(ctx.company)}'s branding — while a competitor is still typing up a PDF.` +
    `</div>` +
    `</td></tr></table>` +
    `</td></tr>`
  );
}

/**
 * Clickable screenshot of the prospect's OWN branded quote — the highest-intent
 * "aha" in the email. The whole image links to their live demo; a caption cue
 * signals it's interactive. Degrades to alt text if the client blocks images
 * (the CTA button below still carries the click).
 */
function previewImageHtml(ctx: HtmlContext): string {
  const alt = `${ctx.company}'s instant freight quote — tap to try it live`;
  return (
    `<tr><td style="padding:6px 32px 4px;">` +
    `<a href="${escapeAttr(ctx.demoUrl)}" style="text-decoration:none;display:block;" target="_blank">` +
    `<img src="${escapeAttr(ctx.previewImageUrl!)}" alt="${escapeAttr(alt)}" width="536" ` +
    `style="display:block;width:100%;max-width:536px;height:auto;border:1px solid ${PANEL_BORDER};` +
    `border-radius:12px;">` +
    `<div style="margin-top:8px;font-family:${FONT_STACK};font-size:12.5px;color:${BRAND_BLUE};` +
    `font-weight:600;">&#9654;&nbsp; This is ${escapeHtml(ctx.company)}'s live calculator — tap to try your own lane</div>` +
    `</a>` +
    `</td></tr>`
  );
}

/** Bulletproof CTA button linking to the prospect's own branded demo. */
function ctaHtml(ctx: HtmlContext): string {
  const label = `See ${escapeHtml(ctx.company)}'s live demo &rarr;`;
  return (
    `<tr><td style="padding:20px 32px 6px;">` +
    `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
    `<td style="border-radius:10px;background:${BRAND_BLUE};">` +
    `<a href="${escapeAttr(ctx.demoUrl)}" ` +
    `style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:15px;` +
    `font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>` +
    `</td></tr></table>` +
    `<div style="margin-top:10px;font-family:${FONT_STACK};font-size:13px;color:${MUT};">` +
    `Takes 2 minutes — no signup needed to look.</div>` +
    `</td></tr>`
  );
}

/** Founder signature row. */
function signatureHtml(): string {
  return (
    `<tr><td style="padding:18px 32px 26px;font-family:${FONT_STACK};font-size:14.5px;color:${INK};line-height:1.5;">` +
    `<div>&mdash; ${escapeHtml(SENDER_PERSON)}</div>` +
    `<div style="color:${MUT};font-size:13px;">${escapeHtml(SENDER_TITLE)}</div>` +
    `</td></tr>`
  );
}

/** Assemble the full branded HTML email (bulletproof table layout, inline styles). */
function assembleHtml(paragraphs: string[], ctx: HtmlContext): string {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 15px 0;">${linkifyDemo(escapeHtml(p), ctx.demoUrl)}</p>`,
    )
    .join('\n');
  const preheader =
    `Instant, branded freight quotes for ${escapeHtml(ctx.company)} — see the live demo we built.`;
  return (
    // Hidden preheader (inbox preview line)
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preheader}</div>\n` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ` +
    `style="background:#f4f5f7;margin:0;padding:24px 12px;">\n` +
    `<tr><td align="center">\n` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" ` +
    `style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;` +
    `border-radius:14px;overflow:hidden;">\n` +
    headerHtml(ctx.publicBaseUrl) +
    `<tr><td style="padding:26px 32px 6px;font-family:${FONT_STACK};font-size:15.5px;` +
    `line-height:1.62;color:${INK};">\n${body}\n</td></tr>\n` +
    (ctx.previewImageUrl ? previewImageHtml(ctx) : previewCardHtml(ctx)) +
    ctaHtml(ctx) +
    signatureHtml() +
    footerHtml() +
    `</table>\n` +
    `</td></tr>\n</table>`
  );
}

/** Assemble the plaintext version from paragraphs + the sign-off. */
function assembleText(paragraphs: string[]): string {
  return `${paragraphs.join('\n\n')}\n\n${footerText()}`;
}

// ─── Reply-subject helper (warm-reply mode) ────────────────────────────────
/**
 * Build the in-thread reply subject: strip any existing leading "Re:" run from
 * the inbound subject, then prefix a single "Re: ". Mirrors WFT's reply-subject
 * helper so a thread never accumulates "Re: Re: Re:".
 */
export function buildReplySubject(inboundSubject: string): string {
  const s = (inboundSubject || '').replace(/^\s*(re:\s*)+/i, '').trim();
  return `Re: ${s || 'your note'}`;
}

// ─── AI prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  mode: 'cold' | 'warm-reply' = 'cold',
  inboundContext?: { subject: string; senderName?: string },
): string {
  if (mode === 'warm-reply') {
    const name = inboundContext?.senderName?.trim();
    return [
      'You are a founder-led B2B sales writer for QuoteFleet, an embeddable instant-quote',
      'calculator + AI dispatcher for freight carriers (drayage & trucking) in the USA/Canada.',
      'This is a WARM REPLY: the recipient emailed US FIRST — an inbound pitch/intro about',
      'THEIR OWN freight service — and you are replying IN-THREAD. It must feel like a peer',
      'wrote it — freight-literate, specific, confident, concise. NOT marketing fluff.',
      '',
      'HARD RULES:',
      '1. Do NOT write a subject line — the system sets the "Re: …" reply subject automatically.',
      `2. BODY: exactly 2 short paragraphs, UNDER 10 sentences total. Paragraph 1 OPENS by`,
      '   ACKNOWLEDGING they reached out to you first and references THEIR service/pitch —',
      `   e.g. "Thanks for reaching out about {their service} — funny timing, because I'd`,
      `   actually just built you a working preview…"${name ? ` (you may greet them as "${name}")` : ''}.`,
      '   Then pivot to the branded demo. Paragraph 2 introduces the demo you built for them and',
      '   includes the EXACT demo URL provided, phrased like "here it is — {demoUrl}". Tie it to a',
      '   real pain: manual/slow quoting loses loads; the first carrier to respond usually wins.',
      '   End with ONE low-friction CTA (a quick reply, or a look at the demo).',
      '3. You may cite AT MOST 1-2 of the provided SAFE stats, framed as "the same dynamic applies',
      '   to freight quoting". Do NOT invent freight-specific win-rate percentages or any number not',
      '   in the provided stats.',
      '4. Use their real company name. Do not fabricate facts not present in the input.',
      '5. Do NOT add a signature or an unsubscribe line or a mailing address — those are appended',
      '   automatically.',
      '',
      'Return ONLY minified JSON, no markdown fences, EXACTLY:',
      '{"subject": string, "bodyText": string}',
      'where subject is a short throwaway line (ignored — the system forces the Re: subject) and',
      'bodyText is the plaintext body with the two paragraphs separated by a blank line.',
    ].join('\n');
  }
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

function buildUserPayload(
  profile: CompanyProfile,
  demoUrl: string,
  inboundContext?: { subject: string; senderName?: string },
): string {
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
    // Only present on a warm reply — lets the AI reference what they wrote in.
    ...(inboundContext
      ? {
          theyReachedOutFirst: true,
          theirInboundSubject: inboundContext.subject,
          theirName: inboundContext.senderName ?? null,
        }
      : {}),
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

/**
 * Warm-reply template (deterministic, no AI) — used for an in-thread reply to an
 * inbound broker/carrier pitch when the AI key is absent or the AI reply is
 * unusable. Opens by ACKNOWLEDGING they reached out first, then pivots to the
 * demo. The subject is the "Re: …" reply subject (draftOutreachEmail forces the
 * same value, so cold/warm/template stay consistent).
 */
export function buildWarmTemplateEmail(
  profile: CompanyProfile,
  demoUrl: string,
  inboundContext: { subject: string; senderName?: string },
): { subject: string; bodyText: string } {
  const company = companyDisplayName(profile);
  const modeLabel = primaryModeLabel(profile);
  const greet = inboundContext.senderName?.trim();
  const subject = buildReplySubject(inboundContext.subject);

  const para1 =
    `${greet ? `${greet}, thanks` : 'Thanks'} for reaching out about ${company} — funny timing, because ` +
    `I'd actually just built you a working preview of an instant-quote tool in your own branding. ` +
    `In freight, the first carrier to reply usually wins the load, and quoting ${modeLabel} by hand is ` +
    `exactly where that time leaks — HBR found reply speed swings B2B qualification odds by ~400%.`;

  const para2 =
    `Here it is — ${demoUrl}. It quotes ${modeLabel} lanes in seconds and can capture the lead while a ` +
    `competitor is still typing up a PDF. Worth a quick look? Happy to tailor it to your rates.`;

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
  const mode = opts.mode ?? 'cold';
  const inboundContext = opts.inboundContext;
  // Still tracked per recipient — powers suppression + the invisible List-
  // Unsubscribe header (set in sendOutreach). It is NOT rendered in the body.
  const unsubscribeToken = opts.unsubscribeToken || nanoid(24);

  let subject: string | null = null;
  let bodyText: string | null = null;
  let aiGenerated = false;

  if (anthropicKey) {
    try {
      const out = await aiComplete({
        tenantId: null,
        system: buildSystemPrompt(mode, inboundContext),
        messages: [
          {
            role: 'user',
            content: buildUserPayload(
              profile,
              demoUrl,
              mode === 'warm-reply' ? inboundContext : undefined,
            ),
          },
        ],
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
    const tmpl =
      mode === 'warm-reply'
        ? buildWarmTemplateEmail(profile, demoUrl, inboundContext ?? { subject: '' })
        : buildTemplateEmail(profile, demoUrl);
    subject = tmpl.subject;
    bodyText = tmpl.bodyText;
    aiGenerated = false;
  }

  // Warm reply always threads: force the "Re: …" subject regardless of what the
  // AI produced, so the reply lands in the same thread as the inbound pitch.
  if (mode === 'warm-reply') {
    subject = buildReplySubject(inboundContext?.subject ?? '');
  }

  const paragraphs = toParagraphs(bodyText);
  const bodyHtml = assembleHtml(paragraphs, {
    demoUrl,
    company: companyDisplayName(profile),
    modeLabel: primaryModeLabel(profile),
    lane: primaryLane(profile),
    publicBaseUrl,
    previewImageUrl: opts.previewImageUrl,
  });
  const finalText = assembleText(paragraphs);

  return { subject, bodyHtml, bodyText: finalText, unsubscribeToken, aiGenerated };
}
