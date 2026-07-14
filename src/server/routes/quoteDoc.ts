import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants, brandConfigs, leads, accessorials, rateCards } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { publicDocLimiter } from '../rateLimits.js';
import { loadCarrierProfile } from './carrierProfile.js';
import { customerFacingLines } from '../../calc/engine.js';
import { resolveQuoteDisclaimer } from '../quoteDisclaimer.js';
import { estimateTransit } from '../../calc/transit.js';
import { getRouteMap, buildStaticMapUrl, type LatLng } from '../routeMap.js';

const QUOTE_VALIDITY_DAYS = 30;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function clean<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

function money(n: number | null | undefined, currency: string | null | undefined): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(
    typeof n === 'number' && Number.isFinite(n) ? n : 0
  );
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function leadLaneText(lead: typeof leads.$inferSelect): string {
  const pickup = [lead.pickupCity, lead.pickupState || lead.pickupZip].filter(Boolean).join(', ') || 'Pickup not specified';
  const delivery = [lead.deliveryCity, lead.deliveryState || lead.deliveryZip].filter(Boolean).join(', ') || 'Delivery not specified';
  return `${pickup} → ${delivery}`;
}

type RouteMapResult = { url: string; distanceMiles: number | null };

/**
 * Resolve the hosted-quote route map. Prefers Google Directions (a real road
 * route drawn with `path=enc:` + green/red A·B markers, cached per lane); if
 * no Google key is present, falls back to a Mapbox straight-line overlay.
 * Returns null only when there's genuinely no usable geometry.
 */
