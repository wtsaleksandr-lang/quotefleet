# QuoteFleet automation runbook

Use this note for scheduled or user-triggered support passes. It complements `docs/automation-safe-scope.md`.

## Start checklist

1. Confirm the task is low risk.
2. Avoid shared product files.
3. Check for open PRs in the same area.
4. Reset `automation/support-work` to the latest `main` before editing.
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

## Branch rule

Support work uses the reusable `automation/support-work` branch so each pass has a predictable review branch and does not leave a trail of stale topic branches.

Before each task:

1. Confirm no open PR is already using `automation/support-work`.
2. Reset `automation/support-work` to latest `main`.
3. Make the smallest useful docs, test, copy, or support-only change.
4. Open a pull request from `automation/support-work` to `main`.
5. Merge only when the user has allowed clean support PRs to be merged and the PR is mergeable.
6. Reset `automation/support-work` to latest `main` after merge.

Avoid creating one-off support branches unless the user explicitly asks for a separate branch.

## PR checklist

Each automation PR should state:

- what changed
- why it is low risk
- files changed
- whether a smoke test was added
- what overlapping development should avoid while the PR is open

## Main branch rule

Scheduled or user-triggered support work should stay on `automation/support-work` and move toward `main` only through a pull request.

When a branch or PR cannot be prepared safely, stop and summarize instead of forcing a change.

## Cleanup checklist

End each completed support pass by confirming:

- the PR was merged or intentionally closed
- no support PRs are still open
- `automation/support-work` is identical to `main`
- any known old support branches have no unmerged diff from `main`

## Handoff format

End each run with:

- branch or commit
- PR number if created
- files changed
- short summary
- overlapping-development avoidance note if a PR is still open
- cleanup status
