/**
 * parseInbound unit tests — pure string transforms, no network/DB.
 * Proves the ported mail helpers + the new signature parser against
 * representative broker/carrier inbound emails.
 */
import { describe, it, expect } from 'vitest';
import {
  extractEmail,
  extractMessageId,
  stripQuotedText,
  htmlToText,
  extractSignature,
} from './parseInbound.js';

describe('extractEmail', () => {
  it('pulls the address from an angle-bracket From header', () => {
    expect(extractEmail('Dana Whitfield <dana@brokerco.com>')).toBe('dana@brokerco.com');
  });
  it('accepts a bare address and lowercases it', () => {
    expect(extractEmail('Sales@BrokerCo.com')).toBe('sales@brokerco.com');
  });
  it('returns null on junk / empty', () => {
    expect(extractEmail('not an email')).toBeNull();
    expect(extractEmail('')).toBeNull();
  });
});

describe('extractMessageId', () => {
  it('reads the Message-ID out of a raw header block (case-insensitive)', () => {
    const headers = [
      'Received: from mail.brokerco.com',
      'From: dana@brokerco.com',
      'Message-ID: <abc-123@brokerco.com>',
      'Subject: Reefer capacity',
    ].join('\n');
    expect(extractMessageId(headers)).toBe('<abc-123@brokerco.com>');
  });
  it('returns null when absent', () => {
    expect(extractMessageId('From: x@y.com')).toBeNull();
    expect(extractMessageId('')).toBeNull();
  });
});

describe('stripQuotedText', () => {
  it('keeps the new text and drops the quoted "On … wrote:" chain', () => {
    const raw =
      'Great — following up on our capacity.\n\n' +
      'On Mon, Aug 4, 2026 at 9:00 AM Aleksandr <a@quotefleet.net> wrote:\n' +
      '> Thanks for reaching out.\n' +
      '> Here is the demo.';
    const out = stripQuotedText(raw);
    expect(out).toBe('Great — following up on our capacity.');
    expect(out).not.toContain('demo');
  });
  it('drops a trailing run of ">"-quoted lines', () => {
    const raw = 'New line here.\n> quoted\n> more quoted';
    expect(stripQuotedText(raw)).toBe('New line here.');
  });
  it('returns the whole message when there is no quote', () => {
    expect(stripQuotedText('Just one paragraph.')).toBe('Just one paragraph.');
  });
});

describe('htmlToText', () => {
  it('converts a simple HTML body to readable text', () => {
    const html = '<div>Hi there,</div><p>We move <b>reefer</b> freight.</p><br>Thanks &amp; regards';
    const out = htmlToText(html);
    expect(out).toContain('Hi there,');
    expect(out).toContain('We move reefer freight.');
    expect(out).toContain('Thanks & regards');
    expect(out).not.toContain('<');
  });
});

describe('extractSignature', () => {
  it('pulls name, title, and phone from a broker cold-email signature', () => {
    const body = [
      'Hi there,',
      '',
      'We run a ton of reefer capacity out of Long Beach and would love to set up lanes with your team.',
      '',
      'Thanks,',
      'Dana Whitfield',
      'Senior Logistics Manager',
      'BrokerCo Freight',
      '(562) 555-1234',
      'dana@brokerco.com',
    ].join('\n');
    const sig = extractSignature(body);
    expect(sig.name).toBe('Dana Whitfield');
    expect(sig.title).toBe('Senior Logistics Manager');
    expect(sig.phone).toBe('(562) 555-1234');
  });

  it('handles a signature with no explicit sign-off (trailing-lines fallback)', () => {
    const body = [
      'Following up on carrier onboarding for our fleet.',
      '',
      'Marcus Reed',
      'Carrier Sales',
      '888-555-0100',
    ].join('\n');
    const sig = extractSignature(body);
    expect(sig.name).toBe('Marcus Reed');
    expect(sig.title).toBe('Carrier Sales');
    expect(sig.phone).toBe('888-555-0100');
  });

  it('returns an empty object when there is nothing signature-like', () => {
    expect(extractSignature('please quote my shipment')).toEqual({});
    expect(extractSignature('')).toEqual({});
  });
});
