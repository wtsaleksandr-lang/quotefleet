/**
 * Manifest Privacy routes — the managed CBP vessel-manifest-confidentiality
 * service. Soft-auth (public_token) onboarding like the importer profiles, plus
 * a super-admin filing queue.
 *
 * Public:
 *   GET  /privacy                              marketing + tiers
 *   GET  /privacy/apply[/:token]               stepped onboarding (new / resume)
 *   POST /api/privacy/application              create draft
 *   PATCH/api/privacy/application/:token       autosave
 *   POST /api/privacy/application/:token/consent   record ESIGN consent
 *   POST /api/privacy/application/:token/sign      capture signature → PDF → sha256 → email
 *   GET  /api/privacy/application/:token/pdf       stream the retained POA PDF
 *   POST /api/privacy/application/:token/verify-email  (re)send the signer email round-trip
 *   GET  /privacy/verify/:vtoken               the round-trip click target (single-use)
 *   POST /api/privacy/application/:token/upload     zero-storage doc-on-file flag (never "verified")
 *
 * Admin (requireAuth + requireSuperAdmin):
 *   GET  /api/admin/privacy/queue
 *   GET  /admin/privacy
 *   POST /api/admin/privacy/:id/submit         PRE-FILING GATE → record CBP channel/ref, status=submitted
 *   POST /api/admin/privacy/:id/confirm        cbp_confirmed_at, +2yr expiry, status=active, INSERT redactions
 *   POST /api/admin/privacy/:id/refile         clone for a fresh 2-year term
 *   POST /api/admin/privacy/:id/revoke         status=revoked, deactivate redactions
 *
 * EXECUTION GATE (validateBeforeSigning) and PRE-FILING GATE (validatePoaForFiling)
 * both live in ../manifestPoaValidation.ts — the shared rules that keep a filing
 * out of CBP's 15 documented rejection causes.
 *
 * RETENTION: an executed POA, its append-only audit trail, and its signature
 * material are retained for NOT LESS THAN 5 years after the later of execution
 * and the last submission (ESIGN 15 U.S.C. 7001(d); CBP may demand production
 * under 19 CFR 141.46). `poa_applications.retain_until` carries that floor.
 * NOTHING here deletes a POA row, and no cleanup job may be added that does.
 *
 * HONEST-CLAIMS: no automated CBP API (filing is a human ops step); status walks
 * Draft→Signed→Submitted→Confirmed→Active→Renewal due; redaction inserted ONLY on
 * confirm; uploaded docs flagged "on file" / self-reported, never "verified"; the
 * service is a confidentiality-filing service, never customs brokerage.
 */
