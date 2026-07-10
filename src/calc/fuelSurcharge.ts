/**
 * Automatic fuel-surcharge (FSC) formula — PURE, no I/O.
 *
 * Industry-standard "DOE index" fuel surcharge tied to the EIA weekly
 * national on-highway No. 2 diesel retail price:
 *
 *     FSC ($/mile) = max(0, (dieselPrice − pegPrice) / mpg)
 *
 * This is the model published by OOIDA and used in nearly every carrier
 * FSC table: pick a base ("peg") diesel price, and for every dollar the
 * current price rises above the peg, add (1 / mpg) dollars per mile. With
 * the classic mpg = 6.0 assumption this yields the familiar rule of thumb
 * "+$0.01/mile for every $0.06 diesel rises above the peg" (0.06 / 6 = 0.01).
 *
 * Defaults (see AUTO_FSC_DEFAULTS in defaults.ts):
 *   peg = $1.25/gal, mpg = 6.0 mi/gal.
 *   e.g. diesel $4.05  →  (4.05 − 1.25) / 6 = $0.467/mi
 *
 * Source: US EIA weekly on-highway diesel price
 *   series EMD_EPD2D_PTE_NUS_DPG (public domain). The dollars-per-mile
 *   amount is applied to the lane's miles by the calc engine.
 */

export interface AutoFscParams {
  /** Current national average diesel price, $/gallon (from EIA). */
  dieselUsdPerGal: number;
  /** Base/peg diesel price, $/gallon. Below this, surcharge is $0. */
  pegUsdPerGal: number;
  /** Assumed truck fuel economy, miles per gallon. */
  mpg: number;
}

/**
 * Fuel surcharge in dollars per mile for the given diesel price.
 * Never negative (a diesel price at/below the peg yields $0/mi).
 */
export function autoFscPerMile(params: AutoFscParams): number {
  const { dieselUsdPerGal, pegUsdPerGal, mpg } = params;
  if (!(mpg > 0)) return 0;
  const perMile = (dieselUsdPerGal - pegUsdPerGal) / mpg;
  return perMile > 0 ? Math.round(perMile * 1000) / 1000 : 0;
}
