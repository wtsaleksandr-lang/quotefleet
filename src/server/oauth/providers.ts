/**
 * Social-login provider registry — Google / Meta (Facebook) / Apple.
 *
 * Ported from WeFixTrades' hand-rolled OAuth2 sign-in (server/lib/googleSignin.ts
 * + the inlined Facebook flow in server/routes/authRoutes.ts) and
 * adapted to QuoteFleet. Deliberately NO new dependency: the whole
 * authorization-code flow is `fetch` against each provider's public token /
 * userinfo endpoints. The profile is read from the userinfo endpoint using the
 * access token we just minted — no JWT signature verification is needed because
 * the token came directly from the provider's HTTPS token endpoint (the TLS
 * channel is the trust anchor for the auth-code flow), exactly as WFT does.
 *
 * PROVIDER GATING: a provider is "configured" only when BOTH its client id and
 * secret are present in the environment. When absent, isConfigured() is false —
 * the routes soft-404 and the login/signup buttons are never advertised. So
 * deploying this with no OAuth env set is a complete no-op.
 *
 * Env var names (set later in Doppler quotefleet/prd to activate):
 *   Google      GOOGLE_OAUTH_CLIENT_ID     GOOGLE_OAUTH_CLIENT_SECRET     [GOOGLE_OAUTH_REDIRECT_URI]
 *   Meta        META_OAUTH_CLIENT_ID       META_OAUTH_CLIENT_SECRET       [META_OAUTH_REDIRECT_URI]
 *               (FACEBOOK_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI accepted as aliases)
 * Redirect URI defaults to `<PUBLIC_BASE_URL>/auth/oauth/<provider>/callback`.
 */
import crypto from 'crypto';
import type { OAuthSubColumn } from '../routes/tenantProvision.js';

export type OAuthProviderId = 'google' | 'meta' | 'apple';

export const OAUTH_PROVIDER_IDS: OAuthProviderId[] = ['google', 'meta', 'apple'];

/** Human labels for the buttons (kept server-side so the client just renders). */
export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  google: 'Google',
  meta: 'Meta',
  apple: 'Apple',
};

/** Provider → the nullable users.* column that stores its stable subject id. */
export const OAUTH_SUB_COLUMN: Record<OAuthProviderId, OAuthSubColumn> = {
  google: 'googleSub',
  meta: 'metaSub',
  apple: 'appleSub',
};

export interface OAuthProfile {
  /** Stable, opaque provider subject id (never the email). */
  sub: string;
  email: string;
  /** Whether the provider vouches the email belongs to the user. */
  emailVerified: boolean;
  name: string | null;
}

interface ProviderConfig {
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  configured: boolean;
}

const HTTP_TIMEOUT_MS = 15_000;
/** Signed state is single-hop and short-lived; reject anything older. */
const STATE_TTL_MS = 10 * 60 * 1000;

