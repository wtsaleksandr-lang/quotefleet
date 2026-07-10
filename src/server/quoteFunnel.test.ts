/**
 * Guards for the persona-audit quote-funnel wave:
 *   - submit links the customer to the polished hosted quote (quoteUrl)
 *   - the hosted quote has an Accept/Request-booking flow that records intent
 *     as lead status `booking_requested`
 *   - transit-time estimate is surfaced on the calc result + hosted quote
 *   - a chat 429 can NEVER blank the hosted quote: the quote-doc GET (and the
 *     view/activity beacon) use the generous doc limiter, NOT the chat limiter
 *
 * Source-level assertions in the same style as quoteCredibility.test.ts, so a
 * future edit that re-couples the doc read to the chat limiter, drops the
 * accept flow, or orphans the hosted quote fails CI immediately.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');
const serverDir = resolve(process.cwd(), 'src/server');

const pub = (n: string) => readFile(resolve(publicDir, n), 'utf8');
const route = (n: string) => readFile(resolve(routesDir, n), 'utf8');
const srv = (n: string) => readFile(resolve(serverDir, n), 'utf8');

describe('submit links the customer to the polished hosted quote', () => {
  it('lead response returns a quoteUrl to /quote/:ref', async () => {
    const p = await route('public.ts');
    expect(p).toContain('quoteUrl: `${publicBase}/quote/${encodeURIComponent(refId)}`');
  });

  it('widget surfaces a View-your-full-quote action after submit', async () => {
    const html = await pub('widget.html');
    const js = await pub('widget.js');
    expect(html).toContain('id="qf-view-quote"');
    expect(js).toContain("$('qf-view-quote')");
    expect(js).toContain('resp.quoteUrl');
  });
});

describe('accept / request booking on the hosted quote', () => {
  it('public accept route records intent as booking_requested and notifies the carrier', async () => {
    const p = await route('public.ts');
    expect(p).toContain("app.post(\n    '/api/public/accept/:refId'");
    // status transition — booking_requested, but never downgrade a won lead
    expect(p).toContain("lead.status === 'won' ? 'won' : 'booking_requested'");
    expect(p).toMatch(/\.update\(leads\)[\s\S]*status: nextStatus/);
    // best-effort carrier notification, same pattern as the callback path
    expect(p).toContain('[public/accept] notify failed (non-fatal):');
  });

  it('booking_requested is an accepted lead status in the dashboard PATCH', async () => {
    const t = await route('tenant.ts');
    expect(t).toContain("'replied', 'booking_requested', 'won'");
  });

  it('dashboard renders the booking_requested status', async () => {
    const js = await pub('app.js');
    expect(js).toContain('booking_requested');
    expect(js).toContain("booking_requested: 'Booking requested'");
  });

  it('hosted quote exposes the accept CTA + panel and posts to the accept route', async () => {
    const html = await pub('quote.html');
    const js = await pub('quote.js');
    expect(html).toContain('id="qdoc-accept-open"');
    expect(html).toContain('id="qdoc-accept-send"');
    expect(js).toContain('/api/public/accept/');
    expect(js).toContain('function sendAccept');
  });
});

describe('transit-time estimate', () => {
  it('is computed from distance + service on both surfaces', async () => {
    const p = await route('public.ts');
    const q = await route('quoteDoc.ts');
    expect(p).toContain('estimateTransit(dist.miles, body.service)');
    expect(q).toContain('estimateTransit(lead.distanceMiles, lead.service)');
  });

  it('is rendered as an estimate on the calc result + hosted quote', async () => {
    const widget = await pub('widget.js');
    const quote = await pub('quote.js');
    expect(widget).toContain('Est. transit');
    expect(widget).toContain('resp.transit');
    expect(quote).toContain('data.quote.transit');
  });
});

describe('a chat 429 can never blank the hosted quote', () => {
  it('the quote-doc GET is NOT gated by the chat limiter', async () => {
    const q = await route('quoteDoc.ts');
    expect(q).toContain('publicDocLimiter');
    expect(q).not.toContain('publicChatLimiter');
    // the doc read specifically uses the generous doc limiter
    expect(q).toContain("app.get('/api/public/quote-doc/:refId', publicDocLimiter");
  });

  it('the activity/view beacon is also decoupled from the chat limiter', async () => {
    const a = await route('quoteActivity.ts');
    expect(a).toContain('publicDocLimiter');
    expect(a).not.toContain('publicChatLimiter');
  });

  it('the doc limiter is generous relative to the chat limiter', async () => {
    const rl = await srv('rateLimits.ts');
    expect(rl).toContain('export const publicDocLimiter');
    // 120/min doc reads vs 12/min chat — a chat burst can't exhaust doc reads
    expect(rl).toMatch(/publicDocLimiter[\s\S]*limit:\s*120/);
  });
});
