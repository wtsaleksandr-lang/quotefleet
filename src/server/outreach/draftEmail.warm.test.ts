/**
 * Warm-reply drafter tests (REVERSE OUTREACH Phase 1). Everything injected — no
 * network, no AI vendor. Proves:
 *   - mode:'warm-reply' forces a "Re: <inbound subject>" subject, stripping any
 *     existing leading "Re:".
 *   - The system prompt instructs the AI to acknowledge they reached out first.
 *   - AI path AND the no-key template path both embed the demo URL.
 *   - previewImageUrl still embeds the branded image (shared assemble path).
 *   - The template opener literally acknowledges they reached out.
 *   - Cold mode is unchanged (no forced "Re:", still names the company).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  draftOutreachEmail,
  buildWarmTemplateEmail,
  buildReplySubject,
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
    serviceModes: ['drayage'],
    regionsLanes: ['Los Angeles to Phoenix'],
    brandColors: { primary: '#123456', secondary: null, confidence: 'high' },
    logoUrl: null,
    logoConfidence: 'low',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
  };
}

/** aiComplete stub returning a well-formed warm reply that includes the demo URL. */
function aiWarm(): { fn: DraftEmailOpts['aiComplete']; mock: ReturnType<typeof vi.fn> } {
  const body =
    `Thanks for reaching out about Acme Drayage — funny timing, because I'd just built you a preview.\n\n` +
    `Here it is — ${DEMO_URL}. It quotes drayage lanes in seconds. Worth a look?`;
  const mock = vi.fn(
    async () =>
      ({
        text: JSON.stringify({ subject: 'ignored', bodyText: body }),
        toolUses: [],
        stopReason: 'end_turn',
      }) as ChatCompletion,
  );
  return { fn: mock as unknown as DraftEmailOpts['aiComplete'], mock };
}

describe('buildReplySubject', () => {
  it('prefixes a single Re: and strips existing Re: runs', () => {
    expect(buildReplySubject('Reefer capacity')).toBe('Re: Reefer capacity');
    expect(buildReplySubject('Re: Reefer capacity')).toBe('Re: Reefer capacity');
    expect(buildReplySubject('RE: re: Reefer capacity')).toBe('Re: Reefer capacity');
    expect(buildReplySubject('')).toBe('Re: your note');
  });
});

describe('draftOutreachEmail — warm-reply AI path', () => {
  it('forces a Re: subject and passes an acknowledgement-first system prompt', async () => {
    const { fn, mock } = aiWarm();
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: fn,
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
      mode: 'warm-reply',
      inboundContext: { subject: 'Re: Reefer capacity', senderName: 'Dana' },
    });

    expect(draft.aiGenerated).toBe(true);
    // Subject is the threaded reply subject, existing "Re:" collapsed to one.
    expect(draft.subject).toBe('Re: Reefer capacity');
    // Demo URL present in both formats.
    expect(draft.bodyText).toContain(DEMO_URL);
    expect(draft.bodyHtml).toContain(`href="${DEMO_URL}"`);

    // The system prompt instructs the AI to acknowledge they reached out first.
    const sys = String((mock.mock.calls[0][0] as { system: string }).system).toLowerCase();
    expect(sys).toContain('warm reply');
    expect(sys).toMatch(/reach(ed|ing) out/);
  });

  it('still embeds the branded quote image when previewImageUrl is set', async () => {
    const IMG = 'https://cdn.example.com/demo-shot/abc123XYZ.png';
    const { fn } = aiWarm();
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      aiComplete: fn,
      anthropicKey: 'sk-test',
      publicBaseUrl: BASE,
      mode: 'warm-reply',
      inboundContext: { subject: 'Reefer capacity' },
      previewImageUrl: IMG,
    });
    expect(draft.bodyHtml).toContain(`src="${IMG}"`);
    expect(draft.bodyHtml).toContain(`href="${DEMO_URL}"`);
    expect(draft.bodyHtml).not.toContain('Instant freight estimate');
  });
});

describe('draftOutreachEmail — warm-reply template path (no AI key)', () => {
  it('acknowledges they reached out, threads the subject, and links the demo', async () => {
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      anthropicKey: '', // no key → deterministic warm template
      publicBaseUrl: BASE,
      mode: 'warm-reply',
      inboundContext: { subject: 'Reefer capacity', senderName: 'Dana' },
    });

    expect(draft.aiGenerated).toBe(false);
    expect(draft.subject).toBe('Re: Reefer capacity');
    expect(draft.bodyText.toLowerCase()).toContain('reaching out');
    expect(draft.bodyText).toContain('Acme Drayage');
    expect(draft.bodyText).toContain(DEMO_URL);
    expect(draft.bodyHtml).toContain(DEMO_URL);
  });

  it('buildWarmTemplateEmail greets by name when supplied', () => {
    const tmpl = buildWarmTemplateEmail(acmeProfile(), DEMO_URL, {
      subject: 'Reefer capacity',
      senderName: 'Dana',
    });
    expect(tmpl.subject).toBe('Re: Reefer capacity');
    expect(tmpl.bodyText).toContain('Dana, thanks for reaching out');
    expect(tmpl.bodyText).toContain(DEMO_URL);
  });
});

describe('draftOutreachEmail — cold mode unchanged', () => {
  it('defaults to cold: no forced Re:, names the company', async () => {
    const draft = await draftOutreachEmail(acmeProfile(), DEMO_URL, {
      anthropicKey: '', // template
      publicBaseUrl: BASE,
      // no mode → cold
    });
    expect(draft.subject).not.toMatch(/^Re:/);
    expect(draft.subject).toContain('Acme Drayage');
    expect(draft.bodyText).toContain(DEMO_URL);
    expect(draft.bodyText.toLowerCase()).not.toContain('reaching out');
  });
});
