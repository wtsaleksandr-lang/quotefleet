import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { tenants, brandConfigs, leads, accessorials } from '../../db/schema.js';
import { loadEnv } from '../../config.js';
import { publicChatLimiter } from '../rateLimits.js';

const QUOTE_VALIDITY_DAYS = 30;

type LatLng = { lat: number; lng: number };

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function clean<T>(value: T | null | undefined): T | undefined {
  return value == null ? undefined : value;
}

function routeMapUrl(origin?: LatLng, destination?: LatLng): string | null {
  if (!origin || !destination) return null;
  const env = loadEnv();

  if (env.GOOGLE_MAPS_API_KEY) {
    const params = new URLSearchParams({
      size: '900x360',
      scale: '2',
      maptype: 'roadmap',
      key: env.GOOGLE_MAPS_API_KEY,
    });
    params.append('markers', `color:blue|label:A|${origin.lat},${origin.lng}`);
    params.append('markers', `color:red|label:B|${destination.lat},${destination.lng}`);
    params.append('path', `color:0x2563ebff|weight:4|${origin.lat},${origin.lng}|${destination.lat},${destination.lng}`);
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
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
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${overlay}/auto/900x360@2x?access_token=${encodeURIComponent(env.MAPBOX_TOKEN)}`;
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
  app.get('/api/public/quote-doc/:refId', publicChatLimiter, async (req: Request, res: Response) => {
    const refId = String(req.params.refId ?? '').trim();
    if (!refId) return res.status(400).json({ error: 'Missing refId' });

    const leadRows = await db().select().from(leads).where(eq(leads.refId, refId)).limit(1);
    const lead = leadRows[0];
    if (!lead) return res.status(404).json({ error: 'Quote not found' });

    const [tenantRows, brandRows, accessorialRows] = await Promise.all([
      db().select().from(tenants).where(eq(tenants.id, lead.tenantId)).limit(1),
      db().select().from(brandConfigs).where(eq(brandConfigs.tenantId, lead.tenantId)).limit(1),
      db().select().from(accessorials).where(eq(accessorials.tenantId, lead.tenantId)),
    ]);
    const tenant = tenantRows[0];
    if (!tenant || tenant.status !== 'active') return res.status(404).json({ error: 'Carrier not found' });

    const createdAt = lead.createdAt instanceof Date ? lead.createdAt : new Date(lead.createdAt);
    const expiresAt = addDays(createdAt, QUOTE_VALIDITY_DAYS);
    const env = loadEnv();
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
    const pickup = locationBlock('pickup', lead);
    const delivery = locationBlock('delivery', lead);
    const mapImageUrl = routeMapUrl(
      pickup.lat != null && pickup.lng != null ? { lat: pickup.lat, lng: pickup.lng } : undefined,
      delivery.lat != null && delivery.lng != null ? { lat: delivery.lat, lng: delivery.lng } : undefined
    );

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
        breakdown: lead.breakdownJson ?? [],
        aiSummary: lead.aiSummary,
        quoteUrl: `${base}/quote/${encodeURIComponent(lead.refId)}`,
        chatUrl: `${base}/chat/${encodeURIComponent(lead.refId)}`,
      },
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        mcNumber: tenant.mcNumber,
        dotNumber: tenant.dotNumber,
      },
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
      },
      shipment: {
        service: lead.service,
        equipment: lead.equipment,
        pickupDate: lead.pickupDate,
        deliveryDate: lead.deliveryDate,
        oceanCarrier: lead.oceanCarrier,
        bookingNumber: lead.bookingNumber,
        billOfLadingNumber: lead.billOfLadingNumber,
        containerNumbers: lead.containerNumbers,
        weightLbs: lead.weightLbs,
        pieces: lead.pieces,
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
        name: tenant.name,
        email: tenant.contactEmail,
        phone: tenant.contactPhone,
      },
    });
  });
}
