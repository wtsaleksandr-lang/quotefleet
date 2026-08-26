/**
 * Curated HS-code + commodity reference for the Importer Search autosuggest.
 *
 * Powers the "Commodity / HS code" combobox on /importers: the user can type a
 * code (e.g. `8202`) OR a description word (e.g. `saw blades`, `furniture`) and
 * get matching suggestions. This is a hand-picked list of the frequently-imported
 * headings across the common chapters — NOT the full ~5k-line HTS. It is
 * deliberately kept to a few hundred rows so it can serve fast, in-memory
 * suggestions with no external call (ImportYeti is NEVER hit for suggestions).
 *
 * Pure + dependency-free so it unit-tests without the server. `suggestCommodity`
 * matches on the CODE or on any word of the DESCRIPTION, ranks exact/prefix hits
 * first, and returns a bounded list.
 */

/** One reference row: a 4-digit heading (or common 6-digit subheading) + label. */
export interface HsRef {
  /** HS code — 4 or 6 digits, as a string (leading zeros preserved). */
  code: string;
  /** Short human description of the goods. */
  description: string;
}

/**
 * Curated common-import HS headings. Kept compact (code, description). Covers the
 * chapters that dominate US container imports: food, chemicals, plastics/rubber,
 * wood/paper, textiles/apparel/footwear, stone/glass/ceramic, base metals + tools,
 * machinery, electronics, vehicles, furniture, toys and misc manufactured goods.
 */
