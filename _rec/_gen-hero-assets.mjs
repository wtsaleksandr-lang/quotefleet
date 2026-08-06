// Generate the extra hero-recorder assets (plain Node — the TS toolchain / tsx
// is unavailable in this env, so these are hand-authored from the real
// widgetThemes.ts palettes rather than resolveWidgetTheme()):
//
//   _rec/cfg-after-qf.json  — the "reskinned" widget config the DESKTOP Customize
//     beat's live-preview iframe loads AFTER the owner clicks a dark preset + a
//     periwinkle accent. It is cfg-mono-qf.json (light/Clarity) with its theme
//     block swapped to a Midnight-dark token set + #6E8BFF accent, so the iframe
//     visibly reskins white -> dark on reload.
//
//   _rec/brand-options.json — { presets, fonts, ctaHovers, fontColors, mapStyles }
//     the exact shape GET /api/tenant/brand returns (see routes/tenant.ts), so the
//     Customize panel renders its real preset strip + accent + font + text-color
//     controls. Values mirror WIDGET_PRESET_LIST / WIDGET_FONTS / FONT_COLOR_SWATCHES
//     / MAP_STYLE_LIST.
//
// Regenerate:  node _rec/_gen-hero-assets.mjs
import fs from 'node:fs';
import path from 'node:path';

const REC = path.resolve('_rec');
const before = JSON.parse(fs.readFileSync(path.join(REC, 'cfg-mono-qf.json'), 'utf8'));

// Periwinkle accent the beat selects; Midnight dark shell from widgetThemes.ts.
const ACCENT = '#6E8BFF';
const darkTokens = {
  '--w-page-bg': '#13181A',
  '--w-surface': '#1E2528',
  '--w-surface-2': '#262E31',
  '--w-surface-2-text': '#E6E3E0',
  '--w-input-bg': '#E6E3E0',
  '--w-input-bg-hover': '#D4CFC9',
  '--w-input-text': '#1E1E1E',
  '--w-input-border': 'rgba(110,139,255,.30)',
  '--w-text': '#FFFFFF',
  '--w-muted': '#B1C5CE',
  '--w-muted-2': '#9FB2BB',
  '--w-contact-text': '#C9D4DA',
  '--w-border': 'rgba(255,255,255,.10)',
  '--w-accent': ACCENT,
  '--w-accent-solid': ACCENT,
  '--w-accent-hover': '#5A78F0',
  '--w-accent-text': '#10141A',
  '--w-accent-surface': '#FFFFFF',
  '--w-accent-surface-border': 'rgba(110,139,255,.24)',
  '--w-accent-on-surface': ACCENT,
  '--w-accent-pill-bg': 'rgba(110,139,255,0.14)',
  '--w-accent-pill-border': 'rgba(110,139,255,0.42)',
  '--w-total-text': '#10141A',
  '--w-pill-text': '#E6E3E0',
  '--w-error-bg': '#F3EDDF',
  '--w-error-text': '#1E1E1E',
  '--w-success-bg': '#E4EDF1',
  '--w-success-text': '#1E1E1E',
  '--w-primary': ACCENT,
  '--w-primary-hover': '#5A78F0',
  '--w-font': "'Satoshi', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  '--w-radius-card': '16px',
  '--w-radius-input': '10px',
  '--w-radius-btn': '12px',
  '--w-radius-pill': '10px',
  '--w-border-width': '1px',
  '--w-card-shadow': '0 1px 2px rgba(0,0,0,.4), 0 18px 42px -20px rgba(0,0,0,.62)',
  '--w-label-transform': 'none',
  '--w-label-spacing': 'normal',
  '--w-label-weight': '600',
  '--w-active-border-color': ACCENT,
  '--w-active-border-width': '2px',
  '--w-chip-inactive-bg': '#262E31',
  '--w-chip-inactive-border': 'transparent',
  '--w-chip-active-bg': '#1E2528',
  '--w-chip-active-text': '#FFFFFF',
  '--w-surface-frost': 'rgba(30,37,40,.92)',
  '--w-frost-blur': '0px',
  '--w-footer-text': '#9FB2BB',
  '--w-hint-text': '#9FB2BB',
  '--w-oncard-text': '#FFFFFF',
  '--w-oncard-muted': '#9FB2BB',
  '--w-oncard-accent': ACCENT,
  '--w-tab-active-text': '#FFFFFF',
};

