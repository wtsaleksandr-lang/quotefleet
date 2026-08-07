/**
 * Copilot form-fill agent (Phase 2). Given the on-screen form the owner is
 * looking at — its field list, current values, and the owner's request — the
 * model proposes concrete values for those fields. The client prefills the REAL
 * inputs (highlighted, pending) and the owner Confirms / Undoes.
 *
 * Parity with the WeFixTrades portal FORM_FILL contract (server/routes/portal/
 * chat.ts): the model appends a single fenced <<<FORM_FILL>>> JSON block; the
 * server strips it from the visible reply, validates every fill against the
 * allowed field keys (and enum options when provided), and never applies blindly.
 *
 * Unlike the rate agent this path is READ-ONLY on the server — it returns
 * proposed values only; nothing is written. The client applies them to the
 * live form, whose own save logic (already tenant-scoped + validated) persists
 * on Confirm.
 */
import { complete } from './client.js';

export interface FormFillFieldOption {
  value: string;
  label?: string;
}

export interface FormFillField {
  key: string;
  label: string;
  required?: boolean;
  /** For select fields — the only values the model may return for this key. */
  options?: FormFillFieldOption[];
}

/** A single proposed fill: which field, what value. */
export interface FormFill {
  field_key: string;
  value: string;
}

export interface FormFillInput {
  formLabel?: string;
  fields: FormFillField[];
  currentValues: Record<string, unknown>;
  message: string;
}

export interface FormFillResult {
  fills: FormFill[];
  reply: string;
}

const FORM_FILL_RE = /<<<FORM_FILL>>>([\s\S]*?)<<<END_FORM_FILL>>>/;
const MAX_FILLS = 8;
const MAX_VALUE_LEN = 2000;

/**
 * Build the system prompt. Lists the editable fields (with enum options + a
 * "currently filled in" snapshot) and the FORM_FILL return contract. Pure —
 * unit-testable without an API call.
 */
export function buildFormFillSystemPrompt(input: {
  formLabel?: string;
  fields: FormFillField[];
  currentValues: Record<string, unknown>;
}): string {
  const fieldLines = input.fields
    .map((f) => {
      const opts = f.options && f.options.length
        ? ` — allowed values: ${f.options.map((o) => `"${o.value}"${o.label ? ` (${o.label})` : ''}`).join(', ')}`
        : '';
      return `- ${f.label}${f.required ? ' (required)' : ''} [key: ${f.key}]${opts}`;
    })
    .join('\n');

  const filled = Object.entries(input.currentValues || {})
    .filter(([, v]) => v !== '' && v !== false && v != null)
    .map(([k, v]) => `- ${k}: ${String(v)}`)
    .join('\n') || 'None filled yet.';

  const formName = input.formLabel ? ` ("${input.formLabel}")` : '';

  return `You are the form-fill copilot for QuoteFleet, a freight rate-calculator SaaS. The carrier's owner is looking at an editable form${formName} in their portal and wants you to fill in specific fields for them.

The fields on this form the owner can fill are:
${fieldLines}

Currently filled in:
${filled}

Your job: turn the owner's request into concrete values for these fields, then propose them by appending a SINGLE fenced block at the very END of your reply:

<<<FORM_FILL>>>
{"fills":[{"field_key":"<key-from-above>","value":"<the value to set>"}]}
<<<END_FORM_FILL>>>

Rules:
- field_key MUST be one of the [key: …] values above — exact spelling and case.
- value MUST be a string. For a number, use the digits as a string ("50"). For a select field, use one of its allowed values exactly.
- Only fill fields the owner's request actually implies. Don't invent unrelated values. Max ${MAX_FILLS} fills.
- Write ONE short, friendly sentence BEFORE the block (e.g. "Here's what I'll set — review the highlighted fields, then Confirm or Undo."). The block itself is invisible to the owner.
- If the request is NOT about these fields (e.g. a broad "raise all my rates 10%" pricing change), do NOT emit a FORM_FILL block — briefly say you can't fill this form for that and suggest the AI agent for rate changes.
- Keep the reply to 1-2 sentences. Use plain, practical language.`;
}

/**
 * Parse + validate the model's FORM_FILL block. Drops fills whose key isn't in
 * `allowedKeys`, coerces values to a capped string, and (when an options set is
 * given for a key) drops values outside that enum. Never throws — a malformed
 * block yields an empty list. Pure — unit-testable.
 */
export function parseFormFills(
  rawText: string,
  allowedKeys: Set<string>,
  optionsByKey?: Map<string, Set<string>>,
): FormFill[] {
  if (!rawText) return [];
  const match = rawText.match(FORM_FILL_RE);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return [];
  }
  const fillsRaw = (parsed as { fills?: unknown })?.fills;
  if (!Array.isArray(fillsRaw)) return [];

  const seen = new Set<string>();
  const out: FormFill[] = [];
  for (const f of fillsRaw) {
    if (!f || typeof (f as FormFill).field_key !== 'string') continue;
    const key = (f as FormFill).field_key;
    if (!allowedKeys.has(key) || seen.has(key)) continue;
    const rawVal = (f as { value: unknown }).value;
    if (rawVal == null || typeof rawVal === 'object') continue;
    const value = String(rawVal).slice(0, MAX_VALUE_LEN);
    const allowedValues = optionsByKey?.get(key);
    if (allowedValues && allowedValues.size > 0 && !allowedValues.has(value)) continue;
    seen.add(key);
    out.push({ field_key: key, value });
    if (out.length >= MAX_FILLS) break;
  }
  return out;
}

/** Strip the fenced block from the model text to get the visible reply. */
export function stripFormFillBlock(rawText: string): string {
  return (rawText || '').replace(FORM_FILL_RE, '').trim();
}

/**
 * One form-fill turn: prompt the model with the form context, parse + validate
 * the proposed fills, and return them alongside the cleaned reply. Tenant-scoped
 * via the shared Anthropic client (per-tenant BYO key, else platform key).
 */
export async function formFillTurn(tenantId: number, input: FormFillInput): Promise<FormFillResult> {
  const system = buildFormFillSystemPrompt(input);
  const out = await complete({
    tenantId,
    system,
    messages: [{ role: 'user', content: input.message }],
    maxTokens: 500,
  });

  const allowedKeys = new Set(input.fields.map((f) => f.key));
  const optionsByKey = new Map<string, Set<string>>();
  for (const f of input.fields) {
    if (f.options && f.options.length) {
      optionsByKey.set(f.key, new Set(f.options.map((o) => o.value)));
    }
  }

  const fills = parseFormFills(out.text, allowedKeys, optionsByKey);
  let reply = stripFormFillBlock(out.text);
  if (!reply) {
    reply = fills.length
      ? "Here's what I'll set — review the highlighted fields, then Confirm or Undo."
      : "I couldn't map that to this form. Try the AI agent for rate changes, or tell me exactly what to set.";
  }
  return { fills, reply };
}
