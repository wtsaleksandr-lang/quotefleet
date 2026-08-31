/**
 * PUBLIC drayage & freight GLOSSARY — no auth, SEO-first.
 *
 * A self-contained, server-rendered glossary that lives alongside the carrier
 * directory. Every definition here is ORIGINAL copy written for QuoteFleet —
 * no third-party text is copied. Pages reuse the QuoteFleet marketing shell
 * (style.css, topnav, footer, favicons) and the directory's design tokens so
 * they're visually consistent with /directory and /compliance.
 *
 * Routes (registered via registerGlossaryRoutes in src/server/app.ts):
 *   GET /glossary          → index, terms grouped by category.
 *   GET /glossary/:slug    → single term page (question-form H1, definition,
 *                            related terms, CTA into /directory + the widget),
 *                            with DefinedTerm/Article + BreadcrumbList JSON-LD.
 *
 * The term corpus is a plain data array (GLOSSARY_TERMS) so it's trivial to
 * extend: add a {slug, term, category, titleQuestion, definitionHtml, related}
 * entry and it appears on the index (under its category) and gets its own page.
 */
import type { Express, Request, Response } from 'express';
import { setPublicDirectoryCache } from './httpCache.js';

const SITE = 'https://quotefleet.net';

// ─── HTML escape (self-contained; mirrors directory/pages.ts) ──────────────
function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string),
  );
}

// ─── Categories (ordered as they render on the index) ──────────────────────
export const GLOSSARY_CATEGORIES = [
  'Compliance',
  'Core',
  'Costs',
  'Equipment',
  'Operations',
  'Port fees',
  'Specialized',
] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

export interface GlossaryTerm {
  slug: string;
  term: string;
  category: GlossaryCategory;
  /** One-line summary used on the index card + meta description. */
  summary: string;
  /** Question-form H1, e.g. "What is Drayage?" */
  titleQuestion: string;
  /** Our own 2–4 paragraph definition, already HTML (<p>…</p>). */
  definitionHtml: string;
  /** Slugs of related terms (rendered as cross-links). */
  related: string[];
}

