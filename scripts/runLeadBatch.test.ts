/**
 * Lead-batch orchestrator unit tests (Phase 3). Everything injected — no
 * network, no Playwright, no Anthropic vendor, no DB. Proves the per-lead
 * pipeline (`processLead`):
 *   - a RESOLVED lead → demo upserted + branded shot captured + a COLD draft
 *     (mode:'cold', embedImageCid:true, coldCompliantFooter:true) + saveDraft +
 *     the lead flips to 'drafted' carrying demoToken + outreachEmailId.
 *   - enrich failure → minimal-profile fallback, and it STILL drafts (never
 *     hard-fails the lead on a bad enrich).
 *   - the draft is COLD, never a warm reply (mode is asserted, and no
 *     inboundContext is ever passed).
 *   - a screenshot failure is soft (shotCaptured=false) but the lead still drafts.
 *   - a hard failure (draft throws) flips the lead to 'error' and never throws
 *     out of processLead.
 *   - a resolved lead with no resolvedDomain is skipped (nothing enriched/drafted).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  processLead,
  minimalProfileFromLead,
  type ProcessLeadDeps,
} from './runLeadBatch.js';
import type { CompanyProfile } from '../src/server/outreach/enrichCompany.js';
import type { DraftEmailOpts, DraftedEmail } from '../src/server/outreach/draftEmail.js';
import type { BrokerLead, ProspectDemoBrand, ProspectDemoConfig } from '../src/db/schema.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────
function resolvedLead(over: Partial<BrokerLead> = {}): BrokerLead {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: 42,
    mcNumber: 'MC123456',
    dotNumber: '987654',
    legalName: 'Harbor Link Logistics LLC',
    dbaName: 'Harbor Link Logistics',
    phone: '(562) 555-0100',
    addrStreet: '1200 Harbor Blvd',
    addrCity: 'Long Beach',
    addrState: 'CA',
    addrZip: '90802',
    censusEmail: 'ops@harborlinklogistics.com',
    resolvedDomain: 'harborlinklogistics.com',
    resolvedEmail: 'dispatch@harborlinklogistics.com',
    emailSource: 'census',
    emailVerified: true,
    powerUnits: 40,
    segment: 'broker',
    demoToken: null,
    outreachEmailId: null,
    status: 'resolved',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function enrichedProfile(): CompanyProfile {
  return {
    domain: 'harborlinklogistics.com',
    website: 'https://harborlinklogistics.com',
    companyName: 'Harbor Link Logistics',
    tagline: 'Port to door, on time',
    phone: '(562) 555-0100',
    email: 'dispatch@harborlinklogistics.com',
    mailingAddress: '1200 Harbor Blvd, Long Beach, CA 90802',
    serviceModes: ['drayage'],
    regionsLanes: ['Los Angeles to Phoenix'],
    brandColors: { primary: '#0d3cfc', secondary: null, confidence: 'high' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: {
      tone: 'professional',
      businessSummary: 'A drayage carrier out of the San Pedro ports.',
      painPoints: ['manual drayage quoting is slow'],
      quoteFleetAngle: 'instant branded drayage quotes',
      suggestedCalculator: { mode: 'drayage', fields: ['port', 'container'] },
    },
    aiAvailable: true,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

const CONFIG: ProspectDemoConfig = {
  primaryMode: 'drayage',
  services: [],
  sampleCards: [],
  fields: ['port', 'container'],
  countryFocus: 'US',
};
const BRAND: ProspectDemoBrand = {
  primary: '#0d3cfc',
  secondary: null,
  logoUrl: null,
  companyName: 'Harbor Link Logistics',
  brandColorConfidence: 'high',
};

/** A drafted-email stub — records how the drafter was invoked. */
function draftedEmail(subject = 'Instant quotes for Harbor Link drayage'): DraftedEmail {
  return {
    subject,
    bodyHtml: '<table><tr><td>cold body — see the demo</td></tr></table>',
    bodyText: 'cold body — see the demo\n\n— Aleksandr',
    unsubscribeToken: 'unsub-token-xyz',
    aiGenerated: true,
  };
}

