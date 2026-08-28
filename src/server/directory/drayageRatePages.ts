/**
 * DRAYAGE RATE PAGES — /drayage-rates and /drayage-rates/:slug
 *
 * WHY THIS PAGE TYPE AND NOT THE OBVIOUS ONES. The tempting programmatic plays
 * here are port×metro "lane" pages and equipment×state carrier pages. Both were
 * evaluated and REJECTED:
 *
 *   • Lane pages (port → metro) multiply into thousands of URLs whose only
 *     difference is two proper nouns. That is the pattern Google's doorway-abuse
 *     policy names verbatim ("substantially similar pages"). We also have no
 *     per-lane proprietary rate data to differentiate them with — the honest
 *     version of that page type needs real quote volume per corridor, which we
 *     will have after launch, not before.
 *   • Equipment×state pages are the exact format otrucking.com built on the same
 *     public FMCSA file. It is in free-fall (-66% MoM, 29-second average visit).
 *     Reformatted public data is the City-data.com bucket: an LLM answers it
 *     without the click.
 *   • Port hubs and city hubs already exist (/directory/port/:code × 60,
 *     /directory/{state}/{city} × ~24.7k) and already rank for "[port] drayage
 *     carriers". Rebuilding them under a new prefix would be self-cannibalising.
 *
 * What we DO hold that nobody else publishes is the actual money: a researched
 * base drayage tariff per port (DEFAULT_DRAYAGE_TARIFFS — three distance rings
 * per port) and a full drayage accessorial schedule (DEFAULT_ACCESSORIALS —
 * chassis split, prepull, flip, PierPass, congestion, triaxle...). Those are the
 * numbers a shipper actually searches for and the ones an LLM cannot synthesise
 * from public data. So this page type is deliberately SMALL — one page per port
 * where we have a real tariff, currently 11 — and each page leads with price.
 *
 * ANTI-SCAN CONTRACT. Every DB read on these pages goes through the SAME two
 * calls the existing port hub makes — listCarriers({filters}) and
 * getFacetCounts(filters) with a port filter — so they inherit
 * carrier_directory_port_featured_idx, the bounded aggregate semaphore, the
 * statement timeouts, the SWR facet cache and the honest `unavailable`
 * degradation. No new query shape is introduced, so there is nothing new to
 * index. Responses are byte-identical for every visitor and go out under
 * setPublicDirectoryCache (s-maxage 86400), so at 11 URLs the origin cost is
 * bounded to a daily refresh.
 *
 * HONESTY RULE (mirrors servicePages' honestyBanner). The ring prices are
 * QuoteFleet's researched base tariff for a 40' container, not a market index
 * and not a quote. Every page says so in the methodology note, and the facet
 * counts are omitted rather than shown as 0 when the aggregate layer degrades.
 */
import type { Express, Request, Response } from 'express';
import { layout, esc } from './pages.js';
import { setPublicDirectoryCache } from './httpCache.js';
import {
  listCarriers,
  getFacetCounts,
  normalizeFilters,
  EQUIPMENT_OPTIONS,
  type FacetCounts,
} from './queries.js';
import { PORT_GROUPS, portGroupByCode, type PortGroup } from './containerPorts.js';
import { INTERMODAL_TERMINALS } from './terminals.js';
import { US_STATES } from './usStates.js';
import { DEFAULT_DRAYAGE_TARIFFS, DEFAULT_ACCESSORIALS } from '../../calc/defaults.js';

const SITE = 'https://quotefleet.net';

/** Container-size multipliers off the 40' base, documented at the tariff table
 *  in calc/defaults.ts ("20' is ~85% of these, 45' is ~110%"). */
const SIZE_FACTORS: ReadonlyArray<{ label: string; factor: number }> = [
  { label: "20' standard", factor: 0.85 },
  { label: "40' / 40' HC", factor: 1 },
  { label: "45' HC", factor: 1.1 },
];

/** The accessorials that actually show up on a drayage invoice, in the order a
 *  shipper meets them. Pulled from DEFAULT_ACCESSORIALS so the page can never
 *  drift from the engine's own schedule. */