export const HS_CODES: readonly HsRef[] = [
  // ── Live plants / food / agriculture (Ch. 06–24) ──
  { code: '0603', description: 'Cut flowers, fresh or dried' },
  { code: '0709', description: 'Fresh vegetables' },
  { code: '0803', description: 'Bananas, fresh or dried' },
  { code: '0805', description: 'Citrus fruit, fresh or dried' },
  { code: '0806', description: 'Grapes, fresh or dried' },
  { code: '0901', description: 'Coffee, roasted or not' },
  { code: '0902', description: 'Tea' },
  { code: '1006', description: 'Rice' },
  { code: '1509', description: 'Olive oil' },
  { code: '1806', description: 'Chocolate and cocoa preparations' },
  { code: '1905', description: 'Bread, pastry, biscuits and cakes' },
  { code: '2009', description: 'Fruit and vegetable juices' },
  { code: '2103', description: 'Sauces, condiments and seasonings' },
  { code: '2106', description: 'Food preparations, misc.' },
  { code: '2202', description: 'Non-alcoholic beverages, waters' },
  { code: '2204', description: 'Wine of fresh grapes' },
  { code: '2208', description: 'Spirits, liqueurs and distilled beverages' },
  // ── Mineral / chemical (Ch. 25–38) ──
  { code: '2515', description: 'Marble, travertine and building stone' },
  { code: '2523', description: 'Portland cement' },
  { code: '2710', description: 'Petroleum oils (not crude)' },
  { code: '2836', description: 'Carbonates (soda ash, etc.)' },
  { code: '2917', description: 'Polycarboxylic acids' },
  { code: '2933', description: 'Heterocyclic nitrogen compounds' },
  { code: '3004', description: 'Medicaments, packaged for retail' },
  { code: '3208', description: 'Paints and varnishes' },
  { code: '3304', description: 'Beauty, makeup and skincare preparations' },
  { code: '3305', description: 'Hair preparations (shampoo, etc.)' },
  { code: '3401', description: 'Soap' },
  { code: '3402', description: 'Detergents and cleaning preparations' },
  { code: '3808', description: 'Insecticides, pesticides and fungicides' },
  { code: '3824', description: 'Prepared chemical products, misc.' },
  { code: '3826', description: 'Biodiesel' },
  // ── Plastics & rubber (Ch. 39–40) ──
  { code: '3901', description: 'Polymers of ethylene (polyethylene)' },
  { code: '3902', description: 'Polymers of propylene (polypropylene)' },
  { code: '3907', description: 'Polyacetals, epoxides, polyesters' },
  { code: '3919', description: 'Self-adhesive plastic film and tape' },
  { code: '3920', description: 'Plastic sheet and film, non-cellular' },
  { code: '3923', description: 'Plastic packaging, boxes and bottles' },
  { code: '3924', description: 'Plastic tableware and kitchenware' },
  { code: '3926', description: 'Plastic articles, misc.' },
  { code: '4008', description: 'Rubber sheets, strips and profiles' },
  { code: '4011', description: 'New pneumatic rubber tires' },
  { code: '4016', description: 'Articles of vulcanized rubber' },
  // ── Leather / wood / paper (Ch. 42–49) ──
  { code: '4202', description: 'Trunks, bags, cases and handbags' },
  { code: '4203', description: 'Leather apparel and accessories' },
  { code: '4407', description: 'Sawn or chipped wood (lumber)' },
  { code: '4409', description: 'Wood flooring and moldings' },
  { code: '4411', description: 'Fiberboard (MDF, HDF)' },
  { code: '4412', description: 'Plywood and veneered panels' },
  { code: '4418', description: "Builders' joinery and carpentry of wood" },
  { code: '4419', description: 'Wooden tableware and kitchenware' },
  { code: '4421', description: 'Articles of wood, misc.' },
  { code: '4802', description: 'Uncoated paper and paperboard' },
  { code: '4811', description: 'Coated and treated paper' },
  { code: '4819', description: 'Cartons, boxes and cases of paper' },
  { code: '4901', description: 'Printed books and brochures' },
  // ── Textiles & apparel (Ch. 50–63) ──
  { code: '5007', description: 'Woven silk fabric' },
  { code: '5208', description: 'Woven cotton fabric' },
  { code: '5407', description: 'Woven synthetic filament fabric' },
  { code: '5603', description: 'Nonwovens' },
  { code: '5703', description: 'Carpets, tufted' },
  { code: '5806', description: 'Narrow woven fabrics, ribbons' },
  { code: '6104', description: "Women's suits, dresses and skirts, knit" },
  { code: '6105', description: "Men's shirts, knitted" },
  { code: '6109', description: 'T-shirts and singlets, knitted' },
  { code: '6110', description: 'Sweaters, pullovers and cardigans' },
  { code: '6115', description: 'Hosiery, socks and tights, knit' },
  { code: '6203', description: "Men's suits, jackets and trousers, woven" },
  { code: '6204', description: "Women's suits, jackets and trousers, woven" },
  { code: '6206', description: "Women's blouses and shirts, woven" },
  { code: '6212', description: 'Bras, girdles and corsets' },
  { code: '6302', description: 'Bed, table and kitchen linen' },
  { code: '6304', description: 'Furnishing articles, curtains and cushions' },
  { code: '6307', description: 'Made-up textile articles, misc.' },
  { code: '6402', description: 'Footwear with rubber or plastic uppers' },
  { code: '6403', description: 'Footwear with leather uppers' },
  { code: '6404', description: 'Footwear with textile uppers' },
  { code: '6505', description: 'Hats and headgear, knitted or made-up' },
  // ── Stone / ceramic / glass (Ch. 68–70) ──
  { code: '6802', description: 'Worked monumental or building stone' },
  { code: '6810', description: 'Articles of cement or concrete' },
  { code: '6907', description: 'Ceramic tiles and flags' },
  { code: '6910', description: 'Ceramic sinks, baths and sanitary ware' },
  { code: '6911', description: 'Porcelain tableware' },
  { code: '6912', description: 'Ceramic tableware, non-porcelain' },
  { code: '7010', description: 'Glass bottles, jars and containers' },
  { code: '7013', description: 'Glassware for table, kitchen and decor' },
  { code: '7016', description: 'Glass blocks, bricks and tiles' },
  // ── Base metals & tools (Ch. 72–83) ──
  { code: '7208', description: 'Flat-rolled iron/steel, hot-rolled' },
  { code: '7210', description: 'Flat-rolled steel, coated or plated' },
  { code: '7217', description: 'Iron or steel wire' },
  { code: '7304', description: 'Seamless iron or steel tubes and pipe' },
  { code: '7306', description: 'Welded iron or steel tube and pipe' },
  { code: '7308', description: 'Structures and parts of iron or steel' },
  { code: '7318', description: 'Screws, bolts, nuts and fasteners' },
  { code: '7323', description: 'Iron or steel household articles' },
  { code: '7326', description: 'Articles of iron or steel, misc.' },
  { code: '7407', description: 'Copper bars, rods and profiles' },
  { code: '7604', description: 'Aluminum bars, rods and profiles' },
  { code: '7606', description: 'Aluminum plates, sheets and strip' },
  { code: '7610', description: 'Aluminum structures and parts' },
  { code: '8201', description: 'Hand tools for agriculture and gardening' },
  { code: '8202', description: 'Hand saws and saw blades' },
  { code: '8204', description: 'Wrenches and spanners' },
  { code: '8205', description: 'Hand tools, misc.' },
  { code: '8207', description: 'Interchangeable tool tips and drill bits' },
  { code: '8211', description: 'Knives with cutting blades' },
  { code: '8215', description: 'Spoons, forks and cutlery' },
  { code: '8301', description: 'Padlocks and locks of base metal' },
  { code: '8302', description: 'Base-metal mountings, fittings and hardware' },
  { code: '8311', description: 'Wire, rods and electrodes for soldering' },
  // ── Machinery & mechanical (Ch. 84) ──
  { code: '8407', description: 'Spark-ignition engines' },
  { code: '8408', description: 'Diesel and compression engines' },
  { code: '8413', description: 'Pumps for liquids' },
  { code: '8414', description: 'Air pumps, compressors and fans' },
  { code: '8415', description: 'Air conditioning machines' },
  { code: '8418', description: 'Refrigerators and freezers' },
  { code: '8421', description: 'Centrifuges and filtering machinery' },
  { code: '8422', description: 'Dishwashers and packaging machinery' },
  { code: '8424', description: 'Spraying and dispersing machinery' },
  { code: '8427', description: 'Forklifts and works trucks' },
  { code: '8429', description: 'Bulldozers, graders and excavators' },
  { code: '8431', description: 'Parts for lifting and earth-moving machines' },
  { code: '8443', description: 'Printing machinery and printers' },
  { code: '8450', description: 'Washing machines, household' },
  { code: '8465', description: 'Machine tools for wood and plastic' },
  { code: '8467', description: 'Power hand tools' },
  { code: '8471', description: 'Computers and data-processing machines' },
  { code: '8473', description: 'Parts for computers and office machines' },
  { code: '8481', description: 'Valves and taps for pipes and tanks' },
  { code: '8482', description: 'Ball and roller bearings' },
  { code: '8483', description: 'Transmission shafts, gears and gearboxes' },
  { code: '8501', description: 'Electric motors and generators' },
  { code: '8504', description: 'Transformers and power supplies' },
  { code: '8507', description: 'Batteries and accumulators' },
  // ── Electrical & electronics (Ch. 85) ──
  { code: '8508', description: 'Vacuum cleaners' },
  { code: '8509', description: 'Electromechanical domestic appliances' },
  { code: '8513', description: 'Portable electric lamps and flashlights' },
  { code: '8516', description: 'Electric heaters, kettles and appliances' },
  { code: '8517', description: 'Telephones and networking equipment' },
  { code: '8518', description: 'Microphones, speakers and audio gear' },
  { code: '8523', description: 'Media, cards and storage devices' },
  { code: '8528', description: 'Monitors, projectors and televisions' },
  { code: '8536', description: 'Electrical switches, plugs and connectors' },
  { code: '8537', description: 'Control panels and switchboards' },
  { code: '8539', description: 'Electric lamps and LED bulbs' },
  { code: '8541', description: 'Semiconductors, diodes and solar cells' },
  { code: '8542', description: 'Integrated circuits (chips)' },
  { code: '8544', description: 'Insulated wire, cable and connectors' },
  { code: '8547', description: 'Insulating fittings for electrical machines' },
  // ── Vehicles & transport (Ch. 87–89) ──
  { code: '8701', description: 'Tractors' },
  { code: '8703', description: 'Passenger motor cars' },
  { code: '8704', description: 'Motor vehicles for goods transport' },
  { code: '8708', description: 'Parts and accessories for motor vehicles' },
  { code: '8711', description: 'Motorcycles and mopeds' },
  { code: '8712', description: 'Bicycles, non-motorized' },
  { code: '8714', description: 'Parts for bicycles and motorcycles' },
  { code: '8716', description: 'Trailers and semi-trailers' },
  // ── Instruments / optical / medical (Ch. 90) ──
  { code: '9001', description: 'Optical fibers and lenses' },
  { code: '9018', description: 'Medical and surgical instruments' },
  { code: '9021', description: 'Orthopedic and prosthetic appliances' },
  { code: '9028', description: 'Gas, liquid and electricity meters' },
  { code: '9032', description: 'Automatic regulating instruments' },
  // ── Furniture / lighting / prefab (Ch. 94) ──
  { code: '9401', description: 'Seats and chairs' },
  { code: '9403', description: 'Furniture and parts, misc.' },
  { code: '9404', description: 'Mattresses, cushions and bedding' },
  { code: '9405', description: 'Lamps, lighting fittings and fixtures' },
  { code: '9406', description: 'Prefabricated buildings' },
  // ── Toys / sports / misc manufactured (Ch. 95–96) ──
  { code: '9503', description: 'Toys, tricycles and scale models' },
  { code: '9504', description: 'Video game consoles and playing tables' },
  { code: '9506', description: 'Sports and fitness equipment' },
  { code: '9603', description: 'Brooms, brushes and mops' },
  { code: '9608', description: 'Pens, markers and writing instruments' },
  { code: '9613', description: 'Lighters' },
  { code: '9617', description: 'Vacuum flasks and insulated containers' },
];

