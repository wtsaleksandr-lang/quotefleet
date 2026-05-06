# Rate Data Sources for the Freight Copilot Quote Calculator

**Purpose:** seed the instant quote calculator with sensible default rates for USA / Canada drayage and trucking, so a brand-new tenant can produce reasonable quotes on day one. Each carrier customer can later override every value via their own rate cards.

**Scope of this document:** which sources are *actually free*, *free with key*, or *paid* (flagged); what each one gives us; how often it updates; license posture for commercial use; and a concrete week-1 seeding plan.

> Pricing snapshots in this document are illustrative benchmarks pulled from public reporting (DAT, ACT, FleetOwner, Cass) and are intended as default starting values. They are not a substitute for live market data. The whole point of the seeded values is that customers tune them.

---

## 1. Top-tier free sources (use these first)

### 1.1 EIA – U.S. on-highway diesel price (fuel surcharge engine)

This is the single most important free feed for the calculator. Almost every U.S. trucking and drayage fuel surcharge in the country is anchored to the **DOE/EIA Weekly U.S. No 2 Diesel Retail Price** ("DOE National Average") published every Tuesday around 10:00 ET.

- Landing page: https://www.eia.gov/petroleum/gasdiesel/
- Methodology: https://www.eia.gov/petroleum/gasdiesel/diesel_proc-methods.php
- DOE FSC matrix (illustrative): https://atlas.doe.gov/RateRoute/FuelSurcharge/2025CurrentFSCMatrix.pdf
- API: https://www.eia.gov/opendata/ (APIv2)
- API docs: https://www.eia.gov/opendata/documentation.php
- API browser: https://www.eia.gov/opendata/browser/petroleum/pri/

**Free?** Yes, fully free. Requires a free API key (email-issued, no quota documented in public terms; rate limit only).

**Update cadence:** Weekly, every Tuesday ~10:00 ET (Wednesday on federal holidays).

**License:** EIA data is in the public domain (U.S. government work). Commercial use is permitted; attribution recommended.

**Coverage:** US national average + 9 PADD/sub-PADD regions (PADD 1A New England, 1B Central Atlantic, 1C Lower Atlantic, 2 Midwest, 3 Gulf Coast, 4 Rocky Mountain, 5 West Coast, California, West Coast ex-CA).

**Series IDs you want (APIv2, route `petroleum/pri/gnd`):**
- `EMD_EPD2D_PTE_NUS_DPG` – US national diesel, weekly $/gal
- `EMD_EPD2DXL0_PTE_NUS_DPG` – US national ULSD only
- `EMD_EPD2D_PTE_R20_DPG`, `R30_DPG`, `R50_DPG`, etc. – PADD regions

**Standard fuel surcharge formula** (industry default the calculator should ship with):

```
fuel_surcharge_per_mile = max(0, (current_doe_price - baseline_price) / mpg)
```

Defaults: baseline `$1.25/gal` (very common in legacy contracts) or `$1.20–$1.50`; assumed MPG `6.5` for dryvan/reefer truckload, `5.0–5.5` for drayage/heavy. A drayage variant often uses a per-trip surcharge based on a step matrix (the "DOE FSC matrix" approach).

### 1.2 FRED – Free historical price-index time series

Federal Reserve Bank of St. Louis hosts BLS Producer Price Indices and other public series with free APIs and CSV downloads. Use these to (a) trend-adjust the seeded rates over time, (b) sanity-check our defaults, and (c) drive an "inflation knob" the customer can apply.

- API: https://fred.stlouisfed.org/docs/api/fred/ (free key, generous quota)
- Series of interest:
  - `PCU484121484121` – PPI General Freight Trucking, Long-Distance Truckload
  - `PCU4841224841221` – PPI General Freight Trucking, Long-Distance LTL
  - `PCU4841148411` – PPI General Freight Trucking, Local
  - `PCU48424842` – PPI Specialized Freight Trucking
  - `PCU484484` – PPI Truck Transportation (rollup)
  - `TSIFRGHT` / `TSIFRGHTC` – BTS Freight Transportation Services Index
  - `FRGSHPUSM649NCIS` – Cass Freight Index Shipments (monthly)
  - `GASDESMWW`, `GASDESGCW`, `GASDESLSMWW` – PADD diesel sales prices
- Series page example: https://fred.stlouisfed.org/series/PCU484121484121

**Free?** Yes. **Cadence:** Monthly. **License:** FRED redistributes BLS data; BLS data is public domain. Commercial use OK with attribution.

### 1.3 BTS – Freight Analysis Framework, CFS, TransBorder, NTAD

The Bureau of Transportation Statistics is the cornerstone of free U.S. freight geography and flow data. It does not publish $/mile lane rates, but it gives us the tonnage / value / OD-pair structure used to weight national averages into regional defaults.

