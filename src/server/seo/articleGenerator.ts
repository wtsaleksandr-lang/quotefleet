/**
 * articleGenerator — turns one carrier-census cut into a single data-backed
 * article and files it into the human-review queue as an in_review draft.
 *
 * ─── THE THREE HARD GUARANTEES (all carried over from the source engine) ──
 *   1. ANTI-THIN. Generation happens only when real data backs the page. If
 *      CarrierDataService returns { sufficient:false } (below the minimum-
 *      sample floor) nothing is generated and nothing is written — we return
 *      { skipped:true, reason:'insufficient_data' }.
 *   2. NEVER AUTO-PUBLISH. The draft is written with status='in_review'. The
 *      store's createSeoContentDraft independently refuses 'published'.
 *      Publication is a separate, explicit human action in the review screen.
 *   3. FORCED CITATION. The prompt hands the model the real numbers and forbids
 *      inventing any others; if the model drops them anyway, the real data
 *      block is appended before the draft is stored. A published page ALWAYS
 *      carries its provenance — the numbers are ours, not the model's.
 *
 * ─── INERT BY DEFAULT, TWICE ──────────────────────────────────────────────
 * Behind checkSeoEngineGate() (SEO_ENGINE_ENABLED env + DB kill-switch, fails
 * closed) AND behind externalPullGuard's `anthropic_seo` slot, which is
 * default-deny and cannot be opened by env inside a test runner. Flag off →
 * { skipped:true, reason:'engine_disabled' }, no generation, no AI spend. Guard
 * shut → { skipped:true, reason:'llm_spend_blocked' }, no API call is made.
 * Ships dark: both are OFF in every config today.
 */

import { Models, complete } from '../../ai/client.js';
import {
  livePullsAllowed,
  reportProviderCost,
  type GuardDecision,
} from '../directory/externalPullGuard.js';
import {
  computeUniqueDataScore,
  cutLabel,
  getCarrierDataForCut,
  type CarrierCut,
  type CarrierDataResult,
  type SufficientCarrierData,
} from './carrierDataService.js';
import {
  assertSeedCells,
  cellKeyword,
  cellSlug,
  displayCity,
  DEFAULT_BATCH_LIMIT,
  MAX_BATCH_CELLS,
  MIN_UNIQUE_DATA_SCORE,
} from './seedMatrix.js';
import type { SeoGateResult } from './seoEngineGate.js';
import type { NewSeoContentPage, SeoContentPage } from '../../db/schema.js';

export const DEFAULT_AUTHOR_ENTITY = 'QuoteFleet Research';

/* ─── Public request / result types ───────────────────────────────────── */

export interface SeoArticleRequest {
  cut: CarrierCut;
  /** Optional author entity override. */
  authorEntity?: string;
}

export type SeoArticleSkipReason =
  | 'engine_disabled'
  | 'llm_spend_blocked'
  | 'insufficient_data'
  | 'duplicate_slug'
  | 'generation_failed';

export interface SeoArticleSkipped {
  ok: false;
  skipped: true;
  reason: SeoArticleSkipReason;
  detail?: string;
  sampleSize?: number;
}

export interface SeoArticleGenerated {
  ok: true;
  skipped: false;
  /** The in_review draft row that was created. */
  draft: SeoContentPage;
  uniqueDataScore: number;
}

export type SeoArticleResult = SeoArticleGenerated | SeoArticleSkipped;

/* ─── Injectable dependencies ─────────────────────────────────────────────
   So the unit test drives the whole generator with no DB, no API key, and no
   spend. Production defaults wire the real gate + data service + AI + store. */

export interface SeoGeneratorStore {
  createSeoContentDraft: (data: NewSeoContentPage) => Promise<SeoContentPage>;
  appendSeoApproval: (data: {
    pageId: number;
    actorType: string;
    actorId?: number | null;
    action: string;
    notes?: string | null;
    metadata?: unknown;
  }) => Promise<unknown>;
  seoSlugExists: (slug: string) => Promise<boolean>;
}

