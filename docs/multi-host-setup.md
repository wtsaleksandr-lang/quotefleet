# Multi-host setup — running QuoteFleet on multiple domains

Each tenant gets a hosted page at `<slug>.<host>` where `<host>` is one of the platform-owned domains they pick at signup. Same backend, same database — just multiple base domains pointing at the same deployment.

This doc covers what you (the platform operator) need to do at the registrar and at Replit / Caddy / Cloudflare to make the routing work.

> **Code is already done.** The server reads `HOST_DOMAINS` from env, parses the `Host` header on every request, and serves the right tenant's widget on `/`. You just need to wire DNS + TLS so requests actually arrive.

---

## 1. Add the domains to `HOST_DOMAINS`

In your `.env` (or Replit Secrets):

```
HOST_DOMAINS=quotefleet.app,quotefleet.net,truckrate.online,your-quote.online
```

The first entry is the **default** — used for new signups when the customer doesn't pick one.

Restart the app. From now on:
- New tenants get a host picker at signup with these four options.
- Wildcard subdomains on each route to the right tenant.

---

## 2. Buy the domains

You said these are available:

| Domain | Notes | Approx. price (Cloudflare Registrar) |
|---|---|---|
| `quotefleet.app` | The default — main brand | ~$14/yr (`.app` is a Google TLD, HSTS-required so HTTPS only — fine for us) |
| `quotefleet.net` | Brand variant | ~$10/yr |
| `truckrate.online` | Generic / per-customer choice | ~$2-3/yr first year |
| `your-quote.online` | Generic / per-customer choice | ~$2-3/yr first year |

I'd recommend buying through **Cloudflare Registrar** (https://www.cloudflare.com/products/registrar/) — at-cost pricing, free WHOIS privacy, free DNSSEC, and you'll be on Cloudflare DNS anyway for the routing trick below.

---

## 3. DNS — wildcard each domain at your deployment

For each domain, you need:

```
A          @      <your_server_ip>
A          *      <your_server_ip>
```

Or if your deployment doesn't have a stable IP (e.g. Replit, Render):

```
CNAME      @      <your-app>.replit.app
CNAME      *      <your-app>.replit.app
```

> **Replit caveat.** The free Replit deployment URL (`<repl>.replit.app`) does *not* support wildcard CNAMEs against arbitrary custom domains out of the box. You need either:
>   - **Replit Reserved VM Deployment** ($10+/mo) which lets you map custom domains, OR
>   - **Cloudflare in front** (free tier works) — see step 4.

The cleanest setup: **Cloudflare Proxy** with each `HOST_DOMAINS` domain on Cloudflare DNS, "proxied" (orange cloud), with one origin record pointing at Replit. This gets you free TLS, free wildcard support, and the `Host` header arrives intact at your app.

---

## 4. TLS — wildcard certificate per domain

You need a cert that covers `*.<domain>` and `<domain>` for each entry in `HOST_DOMAINS`.

**Option A — Cloudflare (recommended).** Add domain → Cloudflare auto-issues "Universal SSL" covering `<domain>` and `*.<domain>`. Set SSL/TLS mode to **Full (strict)**. Done. Repeat for each domain.

**Option B — Caddy in front of Replit.** Run a tiny VPS ($5/mo on Hetzner / DO) with Caddy reverse-proxying to your Replit URL. Caddy handles ACME wildcard via DNS-01:

```caddyfile
*.quotefleet.app, quotefleet.app {
  tls {
    dns cloudflare {env.CF_API_TOKEN}
  }
  reverse_proxy <your-app>.replit.app
}
```

Repeat the block for each base domain. Caddy auto-renews.

**Option C — Replit Reserved VM** with custom domain feature. Replit handles TLS automatically once you add `*.quotefleet.app` and verify ownership.

---

## 5. Verify routing

Once DNS + TLS are live:

```bash
# Should return the marketing landing page
curl -sI https://quotefleet.app/ | head -1

# Should return the demo tenant's widget
curl -sI https://demo.quotefleet.app/ | head -1

# Same demo tenant on a different brand
curl -sI https://demo.truckrate.online/ | head -1

# A non-existent slug should still resolve (widget loads, then errors with 404 from API)
curl -s https://nope.quotefleet.app/ | head -10
```

The server logs will show `host=demo.quotefleet.app subdomain=demo baseDomain=quotefleet.app` for each subdomain request.

---

## 6. Cookie scope (gotcha)

Session cookies are set with `path=/` and **no domain** — so they're tied to the host that set them. That's intentional: a logged-in tenant on `acme.quotefleet.app` doesn't accidentally share a session with another tenant on the same base domain. The dashboard at `quotefleet.app/app` runs in its own cookie scope from the bare domain.

If you ever want a single sign-on across `<slug>.quotefleet.app` and `quotefleet.app/app`, set the cookie domain to `.quotefleet.app` — but **don't do that across base domains** (you can't share a cookie between `quotefleet.app` and `truckrate.online` even if you wanted to; browsers prevent it).

---

## 7. Custom domain (Pro tier — future)

The `tenants.custom_domain` column is in the schema but not wired into routing yet. When you build the Pro feature:

1. Tenant adds `quote.astova.com` in dashboard.
2. Verify they CNAMEd it to `<slug>.quotefleet.app`.
3. Cloudflare for SaaS (free up to 100 hostnames) handles per-customer TLS automatically.
4. Add a check in `hostInfo.ts` — if the host doesn't match `HOST_DOMAINS`, look up `tenants.custom_domain` and resolve.

Plan on ~1 day of work. Don't do it until at least one Pro customer has asked.

---

## 8. Reserved subdomains

These subdomains are blocked from being claimed by tenants (see `RESERVED_SLUGS` in `src/server/routes/auth.ts` and the matching reserved set in `src/server/hostInfo.ts`):

```
www, app, admin, api, mail, docs, help, status, static, cdn, assets,
login, signup, logout, pricing, about, blog, support, demo, test,
staging, dev, public, private, auth, oauth, embed, widget, chat,
webhook, webhooks
```

Add to both lists if you spin up any new platform-level subdomains (e.g. if you host docs at `docs.quotefleet.app`).

---

## 9. Cost summary

| Line item | Cost |
|---|---|
| 4 domains × ~$8/yr avg (Cloudflare Registrar) | ~$32/yr |
| Cloudflare Universal SSL × 4 | $0 |
| Replit Reserved VM (or VPS for Caddy) | $5-10/mo |
| **Total** | ~$60-150/yr |

Negligible compared to the value of multiple branded URLs at signup time.
