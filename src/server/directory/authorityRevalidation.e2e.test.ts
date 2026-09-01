/**
 * THE BOT GATE, ASSERTED ON THE WIRE.
 *
 * WHY THIS EXISTS ALONGSIDE authorityRevalidation.test.ts: that file proves the
 * gate LOGIC. This one proves the gate is actually WIRED — it boots the real
 * `createApp()` (full middleware chain, rate limiters, route registration order)
 * on a real socket and drives the endpoint with real HTTP requests carrying real
 * crawler user-agents. A refactor that dropped the `mayRevalidate` call from the
 * route, or registered the handler ahead of the gate, would pass every unit test
 * in the sibling file and fail here. Same reasoning as
 * ./publicCacheHeaders.e2e.test.ts, which exists because handler-level tests all
 * passed while prod served the wrong header.
 *
 * THE STAKE: the link mesh made ~100% of 330,452 carrier profiles reachable and
 * Googlebot renders JavaScript. A gate that is present but unwired means
 * hundreds of thousands of requests to a government API.
 *
 * THE TEST CAN FAIL. `FMCSA_WEBKEY` is set and the FMCSA client is a spy, so a
 * request that gets past the gate DOES record a call — proven by the positive
 * control ('a genuine first-party browser fetch DOES reach FMCSA'). Without that
 * control, "never called" would also be satisfied by a broken endpoint.
 *
 * Nothing here touches the network or a database: the FMCSA client is mocked and
 * the DB is stubbed, so CI never spends an FMCSA request and the suite cannot be
 * broken by a dev DB over quota.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { CarrierComplianceSnapshot } from './fmcsaLookup.js';

// ── The FMCSA client, spied ────────────────────────────────────────────────
const QC_ACTIVE: CarrierComplianceSnapshot = {
  found: true,
  usdot: '107080',
  mcNumber: 'MC1319157',
  legalName: 'ACME TRUCKING INC',
  dbaName: null,
  city: 'Savannah',
  state: 'GA',
  allowedToOperate: 'Y',
  authority: { common: 'A', contract: 'N', broker: 'N' },
  insurance: { bipdOnFile: '750', bipdRequired: '750', cargoRequired: 'N' },
  safetyRating: null,
  outOfService: false,
  outOfServiceDate: null,
  powerUnits: 3,
  drivers: 3,
  note: null,
};

const spies = vi.hoisted(() => ({ lookup: null as unknown as ReturnType<typeof vi.fn> }));
spies.lookup = vi.fn(async () => QC_ACTIVE);

vi.mock('./fmcsaLookup.js', () => ({ lookupCarrierCompliance: spies.lookup }));

// ── DB stub ────────────────────────────────────────────────────────────────
// Same chaining proxy as publicCacheHeaders.e2e.test.ts, with `execute` wired to
// a settable result so readAuthorityCache() can report "carrier exists, nothing
// cached" without a live Postgres.
let execRows: unknown[] = [{ status: null, checked_at: null }];

function chain(): unknown {
  const target = () => chain();
  return new Proxy(target, {
    get: (_t, prop) => {
      if (prop === 'execute') return async () => execRows;
      if (prop === 'then') {
        return (onFulfilled: (v: unknown[]) => unknown) => Promise.resolve([]).then(onFulfilled);
      }
      return () => chain();
    },
    apply: () => chain(),
  });
}

vi.mock('../../db/client.js', () => ({
  db: () => chain(),
  pool: { query: async () => ({ rows: [] }) },
  closeDb: async () => {},
}));

// ── Real server on a real socket ───────────────────────────────────────────
let server: Server;
let base = '';

beforeAll(async () => {
  process.env.SESSION_SECRET ||= 'test'.repeat(16);
  process.env.DATABASE_URL ||= 'postgresql://user:pw@127.0.0.1:1/db';
  // Set so the gate is the ONLY thing that can stop a lookup — an unset webkey
  // would short-circuit before the network and make every assertion vacuous.
  process.env.FMCSA_WEBKEY = 'test-webkey-not-a-real-credential';
  const { createApp } = await import('../app.js');
  server = createServer(createApp());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
});

beforeEach(async () => {
  spies.lookup.mockClear();
  execRows = [{ status: null, checked_at: null }];
  const mod = await import('./authorityRevalidation.js');
  mod.__resetInFlight();
});

const PATH = '/api/directory/carrier/107080/authority';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * `app.set('trust proxy', 1)` means the rate limiter keys on X-Forwarded-For, so
 * giving each request its own source IP keeps the 30/min per-IP limiter from
 * answering 429 and making a "never called FMCSA" assertion pass for the wrong
 * reason. Every assertion below also checks the response BODY, so a 429 that
 * slipped through would still fail rather than silently satisfy the test.
 */
let ipSeq = 0;
const nextIp = () => `203.0.113.${(ipSeq++ % 200) + 1}`;

interface AuthorityBody {
  status: string;
  live: boolean;
  checkedAt: string | null;
  checkedLabel: string | null;
  reason: string;
}

