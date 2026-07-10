/**
 * Transit-time estimate — a shipper decides on price AND days, so both the
 * calculator result and the hosted quote show an estimated transit window
 * derived purely from lane distance + service type.
 *
 * This is a deliberately conservative heuristic, NOT a routing/ETA API:
 *   - Standard truckload ≈ 450–500 loaded miles/day + one dispatch/pickup day.
 *   - Expedited / hotshot run harder (team-capable, direct) ≈ 850 mi/day and
 *     dispatch same day, so no pickup buffer.
 *   - Drayage and very short local moves are same/next business day.
 *
 * Always presented to the customer as an estimate (disclaimer in the UI), so
 * we never overpromise. Returns null when distance is unknown.
 */
export type TransitEstimate = {
  /** Human-readable window, e.g. "4–5 business days" or "Same or next business day". */
  text: string;
  /** [low, high] business-day bounds when a numeric range applies; omitted for same/next-day. */
  days?: [number, number];
};

export function estimateTransit(
  miles: number | null | undefined,
  service: string | null | undefined
): TransitEstimate | null {
  const m = Number(miles);
  if (!Number.isFinite(m) || m <= 0) return null;
  const svc = String(service || '').toLowerCase();

  // Local port/rail drayage and very short hauls move same or next day.
  if (svc === 'drayage' || m <= 100) {
    return { text: 'Same or next business day' };
  }

  const expedited = svc === 'expedited' || svc === 'hotshot';
  const milesPerDay = expedited ? 850 : 500;
  const driveDays = Math.max(1, Math.ceil(m / milesPerDay));
  // Standard TL adds one dispatch/pickup day; expedited dispatches same day.
  const low = expedited ? driveDays : driveDays + 1;
  const high = low + 1;
  return { text: `${low}–${high} business days`, days: [low, high] };
}
