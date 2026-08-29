/**
 * The gate ships the engine DARK, and fails CLOSED.
 *
 * QuoteFleet's other background machinery (sitemap recompute, directory
 * auto-heal) is load-bearing and deliberately fails OPEN — a transient DB error
 * must not take the site down. This one is the opposite: it spends money and
 * publishes content under our own domain, so every ambiguous state resolves to
 * "off". A new feature must never start working on its own.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { evaluateSeoEngineGate, isSeoEngineFlagEnabled } from './seoEngineGate.js';

const ORIGINAL = process.env.SEO_ENGINE_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.SEO_ENGINE_ENABLED;
  else process.env.SEO_ENGINE_ENABLED = ORIGINAL;
});

describe('SEO_ENGINE_ENABLED', () => {
  it('is OFF when unset — the shipping default', () => {
    delete process.env.SEO_ENGINE_ENABLED;
    expect(isSeoEngineFlagEnabled()).toBe(false);
  });

  it('is OFF for empty or junk values', () => {
    for (const v of ['', '   ', 'maybe', '0', 'false', 'off', 'no']) {
      process.env.SEO_ENGINE_ENABLED = v;
      expect(isSeoEngineFlagEnabled(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('is ON only for explicit truthy values', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.SEO_ENGINE_ENABLED = v;
      expect(isSeoEngineFlagEnabled(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });
});

describe('evaluateSeoEngineGate', () => {
  it('blocks when the flag is off, whatever the kill switch says', () => {
    expect(evaluateSeoEngineGate(false, false).allowed).toBe(false);
    expect(evaluateSeoEngineGate(false, true).allowed).toBe(false);
  });

  it('blocks when the kill switch is on even with the flag set', () => {
    const out = evaluateSeoEngineGate(true, true);
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/kill switch/i);
  });

  it('allows only when the flag is on AND the kill switch is off', () => {
    expect(evaluateSeoEngineGate(true, false).allowed).toBe(true);
  });

  it('explains itself so a blocked run is diagnosable from the log line', () => {
    expect(evaluateSeoEngineGate(false, false).reason).toContain('SEO_ENGINE_ENABLED');
  });
});
