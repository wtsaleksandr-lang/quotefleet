/**
 * LIVE AUTHORITY REVALIDATION — the safety properties, locked in.
 *
 * The feature itself is small. What it must never do is not: this file is
 * mostly about the four ways it could go wrong.
 *
 *   1. A CRAWLER TRIGGERS AN FMCSA CALL. The link mesh made ~100% of 330,452
 *      carrier profiles reachable and Googlebot renders JavaScript, so a leak
 *      here is not "a few extra requests", it is hundreds of thousands of hits
 *      on a government API. The centrepiece is `never calls FMCSA for any real
 *      crawler user-agent` — it drives the real orchestration with 40 verbatim
 *      production crawler UA strings and asserts the lookup ran ZERO times.
 *   2. A FAILED LOOKUP DEGRADES THE PAGE. Every failure path must return the
 *      snapshot answer, never throw, never surface an error to a visitor.
 *   3. A PER-VIEW TIMESTAMP MANUFACTURES SITEMAP FRESHNESS. The cache columns
 *      must stay out of the ingest's change comparison — asserted against the
 *      real source files, not by convention.
 *   4. THE PAGE SILENTLY KEEPS SAYING "ACTIVE". The badge is now always in the
 *      markup and toggled with `hidden`, which an author `display` rule beats —
 *      so the CSS guard for that is asserted too.
 *
 * Every test here is offline. No test in this file may reach FMCSA: the lookup
 * is always an injected fake, so CI never spends a request on a live API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isCrawlerUserAgent,
  isFirstPartyFetch,
  mayRevalidate,
  liveAuthorityStatus,
  isCacheFresh,
  resolveAuthority,
  snapshotAuthorityAnswer,
  AuthorityBudget,
  AUTHORITY_TTL_MS,
  AUTHORITY_SELF_HEAL_STATEMENTS,
  BREAKER_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  FIRST_PARTY_HEADER,
  __resetInFlight,
  type AuthorityRequestHeaders,
  type RevalidationDeps,
} from './authorityRevalidation.js';
import type { CarrierComplianceSnapshot } from './fmcsaLookup.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

/**
 * A FROZEN QCMobile payload. The real shape, captured once, so the whole suite
 * runs offline — CI must never spend a request on FMCSA to test this.
 */
const QC_ACTIVE: CarrierComplianceSnapshot = {
  found: true,
  usdot: '3733285',
  mcNumber: 'MC1319157',
  legalName: 'EXAMPLE FREIGHT LLC',
  dbaName: null,
  city: 'CHICAGO',
  state: 'IL',
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

const QC_REVOKED: CarrierComplianceSnapshot = {
  ...QC_ACTIVE,
  allowedToOperate: 'N',
  authority: { common: 'I', contract: 'N', broker: 'N' },
};

const NOT_FOUND: CarrierComplianceSnapshot = {
  ...QC_ACTIVE,
  found: false,
  allowedToOperate: null,
  authority: { common: null, contract: null, broker: null },
  note: 'FMCSA did not respond.',
};

/** Headers of a genuine first-party fetch from our own page script. */
const BROWSER_HEADERS: AuthorityRequestHeaders = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  [FIRST_PARTY_HEADER]: '1',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
};

/**
 * VERBATIM production crawler user-agents. Not paraphrases — these are the
 * strings these agents actually send, including Googlebot's JavaScript-rendering
 * pass (which reports as modern Chrome with the Googlebot token appended and is
 * the one that would otherwise reach a client-hydrated endpoint).
 */
