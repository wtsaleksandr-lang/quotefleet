/**
 * THE MARKET RATE SOURCE REGISTER — and why it is not `SourceDoc`.
 *
 * `SourceDoc` in `src/calc/osow/provenance.ts` carries statutes, state DOT fee
 * schedules and eCFR sections. Its own doc comment says so: "State DOT / eCFR /
 * statute sites only". Nothing in this file is one of those. These are trade
 * press republications of a paid index, US Government open datasets, one dated
 * industry rate posting, a dozen operator rate cards and two filed carrier
 * tariffs.
 *
 * Some of those are genuinely strong evidence. None of them is a statute, and
 * `MarketSource` is a DIFFERENT TYPE so that no future edit can put a pilot-car
 * rate card into a `Sourced<T>` and have it flow into `totalPermitUsd`. The
 * escort research asked for exactly this and the reason is worth repeating:
 * "It must never be laundered into the same type as a statutory permit fee."
 *
 * ── WHAT EACH FIELD MEANS ─────────────────────────────────────────────────
 *
 * `dated` is the date THE DOCUMENT ITSELF carries. `null` means the page states
 * no date, which is a fact about the evidence and not a gap to fill in with
 * today. Most operator rate sheets are undated; the only honest claim available
 * for them is that they were live and readable on `retrievedOn`.
 *
 * `refetch` says whether the figure can be refreshed WITHOUT a key and WITHOUT
 * paying anybody. It is the thing that decides whether a number ages silently
 * or can be put on a cron.
 */

/** Can this source be refreshed later, and how hard is it? */
export type RefetchMode =
  /** Free, keyless, machine-readable. Put it on a cron. */
  | 'keylessApi'
  /** Free, but the page 403s a plain fetch and needs a headless capture. */
  | 'headlessCapture'
  /** A PDF or HTML page at a stable URL; re-read by hand. */
  | 'manualDocument'
  /** No successor exists. The figure ages until somebody publishes again. */
  | 'noSuccessor';

/**
 * A market rate source. NOT a `SourceDoc`, deliberately — see the header.
 */
export interface MarketSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  /** The date the DOCUMENT carries. `null` when it carries none. */
  dated: string | null;
  /** When the research actually loaded it. */
  retrievedOn: string;
  /** How many independent price points this source contributes. */
  samplePoints: number;
  refetch: RefetchMode;
  /** What it gives, in one clause. */
  gives: string;
}

const RETRIEVED = '2026-09-04';

// ── Line haul ─────────────────────────────────────────────────────────────

export const SRC_DAT_FLATBED: MarketSource = {
  id: 'dat_flatbed_linehaul_2026w35',
  title: 'DAT spot market data for Aug 23–29, 2026',
  url: 'https://www.ajot.com/news/dat-spot-market-data-for-aug-23-29-2026',
  publisher: 'AJOT (republishing the DAT spot index)',
  dated: '2026-08-29',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'headlessCapture',
  gives:
    'National flatbed rate split into line-haul and all-in, plus the EIA diesel figure DAT used for the surcharge. Weekly; the article slug changes each week.',
};

export const SRC_USDA_REEFER_LANES: MarketSource = {
  id: 'usda_agtransport_acar_e3r8',
  title: 'AgTransport — Refrigerated Truck Rates and Availability (acar-e3r8)',
  url: 'https://agtransport.usda.gov/resource/acar-e3r8.json',
  publisher: 'US Department of Agriculture (public domain)',
  dated: '2026-08-29',
  retrievedOn: RETRIEVED,
  samplePoints: 6098,
  refetch: 'keylessApi',
  gives:
    '~19.7k lane-week observations with numeric distance and $/mile. The distance-decay curve and the sub-100-mile minimum-charge floor both come from here.',
};

