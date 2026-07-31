// Reproduce Alex's onboarding blocker: signs up a FRESH tenant (so the wizard
// gate is live), then POSTs the exact payloads the wizard sends from the brand
// step — both the "Continue" shape and the "Skip" shape — and prints the real
// status + body for each.
const BASE = 'http://localhost:8854';
const stamp = process.argv[2] || String(Date.now());
const email = `obrepro+${stamp}@example.com`;

let cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    redirect: 'manual',
  });
  const setc = res.headers.getSetCookie?.() || [];
  if (setc.length) cookie = setc.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body };
}

console.log('== 1. signup fresh tenant ==');
const su = await call('/api/auth/signup', {
  method: 'POST',
  body: JSON.stringify({
    companyName: `OB Repro ${stamp}`,
    email,
    password: 'ReproTest!2345',
    countryFocus: 'US',
    dpaAccepted: true,
    dpaVersion: '1.0',
  }),
});
console.log('signup:', su.status, JSON.stringify(su.body).slice(0, 300));
if (su.status >= 400) { console.log('ABORT: signup failed'); process.exit(1); }

console.log('\n== 2. /api/auth/me (is onboarding gated?) ==');
const me = await call('/api/auth/me');
console.log('me:', me.status, JSON.stringify(me.body).slice(0, 400));

// EXACT payload the wizard sends on Continue from the brand step.
console.log('\n== 3. CONTINUE from brand step (with color, lane left blank) ==');
const cont = await call('/api/tenant/onboarding/apply', {
  method: 'POST',
  body: JSON.stringify({
    freightVertical: 'dryvan_ftl',
    pricingMode: 'per_mile',
    mainLane: { from: null, to: null },
    brand: { primaryColor: '#0D3CFC' },
  }),
});
console.log('apply(continue):', cont.status, JSON.stringify(cont.body).slice(0, 500));

console.log('\n== 4. CONTINUE with NO brand (the "skip the color" case) ==');
const noBrand = await call('/api/tenant/onboarding/apply', {
  method: 'POST',
  body: JSON.stringify({
    freightVertical: 'dryvan_ftl',
    pricingMode: 'per_mile',
    mainLane: { from: null, to: null },
  }),
});
console.log('apply(no brand):', noBrand.status, JSON.stringify(noBrand.body).slice(0, 500));

console.log('\n== 5. SKIP button payload ==');
const skip = await call('/api/tenant/onboarding/apply', {
  method: 'POST',
  body: JSON.stringify({ skip: true }),
});
console.log('apply(skip):', skip.status, JSON.stringify(skip.body).slice(0, 500));

console.log('\n== 6. rate-cards fetch the wizard does right after apply ==');
const rc = await call('/api/tenant/rate-cards');
console.log('rate-cards:', rc.status, JSON.stringify(rc.body).slice(0, 200));
