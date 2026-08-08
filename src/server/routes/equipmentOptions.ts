/**
 * Widget equipment-option helpers — the canonical labels for each equipment
 * code and the de-dup that collapses the tenant's rate cards down to distinct
 * equipment TYPES.
 *
 * Kept in its own tiny module (no DB / email / AI imports) so it can be unit
 * tested directly without dragging in the whole public-route dependency chain.
 */

// Human labels for the equipment codes a rate matrix or card can carry (so a
// dropdown option reads "40' Reefer Container" rather than the raw code).
// Falls back to a title-cased code when unmapped.
export const MATRIX_EQUIPMENT_LABELS: Record<string, string> = {
  dryvan: 'Dry Van',
  reefer: 'Reefer (Refrigerated)',
  flatbed: 'Flatbed',
  step_deck: 'Step Deck',
  conestoga: 'Conestoga',
  container_20: "20' Container",
  container_40: "40' Container",
  container_40hc: "40'HQ",
  container_45: "45' Container",
  container_40re: "40' Reefer Container",
  container_20re: "20' Reefer Container",
  sprinter: 'Sprinter Van',
  box_truck: 'Box Truck',
  tractor_only: 'Power Only',
  pallet: 'Pallet',
};

export function matrixEquipmentLabel(code: string): string {
  const c = String(code || '').trim();
  if (MATRIX_EQUIPMENT_LABELS[c]) return MATRIX_EQUIPMENT_LABELS[c];
  // Title-case the raw code as a fallback (container_40re → "Container 40re").
  return c.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim() || c;
}

export type EquipmentOption = { value: string; label: string; maxWeightLbs?: number };

// Canonical display rank for CONTAINER equipment so a container list always
// reads smallest→largest (20' → 40' → 40'HQ → 45') regardless of the order the
// tenant's rate cards happen to arrive in (cards sort by updatedAt/id, which is
// non-deterministic for a bulk-seeded tenant). This makes the widget default to
// the 20' container for drayage. Non-container equipment gets a high rank and
// keeps its original relative order (stable sort), so other modes are untouched.
const CONTAINER_ORDER: Record<string, number> = {
  container_20: 0,
  container_20re: 1,
  container_40: 2,
  container_40hc: 3,
  container_40re: 4,
  container_45: 5,
};
function equipmentSortRank(value: string, index: number): number {
  const r = CONTAINER_ORDER[value];
  return r === undefined ? 100 + index : r;
}

/**
 * Collapse each service's equipment list to distinct equipment TYPES.
 *
 * The card-derived `groupBy` emits ONE entry per enabled rate card, so a tenant
 * with 33 ingested reefer lane-cards produced 33 `reefer` <option>s — each
 * carrying the card's lane-named label ("Reefer – Plant City FL → New York NY
 * (L01)"). The customer only picks an equipment TYPE, never a lane, so we
 * de-dupe by equipment value per service and force a clean canonical label
 * (matrixEquipmentLabel) instead of whatever lane text the card happened to
 * carry. When several cards share a value we keep the most permissive weight
 * ceiling (max) so we never falsely block a load the tenant can actually haul.
 */
export function dedupeEquipmentTypes(
  byService: Record<string, EquipmentOption[]>,
): Record<string, EquipmentOption[]> {
  const out: Record<string, EquipmentOption[]> = {};
  for (const service of Object.keys(byService)) {
    const seen = new Map<string, EquipmentOption>();
    for (const item of byService[service]) {
      const value = String(item.value ?? '').trim();
      if (!value) continue;
      const existing = seen.get(value);
      if (!existing) {
        seen.set(value, {
          value,
          label: matrixEquipmentLabel(value),
          ...(Number.isFinite(item.maxWeightLbs) && (item.maxWeightLbs as number) > 0
            ? { maxWeightLbs: item.maxWeightLbs }
            : {}),
        });
      } else if (
        Number.isFinite(item.maxWeightLbs) &&
        (item.maxWeightLbs as number) > (existing.maxWeightLbs ?? 0)
      ) {
        existing.maxWeightLbs = item.maxWeightLbs;
      }
    }
    // Stable canonical order: containers smallest→largest, everything else in
    // arrival order. Sort by (rank, originalIndex) so it never shuffles
    // non-container modes.
    out[service] = Array.from(seen.values())
      .map((opt, index) => ({ opt, index }))
      .sort((a, b) =>
        equipmentSortRank(a.opt.value, a.index) - equipmentSortRank(b.opt.value, b.index) ||
        a.index - b.index,
      )
      .map((x) => x.opt);
  }
  return out;
}
