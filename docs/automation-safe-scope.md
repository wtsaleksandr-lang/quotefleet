# QuoteFleet automation safe scope

This document defines the safe working area for automated build-loop passes while manual development may be happening in parallel.

## Allowed work

The automation may work on low-risk support tasks only:

- documentation improvements
- smoke tests for existing UI or documentation
- UI copy cleanup
- accessibility polish
- responsive CSS polish
- small visual consistency improvements
- README, internal notes, and product checklist updates
- non-destructive frontend-only refinements

## Avoided work

The automation must not work on major product features or anything likely to conflict with manual development:

- business logic
- architecture changes
- database schema changes
- quote calculation logic
- authentication or payment flows
- AI workflow behavior
- API route behavior
- destructive migrations or file removals

## High-conflict files

Avoid these unless the change is explicitly requested and very small:

- `src/server/public/app.js`
- `src/server/public/premium-saas-polish.js`
- database schema files
- API route files
- quote calculation files
- authentication files
- payment files

## Preferred approach

1. Review latest `main` before choosing work.
2. Choose one small, safe task.
3. Prefer isolated files over shared files.
4. Add a smoke test when practical.
5. Use a branch and pull request when possible.
6. Commit directly to `main` only for clearly safe documentation, test, or isolated UI/CSS cleanup when PR creation is blocked or unavailable.
7. Skip any file that looks recently changed or conflict-prone.

## Good examples

- Add a documentation note for a dashboard UX layer.
- Add a smoke test that checks an already-existing public asset is loaded.
- Add CSS-only responsive polish in a new isolated file.
- Fix user-facing copy in a low-conflict static page.

## Bad examples

- Changing the quote calculator formula.
- Editing API behavior.
- Changing the database schema.
- Reworking authentication or billing.
- Rewriting the dashboard router.
- Replacing large shared JavaScript files.
