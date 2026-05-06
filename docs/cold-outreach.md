# Cold outreach — architecture and runbook

> The QuoteFleet platform itself never sends cold mail. We push prospects to **Smartlead**, which handles sending, warmup, deliverability, and webhook events back. The platform is the *CRM* — pipeline, statuses, notes, conversion attribution.

This separation is critical: cold outreach from `quotefleet.app` would torch the same domain we use for magic-links and password resets. Smartlead runs on a separate sending domain.

---

## 1. Sending domain — set this up first

**Never send cold from `quotefleet.app`.** Buy a separate domain for outreach.

Recommended name pattern: `<brand>mail.com`, `try-<brand>.com`, or just a generic-sounding domain that ties back to a real LLC. Examples:

- `quotefleetmail.com`
- `try-quotefleet.com`
- `loadmodemail.com` (you already own loadmode)

Set up:

1. Buy domain → Cloudflare Registrar (~$10/yr).
2. Add to Smartlead → Settings → Email Accounts → "Connect Email Account."
3. Smartlead walks you through SPF, DKIM, DMARC records you paste into Cloudflare.
4. Let it warm up for **2-3 weeks** before sending production volume. Smartlead's own warmup engine handles this — set warmup limit to 30/day for the first 2 weeks.
5. After warmup, ramp to 30 → 50 → 75 → 100 sends/day per inbox. Don't go higher than 50/day from a single inbox if you want to stay deliverable.

If you want volume faster: spin up **3-5 sending inboxes** (`alex@try-quotefleet.com`, `sam@try-quotefleet.com`, etc.), warm them in parallel, rotate via Smartlead. That's the standard play.

---

## 2. Prospect sourcing

Sources for drayage / trucking carriers:

| Source | Cost | Notes |
|---|---|---|
| **FMCSA SAFER** (fmcsa.dot.gov/safer) | Free | All US trucking companies, with email + phone for ~30%. Bulk download via SAFER snapshot. |
| **Apollo.io** | $49-99/mo | Best for filtering by industry + role. Carrier dispatcher / ops manager titles. |
| **LinkedIn Sales Navigator** | $99/mo | Good for personalization + decision-maker discovery. |
| **Google Maps scraping** | Custom | Free if you build it (Maps URL → place details API → contact info from website). |
| **Industry directories** | Free | Drayage Group Coalition, IANA, ATA member lists. |
| **Manual / referrals** | Free | Highest conversion; lowest volume. |

For QuoteFleet's first 500 prospects: FMCSA SAFER + Google Maps scrape of "drayage [city]" for the top 20 US container ports. Filter to companies with active websites that *don't* have a quote calculator already.

---

## 3. Data model — what we track in QuoteFleet

Three tables (already in schema):

- `outreach_prospects` — one row per prospect. Status, segment, contact info, website snapshot, conversion link to `tenants` if they sign up.
- `outreach_campaigns` — mirrored from Smartlead. Stats refreshed every 10 min.
- `outreach_events` — every send / open / click / reply / bounce. Mirrored from Smartlead webhooks.

**Status flow**:

```
new
 ├→ enriched          (we found their email + decision-maker)
 │   └→ queued        (added to a Smartlead campaign)
 │       └→ sent      (initial sent successfully)
 │           ├→ opened
 │           │   ├→ replied
 │           │   │   ├→ meeting     (booked a Zoom)
 │           │   │   │   └→ trial_started   (signed up)
 │           │   │   │       └→ subscribed   (paid)
 │           │   │   │           └→ churned
 │           │   │   └→ unqualified
 │           │   └→ (no reply — keep in followup sequence)
 │           ├→ bounced
 │           └→ unsubscribed
 └→ unqualified       (manually disqualified before send)
```

`outreach_events` is the activity timeline. The dashboard shows the prospect's status + the last 5 events.

---

## 4. Smartlead config (env vars)

