/**
 * Harvest handler — REVERSE OUTREACH, Phase 2a.
 *
 * The GLUE that turns ONE parsed inbound broker/carrier email into a reviewed
 * warm-reply DRAFT. It ties the already-shipped pieces together end-to-end:
 *
 *   classify → (freemail gate) → reuse-or-provision branded demo → warm draft →
 *   persist the draft + an `inbound_prospects` row (with threading fields).
 *
 * It is transport- and source-AGNOSTIC by design: it does NOT poll IMAP and does
 * NOT send. A later phase feeds it parsed emails and, separately, sends the
 * reviewed drafts. Everything external (classify / enrich / the three stores /
 * the drafter / the URL builders) is injectable via `deps`, so the unit tests
 * run with zero network and zero DB.
 *
 * Idempotent: a repeat of the same Message-ID short-circuits to `duplicate`
 * (never re-drafts, never re-provisions). FAIL-SOFT: a single bad email never
 * throws — the body is wrapped in try/catch, the row is parked with status
 * 'skipped' + an error note, and a non-drafted result is returned.
 */
import {
  classifyInbound,
  type ClassifyInboundInput,
  type InboundVerdict,
} from './classifyInbound.js';
import { extractSignature } from './parseInbound.js';
import {
  dbInboundProspectStore,
  type InboundProspectStore,
} from './inboundProspectStore.js';
import {
  enrichCompany,
  normalizeDomain,
  type CompanyProfile,
} from '../enrichCompany.js';
import { deriveDemoConfig, deriveDemoBrand } from '../prospectDemo.js';
import {
  dbProspectDemoStore,
  type ProspectDemoStore,
} from '../prospectDemoStore.js';
import {
  dbOutreachEmailStore,
  type OutreachEmailStore,
} from '../outreachEmailStore.js';
import {
  draftOutreachEmail,
  type DraftedEmail,
  type DraftEmailOpts,
} from '../draftEmail.js';
import { demoUrlForToken, quoteShotUrlForToken } from '../../routes/outreach.js';
import { loadEnv } from '../../../config.js';

/** One parsed inbound email handed to the handler (transport-agnostic). */
export interface HandleHarvestedEmailInput {
  /** Which harvest mailbox this landed in (audit + reply-from later). */
  harvestMailbox: string;
  /** Bare sender address, e.g. "sam@acme-freight.com". */
  fromEmail: string;
  subject: string;
  /** New message text with the quoted reply chain already stripped. */
  bodyText: string;
  bodyHtml?: string;
  /** RFC 5322 Message-ID — the dedupe key + reply-threading anchor. */
  messageId?: string;
  /** Prior thread Message-IDs (for the reply's References header later). */
  references?: string[];
  receivedAt?: Date;
}

export type HandleHarvestedStatus =
  | 'drafted'
  | 'skipped_noise'
  | 'skipped_freemail'
  | 'duplicate';

export interface HandleHarvestedEmailResult {
  status: HandleHarvestedStatus;
  inboundProspectId?: number;
  demoToken?: string;
  outreachEmailId?: number;
}

/** Injectable dependencies — defaults are the real impls, so a caller passes
 *  nothing in production and tests pass fakes for a fully offline run. */
export interface HandleHarvestedEmailDeps {
  classify?: (input: ClassifyInboundInput) => Promise<InboundVerdict>;
  enrich?: (domain: string) => Promise<CompanyProfile>;
  demoStore?: ProspectDemoStore;
  emailStore?: OutreachEmailStore;
  inboundStore?: InboundProspectStore;
  draft?: (profile: CompanyProfile, demoUrl: string, opts: DraftEmailOpts) => Promise<DraftedEmail>;
  /** Build the public /demo/:token URL (defaults to the route helper). */
  demoUrlForToken?: (token: string) => string;
  /** Build the branded quote-screenshot URL (defaults to the route helper). */
  quoteShotUrlForToken?: (token: string) => string;
  /** Base URL for links inside the drafted HTML. Defaults to env at draft time. */
  publicBaseUrl?: string;
}

/**
 * Consumer freemail providers. A freight BROKER/CARRIER worth a branded demo
 * mails from its OWN company domain — a gmail/outlook/etc. sender is a person we
 * can't enrich or brand, so it goes to a manual queue instead of an auto-draft.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com',
  'aol.com', 'aim.com',
  'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
  'comcast.net', 'verizon.net', 'sbcglobal.net', 'att.net', 'cox.net',
  'bellsouth.net', 'charter.net', 'earthlink.net',
]);

/** Our own domains — never draft a warm reply to ourselves. */
export const OWN_DOMAINS: ReadonlySet<string> = new Set([
  'quotefleet.net',
  'quotefleet.com',
]);

/** Domain portion of a bare email address, normalized (lowercase, no www). */
function domainOf(email: string): string {
  const at = (email || '').lastIndexOf('@');
  if (at === -1) return '';
  return normalizeDomain(email.slice(at + 1));
}

/**
 * Handle one harvested inbound email — the Phase 2a pipeline.
 *
 * @returns the terminal status plus the ids/token of anything it persisted.
 */
