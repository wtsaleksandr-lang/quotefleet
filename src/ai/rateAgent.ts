/**
 * Rate-adjustment AI agent. The carrier's tenant-owner chats in plain
 * English ("raise drayage from LAX by 10% and add a $50 chassis fee").
 * The agent has tools to update rate cards, accessorials, and zones.
 *
 * CONFIRM-BEFORE-APPLY (audit H1). The AI never writes live pricing on its
 * own. When the model calls a MUTATION tool the agent does NOT touch the DB —
 * it validates the input against the RATE-C1 bounds, reads the current row for
 * a before→after diff, and returns a STRUCTURED PROPOSAL (nothing persisted).
 * The proposal is saved as a `conversations` row with status `pending`; the UI
 * renders it as a diff card with Apply / Discard. Only when the owner clicks
 * Apply does POST /api/ai/rate-proposals/:id/apply call `applyRateMutation`,
 * which RE-VALIDATES the stored input server-side (never trusts client numbers)
 * and then writes + audit-logs. This prevents a single semantic mis-map (e.g.
 * the model reading "$600 minimum" as ratePerMile=600) from silently wrecking a
 * tenant's live rates — the human sees exactly what changes first.
 *
 * READ tools (list_*) still run inline — they have no side effects.
 */
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  tenants,
  rateCards,
  accessorials,
  laneZones,
  aiConfigs,
  auditLog,
  conversations,
  type Tenant,
} from '../db/schema.js';
import { complete, type ChatToolDef } from './client.js';
import { rateAdjusterSystemPrompt } from './prompts.js';

// ─── Tool input validation ────────────────────────────────────────────
// LLMs hallucinate. Without strict bounds on tool args a model could
// (and occasionally will) write nonsense like ratePerMile=-50, kind="evil",
// fuelSurchargePct=999. These schemas reject before the DB write — the
// tool result returned to the model includes the validation error so the
// model can apologize / retry with a sane number.
const reasonField = z.string().min(1).max(500);
const moneyField = z.number().finite().min(0).max(100_000); // $/mile or USD
const pctField = z.number().finite().min(0).max(500);       // 0–500% (markup, fuel)
const weightField = z.number().finite().min(0).max(200_000);
const milesField = z.number().finite().min(0).max(20_000);
const idField = z.number().int().positive();

const ToolSchemas = {
  list_rate_cards: z.object({}).strict().passthrough(),
  list_accessorials: z.object({}).strict().passthrough(),
  list_lane_zones: z.object({}).strict().passthrough(),
  update_rate_card: z.object({
    id: idField,
    reason: reasonField,
    ratePerMile: moneyField.optional(),
    minimumCharge: moneyField.optional(),
    flatFee: moneyField.optional(),
    fuelSurchargePct: pctField.optional(),
    marginPct: pctField.optional(),
    maxWeightLbs: weightField.optional(),
    maxMiles: milesField.optional(),
    enabled: z.boolean().optional(),
    label: z.string().max(160).optional(),
    notes: z.string().max(2000).optional(),
  }).passthrough(),
  create_accessorial: z.object({
    code: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, 'Lowercase letters, digits, underscore.'),
    label: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    kind: z.enum(['flat', 'per_mile', 'pct_of_base', 'per_day', 'per_hour']),
    amount: z.number().finite().min(0).max(100_000),
    trigger: z.enum([
      'optional',
      'auto',
      'auto_if_residential',
      'auto_if_hazmat',
      'auto_if_temp_controlled',
      'auto_if_weight_over',
    ]),
    appliesToServices: z.array(z.string().max(40)).max(10).optional(),
    reason: reasonField,
  }).passthrough(),
  update_accessorial: z.object({
    id: idField,
    reason: reasonField,
    amount: z.number().finite().min(0).max(100_000).optional(),
    kind: z.enum(['flat', 'per_mile', 'pct_of_base', 'per_day', 'per_hour']).optional(),
    trigger: z.enum([
      'optional',
      'auto',
      'auto_if_residential',
      'auto_if_hazmat',
      'auto_if_temp_controlled',
      'auto_if_weight_over',
    ]).optional(),
    enabled: z.boolean().optional(),
    label: z.string().max(120).optional(),
    description: z.string().max(500).optional(),
  }).passthrough(),
  update_lane_zone: z.object({
    id: idField,
    reason: reasonField,
    flatPrice: moneyField.optional(),
    radiusMiles: milesField.optional(),
    enabled: z.boolean().optional(),
  }).passthrough(),
} as const;

