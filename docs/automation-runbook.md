# QuoteFleet automation runbook

Use this note for scheduled or manual automation passes. It complements `docs/automation-safe-scope.md`.

## Start checklist

1. Confirm the task is low risk.
2. Avoid shared product files.
3. Check for open PRs in the same area.
4. Prefer a new branch.
5. Pick one small task only.

## Safe task types

Prefer isolated work:

- documentation clarifications
- smoke tests for existing static assets
- accessibility notes
- responsive CSS notes
- checklist updates
- copy edits in low-conflict static files

Skip work that changes product logic, routes, database files, auth, payment, AI behavior, or quote calculation.

## Branch names

Use short names:

- `docs/<topic>`
- `tests/<topic>`
- `polish/<topic>`

Avoid broad names such as `feature/dashboard-overhaul` or `rewrite/app`.

## PR checklist

Each automation PR should state:

- what changed
- why it is low risk
- files changed
- whether a smoke test was added
- what manual development should avoid while the PR is open

## Direct commit rule

Direct commits to `main` should be limited to clearly safe documentation, test, or isolated UI/CSS cleanup when branch or PR creation is blocked or unavailable.

When unsure, stop and summarize instead of forcing a change.

## Handoff format

End each run with:

- branch or commit
- PR number if created
- files changed
- short summary
- manual development avoidance note
- next safe task suggestion
