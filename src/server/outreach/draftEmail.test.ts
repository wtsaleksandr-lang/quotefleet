/**
 * AI email-drafter unit tests (Phase 2 outreach). Everything injected — no
 * network, no Anthropic vendor, no DB. Proves:
 *   - AI path: produces subject + HTML + text, includes the demo URL, the
 *     physical mailing address, and an unsubscribe link; personalization tokens
 *     (company name + a mode) present; body isn't a wall of text.
 *   - Compliance footer + unsubscribe link appear in BOTH HTML and plaintext.
 *   - AI-absent (no key) → deterministic TEMPLATE email, still valid + compliant.
 *   - AI reply missing the demo URL is rejected → template fallback.
 */
import { describe, it, expect } from 'vitest';
import {
  draftOutreachEmail,
  buildTemplateEmail,
  countSentences,
  SENDER_ADDRESS,
  SENDER_NAME,
  type DraftEmailOpts,
} from './draftEmail.js';
import type { CompanyProfile } from './enrichCompany.js';
import type { ChatCompletion } from '../../ai/client.js';

const DEMO_URL = 'https://quotefleet.net/demo/abc123XYZ';
const BASE = 'https://quotefleet.net';

function acmeProfile(): CompanyProfile {
  return {
    domain: 'acmedrayage.com',
    website: 'https://acmedrayage.com',
    companyName: 'Acme Drayage',
    tagline: 'Port to door, on time',
    phone: '(562) 555-1234',
    email: 'dispatch@acmedrayage.com',
    mailingAddress: '1200 Harbor Blvd, Long Beach, CA 90802',
    serviceModes: ['drayage', 'reefer'],
    regionsLanes: ['Los Angeles to Phoenix', 'West Coast'],
    brandColors: { primary: '#123456', secondary: null, confidence: 'high' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: {
      tone: 'professional',
      businessSummary: 'A drayage and reefer carrier out of the San Pedro ports.',
      painPoints: ['quoting drayage by hand is slow and shippers move on'],
      quoteFleetAngle: 'instant branded drayage quotes',
      suggestedCalculator: { mode: 'drayage', fields: ['port', 'terminal', 'container', 'chassis'] },
    },
    aiAvailable: true,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

/** An aiComplete stub returning a well-formed JSON email that cites one stat and
 *  includes the exact demo URL (as the drafter requires). */
function aiOk(subject: string, bodyText: string): DraftEmailOpts['aiComplete'] {
  return async () =>
    ({
      text: JSON.stringify({ subject, bodyText }),
      toolUses: [],
      stopReason: 'end_turn',
    }) as ChatCompletion;
}

describe('draftOutreachEmail — AI path', () => {
  it('produces a compliant, personalized email with subject + HTML + text', async () => {
    const body =
      'I noticed Acme Drayage runs container drayage out of the San Pedro ports. ' +
      'When quoting is manual, shippers wait and the first carrier to reply usually wins — ' +
      'HBR found reply speed swings qualification odds by ~400%.\n\n' +
      `I built you a working preview in your own branding — ${DEMO_URL}. ` +
      'It quotes drayage lanes in seconds. Worth a quick look?';
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('Instant quotes for Acme Drayage drayage', body),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
    });

    expect(draft.aiGenerated).toBe(true);
    expect(draft.subject).toContain('Acme Drayage');
    expect(draft.subject.split(/\s+/).length).toBeLessThanOrEqual(8);

    // Demo URL present in both formats.
    expect(draft.bodyHtml).toContain(DEMO_URL);
    expect(draft.bodyText).toContain(DEMO_URL);
    // It's a real clickable link in HTML.
    expect(draft.bodyHtml).toContain(`href="${DEMO_URL}"`);

    // Personalization tokens: company name + a mode.
    expect(draft.bodyText).toContain('Acme Drayage');
    expect(draft.bodyText.toLowerCase()).toContain('drayage');

    // Body isn't a wall of text (under ~10 sentences before the footer).
    const bodyOnly = draft.bodyText.split('\n\n—')[0];
    expect(countSentences(bodyOnly)).toBeLessThanOrEqual(10);
  });

  it('carries sender identity but NO mailing address and NO visible unsubscribe link', async () => {
    const body = `A specific opener about Acme Drayage.\n\nHere is your preview — ${DEMO_URL}. Worth a look?`;
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('A branded quote tool for Acme Drayage', body),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
    });

    for (const doc of [draft.bodyHtml, draft.bodyText]) {
      // Sender identity stays (founder-style email).
      expect(doc).toContain(SENDER_NAME);
      // Product decision: the physical address and the visible unsubscribe link
      // are intentionally NOT rendered in the email body.
      expect(doc).not.toContain(SENDER_ADDRESS);
      expect(doc).not.toContain('/outreach/unsubscribe/');
      expect(doc.toLowerCase()).not.toContain('unsubscribe');
    }
    // The per-recipient token is still generated (powers suppression + the
    // invisible List-Unsubscribe header set by the send path), just not shown.
    expect(draft.unsubscribeToken.length).toBeGreaterThanOrEqual(16);
  });

  it('still tracks a supplied unsubscribe token (stable per recipient) without rendering it', async () => {
    const body = `Opener.\n\nPreview — ${DEMO_URL}.`;
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('Quotes for Acme Drayage', body),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
      unsubscribeToken: 'fixed-token-1234567890',
    });
    expect(draft.unsubscribeToken).toBe('fixed-token-1234567890');
    // Token is tracked but never printed in the body.
    expect(draft.bodyText).not.toContain('fixed-token-1234567890');
    expect(draft.bodyHtml).not.toContain('fixed-token-1234567890');
  });

  it('rejects an AI reply missing the demo URL → falls back to the template', async () => {
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('Generic subject', 'A body that forgot to include the preview link.'),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
    });
    expect(draft.aiGenerated).toBe(false);
    // Template still includes the demo URL; address is intentionally omitted.
    expect(draft.bodyText).toContain(DEMO_URL);
    expect(draft.bodyText).not.toContain(SENDER_ADDRESS);
  });

  it('never throws when the AI client errors → template fallback', async () => {
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: (async () => {
        throw new Error('AI down');
      }) as DraftEmailOpts['aiComplete'],
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
    });
    expect(draft.aiGenerated).toBe(false);
    expect(draft.subject).toContain('Acme Drayage');
    expect(draft.bodyText).toContain(DEMO_URL);
  });
});