const DRAYAGE_ACCESSORIAL_CODES = [
  'chassis_rental',
  'chassis_split',
  'prepull',
  'flip_fee',
  'pier_pass',
  'port_congestion',
  'triaxle',
  'detention',
  'storage',
  'drop_hook',
  'hazmat',
  'reefer_genset',
  'in_bond',
] as const;

interface RingBand {
  radius: number;
  price: number;
}

export interface DrayageRatePort {
  slug: string;
  /** PORT_GROUPS code — the canonical hub this page cross-links to. */
  groupCode: string;
  rings: RingBand[];
  /** Our own framing of what makes drayage out of this gateway distinctive. */
  intro: string;
  faqs: Array<{ q: string; a: string }>;
}

/** Tariff portCode → PORT_GROUPS code. LA/LGB merge into USLALB and Seattle/
 *  Tacoma into USSEA (identical tariffs); Norfolk's tariff row uses the legacy
 *  'USNOR' code while the hub is 'USORF'. */
const TARIFF_TO_GROUP: Record<string, string> = {
  USLAX: 'USLALB',
  USLGB: 'USLALB',
  USSEA: 'USSEA',
  USTIW: 'USSEA',
  USNOR: 'USORF',
};

/** Editorial per gateway. This is the part that cannot be generated — it is why
 *  each page is worth existing rather than being a keyword swap. */
