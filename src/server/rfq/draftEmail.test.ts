/**
 * RFQ drafter tests — the personalized, per-carrier "Dear <Company>," rate
 * request. Proves the human-not-AI voice guards, the deterministic fallback with
 * no AI, per-carrier individuality, and that an AI reply that trips the voice
 * guard is rejected in favor of the clean template. No network, no AI vendor.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  draftRfqEmail,
  buildRfqSystemPrompt,
  buildRfqTemplateMiddle,
  violatesRfqVoice,
  wordCount,
  carrierCapabilityPhrase,
  RFQ_MAX_WORDS,
  AI_VOICE_BANS,
  type RfqCarrierFacts,
} from './draftEmail.js';
import type { RfqRequest } from '../../db/schema.js';
import type { ChatCompletion } from '../../ai/client.js';

type CompleteFn = typeof import('../../ai/client.js').complete;

const request = (over: Partial<RfqRequest> = {}): RfqRequest => ({
  id: 1,
  viewToken: 'v',
  shipperName: 'Dana Shipper',
  shipperCompany: 'Dana Logistics',
  shipperEmail: 'dana@shipper.example',
  shipperPhone: null,
  origin: 'Los Angeles, CA',
  destination: 'Dallas, TX',
  equipment: 'Reefer',
  containerType: null,
  commodity: 'Produce',
  weight: '42,000 lbs',
  readyDate: '2026-09-01',
  targetRate: '$2,400',
  notes: null,
  filterSnapshot: null,
  status: 'open',
  createdAt: new Date('2026-08-20T00:00:00Z'),
  ...over,
});

const reeferCarrier: RfqCarrierFacts = {
  name: 'Sunbelt Reefer Lines',
  city: 'Fontana',
  state: 'CA',
  reefer: true,
};

const drayageCarrier: RfqCarrierFacts = {
  name: 'Harbor Drayage Co',
  city: 'Long Beach',
  state: 'CA',
  intermodal: true,
  nearestPortCode: 'USLAX',
};

/** Fake AI client returning fixed JSON — typed as the real `complete`. */
const fakeAi = (json: object): CompleteFn =>
  vi.fn(
    async (): Promise<ChatCompletion> => ({
      text: JSON.stringify(json),
      toolUses: [],
      stopReason: 'end_turn',
    }),
  ) as unknown as CompleteFn;

describe('violatesRfqVoice', () => {
  it('flags AI filler, exclamation, and model-B payment promises', () => {
    expect(violatesRfqVoice('I hope this email finds you well.')).toBe(true);
    expect(violatesRfqVoice("I'm excited to work with you")).toBe(true);
    expect(violatesRfqVoice('Furthermore, we can help')).toBe(true);
    expect(violatesRfqVoice('Great news!')).toBe(true); // exclamation
    expect(violatesRfqVoice("We'll pay you $2,400 for this load")).toBe(true); // model-B
    expect(violatesRfqVoice('Send your all-in rate for LA to Dallas.')).toBe(false);
  });
});

describe('buildRfqSystemPrompt', () => {
  it('bans the AI-ish filler phrases and forbids exclamation + payment', () => {
    const p = buildRfqSystemPrompt().toLowerCase();
    expect(p).toContain('i hope this email finds you well');
    expect(p).toContain('furthermore');
    expect(p).toContain('no exclamation');
    expect(p).toContain('never promise payment');
    // MODEL-B framing: requesting the rate, not offering one.
    expect(p).toContain('requesting');
  });
});

describe('carrierCapabilityPhrase', () => {
  it('prefers drayage + port, then equipment, then null when unknown', () => {
    expect(carrierCapabilityPhrase(drayageCarrier)).toContain('Port of Los Angeles');
    expect(carrierCapabilityPhrase(reeferCarrier)).toContain('reefer');
    expect(carrierCapabilityPhrase({ name: 'Bare Carrier' })).toBeNull();
  });
});

describe('buildRfqTemplateMiddle (deterministic fallback)', () => {
  it('references the carrier capability + lane and asks for the rate, no banned voice', () => {
    const { subject, bodyText } = buildRfqTemplateMiddle(request(), reeferCarrier);
    expect(subject).toContain('Los Angeles, CA to Dallas, TX');
    expect(bodyText.toLowerCase()).toContain('reefer');
    expect(bodyText.toLowerCase()).toContain('rate');
    // Human, not AI; and MODEL-B safe (no payment promise).
    expect(violatesRfqVoice(`${subject}\n${bodyText}`)).toBe(false);
  });
});

