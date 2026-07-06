# QuoteFleet automation runbook

Use this note for scheduled or manual automation passes. It complements `docs/automation-safe-scope.md`.

## Start checklist

1. Confirm the task is low risk.
2. Avoid shared product files.
3. Check for open PRs in the same area.
4. Start from the latest `main` on `automation/support-work`.
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

## Branch name

Scheduled support work uses `automation/support-work` so each pass has a predictable review branch.

For manual one-off support work, short names are preferred:

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

## Main branch rule

Scheduled automation work should stay on `automation/support-work` and move toward `main` only through a pull request.

When a branch or PR cannot be prepared safely, stop and summarize instead of forcing a change.

## Handoff format

End each run with:

- branch or commit
- PR number if created
- files changed
- short summary
- manual development avoidance note
- next safe task suggestion
