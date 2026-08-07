/**
 * Ingest provenance — dashboard UI surfacing (string-contract tests).
 *
 * app.js is vanilla-JS DOM-building; like the other dashboard UI tests here we
 * assert on the source string so a regression that drops the provenance surface
 * fails CI. Covers:
 *   - showReview renders the From-line for an email-sourced draft,
 *   - the ingest queue row shows the ✉ email badge + sender,
 *   - the email-import card states the trust model + lists trusted senders with
 *     a remove (✕) control wired to the DELETE endpoint,
 *   - the ✉ badge is a theme-aware token style (no raw hex).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
async function pub(name: string) { return readFile(resolve(publicDir, name), 'utf8'); }

describe('ingest provenance — review + queue', () => {
  it('showReview renders a From-line for an email-sourced draft', async () => {
    const app = await pub('app.js');
    expect(app).toContain("job.source === 'email'");
    expect(app).toContain('job.sourceEmail');
    expect(app).toContain('From ');
    expect(app).toContain('received ');
    // Uses the compact provenance timestamp formatter, not a bare date.
    expect(app).toContain('fmtProvDate');
  });

  it('the queue row shows a ✉ email badge + the sender for email jobs', async () => {
    const app = await pub('app.js');
    expect(app).toContain('qf-email-badge');
    expect(app).toContain('✉');
    // The badge is conditional on provenance — manual uploads never get it.
    expect(app).toContain("j.source === 'email'");
  });

  it('the ✉ badge is a theme-aware token style (no raw hex)', async () => {
    const css = await pub('style.css');
    expect(css).toContain('.qf-email-badge');
    expect(css).toMatch(/\.qf-email-badge[\s\S]*?background:\s*var\(--accent-soft\)/);
    expect(css).toMatch(/\.qf-email-badge[\s\S]*?color:\s*var\(--accent\)/);
  });
});

describe('ingest provenance — trust model + trusted senders', () => {
  it('states the hold-first / trust-after-approval model in plain words', async () => {
    const app = await pub('app.js');
    expect(app).toContain('The first email from a new sender is held for your review');
    expect(app).toContain('apply automatically');
  });

  it('lists trusted senders and wires a remove (✕) control to the DELETE endpoint', async () => {
    const app = await pub('app.js');
    expect(app).toContain('/api/tenant/email-import/senders');
    expect(app).toContain('loadSenders');
    expect(app).toContain('renderSenders');
    // Remove uses DELETE with the encoded address.
    expect(app).toContain("method: 'DELETE'");
    expect(app).toContain('encodeURIComponent(addr)');
  });
});
