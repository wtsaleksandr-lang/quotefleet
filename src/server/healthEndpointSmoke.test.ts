import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = process.cwd();

async function read(path: string) {
  return readFile(resolve(rootDir, path), 'utf8');
}

describe('production health endpoint', () => {
  it('keeps public health checks mounted without leaking db diagnostics', async () => {
    const app = await read('src/server/app.ts');

    expect(app).toContain("['/healthz', '/api/health']");
    expect(app).toContain("status: 'up'");
    expect(app).toContain("status: 'down'");
    expect(app).toContain("[health] db ping failed");
    expect(app).not.toContain('dbUrlSet');
    expect(app).not.toContain('dbUrlScheme');
    expect(app).not.toContain('dbUrlHasHost');
    expect(app).not.toContain('causeMessage');
  });
});
