# Cloudflare ops runbooks

Two scripts in this folder:

## `cloudflare-migrate.mjs` — Namecheap → Cloudflare DNS

Move domains from Namecheap registrar's DNS to Cloudflare so they get
free Universal SSL covering `<domain>` AND `*.<domain>`. Detailed
runbook at the bottom of this file.

## `cloudflare-replit-link.mjs` — Cloudflare → Replit deployment

For zones already on Cloudflare, point them at the QuoteFleet Replit
deployment by adding apex + wildcard CNAMEs (proxied, orange cloud).
With proxy on, Cloudflare terminates SSL at the edge and forwards the
`Host` header through to Replit unchanged — so QuoteFleet's multi-host
middleware sees the right tenant slug, and you do NOT need to add each
custom domain individually in Replit's deployment settings.

```bash
cd ops

export CF_API_TOKEN="cfut_h3H3orGMsuAHwQF3gSJVTA4s901A47PmOa4FtsEX020bc75d"

# 1. INSPECT (no writes). Tags every zone:
#      SAFE             no apex record yet — safe to link
#      ALREADY_LINKED   apex CNAMEs to your Replit URL already
#      IN_USE           apex points elsewhere (LoadMode, wefixtrades, …)
#                       script won't touch without --force
node cloudflare-replit-link.mjs \
  --account efa414704efefaa266c86d5d136d1e3a \
  --target  quote-fleet.replit.app

# 2. LINK ONLY THE FOUR HOST_DOMAINS (safest path — recommended):
node cloudflare-replit-link.mjs \
  --account efa414704efefaa266c86d5d136d1e3a \
  --target  quote-fleet.replit.app \
  --include quotefleet.app,quotefleet.net,truckrate.online,your-quote.online \
  --do-it

# 3. Or: link every SAFE zone (skips IN_USE so other apps stay alive):
node cloudflare-replit-link.mjs \
  --account efa414704efefaa266c86d5d136d1e3a \
  --target  quote-fleet.replit.app \
  --do-it

# 4. Force-overwrite IN_USE zones (only after eyeballing the plan!):
node cloudflare-replit-link.mjs \
  --account efa414704efefaa266c86d5d136d1e3a \
  --target  quote-fleet.replit.app \
  --do-it --force
```

After the script runs, do these **once per linked zone** in the Cloudflare dashboard:

1. SSL/TLS → Overview → mode = **Full** (Replit serves a valid `*.replit.app` cert)
2. SSL/TLS → Edge Certificates → enable **Always Use HTTPS**

Then update **Replit Secrets**:

| Key | Value |
|---|---|
| `HOST_DOMAINS` | Comma-separated list of linked domains, e.g. `quotefleet.app,quotefleet.net,truckrate.online,your-quote.online` |

Redeploy. The signup form's host dropdown now offers every linked domain.

---

## Migration runbook (Namecheap → Cloudflare)

Move ~20 domains from Namecheap registrar's DNS to Cloudflare to get
free Universal SSL on each (covers `<domain>` AND `*.<domain>`).

---

## 1. Whitelist your IP in Namecheap

Cloudflare's API is open. Namecheap's is not — they require IP allowlisting.

1. Find the IP you'll run the script from: `curl -s ifconfig.me`
2. Open https://ap.www.namecheap.com/settings/tools/apiaccess/
3. Toggle "API Access: ON" if it isn't already
4. Under "Whitelisted IPs", add the IP from step 1
5. Save. Wait ~30 seconds for propagation.

---

## 2. Get a Cloudflare API token with the right scopes

The token you provided (`cfut_h3H3...`) — verify it has the scopes the
script needs. If not, create a new one:

1. https://dash.cloudflare.com/profile/api-tokens → "Create Token" → "Custom token"
2. Permissions:
   - **Zone** → **Zone** → **Edit**
   - **Zone** → **DNS** → **Edit**
   - **Account** → **Zone** → **Edit**
3. Account Resources: include your account
4. Zone Resources: All zones from your account
5. Save. Copy the token.

You'll also need your **Cloudflare Account ID** (visible in the
dashboard sidebar of any zone, or via `GET /accounts`).

