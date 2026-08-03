import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

/**
 * Lead queue search was reconciled onto ONE system (feat/leads-server-pagination):
 * renderLeads (app.js) now drives search + status + pagination against the
 * server, replacing the old client-only lead-queue-search.js that filtered just
 * the loaded rows (its counts disagreed with the server past the 200-row cap).
 * The stylesheet is kept and reused; the standalone client-filter script is gone.
 */
describe('lead queue search — server-backed reconciliation', () => {
  it('keeps the reused stylesheet loaded and drops the client-only script', async () => {
    const html = await file('app.html');
    // CSS is reused by renderLeads (searchbar shell + mobile card reflow).
    expect(html).toContain('/lead-queue-search.css');
    // The client-only filter script must no longer be loaded.
    expect(html).not.toContain('/lead-queue-search.js');
  });

  it('drives leads search + status + pagination from the server in app.js', async () => {
    const js = await file('app.js');
    // renderLeads builds the query string against the paginated endpoint.
    expect(js).toContain('/api/tenant/leads');
    expect(js).toContain("'&search=' + encodeURIComponent(state.search)");
    expect(js).toContain("'&status=' + encodeURIComponent(state.status)");
    expect(js).toContain("'?page=' + state.page + '&pageSize=' + state.pageSize");
    // Search + status changes reset to page 1 (accurate whole-table results).
    expect(js).toContain('state.page = 1; load();');
    // The reused searchbar shell + server control layout hook.
    expect(js).toContain('qf-lead-searchbar qf-leads-controls');
    expect(js).toContain('qf-leads-pager');
  });

  it('keeps the searchbar + mobile reflow + new control styling in the stylesheet', async () => {
    const css = await file('lead-queue-search.css');
    expect(css).toContain('Phase AX: lead queue search and premium list polish');
    expect(css).toContain('.qf-lead-searchbar');
    // Mobile stacked-card reflow (reused by the leads table) survives.
    expect(css).toContain('.qf-leads-table tbody td::before');
    // Server-backed control additions: status <select> + pager.
    expect(css).toContain('.qf-lead-searchbar select');
    expect(css).toContain('.qf-leads-pager');
    expect(css).toContain('html[data-theme="light"] .qf-leads-focus');
  });
});