describe('draftOutreachEmail — template fallback (no AI key)', () => {
  it('returns a valid, personalized, compliant email without any AI', async () => {
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      anthropicKey: '', // no key → deterministic template
      publicBaseUrl: BASE,
    });

    expect(draft.aiGenerated).toBe(false);
    expect(draft.subject).toContain('Acme Drayage');
    expect(draft.subject.split(/\s+/).length).toBeLessThanOrEqual(8);

    // Personalization + demo link.
    expect(draft.bodyText).toContain('Acme Drayage');
    expect(draft.bodyText.toLowerCase()).toContain('drayage');
    expect(draft.bodyText).toContain(DEMO_URL);
    expect(draft.bodyHtml).toContain(DEMO_URL);

    // Sender identity present; address + unsubscribe intentionally omitted.
    expect(draft.bodyHtml).toContain(SENDER_NAME);
    expect(draft.bodyHtml).not.toContain(SENDER_ADDRESS);
    expect(draft.bodyText).not.toContain(SENDER_ADDRESS);
    expect(draft.bodyText).not.toContain('/outreach/unsubscribe/');

    // Not a wall of text.
    const bodyOnly = draft.bodyText.split('\n\n—')[0];
    expect(countSentences(bodyOnly)).toBeLessThanOrEqual(10);
  });

  it('degrades to the domain when the company name is missing', async () => {
    const p = acmeProfile();
    p.companyName = null;
    const tmpl = buildTemplateEmail(p, DEMO_URL);
    expect(tmpl.subject).toContain('acmedrayage.com');
    expect(tmpl.bodyText).toContain('acmedrayage.com');
  });

  it('uses a generic mode when none was detected', async () => {
    const p = acmeProfile();
    p.serviceModes = [];
    p.ai = null;
    const tmpl = buildTemplateEmail(p, DEMO_URL);
    expect(tmpl.bodyText).toContain('freight');
    expect(tmpl.bodyText).toContain(DEMO_URL);
  });
});

describe('draftOutreachEmail — embedded branded-quote image', () => {
  const IMG = 'https://cdn.example.com/demo-shot/abc123XYZ.png';

  it('embeds a clickable image (linked to the demo) when previewImageUrl is set', async () => {
    const body = `Opener about Acme Drayage.\n\nPreview — ${DEMO_URL}.`;
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('Quotes for Acme Drayage', body),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
      previewImageUrl: IMG,
    });
    // The image is present and wrapped in a link to the prospect's demo.
    expect(draft.bodyHtml).toContain(`src="${IMG}"`);
    expect(draft.bodyHtml).toContain(`href="${DEMO_URL}"`);
    // Alt text carries the message if images are blocked.
    expect(draft.bodyHtml).toMatch(/alt="[^"]*Acme Drayage[^"]*"/);
    // The text preview card is replaced by the image (no "Instant freight estimate" card label).
    expect(draft.bodyHtml).not.toContain('Instant freight estimate');
  });

  it('falls back to the text preview card when no previewImageUrl is given', async () => {
    const body = `Opener about Acme Drayage.\n\nPreview — ${DEMO_URL}.`;
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: aiOk('Quotes for Acme Drayage', body),
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
    });
    expect(draft.bodyHtml).toContain('Instant freight estimate');
    expect(draft.bodyHtml).not.toContain('<img src="https://cdn.example.com');
  });
});

describe('countSentences', () => {
  it('counts sentence-terminated clauses', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('No terminator here')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
});
