import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFile(resolve(root, p), 'utf8');

// Regression locks for the portal-audit fixes (the ones most likely to silently
// come back). The rest are behavioural (UI/keyboard/preview) and covered live.
describe('portal audit fixes', () => {
  it('the mobile Customize sheet no longer references undefined applyFloatGeometry / resizeGrip', async () => {
    const js = await read('src/server/public/app.js');
    // Both threw ReferenceErrors (undefined call on resize; undeclared assign under strict mode).
    expect(js).not.toContain('applyFloatGeometry');
    expect(js).not.toContain('resizeGrip');
  });

  it('changing the password revokes every OTHER session', async () => {
    const auth = await read('src/server/routes/auth.ts');
    expect(auth).toContain('delete(sessions).where(and(eq(sessions.userId, ctx.user.id), ne(sessions.token');
  });

  it('imported rate values are clamped so a bad parse cannot produce negative / >100% quotes', async () => {
    const ing = await read('src/server/routes/ingest.ts');
    expect(ing).toContain('const clampMoney');
    expect(ing).toContain('ratePerMile: clampMoney(');
    expect(ing).toContain('marginPct: clampPct(');
  });

  it('switching an accessorial to pct_of_base clamps the stored amount (no 500%-of-base surcharge)', async () => {
    const t = await read('src/server/routes/tenant.ts');
    expect(t).toContain("patch.kind === 'pct_of_base' && patch.amount == null");
  });

  it('api() parses the body defensively instead of a raw r.json() that throws on non-JSON', async () => {
    const js = await read('src/server/public/app.js');
    expect(js).toContain('r.text().then(function (body)');
  });

  // ── round 2 ────────────────────────────────────────────────────
  it('the overview endpoint counts new leads with an aggregate, not a full-table load', async () => {
    const t = await read('src/server/routes/tenant.ts');
    // A full db().select().from(leads) pulled every row just to count the "new" ones.
    expect(t).toContain('.from(leads)');
    expect(t).toMatch(/count\(\)[\s\S]{0,80}\.from\(leads\)/);
  });

  it('deleting a rate card validates the id and 404s when nothing matched', async () => {
    const t = await read('src/server/routes/tenant.ts');
    expect(t).toContain("if (!Number.isFinite(id)) return res.status(400)");
    expect(t).toContain("if (!deleted.length) return res.status(404)");
  });

  it('copy buttons route through the copyText fallback (no bare navigator.clipboard that throws off-HTTPS)', async () => {
    const js = await read('src/server/public/app.js');
    expect(js).toContain('function copyText(');
    expect(js).toContain('function legacyCopy(');
    // No raw clipboard write should remain — they all go through copyText().
    expect(js).not.toContain('navigator.clipboard.writeText(');
  });

  it('the onboarding fast-path re-enables its buttons on failure so the user is not stranded', async () => {
    const ob = await read('src/server/public/onboarding-wizard.js');
    expect(ob).toMatch(/state\.submitting = false;[\s\S]{0,320}nextBtn\.disabled = false; skipBtn\.disabled = false;/);
  });

  it('lead status labels are HTML-escaped before injection', async () => {
    const js = await read('src/server/public/app.js');
    expect(js).toContain('escapeHtml(statusLabel(');
  });

  it('the portal exposes a skip link and a focusable content region for keyboard users', async () => {
    const html = await read('src/server/public/app.html');
    expect(html).toContain('class="qf-skip-link" href="#page-content"');
    expect(html).toContain('id="page-content" tabindex="-1"');
  });
});
