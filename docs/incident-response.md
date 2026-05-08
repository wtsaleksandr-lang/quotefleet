# Incident-response runbook — QuoteFleet

> **Audience:** the operator(s) on duty when a production incident hits
> QuoteFleet. Keep this short, runnable, and accurate.

**Last updated:** 2026-05-08
**Owner:** wts.aleksandr@gmail.com
**Security inbox:** security@quotefleet.app

---

## 1. Severity tiers

| Sev | Definition | Examples | Response SLA |
|---|---|---|---|
| **P0** | Customer data exposed, full outage, financial fraud, active intrusion | DB dump leaked; signup completely broken; widget not loading on any tenant; unauthorized super-admin login | Page on-call **immediately**; engage within 15 min; status update every 30 min |
| **P1** | Significant degradation but no data exposure | Healthcheck DB ping failing; AI agent throwing 500s for >5% of requests; one host domain not resolving | Engage within 1 hr; resolve within 4 hr |
| **P2** | Single feature broken; workaround exists | One tenant's embed not loading; auto-reply email not sending; widget styling broken | Engage within 4 business hours; resolve within 1 business day |
| **P3** | Cosmetic / non-blocking | Typo in dashboard; slow page render; minor visual bug | Track in issue tracker; fix in regular release |

If unsure → **assume one tier higher** until you've gathered enough info to step down.

---

## 2. On-call expectations

Solo founder for now. On-call = the founder. When team grows:
- Primary on-call rotates weekly (Mon 09:00 → next Mon 09:00 local time)
- Secondary on-call as backup (paged after 15 min if primary unreachable)
- Hand-offs at start of week include reading the previous week's incidents

---

## 3. Detection sources

In rough order of how you'll learn about a problem:

1. **Customer email / Slack DM** to the founder
2. **`/healthz` endpoint** returning non-200 (when monitoring is wired up)
3. **Replit deployment "Crash" notifications** in the Replit dashboard
4. **Cloudflare Analytics anomalies** — sudden 5xx spike, traffic drop
5. **Stripe webhook errors** in the Stripe dashboard
6. **Anthropic API quota / billing alerts**
7. **Neon database CPU / connection-count alerts** (set up under "Alerts" in Neon Console)

---

## 4. Initial response checklist

Within the **first 15 minutes** of any P0/P1:

- [ ] **Acknowledge** to the reporter ("we're looking at it")
- [ ] **Confirm scope** — one tenant or all tenants? one feature or whole app?
  - `curl https://drayrate.net/healthz` — overall health
  - `curl https://drayrate.net/api/auth/signup-options` — DB connectivity
  - `curl https://demo.drayrate.net/` — wildcard routing
- [ ] **Snapshot evidence** before changing anything:
  - Replit deploy logs → save the last 200 lines somewhere
  - Browser-side error if any (screenshot)
  - Recent commits: `git log --oneline -10`
- [ ] **Open an incident note** — even a Google Doc — with:
  - Time first observed
  - Symptoms
  - Suspected blast radius
  - Who's working on it

---

## 5. Common scenarios + first moves

### `/healthz` returns `db:down`

1. Check `causeMessage` in the response body — that's the actual postgres-js error
2. If `ENOTFOUND <host>` → DATABASE_URL points at an unreachable host (likely got changed in Replit Secrets)
3. If `Authentication failed` → Neon credentials revoked or project paused
4. If `relation "tenants" does not exist` → migrations didn't apply; run `pnpm db:migrate` against the Neon URL manually

### Wildcard subdomains return 525 / redirect-loop

1. Check Cloudflare Worker `quotefleet-wildcard-proxy` is still deployed (CF dashboard → Workers)
2. Check `WORKER_AUTH_SECRET` matches between CF Worker secrets and Replit Deployment Secrets
3. Check Replit deployment is Public (not gated by Repl Shield)

### AI requests 500ing or hanging

1. Check `[ai.usage]` log lines — last successful call, model, tenant
2. Check Anthropic console for rate-limit / billing errors
3. If platform-key requests failing: temporarily disable AI features by removing `ANTHROPIC_API_KEY` from Replit Secrets and redeploying — endpoints return graceful 503

### Site loads but is read-only / shows "Trial expired"

1. Check `tenant.trialEndsAt` for the affected tenant in Neon (`select trial_ends_at, plan from tenants where slug = '...'`)
2. If they paid, manually flip `plan = 'pro'` and `trial_ends_at = NULL`
3. Investigate why Stripe webhook didn't fire

---

## 6. Communication chain

| Audience | When | Channel | Who |
|---|---|---|---|
| Reporting customer | Within 15 min of acknowledgement | Reply to original ticket / DM | On-call |
| All affected tenants | If P0/P1 lasting >30 min | Email blast (use mailmerge against `tenants.contact_email` filtered to affected) | On-call |
| Public status | Once status page exists (TODO) | status.quotefleet.app | On-call |
| Internal team | As needed | Slack / WhatsApp | On-call |

**Template for customer comms (P0/P1):**

> Hi — we're aware of [problem] affecting [scope] starting [time].
> The team is actively investigating; cause appears to be [hypothesis].
> No action required from you. Next update at [time + 30 min].
> — [your name], QuoteFleet

---

## 7. Post-incident actions

Within **48 hours** of any P0/P1 resolution:

- [ ] Write a postmortem (template below). Even 1 page.
- [ ] Send postmortem to all customers who hit the issue (transparency builds trust)
- [ ] Open follow-up tickets for every preventive action
- [ ] Update this runbook if a new scenario emerged

### Postmortem template

```markdown
# Incident YYYY-MM-DD — <one-line title>

**Severity:** P0 / P1 / P2
**Detection:** how we learned about it
**Duration:** start time → resolution time
**Customer impact:** who was affected, how badly

## Timeline (UTC)
- HH:MM — first observation
- HH:MM — escalation
- HH:MM — root cause identified
- HH:MM — fix deployed
- HH:MM — confirmed resolved

## Root cause
What actually broke and why.

## What went well
- Detection time
- Communication
- Fix correctness

## What went wrong
- Detection took too long because…
- The fix took longer because…
- Customer comms were unclear because…

## Action items
- [ ] [owner] [date] — preventive change
- [ ] [owner] [date] — monitoring improvement
- [ ] [owner] [date] — runbook update
```

---

## 8. Vulnerability reports from external researchers

Emails to `security@quotefleet.app` are reports under our published policy
(`/security` page, RFC-9116 `/.well-known/security.txt`).

1. **Acknowledge within 48 hrs** — even if just "received, investigating"
2. **Triage severity** using the same P0/P1/P2/P3 scale
3. **Fix and ship** — coordinated disclosure: notify reporter when patched
4. **Credit the reporter** publicly (with their permission) once the fix is live
5. **Add a CVE** if appropriate (most won't qualify)

---

## 9. Contact list

| Service | Where to log in | Account / project |
|---|---|---|
| Replit (deploy + workspace) | https://replit.com | wtsaleksandr-lang |
| Cloudflare (DNS + Workers) | https://dash.cloudflare.com | Support@loadmode.net (account `653c…`) |
| Neon (Postgres) | https://console.neon.tech | wts.aleksandr@gmail.com |
| Namecheap (domain registrar) | https://ap.www.namecheap.com | ewoio |
| Anthropic (AI API) | https://console.anthropic.com | wts.aleksandr@gmail.com |
| Stripe (payments) | https://dashboard.stripe.com | (when wired) |
| GitHub (source) | https://github.com/wtsaleksandr-lang/quotefleet | wtsaleksandr-lang |

Keep account credentials in a password manager. Never commit them to git.
