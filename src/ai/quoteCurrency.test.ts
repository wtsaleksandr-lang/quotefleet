import { describe, it, expect } from 'vitest';
import {
  currencyInstructionSection,
  labelSummaryCurrency,
  quoteCurrencySymbol,
  resolveQuoteCurrency,
} from './quoteCurrency.js';
import { leadChatSystemPrompt, leadReplySystemPrompt } from './prompts.js';
import type { Tenant, AiConfig } from '../db/schema.js';

/** Minimal tenant-shaped literal — the prompt builder reads name/slug and the
 *  (absent) onboarding answers. */
const TENANT = {
  name: 'Maple Line Transport',
  slug: 'maple-line',
  onboardingJson: null,
} as unknown as Tenant;

const AI = null as AiConfig | null;

describe('resolveQuoteCurrency', () => {
  it('narrows CAD', () => {
    expect(resolveQuoteCurrency('CAD')).toBe('CAD');
  });
  it('falls back to USD for USD, null, garbage', () => {
    expect(resolveQuoteCurrency('USD')).toBe('USD');
    expect(resolveQuoteCurrency(null)).toBe('USD');
    expect(resolveQuoteCurrency(undefined)).toBe('USD');
    expect(resolveQuoteCurrency('EUR')).toBe('USD');
  });
});

describe('quoteCurrencySymbol', () => {
  it('matches the house format (never the bare "$" en-CA renders)', () => {
    expect(quoteCurrencySymbol('USD')).toBe('$');
    expect(quoteCurrencySymbol('CAD')).toBe('CA$');
  });
});

describe('currencyInstructionSection', () => {
  it('instructs CAD concretely, with the CA$ symbol and a worked example', () => {
    const out = currencyInstructionSection('CAD');
    expect(out).toContain('priced in CAD');
    expect(out).toContain('CA$');
    expect(out).toContain('CA$8,578.39');
    // Explicitly contradicts the US-formatted example earlier in the prompt.
    expect(out).toContain('A bare "$" is WRONG for this quote');
    // Labelling only — the model must never touch the value.
    expect(out).toMatch(/Never convert, recalculate, round/);
  });

  it('defaults to the email surface, leaving the lead-reply block byte-identical', () => {
    expect(currencyInstructionSection('CAD')).toBe(currencyInstructionSection('CAD', 'email'));
    expect(currencyInstructionSection('USD')).toBe(currencyInstructionSection('USD', 'email'));
    // The email variant still overrides the US-formatted example in that prompt.
    expect(currencyInstructionSection('CAD', 'email')).toContain(
      'Quote #QF-2026-0042 — CA$1,847'
    );
  });

  it('the chat surface drops email-only wording it cannot honour', () => {
    const chat = currencyInstructionSection('CAD', 'chat');
    // Chat is not writing an email and has no worked example above it to correct.
    expect(chat).not.toContain('in the email');
    expect(chat).not.toContain('example format shown above');
    // …but still carries the core correction, aimed at what chat actually does.
    expect(chat).toContain('A bare "$" is WRONG for this quote');
    expect(chat).toContain('CA$8,578.39');
    expect(chat).toContain('re-explain');
  });

  it('USD carries no CAD correction on either surface', () => {
    expect(currencyInstructionSection('USD', 'chat')).not.toContain('CA$');
    expect(currencyInstructionSection('USD', 'email')).not.toContain('CA$');
  });

  it('instructs USD without the CAD-specific correction', () => {
    const out = currencyInstructionSection('USD');
    expect(out).toContain('priced in USD');
    expect(out).toContain('$8,578.39');
    expect(out).not.toContain('CA$');
  });
});

describe('leadReplySystemPrompt — currency awareness', () => {
  it('a CAD quote is demonstrably instructed to write CA$', () => {
    const prompt = leadReplySystemPrompt(TENANT, AI, 'CAD');
    expect(prompt).toContain('This quote is priced in CAD');
    expect(prompt).toContain('CA$8,578.39');
  });

  it('defaults to USD so existing callers are unchanged in behaviour', () => {
    expect(leadReplySystemPrompt(TENANT, AI)).toBe(leadReplySystemPrompt(TENANT, AI, 'USD'));
  });

  it('keeps every pre-existing instruction (additive only)', () => {
    const prompt = leadReplySystemPrompt(TENANT, AI, 'CAD');
    expect(prompt).toContain('You write the FIRST EMAIL REPLY to an inbound quote request');
    expect(prompt).toContain("NEVER show or mention the carrier's margin/markup");
    expect(prompt).toContain('Plain text only (no Markdown, no HTML');
    expect(prompt).toContain('Sign as: "Maple Line Transport"');
  });
});

