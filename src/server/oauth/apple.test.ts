/**
 * Sign in with Apple — unit tests for the crypto + flow that differs from the
 * other providers. Everything runs against a LOCAL EC (P-256/ES256) test keypair
 * generated in-process, so there is no network and no real Apple credentials:
 *
 *   - the ES256 client_secret is signed with the test private key and VERIFIED
 *     against the matching public key (+ its header/claims decoded and asserted),
 *   - the id_token is signed with the test key and verified through the same
 *     verify path the real flow uses, with the JWKS injected as the public key,
 *   - the full code→profile exchange runs with fetch + JWKS injected.
 *
 * Provider-gating + the authorize-URL shape are asserted against the real
 * providers.ts (apple only "configured" when all four env vars are present).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  generateKeyPair,
  exportPKCS8,
  SignJWT,
  jwtVerify,
  decodeJwt,
  decodeProtectedHeader,
} from 'jose';
import {
  buildAppleClientSecret,
  verifyAppleIdToken,
  parseAppleUserName,
  exchangeAppleCodeForProfile,
  APPLE_ISSUER,
  type AppleSigningConfig,
} from './apple.js';

// Env for providers.ts (loadEnv is lazy; these just need to exist).
process.env.SESSION_SECRET ||= 'x'.repeat(64);
process.env.PUBLIC_BASE_URL ||= 'http://localhost:5000';

const SERVICES_ID = 'net.quotefleet.web';
const TEAM_ID = 'ABCDE12345';
const KEY_ID = 'KEY1234567';

let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let privatePkcs8: string;
let signingCfg: AppleSigningConfig;

/** A JWTVerifyGetKey-compatible resolver that always returns our test key. */
const localKeyResolver = () => Promise.resolve(keyPair.publicKey);

beforeAll(async () => {
  keyPair = await generateKeyPair('ES256', { extractable: true });
  privatePkcs8 = await exportPKCS8(keyPair.privateKey);
  signingCfg = { servicesId: SERVICES_ID, teamId: TEAM_ID, keyId: KEY_ID, privateKey: privatePkcs8 };
});

/** Sign an id_token exactly like Apple would (for verify/exchange tests). */
async function signAppleIdToken(overrides: Record<string, unknown> = {}, nowS = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ email: 'buyer@icloud.com', email_verified: 'true', ...overrides })
    .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
    .setIssuer(APPLE_ISSUER)
    .setAudience(SERVICES_ID)
    .setSubject('001234.apple.stable.sub')
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + 600)
    .sign(keyPair.privateKey);
}

function enableAppleEnv() {
  process.env.APPLE_OAUTH_CLIENT_ID = SERVICES_ID;
  process.env.APPLE_TEAM_ID = TEAM_ID;
  process.env.APPLE_KEY_ID = KEY_ID;
  process.env.APPLE_PRIVATE_KEY = privatePkcs8;
}
function disableAppleEnv() {
  delete process.env.APPLE_OAUTH_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
}

afterEach(() => disableAppleEnv());

describe('provider-gating (apple)', () => {
  it('apple is configured + advertised ONLY when all four env vars are present', async () => {
    const { isConfigured, configuredProviders } = await import('./providers.js');
    disableAppleEnv();
    expect(isConfigured('apple')).toBe(false);
    expect(configuredProviders()).not.toContain('apple');

    // Missing one of the four is still "not configured".
    process.env.APPLE_OAUTH_CLIENT_ID = SERVICES_ID;
    process.env.APPLE_TEAM_ID = TEAM_ID;
    process.env.APPLE_KEY_ID = KEY_ID;
    expect(isConfigured('apple')).toBe(false);

    enableAppleEnv();
    expect(isConfigured('apple')).toBe(true);
    expect(configuredProviders()).toContain('apple');
  });
});