const after = JSON.parse(JSON.stringify(before));
after.brand.themePreset = 'midnight';
after.brand.primaryColor = ACCENT;
after.theme = {
  preset: 'midnight',
  mode: 'dark',
  font: 'satoshi',
  fontStack: darkTokens['--w-font'],
  accentOverride: ACCENT,
  fontColor: 'auto',
  ctaHover: 'border',
  mapBlend: 'off',
  tokens: darkTokens,
};
fs.writeFileSync(path.join(REC, 'cfg-after-qf.json'), JSON.stringify(after, null, 2));

// ── /api/tenant/brand option universes (routes/tenant.ts shape) ──
const presets = [
  { id: 'midnight', label: 'Midnight', description: 'Charcoal shell, cream inputs, cobalt accent.', mode: 'dark', bg: '#13181A', surface: '#1E2528', accent: '#0D3CFC' },
  { id: 'mono', label: 'Clarity', description: 'Premium white surfaces, black ink, solid black CTA.', mode: 'light', bg: '#FFFFFF', surface: '#FFFFFF', accent: '#111111' },
  { id: 'ironhorse', label: 'Ironhorse', description: 'Bold orange-on-black moto identity.', mode: 'light', bg: '#F3F3F4', surface: '#FFFFFF', accent: '#FC6600' },
  { id: 'harbor', label: 'Harbor', description: 'Cool maritime navy on soft grey-blue.', mode: 'light', bg: '#EAEEF3', surface: '#FFFFFF', accent: '#0C566B' },
  { id: 'cupertino', label: 'Cupertino', description: 'Clean Apple-style light UI, system blue.', mode: 'light', bg: '#EDEDF2', surface: '#FFFFFF', accent: '#007AFF' },
  { id: 'booking', label: 'Voyage', description: 'Deep travel-blue shell, bright blue accent.', mode: 'dark', bg: '#002E77', surface: '#003B95', accent: '#006CE4' },
  { id: 'tesla', label: 'Voltage', description: 'Near-black console void, red accent.', mode: 'dark', bg: '#0A0A0B', surface: '#141516', accent: '#E82127' },
  { id: 'stripe', label: 'Blurple', description: 'Soft off-white, signature blurple accent.', mode: 'light', bg: '#F6F9FC', surface: '#FFFFFF', accent: '#635BFF' },
  { id: 'vault', label: 'Vault', description: 'Warm cream paper, industrial orange accent.', mode: 'light', bg: '#EAE4D9', surface: '#FBF8F2', accent: '#F04E23' },
];
const fonts = [
  { id: 'satoshi', label: 'Satoshi' }, { id: 'inter', label: 'Inter' }, { id: 'sora', label: 'Sora' },
  { id: 'roboto', label: 'Roboto' }, { id: 'dmsans', label: 'DM Sans' }, { id: 'clashdisplay', label: 'Clash Display' },
  { id: 'oswald', label: 'Oswald' }, { id: 'system', label: 'System' },
];
const ctaHovers = ['border', 'lift', 'glow', 'fill', 'none'].map((id) => ({ id }));
const fontColors = [
  { id: 'white', label: 'White', hex: '#FFFFFF' },
  { id: 'charcoal', label: 'Charcoal', hex: '#141414' },
  { id: 'ink', label: 'Ink', hex: '#1E1E1E' },
  { id: 'light-gray', label: 'Light gray', hex: '#E6E3E0' },
  { id: 'slate', label: 'Slate', hex: '#334155' },
  { id: 'cream', label: 'Cream', hex: '#F5F1E8' },
];
const mapStyles = [
  { key: 'branded', label: 'Branded', hint: 'On-brand navy map with highlighted roads.' },
  { key: 'dark_routes', label: 'Dark', hint: 'Dark grey base with a bright white route (Uber-style).' },
];
fs.writeFileSync(path.join(REC, 'brand-options.json'), JSON.stringify({ presets, fonts, ctaHovers, fontColors, mapStyles }, null, 2));

console.log('WROTE cfg-after-qf.json + brand-options.json; after.accent=', ACCENT, 'presets=', presets.length);
