# QuoteFleet support PR review checklist

Use this checklist before opening low-risk support pull requests from `automation/support-work`.

## Scope check

Confirm the PR only changes one small support area, such as docs, smoke tests, accessibility notes, copy polish, or frontend-only CSS refinements.

Do not include product features, pricing behavior, quote calculation changes, API route changes, database schema edits, authentication, payments, or AI workflow behavior.

## File safety check

Before editing, confirm the files are not high-conflict product files. Avoid `src/server/public/app.js`, `src/server/public/premium-saas-polish.js`, database files, route handlers, quote calculation files, auth files, payment files, and active product work.

## PR body check

Each support PR should clearly state:

- what changed
- why the change is low risk
- which files changed
- whether a smoke test was added or updated
- what development should avoid until the PR is reviewed

## Handoff check

After opening the PR, leave the branch ready for review. Merge only when the user has explicitly allowed clean support PRs to be merged and the PR is mergeable.
