/**
 * Hero-carriers query shape + safe-projection unit tests (no DB required).
 *
 * Covers the homepage hero social-proof feed: the WHERE predicates keep only
 * display-worthy carriers (good standing, not opted-out, real location + fleet),
 * the ORDER BY walks the primary key (a random POOL WINDOW plus a per-call
 * shuffle now supply the variation that `ORDER BY random()` used to buy with a
 * full-table sort), and the card projection emits ONLY contact-free public fields.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  heroCarrierConditions,
  heroCarrierOrder,
  heroCarrierCard,
  sampleCards,
  HERO_CARRIER_LIMIT,
} from './queries.js';
import type { carrierDirectory } from '../../db/schema.js';

const dialect = new PgDialect();
const sqlText = (frag: unknown): string => {
  const q = dialect.sqlToQuery((frag as { getSQL: () => import('drizzle-orm').SQL }).getSQL());
  return q.sql.toLowerCase();
};
const allConditionsText = (): string => heroCarrierConditions().map(sqlText).join(' | ');

/** Minimal fake carrier_directory row for the pure projection tests. */
function fakeRow(over: Partial<typeof carrierDirectory.$inferSelect> = {}): typeof carrierDirectory.$inferSelect {
  return {
    id: 1,
    usdot: '2841196',
    mcNumber: '954120',
    legalName: 'HARBOR LINK DRAYAGE LLC',
    dbaName: null,
    city: 'LONG BEACH',
    state: 'CA',
    country: 'US',
    zip: '90802',
    phone: '5625550100',
    email: 'ops@example.com',
    contactHidden: false,
    powerUnits: 42,
    drivers: 55,
    safetyRating: 'S',
    authorityType: 'common',
    intermodal: true,
    hazmat: false,
    dryVan: false,
    reefer: false,
    tanker: false,
    flatbed: false,
    dryBulk: false,
    householdGoods: false,
    beverages: false,
    produce: false,
    motorVehicles: false,
    livestock: false,
    grainFeed: false,
    oilfield: false,
    meat: false,
    paper: false,
    construction: false,
    farmSupplies: false,
    coalCoke: false,
    buildingMaterials: false,
    nearestPortCode: null,
    publicSlug: 'harbor-link-drayage-2841196',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as typeof carrierDirectory.$inferSelect;
}

describe('heroCarrierConditions — WHERE shape', () => {
  const text = allConditionsText();

  it('keeps only good-standing carriers (drops Conditional / Unsatisfactory)', () => {
    expect(text).toContain("not in ('c', 'u')");
    // Unrated (NULL safety) must be preserved, so the predicate is null-tolerant.
    expect(text).toContain('is null');
  });

  it('excludes carriers who opted out of public contact', () => {
    expect(text).toContain('contact_hidden');
  });

  it('requires a real city, state and an actual fleet (headline stat)', () => {
    expect(text).toContain('"city"');
    expect(text).toContain('"state"');
    expect(text).toContain('power_units');
  });

  it('restricts to US-domiciled carriers', () => {
    expect(text).toContain('country');
  });
});

describe('heroCarrierOrder — variation WITHOUT a full-table sort', () => {
  /**
   * This ORDER BY used to be `random()`. That is a full sort of every qualifying
   * row to take 8, and it ran on EVERY homepage load (hero-carriers.js fetches
   * the endpoint on DOMContentLoaded and the route is `no-store`). Prod EXPLAIN:
   * cost 24,727.62 (Seq Scan 314,554 + Sort) vs 146.09 for the id-ordered window.
   *
   * If anyone reinstates `random()` here, that regression comes straight back —
   * so this test asserts its ABSENCE, not just the presence of the new order.
   */
  it('walks the primary key so Postgres can stop at LIMIT (never a full sort)', () => {
    const text = heroCarrierOrder().map(sqlText).join(' ');
    expect(text).toContain('"id"');
    expect(text).toContain('asc');
    expect(text).not.toContain('random()');
  });

  it('still varies the visible set: a random pool window, then a per-call shuffle', () => {
    // Variation now comes from two cheap layers instead of the sort. Pin them so
    // a future "simplification" cannot quietly make the hero static.
    const pool = Array.from({ length: 40 }, (_, i) => i);
    const a = sampleCards(pool, 8);
    const b = sampleCards(pool, 8);
    expect(a).toHaveLength(8);
    expect(new Set(a).size).toBe(8); // distinct — no card shown twice
    for (const v of a) expect(pool).toContain(v);
    // Two draws of 8 from 40 collide identically with probability ~1/7.7e10.
    expect(a.join(',')).not.toBe(b.join(','));
  });

  it('sampleCards never mutates the cached pool and degrades when it is short', () => {
    const pool = [1, 2, 3];
    const snapshot = pool.slice();
    expect(sampleCards(pool, 8)).toHaveLength(3);
    expect(pool).toEqual(snapshot);
    expect(sampleCards([], 8)).toEqual([]);
  });
});

describe('heroCarrierCard — safe projection', () => {
  it('emits ONLY contact-free public fields (no phone / email / internal id)', () => {
    const card = heroCarrierCard(fakeRow());
    expect(Object.keys(card).sort()).toEqual(['chips', 'ids', 'locLabel', 'locValue', 'name', 'slug'].sort());
    const blob = JSON.stringify(card);
    expect(blob).not.toContain('5625550100');
    expect(blob).not.toContain('ops@example.com');
    expect(card).not.toHaveProperty('id');
    expect(card).not.toHaveProperty('phone');
    expect(card).not.toHaveProperty('email');
  });

  it('links via the public slug and formats the public FMCSA ids', () => {
    const card = heroCarrierCard(fakeRow());
    expect(card.slug).toBe('harbor-link-drayage-2841196');
    expect(card.ids).toBe('USDOT 2841196 · MC 954120');
  });

  it('omits the MC segment when there is no MC number', () => {
    expect(heroCarrierCard(fakeRow({ mcNumber: null })).ids).toBe('USDOT 2841196');
  });

  it('derives equipment badges + a muted Satisfactory chip', () => {
    const card = heroCarrierCard(fakeRow({ intermodal: true, reefer: true, safetyRating: 'S' }));
    const labels = card.chips.map((c) => c.label);
    expect(labels).toContain('Drayage');
    expect(labels).toContain('Reefer');
    expect(card.chips.find((c) => c.label === 'Satisfactory')?.muted).toBe(true);
    // Equipment badges are capped at 2 before the standing chip.
    expect(card.chips.filter((c) => !c.muted).length).toBeLessThanOrEqual(2);
  });

  it('falls back to a single honest chip when no FMCSA equipment flag is set', () => {
    const card = heroCarrierCard(fakeRow({ intermodal: false, reefer: false, safetyRating: null }));
    expect(card.chips.map((c) => c.label)).toEqual(['Motor carrier']);
  });

  it('shows a "Based in City, ST" location when no nearest port is known', () => {
    const card = heroCarrierCard(fakeRow({ nearestPortCode: null, city: 'DALLAS', state: 'TX' }));
    expect(card.locLabel).toBe('Based in');
    expect(card.locValue).toBe('Dallas, TX');
  });

  it('prefers a meaningful DBA name over the legal name', () => {
    const card = heroCarrierCard(fakeRow({ dbaName: 'Pacific Gateway Transport' }));
    expect(card.name).toBe('Pacific Gateway Transport');
  });

  it('exposes a sane default fetch size', () => {
    expect(HERO_CARRIER_LIMIT).toBeGreaterThanOrEqual(6);
    expect(HERO_CARRIER_LIMIT).toBeLessThanOrEqual(8);
  });
});
