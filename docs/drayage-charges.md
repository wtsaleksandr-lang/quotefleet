# Drayage charges, terminals, and the "which terminal?" UX problem

> **Purpose.** A practical reference for what gets charged on a drayage move, where the trucks actually pick up, and how to design a quote tool that handles the messy reality. Pairs with `rate-data-sources.md` (which covers $/mile benchmarks and fuel-index APIs).

> **Audience.** Engineers and product designers building QuoteFleet. Drayage carrier owners can read this too — there's nothing here you don't already know.

---

## 1. The mental model

Drayage is **short-haul container trucking** — moving an ocean container between a marine terminal (or rail ramp) and a shipper/consignee. Three things make it different from regular trucking, and every one of them affects the quote tool:

| Difference | Why it matters for the calculator |
|---|---|
| **Pickup happens at a terminal, not a warehouse.** | The pickup location isn't an address — it's a terminal name. There can be 5-15 terminals at a single port, and customers usually only know the *city*. |
| **Equipment is rented, not owned.** | Chassis fees, container per-diem, and reefer-genset costs accrue daily. The quote engine has to reason about *time* (free days, layover) not just distance. |
| **Almost every charge is conditional.** | Chassis split *only if* the chassis isn't on-site. Pre-pull *only if* the customer can't unload in 1 hour. Per-diem *only if* it doesn't return to the port in 4 days. The quote tool has to ask the right "do you need this?" questions without overwhelming the user. |

---

## 2. The full charge taxonomy

Numbers are 2025-2026 industry medians compiled from public carrier tariffs (LA/LB, NY/NJ, Houston, Savannah, Norfolk, Vancouver), DAT iQ, and FreightWaves. They are **defaults to ship with**; tenants will tune them through the AI agent.

### 2.1 Base linehaul (what's always there)

| Charge | Typical | Notes |
|---|---|---|
| Per-mile rate | $4.50-$5.50/mi for 20'/40' | Inflated vs. FTL ($2.55/mi) because of port wait time and yard time. |
| Minimum charge | $350-$450 | Even a 5-mile dray hits this floor. |
| Fuel surcharge | 18-22% of linehaul | Lower than FTL (15% vs 22-25%) because dray miles are short. |
| Margin | 10-15% on top | Carrier's profit; usually rolled into per-mile rate but exposed separately so the AI agent can adjust. |

### 2.2 Equipment / containers

| Charge | Typical | Trigger |
|---|---|---|
| **Chassis daily rental** | $25-$35/day | Always present unless trucker owns chassis. Most pools (TRAC, FlexiVan, DCLI) charge per day. |
| **Chassis split / pickup** | $150-$200 flat | Trucker has to detour to a chassis pool to grab a chassis before the box. Not always required (depends on port + steamship line). |
| **Triaxle** (Canada) | $200-$300 flat | Required when gross > 80,000 lbs. Most BC/QC moves with a 40' loaded heavy. |
| **Reefer / genset** | $75-$125/day | Refrigerated container needs a power unit. Per-diem clock starts at terminal pickup. |
| **20' container surcharge** | $50-$100 flat | Some carriers charge extra for 20s because chassis are scarcer. |
| **45' container surcharge** | $100-$150 flat | Even rarer chassis. |

### 2.3 Time-based (the silent revenue killers)

| Charge | Typical | Trigger |
|---|---|---|
| **Detention at customer** | $75/hr after 2 hr free | Driver waits at shipper/consignee. **Single biggest dispute** between carriers and shippers. |
| **Terminal wait time** | $75/hr after 1 hr free | Same idea but at the marine terminal. Free time is shorter because terminal turn times can blow out 4+ hours during congestion. |
| **Layover** | $250-$400/day | Driver held overnight (out-of-hours). |
| **Driver assist** | $100 flat | Driver helps load/unload. |
| **Per-diem** (container) | $50-$150/day | Steamship line charges shipper for keeping the container past 4 free days. **Pass-through** — carrier doesn't pocket this. |
| **Demurrage** (terminal) | $150-$250/day, escalating | Container sits at port past free time before it's picked up. **Pass-through.** Often higher than per-diem because terminals want the box gone. |
| **Pre-pull** | $150-$200 flat | Pull container from terminal to carrier yard *before* delivery date — usually to avoid demurrage when terminal is congested. |
| **Yard storage** | $50-$75/day | Container sits at carrier's own yard. |
| **TONU** (truck ordered, not used) | $200-$400 flat | Driver dispatched, load cancelled before pickup. |

