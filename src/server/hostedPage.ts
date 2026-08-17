/**
 * Hosted trust-wrap (Phase 1) — the lean, conversion-focused landing shell that
 * wraps a tenant's HOSTED calculator page (`/w/:slug`, their subdomain, custom
 * domains). The calculator itself stays the centrepiece; a light frame of
 * carrier-supplied trust/social-proof content surrounds it.
 *
 * SCOPE: this ONLY applies to the hosted page. The embedded JS-snippet widget
 * (`?embed=1`) and the `/w/demo` showcase keep serving the bare calculator —
 * app.ts decides which to serve and only calls this for the hosted path.
 *
 * The calculator is embedded as an IFRAME pointing back at the same slug with
 * `?embed=1` (the bare widget). That keeps the existing calculator behaviour
 * 100% intact — it is literally the same served widget page — and cleanly
 * isolates the wrap's CSS/JS from the widget's. A tiny relay script sizes the
 * inner frame to its content and, in the portal live-preview, forwards
 * theme / brand-preview messages down to the calculator and applies hosted-copy
 * edits (`qf:'hosted-preview'`) in place with no reload.
 *
 * Fully server-rendered (SEO + no-JS friendly first paint), theme-aware, and
 * self-contained (inline CSS/JS) like renderGatePage. Reuses the widget theme
 * engine (resolveWidgetTheme) so the frame is on-brand with the calculator.
 */
import type {
  BrandConfig,
  Tenant,
  HostedTestimonial,
  HostedCta,
  HostedBackground,
} from '../db/schema.js';
import { resolveWidgetTheme } from './widgetThemes.js';

type HostedTenant = Pick<Tenant, 'name' | 'slug' | 'dotNumber' | 'mcNumber'>;
type HostedBrand = Pick<
  BrandConfig,
  | 'displayName'
  | 'tagline'
  | 'logoUrl'
  | 'themePreset'
  | 'accentOverride'
  | 'fontFamily'
  | 'fontColor'
  | 'hostedHeadline'
  | 'hostedSubhead'
  | 'hostedTrustBadges'
  | 'hostedTestimonialsJson'
  | 'hostedCtasJson'
  | 'hostedBackgroundJson'
>;

export interface RenderHostedPageOpts {
  tenant: HostedTenant;
  brand: HostedBrand | null;
  /** src for the inner calculator iframe (the bare widget). */
  calcSrc: string;
}