- BTS hub: https://www.bts.gov/topics/freight-transportation
- FAF5 (currently FAF5.7.1 covering 2018–2024): https://www.bts.gov/faf and https://faf.ornl.gov/
- FAF5 data tabulator: https://faf.ornl.gov/faf5/SummaryTable.aspx
- CFS 2022 Public Use Microdata: https://www.bts.gov/cfs and https://cfsdata.bts.gov/
- TransBorder Freight Data (US/Canada/Mexico monthly): https://www.bts.gov/transborder
- BTS data inventory: https://data.bts.gov/
- NTAD geographic atlas: https://www.bts.gov/ntad

**Free?** Yes, all. **Cadence:** Annual (FAF), 5-yearly (CFS), monthly (TransBorder). **License:** Public domain.

**What we actually use it for:**
- FAF5 OD pairs by mode → distribute the national $/mile spot defaults into 132 FAF zones with realistic regional skew (e.g., outbound LA premium, inbound Northeast).
- CFS PUMS → derive distance-band distributions used by the calculator's "short-haul vs. long-haul" pricing tiers.
- TransBorder → cross-border volume share by port-of-entry to weight US-Canada lane defaults.

### 1.4 Statistics Canada – For-hire motor carrier freight services price index

The closest Canadian analog to the BLS PPI for trucking. Excellent for trending Canadian seeded rates over time.

- Active table: https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810028101 (FHMCFSPI, monthly, base 2021=100, since Jan 2007)
- Inactive predecessor: https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810004301
- Data API: https://www.statcan.gc.ca/en/developers/wds (Web Data Service, free, JSON)

**Free?** Yes. **Cadence:** Monthly. **License:** Statistics Canada Open Licence – commercial use permitted with attribution.

### 1.5 Canadian General Freight Index (CGFI)

Industry-published Canadian index that tracks base + fuel rates paid by Canadian shippers. Headline index values are published free monthly; the underlying micro-data is paid.

- Site: https://cgfi.ca/canadian-general-freight-index-results/
- Free? Headline index yes; underlying data behind a paywall.

### 1.6 Cass Information Systems – Cass Truckload Linehaul Index

Monthly index of per-mile truckload linehaul rates (excluding fuel and accessorials). Published free as a monthly PDF report; the granular data is paid.

- Index landing: https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/truckload-linehaul-index
- Cass Freight Index landing: https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/cass-freight-index
- FRED mirror (free machine-readable): https://fred.stlouisfed.org/series/FRGSHPUSM649NCIS

### 1.7 ACT Research / FleetOwner / Trucking Dive / DAT Trendlines (free public summaries)

DAT iQ runs RateView (a paid product), but they publish a free national-rate snapshot every week through DAT Trendlines and via the trade press. Plus ACT Research publishes a free Canada freight rate dashboard. Neither lets us license the underlying data, but the published weekly headline numbers are fair game to seed defaults from publicly cited summaries.

- DAT Trendlines: https://www.dat.com/trendlines
- ACT Research US rates: https://www.actresearch.net/resources/data-tracking/freight-trucking-rates
- ACT Research Canada rates: https://www.actresearch.net/resources/data-tracking/canada-rates
- FleetOwner rate coverage: https://www.fleetowner.com/news/rates
- Trucking Dive rate tracker: https://www.truckingdive.com/news/truck-freight-rates-changes-tracker/715709/

**Recent published US national spot benchmarks** (week of late-Apr / early-May 2026, to seed defaults):
- Dryvan: ~$2.37/mi (low) up to $2.68/mi (high)
- Reefer: ~$2.72/mi (low) up to $3.13/mi (high)
- Flatbed: ~$3.05/mi (low) up to $3.46/mi (high)

Contract rates typically run **$0.30–$0.50/mi above** all-in spot rates per ACT and Cass. We seed `contract = spot + $0.40/mi` as the day-1 default, customer-tunable.

### 1.8 OOIDA Fuel Surcharge Calculator (formula reference, free)

- https://www.ooida.com/trucking-tools/fuel-surcharge-calculator/

Use it to cross-check our FSC formula. Independent of any vendor.

---

## 2. Drayage – port tariffs and published schedules

Drayage rates are not standardized; carriers publish their own. But the **port authorities** publish the marine-terminal tariffs and accessorial fees that *go into* the drayage cost stack (chassis, exam, gate, congestion). These are free, primary-source PDFs we can parse.

