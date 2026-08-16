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
});