```bash
# Required
SMARTLEAD_API_KEY=sl-xxxxxxxxxxxxxxxx
SMARTLEAD_SENDING_DOMAIN=try-quotefleet.com

# Optional (defaults to Smartlead's prod URL)
SMARTLEAD_BASE_URL=https://server.smartlead.ai/api/v1

# Optional — webhook signing secret (set this when you configure
# webhooks in Smartlead → Campaigns → Webhooks).
SMARTLEAD_WEBHOOK_SECRET=...
```

The platform only calls Smartlead when an admin clicks "Push to Smartlead" in the dashboard. No background sending from QuoteFleet.

---

## 5. Workflow (the admin dashboard)

After login as super-admin, the Outreach section will let you:

1. **Import prospects** — upload CSV, paste rows, or trigger a Maps scraper (built later).
2. **Enrich** — for prospects without email, attempt to find one via Hunter.io / Apollo (configurable provider).
3. **Pick a campaign** — list of Smartlead campaigns, with current stats inline.
4. **Push** — sends selected prospects to Smartlead's lead list. Smartlead handles sequencing, replies, follow-ups, unsubscribes from there.
5. **Monitor** — webhook events stream into `outreach_events`. Dashboard shows pipeline by status with conversion percentages.

---

## 6. Compliance — read this twice

**US (CAN-SPAM)**: cold B2B is legal if you (a) include identification, (b) include a working unsubscribe, (c) include your physical address. Smartlead inserts the unsubscribe footer automatically — you set the address in Settings.

**Canada (CASL)**: requires *prior consent* (express or implied). "Implied" includes existing business relationship or published business email — but "I scraped it from your website" is **not** implied consent, despite what cold-email Twitter says. Be careful with Canadian carriers; have a tighter qualification step or use referral-based outreach for Canada.

**EU (GDPR + ePrivacy)**: ePrivacy Directive (2002/58/EC) generally requires opt-in for unsolicited marketing email to individuals. Strict legal interpretation says cold B2B is also opt-in only in most member states (DE, FR, IT, NL). Practical posture: skip the EU for now, or only outreach to clearly business email addresses (`info@`, `sales@`) of B2B-only operations.

**California (CPRA)**: requires opt-out + Do Not Sell mechanism. Smartlead's footer covers this.

If you scale past ~10K monthly sends, get an actual lawyer for an hour ($300-500) to review your campaign + footers. Worth every penny vs. a $10K CAN-SPAM action.

---

## 7. UI — what to build (v1, ~2 days)

After this scaffolding, the admin Outreach page needs:

1. **Pipeline board** — Kanban columns by status, drag-and-drop, prospect count per column.
2. **Prospect detail** — full record + activity timeline + notes + "push to Smartlead" button.
3. **Campaign list** — sync with Smartlead, shows live stats, link to "view in Smartlead."
4. **CSV upload** — the simplest import path for v1.
5. **Webhook receiver** at `POST /api/admin/outreach/smartlead/webhook` — store events, update prospect status.

The scraper (Google Maps / FMCSA) is its own ~3 days of work, and is much better as a Python script you run locally than something baked into the SaaS app. Build a shared schema, use a separate command-line tool to populate it, push from the dashboard.

---

## 8. Cost estimate for first 6 months

| Item | Cost |
|---|---|
| Sending domain | $10/yr |
| Smartlead — Pro plan, 6K leads/mo | $39/mo |
| Apollo.io — Basic plan | $49/mo |
| Sending inboxes — 5× Google Workspace seats | 5 × $7/mo = $35/mo |
| Total first 6 months | ~$760 |

Versus a 6-week build of your own scraper + sender: ~$15K of your time and a guaranteed deliverability nightmare.

---

## 9. Don't do this

- Don't send from `quotefleet.app` or any subdomain that handles transactional mail.
- Don't try to process 1,000+ sends/day from a single inbox.
- Don't reuse "warmed" sending inboxes for new campaigns without re-warming.
- Don't ignore replies — Smartlead surfaces them; the AI assistant can draft responses but a human should review until you have ~50 sent replies of muscle memory.
- Don't scrape LinkedIn directly — they enforce hard.
- Don't buy lists from random Telegram sellers. They're 60% bounce rate, instantly nukes your domain reputation.
