/**
 * Prospect-demo pure-logic tests — mode derivation, widget-config synthesis,
 * and that the SAMPLE rates compute realistic quotes through the REAL engine.
 * No network, no DB.
 */
import { describe, it, expect } from 'vitest';
import type { CompanyProfile } from './enrichCompany.js';
import {
  canonicalMode,
  deriveDemoConfig,
  deriveDemoBrand,
  buildProspectWidgetConfig,
  buildSampleRateCards,
  computeProspectQuote,
  type ProspectDemoRecord,
} from './prospectDemo.js';
import type { CalcRequest } from '../../calc/engine.js';

function profile(o: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    domain: 'acme-freight.com',
    website: 'https://acme-freight.com',
    companyName: 'Acme Freight',
    tagline: 'Drayage done right',
    phone: '(555) 123-4567',
    email: 'quotes@acme-freight.com',
    mailingAddress: '123 Harbor Blvd, Long Beach, CA 90802',
    serviceModes: [],
    regionsLanes: [],
    brandColors: { primary: '#ff5a1f', secondary: '#0b2545', confidence: 'high' },
    logoUrl: 'https://acme-freight.com/logo.png',
    logoConfidence: 'high',
    ai: null,
    aiAvailable: false,
    fmcsa: null,
    fmcsaAvailable: false,
    fetchNotes: [],
    fetchedPaths: [],
    ...o,
  };
}

function withAiMode(mode: string, fields?: string[]): CompanyProfile {
  return profile({
    ai: {
      tone: 'professional',
      businessSummary: 's',
      painPoints: [],
      quoteFleetAngle: 'a',
      suggestedCalculator: { mode, fields: fields ?? [] },
    },
    aiAvailable: true,
  });
}

describe('canonicalMode', () => {
  it('maps freight phrasings to a supported mode', () => {
    expect(canonicalMode('drayage')).toBe('drayage');
    expect(canonicalMode('Port container haul')).toBe('drayage');
    expect(canonicalMode('refrigerated')).toBe('reefer');
    expect(canonicalMode('Full Truckload')).toBe('ftl');
    expect(canonicalMode('LTL')).toBe('ltl');
    expect(canonicalMode('flatbed / step deck')).toBe('flatbed');
    expect(canonicalMode('hotshot')).toBe('hotshot');
  });
  it('falls back to ftl for empty / unknown', () => {
    expect(canonicalMode('')).toBe('ftl');
    expect(canonicalMode(null)).toBe('ftl');
    expect(canonicalMode('quantum teleportation')).toBe('ftl');
  });
});

describe('deriveDemoConfig', () => {
  it('uses the AI-suggested mode as primary + its fields', () => {
    const cfg = deriveDemoConfig(withAiMode('drayage', ['port', 'terminal', 'container', 'chassis']));
    expect(cfg.primaryMode).toBe('drayage');
    expect(cfg.fields).toEqual(['port', 'terminal', 'container', 'chassis']);
    expect(cfg.services.map((s) => s.service)).toContain('drayage');
    expect(cfg.sampleCards.some((c) => c.service === 'drayage')).toBe(true);
  });

  it('falls back to the first detected mode, then default fields', () => {
    const cfg = deriveDemoConfig(profile({ serviceModes: ['reefer'] }));
    expect(cfg.primaryMode).toBe('reefer');
    expect(cfg.fields).toContain('set-temp');
  });

  it('includes extra detected modes (deduped, capped at 3)', () => {
    const cfg = deriveDemoConfig(
      profile({ serviceModes: ['FTL', 'reefer', 'flatbed', 'drayage'] })
    );
    expect(cfg.services.length).toBeLessThanOrEqual(3);
    // primary is FTL; the next distinct supported modes follow
    expect(cfg.primaryMode).toBe('ftl');
    expect(cfg.services.map((s) => s.service)).toContain('reefer');
  });

  it('detects a Canadian focus from address/lanes', () => {
    const cfg = deriveDemoConfig(profile({ mailingAddress: '50 King St W, Toronto, ON, Canada' }));
    expect(cfg.countryFocus).toBe('CA');
  });
});

