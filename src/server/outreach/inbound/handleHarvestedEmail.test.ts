/**
 * handleHarvestedEmail (Phase 2a) — DB-free, network-free unit tests.
 *
 * Every external dependency (classify / enrich / the three stores / the drafter
 * / the URL builders) is injected as an in-memory fake, so these lock the
 * pipeline semantics with zero network and zero DB:
 *   - a real broker email → enrich → provision → warm-reply draft → persist
 *     (with the threading fields on the inbound_prospects row);
 *   - classifier "not worth" → parked as noise, nothing drafted/provisioned;
 *   - a freemail sender → skipped to the manual queue, nothing drafted;
 *   - a repeat Message-ID → duplicate, the drafter is never called again;
 *   - an existing demo for the domain → reuse it, no re-enrich.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ProspectDemo, ProspectInbound, OutreachEmail } from '../../../db/schema.js';
import type { CompanyProfile } from '../enrichCompany.js';
import type { InboundVerdict } from './classifyInbound.js';
import type { ProspectDemoStore } from '../prospectDemoStore.js';
import type { OutreachEmailStore } from '../outreachEmailStore.js';
import type { InboundProspectStore } from './inboundProspectStore.js';
import type { DraftedEmail } from '../draftEmail.js';
import { handleHarvestedEmail, type HandleHarvestedEmailDeps } from './handleHarvestedEmail.js';

// ─── Minimal fakes ─────────────────────────────────────────────────────────

function makeProfile(domain: string): CompanyProfile {
  return {
    domain,
    website: `https://${domain}`,
    companyName: 'Acme Freight',
    tagline: 'Drayage done right',
    phone: null,
    email: `sales@${domain}`,
    mailingAddress: null,
    serviceModes: ['drayage'],
    regionsLanes: [],
    brandColors: { primary: null, secondary: null, confidence: 'low' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

function makeDemoStore(seed?: ProspectDemo): ProspectDemoStore & {
  rows: ProspectDemo[];
  upsertCalls: number;
} {
  const rows: ProspectDemo[] = seed ? [seed] : [];
  let nextId = rows.length + 1;
  let tokenSeq = rows.length + 1;
  const store = {
    rows,
    upsertCalls: 0,
    async getByToken(token: string) {
      return rows.find((r) => r.token === token) ?? null;
    },
    async getByDomain(domain: string) {
      return rows.find((r) => r.domain === domain) ?? null;
    },
    async upsert(input: {
      domain: string;
      companyName: string | null;
      profileJson: Record<string, unknown> | null;
      brandJson: ProspectDemo['brandJson'];
      configJson: ProspectDemo['configJson'];
    }) {
      store.upsertCalls += 1;
      const existing = rows.find((r) => r.domain === input.domain);
      if (existing) {
        Object.assign(existing, input, { updatedAt: new Date() });
        return existing;
      }
      const row: ProspectDemo = {
        id: nextId++,
        token: `tok_${tokenSeq++}`,
        domain: input.domain,
        companyName: input.companyName,
        profileJson: input.profileJson,
        brandJson: input.brandJson,
        configJson: input.configJson,
        createdAt: new Date(),
        updatedAt: new Date(),
        viewedAt: null,
        quoteShotB64: null,
        quoteShotAt: null,
      };
      rows.push(row);
      return row;
    },
    async markViewed() {},
  };
  return store;
}

function makeEmailStore(): OutreachEmailStore & { rows: OutreachEmail[] } {
  const rows: OutreachEmail[] = [];
  let nextId = 1;
  return {
    rows,
    async saveDraft(input) {
      const row = {
        id: nextId++,
        demoToken: input.demoToken,
        domain: input.domain,
        recipientEmail: input.recipientEmail,
        unsubscribeToken: input.unsubscribeToken,
        subject: input.subject,
        bodyHtml: input.bodyHtml,
        bodyText: input.bodyText,
        aiGenerated: input.aiGenerated,
      } as unknown as OutreachEmail;
      rows.push(row);
      return row;
    },
    async getByUnsubscribeToken() { return null; },
    async getById() { return null; },
    async suppressByToken() { return false; },
    async isRecipientSuppressed() { return false; },
    async recordSend() {},
    async markClickedByToken() { return null; },
  };
}

function makeInboundStore(seed?: ProspectInbound): InboundProspectStore & {
  rows: ProspectInbound[];
} {
  const rows: ProspectInbound[] = seed ? [seed] : [];
  let nextId = rows.length + 1;
  return {
    rows,
    async upsert(input) {
      const messageId = input.originalMessageId ?? null;
      const existing = messageId
        ? rows.find((r) => r.originalMessageId === messageId)
        : undefined;
      const base: ProspectInbound = existing ?? ({
        id: nextId++,
        createdAt: new Date(),
      } as ProspectInbound);
      const row: ProspectInbound = {
        ...base,
        harvestMailbox: input.harvestMailbox,
        fromEmail: input.fromEmail,
        fromDomain: input.fromDomain,
        originalMessageId: messageId,
        originalReferences: input.originalReferences ?? null,
        originalSubject: input.originalSubject ?? null,
        receivedAt: input.receivedAt ?? null,
        signatureJson: input.signatureJson ?? null,
        classifyCategory: input.classifyCategory ?? null,
        status: input.status ?? 'harvested',
        demoToken: input.demoToken ?? null,
        outreachEmailId: input.outreachEmailId ?? null,
        updatedAt: new Date(),
      } as ProspectInbound;
      if (existing) {
        Object.assign(existing, row);
        return existing;
      }
      rows.push(row);
      return row;
    },
    async getByMessageId(messageId: string) {
      return rows.find((r) => r.originalMessageId === messageId) ?? null;
    },
    async getById(id: number) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async list() { return rows.slice(); },
    async updateStatus() {},
  };
}

const worth = (category: 'broker' | 'carrier' = 'broker'): InboundVerdict => ({
  worth: true,
  category,
  reason: 'broker pitch',
});
const notWorth: InboundVerdict = { worth: false, category: 'shipper_rfq', reason: 'shipper rfq' };

function makeDraft(): DraftedEmail {
  return {
    subject: 'Re: Partner with Acme Freight',
    bodyHtml: '<p>hi</p>',
    bodyText: 'hi\n\n— Aleksandr',
    unsubscribeToken: 'unsub_1',
    aiGenerated: false,
  };
}

/** Common deps with fakes wired up; individual tests override as needed. */
function baseDeps(overrides: Partial<HandleHarvestedEmailDeps> = {}): {
  deps: HandleHarvestedEmailDeps;
  classify: ReturnType<typeof vi.fn>;
  enrich: ReturnType<typeof vi.fn>;
  draft: ReturnType<typeof vi.fn>;
  demoStore: ReturnType<typeof makeDemoStore>;
  emailStore: ReturnType<typeof makeEmailStore>;
  inboundStore: ReturnType<typeof makeInboundStore>;
} {
  const demoStore = (overrides.demoStore as ReturnType<typeof makeDemoStore>) ?? makeDemoStore();
  const emailStore = (overrides.emailStore as ReturnType<typeof makeEmailStore>) ?? makeEmailStore();
  const inboundStore =
    (overrides.inboundStore as ReturnType<typeof makeInboundStore>) ?? makeInboundStore();
  const classify = (overrides.classify as ReturnType<typeof vi.fn>) ?? vi.fn(async () => worth());
  const enrich =
    (overrides.enrich as ReturnType<typeof vi.fn>) ?? vi.fn(async (domain: string) => makeProfile(domain));
  const draft = (overrides.draft as ReturnType<typeof vi.fn>) ?? vi.fn(async () => makeDraft());
  const deps: HandleHarvestedEmailDeps = {
    classify,
    enrich,
    draft,
    demoStore,
    emailStore,
    inboundStore,
    demoUrlForToken: (t) => `https://qf.test/demo/${t}`,
    quoteShotUrlForToken: (t) => `https://qf.test/demo-shot/${t}.png`,
    publicBaseUrl: 'https://qf.test',
    ...overrides,
  };
  return { deps, classify, enrich, draft, demoStore, emailStore, inboundStore };
}

