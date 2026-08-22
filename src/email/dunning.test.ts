/**
 * Dunning stage-selection logic (pure — no DB, no timers, no Stripe).
 *
 * Covers the four behaviors the worker relies on:
 *   - which stage to send given elapsed time since the payment failed;
 *   - idempotency — a stage already sent never re-sends;
 *   - recovery reset — a no-longer-past-due tenant with stale markers is reset;
 *   - a recovered / never-past-due account sends nothing.
 */
import { describe, it, expect } from 'vitest';
import { nextDunningAction, DUNNING_STAGES, DUNNING_STAGE_KEYS } from './dunning.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 30);
const KEY0 = 'billingDunningSent0';
const KEY3 = 'billingDunningSent3';
const KEY6 = 'billingDunningSent6';

/** ISO for `days` before NOW. */
function pastDue(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

describe('nextDunningAction — stage selection', () => {
  it('sends stage 0 immediately when a payment just failed', () => {
    const action = nextDunningAction({ pastDueSince: pastDue(0), sent: {} }, NOW);
    expect(action).toEqual({ type: 'send', stage: DUNNING_STAGES[0] });
    expect(action && action.type === 'send' && action.stage.id).toBe('0');
  });

  it('sends stage 3 once ~3 days have elapsed and stage 0 is done', () => {
    const action = nextDunningAction(
      { pastDueSince: pastDue(3), sent: { [KEY0]: pastDue(3) } },
      NOW
    );
    expect(action).toEqual({ type: 'send', stage: DUNNING_STAGES[1] });
  });

  it('sends stage 6 once ~6 days have elapsed and stages 0+3 are done', () => {
    const action = nextDunningAction(
      { pastDueSince: pastDue(6), sent: { [KEY0]: pastDue(6), [KEY3]: pastDue(3) } },
      NOW
    );
    expect(action).toEqual({ type: 'send', stage: DUNNING_STAGES[2] });
  });

  it('does NOT send stage 3 before its day-3 threshold', () => {
    const action = nextDunningAction(
      { pastDueSince: pastDue(2), sent: { [KEY0]: pastDue(2) } },
      NOW
    );
    expect(action).toBeNull();
  });

  it('sends the earliest unsent due stage first (one per tick) on catch-up', () => {
    // Past-due 7 days but nothing sent yet (e.g. worker just deployed): send
    // stage 0 first, not the latest stage.
    const action = nextDunningAction({ pastDueSince: pastDue(7), sent: {} }, NOW);
    expect(action).toEqual({ type: 'send', stage: DUNNING_STAGES[0] });
  });
});

describe('nextDunningAction — idempotency', () => {
  it('does not resend a stage already recorded', () => {
    const action = nextDunningAction(
      { pastDueSince: pastDue(0), sent: { [KEY0]: pastDue(0) } },
      NOW
    );
    expect(action).toBeNull();
  });

  it('sends nothing once all three stages are done', () => {
    const action = nextDunningAction(
      {
        pastDueSince: pastDue(10),
        sent: { [KEY0]: pastDue(10), [KEY3]: pastDue(7), [KEY6]: pastDue(4) },
      },
      NOW
    );
    expect(action).toBeNull();
  });
});

describe('nextDunningAction — recovery reset', () => {
  it('resets the sequence when no longer past-due but stale markers remain', () => {
    const action = nextDunningAction(
      { pastDueSince: null, sent: { [KEY0]: pastDue(10), [KEY3]: pastDue(7) } },
      NOW
    );
    expect(action).toEqual({ type: 'reset' });
  });

  it('sends NOTHING for a recovered account with no markers', () => {
    const action = nextDunningAction({ pastDueSince: null, sent: {} }, NOW);
    expect(action).toBeNull();
  });

  it('ignores unrelated lifecycle keys (does not treat them as dunning markers)', () => {
    const action = nextDunningAction(
      { pastDueSince: null, sent: { welcome: pastDue(30), day_7: pastDue(20) } },
      NOW
    );
    expect(action).toBeNull();
  });

  it('after a reset, a fresh past-due restarts at stage 0', () => {
    // Simulate the state the cron leaves post-reset (stage keys cleared), then a
    // new failure stamps a fresh pastDueSince.
    const action = nextDunningAction(
      { pastDueSince: pastDue(0), sent: { welcome: pastDue(30) } },
      NOW
    );
    expect(action).toEqual({ type: 'send', stage: DUNNING_STAGES[0] });
  });
});

describe('nextDunningAction — robustness', () => {
  it('does nothing on a malformed pastDueSince timestamp', () => {
    const action = nextDunningAction({ pastDueSince: 'not-a-date', sent: {} }, NOW);
    expect(action).toBeNull();
  });

  it('exposes exactly the three stage keys used for reset', () => {
    expect(DUNNING_STAGE_KEYS).toEqual([KEY0, KEY3, KEY6]);
  });
});
