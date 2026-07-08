type Check = {
  name: string;
  env: string[];
  requiredFor: 'pilot' | 'public-launch' | 'paid-launch';
  note: string;
  validate?: () => string | null;
};

function value(name: string): string {
  return String(process.env[name] ?? '').trim();
}

function present(names: string[]): boolean {
  return names.every((name) => value(name).length > 0);
}

function masked(name: string): string {
  const v = value(name);
  if (!v) return 'missing';
  if (v.length <= 6) return 'set';
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

const checks: Check[] = [
  {
    name: 'Database',
    env: ['DATABASE_URL'],
    requiredFor: 'pilot',
    note: 'Postgres connection used by app, health endpoint, tenants, quotes, leads, and auth.',
    validate: () => value('DATABASE_URL').startsWith('postgresql://') ? null : 'DATABASE_URL should start with postgresql://',
  },
  {
    name: 'Session secret',
    env: ['SESSION_SECRET'],
    requiredFor: 'pilot',
    note: 'Required for stable signed sessions across restarts.',
    validate: () => value('SESSION_SECRET').length >= 32 ? null : 'SESSION_SECRET should be at least 32 characters.',
  },
  {
    name: 'Public URL',
    env: ['PUBLIC_BASE_URL'],
    requiredFor: 'pilot',
    note: 'Used for hosted links, embeds, and email/link generation.',
    validate: () => /^https?:\/\//.test(value('PUBLIC_BASE_URL')) ? null : 'PUBLIC_BASE_URL should include http:// or https://',
  },
  {
    name: 'Host domains',
    env: ['HOST_DOMAINS'],
    requiredFor: 'public-launch',
    note: 'Comma-separated platform domains with wildcard DNS pointing at the app.',
    validate: () => value('HOST_DOMAINS').includes('.') ? null : 'HOST_DOMAINS should contain at least one domain.',
  },
  {
    name: 'AI provider',
    env: ['ANTHROPIC_API_KEY'],
    requiredFor: 'pilot',
    note: 'Default AI key. Tenants can later use tenant-level keys.',
    validate: () => value('ANTHROPIC_API_KEY').startsWith('sk-') ? null : 'ANTHROPIC_API_KEY should look like a provider key.',
  },
  {
    name: 'Address autocomplete',
    env: ['GOOGLE_MAPS_API_KEY'],
    requiredFor: 'public-launch',
    note: 'Preferred provider for Places/Geocoding. Mapbox can be used as fallback.',
  },
  {
    name: 'Mapbox fallback',
    env: ['MAPBOX_TOKEN'],
    requiredFor: 'public-launch',
    note: 'Fallback autocomplete/geocoding provider if Google is unavailable.',
  },
  {
    name: 'SMTP delivery',
    env: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    requiredFor: 'public-launch',
    note: 'Required for lead notifications, customer auto-replies, and magic links to leave stdout.',
  },
  {
    name: 'Fuel index',
    env: ['EIA_API_KEY'],
    requiredFor: 'public-launch',
    note: 'Optional live diesel index. App falls back if unset, but production should prefer live data.',
  },
  {
    name: 'Stripe secret',
    env: ['STRIPE_SECRET_KEY'],
    requiredFor: 'paid-launch',
    note: 'Needed only when paid billing is active.',
    validate: () => !value('STRIPE_SECRET_KEY') || value('STRIPE_SECRET_KEY').startsWith('sk_') ? null : 'STRIPE_SECRET_KEY should start with sk_.',
  },
  {
    name: 'Stripe webhook',
    env: ['STRIPE_WEBHOOK_SECRET'],
    requiredFor: 'paid-launch',
    note: 'Needed for billing webhooks when paid subscriptions are active.',
    validate: () => !value('STRIPE_WEBHOOK_SECRET') || value('STRIPE_WEBHOOK_SECRET').startsWith('whsec_') ? null : 'STRIPE_WEBHOOK_SECRET should start with whsec_.',
  },
];

const order = ['pilot', 'public-launch', 'paid-launch'] as const;
const target = (process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1] ?? 'public-launch') as typeof order[number];
const targetIndex = order.indexOf(target);
if (targetIndex < 0) {
  console.error(`Unknown target: ${target}`);
  process.exit(2);
}

const relevant = checks.filter((check) => order.indexOf(check.requiredFor) <= targetIndex);
let failed = 0;

console.log(`QuoteFleet production readiness check: ${target}`);
for (const check of relevant) {
  const hasValues = present(check.env);
  const validation = hasValues && check.validate ? check.validate() : null;
  const ok = hasValues && !validation;
  if (!ok) failed += 1;
  console.log(`\n${ok ? 'OK' : 'MISSING'} ${check.name}`);
  console.log(`  env: ${check.env.map((name) => `${name}=${masked(name)}`).join(', ')}`);
  console.log(`  scope: ${check.requiredFor}`);
  console.log(`  note: ${check.note}`);
  if (validation) console.log(`  issue: ${validation}`);
}

if (failed > 0) {
  console.log(`\nResult: ${failed} missing or invalid readiness item(s).`);
  process.exit(1);
}

console.log('\nResult: readiness environment variables are present for this target.');