export const SRC_USDA_GRAIN_TRUCK: MarketSource = {
  id: 'usda_agtransport_fxkn_2w9c',
  title: 'AgTransport — Quarterly Grain Truck Rates (fxkn-2w9c)',
  url: 'https://agtransport.usda.gov/resource/fxkn-2w9c.json',
  publisher: 'US Department of Agriculture (public domain)',
  dated: '2026-06-30',
  retrievedOn: RETRIEVED,
  samplePoints: 458,
  refetch: 'keylessApi',
  gives:
    '$/mile at 25 / 100 / 200-mile bands, national and by region. Independent confirmation of the short-haul premium’s SHAPE — the levels are hopper freight and do not transfer.',
};

export const SRC_ATRI_COSTS: MarketSource = {
  id: 'atri_operational_costs_2026',
  title: 'An Analysis of the Operational Costs of Trucking (2026 release)',
  url: 'https://truckingresearch.org/2026/07/new-atri-report-details-accelerating-costs-and-low-profitability-despite-cuts/',
  publisher: 'American Transportation Research Institute',
  dated: '2026-07-15',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'Carrier marginal cost: $2.336/mi all-in and $1.854/mi excluding fuel, 2025. Used as a floor to flag an impossible quote, never to price one.',
};

export const SRC_EQUIPMENT_GUIDES: MarketSource = {
  id: 'heavy_haul_published_rate_guides',
  title: 'Ten independent published heavy-haul rate guides, two of them operating carriers',
  url: 'https://atsinc.com/blog/open-deck-shipping-price-information',
  publisher:
    'Anderson Trucking Service · Freight Sidekick · O Trucking · Logi Transports · Truck Dispatch Experts · Nexus · usatruckerchoice · FF Dispatch · Heavy Haulers · heavydutyyard',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 10,
  refetch: 'manualDocument',
  gives:
    'RGN-to-flatbed ratios with a median of 1.523 across ten publishers (±22%, not the ±40% five guides gave), a step-deck delta of +$0.23–0.50/mi, published open-deck minimums of $300–$1,400, and — the correction that matters — three DECOMPOSED worked examples where the publisher itemises base hauling separately from permits, escorts and fuel. Those three are the only published figures that are line-haul rather than all-in.',
};

/**
 * THE ONLY ANGLE WITH TRANSACTION VOLUME — and it stops at legal weight.
 *
 * 21,851 real broker postings behind a lane × equipment rate table, plus one
 * heavy-haul marketplace's own published average of itself. It measures the
 * flatbed level and the step-deck ratio outright. It measures NOTHING above
 * 47,000 lb: a 4,087-load live board carried exactly two lowboy postings, and
 * the entire permitted/multi-axle domain has no public transaction record at
 * all. That asymmetry is why the multi-axle band stays wide.
 *
 * NOT `keylessApi` DELIBERATELY. The board's terms forbid scraping at scale, so
 * the figures came from a handful of ordinary page views and this source must
 * never end up on a cron.
 */
export const SRC_OBSERVED_POSTINGS: MarketSource = {
  id: 'observed_load_board_postings_2026',
  title: 'Observed open-deck load postings and marketplace line-haul averages',
  url: 'https://www.trulos.com/',
  publisher: 'Trulos free load board (Freight Rate Intelligence) · FR8Star (Sandhills Global)',
  dated: '2026-09-04',
  retrievedOn: RETRIEVED,
  samplePoints: 21_851,
  refetch: 'manualDocument',
  gives:
    'Flatbed line-haul median $2.84/mi (p25 $2.16 · p75 $3.49, n=2,636 postings); a matched-lane step-deck-to-flatbed ratio of 0.970 across 162 lanes carrying both with ≥5 loads each; an RGN-to-flatbed ratio of 1.75 from a heavy-haul marketplace’s own three published rate sets; and a fitted distance decay of $/mi = 8.34 × miles^(−0.168) over 626 lanes and 12,881 loads.',
};

/**
 * A GOVERNMENT-SET $/MILE SCHEDULE KEYED TO LOAD WEIGHT IN POUNDS.
 *
 * The only one found anywhere, free or paid: a binding interagency rate for
 * lowboy transport at $4.50 / $5.50 / $5.75 per mile by load rating, with a
 * daily guarantee paid whenever it beats the mileage. Escorts are reimbursed
 * separately on the invoice, so those figures are EX-ESCORT — which is the same
 * decomposition this engine uses, and the reason they are comparable at all.
 */
