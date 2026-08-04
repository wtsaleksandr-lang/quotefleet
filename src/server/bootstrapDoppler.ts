/**
 * Doppler → process.env bootstrap. Runs FIRST in server/index.ts, before
 * any other module that reads process.env (config.ts's loadEnv(),
 * db/client.ts, etc.).
 *
 * Goal: pull secrets stored only in Doppler (project `quotefleet`) into the
 * runtime env so we don't have to manually mirror everything into Replit
 * Secrets. The inverse case — secrets only in Replit Secrets — also still
 * works because Replit-injected env vars take precedence by default (we only
 * fill in MISSING keys; never overwrite).
 *
 * Two-token / env-matched selection: Replit Secrets are SHARED between the dev
 * workflow and the production deployment, so BOTH Doppler service tokens are
 * visible in both environments:
 *   - `DOPPLER_TOKEN`         = a dev service token  (`dp.st.dev.…`)
 *   - `DOPPLER_SERVICE_TOKEN` = a prd service token  (`dp.st.prd.…`)
 * We must NOT let prod boot on the dev token (that would pull test-mode Stripe
 * / dev email into prod). {@link selectDopplerToken} picks the token whose
 * embedded `dp.st.<config>.` matches the target config for this environment —
 * `prd` when `NODE_ENV === 'production'` (consistent with config.ts), else
 * `dev` — falling back to whatever single token is present. The chosen token
 * then drives {@link detectDopplerConfig}, so the pulled config always matches
 * the token (a prd token can only read /quotefleet/prd or the API 403s).
 *
 * Override list (opt-in escape hatch): `DOPPLER_OVERRIDE_KEYS` —
 * comma-separated list of env-var names whose Doppler value should WIN over
 * any pre-existing process.env value. Default is empty (no overrides →
 * existing behaviour). The list can be set in Replit Secrets (highest
 * priority, useful for emergency disable) or in the Doppler config itself.
 *
 * Failure mode: soft. If no Doppler token is present, Doppler is unreachable, the
 * response is malformed, or the request times out, we log a warning and
 * continue with whatever env the runtime already has. The server still boots;
 * only Doppler-only secrets are missing. With NO Doppler token at all this
 * module is a complete no-op — boot behaves exactly as it did on Replit
 * Secrets alone.
 *
 * Sync execution via execSync curl is deliberate — we need the secrets in
 * process.env BEFORE any other ESM import runs, and Node's native fetch is
 * async-only. The Replit autoscale container is single-tenant so
 * argv-visibility of the token for ~5s is acceptable risk.
 */

import { execSync } from 'node:child_process';

// Doppler CLI / bootstrap bookkeeping vars — these configure the bootstrap
// itself, not runtime app secrets, so we never inject them into process.env.
// Any other `DOPPLER_*`-prefixed key in the config IS a legitimate runtime
// secret and must be injected.
export const DOPPLER_BOOKKEEPING = new Set([
  'DOPPLER_TOKEN',
  'DOPPLER_SERVICE_TOKEN',
  'DOPPLER_PROJECT',
  'DOPPLER_CONFIG',
  'DOPPLER_ENVIRONMENT',
  'DOPPLER_OVERRIDE_KEYS',
]);

/** Shape of a single secret entry as returned by the Doppler API. */
export interface DopplerSecretValue {
  computed?: string;
  raw?: string;
}

export type DopplerSecrets = Record<string, DopplerSecretValue>;

/** Summary of what {@link applyDopplerSecrets} mutated. */
export interface ApplyResult {
  applied: number;
  skippedExisting: number;
  skippedEmpty: number;
  overrode: number;
  overrodeNames: string[];
}

/**
 * Detect which Doppler config to read. Precedence:
 *   1. explicit `configOverride` (DOPPLER_CONFIG),
 *   2. parse from service-token format `dp.st.<config>.<id>` (service tokens
 *      are config-scoped, so this prevents the silent 403 mismatch where a
 *      `dp.st.prd.X` token tries to read /quotefleet/dev),
 *   3. NODE_ENV=production → "prd",
 *   4. fall back to "dev".
 */
export function detectDopplerConfig(
  token: string,
  configOverride?: string,
  nodeEnv?: string,
): string {
  if (configOverride && configOverride.trim() !== '') return configOverride;
  const tokenMatch = /^dp\.st\.([a-z0-9_-]+)\./.exec(token);
  if (tokenMatch?.[1]) return tokenMatch[1];
  if (nodeEnv === 'production') return 'prd';
  return 'dev';
}

/**
 * Pick the env-matched Doppler service token from the (shared) Replit Secrets.
 *
 * Replit Secrets are shared between the dev workflow and the production
 * deployment, so BOTH tokens are visible in both environments:
 *   - `DOPPLER_SERVICE_TOKEN` = prd token (`dp.st.prd.…`)
 *   - `DOPPLER_TOKEN`         = dev token (`dp.st.dev.…`)
 *
 * We compute the target config for THIS environment (`prd` in production, else
 * `dev` — consistent with config.ts's NODE_ENV check) and return the token
 * whose embedded `dp.st.<config>.` matches. If none of the available tokens
 * match the target config, we return the first available token (single-token
 * legacy fallback). If no token is present at all, returns undefined so the
 * caller can soft-skip.
 */
