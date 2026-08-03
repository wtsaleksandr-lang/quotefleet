import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const routesDir = resolve(process.cwd(), 'src/server/routes');

async function pub(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('leads CSV export button', () => {
  it('wires an Export CSV download to the existing tenant export endpoint', async () => {
    const js = await pub('app.js');
    // Button is a plain download link (session-cookie authed, tenant-scoped).
    expect(js).toContain('Export CSV');
    expect(js).toContain('/api/tenant/leads/export.csv');
    expect(js).toContain('qf-leads-export');
    expect(js).toContain("download: ''");
    // Header wrapper the button lives in.
    expect(js).toContain('qf-leads-header');
  });

  it('only offers the button when there are leads to export', async () => {
    const js = await pub('app.js');
    const start = js.indexOf('qf-leads-header');
    const guard = js.indexOf('if (d.leads.length)', start);
    const anchor = js.indexOf('qf-leads-export', start);
    expect(guard).toBeGreaterThan(-1);
    // The export anchor is emitted inside the leads-length guard.
    expect(anchor).toBeGreaterThan(guard);
  });

  it('backs the button with a real server-side export route', async () => {
    const tenant = await readFile(resolve(routesDir, 'tenant.ts'), 'utf8');
    expect(tenant).toContain("app.get('/api/tenant/leads/export.csv'");
    expect(tenant).toContain('text/csv');
  });
});

describe('callbacks + audit tables mobile card reflow', () => {
  it('gives the callbacks table the shared reflow class + labelled cells', async () => {
    const js = await pub('app.js');
    expect(js).toContain("class: 'table qf-leads-table qf-callbacks-table'");
    // Every callback cell is labelled so it reads as a card on a phone.
    for (const label of ['Customer', 'Phone', 'Quote', 'Topic', 'Status', 'When', 'Notes']) {
      expect(js).toContain('data-label="' + label + '"');
    }
  });

  it('gives the audit log table the shared reflow class + labelled cells', async () => {
    const js = await pub('app.js');
    // The audit table string builder carries the reflow class + its own labels.
    expect(js).toContain('<td data-label="When"><span class="muted-small">');
    expect(js).toContain('<td data-label="Action"><strong>');
    expect(js).toContain('<td data-label="By"><span class="badge ');
    expect(js).toContain('<td data-label="Reason">');
  });

  it('reuses the existing leads reflow mechanism in CSS, not a parallel one', async () => {
    const css = await pub('lead-queue-search.css');
    // The ≤480px card reflow keyed on qf-leads-table must already exist.
    expect(css).toContain('@media (max-width: 480px)');
    expect(css).toContain('.qf-leads-table tbody td::before');
    // New rules only tune the callbacks-specific cells + the header.
    expect(css).toContain('.qf-leads-header');
    expect(css).toContain('.qf-callbacks-table tbody td .select');
    expect(css).toContain('.qf-callbacks-table tbody tr.callback-notes-editor');
  });
});
