/**
 * Lead-batch orchestrator (Phase 3) — turn RESOLVED broker leads into
 * review-ready BRANDED COLD DRAFTS.
 *
 * For each `broker_leads` row with status='resolved', end-to-end:
 *   1. enrichCompany(resolvedDomain)          → CompanyProfile (minimal-profile
 *                                                fallback from the lead fields so
 *                                                one bad enrich never sinks the batch).
 *   2. deriveDemoConfig + deriveDemoBrand      → the on-brand sample calculator.
 *   3. dbProspectDemoStore.upsert(...)          → a prospect_demos token (dedup by domain).
 *   4. captureQuoteShotForToken(token, base)    → screenshot the branded quote (soft-fail).
 *   5. draftOutreachEmail(profile, demoUrl, {   → a personalized COLD draft:
 *        mode:'cold', embedImageCid:true,          CID-embedded screenshot +
 *        coldCompliantFooter:true })               CAN-SPAM footer + anti-leak guard.
 *   6. dbOutreachEmailStore.saveDraft(...)      → an outreach_emails row (id).
 *   7. dbLeadStore.updateStatus(id,'drafted',{ demoToken, outreachEmailId }).
 *
 * NEVER SENDS — this only drafts for human review. COLD only, QuoteFleet's own
 * sender (feedback_quotefleet_accessair_separation): the drafter's assertNoLeak
 * guard throws before any "you reached out" / Access-Air wording can be persisted.
 *
 * Idempotent + resumable: it only ever reads status='resolved', so a re-run skips
 * everything already 'drafted' (or 'error'/'skipped'). Each lead is fully
 * try/caught — one bad lead flips to status 'error' and the batch continues.
 * Enrich fetch + Playwright are heavy, so leads run SERIALLY with a small spacing.
 *
 * RUN (orchestrator, dev DB — the dev server + tunnel must be live):
 *   doppler run -p quotefleet -c dev --scope "C:\\Users\\Owner" -- bash -c \
 *     'PUBLIC_BASE_URL=https://<demo-host> pnpm exec tsx scripts/runLeadBatch.ts --limit 3'
 *
 * Flags:
 *   --limit N   cap resolved leads processed this run (default 25).
 *   --dry-run   enrich + derive + draft in memory, but write NOTHING to the DB
 *               and skip the (DB-persisting) screenshot capture.
 */
import { dbLeadStore, type LeadStore } from '../src/server/outreach/leadStore.js';
import {
  dbProspectDemoStore,
  type ProspectDemoStore,
} from '../src/server/outreach/prospectDemoStore.js';
import {
  dbOutreachEmailStore,
  type OutreachEmailStore,
} from '../src/server/outreach/outreachEmailStore.js';
import {
  enrichCompany,
  normalizeDomain,
  type CompanyProfile,
} from '../src/server/outreach/enrichCompany.js';
import { deriveDemoConfig, deriveDemoBrand } from '../src/server/outreach/prospectDemo.js';
import {
  draftOutreachEmail,
  type DraftedEmail,
  type DraftEmailOpts,
} from '../src/server/outreach/draftEmail.js';
import { demoUrlForToken } from '../src/server/routes/outreach.js';
import { captureQuoteShotForToken } from './captureQuoteShot.js';
import type {
  BrokerLead,
  ProspectDemoBrand,
  ProspectDemoConfig,
} from '../src/db/schema.js';

// ─── Per-lead orchestration (testable core) ───────────────────────────────
/** Everything the per-lead pipeline needs — injected so tests run DB/network-free. */
export interface ProcessLeadDeps {
  enrich: (domain: string) => Promise<CompanyProfile>;
  deriveConfig: (profile: CompanyProfile) => ProspectDemoConfig;
  deriveBrand: (profile: CompanyProfile) => ProspectDemoBrand;
  prospectStore: Pick<ProspectDemoStore, 'upsert'>;
  /** Capture + persist the branded quote screenshot for a token. Throws on
   *  failure; processLead treats a throw as a (soft) "no shot". */
  captureShot: (token: string, baseUrl: string) => Promise<void>;
  draft: (profile: CompanyProfile, demoUrl: string, opts: DraftEmailOpts) => Promise<DraftedEmail>;
  emailStore: Pick<OutreachEmailStore, 'saveDraft'>;
  leadStore: Pick<LeadStore, 'updateStatus'>;
  demoUrl: (token: string) => string;
  publicBaseUrl: string;
}

export type LeadOutcome = 'drafted' | 'skipped' | 'error';

export interface ProcessResult {
  leadId: number;
  outcome: LeadOutcome;
  demoToken?: string;
  emailId?: number;
  subject?: string;
  shotCaptured?: boolean;
  aiGenerated?: boolean;
  reason?: string;
}

/** Build a minimal CompanyProfile from the lead's own fields — the fallback when
 *  enrichment fails/hangs, so the batch always has SOMETHING to brand + draft. */