export function isValidProviderId(id: string): id is OAuthProviderId {
  return (OAUTH_PROVIDER_IDS as string[]).includes(id);
}

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function firstEnv(...keys: string[]): string | null {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

/** Read a provider's config fresh from the environment on every call, so keys
 *  added later (Doppler) take effect on the next request without a code change. */
export function getProviderConfig(provider: OAuthProviderId): ProviderConfig {
  let clientId: string | null;
  let clientSecret: string | null;
  let redirectOverride: string | null;
  if (provider === 'google') {
    clientId = firstEnv('GOOGLE_OAUTH_CLIENT_ID');
    clientSecret = firstEnv('GOOGLE_OAUTH_CLIENT_SECRET');
    redirectOverride = firstEnv('GOOGLE_OAUTH_REDIRECT_URI');
  } else if (provider === 'apple') {
    // Apple has NO static client secret — it's a signed ES256 JWT minted per
    // token-exchange (see src/server/oauth/apple.ts). The provider is
    // "configured" only when the Services ID + Team ID + Key ID + .p8 private
    // key are ALL present (getAppleConfig gates it); clientSecret stays null.
    const a = getAppleConfig();
    return {
      clientId: a.servicesId,
      clientSecret: null,
      redirectUri: a.redirectUri,
      configured: a.configured,
    };
  } else {
    clientId = firstEnv('META_OAUTH_CLIENT_ID', 'FACEBOOK_OAUTH_CLIENT_ID');
    clientSecret = firstEnv('META_OAUTH_CLIENT_SECRET', 'FACEBOOK_OAUTH_CLIENT_SECRET');
    redirectOverride = firstEnv('META_OAUTH_REDIRECT_URI', 'FACEBOOK_OAUTH_REDIRECT_URI');
  }
  const redirectUri = redirectOverride || `${baseUrl()}/auth/oauth/${provider}/callback`;
  return { clientId, clientSecret, redirectUri, configured: !!(clientId && clientSecret) };
}

export function isConfigured(provider: OAuthProviderId): boolean {
  return getProviderConfig(provider).configured;
}

/** The provider ids whose keys are present — drives which buttons render. */
export function configuredProviders(): OAuthProviderId[] {
  return OAUTH_PROVIDER_IDS.filter(isConfigured);
}

/** Full Apple config (read fresh from env each call, like getProviderConfig).
 *  `configured` is true only when the Services ID + Team ID + Key ID + .p8
 *  private key are ALL present. The dedicated Apple POST callback + the ES256
 *  client-secret signer (src/server/oauth/apple.ts) consume this. */
export interface AppleConfig {
  /** Services ID = OAuth client_id + id_token audience. */
  servicesId: string | null;
  teamId: string | null;
  keyId: string | null;
  /** .p8 PEM contents. */
  privateKey: string | null;
  redirectUri: string;
  configured: boolean;
}

export function getAppleConfig(): AppleConfig {
  const servicesId = firstEnv('APPLE_OAUTH_CLIENT_ID');
  const teamId = firstEnv('APPLE_TEAM_ID');
  const keyId = firstEnv('APPLE_KEY_ID');
  const privateKey = firstEnv('APPLE_PRIVATE_KEY');
  const redirectUri =
    firstEnv('APPLE_OAUTH_REDIRECT_URI') || `${baseUrl()}/auth/oauth/apple/callback`;
  return {
    servicesId,
    teamId,
    keyId,
    privateKey,
    redirectUri,
    configured: !!(servicesId && teamId && keyId && privateKey),
  };
}

/* ─── HMAC-signed OAuth state (CSRF guard) ───
 * Mirrors WFT: base64url(payload).base64url(hmac). The provider id is folded
 * into the HMAC context so a state minted for one provider can't be replayed
 * against another's callback. The signing key is SESSION_SECRET. */

function stateSecret(): string {
  return process.env.SESSION_SECRET || 'qf-oauth-default-key-change-me';
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf-8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(payload: string, provider: OAuthProviderId): Buffer {
  return crypto
    .createHmac('sha256', stateSecret())
    .update(`${payload}:qf_oauth_state_${provider}`)
    .digest();
}

export function signState(provider: OAuthProviderId, mode: 'login' | 'signup'): string {
  const payload = JSON.stringify({ mode, ts: Date.now(), nonce: crypto.randomBytes(8).toString('hex') });
  return `${b64url(payload)}.${b64url(hmac(payload, provider))}`;
}

/** Verify a signed state for `provider`. Returns true only when the signature
 *  matches (constant-time) AND the state is within the TTL window. */
export function verifyState(signed: string, provider: OAuthProviderId): boolean {
  if (!signed || typeof signed !== 'string') return false;
  const parts = signed.split('.');
  if (parts.length !== 2) return false;
  let payload: string;
  let providedSig: Buffer;
  try {
    payload = b64urlDecode(parts[0]).toString('utf-8');
    providedSig = b64urlDecode(parts[1]);
  } catch {
    return false;
  }
  const expectedSig = hmac(payload, provider);
  if (providedSig.length !== expectedSig.length) return false;
  if (!crypto.timingSafeEqual(providedSig, expectedSig)) return false;
  try {
    const { ts } = JSON.parse(payload) as { ts?: number };
    if (typeof ts !== 'number' || Date.now() - ts > STATE_TTL_MS) return false;
  } catch {
    return false;
  }
  return true;
}

/* ─── Authorize URL ─── */

const AUTH_URLS: Record<OAuthProviderId, string> = {
  google: 'https://accounts.google.com/o/oauth2/auth',
  meta: 'https://www.facebook.com/v18.0/dialog/oauth',
  apple: 'https://appleid.apple.com/auth/authorize',
};

export function buildAuthorizeUrl(provider: OAuthProviderId, mode: 'login' | 'signup'): string {
  const cfg = getProviderConfig(provider);
  if (!cfg.clientId) throw new Error(`${provider} OAuth not configured`);
  const state = signState(provider, mode);
  if (provider === 'apple') {
    // Apple requires response_mode=form_post (it POSTs the code back). Scope is
    // the space-delimited 'name email'; the name is only delivered on the first
    // consent, inside the POST `user` field.
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'name email',
      response_mode: 'form_post',
      state,
    });
    return `${AUTH_URLS.apple}?${params.toString()}`;
  }
  if (provider === 'meta') {
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'email public_profile',
      state,
      auth_type: 'rerequest',
    });
    return `${AUTH_URLS.meta}?${params.toString()}`;
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Show the account chooser so users on multiple accounts can pick.
    prompt: 'select_account',
  });
  return `${AUTH_URLS[provider]}?${params.toString()}`;
}