export async function handleHarvestedEmail(
  input: HandleHarvestedEmailInput,
  deps: HandleHarvestedEmailDeps = {},
): Promise<HandleHarvestedEmailResult> {
  const classify = deps.classify ?? ((i: ClassifyInboundInput) => classifyInbound(i));
  const enrich = deps.enrich ?? ((domain: string) => enrichCompany(domain));
  const demoStore = deps.demoStore ?? dbProspectDemoStore;
  const emailStore = deps.emailStore ?? dbOutreachEmailStore;
  const inboundStore = deps.inboundStore ?? dbInboundProspectStore;
  const draft =
    deps.draft ?? ((profile, demoUrl, opts) => draftOutreachEmail(profile, demoUrl, opts));
  const buildDemoUrl = deps.demoUrlForToken ?? demoUrlForToken;
  const buildShotUrl = deps.quoteShotUrlForToken ?? quoteShotUrlForToken;

  const { harvestMailbox, fromEmail, subject, bodyText } = input;
  const messageId = input.messageId ?? undefined;
  const references = input.references ?? [];
  const receivedAt = input.receivedAt ?? null;
  const domain = domainOf(fromEmail);

  try {
    // 1 ── Idempotency: a Message-ID we've already harvested short-circuits.
    if (messageId) {
      const existing = await inboundStore.getByMessageId(messageId);
      if (existing) {
        return {
          status: 'duplicate',
          inboundProspectId: existing.id,
          demoToken: existing.demoToken ?? undefined,
          outreachEmailId: existing.outreachEmailId ?? undefined,
        };
      }
    }

    // 2 ── Classify. Anything not clearly a broker/carrier pitch is parked as
    //      noise (no enrich, no demo, no draft) — fail-closed.
    const verdict = await classify({ senderEmail: fromEmail, subject, body: bodyText });
    if (!verdict.worth) {
      const row = await inboundStore.upsert({
        harvestMailbox,
        fromEmail,
        fromDomain: domain,
        originalMessageId: messageId,
        originalReferences: references,
        originalSubject: subject,
        receivedAt,
        classifyCategory: verdict.category,
        status: 'classified_noise',
      });
      return { status: 'skipped_noise', inboundProspectId: row.id };
    }

    // 3 ── Freemail / own-domain gate. Brokers pitch from a company domain; a
    //      consumer freemail sender (or ourselves) goes to the manual queue.
    if (!domain || FREEMAIL_DOMAINS.has(domain) || OWN_DOMAINS.has(domain)) {
      const row = await inboundStore.upsert({
        harvestMailbox,
        fromEmail,
        fromDomain: domain,
        originalMessageId: messageId,
        originalReferences: references,
        originalSubject: subject,
        receivedAt,
        classifyCategory: verdict.category,
        status: 'skipped',
      });
      return { status: 'skipped_freemail', inboundProspectId: row.id };
    }

    // 4 ── Reuse-or-provision the prospect's branded demo (dedupe by domain).
    //      Mirrors routes/outreach.ts ensureDraftRow: reuse the stored profile
    //      when the demo already exists, else enrich + derive + upsert now.
    let demo = await demoStore.getByDomain(domain);
    let profile: CompanyProfile;
    if (demo && demo.profileJson) {
      profile = demo.profileJson as unknown as CompanyProfile;
    } else {
      profile = await enrich(domain);
      const config = deriveDemoConfig(profile);
      const brand = deriveDemoBrand(profile);
      demo = await demoStore.upsert({
        domain,
        companyName: profile.companyName,
        profileJson: profile as unknown as Record<string, unknown>,
        brandJson: brand,
        configJson: config,
      });
    }

    // 5 ── Links: the prospect's own demo + (when captured) the branded shot.
    const demoUrl = buildDemoUrl(demo.token);
    const previewImageUrl = demo.quoteShotAt ? buildShotUrl(demo.token) : undefined;

    // 6 ── Sender name (best-effort) for a personal warm-reply opener.
    const signature = extractSignature(bodyText);

    // 7 ── Draft the in-thread warm reply against their branded demo.
    const publicBaseUrl = deps.publicBaseUrl ?? loadEnv().PUBLIC_BASE_URL;
    const email = await draft(profile, demoUrl, {
      mode: 'warm-reply',
      inboundContext: { subject, senderName: signature.name },
      previewImageUrl,
      publicBaseUrl,
    });

    // 8 ── Persist: the reviewable draft, then the inbound_prospects row with
    //      the threading fields Phase 3 needs to reply in-thread.
    const savedDraft = await emailStore.saveDraft({
      demoToken: demo.token,
      domain,
      recipientEmail: fromEmail,
      unsubscribeToken: email.unsubscribeToken,
      subject: email.subject,
      bodyHtml: email.bodyHtml,
      bodyText: email.bodyText,
      aiGenerated: email.aiGenerated,
    });

    const row = await inboundStore.upsert({
      harvestMailbox,
      fromEmail,
      fromDomain: domain,
      originalMessageId: messageId,
      originalReferences: references,
      originalSubject: subject,
      receivedAt,
      signatureJson: { ...signature },
      classifyCategory: verdict.category,
      status: 'drafted',
      demoToken: demo.token,
      outreachEmailId: savedDraft.id,
    });

    // 9 ── Done.
    return {
      status: 'drafted',
      inboundProspectId: row.id,
      demoToken: demo.token,
      outreachEmailId: savedDraft.id,
    };
  } catch (err) {
    // Never let one bad email sink the harvest. Park it (best-effort) with the
    // error note and return a non-drafted result. The union has no dedicated
    // error variant, so an unexpected failure maps to 'skipped_noise' (dropped,
    // not drafted); the DB row status 'skipped' + note records the real reason.
    const note = err instanceof Error ? err.message : String(err);
    try {
      await inboundStore.upsert({
        harvestMailbox,
        fromEmail,
        fromDomain: domain,
        originalMessageId: messageId,
        originalReferences: references,
        originalSubject: subject,
        receivedAt,
        classifyCategory: `error: ${note}`.slice(0, 200),
        status: 'skipped',
      });
    } catch {
      // Even the park failed (DB down) — swallow so we still return, never throw.
    }
    return { status: 'skipped_noise' };
  }
}