function validateToolInput(name: string, input: Record<string, unknown>):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string } {
  const schema = (ToolSchemas as Record<string, z.ZodTypeAny | undefined>)[name];
  if (!schema) return { ok: true, data: input };
  const r = schema.safeParse(input);
  if (r.success) return { ok: true, data: r.data as Record<string, unknown> };
  const issues = r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    .join('; ');
  return { ok: false, message: `Invalid arguments for ${name} — ${issues}. Re-call the tool with corrected values.` };
}

const TOOLS: ChatToolDef[] = [
  {
    name: 'list_rate_cards',
    description:
      'Read all rate cards for the current tenant. Use this BEFORE making changes to know current values.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_accessorials',
    description: 'Read all accessorials for the current tenant.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_lane_zones',
    description: 'Read all drayage lane zones (port → radius tariffs).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'update_rate_card',
    description:
      'Update fields on an existing rate card. Pass only the fields you want to change. Always include a brief reason.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        ratePerMile: { type: 'number' },
        minimumCharge: { type: 'number' },
        flatFee: { type: 'number' },
        fuelSurchargePct: { type: 'number' },
        marginPct: { type: 'number' },
        maxWeightLbs: { type: 'number' },
        maxMiles: { type: 'number' },
        enabled: { type: 'boolean' },
        label: { type: 'string' },
        notes: { type: 'string' },
        reason: {
          type: 'string',
          description: 'One-line reason for the change (audit log).',
        },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'create_accessorial',
    description: 'Add a new accessorial.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        label: { type: 'string' },
        description: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['flat', 'per_mile', 'pct_of_base', 'per_day', 'per_hour'],
        },
        amount: { type: 'number' },
        trigger: {
          type: 'string',
          enum: [
            'optional',
            'auto',
            'auto_if_residential',
            'auto_if_hazmat',
            'auto_if_temp_controlled',
            'auto_if_weight_over',
          ],
        },
        appliesToServices: {
          type: 'array',
          items: { type: 'string' },
        },
        reason: { type: 'string' },
      },
      required: ['code', 'label', 'kind', 'amount', 'trigger', 'reason'],
    },
  },
  {
    name: 'update_accessorial',
    description: 'Update fields on an existing accessorial.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        amount: { type: 'number' },
        kind: { type: 'string' },
        trigger: { type: 'string' },
        enabled: { type: 'boolean' },
        label: { type: 'string' },
        description: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['id', 'reason'],
    },
  },
  {
    name: 'update_lane_zone',
    description: 'Update a drayage lane zone (price or radius).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        flatPrice: { type: 'number' },
        radiusMiles: { type: 'number' },
        enabled: { type: 'boolean' },
        reason: { type: 'string' },
      },
      required: ['id', 'reason'],
    },
  },
];

interface ToolCallResult {
  ok: boolean;
  message: string;
  data?: unknown;
  /** Present when a mutation tool produced a proposal (nothing written yet). */
  proposal?: RateProposal;
}

// ─── Proposals (confirm-before-apply) ─────────────────────────────────
// The four mutation tools never write when the model calls them; they return
// a RateProposal instead. Persisted as a pending `conversations` row and
// applied only via the Apply endpoint, which re-validates the stored input.
export const MUTATION_TOOLS = new Set([
  'update_rate_card',
  'create_accessorial',
  'update_accessorial',
  'update_lane_zone',
]);

/** Mutable field lists — the only keys copied from tool input into a DB patch.
 *  Shared by the diff builder and the writer so they can never drift. */
