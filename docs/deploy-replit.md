# Replit deployment guide

QuoteFleet is built to run on Replit's "Reserved VM" deployment with a Neon Postgres database. This guide walks through the full setup.

## Prerequisites

- A Replit account (free tier works for testing; paid tier needed for "Always-on" / Reserved VM)
- A Neon account with a Postgres database created (free tier — `https://neon.tech`)
- An Anthropic API key (`https://console.anthropic.com`)
- (Optional) An SMTP account for outgoing emails — Resend, Postmark, SendGrid all fine

## 1. Push this branch to GitHub

If you're reading this in the local clone:

```bash
git push -u origin claude/trucking-quote-tool-XIUCR
```

## 2. Create a Replit project from the GitHub repo

1. Replit → "Create Repl" → "Import from GitHub"
2. Paste your repo URL, select the `claude/trucking-quote-tool-XIUCR` branch
3. Replit detects Node.js automatically (the `.replit` file pre-configures everything)

## 3. Add Replit Secrets

In the Repl's left sidebar → "Secrets" (the lock icon) → add:

| Secret | Required | Notes |
|--------|----------|-------|
| `DATABASE_URL` | Yes | From Neon dashboard → "Connection string" |
| `ANTHROPIC_API_KEY` | Yes | `sk-ant-api03-…` |
| `SUPER_ADMIN_EMAIL` | Recommended | Your email — auto-promoted to super_admin on first signup |
| `SESSION_SECRET` | Recommended | Generate with `openssl rand -hex 32` |
| `PUBLIC_BASE_URL` | After first run | Set to your Replit deployment URL once known |
| `SMTP_HOST` | Optional | If unset, emails are logged to stdout (fine for V1) |
| `SMTP_PORT` | Optional | Usually 587 |
| `SMTP_USER` | Optional | |
| `SMTP_PASS` | Optional | |
| `SMTP_FROM` | Optional | e.g. `"QuoteFleet <noreply@yourdomain.com>"` |

## 4. Hit Run

The pre-configured run command:
```
pnpm install && pnpm db:push && pnpm db:seed && pnpm start
```

What happens:
1. Installs deps (~30 seconds)
2. Pushes the schema to Neon
3. Seeds the `ports` table + a `demo` tenant + (if `SUPER_ADMIN_EMAIL` is set) a super-admin user. **Note the temporary password printed in the console — log in immediately and change it.**
4. Starts the server on port 5000

## 5. Hit your deployment URL

Replit gives you a URL like `https://your-repl-name.your-username.repl.co`. Open it. You should see the QuoteFleet landing page.

- Marketing: `/`
- Demo widget: `/w/demo`
- Sign in: `/login`
- Dashboard (after sign-in): `/app`

## 6. Set `PUBLIC_BASE_URL`

After the first run, copy your Replit URL (or your custom domain if you've connected one) into the `PUBLIC_BASE_URL` Secret. This is what gets baked into embed snippets and email links. Restart the Repl.

## 7. (Optional) Connect a custom domain

In Replit deployment settings → Custom domain → follow the DNS instructions. Then update `PUBLIC_BASE_URL` and restart.

## 8. Promote to "Reserved VM" deployment

Replit's free tier sleeps. For a real deployment:

1. Replit → Deploy → Reserved VM
2. Build command: `pnpm install && pnpm db:push && pnpm db:seed`
3. Run command: `pnpm start`
4. Choose tier — `0.25 vCPU + 1GB RAM` is enough for first hundreds of tenants (~$7/mo)

The `.replit` file already specifies the right `[deployment]` block; Replit picks it up automatically.

## Troubleshooting

**"Cannot connect to Postgres"** — Check `DATABASE_URL`; Neon URLs need `?sslmode=require` at the end.

**"Missing required env var ANTHROPIC_API_KEY"** — Add to Secrets (not env file) on Replit.

**"Failed to start: bcrypt error"** — `bcryptjs` is the pure-JS variant; if you see this, ensure `pnpm install` ran (Replit caches sometimes).

**"AI calls fail"** — Check Anthropic key validity at console.anthropic.com. Each tenant can override with their own key in `/app/ai`.

**"Widget won't load on customer site"** — Mixed-content errors? Make sure `PUBLIC_BASE_URL` is HTTPS. Customer site embeds via `https://...` will refuse `http://...`.

**"Schema drift between db and code"** — `pnpm db:push` (locally with the same `DATABASE_URL`) syncs everything.

## Backups

Neon takes hourly automatic backups on the free tier. Configure point-in-time recovery in Neon console.

## Monitoring

Replit's deployment dashboard shows logs. For more visibility:
- `console.log` calls in the code go to Replit logs
- Audit log table (`audit_log`) records every AI/manual change
- Lead notifications go via SMTP — check spam/bounces in your SMTP provider's dashboard
