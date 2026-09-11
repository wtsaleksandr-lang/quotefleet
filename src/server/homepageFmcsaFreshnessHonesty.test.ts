/**
 * THE HOMEPAGE MUST NOT CLAIM A SYNC CADENCE THE CRON DOES NOT RUN.
 *
 * ─── THE CLAIM THIS FILE RETIRED ──────────────────────────────────────────
 * landing.html said "Synced daily from FMCSA data." and listed "Daily FMCSA
 * sync" as a headline stat beside the carrier/city counts. The FMCSA
 * re-ingest cron is WEEKLY: one off-peak slot, Sunday 09:00 UTC, behind a 6-day
 * cooldown (directoryRefreshCron.ts). The product's own carrier profiles had
 * been contradicting the homepage in public for weeks — they render "FMCSA data
 * as of Aug 31, 2026." from the row's real `updated_at`.
 *
 * ─── WHY THE TEST DOES NOT JUST ASSERT "weekly" ───────────────────────────
 * A hard-coded cadence word is a claim with no source: it was true once, the
 * schedule moved, and the copy did not. Asserting the string "weekly" would
 * pin the same fragile shape one rename lower. So:
 *
 *   1. THE CADENCE GUARD reads the REAL cron constants (REFRESH_DAY /
 *      REFRESH_HOUR / COOLDOWN) and fails if the page claims a faster cadence
 *      than the schedule actually runs. If someone moves the cron to daily, the
 *      page copy becomes legal automatically; if someone writes "daily" while
 *      the cron stays weekly, this fails.
 *   2. THE VINTAGE PATH asserts that when the real data vintage IS known the
 *      page states it instead of any cadence at all — the drift-proof form.
 *   3. THE FALLBACK asserts the no-database render is itself truthful, because
 *      that is what ships on a cold cache.
 *
 * Pure string/render assertions — no DB, no network.
 */
import { describe, expect, it } from 'vitest';
import { renderStaticPage } from './siteChrome.js';
import {
  applyFmcsaFreshness,
  formatFmcsaAsOf,
  FMCSA_ASOF_SLOT,
  FMCSA_ASOF_SHORT_SLOT,
} from './directory/fmcsaFreshness.js';
import { REFRESH_DOW, REFRESH_HOUR, REFRESH_COOLDOWN_MS } from './directoryRefreshCron.js';

const LANDING = renderStaticPage('landing.html');

/** Cadence words a page could claim, with the minimum interval each implies. */
const CADENCE_CLAIMS: Array<[RegExp, number, string]> = [
  [/\bhourly\b/gi, 60 * 60 * 1000, 'hourly'],
  [/\bdaily\b/gi, 24 * 60 * 60 * 1000, 'daily'],
  [/\bevery day\b/gi, 24 * 60 * 60 * 1000, 'every day'],
  [/\breal[- ]?time\b/gi, 60 * 1000, 'real-time'],
  [/\blive sync\b/gi, 60 * 1000, 'live sync'],
];

/**
 * Cadence words near an FMCSA/sync mention, with a window of surrounding text.
 *
 * SCOPED ON PURPOSE. A blanket page-wide ban on "daily" would also fire on
 * unrelated, perfectly true copy ("the work you do every day" on the pricing
 * card). The claim under test is specifically "how often OUR FMCSA data
 * refreshes", so the match only counts when the word sits beside that subject.
 */
const CONTEXT_CHARS = 140;
function cadenceClaimsAboutFmcsa(html: string, re: RegExp): string[] {
  const hits: string[] = [];
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const window = html.slice(
      Math.max(0, m.index - CONTEXT_CHARS),
      m.index + m[0].length + CONTEXT_CHARS,
    );
    if (/FMCSA|\bsync(ed|hronis|hroniz)?\b/i.test(window)) hits.push(window);
  }
  re.lastIndex = 0;
  return hits;
}

