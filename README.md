# QuoteFleet

> Embeddable instant quote calculator + AI dispatcher for drayage & trucking carriers in USA / Canada. Multi-tenant SaaS.

---

## What it does

A drayage or trucking carrier signs up. We instantly load realistic per-mile rates (sourced from public 2026 benchmarks), port-zone tariffs for the major US/Canada ports, accessorials (chassis split, prepull, residential, hazmat, …), and a default AI agent persona.

They paste **one line of HTML** on their website:

```html
<script src="https://yourquotefleet.app/embed.js?t=YOUR_TOKEN" defer></script>
```

Visitors to their site get a polished, branded quote calculator. They fill in pickup, delivery, equipment, weight, accessorials → instant price + line-item breakdown. If they enter their email, the lead lands in the carrier's dashboard, and the AI dispatcher sends an auto-reply email and offers chat-style follow-up.

The carrier tunes their rates by chatting in plain English with their dedicated AI agent ("raise dryvan to $2.65/mi, add a $50 chassis-flip fee, disable LTL on weekends"). The AI executes against the rate cards and writes everything to an audit log.

---

## Quick start

### 1. Clone & install

```bash
pnpm install
```

### 2. Configure env

Copy `.env.example` → `.env` and fill in:

- **`DATABASE_URL`** — Postgres connection string (Neon free tier works perfectly)
- **`ANTHROPIC_API_KEY`** — Claude API key from console.anthropic.com
- (Optional) `PUBLIC_BASE_URL`, `SUPER_ADMIN_EMAIL`, `SMTP_*`, `MAPBOX_TOKEN`

### 3. Push schema + seed

```bash
pnpm db:push          # creates tables on the Postgres
pnpm db:seed          # ports table, demo tenant, super-admin
```

The seed prints a temporary super-admin password if `SUPER_ADMIN_EMAIL` is set — note it, log in immediately, change it.

### 4. Run

```bash
pnpm dev              # tsx watch, restarts on save
# or
pnpm start            # production
```

Open http://localhost:5000.

- Marketing page: `/`
- Demo widget: `/w/demo`
- Embed snippet (after signup): `/app/embed`
- Super admin: `/admin`

---

## Architecture

```
src/
  config.ts                 — env validation
  index.ts                  — (none — see server/index.ts)
  db/
    schema.ts               — all Drizzle tables (multi-tenant)
    client.ts               — Neon HTTP driver
    seed.ts                 — ports + demo tenant + super-admin bootstrap
  calc/
    engine.ts               — pure quote calculator (rate × miles + accessorials)
    distance.ts             — geocode + haversine distance, with cache
    defaults.ts             — default rate cards / accessorials / port zones
    zipCentroids.ts         — US ZIP3 lookup table
    canadaFsa.ts            — Canada FSA lookup table
  data/
    ports.ts                — top US/Canada container ports
  ai/
    client.ts               — Anthropic SDK wrapper, BYO-key per tenant
    prompts.ts              — system prompt templates
    rateAgent.ts            — tool-calling agent for rate adjustments
    replyAgent.ts           — auto-reply email composer
    chatAgent.ts            — customer-service chat
  auth/
    password.ts             — bcrypt hashing
    session.ts              — DB-backed session cookies
    secrets.ts              — AES-256-GCM for tenant API keys
  email/
    send.ts                 — nodemailer wrapper, logs-to-stdout fallback
  server/
    index.ts                — entry: loadEnv() + listen
    app.ts                  — Express app factory
    middleware.ts           — requireAuth / requireTenant / requireSuperAdmin
    routes/
      auth.ts               — signup / login / logout / me
      public.ts             — embed.js, widget config, quote, lead, chat
      tenant.ts             — rates / accessorials / leads / brand / embed CRUD
      admin.ts              — super-admin tenant management
      ai.ts                 — rate-agent chat + sandbox preview
    public/                 — static frontend (HTML+JS, no build step)
      landing.html / pricing.html / login.html / signup.html
      app.html + app.js     — tenant dashboard SPA
      admin.html + admin.js — super-admin SPA
      widget.html + widget.js — embeddable calculator
      chat.html + chat.js   — customer follow-up chat
      style.css             — shared styles
      widget-style.css      — widget-only styles
docs/
  competition.md            — market research (competitors, gaps)
  rate-data-sources.md      — free public data sources for rates
  domain-ideas.md           — domain candidates
  architecture.md           — deeper dive
  deploy-replit.md          — Replit deployment guide
```

