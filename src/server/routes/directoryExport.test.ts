/**
 * Export download gate — .xlsx / .csv downloads are Directory Pro-only, with a
 * `DIRECTORY_EXPORT_FREE=1` env kill-switch. The branded HTML VIEW stays free
 * (it has no gate call at all — see directoryExport.ts). Entitlement is mocked
 * so this is a pure unit test (no DB, no session).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';

vi.mock('../directory/entitlement.js', () => ({ hasDirectoryPro: vi.fn() }));
import { hasDirectoryPro } from '../directory/entitlement.js';
import { canExport } from './directoryExport.js';

const req = () => ({} as unknown as Request);

describe('canExport — download gate', () => {
  beforeEach(() => {
    delete process.env.DIRECTORY_EXPORT_FREE;
    vi.mocked(hasDirectoryPro).mockReset();
  });
  afterEach(() => {
    delete process.env.DIRECTORY_EXPORT_FREE;
  });

  it('denies a non-Pro (free / anonymous) caller by default', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(false);
    expect(await canExport(req())).toBe(false);
    expect(hasDirectoryPro).toHaveBeenCalledOnce();
  });

  it('allows a live Directory Pro subscriber', async () => {
    vi.mocked(hasDirectoryPro).mockResolvedValue(true);
    expect(await canExport(req())).toBe(true);
  });

  it('kill-switch DIRECTORY_EXPORT_FREE=1 opens downloads to everyone, skipping the entitlement check', async () => {
    process.env.DIRECTORY_EXPORT_FREE = '1';
    vi.mocked(hasDirectoryPro).mockResolvedValue(false);
    expect(await canExport(req())).toBe(true);
    expect(hasDirectoryPro).not.toHaveBeenCalled();
  });

  it('kill-switch only fires on exactly "1" (any other value falls through to entitlement)', async () => {
    process.env.DIRECTORY_EXPORT_FREE = 'true';
    vi.mocked(hasDirectoryPro).mockResolvedValue(false);
    expect(await canExport(req())).toBe(false);
    expect(hasDirectoryPro).toHaveBeenCalledOnce();
  });
});
