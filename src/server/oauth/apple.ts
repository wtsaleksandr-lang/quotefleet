/**
 * Sign in with Apple — the three things Apple does differently from the other
 * OAuth providers (Google / Meta live in ./providers.ts):
 *
 *   1. The callback is a POST (response_mode=form_post), not a GET — handled by
 *      the dedicated app.post('/auth/oauth/apple/callback') route in
 *      src/server/routes/oauth.ts. The display NAME arrives only on the FIRST
 *      consent, in that POST's `user` field (JSON). parseAppleUserName() reads
 *      it when present and tolerates its absence on every later sign-in.
 *
 *   2. The `client_secret` is NOT a static string — it is a short-lived ES256
 *      JWT we sign ourselves per token-exchange (buildAppleClientSecret). A
 *      300s exp regenerated on every exchange means the secret can never expire
 *      on us. Signing key = the .p8 private key (APPLE_PRIVATE_KEY, PKCS#8 PEM).
 *
 *   3. The user identity comes from the `id_token` the token endpoint returns,
 *      which we VERIFY against Apple's JWKS (verifyAppleIdToken) — audience is
 *      our Services ID, issuer is https://appleid.apple.com. The verified `sub`
 *      is the stable Apple user id; `email` may be a private relay address
 *      (@privaterelay.appleid.com). Unlike Google there is no userinfo
 *      endpoint — the signed, verified token IS the profile source.
 *
 * All network + crypto touch-points (fetch, JWKS) are injectable via the deps
 * arg so the unit tests exercise the real flow with a local test keypair and no
 * network. Only `jose` is added as a dependency (ES256 sign + JWKS verify).
 */
import {
  SignJWT,
  importPKCS8,
  jwtVerify,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import type { OAuthProfile } from './providers.js';

export const APPLE_ISSUER = 'https://appleid.apple.com';
export const APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

const HTTP_TIMEOUT_MS = 15_000;
/** client_secret JWT lifetime. Short + regenerated per exchange = never stale.
 *  Apple caps this at 6 months; 5 minutes is the safe minimum-blast-radius. */
const CLIENT_SECRET_TTL_S = 300;

/** The four pieces Apple's server-side flow needs (from Doppler env). */
export interface AppleSigningConfig {
  /** Services ID — the OAuth `client_id` and the id_token `aud`. */
  servicesId: string;
  /** Apple Developer Team ID — the client_secret `iss`. */
  teamId: string;
  /** Key ID of the .p8 signing key — the client_secret header `kid`. */
  keyId: string;
  /** The .p8 private key contents (PKCS#8 PEM). */
  privateKey: string;
}

/** Claims we read off Apple's verified id_token. */
export interface AppleIdTokenClaims extends JWTPayload {
  email?: string;
  /** Apple sends this as the string 'true' | 'false' (sometimes boolean). */
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

/**
 * Build the ES256-signed `client_secret` JWT for a token-exchange.
 * Header: { alg:'ES256', kid: keyId }. Claims: iss=teamId, iat=now, exp=now+300,
 * aud='https://appleid.apple.com', sub=servicesId. Exposed (and pure) so a test
 * can decode + assert the header/claims and verify the signature with the public
 * half of a test EC keypair.
 */
export async function buildAppleClientSecret(
  cfg: AppleSigningConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  // Tolerate a single-line .p8 stored with literal "\n" (common in Doppler /
  // env dashboards) as well as a real multi-line PEM.
  const pem = cfg.privateKey.includes('\\n')
    ? cfg.privateKey.replace(/\\n/g, '\n')
    : cfg.privateKey;
  const key = await importPKCS8(pem, 'ES256');
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + CLIENT_SECRET_TTL_S)
    .setAudience(APPLE_ISSUER)
    .setSubject(cfg.servicesId)
    .sign(key);
}

/**
 * Verify an Apple id_token against Apple's public keys. `keyResolver` is Apple's
 * remote JWKS in production; tests inject a local key so no network is needed.
 * Enforces issuer = appleid.apple.com and audience = our Services ID.
 */
export async function verifyAppleIdToken(
  idToken: string,
  servicesId: string,
  keyResolver: JWTVerifyGetKey
): Promise<AppleIdTokenClaims> {
  const { payload } = await jwtVerify(idToken, keyResolver, {
    issuer: APPLE_ISSUER,
    audience: servicesId,
  });
  return payload as AppleIdTokenClaims;
}

/**
 * Parse the first-consent `user` field (a JSON string in the form_post body)
 * into a display name. Present ONLY on the very first authorization; every later
 * sign-in omits it, so absence/blank/malformed all resolve cleanly to null.
 */
export function parseAppleUserName(userField: unknown): string | null {
  if (typeof userField !== 'string' || !userField.trim()) return null;
  try {
    const parsed = JSON.parse(userField) as {
      name?: { firstName?: string; lastName?: string };
    };
    const first = parsed?.name?.firstName?.trim() || '';
    const last = parsed?.name?.lastName?.trim() || '';
    const full = `${first} ${last}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

/** Injected network + crypto seams (defaults are the real fetch + Apple JWKS). */
export interface AppleExchangeDeps {
  fetchImpl?: typeof fetch;
  /** Key resolver for id_token verification (default = Apple's remote JWKS).
   *  Both the production JWKS (createRemoteJWKSet) and the test key are supplied
   *  in the JWTVerifyGetKey resolver form. */
  keyResolver?: JWTVerifyGetKey;
  /** Current time in ms (default Date.now) — lets tests pin iat/exp. */
  now?: () => number;
}

/** Lazily-built, cached remote JWKS (createRemoteJWKSet caches keys internally). */
let cachedRemoteJwks: JWTVerifyGetKey | null = null;
function appleRemoteJwks(): JWTVerifyGetKey {
  if (!cachedRemoteJwks) cachedRemoteJwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL));
  return cachedRemoteJwks;
}

/**
 * Exchange an Apple authorization code for the user's verified profile:
 *   1. sign a fresh ES256 client_secret,
 *   2. POST it + the code to Apple's token endpoint,
 *   3. VERIFY the returned id_token against Apple's JWKS,
 *   4. return { sub, email, emailVerified, name } — `name` from the first-consent
 *      form_post `user` field (null on later sign-ins).
 * Throws on any failure (the route maps it to a friendly redirect).
 */
export async function exchangeAppleCodeForProfile(
  code: string,
  appleName: string | null,
  cfg: AppleSigningConfig & { redirectUri: string },
  deps: AppleExchangeDeps = {}
): Promise<OAuthProfile> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowMs = deps.now ? deps.now() : Date.now();

  const clientSecret = await buildAppleClientSecret(cfg, Math.floor(nowMs / 1000));

  const res = await fetchImpl(APPLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.servicesId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    }).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      `apple token exchange failed: ${String(err.error_description || err.error || res.statusText)}`
    );
  }
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error('apple token exchange returned no id_token');

  const claims = await verifyAppleIdToken(
    data.id_token,
    cfg.servicesId,
    deps.keyResolver ?? appleRemoteJwks()
  );
  if (!claims.sub) throw new Error('apple id_token missing sub');
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase().trim() : '';
  if (!email) throw new Error('apple id_token missing email');
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

  return {
    sub: String(claims.sub),
    email,
    emailVerified,
    name: appleName?.trim() || null,
  };
}