### 2.4 Port / terminal pass-throughs

These are real fees the port or terminal charges; carrier collects and remits. Not negotiable, not profit.

| Charge | Where | Typical |
|---|---|---|
| **PierPass / TMF** | LA/LB | $35.50/TEU (off-peak gates, mandatory for daytime moves) |
| **Clean Truck Fee** (CTF) | LA/LB, Oakland | $10/TEU (older trucks pay surcharge or are barred) |
| **NY Cargo Facility Charge** | NY/NJ | $30-$50/container |
| **Lift fee** (rail ramp) | Chicago, Memphis, etc. | $35-$75/lift (varies BNSF / UP / CN / CSX / NS) |
| **Gate fee** | Many | $0-$25, often waived |
| **Empty return fee** | Various | $25-$75 when terminal restricts empty returns |
| **Bonded move surcharge** | Cross-border / in-bond | $50-$150 (TMX shows this in their UI) |
| **Liquor surcharge** (Canada) | LCBO/SAQ shipments | $100-$200 |
| **Hazmat surcharge** | All ports | 15-25% of base (or flat $250-$500) |

### 2.5 Last-mile / delivery accessorials

| Charge | Typical | Trigger |
|---|---|---|
| **Residential delivery** | $85 flat | Auto-add when delivery is residential. |
| **Liftgate** (LTL only) | $95 flat | Driver-side liftgate to roll pallets off. |
| **Inside delivery** | $125 flat | Driver carries freight inside the building (vs. curb). |
| **Appointment delivery** | $50 flat | Receiver requires scheduled time slot. |
| **Drop & hook** | $150 flat | Live-load impossible — drop trailer, hook another. |
| **Extra stop** | $75 flat | Per additional pickup or delivery. |
| **Re-delivery** | $200-$300 flat | Receiver wasn't ready, second attempt. |

### 2.6 Permits / overweight

| Charge | Typical | Trigger |
|---|---|---|
| **Overweight permit** | $175-$300 flat | Gross > 44,000 lb cargo or 80,000 lb total. State-issued per move. Some states (PA, NJ, NY, IL) are stricter. |
| **Hazmat tier escalation** | +$100-$300 | Class 1/3/7 (explosives, flammable, radioactive) costs more than Class 8/9 (corrosive/misc). |
| **TWIC requirement** | $0 (just dispatcher constraint) | Doesn't change price but affects driver pool. |
| **Scale fee** | $15-$25 flat | Drive-on CAT scale weight ticket. |

---

## 3. The terminal landscape (where the trucks actually pick up)

Customers say "Long Beach" or "Chicago" or "Newark." There are 5-15 terminals at each. **The terminal determines:** chassis pool availability, gate hours, pier-pass requirement, lift fee at rail ramps, and 20-50% of total drayage cost variance on the same lane.

### 3.1 Major US ocean terminals

#### Port of Los Angeles / Long Beach (12 marine terminals)
The largest container complex in North America. Steamship line maps to terminal — given the booking, you can derive the terminal.

- **POLA**: APM (Pier 400), Fenix Marine (Pier 300), TraPac, WBCT, YTI, Everport
- **POLB**: SSA Marine Pier A/J, ITS, LBCT, PCT, TTI, PMS

Notable: PierPass / TMF applies port-wide. Chassis pool is the LA/LB Pool (DCLI/Flexi/TRAC).

#### Port of NY/NJ (6 marine terminals)
- **NJ**: APM Elizabeth, Maher Terminals (Elizabeth), Port Newark Container Terminal (PNCT), GCT Bayonne
- **NY**: GCT New York (Staten Island), Red Hook (Brooklyn — smaller, mostly project cargo)

Notable: NY/NJ Cargo Facility Charge applies. Chassis pool is the M&R Pool (Direct ChassisLink).

#### Port of Savannah (1 main: Garden City Terminal)
GCT is the largest single-terminal complex in North America. Massive capacity, simpler routing because it's effectively one terminal. Plus Ocean Terminal (mostly project cargo, RoRo).