import type { Express, Request, Response } from 'express';
import { and, desc, eq, isNull, isNotNull, inArray, lte, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/client.js';
import {
  poaApplications,
  poaAuditEvents,
  manifestRedactions,
  manifestSubscriptions,
  type PoaApplication,
  type NewPoaApplication,
} from '../../db/schema.js';
import { requireAuth, requireSuperAdmin, requireSuperAdminPage } from '../middleware.js';
import { lookupSession, SESSION_COOKIE_NAME } from '../../auth/session.js';
import { sendEmail } from '../../email/send.js';
import { companyKey } from '../directory/importerCache.js';
import { titleFromSlug } from '../directory/importerProfile.js';
import {
  buildPoaPdf,
  decodeSignaturePng,
  CONSENT_DISCLOSURE_VERSION,
} from '../manifestPoaPdf.js';
import {
  POA_GOVERNING_LAW_STATE,
  poaTermYears,
  poaTermExpiresAt,
  poaRetainUntil,
  validateBeforeSigning,
  validatePoaForFiling,
} from '../manifestPoaValidation.js';
import {
  renderPrivacyLanding,
  renderPrivacyApply,
  renderAdminPrivacyQueue,
  renderPrivacyAccount,
  renderPrivacyLogin,
  renderPrivacyVerified,
} from '../directory/manifestPages.js';
import { manifestIdentity } from '../directory/manifestEntitlement.js';
import { loadEnv } from '../../config.js';
import {
  currentManifestPeriod,
  dbManifestUsageStore,
  manifestAccountKey,
  canStartPoa,
} from '../directory/manifestUsage.js';
import { invalidateRedactionCache } from '../directory/manifestRedactions.js';

/** QuoteFleet's legal filing entity named as Agent on the POA. Overridable so
 *  the instrument always carries the real, current legal name. */
function agentLegalName(): string {
  return loadEnv().MANIFEST_AGENT_LEGAL_NAME || 'QuoteFleet, Inc.';
}

/**
 * The Agent's physical address on the POA (19 CFR 141.32's model form names the
 * agent AND its address). Deliberately NOT hardcoded — an unverified address on
 * an executed legal instrument is a false statement. Unset ⇒ the document falls
 * back to the Agent's email notice address and the pre-filing gate BLOCKS, so
 * this surfaces as a config task rather than shipping a fabricated fact.
 */
function agentAddress(): string | null {
  return loadEnv().MANIFEST_AGENT_ADDRESS ?? null;
}
/** CBP confidentiality is valid 2 years from receipt. */
const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

function clientIp(req: Request): string | null {
  return (req.ip || (req.socket && req.socket.remoteAddress) || null) as string | null;
}
function clientUa(req: Request): string | null {
  return req.get('user-agent') || null;
}

async function sessionUserId(req: Request): Promise<number | null> {
  try {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const ctx = await lookupSession(token);
    return ctx?.user.id ?? null;
  } catch {
    return null;
  }
}

async function getByToken(token: string): Promise<PoaApplication | null> {
  if (!token) return null;
  const rows = await db()
    .select()
    .from(poaApplications)
    .where(eq(poaApplications.publicToken, token))
    .limit(1);
  return rows[0] ?? null;
}

async function getById(id: number): Promise<PoaApplication | null> {
  const rows = await db().select().from(poaApplications).where(eq(poaApplications.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Account-linking: associate any ownerless POA applications (created via the
 * anonymous token flow) to this signed-in user by matching signer_email to the
 * account email. Idempotent — only claims rows whose user_id IS NULL, so a
 * token-based resume for a not-yet-registered visitor keeps working until they
 * sign in. Best-effort: a failure here must never block the account page.
 */
async function claimApplicationsForUser(userId: number, email: string | null): Promise<void> {
  if (!email) return;
  try {
    await db()
      .update(poaApplications)
      .set({ userId, updatedAt: new Date() })
      .where(
        and(
          isNull(poaApplications.userId),
          sql`lower(${poaApplications.signerEmail}) = lower(${email})`,
        ),
      );
  } catch (err) {
    console.warn('[manifest.account.claim] link-by-email failed (non-fatal):', err);
  }
}

/** All POA applications owned by a user, newest first. */
async function applicationsForUser(userId: number): Promise<PoaApplication[]> {
  return db()
    .select()
    .from(poaApplications)
    .where(eq(poaApplications.userId, userId))
    .orderBy(desc(poaApplications.createdAt));
}

async function audit(
  applicationId: number,
  event: string,
  req: Request,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await db().insert(poaAuditEvents).values({
      applicationId,
      event,
      ip: clientIp(req),
      userAgent: clientUa(req),
      meta: meta ?? null,
    });
  } catch (err) {
    // The audit trail is best-effort at the boundary but must not fail the
    // request; a write error is logged loudly, never swallowed silently.
    console.error('[manifest.audit] failed to write event', event, err);
  }
}

/** Sanitize a string field (trim, cap length). */
function str(v: unknown, max = 400): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}
function strArr(v: unknown, max = 60): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Merge autosave fields from a request body onto an insert/update shape. */
function fieldsFromBody(b: Record<string, unknown>): Partial<NewPoaApplication> {
  return {
    grantorLegalName: str(b.grantorLegalName, 200) ?? undefined,
    dbaNames: strArr(b.dbaNames, 20),
    entityType: str(b.entityType, 80) ?? undefined,
    stateOfOrg: str(b.stateOfOrg, 80) ?? undefined,
    countryOfOrg: str(b.countryOfOrg, 80) ?? undefined,
    residency: str(b.residency, 20) === 'nonresident' ? 'nonresident' : str(b.residency, 20) === 'resident' ? 'resident' : undefined,
    grantorAddress: str(b.grantorAddress, 400) ?? undefined,
    mailingAddress: str(b.mailingAddress, 400) ?? undefined,
    einOrImporterNo: str(b.einOrImporterNo, 40) ?? undefined,
    iorNumber: str(b.iorNumber, 40) ?? undefined,
    partnerNames: strArr(b.partnerNames, 40),
    nameVariations: strArr(b.nameVariations),
    addressVariations: strArr(b.addressVariations),
    importerSlug: str(b.importerSlug, 120) ?? undefined,
    signerName: str(b.signerName, 120) ?? undefined,
    signerTitle: str(b.signerTitle, 120) ?? undefined,
    signerEmail: str(b.signerEmail, 160) ?? undefined,
    signerPhone: str(b.signerPhone, 40) ?? undefined,
    certSignerName: str(b.certSignerName, 120) ?? undefined,
    certSignerTitle: str(b.certSignerTitle, 120) ?? undefined,
    certSignerEmail: str(b.certSignerEmail, 160) ?? undefined,
    authorityDocsNote: str(b.authorityDocsNote, 400) ?? undefined,
  };
}

/**
 * Build the deterministic PDF input from a stored application.
 *
 * DETERMINISM CONTRACT — the SHA-256 recorded at execution must still match when
 * the document is re-rendered months later for CBP or the customer. So every
 * value fed in here must be FROZEN at execution: `emailVerifiedAt` is passed
 * ONLY when the round-trip completed at-or-before signing, because a signer who
 * clicks the verification link the next day must not silently change the bytes
 * of an already-hashed instrument. (Post-execution events live in the
 * append-only poa_audit_events log, which the document points at.)
 */
function pdfInputFromApp(app: PoaApplication, signedAt: Date) {
  const verifiedBeforeSigning =
    app.signerEmailVerifiedAt instanceof Date && app.signerEmailVerifiedAt.getTime() <= signedAt.getTime()
      ? app.signerEmailVerifiedAt
      : null;
  return {
    grantorLegalName: app.grantorLegalName || '',
    dbaNames: app.dbaNames ?? [],
    entityType: app.entityType,
    stateOfOrg: app.stateOfOrg,
    countryOfOrg: app.countryOfOrg,
    residency: app.residency,
    grantorAddress: app.grantorAddress,
    mailingAddress: app.mailingAddress,
    einOrImporterNo: app.einOrImporterNo,
    iorNumber: app.iorNumber,
    partnerNames: app.partnerNames ?? [],
    nameVariations: app.nameVariations ?? [],
    addressVariations: app.addressVariations ?? [],
    signerName: app.signerName || '',
    signerTitle: app.signerTitle,
    signerEmail: app.signerEmail,
    signerPhone: app.signerPhone,
    certSignerName: app.certSignerName,
    certSignerTitle: app.certSignerTitle,
    certSignerEmail: app.certSignerEmail,
    authorityDocsNote: app.authorityDocsNote,
    signedAt,
    signerIp: app.signerIp,
    signerUa: app.signerUa,
    consentDisclosureVersion: app.consentDisclosureVersion || CONSENT_DISCLOSURE_VERSION,
    applicationCreatedAt: app.createdAt ?? null,
    consentAt: app.consentAt ?? null,
    emailVerifiedAt: verifiedBeforeSigning,
    signatureImage: decodeSignaturePng(app.signatureDrawnPng),
    agentLegalName: agentLegalName(),
    agentAddress: agentAddress(),
    expiresAt: app.expiresAt ?? null,
  };
}

/**
 * Issue (or reissue) the signer's email round-trip token and send the
 * verification link. Best-effort — a mail failure never blocks the flow; the
 * pre-filing gate is what actually holds an unverified filing back.
 */
async function issueEmailVerification(app: PoaApplication): Promise<string | null> {
  if (!app.signerEmail) return null;
  const vtoken = nanoid(32);
  try {
    await db()
      .update(poaApplications)
      .set({ signerEmailVerifyToken: vtoken, updatedAt: new Date() })
      .where(eq(poaApplications.id, app.id));
  } catch (err) {
    console.error('[manifest.verifyEmail] could not store the verification token:', err);
    return null;
  }
  const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
  const link = `${base}/privacy/verify/${vtoken}`;
  sendEmail({
    to: app.signerEmail,
    subject: 'Confirm your email to complete your Manifest Privacy authorization',
    text:
      `Please confirm this is your business email address so we can complete your U.S. Customs ` +
      `vessel manifest confidentiality request for ${app.grantorLegalName || 'your business'}.\n\n` +
      `Confirm: ${link}\n\n` +
      `We can't submit your request to CBP until this address is confirmed. If you didn't start ` +
      `this request, ignore this email — nothing will be filed.\n\n— QuoteFleet Manifest Privacy`,
  }).catch((e) => console.warn('[manifest.verifyEmail] send failed (non-fatal):', e));
  return vtoken;
}

/** The redaction keys for an application: legal name + every variation + the
 *  slug-derived name (so both search-by-company and profile-by-slug match). */
function redactionKeysFor(app: PoaApplication): string[] {
  const raw = [
    app.grantorLegalName || '',
    ...(app.nameVariations ?? []),
    app.importerSlug ? titleFromSlug(app.importerSlug) : '',
    app.importerSlug ? app.importerSlug.replace(/-/g, ' ') : '',
  ];
  const keys = new Set<string>();
  for (const r of raw) {
    const k = companyKey(r);
    if (k) keys.add(k);
  }
  return [...keys];
}

export function registerManifestPrivacyRoutes(app: Express): void {
  // ── public pages ───────────────────────────────────────────────────────────
  // NOTE: the landing lives at /manifest-privacy — /privacy is the legal Privacy
  // Policy (static privacy.html) and must not be shadowed. Onboarding at
  // /privacy/apply is a distinct subpath and does not collide with it.
  app.get('/manifest-privacy', (_req: Request, res: Response) => {
    res.type('html').send(renderPrivacyLanding());
  });

  app.get(['/privacy/apply', '/privacy/apply/:token'], async (req: Request, res: Response) => {
    const token = str((req.params as Record<string, unknown>)?.token, 40);
    const application = token ? await getByToken(token) : null;
    const prefill = {
      slug: str((req.query as Record<string, unknown>)?.slug, 120) ?? undefined,
      name: str((req.query as Record<string, unknown>)?.name, 200) ?? undefined,
    };
    // Whether the caller is a paying subscriber decides the honest Done-screen
    // copy: an unpaid signer must NOT be told we submit to CBP (nothing is filed
    // until they choose a plan).
    const ident = await manifestIdentity(req);
    res.type('html').send(
      renderPrivacyApply({ app: application, prefill, isSubscriber: ident.isSubscriber }),
    );
  });

  // ── customer sign-in gate (magic-link) ──────────────────────────────────────
  app.get('/privacy/login', (_req: Request, res: Response) => {
    res.type('html').send(renderPrivacyLogin());
  });

  // ── customer account portal (page) ──────────────────────────────────────────
  // Requires login. An unauthenticated visitor is REDIRECTED to the sign-in page
  // (never a raw JSON 401 on a browser navigation).
  app.get('/privacy/account', async (req: Request, res: Response) => {
    const ident = await manifestIdentity(req);
    if (ident.userId == null) {
      return res.redirect('/privacy/login');
    }
    // Claim any ownerless applications filed under this email, then list them.
    await claimApplicationsForUser(ident.userId, ident.email);
    const applications = await applicationsForUser(ident.userId);
    return res
      .type('html')
      .send(renderPrivacyAccount({ email: ident.email ?? '', identity: ident, applications }));
  });

  // ── customer account API (soft-auth, mirrors /api/directory/auth/me) ─────────
  // Never 401s: an anonymous caller gets { user: null }. A signed-in caller gets
  // their subscription identity + every entity they've filed (after linking any
  // ownerless applications by email).
  app.get('/api/privacy/me', async (req: Request, res: Response) => {
    const ident = await manifestIdentity(req);
    if (ident.userId == null) {
      return res.json({ user: null, subscription: null, applications: [] });
    }
    await claimApplicationsForUser(ident.userId, ident.email);
    const applications = await applicationsForUser(ident.userId);
    return res.json({
      user: { id: ident.userId, email: ident.email, name: ident.name ?? null },
      subscription: {
        tier: ident.tier,
        status: ident.status,
        isSubscriber: ident.isSubscriber,
        entityQuota: ident.entityQuota,
        currentPeriodEnd: ident.currentPeriodEnd,
      },
      applications: applications.map((a) => ({
        token: a.publicToken,
        status: a.status,
        grantorLegalName: a.grantorLegalName,
        nameVariations: a.nameVariations ?? [],
        signerEmail: a.signerEmail,
        docSha256: a.docSha256,
        signedAt: a.signedAt,
        cbpSubmittedAt: a.cbpSubmittedAt,
        cbpConfirmedAt: a.cbpConfirmedAt,
        effectiveAt: a.effectiveAt,
        expiresAt: a.expiresAt,
      })),
    });
  });

  // ── create draft ───────────────────────────────────────────────────────────
  app.post('/api/privacy/application', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const userId = await sessionUserId(req);

      // Free-tier meter: a logged-in NON-subscriber may start FREE_POA_PER_MONTH
      // per month. Anonymous drafts are cheap (no external credit) and not gated.
      if (userId != null) {
        const ident = await manifestIdentity(req);
        const period = currentManifestPeriod();
        const started = await dbManifestUsageStore.getStarted(manifestAccountKey(userId, null), period);
        if (!canStartPoa({ isSubscriber: ident.isSubscriber, startedThisPeriod: started })) {
          return res.status(403).json({
            error: 'You’ve used your free authorization this month. Subscribe to protect more entities.',
          });
        }
      }

      const token = nanoid(24);
      const fields = fieldsFromBody(body);
      const inserted = (
        await db()
          .insert(poaApplications)
          .values({ publicToken: token, userId: userId ?? undefined, status: 'draft', ...fields })
          .returning()
      )[0];
      await audit(inserted.id, 'created', req, { source: 'onboarding' });
      return res.json({ token, status: 'draft' });
    } catch (err) {
      console.error('[manifest.application.create] failed:', err);
      return res.status(500).json({ error: 'Could not start your request. Try again.' });
    }
  });

  // ── autosave ───────────────────────────────────────────────────────────────
  app.patch('/api/privacy/application/:token', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const existing = await getByToken(token);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      // Once signed, the record is immutable (retained ESIGN record).
      if (existing.status !== 'draft') {
        return res.status(409).json({ error: 'This request is already signed and can’t be edited.' });
      }
      const fields = fieldsFromBody((req.body ?? {}) as Record<string, unknown>);
      await db()
        .update(poaApplications)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(poaApplications.id, existing.id));
      return res.json({ ok: true });
    } catch (err) {
      console.error('[manifest.application.patch] failed:', err);
      return res.status(500).json({ error: 'Save failed.' });
    }
  });

  // ── record consent (ESIGN element) ──────────────────────────────────────────
  app.post('/api/privacy/application/:token/consent', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const existing = await getByToken(token);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      const consentAt = new Date();
      await db()
        .update(poaApplications)
        .set({
          consentDisclosureVersion: CONSENT_DISCLOSURE_VERSION,
          consentAt: existing.consentAt ?? consentAt,
          updatedAt: consentAt,
        })
        .where(eq(poaApplications.id, existing.id));
      await audit(existing.id, 'consent', req, { disclosureVersion: CONSENT_DISCLOSURE_VERSION });
      // Start the email round-trip as soon as we have consent + an address, so a
      // signer who confirms before signing gets the verification stamped INTO
      // the executed instrument's audit block.
      if (existing.signerEmail && !existing.signerEmailVerifiedAt) {
        await issueEmailVerification(existing);
        await audit(existing.id, 'email_verification_sent', req, { to: existing.signerEmail });
      }
      return res.json({ ok: true, disclosureVersion: CONSENT_DISCLOSURE_VERSION });
    } catch (err) {
      console.error('[manifest.application.consent] failed:', err);
      return res.status(500).json({ error: 'Could not record consent.' });
    }
  });

  // ── sign: capture signature → generate PDF → sha256 → email → status=signed ──
  app.post('/api/privacy/application/:token/sign', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const body = (req.body ?? {}) as Record<string, unknown>;
      const existing = await getByToken(token);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (existing.status !== 'draft') {
        // Idempotent: already signed → return the stored hash rather than erroring.
        return res.json({ status: existing.status, docSha256: existing.docSha256 ?? '' });
      }
      const signatureDrawnPng = typeof body.signatureDrawnPng === 'string' ? body.signatureDrawnPng : null;

      const signedAt = new Date();
      // Persist the signer + attribution BEFORE generating the PDF so the PDF is
      // built from the stored, retained record (reproducible).
      const withSigner: PoaApplication = {
        ...existing,
        signerName: str(body.signerName, 120) ?? existing.signerName,
        signerTitle: str(body.signerTitle, 120) ?? existing.signerTitle,
        signerEmail: str(body.signerEmail, 160) ?? existing.signerEmail,
        signerPhone: str(body.signerPhone, 40) ?? existing.signerPhone,
        certSignerName: str(body.certSignerName, 120) ?? existing.certSignerName,
        certSignerTitle: str(body.certSignerTitle, 120) ?? existing.certSignerTitle,
        certSignerEmail: str(body.certSignerEmail, 160) ?? existing.certSignerEmail,
        authorityDocsNote: str(body.authorityDocsNote, 400) ?? existing.authorityDocsNote,
        signatureDrawnPng,
        consentDisclosureVersion: existing.consentDisclosureVersion || CONSENT_DISCLOSURE_VERSION,
        signerIp: clientIp(req),
        signerUa: clientUa(req),
        signedAt,
      };

      // THE EXECUTION GATE. Everything knowable at signing time is enforced here
      // — a PO-box address, an empty Schedule A, an unnamed partner, or an
      // off-allowlist title with no corporate certification would all produce a
      // filing CBP rejects, and a rejected filing means asking the customer to
      // sign again. Blocking now is cheaper than re-signing later.
      const problem = validateBeforeSigning(withSigner);
      if (problem) return res.status(400).json({ error: problem });

      // The instrument's own term: 2 years, hard-capped for a partnership by
      // 19 CFR 141.34. Retention floor: execution + 5 years (ESIGN 7001(d)).
      const termYears = poaTermYears(withSigner.entityType);
      const retainUntil = poaRetainUntil(signedAt);

      const { buffer, sha256 } = await buildPoaPdf(pdfInputFromApp(withSigner, signedAt));

      await db()
        .update(poaApplications)
        .set({
          status: 'signed',
          signerName: withSigner.signerName,
          signerTitle: withSigner.signerTitle,
          signerEmail: withSigner.signerEmail,
          signerPhone: withSigner.signerPhone,
          certSignerName: withSigner.certSignerName,
          certSignerTitle: withSigner.certSignerTitle,
          certSignerEmail: withSigner.certSignerEmail,
          authorityDocsNote: withSigner.authorityDocsNote,
          signatureTyped: withSigner.signerName,
          signatureDrawnPng,
          consentDisclosureVersion: withSigner.consentDisclosureVersion,
          governingLaw: POA_GOVERNING_LAW_STATE,
          termYears,
          retainUntil,
          signerIp: withSigner.signerIp,
          signerUa: withSigner.signerUa,
          signedAt,
          docSha256: sha256,
          updatedAt: new Date(),
        })
        .where(eq(poaApplications.id, existing.id));

      await audit(existing.id, 'signed', req, {
        docHash: sha256,
        disclosureVersion: withSigner.consentDisclosureVersion,
        governingLaw: POA_GOVERNING_LAW_STATE,
        termYears,
        retainUntil: retainUntil.toISOString(),
      });
      await audit(existing.id, 'pdf_generated', req, { docHash: sha256, bytes: buffer.length });

      // Email round-trip: if the signer hasn't confirmed their address yet, send
      // (or resend) the confirmation now. It is a BLOCKING pre-filing check, so
      // nothing goes to CBP until they click it.
      const needsEmailVerification = !!withSigner.signerEmail && !withSigner.signerEmailVerifiedAt;
      if (needsEmailVerification) {
        await issueEmailVerification(withSigner);
        await audit(existing.id, 'email_verification_sent', req, { to: withSigner.signerEmail });
      }

      // Email the signer a copy of the signed PDF (best-effort; never blocks).
      if (withSigner.signerEmail) {
        const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
        const resumeUrl = `${base}/privacy/apply/${existing.publicToken}`;
        const accountUrl = `${base}/privacy/account`;
        sendEmail({
          to: withSigner.signerEmail,
          subject: 'Your signed Manifest Privacy authorization',
          text:
            `Attached is your signed Limited Power of Attorney for a U.S. Customs vessel manifest ` +
            `confidentiality request.\n\nDocument SHA-256: ${sha256}\n\n` +
            `Pick up where you left off (choose a plan or review your request):\n${resumeUrl}\n\n` +
            `Manage all your protected entities and track status any time in your account:\n${accountUrl}\n` +
            `(Sign in with this email — no password needed.)\n\n` +
            `We prepare and submit your ` +
            `request to CBP on your behalf and will keep you posted as your status moves from ` +
            `Signed to Submitted to Confirmed. — QuoteFleet`,
          attachments: [
            {
              filename: 'manifest-privacy-authorization.pdf',
              contentBase64: buffer.toString('base64'),
              contentType: 'application/pdf',
            },
          ],
        }).catch((e) => console.warn('[manifest.sign] email failed (non-fatal):', e));
      }

      return res.json({
        status: 'signed',
        docSha256: sha256,
        emailVerificationPending: needsEmailVerification,
        termExpiresAt: poaTermExpiresAt(withSigner.entityType, signedAt).toISOString(),
      });
    } catch (err) {
      console.error('[manifest.application.sign] failed:', err);
      return res.status(500).json({ error: 'Could not sign. Try again.' });
    }
  });

  // ── stream the retained PDF (regenerated deterministically) ──────────────────
  app.get('/api/privacy/application/:token/pdf', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const existing = await getByToken(token);
      if (!existing || !existing.signedAt) {
        return res.status(404).type('text/plain').send('Not available.');
      }
      const { buffer } = await buildPoaPdf(pdfInputFromApp(existing, existing.signedAt));
      // `?download=1` (the admin queue's Download action) forces a save-to-disk;
      // the default stays inline so View/Print open the document in the viewer.
      const download = String((req.query as Record<string, unknown>)?.download ?? '') === '1';
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="manifest-privacy-authorization.pdf"`,
      );
      return res.send(buffer);
    } catch (err) {
      console.error('[manifest.application.pdf] failed:', err);
      return res.status(500).type('text/plain').send('Could not render the document.');
    }
  });

  // ── signer email round-trip: the click target on the verification email ──────
  // Single-use: the token is cleared on success, so a forwarded link can't be
  // replayed. Always renders a page (a browser navigation, never a raw JSON 401).
  app.get('/privacy/verify/:vtoken', async (req: Request, res: Response) => {
    const vtoken = str((req.params as Record<string, unknown>)?.vtoken, 60) || '';
    try {
      const rows = vtoken
        ? await db()
            .select()
            .from(poaApplications)
            .where(eq(poaApplications.signerEmailVerifyToken, vtoken))
            .limit(1)
        : [];
      const found = rows[0] ?? null;
      if (!found) {
        return res
          .status(404)
          .type('html')
          .send(renderPrivacyVerified({ ok: false, token: null, email: null }));
      }
      const verifiedAt = found.signerEmailVerifiedAt ?? new Date();
      await db()
        .update(poaApplications)
        .set({ signerEmailVerifiedAt: verifiedAt, signerEmailVerifyToken: null, updatedAt: new Date() })
        .where(eq(poaApplications.id, found.id));
      await audit(found.id, 'email_verified', req, { email: found.signerEmail });
      return res
        .type('html')
        .send(renderPrivacyVerified({ ok: true, token: found.publicToken, email: found.signerEmail }));
    } catch (err) {
      console.error('[manifest.application.verifyEmail] failed:', err);
      return res
        .status(500)
        .type('html')
        .send(renderPrivacyVerified({ ok: false, token: null, email: null }));
    }
  });

  // ── resend the signer email verification ─────────────────────────────────────
  app.post('/api/privacy/application/:token/verify-email', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const existing = await getByToken(token);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (existing.signerEmailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });
      if (!existing.signerEmail) return res.status(400).json({ error: 'Add your business email first.' });
      await issueEmailVerification(existing);
      await audit(existing.id, 'email_verification_sent', req, { to: existing.signerEmail, resend: true });
      return res.json({ ok: true, sent: true });
    } catch (err) {
      console.error('[manifest.application.verifyEmailResend] failed:', err);
      return res.status(500).json({ error: 'Could not send the confirmation email.' });
    }
  });

  // ── zero-storage doc-on-file flag (NEVER "verified") ─────────────────────────
  app.post('/api/privacy/application/:token/upload', async (req: Request, res: Response) => {
    try {
      const token = str((req.params as Record<string, unknown>)?.token, 40) || '';
      const existing = await getByToken(token);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      const kind = str((req.body as Record<string, unknown>)?.kind, 40) || 'document';
      // We store NOTHING here — only a self-reported "on file" marker. Honest-
      // claims: this is never a "verified" status.
      const docs = { ...(existing.docs ?? {}), [`${kind}OnFile`]: true, verified: false };
      await db()
        .update(poaApplications)
        .set({ docs, updatedAt: new Date() })
        .where(eq(poaApplications.id, existing.id));
      await audit(existing.id, 'doc_on_file', req, { kind });
      return res.json({ ok: true, status: 'on_file' });
    } catch (err) {
      console.error('[manifest.application.upload] failed:', err);
      return res.status(500).json({ error: 'Could not record the document.' });
    }
  });

  // ── admin: queue JSON ────────────────────────────────────────────────────────
  app.get(
    '/api/admin/privacy/queue',
    requireAuth,
    requireSuperAdmin,
    async (_req: Request, res: Response) => {
      const rows = await db()
        .select()
        .from(poaApplications)
        .orderBy(desc(poaApplications.createdAt))
        .limit(200);
      return res.json({ applications: rows });
    },
  );

  // ── admin: review page ───────────────────────────────────────────────────────
  // `requireSuperAdminPage` REDIRECTS an unauthenticated browser to /login (never
  // a raw JSON 401 on a white page). `?filter=renewals` narrows to filings that
  // need re-filing (status renewal_due/expired OR expiring within 90 days).
  app.get(
    '/admin/privacy',
    requireSuperAdminPage,
    async (req: Request, res: Response) => {
      const filter = String((req.query as Record<string, unknown>)?.filter ?? '') === 'renewals' ? 'renewals' : 'all';
      const in90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const whereClause =
        filter === 'renewals'
          ? or(
              eq(poaApplications.status, 'renewal_due'),
              eq(poaApplications.status, 'expired'),
              and(isNotNull(poaApplications.expiresAt), lte(poaApplications.expiresAt, in90)),
            )
          : undefined;
      const apps = await db()
        .select()
        .from(poaApplications)
        .where(whereClause)
        .orderBy(desc(poaApplications.createdAt))
        .limit(200);

      // JOIN the payer state so ops never files for a non-payer: gather the
      // owning user ids, look up their manifest subscription in ONE indexed IN()
      // query, and mark each filing paid = a live (or comped) subscription.
      const userIds = [...new Set(apps.map((a) => a.userId).filter((v): v is number => v != null))];
      const subs = userIds.length
        ? await db()
            .select({
              userId: manifestSubscriptions.userId,
              tier: manifestSubscriptions.tier,
              status: manifestSubscriptions.status,
              comp: manifestSubscriptions.comp,
              currentPeriodEnd: manifestSubscriptions.currentPeriodEnd,
            })
            .from(manifestSubscriptions)
            .where(inArray(manifestSubscriptions.userId, userIds))
        : [];
      const subByUser = new Map(subs.map((s) => [s.userId, s]));
      const nowMs = Date.now();
      const subFor = (userId: number | null): { tier: string | null; paid: boolean } => {
        if (userId == null) return { tier: null, paid: false };
        const s = subByUser.get(userId);
        if (!s) return { tier: null, paid: false };
        const live =
          (s.status === 'active' || s.status === 'trialing') &&
          (s.currentPeriodEnd == null || s.currentPeriodEnd.getTime() > nowMs);
        return { tier: s.tier ?? null, paid: !!s.comp || live };
      };

      const withEvents = await Promise.all(
        apps.map(async (a) => {
          const events = await db()
            .select()
            .from(poaAuditEvents)
            .where(eq(poaAuditEvents.applicationId, a.id))
            .orderBy(desc(poaAuditEvents.createdAt))
            .limit(10);
          // The pre-filing gate, computed per application so the operator sees a
          // checklist (ACE name / EIN / address / title / Schedule A /
          // partnership / nonresident / email round-trip) instead of having to
          // remember 15 rejection causes.
          return {
            app: a,
            events,
            sub: subFor(a.userId),
            gate: validatePoaForFiling(a, { agentAddressConfigured: !!agentAddress() }),
          };
        }),
      );
      res.type('html').send(renderAdminPrivacyQueue(withEvents, { filter }));
    },
  );

  // ── admin: submit (record CBP channel) ───────────────────────────────────────
  app.post(
    '/api/admin/privacy/:id/submit',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number((req.params as Record<string, unknown>)?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
      const existing = await getById(id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      const body = (req.body ?? {}) as Record<string, unknown>;
      const channel = str(body.channel, 20) || 'portal';
      const reference = str(body.reference, 120);

      // PRE-FILING GATE. Every blocking check must pass before anything is
      // transmitted to CBP — a rejected filing costs the customer a re-signature.
      // An operator can override deliberately (`force`), and the override is
      // recorded in the audit trail with the exact checks that were failing.
      const gate = validatePoaForFiling(existing, { agentAddressConfigured: !!agentAddress() });
      const force = body.force === true;
      if (!gate.ok && !force) {
        return res.status(409).json({
          error: 'Pre-filing checks are failing — fix them or resubmit with force.',
          failures: gate.failures.map((c) => ({ key: c.key, label: c.label, detail: c.detail })),
        });
      }

      const now = new Date();
      await db()
        .update(poaApplications)
        .set({
          status: 'submitted',
          cbpChannel: channel,
          cbpReference: reference ?? existing.cbpReference ?? null,
          cbpSubmittedAt: now,
          // Retention runs from the LAST submission, not just execution.
          retainUntil: poaRetainUntil(now),
          updatedAt: now,
        })
        .where(eq(poaApplications.id, id));
      await audit(id, 'submitted', req, {
        channel,
        reference: reference ?? null,
        gateOk: gate.ok,
        forced: !gate.ok && force,
        gateFailures: gate.failures.map((c) => c.key),
      });
      return res.json({ ok: true, status: 'submitted', gateOk: gate.ok, forced: !gate.ok && force });
    },
  );

  // ── admin: confirm (CBP receipt) → activate + insert redactions ──────────────
  app.post(
    '/api/admin/privacy/:id/confirm',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number((req.params as Record<string, unknown>)?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
      const existing = await getById(id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });

      // Capture the CBP receipt/confirmation reference + the channel it was filed
      // through — the proof-of-filing that makes the 2-year term auditable. A
      // confirm with no reference is still allowed (some channels don't issue one)
      // but the reference is stored whenever provided.
      const body = (req.body ?? {}) as Record<string, unknown>;
      const reference = str(body.reference, 120);
      const channel = str(body.channel, 20) || existing.cbpChannel || 'portal';

      const now = new Date();
      const expiresAt = new Date(now.getTime() + TWO_YEARS_MS);
      await db()
        .update(poaApplications)
        .set({
          status: 'active',
          cbpConfirmedAt: now,
          effectiveAt: now,
          expiresAt,
          cbpReference: reference ?? existing.cbpReference ?? null,
          cbpChannel: channel,
          updatedAt: now,
        })
        .where(eq(poaApplications.id, id));

      // Insert a redaction row for every protected name variation. This is the
      // ONLY place redactions are created — never before CBP confirm.
      const keys = redactionKeysFor(existing);
      for (const nameKey of keys) {
        await db()
          .insert(manifestRedactions)
          .values({ nameKey, applicationId: id, reason: 'cbp_confirmed', active: true })
          .onConflictDoUpdate({
            target: manifestRedactions.nameKey,
            set: { active: true, applicationId: id, reason: 'cbp_confirmed' },
          });
      }
      invalidateRedactionCache();
      await audit(id, 'confirmed', req, {
        expiresAt: expiresAt.toISOString(),
        redactionKeys: keys.length,
        reference: reference ?? null,
        channel,
      });
      return res.json({
        ok: true,
        status: 'active',
        expiresAt: expiresAt.toISOString(),
        redactions: keys.length,
        reference: reference ?? null,
      });
    },
  );

  // ── admin: re-file → clone the filing for a fresh 2-year term ─────────────────
  // A CBP confidentiality request is valid 2 years; renewing means filing again.
  // The signed POA authorizes "preparing, submitting, maintaining, AND renewing"
  // the request, so re-filing under the same authorization is in-scope. This
  // clones the application (grantor + signer + retained signature/hash) into a
  // NEW row with a fresh public token, status 'submitted', and the channel/
  // reference the operator just filed under. On the next confirm the new row gets
  // its own +2-year expiry. The original is left intact (historical record) and
  // stamped with a 'refiled' audit event pointing at the clone.
  app.post(
    '/api/admin/privacy/:id/refile',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number((req.params as Record<string, unknown>)?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
      const existing = await getById(id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      if (!existing.signedAt || !existing.docSha256) {
        return res.status(409).json({ error: 'Only a signed authorization can be re-filed.' });
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const channel = str(body.channel, 20) || existing.cbpChannel || 'portal';
      const reference = str(body.reference, 120);

      const now = new Date();
      const token = nanoid(24);
      const inserted = (
        await db()
          .insert(poaApplications)
          .values({
            publicToken: token,
            userId: existing.userId ?? undefined,
            status: 'submitted',
            grantorLegalName: existing.grantorLegalName,
            dbaNames: existing.dbaNames ?? undefined,
            entityType: existing.entityType,
            stateOfOrg: existing.stateOfOrg,
            countryOfOrg: existing.countryOfOrg,
            residency: existing.residency,
            grantorAddress: existing.grantorAddress,
            mailingAddress: existing.mailingAddress,
            einOrImporterNo: existing.einOrImporterNo,
            iorNumber: existing.iorNumber,
            partnerNames: existing.partnerNames ?? undefined,
            nameVariations: existing.nameVariations ?? undefined,
            addressVariations: existing.addressVariations ?? undefined,
            importerSlug: existing.importerSlug,
            signerName: existing.signerName,
            signerTitle: existing.signerTitle,
            signerEmail: existing.signerEmail,
            signerPhone: existing.signerPhone,
            signerEmailVerifiedAt: existing.signerEmailVerifiedAt,
            certSignerName: existing.certSignerName,
            certSignerTitle: existing.certSignerTitle,
            certSignerEmail: existing.certSignerEmail,
            authorityDocsNote: existing.authorityDocsNote,
            governingLaw: existing.governingLaw,
            termYears: existing.termYears,
            consentDisclosureVersion: existing.consentDisclosureVersion,
            consentAt: existing.consentAt,
            signatureTyped: existing.signatureTyped,
            signatureDrawnPng: existing.signatureDrawnPng,
            signedAt: existing.signedAt,
            signerIp: existing.signerIp,
            signerUa: existing.signerUa,
            docSha256: existing.docSha256,
            cbpChannel: channel,
            cbpReference: reference ?? undefined,
            cbpSubmittedAt: now,
            retainUntil: poaRetainUntil(now),
            docs: existing.docs ?? undefined,
          })
          .returning()
      )[0];

      await audit(inserted.id, 'created', req, { source: 'refile', fromApplicationId: id });
      await audit(inserted.id, 'submitted', req, { channel, reference: reference ?? null, refileOf: id });
      await audit(id, 'refiled', req, { newApplicationId: inserted.id, newToken: token });
      return res.json({ ok: true, status: 'submitted', newId: inserted.id, newToken: token });
    },
  );

  // ── admin: revoke → deactivate redactions ────────────────────────────────────
  app.post(
    '/api/admin/privacy/:id/revoke',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number((req.params as Record<string, unknown>)?.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
      const existing = await getById(id);
      if (!existing) return res.status(404).json({ error: 'Not found.' });
      await db()
        .update(poaApplications)
        .set({ status: 'revoked', updatedAt: new Date() })
        .where(eq(poaApplications.id, id));
      await db()
        .update(manifestRedactions)
        .set({ active: false })
        .where(and(eq(manifestRedactions.applicationId, id), eq(manifestRedactions.active, true)));
      invalidateRedactionCache();
      await audit(id, 'revoked', req, {});
      return res.json({ ok: true, status: 'revoked' });
    },
  );
}
