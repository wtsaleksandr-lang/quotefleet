/**
 * /guides SEO content engine — runtime gate.
 *
 * The engine is INERT by default. Generation may proceed ONLY when BOTH:
 *   1. the SEO_ENGINE_ENABLED env flag is truthy, AND
 *   2. the seo_engine_settings.kill_switch DB row is OFF.
 *
 * FAILS CLOSED. A brand-new feature must never start doing work on its own, so
 * an unset flag leaves the engine disabled AND a settings-read failure leaves it
 * disabled. This is the opposite posture from QuoteFleet's other background
 * features (directory auto-heal, sitemap recompute), which are load-bearing and
 * fail open — this one spends money and publishes content, so it fails shut.
 *
 * This gate guards GENERATION side-effects only. The public RENDER path
 * (serving an already-approved /guides row) is deliberately NOT gated: once a
 * human has reviewed and published an article it is live SEO content, and
 * pulling it offline because a generation flag flipped would be a self-inflicted
 * ranking loss. Render visibility is governed solely by status='published'.
 *
 * Note the SECOND, independent gate on spend: even with this gate open, the
 * actual LLM call still has to clear externalPullGuard's `anthropic_seo` slot
 * (SEO_ENGINE_LIVE_LLM / EXTERNAL_PULLS_ENABLED), which is itself default-deny
 * and can never be opened inside a test runner by env alone.
 */

import { getSeoEngineSettings } from './store.js';

export interface SeoGateResult {
  allowed: boolean;
  /** Human-readable reason when allowed === false. */
  reason?: string;
}

const TRUEY = /^(1|true|yes|on)$/i;

/** True when the SEO_ENGINE_ENABLED env flag is set to a truthy value. */
export function isSeoEngineFlagEnabled(): boolean {
  return TRUEY.test((process.env.SEO_ENGINE_ENABLED ?? '').trim());
}

/**
 * Pure gate decision from the two inputs. Extracted so it is deterministically
 * testable without a DB; checkSeoEngineGate() reads the live values and
 * delegates here.
 */
export function evaluateSeoEngineGate(flagEnabled: boolean, killSwitch: boolean): SeoGateResult {
  if (!flagEnabled) {
    return { allowed: false, reason: 'SEO engine is disabled — SEO_ENGINE_ENABLED is not set.' };
  }
  if (killSwitch) {
    return { allowed: false, reason: 'SEO engine is paused — the admin kill switch is ON.' };
  }
  return { allowed: true };
}

/**
 * Gate for SEO-engine generation side-effects. Returns { allowed: false } when
 * the env flag is unset OR the DB kill switch is on OR the settings row cannot
 * be read (fail-closed).
 */
export async function checkSeoEngineGate(): Promise<SeoGateResult> {
  if (!isSeoEngineFlagEnabled()) {
    return evaluateSeoEngineGate(false, false);
  }

  let killSwitch: boolean;
  try {
    killSwitch = (await getSeoEngineSettings()).killSwitch;
  } catch (err) {
    // Fail CLOSED and log loudly — a dormant feature must not start itself on a
    // transient DB error.
    console.error(
      '[seo] settings read failed — keeping engine disabled (fail-closed):',
      (err as Error)?.message,
    );
    return { allowed: false, reason: 'SEO engine settings unavailable — engine held disabled.' };
  }

  return evaluateSeoEngineGate(true, killSwitch);
}
