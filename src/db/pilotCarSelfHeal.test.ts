/**
 * The pilot-car table's self-heal path.
 *
 * The two things worth pinning here are the ones that took prod down before.
 * (1) Every statement must keep a shape `selfHealTarget()` recognises, because
 * that recognition is what turns a healthy boot into a lock-free catalog probe.
 * (2) No `ALTER TABLE ... ADD COLUMN`, ever, on this table: that form takes
 * ACCESS EXCLUSIVE *before* it checks existence, so "idempotent" is not "free".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PILOT_CAR_DIRECTORY_DDL } from './pilotCarDirectoryDdl.js';
import { SELF_HEAL_TABLE_STATEMENTS, selfHealTarget } from './migrate.js';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('the DDL is folded into the boot self-heal, byte for byte', () => {
  it('every statement in the leaf module is in SELF_HEAL_TABLE_STATEMENTS', () => {
    for (const stmt of PILOT_CAR_DIRECTORY_DDL) {
      expect(SELF_HEAL_TABLE_STATEMENTS, stmt.slice(0, 60)).toContain(stmt);
    }
  });

  it('there is exactly ONE definition — migrate.ts spreads the leaf, it does not copy it', () => {
    const migrateSrc = read('src/db/migrate.ts');
    expect(migrateSrc).toContain('...PILOT_CAR_DIRECTORY_DDL,');
    expect(migrateSrc).not.toContain('CREATE TABLE IF NOT EXISTS "pilot_car_operators"');
  });

  it('the store reads the SAME leaf, so the two can never drift', () => {
    const storeSrc = read('src/server/pilotCars/store.ts');
    expect(storeSrc).toContain("from '../../db/pilotCarDirectoryDdl.js'");
    expect(storeSrc).not.toContain('CREATE TABLE IF NOT EXISTS "pilot_car_operators"');
  });
});

describe('every statement takes the lock-free path', () => {
  it('selfHealTarget() recognises all of them, so a healthy boot is a catalog probe', () => {
    for (const stmt of PILOT_CAR_DIRECTORY_DDL) {
      expect(selfHealTarget(stmt), stmt.slice(0, 60)).not.toBeNull();
    }
  });

  it('uses NO bare ALTER TABLE ADD COLUMN — that form locks before it checks', () => {
    for (const stmt of PILOT_CAR_DIRECTORY_DDL) {
      expect(stmt).not.toMatch(/ALTER TABLE/i);
      expect(stmt).toMatch(/^CREATE (TABLE|UNIQUE INDEX|INDEX) IF NOT EXISTS/);
    }
  });

  it('moves no data on the boot path', () => {
    for (const stmt of PILOT_CAR_DIRECTORY_DDL) {
      expect(stmt).not.toMatch(/\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE|CONCURRENTLY)\b/);
    }
  });
});

describe('the shape is the product', () => {
  const sql = PILOT_CAR_DIRECTORY_DDL.join('\n');

  it('stores certification as per-state ROWS plus an indexed projection, not a boolean', () => {
    expect(sql).toContain('"certifications_json" jsonb');
    expect(sql).toContain('"certified_states" jsonb');
    expect(sql).not.toMatch(/"is_certified"|"certified" boolean/);
  });

  it('indexes the two arrays the whole product filters on', () => {
    expect(sql).toContain('"pilot_car_operators_states_idx" ON "pilot_car_operators" USING gin ("states_covered")');
    expect(sql).toContain('"pilot_car_operators_certified_idx" ON "pilot_car_operators" USING gin ("certified_states")');
  });

  it('carries the escort VEHICLE separately from the driver\'s certification', () => {
    expect(sql).toContain('"vehicle_gvwr_lbs" integer');
    expect(sql).toContain('"vehicle_class" text');
  });

  it('defaults verification to the weakest tier and the listing to unpublished', () => {
    expect(sql).toContain(`"verification_tier" text DEFAULT 'self-asserted' NOT NULL`);
    expect(sql).toContain(`"listing_status" text DEFAULT 'pending' NOT NULL`);
    expect(sql).toContain(`"consent_public_listing" boolean DEFAULT false NOT NULL`);
  });

  it('gates each contact field on its own publish flag', () => {
    for (const col of ['"publish_email"', '"publish_phone"', '"publish_contact_name"']) {
      expect(sql).toContain(`${col} boolean DEFAULT false NOT NULL`);
    }
  });

  it('holds a HASH of the manage token, never the token', () => {
    expect(sql).toContain('"manage_token_hash" text NOT NULL');
    expect(sql).not.toContain('"manage_token" text');
    expect(sql).toContain('"pilot_car_operators_token_idx"');
  });
});

describe('boot wiring', () => {
  const indexSrc = read('src/server/index.ts');

  it('heals the table POST-LISTEN and NON-BLOCKING, like the other new tables', () => {
    expect(indexSrc).toContain('void ensurePilotCarTable().catch(');
    expect(indexSrc).toContain('non-fatal');
  });

  it('says why a failed heal is survivable — the pages degrade rather than 500', () => {
    expect(indexSrc).toContain('no operators found');
  });
});