describe('draftRfqEmail — no AI (deterministic template)', () => {
  it('opens "Dear <Company>," references facts, stays under the word ceiling', async () => {
    const d = await draftRfqEmail(request(), reeferCarrier, { anthropicKey: '' });
    expect(d.aiGenerated).toBe(false);
    expect(d.body.startsWith('Dear Sunbelt Reefer Lines,')).toBe(true);
    expect(d.body.toLowerCase()).toContain('reefer');
    expect(d.body).toContain('Los Angeles, CA');
    expect(d.body).toContain('Dallas, TX');
    // Signed off by the shipper (peer-to-peer), never QuoteFleet as counterparty.
    expect(d.body).toContain('Dana Shipper, Dana Logistics');
    expect(wordCount(d.body)).toBeLessThanOrEqual(RFQ_MAX_WORDS);
    expect(violatesRfqVoice(d.body)).toBe(false);
  });

  it('falls back deterministically when the AI client THROWS', async () => {
    const throwingAi = vi.fn(async () => {
      throw new Error('ai down');
    });
    const d = await draftRfqEmail(request(), drayageCarrier, {
      anthropicKey: 'present-key',
      aiComplete: throwingAi as unknown as typeof import('../../ai/client.js').complete,
    });
    expect(throwingAi).toHaveBeenCalled();
    expect(d.aiGenerated).toBe(false);
    expect(d.body.startsWith('Dear Harbor Drayage Co,')).toBe(true);
  });

  it('produces INDIVIDUAL bodies for different carriers (no two identical)', async () => {
    const a = await draftRfqEmail(request(), reeferCarrier, { anthropicKey: '' });
    const b = await draftRfqEmail(request(), drayageCarrier, { anthropicKey: '' });
    expect(a.body).not.toBe(b.body);
    expect(a.body).toContain('Dear Sunbelt Reefer Lines,');
    expect(b.body).toContain('Dear Harbor Drayage Co,');
    // Each references its OWN capability.
    expect(a.body.toLowerCase()).toContain('reefer');
    expect(b.body.toLowerCase()).toContain('port of los angeles');
  });
});

describe('draftRfqEmail — AI path', () => {
  it('accepts clean AI copy and FORCES the "Dear <Company>," greeting', async () => {
    const ai = fakeAi({
      subject: 'Rate request: LA to Dallas, reefer',
      bodyText:
        'Saw your reefer freight out of Fontana, CA. I have a produce load running Los Angeles to Dallas.\n\nSend your all-in rate and the soonest you could cover it.',
    });
    const d = await draftRfqEmail(request(), reeferCarrier, { anthropicKey: 'k', aiComplete: ai });
    expect(d.aiGenerated).toBe(true);
    expect(d.subject).toBe('Rate request: LA to Dallas, reefer');
    // Greeting + sign-off are assembled deterministically around the AI middle.
    expect(d.body.startsWith('Dear Sunbelt Reefer Lines,')).toBe(true);
    expect(d.body).toContain('Dana Shipper, Dana Logistics');
  });

  it('REJECTS AI copy that trips the voice guard and falls back to the template', async () => {
    const ai = fakeAi({
      subject: 'Exciting opportunity!',
      bodyText: "I hope this email finds you well. I'm excited to reach out to you today!",
    });
    const d = await draftRfqEmail(request(), reeferCarrier, { anthropicKey: 'k', aiComplete: ai });
    expect(d.aiGenerated).toBe(false); // rejected → template
    expect(d.body.startsWith('Dear Sunbelt Reefer Lines,')).toBe(true);
    expect(violatesRfqVoice(d.body)).toBe(false);
  });

  it('REJECTS AI copy over the word ceiling', async () => {
    const longMiddle = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const ai = fakeAi({ subject: 'Rate request', bodyText: longMiddle });
    const d = await draftRfqEmail(request(), reeferCarrier, { anthropicKey: 'k', aiComplete: ai });
    expect(d.aiGenerated).toBe(false);
    expect(wordCount(d.body)).toBeLessThanOrEqual(RFQ_MAX_WORDS);
  });
});

describe('AI_VOICE_BANS', () => {
  it('covers the owner-named filler phrases', () => {
    const joined = AI_VOICE_BANS.join(' | ');
    expect(joined).toContain('i hope this email finds you well');
    expect(joined).toContain("i'm excited to");
    expect(joined).toContain('furthermore');
  });
});
