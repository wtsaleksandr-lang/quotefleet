/**
 * THE MARKET RATE ENGINE.
 *
 * The tool used to ask a shipper for his own $/mile and his own pilot-car rate,
 * and refused to invent one. That was the right answer for a carrier's
 * dispatcher and the wrong one for the people actually using it — a freight
 * forwarder has no idea what road types, permits and escorts cost and has no
 * rates of his own for any of it.
 *
 * The honest version is not refusing to estimate. It is estimating from real
 * market data and showing exactly what each number rests on. That is what this
 * directory does:
 *
 *   linehaul.ts     — DAT-anchored line haul, USDA distance curve, and a minimum
 *                     ladder pinned to the ~250-mile day-rate crossover
 *   escorts.ts      — the civilian pilot-car tiered floor
 *   accessorials.ts — loading (the headline), detention, layover, tarping,
 *                     securement, permit service margin, route survey, insurance
 *   derive.ts       — axle count, equipment class, route class, from the cargo
 *   accuracy.ts     — the four-tier rating every charge carries
 *   sources.ts      — the register, deliberately NOT `SourceDoc`
 *
 * NOTHING HERE TOUCHES `src/calc/osow/`. The permits engine, the police escort
 * rates and the permits-only tool are byte-identical after this change. Market
 * money lands in its own subtotal and cannot reach a cited one.
 */
export * from './accuracy.js';
export * from './sources.js';
export * from './derive.js';
export * from './linehaul.js';
export * from './escorts.js';
export * from './accessorials.js';