export function selectDopplerToken(
  env: Record<string, string | undefined>,
): string | undefined {
  const targetConfig = env.NODE_ENV === 'production' ? 'prd' : 'dev';

  // Preference order only matters as a fallback tie-breaker; the config match
  // below is what actually decides. Filter out empty/undefined up front.
  const candidates = [env.DOPPLER_SERVICE_TOKEN, env.DOPPLER_TOKEN].filter(
    (t): t is string => typeof t === 'string' && t.trim() !== '',
  );
  if (candidates.length === 0) return undefined;

  const matched = candidates.find((token) => {
    const m = /^dp\.st\.([a-z0-9_-]+)\./.exec(token);
    return m?.[1] === targetConfig;
  });

  return matched ?? candidates[0];
}

/**
 * Pure inject logic — separated from the curl fetch so it is unit-testable.
 * Mutates `env` in place: fills MISSING keys from `secrets`, never overwrites
 * an existing non-empty value UNLESS the key is in `overrideKeys`, and skips
 * bookkeeping vars + empty Doppler values. Returns a summary of mutations.
 */
export function applyDopplerSecrets(
  env: Record<string, string | undefined>,
  secrets: DopplerSecrets,
  opts: { overrideKeys?: Set<string> } = {},
): ApplyResult {
  const overrideKeys = opts.overrideKeys ?? new Set<string>();
  const result: ApplyResult = {
    applied: 0,
    skippedExisting: 0,
    skippedEmpty: 0,
    overrode: 0,
    overrodeNames: [],
  };

  for (const [key, value] of Object.entries(secrets)) {
    // Doppler bookkeeping vars — never inject these into the app.
    if (DOPPLER_BOOKKEEPING.has(key) || key === 'NAME') continue;

    const force = overrideKeys.has(key);
    const hasRuntime = env[key] !== undefined && env[key] !== '';

    // Default rule: Replit / runtime env wins. Override list flips that for
    // listed keys only.
    if (hasRuntime && !force) {
      result.skippedExisting++;
      continue;
    }

    const v = value?.computed ?? value?.raw;
    if (typeof v === 'string' && v.length > 0) {
      if (force && hasRuntime && env[key] !== v) {
        result.overrode++;
        result.overrodeNames.push(key);
      }
      env[key] = v;
      result.applied++;
    } else {
      result.skippedEmpty++;
    }
  }

  return result;
}

/** Parse a comma-separated DOPPLER_OVERRIDE_KEYS string into a Set. */
export function parseOverrideKeys(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

(() => {
  const token = selectDopplerToken(process.env);
  if (!token) {
    console.log('[doppler-bootstrap] no Doppler token — skipping');
    return;
  }

  const project = process.env.DOPPLER_PROJECT || 'quotefleet';
  const config = detectDopplerConfig(
    token,
    process.env.DOPPLER_CONFIG,
    process.env.NODE_ENV,
  );
  console.log(`[doppler-bootstrap] pulling ${project}/${config}`);
  const url = `https://api.doppler.com/v3/configs/config/secrets?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}&include_dynamic_secrets=false&include_managed_secrets=false`;

  let raw: string;
  try {
    raw = execSync(
      `curl -s --max-time 5 --fail-with-body -H "Authorization: Bearer ${token}" "${url}"`,
      { encoding: 'utf8', timeout: 6000, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (err) {
    const msg = (err as Error).message;
    const body =
      (err as { stdout?: string | Buffer }).stdout?.toString().slice(0, 200) || '';
    console.warn(
      `[doppler-bootstrap] fetch failed: ${msg.split('\n')[0]}${body ? ` | body=${body}` : ''}`,
    );
    return;
  }

  let payload: { secrets?: DopplerSecrets };
  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn(
      '[doppler-bootstrap] response was not valid JSON — proceeding without Doppler',
    );
    return;
  }

  const secrets = payload?.secrets ?? {};

  // Override list: Replit-Secret value takes precedence (emergency-disable
  // path), else fall back to the Doppler-stored value. Empty list = no
  // overrides (current behaviour preserved).
  const overrideRaw =
    process.env.DOPPLER_OVERRIDE_KEYS ||
    secrets['DOPPLER_OVERRIDE_KEYS']?.computed ||
    secrets['DOPPLER_OVERRIDE_KEYS']?.raw ||
    '';
  const overrideKeys = parseOverrideKeys(overrideRaw);

  const r = applyDopplerSecrets(process.env, secrets, { overrideKeys });

  console.log(
    `[doppler-bootstrap] project=${project} config=${config} ` +
      `fetched=${Object.keys(secrets).length} applied=${r.applied} ` +
      `kept-from-runtime=${r.skippedExisting} empty=${r.skippedEmpty} overrode=${r.overrode}` +
      (r.overrodeNames.length ? ` (${r.overrodeNames.join(',')})` : ''),
  );
})();
