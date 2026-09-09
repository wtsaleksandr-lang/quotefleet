import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('signin UI smoke coverage', () => {
  it('keeps signup guidance mounted', async () => {
    const signup = await file('signup.html');
    /*
     * The company field is a COMBOBOX now, so it carries autocomplete="off"
     * rather than "organization".
     *
     * That is deliberate and it is the standard for the ARIA combobox pattern:
     * the browser's own organization autofill renders its dropdown in the same
     * place as the suggestion list, and two overlapping dropdowns is a worse
     * experience than either alone. What replaces the hint is a far more useful
     * list — 370,000 active FMCSA carriers, each carrying its DOT number, so a
     * carrier picking itself hands us its verified identity.
     *
     * The intent this assertion has always guarded — that the signup field
     * semantics are deliberate rather than accidental — is asserted below
     * against what the field actually is.
     */
    expect(signup).toContain('data-suggest-endpoint="/api/tools/company-suggest"');
    expect(signup).toContain('id="companyName"');
    expect(signup).toContain('Confirm');
    expect(signup).toContain('normalizeEmail');
    // Two-tier signup: plan chooser + card-required all-inclusive trial copy.
    expect(signup).toContain('14-day all-inclusive trial');
    expect(signup).toContain('name="plan"');
  });

  it('keeps login guidance mounted', async () => {
    const login = await file('login.html');
    expect(login).toContain('current-');
    expect(login).toContain('If that email exists');
    expect(login).toContain('one-time email link');
    expect(login).toContain('normalizeEmail');
    expect(login).toContain('Security note');
  });
});
