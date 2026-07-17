/**
 * Forward-email auto-import — pure helper unit tests.
 *
 * Locks the properties that make the feature safe:
 *   - address tokens are unguessable + tenant-scoped, and build/parse round-trip
 *   - recipient resolution tolerates real-world `to` shapes (arrays, CC lists,
 *     display-name wrappers, +sub-addressing) and rejects non-ours
 *   - content selection prefers the richest attachment, falls back to the body
 *   - the auto-apply decision only fires on high-confidence + all-clean drafts
 */
import { describe, it, expect } from 'vitest';
import {
  generateIngestEmailToken,
  buildInboundAddress,
  parseInboundToken,
  resolveTokenFromRecipients,
  inboundDomain,
  pickBestContent,
  decideEmailImport,
  PLACEHOLDER_INBOUND_DOMAIN,
} from './emailImport.js';

describe('token generation — stable, unguessable, tenant-scoped', () => {
  it('mints lowercase-alphanumeric tokens of solid length', () => {
    const t = generateIngestEmailToken();
    expect(t).toMatch(/^[0-9a-z]+$/);
    expect(t.length).toBeGreaterThanOrEqual(20);
  });

  it('every token is unique across many draws (unguessable, no collisions)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 500; i++) set.add(generateIngestEmailToken());
    expect(set.size).toBe(500);
  });
});

describe('address build / parse round-trip', () => {
  it('builds rates-<token>@<domain> and parses the token back', () => {
    const addr = buildInboundAddress('abc123', 'rates.quotefleet.net');
    expect(addr).toBe('rates-abc123@rates.quotefleet.net');
    expect(parseInboundToken(addr)).toBe('abc123');
  });

  it('a freshly minted token round-trips through an address', () => {
    const token = generateIngestEmailToken();
    expect(parseInboundToken(buildInboundAddress(token, 'x.com'))).toBe(token);
  });

  it('falls back to the placeholder domain when env is unset', () => {
    expect(inboundDomain(undefined)).toBe(PLACEHOLDER_INBOUND_DOMAIN);
    expect(buildInboundAddress('t', undefined)).toBe(`rates-t@${PLACEHOLDER_INBOUND_DOMAIN}`);
  });

  it('parse tolerates display-name wrappers, +sub-addressing, and casing', () => {
    expect(parseInboundToken('Rates Inbox <RATES-ABC@Rates.QuoteFleet.net>')).toBe('abc');
    expect(parseInboundToken('rates-abc123+forwarded@x.com')).toBe('abc123');
  });

  it('parse rejects addresses that are not ours', () => {
    expect(parseInboundToken('hello@quotefleet.net')).toBeNull();
    expect(parseInboundToken('rates-@x.com')).toBeNull(); // empty token
    expect(parseInboundToken('rates-abc!def@x.com')).toBeNull(); // bad chars
    expect(parseInboundToken('not-an-email')).toBeNull();
    expect(parseInboundToken('')).toBeNull();
  });
});

describe('resolveTokenFromRecipients — real-world `to` shapes', () => {
  it('resolves off a comma-joined string list (CC on a forward)', () => {
    expect(resolveTokenFromRecipients('boss@carrier.com, rates-xyz@x.com')).toBe('xyz');
  });
  it('resolves off an array of strings', () => {
    expect(resolveTokenFromRecipients(['a@b.com', 'rates-9k@x.com'])).toBe('9k');
  });
  it('resolves off an array of {address} objects', () => {
    expect(resolveTokenFromRecipients([{ address: 'rates-qq@x.com' }])).toBe('qq');
  });
  it('returns null when no rates- recipient is present', () => {
    expect(resolveTokenFromRecipients('a@b.com, c@d.com')).toBeNull();
    expect(resolveTokenFromRecipients([])).toBeNull();
    expect(resolveTokenFromRecipients(undefined)).toBeNull();
  });
});

describe('pickBestContent — best attachment else body', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64');

  it('prefers a PDF attachment over the email body', () => {
    const pick = pickBestContent({
      text: 'see attached',
      attachments: [
        { filename: 'note.txt', contentType: 'text/plain', contentBase64: b64('hi') },
        { filename: 'rates.pdf', contentType: 'application/pdf', contentBase64: b64('%PDF') },
      ],
    });
    expect(pick?.mimeType).toBe('application/pdf');
    expect(pick?.filename).toBe('rates.pdf');
  });

  it('skips unsupported attachments and uses the body', () => {
    const pick = pickBestContent({
      subject: 'Q3 rates',
      text: 'LB to Phoenix $1200',
      attachments: [{ filename: 'logo.zip', contentType: 'application/zip', contentBase64: b64('PK') }],
    });
    expect(pick?.mimeType).toBe('text/plain');
    expect(Buffer.from(pick!.dataBase64, 'base64').toString('utf8')).toContain('LB to Phoenix');
  });

  it('prefers HTML body over text when no attachments', () => {
    const pick = pickBestContent({ html: '<p>rates</p>', text: 'rates' });
    expect(pick?.mimeType).toBe('text/html');
  });

  it('returns null when there is nothing to parse', () => {
    expect(pickBestContent({})).toBeNull();
    expect(pickBestContent({ attachments: [{ filename: 'x.zip', contentType: 'application/zip', contentBase64: 'AA' }] })).toBeNull();
  });

  it('breaks attachment ties by size (the fuller sheet wins)', () => {
    const pick = pickBestContent({
      attachments: [
        { filename: 'small.png', contentType: 'image/png', contentBase64: b64('a') },
        { filename: 'big.png', contentType: 'image/png', contentBase64: b64('aaaaaaaaaaaaaaaa') },
      ],
    });
    expect(pick?.filename).toBe('big.png');
  });
});

describe('decideEmailImport — auto-apply only when safe', () => {
  const draft = { confidence: 'high', rateCards: [{ service: 'ftl' }] };
  const clean = { total: 4, flaggedCount: 0 };

  it('AUTO-APPLIES on high confidence + all-clean + has content', () => {
    const d = decideEmailImport(draft, clean);
    expect(d.autoApply).toBe(true);
    expect(d.reason).toBe('high_confidence_all_clean');
  });

  it('HOLDS when confidence is not high', () => {
    expect(decideEmailImport({ ...draft, confidence: 'medium' }, clean).autoApply).toBe(false);
    expect(decideEmailImport({ ...draft, confidence: 'low' }, clean).autoApply).toBe(false);
  });

  it('HOLDS when the auto-check flagged any lane', () => {
    expect(decideEmailImport(draft, { total: 4, flaggedCount: 1 }).autoApply).toBe(false);
  });

  it('HOLDS when the auto-check ran zero samples (no evidence of safety)', () => {
    const d = decideEmailImport(draft, { total: 0, flaggedCount: 0 });
    expect(d.autoApply).toBe(false);
    expect(d.reason).toBe('no_autocheck_samples');
  });

  it('HOLDS when nothing was extracted, even at high confidence', () => {
    const d = decideEmailImport({ confidence: 'high', rateCards: [], accessorials: [], laneZones: [] }, clean);
    expect(d.autoApply).toBe(false);
    expect(d.reason).toBe('nothing_extracted');
  });

  it('counts accessorials or lane zones as content too', () => {
    expect(decideEmailImport({ confidence: 'high', accessorials: [{ code: 'liftgate' }] }, clean).autoApply).toBe(true);
    expect(decideEmailImport({ confidence: 'high', laneZones: [{ label: 'z' }] }, clean).autoApply).toBe(true);
  });
});