export const SRC_NRCG_TRANSPORT_RATES: MarketSource = {
  id: 'nrcg_chapter20_transport_lowboy_2025',
  title: 'NR Supplement to the NWCG Standards for Interagency Incident Business Management, Chapter 20',
  url: 'https://gacc.nifc.gov/nrcc/nrcg/committees/business/nr%20supplements/NR_Chapter20.pdf',
  publisher: 'Northern Rockies Coordinating Group (US interagency, public domain)',
  dated: '2025-05-01',
  retrievedOn: RETRIEVED,
  samplePoints: 3,
  refetch: 'manualDocument',
  gives:
    'TRANSPORT, LOWBOY at $4.50/$5.50/$5.75 per mile by load rating (≤35,000 / 35,001–69,999 / ≥70,000 lb), fully operated and ex-escort, each with a minimum daily guarantee of $1,100/$1,400/$1,500 paid whenever it beats the mileage — which puts the day-rate crossover at 244–261 miles.',
};

/**
 * A REAL ASSET-BASED CARRIER'S PUBLISHED HEAVY-HAUL FORMULA.
 *
 * Held as a CROSS-CHECK, never as a pricing path — see `atsAxleFormulaUsd` in
 * `linehaul.ts`. It is all-in by the carrier's own policy, which is exactly why
 * it can only bound our line-haul figure from above rather than replace it.
 */
export const SRC_ATS_AXLE_FORMULA: MarketSource = {
  id: 'ats_heavy_haul_axle_formula',
  title: 'Heavy haul trucking cost information — the $1 × axles × miles formula',
  url: 'https://atsinc.com/blog/heavy-haul-trucking-cost-information',
  publisher: 'Anderson Trucking Service (asset-based specialized carrier)',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    '$1.00 × axles × miles for heavy haul up to 100,000 lb, with a worked example — a 70,000 lb boiler, New Orleans→Indianapolis, 819 mi on 7 axles, $5,733. Declared invalid above 100,000 lb, 13\'6", 50 ft or 16 ft.',
};

// ── Escorts ───────────────────────────────────────────────────────────────

export const SRC_PILOTCAR101: MarketSource = {
  id: 'pilotcar101_rates_jan2025',
  title: 'Pilot Car Rates for January 2025',
  url: 'https://pilotcar101.com/blog/f/pilot-car-rates-for-january-2025',
  publisher: 'Pilot Car 101 (a training/community site, not a service company)',
  dated: '2025-01-26',
  retrievedOn: RETRIEVED,
  samplePoints: 5,
  refetch: 'noSuccessor',
  gives:
    'Lead/chase, high-pole, day, mini, hotel and no-go rates broken out for five US regions. The strongest single escort source, and the only dated one. No 2026 edition exists — re-check each January.',
};

export const SRC_ESCORT_OPERATOR_SHEETS: MarketSource = {
  id: 'escort_operator_rate_sheets',
  title: 'Six published pilot-car operator rate sheets',
  url: 'https://blueridgepilotcars.com/rates/',
  publisher: 'Blue Ridge · Big Sky · AmeriPilot · TMP · 365Pilots · Arizona Pilot Car',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 6,
  refetch: 'manualDocument',
  gives:
    'Per-mile, high-pole, day, overnight, wait and cancellation rates. Undated pages: the only honest claim is that they were live on the retrieval date.',
};

export const SRC_ESCORT_BUYER_SIDE: MarketSource = {
  id: 'escort_buyer_side_guides',
  title: 'Broker-side escort cost guides',
  url: 'https://freightsidekick.com/resources/cost-guides/specialized-heavy-haul-rates',
  publisher: 'Freight Sidekick · Heavy Haulers · Everdauer · Arizona Pilot Car startup guide',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 4,
  refetch: 'manualDocument',
  gives:
    '$400–$800 per escort per day from the BUY side — an independent cross-check that lands on top of the operator day-rate band.',
};

