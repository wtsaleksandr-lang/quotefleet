/**
 * Live FMCSA QCMobile lookup by USDOT or MC (docket) number — backs the public
 * Compliance Tools verification widget (/compliance).
 *
 * QCMobile is FMCSA's free JSON API; it needs a `webKey` (env FMCSA_WEBKEY,
 * already set in Doppler). We hit two endpoints:
 *   - by USDOT:  /qc/services/carriers/{dot}?webKey=…            → content.carrier
 *   - by docket: /qc/services/carriers/docket-number/{n}?webKey=… → content[].carrier
 *
 * We surface only the compliance-relevant fields a shipper cares about:
 * operating authority status, insurance-on-file, safety rating, out-of-service
 * status, and fleet size. Never throws — a flaky/absent FMCSA returns
 * `{ found:false, note }` so the page degrades gracefully.
 *
 * This is READ-ONLY public data. No secrets in the response; the webKey stays
 * server-side.
 */

import { releaseBody } from '../../http/responseBody.js';

const QC_BASE = 'https://mobile.fmcsa.dot.gov/qc/services/carriers';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface CarrierComplianceSnapshot {
  found: boolean;
  usdot: string | null;
  mcNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  city: string | null;
  state: string | null;
  /** "Y" / "N" — FMCSA's allowedToOperate flag. */
  allowedToOperate: string | null;
  /** Authority statuses: "A" active, "I" inactive, "N" none. */
  authority: { common: string | null; contract: string | null; broker: string | null };
  insurance: { bipdOnFile: string | null; bipdRequired: string | null; cargoRequired: string | null };
  safetyRating: string | null;
  outOfService: boolean;
  outOfServiceDate: string | null;
  powerUnits: number | null;
  drivers: number | null;
  /** Human note when the lookup couldn't complete (never throws). */
  note: string | null;
}

interface FetchDeps {
  fetchFn?: typeof fetch;
  webKey?: string;
  timeoutMs?: number;
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Timeout-bounded fetch that never throws; returns parsed JSON or null. */
async function safeJson(fetchFn: typeof fetch, url: string, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { redirect: 'follow', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      releaseBody(res); // free the socket — body is never read on the error path
      return null;
    }
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Map a raw QCMobile carrier object → our snapshot shape. */
function mapCarrier(carrier: Record<string, unknown>): CarrierComplianceSnapshot {
  return {
    found: true,
    usdot: str(carrier.dotNumber),
    mcNumber: str(carrier.docketNumber ?? carrier.mcNumber),
    legalName: str(carrier.legalName),
    dbaName: str(carrier.dbaName),
    city: str(carrier.phyCity),
    state: str(carrier.phyState),
    allowedToOperate: str(carrier.allowedToOperate),
    authority: {
      common: str(carrier.commonAuthorityStatus),
      contract: str(carrier.contractAuthorityStatus),
      broker: str(carrier.brokerAuthorityStatus),
    },
    insurance: {
      bipdOnFile: str(carrier.bipdInsuranceOnFile),
      bipdRequired: str(carrier.bipdInsuranceRequired),
      cargoRequired: str(carrier.cargoInsuranceRequired),
    },
    safetyRating: str(carrier.safetyRating),
    outOfService: str(carrier.oosDate) != null,
    outOfServiceDate: str(carrier.oosDate),
    powerUnits: num(carrier.totalPowerUnits),
    drivers: num(carrier.totalDrivers),
    note: null,
  };
}

const NOT_FOUND = (note: string): CarrierComplianceSnapshot => ({
  found: false,
  usdot: null,
  mcNumber: null,
  legalName: null,
  dbaName: null,
  city: null,
  state: null,
  allowedToOperate: null,
  authority: { common: null, contract: null, broker: null },
  insurance: { bipdOnFile: null, bipdRequired: null, cargoRequired: null },
  safetyRating: null,
  outOfService: false,
  outOfServiceDate: null,
  powerUnits: null,
  drivers: null,
  note,
});

/**
 * Look up a carrier by USDOT or MC number. `kind` selects which endpoint.
 * Digits are extracted from the input, so "MC-123456" / "USDOT 3733285" work.
 */
export async function lookupCarrierCompliance(
  kind: 'dot' | 'mc',
  rawNumber: string,
  deps: FetchDeps = {},
): Promise<CarrierComplianceSnapshot> {
  const fetchFn = deps.fetchFn ?? fetch;
  const webKey = deps.webKey ?? process.env.FMCSA_WEBKEY ?? '';
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const digits = String(rawNumber || '').replace(/\D/g, '');
  if (!digits) return NOT_FOUND('Enter a valid USDOT or MC number.');
  if (!webKey) return NOT_FOUND('Live FMCSA lookup is not configured on this server.');

  const url =
    kind === 'dot'
      ? `${QC_BASE}/${encodeURIComponent(digits)}?webKey=${encodeURIComponent(webKey)}`
      : `${QC_BASE}/docket-number/${encodeURIComponent(digits)}?webKey=${encodeURIComponent(webKey)}`;

  const data = (await safeJson(fetchFn, url, timeoutMs)) as { content?: unknown } | null;
  if (!data) return NOT_FOUND('FMCSA did not respond. Try again, or use SAFER directly.');

  // by-DOT → content.carrier (object); by-docket → content[].carrier (array).
  const content = data.content;
  let carrier: Record<string, unknown> | null = null;
  if (Array.isArray(content)) {
    const first = content[0] as { carrier?: Record<string, unknown> } | undefined;
    carrier = first?.carrier ?? null;
  } else if (content && typeof content === 'object') {
    carrier = ((content as { carrier?: Record<string, unknown> }).carrier ?? null) as Record<string, unknown> | null;
  }

  if (!carrier) {
    return NOT_FOUND(`No FMCSA record found for ${kind === 'dot' ? 'USDOT' : 'MC'} ${digits}.`);
  }
  return mapCarrier(carrier);
}
