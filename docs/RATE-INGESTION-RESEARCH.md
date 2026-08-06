# How trucking companies handle rates — reference for the AI rate-sheet parser

Consolidated from primary-source research (2026-08). Purpose: give QuoteFleet's AI ingestion
the domain knowledge to comprehend and normalize **any** carrier/broker rate document. Specific
dollar figures are 2025–2026 market snapshots (illustrative, not authoritative); the **structures,
formulas, notations, and quirks** are durable.

---

## 1. The rate universe (modes & how the base is priced)

| Mode | Base pricing | Key variables |
|---|---|---|
| **FTL (truckload)** | per-mile RPM **or** flat lane rate **or** zone matrix; `min charge` floor | miles, equipment, lane/direction, all-in vs linehaul+FSC |
| **LTL** | `(weight/100) × CWT_rate[class][weight-break][zone]`, then discount-off-base, then min charge (AMC) | freight class (density), weight break, zip3 zone, discount%, FAK |
| **Drayage** | per-**container** rate by distance-band **or** named-zone matrix | container size (20/40/40HC/45/reefer), zone, free-time accessorials |
| **Intermodal** | origin dray + rail linehaul (by lane/rail group) + dest dray, each + FSC | ramp lane, rail carrier group, container |
| **Specialized** (flatbed/oversize/reefer/expedited) | per-mile linehaul + surcharge stack | tarping, per-state permits/escorts, temp class, team premium |

### The #1 ambiguity: **all-in vs linehaul + separate FSC**
A bare "$2.45/mi" or "$1,850" is meaningless without knowing if fuel is included.
- Spot/rate-con sheets → usually **all-in** (one number, no FSC line). Never re-apply FSC.
- Contract sheets with an FSC%/FSC column → **linehaul-only**; add FSC separately.
- Tokens to detect: "all-in", "FSC included", "incl fuel" → included. A separate `Linehaul` + `FSC%` column → linehaul-only.

---

## 2. FTL specifics

- **Total** = `max( RPM×miles + FSC + Σaccessorials , min_charge )`.
- **Min charge overrides** the per-mile math on short hauls — always compute the max.
- **Mileage basis varies**: PC*MILER Practical (longest) vs Shortest vs HHG/short (5–12% fewer miles) vs Google. Same RPM → materially different totals. Flag when the basis is unstated.
- **Equipment differentials** (spot $/mi drift): dry van baseline; reefer +premium (fresh 32–36°F often > frozen; washout $50–80); flatbed + tarp $75–150, oversize; step-deck/RGN/oversize $3.50–10+/mi with permits/escorts; power-only premium.
- **Equipment aliases to normalize**: DV/V/Van; R/RF/Reefer; F/FB/FD/Flatbed; SD/Step-deck; DD/Double-drop; RGN; PO/Power-only; HC=high-cube; O/D=over-dimensional.
- **Geography granularity**: city / zip5 / zip3 / KMA (135–149 metro market clusters, cross state lines) / named zone. Zone↔zip legends are often a separate tab that must be joined.
- Directionality: A→B ≠ B→A (matrices may be asymmetric).

---

## 3. LTL specifics

### Freight class (18 discrete values — never round)
`50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500`.
Class 77.5 and 92.5 are real — do not collapse to 75/90.

Set by 4 factors: **density (dominant), handling, stowability, liability.**

**Density → class** (`density = weight_lbs / (L×W×H_in / 1728)`; read ranges as `≥low, <high`):

| PCF (lb/ft³) | Class | PCF | Class | PCF | Class |
|---|---|---|---|---|---|
| ≥50 | 50 | 12–13.5 | 85 | 5–6 | 175 |
| 35–50 | 55 | 10.5–12 | 92.5 | 4–5 | 200 |
| 30–35 | 60 | 9–10.5 | 100 | 3–4 | 250 |
| 22.5–30 | 65 | 8–9 | 110 | 2–3 | 300 |
| 15–22.5 | 70 | 7–8 | 125 | 1–2 | 400 |
| 13.5–15 | 77.5 | 6–7 | 150 | <1 | 500 |

*(2025 NMFC restructure moved many commodities to purely density-based classes; treat density-derived class as increasingly authoritative, legacy per-commodity classes as possibly stale — flag by NMFC edition/date.)*

### Weight-break notation (CWT grid column headers)
`C` = 100 lb (centum), `M` = 1,000 lb (mille), `L` prefix = "less than". Each break is a **range floor** `[break, next)`:
- `MIN`/`AMC` = absolute minimum charge (flat floor). `L5C` = <500 lb (highest $/CWT). `5C`/`M5C` = 500–999. `1M`/`M1M` = 1,000–1,999. `2M` = 2,000–4,999. `5M` = 5,000–9,999. `10M` = 10,000–19,999. `20M`+ = volume/TL-ish.
- $/CWT **falls** left→right as weight rises.