const MUTABLE_FIELDS: Record<string, string[]> = {
  update_rate_card: [
    'ratePerMile', 'minimumCharge', 'flatFee', 'fuelSurchargePct',
    'marginPct', 'maxWeightLbs', 'maxMiles', 'enabled', 'label', 'notes',
  ],
  create_accessorial: [
    'code', 'label', 'description', 'kind', 'amount', 'trigger', 'appliesToServices',
  ],
  update_accessorial: ['amount', 'kind', 'trigger', 'enabled', 'label', 'description'],
  update_lane_zone: ['flatPrice', 'radiusMiles', 'enabled'],
};

export interface ProposalChange {
  field: string;         // machine field name
  label: string;         // human label, e.g. "Per-mile rate"
  from: string | null;   // formatted current value (null for a create)
  to: string;            // formatted proposed value
}

export interface RateProposal {
  /** conversations row id; 0 until persisted, then the real row id. */
  id: number;
  tool: string;
  entity: 'rate_card' | 'accessorial' | 'lane_zone';
  op: 'update' | 'create';
  /** Validated tool input — the source of truth, re-validated at apply time. */
  input: Record<string, unknown>;
  title: string;         // "Dry Van FTL"
  reason: string;        // audit reason from the model
  summary: string;       // one-line human sentence
  changes: ProposalChange[];
}

const FIELD_LABELS: Record<string, string> = {
  ratePerMile: 'Per-mile rate', minimumCharge: 'Minimum charge', flatFee: 'Flat fee',
  fuelSurchargePct: 'Fuel surcharge', marginPct: 'Margin', maxWeightLbs: 'Max weight',
  maxMiles: 'Max miles', enabled: 'Status', label: 'Label', notes: 'Notes',
  amount: 'Amount', kind: 'Kind', trigger: 'Trigger', description: 'Description',
  code: 'Code', appliesToServices: 'Applies to', flatPrice: 'Flat price',
  radiusMiles: 'Radius',
};
const MONEY_FIELDS = new Set(['ratePerMile', 'minimumCharge', 'flatFee', 'amount', 'flatPrice']);
const PCT_FIELDS = new Set(['fuelSurchargePct', 'marginPct']);
const MILES_FIELDS = new Set(['maxMiles', 'radiusMiles']);
const WEIGHT_FIELDS = new Set(['maxWeightLbs']);

function fmtFieldValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Enabled' : 'Disabled';
  if (typeof v === 'number') {
    if (MONEY_FIELDS.has(field)) return `$${v.toFixed(2)}`;
    if (PCT_FIELDS.has(field)) return `${v}%`;
    if (MILES_FIELDS.has(field)) return `${v} mi`;
    if (WEIGHT_FIELDS.has(field)) return `${v.toLocaleString('en-US')} lbs`;
    return String(v);
  }
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

/**
 * PURE diff builder. Given a mutation tool, its validated input, and the
 * current DB row (`before`, null for a create), return the human-readable
 * proposal shell (no id yet). No I/O — unit-testable in isolation.
 */
export function buildRateChangeDiff(
  tool: string,
  input: Record<string, unknown>,
  before: Record<string, unknown> | null
): Omit<RateProposal, 'id'> {
  const reason = String(input.reason ?? '');
  const fields = MUTABLE_FIELDS[tool] ?? [];
  const changes: ProposalChange[] = [];
  for (const f of fields) {
    if (input[f] === undefined) continue;
    const to = fmtFieldValue(f, input[f]);
    const from = before ? fmtFieldValue(f, (before as Record<string, unknown>)[f]) : null;
    // On an update, skip no-op fields the model re-sent unchanged.
    if (before && from === to) continue;
    changes.push({ field: f, label: FIELD_LABELS[f] ?? f, from, to });
  }

  let entity: RateProposal['entity'];
  let op: RateProposal['op'];
  let title: string;
  switch (tool) {
    case 'update_rate_card':
      entity = 'rate_card'; op = 'update';
      title = String(before?.label || `${before?.service ?? ''} ${before?.equipment ?? ''}`.trim() || `Rate card #${before?.id ?? input.id}`);
      break;
    case 'create_accessorial':
      entity = 'accessorial'; op = 'create';
      title = String(input.label || input.code || 'New accessorial');
      break;
    case 'update_accessorial':
      entity = 'accessorial'; op = 'update';
      title = String(before?.label || `Accessorial #${before?.id ?? input.id}`);
      break;
    case 'update_lane_zone':
      entity = 'lane_zone'; op = 'update';
      title = String(before?.label || `Lane zone #${before?.id ?? input.id}`);
      break;
    default:
      entity = 'rate_card'; op = 'update'; title = 'Change';
  }

  let summary: string;
  if (op === 'create') {
    summary = `Create accessorial "${title}" — ${fmtFieldValue('kind', input.kind)} ${fmtFieldValue('amount', input.amount)}`;
  } else if (changes.length === 1) {
    summary = `${title} — ${changes[0].label}: ${changes[0].from} → ${changes[0].to}`;
  } else if (changes.length === 0) {
    summary = `${title} — no effective change`;
  } else {
    summary = `${title} — ${changes.length} changes`;
  }

  return { tool, entity, op, input, title, reason, summary, changes };
}