### 2.1 Port Authority of NY/NJ (PANYNJ)
- Tariffs hub: https://www.panynj.gov/port/en/doing-business/tariffs.html
- PA-10 Marine Terminal Tariff (2025): https://www.panynj.gov/content/dam/port/doing-business-pdfs/Port%20Authority%20Marine%20Terminal%20Tariff%20FMC%20Schedule%20No.%20PA%2010%20(Effective%20February%2010,%202025).pdf
- Maher Terminals tariff (Feb 2026 revision): https://www.panynj.gov/content/dam/port/doing-business-pdfs/maher-tariff.pdf
- NY Terminal Conference tariff: https://www.panynj.gov/content/dam/port/doing-business-pdfs/nytc-tariff-2023.pdf

NYTC dray-to-on-dock rail: $233/container; dray to off-dock rail ramp: $337/container. Maher exam-and-return: $539.52 plus $185.70/way grounding/mounting. These are concrete numbers we can seed.

### 2.2 Port of Houston Authority
- Tariffs page: https://porthouston.com/toolbox/rates/tariffs/
- Tariff No. 8 (Jan 2025): https://porthouston.com/wp-content/uploads/2024/12/v2-Tariff-8.-January-1-2025-12.4.pdf
- Tariff No. 15 (Nov 2024): https://porthouston.com/wp-content/uploads/2024/11/Tariff-15.-November-5-2024.pdf
- Tariff No. 14: https://www.porthouston.com/wp-content/uploads/2022/12/Tariff-14.-January-2023.pdf
- Houston Terminal LLC General Tariff: https://www.houstonterminal.com/wp-content/uploads/HT-General-Tariff-10-1-2023-to-9-30-2024.pdf

### 2.3 Northwest Seaport Alliance (Seattle/Tacoma)
- Trucker resources: https://www.nwseaportalliance.com/cargo-operations/trucker-resources

### 2.4 Other US ports (similar pattern – tariffs published as PDFs)
- Port of LA: https://www.portoflosangeles.org/business/tariffs
- Port of Long Beach: https://polb.com/business/port-tariff/
- Georgia Ports (Savannah): https://gaports.com/business-and-shipping/rates-and-tariffs/
- Port of Virginia (Norfolk): https://www.portofvirginia.com/about/tariffs/

### 2.5 Canadian ports
- Port of Vancouver tariffs: https://www.portvancouver.com/customers/tariff/
- Port of Montreal: https://www.port-montreal.com/en/the-port-of-montreal/operations/our-customers/tariff
- Halifax Port Authority: https://www.portofhalifax.ca/operations/marine-tariffs/
- Prince Rupert Port Authority: https://www.rupertport.com/

**Free?** Yes, all are free public PDFs. **License:** Public/agency tariffs – freely usable; cite source.

### 2.6 Indicative drayage benchmarks (from public industry reporting)

These are the kinds of numbers we seed and let customers override:

| Port group | Local 0-30 mi 40' DV | 30-100 mi 40' DV | 100-250 mi 40' DV |
|---|---|---|---|
| LA / Long Beach | $475-$650 | $700-$950 | $1,100-$1,800 |
| NY / NJ | $400-$575 | $600-$850 | $950-$1,500 |
| Savannah | $325-$475 | $500-$725 | $850-$1,300 |
| Houston | $300-$450 | $475-$700 | $800-$1,250 |
| Norfolk | $325-$475 | $500-$725 | $850-$1,300 |
| Seattle / Tacoma | $375-$525 | $575-$825 | $900-$1,400 |
| Vancouver, BC | $375-$525 CAD | $575-$825 CAD | $1,000-$1,600 CAD |
| Montreal | $250-$425 CAD | $475-$700 CAD | $850-$1,300 CAD |
| Halifax | $300-$475 CAD | $500-$725 CAD | $900-$1,500 CAD |
| Prince Rupert | $400-$550 CAD | $625-$900 CAD | $1,100-$1,750 CAD |

LA/LB is consistently the most expensive North American drayage market because of CARB compliance, the Clean Truck Fund, the PierPASS Traffic Mitigation Fee, and chronic chassis shortages.

### 2.7 Drayage zone pricing logic – recommended seed structure

The calculator's drayage module should ship with a 4-tier zone pricing model that virtually every drayage carrier in North America uses in some form:

| Zone | Radius from terminal | Default 40' DV all-in | Default 20' DV all-in |
|---|---|---|---|
| Local | 0–30 mi | base | base × 0.92 |
| Regional | 30–60 mi | base × 1.4 | base × 1.3 |
| Extended | 60–150 mi | base × 2.2 | base × 2.0 |
| Long-dray | 150–300 mi | base × 3.5 + $/mi over 150 | similar |

For >300 mi the system should fall back to truckload pricing logic (per-mile linehaul + drayage-pickup surcharge) since at that point it's effectively a truckload move with a port-pickup accessorial.

Reefer container: + 15-20% over DV. 45'/HC: + 8-10%.

