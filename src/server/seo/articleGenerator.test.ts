/**
 * The generator's three hard guarantees, plus the two default-OFF gates.
 *
 * What must be true no matter what:
 *   • It NEVER writes status='published'. Publication is a human action.
 *   • It NEVER generates from a below-floor cut.
 *   • It NEVER calls a paid API without both gates open.
 *   • The published body ALWAYS carries the real numbers, even if the model
 *     ignores the instruction to cite them.
 *
 * Every dependency is injected, so nothing here touches a database, an API key
 * or a socket. `generateText` is a spy: if the guards leak, it gets called, and
 * these tests fail on that fact directly rather than on a downstream symptom.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildDataCitation,
  buildMetaDescription,
  buildTitle,
  buildUserPrompt,
  directoryLinkFor,
  generateSeoArticle,
  type SeoArticleDeps,
  type SeoGeneratorStore,
} from './articleGenerator.js';
import { buildCarrierData, type CarrierCut, type CarrierCutStats, type SufficientCarrierData } from './carrierDataService.js';

const CUT: CarrierCut = { kind: 'city', state: 'TX', city: 'HOUSTON' };

function rawStats(over: Partial<CarrierCutStats> = {}): CarrierCutStats {
  return {
    totalInCut: 3501,
    pricedCount: 3480,
    min: 1,
    p25: 1,
    median: 3,
    p75: 9,
    max: 1200,
    totalPowerUnits: 41000,
    ownerOperators: 1740,
    largeFleets: 210,
    flagCounts: { reefer: 700, flatbed: 900 },
    rated: 300,
    satisfactory: 260,
    conditional: 40,
    topPort: { code: 'USHOU', count: 3100 },
    variations: [],
    ...over,
  };
}

function sufficient(over: Partial<CarrierCutStats> = {}): SufficientCarrierData {
  return buildCarrierData(rawStats(over), CUT, 25) as SufficientCarrierData;
}

function fakeStore(): SeoGeneratorStore & { created: unknown[]; approvals: unknown[] } {
  const created: unknown[] = [];
  const approvals: unknown[] = [];
  return {
    created,
    approvals,
    async createSeoContentDraft(data) {
      if (data.status === 'published') {
        throw new Error('store refuses published');
      }
      created.push(data);
      return { id: 1, ...data } as never;
    },
    async appendSeoApproval(data) {
      approvals.push(data);
      return data;
    },
    async seoSlugExists() {
      return false;
    },
  };
}

function deps(over: Partial<SeoArticleDeps> = {}): SeoArticleDeps {
  return {
    checkGate: async () => ({ allowed: true }),
    checkSpend: () => ({ allowed: true, reason: 'test-opt-in' }),
    getCarrierData: async () => sufficient(),
    generateText: async () => ({
      text: '# Trucking Companies in Houston, TX\n\nThere are 3,501 carriers here and the median fleet is 3 trucks. '.repeat(
        8,
      ),
    }),
    store: fakeStore(),
    ...over,
  };
}

describe('gate 1 — the engine ships dark', () => {
  it('skips and spends nothing when the engine is disabled', async () => {
    const generateText = vi.fn();
    const out = await generateSeoArticle(
      { cut: CUT },
      deps({ checkGate: async () => ({ allowed: false, reason: 'flag unset' }), generateText }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('engine_disabled');
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('gate 2 — the cost guard', () => {
  it('skips before the API call when LLM spend is blocked', async () => {
    const generateText = vi.fn();
    const out = await generateSeoArticle(
      { cut: CUT },
      deps({ checkSpend: () => ({ allowed: false, reason: 'test runner' }), generateText }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('llm_spend_blocked');
    // The point of the guard: no call is attempted, so no money can be spent.
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe('anti-thin', () => {
  it('never generates from a below-floor cut', async () => {
    const generateText = vi.fn();
    const store = fakeStore();
    const out = await generateSeoArticle(
      { cut: CUT },
      deps({
        getCarrierData: async () => ({ sufficient: false, sampleSize: 4, minSample: 25, cut: CUT }),
        generateText,
        store,
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('insufficient_data');
    expect(out.sampleSize).toBe(4);
    expect(generateText).not.toHaveBeenCalled();
    expect(store.created).toHaveLength(0); // nothing written either
  });

  it('skips a slug that already exists instead of colliding', async () => {
    const store = fakeStore();
    store.seoSlugExists = async () => true;
    const out = await generateSeoArticle({ cut: CUT }, deps({ store }));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('duplicate_slug');
  });
});

describe('never auto-publishes', () => {
  it('writes the draft as in_review and files a submitted audit row', async () => {
    const store = fakeStore();
    const out = await generateSeoArticle({ cut: CUT }, deps({ store }));
    expect(out.ok).toBe(true);
    const draft = store.created[0] as { status: string; surface?: string };
    expect(draft.status).toBe('in_review');
    expect(store.created.every((d) => (d as { status: string }).status !== 'published')).toBe(true);
    expect((store.approvals[0] as { action: string }).action).toBe('submitted');
    expect((store.approvals[0] as { actorType: string }).actorType).toBe('system');
  });

  it('freezes the cited aggregate onto the draft for the reviewer to audit', async () => {
    const store = fakeStore();
    await generateSeoArticle({ cut: CUT }, deps({ store }));
    const draft = store.created[0] as { originalData: Record<string, unknown> };
    expect(draft.originalData.totalInCut).toBe(3501);
    expect(draft.originalData.median).toBe(3);
    expect(draft.originalData.source).toBe('fmcsa_carrier_census');
  });
});

describe('forced citation', () => {
  it('appends the real data block when the model drops the numbers', async () => {
    const store = fakeStore();
    const out = await generateSeoArticle(
      { cut: CUT },
      deps({
        // A plausible-sounding article that cites nothing real — the exact
        // failure mode that would put an un-attributed claim on our domain.
        generateText: async () => ({
          text: '# Trucking Companies in Houston\n\nHouston is a major freight hub with many carriers to choose from. '.repeat(
            8,
          ),
        }),
        store,
      }),
    );
    expect(out.ok).toBe(true);
    const draft = store.created[0] as { content: string };
    expect(draft.content).toContain('The data behind these numbers');
    expect(draft.content).toContain('3,501');
  });

  it('leaves a compliant body alone', async () => {
    const store = fakeStore();
    await generateSeoArticle({ cut: CUT }, deps({ store }));
    const draft = store.created[0] as { content: string };
    expect(draft.content).not.toContain('The data behind these numbers');
  });

  it('rejects an empty or stub body rather than storing it', async () => {
    const out = await generateSeoArticle({ cut: CUT }, deps({ generateText: async () => ({ text: 'Too short.' }) }));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('generation_failed');
  });

  it('degrades cleanly when the API throws', async () => {
    const out = await generateSeoArticle(
      { cut: CUT },
      deps({
        generateText: async () => {
          throw new Error('429 rate limited');
        },
      }),
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.reason).toBe('generation_failed');
    expect(out.detail).toContain('429');
  });
});

describe('the prompt carries only real numbers', () => {
  it('hands the model the actual aggregates and forbids inventing others', () => {
    const prompt = buildUserPrompt({ cut: CUT }, sufficient());
    expect(prompt).toContain('3,501 carriers');
    expect(prompt).toContain('do not alter them');
    expect(prompt).toContain('the median fleet is **3 trucks**');
    // The instruction that keeps invented figures off our domain.
    expect(prompt).toContain('do not add others');
  });

  it('says "1 truck", not "1 trucks" — the median fleet IS 1 in most city cuts', () => {
    // 72% of Houston's real carriers are owner-operators and its true median is
    // 1, so the singular is the COMMON rendering here, not an edge case.
    const cite = buildDataCitation(sufficient({ median: 1 }));
    expect(cite).toContain('**1 truck**');
    expect(cite).not.toContain('1 trucks');
  });

  it('never shouts the stored UPPERCASE city at the reader', () => {
    // carrier_directory holds 'HOUSTON'; a meta description reading
    // "registered in HOUSTON, TX" would ship that straight to the SERP.
    const meta = buildMetaDescription(CUT, sufficient());
    expect(meta).toContain('Houston, TX');
    expect(meta).not.toContain('HOUSTON');
    expect(buildDataCitation(sufficient())).not.toContain('HOUSTON');
  });

  it('cites provenance and the computed date', () => {
    const cite = buildDataCitation(sufficient());
    expect(cite).toContain('FMCSA census');
    expect(cite).toMatch(/updated \d{4}-\d{2}-\d{2}/);
  });

  it('never fabricates rate data — it points at the calculator instead', () => {
    const prompt = buildUserPrompt({ cut: CUT }, sufficient());
    expect(prompt).toContain('/tools');
  });

  it('deep-links each guide back into the directory it describes', () => {
    expect(directoryLinkFor(CUT)).toContain('state=TX');
    expect(directoryLinkFor(CUT)).toContain('city=Houston');
    expect(directoryLinkFor({ kind: 'state_equipment', state: 'CA', equipment: 'reefer' })).toContain(
      'equipment=reefer',
    );
  });
});

describe('metadata', () => {
  it('keeps the title inside a sane SERP length', () => {
    expect(buildTitle(CUT, sufficient()).length).toBeLessThanOrEqual(65);
  });

  it('keeps the meta description inside the SERP snippet limit', () => {
    expect(buildMetaDescription(CUT, sufficient()).length).toBeLessThanOrEqual(158);
  });
});