// ─── Term corpus (all definitions are original QuoteFleet copy) ────────────
export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // ── Core ────────────────────────────────────────────────────────────────
  {
    slug: 'drayage',
    term: 'Drayage',
    category: 'Core',
    summary: 'Short-haul trucking that moves a container the first or last mile between a port, rail ramp, or yard and a nearby facility.',
    titleQuestion: 'What is Drayage?',
    definitionHtml: `
      <p>Drayage is the short-distance trucking of an ocean or rail container between a transportation hub — a marine terminal, an intermodal rail ramp, or a container yard — and a nearby destination such as a warehouse, distribution center, or another terminal. It is the "first mile" and "last mile" of containerized freight: the leg that connects the long international ocean or domestic rail move to the customer's door.</p>
      <p>Although a drayage run is usually only a few miles and often completes in a single day, it is one of the most operationally complex parts of the supply chain. Drivers must schedule an appointment at the terminal, hold the right credentials for port access, locate the correct chassis, and return the empty container before charges accrue — all inside tight terminal gate windows.</p>
      <p>Because drayage sits at the seam between ocean, rail, and over-the-road transport, delays here ripple outward: a missed terminal appointment or a chassis shortage can trigger detention, demurrage, and per-diem charges downstream. Shippers who book a reliable, compliant drayage carrier protect the rest of the move.</p>`,
    related: ['port-drayage', 'intermodal-drayage', 'chassis', 'detention-demurrage'],
  },
  {
    slug: 'port-drayage',
    term: 'Port Drayage',
    category: 'Core',
    summary: 'Drayage that specifically moves import or export containers to and from an ocean marine terminal.',
    titleQuestion: 'What is Port Drayage?',
    definitionHtml: `
      <p>Port drayage is drayage performed at an ocean marine terminal — hauling import containers off the port after a vessel discharges, or delivering export containers to the port before a vessel's cutoff. It is the specific form of drayage that touches the water side of the supply chain.</p>
      <p>Port drayage carriers work inside the terminal's appointment and gate systems, navigate marine-terminal congestion, and must manage the port's free-time clock: the limited window before demurrage (on the container) and detention (on the equipment) begin. At major U.S. gateways, drivers also need port-access credentials such as a TWIC card and, in California, a CARB-compliant clean truck.</p>
      <p>Because the ocean carrier, the terminal operator, and the chassis provider are often three different parties, port drayage requires tight coordination to avoid missed cutoffs, dry runs, and accessorial charges.</p>`,
    related: ['drayage', 'twic', 'last-free-day', 'pierpass'],
  },
  {
    slug: 'intermodal-drayage',
    term: 'Intermodal Drayage',
    category: 'Core',
    summary: 'The truck leg that connects a container to or from a rail intermodal ramp.',
    titleQuestion: 'What is Intermodal Drayage?',
    definitionHtml: `
      <p>Intermodal drayage is the truck portion of an intermodal move — the short haul that carries a container between a rail intermodal ramp and its origin or destination. In a typical intermodal shipment, a container travels long distances by rail (the cost-efficient line-haul) and relies on trucks only for the ends, and those trucking legs are the intermodal drayage.</p>
      <p>The term "intermodal" simply means the freight moves in more than one mode — ship, rail, and truck — without being unpacked, because it stays in the same standardized container the entire way. Drayage is what makes that seamless handoff possible at each transfer point.</p>
      <p>Intermodal drayage carriers coordinate with railroads' ramp scheduling and notice systems, manage the last free day at the ramp, and often provide or source the chassis the container rides on for the road leg.</p>`,
    related: ['drayage', 'teu', 'chassis', 'last-free-day'],
  },
  {
    slug: 'teu',
    term: 'TEU',
    category: 'Core',
    summary: 'Twenty-foot Equivalent Unit — the standard way to measure container volume and terminal throughput.',
    titleQuestion: 'What is a TEU?',
    definitionHtml: `
      <p>TEU stands for Twenty-foot Equivalent Unit, the standard unit used to measure container capacity and volume across the shipping industry. One TEU equals a single 20-foot shipping container. A standard 40-foot container — the most common size on the road — counts as two TEUs.</p>
      <p>TEUs let the industry compare apples to apples: a vessel's capacity, a port's annual throughput, and a terminal's congestion are all expressed in TEUs regardless of the mix of 20-foot and 40-foot boxes involved. When a port reports moving 9 million TEUs a year, that is the total container volume normalized to the 20-foot standard.</p>
      <p>For drayage, TEU counts translate directly into truck moves and chassis demand: each container hauled off a terminal is one drayage move, so higher TEU volume at a gateway means more pressure on local drayage capacity, chassis pools, and appointment slots.</p>`,
    related: ['drayage', 'port-drayage', 'chassis'],
  },

  // ── Compliance ────────────────────────────────────────────────────────────
  {
    slug: 'uiia',
    term: 'UIIA',
    category: 'Compliance',
    summary: 'The industry-standard interchange agreement a motor carrier must sign to legally pick up and drop off intermodal equipment.',
    titleQuestion: 'What is the UIIA?',
    definitionHtml: `
      <p>The UIIA — the Uniform Intermodal Interchange and Facilities Access Agreement — is the standardized contract that governs how a motor carrier interchanges equipment (containers and chassis) with ocean carriers, railroads, and equipment providers. Administered by the Intermodal Association of North America, it replaces what would otherwise be dozens of separate one-off agreements with a single, industry-wide set of terms.</p>
      <p>A drayage carrier generally must be a UIIA participant — with the required insurance on file and in good standing — before a terminal or equipment provider will release a container or chassis to its drivers. It defines who is responsible for equipment while it is in the trucker's possession, how damage and per-diem disputes are handled, and the access rules at participating facilities.</p>
      <p>UIIA membership is self-declared and managed through IIA, not something derivable from FMCSA records. When vetting a drayage carrier, confirm UIIA status directly rather than assuming it from a carrier's authority alone.</p>`,
    related: ['bonded-carrier', 'chassis', 'per-diem', 'fmcsa-safer'],
  },
  {
    slug: 'twic',
    term: 'TWIC',
    category: 'Compliance',
    summary: 'The federal Transportation Worker Identification Credential that a driver needs to enter secure port facilities.',
    titleQuestion: 'What is a TWIC card?',
    definitionHtml: `
      <p>TWIC — the Transportation Worker Identification Credential — is a federal biometric security card issued by the Transportation Security Administration. It is required for workers who need unescorted access to the secure areas of the nation's ports, marine terminals, and certain vessels regulated under the Maritime Transportation Security Act.</p>
      <p>For port drayage, a TWIC is essentially non-negotiable: a driver without one cannot enter the marine terminal to pick up or drop off a container. Obtaining a TWIC requires a TSA security-threat assessment (a background and immigration check), fingerprinting, and periodic renewal.</p>
      <p>Because TWIC is a per-driver credential rather than a company registration, having drivers who all hold current TWIC cards is a marker of a drayage carrier that is genuinely set up to service ports — not something visible in a carrier's basic operating authority.</p>`,
    related: ['port-drayage', 'uiia', 'carb-compliance'],
  },
  {
    slug: 'fmcsa-safer',
    term: 'FMCSA SAFER',
    category: 'Compliance',
    summary: "FMCSA's public system for looking up a carrier's operating authority, insurance, and safety record by USDOT or MC number.",
    titleQuestion: 'What is FMCSA SAFER?',
    definitionHtml: `
      <p>SAFER — the Safety and Fitness Electronic Records system — is the Federal Motor Carrier Safety Administration's free public database for looking up motor carriers. Its Company Snapshot returns a carrier's operating authority status, whether it is allowed to operate, its insurance on file, fleet size, and its recent crash and inspection history, searchable by USDOT number or MC (docket) number.</p>
      <p>SAFER is the baseline vetting tool for anyone hiring a carrier: before tendering a load, a shipper or broker can confirm the carrier's authority is active, its insurance is in place, and it is not under an out-of-service order. Because the data comes straight from FMCSA, it is authoritative rather than self-reported.</p>
      <p>QuoteFleet's directory is built on this same FMCSA public data, and its compliance tools let you run a live SAFER-style snapshot on any USDOT or MC number without leaving the page.</p>`,
    related: ['usdot-number', 'sms-basic-score', 'bonded-carrier'],
  },
  {
    slug: 'sms-basic-score',
    term: 'SMS BASIC Score',
    category: 'Compliance',
    summary: "FMCSA's Safety Measurement System percentile scores that rank a carrier's safety performance across seven categories.",
    titleQuestion: 'What is an SMS BASIC Score?',
    definitionHtml: `
      <p>The SMS BASIC scores come from FMCSA's Safety Measurement System, which analyzes a carrier's roadside inspection and crash data and expresses its safety performance as percentile rankings. BASIC stands for Behavior Analysis and Safety Improvement Categories — the seven areas the system measures, including Unsafe Driving, Hours-of-Service Compliance, Vehicle Maintenance, Controlled Substances/Alcohol, Hazardous Materials Compliance, Driver Fitness, and Crash Indicator.</p>
      <p>Each score is a percentile from 0 to 100 relative to peer carriers of similar size and operation. A higher percentile means worse relative performance — a carrier scoring in the 90th percentile for Unsafe Driving is performing worse than 90% of comparable carriers, which can flag it for FMCSA intervention.</p>
      <p>BASIC scores add nuance beyond a simple pass/fail safety rating. They help shippers and brokers distinguish a carrier that is technically authorized but trending poorly from one with a clean, well-maintained operation.</p>`,
    related: ['fmcsa-safer', 'usdot-number', 'hazmat-drayage'],
  },
  {
    slug: 'usdot-number',
    term: 'USDOT Number',
    category: 'Compliance',
    summary: "The unique federal identifier assigned to a motor carrier, used to track its safety, authority, and compliance records.",
    titleQuestion: 'What is a USDOT Number?',
    definitionHtml: `
      <p>A USDOT number is the unique identifier the U.S. Department of Transportation assigns to a commercial motor carrier. It follows the carrier for the life of the business and serves as the key that links together its registration, safety records, inspections, crash history, and audit results across federal systems.</p>
      <p>Interstate carriers — and intrastate carriers in many states — are required to have and display an active USDOT number. It is distinct from an MC (motor carrier operating authority) number: the USDOT number identifies the company for safety-monitoring purposes, while the MC number grants the authority to haul regulated freight for hire across state lines.</p>
      <p>When vetting a carrier, the USDOT number is the single most useful thing to have: enter it into FMCSA SAFER or QuoteFleet's live lookup and you can confirm the carrier's authority, insurance, and safety standing in seconds.</p>`,
    related: ['fmcsa-safer', 'sms-basic-score', 'bonded-carrier'],
  },
  {
    slug: 'carb-compliance',
    term: 'CARB Compliance',
    category: 'Compliance',
    summary: "Meeting the California Air Resources Board's clean-truck rules required to serve California ports and rail yards.",
    titleQuestion: 'What is CARB Compliance?',
    definitionHtml: `
      <p>CARB compliance means a truck and carrier meet the California Air Resources Board's emissions regulations — the state clean-air rules that govern which trucks may operate in California, and specifically which may enter its ports and intermodal rail yards. CARB has progressively tightened engine and zero-emission requirements for drayage trucks through programs such as the Drayage Truck Regulation and the Advanced Clean Fleets rule.</p>
      <p>For drayage into ports like Los Angeles, Long Beach, and Oakland, a non-compliant truck is simply turned away at the gate: trucks serving these facilities must be registered in CARB's drayage truck registry and meet the current model-year or zero-emission standard. This makes CARB status a hard gating factor for California port work, not a nice-to-have.</p>
      <p>Because the requirements ratchet up over time, a carrier's California drayage capacity depends on keeping its fleet current with the latest CARB deadlines.</p>`,
    related: ['port-drayage', 'twic', 'reefer-drayage'],
  },
  {
    slug: 'bonded-carrier',
    term: 'Bonded Carrier',
    category: 'Compliance',
    summary: 'A carrier authorized by U.S. Customs to move in-bond freight that has not yet cleared customs.',
    titleQuestion: 'What is a Bonded Carrier?',
    definitionHtml: `
      <p>A bonded carrier is a motor carrier authorized by U.S. Customs and Border Protection to transport freight that has not yet cleared customs. To earn that authorization it posts a customs bond — a financial guarantee that duties and taxes will be paid and that the goods will reach their designated customs destination without being diverted or released prematurely.</p>
      <p>Bonded status matters in drayage because imported containers are frequently moved "in bond" from the port of arrival to an inland customs facility, bonded warehouse, or a container freight station before they are formally entered and cleared. Only a bonded carrier can legally perform that in-bond move.</p>
      <p>The concept overlaps with programs like C-TPAT (a voluntary supply-chain security partnership with CBP), but they are distinct: a customs bond is a financial authorization to carry in-bond cargo, while C-TPAT is a security certification. Both are self-declared credentials to verify directly with the carrier.</p>`,
    related: ['fmcsa-safer', 'uiia', 'hazmat-drayage'],
  },

  // ── Costs ─────────────────────────────────────────────────────────────────
  {
    slug: 'detention-demurrage',
    term: 'Detention & Demurrage',
    category: 'Costs',
    summary: 'Two related charges for holding containers or equipment too long — demurrage on the container at the terminal, detention on the equipment or driver.',
    titleQuestion: 'What are Detention and Demurrage?',
    definitionHtml: `
      <p>Detention and demurrage are the two most common — and most avoidable — accessorial charges in drayage, both essentially penalties for holding something too long. The distinction is what is being held and where.</p>
      <p><strong>Demurrage</strong> is charged by the terminal or ocean carrier when an import container sits at the marine terminal beyond its allotted free time, or when an export container arrives too early. It is, in effect, rent on the container occupying valuable terminal ground. <strong>Detention</strong> is charged when the equipment — the container and chassis — is kept outside the terminal beyond the free time allowed for it to be returned, or when a driver is held too long loading or unloading at a shipper's or consignee's dock.</p>
      <p>A useful shorthand: demurrage is the clock running while the box is inside the terminal; detention is the clock running while the box (or the driver) is outside it. Both accrue daily and add up fast, which is why free-time management and fast turn times are central to profitable drayage.</p>`,
    related: ['free-time', 'per-diem', 'last-free-day', 'street-turn'],
  },
  {
    slug: 'free-time',
    term: 'Free Time',
    category: 'Costs',
    summary: 'The grace period during which a container can sit at a terminal or be used before demurrage, detention, or per-diem charges begin.',
    titleQuestion: 'What is Free Time?',
    definitionHtml: `
      <p>Free time is the grace period a terminal, ocean carrier, or railroad grants before storage and equipment-use charges start. For an import container, it is the number of days the box may remain at the terminal after discharge before demurrage begins; for equipment, it is the days allowed to use and return a container and chassis before detention or per diem starts.</p>
      <p>Free time is typically measured in a handful of calendar or business days and varies by carrier, terminal, and contract. Weekends, holidays, and terminal closures can either count against it or be excluded, depending on the tariff — a detail that materially changes when charges kick in.</p>
      <p>Managing free time is the core financial discipline of drayage. The last day of free time is the "last free day," and getting the container out and the equipment returned before it expires is what keeps a move profitable.</p>`,
    related: ['detention-demurrage', 'last-free-day', 'per-diem'],
  },
  {
    slug: 'per-diem',
    term: 'Per Diem',
    category: 'Costs',
    summary: 'A daily charge for keeping a container or chassis beyond its allotted free time — the "rent" on the equipment itself.',
    titleQuestion: 'What is Per Diem in drayage?',
    definitionHtml: `
      <p>In drayage, per diem is the daily charge an ocean carrier or equipment provider bills for keeping a container or chassis in use beyond the free time allowed. The Latin phrase means "per day," and that is exactly how it works: once the free-time clock runs out, each additional day the equipment is out costs a fixed daily rate until it is returned.</p>
      <p>Per diem is closely related to detention but is specifically the equipment-use component — it is the rent on the container and chassis, distinct from demurrage (rent on the box sitting inside the terminal). Chassis per diem in particular is a frequent line item because a trucker may hold a chassis for several days across a multi-stop move.</p>
      <p>Because per diem accrues automatically and daily, carriers minimize it with tactics like street turns (reusing an empty for the next export rather than returning it) and disciplined equipment return before the last free day.</p>`,
    related: ['detention-demurrage', 'free-time', 'chassis', 'street-turn'],
  },

  // ── Equipment ─────────────────────────────────────────────────────────────
  {
    slug: 'chassis',
    term: 'Chassis',
    category: 'Equipment',
    summary: 'The wheeled steel trailer frame a shipping container is mounted on so a truck can haul it over the road.',
    titleQuestion: 'What is a Chassis?',
    definitionHtml: `
      <p>A chassis is the specialized wheeled trailer frame that a shipping container is locked onto so a truck can pull it on public roads. A container by itself has no wheels; it needs a chassis to become a road-legal trailer. The container's corner castings drop onto the chassis's twist-locks, and the combined unit is what a drayage tractor actually hauls.</p>
      <p>Chassis come in sizes matched to the containers they carry (commonly 20-, 40-, and 45-foot, plus specialized types like tri-axle chassis for heavy loads). Sourcing the right chassis, in good working order, at the right place and time is one of the perennial headaches of drayage.</p>
      <p>Chassis ownership is fragmented across ocean carriers, leasing companies, and pools, which is why concepts like chassis pools, chassis splits, and chassis per diem exist — all of them ways of managing who provides the chassis and who pays for the days it is in use.</p>`,
    related: ['chassis-pool', 'chassis-split', 'per-diem', 'bobtail'],
  },
  {
    slug: 'chassis-pool',
    term: 'Chassis Pool',
    category: 'Equipment',
    summary: 'A shared fleet of chassis that participating carriers draw from and return, rather than each owning their own.',
    titleQuestion: 'What is a Chassis Pool?',
    definitionHtml: `
      <p>A chassis pool is a shared, managed fleet of chassis that multiple trucking companies draw from and return, instead of every carrier maintaining its own equipment. Pools are operated by leasing companies, terminals, or cooperatives, and they let a driver grab an available chassis at a terminal or depot, use it for the move, and return it to any pool location.</p>
      <p>Pools solve the problem that no single carrier can economically position enough chassis everywhere they might be needed. A "gray pool" or neutral pool is one where the chassis are interoperable across many providers, which simplifies picking up and dropping off equipment at busy gateways.</p>
      <p>The tradeoff is that pool availability, condition, and billing (per-diem days start when you take a chassis from the pool) all depend on the pool operator — so pool health directly affects how smoothly drayage flows at a port.</p>`,
    related: ['chassis', 'chassis-split', 'per-diem'],
  },
  {
    slug: 'chassis-split',
    term: 'Chassis Split',
    category: 'Equipment',
    summary: 'When the chassis must be picked up from a different location than the container, forcing an extra, costly trip.',
    titleQuestion: 'What is a Chassis Split?',
    definitionHtml: `
      <p>A chassis split happens when the chassis a driver needs is not available at the same location as the container. Instead of hooking a chassis and grabbing the box in one stop, the driver has to make a separate trip to a depot or pool to pick up (or drop off) the chassis, then travel to the terminal for the container.</p>
      <p>Splits are one of the most disliked inefficiencies in drayage because they add miles, time, and often an accessorial charge for what should be a single move. A "bobtail split" — driving to fetch a chassis with no container attached — burns fuel and hours with no revenue-producing freight on the truck.</p>
      <p>Chassis splits usually stem from equipment imbalances and pool logistics: the right chassis type simply isn't staged where the container is. They are a leading cause of unexpected drayage cost and delay, which is why carriers work to avoid them through pool selection and pre-planning.</p>`,
    related: ['chassis', 'chassis-pool', 'bobtail'],
  },

  // ── Operations ────────────────────────────────────────────────────────────
  {
    slug: 'street-turn',
    term: 'Street Turn',
    category: 'Operations',
    summary: 'Reusing an emptied import container directly for an export load instead of returning it to the terminal first.',
    titleQuestion: 'What is a Street Turn?',
    definitionHtml: `
      <p>A street turn is the practice of taking a container that has just been emptied from an import delivery and reusing it directly for an export load — matching it with a nearby exporter — rather than hauling the empty back to the terminal and then dispatching another truck to fetch an empty for the export.</p>
      <p>Done right, a street turn eliminates two trips to the port: the empty return and the empty pickup. That saves miles, driver hours, chassis per-diem days, and terminal congestion, and it is one of the highest-leverage efficiency moves in drayage. It requires the ocean carrier's approval, because the same carrier's box must be reused and re-tracked.</p>
      <p>The main constraints are timing and matching: an import empty and an export booking for the same ocean carrier and equipment type must line up in the same area within the free-time window. When they do, a street turn is a win for the trucker, the shipper, and the port alike.</p>`,
    related: ['detention-demurrage', 'per-diem', 'bobtail', 'free-time'],
  },
  {
    slug: 'last-free-day',
    term: 'Last Free Day (LFD)',
    category: 'Operations',
    summary: 'The final day a container can be picked up from the terminal before demurrage charges begin.',
    titleQuestion: 'What is the Last Free Day (LFD)?',
    definitionHtml: `
      <p>The Last Free Day, usually abbreviated LFD, is the final day of a container's free time — the last day it can be picked up from the terminal (or, for equipment, returned) before storage or demurrage charges start accruing. After the LFD passes, the daily meter runs.</p>
      <p>The LFD is the single most watched date in a drayage operation. Dispatchers build their scheduling around it: appointments, chassis, and drivers all have to align to get the container out on or before that day. A container that misses its LFD because of a terminal appointment shortage, a chassis split, or a congestion backlog starts generating demurrage that erodes the shipment's margin.</p>
      <p>Because terminals, ocean carriers, and railroads each calculate free time differently — and holidays and closures can shift it — confirming the true LFD for every container is a core discipline of drayage planning.</p>`,
    related: ['free-time', 'detention-demurrage', 'port-drayage'],
  },
  {
    slug: 'bobtail',
    term: 'Bobtail',
    category: 'Operations',
    summary: 'Driving a tractor with no trailer or chassis attached — non-revenue movement that carriers try to minimize.',
    titleQuestion: 'What does Bobtail mean?',
    definitionHtml: `
      <p>To bobtail is to drive a tractor (the truck cab) with nothing attached behind it — no chassis, no container, no trailer. The term paints the picture: a truck running "short" without its tail. In drayage it commonly describes a driver heading to a terminal or depot to pick up equipment, or returning after dropping a load, with an empty tractor.</p>
      <p>Bobtail miles are pure cost with no freight generating revenue, so carriers work hard to reduce them. Fetching a chassis in a chassis split, repositioning between yards, or returning empty from a delivery are all bobtail movements that eat fuel and driver hours.</p>
      <p>Bobtailing also carries a safety note: a tractor without the weight of a trailer over its drive axles handles and brakes differently, which is why it is treated as a distinct operating condition. Minimizing bobtail moves through better dispatch planning — and tactics like street turns — is a mark of an efficient drayage operation.</p>`,
    related: ['chassis-split', 'street-turn', 'chassis'],
  },
  {
    slug: 'transloading',
    term: 'Transloading',
    category: 'Operations',
    summary: 'Transferring freight from an ocean container into domestic trailers or another container to optimize the inland move.',
    titleQuestion: 'What is Transloading?',
    definitionHtml: `
      <p>Transloading is the process of moving freight out of one container or trailer and into another for the next leg of its journey — most commonly transferring the contents of import ocean containers into domestic 53-foot trailers or containers for the inland move. The cargo is handled and reloaded rather than staying in the same box the whole way.</p>
      <p>The economic driver is capacity: three 40-foot ocean containers of goods often fit into two 53-foot domestic trailers. By consolidating, a shipper reduces the number of inland units it has to move and pay for, and it can return the ocean containers to the port quickly to stop per-diem and demurrage.</p>
      <p>Transloading also decouples the international schedule from the domestic one — goods can be staged, mixed, or rerouted at the transload facility — but it adds a handling step and a warehouse cost. It sits alongside pure drayage as a complementary service: drayage brings the box to the transload dock, and transloading takes it from there.</p>`,
    related: ['drayage', 'intermodal-drayage', 'detention-demurrage'],
  },

  // ── Port fees ─────────────────────────────────────────────────────────────
  {
    slug: 'pierpass',
    term: 'PierPASS',
    category: 'Port fees',
    summary: 'A program at the Los Angeles/Long Beach ports that uses a fee and appointment system to shift truck traffic to off-peak hours.',
    titleQuestion: 'What is PierPASS?',
    definitionHtml: `
      <p>PierPASS is a program at the Ports of Los Angeles and Long Beach designed to reduce daytime truck congestion and improve air quality by encouraging cargo owners to move containers during off-peak hours. It is best known for its Traffic Mitigation Fee (TMF), a charge applied to certain container moves that helps fund extended, off-peak terminal gate operations.</p>
      <p>Over time PierPASS has evolved toward an appointment-based model that meters truck arrivals across the day rather than relying purely on peak/off-peak pricing. Either way, the practical effect for drayage is the same: the fee and the terminal's operating windows shape when it is cheapest and least congested to pick up or return a container at the San Pedro Bay ports.</p>
      <p>For a drayage carrier serving LA/Long Beach, understanding PierPASS charges and gate hours is part of quoting a move accurately and scheduling drivers to avoid both congestion and unnecessary fees.</p>`,
    related: ['port-drayage', 'detention-demurrage', 'carb-compliance'],
  },

  // ── Specialized ───────────────────────────────────────────────────────────
  {
    slug: 'hazmat-drayage',
    term: 'Hazmat Drayage',
    category: 'Specialized',
    summary: 'Drayage of hazardous-materials containers, requiring special endorsements, placarding, and routing.',
    titleQuestion: 'What is Hazmat Drayage?',
    definitionHtml: `
      <p>Hazmat drayage is the short-haul movement of containers carrying hazardous materials — chemicals, flammables, corrosives, and other regulated dangerous goods — between ports or rail ramps and nearby facilities. It follows the same first-mile/last-mile pattern as ordinary drayage but under a much stricter regulatory regime.</p>
      <p>Hauling hazmat requires drivers with a Hazardous Materials endorsement on their commercial license (which itself demands a TSA security check), correct placarding of the container, compliant shipping papers, and adherence to routing, parking, and time-in-transit rules for dangerous goods. The carrier must hold the appropriate hazmat operating authority and carry higher insurance limits.</p>
      <p>At the port, hazmat containers often face additional handling requirements and tighter free-time pressure, because terminals limit how long dangerous goods can sit on the ground. That makes prompt, compliant hazmat drayage especially valuable — and a specialty not every drayage carrier offers.</p>`,
    related: ['sms-basic-score', 'bonded-carrier', 'reefer-drayage', 'twic'],
  },
  {
    slug: 'reefer-drayage',
    term: 'Reefer Drayage',
    category: 'Specialized',
    summary: 'Drayage of refrigerated containers, which must stay powered and temperature-controlled the entire move.',
    titleQuestion: 'What is Reefer Drayage?',
    definitionHtml: `
      <p>Reefer drayage is the drayage of refrigerated containers — "reefers" — that carry temperature-sensitive cargo such as produce, seafood, pharmaceuticals, and other perishables. Unlike a dry box, a reefer container has a built-in refrigeration unit that must keep running to hold the cargo at its required temperature throughout the move.</p>
      <p>That live-power requirement changes the operation. At the terminal the container is plugged into a powered rack; the moment it is unplugged for the road leg it runs on its own diesel generator (a "genset") or the chassis's power, and the clock is now ticking on maintaining the cold chain. Drivers must monitor the set-point temperature and minimize the time the unit is off power.</p>
      <p>Reefer drayage carries tighter time pressure and higher stakes than dry drayage — a temperature excursion can ruin an entire load — so it commands specialized equipment (reefer-capable chassis and gensets) and carriers who can prioritize these moves. It is a distinct specialty within drayage, often overlapping with produce and cold-chain logistics.</p>`,
    related: ['chassis', 'hazmat-drayage', 'carb-compliance', 'drayage'],
  },
];