#### Port of Charleston (3 terminals)
Hugh K. Leatherman Terminal (newest, post-2021), Wando Welch Terminal, North Charleston Terminal.

#### Port of Norfolk / Hampton Roads (3 main)
Virginia International Gateway (VIG), Norfolk International Terminals (NIT), Portsmouth Marine Terminal. Plus Newport News for breakbulk.

#### Port of Houston (2 main)
Bayport Container Terminal, Barbours Cut Container Terminal. Roughly even split by volume.

#### Port of Oakland (4 main)
Oakland International Container Terminal (OICT, the big one — SSA), TraPac, Ben E. Nutter Terminal, Outer Harbor Terminal.

#### Port of Seattle / Tacoma (NWSA — Northwest Seaport Alliance)
Two ports operated jointly. Terminals: T-5 Seattle (SSA), T-18 Seattle, T-30 Seattle, Husky Tacoma (SSA), Washington United Terminals (Tacoma), Pierce County Terminal (Tacoma).

#### Other notable: Baltimore (Seagirt), Jacksonville (Blount Island, Dames Point), Miami (POMTOC, SFCT), New Orleans (Napoleon Avenue Terminal), Mobile (APM Mobile).

### 3.2 Major Canadian ocean terminals

- **Vancouver / Lower Mainland**: DP World Centerm, GCT Deltaport, GCT Vanterm, Fraser Surrey Docks. Triaxle requirement common.
- **Prince Rupert**: Fairview Container Terminal (single terminal, deep-water, rail-served — short dwell).
- **Montreal**: Termont (Cast/Maisonneuve), Racine, Bickerdike. Bilingual operations; bonded moves common to Ontario.
- **Halifax**: PSA Halifax (Halterm), Cerescorp (Fairview Cove).

### 3.3 Major US inland intermodal ramps (not ocean — but drayage from rail)

This is where the customer-doesn't-know-which-terminal problem is **worst**. Chicago alone has 15+ active container ramps:

#### Chicago (15+ ramps across 4 railroads)
- **BNSF**: Logistics Park Chicago (Joliet/Elwood), Cicero, Corwith, Willow Springs
- **UP**: Global I, Global II, Global III, Global IV (Joliet), G3 (Rochelle), Yard Center (Dolton)
- **CN**: Harvey, Joliet (Markham), Memphis Junction
- **CSX**: Bedford Park, 59th St
- **NS**: Landers, 47th St, 63rd St, Calumet

#### Other major inland ramps
- **Memphis**: BNSF, NS, CN
- **Dallas/Fort Worth**: BNSF Alliance, UP Mesquite
- **Kansas City**: BNSF Argentine, NS Voltz
- **Atlanta**: NS Inman/Whitaker, CSX Hulsey, NS Austell
- **Detroit**: NS Townsend, CSX Junction Yard, CN Moterm
- **Columbus / Cincinnati / Indianapolis / Cleveland / St. Louis**: each have 2-4 ramps
- **Twin Cities**: BNSF, CP

**Rule of thumb in the calculator UX:** if the user types "Chicago" in pickup, ask which railroad first (4 options), then which ramp under that railroad. If they don't know the railroad either, fall back to "look it up from booking number" (see §5).

---

## 4. Information sources customers actually have

When a shipper or freight forwarder asks for a drayage quote, what do they have on their desk? In rough order of how often it's available:

| Source | Has terminal info? | Typical when |
|---|---|---|
| **Booking confirmation** (from steamship line) | **Yes**, often. The booking confirmation usually names the loading terminal for export and discharge terminal for import. | They've already booked the ocean leg. |
| **Bill of Lading (B/L) / Sea Waybill** | **Yes** for import. Lists discharge port + sometimes terminal. | After ETA. |
| **Container tracking page** (steamship line website) | Yes, sometimes. CMA CGM, Maersk, Hapag-Lloyd, MSC, ONE all show "discharged at <terminal>" once it lands. | After vessel arrival. |
| **Freight forwarder's quote** | Sometimes. | Forwarder has done the legwork. |
| **Their own logistics dept** | Sometimes. They might just say "Chicago" and not know more. | Casual inquiry / ballpark. |

Implication for the UX: **the booking number / B/L number is the magic key**. If the user has it, we can either parse the terminal from it (hard — see §5) or simply *capture* it and show the quote with a "we'll confirm the exact terminal once we have the booking" caveat.

