/**
 * Deliverable-email resolution — Phase 2 of the FMCSA outreach pipeline.
 *
 * Confirms a SEND-TO address for a broker lead, in cheapest-first order:
 *   1. CENSUS  — the FMCSA `censusEmail`, if it's syntactically valid AND its
 *                domain publishes an MX record. ~96% of leads carry one, so this
 *                is the common path and costs one DNS lookup.
 *   2. SCRAPE  — else, when a website domain is known, an enrichCompany-style
 *                page scrape for a published contact address.
 *   3. ROLE    — else a conventional role mailbox at the domain
 *                (info@ / dispatch@ / sales@).
 *
 * HARD RULE: an address is only ever accepted — and `verified` only ever true —
 * when BOTH syntax and a live MX record pass. We never hand back an address whose
 * domain can't receive mail. All I/O (DNS, scrape) is injectable for offline tests.
 */
import { resolveMx as dnsResolveMx } from 'node:dns/promises';
import { enrichCompany } from './enrichCompany.js';
import { emailDomain } from './domainResolver.js';

export type EmailSource = 'census' | 'scrape' | 'role' | null;

export interface EmailResult {
  email: string | null;
  source: EmailSource;
  verified: boolean;
}

/** Returns the domain's MX records (throws / rejects when none exist). */
export type MxResolver = (domain: string) => Promise<Array<{ exchange: string; priority: number }>>;
/** Scrape a domain's site for a published contact email (or null). */
export type EmailScraper = (domain: string) => Promise<string | null>;

export interface EmailResolverDeps {
  resolveMx?: MxResolver;
  scrape?: EmailScraper;
  /** Role mailboxes tried, in order, on a known domain. */
  roles?: string[];
}

/** Minimal shape resolveEmail reads — a `BrokerLead` is structurally assignable. */
export interface ResolvableEmailLead {
  censusEmail?: string | null;
}

const EMAIL_SYNTAX_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const DEFAULT_ROLES = ['info', 'dispatch', 'sales'];

export function isValidEmailSyntax(email: string | null | undefined): boolean {
  return !!email && EMAIL_SYNTAX_RE.test(email.trim());
}

/** True when the domain publishes at least one MX record. Never throws. */
async function hasMx(domain: string, resolveMx: MxResolver): Promise<boolean> {
  try {
    const records = await resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

/** Default scrape: enrichCompany with AI + FMCSA disabled → deterministic email only. */
async function defaultScrape(domain: string): Promise<string | null> {
  const profile = await enrichCompany(domain, { anthropicKey: '', fmcsaKey: '' });
  return profile.email ?? null;
}

/**
 * Resolve a deliverable email for `lead`, preferring the free census address and
 * falling back to scrape / role mailboxes on a known `domain`. Every returned
 * address has passed syntax + MX; `{ email:null, source:null, verified:false }`
 * means nothing deliverable was found.
 */
export async function resolveEmail(
  lead: ResolvableEmailLead,
  domain: string | null,
  deps: EmailResolverDeps = {},
): Promise<EmailResult> {
  const resolveMx = deps.resolveMx ?? dnsResolveMx;
  const scrape = deps.scrape ?? defaultScrape;
  const roles = deps.roles ?? DEFAULT_ROLES;

  // 1. CENSUS — free, just needs syntax + MX.
  const census = lead.censusEmail?.trim() || null;
  if (isValidEmailSyntax(census)) {
    const d = emailDomain(census);
    if (d && (await hasMx(d, resolveMx))) {
      return { email: census!.toLowerCase(), source: 'census', verified: true };
    }
  }

  // Without a domain there's nowhere left to look.
  const norm = domain?.trim().toLowerCase() || null;
  if (!norm) return { email: null, source: null, verified: false };

  // The domain must be able to receive mail before we trust ANY address on it.
  const domainHasMx = await hasMx(norm, resolveMx);
  if (!domainHasMx) return { email: null, source: null, verified: false };

  // 2. SCRAPE — a published contact address (accept only if syntax + MX pass).
  try {
    const scraped = (await scrape(norm))?.trim() || null;
    if (isValidEmailSyntax(scraped)) {
      const d = emailDomain(scraped);
      // If the scraped address lives on a different domain, re-check that one's MX.
      const mxOk = d === norm ? true : d ? await hasMx(d, resolveMx) : false;
      if (d && mxOk) return { email: scraped!.toLowerCase(), source: 'scrape', verified: true };
    }
  } catch {
    // Scrape is best-effort; fall through to a role mailbox.
  }

  // 3. ROLE — a conventional mailbox on the (MX-verified) domain.
  const role = roles[0];
  if (role) {
    const email = `${role}@${norm}`;
    if (isValidEmailSyntax(email)) return { email, source: 'role', verified: true };
  }

  return { email: null, source: null, verified: false };
}
