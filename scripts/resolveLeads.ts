/**
 * Resolve broker-lead DOMAIN + deliverable EMAIL → broker_leads (Phase 2).
 *
 * For each lead with status='new':
 *   1. resolveDomain  — census-email domain (free) → Google Places fallback.
 *   2. resolveEmail   — census address (syntax + MX) → scrape → role mailbox.
 *   3. persist        — updateStatus(id, 'resolved' | 'skipped', {
 *                         resolvedDomain, resolvedEmail, emailSource, emailVerified }).
 *                       'resolved' = a verified deliverable email exists;
 *                       'skipped'  = no deliverable email (domain, if any, is
 *                       still recorded so the lead stays branded-demo-capable).
 *
 * Idempotent + resumable: it only ever reads status='new', so a re-run picks up
 * exactly what a prior run didn't finish. Places calls are rate-limited and
 * cached by mcNumber so a re-run never double-bills.
 *
 * RUN (orchestrator, dev DB):
 *   doppler run -p quotefleet -c dev --scope "C:\\Users\\Owner" -- \
 *     pnpm exec tsx scripts/resolveLeads.ts --limit 500
 *
 * Flags:
 *   --limit N   cap leads processed this run (default 500).
 *   --dry-run   resolve + summarize, but do NOT write to the DB.
 */
import { dbLeadStore, type LeadStore } from '../src/server/outreach/leadStore.js';
import {
  resolveDomain,
  makeGooglePlacesLookup,
  type DomainResult,
  type PlacesLookup,
} from '../src/server/outreach/domainResolver.js';
import { resolveEmail, type EmailResult } from '../src/server/outreach/emailResolver.js';
import type { BrokerLead } from '../src/db/schema.js';

interface Options {
  limit: number;
  dryRun: boolean;
}

interface RunSummary {
  processed: number;
  domainBySource: Record<DomainResult['source'], number>;
  emailBySource: Record<'census' | 'scrape' | 'role' | 'none', number>;
  verifiedEmail: number;
  brandedReady: number; // has a domain
  resolved: number;
  skipped: number;
  placesCalls: number;
  placesConfigured: boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Polite spacing between real Places calls (~5 req/s). */
const PLACES_DELAY_MS = 200;

/** Wrap a lookup so each real call is rate-limited and counted. */
function rateLimited(lookup: PlacesLookup, counter: { n: number }): PlacesLookup {
  return async (query: string) => {
    if (counter.n > 0) await sleep(PLACES_DELAY_MS);
    counter.n += 1;
    return lookup(query);
  };
}

export async function runResolve(
  opts: Options,
  store: LeadStore = dbLeadStore,
): Promise<RunSummary> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const placesConfigured = !!apiKey;
  const placesCounter = { n: 0 };
  const placesLookup: PlacesLookup | null = apiKey
    ? rateLimited(makeGooglePlacesLookup(apiKey), placesCounter)
    : null;
  const cache = new Map<string, DomainResult>();

  const summary: RunSummary = {
    processed: 0,
    domainBySource: { email: 0, places: 0, none: 0 },
    emailBySource: { census: 0, scrape: 0, role: 0, none: 0 },
    verifiedEmail: 0,
    brandedReady: 0,
    resolved: 0,
    skipped: 0,
    placesCalls: 0,
    placesConfigured,
  };

  const leads: BrokerLead[] = await store.getByStatus('new', opts.limit);
  console.log(`[resolve] pulled ${leads.length} lead(s) with status='new' (limit=${opts.limit})`);

  for (const lead of leads) {
    let domain: DomainResult = { domain: null, source: 'none' };
    try {
      domain = await resolveDomain(lead, { placesLookup, cache });
    } catch (err) {
      console.warn(`[resolve] domain lookup failed for lead ${lead.id} (MC ${lead.mcNumber ?? '—'}): ${(err as Error).message}`);
    }

    let email: EmailResult = { email: null, source: null, verified: false };
    try {
      email = await resolveEmail(lead, domain.domain);
    } catch (err) {
      console.warn(`[resolve] email lookup failed for lead ${lead.id}: ${(err as Error).message}`);
    }

    summary.processed += 1;
    summary.domainBySource[domain.source] += 1;
    summary.emailBySource[email.source ?? 'none'] += 1;
    if (email.verified) summary.verifiedEmail += 1;
    if (domain.domain) summary.brandedReady += 1;

    const deliverable = email.verified && !!email.email;
    const nextStatus = deliverable ? 'resolved' : 'skipped';
    if (deliverable) summary.resolved += 1;
    else summary.skipped += 1;

    if (!opts.dryRun) {
      await store.updateStatus(lead.id, nextStatus, {
        resolvedDomain: domain.domain,
        resolvedEmail: email.email,
        emailSource: email.source,
        emailVerified: email.verified,
      });
    }

    if (summary.processed % 50 === 0) {
      console.log(`  …${summary.processed}/${leads.length} (domain email=${summary.domainBySource.email} places=${summary.domainBySource.places} none=${summary.domainBySource.none}; verified=${summary.verifiedEmail})`);
    }
  }

  summary.placesCalls = placesCounter.n;
  return summary;
}

function parseArgs(argv: string[]): Options {
  const i = argv.indexOf('--limit');
  const limit = i !== -1 && i + 1 < argv.length ? Number.parseInt(argv[i + 1], 10) : 500;
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 500,
    dryRun: argv.includes('--dry-run'),
  };
}

function pct(n: number, total: number): string {
  return total ? ((100 * n) / total).toFixed(1) + '%' : '0.0%';
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`[resolve] domain + deliverable-email resolver (limit=${opts.limit}${opts.dryRun ? ', DRY-RUN' : ''})`);
  const t0 = Date.now();
  const s = await runResolve(opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const p = s.processed;

  console.log('\n[resolve] DONE in ' + secs + 's');
  console.log(`  processed              : ${p}`);
  console.log(`  Places API             : ${s.placesConfigured ? `configured (${s.placesCalls} call(s) made)` : 'NOT configured (GOOGLE_MAPS_API_KEY absent) — free email-domain path only'}`);
  console.log('  ── domain resolution ──');
  console.log(`    via free email domain: ${s.domainBySource.email} (${pct(s.domainBySource.email, p)})`);
  console.log(`    via Google Places    : ${s.domainBySource.places} (${pct(s.domainBySource.places, p)})`);
  console.log(`    unresolved (none)    : ${s.domainBySource.none} (${pct(s.domainBySource.none, p)})`);
  console.log(`    BRANDED-DEMO-READY   : ${s.brandedReady} (${pct(s.brandedReady, p)})  ← has a domain`);
  console.log('  ── deliverable email ──');
  console.log(`    verified (syntax+MX) : ${s.verifiedEmail} (${pct(s.verifiedEmail, p)})`);
  console.log(`      from census        : ${s.emailBySource.census}`);
  console.log(`      from scrape        : ${s.emailBySource.scrape}`);
  console.log(`      from role mailbox  : ${s.emailBySource.role}`);
  console.log(`      none               : ${s.emailBySource.none}`);
  console.log('  ── status writes ──');
  console.log(`    resolved (sendable)  : ${s.resolved}`);
  console.log(`    skipped (no email)   : ${s.skipped}`);
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('resolveLeads.ts');
if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[resolve] FAILED:', err);
      process.exit(1);
    });
}
