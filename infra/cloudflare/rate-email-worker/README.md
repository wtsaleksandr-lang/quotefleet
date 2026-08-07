# Rate-email inbound Cloudflare Worker (`qf-rate-email`)

Deployed Cloudflare **Email Worker** that powers the "forward your rate emails" auto-import feature. It is the mail-provider half of the contract documented in `src/server/routes/inbound.ts`.

## What it does

Bound as the **catch-all** for `quotefleet.net` email routing:

- Mail to `rates-<token>@quotefleet.net` → parsed (subject/text/html/attachments via `postal-mime`) and POSTed as JSON to `https://quotefleet.net/api/inbound/rate-email` with the `X-Inbound-Secret` header. The app resolves the tenant from the `to` token, runs the same `parseRateSheet` as the manual uploader, and applies-if-safe / holds-for-review.
- **Everything else** (any non-`rates-` address) and **any error** (parse failure, non-2xx from the webhook) → `message.forward("support@loadmode.net")`. This preserves the pre-existing catch-all behavior exactly, so no mail is ever lost.

## Config / bindings

- Secret binding `INBOUND_WEBHOOK_SECRET` — must equal Doppler `quotefleet/prd` `INBOUND_WEBHOOK_SECRET` (the value the app's webhook validates). Set at deploy time (see `deploy.mjs`), never committed.
- App side: Doppler `quotefleet/{dev,prd}` `INBOUND_EMAIL_DOMAIN=quotefleet.net` (drives the displayed `rates-<token>@quotefleet.net` address + clears the "setup in progress" banner once prod boots with it).

## Deploy

```sh
npm install                       # postal-mime + esbuild
node node_modules/esbuild/bin/esbuild src.mjs --bundle --format=esm \
  --platform=browser --target=es2022 --outfile=bundle.mjs
CF_KEY="<cloudflare token w/ Workers Scripts: Edit>" \
INBOUND_WEBHOOK_SECRET="$(doppler secrets get INBOUND_WEBHOOK_SECRET --plain -p quotefleet -c prd)" \
  node deploy.mjs
```

Then, once (already done — recorded here for reproducibility): point the zone's
Email Routing **catch-all** action at this worker:

```
PUT /zones/<quotefleet.net zone>/email/routing/rules/catch_all
{ "enabled": true, "matchers": [{"type":"all"}],
  "actions": [{"type":"worker","value":["qf-rate-email"]}] }
```

CF account `653c7ef13d4439532fb4a1a78b0555ad`, zone = `quotefleet.net`.

`bundle.mjs` and `node_modules/` are build artifacts — not committed.
