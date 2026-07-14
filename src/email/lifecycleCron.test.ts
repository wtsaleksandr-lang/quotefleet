/**
 * Lifecycle cron — marketing-compliance behavior.
 *
 * Asserts two things about a real cron tick (runOnce), with the DB and the
 * email transport mocked:
 *   1. A tenant with marketingOptOut=true is SKIPPED (no send).
 *   2. An opted-in tenant's welcome send passes a `listUnsubscribeUrl` to
 *      sendEmail (so the List-Unsubscribe header is attached) AND the tokenized
 *      unsubscribe link appears in the rendered HTML footer.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const { sendMock, rowsRef, updateMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  rowsRef: { current: [] as unknown[] },
  updateMock: vi.fn(),
}));

vi.mock('./send.js', () => ({ sendEmail: sendMock }));

vi.mock('../db/client.js', () => ({
  db: () => ({
    select: () => ({ from: () => ({ where: () => Promise.resolve(rowsRef.current) }) }),
    update: () => ({
      set: (v: unknown) => {
        updateMock(v);
        return { where: () => Promise.resolve() };
      },
    }),
  }),
}));

beforeAll(() => {
  if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'x'.repeat(64);
  if (!process.env.DATABASE_URL)
    process.env.DATABASE_URL = 'postgresql://dummy:dummy@localhost:5432/dummy';
  process.env.PUBLIC_BASE_URL = 'https://quotefleet.net';
});

function tenant(over: Record<string, unknown>): Record<string, unknown> {
  const trialEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // mid-trial
  return {
    id: 1,
    slug: 'acme',
    hostDomain: 'quotefleet.net',
    name: 'Acme',
    contactEmail: 'owner@acme.com',
    plan: 'free',
    trialEndsAt: trialEnd,
    lifecycleEmailsJson: null,
    marketingOptOut: false,
    ...over,
  };
}

describe('lifecycle cron marketing compliance', () => {
  beforeEach(() => {
    sendMock.mockReset();
    updateMock.mockReset();
    sendMock.mockResolvedValue({ ok: true, provider: 'resend' });
  });

  it('skips a tenant who opted out of marketing (no send)', async () => {
    rowsRef.current = [tenant({ id: 1, marketingOptOut: true })];
    const { runOnce } = await import('./lifecycleCron.js');
    await runOnce('test');
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('sends welcome to an opted-in tenant WITH a List-Unsubscribe url + visible footer link', async () => {
    rowsRef.current = [tenant({ id: 5, marketingOptOut: false })];
    const { runOnce } = await import('./lifecycleCron.js');
    await runOnce('test');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0][0] as {
      listUnsubscribeUrl?: string;
      html?: string;
      text?: string;
    };
    // Header input present + tokenized for THIS tenant.
    expect(arg.listUnsubscribeUrl).toContain('https://quotefleet.net/unsubscribe?token=');
    const { verifyUnsubscribeToken } = await import('./unsubscribe.js');
    const token = decodeURIComponent(arg.listUnsubscribeUrl!.split('token=')[1]);
    expect(verifyUnsubscribeToken(token)).toBe(5);
    // Visible footer link in the rendered HTML + plain-text parity.
    expect(arg.html).toContain('Unsubscribe from product updates');
    expect(arg.html).toContain(arg.listUnsubscribeUrl!);
    expect(arg.text).toContain('Unsubscribe:');
  });
});