---

## 3. Dry run

```bash
cd /home/user/ops    # or wherever you put cloudflare-migrate.mjs

export CF_API_TOKEN="cfut_h3H3orGMsuAHwQF3gSJVTA4s901A47PmOa4FtsEX020bc75d"
export NC_API_KEY="7df9f14e2ec54170a5512bd6dc39a1e7"
export NC_USER="ewoio"
# Get your Cloudflare account ID: dashboard sidebar of any zone, or
# leave CF_ACCOUNT_ID unset and the script will list your accounts.

node cloudflare-migrate.mjs --user "$NC_USER"
```

The first run (without `--account`) will print your Cloudflare account
IDs. Pick the one to use, then re-run with `--account <id>`:

```bash
node cloudflare-migrate.mjs --user "$NC_USER" --account abc123…
```

This lists every Namecheap domain and shows a planned action per row:

```
[skip ] curalabs.shop                    excluded by user
[skip ] medicine.recipes                 excluded by user
[skip ] snorezaway.com                   excluded by user
[reuse] loadmode.app                     already on Cloudflare
[add  ] quotefleet.app                   will create zone
[add  ] quotefleet.net                   will create zone
...
```

No changes are made.

---

## 4. Phase 1 — create zones

Once the dry-run plan looks right:

```bash
node cloudflare-migrate.mjs --user "$NC_USER" --account "$CF_ACCOUNT_ID" --do-it
```

Type `yes` at the confirm prompt. The script:

- Creates a Cloudflare zone for each `add` row
- Cloudflare auto-imports existing public DNS records via its scanner
  (A/AAAA/MX/TXT it can resolve from the live nameservers)
- Prints the assigned Cloudflare nameservers per domain
- Writes a JSON log line to `cloudflare-migrate-YYYY-MM-DD.log`

**Domains keep working** during this phase. Their NS still point at
Namecheap. We're only setting up the zone on Cloudflare.

### Verify imported records before phase 2

For each domain that has live email or websites, **eyeball the imported records**:

1. Cloudflare dashboard → pick the new zone → DNS → Records
2. Make sure your MX, A/CNAME, TXT (SPF/DKIM/DMARC) records are present
3. If anything is missing, add it manually before phase 2 — once you
   change NS, missing records mean broken email or websites.

---

## 5. Phase 2 — switch nameservers at Namecheap

```bash
node cloudflare-migrate.mjs --user "$NC_USER" --account "$CF_ACCOUNT_ID" --do-it --update-ns
```

Confirms again. Then for every zone that's already on Cloudflare, it
calls `namecheap.domains.dns.setCustom` with the assigned NS pair.

DNS propagates over 5–60 minutes. Cloudflare's "Pending Nameserver
Update" status flips to "Active" once they detect the change. SSL
issues automatically about 15 minutes after activation.

---

## 6. After migration

- Cloudflare → SSL/TLS → Overview → set mode to **Full (strict)**
  (or **Full** if your origin doesn't have its own cert).
- Cloudflare → SSL/TLS → Edge Certificates → enable **Always Use HTTPS**.
- For wildcard subdomain coverage, Universal SSL automatically covers
  `<domain>` + one level of subdomains. Deeper wildcards (e.g.
  `*.foo.<domain>`) need an Advanced Certificate ($10/mo on free).

---

## 7. Excluded domains

Hardcoded in `EXCLUDED` at the top of `cloudflare-migrate.mjs`:

```js
const EXCLUDED = new Set([
  'curalabs.shop',
  'medicine.recipes',
  'snorezaway.com',
]);
```

Edit the set if you want to change which domains are skipped.

---

## 8. Rollback (if something breaks)

If a domain goes sideways after switching NS:

1. Namecheap → Domain List → Manage → Nameservers → switch back to
   "Namecheap BasicDNS" (or whatever was there before).
2. Wait 5–60 minutes for DNS to revert.
3. Diagnose the missing record on Cloudflare and re-try.

The Cloudflare zone stays around — you can re-attempt phase 2 later
without re-running phase 1.
