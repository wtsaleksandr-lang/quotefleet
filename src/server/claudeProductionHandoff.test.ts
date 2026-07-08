import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('Claude Code production handoff', () => {
  it('documents credential-blocked launch work', async () => {
    const doc = await read('docs/claude-code-production-handoff.md');

    expect(doc).toContain('Claude Code production handoff');
    expect(doc).toContain('SMTP / outbound email');
    expect(doc).toContain('Domain/DNS and host domains');
    expect(doc).toContain('Database backups and restore drill');
    expect(doc).toContain('Monitoring and alerting provider');
    expect(doc).toContain('Stripe/payment production setup');
    expect(doc).toContain('Legal/support/public notices');
    expect(doc).toContain('Never commit `.env`');
  });

  it('adds a production readiness checker without printing full secrets', async () => {
    const script = await read('scripts/check-production-readiness.ts');
    const pkg = await read('package.json');

    expect(script).toContain('masked(name)');
    expect(script).toContain('DATABASE_URL');
    expect(script).toContain('SMTP_HOST');
    expect(script).toContain('STRIPE_SECRET_KEY');
    expect(script).toContain('STRIPE_WEBHOOK_SECRET');
    expect(script).toContain('--target=');
    expect(pkg).toContain('prod:check');
  });

  it('links the handoff from support docs and README', async () => {
    const index = await read('docs/support-docs-index.md');
    const readme = await read('README.md');

    expect(index).toContain('docs/claude-code-production-handoff.md');
    expect(readme).toContain('docs/claude-code-production-handoff.md');
    expect(readme).toContain('pnpm prod:check -- --target=public-launch');
  });
});
