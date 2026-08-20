/**
 * RFQ recipient resolution — turn a directory SELECTION into the concrete set of
 * carriers a rate request fans out to.
 *
 * A selection is either:
 *   - an explicit list of carrier USDOTs (`?dots=D1,D2,…`, the "select these"
 *     path from the results page), OR
 *   - a directory FILTER (the normalized facet state), resolved server-side to
 *     "all carriers currently matching these filters" (the "request from all
 *     filtered" path — the flow that beats LoadMatch).
 *
 * Each resolved carrier is classified into its INITIAL recipient status:
 *   - 'opted_out' — the carrier hid its public contact (carrier_directory
 *     contact_hidden OR a carrier_overrides.hidden opt-out) OR its email is on
 *     the outreach suppression list. NEVER emailed.
 *   - 'no_email'  — no public email on file. Can't be emailed; recorded so the
 *     shipper sees the coverage gap.
 *   - 'pending'   — has an email and hasn't opted out → will be emailed.
 *
 * The whole thing is PURE + INJECTABLE (deps are passed in) so it unit-tests with
 * no DB and no network; the DB-backed defaults live in `dbResolveDeps()`.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { carrierDirectory, carrierOverrides } from '../../db/schema.js';
import { normalizeEmailAddress } from '../outreach/outreachEmailStore.js';
import { dbOutreachEmailStore, type OutreachEmailStore } from '../outreach/outreachEmailStore.js';
import { carrierName } from '../directory/pages.js';
import { listCarriers, type DirectoryFilters, type VisibleCarrier } from '../directory/queries.js';

/** Minimal carrier shape the resolver needs (drops everything render-only). */
export interface CarrierLite {
  usdot: string;
  name: string;
  email: string | null;
  contactHidden: boolean;
}

export type RfqCandidateStatus = 'pending' | 'no_email' | 'opted_out';

export interface ResolvedRecipient extends CarrierLite {
  status: RfqCandidateStatus;
}

export interface ResolveResult {
  /** The capped, classified recipient set (rows to create). */
  recipients: ResolvedRecipient[];
  /** How many carriers matched the selection BEFORE the cap. */
  totalMatched: number;
  /** True when the selection matched more carriers than the cap allowed. */
  capped: boolean;
  /** How many carriers were dropped by the cap (totalMatched − recipients). */
  cappedOut: number;
  /** The cap that was applied. */
  cap: number;
}

export interface ResolveDeps {
  /** All carriers matching a filter set, up to `limit`, with the total match count. */
  listByFilters: (filters: DirectoryFilters, limit: number) => Promise<{ carriers: CarrierLite[]; total: number }>;
  /** Carriers for an explicit USDOT list (order/dedupe handled by the resolver). */
  listByDots: (dots: string[]) => Promise<CarrierLite[]>;
  /** Subset of `dots` that have opted out via carrier_overrides.hidden. */
  optedOutDots: (dots: string[]) => Promise<Set<string>>;
  /** Whether a single email is on the outreach suppression list. */
  isEmailSuppressed: (email: string) => Promise<boolean>;
}

/** Normalize a raw USDOT the way carrier_directory stores it (digits only, no
 *  leading zeros). Returns '' for anything with no digits. */
export function normalizeDot(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D+/g, '');
  const trimmed = digits.replace(/^0+/, '');
  return trimmed || (digits ? '0' : '');
}

/** Parse a `?dots=` value (comma/space separated) into a deduped, normalized list. */
export function parseDots(raw: unknown): string[] {
  const parts = String(raw ?? '')
    .split(/[,\s]+/)
    .map((d) => normalizeDot(d))
    .filter(Boolean);
  return [...new Set(parts)];
}

/** Map a full VisibleCarrier row to the minimal CarrierLite the resolver uses. */
export function toCarrierLite(c: VisibleCarrier): CarrierLite {
  return {
    usdot: c.usdot,
    name: carrierName(c),
    email: c.email && c.email.trim() ? c.email.trim() : null,
    contactHidden: c.contactHidden,
  };
}

/**
 * Classify a resolved carrier into its initial recipient status. PURE — the one
 * place the opt-out / no-email / pending decision is made, so it is unit-tested
 * directly. Opt-out wins over no-email (an opted-out carrier is never emailed
 * regardless of whether an address exists).
 */
