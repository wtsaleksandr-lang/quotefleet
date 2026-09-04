/**
 * A FAILED FETCH MUST NEVER ERASE GOOD DATA — asserted against the SQL itself.
 *
 * This is the bug #465 and `directory/ingestSoftFailure.test.ts` document, in a
 * new place: a fetch that came back empty was written as an authoritative zero,
 * nulling published columns across ~330k rows and moving `updated_at` on every
 * one of them.
 *
 * The defence in `store.ts` is structural rather than conditional — success and
 * failure are two DIFFERENT statements, and the failure statement does not
 * NAME the data columns at all. A test that only exercised the happy path could
 * never see that, so this file reads the module's own source and checks the
 * failure statement's column list directly. If a future refactor merges the two
 * upserts into one "clever" statement, this fails.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEASONAL_UPDATED_AT_SQL, contentHashOf } from './store.js';
import type { SeasonalRestriction } from '../../calc/osow/seasonal/types.js';

const SOURCE = readFileSync(fileURLToPath(new URL('./store.ts', import.meta.url)), 'utf8');

/**
 * The body of one exported function, by name.
 *
 * Bounded at the first closing brace in COLUMN ZERO, which is the end of a
 * top-level function in this file's style. Bounding it at "the next export"
 * instead swallows the module's private helpers and makes the negative
 * assertions below vacuous — which is exactly what happened on the first draft
 * of this test, so the bound is part of what is being asserted.
 */
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf('\n}\n', start);
  expect(end, `${name} has no top-level closing brace`).toBeGreaterThan(start);
  return SOURCE.slice(start, end + 3);
}

/** Everything a failed fetch has nothing to say about. */
const DATA_COLUMNS = [
  '"rows_json"',
  '"retrieved_on"',
  '"row_count"',
  '"record_count"',
  '"verified_clear"',
  '"content_hash"',
  '"source_revised_on"',
  '"last_success_at"',
  '"updated_at"',
];

describe('recordFailure cannot reach the data', () => {
  const body = functionBody('recordFailure');

  it('ASSIGNS no data column — you cannot clear what you never write', () => {
    // `retrieved_on` IS mentioned, once, and only as a READ inside the CASE
    // that decides `never` versus `stale`. Reading it is how the failure knows
    // whether there is good data to preserve; writing it is the bug. So the
    // assertion is on assignment, not on mention.
    for (const col of DATA_COLUMNS) {
      expect(body, `recordFailure assigns ${col}`).not.toContain(`${col} =`);
      expect(body, `recordFailure takes ${col} from excluded`).not.toContain(
        `excluded.${col}`,
      );
    }
  });

  it('does not even list a data column in its INSERT column list', () => {
    const insertList = /insert into "seasonal_restrictions" \(([\s\S]*?)\)/.exec(body)?.[1] ?? '';
    expect(insertList.length).toBeGreaterThan(0);
    for (const col of DATA_COLUMNS) {
      expect(insertList, `recordFailure inserts ${col}`).not.toContain(col);
    }
  });

  it('names ONLY the three bookkeeping columns it is allowed to write', () => {
    expect(body).toContain('"last_attempt_at"');
    expect(body).toContain('"last_error"');
    expect(body).toContain('"fetch_status"');
  });

  it('degrades a state that HAS data to `stale`, and one that never had any to `never`', () => {
    // The distinction matters downstream: `stale` still renders the last good
    // snapshot with its age; `never` renders "we hold nothing".
    expect(body).toContain('when "seasonal_restrictions"."retrieved_on" is null then \'never\'');
    expect(body).toContain("else 'stale'");
  });
});

describe('recordSuccess writes the data, and only it', () => {
  const body = functionBody('recordSuccess');

  it('writes every data column', () => {
    for (const col of DATA_COLUMNS) expect(body).toContain(col);
  });

  it('moves `updated_at` ONLY when the content actually changed', () => {
    // Eight polls a day per state must not manufacture change timestamps —
    // the same rule CARRIER_UPDATED_AT_SQL enforces for the directory.
    expect(body).toContain('sql.raw(SEASONAL_UPDATED_AT_SQL)');
    expect(SEASONAL_UPDATED_AT_SQL).toContain('IS DISTINCT FROM excluded."content_hash"');
    expect(SEASONAL_UPDATED_AT_SQL).toContain('ELSE "seasonal_restrictions"."updated_at"');
  });

  it('still moves `retrieved_on` on every success — confirming is not the same as changing', () => {
    expect(body).toContain('"retrieved_on" = excluded."retrieved_on"');
  });

  it('updates the in-memory snapshot BEFORE the write, so a DB failure loses only durability', () => {
    const cacheAt = body.indexOf('lastGood.set(');
    const writeAt = body.indexOf('withDbRetry');
    expect(cacheAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(cacheAt);
  });

  it('reports a failed write as false rather than throwing into the cron', () => {
    expect(body).toContain('return false;');
    expect(body).toContain('could not be persisted');
  });
});

describe('the content hash', () => {
  const row = (limit: string): SeasonalRestriction => ({
    value: { scope: 'zone', area: 'North', limit },
    source: {
      id: 'x',
      title: 't',
      url: 'https://example.gov',
      publisher: 'p',
      revisedOn: null,
      retrievedOn: '2026-03-15',
    },
    effectiveFrom: '2026-03-01',
    effectiveTo: '2026-05-01',
  });

  it('is stable for identical content, so a no-change poll is a no-op', () => {
    expect(contentHashOf([row('7 Ton')], false)).toBe(contentHashOf([row('7 Ton')], false));
  });

  it('changes when the restriction changes', () => {
    expect(contentHashOf([row('7 Ton')], false)).not.toBe(contentHashOf([row('5 Ton')], false));
  });

  it('distinguishes a VERIFIED CLEAR from an unclassified empty — they are not the same state', () => {
    expect(contentHashOf([], true)).not.toBe(contentHashOf([], false));
  });
});
