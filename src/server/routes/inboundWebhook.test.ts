/**
 * PUBLIC harvest-webhook tests — the Cloudflare-Worker-facing auto-catch, all
 * DB-free / network-free via injected fakes. Proves:
 *   - 503 when INBOUND_WEBHOOK_SECRET is unset (feature disabled);
 *   - 401 on a missing / wrong secret when one IS set;
 *   - 200 + the handler called with the mapped input on a valid secret + explicit
 *     `{ from, subject, text }` body;
 *   - 200 + a raw .eml parsed (real mailparser) into the pipeline fields;
 *   - constant-time compare: a WRONG-LENGTH secret still 401s (no throw).
 *
 * The route reads the secret through an injected `loadEnv`, and calls an injected
 * `handle`, so no real env / DB / mailbox is touched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerInboundWebhookRoutes } from './inboundWebhook.js';
import type {
  HandleHarvestedEmailInput,
  HandleHarvestedEmailResult,
} from '../outreach/inbound/handleHarvestedEmail.js';

const SECRET = 'harvest-shared-secret-abc123';

// A realistic forwarded broker email (raw RFC 822).
const RAW_EML = [
  'From: "Sam Rivera" <sam@acme-freight.com>',
  'To: harvest@quotefleet.net',
  'Subject: Spot capacity this week?',
  'Message-ID: <deal-9931@acme-freight.com>',
  'References: <thread-1@acme-freight.com> <thread-2@acme-freight.com>',
  'Date: Fri, 01 Aug 2026 09:12:00 -0400',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi there,',
  '',
  'We have vans running the Midwest lanes and are quoting spot loads.',
  'Happy to send our rate sheet.',
  '',
  'Thanks,',
  'Sam Rivera',
  '',
].join('\r\n');

interface Recorder {
  handled: HandleHarvestedEmailInput[];
}

/** Boot an app with the route wired to a fake handler + a configurable secret. */
async function bootServer(opts: { secret?: string; rec: Recorder }): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  registerInboundWebhookRoutes(app, {
    loadEnv: () => ({ INBOUND_WEBHOOK_SECRET: opts.secret }),
    handle: async (input): Promise<HandleHarvestedEmailResult> => {
      opts.rec.handled.push(input);
      return { status: 'drafted', inboundProspectId: 7, demoToken: 'tok_z', outreachEmailId: 20 };
    },
  });
  const server: Server = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, baseUrl };
}

function post(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/api/inbound/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function jsonOf(res: globalThis.Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/inbound/webhook — auth', () => {
  let server: Server;
  let baseUrl: string;
  const rec: Recorder = { handled: [] };

  describe('secret unset', () => {
    let s2: Server;
    let url2: string;
    const rec2: Recorder = { handled: [] };
    beforeAll(async () => { ({ server: s2, baseUrl: url2 } = await bootServer({ secret: undefined, rec: rec2 })); });
    afterAll(async () => { await new Promise<void>((r) => s2.close(() => r())); });

    it('503 when INBOUND_WEBHOOK_SECRET is unset', async () => {
      const res = await post(url2, { from: 'sam@acme-freight.com', subject: 'hi', text: 'body' }, { 'X-Harvest-Secret': 'anything' });
      expect(res.status).toBe(503);
      expect(rec2.handled.length).toBe(0);
    });
  });

  describe('secret set', () => {
    beforeAll(async () => { ({ server, baseUrl } = await bootServer({ secret: SECRET, rec })); });
    afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

    it('401 on a missing secret', async () => {
      const res = await post(baseUrl, { from: 'sam@acme-freight.com', subject: 'hi', text: 'body' });
      expect(res.status).toBe(401);
      expect(rec.handled.length).toBe(0);
    });

    it('401 on a wrong (same-length) secret', async () => {
      const wrong = 'x'.repeat(SECRET.length);
      const res = await post(baseUrl, { from: 'sam@acme-freight.com', subject: 'hi', text: 'body' }, { 'X-Harvest-Secret': wrong });
      expect(res.status).toBe(401);
      expect(rec.handled.length).toBe(0);
    });

    it('401 on a WRONG-LENGTH secret without throwing (constant-time compare guards length)', async () => {
      const res = await post(baseUrl, { from: 'sam@acme-freight.com', subject: 'hi', text: 'body' }, { 'X-Harvest-Secret': 'short' });
      // A length mismatch must be a clean 401, never a 500 from timingSafeEqual.
      expect(res.status).toBe(401);
      expect((await jsonOf(res)).ok).toBe(false);
    });

    it('200 + handler called with mapped input on a valid secret + explicit fields', async () => {
      const before = rec.handled.length;
      const res = await post(
        baseUrl,
        { from: 'Sam@Acme-Freight.com', subject: 'Spot capacity?', text: 'We run Midwest lanes.' },
        { 'X-Harvest-Secret': SECRET },
      );
      expect(res.status).toBe(200);
      const json = await jsonOf(res);
      expect(json.ok).toBe(true);
      expect(json.status).toBe('drafted');
      expect(json.inboundProspectId).toBe(7);
      expect(json.demoToken).toBe('tok_z');

      expect(rec.handled.length).toBe(before + 1);
      const passed = rec.handled[rec.handled.length - 1];
      expect(passed.harvestMailbox).toBe('harvest@quotefleet.net');
      expect(passed.fromEmail).toBe('sam@acme-freight.com'); // lowercased
      expect(passed.subject).toBe('Spot capacity?');
      expect(passed.bodyText).toBe('We run Midwest lanes.');
      expect(passed.references).toEqual([]);
    });

    it('also accepts Authorization: Bearer <secret>', async () => {
      const res = await post(
        baseUrl,
        { from: 'sam@acme-freight.com', subject: 'hi', text: 'body' },
        { Authorization: `Bearer ${SECRET}` },
      );
      expect(res.status).toBe(200);
    });

    it('200 + parses a raw .eml body into the pipeline fields', async () => {
      const before = rec.handled.length;
      const res = await post(baseUrl, { raw: RAW_EML }, { 'X-Harvest-Secret': SECRET });
      expect(res.status).toBe(200);
      expect((await jsonOf(res)).ok).toBe(true);

      expect(rec.handled.length).toBe(before + 1);
      const passed = rec.handled[rec.handled.length - 1];
      expect(passed.fromEmail).toBe('sam@acme-freight.com');
      expect(passed.subject).toBe('Spot capacity this week?');
      expect(passed.messageId).toBe('<deal-9931@acme-freight.com>');
      expect(passed.references).toEqual(['<thread-1@acme-freight.com>', '<thread-2@acme-freight.com>']);
      expect(passed.bodyText).toContain('Midwest lanes');
    });

    it('honors a `to` override for the harvest mailbox', async () => {
      const before = rec.handled.length;
      const res = await post(
        baseUrl,
        { from: 'sam@acme-freight.com', subject: 'hi', text: 'body', to: 'leads@quotefleet.net' },
        { 'X-Harvest-Secret': SECRET },
      );
      expect(res.status).toBe(200);
      expect(rec.handled[before].harvestMailbox).toBe('leads@quotefleet.net');
    });

    it('200 { ok:false } when no sender address can be found (no retry)', async () => {
      const before = rec.handled.length;
      const res = await post(baseUrl, { subject: 'hi', text: 'no sender' }, { 'X-Harvest-Secret': SECRET });
      expect(res.status).toBe(200);
      expect((await jsonOf(res)).ok).toBe(false);
      expect(rec.handled.length).toBe(before); // handler never called
    });
  });
});
