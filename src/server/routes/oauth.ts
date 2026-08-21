/**
 * Social login routes — "Continue with Google / Meta / Apple".
 *
 * Ported from WeFixTrades and adapted to QuoteFleet's cookie-session, multi-
 * tenant model. Two flow routes plus a tiny config endpoint:
 *
 *   GET /api/auth/oauth/providers        → { providers:[{id,label}] } for the
 *                                          configured providers only (drives
 *                                          which buttons the pages render).
 *   GET /auth/oauth/:provider            → redirect to the provider's consent
 *                                          screen (soft-404 if not configured).
 *   GET /auth/oauth/:provider/callback   → exchange code, resolve the account,
 *                                          set the session cookie, redirect.
 *
 * Identity → account mapping (the product logic):
 *   1. Known provider sub            → log into that user.
 *   2. Email matches an existing user → link the sub (only when the provider
 *                                       vouched the email is verified) + log in.
 *   3. No match                       → OAuth SIGNUP: create a brand-new tenant
 *                                       + tenant_owner on a card-free 14-day
 *                                       trial via the SAME provisionTrialTenant()
 *                                       the password signup uses. The provider
 *                                       verified the email, so there is no
 *                                       email-verification step.
 *
 * PROVIDER GATING: every branch first checks isConfigured(provider). With no
 * keys set the start/callback routes soft-404 and /providers returns []. So this
 * is a complete no-op until the OAuth apps' keys land in Doppler quotefleet/prd.
 */
