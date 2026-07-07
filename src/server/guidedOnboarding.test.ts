import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('guided onboarding questions', () => {
  it('adds shared setup questions across setup areas', async () => {
    const js = await file('dashboard-setup.js');

    expect(js).toContain('onboardingQuestions');
    expect(js).toContain('qf-onboarding-panel');
    expect(js).toContain('qf-onboarding-options');
    expect(js).toContain('Save custom');
    expect(js).toContain('rates:');
    expect(js).toContain('accessorials:');
    expect(js).toContain('zones:');
    expect(js).toContain('brand:');
    expect(js).toContain('embed:');
  });

  it('adds AI training questions and apply action', async () => {
    const js = await file('dashboard-setup.js');
    const css = await file('dashboard-setup.css');

    expect(js).toContain('Train this customer AI agent');
    expect(js).toContain('Apply to AI prompt');
    expect(js).toContain('What must the AI agent never promise?');
    expect(js).toContain('applyAiAnswers');

    expect(css).toContain('Phase BI');
    expect(css).toContain('.qf-onboarding-panel');
    expect(css).toContain('.qf-onboarding-custom');
  });
});
