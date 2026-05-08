/**
 * Anthropic SDK wrapper. Resolves the API key per-tenant: falls back
 * to platform key when tenant hasn't set their own. Future-proof for
 * a multi-provider switch (Gemini, OpenAI) — exposes `complete()` and
 * `completeWithTools()` over a single shape.
 */
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { decrypt } from '../auth/secrets.js';

export type Role = 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatCompletion {
  text: string;
  toolUses: ChatToolUse[];
  stopReason: string;
}

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ESCALATE_MODEL = 'claude-sonnet-4-6';

async function resolveApiKey(tenantId: number | null): Promise<string> {
  const env = loadEnv();
  if (tenantId != null) {
    const t = await db()
      .select({ encrypted: tenants.anthropicKeyEncrypted })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const enc = t[0]?.encrypted;
    if (enc) {
      try {
        return decrypt(enc);
      } catch {
        // bad ciphertext or wrong session secret — fall back.
      }
    }
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to Replit Secrets to enable AI features.');
  }
  return env.ANTHROPIC_API_KEY;
}

/** Per-call timeout. SDK default is 10 minutes — way too long; a hung
 *  request would hold an Express handler indefinitely. 30s covers
 *  even slow Sonnet runs with a comfortable margin. */
const ANTHROPIC_TIMEOUT_MS = 30_000;

export async function complete(opts: {
  tenantId: number | null;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
  tools?: ChatToolDef[];
  /** Mark the system prompt for ephemeral prompt caching (5-minute TTL).
   *  Use when the system prompt is mostly static and >1024 tokens. */
  cacheSystem?: boolean;
}): Promise<ChatCompletion> {
  const apiKey = await resolveApiKey(opts.tenantId);
  const client = new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS });

  const model = opts.model ?? DEFAULT_MODEL;
  // System block: optionally wrapped in a cache_control structure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const system: any = opts.cacheSystem
    ? [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
    : opts.system;
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    system,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: opts.tools as any,
  });

  let text = '';
  const toolUses: ChatToolUse[] = [];
  for (const block of res.content) {
    if (block.type === 'text') text += block.text;
    if (block.type === 'tool_use') {
      toolUses.push({
        id: block.id,
        name: block.name,
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  // One-line usage log so we can grep cost data even before a real
  // observability stack is wired up. Volume is small; switch to a DB
  // table when per-tenant budgeting lands.
  try {
    const u = (res as unknown as { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }).usage;
    if (u) {
      console.log(
        `[ai.usage] tenant=${opts.tenantId ?? 'platform'} model=${model} ` +
          `in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} ` +
          `cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0}`
      );
    }
  } catch { /* never fail the request because of telemetry */ }

  return { text, toolUses, stopReason: res.stop_reason ?? '' };
}

export const Models = {
  default: DEFAULT_MODEL,
  escalate: ESCALATE_MODEL,
};