export function classifyCandidate(
  c: CarrierLite,
  opts: { optedOut: boolean; suppressed: boolean },
): RfqCandidateStatus {
  if (c.contactHidden || opts.optedOut || opts.suppressed) return 'opted_out';
  if (!c.email) return 'no_email';
  return 'pending';
}

/**
 * Resolve + classify + cap the recipient set for a request. Explicit dots take
 * precedence over filters (the results page passes one or the other). Never
 * throws — a resolution failure surfaces as an empty set to the caller.
 */
export async function resolveRfqRecipients(
  input: { dots?: string[]; filters?: DirectoryFilters },
  cap: number,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const safeCap = Math.max(1, Math.floor(cap) || 1);

  let carriers: CarrierLite[] = [];
  let totalMatched = 0;

  if (input.dots && input.dots.length) {
    const all = await deps.listByDots(input.dots);
    // Preserve the caller's dot order, dedupe, drop unknown dots.
    const byDot = new Map(all.map((c) => [c.usdot, c] as const));
    const ordered: CarrierLite[] = [];
    const seen = new Set<string>();
    for (const dot of input.dots) {
      if (seen.has(dot)) continue;
      const c = byDot.get(dot);
      if (c) {
        ordered.push(c);
        seen.add(dot);
      }
    }
    totalMatched = ordered.length;
    carriers = ordered.slice(0, safeCap);
  } else if (input.filters) {
    const { carriers: rows, total } = await deps.listByFilters(input.filters, safeCap);
    totalMatched = total;
    carriers = rows.slice(0, safeCap);
  }

  // Opt-out lookups for exactly the capped set.
  const dots = carriers.map((c) => c.usdot);
  const optedOut = dots.length ? await deps.optedOutDots(dots) : new Set<string>();

  const recipients: ResolvedRecipient[] = [];
  for (const c of carriers) {
    const suppressed = c.email ? await deps.isEmailSuppressed(c.email) : false;
    const status = classifyCandidate(c, { optedOut: optedOut.has(c.usdot), suppressed });
    recipients.push({ ...c, status });
  }

  return {
    recipients,
    totalMatched,
    capped: totalMatched > recipients.length,
    cappedOut: Math.max(0, totalMatched - recipients.length),
    cap: safeCap,
  };
}

// ─── DB-backed default deps ────────────────────────────────────────────────
/** Real deps wired to the directory query layer + outreach suppression store. */
export function dbResolveDeps(store: OutreachEmailStore = dbOutreachEmailStore): ResolveDeps {
  return {
    async listByFilters(filters, limit) {
      // Reuse the directory query layer (read-only) so the RFQ "all filtered"
      // set is identical to what the results page shows. perPage is clamped to
      // MAX_PER_PAGE (50) inside listCarriers, so `limit` above 50 is fetched in
      // one page here (the RFQ cap default of 25 sits well under that).
      const res = await listCarriers({ filters, perPage: limit });
      return { carriers: res.carriers.map(toCarrierLite), total: res.total };
    },
    async listByDots(dots) {
      if (!dots.length) return [];
      try {
        const rows = await db()
          .select()
          .from(carrierDirectory)
          .where(inArray(carrierDirectory.usdot, dots));
        // visibleCarrier isn't needed — map the raw row directly to CarrierLite.
        return rows.map((r) => ({
          usdot: r.usdot,
          name: carrierName({ dbaName: r.dbaName, legalName: r.legalName }),
          email: r.email && r.email.trim() ? r.email.trim() : null,
          contactHidden: r.contactHidden,
        }));
      } catch (err) {
        console.warn('[rfq] listByDots failed; treating as no carriers:', err);
        return [];
      }
    },
    async optedOutDots(dots) {
      if (!dots.length) return new Set<string>();
      try {
        const rows = await db()
          .select({ usdot: carrierOverrides.usdot })
          .from(carrierOverrides)
          .where(and(inArray(carrierOverrides.usdot, dots), eq(carrierOverrides.hidden, true)));
        return new Set(rows.map((r) => r.usdot));
      } catch (err) {
        console.warn('[rfq] optedOutDots failed; treating as none opted out:', err);
        return new Set<string>();
      }
    },
    async isEmailSuppressed(email) {
      const normalized = normalizeEmailAddress(email);
      if (!normalized) return false;
      try {
        return await store.isRecipientSuppressed(normalized);
      } catch {
        return false;
      }
    },
  };
}