// ── Accessorials ──────────────────────────────────────────────────────────

export const SRC_ACE_DORAN_TARIFF: MarketSource = {
  id: 'ace_doran_aceh_101e',
  title: 'Ace Doran Hauling & Rigging, ICC ACEH 101-E',
  url: 'https://acedoran.com/wp-content/uploads/2026/02/101ACEH-E12.1.2024.pdf',
  publisher: 'Ace Doran Hauling & Rigging (filed heavy-haul carrier tariff)',
  dated: '2024-12-02',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'Axle-scaled detention (Item 200), dimension-scaled tarping (Item 440), per-state permit charges (Item 340), and Item 270 — the clause that puts the crane on the shipper.',
};

export const SRC_GLEN_RAVEN_TARIFF: MarketSource = {
  id: 'glen_raven_rules_accessorials',
  title: 'Glen Raven Logistics rules and accessorial tariff',
  url: 'https://www.glenravenlogistics.com/pdf/GRL-Asset-Rules-and-Accessorials.pdf',
  publisher: 'Glen Raven Logistics',
  dated: '2016-07-10',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'The only tariff found that names OVERSIZE/OVERWEIGHT curfews as the layover trigger: $130/man + $176/vehicle per night. Ten years old, so its low end understates 2026.',
};

export const SRC_FEMA_URT: MarketSource = {
  id: 'fema_uniform_rules_tariff_2024',
  title: 'FEMA Uniform Rules Tariff',
  url: 'https://www.fema.gov/sites/default/files/documents/fema_2024_urt.pdf',
  publisher: 'US Federal Emergency Management Agency (public domain)',
  dated: '2024-07-01',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'Detention $135/hr and layover capped at $550 per vehicle per day — a government-set ceiling, and the right upper bound for the layover band.',
};

export const SRC_NORTH_TEXAS_CRANE: MarketSource = {
  id: 'north_texas_crane_2025_rate_sheet',
  title: '2025 Crane Rental Rate Sheet',
  url: 'https://www.northtexascrane.com/siteart/pdf/2025-Crane-Rental-Rate-Sheet-1.pdf',
  publisher: 'North Texas Crane Service',
  dated: '2025-01-01',
  retrievedOn: RETRIEVED,
  samplePoints: 14,
  refetch: 'manualDocument',
  gives:
    'The full OPERATED hourly curve from 23 t to 275 t, plus minimums, the crane’s own road permit, rigger and standby rates, the 7% fuel surcharge and portal-to-portal billing. The spine of the crane model — and the single-source risk in it, since it is one Texas market.',
};

export const SRC_FEMA_EQUIPMENT_RATES: MarketSource = {
  id: 'fema_schedule_equipment_rates_2025',
  title: 'FEMA Schedule of Equipment Rates',
  url: 'https://www.fema.gov/assistance/public/tools-resources/schedule-equipment-rates',
  publisher: 'US Federal Emergency Management Agency (public domain)',
  dated: '2025-07-01',
  retrievedOn: RETRIEVED,
  samplePoints: 8,
  refetch: 'manualDocument',
  gives:
    'Bare hourly rates for cranes 15–125 t, operator explicitly EXCLUDED. A sanity rail on the commercial curve, not a hire price.',
};

export const SRC_CA_PREVAILING_WAGE: MarketSource = {
  id: 'ca_dir_crane_prevailing_wage_2024',
  title: 'CA DIR prevailing wage SC-23-63-2 — Cranes, Pile Driver & Hoisting',
  url: 'https://www.dir.ca.gov/oprl/2025-1/PWD/Determinations/Southern/SC-023-63-2%28B%29.pdf',
  publisher: 'California Department of Industrial Relations',
  dated: '2024-08-22',
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'A legally binding, fully burdened crane-operator cost of $94.08–$100.08/hr — which lands on top of the Texas sheet’s $95/hr rigger rate from a completely independent direction.',
};