const brokerInput = {
  harvestMailbox: 'harvest@quotefleet.net',
  fromEmail: 'sam@acme-freight.com',
  subject: 'Partner with Acme Freight',
  bodyText: 'Hi, we are a drayage broker looking to connect.\n\nThanks,\nSam Rivera\nDispatch Manager',
  messageId: '<abc-123@acme-freight.com>',
  references: ['<root@acme-freight.com>'],
  receivedAt: new Date('2026-08-01T12:00:00Z'),
};

// ─── Tests ───────────────────────────────────────────────────────────────

describe('handleHarvestedEmail', () => {
  it('broker email → enrich → provision → warm draft → persist with threading', async () => {
    const { deps, classify, enrich, draft, demoStore, emailStore, inboundStore } = baseDeps();

    const res = await handleHarvestedEmail(brokerInput, deps);

    expect(res.status).toBe('drafted');
    expect(res.demoToken).toBeTruthy();
    expect(res.outreachEmailId).toBeTruthy();
    expect(res.inboundProspectId).toBeTruthy();

    // Enrich + provision happened once.
    expect(enrich).toHaveBeenCalledWith('acme-freight.com');
    expect(demoStore.rows).toHaveLength(1);

    // Draft called in warm-reply mode with the inbound subject as context.
    expect(classify).toHaveBeenCalledTimes(1);
    expect(draft).toHaveBeenCalledTimes(1);
    const draftOpts = draft.mock.calls[0][2];
    expect(draftOpts.mode).toBe('warm-reply');
    expect(draftOpts.inboundContext.subject).toBe('Partner with Acme Freight');
    expect(draftOpts.inboundContext.senderName).toBe('Sam Rivera');

    // A draft row was persisted, addressed back to the inbound sender.
    expect(emailStore.rows).toHaveLength(1);
    expect(emailStore.rows[0].recipientEmail).toBe('sam@acme-freight.com');

    // The inbound_prospects row carries the threading fields + linkage.
    expect(inboundStore.rows).toHaveLength(1);
    const row = inboundStore.rows[0];
    expect(row.status).toBe('drafted');
    expect(row.originalMessageId).toBe('<abc-123@acme-freight.com>');
    expect(row.originalReferences).toEqual(['<root@acme-freight.com>']);
    expect(row.originalSubject).toBe('Partner with Acme Freight');
    expect(row.fromDomain).toBe('acme-freight.com');
    expect(row.demoToken).toBe(res.demoToken);
    expect(row.outreachEmailId).toBe(res.outreachEmailId);
  });

  it('classifier says not-worth → classified_noise, no draft, no demo', async () => {
    const { deps, classify, enrich, draft, demoStore, emailStore, inboundStore } = baseDeps({
      classify: vi.fn(async () => notWorth),
    });

    const res = await handleHarvestedEmail(brokerInput, deps);

    expect(res.status).toBe('skipped_noise');
    expect(classify).toHaveBeenCalledTimes(1);
    expect(enrich).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
    expect(demoStore.rows).toHaveLength(0);
    expect(emailStore.rows).toHaveLength(0);
    expect(inboundStore.rows).toHaveLength(1);
    expect(inboundStore.rows[0].status).toBe('classified_noise');
    expect(inboundStore.rows[0].classifyCategory).toBe('shipper_rfq');
  });

  it('freemail sender → skipped_freemail, no draft', async () => {
    const { deps, enrich, draft, demoStore, emailStore, inboundStore } = baseDeps();

    const res = await handleHarvestedEmail(
      { ...brokerInput, fromEmail: 'someone@gmail.com', messageId: '<x@gmail.com>' },
      deps,
    );

    expect(res.status).toBe('skipped_freemail');
    expect(enrich).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
    expect(demoStore.rows).toHaveLength(0);
    expect(emailStore.rows).toHaveLength(0);
    expect(inboundStore.rows).toHaveLength(1);
    expect(inboundStore.rows[0].status).toBe('skipped');
    expect(inboundStore.rows[0].fromDomain).toBe('gmail.com');
  });

  it('duplicate Message-ID → duplicate, draft NOT called again', async () => {
    const seeded = makeInboundStore();
    // Pre-seed a row for this Message-ID (as if already harvested).
    await seeded.upsert({
      harvestMailbox: brokerInput.harvestMailbox,
      fromEmail: brokerInput.fromEmail,
      fromDomain: 'acme-freight.com',
      originalMessageId: brokerInput.messageId,
      status: 'drafted',
      demoToken: 'tok_seed',
      outreachEmailId: 99,
    });
    const { deps, classify, draft } = baseDeps({ inboundStore: seeded });

    const res = await handleHarvestedEmail(brokerInput, deps);

    expect(res.status).toBe('duplicate');
    expect(res.demoToken).toBe('tok_seed');
    expect(res.outreachEmailId).toBe(99);
    expect(classify).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
    // No new row inserted.
    expect(seeded.rows).toHaveLength(1);
  });

  it('existing demo for the domain → reuse it, no re-enrich', async () => {
    const existingDemo = {
      id: 7,
      token: 'tok_existing',
      domain: 'acme-freight.com',
      companyName: 'Acme Freight',
      profileJson: makeProfile('acme-freight.com') as unknown as Record<string, unknown>,
      brandJson: null,
      configJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      viewedAt: null,
      quoteShotB64: null,
      quoteShotAt: null,
    } as ProspectDemo;
    const demoStore = makeDemoStore(existingDemo);
    const { deps, enrich, draft } = baseDeps({ demoStore });

    const res = await handleHarvestedEmail(brokerInput, deps);

    expect(res.status).toBe('drafted');
    expect(res.demoToken).toBe('tok_existing');
    expect(enrich).not.toHaveBeenCalled();
    expect(demoStore.upsertCalls).toBe(0);
    // Draft still ran against the reused demo's URL.
    expect(draft).toHaveBeenCalledTimes(1);
    expect(draft.mock.calls[0][1]).toBe('https://qf.test/demo/tok_existing');
  });
});
