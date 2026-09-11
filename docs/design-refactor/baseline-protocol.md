# Guard-baseline protocol (design refactor)

Rules every redesign wave must follow when touching CSS in `src/server/public/`.

## The hazard

Two CI guards tolerate existing debt via a snapshot file:

| Guard | Baseline | Entries (wave 0) |
| --- | --- | --- |
| `scripts/check-hardcoded-colors.mjs` | `scripts/color-violations-baseline.txt` | 107 |
| `scripts/check-spacing.mjs` | `scripts/spacing-violations-baseline.txt` | 1180 (834 spacing/tap/line-height + 346 radii added in wave 0) |

Both are keyed on **`file:line`**. That key is positional, so:

1. **Any mid-file CSS insertion renumbers everything below it.** Insert 3 lines at
   the top of a stylesheet with 40 baselined entries and all 40 stop matching —
   they are reported as NEW violations *and* the old entries go stale. A
   one-line edit can mass-fail CI with a diff that looks harmless.
2. **Two branches that both regenerate a baseline always conflict.** The file is
   a sorted line dump; Git cannot merge two regenerations of it meaningfully,
   and "resolve by taking ours" silently deletes the other wave's entries,
   re-arming violations nobody will notice until a much later PR.

## The rules

1. **Append at EOF where possible.** New CSS goes at the end of a stylesheet, or
   in a new file, so existing line numbers are preserved and no baseline churn
   occurs. New baseline entries are appended at EOF under a dated comment
   header (see the wave-0 radius block) rather than folded into the sorted body.
2. **Regenerate as the LAST step of a wave, never mid-wave.** Run
   `node scripts/check-spacing.mjs --write-baseline` /
   `node scripts/check-hardcoded-colors.mjs --write-baseline` only once all the
   wave's CSS edits are final, in a single commit of its own, with no other
   files in that commit. A regeneration commit mixed with code changes is
   unreviewable.
3. **Never regenerate in two branches simultaneously.** Baseline regeneration is
   a serialized, single-writer operation. Before a wave regenerates it must
   rebase onto the current `main`; if another wave's regeneration is in flight,
   wait for it to merge. Parallel writer agents must each work in their own
   worktree *and* only one of them may hold the regeneration token at a time.
4. **Always review the baseline diff.**
   - A **shrinking** baseline is good — debt was paid down. Land it.
   - A **growing** baseline needs an explicit justification in the PR body
     (which rule, why the value cannot be on-ramp, when it will be retired).
     "The guard went red so I regenerated" is not a justification.
   - A baseline whose *line count barely changes but whose contents churn
     heavily* is the renumbering signature — stop and re-do the edit as an
     EOF append instead.
5. **Prefer clearing to baselining.** Both guards print a
   `note: N baseline entries are cleared and can be deleted` line when debt has
   been fixed but the entry remains. Delete those lines by hand; it is a safe,
   conflict-free, shrinking edit.
6. **Check the guard's own exit code, not a pipe's.** `node scripts/check-*.mjs | tail`
   reports `tail`'s status. Redirect to a file and test `$?`, or run the guard bare.

## Token ramps the guards enforce

- **Spacing** (`padding` / `margin` / `gap` / `inset` / `top`-`left`):
  `{0, 4, 8, 12, 16, 24, 32, 48, 60, 80, 120}` — the 8px grid. Unchanged by the
  redesign.
- **Radius** (`border-*-radius`): a separate category added in wave 0, because a
  corner radius tracks a control's optical size rather than the layout grid. Do
  not merge the two sets.
  - **Target (use these): `{0, 6, 8, 12, 9999}`.** The measured reference has
    exactly three radii plus the pill idiom, and they are concentric — a 12px
    shell with 4px of padding gives 8px inner children. `8` was added to the
    guard in wave 2, when `--radius-btn` / `--radius-control` became 8px.
  - **Legacy (tolerated, do not use in new CSS): `{10, 16, 20, 24}`.** Still in
    `RADIUS_ALLOWED` only so the component waves can drain them incrementally
    instead of mass-failing CI; each should leave the set as it empties.
- **Tap targets**: `>= 24px` hard floor on interactive selectors, `44px` target
  (24–43 warns only). Unchanged.
- **Body line-height**: unitless `1.4`–`1.6`. Unchanged.
