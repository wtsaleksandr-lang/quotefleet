/**
 * Company-enrichment unit tests (Phase 1 outreach).
 *
 * Everything is injected — no network, no Anthropic vendor, no DB. We stub
 * `fetchFn`, `aiComplete`, and the two env keys via the `EnrichDeps` param, and
 * assert:
 *   - freight service-mode detection from sample HTML
 *   - deterministic field parsing (name/tagline/phone/email/address)
 *   - graceful partial profile when the fetch fails (fetchNotes populated)
 *   - AI fields null + flag when the AI key is absent, populated when present
 *   - FMCSA soft-skip when the key is absent, populated when present
 *   - fleet-number reconciliation flags conflicting self-reported figures
 */
import { describe, it, expect } from 'vitest';
import {
  enrichCompany,
  normalizeDomain,
  reconcileFleetSize,
  type EnrichDeps,
} from './enrichCompany.js';
import type { ChatCompletion } from '../../ai/client.js';

// A representative freight homepage: og tags, tel:/mailto:, address, and copy
// naming several modes + a lane.
const FREIGHT_HTML = `<!doctype html><html><head>
  <title>Acme Drayage &amp; Logistics | Port to Door, On Time</title>
  <meta property="og:site_name" content="Acme Drayage & Logistics">
  <meta property="og:description" content="Container drayage and reefer trucking across the West Coast.">
  <meta name="theme-color" content="#123456">
  <meta property="og:image" content="/img/logo.png">
</head><body>
  <h1>Port drayage, reefer, and FTL freight</h1>
  <p>We provide drayage, refrigerated (reefer), and full-truckload (FTL) service.
     Also LTL and intermodal. Serving Los Angeles to Phoenix and the West Coast.</p>
  <p>236 power units. Over 250 trucks in peak season. 10,000 loads delivered.</p>
  <a href="tel:+15625551234">Call us</a>
  <a href="mailto:dispatch@acmedrayage.com">Email</a>
  <address>1200 Harbor Blvd, Long Beach, CA 90802</address>
</body></html>`;

const FMCSA_JSON = JSON.stringify({
  content: [
    {
      carrier: {
        legalName: 'ACME DRAYAGE AND LOGISTICS LLC',
        dotNumber: 1234567,
        docketNumber: 'MC-987654',
        totalPowerUnits: 236,
        carrierOperation: 'INTERSTATE',
      },
    },
  ],
});

/** Build a fetch stub that routes by URL. Homepage → freight HTML; FMCSA host →
 *  carrier JSON; anything else → a benign empty 200 (so extra-path chasing is
 *  quiet). Override per-test via `over`. */
function makeFetch(over?: (url: string) => Response | null): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const custom = over?.(url);
    if (custom) return custom;
    if (url.includes('mobile.fmcsa.dot.gov')) return new Response(FMCSA_JSON, { status: 200 });
    if (/^https:\/\/[^/]+\/?$/.test(url)) return new Response(FREIGHT_HTML, { status: 200 });
    return new Response('<html></html>', { status: 200 });
  }) as unknown as typeof fetch;
}

const aiOk: EnrichDeps['aiComplete'] = async () =>
  ({
    text: JSON.stringify({
      tone: 'professional, no-nonsense',
      businessSummary: 'Acme runs drayage and reefer freight on the West Coast.',
      painPoints: ['manual rate quoting', 'port congestion delays'],
      quoteFleetAngle: 'Instant drayage quotes tied to their LA/Long Beach port lanes.',
      suggestedCalculator: { mode: 'drayage', fields: ['port', 'terminal', 'container', 'chassis'] },
    }),
    toolUses: [],
    stopReason: 'end_turn',
  }) as ChatCompletion;

const baseDeps: EnrichDeps = {
  fetchFn: makeFetch(),
  anthropicKey: '',
  fmcsaKey: '',
  timeoutMs: 500,
};

describe('normalizeDomain', () => {
  it('strips protocol, path, www, and lowercases', () => {
    expect(normalizeDomain('HTTPS://www.Acme-Freight.com/services')).toBe('acme-freight.com');
    expect(normalizeDomain('  acme.com  ')).toBe('acme.com');
  });
});

describe('service-mode detection', () => {
  it('detects the freight modes present in the page text', async () => {
    const p = await enrichCompany('acmedrayage.com', baseDeps);
    expect(p.serviceModes).toEqual(
      expect.arrayContaining(['drayage', 'reefer', 'FTL', 'LTL', 'intermodal']),
    );
    // Not present in the copy → not detected.
    expect(p.serviceModes).not.toContain('hotshot');
    expect(p.serviceModes).not.toContain('flatbed');
  });
});