// ─── Lookups ───────────────────────────────────────────────────────────────
const TERM_BY_SLUG = new Map(GLOSSARY_TERMS.map((t) => [t.slug, t]));
export function glossaryTermBySlug(slug: string): GlossaryTerm | undefined {
  return TERM_BY_SLUG.get(slug);
}

// ─── Glossary-specific CSS (matches the directory design tokens) ───────────
const GLOSSARY_CSS = `
  .gl-shell { max-width: 900px; margin: 0 auto; padding: 28px; }
  /* Left-align the hero (shared .hero centers text; glossary must read left-aligned). */
  .gl-hero { padding: 40px 28px 22px; text-align: left; }
  .gl-hero .container-narrow { max-width: 900px; margin: 0; }
  .gl-hero h1 { font-size: 40px; line-height: 1.1; margin: 0 0 10px; }
  .gl-hero p.lead { max-width: 640px; margin-left: 0; margin-right: 0; }
  .gl-hero .hero-cta { justify-content: flex-start; }
  .gl-crumbs { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; color: var(--muted); margin: 0 0 12px; }
  .gl-crumbs a { color: var(--muted); text-decoration: none; }
  .gl-crumbs a:hover { color: var(--accent); }
  .gl-crumbs .sep { margin: 0 8px; opacity: 0.6; }
  .gl-pill { display: inline-block; font-size: 11px; font-family: var(--font-mono); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 12px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent-soft); color: var(--accent); }
  .gl-cat-block { margin: 34px 0 0; }
  .gl-cat-h { display: flex; align-items: baseline; gap: 12px; margin: 0 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .gl-cat-h h2 { font-size: 20px; margin: 0; }
  .gl-cat-h .cnt { font-size: 12px; font-family: var(--font-mono); color: var(--muted); letter-spacing: 0.04em; }
  .gl-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .gl-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px 20px; text-decoration: none; color: inherit; display: block; transition: border-color 0.15s ease, transform 0.15s ease; }
  .gl-card:hover { border-color: var(--border-strong); transform: translateY(-2px); }
  .gl-card h3 { margin: 0 0 6px; font-size: 17px; }
  .gl-card p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
  .gl-def { margin-top: 20px; }
  .gl-def p { font-size: 16px; line-height: 1.65; color: var(--ink-soft); margin: 0 0 16px; }
  .gl-def strong { color: var(--ink); font-weight: 600; }
  .gl-related { margin-top: 32px; }
  .gl-related h2 { font-size: 18px; margin: 0 0 12px; }
  .gl-chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .gl-chip { font-size: 13px; font-family: var(--font-mono); letter-spacing: 0.02em; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft); text-decoration: none; white-space: nowrap; }
  .gl-chip:hover { border-color: var(--accent); color: var(--accent); }
  .gl-cta { margin-top: 32px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 26px; text-align: center; }
  .gl-cta h2 { font-size: 20px; margin: 0 0 8px; }
  .gl-cta p { color: var(--muted); margin: 0 auto 18px; max-width: 480px; line-height: 1.55; }
  .gl-cta .row { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  .gl-toc { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
  .gl-toc a { font-size: 12px; font-family: var(--font-mono); letter-spacing: 0.04em; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); color: var(--ink-soft); text-decoration: none; }
  .gl-toc a:hover { border-color: var(--accent); color: var(--accent); }
  @media (max-width: 640px) {
    .gl-hero h1 { font-size: 30px; }
    .gl-shell, .gl-hero { padding-left: 18px; padding-right: 18px; }
    .gl-grid { grid-template-columns: 1fr; }
    .gl-def p { font-size: 15px; }
  }
`;

