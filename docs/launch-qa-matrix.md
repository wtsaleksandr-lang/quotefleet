# QuoteFleet launch QA matrix

Use this matrix before a real business launch. It is focused on realistic freight quote behavior, messy customer input, and the customer journey from quote estimate to lead follow-up.

This document intentionally does not cover payment processor wiring or outbound email wiring.

## Launch readiness target

A public launch should not happen until the following are true:

- Public calculator can handle normal and messy customer input without breaking.
- Quote totals are explainable through line items.
- Missing-rate scenarios show clear customer-facing guidance.
- Drayage port and terminal flows work when the user knows the terminal and when they do not.
- Contact capture respects the carrier's email/phone requirements.
- Lead records preserve operational context for dispatch and sales follow-up.
- Dashboard users can find, review, and act on new leads without guessing.

## Core freight scenarios

| Scenario | Example lane | Required checks | Launch status |
|---|---|---|---|
| FTL dry van | Chicago, IL to Atlanta, GA, 38,000 lb | rate card match, linehaul, fuel, margin, written quote request | Must pass |
| LTL | Toronto, ON to Montreal, QC, 2 pallets | equipment selection, weight handling, minimum charge behavior | Must pass |
| Drayage port pickup | USLAX / Long Beach terminal to Ontario, CA | port selector, terminal search, zone tariff, terminal surcharge | Must pass |
| Drayage unknown terminal | Port known, terminal unknown | `I don't know yet` path, no blocking, dispatcher note preserved | Must pass |
| Residential delivery | Any FTL/LTL quote with residential flag | residential accessorial auto-applies | Must pass |
| Hazmat | Any quote with hazmat flag | hazmat accessorial auto-applies, no unsupported promise | Must pass |
| Overweight | 45,000+ lb load | overweight accessorial or unsupported guidance | Must pass |
| Temp-control | Reefer or temp-control flag | matching equipment/accessorial behavior | Must pass |
| Missing rate card | unsupported equipment/service combo | clear no-rate message, no broken total | Must pass |
| Long lane | Coast-to-coast quote | no overflow, reasonable formatting, line items readable | Must pass |
| Canada postal | M5V / H3B style postal input | location parsing/geocode fallback behavior | Must pass |
| Bad input | empty pickup, empty delivery, typo city | helpful validation, no crash | Must pass |

## Public calculator UX checklist

- Service tabs are clear on mobile.
- Equipment labels are understandable to non-dispatch users.
- Drayage port selector is searchable by port, city, code, or state.
- Terminal selector is searchable by terminal name, carrier, or code.
- Terminal field lets the customer choose `I don't know yet`.
- Add-ons are visibly optional.
- Customer can see that the estimate is not final dispatch confirmation.
- Result screen explains what happens next.
- Written quote CTA is more prominent than secondary actions.
- Errors are short, actionable, and not technical.

## Dashboard QA checklist

- New leads appear in the lead queue.
- Lead detail page shows customer, shipment, quote, notes, and contact context.
- Callback requests appear in callback queue.
- Rate cards, accessorials, and zones can be reviewed after a quote fails.
- Trial/lead quota states block new lead capture only when intended.
- Admin can still access tenant context for support.

## Automated smoke coverage added

The `launchFreightQaMatrix.test.ts` suite verifies representative engine behavior for:

- FTL dry van with messy flags and selected accessorials.
- Drayage zone tariff with selected terminal surcharge.
- Unsupported service/equipment combinations.
- Presence of this launch QA matrix and required scenario names.

## Manual QA sign-off template

Before launch, copy this checklist into the launch issue or release notes:

```text
Public widget tested on desktop: yes/no
Public widget tested on mobile: yes/no
FTL test lane passed: yes/no
LTL test lane passed: yes/no
Drayage known-terminal lane passed: yes/no
Drayage unknown-terminal lane passed: yes/no
Missing-rate path passed: yes/no
Lead capture path passed: yes/no
Callback path passed: yes/no
Customer chat path passed: yes/no
Dashboard lead review passed: yes/no
Quote PDF/print path passed: yes/no
Known launch blockers remaining:
```