const PORT_COPY: Record<string, { slug: string; intro: string; faqs: Array<{ q: string; a: string }> }> = {
  USLALB: {
    slug: 'los-angeles-long-beach',
    intro:
      'San Pedro Bay moves more containers than any other US gateway, and its drayage market is priced accordingly: a dense local pool inside the 30-mile LA Basin ring, then a steep step up to the Inland Empire warehouses in Fontana, Ontario and Moreno Valley. Two things dominate the invoice here that barely register elsewhere — PierPass/TMF on weekday daytime moves, and chassis splits, because the LA/LB chassis pool is shared across three terminals and a split can add a full extra turn.',
    faqs: [
      { q: 'Why is an Inland Empire move so much more than a local LA move?', a: 'It is a different ring, not a longer drive. A local Basin move is a same-day round turn; a Fontana or Moreno Valley delivery at 55-70 miles usually consumes the driver\'s whole day, so it prices off the 30-60 mile band and often the 60-150 band once you are past Riverside.' },
      { q: 'What is PierPass and is it in the rate?', a: 'PierPass is the Traffic Mitigation Fee on weekday daytime cargo moves at LA/Long Beach. It is a pass-through, so it sits outside the base ring rate — see the accessorial table below for the current amount.' },
      { q: 'Does the rate change between the Port of LA and the Port of Long Beach?', a: 'No. The two ports sit on the same harbour and draw on the same carrier and chassis pools, so we price them as one gateway. Which terminal you pull from affects turn time and chassis availability, not the base ring.' },
    ],
  },
  USNYC: {
    slug: 'new-york-new-jersey',
    intro:
      'Port Newark-Elizabeth is the East Coast\'s largest gateway and its most expensive to dray, for reasons that are structural rather than seasonal: tolls, congestion on the Turnpike corridor, and a delivery footprint that crosses three states inside the 60-mile ring. A move into Brooklyn or Queens can cost more than one twice the distance into central New Jersey.',
    faqs: [
      { q: 'Why does a short move into the boroughs price like a long one?', a: 'Bridge and tunnel tolls, restricted truck routes and dwell at the receiver. Distance is only one input — the New York rings assume a round turn, and a Brooklyn delivery rarely gives you one.' },
      { q: 'Which states fall inside the 60-mile ring from Port Newark?', a: 'Most of northern and central New Jersey, New York City and the lower Hudson Valley, and the eastern edge of Pennsylvania around Easton. Philadelphia and Allentown sit in the 60-150 band.' },
      { q: 'Is a triaxle chassis needed here?', a: 'For overweight containers, usually yes. New Jersey enforces axle weights tightly on the port approaches, so heavy boxes move on a triaxle and carry the surcharge in the table below.' },
    ],
  },
  USSAV: {
    slug: 'savannah',
    intro:
      'Garden City Terminal is the largest single container terminal in North America, and Savannah\'s drayage economics are unusually clean because of it: one terminal, no harbour crossing, and a warehouse belt that grew up along I-16 and the Pooler/Bloomingdale corridor inside the 30-mile ring. The pressure point at Savannah is not distance, it is dwell — when vessel bunching pushes gate queues out, prepull and yard storage do more to the invoice than mileage does.',
    faqs: [
      { q: 'Why is Savannah cheaper to dray than New York or LA?', a: 'A single terminal, free-flowing interstate access and a local warehouse belt inside 30 miles mean more round turns per driver per day. Fewer wasted hours is the whole reason the base ring is lower.' },
      { q: 'What is a prepull and when will I be charged one?', a: 'The carrier pulls your container off the terminal before the last free day and holds it in their yard. You pay a prepull plus per-night yard storage, but you avoid port demurrage — which is almost always the more expensive of the two.' },
      { q: 'Does Atlanta fall inside these rings?', a: 'No. Atlanta is roughly 250 miles from Garden City, past the 150-mile band, so it prices off a per-mile linehaul rate rather than a flat drayage ring.' },
    ],
  },
  USHOU: {
    slug: 'houston',
    intro:
      'Houston drays out of Barbours Cut and Bayport, and the market is shaped by two things you do not see at the coastal container gateways: a very large resin and petrochemical export flow, and long dray distances inside the metro itself. The 30-mile ring from Barbours Cut does not reach the west-side warehouse parks, so a surprising share of Houston moves price off the 30-60 band.',
    faqs: [
      { q: 'Why do so many Houston moves land in the 30-60 mile ring?', a: 'The container terminals sit on the east side of the ship channel while much of the warehouse and transload capacity is north and west of the city. Crossing Houston is what puts the move in the next band.' },
      { q: 'Do resin exports price differently?', a: 'The base ring is the same, but export resin usually adds a transload or bagging stop and often a scale ticket for weight verification. Those are accessorials, not a different linehaul.' },
      { q: 'Is Barbours Cut or Bayport cheaper?', a: 'They price the same. The two terminals are about eight miles apart and draw on the same carrier pool; the difference shows up in gate turn times, not the base tariff.' },
    ],
  },
  USORF: {
    slug: 'norfolk-virginia',
    intro:
      'The Port of Virginia is the deepest harbour on the US East Coast and the most rail-oriented — a large share of its boxes leave on the Heartland Corridor rather than on a chassis. That makes the local dray market smaller and steadier than Savannah\'s or New York\'s, with a tight Hampton Roads ring and a well-worn 60-150 mile run up to Richmond.',
    faqs: [
      { q: 'How much of Norfolk\'s volume actually moves by truck?', a: 'A minority of it. The Port of Virginia is unusually rail-heavy, so the drayage pool is smaller than the port\'s TEU rank suggests — which is exactly why carrier availability, not price, is the thing to check first here.' },
      { q: 'Is Richmond a drayage move or a linehaul?', a: 'Richmond is roughly 90 miles from Norfolk International Terminals, so it sits inside the 60-150 mile band and still prices as flat drayage rather than per-mile linehaul.' },
      { q: 'Does the harbour crossing affect the rate?', a: 'It affects the turn, not the band. Moves that have to cross the Hampton Roads tunnels can lose an hour to congestion, which shows up as detention if the receiver is slow.' },
    ],
  },
  USCHS: {
    slug: 'charleston',
    intro:
      'Charleston splits its container volume across Wando Welch and the newer Leatherman terminal, and its drayage market is defined by the inland manufacturing it serves — the BMW and tyre plants up the I-26 corridor pull a steady flow of boxes well past the 60-mile ring toward Greenville and Spartanburg.',
    faqs: [
      { q: 'Does the Inland Port at Greer change the rate?', a: 'Yes, materially. Boxes railed to Inland Port Greer are drayed locally at the Greer end rather than trucked the full 200+ miles from Charleston, so compare the two routings before assuming a long dray.' },
      { q: 'Which terminal will my container be at?', a: 'Wando Welch handles most of the container volume, with Leatherman taking a growing share. The base ring is the same for both; the practical difference is gate hours and queue length.' },
      { q: 'How far up the I-26 corridor do these rings reach?', a: 'Columbia at roughly 110 miles is inside the 60-150 band. Greenville and Spartanburg are past it and price off a per-mile rate.' },
    ],
  },
  USSEA: {
    slug: 'seattle-tacoma',
    intro:
      'Seattle and Tacoma operate as one gateway under the Northwest Seaport Alliance, and their drayage market carries a constraint no other US port has to the same degree: the Puget Sound geography funnels almost everything onto I-5. A Kent or Auburn warehouse is close in miles and expensive in hours. Washington also runs the strictest clean-truck expectations on the West Coast outside California.',
    faqs: [
      { q: 'Are Seattle and Tacoma priced separately?', a: 'No. They are jointly managed by the Northwest Seaport Alliance and share a carrier pool, so we publish one tariff for the gateway. Which terminal your box lands at changes the drive, not the band.' },
      { q: 'Why is the Kent Valley more expensive than the mileage suggests?', a: 'I-5 and SR-167 congestion. The warehouse belt between Kent, Auburn and Sumner is 20-35 miles out but routinely takes as long as a 60-mile run elsewhere, so it prices toward the upper end of its ring.' },
      { q: 'Does Portland fall inside these rings?', a: 'No. Portland is about 145 miles from Seattle but is its own container gateway with its own carrier pool, so it is quoted as a separate origin rather than a Seattle delivery.' },
    ],
  },
  CAVAN: {
    slug: 'vancouver',
    intro:
      'Vancouver is Canada\'s largest port and its drayage market is shaped by a hard geographic squeeze: the terminals sit in Burrard Inlet and Deltaport, the warehouses sit in Surrey, Delta and Langley, and everything in between is bridge-constrained. Vancouver also runs a truck licensing system, so the carrier pool that can legally serve the terminals is smaller and more tightly regulated than at a US gateway.',
    faqs: [
      { q: 'Why is Vancouver drayage more expensive than a comparable US port?', a: 'A licensed and capped truck pool, bridge-constrained geography, and higher operating costs. The licensing system in particular means you cannot simply add capacity when volumes spike.' },
      { q: 'Does the rate cover both Centerm and Deltaport?', a: 'Yes, but they are on opposite sides of the harbour. A Deltaport pull to a Surrey warehouse is a very different drive from a Centerm pull to the same place, so confirm the terminal before you commit to a ring.' },
      { q: 'Are these rates in Canadian dollars?', a: 'The tariff is published in USD like the rest of our table. Confirm the settlement currency with the carrier — Canadian drayage is commonly invoiced in CAD.' },
    ],
  },
  CAMTR: {
    slug: 'montreal',
    intro:
      'Montreal is the deepest inland container port in North America — an ocean vessel sails roughly 1,000 miles up the St. Lawrence to reach it — which means the dray leg out of Montreal is often replacing what would otherwise be a long inland move from a coastal port. Its local market is bilingual, seasonal, and heavily oriented toward Ontario and the US Northeast.',
    faqs: [
      { q: 'Why route through Montreal instead of New York?', a: 'For cargo bound for Quebec, eastern Ontario or the US Northeast interior, the ocean leg up the St. Lawrence replaces several hundred miles of inland trucking. The dray at the Montreal end is short by comparison.' },
      { q: 'Does winter change drayage rates?', a: 'The base tariff does not change, but winter reliably adds cost through delays, longer turn times and equipment issues — which surface as detention and storage rather than a higher linehaul.' },
      { q: 'Is Toronto inside these rings?', a: 'No. Toronto is roughly 335 miles from Montreal and prices as a linehaul, not a dray. Ottawa, at about 120 miles, is inside the 60-150 band.' },
    ],
  },
  CAHAL: {
    slug: 'halifax',
    intro:
      'Halifax is the first inbound and last outbound call on many North Atlantic services and can take the largest vessels without tidal restriction. Its local drayage market is genuinely small — the Halifax metro is the demand base, and most volume leaves on CN rail rather than a chassis — so the practical question here is carrier availability rather than price band.',
    faqs: [
      { q: 'How large is the Halifax drayage pool?', a: 'Small compared with any US gateway of similar TEU rank, because most containers leave Halifax by rail. Book early; the constraint is trucks available, not the tariff.' },
      { q: 'What is inside the 60-150 mile ring from Halifax?', a: 'Truro at roughly 60 miles and the corridor toward Amherst. Moncton, at about 110 miles, is inside the outer band; Saint John is a separate gateway.' },
      { q: 'Does the rate include the rail alternative?', a: 'No. This tariff prices the truck move only. If your box is railing inland from Halifax, the dray you pay for happens at the destination ramp instead.' },
    ],
  },
  CAPRR: {
    slug: 'prince-rupert',
    intro:
      'Prince Rupert is the outlier on this list and the reason its tariff is the highest: it is a transload-and-rail gateway with the shortest sailing from Asia to North America, but almost no local demand base. Over 90% of its containers leave directly on CN rail. Local drayage exists mainly to serve the transload facilities, so the pool is tiny and prices reflect scarcity, not distance.',
    faqs: [
      { q: 'Why is Prince Rupert the most expensive gateway on this list?', a: 'Scarcity. There is very little local freight demand to balance a truck against, so a carrier cannot easily fill a return leg. That imbalance, not mileage, sets the price.' },
      { q: 'Should I be draying out of Prince Rupert at all?', a: 'Usually not. The port exists to move boxes onto CN rail toward Chicago, Memphis and Toronto. If your cargo is not transloading locally, the dray you actually need is at the inland ramp.' },
      { q: 'What is within 150 miles?', a: 'Terrace at roughly 90 miles, and very little else. This is the thinnest local market of any gateway we publish a tariff for.' },
    ],
  },
};

