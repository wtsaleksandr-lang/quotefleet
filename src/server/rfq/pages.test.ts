/**
 * RFQ form rendering — the signed-in shipper prefill (audit finding H3).
 *
 * The RFQ form hard-requires a logged-in account, yet it used to ask the shipper
 * to re-type identity the account already knows. `renderRfqForm` now prefills the
 * "Your contact" fields from the signed-in identity. These are pure-function
 * tests (no db / no network), mirroring the other directory render tests.
 *
 * Covers:
 *   • signed-in email prefills the email input's value + shows the "Sending as" note;
 *   • name prefills when the account carries one; company/phone stay empty (not stored);
 *   • prefilled values are HTML-escaped (no attribute injection in value="…");
 *   • a bounced-back POST value overrides the identity default;
 *   • anonymous (no identity) → empty contact inputs, no "Sending as" note.
 */
import { describe, it, expect } from 'vitest';
import {
  renderRfqForm,
  renderRfqConfirmation,
  type RfqFormOpts,
  type RfqConfirmationOpts,
} from './pages.js';

const base: RfqFormOpts = {
  recipientCount: 3,
  totalMatched: 3,
  cap: 25,
  capped: false,
  dots: '1,2,3',
};

/** Pull the value="…" of a named input out of the rendered HTML. */
function valueOf(html: string, name: string): string | null {
  // Inputs render as: <input id="rfq-<name>" name="<name>" type="…" … value="…">
  const re = new RegExp(`<input[^>]*\\bname="${name}"[^>]*\\bvalue="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1] : null;
}

describe('renderRfqForm — signed-in shipper prefill (H3)', () => {
  it('prefills the email input value from the signed-in identity', () => {
    const html = renderRfqForm({ ...base, identity: { email: 'dana@acme.example', name: null } });
    expect(valueOf(html, 'shipper_email')).toBe('dana@acme.example');
  });

  it('shows the "Sending as <email>" note when signed in', () => {
    const html = renderRfqForm({ ...base, identity: { email: 'dana@acme.example', name: null } });
    expect(html).toContain('Sending as <strong>dana@acme.example</strong>');
  });

  it('prefills the name when the account carries one', () => {
    const html = renderRfqForm({ ...base, identity: { email: 'dana@acme.example', name: 'Dana Shipper' } });
    expect(valueOf(html, 'shipper_name')).toBe('Dana Shipper');
  });

  it('leaves company + phone empty (not stored on the account)', () => {
    const html = renderRfqForm({ ...base, identity: { email: 'dana@acme.example', name: 'Dana Shipper' } });
    expect(valueOf(html, 'shipper_company')).toBe('');
    expect(valueOf(html, 'shipper_phone')).toBe('');
  });

  it('HTML-escapes the prefilled email — no attribute injection in value="…"', () => {
    const evil = 'x"><script>alert(1)</script>@acme.example';
    const html = renderRfqForm({ ...base, identity: { email: evil, name: null } });
    // The raw payload must never appear unescaped (it would break out of value="…").
    expect(html).not.toContain('value="x"><script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    // It renders as the fully-escaped form instead.
    expect(html).toContain('x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@acme.example');
  });

  it('a bounced-back POST value overrides the identity default', () => {
    const html = renderRfqForm({
      ...base,
      identity: { email: 'account@acme.example', name: 'Account Name' },
      prefill: { shipper_email: 'typed@other.example', shipper_name: 'Typed Name' },
    });
    expect(valueOf(html, 'shipper_email')).toBe('typed@other.example');
    expect(valueOf(html, 'shipper_name')).toBe('Typed Name');
  });

  it('anonymous (no identity) → empty contact inputs and no "Sending as" note', () => {
    const html = renderRfqForm({ ...base });
    expect(valueOf(html, 'shipper_email')).toBe('');
    expect(valueOf(html, 'shipper_name')).toBe('');
    expect(html).not.toContain('Sending as <strong>');
    // The default contact helper still renders.
    expect(html).toContain("So carriers know who's requesting");
  });
});

/**
 * Confirmation page — the delivery-failure surface.
 *
 * Before this, `failed` was not a field: a blast where every send hard-failed
 * rendered "0 Requests sent" and nothing else. The shipper was shown a success
 * page for a total failure.
 */
describe('renderRfqConfirmation — failed deliveries are visible', () => {
  const base: RfqConfirmationOpts = {
    viewUrl: 'https://quotefleet.net/directory/rfq/tok',
    sent: 10,
    noEmail: 1,
    optedOut: 2,
    cappedOut: 0,
    total: 13,
    dryRun: false,
  };

  it('says nothing about failures when there are none', () => {
    const html = renderRfqConfirmation(base);
    expect(html).not.toContain("couldn't be delivered");
    expect(html).not.toContain('Not delivered');
  });

  it('states the failure count in prose AND as a count tile', () => {
    const html = renderRfqConfirmation({ ...base, sent: 8, failed: 2 });
    expect(html).toContain("2 requests couldn't be delivered.");
    expect(html).toContain('Not delivered');
    expect(html).toContain('rfq-note-warn');
  });

  it('reads correctly for a single failure', () => {
    const html = renderRfqConfirmation({ ...base, sent: 9, failed: 1 });
    expect(html).toContain("1 request couldn't be delivered.");
    expect(html).toContain('That carrier was');
  });

  it('tells the shipper it is already reported — they have no action to take', () => {
    const html = renderRfqConfirmation({ ...base, failed: 1 });
    expect(html).toContain("you don't need to report it");
  });

  it('keeps the count tiles to an even number so mobile never orphans one', () => {
    // .rfq-count is flex 1 1 120px: at 375px two fit per row, so an odd tile
    // count would leave a lone stretched tile on the last row.
    const html = renderRfqConfirmation({ ...base, failed: 2 });
    const tiles = html.match(/class="rfq-count"/g) ?? [];
    expect(tiles).toHaveLength(4);
    expect(tiles.length % 2).toBe(0);
  });
});