/**
 * Fetch the current row for an UPDATE tool (ownership-scoped). Returns the row
 * or an error message. Creates have no `before`. Extracted so both propose and
 * apply share the exact same ownership check.
 */
async function fetchBeforeRow(
  tenantId: number,
  tool: string,
  input: Record<string, unknown>
): Promise<{ ok: true; before: Record<string, unknown> | null } | { ok: false; message: string }> {
  if (tool === 'create_accessorial') return { ok: true, before: null };
  const id = Number(input.id);
  if (tool === 'update_rate_card') {
    const r = await db().select().from(rateCards)
      .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId))).limit(1);
    if (!r[0]) return { ok: false, message: `Rate card ${id} not found for this tenant.` };
    return { ok: true, before: r[0] as Record<string, unknown> };
  }
  if (tool === 'update_accessorial') {
    const r = await db().select().from(accessorials)
      .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, tenantId))).limit(1);
    if (!r[0]) return { ok: false, message: `Accessorial ${id} not found.` };
    return { ok: true, before: r[0] as Record<string, unknown> };
  }
  if (tool === 'update_lane_zone') {
    const r = await db().select().from(laneZones)
      .where(and(eq(laneZones.id, id), eq(laneZones.tenantId, tenantId))).limit(1);
    if (!r[0]) return { ok: false, message: `Lane zone ${id} not found.` };
    return { ok: true, before: r[0] as Record<string, unknown> };
  }
  return { ok: false, message: `Unknown tool: ${tool}` };
}

/**
 * Turn a model mutation-tool call into a PROPOSAL. Validates (RATE-C1 bounds),
 * confirms ownership, computes the diff. Writes NOTHING. Returns the proposal
 * (id 0) in `data`/`proposal`; the caller persists it and assigns the id.
 */
export async function proposeMutation(
  tenantId: number,
  tool: string,
  rawInput: Record<string, unknown>
): Promise<ToolCallResult> {
  const v = validateToolInput(tool, rawInput);
  if (!v.ok) return { ok: false, message: v.message };
  const input = v.data;
  const b = await fetchBeforeRow(tenantId, tool, input);
  if (!b.ok) return { ok: false, message: b.message };
  const shell = buildRateChangeDiff(tool, input, b.before);
  const proposal: RateProposal = { id: 0, ...shell };
  return {
    ok: true,
    message: `Proposed (pending your confirmation — NOTHING has been applied): ${proposal.summary}`,
    proposal,
    data: { proposal: { summary: proposal.summary, changes: proposal.changes } },
  };
}

/**
 * WRITE path. Called ONLY from the Apply endpoint after the owner confirms.
 * Re-validates the stored input against the same RATE-C1 bounds (never trusts
 * a client-supplied number), then writes + audit-logs. Returns the result.
 */