async function routeMapUrl(origin?: LatLng, destination?: LatLng): Promise<RouteMapResult | null> {
  if (!origin || !destination) return null;
  const env = loadEnv();

  if (env.GOOGLE_MAPS_API_KEY) {
    const route = await getRouteMap(origin, destination, env.GOOGLE_MAPS_API_KEY);
    if (route) return { url: route.url, distanceMiles: route.distanceMiles };
    // No route resolved but key exists — draw a straight-line static map.
    return { url: buildStaticMapUrl(env.GOOGLE_MAPS_API_KEY, origin, destination, null), distanceMiles: null };
  }

  if (env.MAPBOX_TOKEN) {
    const line = {
      type: 'Feature',
      properties: {
        stroke: '#2563eb',
        'stroke-width': 4,
        'stroke-opacity': 0.75,
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [origin.lng, origin.lat],
          [destination.lng, destination.lat],
        ],
      },
    };
    const overlay = [
      `geojson(${encodeURIComponent(JSON.stringify(line))})`,
      `pin-s-a+2563eb(${origin.lng},${origin.lat})`,
      `pin-s-b+ef4444(${destination.lng},${destination.lat})`,
    ].join(',');
    return {
      url: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}/auto/900x360@2x?access_token=${encodeURIComponent(env.MAPBOX_TOKEN)}`,
      distanceMiles: null,
    };
  }

  return null;
}

function locationBlock(prefix: 'pickup' | 'delivery', lead: typeof leads.$inferSelect) {
  const city = prefix === 'pickup' ? lead.pickupCity : lead.deliveryCity;
  const state = prefix === 'pickup' ? lead.pickupState : lead.deliveryState;
  const zip = prefix === 'pickup' ? lead.pickupZip : lead.deliveryZip;
  const country = prefix === 'pickup' ? lead.pickupCountry : lead.deliveryCountry;
  const address = prefix === 'pickup' ? lead.pickupAddress : lead.deliveryAddress;
  const lat = prefix === 'pickup' ? lead.pickupLat : lead.deliveryLat;
  const lng = prefix === 'pickup' ? lead.pickupLng : lead.deliveryLng;

  const title = [city, state].filter(Boolean).join(', ') || address || zip || 'Location not specified';
  const subtitle = [address, zip, country].filter(Boolean).join(' · ');

  return {
    address: clean(address),
    city: clean(city),
    state: clean(state),
    zip: clean(zip),
    country: clean(country),
    title,
    subtitle,
    lat: typeof lat === 'number' ? lat : undefined,
    lng: typeof lng === 'number' ? lng : undefined,
  };
}

export function registerQuoteDocRoutes(app: Express) {
  app.get('/api/public/quote-doc/:refId', publicDocLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const [tenantRows, brandRows, accessorialRows, rateCardRows, carrierProfile] = await Promise.all([
      db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1),
      db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, lead.tenantId)).limit(1),
      db().select().from(accessorials).where(eq(accessorials.tenantId, lead.tenantId)),
      db().select().from(rateCards).where(eq(rateCards.tenantId, lead.tenantId)),
      loadCarrierProfile(lead.tenantId),
    ]);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    // Friendly equipment label — same human name the widget's equipment
    // dropdown shows (from the carrier's own rate card), so the hosted quote
    // reads "40' Standard Container" instead of the raw code "container_40".
    const equipmentCard = rateCardRows.find(
      (c) => c.service === lead.service && c.equipment === lead.equipment
    );
    const equipmentLabel = equipmentCard?.label
      ? equipmentCard.label.replace(/\s*\(drayage\)\s*/i, ' ').replace(/\s{2,}/g, ' ').trim()
      : null;

    const createdAt = lead.createdAt instanceof Date ? lead.createdAt : new Date(lead.createdAt);
    const expiresAt = addDays(createdAt, QUOTE_VALIDITY_DAYS);
    const env = loadEnv();
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const pickup = locationBlock('pickup', lead);
    const delivery = locationBlock('delivery', lead);
    const routeMap = await routeMapUrl(
      pickup.lat != null && pickup.lng != null ? { lat: pickup.lat, lng: pickup.lng } : undefined,
      delivery.lat != null && delivery.lng != null ? { lat: delivery.lat, lng: delivery.lng } : undefined
    );
    const mapImageUrl = routeMap?.url ?? null;
    // Prefer the driving distance the route returned; fall back to the lane's
    // stored estimate so the caption still reads a mileage.
    const mapDistanceMiles =
      routeMap?.distanceMiles ??
      (typeof lead.distanceMiles === 'number' ? Math.round(lead.distanceMiles) : null);

    return res.json({
      quote: {
        refId: lead.refId,
        generatedAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        validityDays: QUOTE_VALIDITY_DAYS,
        status: lead.status,
        currency: lead.quotedCurrency || 'USD',
        total: lead.quotedTotal ?? 0,
        distanceMiles: lead.distanceMiles,
        // Estimated transit window (days) derived from lane distance + service.
        // Shown as an estimate on the hosted quote; null when distance unknown.
        transit: estimateTransit(lead.distanceMiles, lead.service),
        // Customer-facing: fold the carrier's margin into the linehaul line so
        // it's never shown on the hosted quote. The stored breakdownJson keeps
        // the raw margin line for the carrier's internal dashboard view; the
        // grand total (lead.quotedTotal) is unchanged.
        breakdown: customerFacingLines(lead.breakdownJson as Parameters<typeof customerFacingLines>[0]),
        aiSummary: lead.aiSummary,
        // Terms shown at the bottom of the hosted + printable quote. Resolves
        // to the carrier's own text when set, else the platform default.
        disclaimer: resolveQuoteDisclaimer(tenant.quoteDisclaimer),
        quoteUrl: `${base}/quote/${encodeURIComponent(lead.refId)}`,
        chatUrl: `${base}/chat/${encodeURIComponent(lead.refId)}`,
      },
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        // Public hosted quote — expose only the opt-in publicContactEmail, never
        // the private owner/login contactEmail. Null when unset → row hidden by
        // the renderer (quote.js / quote-profile.js drop falsy contact values).
        contactEmail: tenant.publicContactEmail ?? null,
        contactPhone: tenant.contactPhone,
        mcNumber: tenant.mcNumber,
        dotNumber: tenant.dotNumber,
      },
      carrierProfile,
      brand: brandRows[0] ?? null,
      customer: {
        name: lead.customerName,
        email: lead.customerEmail,
        phone: lead.customerPhone,
        company: lead.customerCompany,
      },
      lane: {
        pickup,
        delivery,
        mapImageUrl,
        mapDistanceMiles,
      },
      shipment: {
        service: lead.service,
        equipment: lead.equipment,
        equipmentLabel,
        pickupDate: lead.pickupDate,
        deliveryDate: lead.deliveryDate,
        oceanCarrier: lead.oceanCarrier,
        bookingNumber: lead.bookingNumber,
        billOfLadingNumber: lead.billOfLadingNumber,
        containerNumbers: lead.containerNumbers,
        weightLbs: lead.weightLbs,
        pieces: lead.pieces,
        lengthIn: lead.lengthIn,
        widthIn: lead.widthIn,
        heightIn: lead.heightIn,
        freightClass: lead.freightClass,
        densityPcf: lead.densityPcf,
        palletized: lead.palletized,
        loadedFromDock: lead.loadedFromDock,
        commodity: lead.commodity,
        notes: lead.notes,
        accessorialCodes: lead.accessorialCodes ?? [],
      },
      possibleAccessorials: accessorialRows
        .filter((a) => a.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
        .map((a) => ({
          code: a.code,
          label: a.label,
          description: a.description,
          kind: a.kind,
          amount: a.amount,
          trigger: a.trigger,
          appliesToServices: a.appliesToServices ?? null,
        })),
      issuedBy: {
        name: String(carrierProfile.quoteContactName || tenant.name),
        // Public — opt-in publicContactEmail only, never the login contactEmail.
        email: tenant.publicContactEmail ?? null,
        phone: tenant.contactPhone,
      },
    });
  });

  app.get('/api/public/quote-email-preview/:refId', publicDocLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const [tenantRows, brandRows] = await Promise.all([
      db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1),
      db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, lead.tenantId)).limit(1),
    ]);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    const brand = brandRows[0] || null;
    const base = loadEnv().PUBLIC_BASE_URL.replace(/\/$/, '');
    const carrierName = brand?.displayName || tenant.name;
    const quoteUrl = `${base}/quote/${encodeURIComponent(lead.refId)}`;
    const total = money(lead.quotedTotal, lead.quotedCurrency);
    const lane = leadLaneText(lead);
    const service = [lead.service, lead.equipment].filter(Boolean).join(' / ');
    const greeting = lead.customerName ? `Hi ${lead.customerName},` : 'Hello,';
    const subject = `Quote ${lead.refId} from ${carrierName}`;

    const text = [
      greeting,
      '',
      `${carrierName} prepared quote ${lead.refId}.`,
      `Estimated total: ${total}`,
      `Lane: ${lane}`,
      service ? `Service / equipment: ${service}` : '',
      lead.distanceMiles ? `Estimated distance: ${Math.round(lead.distanceMiles)} miles` : '',
      '',
      `View quote: ${quoteUrl}`,
      '',
      tenant.publicContactEmail ? `Questions: ${tenant.publicContactEmail}` : '',
      tenant.contactPhone ? `Phone: ${tenant.contactPhone}` : '',
    ].filter(Boolean).join('\n');

    const accent = '#0D3CFC';
    const preheader = `${carrierName} — quote ${lead.refId} · ${total}`;
    const html = [
      '<!doctype html><html lang="en"><head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<meta name="x-apple-disable-message-reformatting">',
      '<meta name="color-scheme" content="light dark">',
      '<meta name="supported-color-schemes" content="light dark">',
      '<title>' + esc(carrierName) + '</title>',
      '</head>',
      '<body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">',
      '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f3f5f8;">' + esc(preheader) + '</div>',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f5f8;"><tr><td align="center" style="padding:24px 16px;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:620px;background:#fff;border:1px solid #d9e1ec;border-radius:10px;overflow:hidden;">',
      '<tr><td style="padding:24px 24px 8px 24px;">',
      '<div style="font-size:12px;text-transform:uppercase;color:#64748b;font-weight:bold;letter-spacing:0.05em;">Freight Quote</div>',
      '<h1 style="margin:4px 0 18px;font-size:22px;color:#111827;">' + esc(carrierName) + '</h1>',
      '<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">' + esc(greeting) + '</p>',
      '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Your quote is ready. Open the hosted quote to view the complete pricing breakdown and next steps.</p>',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #d9e1ec;border-radius:8px;margin:0 0 16px;overflow:hidden;">',
      '<tr><td style="padding:10px 12px;border-bottom:1px solid #e5eaf1;font-size:14px;"><b>Quote:</b> ' + esc(lead.refId) + '</td></tr>',
      '<tr><td style="padding:10px 12px;border-bottom:1px solid #e5eaf1;font-size:14px;"><b>Total:</b> ' + esc(total) + '</td></tr>',
      '<tr><td style="padding:10px 12px;border-bottom:1px solid #e5eaf1;font-size:14px;"><b>Lane:</b> ' + esc(lane) + '</td></tr>',
      '<tr><td style="padding:10px 12px;font-size:14px;"><b>Service:</b> ' + esc(service || '—') + '</td></tr>',
      '</table>',
      '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;"><tr>',
      '<td align="center" bgcolor="' + accent + '" style="border-radius:7px;background:' + accent + ';">',
      '<a href="' + esc(quoteUrl) + '" style="display:inline-block;background:' + accent + ';color:#fff;text-decoration:none;font-weight:bold;padding:11px 20px;border-radius:7px;font-size:15px;">View hosted quote →</a>',
      '</td></tr></table>',
      '<p style="margin:0;font-size:12px;color:#475569;line-height:1.5;">Quote is based on the details provided and may change if shipment details or required add-ons change.</p>',
      '</td></tr></table>',
      '</td></tr></table>',
      '</body></html>',
    ].join('');

    return res.json({ refId: lead.refId, to: lead.customerEmail || null, subject, text, html, quoteUrl });
  });
}
