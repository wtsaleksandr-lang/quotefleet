import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

/**
 * Reconstructs the callbackStatusLabel / callbackStatusClass maps from app.js
 * and returns them as callable functions, so the label/badge logic is tested
 * as behaviour (not just a string-match). app.js is a plain browser script
 * (IIFE, no exports), so we lift the two functions out and eval them in a
 * bare scope.
 */
function extractFn(js: string, name: string): (s: string) => string {
  const start = js.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  // Walk braces from the first `{` after the signature to the matching close.
  const open = js.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const src = js.slice(start, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn ' + name + ';')() as (s: string) => string;
}

describe('leads + callbacks UX polish', () => {
  it('maps every callback status to a human label (not raw snake_case)', async () => {
    const js = await file('app.js');
    const label = extractFn(js, 'callbackStatusLabel');
    expect(label('open')).toBe('Open');
    expect(label('in_progress')).toBe('In progress');
    expect(label('completed')).toBe('Completed');
    expect(label('no_answer')).toBe('No answer');
    expect(label('cancelled')).toBe('Cancelled');
    // Unknown status degrades gracefully to its own value.
    expect(label('weird_value')).toBe('weird_value');
  });

  it('assigns each callback status a real, tinted badge class', async () => {
    const js = await file('app.js');
    const cls = extractFn(js, 'callbackStatusClass');
    const valid = new Set(['badge-info', 'badge-warn', 'badge-success', 'badge-muted', 'badge-error']);
    for (const s of ['open', 'in_progress', 'completed', 'no_answer', 'cancelled']) {
      expect(valid.has(cls(s))).toBe(true);
    }
    expect(cls('unknown')).toBe('badge-muted');
  });

  it('covers exactly the CALLBACK_STATUSES the queue offers', async () => {
    const js = await file('app.js');
    const label = extractFn(js, 'callbackStatusLabel');
    const m = js.match(/var CALLBACK_STATUSES = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const statuses = m![1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
    expect(statuses.length).toBeGreaterThan(0);
    for (const s of statuses) {
      // Every offered status has a bespoke (non-passthrough) label.
      expect(label(s)).not.toBe(s);
    }
  });

  it('gives the lead-detail status + notes saves visible toast feedback', async () => {
    const js = await file('app.js');
    // Status change on the lead-detail select is wrapped in saved() (toasts on success).
    expect(js).toMatch(/saved\(api\('\/api\/tenant\/leads\/' \+ encodeURIComponent\(l\.refId\), \{ method: 'PATCH', body: \{ status: sel\.value \} \}\)\)/);
    // Notes blur only saves when changed, and toasts via saved().
    expect(js).toContain("if (ta.value === (l.notes || '')) return;");
    expect(js).toMatch(/saved\(api\('\/api\/tenant\/leads\/' \+ encodeURIComponent\(l\.refId\), \{ method: 'PATCH', body: \{ notes: ta\.value \} \}\)/);
  });

  it('renders the callback status as a badge and human-labelled options', async () => {
    const js = await file('app.js');
    expect(js).toContain("var statusBadge = el('span', { class: 'badge ' + callbackStatusClass(cb.status), text: callbackStatusLabel(cb.status) });");
    expect(js).toContain('o.textContent = callbackStatusLabel(s);');
    expect(js).toContain("class: 'qf-cb-status'");
  });

  it('adds accessible names to the leads + callbacks controls', async () => {
    const js = await file('app.js');
    expect(js).toContain("'aria-label': 'Search leads by ref, customer, company, email, or lane'");
    expect(js).toContain("'aria-label': 'Filter leads by status'");
    expect(js).toContain("'aria-label': 'Previous page of leads'");
    expect(js).toContain("'aria-label': 'Next page of leads'");
    expect(js).toContain("'aria-label': 'Callback status'");
    // Toast region is a polite live region.
    expect(js).toContain("t.setAttribute('aria-live', 'polite');");
    expect(js).toContain("t.setAttribute('role', 'status');");
  });

  it('stacks name over email/phone in the mobile cards via a single flex item', async () => {
    const js = await file('app.js');
    const css = await file('lead-queue-search.css');
    // Stacked value cells wrap their name+email pair.
    expect(js).toContain('<span class="qf-stack-cell">');
    // CSS forces the pair to stack (column) and hides the <br> at ≤480px.
    expect(css).toContain('.qf-stack-cell');
    expect(css).toMatch(/\.qf-leads-table tbody td \.qf-stack-cell \{[^}]*flex-direction: column/);
    expect(css).toContain('.qf-leads-table tbody td .qf-stack-cell br { display: none; }');
    // Callback status wrapper CSS is present.
    expect(css).toContain('.qf-cb-status');
  });
});
