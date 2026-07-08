# Homepage cleanup note

This pass tightens the QuoteFleet public homepage after visual review.

Goals:

- Reduce clutter and repetition.
- Remove remaining teal/green visual leftovers.
- Use WeFixTrades-style blue as the only contrast accent.
- Use dark grey background surfaces.
- Use beige + black/dark card treatment for the hero visual.
- Add more breathing room between homepage sections.
- Keep calculator and backend logic unchanged.

Implementation:

- `landing-wefixtrades-cleanup.css` is the final landing override loaded by `landing-motion.js`.
- The original landing HTML is intentionally kept mostly stable because older smoke tests depend on existing text hooks.
- Visual cleanup is handled through CSS overrides.