### The LTL waterfall (order matters)
```
1. class      ← density table OR FAK agreement
2. CWT rate   ← grid[class][weight-break][zone]
3. linehaul   = (weight/100) × CWT_rate           ("as rated")
4. discount   = linehaul × (1 − discount%)         (discount off the BASE tariff)
5. FSC        + (discounted linehaul × FSC%)        typically 25–35%
6. accessorials
7. floor      = max(total, AMC)
```
- **Discount-off-which-base** is load-bearing: "70% off CzarLite XL" vs "70% off carrier base 2000" differ ~2×. Capture *(base tariff name/edition + discount%)* as a pair; ideally normalize to net $/CWT.
- **FAK** (freight-all-kinds): "classes 70–125 all rate as 85" — lives in a rules note, overrides the density class for rating (but actual class still governs linear-foot/liability rules; store both).
- **Weight bumping / deficit rating**: a 480-lb shipment may bill as 500 lb if the lower break's rate is cheaper — bill the cheaper of the two.
- **Linear-foot rule**: >12 linear ft (carrier-specific 10–15 ft) → rerate at 1,000 lb/linear-ft. **Cubic-capacity**: >750 ft³ & <6 PCF → rerate whole volume at 6 lb/ft³.

---

## 4. Drayage / intermodal / specialized

- **Drayage base**: per-container, by **distance band** (0–25/25–50/50–100/100+ mi) OR **named-zone matrix** (port → dest zip/zone → per-container $), columns often 20'/40'/40HC/45'/reefer. FSC stated once as % (35–55%) applied to every cell.
- ⚠️ Numeric columns aren't always container sizes — may be **rail-carrier groups** (NS/UP, CSX/KCS, BNSF) or destinations. Verify header semantics.
- **Free-time / time-based accessorials** (must pair charge with its free threshold + tier bands):
  - Demurrage: per day, **tiered** (day 1–4 / 5–7 / 8+), free 4–7 days from discharge.
  - Per diem (container): per day, free 4–5 days to return empty.
  - Driver detention: per hour, free 1–2 hr each end.
  - Chassis: rental per-day × days-out **and** split/flip per-occurrence **and** tri-axle upcharge — three separate charges.
- **Intermodal** = origin-dray(+FSC) + rail-linehaul-by-lane(+FSC) + dest-dray(+FSC); apply the three FSCs separately.
- **Specialized**: flatbed per-mile + tarp + securement; oversize = **per-state** permit (base + per-mile + per-foot-over) stacked across each state crossed, + escorts (per-mile or per-day) + superload; reefer = per-mile premium driven by temp class/mode + precool/washout/genset; expedited/hotshot tiered per-mile + team premium, deadhead-adjusted floor + minimum.

---

## 5. Fuel surcharge (4 forms to detect)

1. **Per-mile cpm scale** (FTL): `FSC$/mi = (diesel − base_peg) ÷ mpg`; base peg $1.20–1.50 (legacy) or $2.50–3.50 (recent); mpg ~6.0–6.5. Usually printed as a **$0.05/gal-band step table** (diesel range → cpm). ⚠️ Published table cpm often bakes in rounding/margin (may exceed the raw formula) — trust the table's value.
2. **Percentage-of-linehaul table** (LTL/brokered): diesel band → % applied to **net linehaul only** (after discount, never on accessorials or the invoice total). LTL commonly 25–35%.
3. **Fixed cpm or fixed %** stated flat on a rate con — a snapshot, not a live scale.
4. **All-in / "FSC included"** — no line; never re-apply.

Pegged to EIA weekly U.S. On-Highway Diesel (published Mon, applied Tue/Wed, 7–10 day lag). Some carriers use a **PADD/regional** or proprietary index — capture the index name; values won't reconcile across indices. Reefer +$0.08–0.15/mi and team +$0.30–0.50/mi ride **on top**.

---

## 6. Accessorial catalog (name | basis | typical | free-time/conditions)

| Accessorial | Basis | Typical | Free-time / condition |
|---|---|---|---|
| Detention | per hour | $50–100 (reefer/dray higher) | **2 hr free** per stop (dray 1 hr); define clock-start |
| Layover | per day | $200–500 | after a missed scheduled day |
| TONU | flat | $150–350 | canceled after cutoff |
| Lumper | per job (pass-through) | $25–500 | receipt |
| Liftgate | flat (LTL per cwt) | $30–175 ($5–11/cwt, $100–150 min) | no dock |
| Residential | flat | $75–200 | non-commercial |
| Limited access | flat | $100–300 | school/mil/construction/farm |
| Inside delivery | flat | $50–300 | past threshold |
| Appointment/notify | flat | $10–75 | must schedule |
| Redelivery | flat | up to $400–500 | failed first attempt |
| Reweigh/reclass (LTL) | flat | $25–150 | wrong weight/class → re-rate |
| Sort & segregate | per piece/cwt | $1–5 | sorted at delivery |
| Stop-off | per stop | $50–150 | beyond 1 pick + 1 drop |
| Oversize/overlength | flat/bracket | $75–800+ | ≥8–12 ft LTL trigger |
| Overweight | per cwt/flat | varies | axle/legal limit |
| Hazmat | flat | $50–400 | endorsement/placard |
| Tarping | per load | $50–150+ | flatbed |
| Team service | per-mile | +$0.30–0.50/mi | 2-driver |
| Storage | per day | $110–330 | held |
| Chassis rental | per day | $35–75 | intermodal |
| Chassis split/flip | flat | $50–110 | container+chassis separate |
| Pre-pull | flat | ~$150 | early pull |
| Congestion / PierPass/TMF | per container / per TEU | $35–300 | 40'=2×20' for TMF |
| Demurrage / per-diem | per day, tiered | $100–500 | free-time table |