describe('the homepage cannot out-claim the FMCSA cron', () => {
  it('the cron really is a once-a-week slot (the guard reads the real constants)', () => {
    // Guard on the guard: if this ever stops being true, the assertions below
    // would be measuring nothing.
    expect(REFRESH_DOW).toBe(0); // Sunday
    expect(REFRESH_HOUR).toBe(9);
    expect(REFRESH_COOLDOWN_MS).toBeGreaterThan(5 * 24 * 60 * 60 * 1000);
  });

  it('claims no sync cadence faster than the schedule actually runs', () => {
    // The cron fires at most once per its cooldown window. Any copy implying a
    // shorter interval than that is a factual misstatement, whatever the word.
    for (const [re, impliedMs, label] of CADENCE_CLAIMS) {
      if (impliedMs >= REFRESH_COOLDOWN_MS) continue;
      expect(
        cadenceClaimsAboutFmcsa(LANDING, re),
        `homepage claims "${label}" FMCSA sync but the cron runs at most once per ` +
          `${Math.round(REFRESH_COOLDOWN_MS / 86_400_000)} days`,
      ).toEqual([]);
    }
  });

  it('the cadence guard really fires (it is not passing vacuously)', () => {
    // Guard on the guard: feed it the exact copy that shipped and it must catch
    // it — otherwise the assertion above proves nothing.
    const regressed = LANDING.replace(
      'Refreshed weekly from FMCSA data.',
      'Synced daily from FMCSA data.',
    );
    expect(cadenceClaimsAboutFmcsa(regressed, /\bdaily\b/gi)).not.toEqual([]);
    // …and it must NOT fire on the unrelated, true "every day" copy elsewhere.
    expect(cadenceClaimsAboutFmcsa(LANDING, /\bevery day\b/gi)).toEqual([]);
  });

  it('specifically no longer says "Synced daily from FMCSA data" or "Daily FMCSA sync"', () => {
    // The two exact strings the audit found live.
    expect(LANDING).not.toContain('Synced daily from FMCSA data');
    expect(LANDING).not.toContain('Daily FMCSA sync');
  });
});

describe('the homepage states the real data vintage when it is known', () => {
  it('carries both freshness slots so the injector has somewhere to write', () => {
    expect(LANDING).toContain(FMCSA_ASOF_SLOT);
    expect(LANDING).toContain(FMCSA_ASOF_SHORT_SLOT);
  });

  it('replaces the cadence copy with the actual max(updated_at) vintage', () => {
    // The SAME date the carrier profiles publish, through the SAME formatter.
    const asOf = new Date('2026-08-31T04:12:00.000Z');
    const out = applyFmcsaFreshness(LANDING, asOf);
    expect(formatFmcsaAsOf(asOf)).toBe('Aug 31, 2026');
    expect(out).toContain('FMCSA data as of Aug 31, 2026.');
    expect(out).toContain('<strong>Aug 31, 2026</strong> FMCSA data');
    // Once the real vintage is rendered, no cadence word is claimed at all —
    // which is the whole point: a date cannot drift away from the schedule.
    expect(out).not.toMatch(/\bweekly\b/i);
  });

  it('is drift-proof: a stalled ingest shows an OLD date rather than a fresh promise', () => {
    // If the cron silently no-ops for a month, the page says so in public.
    const stale = new Date('2026-06-01T00:00:00.000Z');
    expect(applyFmcsaFreshness(LANDING, stale)).toContain('FMCSA data as of Jun 1, 2026.');
  });
});

describe('the no-database fallback is itself truthful', () => {
  it('leaves the page untouched when the vintage is unknown', () => {
    // Cold cache / empty directory / DB blip. The injector must not blank the
    // slots or print "Invalid Date" — the static copy stands.
    expect(applyFmcsaFreshness(LANDING, null)).toBe(LANDING);
  });

  it('and that static copy states the WEEKLY cadence the cron actually runs', () => {
    expect(LANDING).toContain('Refreshed weekly from FMCSA data.');
    expect(LANDING).toContain('<strong>Weekly</strong> FMCSA sync');
  });
});
