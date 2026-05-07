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
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { loadEnv } from '../config.js';
import { decrypt } from '../auth/secrets.js';

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

const UNSUPPORTED_NEEDS_LIB: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'Excel (.xlsx) parsing needs the `xlsx` package. For now: open in Excel, "Save As" → PDF, then re-upload.',
  'application/vnd.ms-excel':
    'Legacy Excel (.xls) parsing needs the `xlsx` package. For now: open in Excel, "Save As" → PDF, then re-upload.',
  'message/rfc822':
    '.eml parsing needs the `mailparser` package. For now: paste the email body and any rate-sheet attachment as separate uploads.',
};

const SYSTEM_PROMPT = `You are a freight-rate-sheet parser for a drayage/trucking carrier's quote calculator. The user uploads a rate sheet — image, PDF, or text — and you extract a structured representation.

OUTPUT: a single JSON object with this exact shape, nothing else, no prose:

{
  "summary": "1-2 sentences describing what this sheet appears to be",
  "confidence": "high" | "medium" | "low",
  "warnings": ["short bullet about anything ambiguous or missing"],
  "rateCards": [
    {
      "service": "drayage" | "ftl" | "ltl" | "expedited" | "hotshot",
      "equipment": "dryvan" | "reefer" | "flatbed" | "step_deck" | "conestoga"
                 | "container_20" | "container_40" | "container_40hc" | "container_45"
                 | "sprinter" | "box_truck" | "tractor_only" | "pallet",
      "label": "human label like '53\\' Dry Van'",
      "ratePerMile": number | null,
      "minimumCharge": number | null,
      "flatFee": number | null,
      "fuelSurchargePct": number | null,
      "marginPct": number | null
    }
  ],
  "accessorials": [
    {
      "code": "snake_case_code (e.g. chassis_split, prepull, detention, hazmat)",
      "label": "human label",
      "kind": "flat" | "per_mile" | "pct_of_base" | "per_hour" | "per_day",
      "amount": number,
      "appliesToServices": ["drayage", "ftl", ...] | null
    }
  ],
  "laneZones": [
    {
      "label": "e.g. 'LAX/LGB → Local LA Basin (0-30 mi)'",
      "anchorPortCode": "USLAX" | "USLGB" | "USNYC" | ... | null,
      "anchorCity": "Los Angeles" | null,
      "anchorState": "CA" | null,
      "radiusMiles": number,
      "flatPrice": number,
      "equipmentScope": ["container_20", "container_40", ...]
    }
  ]
}

RULES:
- Use null for unknowns. Don't guess.
- Currency: assume USD unless the sheet clearly says CAD.
- If the sheet is ambiguous, lower the confidence and add to warnings.
- If you can't find anything parseable, return all arrays empty and warnings explaining why.
- Output ONLY the JSON. No backticks, no commentary.`;

export interface IngestResult {
  parsed: {
    summary: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
    rateCards: Array<Record<string, unknown>>;
    accessorials: Array<Record<string, unknown>>;
    laneZones: Array<Record<string, unknown>>;
  };
  raw: string;
  modelUsed: string;
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
  if (UNSUPPORTED_NEEDS_LIB[mt]) {
    throw new IngestUnsupportedError(mt, UNSUPPORTED_NEEDS_LIB[mt]);
  }

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
  } else if (SUPPORTED_TEXT_MIME.has(mt)) {
    const decoded = Buffer.from(opts.dataBase64, 'base64').toString('utf8');
    if (decoded.length > 50000) {
      throw new Error('Text file too large (>50KB). Try a smaller excerpt or convert to PDF.');
    }
    userContent = [
      { type: 'text', text: `Filename: ${opts.filename}\n\n${decoded}\n\nExtract the rate sheet into JSON per the spec.` },
    ];
  } else {
    throw new IngestUnsupportedError(mt, 'Supported types: PDF, PNG, JPEG, WEBP, GIF, plain text, CSV, HTML.');
  }

  const res = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  // Strip optional code fences (model sometimes adds them despite instructions)
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
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

  return { parsed, raw: cleaned, modelUsed: model };
}
