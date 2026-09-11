/**
 * SAFETY: an ownership code must never reach a carrier's FMCSA census address
 * from a non-production process.
 *
 * `quotefleet/dev` carries a LIVE RESEND_API_KEY, so a dev boot is fully
 * capable of mailing a real trucking company that never asked to hear from us —
 * and that mail cannot be recalled. NODE_ENV cannot tell dev from prod here
 * (`.replit` and the dev Doppler config both pin it to "production"), so the
 * gate reads Doppler's injected config name and FAILS CLOSED.
 *
 * The provider is mocked and a fully-configured email env is faked, so these
 * assertions prove the GUARD stops the send — not the absence of an API key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sendEmail = vi.fn(async () => ({ ok: true, provider: 'resend' as const, id: 'msg_1' }));
vi.mock('../../email/send.js', async () => {
  const actual = await vi.importActual<typeof import('../../email/send.js')>('../../email/send.js');
  return { ...actual, sendEmail };
});

// A provider IS configured — so nothing but the env guard can stop the send.
vi.mock('../../config.js', () => ({
  loadEnv: () => ({
    RESEND_API_KEY: 'test-key-not-a-real-secret',
    RESEND_FROM_EMAIL: 'QuoteFleet <hello@quotefleet.net>',
    PUBLIC_BASE_URL: 'https://quotefleet.net',
    HOST_DOMAINS: ['quotefleet.net'],
  }),
  defaultHostDomain: () => 'quotefleet.net',
}));

const CENSUS_ADDRESS = 'dispatch@a-real-carrier.com';
const ENV_KEYS = ['DOPPLER_CONFIG', 'DOPPLER_ENVIRONMENT', 'CLAIM_ALLOW_REAL_OTP'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sendEmail.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function sendUnder(config: string | undefined): Promise<boolean> {
  if (config !== undefined) process.env.DOPPLER_CONFIG = config;
  const { dbClaimStore } = await import('./claims.js');
  return dbClaimStore.sendOtpEmail(CENSUS_ADDRESS, { code: '123456', company: 'A REAL CARRIER INC' });
}

describe('ownership-code send is gated on a POSITIVELY production environment', () => {
  // 'unknown' is the case that matters most: it is what a plain `node dist/...`,
  // a CI runner and this very test suite all look like.
  for (const config of ['dev', 'stg', 'staging', 'ci', 'test', 'local', 'preview', 'dev_branch', undefined]) {
    it(`never calls the provider under DOPPLER_CONFIG=${config ?? '(unset → unknown)'}`, async () => {
      const delivered = await sendUnder(config);
      expect(delivered).toBe(false);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  }

  it('sends under a production config', async () => {
    const delivered = await sendUnder('prd');
    expect(delivered).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: CENSUS_ADDRESS });
  });

  it('CLAIM_ALLOW_REAL_OTP=1 is the explicit opt-in for deliberate testing', async () => {
    process.env.CLAIM_ALLOW_REAL_OTP = '1';
    expect(await sendUnder('dev')).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('suppression logs the environment but NEVER the code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendUnder('dev');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('OTP suppressed in dev');
    expect(logged).not.toContain('123456');
    warn.mockRestore();
  });

  it('realOtpSendAllowed is false by default in this very test process', async () => {
    const { realOtpSendAllowed } = await import('./claims.js');
    expect(realOtpSendAllowed()).toBe(false);
  });
});
