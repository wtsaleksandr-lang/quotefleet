/**
 * Hero-carriers query shape + safe-projection unit tests (no DB required).
 *
 * Covers the homepage hero social-proof feed: the WHERE predicates keep only
 * display-worthy carriers (good standing, not opted-out, real location + fleet),
 * the ORDER BY is random (so the featured set varies per load), and the card
 * projection emits ONLY contact-free public fields.
 */
import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  heroCarrierConditions,
  heroCarrierOrder,
  heroCarrierCard,
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

describe('heroCarrierOrder — variation per load', () => {
  it('orders randomly so the featured set rotates each request', () => {
    expect(heroCarrierOrder().map(sqlText).join(' ')).toContain('random()');
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
