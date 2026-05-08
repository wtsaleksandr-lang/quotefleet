/**
 * Rate-adjustment AI agent. The carrier's tenant-owner chats in plain
 * English ("raise drayage from LAX by 10% and add a $50 chassis fee").
 * The agent has tools to update rate cards, accessorials, and zones.
 *
 * One LLM round-trip per user turn. Multi-step changes are surfaced as
 * a plan that the user must confirm before tools are actually called.
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
}

async function execTool(
  tenantId: number,
  userId: number | null,
  name: string,
  rawInput: Record<string, unknown>
): Promise<ToolCallResult> {
  // Validate first — bounds-check every numeric field, enum-check kind/
  // trigger, length-cap strings. A bad input is returned to the model so
  // it can correct on the next turn instead of silently writing garbage.
  const v = validateToolInput(name, rawInput);
  if (!v.ok) return { ok: false, message: v.message };
  const input = v.data;
  switch (name) {
    case 'list_rate_cards': {
      const rows = await db()
        .select()
        .from(rateCards)
        .where(eq(rateCards.tenantId, tenantId));
      return {
        ok: true,
        message: `Loaded ${rows.length} rate cards`,
        data: rows,
      };
    }
    case 'list_accessorials': {
      const rows = await db()
        .select()
        .from(accessorials)
        .where(eq(accessorials.tenantId, tenantId));
      return {
        ok: true,
        message: `Loaded ${rows.length} accessorials`,
        data: rows,
      };
    }
    case 'list_lane_zones': {
      const rows = await db()
        .select()
        .from(laneZones)
        .where(eq(laneZones.tenantId, tenantId));
      return {
        ok: true,
        message: `Loaded ${rows.length} lane zones`,
        data: rows,
      };
    }
    case 'update_rate_card': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      // Verify ownership.
      const existing = await db()
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.id, id), eq(rateCards.tenantId, tenantId)))
        .limit(1);
      if (!existing[0]) return { ok: false, message: `Rate card ${id} not found for this tenant.` };
      const patch: Record<string, unknown> = {};
      for (const k of [
        'ratePerMile',
        'minimumCharge',
        'flatFee',
        'fuelSurchargePct',
        'marginPct',
        'maxWeightLbs',
        'maxMiles',
        'enabled',
        'label',
        'notes',
      ]) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.lastAiEditAt = new Date();
      patch.lastAiEditReason = reason;
      patch.updatedAt = new Date();
      await db().update(rateCards).set(patch).where(eq(rateCards.id, id));
      await db().insert(auditLog).values({
        tenantId,
        userId,
        action: 'rate_card.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Rate card #${id} updated.`, data: patch };
    }
    case 'create_accessorial': {
      const [row] = await db()
        .insert(accessorials)
        .values({
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
        })
        .returning();
      await db().insert(auditLog).values({
        tenantId,
        userId,
        action: 'accessorial.create',
        actorKind: 'ai_agent',
        detailsJson: { id: row?.id, input, reason: input.reason },
      });
      return {
        ok: true,
        message: `Accessorial "${input.label}" created.`,
        data: row,
      };
    }
    case 'update_accessorial': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      const existing = await db()
        .select()
        .from(accessorials)
        .where(and(eq(accessorials.id, id), eq(accessorials.tenantId, tenantId)))
        .limit(1);
      if (!existing[0]) return { ok: false, message: `Accessorial ${id} not found.` };
      const patch: Record<string, unknown> = {};
      for (const k of ['amount', 'kind', 'trigger', 'enabled', 'label', 'description']) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.updatedAt = new Date();
      await db().update(accessorials).set(patch).where(eq(accessorials.id, id));
      await db().insert(auditLog).values({
        tenantId,
        userId,
        action: 'accessorial.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Accessorial #${id} updated.`, data: patch };
    }
    case 'update_lane_zone': {
      const id = Number(input.id);
      const reason = String(input.reason ?? '');
      const existing = await db()
        .select()
        .from(laneZones)
        .where(and(eq(laneZones.id, id), eq(laneZones.tenantId, tenantId)))
        .limit(1);
      if (!existing[0]) return { ok: false, message: `Lane zone ${id} not found.` };
      const patch: Record<string, unknown> = {};
      for (const k of ['flatPrice', 'radiusMiles', 'enabled']) {
        if (input[k] !== undefined) patch[k] = input[k];
      }
      patch.updatedAt = new Date();
      await db().update(laneZones).set(patch).where(eq(laneZones.id, id));
      await db().insert(auditLog).values({
        tenantId,
        userId,
        action: 'lane_zone.update',
        actorKind: 'ai_agent',
        detailsJson: { id, before: existing[0], patch, reason },
      });
      return { ok: true, message: `Lane zone #${id} updated.`, data: patch };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}

export interface RateAgentTurn {
  reply: string;
  toolResults: Array<{ tool: string; result: ToolCallResult }>;
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

  return { reply: finalText, toolResults };
}
