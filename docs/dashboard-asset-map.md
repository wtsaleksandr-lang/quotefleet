# QuoteFleet dashboard asset map

This dashboard currently uses small layered CSS/JS files instead of one large rewritten app file. This keeps each product UX pass isolated and easier to roll back.

## Load order

`src/server/public/app.html` should load dashboard CSS in this order:

1. `/style.css` — base app styles, shared UI primitives, AND the single source
   of truth for color tokens (the WeFixTrades dark palette + light theme shared
   with the public site). REMOVED: `/premium-palette.css` — its teal logistics
   theme overrode style.css and made the dashboard render teal/pale-blue; the
   dashboard now inherits the same palette as the public pages.
2. `/dashboard-polish.css` — general dashboard visual polish.
4. `/dashboard-setup.css` — overview setup progress panel and setup empty states.
5. `/dashboard-preview.css` — customer calculator preview card.
6. `/rate-builder.css` — `/app/rates` builder layer.
7. `/setup-builder.css` — `/app/accessorials` and `/app/zones` builder layer.
8. `/brand-editor.css` — `/app/brand` editor layer.
9. `/ai-setup.css` — `/app/ai` setup layer.
10. `/premium-saas-polish.css` — global loading, toast, modal, and action-state polish.
11. `/app-quote-actions.css` — quote action-specific styles.

Dashboard JS should load in this order:

1. `/app.js` — core dashboard router and existing product logic.
2. `/premium-saas-polish.js` — global toast, modal, loading, and action feedback helpers.
3. `/dashboard-setup.js` — setup progress and setup page guidance.
4. `/dashboard-preview.js` — customer preview card.
5. `/rate-builder.js` — rate card builder enhancements.
6. `/setup-builder.js` — accessorial and zone builder enhancements.
7. `/brand-editor.js` — brand page editor guidance.
8. `/ai-setup.js` — AI setup guidance.
9. `/app-quote-actions.js` — quote action behavior.
10. `/app-quote-activity.js` — quote activity behavior.
11. `/app-accessorial-tools.js` — accessorial helper behavior.
12. `/app-carrier-profile.js` — carrier profile behavior.

## Why the order matters

The base app renders first. Enhancement layers then attach to `#page-content` after the dashboard route content appears. Global helpers load early so later layers can dispatch `qf:toast` or use `window.qfToast` / `window.qfConfirm`.

## Current UX layers

- `dashboard-setup.*`: short, interactive calculator setup path.
- `dashboard-preview.*`: customer-facing calculator preview and link actions.
- `rate-builder.*`: makes `/app/rates` feel like a calculator builder.
- `setup-builder.*`: makes `/app/accessorials` and `/app/zones` consistent with rates.
- `brand-editor.*`: turns `/app/brand` into a customer page editor experience.
- `ai-setup.*`: safer AI configuration guidance.
- `premium-saas-polish.*`: global SaaS polish, feedback, loading, and modal groundwork.

## Maintenance rules

- Keep each layer focused on one product surface.
- Prefer adding a small focused file over rewriting the large dashboard shell.
- Add smoke tests when a new asset is loaded from `app.html`.
- Avoid duplicate route-specific panels on the same page.
- Enhancement scripts should fail safely if their route or target element is missing.