export const SRC_PERMIT_SERVICE_FEES: MarketSource = {
  id: 'permit_service_fee_schedules',
  title: 'Two published permit-service fee schedules',
  url: 'https://highway-permits.com/fees/',
  publisher: 'Highway Permits · Compare Transport',
  dated: '2026-01-01',
  retrievedOn: RETRIEVED,
  samplePoints: 2,
  refetch: 'manualDocument',
  gives:
    'The agent’s fee ON TOP OF the state fee: $24–$30 at the budget end, $72.50–$82.50 full service. A genuine 3× spread, so the model is a band and never a point.',
};

export const SRC_TXDMV_SUPERHEAVY: MarketSource = {
  id: 'txdmv_superheavy_single_trip',
  title: 'Superheavy Single-Trip Permit',
  url: 'https://www.txdmv.gov/motor-carriers/oversize-overweight-permits/superheavy-single-trip',
  publisher: 'Texas Department of Motor Vehicles',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'A FLAT $500 engineering-report review, $375 highway maintenance, $100 for a no-bridge route, and a 3–4 week lead time. One of the two route-survey fee architectures.',
};

export const SRC_IL_ENGINEERING_REVIEW: MarketSource = {
  id: 'il_adm_code_554_engineering_review',
  title: 'Illinois engineering review and pavement analysis (92 Ill. Adm. Code 554)',
  url: 'https://osowloads.com/states/illinois',
  publisher: 'OSOWloads, citing 92 Ill. Adm. Code 554',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 1,
  refetch: 'manualDocument',
  gives:
    'Engineering review and pavement analysis at $40/hr — the HOURLY architecture, against Texas’s flat fee. A single national constant would be wrong for one of the two.',
};

export const SRC_CARGO_INSURANCE: MarketSource = {
  id: 'cargo_excess_value_rate_guides',
  title: 'Cargo insurance and declared-value rate guides',
  url: 'https://www.logrock.com/uncategorized/cargo-insurance-rate/',
  publisher: 'Logrock · Cahoot',
  dated: null,
  retrievedOn: RETRIEVED,
  samplePoints: 2,
  refetch: 'manualDocument',
  gives:
    'Excess-value cover at $0.50–$1.25 per $100 third-party, $1.05–$1.90 per $100 as a carrier declared-value fee.',
};

/** Every source this engine cites, for a "where these numbers come from" page. */
export const MARKET_SOURCES: ReadonlyArray<MarketSource> = [
  SRC_DAT_FLATBED,
  SRC_USDA_REEFER_LANES,
  SRC_USDA_GRAIN_TRUCK,
  SRC_ATRI_COSTS,
  SRC_EQUIPMENT_GUIDES,
  SRC_OBSERVED_POSTINGS,
  SRC_NRCG_TRANSPORT_RATES,
  SRC_ATS_AXLE_FORMULA,
  SRC_PILOTCAR101,
  SRC_ESCORT_OPERATOR_SHEETS,
  SRC_ESCORT_BUYER_SIDE,
  SRC_ACE_DORAN_TARIFF,
  SRC_GLEN_RAVEN_TARIFF,
  SRC_FEMA_URT,
  SRC_NORTH_TEXAS_CRANE,
  SRC_FEMA_EQUIPMENT_RATES,
  SRC_CA_PREVAILING_WAGE,
  SRC_PERMIT_SERVICE_FEES,
  SRC_TXDMV_SUPERHEAVY,
  SRC_IL_ENGINEERING_REVIEW,
  SRC_CARGO_INSURANCE,
];

/**
 * The sources a cron could refresh on its own, with no key and no payment.
 *
 * Two of twenty-one, and naming them is the point: everything else in this engine
 * ages silently until somebody re-reads a PDF. The DAT weekly anchor is free but
 * 403s a plain fetch and its article slug changes every week, so it sits in
 * `headlessCapture` rather than here.
 */
export const AUTO_REFRESHABLE_SOURCES: ReadonlyArray<MarketSource> =
  MARKET_SOURCES.filter((s) => s.refetch === 'keylessApi');