interface LayoutOpts {
  title: string;
  description: string;
  canonicalPath: string;
  bodyHtml: string;
  jsonLd?: object[];
}

/**
 * Page shell — replicates the directory/marketing shell (style.css + topnav +
 * footer + favicons) so the glossary is visually identical to /directory and
 * /compliance, plus an optional JSON-LD block.
 */
function layout({ title, description, canonicalPath, bodyHtml, jsonLd }: LayoutOpts): string {
  const jsonLdTags = (jsonLd ?? [])
    .map((obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`)
    .join('\n  ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <script>(function(){try{var t=localStorage.getItem('qf-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();</script>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${esc(canonicalPath)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
  <style>${GLOSSARY_CSS}</style>
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/brand/apple-touch-icon-180.png">
  <link rel="manifest" href="/site.webmanifest">
  <meta name="theme-color" content="#0b0f15">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${SITE}/brand/og-image-1200x630.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/brand/og-image-1200x630.png">
  ${jsonLdTags}
</head>
<body>
  <header class="topnav topnav--mobile-menu">
    <div class="topnav-inner">
      <a href="/" class="brand-mark">
        <span class="logo"><img class="qf-brand-mark" src="/brand/mark-keys-ondark.png" alt="QuoteFleet" width="28" height="30" decoding="async"></span>
        QuoteFleet
      </a>
      <span class="topnav-spacer"></span>
      <a class="nav-link" href="/directory">Directory</a>
      <a class="nav-link" href="/importers">Importers</a>
      <a class="nav-link" href="/compliance">Compliance</a>
      <a class="nav-link" href="/glossary">Glossary</a>
      <a class="btn btn-primary always-show" href="/signup">Claim your listing <span class="arr">→</span></a>
      <button type="button" class="qf-theme-btn" aria-label="Toggle light/dark theme" aria-pressed="false" title="Toggle theme"><svg class="qf-ico-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="qf-ico-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>
      <button type="button" class="topnav-burger" aria-label="Open menu" aria-expanded="false" aria-controls="topnav-mobile-menu">
        <svg class="ico-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
        <svg class="ico-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>
    </div>
    <nav class="topnav-mobile" id="topnav-mobile-menu" hidden aria-label="Site navigation">
      <a href="/directory">Directory</a>
      <a href="/importers">Importers Directory</a>
      <a href="/compliance">Compliance</a>
      <a href="/glossary">Glossary</a>
      <a href="/services">Services</a>
      <a href="/tools">Rate calculator</a>
      <a href="/pricing">Pricing</a>
      <a href="/">Home</a>
      <a class="tn-cta" href="/signup">Claim your listing →</a>
    </nav>
  </header>
  ${bodyHtml}
  <footer class="site-footer">
    © <span id="year"></span> QuoteFleet · <a href="/directory">Directory</a> · <a href="/importers">Importers Directory</a> · <a href="/compliance">Compliance</a> · <a href="/glossary">Glossary</a> · <a href="/drayage-rates">Drayage Rates</a> · <a href="/services">Services</a> · <a href="/marketplace/">Marketplace</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/">Home</a>
  </footer>
  <script>document.getElementById('year').textContent = new Date().getFullYear();</script>
  <script>(function(){var b=document.querySelector('.topnav-burger'),m=document.getElementById('topnav-mobile-menu');if(!b||!m)return;function set(o){b.setAttribute('aria-expanded',o?'true':'false');b.setAttribute('aria-label',o?'Close menu':'Open menu');if(o)m.removeAttribute('hidden');else m.setAttribute('hidden','');}b.addEventListener('click',function(e){e.stopPropagation();set(b.getAttribute('aria-expanded')!=='true');});document.addEventListener('click',function(e){if(b.getAttribute('aria-expanded')==='true'&&!m.contains(e.target)&&!b.contains(e.target))set(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape')set(false);});})();</script>
  <script src="/marketing-chat.js" defer></script>
  <script src="/theme-toggle.js" defer></script>
</body>
</html>`;
}

// ─── Index page ────────────────────────────────────────────────────────────
export function renderGlossaryIndex(): string {
  const catBlocks = GLOSSARY_CATEGORIES.map((cat) => {
    const terms = GLOSSARY_TERMS.filter((t) => t.category === cat).sort((a, b) =>
      a.term.localeCompare(b.term),
    );
    if (!terms.length) return '';
    const anchor = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cards = terms
      .map(
        (t) => `<a class="gl-card" href="/glossary/${esc(t.slug)}">
        <h3>${esc(t.term)}</h3>
        <p>${esc(t.summary)}</p>
      </a>`,
      )
      .join('\n');
    return `<section class="gl-cat-block" id="${esc(anchor)}">
      <div class="gl-cat-h"><h2>${esc(cat)}</h2><span class="cnt">${terms.length} term${terms.length === 1 ? '' : 's'}</span></div>
      <div class="gl-grid">${cards}</div>
    </section>`;
  }).join('\n');

  const toc = GLOSSARY_CATEGORIES.filter((cat) => GLOSSARY_TERMS.some((t) => t.category === cat))
    .map((cat) => {
      const anchor = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `<a href="#${esc(anchor)}">${esc(cat)}</a>`;
    })
    .join('\n');

  // ItemList JSON-LD over every term + BreadcrumbList (Home → Glossary).
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Drayage & Freight Glossary',
    numberOfItems: GLOSSARY_TERMS.length,
    itemListElement: GLOSSARY_TERMS.map((t, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.term,
      url: `${SITE}/glossary/${t.slug}`,
    })),
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Glossary', item: `${SITE}/glossary` },
    ],
  };

  const body = `
  <section class="hero gl-hero">
    <div class="container-narrow">
      <div class="eyebrow" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;">Freight knowledge base</div>
      <h1>Drayage &amp; Freight Glossary</h1>
      <p class="lead">Plain-English definitions of the drayage, intermodal, and freight-compliance terms that shape a container move — written by QuoteFleet. ${GLOSSARY_TERMS.length} terms across ${GLOSSARY_CATEGORIES.length} categories.</p>
      <div class="gl-toc">${toc}</div>
    </div>
  </section>
  <main class="gl-shell">
    ${catBlocks}
    <div class="gl-cta">
      <h2>Ready to move a container?</h2>
      <p>Browse FMCSA-verified drayage and intermodal carriers, or get an instant freight quote in minutes.</p>
      <div class="row">
        <a class="btn btn-primary" href="/directory?intermodal=1">Find drayage carriers <span class="arr">→</span></a>
        <a class="btn btn-secondary" href="/w/demo">Get an instant quote</a>
      </div>
    </div>
  </main>`;

  return layout({
    title: `Drayage & Freight Glossary — ${GLOSSARY_TERMS.length} Terms Defined | QuoteFleet`,
    description: `Clear definitions of ${GLOSSARY_TERMS.length} drayage, intermodal and freight-compliance terms — from demurrage and chassis splits to UIIA, TWIC and TEU. A free QuoteFleet reference.`,
    canonicalPath: '/glossary',
    bodyHtml: body,
    jsonLd: [itemList, breadcrumb],
  });
}

