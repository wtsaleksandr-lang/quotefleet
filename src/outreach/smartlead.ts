/**
 * Smartlead integration — minimal client.
 *
 * Cold outreach runs on Smartlead (smartlead.ai), not on the platform's
 * transactional mail. Why: deliverability. Sending cold email from
 * `quotefleet.net` would torch the same domain we use for magic-links
 * and password resets. Smartlead handles its own warmup, DKIM/SPF/DMARC,
 * inbox rotation, and reputation monitoring.
 *
 * QuoteFleet's role:
 *   - Source prospects (scrape, CSV, manual entry).
 *   - Push them to a Smartlead campaign via this client.
 *   - Receive Smartlead webhooks → mirror into `outreach_events`.
 *   - Surface a single dashboard combining prospect data + Smartlead stats.
 *
 * Smartlead API docs: https://api.smartlead.ai/reference/
 */
import type { OutreachProspect } from '../db/schema.js';

export interface SmartleadConfig {
  /** API key from Smartlead → Settings → API. */
  apiKey: string;
  /** Default sending domain used for cold outreach (NOT your product brand). */
  sendingDomain: string;
  /** Base URL — `https://server.smartlead.ai/api/v1`. */
  baseUrl?: string;
}

export interface SmartleadCampaign {
  id: number;
  name: string;
  status: string;
}

export interface SmartleadAddLeadResponse {
  ok: boolean;
  upload_count?: number;
  already_added_to_campaign_count?: number;
  error?: string;
}

const DEFAULT_BASE_URL = 'https://server.smartlead.ai/api/v1';

function smartleadConfigFromEnv(): SmartleadConfig | null {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const sendingDomain = process.env.SMARTLEAD_SENDING_DOMAIN;
  if (!apiKey || !sendingDomain) return null;
  return {
    apiKey,
    sendingDomain,
    baseUrl: process.env.SMARTLEAD_BASE_URL ?? DEFAULT_BASE_URL,
  };
}

async function smartleadFetch<T>(
  cfg: SmartleadConfig,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = new URL(`${cfg.baseUrl ?? DEFAULT_BASE_URL}${path}`);
  url.searchParams.set('api_key', cfg.apiKey);
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Smartlead ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** List campaigns. Used by the admin dashboard to pick a campaign before adding prospects. */
export async function listCampaigns(cfg?: SmartleadConfig): Promise<SmartleadCampaign[]> {
  const c = cfg ?? smartleadConfigFromEnv();
  if (!c) throw new Error('Smartlead not configured (set SMARTLEAD_API_KEY + SMARTLEAD_SENDING_DOMAIN).');
  return smartleadFetch<SmartleadCampaign[]>(c, '/campaigns');
}

/** Push a prospect (or a batch) into a Smartlead campaign. */
export async function addProspectsToCampaign(
  campaignId: number,
  prospects: OutreachProspect[],
  cfg?: SmartleadConfig
): Promise<SmartleadAddLeadResponse> {
  const c = cfg ?? smartleadConfigFromEnv();
  if (!c) throw new Error('Smartlead not configured.');

  const lead_list = prospects
    .filter((p) => p.contactEmail)
    .map((p) => ({
      first_name: (p.contactName ?? '').split(' ')[0] ?? '',
      last_name: (p.contactName ?? '').split(' ').slice(1).join(' '),
      email: p.contactEmail,
      phone_number: p.contactPhone ?? undefined,
      company_name: p.companyName ?? undefined,
      website: p.websiteUrl ?? undefined,
      location: [p.companyCity, p.companyState, p.companyCountry].filter(Boolean).join(', '),
      // Smartlead "custom_fields" — surface our segment + size for personalization.
      custom_fields: {
        segment: p.segment ?? '',
        size_band: p.sizeBand ?? '',
        company_phone: p.companyPhone ?? '',
        prospect_id: String(p.id),
      },
    }));

  return smartleadFetch<SmartleadAddLeadResponse>(c, `/campaigns/${campaignId}/leads`, {
    method: 'POST',
    body: JSON.stringify({ lead_list, settings: { ignore_global_block_list: false } }),
  });
}

/** Fetch campaign aggregate stats. Used by the cron job that refreshes
 *  `outreach_campaigns.statsJson` every ~10 minutes. */
export async function getCampaignStats(
  campaignId: number,
  cfg?: SmartleadConfig
): Promise<{ sent: number; opened: number; replied: number; bounced: number; unsubscribed: number }> {
  const c = cfg ?? smartleadConfigFromEnv();
  if (!c) throw new Error('Smartlead not configured.');
  type StatsResp = {
    sent_count?: number;
    open_count?: number;
    reply_count?: number;
    bounce_count?: number;
    unsubscribed_count?: number;
  };
  const r = await smartleadFetch<StatsResp>(c, `/campaigns/${campaignId}/statistics`);
  return {
    sent: r.sent_count ?? 0,
    opened: r.open_count ?? 0,
    replied: r.reply_count ?? 0,
    bounced: r.bounce_count ?? 0,
    unsubscribed: r.unsubscribed_count ?? 0,
  };
}

/** Webhook handler — verify + parse a Smartlead webhook payload into
 *  an outreach event we can store. Stub for the admin route to call. */
export interface SmartleadWebhookPayload {
  event_type: string;
  campaign_id?: number;
  lead?: { email?: string; id?: number };
  step?: { sequence_number?: number };
  metadata?: Record<string, unknown>;
}

export function parseWebhook(payload: unknown): SmartleadWebhookPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as SmartleadWebhookPayload;
  if (!p.event_type) return null;
  return p;
}
