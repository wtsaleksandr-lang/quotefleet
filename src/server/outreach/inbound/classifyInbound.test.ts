/**
 * classifyInbound unit tests — everything injected, no network / AI vendor.
 * Proves:
 *   - looksAutomatedSender drops obvious no-reply / bounce / newsletter / DSN mail.
 *   - Layer-1 drop happens BEFORE any AI call (stub never invoked).
 *   - broker/carrier → worth; shipper_rfq/vendor/newsletter → drop.
 *   - FAIL-CLOSED: stub throws, returns garbage, returns an inconsistent verdict,
 *     or the spend ceiling is hit → worth=false.
 *   - The attacker-controlled subject/body are fenced in the model payload.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyInbound,
  looksAutomatedSender,
  type ClassifyInboundDeps,
  type InboundVerdict,
} from './classifyInbound.js';
import type { ChatCompletion } from '../../../ai/client.js';

/** A `complete` stub that returns fixed text and records how it was called.
 *  Returns the raw vi.fn (so `.mock` is well-typed); cast to `complete` at the
 *  call site via the deps object. */
function stub(text: string) {
  return vi.fn(async (..._args: unknown[]) =>
    ({ text, toolUses: [], stopReason: 'end_turn' }) as ChatCompletion,
  );
}

function verdictJson(v: Partial<InboundVerdict> & { worth: boolean }): string {
  return JSON.stringify({ category: 'vendor', reason: 'x', ...v });
}

const brokerEmail = {
  senderEmail: 'dana@brokerco.com',
  subject: 'Reefer capacity out of Long Beach',
  body: "Hi — we're a freight brokerage moving reefer loads and want to set up lanes with your carriers.",
};

describe('looksAutomatedSender', () => {
  it('drops no-reply / bounce / newsletter localparts', () => {
    expect(looksAutomatedSender('no-reply@brokerco.com', 'Hi')).toBe(true);
    expect(looksAutomatedSender('bounce+123@mailer.com', 'Hi')).toBe(true);
    expect(looksAutomatedSender('newsletter@freightwaves.com', 'Weekly digest')).toBe(true);
    expect(looksAutomatedSender('mailer-daemon@x.com', 'Hi')).toBe(true);
  });
  it('drops DSN / auto-reply subjects regardless of sender', () => {
    expect(looksAutomatedSender('dana@brokerco.com', 'Automatic reply: out today')).toBe(true);
    expect(looksAutomatedSender('dana@brokerco.com', 'Undeliverable: your message')).toBe(true);
    expect(looksAutomatedSender('dana@brokerco.com', 'Unsubscribe from our list')).toBe(true);
  });
  it('passes a normal human sender + subject', () => {
    expect(looksAutomatedSender('dana@brokerco.com', 'Reefer capacity')).toBe(false);
  });
});

describe('classifyInbound — layer 1 (deterministic drop)', () => {
  it('drops an automated sender WITHOUT calling the AI', async () => {
    const complete = stub(verdictJson({ worth: true, category: 'broker' }));
    const v = await classifyInbound(
      { senderEmail: 'no-reply@brokerco.com', subject: 'News', body: 'x' },
      { complete },
    );
    expect(v.worth).toBe(false);
    expect(v.category).toBe('noise');
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('classifyInbound — layer 2 (AI verdict)', () => {
  it('marks a broker pitch as worth', async () => {
    const complete = stub(verdictJson({ worth: true, category: 'broker', reason: 'broker pitch' }));
    const v = await classifyInbound(brokerEmail, { complete });
    expect(v).toEqual({ worth: true, category: 'broker', reason: 'broker pitch' });
  });

  it('marks a carrier pitch as worth', async () => {
    const complete = stub(verdictJson({ worth: true, category: 'carrier', reason: 'carrier intro' }));
    const v = await classifyInbound(brokerEmail, { complete });
    expect(v.worth).toBe(true);
    expect(v.category).toBe('carrier');
  });

  it('drops a shipper RFQ', async () => {
    const complete = stub(verdictJson({ worth: false, category: 'shipper_rfq', reason: 'shipper asking us' }));
    const v = await classifyInbound(brokerEmail, { complete });
    expect(v.worth).toBe(false);
    expect(v.category).toBe('shipper_rfq');
  });

  it('drops an unrelated vendor / SaaS pitch', async () => {
    const complete = stub(verdictJson({ worth: false, category: 'vendor', reason: 'saas spam' }));
    const v = await classifyInbound(brokerEmail, { complete });
    expect(v.worth).toBe(false);
    expect(v.category).toBe('vendor');
  });

  it('wraps the untrusted subject/body in fences in the model payload', async () => {
    const complete = stub(verdictJson({ worth: true, category: 'broker' }));
    await classifyInbound(brokerEmail, { complete });
    const arg = complete.mock.calls[0][0] as { messages: { content: string }[] };
    const userContent = arg.messages[0].content;
    expect(userContent).toContain('<<<UNTRUSTED_INBOUND_EMAIL>>>');
    expect(userContent).toContain('<<<END_UNTRUSTED_INBOUND_EMAIL>>>');
    expect(userContent).toContain(brokerEmail.subject);
  });
});

describe('classifyInbound — FAIL-CLOSED', () => {
  it('fails closed when the model throws', async () => {
    const complete = vi.fn(async () => {
      throw new Error('AI down');
    }) as unknown as NonNullable<ClassifyInboundDeps['complete']>;
    const v = await classifyInbound(brokerEmail, { complete });
    expect(v.worth).toBe(false);
    expect(v.category).toBe('noise');
  });

  it('fails closed on unparseable model output', async () => {
    const v = await classifyInbound(brokerEmail, { complete: stub('this is not json at all') });
    expect(v.worth).toBe(false);
  });

  it('fails closed on an INCONSISTENT verdict (worth=true but category=vendor)', async () => {
    const v = await classifyInbound(brokerEmail, {
      complete: stub(verdictJson({ worth: true, category: 'vendor' })),
    });
    expect(v.worth).toBe(false);
    expect(v.category).toBe('vendor');
  });

  it('fails closed (and skips the AI) when the spend ceiling is hit', async () => {
    const complete = stub(verdictJson({ worth: true, category: 'broker' }));
    const v = await classifyInbound(brokerEmail, { complete, allow: () => false });
    expect(v.worth).toBe(false);
    expect(v.category).toBe('noise');
    expect(complete).not.toHaveBeenCalled();
  });
});
