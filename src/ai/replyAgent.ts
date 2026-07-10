/**
 * Auto-reply email generator. Called when a new lead lands. Produces
 * a plain-text email body that summarises the quote in a friendly,
 * professional tone. We don't actually send here — that's the email
 * helper's job. We just generate the body.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, aiConfigs, leads, type Tenant, type Lead } from '../db/schema.js';
import { complete } from './client.js';
import { leadReplySystemPrompt } from './prompts.js';
import { customerFacingLines } from '../calc/engine.js';

export async function generateLeadReply(
  tenantId: number,
  leadId: number
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
  if (!lead) throw new Error('Lead not found');

  const sys = leadReplySystemPrompt(tenant as Tenant, ai);
  const summary = leadSummary(lead);
  const out = await complete({
    tenantId,
    system: sys,
    messages: [
      {
        role: 'user',
        content:
          `Generate the email body for this incoming quote request:\n\n${summary}\n\n` +
          `Output ONLY the email body. No subject, no signature beyond the company name. ` +
          `Plain text. 6-12 lines.`,
      },
    ],
    maxTokens: 800,
  });
  return out.text.trim();
}

function leadSummary(l: Lead): string {
  const lines: string[] = [];
  lines.push(`Ref: ${l.refId}`);
  lines.push(`Customer: ${l.customerName ?? '(unnamed)'} <${l.customerEmail ?? '?'}>`);
  if (l.customerPhone) lines.push(`Phone: ${l.customerPhone}`);
  if (l.customerCompany) lines.push(`Company: ${l.customerCompany}`);
  lines.push(`Service: ${l.service} — ${l.equipment}`);
  lines.push(
    `Pickup:   ${[l.pickupCity, l.pickupState, l.pickupZip, l.pickupCountry].filter(Boolean).join(', ')}`
  );
  lines.push(
    `Delivery: ${[l.deliveryCity, l.deliveryState, l.deliveryZip, l.deliveryCountry].filter(Boolean).join(', ')}`
  );
  if (l.distanceMiles) lines.push(`Distance: ${Math.round(l.distanceMiles)} mi`);
  if (l.weightLbs) lines.push(`Weight: ${l.weightLbs} lbs`);
  if (l.pickupDate) lines.push(`Pickup date: ${l.pickupDate}`);
  if (l.deliveryDate) lines.push(`Delivery date: ${l.deliveryDate}`);
  if (l.commodity) lines.push(`Commodity: ${l.commodity}`);
  if (l.accessorialCodes && l.accessorialCodes.length) {
    lines.push(`Accessorials selected: ${l.accessorialCodes.join(', ')}`);
  }
  lines.push(`Quoted total: $${l.quotedTotal?.toFixed(2) ?? '?'}`);
  // Customer-facing email: fold the carrier's margin into linehaul so the
  // reply never exposes their markup (total is unchanged).
  const customerBreakdown = customerFacingLines(l.breakdownJson as Parameters<typeof customerFacingLines>[0]);
  if (customerBreakdown.length) {
    lines.push('Breakdown:');
    for (const item of customerBreakdown) {
      lines.push(`  - ${item.name}: $${(Number(item.amount) || 0).toFixed(2)}`);
    }
  }
  if (l.notes) lines.push(`Notes: ${l.notes}`);
  return lines.join('\n');
}