interface Recorder {
  upserted: unknown[];
  captured: Array<{ token: string; base: string }>;
  draftCalls: Array<{ demoUrl: string; opts: DraftEmailOpts }>;
  saved: unknown[];
  statusUpdates: Array<{ id: number; status: string; patch: unknown }>;
}

/** Build a fully-faked, happy-path dep set + a recorder to assert against. */
function makeDeps(
  over: Partial<ProcessLeadDeps> = {},
): { deps: ProcessLeadDeps; rec: Recorder } {
  const rec: Recorder = { upserted: [], captured: [], draftCalls: [], saved: [], statusUpdates: [] };
  const deps: ProcessLeadDeps = {
    enrich: vi.fn(async () => enrichedProfile()),
    deriveConfig: vi.fn(() => CONFIG),
    deriveBrand: vi.fn(() => BRAND),
    prospectStore: {
      upsert: vi.fn(async (input) => {
        rec.upserted.push(input);
        return { token: 'demo-token-abc', ...input } as never;
      }),
    },
    captureShot: vi.fn(async (token: string, base: string) => {
      rec.captured.push({ token, base });
    }),
    draft: vi.fn(async (_profile: CompanyProfile, demoUrl: string, opts: DraftEmailOpts) => {
      rec.draftCalls.push({ demoUrl, opts });
      return draftedEmail();
    }),
    emailStore: {
      saveDraft: vi.fn(async (input) => {
        rec.saved.push(input);
        return { id: 777, ...input } as never;
      }),
    },
    leadStore: {
      updateStatus: vi.fn(async (id: number, status: string, patch?: unknown) => {
        rec.statusUpdates.push({ id, status, patch });
      }),
    },
    demoUrl: (token: string) => `https://quotefleet.net/demo/${token}`,
    publicBaseUrl: 'https://quotefleet.net',
    ...over,
  };
  return { deps, rec };
}

