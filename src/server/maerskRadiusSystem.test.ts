import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('Maersk-style global radius system', () => {
  it('keeps the shared radius tokens restrained', async () => {
    const css = await file('maersk-radius-system.css');

    expect(css).toContain('Phase BY');
    expect(css).toContain('--qf-maersk-radius-card: 8px');
    expect(css).toContain('--qf-maersk-radius-control: 6px');
    expect(css).toContain('--qf-maersk-radius-button: 4px');
    expect(css).toContain('body.qf-app-calculator .qf-widget');
    expect(css).toContain('body.qf-wft .visual-flow');
  });

  it('loads the radius system on the dashboard, admin, landing, and quote tool', async () => {
    const app = await file('app.html');
    const admin = await file('admin.html');
    const landingMotion = await file('landing-motion.js');
    const calculator = await file('public-calculator-conditional-options.js');

    expect(app).toContain('/maersk-radius-system.css');
    expect(admin).toContain('/maersk-radius-system.css');
    expect(landingMotion).toContain('/maersk-radius-system.css');
    expect(calculator).toContain('/maersk-radius-system.css');
  });

  it('applies restrained radii inside the actual quote tool styles', async () => {
    const appStyle = await file('public-calculator-app-style.css');
    const brandPreview = await file('public-calculator-brand-preview.css');

    expect(appStyle).toContain('--qf-app-radius-shell: 8px');
    expect(appStyle).toContain('--qf-app-radius-card: 8px');
    expect(appStyle).toContain('--qf-app-radius-control: 6px');
    expect(appStyle).toContain('--qf-app-radius-button: 4px');
    expect(brandPreview).toContain('border-radius: var(--qf-app-radius-button)');
    expect(brandPreview).not.toContain('border-radius: 17px');
  });
});