describe('leadChatSystemPrompt — currency awareness', () => {
  it('a CAD quote is demonstrably instructed to write CA$', () => {
    const prompt = leadChatSystemPrompt(TENANT, AI, 'CAD');
    expect(prompt).toContain('This quote is priced in CAD');
    expect(prompt).toContain('CA$8,578.39');
    expect(prompt).toContain('A bare "$" is WRONG for this quote');
  });

  it('defaults to USD so existing callers are unchanged in behaviour', () => {
    expect(leadChatSystemPrompt(TENANT, AI)).toBe(leadChatSystemPrompt(TENANT, AI, 'USD'));
  });

  it('never tells a USD quote to write CA$', () => {
    expect(leadChatSystemPrompt(TENANT, AI, 'USD')).not.toContain('CA$');
  });

  it('keeps every pre-existing instruction (additive only)', () => {
    const prompt = leadChatSystemPrompt(TENANT, AI, 'CAD');
    expect(prompt).toContain('You are the customer-service chat AI for Maple Line Transport');
    expect(prompt).toContain('Re-explain the quote breakdown');
    expect(prompt).toContain('Adjust accessorials and re-compute (using the recalc tool)');
    expect(prompt).toContain('Promise pricing you didn’t compute'.replace('’', "'"));
    expect(prompt).toContain('2-4 sentence replies typically');
    // The currency block is APPENDED — the original prompt is a prefix of it.
    expect(prompt.startsWith(leadChatSystemPrompt(TENANT, AI, 'USD').slice(0, 200))).toBe(true);
  });

  it('re-explaining a CAD breakdown is instructed not to restate values', () => {
    expect(leadChatSystemPrompt(TENANT, AI, 'CAD')).toMatch(
      /Never convert, recalculate, round/
    );
  });
});

describe('labelSummaryCurrency — defensive post-format', () => {
  it('normalises a bare "$" in a CAD summary', () => {
    expect(labelSummaryCurrency('Quote #QF-2026-0042 — $8,578.39 all-in.', 'CAD')).toBe(
      'Quote #QF-2026-0042 — CA$8,578.39 all-in.'
    );
  });

  it('never double-prefixes an already-labelled amount', () => {
    expect(labelSummaryCurrency('Total CA$8,578.39 today.', 'CAD')).toBe('Total CA$8,578.39 today.');
    expect(labelSummaryCurrency('Total US$120.00 today.', 'CAD')).toBe('Total US$120.00 today.');
    expect(labelSummaryCurrency('Total CAD $8,578.39.', 'CAD')).toBe('Total CAD $8,578.39.');
    // Idempotent: running it twice cannot produce "CACA$".
    const once = labelSummaryCurrency('Total $50.00.', 'CAD') as string;
    expect(once).toBe('Total CA$50.00.');
    expect(labelSummaryCurrency(once, 'CAD')).toBe(once);
  });

  it('still relabels after ordinary words that merely end in CA/US', () => {
    expect(labelSummaryCurrency('Total $50.00.', 'CAD')).toBe('Total CA$50.00.');
    expect(labelSummaryCurrency('Liftgate surplus $12.00.', 'CAD')).toBe(
      'Liftgate surplus CA$12.00.'
    );
  });

  it('handles several amounts in one paragraph', () => {
    expect(
      labelSummaryCurrency('Linehaul $7,200.00, fuel $978.39, total $8,578.39.', 'CAD')
    ).toBe('Linehaul CA$7,200.00, fuel CA$978.39, total CA$8,578.39.');
  });

  it('never alters a digit', () => {
    const src = 'Linehaul $7,200.00 over 1,204 mi at $5.98/mi.';
    const out = labelSummaryCurrency(src, 'CAD') as string;
    expect(out.replace(/CA\$/g, '$')).toBe(src);
    expect(out.match(/\d+/g)).toEqual(src.match(/\d+/g));
  });

  it('leaves plain prose with no "$" untouched', () => {
    const prose = 'Thanks for your request — we will lock the truck once you confirm the date.';
    expect(labelSummaryCurrency(prose, 'CAD')).toBe(prose);
  });

  it('leaves USD summaries byte-for-byte untouched', () => {
    const usd = 'Quote #QF-2026-0042 — $8,578.39 all-in.';
    expect(labelSummaryCurrency(usd, 'USD')).toBe(usd);
  });

  it('passes through a null/empty summary (AI disabled) without throwing', () => {
    expect(labelSummaryCurrency(null, 'CAD')).toBeNull();
    expect(labelSummaryCurrency(undefined, 'CAD')).toBeUndefined();
    expect(labelSummaryCurrency('', 'CAD')).toBe('');
  });
});