/**
 * Extra free-text commodity keywords that map onto the headings above, so a user
 * typing a plain product word ("sneakers", "led", "cookware") still gets a hit
 * even when the word isn't literally in an HS description. Each maps to a heading
 * whose description carries the canonical label.
 */
const KEYWORD_ALIASES: ReadonlyArray<[string, string]> = [
  ['sneakers', '6404'], ['shoes', '6403'], ['boots', '6403'], ['sandals', '6402'],
  ['handbags', '4202'], ['backpacks', '4202'], ['luggage', '4202'], ['wallets', '4202'],
  ['t-shirts', '6109'], ['tshirts', '6109'], ['jeans', '6203'], ['dresses', '6104'],
  ['sweaters', '6110'], ['socks', '6115'], ['hats', '6505'], ['bedding', '9404'],
  ['towels', '6302'], ['curtains', '6304'], ['cookware', '7323'], ['cutlery', '8215'],
  ['knives', '8211'], ['tools', '8205'], ['saw blades', '8202'], ['drill bits', '8207'],
  ['fasteners', '7318'], ['screws', '7318'], ['bolts', '7318'], ['bearings', '8482'],
  ['valves', '8481'], ['pumps', '8413'], ['tires', '4011'], ['batteries', '8507'],
  ['led', '8539'], ['light bulbs', '8539'], ['lamps', '9405'], ['lighting', '9405'],
  ['solar panels', '8541'], ['solar', '8541'], ['chips', '8542'], ['cables', '8544'],
  ['wire', '8544'], ['connectors', '8536'], ['tv', '8528'], ['monitors', '8528'],
  ['speakers', '8518'], ['headphones', '8518'], ['computers', '8471'], ['laptops', '8471'],
  ['phones', '8517'], ['furniture', '9403'], ['chairs', '9401'], ['sofas', '9401'],
  ['mattresses', '9404'], ['toys', '9503'], ['bicycles', '8712'], ['bikes', '8712'],
  ['auto parts', '8708'], ['car parts', '8708'], ['tiles', '6907'], ['flooring', '4409'],
  ['plywood', '4412'], ['lumber', '4407'], ['cabinets', '9403'], ['sinks', '6910'],
  ['glassware', '7013'], ['bottles', '7010'], ['cosmetics', '3304'], ['skincare', '3304'],
  ['shampoo', '3305'], ['soap', '3401'], ['detergent', '3402'], ['coffee', '0901'],
  ['wine', '2204'], ['chocolate', '1806'], ['appliances', '8509'], ['refrigerators', '8418'],
  ['air conditioners', '8415'], ['fans', '8414'], ['sporting goods', '9506'],
  ['fitness equipment', '9506'], ['pet supplies', '3926'], ['packaging', '3923'],
  ['plastic', '3926'], ['steel', '7326'], ['aluminum', '7604'], ['pipe', '7306'],
  ['fabric', '5208'], ['carpet', '5703'], ['brushes', '9603'], ['pens', '9608'],
];