describe('deterministic field parsing', () => {
  it('parses name, tagline, phone, email, address, brand color, logo', async () => {
    const p = await enrichCompany('acmedrayage.com', baseDeps);
    expect(p.domain).toBe('acmedrayage.com');
    expect(p.website).toBe('https://acmedrayage.com');
    expect(p.companyName).toBe('Acme Drayage & Logistics');
    expect(p.tagline).toMatch(/drayage/i);
    expect(p.phone).toContain('562');
    expect(p.email).toBe('dispatch@acmedrayage.com');
    expect(p.mailingAddress).toMatch(/Long Beach, CA 90802/);
    expect(p.brandColors.primary).toBe('#123456');
    expect(p.brandColors.confidence).toBe('high');
    expect(p.logoUrl).toBe('https://acmedrayage.com/img/logo.png');
    expect(p.regionsLanes.length).toBeGreaterThan(0);
  });
});

describe('graceful degrade on fetch failure', () => {
  it('returns an empty-but-valid profile with fetchNotes when the homepage 403s', async () => {
    const deps: EnrichDeps = {
      ...baseDeps,
      fetchFn: makeFetch((url) =>
        /^https:\/\/[^/]+\/?$/.test(url) ? new Response('blocked', { status: 403 }) : null,
      ),
    };
    const p = await enrichCompany('walled.com', deps);
    expect(p.companyName).toBeNull();
    expect(p.serviceModes).toEqual([]);
    expect(p.fetchedPaths).toEqual([]);
    expect(p.fetchNotes.join(' ')).toMatch(/403|bot-wall|No page fetched/i);
  });

  it('does not throw on an invalid domain — returns notes', async () => {
    const p = await enrichCompany('not a domain', baseDeps);
    expect(p.fetchNotes.join(' ')).toMatch(/not a valid domain/i);
  });
});

describe('AI insights', () => {
  it('leaves ai null + flags unavailable when no Anthropic key', async () => {
    const p = await enrichCompany('acmedrayage.com', { ...baseDeps, anthropicKey: '' });
    expect(p.ai).toBeNull();
    expect(p.aiAvailable).toBe(false);
    expect(p.fetchNotes.join(' ')).toMatch(/AI insights skipped/i);
  });

  it('populates ai insights when a key + AI client are present', async () => {
    const p = await enrichCompany('acmedrayage.com', {
      ...baseDeps,
      anthropicKey: 'sk-test',
      aiComplete: aiOk,
    });
    expect(p.aiAvailable).toBe(true);
    expect(p.ai).not.toBeNull();
    expect(p.ai?.tone).toMatch(/professional/i);
    expect(p.ai?.suggestedCalculator.mode).toBe('drayage');
    expect(p.ai?.painPoints.length).toBeGreaterThan(0);
  });

  it('survives an AI failure — deterministic fields intact, note added', async () => {
    const p = await enrichCompany('acmedrayage.com', {
      ...baseDeps,
      anthropicKey: 'sk-test',
      aiComplete: (async () => {
        throw new Error('vendor 529 overloaded');
      }) as EnrichDeps['aiComplete'],
    });
    expect(p.ai).toBeNull();
    expect(p.aiAvailable).toBe(false);
    expect(p.companyName).toBe('Acme Drayage & Logistics'); // deterministic unaffected
    expect(p.fetchNotes.join(' ')).toMatch(/AI insights failed/i);
  });
});

describe('FMCSA enrichment', () => {
  it('soft-skips when FMCSA_WEBKEY is absent', async () => {
    const p = await enrichCompany('acmedrayage.com', { ...baseDeps, fmcsaKey: '' });
    expect(p.fmcsa).toBeNull();
    expect(p.fmcsaAvailable).toBe(false);
    expect(p.fetchNotes.join(' ')).toMatch(/FMCSA enrichment skipped/i);
  });

  it('populates MC/DOT + firmographics when a key is present', async () => {
    const p = await enrichCompany('acmedrayage.com', { ...baseDeps, fmcsaKey: 'web-key-123' });
    expect(p.fmcsaAvailable).toBe(true);
    expect(p.fmcsa?.dotNumber).toBe('1234567');
    expect(p.fmcsa?.mcNumber).toBe('MC-987654');
    expect(p.fmcsa?.fleetSize).toBe(236);
    expect(p.fmcsa?.entityType).toBe('INTERSTATE');
  });

  it('never sinks the profile when FMCSA errors', async () => {
    const p = await enrichCompany('acmedrayage.com', {
      ...baseDeps,
      fmcsaKey: 'web-key-123',
      fetchFn: makeFetch((url) =>
        url.includes('mobile.fmcsa.dot.gov') ? new Response('gateway down', { status: 502 }) : null,
      ),
    });
    expect(p.fmcsa).toBeNull();
    expect(p.companyName).toBe('Acme Drayage & Logistics'); // rest of profile is fine
  });
});

describe('reconcileFleetSize', () => {
  it('flags conflicting self-reported figures and picks the specific one', () => {
    const r = reconcileFleetSize('236 power units. Over 250 trucks. 10,000 loads delivered.');
    // "loads delivered" is not a fleet noun, so only 236 + 250 are candidates.
    expect(r.value).toBe(236);
    expect(r.note).toMatch(/Conflicting self-reported/i);
  });

  it('returns null with no note when nothing matches', () => {
    expect(reconcileFleetSize('We move freight fast.')).toEqual({ value: null, note: null });
  });
});
