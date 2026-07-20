/**
 * Customer-service chat agent. A lead can chat after receiving their
 * quote (link in the auto-reply email points to /chat/:refId).
 *
 * Tools are limited compared to rate-agent: it can recompute a quote
 * (no DB writes) and summarise but can't change rate cards. Anything
 * the customer wants changed bubbles up to the lead's status.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  tenants,
  aiConfigs,
  leads,
  conversations,
  type Tenant,
} from '../db/schema.js';
import { complete } from './client.js';
import { leadChatSystemPrompt } from './prompts.js';
import { formatEmailMoney } from '../email/templates.js';
import {
  labelSummaryCurrency,
  quoteCurrencySymbol,
  resolveQuoteCurrency,
  type QuoteCurrency,
} from './quoteCurrency.js';

export async function leadChatTurn(
  tenantId: number,
  leadId: number,
  userMessage: string
): Promise<string> {
  const t = await db().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = t[0];
  if (!tenant) throw new Error('Tenant not found');
  const aiRow = await db()
    .select()
    .from(aiConfigs)
    .where(eq(aiConfigs.tenantId, tenantId))
    .limit(1);
  const ai = aiRow[0] ?? null;

  const leadRow = await db().select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const lead = leadRow[0];
  if (!lead || lead.tenantId !== tenantId) throw new Error('Lead not found');

  await db().insert(conversations).values({
    tenantId,
    leadId,
    channel: 'lead_chat',
    role: 'user',
    content: userMessage,
  });

  const history = await db()
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.leadId, leadId),
        eq(conversations.channel, 'lead_chat')
      )
    )
    .orderBy(conversations.createdAt)
    .limit(30);
  const messages = history.map((h) => ({
    role: (h.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: h.content,
  }));

  // The quote was priced in the carrier's own currency at lead-creation time,
  // so `lead.quotedCurrency` is the only correct label for every amount in the
  // chat. Feed it to BOTH ends: the prompt (so the model writes "CA$"), and the
  // quote context below (so it never sees a bare "$" to copy).
  const currency: QuoteCurrency = resolveQuoteCurrency(lead.quotedCurrency);

  // Quote context as system suffix.
  // Currency LABEL only — formatEmailMoney never converts or alters the amount
  // (same en-US locale and 2dp as the `toFixed(2)` it replaces).
  const ctx = `Quote context:
Ref: ${lead.refId}
Service: ${lead.service} (${lead.equipment})
Pickup: ${[lead.pickupCity, lead.pickupState].filter(Boolean).join(', ')}
Delivery: ${[lead.deliveryCity, lead.deliveryState].filter(Boolean).join(', ')}
Distance: ${lead.distanceMiles ? Math.round(lead.distanceMiles) + ' mi' : 'unknown'}
Currency: ${currency} (label every amount with "${quoteCurrencySymbol(currency)}")
Total quoted: ${
    typeof lead.quotedTotal === 'number' ? formatEmailMoney(lead.quotedTotal, currency) : '?'
  }`;

  const sys =
    leadChatSystemPrompt(tenant as Tenant, ai, currency) +
    '\n\n' +
    ctx;

  const out = await complete({
    tenantId,
    system: sys,
    messages,
    maxTokens: 600,
  });

  // Belt-and-braces: if the model wrote a bare "$" anyway, re-label it. Symbol
  // only — no amount is ever recomputed here. This response is NOT streamed
  // (`complete` resolves the full text), so post-formatting cannot corrupt a
  // partial chunk. It also runs BEFORE the row is persisted: history is replayed
  // into later turns, so an unlabelled reply stored now would be a bare "$" in
  // the model's own context on the next turn — exactly the copy-the-input bug.
  const reply =
    labelSummaryCurrency(out.text.trim(), currency) ||
    'Let me check with dispatch and get back to you shortly.';

  await db().insert(conversations).values({
    tenantId,
    leadId,
    channel: 'lead_chat',
    role: 'assistant',
    content: reply,
  });

  return reply;
}
