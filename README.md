# QuoteFleet

Embeddable instant quote widget, hosted quote pages, marketplace benchmarking, and AI follow-up tools for drayage and trucking carriers in the USA and Canada.

## Product summary

QuoteFleet helps a carrier share a hosted branded rate page that customers can open anytime.

A customer enters lane, equipment, weight, and add-ons. QuoteFleet calculates from the carrier's own rate cards, lane zones, and accessorials, then creates a branded quote experience with follow-up actions.

Core flows:

- Public quote widget at `/w/:slug`
- Hosted quote page at `/quote/:refId`
- Customer chat at `/chat/:refId`
- Tenant dashboard at `/app`
- Optional public marketplace at `/marketplace/`
- Super-admin console at `/admin`

## What is already built

- Multi-tenant signup/login and dashboard
- Embeddable widget and hosted widget link
- Public quote calculation with rate cards, lane zones, accessorials, and flags
- Drayage terminal/port-aware inputs
- Location autocomplete endpoint with Google Maps first, Mapbox fallback, and free-text fallback
- Hosted quote document page with branded header, pricing breakdown, map fallback, and print/PDF-ready styling
- Quote activity tracking for views, copy-link, print/PDF, chat, and callback actions
- Quote email preview template without requiring live email delivery
- Carrier profile fields stored in platform settings
- Accessorial library seeding and dashboard filters
- Rate-card/accessorial/lane-zone workbook import script
- Marketplace carriers, public benchmarks, and confidence metadata
- GitHub Actions CI for typecheck and unit tests

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm db:push
pnpm db:seed
pnpm dev
```

Open:

```text
/
/w/demo
/app
/admin
```

## Required environment

Minimum required values are documented in `.env.example`.

Most important variables:

```text
DATABASE_URL
ANTHROPIC_API_KEY
SESSION_SECRET
PUBLIC_BASE_URL
HOST_DOMAINS
```

Optional integrations:

```text
GOOGLE_MAPS_API_KEY
MAPBOX_TOKEN
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
EIA_API_KEY
```

Without Google or Mapbox keys, users can still type ZIP/city manually. Without SMTP, email previews work and outbound emails log to stdout.

## Common commands

```bash
pnpm typecheck
pnpm test
pnpm db:push
pnpm db:seed
pnpm accessorials:seed
pnpm rates:import -- --tenant-slug=demo --file=/path/to/rates.xlsx
pnpm quotes:recent
```

## Support workflow

Low-risk support passes use the reusable `automation/support-work` branch.

Before support work, check:

- `docs/support-docs-index.md`
- `docs/automation-runbook.md`
- `docs/support-pr-review-checklist.md`
- `docs/quote-copy-rules.md`

Support changes should stay limited to docs, smoke tests, copy polish, accessibility notes, or isolated frontend-only polish. Avoid product logic, quote calculation, API behavior, database schema, authentication, payments, AI workflow behavior, and active product-work files.

After a clean support PR is merged, reset `automation/support-work` to latest `main` so the branch does not drift.

## Production launch operations

Before real public traffic, review:

- `docs/launch-qa-matrix.md` — freight scenario QA and manual launch sign-off.
- `docs/production-launch-ops.md` — monitoring, backups, incident process, support workflow, terms/privacy, and data-retention checklist.

Production launch should have assigned owners for monitoring, backups, support, legal/customer notices, billing/account decisions, and incident response.

## Important public routes

| Route | Purpose |
|---|---|
| `/` | Marketing homepage |
| `/pricing` | Pricing page |
| `/w/demo` | Demo widget |
| `/w/:slug` | Tenant hosted widget |
| `/quote/:refId` | Hosted quote document |
| `/chat/:refId` | Customer follow-up chat |
| `/app` | Tenant dashboard |
| `/admin` | Super-admin console |
| `/marketplace/` | Public marketplace |

## Repository layout

```text
src/
  ai/                 AI clients and prompt/tool agents
  auth/               password hashing, sessions, encrypted secrets
  calc/               quote engine, distance, defaults, accessorial library
  data/               ports and static data
  db/                 Drizzle schema, client, seed
  email/              mail wrapper and fallback logging
  server/
    app.ts            Express app factory and public page routing
    routes/           auth, tenant, public, quote, marketplace, billing, tools
    public/           vanilla HTML/CSS/JS frontend assets
scripts/
  seed-accessorial-library.ts
  import-rates.ts
  list-recent-quotes.ts
docs/
  deploy-replit.md
  rate-import-template.md
  architecture.md
```

## Replit deployment checklist

1. Pull latest `main`.
2. Add Replit Secrets from `.env.example`.
3. Run `pnpm install` if dependencies changed.
4. Run `pnpm db:push`.
5. Run `pnpm db:seed` once for a fresh database.
6. Run `pnpm accessorials:seed` to backfill the expanded accessorial library.
7. Run `pnpm typecheck`.
8. Restart the Replit app.
9. Open `/`, `/w/demo`, `/app`, and `/quote-demo.html`.

## Rate import

Use the workbook importer when a carrier has rates in XLSX format:

```bash
pnpm rates:import -- --tenant-slug=YOUR_SLUG --file=/path/to/rates.xlsx
```

Supported sheets:

- `Rate Cards`
- `Accessorials`
- `Lane Zones`

The importer upserts rows to avoid duplicates.

See `docs/rate-import-template.md`.

## Testing quote pages

To find real quote refs in the active database:

```bash
pnpm quotes:recent
```

Then open:

```text
/quote/YOUR_REF_ID
```

## Current limitations

- Live email sending requires SMTP secrets.
- Real address suggestions require Google Maps or Mapbox credentials.
- Browser print/PDF works; a true server-generated PDF endpoint is still a future hardening item.
- Production billing requires payment-provider credentials and full verification.
- Team accounts and magic-link login are not yet fully productized.

## Roadmap

Near-term priorities:

1. Header/footer polish across all public pages.
2. Searchable terminal selector in the widget.
3. Hosted quote and print/PDF polish.
4. Smoke tests for landing, widget, quote demo, and dashboard shell.
5. Auth/signup reliability and clearer errors.
6. Server-side PDF generation when the runtime/browser dependency is confirmed.

## License

Private — all rights reserved. Contact for licensing terms.