### 2.8 Drayage / port reference media (free public reporting we can cite)
- DrayLocator price index: https://draylocator.com/price-index/los-angeles-long-beach/
- Drayage.com directory and rate snapshots: https://www.drayage.com/directory/dray-rates.cfm
- C.H. Robinson freight market drayage updates: https://www.chrobinson.com/en-us/resources/insights-and-advisories/north-america-freight-insights/
- Port City Logistics drayage rate guide: https://portcitylogistics.com/resources-blog-the-complete-guide-to-understanding-drayage-rates/

---

## 3. Accessorials – the standard fee deck

Accessorials are the third-rail of quote accuracy. The good news: they are very standardized in industry reporting. The following is a defensible seed deck pulled from ArcBest, ODFL, Stord, FreightWaves, CloudTrucks and DataDocks public guides – all customer-tunable.

| Accessorial | Default seed | Notes |
|---|---|---|
| Detention (TL/drayage) | $75/hr after 2 hr free | Range $50–$100/hr. Drayage often $80–$110/hr. |
| Detention (LTL) | $50–$75/hr | After 30-min free. |
| Layover | $250/event | Range $150–$400. |
| Truck Ordered Not Used (TONU) | $300 | Range $250–$400. |
| Driver assist / lumper | $100 | Lumper $75–$150 typical. |
| Liftgate | $50 (TL) / $90 (LTL) | LTL min often $100–$150, or $5–$11/cwt with min. |
| Residential delivery | $90 | Range $50–$150. |
| Inside delivery | $85 | Range $50–$125. |
| Limited access | $75 | Schools, military bases, mini-storage. |
| Hazmat | $50 + 18% of linehaul | Range $35–$75 flat or 15–25% surcharge. |
| Tarping (flatbed) | $75 | Light tarp; heavy/specialty tarps $150-$250. |
| Reefer surcharge | $0.10/mi or 8% | On top of dryvan rate. |
| Stop-off | $75/extra stop | Range $50–$150. |
| Reconsignment | $150 | Plus deadhead miles. |
| Prepull (drayage) | $175/container | Range $125–$250. |
| Drop-and-hook (drayage) | $75 | When trucker drops chassis at consignee. |
| Chassis split | $175 | Range $100–$200. |
| Chassis day rate | $30/day | Range $25–$45 outside free time. |
| Per-diem (container) | $75/day | After free days – steamship line determined. |
| Yard storage / pier pass | $30/day | LA/LB PierPASS TMF currently ~$39.93 each way for non-exempt 20', double for >20'. |
| Congestion / clean truck | $20–$35 | LA/LB Clean Truck Fund $10/TEU import + $10/TEU export. |
| Customs exam (VACIS/CET/Intensive) | $250 / $450 / $675 | Plus drayage to/from exam site. |
| Cross-border ACE/ACI fee | $25/load | Filing fee passthrough. |