import type { Express, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { eq, type SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { hashPassword } from '../../auth/password.js';
import { createSession } from '../../auth/session.js';
import { setCookie, CURRENT_DPA_VERSION } from './auth.js';
import { deriveAvailableSlug, provisionTrialTenant } from './tenantProvision.js';
import {
  OAUTH_PROVIDER_LABELS,
  buildAuthorizeUrl,
  configuredProviders,
  exchangeCodeForProfile,
  getAppleConfig,
  isConfigured,
  isValidProviderId,
  verifyState,
  type OAuthProviderId,
  type OAuthProfile,
} from '../oauth/providers.js';
import { exchangeAppleCodeForProfile, parseAppleUserName } from '../oauth/apple.js';

/** Drizzle column that stores this provider's stable subject id. */
function subColumn(provider: OAuthProviderId) {
  if (provider === 'google') return users.googleSub;
  if (provider === 'apple') return users.appleSub;
  return users.metaSub;
}

/** Type-safe update patch that sets this provider's sub column. */
function subPatch(provider: OAuthProviderId, sub: string) {
  if (provider === 'google') return { googleSub: sub };
  if (provider === 'apple') return { appleSub: sub };
  return { metaSub: sub };
}

/** Provider → the users.* column name provisionTrialTenant stamps at signup. */
function subColumnName(
  provider: OAuthProviderId
): 'googleSub' | 'metaSub' | 'appleSub' {
  if (provider === 'google') return 'googleSub';
  if (provider === 'apple') return 'appleSub';
  return 'metaSub';
}

function landingPathForRole(role: string): string {
  return role === 'super_admin' ? '/admin' : '/app';
}

/** Derive a sensible company name for an OAuth signup from the display name or
 *  the email local-part. Never empty (deriveAvailableSlug also guards). */
function deriveCompanyName(profile: OAuthProfile): string {
  const fromName = profile.name?.trim();
  if (fromName) return fromName.slice(0, 120);
  const local = profile.email.split('@')[0] || 'My Company';
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  return (cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : 'My Company').slice(0, 120);
}

export function registerOAuthRoutes(app: Express) {
  /** Which providers are live — the login/signup pages fetch this to decide
   *  which buttons to render. Absent keys → empty list → no buttons. */
  app.get('/api/auth/oauth/providers', (_req: Request, res: Response) => {
    const providers = configuredProviders().map((id) => ({ id, label: OAUTH_PROVIDER_LABELS[id] }));
    return res.json({ providers });
  });

  /** Start: redirect to the provider's consent screen. */
  app.get('/auth/oauth/:provider', (req: Request, res: Response) => {
    const provider = String(req.params.provider);
    if (!isValidProviderId(provider) || !isConfigured(provider)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const mode = req.query.mode === 'signup' ? 'signup' : 'login';
    try {
      return res.redirect(buildAuthorizeUrl(provider, mode));
    } catch (err) {
      console.error(`[oauth] ${provider} start failed:`, err);
      return res.redirect('/login?oauth_error=start_failed');
    }
  });

  /** Callback (GET): exchange the code, resolve the account, set the cookie.
   *  Apple is EXCLUDED here — it uses response_mode=form_post, so its callback
   *  is the app.post('/auth/oauth/apple/callback') handler below. */
  app.get('/auth/oauth/:provider/callback', async (req: Request, res: Response) => {
    const provider = String(req.params.provider);
    if (!isValidProviderId(provider) || provider === 'apple' || !isConfigured(provider)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      return res.redirect(`/login?oauth_error=${encodeURIComponent(String(oauthError))}`);
    }
    if (!code || typeof code !== 'string') {
      return res.redirect('/login?oauth_error=missing_code');
    }
    // CSRF: the state must carry our valid, unexpired HMAC bound to THIS provider.
    if (!verifyState(String(state ?? ''), provider)) {
      console.warn(`[oauth] ${provider} callback: state verification failed`);
      return res.redirect('/login?oauth_error=invalid_state');
    }

    let profile: OAuthProfile;
    try {
      profile = await exchangeCodeForProfile(provider, code);
    } catch (err) {
      console.error(`[oauth] ${provider} code exchange failed:`, err);
      return res.redirect('/login?oauth_error=exchange_failed');
    }

    return resolveOAuthAndLogin(res, provider, profile);
  });

  /** Callback (POST): Sign in with Apple. Apple sends response_mode=form_post,
   *  so the code/state (and, on FIRST consent only, a `user` JSON blob with the
   *  display name) arrive as an application/x-www-form-urlencoded POST body —
   *  parsed by the global express.urlencoded() middleware. The client_secret is
   *  a signed ES256 JWT and the id_token is verified against Apple's JWKS inside
   *  exchangeAppleCodeForProfile. Account resolution is the SAME as every other
   *  provider (resolveOAuthAndLogin). */
  app.post('/auth/oauth/apple/callback', async (req: Request, res: Response) => {
    if (!isConfigured('apple')) {
      return res.status(404).json({ error: 'Not found' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { code, state, error: oauthError, user } = body;
    if (oauthError) {
      return res.redirect(`/login?oauth_error=${encodeURIComponent(String(oauthError))}`);
    }
    if (!code || typeof code !== 'string') {
      return res.redirect('/login?oauth_error=missing_code');
    }
    if (!verifyState(String(state ?? ''), 'apple')) {
      console.warn('[oauth] apple callback: state verification failed');
      return res.redirect('/login?oauth_error=invalid_state');
    }

    const cfg = getAppleConfig();
    if (!cfg.servicesId || !cfg.teamId || !cfg.keyId || !cfg.privateKey) {
      return res.status(404).json({ error: 'Not found' });
    }

    // The display name is delivered ONLY on the first consent, in `user`.
    const appleName = parseAppleUserName(user);

    let profile: OAuthProfile;
    try {
      profile = await exchangeAppleCodeForProfile(code, appleName, {
        servicesId: cfg.servicesId,
        teamId: cfg.teamId,
        keyId: cfg.keyId,
        privateKey: cfg.privateKey,
        redirectUri: cfg.redirectUri,
      });
    } catch (err) {
      console.error('[oauth] apple code exchange failed:', err);
      return res.redirect('/login?oauth_error=exchange_failed');
    }

    return resolveOAuthAndLogin(res, 'apple', profile);
  });
}

/**
 * Identity → account resolution, shared by every provider callback (GET for
 * google/meta, POST for apple). Handles its own errors by redirecting.
 *   1. Known provider sub            → log into that user.
 *   2. Email matches an existing user → link the sub (verified email only).
 *   3. No match                       → OAuth SIGNUP: new trial tenant + owner.
 */
async function resolveOAuthAndLogin(
  res: Response,
  provider: OAuthProviderId,
  profile: OAuthProfile
) {
  try {
    // 1. Known provider identity → straight in.
    const bySub = (
      await db().select().from(users).where(eq(subColumn(provider), profile.sub) as SQL).limit(1)
    )[0];
    if (bySub) return await loginAndRedirect(res, bySub.id, bySub.role);

    // 2. Email matches an existing account.
    const byEmail = (
      await db().select().from(users).where(eq(users.email, profile.email)).limit(1)
    )[0];
    if (byEmail) {
      if (!profile.emailVerified) {
        // Never attach a provider identity to an existing account on an
        // unverified email — that would let an attacker who controls an
        // unverified provider account hijack a QuoteFleet login by email.
        return res.redirect('/login?oauth_error=email_unverified');
      }
      await db().update(users).set(subPatch(provider, profile.sub)).where(eq(users.id, byEmail.id));
      return await loginAndRedirect(res, byEmail.id, byEmail.role);
    }

    // 3. Brand-new → OAuth SIGNUP. Only create on a provider-verified email.
    if (!profile.emailVerified) {
      return res.redirect('/login?oauth_error=email_unverified');
    }
    const companyName = deriveCompanyName(profile);
    const slug = await deriveAvailableSlug(companyName);
    // OAuth users get a random unusable password; they can claim a real one
    // later via magic-link → change password.
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
    try {
      const result = await provisionTrialTenant({
        companyName,
        email: profile.email,
        passwordHash,
        countryFocus: 'US',
        ownerName: profile.name,
        // Continuing through the provider from a page that states the terms
        // records DPA consent at the current version (no mid-OAuth checkbox).
        dpaVersion: CURRENT_DPA_VERSION,
        slug,
        oauth: { column: subColumnName(provider), sub: profile.sub },
      });
      return await loginAndRedirect(res, result.userId, 'tenant_owner');
    } catch (err) {
      // Race: another tab/retry may have created the account between our
      // lookups and the insert. Fall back to logging into whatever now exists.
      console.error(`[oauth] ${provider} signup insert failed:`, err);
      const raced =
        (await db().select().from(users).where(eq(subColumn(provider), profile.sub) as SQL).limit(1))[0] ??
        (await db().select().from(users).where(eq(users.email, profile.email)).limit(1))[0];
      if (raced) return await loginAndRedirect(res, raced.id, raced.role);
      return res.redirect('/login?oauth_error=signup_failed');
    }
  } catch (err) {
    console.error(`[oauth] ${provider} callback error:`, err);
    return res.redirect('/login?oauth_error=internal');
  }
}

/** Issue the session cookie (same createSession/setCookie as the password
 *  flow) and redirect to the role's landing page. */
async function loginAndRedirect(res: Response, userId: number, role: string) {
  await db().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  const token = await createSession(userId);
  setCookie(res, token);
  return res.redirect(landingPathForRole(role));
}