export async function applyRateMutation(
  tenantId: number,
  userId: number | null,
  tool: string,
  rawInput: Record<string, unknown>
): Promise<ToolCallResult> {
  // Server-side re-validation — the client only sends a proposal id, but we
  // still bounds-check the stored input in case it was ever tampered with.
  const v = validateToolInput(tool, rawInput);
  if (!v.ok) return { ok: false, message: v.message };
  const input = v.data;
  switch (tool) {
    case 'update_rate_card': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      const existing = await db().select().from(rateCards)
        .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId))).limit(1);
      if (!existing[0]) return { ok: false, message: `Rate card ${id} not found for this tenant.` };
      const patch: Record<string, unknown> = {};
      for (const k of MUTABLE_FIELDS.update_rate_card) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.lastAiEditAt = new Date();
      patch.lastAiEditReason = reason;
      patch.updatedAt = new Date();
      await db().update(rateCards).set(patch).where(eq(rateCards.id, id));
      await db().insert(auditLog).values({
        tenantId, userId,
        action: 'rate_card.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Rate card #${id} updated.`, data: patch };
    }
    case 'create_accessorial': {
      const [row] = await db().insert(accessorials).values({
        tenantId,
        code: String(input.code),
        label: String(input.label),
        description: input.description ? String(input.description) : null,
        kind: String(input.kind),
        amount: Number(input.amount),
        trigger: String(input.trigger),
        appliesToServices: input.appliesToServices as string[] | undefined,
        enabled: true,
        sortOrder: 1000,
      }).returning();
      await db().insert(auditLog).values({
        tenantId, userId,
        action: 'accessorial.create',
        actorKind: 'ai_agent',
        detailsJson: { id: row?.id, input, reason: input.reason },
      });
      return { ok: true, message: `Accessorial "${input.label}" created.`, data: row };
    }
    case 'update_accessorial': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      const existing = await db().select().from(accessorials)
        .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, tenantId))).limit(1);
      if (!existing[0]) return { ok: false, message: `Accessorial ${id} not found.` };
      const patch: Record<string, unknown> = {};
      for (const k of MUTABLE_FIELDS.update_accessorial) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.updatedAt = new Date();
      await db().update(accessorials).set(patch).where(eq(accessorials.id, id));
      await db().insert(auditLog).values({
        tenantId, userId,
        action: 'accessorial.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Accessorial #${id} updated.`, data: patch };
    }
    case 'update_lane_zone': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      const existing = await db().select().from(laneZones)
        .where(and(eq(laneZones.id, id), eq(laneZones.tenantId, tenantId))).limit(1);
      if (!existing[0]) return { ok: false, message: `Lane zone ${id} not found.` };
      const patch: Record<string, unknown> = {};
      for (const k of MUTABLE_FIELDS.update_lane_zone) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.updatedAt = new Date();
      await db().update(laneZones).set(patch).where(eq(laneZones.id, id));
      await db().insert(auditLog).values({
        tenantId, userId,
        action: 'lane_zone.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Lane zone #${id} updated.`, data: patch };
    }
    default:
      return { ok: false, message: `Unknown tool: ${tool}` };
  }
}

/**
 * Dispatch a model tool call. READ tools run inline; MUTATION tools return a
 * proposal (write nothing). This is the ONLY place the agent loop reaches the
 * DB per model turn.
 */
