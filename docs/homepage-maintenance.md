# Homepage maintenance guide

This guide documents the current QuoteFleet homepage direction so future edits do not drift back into heavy, confusing, or fear-triggering messaging.

## Core positioning

The homepage should communicate this idea quickly:

- A trucking service provider can get a branded hosted rate page.
- The page can be shared by link.
- It can be added to an email signature.
- It can be used internally to create a branded PDF quote.
- Optional AI chat can answer basic customer questions.
- Follow-up reminders help keep warm quote activity visible.
- No website changes are required to start.
- No contracts or heavy software setup should be implied.

## Hero rules

Keep the hero simple and visual-first.

Current approved hero direction:

- Eyebrow: `For trucking service providers`
- Headline: `Start sharing live rates in one day.`
- Subtext: `No website changes needed. No heavy setup. Just your own branded page that customers can open anytime.`
- Trust line: `No contracts · Share by link · Optional AI chat`

Avoid adding more text above the fold unless it replaces existing text.

## Words and phrases to avoid on the homepage

Avoid these phrases outside of technical/admin pages:

- quote desk
- freight quote leads
- private rates by default
- turn website visitors into freight quote leads
- quote freight faster from your website

Reason: these sound heavy, generic, or may trigger unnecessary concern about rate exposure.

Rate access/control language belongs in FAQ only.

## Visual story to preserve

The homepage should show this flow visually:

1. Your rates
2. Your branded page
3. Customer view
4. PDF quote / AI chat / follow-up

Preferred visuals:

- hosted URL example such as `acmetrucking.yourquote.net`
- email signature snippet
- branded PDF quote card
- AI chat bubbles
- follow-up queue card

## Mobile QA checklist

Before merging homepage edits, check mobile at a narrow width.

The mobile hero should show:

- QuoteFleet header
- Start free button
- short eyebrow
- headline
- short subtext
- primary CTA
- light demo/how-it-works link
- short trust line
- visual flow starting soon after

Watch for:

- headline becoming too tall
- CTA stack taking too much space
- quick-point cards wrapping awkwardly
- product visual pushed too far below the fold
- dark background feeling too heavy

## Motion rules

Homepage motion must be subtle and optional.

Current reveal behavior:

- `landing-motion.js` adds `.is-visible` as sections enter viewport.
- CSS must scope hidden reveal states behind `.js [data-reveal]`.
- Content must remain visible if JavaScript is disabled.
- Reduced-motion users must not get scroll animation.

Do not add animation that hides important content without a safe fallback.

## Smoke-test expectations

The public smoke tests should continue to check:

- current hero copy
- no old placeholder footer links
- no old heavy phrases
- social metadata
- social preview copy
- motion helper safety
- reveal fallback guardrails
- widget static files
- quote static files

Update tests whenever homepage positioning changes intentionally.