describe('buildProspectWidgetConfig', () => {
  function record(p: CompanyProfile): ProspectDemoRecord {
    return {
      token: 'tok_abc123',
      domain: p.domain,
      companyName: p.companyName,
      profileJson: p as unknown as Record<string, unknown>,
      brandJson: deriveDemoBrand(p),
      configJson: deriveDemoConfig(p),
      viewedAt: null,
    };
  }

  it('injects the prospect brand + mode into the widget config shape', () => {
    const cfg = buildProspectWidgetConfig(record(withAiMode('drayage')));
    expect(cfg.demo).toBe(true);
    expect(cfg.tenant.slug).toBe('tok_abc123');
    expect(cfg.tenant.name).toBe('Acme Freight');
    expect(cfg.brand.displayName).toBe('Acme Freight');
    expect(cfg.brand.logoUrl).toBe('https://acme-freight.com/logo.png');
    expect(cfg.brand.showPoweredBy).toBe(true);
    expect(cfg.brand.showQuoteBeforeContact).toBe(true);
    // brand colour drives the theme accent
    expect(cfg.brand.primaryColor).toBe('#ff5a1f');
    expect(cfg.theme.accentOverride).toBe('#ff5a1f');
    expect(Object.keys(cfg.theme.tokens).length).toBeGreaterThan(0);
    // mode → services + equipment
    expect(cfg.services).toContain('drayage');
    // The widget reads option.value (widget.js#renderServices) — the demo MUST
    // emit `value` (not `equipment`), or the dropdown renders value="undefined"
    // and no quote can ever be produced (the shipping-blocker this guards).
    expect(cfg.equipmentByService.drayage.some((e) => e.value === 'container_40hc')).toBe(true);
    // drayage → sample ports populated so the port picker works
    expect(cfg.drayagePorts.length).toBeGreaterThan(0);
    // prospect contact surfaced from the profile
    expect(cfg.contact.phone).toBe('(555) 123-4567');
  });

  it('equipment options match the TENANT widget-config option shape {value,label,maxWeightLbs?}', () => {
    // The widget is shared unforked, so the prospect equipmentByService entries
    // must be byte-for-byte the same shape the tenant endpoint emits via
    // groupBy(cards,'service','equipment','label') → { value, label, maxWeightLbs? }.
    const cfg = buildProspectWidgetConfig(record(withAiMode('drayage')));
    const ALLOWED = new Set(['value', 'label', 'maxWeightLbs']);
    const allOptions = Object.values(cfg.equipmentByService).flat();
    expect(allOptions.length).toBeGreaterThan(0);
    for (const opt of allOptions) {
      // exactly the tenant keys — never the internal `equipment` key
      expect(Object.keys(opt).every((k) => ALLOWED.has(k))).toBe(true);
      expect('equipment' in opt).toBe(false);
      // value is the equipment id the calc engine matches on (non-empty string)
      expect(typeof opt.value).toBe('string');
      expect(opt.value.length).toBeGreaterThan(0);
      expect(typeof opt.label).toBe('string');
    }
    // and the value must line up with a priceable sample card
    const cardEquip = new Set((record(withAiMode('drayage')).configJson?.sampleCards ?? []).map((c) => c.equipment));
    for (const opt of allOptions) expect(cardEquip.has(opt.value)).toBe(true);
  });

  it('does not populate ports for non-drayage modes', () => {
    const cfg = buildProspectWidgetConfig(record(withAiMode('ftl')));
    expect(cfg.drayagePorts.length).toBe(0);
    expect(cfg.services).toContain('ftl');
  });
});

describe('computeProspectQuote — realistic numbers per mode', () => {
  const base = (o: Partial<CalcRequest>): CalcRequest => ({
    service: 'ftl',
    equipment: 'dryvan',
    miles: 500,
    ...o,
  });

  it('FTL prices a credible mid-haul truckload', () => {
    const cfg = deriveDemoConfig(withAiMode('ftl'));
    const r = computeProspectQuote(cfg, base({ service: 'ftl', equipment: 'dryvan', miles: 500, weightLbs: 20000 }));
    expect(r.unsupported).toBeUndefined();
    // 500mi × $2.75 = $1375 linehaul + 24% fuel + 12% margin ≈ $1900
    expect(r.total).toBeGreaterThan(1500);
    expect(r.total).toBeLessThan(2500);
  });

  it('drayage prices a short port move (min-charge floor applies)', () => {
    const cfg = deriveDemoConfig(withAiMode('drayage'));
    const r = computeProspectQuote(
      cfg,
      base({ service: 'drayage', equipment: 'container_40hc', miles: 45, weightLbs: 30000 })
    );
    expect(r.unsupported).toBeUndefined();
    expect(r.total).toBeGreaterThan(350);
    expect(r.total).toBeLessThan(900);
  });

  it('LTL prices from class + weight (not distance-only)', () => {
    const cfg = deriveDemoConfig(withAiMode('ltl'));
    const r = computeProspectQuote(
      cfg,
      base({ service: 'ltl', equipment: 'ltl', miles: 300, weightLbs: 2200, freightClass: 70 })
    );
    expect(r.unsupported).toBeUndefined();
    expect(Number.isFinite(r.total)).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(95); // never below the minimum
  });

  it('buildSampleRateCards yields enabled, priceable cards', () => {
    const cfg = deriveDemoConfig(withAiMode('flatbed'));
    const cards = buildSampleRateCards(cfg);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.enabled)).toBe(true);
    expect(cards.some((c) => c.service === 'flatbed')).toBe(true);
  });
});
