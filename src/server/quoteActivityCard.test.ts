import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');

async function file(name: string) {
  return readFile(resolve(publicDir, name), 'utf8');
}

describe('quote activity card', () => {
  it('shows a next action and timeline for quote activity', async () => {
    const js = await file('app-quote-activity.js');
    expect(js).toContain('function nextAction');
    expect(js).toContain('Callback requested');
    expect(js).toContain('Review chat');
    expect(js).toContain('Follow PDF');
    expect(js).toContain('Send follow-up');
    expect(js).toContain('qf-activity-timeline');
  });

  it('has responsive styling for the activity card', async () => {
    const css = await file('app-quote-actions.css');
    expect(css).toContain('.qf-activity-card');
    expect(css).toContain('.qf-activity-status');
    expect(css).toContain('.qf-activity-step.is-active');
    expect(css).toContain('@media(max-width:700px)');
  });
});