async function hit(headers: Record<string, string>): Promise<{ status: number; body: AuthorityBody }> {
  const res = await fetch(`${base}${PATH}`, {
    headers: { 'x-forwarded-for': nextIp(), ...headers },
  });
  return { status: res.status, body: (await res.json()) as AuthorityBody };
}

/** Everything our own page script sends. */
const firstParty = (ua: string): Record<string, string> => ({
  'user-agent': ua,
  'x-qf-authority-check': '1',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
});

/**
 * Verbatim production crawler user-agents, including Googlebot's
 * JavaScript-RENDERING pass — the one that would actually reach a client-hydrated
 * endpoint. The sibling unit test sweeps a wider list; this is the set driven
 * through the real HTTP stack.
 */
const CRAWLERS: ReadonlyArray<[string, string]> = [
  ['Googlebot desktop', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [
    'Googlebot smartphone',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.76 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ],
  [
    'Googlebot WRS (renders JS)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.6422.76 Safari/537.36',
  ],
  [
    'Google-InspectionTool',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)',
  ],
  ['GoogleOther', 'Mozilla/5.0 (compatible; GoogleOther)'],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['Yahoo Slurp', 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
  ['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
  ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
  ['Baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
  [
    'Applebot',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  ],
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
  [
    'ClaudeBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  ],
  ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
  ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
];

describe('/api/directory/carrier/:usdot/authority — the bot gate on the wire', () => {
  it.each(CRAWLERS)('%s never reaches FMCSA', async (_name, ua) => {
    // Handed EVERY first-party signal our own script sends, so the user-agent is
    // the only thing that can stop it.
    const { status, body } = await hit(firstParty(ua));
    expect(status).toBe(200);
    expect(body.reason).toBe('crawler');
    expect(body.live).toBe(false);
    expect(body.status).toBe('unknown');
    expect(body.checkedAt).toBeNull();
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  it('a bare GET with a browser UA but no first-party header never reaches FMCSA', async () => {
    const { status, body } = await hit({ 'user-agent': CHROME });
    expect(status).toBe(200);
    expect(body.reason).toBe('not-first-party');
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  it('a navigation (Sec-Fetch-Site: none) never reaches FMCSA', async () => {
    const { body } = await hit({ ...firstParty(CHROME), 'sec-fetch-site': 'none' });
    expect(body.reason).toBe('not-first-party');
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  it('a cross-site fetch never reaches FMCSA', async () => {
    const { body } = await hit({ ...firstParty(CHROME), 'sec-fetch-site': 'cross-site' });
    expect(body.reason).toBe('not-first-party');
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  it('a request with no user-agent at all never reaches FMCSA', async () => {
    const res = await fetch(`${base}${PATH}`, {
      headers: {
        'x-forwarded-for': nextIp(),
        'x-qf-authority-check': '1',
        'sec-fetch-site': 'same-origin',
        // undici always sends a UA, so blank it explicitly.
        'user-agent': '',
      },
    });
    const body = (await res.json()) as AuthorityBody;
    expect(body.live).toBe(false);
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  /**
   * POSITIVE CONTROL. Without this, every assertion above would also pass on an
   * endpoint that was broken, unregistered or 500ing.
   */
  it('a genuine first-party browser fetch DOES reach FMCSA', async () => {
    const { status, body } = await hit(firstParty(CHROME));
    expect(status).toBe(200);
    expect(spies.lookup).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ status: 'active', live: true, reason: 'fresh' });
    // `\w{3,4}`, not `\w{3}`: en-GB abbreviates September to the four-letter
    // "Sept", so this assertion started failing on 1 September 2026 for every
    // PR in the repo. The formatter is right — the regex was wrong to assume
    // every short month name is exactly three letters.
    expect(body.checkedLabel).toMatch(/^\d{1,2} \w{3,4} \d{4}$/);
  });

  it('serves a cached result without calling FMCSA', async () => {
    execRows = [{ status: 'inactive', checked_at: new Date().toISOString() }];
    const { body } = await hit(firstParty(CHROME));
    expect(spies.lookup).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: 'inactive', live: true, reason: 'cached' });
  });

  it('404s a USDOT the directory does not carry, without proxying FMCSA', async () => {
    // An open proxy here would let anyone enumerate the national registry
    // through us, and would spend our request budget doing it.
    execRows = [];
    const res = await fetch(`${base}/api/directory/carrier/999999999/authority`, {
      headers: { 'x-forwarded-for': nextIp(), ...firstParty(CHROME) },
    });
    expect(res.status).toBe(404);
    expect(spies.lookup).not.toHaveBeenCalled();
  });

  it('is never stored in a shared cache', async () => {
    const res = await fetch(`${base}${PATH}`, {
      headers: { 'x-forwarded-for': nextIp(), ...firstParty(CHROME) },
    });
    await res.arrayBuffer();
    // The profile HTML is deliberately shared-cacheable and byte-identical; this
    // answer is per-carrier-per-moment and must never be pinned onto that URL.
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/);
  });
});
