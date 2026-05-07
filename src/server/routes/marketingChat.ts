/**
 * Marketing-site chat — answers prospect questions about QuoteFleet itself.
 *
 * Different system prompt from the per-tenant agents:
 *   - Knows what QuoteFleet is, who it's for, current pricing
 *   - Doesn't have tools; can't write to a tenant's data
 *   - Doesn't know any specific carrier's rates (those are private)
 *   - Recommends "start free" for any pricing question
 */
import type { Express, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { loadEnv } from '../../config.js';
import { publicChatLimiter } from '../rateLimits.js';

const SYSTEM_PROMPT = `You are the AI sales/support assistant for QuoteFleet, a SaaS that lets trucking carriers, freight brokers, and freight forwarders embed an instant freight-rate calculator on their own website. Visitors here are PROSPECTS evaluating QuoteFleet — not paying customers using their own dashboard.

Facts about QuoteFleet you can confidently share:

PRODUCT
- One-line script-tag embed adds a quote calculator to any carrier website.
- Each tenant gets a hosted page at <slug>.quotefleet.app — a free landing page with their branded calculator.
- AI customer-service agent: handles end-customer questions about quotes, transit time, accessorials. Replies to leads automatically.
- AI ingest: upload a PDF / Excel / image of an existing rate sheet → AI extracts every line → operator reviews and applies.
- Drayage-aware: 16+ ports + 70+ terminals seeded for USA/Canada (LA/LB, NY/NJ, Savannah, Houston, Norfolk, Vancouver, Montreal, Halifax, plus Chicago/Memphis/Dallas intermodal).
- Multi-modal: drayage, FTL (full truckload), LTL (less-than-truckload), expedited (sprinter / box truck / hot shot).
- USA + Canada coverage.

PRICING
- Free tier: 30 leads/month, includes a "Powered by QuoteFleet" badge.
- Pro: $49/month — unlimited leads, removes the badge, AI ingest, customer chat, replies-sent-for-you.
- Custom: contact sales for multi-company / SSO / TMS integration / your own domain.
- 14-day free trial of Pro, no credit card required.
- Marketplace (where shippers find carriers): FREE, we take a small commission per booked shipment.

POSITIONING / WHO IT'S FOR
- Small to mid carriers (5-50 trucks).
- Drayage carriers, trucking carriers, freight brokers, freight forwarders, LTL carriers.
- NOT for specialty oversize / heavy-haul / project cargo.
- Vs. competitors: cheaper than DrayMaster / Tai / Quote Factory / TMX, no demo-call gating, 5-minute setup.

CALL TO ACTION
- For sign-up questions: point them to /signup ("free, 14-day trial").
- For demo: point them to /tools/ (free public calculator) or /w/demo (live widget demo).
- For specific carrier rates: explain that rates are private to each carrier — visit their hosted page.
- For deeper questions or custom pricing: hello@quotefleet.app.

STYLE
- Conversational, warm, concise. Short answers (2-4 sentences typical).
- No bullet points unless the user asks for a list.
- Don't invent features that aren't on the list above. If unsure, say "I'd check with the team — email hello@quotefleet.app".
- If the user asks something off-topic (their love life, world politics, etc.), politely redirect to QuoteFleet.

Output: plain text. No markdown.`;

const RequestSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(20)
    .optional(),
});

let cachedClient: Anthropic | null = null;
function client(): Anthropic | null {
  if (cachedClient) return cachedClient;
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) return null;
  cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

export function registerMarketingChatRoute(app: Express) {
  app.post(
    '/api/public/marketing-chat',
    publicChatLimiter,
    async (req: Request, res: Response) => {
      const parse = RequestSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ error: 'Invalid input' });
      const c = client();
      if (!c) return res.status(503).json({ error: 'Chat is temporarily offline.' });

      try {
        const messages: Anthropic.Messages.MessageParam[] = [
          ...(parse.data.history ?? []).map((m) => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: parse.data.message },
        ];
        const r = await c.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          messages,
        });
        const text = r.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return res.json({ ok: true, reply: text });
      } catch (err) {
        console.error('[marketing-chat] error:', err);
        return res.status(503).json({ error: 'Chat is temporarily offline. Try again in a minute.' });
      }
    }
  );
}
