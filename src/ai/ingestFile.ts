/**
 * AI rate-sheet ingest.
 *
 * Takes a base64-encoded file (PDF / image / text) + its mime type and
 * asks Claude to extract a structured rate book. Returns a draft the
 * carrier reviews and confirms before any DB write.
 *
 * Supported MIME types (V1):
 *   - application/pdf            → native Claude PDF support
 *   - image/png, image/jpeg, image/webp, image/gif → native Claude vision
 *   - text/plain, text/csv, text/html → wrapped as text content
 *
 * Excel and .eml are accepted but a friendly error tells the user to
 * convert to PDF or paste contents — Excel parsing needs `xlsx` and
 * .eml needs `mailparser`, both currently uninstalled.
 *
 * The model returns structured JSON matching the calculator's existing
 * shapes so applying changes is a straight DB upsert.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { simpleParser, type Attachment } from 'mailparser';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { decrypt } from '../auth/secrets.js';
import { distanceBetween } from '../calc/distance.js';

// Tool the model can call mid-parse to derive a per-mile rate from a
// point-to-point total ("Long Beach → Phoenix, $1,200" → 380 mi).
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'geocode_distance',
    description:
      "Look up approximate road distance in miles between two USA/Canada locations. Use when the rate sheet shows a point-to-point total but no per-mile rate. Locations can be 'City, ST', a 5-digit ZIP, or a Canadian FSA. Returns { miles } or { error }.",
    input_schema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Origin location, e.g. "Long Beach, CA" or "90802".',
        },
        destination: {
          type: 'string',
          description: 'Destination location, e.g. "Phoenix, AZ" or "85003".',
        },
      },
      required: ['origin', 'destination'],
    },
  },
];

/** Parse a free-text location into the shape distanceBetween expects. */
function parseFreeText(s: string): { city?: string; state?: string; zip?: string; country?: string } {
  const t = s.trim();
  if (/^\d{5}$/.test(t)) return { zip: t, country: 'US' };
  if (/^[A-Z]\d[A-Z]/i.test(t)) return { zip: t.replace(/\s+/g, ''), country: 'CA' };
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[0], state: parts[1].slice(0, 2).toUpperCase(), country: 'US' };
  return { city: t, country: 'US' };
}

async function execTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'geocode_distance') {
    const origin = parseFreeText(String(input.origin ?? ''));
    const destination = parseFreeText(String(input.destination ?? ''));
    const r = await distanceBetween(origin, destination);
    if ('error' in r) return { error: r.error };
    return { miles: r.miles, source: r.source };
  }
  return { error: `Unknown tool ${name}` };
}

const SUPPORTED_VISION_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const SUPPORTED_TEXT_MIME = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
]);

const EXCEL_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // legacy .xls
]);

const EML_MIME = 'message/rfc822';

const SYSTEM_PROMPT = `You are a freight-rate-sheet parser for a drayage/trucking carrier's quote calculator. The user uploads a rate sheet — image, PDF, spreadsheet, email — and you extract a structured rate book.

OUTPUT: a single JSON object with this exact shape. Output ONLY the JSON — no prose, no backticks.

{
  "summary": "1-2 sentence description",
  "confidence": "high" | "medium" | "low",
  "warnings": ["short bullets about anything ambiguous"],
  "fscDetected": {
    "present": boolean,
    "appearsIncludedInLinehaul": boolean,
    "valuePct": number | null,
    "valuePerMile": number | null,
    "notes": "what made you decide"
  },
  "rateCards": [
    {
      "service": "drayage" | "ftl" | "ltl" | "expedited" | "hotshot",
      "equipment": "dryvan" | "reefer" | "flatbed" | "step_deck" | "conestoga"
                 | "container_20" | "container_40" | "container_40hc" | "container_45"
                 | "sprinter" | "box_truck" | "tractor_only" | "pallet",
      "label": "e.g. 53' Dry Van",
      "ratePerMile": number | null,
      "minimumCharge": number | null,
      "flatFee": number | null,
      "fuelSurchargePct": number | null,
      "marginPct": number | null,
      "derivedFrom": null | {
        "totalUsd": number,
        "originAddress": "string",
        "destinationAddress": "string",
        "approxMiles": number,
        "explanation": "how you computed ratePerMile"
      }
    }
  ],
  "accessorials": [
    {
      "code": "snake_case",
      "label": "human label",
      "kind": "flat" | "per_mile" | "pct_of_base" | "per_hour" | "per_day",
      "amount": number,
      "appliesToServices": ["drayage","ftl",...] | null
    }
  ],
  "laneZones": [
    {
      "label": "e.g. LAX/LGB → Local LA Basin (0-30 mi)",
      "anchorPortCode": "USLAX" | null,
      "anchorCity": "Los Angeles" | null,
      "anchorState": "CA" | null,
      "radiusMiles": number,
      "flatPrice": number,
      "equipmentScope": ["container_20","container_40",...]
    }
  ]
}

CRITICAL RULES:

1. **FSC detection.** Many rate sheets quote a single "all-in" total that already includes Fuel Surcharge. You MUST decide whether the rate is base-only or all-in:
   - If the sheet says "rate includes FSC", "all-in", "linehaul + fuel", "ATF", "all fuel surcharges included", or shows fuel as a separate column / added line → set fscDetected.present=true, fscDetected.appearsIncludedInLinehaul accordingly.
   - If the sheet says "plus fuel", "+FSC", "fuel separate", "as quoted by DOE", or has an explicit FSC table → fsc is separate; set fuelSurchargePct/valuePct on the rate card.
   - If the sheet shows a base rate AND an "all-in rate" both, prefer the BASE rate for ratePerMile and set fuelSurchargePct from the implied difference.
   - If you can't decide, set fscDetected.present=null (i.e. omit the field) and add a warning "FSC handling unclear — assumed all-in".
   - When the rate IS all-in and you set ratePerMile from it, set fuelSurchargePct to 0 (don't double-charge).

2. **Per-mile derivation when only totals are given.** Many sheets show point-to-point totals like "Long Beach → Phoenix, $1,200" without a $/mile rate. You can call the geocode_distance tool to look up the road distance, then divide. Always populate derivedFrom with the inputs. If the tool isn't available or distance is unavailable, leave ratePerMile null and add a warning.

3. **Currency.** Assume USD unless the sheet clearly says CAD; convert nothing — leave the value as-stated and add a warning.

4. **Ambiguity.** Use null for unknowns. Don't guess. Lower the confidence and add to warnings instead of inventing numbers.

5. **Duplicates.** If the sheet repeats the same rate in multiple places (e.g. summary + per-route), emit it once.

6. **Unsupported scope.** If you find ocean rates, customs fees, brokerage commission percentages, or anything that isn't a domestic trucking rate / accessorial / lane zone — skip it and add a warning saying "skipped: <what>".

Output the JSON object and nothing else.`;