---

## 5. The "I don't know which terminal" UX problem

The user flagged this in the demo screenshot:

> "Clients often don't know exactly which terminal, they can only say its coming from the Chicago terminal or the NY terminal."

There are four UX patterns I considered, ranked by what to actually ship:

### Pattern A — Optional terminal field with smart default (RECOMMENDED for MVP)

1. User picks **port / city** (the easy part — autocomplete from `ports` table).
2. Show a **terminal dropdown** populated from terminals the carrier has configured for that port. **First option is always "I don't know yet"**, second is "Use port average," then specific terminals.
3. If the carrier has set per-terminal surcharges, those apply when a specific terminal is picked. Otherwise, the port-level lane zone applies.
4. Capture an **optional "Booking # / B/L"** field. We don't parse it — we save it on the lead so the carrier's dispatcher can verify the terminal when they confirm the rate. The widget shows: *"Final price subject to terminal confirmation if not specified above."*

**Why this wins for MVP:** zero parsing dependencies, customer is never blocked, carrier gets the info needed to firm up the quote.

### Pattern B — Booking number → terminal lookup via carrier APIs

Steamship lines (Maersk, MSC, CMA CGM, Hapag-Lloyd, ONE, Evergreen, Yang Ming, ZIM, COSCO/OOCL) each have tracking pages. Some have OAuth APIs; most don't.

- **Maersk**: Track & Trace API — free tier exists, requires registered API key.
- **Hapag-Lloyd**: API Hub — limited free tier.
- **CMA CGM**: API portal — paid only.
- **MSC, ONE, Evergreen, others**: web tracking only, no public API.
- **Aggregators**: project44, FourKites, terminal49, eModal — all paid, $$$$.