export type SeoAiTextFn = (input: {
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<{ text: string }>;

export interface SeoArticleDeps {
  /** Gate decision (default: live checkSeoEngineGate). */
  checkGate?: () => Promise<SeoGateResult>;
  /** Cost-guard decision for the LLM call (default: the real guard). */
  checkSpend?: () => GuardDecision;
  /** Carrier-census lookup (default: the real, cached, DB-backed service). */
  getCarrierData?: (cut: CarrierCut) => Promise<CarrierDataResult>;
  /** AI text generation (default: the project Anthropic wrapper). */
  generateText?: SeoAiTextFn;
  /** Persistence (default: the real store helpers). */
  store?: SeoGeneratorStore;
}

/* ─── Production defaults (lazily imported so the unit test stays DB-free) ── */

const defaultStore: SeoGeneratorStore = {
  async createSeoContentDraft(data) {
    const { createSeoContentDraft } = await import('./store.js');
    return createSeoContentDraft(data);
  },
  async appendSeoApproval(data) {
    const { appendSeoApproval } = await import('./store.js');
    return appendSeoApproval({
      pageId: data.pageId,
      actorType: data.actorType,
      actorId: data.actorId ?? null,
      action: data.action,
      notes: data.notes ?? null,
      metadata: (data.metadata as Record<string, unknown> | null) ?? null,
    });
  },
  async seoSlugExists(slug) {
    const { seoSlugExists } = await import('./store.js');
    return seoSlugExists(slug);
  },
};

const defaultGenerateText: SeoAiTextFn = async (input) => {
  // Platform key (tenantId null) — this is QuoteFleet's own content, not a
  // tenant's, so it must never bill a tenant's key.
  const out = await complete({
    tenantId: null,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
    maxTokens: input.maxTokens ?? 2400,
    model: Models.escalate,
    // Off the request path (admin-triggered batch), and a full article on the
    // escalate model runs well past the shared 30s default — which is there to
    // protect Express handlers, of which this is not one.
    timeoutMs: 180_000,
  });
  return { text: out.text };
};

/* ─── Pure helpers (exported for the unit test) ───────────────────────── */

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** "1 truck" / "3 trucks". A median fleet of 1 is the COMMON case in this
 *  corpus (72% of Houston carriers are owner-operators), so the singular is not
 *  an edge case — it is what most city guides will say. */
function trucks(n: number): string {
  return `${num(n)} ${n === 1 ? 'truck' : 'trucks'}`;
}

/**
 * The data-citation block, in markdown. Woven into the prompt AND appended as a
 * safety net if the model drops the numbers — so the real figures are on the
 * page either way. This is the single place the citable facts are phrased.
 */
export function buildDataCitation(data: SufficientCarrierData): string {
  const where = cutLabel(data.cut);
  const lines: string[] = [
    `Across **${num(data.totalInCut)} carriers** registered in ${where} in the FMCSA census (QuoteFleet carrier directory, updated ${data.computedAt.slice(0, 10)}), the median fleet is **${trucks(data.median)}**. The middle half of carriers run between **${num(data.p25)}** and **${num(data.p75)}** trucks, and the largest operator reports **${num(data.max)}**. Together they field **${trucks(data.totalPowerUnits)}**.`,
    `${pct(data.ownerOperatorShare)} of them are owner-operators running one or two trucks; ${pct(data.largeFleetShare)} run fleets of 50 or more.`,
  ];
  if (data.equipmentMix.length > 0) {
    const mix = data.equipmentMix
      .slice(0, 5)
      .map((e) => `${e.label} — ${num(e.count)} carriers (${pct(e.share)})`)
      .join('; ');
    lines.push(`Equipment mix: ${mix}.`);
  }
  if (data.variations.length > 0) {
    const v = data.variations
      .slice(0, 6)
      .map((x) => `${displayCity(x.label)} (${num(x.sampleSize)} carriers, median ${trucks(x.medianFleet)})`)
      .join('; ');
    lines.push(`Where they are based: ${v}.`);
  }
  if (data.safety) {
    lines.push(
      `${num(data.safety.rated)} carriers in this group carry an FMCSA safety rating: ${num(data.safety.satisfactory)} Satisfactory, ${num(data.safety.conditional)} Conditional. The rest are unrated, which is normal — FMCSA only rates a carrier after a compliance review.`,
    );
  }
  if (data.topPort) {
    lines.push(
      `The most common nearest port for this group is **${data.topPort.code}** (${num(data.topPort.count)} carriers).`,
    );
  }
  return lines.join('\n\n');
}

function buildSystemPrompt(authorEntity: string): string {
  return [
    `You are a freight-industry analyst writing for QuoteFleet, published on quotefleet.net under the real author entity "${authorEntity}".`,
    'Your readers are shippers, freight brokers and freight forwarders deciding who to move freight with.',
    'Write genuinely useful, accurate, E-E-A-T-rich analysis grounded in the FMCSA carrier census.',
    'HARD RULES:',
    '- Use ONLY the real figures in the DATA BLOCK. NEVER invent, extrapolate, round or estimate any number that is not given to you.',
    '- Never invent rates, prices, lane costs or company names — you have carrier-population data, NOT pricing data. If a rate would be useful, point the reader at the QuoteFleet rate calculator instead of guessing.',
    '- Cite the provenance naturally (e.g. "across 3,501 carriers registered in Houston in the FMCSA census").',
    '- Explain what the numbers MEAN for a shipper: what a median fleet size implies about capacity and flexibility, what a high owner-operator share implies about rates and reliability.',
    '- Structure: a single H1, intent-matched H2s, and an FAQ section. Be specific; no filler, no hype, no padding.',
    'Return ONLY the article body as Markdown (start with the H1). No preamble, no code fences.',
  ].join('\n');
}

export function buildUserPrompt(req: SeoArticleRequest, data: SufficientCarrierData): string {
  const keyword = cellKeyword(req.cut);
  return [
    `Primary keyword: "${keyword}"`,
    `Market: ${cutLabel(req.cut)}.`,
    '',
    'REAL DATA BLOCK (use these numbers verbatim; do not alter them; do not add others):',
    buildDataCitation(data),
    '',
    'STRUCTURE:',
    `- H1 = "${keyword}" (title case).`,
    '- An intro that answers the query in the first two sentences using the carrier count and the median fleet size.',
    '- An H2 on the shape of this carrier market: fleet-size distribution and what it means for available capacity.',
    '- An H2 on equipment availability, using the real equipment mix.',
    '- An H2 on how to vet a carrier here (authority, safety rating, insurance) — practical and specific.',
    '- A short H2 pointing readers to the relevant QuoteFleet tools.',
    "- An FAQ section (H2 'Frequently Asked Questions') with 3-4 Q&As answered from the data.",
    '',
    'INTERNAL LINKS (include these markdown links in the body):',
    `- Carrier directory: [browse these carriers](${directoryLinkFor(req.cut)})`,
    '- Rate calculator: [free freight rate calculator](/tools)',
    '- Compliance tools: [carrier compliance lookup](/compliance)',
    '- Guides hub: [more freight guides](/guides)',
  ].join('\n');
}

/** Deep-link into the existing directory for the cut, so every guide feeds the
 *  programmatic pages it describes (the editorial → programmatic link path is
 *  the entire point of building this surface). */
export function directoryLinkFor(cut: CarrierCut): string {
  return cut.kind === 'city'
    ? `/directory?state=${encodeURIComponent(cut.state)}&city=${encodeURIComponent(displayCity(cut.city))}`
    : `/directory?state=${encodeURIComponent(cut.state)}&equipment=${encodeURIComponent(cut.equipment)}`;
}

export function buildTitle(cut: CarrierCut, data: SufficientCarrierData): string {
  const kw = cellKeyword(cut);
  const cap = kw.charAt(0).toUpperCase() + kw.slice(1);
  const withCount = `${cap} — ${num(data.totalInCut)} Carriers Compared`;
  return withCount.length <= 65 ? withCount : cap;
}

export function buildMetaDescription(cut: CarrierCut, data: SufficientCarrierData): string {
  return `${num(data.totalInCut)} carriers registered in ${cutLabel(cut)}, from the FMCSA census: median fleet ${trucks(data.median)}, ${pct(data.ownerOperatorShare)} owner-operators, and what that means for capacity.`.slice(
    0,
    158,
  );
}

export function buildExcerpt(cut: CarrierCut, data: SufficientCarrierData): string {
  return `Real carrier-population data for ${cutLabel(cut)}: ${num(data.totalInCut)} carriers, ${trucks(data.totalPowerUnits)}, median fleet ${num(data.median)}.`;
}

/* ─── Main entry point ────────────────────────────────────────────────── */

/**
 * Generate ONE article and file it as an in_review draft. Returns
 * { skipped:true } (with a reason) when the engine is off, the spend guard is
 * shut, the data floor is not met, the slug already exists, or generation
 * fails. NEVER publishes.
 */
export async function generateSeoArticle(
  req: SeoArticleRequest,
  deps: SeoArticleDeps = {},
): Promise<SeoArticleResult> {
  const checkGate =
    deps.checkGate ??
    (async () => {
      const { checkSeoEngineGate } = await import('./seoEngineGate.js');
      return checkSeoEngineGate();
    });
  const checkSpend = deps.checkSpend ?? (() => livePullsAllowed('anthropic_seo'));
  const getCarrierData = deps.getCarrierData ?? ((cut: CarrierCut) => getCarrierDataForCut(cut));
  const generateText = deps.generateText ?? defaultGenerateText;
  const store = deps.store ?? defaultStore;
  const authorEntity = req.authorEntity ?? DEFAULT_AUTHOR_ENTITY;

  // ── 1. Inert-by-default gate. No generation when the engine is off. ──
  const gate = await checkGate();
  if (!gate.allowed) {
    return { ok: false, skipped: true, reason: 'engine_disabled', detail: gate.reason };
  }

  // ── 2. Cost guard. Never reach for a paid API without an explicit opt-in. ──
  const spend = checkSpend();
  if (!spend.allowed) {
    return { ok: false, skipped: true, reason: 'llm_spend_blocked', detail: spend.reason };
  }

  // ── 3. Slug dedup — don't regenerate an existing page. ──
  const slug = cellSlug(req.cut);
  if (await store.seoSlugExists(slug)) {
    return { ok: false, skipped: true, reason: 'duplicate_slug', detail: slug };
  }

  // ── 4. THE ANTI-THIN DATA GATE. Generate ONLY when real data backs it. ──
  const data = await getCarrierData(req.cut);
  if (!data.sufficient) {
    console.log(
      `[seo] skipped ${slug} — below data floor (${data.sampleSize} < ${data.minSample}), anti-thin`,
    );
    return { ok: false, skipped: true, reason: 'insufficient_data', sampleSize: data.sampleSize };
  }

  const uniqueDataScore = computeUniqueDataScore(data);

  // ── 5. Generate the body. ──
  let body: string;
  try {
    const out = await generateText({
      system: buildSystemPrompt(authorEntity),
      user: buildUserPrompt(req, data),
      maxTokens: 2400,
    });
    body = (out.text ?? '').trim();
  } catch (err) {
    console.error(`[seo] AI generation failed for ${slug}:`, (err as Error)?.message);
    return { ok: false, skipped: true, reason: 'generation_failed', detail: (err as Error)?.message };
  }
  // Ledger the spend so it shows up in the admin external-spend view alongside
  // every other paid provider. Credits are nominal; the point is the audit row.
  reportProviderCost('anthropic_seo', 1, null);

  if (!body || body.length < 400) {
    return { ok: false, skipped: true, reason: 'generation_failed', detail: 'empty or too-short body' };
  }

  // Safety net: if the model dropped the citation, append the real data block so
  // the page ALWAYS carries its provenance. The numbers are ours, not the model's.
  if (!body.includes(num(data.totalInCut)) && !body.includes(String(data.totalInCut))) {
    body = `${body}\n\n## The data behind these numbers\n\n${buildDataCitation(data)}`;
  }

  // ── 6. Persist as an in_review DRAFT (NEVER published). ──
  const draft = await store.createSeoContentDraft({
    slug,
    title: buildTitle(req.cut, data),
    metaDescription: buildMetaDescription(req.cut, data),
    excerpt: buildExcerpt(req.cut, data),
    content: body,
    status: 'in_review', // the human-review gate — NEVER 'published' here.
    jsonldType: 'Article',
    authorEntity,
    canonical: null, // self-canonical resolved at render.
    originalData: {
      // The cited aggregates + provenance, frozen onto the draft so a reviewer
      // can audit every number on the page against what the corpus actually said.
      cut: data.cut,
      sampleSize: data.sampleSize,
      totalInCut: data.totalInCut,
      min: data.min,
      p25: data.p25,
      median: data.median,
      p75: data.p75,
      max: data.max,
      totalPowerUnits: data.totalPowerUnits,
      ownerOperatorShare: data.ownerOperatorShare,
      largeFleetShare: data.largeFleetShare,
      equipmentMix: data.equipmentMix,
      variations: data.variations,
      safety: data.safety,
      topPort: data.topPort,
      computedAt: data.computedAt,
      source: 'fmcsa_carrier_census',
    },
    uniqueDataScore,
  });

  // The generator hands the page to the human-review queue (actor = system).
  await store.appendSeoApproval({
    pageId: draft.id,
    actorType: 'system',
    actorId: null,
    action: 'submitted',
    notes: `auto-generated for "${cellKeyword(req.cut)}" (sampleSize=${data.sampleSize}, uniqueDataScore=${uniqueDataScore})`,
    metadata: { slug, cut: req.cut },
  });

  console.log(
    `[seo] draft created for review: ${slug} (status=${draft.status}, score=${uniqueDataScore}, n=${data.sampleSize})`,
  );

  return { ok: true, skipped: false, draft, uniqueDataScore };
}

/* ─── Batch over the seed matrix ──────────────────────────────────────── */

export interface MatrixBatchResult {
  attempted: number;
  generated: number;
  skipped: Array<{ slug: string; reason: SeoArticleSkipReason; detail?: string }>;
  belowScoreFloor: string[];
}

/**
 * Run the seed matrix, at most `limit` cells. Asserts the matrix against the
 * live corpus FIRST (throws loudly on a stale cell — see seedMatrix.ts), so a
 * misconfigured matrix can never masquerade as an empty one.
 */
export async function generateMatrixBatch(
  cells: readonly CarrierCut[],
  limit = DEFAULT_BATCH_LIMIT,
  deps: SeoArticleDeps = {},
): Promise<MatrixBatchResult> {
  await assertSeedCells(cells);

  const capped = Math.max(1, Math.min(limit, MAX_BATCH_CELLS));
  const result: MatrixBatchResult = { attempted: 0, generated: 0, skipped: [], belowScoreFloor: [] };

  for (const cut of cells.slice(0, capped)) {
    result.attempted++;
    const slug = cellSlug(cut);
    const out = await generateSeoArticle({ cut }, deps);
    if (!out.ok) {
      // Never a silent skip — every skipped cell is reported with its reason.
      result.skipped.push({ slug, reason: out.reason, detail: out.detail });
      continue;
    }
    if (out.uniqueDataScore < MIN_UNIQUE_DATA_SCORE) {
      // The draft exists but is flagged: its data is not meaningfully distinct
      // from a sibling's. It stays in_review (never auto-published), and the
      // reviewer sees the flag.
      result.belowScoreFloor.push(slug);
    }
    result.generated++;
  }
  return result;
}