// ─── Term page ─────────────────────────────────────────────────────────────
export function renderGlossaryTerm(term: GlossaryTerm): string {
  const related = term.related
    .map((slug) => glossaryTermBySlug(slug))
    .filter((t): t is GlossaryTerm => !!t);
  const relatedHtml = related.length
    ? `<div class="gl-related">
        <h2>Related terms</h2>
        <div class="gl-chips">${related
          .map((t) => `<a class="gl-chip" href="/glossary/${esc(t.slug)}">${esc(t.term)}</a>`)
          .join('\n')}</div>
      </div>`
    : '';

  const body = `
  <section class="hero gl-hero">
    <div class="container-narrow">
      <nav class="gl-crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span class="sep">/</span><a href="/glossary">Glossary</a><span class="sep">/</span>${esc(term.term)}
      </nav>
      <span class="gl-pill">${esc(term.category)}</span>
      <h1 style="margin-top: 12px;">${esc(term.titleQuestion)}</h1>
    </div>
  </section>
  <main class="gl-shell">
    <div class="gl-def">${term.definitionHtml}</div>
    ${relatedHtml}
    <div class="gl-cta">
      <h2>Need a ${esc(term.term.replace(/\s*\(.*\)\s*/, ''))} carrier?</h2>
      <p>QuoteFleet lists FMCSA-verified drayage and intermodal carriers, and gives shippers an instant freight quote. Find a carrier or price your move now.</p>
      <div class="row">
        <a class="btn btn-primary" href="/directory?intermodal=1">Find drayage carriers <span class="arr">→</span></a>
        <a class="btn btn-secondary" href="/w/demo">Get an instant quote</a>
      </div>
    </div>
    <p style="text-align: center; margin-top: 24px;"><a class="muted-small" href="/glossary">← Back to the full glossary</a></p>
  </main>`;

  // Strip HTML tags from the definition for the DefinedTerm/Article text + meta.
  const plain = term.definitionHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const definedTerm = {
    '@context': 'https://schema.org',
    '@type': 'DefinedTerm',
    name: term.term,
    description: term.summary,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: 'QuoteFleet Drayage & Freight Glossary',
      url: `${SITE}/glossary`,
    },
    url: `${SITE}/glossary/${term.slug}`,
  };
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: term.titleQuestion,
    about: term.term,
    articleSection: term.category,
    description: term.summary,
    articleBody: plain,
    isPartOf: { '@type': 'WebSite', name: 'QuoteFleet', url: SITE },
    publisher: { '@type': 'Organization', name: 'QuoteFleet', url: SITE },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Glossary', item: `${SITE}/glossary` },
      { '@type': 'ListItem', position: 3, name: term.term, item: `${SITE}/glossary/${term.slug}` },
    ],
  };

  return layout({
    title: `${term.titleQuestion} — Drayage Glossary | QuoteFleet`,
    description: `${term.summary} Part of QuoteFleet's free drayage & freight glossary.`,
    canonicalPath: `/glossary/${term.slug}`,
    bodyHtml: body,
    jsonLd: [definedTerm, article, breadcrumb],
  });
}

// ─── Route registration ────────────────────────────────────────────────────
export function registerGlossaryRoutes(app: Express) {
  // Index. The glossary is rendered from a static array — byte-identical for
  // every visitor, no DB read, no per-user branching — so it is the single most
  // CDN-friendly page type we serve. It previously set NO Cache-Control at all,
  // so Cloudflare treated it as DYNAMIC and every crawler hit reached the origin.
  app.get(['/glossary', '/glossary/'], (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderGlossaryIndex());
    } catch (err) {
      next(err);
    }
  });

  // Single term.
  app.get('/glossary/:slug', (req: Request, res: Response, next) => {
    try {
      const term = glossaryTermBySlug(String(req.params.slug).toLowerCase());
      if (!term) return res.redirect(302, '/glossary');
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderGlossaryTerm(term));
    } catch (err) {
      next(err);
    }
  });
}