// ─── Tests ───────────────────────────────────────────────────────────────
describe('processLead', () => {
  it('resolved lead → demo upserted, shot captured, COLD draft saved, lead → drafted', async () => {
    const { deps, rec } = makeDeps();
    const lead = resolvedLead();

    const res = await processLead(lead, deps);

    expect(res.outcome).toBe('drafted');
    expect(res.demoToken).toBe('demo-token-abc');
    expect(res.emailId).toBe(777);
    expect(res.shotCaptured).toBe(true);

    // Demo upserted under the resolved domain, branded with the profile.
    expect(rec.upserted).toHaveLength(1);
    expect(rec.upserted[0]).toMatchObject({
      domain: 'harborlinklogistics.com',
      companyName: 'Harbor Link Logistics',
      brandJson: BRAND,
      configJson: CONFIG,
    });

    // Screenshot captured against the public base URL for the minted token.
    expect(rec.captured).toEqual([{ token: 'demo-token-abc', base: 'https://quotefleet.net' }]);

    // Draft was invoked COLD with the CID image + compliant footer, against the
    // prospect's OWN demo URL — and NEVER warm-reply (no inboundContext).
    expect(rec.draftCalls).toHaveLength(1);
    expect(rec.draftCalls[0].demoUrl).toBe('https://quotefleet.net/demo/demo-token-abc');
    expect(rec.draftCalls[0].opts.mode).toBe('cold');
    expect(rec.draftCalls[0].opts.embedImageCid).toBe(true);
    expect(rec.draftCalls[0].opts.coldCompliantFooter).toBe(true);
    expect(rec.draftCalls[0].opts.inboundContext).toBeUndefined();

    // Draft persisted with the recipient + token linkage.
    expect(rec.saved).toHaveLength(1);
    expect(rec.saved[0]).toMatchObject({
      demoToken: 'demo-token-abc',
      domain: 'harborlinklogistics.com',
      recipientEmail: 'dispatch@harborlinklogistics.com',
      unsubscribeToken: 'unsub-token-xyz',
      subject: 'Instant quotes for Harbor Link drayage',
      aiGenerated: true,
    });

    // Lead flipped to 'drafted' with the demo + email linkage.
    expect(rec.statusUpdates).toEqual([
      { id: 42, status: 'drafted', patch: { demoToken: 'demo-token-abc', outreachEmailId: 777 } },
    ]);
  });

  it('draft is COLD — mode is cold and no warm-reply context is ever passed', async () => {
    const { deps, rec } = makeDeps();
    await processLead(resolvedLead(), deps);
    const opts = rec.draftCalls[0].opts;
    expect(opts.mode).toBe('cold');
    expect(opts.mode).not.toBe('warm-reply');
    expect(opts.inboundContext).toBeUndefined();
  });

  it('enrich failure → minimal-profile fallback, but STILL drafts', async () => {
    const enrich = vi.fn(async () => {
      throw new Error('fetch timed out');
    });
    const deriveConfig = vi.fn(() => CONFIG);
    const { deps, rec } = makeDeps({ enrich, deriveConfig });

    const res = await processLead(resolvedLead(), deps);

    expect(res.outcome).toBe('drafted');
    // Config was derived from a minimal profile built off the lead's own fields.
    expect(deriveConfig).toHaveBeenCalledTimes(1);
    const profileArg = deriveConfig.mock.calls[0][0] as CompanyProfile;
    expect(profileArg.domain).toBe('harborlinklogistics.com');
    expect(profileArg.companyName).toBe('Harbor Link Logistics');
    expect(profileArg.aiAvailable).toBe(false);
    // Still drafted + saved + status updated despite the enrich failure.
    expect(rec.saved).toHaveLength(1);
    expect(rec.statusUpdates[0]).toMatchObject({ status: 'drafted' });
  });

  it('screenshot failure is soft — lead still drafts with shotCaptured=false', async () => {
    const captureShot = vi.fn(async () => {
      throw new Error('quote result card not found');
    });
    const { deps, rec } = makeDeps({ captureShot });

    const res = await processLead(resolvedLead(), deps);

    expect(res.outcome).toBe('drafted');
    expect(res.shotCaptured).toBe(false);
    expect(rec.saved).toHaveLength(1);
    expect(rec.statusUpdates[0]).toMatchObject({ status: 'drafted' });
  });

  it('a hard failure (draft throws) → lead flipped to error, no throw out of processLead', async () => {
    const draft = vi.fn(async () => {
      throw new Error('cold-outreach separation guard tripped');
    });
    const { deps, rec } = makeDeps({ draft });

    const res = await processLead(resolvedLead(), deps);

    expect(res.outcome).toBe('error');
    expect(res.reason).toContain('separation guard');
    expect(rec.saved).toHaveLength(0);
    expect(rec.statusUpdates).toEqual([{ id: 42, status: 'error', patch: {} }]);
  });

  it('resolved lead with no domain → skipped (persisted, nothing enriched or drafted)', async () => {
    const { deps, rec } = makeDeps();
    const res = await processLead(resolvedLead({ resolvedDomain: null }), deps);

    expect(res.outcome).toBe('skipped');
    expect(deps.enrich).not.toHaveBeenCalled();
    expect(rec.upserted).toHaveLength(0);
    expect(rec.saved).toHaveLength(0);
    // The skip is persisted so the lead leaves the 'resolved' pool (no re-pull).
    expect(rec.statusUpdates).toEqual([{ id: 42, status: 'skipped', patch: {} }]);
  });
});

describe('minimalProfileFromLead', () => {
  it('builds a usable profile from the lead fields (name, phone, address, email)', () => {
    const p = minimalProfileFromLead(resolvedLead());
    expect(p.domain).toBe('harborlinklogistics.com');
    expect(p.companyName).toBe('Harbor Link Logistics');
    expect(p.phone).toBe('(562) 555-0100');
    expect(p.email).toBe('dispatch@harborlinklogistics.com');
    expect(p.mailingAddress).toBe('1200 Harbor Blvd, Long Beach, CA 90802');
    expect(p.aiAvailable).toBe(false);
    expect(p.ai).toBeNull();
  });

  it('falls back to legalName when there is no DBA', () => {
    const p = minimalProfileFromLead(resolvedLead({ dbaName: null }));
    expect(p.companyName).toBe('Harbor Link Logistics LLC');
  });
});
