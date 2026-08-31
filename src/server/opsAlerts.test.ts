/**
 * ops_alerts — the pure half: urgency, deadlines, money, digest lines.
 *
 * The DB half (upsert/resolve/list) is exercised through the callers' own tests
 * with injected fakes; what is asserted here is the part that decides whether a
 * human is told "today" or "eventually", which must never depend on a clock or
 * a connection to be reviewable.
 */
import { describe, it, expect } from 'vitest';
import {
  isOpsAlertUrgent,
  formatDeadline,
  formatAmount,
  opsAlertLine,
  truncateAlertDetail,
  OPS_ALERT_DETAIL_MAX,
  OPS_ALERT_URGENT_WINDOW_MS,
  OPS_ALERTS_SELF_HEAL_STATEMENTS,
  type OpsAlertRow,
} from './opsAlerts.js';
import { selfHealTarget } from '../db/migrate.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function row(over: Partial<OpsAlertRow> = {}): OpsAlertRow {
  return {
    kind: 'card_problem',
    ref: 'cus_1',
    status: 'open',
    title: 'Card expiring — Acme (tenant #1)',
    detail: null,
    amountCents: null,
    currency: null,
    dueAt: null,
    marker: null,
    openedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('isOpsAlertUrgent', () => {
  it('a dispute is ALWAYS urgent, with or without a deadline', () => {
    expect(isOpsAlertUrgent(row({ kind: 'stripe_dispute', dueAt: null }), NOW)).toBe(true);
    expect(
      isOpsAlertUrgent(row({ kind: 'stripe_dispute', dueAt: new Date('2026-12-01T00:00:00Z') }), NOW),
    ).toBe(true);
  });

  it('a non-dispute with no deadline is not urgent', () => {
    expect(isOpsAlertUrgent(row({ dueAt: null }), NOW)).toBe(false);
  });

  it('becomes urgent only once the deadline is inside the window', () => {
    const justOutside = new Date(NOW.getTime() + OPS_ALERT_URGENT_WINDOW_MS + 60_000);
    const justInside = new Date(NOW.getTime() + OPS_ALERT_URGENT_WINDOW_MS - 60_000);
    expect(isOpsAlertUrgent(row({ dueAt: justOutside }), NOW)).toBe(false);
    expect(isOpsAlertUrgent(row({ dueAt: justInside }), NOW)).toBe(true);
  });

  it('an already-passed deadline is urgent, not ignored', () => {
    expect(isOpsAlertUrgent(row({ dueAt: new Date('2026-05-01T00:00:00Z') }), NOW)).toBe(true);
  });
});

describe('formatDeadline', () => {
  it('reads forward in days', () => {
    expect(formatDeadline(new Date('2026-06-05T00:00:00Z'), NOW)).toBe('due in 4.0 days');
  });
  it('falls back to hours inside a day', () => {
    expect(formatDeadline(new Date('2026-06-01T06:00:00Z'), NOW)).toBe('due in 6 h');
  });
  it('says OVERDUE rather than a negative number', () => {
    expect(formatDeadline(new Date('2026-05-30T00:00:00Z'), NOW)).toBe('OVERDUE by 2.0 days');
  });
});

describe('formatAmount', () => {
  it('renders USD cents as dollars', () => {
    expect(formatAmount(4250, 'usd')).toBe('$42.50');
  });
  it('names a non-USD currency instead of faking a dollar sign', () => {
    expect(formatAmount(4250, 'eur')).toBe('42.50 EUR');
  });
  it('is null when there is no amount (never "$0.00")', () => {
    expect(formatAmount(null, 'usd')).toBeNull();
  });
});

describe('opsAlertLine', () => {
  it('leads with the title, then money, then the deadline', () => {
    const line = opsAlertLine(
      row({
        kind: 'stripe_dispute',
        title: 'Stripe dispute — Acme (tenant #7)',
        amountCents: 12000,
        currency: 'usd',
        dueAt: new Date('2026-06-05T00:00:00Z'),
      }),
      NOW,
    );
    expect(line).toContain('Stripe dispute — Acme (tenant #7)');
    expect(line).toContain('$120.00');
    expect(line).toContain('due in 4.0 days');
  });

  it('omits absent parts rather than printing empty separators', () => {
    expect(opsAlertLine(row({ title: 'Bare' }), NOW)).toBe('Bare');
  });

  it('puts the detail on its own indented line', () => {
    expect(opsAlertLine(row({ title: 'T', detail: 'why it matters' }), NOW)).toContain('\n      why it matters');
  });
});

describe('truncateAlertDetail', () => {
  it('keeps a short detail verbatim and drops an empty one', () => {
    expect(truncateAlertDetail('  hello  ')).toBe('hello');
    expect(truncateAlertDetail('   ')).toBeNull();
    expect(truncateAlertDetail(undefined)).toBeNull();
  });
  it('caps a long detail with an ellipsis', () => {
    const out = truncateAlertDetail('x'.repeat(OPS_ALERT_DETAIL_MAX + 500))!;
    expect(out.length).toBe(OPS_ALERT_DETAIL_MAX);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('self-heal DDL', () => {
  it('every statement is a shape the catalog pre-check recognizes', () => {
    // A shape selfHealTarget cannot parse still runs, but takes a table lock on
    // every healthy boot — which is what the pre-check exists to avoid.
    for (const s of OPS_ALERTS_SELF_HEAL_STATEMENTS) {
      expect(selfHealTarget(s), s.slice(0, 60)).not.toBeNull();
    }
  });

  it('creates the (kind, ref) UNIQUE index the at-least-once upsert depends on', () => {
    // Without it, a re-delivered Stripe webhook silently duplicates the alert.
    const joined = OPS_ALERTS_SELF_HEAL_STATEMENTS.join('\n');
    expect(joined).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "ops_alerts_kind_ref_idx"/);
  });
});