export function minimalProfileFromLead(lead: BrokerLead): CompanyProfile {
  const domain = normalizeDomain(lead.resolvedDomain ?? '');
  // Conventional US format: "Street, City, ST ZIP" (state+zip share a space, not a comma).
  const stateZip = [lead.addrState, lead.addrZip].filter(Boolean).join(' ');
  const mailingAddress =
    [lead.addrStreet, lead.addrCity, stateZip].filter(Boolean).join(', ') || null;
  return {
    domain,
    website: domain ? `https://${domain}` : '',
    companyName: lead.dbaName || lead.legalName || domain || null,
    tagline: null,
    phone: lead.phone ?? null,
    email: lead.resolvedEmail ?? lead.censusEmail ?? null,
    mailingAddress,
    serviceModes: [],
    regionsLanes: [],
    brandColors: { primary: null, secondary: null, confidence: 'low' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: ['minimal profile — enrichment failed or returned nothing.'],
    fetchedPaths: [],
  };
}

/**
 * Run the full resolved-lead → branded-cold-draft pipeline for ONE lead. Every
 * step is guarded: enrichment degrades to a minimal profile, the screenshot is a
 * soft-fail, and any hard failure flips the lead to status 'error' and returns
 * (so the batch loop continues). Returns a structured result for the summary.
 */
export async function processLead(lead: BrokerLead, deps: ProcessLeadDeps): Promise<ProcessResult> {
  const domain = normalizeDomain(lead.resolvedDomain ?? '');
  if (!domain) {
    // A resolved lead with no domain can't be enriched or branded. Persist the
    // skip so it leaves the 'resolved' pool — otherwise a re-run (which orders by
    // id desc) keeps re-pulling the same domainless leads and never advances to
    // the draftable ones. Best-effort: a failed write must not abort the batch.
    try {
      await deps.leadStore.updateStatus(lead.id, 'skipped', {});
    } catch {
      /* non-fatal */
    }
    return { leadId: lead.id, outcome: 'skipped', reason: 'no resolvedDomain' };
  }

  try {
    // 1. Enrich — never hard-fail the lead on a bad enrich; fall back to minimal.
    let profile: CompanyProfile;
    try {
      profile = (await deps.enrich(domain)) ?? minimalProfileFromLead(lead);
    } catch {
      profile = minimalProfileFromLead(lead);
    }

    // 2. Derive the on-brand demo config + brand identity.
    const configJson = deps.deriveConfig(profile);
    const brandJson = deps.deriveBrand(profile);

    // 3. Provision (or update) the prospect demo — dedupe by domain → token.
    const demo = await deps.prospectStore.upsert({
      domain,
      companyName: profile.companyName ?? lead.legalName,
      profileJson: profile as unknown as Record<string, unknown>,
      brandJson,
      configJson,
    });
    const token = demo.token;

    // 4. Capture the branded quote screenshot (soft-fail — the draft still ships
    //    a working CTA/CID reference; a missing shot just omits the inline image).
    let shotCaptured = false;
    try {
      await deps.captureShot(token, deps.publicBaseUrl);
      shotCaptured = true;
    } catch (err) {
      console.warn(`  [lead ${lead.id}] quote screenshot skipped: ${(err as Error).message}`);
    }

    // 5. Draft the COLD email — CID screenshot + CAN-SPAM footer + anti-leak guard.
    const drafted = await deps.draft(profile, deps.demoUrl(token), {
      mode: 'cold',
      embedImageCid: true,
      coldCompliantFooter: true,
      publicBaseUrl: deps.publicBaseUrl,
    });

    // 6. Persist the reviewable draft.
    const saved = await deps.emailStore.saveDraft({
      demoToken: token,
      domain,
      recipientEmail: lead.resolvedEmail ?? null,
      unsubscribeToken: drafted.unsubscribeToken,
      subject: drafted.subject,
      bodyHtml: drafted.bodyHtml,
      bodyText: drafted.bodyText,
      aiGenerated: drafted.aiGenerated,
    });

    // 7. Link the demo + draft back onto the lead and mark it 'drafted'.
    await deps.leadStore.updateStatus(lead.id, 'drafted', {
      demoToken: token,
      outreachEmailId: saved.id,
    });

    return {
      leadId: lead.id,
      outcome: 'drafted',
      demoToken: token,
      emailId: saved.id,
      subject: drafted.subject,
      shotCaptured,
      aiGenerated: drafted.aiGenerated,
    };
  } catch (err) {
    // One bad lead → status 'error' + continue (never abort the whole batch).
    const reason = (err as Error).message;
    try {
      await deps.leadStore.updateStatus(lead.id, 'error', {});
    } catch {
      /* even the error-status write failing must not abort the batch */
    }
    return { leadId: lead.id, outcome: 'error', reason };
  }
}

// ─── Batch driver ──────────────────────────────────────────────────────────
interface Options {
  limit: number;
  dryRun: boolean;
}

export interface BatchSummary {
  processed: number;
  drafted: number;
  skipped: number;
  errored: number;
  shotsCaptured: number;
  results: ProcessResult[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Polite spacing between leads — enrich fetch + Playwright are heavy. */
const LEAD_SPACING_MS = 500;

/** Real-dependency deps for a live batch run. `dryRun` swaps the DB writers +
 *  the screenshot capture for no-ops so the pipeline can be exercised safely. */
function buildLiveDeps(publicBaseUrl: string, dryRun: boolean): ProcessLeadDeps {
  const noopShot = async () => {
    /* dry-run: skip the DB-persisting screenshot */
  };
  const dryProspectStore: Pick<ProspectDemoStore, 'upsert'> = {
    async upsert(input) {
      // Synthesize a demo-shaped record without touching the DB.
      return {
        token: `dry-${input.domain}`,
        domain: input.domain,
        companyName: input.companyName,
        profileJson: input.profileJson,
        brandJson: input.brandJson,
        configJson: input.configJson,
      } as Awaited<ReturnType<ProspectDemoStore['upsert']>>;
    },
  };
  const dryEmailStore: Pick<OutreachEmailStore, 'saveDraft'> = {
    async saveDraft(input) {
      return { id: 0, ...input } as Awaited<ReturnType<OutreachEmailStore['saveDraft']>>;
    },
  };
  const dryLeadStore: Pick<LeadStore, 'updateStatus'> = { async updateStatus() {} };

  return {
    enrich: (domain) => enrichCompany(domain),
    deriveConfig: deriveDemoConfig,
    deriveBrand: deriveDemoBrand,
    prospectStore: dryRun ? dryProspectStore : dbProspectDemoStore,
    captureShot: dryRun ? noopShot : (token, base) => captureQuoteShotForToken(token, base),
    draft: (profile, demoUrl, opts) => draftOutreachEmail(profile, demoUrl, opts),
    emailStore: dryRun ? dryEmailStore : dbOutreachEmailStore,
    leadStore: dryRun ? dryLeadStore : dbLeadStore,
    demoUrl: demoUrlForToken,
    publicBaseUrl,
  };
}

export async function runLeadBatch(
  opts: Options,
  store: LeadStore = dbLeadStore,
  deps?: ProcessLeadDeps,
): Promise<BatchSummary> {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5000';
  const d = deps ?? buildLiveDeps(publicBaseUrl, opts.dryRun);

  const leads = await store.getByStatus('resolved', opts.limit);
  console.log(
    `[batch] pulled ${leads.length} lead(s) with status='resolved' (limit=${opts.limit}${opts.dryRun ? ', DRY-RUN' : ''})`,
  );

  const summary: BatchSummary = {
    processed: 0,
    drafted: 0,
    skipped: 0,
    errored: 0,
    shotsCaptured: 0,
    results: [],
  };

  for (const lead of leads) {
    const res = await processLead(lead, d);
    summary.processed += 1;
    summary.results.push(res);
    if (res.outcome === 'drafted') summary.drafted += 1;
    else if (res.outcome === 'skipped') summary.skipped += 1;
    else summary.errored += 1;
    if (res.shotCaptured) summary.shotsCaptured += 1;

    const name = lead.dbaName || lead.legalName;
    if (res.outcome === 'drafted') {
      console.log(
        `  ✓ [lead ${lead.id}] ${name} (${lead.resolvedDomain}) → drafted #${res.emailId} ` +
          `token=${res.demoToken} shot=${res.shotCaptured ? 'yes' : 'no'} ai=${res.aiGenerated ? 'yes' : 'template'}\n` +
          `      subject: "${res.subject}"`,
      );
    } else if (res.outcome === 'skipped') {
      console.log(`  – [lead ${lead.id}] ${name} → skipped (${res.reason})`);
    } else {
      console.log(`  ✗ [lead ${lead.id}] ${name} → ERROR (${res.reason})`);
    }

    await sleep(LEAD_SPACING_MS);
  }

  return summary;
}

function parseArgs(argv: string[]): Options {
  const i = argv.indexOf('--limit');
  const limit = i !== -1 && i + 1 < argv.length ? Number.parseInt(argv[i + 1], 10) : 25;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 25,
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  console.log(
    `[batch] resolved-broker → branded cold draft (limit=${opts.limit}${opts.dryRun ? ', DRY-RUN' : ''}; base=${base || '(unset)'})`,
  );
  if (!base && !opts.dryRun) {
    console.warn('[batch] PUBLIC_BASE_URL is unset — demo links + screenshot capture need it. Continuing with the localhost default.');
  }
  const t0 = Date.now();
  const s = await runLeadBatch(opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n[batch] DONE in ' + secs + 's');
  console.log(`  processed        : ${s.processed}`);
  console.log(`  drafted          : ${s.drafted}`);
  console.log(`  screenshots      : ${s.shotsCaptured}/${s.drafted} branded shots captured`);
  console.log(`  skipped          : ${s.skipped}`);
  console.log(`  errored          : ${s.errored}`);
  console.log('\n  Drafts are REVIEW-ONLY — nothing was sent.');
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('runLeadBatch.ts');
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[batch] FAILED:', err);
      process.exit(1);
    });
}