### Key design decisions

- **Vanilla HTML/JS frontend** — no build step. Easier to deploy on Replit, easier for the AI agent to modify, easier to embed (the widget bundle is < 30 KB).
- **Drizzle + Postgres (Neon)** — same stack as the user's other repos; schema migrations are simple `pnpm db:push`.
- **Multi-tenant from day 1** — every row that holds tenant data has a `tenant_id` FK. Super-admin is `tenantId: null`.
- **Calculator is a pure function** — same `calculate()` runs server-side at quote time, on the AI's sandbox preview, and (in future) inside a unit-test harness. No state.
- **Embed via iframe** — sidesteps host-page CSS pollution and CORS headaches. PostMessage handles auto-resize.
- **Per-tenant Anthropic key** — encrypted at rest with AES-256-GCM. Falls back to platform key if not set.

---

## Deployment

### On Replit

The included `.replit` is preconfigured. After cloning into a Repl:

1. Add Replit Secrets: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `SUPER_ADMIN_EMAIL`, `PUBLIC_BASE_URL` (set this to your Repl URL once you know it).
2. Hit Run. The first run executes `pnpm install && pnpm db:push && pnpm db:seed && pnpm start`.
3. Set `PUBLIC_BASE_URL` to your real custom domain once you connect one.

See `docs/deploy-replit.md` for step-by-step screenshots.

### Custom domain

1. Buy a domain (see `docs/domain-ideas.md` for vetted options).
2. Point an A or CNAME record at your Replit deployment.
3. Update `PUBLIC_BASE_URL` env var.
4. Restart.

---

## What's NOT in this MVP (deliberately)

- **Live road-distance routing** — uses haversine × 1.18 (industry approximation). Good enough for ±5% on quote price; real OSRM/Mapbox routing is a future plug-in.
- **Live diesel-price feed** — uses fuel-surcharge percent stored on each rate card. EIA API integration scaffolded but not wired (env var `EIA_API_KEY`).
- **Stripe billing** — plan tier is a string in the DB; no actual subscription enforcement yet. Billing integration is the obvious next step (1-2 days of work).
- **Magic-link login** — bcrypt password is fine for V1. Magic links can come later.
- **Multi-user team accounts** — the schema supports it (`role` column), but the UI has only owner login. Add `team` page when needed.
- **Webhooks / CSV export** — listed in pricing for Pro, schema supports it, route is the next 2-hour feature.

---

## Research backing the defaults

The seed numbers aren't made up:
- Per-mile rates from `docs/rate-data-sources.md` (national 2026 benchmarks: DV $2.55/mi, RF $2.95/mi, FB $3.25/mi).
- Drayage zone tariffs from public port tariffs (LA/LB, NY/NJ, Houston, Norfolk, Vancouver, Montreal, Halifax, Prince Rupert).
- Accessorial defaults from carrier publications: detention $75/hr, layover $350, prepull $175, chassis split $175, hazmat 18%, etc.
- Geocoding from US ZCTA + Canadian FSA centroids (embedded), with Nominatim fallback.

A new tenant gets credible quotes on day 1, then tunes via the AI agent.

---

## Roadmap (next 4 weeks)

| Week | Items |
|------|-------|
| 1 | Real road-distance via Valhalla self-hosted; live EIA fuel index; CSV export of leads |
| 2 | Stripe billing + plan enforcement; magic-link login; team accounts |
| 3 | Webhooks (Zapier-friendly); inbound email parsing (rate-sheet drop-in); SMS notifications via Twilio |
| 4 | DAT/Truckstop/Loadsmart rate-source plug-ins (commercial); custom-domain SSL; SOC-2-light audit log retention |

---

## License

Private — all rights reserved. Contact for licensing terms.