/* ─── Code → profile ─── */

const TOKEN_URLS: Record<OAuthProviderId, string> = {
  google: 'https://oauth2.googleapis.com/token',
  meta: 'https://graph.facebook.com/v18.0/oauth/access_token',
  apple: 'https://appleid.apple.com/auth/token',
};

// Apple is deliberately absent: it has NO userinfo endpoint — the verified
// id_token IS the profile source (see src/server/oauth/apple.ts). Only the
// access-token → userinfo providers appear here.
const USERINFO_URLS: Record<Exclude<OAuthProviderId, 'apple'>, string> = {
  google: 'https://openidconnect.googleapis.com/v1/userinfo',
  meta: 'https://graph.facebook.com/v18.0/me',
};

/**
 * Exchange an authorization code for the user's verified profile.
 * Throws on any failure (caller maps to a friendly redirect).
 */
export async function exchangeCodeForProfile(
  provider: OAuthProviderId,
  code: string
): Promise<OAuthProfile> {
  if (provider === 'apple') {
    // Apple never flows through here: it POSTs its callback and is handled by
    // exchangeAppleCodeForProfile (src/server/oauth/apple.ts), which also needs
    // the first-consent display name. Guarded so a stray GET can't reach it.
    throw new Error('apple uses the dedicated POST callback (exchangeAppleCodeForProfile)');
  }

  const cfg = getProviderConfig(provider);
  if (!cfg.clientId || !cfg.clientSecret) throw new Error(`${provider} OAuth not configured`);

  if (provider === 'meta') return exchangeMeta(cfg, code);

  // Google: OIDC — POST form to the token endpoint, then GET userinfo.
  const tokenRes = await fetch(TOKEN_URLS[provider], {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    }).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!tokenRes.ok) {
    const err = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      `${provider} token exchange failed: ${String(err.error_description || err.error || tokenRes.statusText)}`
    );
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error(`${provider} token exchange returned no access_token`);

  const infoRes = await fetch(USERINFO_URLS[provider], {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!infoRes.ok) {
    throw new Error(`${provider} userinfo fetch failed: ${infoRes.status} ${infoRes.statusText}`);
  }
  const info = (await infoRes.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
  };
  if (!info.sub || !info.email) throw new Error(`${provider} userinfo missing sub or email`);

  const emailVerified = info.email_verified === true || info.email_verified === 'true';

  return {
    sub: info.sub,
    email: info.email.toLowerCase().trim(),
    emailVerified,
    name: info.name?.trim() || null,
  };
}

async function exchangeMeta(
  cfg: ProviderConfig,
  code: string
): Promise<OAuthProfile> {
  // Facebook's token endpoint accepts GET with query params.
  const tokenParams = new URLSearchParams({
    client_id: cfg.clientId!,
    client_secret: cfg.clientSecret!,
    redirect_uri: cfg.redirectUri,
    code,
  });
  const tokenRes = await fetch(`${TOKEN_URLS.meta}?${tokenParams.toString()}`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!tokenRes.ok) {
    const err = (await tokenRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`meta token exchange failed: ${err.error?.message || tokenRes.statusText}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error('meta token exchange returned no access_token');

  const infoParams = new URLSearchParams({ fields: 'id,email,name', access_token: tokenData.access_token });
  const infoRes = await fetch(`${USERINFO_URLS.meta}?${infoParams.toString()}`, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!infoRes.ok) throw new Error(`meta /me fetch failed: ${infoRes.status} ${infoRes.statusText}`);
  const info = (await infoRes.json()) as { id?: string; email?: string; name?: string };
  if (!info.id) throw new Error('meta /me missing id');
  if (!info.email) throw new Error('meta /me missing email (email permission declined)');

  return {
    sub: info.id,
    // Facebook only returns an email once the account's email is confirmed, so
    // a present email is treated as verified (parity with WFT's FB flow).
    email: info.email.toLowerCase().trim(),
    emailVerified: true,
    name: info.name?.trim() || null,
  };
}