// ── HTML escaping ─────────────────────────────────────────────────────
function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe JSON for embedding inside a <script> block: neutralise the sequences
// that could break out of the element (`</script>`) or the HTML parser, plus
// the two line separators that are invalid in JS string literals. Without this
// a tenant-supplied headline containing `</script>` would be an XSS.
function jsonForScript(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ── Background presets ────────────────────────────────────────────────
// Each preset supplies a CSS background for the LIGHT and DARK page theme. The
// chrome (text/cards/badges) is theme-driven; the preset only paints the page
// backdrop behind it. Kept intentionally small (a lean, curated set).
interface BgPreset {
  id: string;
  label: string;
  light: string;
  dark: string;
}
export const HOSTED_BG_PRESETS: BgPreset[] = [
  { id: 'default', label: 'Solid', light: '#F4F6F9', dark: '#0F1417' },
  {
    id: 'aurora',
    label: 'Aurora',
    light: 'linear-gradient(135deg, #EAF1FF 0%, #F3ECFF 100%)',
    dark: 'linear-gradient(135deg, #0E1630 0%, #16122B 100%)',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    light: 'linear-gradient(135deg, #FFF1E9 0%, #F5ECFF 100%)',
    dark: 'linear-gradient(135deg, #1A1220 0%, #241528 100%)',
  },
  {
    id: 'slate',
    label: 'Slate',
    light: 'linear-gradient(180deg, #EEF1F5 0%, #E4E9F0 100%)',
    dark: 'linear-gradient(180deg, #12171C 0%, #0D1114 100%)',
  },
  {
    id: 'mint',
    label: 'Mint',
    light: 'linear-gradient(135deg, #E8F7F0 0%, #EDF5FF 100%)',
    dark: 'linear-gradient(135deg, #0C1A17 0%, #0D1622 100%)',
  },
  // ── Brand-tinted gradients — richer, on-brand backdrops that pick up the
  // tenant accent (via var(--hp-accent), defined on :root by the render) so each
  // one is unique to their brand while staying readable behind the card in both
  // themes. color-mix blends the accent into the theme's base so the tint stays
  // gentle; the aside text/card contrast is unchanged.
  {
    id: 'brand-glow',
    label: 'Brand glow',
    light:
      'radial-gradient(130% 120% at 50% -10%, color-mix(in srgb, var(--hp-accent) 22%, #FFFFFF) 0%, #F4F6F9 58%)',
    dark:
      'radial-gradient(130% 120% at 50% -10%, color-mix(in srgb, var(--hp-accent) 30%, #0F1417) 0%, #0B0F12 62%)',
  },
  {
    id: 'brand-beam',
    label: 'Brand beam',
    light:
      'linear-gradient(160deg, color-mix(in srgb, var(--hp-accent) 18%, #FFFFFF) 0%, #F4F6F9 55%, color-mix(in srgb, var(--hp-accent) 8%, #EEF2F7) 100%)',
    dark:
      'linear-gradient(160deg, color-mix(in srgb, var(--hp-accent) 26%, #0F1417) 0%, #0C1013 55%, color-mix(in srgb, var(--hp-accent) 12%, #0A0E11) 100%)',
  },
  {
    id: 'duotone',
    label: 'Duo-tone',
    light: 'linear-gradient(135deg, #E6EEFF 0%, #F4ECFF 48%, #FFEAF1 100%)',
    dark: 'linear-gradient(135deg, #101B34 0%, #1A1330 50%, #2A1422 100%)',
  },
  {
    id: 'mesh',
    label: 'Mesh',
    light:
      'radial-gradient(46% 42% at 12% 16%, color-mix(in srgb, var(--hp-accent) 20%, transparent) 0%, transparent 60%), radial-gradient(44% 40% at 88% 22%, rgba(16,185,129,0.16) 0%, transparent 58%), radial-gradient(52% 48% at 50% 100%, rgba(59,130,246,0.14) 0%, transparent 60%), #F4F6F9',
    dark:
      'radial-gradient(46% 42% at 12% 16%, color-mix(in srgb, var(--hp-accent) 32%, transparent) 0%, transparent 60%), radial-gradient(44% 40% at 88% 22%, rgba(16,185,129,0.22) 0%, transparent 58%), radial-gradient(52% 48% at 50% 100%, rgba(59,130,246,0.20) 0%, transparent 60%), #0F1417',
  },
  // ── Patterned grids — a repeating texture over a solid backdrop, baked per
  // theme (ink on light, light on dark). Tuned to be clearly VISIBLE — the grid
  // reads as a deliberate texture, not a whisper — while the card/text contrast
  // over it is untouched. A single CSS `background` shorthand → applied
  // identically by the SSR body rule and client applyBackground()
  // (body.style.background = presetBg).
  {
    id: 'dot-grid',
    label: 'Dot grid',
    light: 'radial-gradient(rgba(15,23,32,0.20) 1.6px, transparent 2px) 0 0 / 20px 20px, #F1F4F8',
    dark: 'radial-gradient(rgba(255,255,255,0.16) 1.6px, transparent 2px) 0 0 / 20px 20px, #0F1417',
  },
  {
    id: 'line-grid',
    label: 'Line grid',
    light:
      'linear-gradient(rgba(15,23,32,0.13) 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, rgba(15,23,32,0.13) 1px, transparent 1px) 0 0 / 22px 22px, #F1F4F8',
    dark:
      'linear-gradient(rgba(255,255,255,0.11) 1px, transparent 1px) 0 0 / 22px 22px, linear-gradient(90deg, rgba(255,255,255,0.11) 1px, transparent 1px) 0 0 / 22px 22px, #0F1417',
  },
  {
    id: 'cross-hatch',
    label: 'Cross-hatch',
    light:
      'repeating-linear-gradient(45deg, rgba(15,23,32,0.11) 0, rgba(15,23,32,0.11) 1.2px, transparent 1.2px, transparent 11px), repeating-linear-gradient(-45deg, rgba(15,23,32,0.11) 0, rgba(15,23,32,0.11) 1.2px, transparent 1.2px, transparent 11px), #F1F4F8',
    dark:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.09) 0, rgba(255,255,255,0.09) 1.2px, transparent 1.2px, transparent 11px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.09) 0, rgba(255,255,255,0.09) 1.2px, transparent 1.2px, transparent 11px), #0F1417',
  },
];
const BG_PRESET_IDS = new Set(HOSTED_BG_PRESETS.map((p) => p.id));

