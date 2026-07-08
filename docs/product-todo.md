# QuoteFleet product to-do list

## Phase 1 — Calculator setup dashboard UX

Goal: make calculator setup straightforward, interactive, and short.

Tasks:

- Add setup progress panel to the dashboard overview.
- Group the most important calculator setup actions in one place.
- Make rate cards, accessorials, zones, brand, AI, and public link feel like one setup flow.
- Improve empty states for setup screens.
- Add direct action buttons instead of making users guess where to go next.
- Keep setup short: no long wizard until the user needs deeper setup.

## Phase 2 — Live calculator preview inside dashboard

Goal: let users see what customers will see while editing.

Tasks:

- Add a calculator preview panel inside dashboard.
- Start with preview links and lightweight preview cards.
- Later support side-by-side settings + preview.

## Phase 3 — Rate card editing improvements

Goal: make `/app/rates` feel like a calculator builder, not a spreadsheet.

Tasks:

- Add summary cards at the top.
- Add duplicate rate card action.
- Add clearer save states.
- Add last-saved indicator.
- Add better empty state examples.
- Replace destructive browser confirm flows with modal UI.

## Phase 4 — Brand page editor improvement

Goal: make `/app/brand` feel like a simple storefront editor.

Tasks:

- Logo and color section.
- Headline and service description.
- Contact info.
- Preview URL.
- Customer-facing preview card.

## Phase 5 — AI agent setup improvement

Goal: make AI configuration safer and easier.

Tasks:

- Presets for company rules.
- Services offered.
- What AI should not promise.
- When to suggest callback.
- When to suggest PDF quote.
- Common customer questions.

## Phase 6 — Public calculator UX review

Goal: improve the customer-facing quote experience.

Tasks:

- Review mobile field flow.
- Review quote result screen.
- Improve PDF quote action.
- Improve callback request placement.
- Improve AI chat placement.
- Add customer trust wording without making the page heavy.

## Phase 7 — Premium SaaS polish

Goal: make the product feel less generic and more premium.

Tasks:

- Loading skeletons.
- Better toast styling.
- Modal system.
- Better mobile dashboard layout.
- Consistent section headers.
- Cleaner table action buttons.

## Phase 8 — WeFixTrades-style public website redesign

Goal: replace the current QuoteFleet public website look with the stronger dark premium product-suite style from the user's other project, `wtsaleksandr-lang/wefixtrades`.

Reason:

- Current QuoteFleet website design still does not feel premium or memorable enough.
- The user explicitly prefers the WeFixTrades visual system and wants QuoteFleet moved closer to it.
- The public website should sell trust through structure, product clarity, and serious freight-tech presentation instead of generic SaaS sections or fake badges.

Reference:

- GitHub repo: `wtsaleksandr-lang/wefixtrades`
- Visual reference screenshots supplied by user from WeFixTrades.
- Use the WeFixTrades-style dark grey/black surfaces, strong blue accents, beige/white CTA cards, compact mono uppercase nav labels, premium hover states, rounded product cards, dropdown/product-grid treatment, and footer structure.

Design direction:

- Apply the WeFixTrades color palette direction 1:1 where reasonable: dark charcoal backgrounds, blue active accents, muted grey text, white/beige CTA buttons, and crisp border lines.
- Use the same general font feel: compact, bold, technical, premium, and product-led.
- Bring over the same style of product cards, hover states, CTA cards, nav/dropdown panels, footer columns, and container borders.
- Make QuoteFleet feel like a serious freight-tech product suite, not a playful startup landing page.
- Keep freight-specific copy, but use the WeFixTrades layout rhythm and visual system.

Scope:

- Landing page.
- Public product pages.
- Pricing page.
- Support/security/footer surfaces.
- Public calculator wrapper only where appropriate; do not make the calculator itself a marketing page.

Implementation notes:

- First inspect the WeFixTrades repo for CSS variables, palette, header/nav, product grid, CTA, dropdown, and footer patterns.
- Do not blindly copy unrelated trade-services copy into QuoteFleet.
- Copy visual style and component treatment, while adapting content to freight/logistics/SaaS.
- Keep changes staged in small PRs:
  1. global public palette/header/footer,
  2. landing hero and product grid,
  3. pricing/support/security page alignment,
  4. responsive and hover polish.
- Avoid quote logic, database schema, auth, payment, email, and API changes during this redesign.
