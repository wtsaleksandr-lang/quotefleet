# Architecture deep-dive

## Tenancy model

Every domain row is keyed by `tenant_id`. Tenants never see each other's data. The DB is intentionally simple — no schema-per-tenant complexity, just row-level isolation enforced at the route level (`requireTenant` middleware reads `req.user.tenantId` and scopes every query).

`super_admin` users have `tenantId = null` and can pass `?slug=…` to access any tenant's data via admin routes.

## Calculator engine

`src/calc/engine.ts` exports `calculate(rateCards, accessorials, laneZones, request)` — a pure function. It runs in 6 stages:

1. **Find a rate card** that matches `service` × `equipment`. If none, also try lane-zone match.
2. **Linehaul** = `max(miles × ratePerMile + flatFee, minimumCharge)` — or zone flat price if a zone wins.
3. **Auto-trigger accessorials** — apply any accessorial whose `trigger` fires for this request (residential, hazmat, weight-over-N, etc.).
4. **Optional accessorials** — apply any accessorial code in `selectedAccessorialCodes`.
5. **Fuel surcharge** = `linehaulSubtotal × (fuelSurchargePct / 100)` from the rate card.
6. **Margin** = `subtotal × (marginPct / 100)`.

Output is a `CalcResult` with itemised `lines[]`, subtotals, and a final `total`. Always USD; multi-currency is a future migration.

## Distance & geocoding

`src/calc/distance.ts` implements a 4-tier lookup:

1. **Port code shortcut** — if the request mentions a UN/LOCODE we know (USLAX, CAVAN, etc.), use the port's coordinates directly.
2. **Embedded ZIP3 / FSA centroid** — first three chars of US ZIP, first three of Canadian postal. ~50 KB hardcoded table.
3. **DB geocode_cache** — anything we've resolved before.
4. **Nominatim public API** — free, polite-use 1 req/sec, results cached.

Distance = `haversine × 1.18` (industry rule-of-thumb for road miles in North America). `±5%` accuracy on a quote price; the per-mile rate already absorbs that uncertainty. Real road routing is a future upgrade — see `docs/rate-data-sources.md` for the Valhalla self-hosting plan.

## AI agents

Three Claude-powered agents, all use the same `src/ai/client.ts` SDK wrapper:

| Agent | When it runs | Tool access | Model |
|-------|--------------|-------------|-------|
| **rateAgent** | Tenant admin chats in the AI tab | `list/update_rate_card`, `list/update/create_accessorial`, `list/update_lane_zone` | Haiku 4.5 default, escalates to Sonnet 4.6 |
| **replyAgent** | New lead is created (auto-reply email) | None | Haiku 4.5 |
| **chatAgent** | End customer chats from `/chat/:refId` | None | Haiku 4.5 |

`rateAgent` runs a tool-loop (max 3 turns). It prefers to read the current state, restate the planned change in plain English, ask for confirmation if the change is large, then write. Every write goes through `auditLog` with `actorKind: 'ai_agent'`.

API keys: per-tenant key (encrypted with AES-256-GCM keyed off `SESSION_SECRET`) takes precedence over platform `ANTHROPIC_API_KEY`. Lets carriers bring their own billing.

## Embed

`/embed.js?t=<token>` returns a tiny IIFE that:
1. Reads the script tag's parent
2. Inserts a div + iframe pointing to `/w/<slug>?embed=1`
3. Listens for `postMessage({qf: 'resize'})` from the iframe and adjusts iframe height

The widget itself (`widget.html` + `widget.js`) is a self-contained vanilla-JS form. CSS variables get patched at runtime from the tenant's brand config.

CORS is open on `/api/public/*` so any host site can post to it. The widget is served same-origin (since it's loaded inside an iframe under our domain), so no CORS issues there.

## Auth

- Bcrypt password hashing
- Opaque-token sessions stored in `sessions` table, 30-day TTL
- Cookie name: `qf_sess`, `httpOnly`, `sameSite: 'lax'`, `secure: true` when `PUBLIC_BASE_URL` is HTTPS
- No magic-link login in V1 (deliberate — added complexity for marginal value)

## Database

Postgres via Drizzle ORM + Neon HTTP driver. Drizzle's `db:push` handles schema diffs. Tables:

- `tenants` — one per carrier
- `users` — one+ per tenant (or `tenantId=null` for super_admin)
- `sessions` — auth tokens
- `rate_cards` — service × equipment pricing
- `accessorials` — extras
- `lane_zones` — drayage flat-tariff radii
- `ai_configs` — per-tenant AI persona / model preferences
- `brand_configs` — per-tenant widget styling
- `leads` — incoming quote requests with full breakdown
- `conversations` — chat history (admin rate chat + customer follow-up)
- `distance_cache` / `geocode_cache` — performance
- `audit_log` — every AI/manual change
- `ports` — read-only reference (US/Canada)
- `platform_settings` — global key/value store

## What runs where

```
┌──────────────────────────────────────────────────────────────┐
│  Customer's website                                          │
│   <script src="quotefleet.net/embed.js?t=..." defer></script>│
│           │                                                  │
│           ▼                                                  │
│   ┌──────────────────────────────┐                          │
│   │ <iframe src="quotefleet.net/  │                          │
│   │  w/<slug>?embed=1">           │                          │
│   │  (the calculator widget)      │                          │
│   └──────────────┬───────────────┘                          │
└──────────────────┼───────────────────────────────────────────┘
                   │ HTTPS API
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  QuoteFleet server (Express on Replit)                       │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│   │ Public API   │  │ Tenant API   │  │ Admin API    │      │
│   │ (no auth)    │  │ (auth)       │  │ (super only) │      │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│          │                 │                 │              │
│          ▼                 ▼                 ▼              │
│   ┌──────────────────────────────────────────────────┐      │
│   │           Calculator engine (pure)                │      │
│   │           Distance + geocode (cached)             │      │
│   │           AI agents (Anthropic)                   │      │
│   └─────────────────────┬────────────────────────────┘      │
│                         │                                   │
│                         ▼                                   │
│                  ┌──────────────┐                           │
│                  │  Postgres    │                           │
│                  │  (Neon)      │                           │
│                  └──────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

## Security notes

- All form input goes through Zod schemas in routes
- Per-tenant API keys are encrypted at rest with AES-256-GCM, key derived from `SESSION_SECRET` via SHA-256
- Session cookies are httpOnly + sameSite-lax
- `requireTenant` middleware blocks cross-tenant access at every endpoint
- Audit log on every AI mutation — non-repudiable

## Performance notes

- Geocode cache + distance cache mean repeat lanes return in &lt;5 ms
- Anthropic Haiku 4.5 is default — sub-second responses, ~$0.002 per quote
- Rate-agent tool-loop is capped at 3 turns to prevent runaway cost
- Express serves static files from disk; no SSR; widget renders client-side

## Future scale

Today's stack handles ~100 tenants × ~500 quotes/day each (~50K/day) without breaking a sweat. When that's not enough:

- Move from Neon HTTP to Neon WebSocket or Supabase pooler for concurrent connections
- Add a Redis layer for the geocode cache
- Move Anthropic calls onto a queue (BullMQ) so the request thread returns the calc immediately and AI summary backfills via SSE
- Move static widget bundle to a CDN

None of that is needed in V1.