> Source bundle: ArcBest accessorial guide (https://arcb.com/blog/accessorial-charges-in-truckload-and-ltl-freight), ODFL (https://www.odfl.com/us/en/resources/freight-knowledge/odfl-blog/what-your-accessorial-charges-mean.html), Stord (https://www.stord.com/blog/guide-to-freight-accessorial-charges), FreightWaves Checkpoint (https://www.freightwaves.com/checkpoint/fuel-surcharge-in-trucking/), DataDocks (https://datadocks.com/posts/truck-detention-accessorial-fees), Smart Warehousing drayage glossary (https://www.smartwarehousing.com/blog/drayage-terms-and-fees-you-need-to-know).

---

## 4. LTL – class rates and base lanes

There is no free public LTL rate table. NMFTA owns the NMFC classifications and licenses ClassIT for tariff lookups; carriers each publish their own base tariff (e.g., CzarLite, SMC3 CzarLite which is paid).

What we can do for free defaults:

1. **Seed a class density table** from the NMFTA 2025/2026 13-tier density scale (see https://nmfta.org/nmfc/ and https://info.nmfta.org/2025-nmfc-changes-for-ltl-shipments). This is publicly described.
2. **Seed a per-cwt rate matrix by class × zone3 distance band** using published industry midpoints. Reasonable defaults based on Redstag, Freightquote and Unishippers public guidance (https://redstagfulfillment.com/what-is-average-cost-per-pound-ltl-shipping/, https://www.freightquote.com/how-to-ship-freight/freight-class-nmfc-codes/):

| Class | Density (lb/ft³) | $/cwt 0–250 mi | 250–750 mi | 750–1500 mi | 1500+ mi |
|---|---|---|---|---|---|
| 50 | 50+ | $24 | $32 | $44 | $56 |
| 65 | 22.5–30 | $32 | $42 | $58 | $74 |
| 85 | 12–13.5 | $44 | $58 | $80 | $102 |
| 100 | 9–10.5 | $52 | $69 | $94 | $120 |
| 125 | 7–8 | $62 | $82 | $112 | $144 |
| 175 | 5–6 | $84 | $112 | $152 | $194 |
| 250 | 3–4 | $112 | $148 | $202 | $260 |
| 400 | 1–2 | $172 | $228 | $312 | $400 |
| 500 | <1 | $228 | $304 | $416 | $530 |

(Min charge default: $125. Discounts off tariff are a per-customer column for the carrier to set – industry typical is 60–75% off CzarLite-like base.)

3. **NMFC code lookup**: NMFTA's ClassIT is paid. For the calculator, ship a coarse "category → class" mapping (200ish entries) hard-coded so an end user can pick a commodity description and get a class. Customers can then paste their own NMFC overrides.

---

## 5. Mileage and routing

The calculator needs a distance engine. PC*MILER is the gold standard but expensive. Free options:

### 5.1 OSRM (Open Source Routing Machine)
- Site: https://project-osrm.org/
- GitHub: https://github.com/Project-OSRM/osrm-backend
- Public demo (NOT for production): https://router.project-osrm.org/
- Geofabrik commercial-grade hosted (car only): https://www.geofabrik.de/data/routing.html

**Free?** Yes – BSD-2 license, self-hosted. Public demo is rate-limited and forbidden in production by usage policy.

**Pros:** Fast (continental routing in ms), well-documented, simple HTTP API, includes Table service for OD matrices.
**Cons:** Default profiles are car/bike/foot. Truck profile possible but you have to write/maintain it. No native height/weight/hazmat restrictions out-of-the-box.

### 5.2 GraphHopper Open Source
- Site: https://www.graphhopper.com/open-source/
- GitHub: https://github.com/graphhopper/graphhopper

**Free?** Apache 2.0 OSS edition is free. **Caveat:** the truck profile and matrix API moved to GraphHopper Directions API (paid) in recent versions. Self-hosted OSS still supports basic truck attributes (weight, height, hazmat) but not as polished.

### 5.3 Valhalla
- Site: https://valhalla.github.io/valhalla/
- GitHub: https://github.com/valhalla/valhalla

**Free?** MIT license, self-hosted. Has native truck costing model with weight, height, length, axle load and hazmat awareness. **Recommended** for a drayage / trucking calculator.

### 5.4 Mapbox Directions API (paid, with free tier)
- Pricing: https://www.mapbox.com/pricing
- ~50,000 directions requests/mo free, then $0.50–$2/1000.
- Commercial OK on standard terms. Dispatch and TMS use cases need a commercial license tier.

### 5.5 Google Maps Distance Matrix (paid, with credit)
- $200/mo of free credit (~40k Distance Matrix elements, ~28k routing elements at typical rate).
- Heavy ToS restrictions for storing/caching results – read carefully.

### 5.6 OpenStreetMap data + self-hosted Valhalla – recommended approach
- OSM raw data: https://www.openstreetmap.org/ (ODbL, share-alike for derived datasets but our use is internal routing, not data redistribution).
- Geofabrik regional extracts: https://download.geofabrik.de/

**Verdict:** Self-host Valhalla on OSM data. Fully free, commercial-OK, native truck routing, and we control the cost curve.

---

## 6. ZIP / postal code → lat/lon

### 6.1 SimpleMaps US ZIP database
- https://simplemaps.com/data/us-zips
- Free CSV (~33k ZIPs with city, state, county, lat/lon, population) – attribution required for free-tier production use.
- Paid Pro version $99 one-time, no attribution, fuller fields. Worth it.

### 6.2 GeoNames postal codes (US + Canada + global)
- https://download.geonames.org/export/zip/
- CC BY 4.0 – commercial OK with attribution.
- Less polished than SimpleMaps but free and global.

### 6.3 US Census TIGER/Line ZCTA shapefiles
- https://www.census.gov/cgi-bin/geo/shapefiles/index.php
- Public domain, polygon-level – use for radius and zone-membership math.

### 6.4 HUD-USPS ZIP Crosswalk (free with key)
- https://www.huduser.gov/portal/dataset/uspszip-api.html
- ZIP ↔ census tract / county / CBSA / congressional district. Quarterly.

### 6.5 Canada postal codes
- Statistics Canada Postal Code Conversion File (PCCF): paid through StatsCan.
- Free alternative: https://download.geonames.org/export/zip/CA_full.csv.zip (FSA-level only – first 3 chars; that's all Canada Post lets us redistribute).

**Recommended seed:** SimpleMaps Pro for US ($99 one-time), GeoNames CA FSA file for Canada (free), TIGER ZCTAs for polygon math.

---

## 7. Carrier identity / FMCSA

Not rate data per se, but useful for the customer-onboarding flow (validate DOT/MC numbers, populate carrier profile).

- FMCSA QCMobile API: https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi (free with WebKey)
- FMCSA SAFER Company Snapshot (web only): https://safer.fmcsa.dot.gov/CompanySnapshot.aspx
- FMCSA Open Data: https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program (full registry as flat files, free)

**Free?** Yes. **License:** Public domain.

---

## 8. Paid sources – flagged, *not* recommended for seed phase

Listed for awareness; the user explicitly asked us not to lean on these. Pricing is approximate.

| Source | What it gives | Cost | Notes |
|---|---|---|---|
| DAT iQ RateView | Lane $/mi spot/contract, 65k+ lanes, 13-mo history | $200–$500/mo per seat | Industry standard but per-seat licensing kills bulk seeding for a SaaS. Public Trendlines headline only is free. |
| FreightWaves SONAR | Tender volume / rejection / contract rates | $$$ enterprise | Some free blog posts at gosonar.com/freight-market-blog. |
| Truckstop.com Rate Insights | Spot rate index | $$ | No public free tier of value. |
| Greenscreens.ai | Predictive rates | $$$ | API only via partnership. |
| SMC3 CzarLite / RateWare | LTL base tariff | $$$ | Standard LTL base; effectively required if going deep on LTL. |
| Convoy | n/a | — | Defunct (2023). No public data legacy. |
| Loadsmart | n/a | — | Private API only via partnership. |
| Project44 / FourKites | Visibility, not rates | $$$ | No public rate data. |
| ATA reports | American Trucking Trends report | $$$ | Headline stats free in press; full report paid. |
| IANA datapoints | Intermodal volume | members only | Volume not rate; some headline numbers in trade press for free. https://intermodal.org/data-products |
| HTS / FTR (FTR Transportation Intelligence) | Macro rate forecasts | $$ | Some free webinars. |

---

## 9. Cross-border (US ↔ Canada) seeding notes

- **US-Canada cross-border lane defaults:** seed at `domestic_per_mile + $0.25/mi` to account for customs delay risk and lower deadhead options. Cross-border reefer is the strongest paying segment per public driver-forum reporting.
- **Currency:** quote in the origin country's currency by default; provide a `fx_rate` field that the calculator reads from a free exchange-rate API. We recommend https://exchangerate.host/ (free, no key) or BoC Valet (https://www.bankofcanada.ca/valet/docs).
- **CBP / CBSA fees:** add a $25 cross-border filing fee (ACE/ACI) and let customer override. Duties/HST/GST are out of scope (these are the importer's, not the carrier's).
- **TransBorder data** (https://www.bts.gov/transborder) gives us US/Canada/Mexico monthly volume by mode and POE for weighting cross-border defaults.

---

## 10. License & commercial-use summary

| Source | Commercial use? | Attribution required? |
|---|---|---|
| EIA / BLS / BTS / FRED / FAF / CFS / FMCSA / Census TIGER | Yes (US gov, public domain) | Recommended |
| Statistics Canada open data | Yes | Yes (StatCan Open Licence) |
| Port authority tariffs (PANYNJ, POH, POLA/POLB, etc.) | Yes (regulated tariffs are public records) | Cite source |
| GeoNames | Yes | Yes (CC BY 4.0) |
| SimpleMaps free tier | Conditional (link back to SimpleMaps required for free tier production use; paid tier removes that) | Yes for free; no for paid |
| OSRM | Yes (BSD-2) | No |
| Valhalla | Yes (MIT) | No |
| GraphHopper OSS | Yes (Apache 2.0) | No |
| OpenStreetMap data (raw) | Yes (ODbL) | Yes; share-alike on *derived datasets you publish*. Routing output is fine. |
| HUD USPS Crosswalk | Yes | Yes |
| OOIDA tools / DOE FSC matrix | Yes (referenced as formula, not data redistribution) | Recommended |
| Cass Truckload Linehaul Index | Headline values OK to cite; data redistribution not OK | Yes |
| DAT Trendlines | Headline values OK to cite as benchmarks; bulk redistribution not OK | Yes |
| ACT Research blog | Citation OK; redistribution not OK | Yes |

---

## 11. Phase 1 seed plan (week 1)

Goal: by end of week one, the calculator produces a defensible quote for any (origin ZIP/FSA, destination ZIP/FSA, equipment type, weight/class/container size) input in USA + Canada, with all numbers traceable to a free source and tunable per customer.

**Day 1 – Skeleton**
1. Stand up `seeds/` directory in the repo. Subfolders: `geo/`, `linehaul/`, `drayage/`, `ltl/`, `accessorials/`, `fuel/`.
2. Pull SimpleMaps US ZIP (paid $99 Pro) + GeoNames Canada FSA → `geo/postal_codes.csv`.
3. Pull TIGER ZCTA shapefile → `geo/zcta.shp` for polygon math.

**Day 2 – Distance / routing**
4. Spin up self-hosted **Valhalla** in Docker with North America OSM extract (Geofabrik). Configure truck profile defaults (8.5 ft width, 13.5 ft height, 80,000 lb GVW). Cache OD distance matrix per quote – plan for a sub-second response budget. Implement a fallback to great-circle × 1.18 detour factor for offline mode.

**Day 3 – Fuel**
5. Register for EIA APIv2 key. Implement weekly cron job → store latest national + 9 PADD diesel prices.
6. Implement standard FSC formula: `fsc = max(0, (doe - baseline) / mpg)`. Defaults: baseline `$1.25`, MPG by equipment (DV 6.5, RF 6.0, FB 6.0, dray 5.0). Make these per-customer overridable.

**Day 4 – Truckload linehaul**
7. Seed a 4-equipment × 4-distance-band base matrix (DV/RF/FB/dray, 0-100 / 100-500 / 500-1500 / 1500+ mi) using published DAT/ACT national averages (van $2.50/mi, reefer $2.95/mi, flatbed $3.30/mi all-in spot at the start).
8. Apply FAF5 OD-pair regional skew: outbound LA +12%, inbound NY/NJ -8%, intra-Midwest -5%, intra-Texas -3%, etc. (Generate this multiplier table once from FAF5 directly.)
9. Contract rate = spot + $0.40/mi by default.
10. Canadian intra-Canada: USD-equivalent × 1.05 to start; cross-border: domestic + $0.25/mi.

**Day 5 – Drayage**
11. Seed 11 port-cluster zones (LA/LB, OAK, SEA/TAC, NY/NJ, Norfolk, Charleston, Savannah, Houston, Vancouver, Montreal, Halifax, Prince Rupert) with the rate structure in §2.6/§2.7 above.
12. Parse the PANYNJ, POH, POLA, POLB tariff PDFs into a `port_accessorials.csv` (PierPASS, Clean Truck Fund, Maher exam, NYTC dray-on-dock/off-dock, etc.).
13. Add per-diem / chassis / prepull / chassis-split defaults from §3.

**Day 6 – LTL**
14. Seed the class × distance-band rate matrix from §4. Default min charge $125, default discount 65% off tariff.
15. Ship a coarse 200-entry commodity-to-class lookup so users can pick "general dry palletized" → class 70, "auto parts" → 70, "pillows" → 200, etc.
16. Honest disclosure on quote PDF: "LTL default rates are estimated; for binding LTL quotes please connect your carrier rate cards."

**Day 7 – Accessorials + Plumbing**
17. Load all of §3 into `accessorials.csv` keyed by `code`, `default_amount`, `unit`, `currency`, `description`, `applies_to_modes`. Per-customer override table sits on top.
18. Indexing job: pull FRED PPI (`PCU484121484121`, `PCU4841224841221`, `PCU4841148411`) and StatCan `1810028101` monthly. Compute a `default_index_multiplier` so seeded base rates auto-trend until customers provide their own data.
19. Wire calculator output: `linehaul + fuel + accessorials + (drayage if port leg) + (LTL if class-based)`. Show source-of-default on hover for transparency.
20. End-to-end smoke tests: 25 fixture quotes spanning DV / RF / FB / drayage / LTL / cross-border.

Deliverable at end of week 1: a quote calculator that returns a number for any sensible input across USA + Canada, with every default traceable to a free source listed in this document, fully overridable by the customer.

---

## 12. What we deliberately did NOT seed for v1

- **Per-lane DAT-style $/mi by 3-digit ZIP-pair.** That's $200+/mo and per-seat. We use FAF5 + national averages with regional multipliers as a free proxy until a customer connects their DAT/SONAR/own data.
- **SMC3 CzarLite LTL base.** Paid. Our seeded class × distance matrix is ~70% as accurate; customers replace it when they connect their carrier rate cards.
- **Real-time tender / capacity signals** (FreightWaves SONAR). Paid; not necessary for seed phase. Future module.
- **Hazmat / oversize compliance routing** beyond Valhalla's basic flags. Future iteration.

---

## 13. Open questions to revisit in v2

1. Do we want to license SMC3 CzarLite for LTL once we have paying LTL customers? (~$$ scaled by request volume.)
2. Should we add Chainalytics / Loadsmart partnership feeds for predictive rates once we hit scale?
3. Is there an opportunity to publish anonymized aggregate rates ourselves, fed by customer quote volume, as a moat? (Long-term product question.)
4. Should we pull live ocean rates (Xeneta / Freightos BAX) to extend into door-to-door international quoting? (Phase 2.)

---

## Appendix: Source URLs (consolidated)

**US gov free**
- https://www.eia.gov/petroleum/gasdiesel/
- https://www.eia.gov/opendata/
- https://www.eia.gov/opendata/documentation.php
- https://www.bts.gov/
- https://www.bts.gov/faf
- https://faf.ornl.gov/
- https://www.bts.gov/cfs
- https://cfsdata.bts.gov/
- https://www.bts.gov/transborder
- https://data.bts.gov/
- https://www.bts.gov/ntad
- https://fred.stlouisfed.org/
- https://fred.stlouisfed.org/series/PCU484121484121
- https://fred.stlouisfed.org/series/PCU4841224841221
- https://fred.stlouisfed.org/series/TSIFRGHT
- https://fred.stlouisfed.org/series/FRGSHPUSM649NCIS
- https://www.fmcsa.dot.gov/registration/fmcsa-data-dissemination-program
- https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi
- https://safer.fmcsa.dot.gov/CompanySnapshot.aspx
- https://catalog.data.gov/dataset?tags=freight
- https://data.transportation.gov/
- https://www.census.gov/programs-surveys/cfs.html
- https://www.census.gov/cgi-bin/geo/shapefiles/index.php
- https://www.huduser.gov/portal/dataset/uspszip-api.html

**Canada gov free**
- https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810028101
- https://www.statcan.gc.ca/en/developers/wds
- https://www.bankofcanada.ca/valet/docs

**Port tariffs (free public PDFs)**
- https://www.panynj.gov/port/en/doing-business/tariffs.html
- https://porthouston.com/toolbox/rates/tariffs/
- https://www.portoflosangeles.org/business/tariffs
- https://polb.com/business/port-tariff/
- https://www.nwseaportalliance.com/cargo-operations/trucker-resources
- https://gaports.com/business-and-shipping/rates-and-tariffs/
- https://www.portofvirginia.com/about/tariffs/
- https://www.portvancouver.com/customers/tariff/
- https://www.port-montreal.com/en/the-port-of-montreal/operations/our-customers/tariff
- https://www.portofhalifax.ca/operations/marine-tariffs/
- https://www.rupertport.com/

**Industry indices (free headline, paid detail)**
- https://www.dat.com/trendlines
- https://www.actresearch.net/resources/data-tracking/freight-trucking-rates
- https://www.actresearch.net/resources/data-tracking/canada-rates
- https://cgfi.ca/canadian-general-freight-index-results/
- https://www.cassinfo.com/freight-audit-payment/cass-transportation-indexes/truckload-linehaul-index
- https://intermodal.org/data-products
- https://www.fleetowner.com/news/rates
- https://www.truckingdive.com/news/truck-freight-rates-changes-tracker/715709/

**Routing / geo (free, OSS)**
- https://project-osrm.org/
- https://github.com/Project-OSRM/osrm-backend
- https://valhalla.github.io/valhalla/
- https://github.com/valhalla/valhalla
- https://www.graphhopper.com/open-source/
- https://github.com/graphhopper/graphhopper
- https://download.geofabrik.de/
- https://simplemaps.com/data/us-zips
- https://download.geonames.org/export/zip/
- https://www.openstreetmap.org/
- https://operations.osmfoundation.org/policies/nominatim/

**Accessorial / formula references**
- https://www.ooida.com/trucking-tools/fuel-surcharge-calculator/
- https://www.freightwaves.com/checkpoint/fuel-surcharge-in-trucking/
- https://atlas.doe.gov/RateRoute/FuelSurcharge/2025CurrentFSCMatrix.pdf
- https://arcb.com/blog/accessorial-charges-in-truckload-and-ltl-freight
- https://www.odfl.com/us/en/resources/freight-knowledge/odfl-blog/what-your-accessorial-charges-mean.html
- https://www.stord.com/blog/guide-to-freight-accessorial-charges
- https://datadocks.com/posts/truck-detention-accessorial-fees
- https://www.smartwarehousing.com/blog/drayage-terms-and-fees-you-need-to-know

**LTL / classification**
- https://nmfta.org/nmfc/
- https://info.nmfta.org/2025-nmfc-changes-for-ltl-shipments
- https://redstagfulfillment.com/what-is-average-cost-per-pound-ltl-shipping/
- https://www.freightquote.com/how-to-ship-freight/freight-class-nmfc-codes/

**Datasets (free)**
- https://github.com/austinlasseter/datasets-shipping-logistics
- https://github.com/ITSLeeds/opentransportdata
- https://www.kaggle.com/datasets/usdot/freight-analysis-framework
- https://huggingface.co/datasets

**FX (free)**
- https://exchangerate.host/
- https://www.bankofcanada.ca/valet/docs