export interface IngestResult {
  parsed: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
    fscDetected?: {
      present: boolean | null;
      appearsIncludedInLinehaul: boolean | null;
      valuePct: number | null;
      valuePerMile: number | null;
      notes: string;
    };
    rateCards: Array<Record<string, unknown>>;
    accessorials: Array<Record<string, unknown>>;
    laneZones: Array<Record<string, unknown>>;
  };
  raw: string;
  modelUsed: string;
  /** How many times the model called the geocode_distance tool. */
  toolCalls: number;
}

export class IngestUnsupportedError extends Error {
  constructor(mimeType: string, hint: string) {
    super(`Unsupported MIME type ${mimeType}: ${hint}`);
  }
}

async function resolveApiKey(tenantId: number): Promise<string> {
  const env = loadEnv();
  const t = await db()
    .select({ encrypted: tenants.anthropicKeyEncrypted })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const enc = t[0]?.encrypted;
  if (enc) {
    try { return decrypt(enc); } catch { /* fall back */ }
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to Replit Secrets.');
  }
  return env.ANTHROPIC_API_KEY;
}

export async function parseRateSheet(opts: {
  tenantId: number;
  filename: string;
  mimeType: string;
  dataBase64: string;
}): Promise<IngestResult> {
  const mt = opts.mimeType.toLowerCase();

  const apiKey = await resolveApiKey(opts.tenantId);
  const client = new Anthropic({ apiKey });

  // Sonnet for ingest — extracting structured data from a busy rate
  // sheet wants more precision than Haiku.
  const model = 'claude-sonnet-4-6';

  let userContent: Anthropic.Messages.ContentBlockParam[];

  if (mt === 'application/pdf') {
    userContent = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: opts.dataBase64 },
      },
      { type: 'text', text: `Filename: ${opts.filename}\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (SUPPORTED_VISION_MIME.has(mt)) {
    userContent = [
      {
        type: 'image',
        source: { type: 'base64', media_type: mt as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: opts.dataBase64 },
      },
      { type: 'text', text: `Filename: ${opts.filename}\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (EXCEL_MIME.has(mt)) {
    // Convert .xlsx/.xls → CSV-formatted text. Pass each sheet to Claude
    // labeled by sheet name. Claude reads tables natively from CSV.
    const text = excelToText(opts.dataBase64);
    if (text.length > 100_000) {
      throw new Error('Spreadsheet too dense (>100KB after CSV conversion). Split into smaller sheets.');
    }
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\nThis is a spreadsheet rendered as CSV per sheet.\n\n${text}\n\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else if (mt === EML_MIME) {
    // .eml: extract the body + attachments. Each attachment recursed
    // back through this function inline (PDF/image attachments are the
    // common case — a forwarded carrier rate sheet).
    const { content, attachmentBlocks } = await emlToContentBlocks(opts.dataBase64);
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\nThis is an email message.\n\n--- BODY ---\n${content}\n--- END BODY ---\n` },
      ...attachmentBlocks,
      { type: 'text', text: 'Extract the rate sheet into JSON per the spec, drawing from the body AND any attachments above.' },
    ];
  } else if (SUPPORTED_TEXT_MIME.has(mt)) {
    const decoded = Buffer.from(opts.dataBase64, 'base64').toString('utf8');
    if (decoded.length > 50000) {
      throw new Error('Text file too large (>50KB). Try a smaller excerpt or convert to PDF.');
    }
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\n\n${decoded}\n\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else {
    throw new IngestUnsupportedError(mt, 'Supported types: PDF, PNG, JPEG, WEBP, GIF, plain text, CSV, HTML, Excel (.xlsx/.xls), email (.eml).');
  }

  // Multi-turn loop: model can call geocode_distance tool to derive
  // per-mile from totals. Hard-cap at MAX_TURNS to prevent runaway loops.
  const MAX_TURNS = 6;
  const messages: Anthropic.Messages.MessageParam[] = [{ role: 'user', content: userContent }];
  let toolCalls = 0;
  let finalText = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    if (res.stop_reason === 'tool_use') {
      const toolUses = res.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );
      // Append assistant message verbatim, then a user message with
      // tool_result blocks for each tool call.
      messages.push({ role: 'assistant', content: res.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const t of toolUses) {
        toolCalls++;
        try {
          const out = await execTool(t.name, (t.input as Record<string, unknown>) ?? {});
          toolResults.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) });
        } catch (err) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: t.id,
            content: JSON.stringify({ error: (err as Error).message }),
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Terminal turn — text output expected.
    finalText = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    break;
  }

  if (!finalText) throw new Error('Model exhausted tool-use turns without producing JSON.');

  // Strip optional code fences (model sometimes adds them despite instructions)
  const cleaned = finalText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Model returned non-JSON output. First 200 chars: ${cleaned.slice(0, 200)}`
    );
  }

  // Defensive defaults so callers can rely on shape.
  parsed.summary ??= '';
  parsed.confidence ??= 'low';
  parsed.warnings ??= [];
  parsed.rateCards ??= [];
  parsed.accessorials ??= [];
  parsed.laneZones ??= [];

  return { parsed, raw: cleaned, modelUsed: model, toolCalls };
}