⚠️ Don't default everything to flat. Detention/driver-assist = per hour; liftgate/sort = often per cwt; TONU/layover/residential = flat; stop-off = per stop; out-of-route = per mile; demurrage/per-diem/storage/chassis = per day. Many appear as **conditional footnotes** ("$50/hr IF detained") excluded from the quoted total — flag conditional, don't sum into base.

---

## 7. The 8 document structural patterns (classify **per tab/section**, not per file)

1. **Origin×Destination MATRIX** — rows=origin, cols=dest, cell=rate; diagonal blank/`—`; may be asymmetric; unit stated once in title; zip3 variant is 900×900.
2. **Lane / zip-to-zip LIST** — one row per lane (origin, dest, miles, equip, rate, rpm, min, notes). The friendly target shape.
3. **Zone tables (two-part join)** — Tab A: zip3→zone definitions (From/To bands); Tab B: zone×zone rate grid. Two-hop lookup.
4. **LTL class×weight-break GRID** — rows=class, cols=weight breaks (L5C…M20M), cell=$/CWT; AMC in a corner; discount+FAK in separate notes.
5. **Drayage port→zone per-container MATRIX** — rows=dest zip/zone/city, cols=container size, FSC% in header.
6. **Accessorial / FSC schedule** — sidecar list (menu key/value, or banded FSC step-table) attached to every lane; rarely inline.
7. **Rate confirmation (rate con)** — a FORM, one load: load ID/MC/contacts/commodity/weight/equip → route/schedule/appt → rate/payment (linehaul, FSC flat-or-%, terms) → dispute clauses (detention def, lumper, TONU).
8. **"Rate card" price list** (email/PDF) — semi-structured lanes, mixed units in adjacent rows ("$1,850 all-in" vs "$1.95/mi" vs "650 flat"), equipment/terms in free text, effective window implied.

### Messiness quirks (ranked)
multi-tab meaning-split (join required) · merged cells + multi-row headers · units embedded in titles (stated once) · min charge hiding in a corner · abbreviations/equipment codes · FSC as a step-function not a number · mixed modes/units in one file · discount+base-tariff indirection · inconsistent zip formats (leading-zeros dropped by Excel, zip3 vs zip5, zone IDs) · totals/spacer/footnote rows inside the data · conditional rules as free-text footnotes · USD vs CAD ambiguity · effective/expiration dating (title/filename/implied) · scanned/image PDFs needing OCR + rotation.

---

## 8. Canonical normal form (what everything maps INTO)

One **rate record** per priced lane/cell, with FSC + accessorial + FAK sidecars keyed back to it. Always carry `unit_basis`, `currency`, `effective_date`, `source_ref` (file+tab+cell for audit) even when the file states them once.

Core fields: `origin` / `dest` (raw + resolved zip5/zip3/city+state/zone_id), `mode`, `equipment`, `service_level`, `weight_break_min/max`, `class`, `container_size`, `unit_basis` (flat/per_mile/per_cwt/per_container/per_hour/per_day/percent), `rate`, `min_charge`, `discount_pct`, `fsc` (ref/flat), `accessorials[]` (ref), `miles`, `effective_date`/`expiration_date`, `currency`, `source_ref`, `conditions[]`.

Design rules for the parser: (1) classify per tab/section into one of the 8 patterns before extracting; (2) always carry unit_basis + currency + effective_date; (3) resolve joins (zone defs, FSC bands, discounts) rather than flattening; (4) preserve source_ref provenance; (5) never silently drop a concept the engine can't yet price — extract it, map to the closest supported shape, and **warn**.

---

## 9. Parser decision rules (the durable "gotchas" as checks)

1. Detect all-in vs linehaul+FSC before any FSC math; "all-in"/"FSC included" → never re-apply FSC.
2. Always apply `max(computed, min_charge/AMC)`.
3. % vs cpm are different modes — % multiplies linehaul, cpm multiplies miles; never cross them; a doc can have both columns.
4. FSC applies to (net, post-discount) linehaul only — not accessorials, not the total.
5. Weight-break codes are range floors `[break, next)`, Roman shorthand (L5C/5C/1M/2M/5M/10M), not decimals.
6. LTL discount is off a *named base tariff* — capture (base + discount%) together.
7. Class has 18 discrete values incl. 77.5 & 92.5 — never round.
8. Accessorial basis varies (hour/day/cwt/stop/mile/flat) + free-time thresholds are load-bearing.
9. Zone matrices need the zip→zone legend joined; numeric columns may be carrier-groups not sizes.
10. Normalize zip formats (restore dropped leading zeros), equipment aliases, USD/CAD, effective dates.
11. Mixed modes/units can coexist in one file — classify per section/row.
12. Skip out-of-scope (ocean, customs, brokerage %) with a "skipped:" warning.