const REAL_CRAWLER_UAS: ReadonlyArray<[string, string]> = [
  ['Googlebot desktop', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  [
    'Googlebot smartphone',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.76 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ],
  [
    'Googlebot WRS (JS render pass)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.6422.76 Safari/537.36',
  ],
  [
    'Google-InspectionTool',
    'Mozilla/5.0 (compatible; Google-InspectionTool/1.0; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)',
  ],
  ['GoogleOther', 'Mozilla/5.0 (compatible; GoogleOther)'],
  ['Google-Extended', 'Mozilla/5.0 (compatible; Google-Extended/1.0)'],
  ['AdsBot-Google', 'AdsBot-Google (+http://www.google.com/adsbot.html)'],
  ['Storebot-Google', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 (compatible; Storebot-Google/1.0)'],
  ['Chrome-Lighthouse', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Chrome-Lighthouse'],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  [
    'bingbot (Chrome render)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  ],
  ['msnbot', 'msnbot/2.0b (+http://search.msn.com/msnbot.htm)'],
  ['Yahoo Slurp', 'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)'],
  ['DuckDuckBot', 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
  ['Baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
  ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
  ['Applebot', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)'],
  ['PetalBot', 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)'],
  ['SeznamBot', 'Mozilla/5.0 (compatible; SeznamBot/4.0; +http://napoveda.seznam.cz/en/seznambot-intro/)'],
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
  ['OAI-SearchBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot'],
  ['ChatGPT-User', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'],
  ['ClaudeBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['PerplexityBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  ['CCBot', 'CCBot/2.0 (https://commoncrawl.org/faq/)'],
  ['Amazonbot', 'Mozilla/5.0 (Linux; like Android) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81.0.4044.117 Safari/537.36 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)'],
  ['Bytespider', 'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)'],
  ['meta-externalagent', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
  ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
  ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
  ['MJ12bot', 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)'],
  ['DotBot', 'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot)'],
  ['DataForSeoBot', 'Mozilla/5.0 (compatible; DataForSeoBot/1.0; +https://dataforseo.com/dataforseo-bot)'],
  ['Screaming Frog', 'Screaming Frog SEO Spider/21.0'],
  ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
  ['Twitterbot', 'Twitterbot/1.0'],
  ['LinkedInBot', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
  ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
  ['Discordbot', 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
  ['UptimeRobot', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
];

/** Real browser UAs that must NOT be classified as crawlers. */
const REAL_BROWSER_UAS: ReadonlyArray<[string, string]> = [
  ['Chrome / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'],
  ['Safari / iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
  ['Safari / macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
  ['Firefox / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'],
  ['Edge / Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'],
  ['Chrome / Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'],
  ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36'],
];

// ─── Test deps ──────────────────────────────────────────────────────────────

type TestDeps = RevalidationDeps & { lookup: ReturnType<typeof vi.fn> };

function makeDeps(over: Partial<RevalidationDeps> = {}): TestDeps {
  const base: RevalidationDeps = {
    readCache: async () => null,
    writeCache: async () => {},
    lookup: vi.fn(async () => QC_ACTIVE),
    budget: new AuthorityBudget(),
    webKeyConfigured: () => true,
    now: () => new Date('2026-08-30T12:00:00Z'),
    log: () => {},
  };
  return { ...base, ...over } as TestDeps;
}

beforeEach(() => __resetInFlight());

// ─────────────────────────────────────────────────────────────────────────────
describe('the bot gate', () => {
  it('classifies every real crawler user-agent as a crawler', () => {
    const missed = REAL_CRAWLER_UAS.filter(([, ua]) => !isCrawlerUserAgent(ua)).map(([name]) => name);
    expect(missed, `these crawler UAs were NOT detected: ${missed.join(', ')}`).toEqual([]);
  });

  it('does not classify a real browser as a crawler', () => {
    const wrong = REAL_BROWSER_UAS.filter(([, ua]) => isCrawlerUserAgent(ua)).map(([name]) => name);
    expect(wrong, `these browsers were wrongly flagged as crawlers: ${wrong.join(', ')}`).toEqual([]);
  });

  it('treats a missing or empty user-agent as a crawler (fails closed)', () => {
    expect(isCrawlerUserAgent(undefined)).toBe(true);
    expect(isCrawlerUserAgent('')).toBe(true);
    expect(isCrawlerUserAgent('   ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCrawlerUserAgent('MOZILLA/5.0 (COMPATIBLE; GOOGLEBOT/2.1)')).toBe(true);
  });

  /**
   * THE CENTREPIECE. Not a unit test of the predicate — it drives the real
   * orchestration end to end with each production crawler UA and asserts the
   * outbound lookup was never invoked. A regression that removed the gate but
   * kept the predicate would fail here.
   */
  it('never calls FMCSA for any real crawler user-agent', async () => {
    for (const [name, ua] of REAL_CRAWLER_UAS) {
      __resetInFlight();
      const deps = makeDeps();
      // Give the crawler EVERY first-party signal our own script sends, so the
      // UA list is the only thing that can be stopping it.
      const res = await resolveAuthority('3733285', { ...BROWSER_HEADERS, 'user-agent': ua }, deps);
      expect(deps.lookup, `${name} reached FMCSA`).not.toHaveBeenCalled();
      expect(res.live, `${name} got a live answer`).toBe(false);
      expect(res.reason).toBe('crawler');
      expect(res.status).toBe('unknown');
    }
  });

  it('does not even read the cache for a crawler', async () => {
    const readCache = vi.fn(async () => null);
    const deps = makeDeps({ readCache });
    await resolveAuthority('3733285', { ...BROWSER_HEADERS, 'user-agent': REAL_CRAWLER_UAS[0][1] }, deps);
    expect(readCache).not.toHaveBeenCalled();
  });

  it('rejects a request without our first-party header even from a real browser UA', async () => {
    const deps = makeDeps();
    const headers = { ...BROWSER_HEADERS };
    delete headers[FIRST_PARTY_HEADER];
    const res = await resolveAuthority('3733285', headers, deps);
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(res.reason).toBe('not-first-party');
  });

  it('rejects a cross-site or navigation Sec-Fetch-Site', () => {
    expect(isFirstPartyFetch({ ...BROWSER_HEADERS, 'sec-fetch-site': 'cross-site' })).toBe(false);
    expect(isFirstPartyFetch({ ...BROWSER_HEADERS, 'sec-fetch-site': 'none' })).toBe(false);
    expect(isFirstPartyFetch({ ...BROWSER_HEADERS, 'sec-fetch-mode': 'navigate' })).toBe(false);
  });

  it('tolerates absent Fetch-Metadata headers (older clients) but still needs the first-party header', () => {
    expect(isFirstPartyFetch({ 'user-agent': 'x', [FIRST_PARTY_HEADER]: '1' })).toBe(true);
    expect(isFirstPartyFetch({ 'user-agent': 'x' })).toBe(false);
  });

  it('mayRevalidate is true only for a genuine first-party browser fetch', () => {
    expect(mayRevalidate(BROWSER_HEADERS)).toBe(true);
    expect(mayRevalidate({ ...BROWSER_HEADERS, 'user-agent': REAL_CRAWLER_UAS[0][1] })).toBe(false);
    expect(mayRevalidate({})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('status mapping', () => {
  it('reads an active authority flag as active', () => {
    expect(liveAuthorityStatus(QC_ACTIVE)).toBe('active');
  });

  it('lets allowedToOperate=N override an active authority flag', () => {
    expect(liveAuthorityStatus({ ...QC_ACTIVE, allowedToOperate: 'N' })).toBe('inactive');
  });

  it('reads a revoked record as inactive', () => {
    expect(liveAuthorityStatus(QC_REVOKED)).toBe('inactive');
  });

  it('reads a record we could not find as unknown, never inactive', () => {
    // Absence of evidence is not evidence a real business lost its authority.
    expect(liveAuthorityStatus(NOT_FOUND)).toBe('unknown');
  });

  it('reads an uninterpretable record as unknown rather than downgrading the carrier', () => {
    expect(
      liveAuthorityStatus({ ...QC_ACTIVE, authority: { common: null, contract: null, broker: null } }),
    ).toBe('unknown');
  });

  it('accepts a broker-only or contract-only authority as active', () => {
    expect(liveAuthorityStatus({ ...QC_ACTIVE, authority: { common: 'N', contract: 'N', broker: 'A' } })).toBe('active');
    expect(liveAuthorityStatus({ ...QC_ACTIVE, authority: { common: 'N', contract: 'A', broker: 'N' } })).toBe('active');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the cache', () => {
  const now = new Date('2026-08-30T12:00:00Z');

  it('holds a result for seven days', () => {
    expect(AUTHORITY_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is fresh inside the window and stale outside it', () => {
    const justInside = new Date(now.getTime() - AUTHORITY_TTL_MS + 60_000);
    const justOutside = new Date(now.getTime() - AUTHORITY_TTL_MS - 60_000);
    expect(isCacheFresh({ status: 'active', checkedAt: justInside }, now)).toBe(true);
    expect(isCacheFresh({ status: 'active', checkedAt: justOutside }, now)).toBe(false);
  });

  it('treats an empty or half-written row as a miss', () => {
    expect(isCacheFresh(null, now)).toBe(false);
    expect(isCacheFresh({ status: null, checkedAt: now }, now)).toBe(false);
    expect(isCacheFresh({ status: 'active', checkedAt: null }, now)).toBe(false);
  });

  it('treats a future timestamp as stale (a clock problem, not freshness)', () => {
    expect(isCacheFresh({ status: 'active', checkedAt: new Date(now.getTime() + 60_000) }, now)).toBe(false);
  });

  /** REQUIREMENT: a second visitor inside the window must not hit FMCSA. */
  it('serves a second visitor from cache without calling FMCSA', async () => {
    const deps = makeDeps({
      readCache: async () => ({ status: 'active', checkedAt: new Date(now.getTime() - 60_000) }),
    });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: 'active', live: true, reason: 'cached' });
    expect(res.checkedLabel).toBe('30 Aug 2026');
  });

  it('refetches once the cached result has aged out', async () => {
    const deps = makeDeps({
      readCache: async () => ({ status: 'active', checkedAt: new Date(now.getTime() - AUTHORITY_TTL_MS - 1) }),
    });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(deps.lookup).toHaveBeenCalledTimes(1);
    expect(res.reason).toBe('fresh');
  });

  it('persists a fresh result with its timestamp', async () => {
    const writeCache = vi.fn(async () => {});
    const deps = makeDeps({ writeCache });
    await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(writeCache).toHaveBeenCalledWith('3733285', 'active', new Date('2026-08-30T12:00:00Z'));
  });

  it('shares ONE upstream call across simultaneous first-visitors to the same carrier', async () => {
    let release: (v: CarrierComplianceSnapshot) => void = () => {};
    const gate = new Promise<CarrierComplianceSnapshot>((r) => (release = r));
    const lookup = vi.fn(() => gate);
    const deps = makeDeps({ lookup });
    const all = Promise.all([
      resolveAuthority('3733285', BROWSER_HEADERS, deps),
      resolveAuthority('3733285', BROWSER_HEADERS, deps),
      resolveAuthority('3733285', BROWSER_HEADERS, deps),
    ]);
    release(QC_ACTIVE);
    const results = await all;
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.status === 'active')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the budget', () => {
  it('stops handing out tokens once the burst is spent', () => {
    let t = 0;
    const b = new AuthorityBudget(3, 30, () => t);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it('refills over time', () => {
    let t = 0;
    const b = new AuthorityBudget(3, 30, () => t);
    for (let i = 0; i < 3; i++) b.tryTake();
    expect(b.tryTake()).toBe(false);
    t += 60_000; // one minute → +30 tokens, capped at 3
    expect(b.tryTake()).toBe(true);
  });

  it('opens the breaker after consecutive failures and closes it after the cooldown', () => {
    let t = 0;
    const b = new AuthorityBudget(100, 100, () => t);
    for (let i = 0; i < BREAKER_THRESHOLD; i++) b.recordFailure();
    expect(b.breakerOpen()).toBe(true);
    expect(b.tryTake()).toBe(false);
    t += BREAKER_COOLDOWN_MS + 1;
    expect(b.breakerOpen()).toBe(false);
    expect(b.tryTake()).toBe(true);
  });

  it('a success resets the failure streak', () => {
    const b = new AuthorityBudget();
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    expect(b.breakerOpen()).toBe(false);
  });

  it('degrades to the snapshot when the budget is spent, without calling FMCSA', async () => {
    const budget = new AuthorityBudget(0, 0);
    const deps = makeDeps({ budget });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(res).toMatchObject({ live: false, reason: 'budget', status: 'unknown' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('degrading to the snapshot', () => {
  it('never throws and never goes live when the webkey is missing', async () => {
    const deps = makeDeps({ webKeyConfigured: () => false });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(deps.lookup).not.toHaveBeenCalled();
    expect(res).toMatchObject({ live: false, reason: 'unconfigured' });
  });

  it('returns the snapshot answer when FMCSA does not find the carrier', async () => {
    const deps = makeDeps({ lookup: vi.fn(async () => NOT_FOUND) });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(res).toMatchObject({ live: false, status: 'unknown', reason: 'lookup-failed' });
  });

  it('does not cache an uninterpretable answer (it would suppress a real one for a week)', async () => {
    const writeCache = vi.fn(async () => {});
    const deps = makeDeps({ lookup: vi.fn(async () => NOT_FOUND), writeCache });
    await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(writeCache).not.toHaveBeenCalled();
  });

  it('survives a throwing lookup and counts it against the breaker', async () => {
    const budget = new AuthorityBudget();
    const deps = makeDeps({
      budget,
      lookup: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(res).toMatchObject({ live: false, reason: 'lookup-failed' });
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) budget.recordFailure();
    expect(budget.breakerOpen()).toBe(true);
  });

  it('survives a throwing cache read and still goes live', async () => {
    const deps = makeDeps({
      readCache: async () => {
        throw new Error('column does not exist');
      },
    });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(res).toMatchObject({ status: 'active', live: true });
  });

  it('survives a throwing cache write and still returns the live answer', async () => {
    const deps = makeDeps({
      writeCache: async () => {
        throw new Error('read-only transaction');
      },
    });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(res).toMatchObject({ status: 'active', live: true, reason: 'fresh' });
  });

  it('the snapshot answer carries no status, no date and no message a visitor could see', () => {
    for (const reason of ['crawler', 'budget', 'unconfigured', 'lookup-failed'] as const) {
      const a = snapshotAuthorityAnswer(reason);
      expect(a).toEqual({ status: 'unknown', live: false, checkedAt: null, checkedLabel: null, reason });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the live answer wins, with its own date', () => {
  it('reports inactive when FMCSA disagrees with the stored Active snapshot', async () => {
    const deps = makeDeps({ lookup: vi.fn(async () => QC_REVOKED) });
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, deps);
    expect(res).toMatchObject({ status: 'inactive', live: true, checkedLabel: '30 Aug 2026' });
  });

  it('dates every live answer', async () => {
    const res = await resolveAuthority('3733285', BROWSER_HEADERS, makeDeps());
    expect(res.checkedAt).toBe('2026-08-30T12:00:00.000Z');
    expect(res.checkedLabel).toBe('30 Aug 2026');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('it cannot manufacture sitemap freshness', () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const COLUMNS = ['authority_live_status', 'authority_live_checked_at'];

  /**
   * THE STRUCTURAL GUARANTEE. The ingest's UPSERT is generated from
   * CARRIER_MUTABLE_COLUMNS and compared by CARRIER_CHANGED_SQL. If either ever
   * learned about these columns, a per-view revalidation timestamp would mark
   * all ~330k rows changed on every weekly ingest, bump `updated_at`, and
   * publish a fake <lastmod> across the whole carrier sitemap.
   */
  it('keeps the revalidation columns out of the ingest entirely', () => {
    const ingest = src('./carrierIngest.ts');
    for (const col of COLUMNS) {
      expect(ingest, `${col} must never appear in carrierIngest.ts`).not.toContain(col);
    }
  });

  it('keeps the revalidation columns out of the drizzle schema', () => {
    const schema = src('../../db/schema.ts');
    for (const col of COLUMNS) {
      expect(schema, `${col} must never appear in db/schema.ts`).not.toContain(col);
      expect(schema).not.toContain('authorityLive');
    }
  });

  it('adds them by idempotent self-heal DDL only', () => {
    expect(AUTHORITY_SELF_HEAL_STATEMENTS).toHaveLength(2);
    for (const s of AUTHORITY_SELF_HEAL_STATEMENTS) {
      expect(s).toContain('ADD COLUMN IF NOT EXISTS');
      expect(s).toContain('"carrier_directory"');
      // No backfill, no NOT NULL, no DEFAULT — each of those rewrites the table
      // under ACCESS EXCLUSIVE, which is the 2026-08-28 outage.
      expect(s).not.toMatch(/\bdefault\b/i);
      expect(s).not.toMatch(/\bnot null\b/i);
      expect(s).not.toMatch(/\bupdate\b/i);
    }
  });

  it('never writes updated_at when persisting a live result', () => {
    const self = src('./authorityRevalidation.ts');
    const update = self.slice(self.indexOf('update "carrier_directory"'));
    expect(update.slice(0, 400)).not.toContain('updated_at');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rendered page', () => {
  const pagesSrc = readFileSync(fileURLToPath(new URL('./pages.ts', import.meta.url)), 'utf8');

  /**
   * The badge is now ALWAYS emitted and toggled with `hidden` so the client can
   * add OR remove it. `.cp-badge-active` sets `display: inline-flex`, and an
   * author display rule BEATS the UA's `[hidden] { display: none }` — without
   * the guard rule, `hidden` is inert and every carrier renders "Active",
   * including the ones whose authority is not active. This is the exact bug this
   * feature exists to prevent, so it is asserted rather than trusted.
   */
  it('makes [hidden] actually hide the active badge', () => {
    expect(pagesSrc).toContain('.cp-badge-active[hidden] { display: none; }');
    expect(pagesSrc).toContain('.cp-authlive[hidden] { display: none; }');
  });

  it('marks both authority-status assertions so one live read corrects both', () => {
    const occurrences = pagesSrc.split('data-auth-status').length - 1;
    // Two render sites (Overview "Status", Safety "Authority status") + the
    // querySelectorAll in the hydration script.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it('sends the first-party header the server gate requires', () => {
    expect(pagesSrc).toContain("'X-QF-Authority-Check':'1'");
  });

  it('never claims the authority is "verified"', () => {
    const script = pagesSrc.slice(
      pagesSrc.indexOf('const AUTHORITY_REVALIDATE_SCRIPT'),
      pagesSrc.indexOf('const CARRIER_PRO_HYDRATE_SCRIPT'),
    );
    expect(script.toLowerCase()).not.toContain('verified');
    expect(script).toContain('checked ');
  });

  it('defers the fetch off the critical path', () => {
    expect(pagesSrc).toContain('requestIdleCallback');
  });

  /**
   * Once the live check wins, the provenance note below it must stop saying the
   * AUTHORITY came from the frozen 14 May 2026 file — otherwise the page dates
   * the fact the reader is looking at to a file it no longer came from, which is
   * the same misattribution this whole feature exists to remove. Insurance still
   * does come from that file, so only that half of the sentence survives.
   */
  it('re-attributes the provenance note when the live status wins', () => {
    expect(pagesSrc).toContain('data-auth-source');
    const script = pagesSrc.slice(
      pagesSrc.indexOf('const AUTHORITY_REVALIDATE_SCRIPT'),
      pagesSrc.indexOf('const CARRIER_PRO_HYDRATE_SCRIPT'),
    );
    expect(script).toContain('Insurance filings come from');
    expect(script).toContain('operating-authority status above is from FMCSA');
    // The static (no-live-answer) sentence must still be the rendered default.
    expect(pagesSrc).toContain("Authority and insurance come from FMCSA's Licensing &amp; Insurance file");
  });
});
