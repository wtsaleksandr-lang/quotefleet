# Rate import workbook format

Use `pnpm rates:import -- --tenant-slug=YOUR_SLUG --file=/path/to/rates.xlsx`.

The importer reads up to three sheets. It upserts records, so it updates existing rows when it finds a match instead of duplicating them.

## Sheet: Rate Cards

Matches existing rows by `service + equipment`.

Columns:

| Column | Required | Example |
|---|---:|---|
| service | yes | drayage |
| equipment | yes | container_40 |
| label | no | 40' Standard Container |
| ratePerMile | no | 4.5 |
| minimumCharge | no | 400 |
| flatFee | no | 50 |
| fuelSurchargePct | no | 18 |
| marginPct | no | 12 |
| maxWeightLbs | no | 44000 |
| maxMiles | no | 300 |
| enabled | no | yes |
| sortOrder | no | 110 |
| notes | no | local drayage default |

## Sheet: Accessorials

Matches existing rows by `code`.

Columns:

| Column | Required | Example |
|---|---:|---|
| code | yes | chassis_rental |
| label | yes | Chassis Rental |
| description | no | Daily chassis rental |
| kind | no | per_day |
| amount | no | 40 |
| trigger | no | optional |
| appliesToServices | no | drayage;ftl |
| enabled | no | yes |
| sortOrder | no | 101 |

## Sheet: Lane Zones

Matches existing rows by `label`.

Columns:

| Column | Required | Example |
|---|---:|---|
| label | yes | Chicago Rail Local 0-30 mi |
| anchorPortCode | no | USCHI |
| anchorCity | no | Chicago |
| anchorState | no | IL |
| radiusMiles | yes | 30 |
| flatPrice | yes | 375 |
| equipmentScope | no | container_20;container_40;container_40hc |
| enabled | no | yes |
| sortOrder | no | 10 |

## Notes

- Sheet names are flexible: `Rate Cards`, `rate_cards`, or `rates`; `Accessorials`, `add-ons`, or `addons`; `Lane Zones`, `lane_zones`, or `zones`.
- Money symbols and percent signs are stripped automatically.
- `enabled` accepts `yes`, `true`, `1`, `active`, or `enabled`.
- Existing rows are updated; missing rows are inserted.