// Chrome palettes — the wrap's own surfaces/text, per page theme. The tenant
// ACCENT (from the widget theme engine) is layered on top of either.
interface Chrome {
  bg: string;
  text: string;
  muted: string;
  card: string;
  cardBorder: string;
  badgeBg: string;
  badgeBorder: string;
  scrimText: string;
}
const CHROME: Record<'light' | 'dark', Chrome> = {
  light: {
    bg: '#F4F6F9',
    text: '#16202B',
    muted: '#566270',
    card: '#FFFFFF',
    cardBorder: 'rgba(15,23,32,0.10)',
    badgeBg: 'rgba(15,23,32,0.04)',
    badgeBorder: 'rgba(15,23,32,0.12)',
    scrimText: '#FFFFFF',
  },
  dark: {
    bg: '#0F1417',
    text: '#ECECEC',
    muted: '#A6AEB4',
    card: 'rgba(255,255,255,0.045)',
    cardBorder: 'rgba(255,255,255,0.10)',
    badgeBg: 'rgba(255,255,255,0.06)',
    badgeBorder: 'rgba(255,255,255,0.14)',
    scrimText: '#FFFFFF',
  },
};

// ── Normalisers (defensive — the render never trusts stored JSON blindly) ──
export function normalizeTestimonials(v: unknown): HostedTestimonial[] {
  if (!Array.isArray(v)) return [];
  const out: HostedTestimonial[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
    const author = typeof r.author === 'string' ? r.author.trim() : '';
    if (!quote) continue;
    const t: HostedTestimonial = { quote, author };
    if (typeof r.company === 'string' && r.company.trim()) t.company = r.company.trim();
    const rating = typeof r.rating === 'number' ? Math.round(r.rating) : NaN;
    if (rating >= 1 && rating <= 5) t.rating = rating;
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}
export function normalizeCtas(v: unknown): HostedCta[] {
  if (!Array.isArray(v)) return [];
  const out: HostedCta[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    const value = typeof r.value === 'string' ? r.value.trim() : '';
    const type = r.type === 'call' || r.type === 'email' || r.type === 'url' ? r.type : null;
    if (!label || !value || !type) continue;
    out.push({ label, type, value });
    if (out.length >= 3) break;
  }
  return out;
}
export function normalizeBackground(v: unknown): HostedBackground {
  const bg: HostedBackground = {};
  if (!v || typeof v !== 'object') return bg;
  const r = v as Record<string, unknown>;
  if (r.theme === 'light' || r.theme === 'dark') bg.theme = r.theme;
  if (typeof r.preset === 'string' && BG_PRESET_IDS.has(r.preset)) bg.preset = r.preset;
  if (typeof r.imageUrl === 'string' && r.imageUrl.trim()) bg.imageUrl = r.imageUrl.trim();
  const scrim = typeof r.scrim === 'number' ? Math.round(r.scrim) : NaN;
  if (scrim >= 0 && scrim <= 100) bg.scrim = scrim;
  return bg;
}

// Turn a CTA into a safe href. Unknown/unsafe schemes fall back to '#'.
function ctaHref(cta: HostedCta): string {
  if (cta.type === 'call') return `tel:${cta.value.replace(/[^0-9+]/g, '')}`;
  if (cta.type === 'email') return `mailto:${cta.value}`;
  // url — only allow http(s); anything else is unsafe → neutralise.
  const u = cta.value.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return `https://${u}`;
  return '#';
}

function starRow(rating: number): string {
  const full = Math.max(0, Math.min(5, rating));
  let s = '<span class="qf-hp-stars" aria-label="' + full + ' out of 5">';
  for (let i = 0; i < 5; i++) s += i < full ? '★' : '<span class="qf-hp-star-off">★</span>';
  return s + '</span>';
}

// Compute the trust badge labels from data ALREADY collected. The carrier's
// toggle is their attestation; we only surface numbers we actually hold.
export function computeTrustBadges(
  tenant: Pick<HostedTenant, 'dotNumber' | 'mcNumber'>,
  enabled: boolean | null | undefined,
): string[] {
  if (!enabled) return [];
  const badges: string[] = [];
  if (tenant.dotNumber && tenant.dotNumber.trim()) badges.push(`USDOT ${tenant.dotNumber.trim()}`);
  if (tenant.mcNumber && tenant.mcNumber.trim()) badges.push(`MC ${tenant.mcNumber.trim()}`);
  if (badges.length) badges.push('Insured');
  return badges;
}

const SHIELD_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>';

export function renderHostedPage(opts: RenderHostedPageOpts): string {
  const { tenant, brand, calcSrc } = opts;
  const theme = resolveWidgetTheme(brand);
  const tokens = theme.tokens;
  const accent = tokens['--w-accent'];
  const accentText = tokens['--w-accent-text'];
  const fontStack = tokens['--w-font'];

  const bg = normalizeBackground(brand?.hostedBackgroundJson);
  const pageTheme: 'light' | 'dark' = bg.theme ?? theme.mode;
  const chrome = CHROME[pageTheme];
  const presetId = bg.preset && BG_PRESET_IDS.has(bg.preset) ? bg.preset : 'default';
  const preset = HOSTED_BG_PRESETS.find((p) => p.id === presetId) ?? HOSTED_BG_PRESETS[0];
  const presetBg = pageTheme === 'light' ? preset.light : preset.dark;

  const company = esc(brand?.displayName || tenant.name || 'Instant freight quotes');
  const headline = (brand?.hostedHeadline || '').trim();
  const subhead = (brand?.hostedSubhead || '').trim();
  const badges = computeTrustBadges(tenant, brand?.hostedTrustBadges);
  const testimonials = normalizeTestimonials(brand?.hostedTestimonialsJson);
  const ctas = normalizeCtas(brand?.hostedCtasJson);
  const heroImg = bg.imageUrl || '';
  const scrim = typeof bg.scrim === 'number' ? bg.scrim : 55;

  const hasAside =
    !!headline || !!subhead || badges.length > 0 || testimonials.length > 0 || ctas.length > 0;

  // Body background: hero image (with scrim) wins; else the preset backdrop.
  const scrimAlpha = Math.max(0, Math.min(100, scrim)) / 100;
  const scrimColor =
    pageTheme === 'light'
      ? `rgba(12,16,22,${(scrimAlpha * 0.55).toFixed(3)})`
      : `rgba(6,9,12,${(scrimAlpha * 0.72).toFixed(3)})`;
  const hasHero = !!heroImg;

  // ── aside sections ──────────────────────────────────────────────────
  const headBlock =
    headline || subhead
      ? `<header class="qf-hp-head" data-hp="head">
      ${headline ? `<h1 class="qf-hp-headline">${esc(headline)}</h1>` : ''}
      ${subhead ? `<p class="qf-hp-subhead">${esc(subhead)}</p>` : ''}
    </header>`
      : `<header class="qf-hp-head is-empty" data-hp="head"></header>`;

  const badgesBlock = `<div class="qf-hp-badges" data-hp="badges"${badges.length ? '' : ' hidden'}>
      ${badges
        .map(
          (b) =>
            `<span class="qf-hp-badge">${SHIELD_ICON}<span>${esc(b)}</span></span>`,
        )
        .join('\n      ')}
    </div>`;

  const revsBlock = `<div class="qf-hp-revs" data-hp="revs"${testimonials.length ? '' : ' hidden'}>
      ${testimonials
        .map(
          (t) => `<figure class="qf-hp-rev">
        ${t.rating ? starRow(t.rating) : ''}
        <blockquote>${esc(t.quote)}</blockquote>
        <figcaption>${esc(t.author)}${t.company ? ` · <span>${esc(t.company)}</span>` : ''}</figcaption>
      </figure>`,
        )
        .join('\n      ')}
    </div>`;

  const ctasBlock = `<div class="qf-hp-ctas" data-hp="ctas"${ctas.length ? '' : ' hidden'}>
      ${ctas
        .map(
          (c, i) =>
            `<a class="qf-hp-cta${i === 0 ? ' is-primary' : ''}" href="${esc(ctaHref(c))}"${
              c.type === 'url' ? ' target="_blank" rel="noopener"' : ''
            }>${esc(c.label)}</a>`,
        )
        .join('\n      ')}
    </div>`;

  // NOTE: the hosted page deliberately does NOT render a top brand header
  // (company name / logo). The embedded calculator already shows the tenant's
  // brand name + logo in its own header, so repeating it here duplicated the
  // company name (once at the top, once inside the widget). The hosted hero is
  // now the tenant's `hostedHeadline` (+ subhead) only — see headBlock — so a
  // tenant sees their headline + the widget, never the company name twice.

  // Config the preview relay + live-apply script reads (mirrors the render so
  // edits re-render identically in the portal live preview).
  const hpState = {
    headline,
    subhead,
    trustBadges: !!brand?.hostedTrustBadges,
    dot: (tenant.dotNumber || '').trim(),
    mc: (tenant.mcNumber || '').trim(),
    testimonials,
    ctas,
    background: { theme: pageTheme, preset: presetId, imageUrl: heroImg, scrim },
  };
  const presetsForClient = HOSTED_BG_PRESETS.map((p) => ({ id: p.id, light: p.light, dark: p.dark }));

  return `<!doctype html>
<html lang="en" data-hp-theme="${pageTheme}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,follow" />
  <title>${company} — instant freight quotes</title>
  <meta name="description" content="Get an instant freight rate from ${company}." />
  <style>
    :root {
      --hp-accent: ${accent};
      --hp-accent-text: ${accentText};
      --hp-bg: ${chrome.bg};
      --hp-text: ${chrome.text};
      --hp-muted: ${chrome.muted};
      --hp-card: ${chrome.card};
      --hp-card-border: ${chrome.cardBorder};
      --hp-badge-bg: ${chrome.badgeBg};
      --hp-badge-border: ${chrome.badgeBorder};
      --hp-font: ${fontStack};
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      font-family: var(--hp-font);
      color: var(--hp-text);
      background: ${presetBg};
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
      position: relative;
    }
    ${
      hasHero
        ? `body { background: url("${esc(heroImg)}") center/cover no-repeat fixed; }
    body::before { content: ""; position: fixed; inset: 0; background: ${scrimColor}; z-index: 0; pointer-events: none; }
    body[data-hp-hero] { --hp-text: ${chrome.scrimText}; }`
        : ''
    }
    .qf-hp-shell { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 40px 20px 56px; }
    /* Desktop: content around the calculator; calculator prominent on the right. */
    .qf-hp-grid {
      display: grid;
      gap: 28px 40px;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 520px);
      grid-template-rows: auto auto auto 1fr;
      grid-template-areas: "head calc" "badges calc" "revs calc" "ctas calc";
      align-items: start;
    }
    body.qf-hp--bare .qf-hp-grid { grid-template-columns: minmax(0, 560px); grid-template-areas: "calc"; justify-content: center; }
    .qf-hp-head { grid-area: head; }
    .qf-hp-head.is-empty { display: none; }
    .qf-hp-badges { grid-area: badges; display: flex; flex-wrap: wrap; gap: 8px; }
    .qf-hp-revs { grid-area: revs; display: flex; flex-direction: column; gap: 12px; }
    .qf-hp-ctas { grid-area: ctas; display: flex; flex-wrap: wrap; gap: 10px; }
    .qf-hp-calc { grid-area: calc; }
    [hidden] { display: none !important; }

    .qf-hp-headline { font-size: clamp(26px, 3.4vw, 40px); line-height: 1.12; letter-spacing: -0.02em; font-weight: 800; margin: 0 0 12px; }
    .qf-hp-subhead { font-size: clamp(15px, 1.5vw, 18px); line-height: 1.55; margin: 0; color: var(--hp-muted); max-width: 46ch; }
    body[data-hp-hero] .qf-hp-subhead { color: rgba(255,255,255,0.86); }

    .qf-hp-badge {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 12.5px; font-weight: 700; letter-spacing: 0.01em;
      padding: 7px 12px; border-radius: 999px;
      background: var(--hp-badge-bg); border: 1px solid var(--hp-badge-border);
      color: var(--hp-text);
    }
    .qf-hp-badge svg { color: var(--hp-accent); flex: 0 0 auto; }
    body[data-hp-hero] .qf-hp-badge { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.28); color: #fff; }
    body[data-hp-hero] .qf-hp-badge svg { color: #fff; }

    .qf-hp-rev {
      margin: 0; padding: 16px 18px; border-radius: 14px;
      background: var(--hp-card); border: 1px solid var(--hp-card-border);
    }
    .qf-hp-rev blockquote { margin: 6px 0 10px; font-size: 14.5px; line-height: 1.5; }
    .qf-hp-rev figcaption { font-size: 12.5px; color: var(--hp-muted); font-weight: 600; }
    .qf-hp-rev figcaption span { font-weight: 500; }
    .qf-hp-stars { color: var(--hp-accent); font-size: 13px; letter-spacing: 1px; }
    .qf-hp-star-off { color: var(--hp-card-border); }

    .qf-hp-cta {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 11px 18px; border-radius: 10px; font-size: 14px; font-weight: 700;
      text-decoration: none; border: 1px solid var(--hp-card-border); color: var(--hp-text);
      background: var(--hp-card); transition: transform .12s ease, box-shadow .12s ease;
    }
    .qf-hp-cta.is-primary { background: var(--hp-accent); color: var(--hp-accent-text); border-color: transparent; }
    .qf-hp-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 22px -10px rgba(0,0,0,0.45); }
    body[data-hp-hero] .qf-hp-cta:not(.is-primary) { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.3); color: #fff; }

    .qf-hp-frame-card { border-radius: 16px; overflow: clip; box-shadow: 0 30px 70px -34px rgba(0,0,0,0.55); background: transparent; }
    .qf-hp-frame { width: 100%; border: 0; display: block; min-height: 620px; background: transparent; }

    /* Mobile (≤640): calculator FIRST, then a condensed trust strip below. */
    @media (max-width: 640px) {
      .qf-hp-shell { padding: 22px 14px 36px; }
      .qf-hp-grid {
        grid-template-columns: 1fr;
        grid-template-rows: none;
        grid-template-areas: "calc" "head" "badges" "revs" "ctas";
        gap: 20px;
      }
      body.qf-hp--bare .qf-hp-grid { grid-template-columns: 1fr; }
      .qf-hp-headline { font-size: 24px; }
      /* Condense the credential badges so the trio sits on one strip instead of
         orphaning a lone badge on its own line (no-orphan-wrap rule). */
      .qf-hp-badges { gap: 6px; }
      .qf-hp-badge { font-size: 11px; padding: 5px 9px; gap: 5px; }
      /* Only the first two reviews on mobile — condensed, not hidden content. */
      .qf-hp-rev:nth-child(n+3) { display: none; }
      .qf-hp-ctas { flex-direction: column; }
      .qf-hp-cta { width: 100%; }
    }
  </style>
</head>
<body class="${hasAside ? '' : 'qf-hp--bare'}"${hasHero ? ' data-hp-hero' : ''}>
  <div class="qf-hp-shell">
    <div class="qf-hp-grid">
      ${headBlock}
      ${badgesBlock}
      ${revsBlock}
      ${ctasBlock}
      <div class="qf-hp-calc">
        <div class="qf-hp-frame-card">
          <iframe id="qf-calc-frame" class="qf-hp-frame" src="${esc(calcSrc)}" title="${company} rate calculator" loading="eager" allow="clipboard-write"></iframe>
        </div>
      </div>
    </div>
  </div>
  <script>
  (function(){
    var HP = ${jsonForScript(hpState)};
    var PRESETS = ${jsonForScript(presetsForClient)};
    var CHROME = ${jsonForScript(CHROME)};
    var ACCENT = ${jsonForScript(accent)};
    var ACCENT_TEXT = ${jsonForScript(accentText)};
    var calc = document.getElementById('qf-calc-frame');
    var body = document.body;
    function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(ch){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]; }); }

    // ── size relay: inner calculator height → resize frame → report ours up ──
    // Coalesce bursts (a render() + the ResizeObserver it triggers both call
    // this) into ONE post per animation frame so height reports don't oscillate.
    var _rhRaf = 0;
    function postHeight(){ _rhRaf = 0; try { if (window.parent && window.parent !== window) window.parent.postMessage({ type:'QF_WIDGET_HEIGHT', height: document.documentElement.scrollHeight }, '*'); } catch(_e){} }
    function reportHeight(){
      if (_rhRaf) return;
      if (window.requestAnimationFrame) { _rhRaf = window.requestAnimationFrame(postHeight); } else { postHeight(); }
    }
    function forwardToCalc(msg){ try { if (calc && calc.contentWindow) calc.contentWindow.postMessage(msg, '*'); } catch(_e){} }
    window.addEventListener('message', function(e){
      if (!e || !e.data) return;
      if (calc && e.source === calc.contentWindow) {
        if (e.data.type === 'QF_WIDGET_HEIGHT' && typeof e.data.height === 'number') {
          calc.style.height = Math.max(320, Math.round(e.data.height)) + 'px';
          reportHeight();
        }
        return;
      }
      var d = e.data;
      if (d.qf === 'theme' || d.qf === 'brand-preview' || d.qf === 'brand-refetch') { forwardToCalc(d); return; }
      if (d.qf === 'hosted-preview' && d.patch) { applyHosted(d.patch); }
    });
    if (window.ResizeObserver) { try { new ResizeObserver(reportHeight).observe(document.body); } catch(_e){} }
    window.addEventListener('load', reportHeight);

    // ── live-apply of hosted-copy edits (portal preview only) ──
    var SHIELD = ${jsonForScript(SHIELD_ICON)};
    function computeBadges(){
      if (!HP.trustBadges) return [];
      var b = [];
      if (HP.dot) b.push('USDOT ' + HP.dot);
      if (HP.mc) b.push('MC ' + HP.mc);
      if (b.length) b.push('Insured');
      return b;
    }
    function stars(n){
      n = Math.max(0, Math.min(5, n|0));
      var s = '<span class="qf-hp-stars">';
      for (var i=0;i<5;i++) s += i < n ? '★' : '<span class="qf-hp-star-off">★</span>';
      return s + '</span>';
    }
    function ctaHref(c){
      if (c.type === 'call') return 'tel:' + String(c.value||'').replace(/[^0-9+]/g,'');
      if (c.type === 'email') return 'mailto:' + c.value;
      var u = String(c.value||'').trim();
      if (/^https?:\\/\\//i.test(u)) return u;
      if (/^[a-z0-9.-]+\\.[a-z]{2,}(\\/|$)/i.test(u)) return 'https://' + u;
      return '#';
    }
    function q(sel){ return document.querySelector(sel); }
    function render(){
      // headline / subhead
      var head = q('[data-hp="head"]');
      var hasHead = HP.headline || HP.subhead;
      head.classList.toggle('is-empty', !hasHead);
      head.innerHTML = (HP.headline ? '<h1 class="qf-hp-headline">' + esc(HP.headline) + '</h1>' : '')
        + (HP.subhead ? '<p class="qf-hp-subhead">' + esc(HP.subhead) + '</p>' : '');
      // badges
      var badges = computeBadges();
      var bEl = q('[data-hp="badges"]');
      bEl.hidden = !badges.length;
      bEl.innerHTML = badges.map(function(x){ return '<span class="qf-hp-badge">' + SHIELD + '<span>' + esc(x) + '</span></span>'; }).join('');
      // testimonials
      var revs = (HP.testimonials||[]).filter(function(t){ return t && t.quote; }).slice(0,4);
      var rEl = q('[data-hp="revs"]');
      rEl.hidden = !revs.length;
      rEl.innerHTML = revs.map(function(t){
        return '<figure class="qf-hp-rev">' + (t.rating ? stars(t.rating) : '')
          + '<blockquote>' + esc(t.quote) + '</blockquote>'
          + '<figcaption>' + esc(t.author||'') + (t.company ? ' · <span>' + esc(t.company) + '</span>' : '') + '</figcaption></figure>';
      }).join('');
      // ctas — this LIVE render runs only in the portal preview (via applyHosted
      // on a postMessage), never for a real visitor. So it is intentionally
      // lenient: any added button shows at once with a "Button" placeholder +
      // an inert '#' href until label/value are filled, giving the owner instant
      // feedback. The REAL page is server-rendered through normalizeCtas, which
      // stays strict (an incomplete button never ships).
      var ctas = (HP.ctas||[]).filter(function(c){ return c && typeof c === 'object'; }).slice(0,3);
      var cEl = q('[data-hp="ctas"]');
      cEl.hidden = !ctas.length;
      cEl.innerHTML = ctas.map(function(c,i){
        var tgt = c.type === 'url' ? ' target="_blank" rel="noopener"' : '';
        var label = (c.label && String(c.label).trim()) ? c.label : 'Button';
        var href = (c.value && String(c.value).trim()) ? ctaHref(c) : '#';
        return '<a class="qf-hp-cta' + (i===0?' is-primary':'') + '" href="' + esc(href) + '"' + tgt + '>' + esc(label) + '</a>';
      }).join('');
      // bare vs framed
      var hasAside = hasHead || badges.length || revs.length || ctas.length;
      body.classList.toggle('qf-hp--bare', !hasAside);
      applyBackground();
      reportHeight();
    }
    function applyBackground(){
      var bg = HP.background || {};
      var theme = (bg.theme === 'light' || bg.theme === 'dark') ? bg.theme : document.documentElement.getAttribute('data-hp-theme') || 'dark';
      document.documentElement.setAttribute('data-hp-theme', theme);
      var ch = CHROME[theme];
      var r = document.documentElement.style;
      r.setProperty('--hp-bg', ch.bg); r.setProperty('--hp-text', ch.text); r.setProperty('--hp-muted', ch.muted);
      r.setProperty('--hp-card', ch.card); r.setProperty('--hp-card-border', ch.cardBorder);
      r.setProperty('--hp-badge-bg', ch.badgeBg); r.setProperty('--hp-badge-border', ch.badgeBorder);
      var presetId = bg.preset || 'default';
      var p = PRESETS.filter(function(x){ return x.id === presetId; })[0] || PRESETS[0];
      var presetBg = theme === 'light' ? p.light : p.dark;
      if (bg.imageUrl) {
        body.setAttribute('data-hp-hero', '');
        body.style.background = 'url("' + bg.imageUrl + '") center/cover no-repeat fixed';
        var a = (typeof bg.scrim === 'number' ? bg.scrim : 55) / 100;
        var sc = theme === 'light' ? 'rgba(12,16,22,' + (a*0.55).toFixed(3) + ')' : 'rgba(6,9,12,' + (a*0.72).toFixed(3) + ')';
        ensureScrim(sc);
      } else {
        body.removeAttribute('data-hp-hero');
        body.style.background = presetBg;
        removeScrim();
      }
    }
    var scrimEl = null;
    function ensureScrim(color){
      if (!scrimEl) { scrimEl = document.createElement('div'); scrimEl.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;'; document.body.insertBefore(scrimEl, document.body.firstChild); }
      scrimEl.style.background = color;
    }
    function removeScrim(){ if (scrimEl && scrimEl.parentNode) { scrimEl.parentNode.removeChild(scrimEl); scrimEl = null; } }
    function applyHosted(patch){
      if (!patch || typeof patch !== 'object') return;
      if ('hostedHeadline' in patch) HP.headline = String(patch.hostedHeadline || '').trim();
      if ('hostedSubhead' in patch) HP.subhead = String(patch.hostedSubhead || '').trim();
      if ('hostedTrustBadges' in patch) HP.trustBadges = !!patch.hostedTrustBadges;
      if ('hostedTestimonialsJson' in patch) HP.testimonials = Array.isArray(patch.hostedTestimonialsJson) ? patch.hostedTestimonialsJson : [];
      if ('hostedCtasJson' in patch) HP.ctas = Array.isArray(patch.hostedCtasJson) ? patch.hostedCtasJson : [];
      if ('hostedBackgroundJson' in patch && patch.hostedBackgroundJson && typeof patch.hostedBackgroundJson === 'object') {
        HP.background = Object.assign({}, HP.background, patch.hostedBackgroundJson);
      }
      render();
    }
    window.__qfApplyHosted = applyHosted; // exposed for tests / debugging
  })();
  </script>
</body>
</html>`;
}