**Why this is wrong for MVP:** 6+ weeks of integration work, ongoing maintenance as carriers change auth, only covers ~70% of bookings, and it's not even what the customer wants — they want a price *now*, not a chat with their carrier's API. Pattern A (capture, don't parse) does 95% of the value at 1% of the cost.

### Pattern C — "Chat with AI dispatcher" path

Let the AI dispatcher (which the product already has) handle ambiguous terminals. User says "Chicago, BNSF" and AI goes "BNSF Logistics Park or Corwith?" If user says "Joliet" → LPC. If user says "I don't know" → AI quotes the port-average rate and notes the terminal will be verified.

This is a great **fallback** when Pattern A hits "I don't know" — but not a replacement for the structured form. Carriers want structured data on their leads, not free-text chat.

### Pattern D — Port average pricing only (skip terminals entirely)

What the current code already does (just `lane_zones` with port code, no terminal). Loses 10-30% accuracy on cost (some terminals are way more expensive than others — APM Pier 400 vs. WBCT can be $150 different). Loses tenant flexibility. **Don't recommend.**

### Recommendation

Ship Pattern A in the widget redesign. Add:
- `terminals` table (tenant-scoped; list of terminals the carrier serves at each port, with optional surcharge)
- Optional terminal dropdown in the widget after port selection
- Optional booking # / B/L field captured on the lead
- "Subject to terminal confirmation" copy when the user picks "I don't know"

Pattern B and C can come later as Pro-tier features. Pattern D is what we're moving away from.

---

## 6. UI pattern study — what the comparators do

The user shared three reference UIs:

### TMX (the "outdated and ugly" one)
- **Good**: explicit terminal picker (radio list of 12 ports). User knows what they're picking.
- **Bad**: looks like a 2008 form. No autocomplete. Email field is buried at the top. No live preview of the price as you fill the form. Two-column layout with empty right pane.
- **Steal**: the explicit terminal radio list is honest about there being multiple terminals. Worth considering for "advanced mode."

### DrayMaster (the "better but overcomplicated" one)
- **Good**: clean filter UX (steamship line dropdown, container size buttons, switches for Hazmat/Overweight/Reefer). "Find Rates" button means quote is async, which is fine for drayage where every move is unique. Terminal-by-radius filter ("Terminals within X miles") is clever.
- **Bad**: full-page UI with sidebar navigation makes it feel like a CRM, not a quote calculator. Too many fields visible at once. "Filter by Pickup Terminal(s)" multi-select before they've picked the location is confusing.
- **Steal**: container size as buttons (not dropdown), hazmat/overweight/reefer as toggle switches (compact), steamship line dropdown.

### Current QuoteFleet widget (in the screenshot)
- **Good**: clean, minimal, mobile-friendly, single-column. Service tabs at top are clear.
- **Bad**: pickup/delivery are just ZIP/city — no terminal logic. Drayage tab shows the same form as truckload, which loses 30% of the relevant questions (terminal, steamship line, container size already selected via equipment).
- **Improve**: when service = drayage, swap the pickup field for a port + terminal selector. Keep delivery as ZIP/city. Add an optional "booking # / B/L" field.

### The middle spot

Single-column form (current QF), with **service-aware fields** (different inputs for drayage vs. truckload), borrowed compact controls from DrayMaster (toggles + buttons not dropdowns), and explicit terminal selection from TMX (but one autocomplete instead of a 12-row radio list).

---

## 7. Implementation checklist (what code needs to change)

For the widget redesign:

1. **Schema**: add a `terminals` table (`tenantId`, `portCode`, `code`, `name`, `address`, `lat`, `lng`, `surcharge`, `notes`, `enabled`, `sortOrder`). Tenant-scoped because carriers vary in which terminals they serve.
2. **Schema**: extend `leads` with `pickupTerminalCode`, `deliveryTerminalCode`, `oceanCarrier`, `bookingNumber`, `billOfLadingNumber` (all optional, all text).
3. **Defaults**: seed each tenant with the standard terminal list for their declared `countryFocus` (US-default = top-15 marine terminals; Canada-default = top-8). Carrier disables ones they don't serve.
4. **Widget UX**:
   - When `service === 'drayage'`, show a "Pickup port" autocomplete (queries `ports` table) instead of the generic ZIP field.
   - When a port is selected, show a "Terminal" dropdown of that port's tenant-enabled terminals + "I don't know yet."
   - Add a collapsed "Booking details (optional)" section: ocean carrier select + booking # text field.
   - Show terminal-specific surcharge in the breakdown if a specific terminal was picked.
   - When "I don't know yet" is selected, show italic text in the breakdown: *"Subject to terminal confirmation."*
5. **Calculator engine**: lookup terminal surcharge by `(tenantId, portCode, terminalCode)` and add as a line item if present.
6. **Public API**: extend `/api/public/widget/:slug` to return `terminalsByPort` keyed by portCode → terminals[]. Extend the quote/lead endpoints to accept the new optional fields.
7. **Lead inbox**: surface ocean carrier, booking #, and terminal so the dispatcher knows what to verify.

---

## 8. Pricing reality check

When a tenant signs up, the seeded numbers should produce a quote within ±15% of what a real customer would pay on that lane today. Spot-check using DAT iQ's drayage benchmark:

- **POLA → Pomona, CA (35 mi)**, 40' import: market median $585, range $475-$725. Our default tariff (`USLAX` 30-60 mi ring): $575. ✓
- **NY/NJ Elizabeth → Edison, NJ (15 mi)**, 40' import: market median $510, range $425-$650. Our default (`USNYC` 0-30 mi): $525. ✓
- **Vancouver Centerm → Surrey, BC (25 mi)**, 40' import: market median CAD $545, range $475-$650. Our default (`CAVAN` 0-30 mi): $525 USD ≈ CAD $720. ⚠ **High by ~30% — needs revisit**, BC pool chassis fees were dropped in late 2025.

The Vancouver number above is the kind of seeded-default drift that the AI rate-tuning agent is supposed to catch and let the carrier fix in 30 seconds of chat.

---

## 9. What this doc deliberately doesn't cover

- **LCL ocean rates** — separate product (volumetric, weight-vs-cube, palletized fees). QuoteFleet is FCL-drayage-only.
- **Last-mile parcel** — UPS / FedEx / regional carriers. Different game entirely.
- **Specialty drayage** (oversize/RoRo/reefer-with-genset-power) — covered partially via `accessorials` but real specialty needs custom quoting that shouldn't go through the public widget.
- **Cross-border in-bond logistics** — bonded moves get a flat surcharge in the accessorials but customs filing isn't part of the quote.
- **Live rates from DAT iQ / Project44** — paid feeds that we can integrate later as a "live calibration" feature for Pro tier.