/* ────────────────────────────────────────────────────────────────── *
 * Excel → CSV-text rendering
 * ────────────────────────────────────────────────────────────────── */
function excelToText(dataBase64: string): string {
  const buf = Buffer.from(dataBase64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) parts.push(`### Sheet: ${sheetName}\n${csv}`);
  }
  return parts.join('\n\n');
}

/* ────────────────────────────────────────────────────────────────── *
 * .eml → body text + attachment content blocks
 * ────────────────────────────────────────────────────────────────── */
async function emlToContentBlocks(dataBase64: string): Promise<{
  content: string;
  attachmentBlocks: Anthropic.Messages.ContentBlockParam[];
}> {
  const buf = Buffer.from(dataBase64, 'base64');
  const parsed = await simpleParser(buf);
  const headerLine =
    `Subject: ${parsed.subject ?? ''}\n` +
    `From: ${(parsed.from?.text) ?? ''}\n` +
    `To: ${(Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to?.text) ?? ''}\n` +
    `Date: ${parsed.date?.toISOString() ?? ''}\n`;
  const body = (parsed.text ?? parsed.html ?? '').toString().slice(0, 20_000);
  const content = headerLine + '\n' + body;

  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  for (const att of parsed.attachments ?? []) {
    const block = attachmentToBlock(att);
    if (block) blocks.push(block);
  }
  return { content, attachmentBlocks: blocks };
}

function attachmentToBlock(att: Attachment): Anthropic.Messages.ContentBlockParam | null {
  const mt = (att.contentType ?? '').toLowerCase();
  const data = att.content?.toString('base64');
  if (!data) return null;

  if (mt === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }
  if (SUPPORTED_VISION_MIME.has(mt)) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mt as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data },
    };
  }
  if (EXCEL_MIME.has(mt)) {
    const text = excelToText(data);
    return { type: 'text', text: `--- ATTACHMENT (${att.filename ?? 'untitled'}) ---\n${text}\n--- END ATTACHMENT ---` };
  }
  if (SUPPORTED_TEXT_MIME.has(mt)) {
    const txt = att.content!.toString('utf8').slice(0, 20_000);
    return { type: 'text', text: `--- ATTACHMENT (${att.filename ?? 'untitled'}) ---\n${txt}\n--- END ATTACHMENT ---` };
  }
  // Unsupported attachment type — note its presence but skip content.
  return {
    type: 'text',
    text: `[Skipped attachment "${att.filename ?? 'untitled'}" — unsupported type ${mt}.]`,
  };
}
