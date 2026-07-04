# Testing checklist

Run before demo or deploy.

```bash
pnpm typecheck
pnpm test
```

Open these pages after restart:

- `/`
- `/pricing`
- `/security`
- `/w/demo`
- `/quote-demo.html`
- `/marketplace/`

Widget checks:

- service tabs fit on mobile
- pickup and delivery fields align
- help icons open on first tap or click
- add-ons wrap neatly
- sample quote calculates
- contact step opens correctly

Dashboard checks:

- `/app/brand` saves carrier profile fields
- `/app/leads` shows hosted quote actions
- `/app/accessorials` shows filters
- rate cards and zones load

Quote page checks:

```bash
pnpm quotes:recent
```

Open `/quote/<refId>` and check header, quote details, pricing, print, mobile layout, and activity tracking.