/** The published set — one entry per port group where we hold a REAL tariff and
 *  have written real editorial. Deliberately not "every port in PORT_GROUPS". */
export const DRAYAGE_RATE_PORTS: DrayageRatePort[] = (() => {
  const byGroup = new Map<string, RingBand[]>();
  for (const t of DEFAULT_DRAYAGE_TARIFFS) {
    const group = TARIFF_TO_GROUP[t.portCode] ?? t.portCode;
    if (byGroup.has(group)) continue; // merged gateways share one tariff
    byGroup.set(
      group,
      t.rings.map((r) => ({ radius: r.radius, price: r.price })),
    );
  }
  const out: DrayageRatePort[] = [];
  for (const [groupCode, rings] of byGroup) {
    const copy = PORT_COPY[groupCode];
    // No editorial → no page. This is the gate that keeps the set honest: a
    // gateway cannot slip in on tariff data alone.
    if (!copy || !portGroupByCode(groupCode)) continue;
    out.push({ slug: copy.slug, groupCode, rings, intro: copy.intro, faqs: copy.faqs });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
})();

const BY_SLUG = new Map(DRAYAGE_RATE_PORTS.map((p) => [p.slug, p]));

export function drayageRatePortBySlug(slug: string): DrayageRatePort | null {
  return BY_SLUG.get(String(slug).toLowerCase()) ?? null;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const RATE_CSS = `
  .dr-wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 56px; }
  .dr-lede { color: var(--ink-soft); max-width: 68ch; line-height: 1.65; margin: 10px 0 22px; }
  .dr-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .dr-table th, .dr-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .dr-table th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); font-weight: 600; }
  .dr-table td.num { font-family: var(--font-mono); white-space: nowrap; }
  .dr-scroll { overflow-x: auto; }
  .dr-note { font-size: 13px; color: var(--ink-soft); line-height: 1.6; margin-top: 12px; max-width: 72ch; }
  .dr-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin: 12px 0 4px; }
  .dr-stat { border: 1px solid var(--border); border-radius: var(--radius-card, 12px); padding: 14px 16px; background: var(--surface); }
  .dr-stat b { display: block; font-size: 22px; font-family: var(--font-mono); }
  .dr-stat span { font-size: 12px; color: var(--ink-soft); }
  .dr-faq { margin-top: 10px; }
  .dr-faq h3 { font-size: 15px; margin: 18px 0 6px; }
  .dr-faq p { color: var(--ink-soft); line-height: 1.65; margin: 0; max-width: 72ch; }
  @media (max-width: 560px) { .dr-wrap { padding: 0 14px 40px; } }
`;

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function ringLabel(rings: RingBand[], i: number): string {
  const from = i === 0 ? 0 : rings[i - 1].radius;
  return `${from}-${rings[i].radius} mi`;
}

function rateTable(p: DrayageRatePort): string {
  const head = p.rings.map((_, i) => `<th scope="col">${esc(ringLabel(p.rings, i))}</th>`).join('');
  const rows = SIZE_FACTORS.map(
    (s) =>
      `<tr><th scope="row">${esc(s.label)}</th>${p.rings
        .map((r) => `<td class="num">${esc(money(r.price * s.factor))}</td>`)
        .join('')}</tr>`,
  ).join('');
  return `<div class="dr-scroll"><table class="dr-table">
    <caption class="visually-hidden">Base drayage rate by container size and distance ring</caption>
    <thead><tr><th scope="col">Container</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function accessorialTable(): string {
  const rows = DRAYAGE_ACCESSORIAL_CODES.map((code) => {
    const a = DEFAULT_ACCESSORIALS.find((x) => x.code === code);
    if (!a) return '';
    const amount =
      a.kind === 'pct_of_base'
        ? `${a.amount}% of base`
        : a.kind === 'per_hour'
          ? `${money(Number(a.amount))} / hr`
          : a.kind === 'per_day'
            ? `${money(Number(a.amount))} / day`
            : money(Number(a.amount));
    return `<tr><th scope="row">${esc(a.label)}</th><td class="num">${esc(amount)}</td><td>${esc(a.description ?? '')}</td></tr>`;
  }).join('');
  return `<div class="dr-scroll"><table class="dr-table">
    <caption class="visually-hidden">Common drayage accessorial charges</caption>
    <thead><tr><th scope="col">Accessorial</th><th scope="col">Typical</th><th scope="col">When it applies</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** Carrier supply for this gateway, from the SAME facet counts the port hub
 *  uses. Renders nothing rather than a fabricated 0 when the aggregate layer
 *  degrades — the honesty rule from queries.ts FacetCounts.unavailable. */
function supplyBlock(group: PortGroup, total: number, counts: FacetCounts): string {
  const cards: string[] = [];
  if (total > 0) {
    cards.push(
      `<div class="dr-stat"><b>${total.toLocaleString('en-US')}</b><span>FMCSA carriers near this gateway</span></div>`,
    );
  }
  if (!counts.unavailable) {
    for (const eq of EQUIPMENT_OPTIONS) {
      const n = counts.equipment?.[eq.id];
      if (typeof n === 'number' && n > 0) {
        cards.push(`<div class="dr-stat"><b>${n.toLocaleString('en-US')}</b><span>${esc(eq.label)}</span></div>`);
      }
    }
  }
  if (!cards.length) return '';
  return `<h2>Carrier supply at ${esc(group.label)}</h2>
    <p class="dr-lede">Live counts from our FMCSA carrier directory, for operators whose registered domicile puts this gateway nearest. Equipment flags are as reported to FMCSA.</p>
    <div class="dr-grid">${cards.join('')}</div>
    <p class="dr-note"><a href="/directory/port/${esc(group.code)}">Browse all carriers near ${esc(group.label)} →</a></p>`;
}

function terminalsBlock(group: PortGroup): string {
  const members = new Set<string>([group.code, ...group.memberCodes]);
  const rows = INTERMODAL_TERMINALS.filter((t) => members.has(t.code));
  if (!rows.length) return '';
  return `<h2>Terminals</h2><div class="dr-scroll"><table class="dr-table">
    <thead><tr><th scope="col">Terminal</th><th scope="col">Operator</th><th scope="col">Address</th></tr></thead>
    <tbody>${rows
      .map(
        (t) =>
          `<tr><th scope="row">${esc(t.name)}</th><td>${esc(t.operator ?? '—')}</td><td>${esc(t.address ?? '—')}</td></tr>`,
      )
      .join('')}</tbody>
  </table></div>`;
}

function faqBlock(p: DrayageRatePort): string {
  return `<h2>Common questions</h2><div class="dr-faq">${p.faqs
    .map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`)
    .join('')}</div>`;
}

function methodologyNote(group: PortGroup): string {
  return `<p class="dr-note"><strong>How to read this.</strong> These are QuoteFleet's researched base drayage tariffs for ${esc(
    group.label,
  )} — a flat rate per container by distance ring, for the truck move only. They are an estimate band to sanity-check a quote against, <strong>not</strong> a market index, a spot rate, or an offer. Fuel, chassis, terminal fees and the accessorials listed below sit on top. Beyond 150 miles a move prices per-mile as linehaul rather than as drayage. Rates are USD for a standard dry container and move with fuel and market conditions.</p>`;
}

export function renderDrayageRatePage(
  p: DrayageRatePort,
  group: PortGroup,
  total: number,
  counts: FacetCounts,
): string {
  const state = US_STATES.find((s) => s.code === group.state);
  const body = `<main class="dr-wrap">
    <nav aria-label="Breadcrumb" class="dr-note" style="margin:18px 0 6px;">
      <a href="/">Home</a> / <a href="/drayage-rates">Drayage rates</a> / ${esc(group.label)}
    </nav>
    <h1>${esc(group.label)} drayage rates</h1>
    <p class="dr-lede">${esc(p.intro)}</p>

    <h2>Base rate by container size and distance</h2>
    ${rateTable(p)}
    ${methodologyNote(group)}

    ${supplyBlock(group, total, counts)}

    <h2>What sits on top of the base rate</h2>
    <p class="dr-lede">Drayage invoices are rarely just the linehaul. These are the charges that most often appear, at our default schedule.</p>
    ${accessorialTable()}

    ${terminalsBlock(group)}

    ${faqBlock(p)}

    <h2>Next steps</h2>
    <p class="dr-lede">Price a specific move with the <a href="/tools">free drayage rate calculator</a>, browse
      <a href="/directory/port/${esc(group.code)}">carriers serving ${esc(group.label)}</a>${
        state ? `, or see every carrier in <a href="/directory/${esc(state.slug)}">${esc(state.name)}</a>` : ''
      }. New to the terminology? The <a href="/glossary">freight glossary</a> covers
      <a href="/glossary/drayage">drayage</a>, <a href="/glossary/detention-demurrage">detention and demurrage</a>
      and <a href="/glossary/chassis-split">chassis splits</a>.</p>
    <p class="dr-note"><a href="/drayage-rates">← All port drayage rates</a></p>
  </main>`;

  const cheapest = Math.min(...p.rings.map((r) => r.price)) * SIZE_FACTORS[0].factor;
  const dearest = Math.max(...p.rings.map((r) => r.price)) * SIZE_FACTORS[2].factor;

  return layout({
    title: `${group.label} Drayage Rates — Container Trucking Cost by Distance | QuoteFleet`,
    description: `Base drayage rates from ${group.label} by distance ring and container size, plus the chassis, prepull, detention and terminal accessorials that land on the invoice. Researched tariffs, updated with market conditions.`,
    canonicalPath: `/drayage-rates/${p.slug}`,
    bodyHtml: `<style>${RATE_CSS}</style>${body}`,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Drayage rates', item: `${SITE}/drayage-rates` },
          { '@type': 'ListItem', position: 3, name: `${group.label} drayage rates`, item: `${SITE}/drayage-rates/${p.slug}` },
        ],
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Service',
        serviceType: 'Container drayage',
        name: `${group.label} container drayage`,
        areaServed: { '@type': 'Place', name: `${group.city}, ${group.state}` },
        provider: { '@type': 'Organization', name: 'QuoteFleet', url: `${SITE}/` },
        offers: {
          '@type': 'AggregateOffer',
          priceCurrency: 'USD',
          lowPrice: Math.round(cheapest),
          highPrice: Math.round(dearest),
          offerCount: p.rings.length * SIZE_FACTORS.length,
        },
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: p.faqs.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      }),
    ],
  });
}

export function renderDrayageRatesHub(): string {
  const rows = DRAYAGE_RATE_PORTS.map((p) => {
    const g = portGroupByCode(p.groupCode);
    if (!g) return '';
    const low = Math.min(...p.rings.map((r) => r.price));
    return `<tr>
      <th scope="row"><a href="/drayage-rates/${esc(p.slug)}">${esc(g.label)}</a></th>
      <td>${esc(g.city)}, ${esc(g.state)}</td>
      <td class="num">from ${esc(money(low * SIZE_FACTORS[0].factor))}</td>
    </tr>`;
  }).join('');

  const body = `<main class="dr-wrap">
    <nav aria-label="Breadcrumb" class="dr-note" style="margin:18px 0 6px;"><a href="/">Home</a> / Drayage rates</nav>
    <h1>Port drayage rates</h1>
    <p class="dr-lede">What it actually costs to truck a container out of a North American gateway, by distance ring and container size. We publish a researched base tariff for every port where we have one — ${DRAYAGE_RATE_PORTS.length} gateways — plus the accessorial schedule that lands on top of the linehaul. These are estimate bands to check a quote against, not a market index.</p>
    <div class="dr-scroll"><table class="dr-table">
      <thead><tr><th scope="col">Gateway</th><th scope="col">Location</th><th scope="col">20' local move</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="dr-note">Prices are USD for a standard dry container, local ring, truck move only. Open a gateway for its full ring table, carrier supply and accessorials.</p>
    <h2>Related</h2>
    <p class="dr-lede"><a href="/tools">Drayage rate calculator</a> · <a href="/directory">Carrier directory</a> ·
      <a href="/services">Drayage services by specialty</a> · <a href="/glossary">Freight glossary</a></p>
  </main>`;

  return layout({
    title: `Port Drayage Rates by Gateway — Container Trucking Costs | QuoteFleet`,
    description: `Researched base drayage rates for ${DRAYAGE_RATE_PORTS.length} North American container gateways, by distance ring and container size, with the chassis, prepull, detention and terminal fees that land on the invoice.`,
    canonicalPath: '/drayage-rates',
    bodyHtml: `<style>${RATE_CSS}</style>${body}`,
    jsonLd: [
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Drayage rates', item: `${SITE}/drayage-rates` },
        ],
      }),
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: DRAYAGE_RATE_PORTS.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: portGroupByCode(p.groupCode)?.label ?? p.slug,
          url: `${SITE}/drayage-rates/${p.slug}`,
        })),
      }),
    ],
  });
}

// ─── Route registration ─────────────────────────────────────────────────────
export function registerDrayageRateRoutes(app: Express) {
  app.get(['/drayage-rates', '/drayage-rates/'], (req: Request, res: Response, next) => {
    try {
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderDrayageRatesHub());
    } catch (err) {
      next(err);
    }
  });

  app.get('/drayage-rates/:slug', async (req: Request, res: Response, next) => {
    try {
      const p = drayageRatePortBySlug(String(req.params.slug).toLowerCase());
      if (!p) return res.redirect(302, '/drayage-rates');
      const group = portGroupByCode(p.groupCode);
      if (!group) return res.redirect(302, '/drayage-rates');
      // The SAME two reads the /directory/port/:port hub makes, so this page
      // rides carrier_directory_port_featured_idx and the bounded aggregate
      // guards — no new query shape, nothing new to index.
      const filters = normalizeFilters({}, { port: group.code, state: null, citySlug: null });
      const [list, counts] = await Promise.all([
        listCarriers({ filters, perPage: 1 }),
        getFacetCounts(filters),
      ]);
      setPublicDirectoryCache(req, res);
      res.type('html').send(renderDrayageRatePage(p, group, list.total, counts));
    } catch (err) {
      next(err);
    }
  });
}

/** Exported for the sitemap builder. */
export const DRAYAGE_RATE_SLUGS = DRAYAGE_RATE_PORTS.map((p) => p.slug);
export { PORT_GROUPS };