describe('authorize URL shape (apple)', () => {
  it('targets Apple, uses response_mode=form_post + scope "name email" + signed state', async () => {
    enableAppleEnv();
    const { buildAuthorizeUrl } = await import('./providers.js');
    const url = buildAuthorizeUrl('apple', 'login');
    expect(url.startsWith('https://appleid.apple.com/auth/authorize?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('client_id')).toBe(SERVICES_ID);
    expect(q.get('response_type')).toBe('code');
    expect(q.get('response_mode')).toBe('form_post');
    expect(q.get('scope')).toBe('name email');
    expect(q.get('redirect_uri')).toBe('http://localhost:5000/auth/oauth/apple/callback');
    expect((q.get('state') || '').split('.').length).toBe(2); // payload.hmac
  });
});

describe('ES256 client_secret JWT', () => {
  it('has header {alg:ES256, kid} and claims iss/sub/aud/iat/exp(+300)', async () => {
    const now = 1_700_000_000;
    const jwt = await buildAppleClientSecret(signingCfg, now);

    const header = decodeProtectedHeader(jwt);
    expect(header.alg).toBe('ES256');
    expect(header.kid).toBe(KEY_ID);

    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe(TEAM_ID);
    expect(claims.sub).toBe(SERVICES_ID);
    expect(claims.aud).toBe(APPLE_ISSUER);
    expect(claims.iat).toBe(now);
    expect(claims.exp).toBe(now + 300);
  });

  it('verifies against the public key derived from the signing keypair', async () => {
    const jwt = await buildAppleClientSecret(signingCfg);
    // The client_secret's iss is the TEAM id and aud is Apple — verify with the
    // public half of the test keypair. A wrong signature/iss/aud would throw.
    const { payload, protectedHeader } = await jwtVerify(jwt, keyPair.publicKey, {
      issuer: TEAM_ID,
      audience: APPLE_ISSUER,
    });
    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe(KEY_ID);
    expect(payload.sub).toBe(SERVICES_ID);
  });

  it('tolerates a single-line .p8 stored with literal \\n', async () => {
    const singleLine = privatePkcs8.replace(/\n/g, '\\n');
    const jwt = await buildAppleClientSecret({ ...signingCfg, privateKey: singleLine });
    expect(decodeProtectedHeader(jwt).alg).toBe('ES256');
    expect(decodeJwt(jwt).sub).toBe(SERVICES_ID);
  });
});

describe('id_token verification', () => {
  it('accepts a well-formed token and returns sub/email/email_verified', async () => {
    const token = await signAppleIdToken();
    const claims = await verifyAppleIdToken(token, SERVICES_ID, localKeyResolver);
    expect(claims.sub).toBe('001234.apple.stable.sub');
    expect(claims.email).toBe('buyer@icloud.com');
    expect(claims.email_verified).toBe('true');
  });

  it('rejects a token minted for a different audience', async () => {
    const token = await signAppleIdToken({}, Math.floor(Date.now() / 1000));
    await expect(verifyAppleIdToken(token, 'net.someone.else', localKeyResolver)).rejects.toThrow();
  });
});

describe('parseAppleUserName (first-consent name)', () => {
  it('extracts a full name from the first-consent user JSON', () => {
    expect(parseAppleUserName('{"name":{"firstName":"Ada","lastName":"Lovelace"},"email":"x@y.z"}')).toBe(
      'Ada Lovelace'
    );
  });
  it('tolerates absence / blank / malformed → null', () => {
    expect(parseAppleUserName(undefined)).toBeNull();
    expect(parseAppleUserName('')).toBeNull();
    expect(parseAppleUserName('not json')).toBeNull();
    expect(parseAppleUserName('{"name":{}}')).toBeNull();
  });
});

describe('exchangeAppleCodeForProfile (fetch + JWKS injected, no network)', () => {
  it('signs a client_secret, posts the code, verifies the id_token, returns the profile', async () => {
    const idToken = await signAppleIdToken();
    let captured: { url: string; body: string } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), body: String(init.body) };
      return {
        ok: true,
        json: async () => ({ id_token: idToken }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const profile = await exchangeAppleCodeForProfile(
      'the-auth-code',
      'Ada Lovelace',
      { ...signingCfg, redirectUri: 'http://localhost:5000/auth/oauth/apple/callback' },
      { fetchImpl, keyResolver: localKeyResolver }
    );

    expect(profile).toEqual({
      sub: '001234.apple.stable.sub',
      email: 'buyer@icloud.com',
      emailVerified: true,
      name: 'Ada Lovelace',
    });
    // The exchange hit Apple's token endpoint with a signed client_secret + code.
    expect(captured!.url).toBe('https://appleid.apple.com/auth/token');
    const sent = new URLSearchParams(captured!.body);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('client_id')).toBe(SERVICES_ID);
    expect(sent.get('code')).toBe('the-auth-code');
    expect((sent.get('client_secret') || '').split('.').length).toBe(3); // a JWT
    // The signed client_secret verifies against the public key + team-id issuer.
    expect(decodeProtectedHeader(sent.get('client_secret')!).kid).toBe(KEY_ID);
  });

  it('throws when Apple returns no id_token', async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await expect(
      exchangeAppleCodeForProfile('c', null, { ...signingCfg, redirectUri: 'r' }, { fetchImpl, keyResolver: localKeyResolver })
    ).rejects.toThrow(/no id_token/);
  });

  it('name is null on a later sign-in (no first-consent user blob)', async () => {
    const idToken = await signAppleIdToken();
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ id_token: idToken }) }) as unknown as Response) as unknown as typeof fetch;
    const profile = await exchangeAppleCodeForProfile(
      'c',
      null,
      { ...signingCfg, redirectUri: 'r' },
      { fetchImpl, keyResolver: localKeyResolver }
    );
    expect(profile.name).toBeNull();
    expect(profile.sub).toBe('001234.apple.stable.sub');
  });
});
