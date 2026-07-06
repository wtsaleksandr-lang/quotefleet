# QuoteFleet accessibility polish checklist

Use this checklist for small frontend support passes. Keep changes isolated and avoid product logic.

## Keyboard access

- Interactive controls can be reached with Tab.
- Focus order follows the visual order.
- Primary actions have visible focus states.
- Escape closes lightweight overlays when overlays are present.

## Labels and names

- Buttons use clear action labels.
- Form fields have visible labels or accessible names.
- Icon-only controls include text for assistive technology.
- Links describe the destination or action.

## Layout and responsive polish

- Content remains readable at narrow widths.
- Cards and tables do not force unnecessary horizontal scrolling.
- Touch targets have enough spacing on mobile.
- Empty states include a clear next action.

## Motion and visual comfort

- Animations are subtle and non-blocking.
- Reduced-motion preferences are respected when possible.
- Loading states do not hide important context.

## Safe support-work rule

Accessibility polish should stay frontend-only. Do not change quote calculation, API behavior, data models, authentication, payments, or AI workflow behavior as part of an accessibility pass.