/** A suggestion the combobox renders: what to submit (`value`) + what to show. */
export interface CommoditySuggestion {
  /** The value inserted into the field on select (a code for HS, else the text). */
  value: string;
  /** Display label ("8202 · Hand saws and saw blades"). */
  label: string;
  /** 'hs' when the value is a code, 'keyword' for a plain product term. */
  kind: 'hs' | 'keyword';
}

const HS_BY_CODE = new Map(HS_CODES.map((h) => [h.code, h] as const));

/**
 * Suggest HS codes / commodity keywords for a query. Matches on the CODE (prefix)
 * OR any word of the description / a keyword alias, ranks exact-code then
 * code-prefix then description hits, and returns at most `limit`. Pure + fast
 * (small in-memory list) — ImportYeti is NEVER called for suggestions.
 */
export function suggestCommodity(q: string, limit = 10): CommoditySuggestion[] {
  const query = String(q || '').trim().toLowerCase();
  if (!query) return [];
  const digits = /^[0-9]+$/.test(query);
  const out: Array<{ s: CommoditySuggestion; rank: number }> = [];
  const seen = new Set<string>();

  if (digits) {
    for (const h of HS_CODES) {
      if (h.code.startsWith(query)) {
        const rank = h.code === query ? 0 : 1;
        out.push({ s: { value: h.code, label: `${h.code} · ${h.description}`, kind: 'hs' }, rank });
        seen.add(h.code);
      }
    }
  } else {
    // Keyword aliases first (a plain product word → canonical heading).
    for (const [kw, code] of KEYWORD_ALIASES) {
      if (kw.includes(query)) {
        const h = HS_BY_CODE.get(code);
        if (h && !seen.has(`kw:${kw}`)) {
          const rank = kw.startsWith(query) ? 0 : 1;
          out.push({ s: { value: kw, label: `${kw} — HS ${code} · ${h.description}`, kind: 'keyword' }, rank });
          seen.add(`kw:${kw}`);
        }
      }
    }
    // Then description-word matches on the HS headings.
    for (const h of HS_CODES) {
      const desc = h.description.toLowerCase();
      if (desc.includes(query) && !seen.has(h.code)) {
        const rank = desc.startsWith(query) ? 1 : 2;
        out.push({ s: { value: h.code, label: `${h.code} · ${h.description}`, kind: 'hs' }, rank });
        seen.add(h.code);
      }
    }
  }
  out.sort((a, b) => a.rank - b.rank);
  return out.slice(0, limit).map((o) => o.s);
}
