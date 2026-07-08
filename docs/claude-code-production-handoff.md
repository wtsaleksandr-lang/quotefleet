# Claude Code production handoff

This handoff is for the next engineering agent taking over credential-blocked production launch work.

The app is close to controlled beta. Most remaining launch blockers require secrets, provider dashboards, DNS, legal/business approval, or live infrastructure access. Do not invent or commit secrets. Use this document to finish the work once credentials are provided.

## Current baseline

Main branch includes:

- Public widget and hosted widget pages.
- Quote calculation with rate cards, accessorials, lane zones, drayage ports, terminals, and no-rate guidance.
- Lead capture, callback requests, customer chat, tenant dashboard, admin, marketplace, and hosted quote pages.
- Public quote output print/save workflow.
- Signup/login UI hardening.
- AI guardrail presets.
- Production operations checklist.
- Public health endpoints at `/healthz` and `/api/health`.
- Smoke tests for recent launch-readiness work.

## First commands

Run from a clean checkout:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm prod:check -- --target=pilot
pnpm prod:check -- --target=public-launch
```

Use this command after secrets are set in the deployment environment:

```bash
pnpm prod:check -- --target=paid-launch
```

The readiness checker only prints masked secret status. It must not print full secrets.

## Credential-blocked tasks

### 1. SMTP / outbound email

Blocked until SMTP credentials are provided.

Required env:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

After credentials are set:

1. Run `pnpm prod:check -- --target=public-launch`.
2. Start the app in the target environment.
3. Request a magic-link login from `/login`.
4. Submit a public lead from `/w/demo` or a live tenant.
5. Confirm the tenant notification and customer auto-reply are delivered.
6. Confirm logs no longer show email-only stdout fallback for production traffic.
7. Add a short deployment note with provider name, from address, and successful test timestamp. Do not include credentials.

Relevant files:

```text
src/email/send.ts
src/email/templates.ts
src/server/routes/auth.ts
src/server/routes/public.ts
.env.example
```

### 2. Domain/DNS and host domains

Blocked until DNS/provider access is provided.

Required env:

```text
PUBLIC_BASE_URL
HOST_DOMAINS
```

Required provider work:

- Point root/custom domain to the deployment.
- Point wildcard DNS for every platform-owned domain in `HOST_DOMAINS`.
- Confirm HTTPS cert coverage for apex and wildcard domains.
- Confirm tenant subdomain routing works: `<slug>.<domain>`.
- Confirm custom domain routing if that is part of launch.

Smoke test:

```text
https://PUBLIC_BASE_URL/
https://PUBLIC_BASE_URL/w/demo
https://demo.<first HOST_DOMAINS entry>/
https://PUBLIC_BASE_URL/api/health
```

Relevant files:

```text
src/server/hostInfo.ts
src/server/app.ts
src/server/routes/auth.ts
.env.example
```

### 3. Database backups and restore drill

Blocked until database provider dashboard access is provided.

Required confirmation:

- Automated backups enabled.
- Retention period recorded.
- One restore drill completed into a non-production database.
- Restored database contains tenants, users, rate cards, accessorials, zones, leads, chats, callbacks, and audit logs.
- Backup credentials and URLs are not committed to git.

Recommended doc update after verification:

- Add a dated note to release/launch notes or an operations issue.
- Do not place backup URLs, database URLs, or credentials in repo docs.

Relevant docs:

```text
docs/production-launch-ops.md
README.md
```

### 4. Monitoring and alerting provider

Partly unblocked. `/api/health` and `/healthz` now exist. Provider setup is blocked until monitoring account access is available.

Suggested checks:

```text
GET /api/health every 1-5 minutes
GET / every 5 minutes
GET /w/demo every 5 minutes
GET /app every 5 minutes
```

Suggested alerts:

- Non-2xx from `/api/health`.
- Response time above launch threshold.
- Spike in 5xx logs.
- Spike in login/signup errors.
- Spike in lead submission failures.
- Email delivery fallback or SMTP errors.
- Database connection errors.

After setup:

1. Trigger or simulate one alert.
2. Confirm primary and backup operators receive it.
3. Record monitor names, not monitor secrets.

Relevant files:

```text
src/server/app.ts
docs/production-launch-ops.md
```

### 5. Stripe/payment production setup

Blocked until Stripe account, products/prices, and webhook secrets are available.

Likely env:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

Before paid launch:

- Confirm billing route env names against `src/server/routes/billing.ts`.
- Create production products/prices in Stripe.
- Configure webhook endpoint to the deployed app.
- Run webhook test events.
- Confirm tenant plan/status changes are correct.
- Confirm failed payment/cancelled subscription behavior.
- Update pricing page copy if production plan names or prices differ.

Do not change quote logic while wiring payments.

Relevant files:

```text
src/server/routes/billing.ts
src/server/public/pricing.html
src/server/public/app.html
.env.example
```

### 6. Legal/support/public notices

Blocked until business/legal approval.

Current routes already include:

```text
/security
/dpa
/.well-known/security.txt
```

Before public launch, business owner should approve or provide:

```text
Terms of service
Privacy policy
Support/contact page
Security contact
Cookie/session notice if required
Billing/refund policy for paid subscriptions
Data retention wording
```

Engineering can prepare static pages once final copy is available. Do not invent legal terms.

Relevant files:

```text
src/server/app.ts
src/server/public/security.html
src/server/public/dpa.html
src/server/public/landing.html
src/server/public/pricing.html
docs/production-launch-ops.md
```

## Suggested next PRs when credentials arrive

Keep each PR small.

1. `smtp-production-setup-docs` — validate env names, update docs, add email delivery smoke notes.
2. `domain-launch-config-docs` — update deployment docs with real host domains and tested routes, no secrets.
3. `monitoring-provider-runbook` — add final monitor names and alert routing, no secret tokens.
4. `stripe-production-wiring` — only after Stripe credentials/products/webhooks are confirmed.
5. `terms-privacy-pages` — only after approved legal copy is provided.

## Safety rules

- Never commit `.env`, provider screenshots with secrets, private keys, API keys, webhook secrets, SMTP passwords, or database URLs.
- Never print full secrets in logs or tests.
- Keep launch wiring PRs scoped to one provider at a time.
- Run `pnpm typecheck` and `pnpm test` before merging.
- Use a draft PR until CI passes.
- If a production check needs manual proof, add a concise non-secret note to the PR body.

## Current readiness interpretation

- Controlled pilot: ready after deployment secrets and basic smoke tests are confirmed.
- Public free launch: blocked mostly by SMTP, DNS, backups, monitoring, support/legal notices.
- Paid launch: additionally blocked by Stripe production setup and business/legal approval.
