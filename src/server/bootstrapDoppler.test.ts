import { describe, it, expect } from 'vitest';
import {
  applyDopplerSecrets,
  detectDopplerConfig,
  parseOverrideKeys,
  type DopplerSecrets,
} from './bootstrapDoppler.js';

/** Build a Doppler-shaped secrets map from a plain key→value record. */
function secretsOf(kv: Record<string, string>): DopplerSecrets {
  const out: DopplerSecrets = {};
  for (const [k, v] of Object.entries(kv)) out[k] = { computed: v, raw: v };
  return out;
}

describe('applyDopplerSecrets', () => {
  it('fills a MISSING key', () => {
    const env: Record<string, string | undefined> = {};
    const r = applyDopplerSecrets(env, secretsOf({ DATABASE_URL: 'postgres://x' }));
    expect(env.DATABASE_URL).toBe('postgres://x');
    expect(r.applied).toBe(1);
    expect(r.skippedExisting).toBe(0);
  });

  it('also fills a key that exists but is EMPTY', () => {
    const env: Record<string, string | undefined> = { API_KEY: '' };
    applyDopplerSecrets(env, secretsOf({ API_KEY: 'from-doppler' }));
    expect(env.API_KEY).toBe('from-doppler');
  });

  it('does NOT overwrite an existing non-empty key (runtime/Replit wins)', () => {
    const env: Record<string, string | undefined> = { API_KEY: 'from-replit' };
    const r = applyDopplerSecrets(env, secretsOf({ API_KEY: 'from-doppler' }));
    expect(env.API_KEY).toBe('from-replit');
    expect(r.applied).toBe(0);
    expect(r.skippedExisting).toBe(1);
  });

  it('overrides ONLY keys in the override list', () => {
    const env: Record<string, string | undefined> = {
      API_KEY: 'from-replit',
      OTHER: 'keep-me',
    };
    const r = applyDopplerSecrets(
      env,
      secretsOf({ API_KEY: 'from-doppler', OTHER: 'doppler-other' }),
      { overrideKeys: new Set(['API_KEY']) },
    );
    expect(env.API_KEY).toBe('from-doppler'); // overridden
    expect(env.OTHER).toBe('keep-me'); // not in list → runtime wins
    expect(r.overrode).toBe(1);
    expect(r.overrodeNames).toEqual(['API_KEY']);
    expect(r.skippedExisting).toBe(1);
  });

  it('skips Doppler bookkeeping vars + the NAME var', () => {
    const env: Record<string, string | undefined> = {};
    applyDopplerSecrets(
      env,
      secretsOf({
        DOPPLER_TOKEN: 'dp.st.prd.abc',
        DOPPLER_PROJECT: 'quotefleet',
        DOPPLER_CONFIG: 'prd',
        DOPPLER_ENVIRONMENT: 'prd',
        DOPPLER_OVERRIDE_KEYS: 'API_KEY',
        NAME: 'prd',
        REAL_SECRET: 'yes',
      }),
    );
    expect(env.DOPPLER_TOKEN).toBeUndefined();
    expect(env.DOPPLER_PROJECT).toBeUndefined();
    expect(env.DOPPLER_CONFIG).toBeUndefined();
    expect(env.DOPPLER_ENVIRONMENT).toBeUndefined();
    expect(env.DOPPLER_OVERRIDE_KEYS).toBeUndefined();
    expect(env.NAME).toBeUndefined();
    expect(env.REAL_SECRET).toBe('yes'); // non-bookkeeping key still applied
  });

  it('skips empty Doppler values (does not clobber with empty)', () => {
    const env: Record<string, string | undefined> = {};
    const r = applyDopplerSecrets(env, { EMPTY_ONE: { computed: '', raw: '' } });
    expect(env.EMPTY_ONE).toBeUndefined();
    expect(r.applied).toBe(0);
    expect(r.skippedEmpty).toBe(1);
  });

  it('injects legitimate DOPPLER_*-prefixed runtime secrets (only exact bookkeeping names are skipped)', () => {
    const env: Record<string, string | undefined> = {};
    applyDopplerSecrets(env, secretsOf({ DOPPLER_WEBHOOK_SECRET: 'hmac-secret' }));
    expect(env.DOPPLER_WEBHOOK_SECRET).toBe('hmac-secret');
  });
});

describe('detectDopplerConfig', () => {
  it('auto-detects config from a dp.st.prd.xxx service token → prd', () => {
    expect(detectDopplerConfig('dp.st.prd.abc123')).toBe('prd');
  });

  it('auto-detects config from a dp.st.dev.xxx service token → dev', () => {
    expect(detectDopplerConfig('dp.st.dev.abc123')).toBe('dev');
  });

  it('explicit config override wins over token parse', () => {
    expect(detectDopplerConfig('dp.st.prd.abc123', 'stg')).toBe('stg');
  });

  it('falls back to prd when NODE_ENV=production and token is not parseable', () => {
    expect(detectDopplerConfig('dp.pt.notservice', undefined, 'production')).toBe('prd');
  });

  it('falls back to dev otherwise', () => {
    expect(detectDopplerConfig('dp.pt.notservice', undefined, undefined)).toBe('dev');
  });
});

describe('parseOverrideKeys', () => {
  it('parses a comma-separated list, trimming + dropping blanks', () => {
    expect([...parseOverrideKeys(' A, B ,,C ')]).toEqual(['A', 'B', 'C']);
  });

  it('returns an empty set for undefined / empty input', () => {
    expect(parseOverrideKeys(undefined).size).toBe(0);
    expect(parseOverrideKeys('').size).toBe(0);
  });
});