async function execTool(
  tenantId: number,
  _userId: number | null,
  name: string,
  rawInput: Record<string, unknown>
): Promise<ToolCallResult> {
  if (MUTATION_TOOLS.has(name)) {
    return proposeMutation(tenantId, name, rawInput);
  }
  const v = validateToolInput(name, rawInput);
  if (!v.ok) return { ok: false, message: v.message };
  switch (name) {
    case 'list_rate_cards': {
      const rows = await db().select().from(rateCards).where(eq(rateCards.tenantId, tenantId));
      return { ok: true, message: `Loaded ${rows.length} rate cards`, data: rows };
    }
    case 'list_accessorials': {
      const rows = await db().select().from(accessorials).where(eq(accessorials.tenantId, tenantId));
      return { ok: true, message: `Loaded ${rows.length} accessorials`, data: rows };
    }
    case 'list_lane_zones': {
      const rows = await db().select().from(laneZones).where(eq(laneZones.tenantId, tenantId));
      return { ok: true, message: `Loaded ${rows.length} lane zones`, data: rows };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}

export interface RateAgentTurn {
  reply: string;
  toolResults: Array<{ tool: string; result: ToolCallResult }>;
  /** Pending proposals produced this turn — each persisted, id-assigned, and
   *  awaiting Apply/Discard in the chat UI. Empty when the turn only read. */
  proposals: RateProposal[];
}

export async function rateAgentTurn(
  tenantId: number,
  userId: number,
  userMessage: string
): Promise<RateAgentTurn> {
  const t = await db().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = t[0];
  if (!tenant) throw new Error('Tenant not found');
  const ai = await db()
    .select()
    .from(aiConfigs)
    .where(eq(aiConfigs.tenantId, tenantId))
    .limit(1);
  const aiCfg = ai[0] ?? null;

  // Save user message
  await db().insert(conversations).values({
    tenantId,
    channel: 'admin_rate_chat',
    userId,
    role: 'user',
    content: userMessage,
  });

  // Recent context (last 10 messages).
  const history = await db()
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.channel, 'admin_rate_chat')
      )
    )
    .orderBy(conversations.createdAt)
    .limit(20);

  const messages = history.map((h) => ({
    role: (h.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: h.content,
  }));

  const sys = rateAdjusterSystemPrompt(tenant as Tenant, aiCfg);

  // Single round-trip with tools available. If the model asks for tools,
  // run them and pass results back in a follow-up call (max 3 turns).
  const toolResults: RateAgentTurn['toolResults'] = [];
  let finalText = '';
  let turnMessages: { role: 'user' | 'assistant'; content: string }[] = [...messages];
  for (let i = 0; i < 3; i++) {
    const out = await complete({
      tenantId,
      system: sys,
      messages: turnMessages,
      maxTokens: 1500,
      tools: TOOLS,
    });
    if (out.text) finalText += out.text + '\n';
    if (out.toolUses.length === 0) break;

    // Execute every tool the model asked for; serialise results into
    // a plain text "tool results" message that we feed back in.
    const lines: string[] = [];
    for (const t of out.toolUses) {
      const r = await execTool(tenantId, userId, t.name, t.input);
      toolResults.push({ tool: t.name, result: r });
      lines.push(
        `Tool ${t.name}: ${r.ok ? 'OK' : 'ERROR'} — ${r.message}` +
          (r.data ? `\n${JSON.stringify(r.data).slice(0, 2000)}` : '')
      );
    }
    turnMessages = [
      ...turnMessages,
      { role: 'assistant', content: out.text || '(invoking tools)' },
      { role: 'user', content: `Tool results:\n${lines.join('\n\n')}` },
    ];
  }

  finalText = finalText.trim() || '(no reply)';
  await db().insert(conversations).values({
    tenantId,
    channel: 'admin_rate_chat',
    userId,
    role: 'assistant',
    content: finalText,
    metadataJson: { toolResults: toolResults.map((t) => ({ tool: t.tool, ok: t.result.ok })) },
  });

  // Persist every proposal as its own `pending` conversation row. The row id
  // IS the proposal id the Apply/Discard endpoints key on; storing the full
  // (validated) input means the server never has to trust a client number.
  const proposals: RateProposal[] = [];
  for (const tr of toolResults) {
    const p = tr.result.proposal;
    if (!tr.result.ok || !p) continue;
    const [row] = await db().insert(conversations).values({
      tenantId,
      channel: 'admin_rate_chat',
      userId,
      role: 'tool',
      content: p.summary,
      metadataJson: {
        kind: 'rate_proposal',
        status: 'pending',
        tool: p.tool,
        entity: p.entity,
        op: p.op,
        title: p.title,
        reason: p.reason,
        summary: p.summary,
        changes: p.changes,
        input: p.input,
      },
    }).returning({ id: conversations.id });
    proposals.push({ ...p, id: row?.id ?? 0 });
  }

  return { reply: finalText, toolResults, proposals };
}
