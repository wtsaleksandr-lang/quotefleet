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
  return env.ANTHROPIC_API_KEY;
}

export async function complete(opts: {
  tenantId: number | null;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  model?: string;
  tools?: ChatToolDef[];
}): Promise<ChatCompletion> {
  const apiKey = await resolveApiKey(opts.tenantId);
  const client = new Anthropic({ apiKey });

  const model = opts.model ?? DEFAULT_MODEL;
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
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
  return { text, toolUses, stopReason: res.stop_reason ?? '' };
}

export const Models = {
  default: DEFAULT_MODEL,
  escalate: ESCALATE_MODEL,
};
