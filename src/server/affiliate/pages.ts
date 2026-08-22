/**
 * Server-rendered HTML for the PUBLIC partner program surfaces:
 *   GET /partners            — landing (both programs + self-serve affiliate signup)
 *   GET /partners/terms      — full program terms
 *   GET /partners/dashboard  — an affiliate's stats + link + payout status
 *
 * All three reuse the canonical marketing chrome (renderMarketingShell → full
 * header + premium footer + qf-public-wft skin) so they're visually identical to
 * /pricing etc. Page-scoped CSS is inline + token-driven (var(--*)) on the 8px
 * ramp — light/dark parity, squared corners, left-aligned headers.
 */
import { renderMarketingShell } from '../siteChrome.js';
import {
  AFFILIATE_BASE_RATE,
  AFFILIATE_PRO_RATE,
  AFFILIATE_PRO_THRESHOLD,
  AFFILIATE_PRO_DURATION_MONTHS,
  AFFILIATE_PARTNER_RATE,
  AFFILIATE_MIN_PAYOUT_CENTS,
  REF_COOKIE_DAYS,
  REFEREE_TRIAL_DAYS,
  REFEREE_DISCOUNT_PCT,
  REFEREE_DISCOUNT_MONTHS,
  REFERRER_FREE_MONTHS,
} from './programs.js';
import type { AffiliateDashboard } from './dashboard.js';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] as string
  );
}

const pct = (f: number) => `${Math.round(f * 100)}%`;
const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Page-scoped CSS (tokens + 8px ramp only; no raw hex) ────────────────────
const PARTNERS_CSS = `
  .pt-shell { max-width: 1000px; margin: 0 auto; padding: 32px 24px 60px; }
  .pt-hero { max-width: 1000px; margin: 0 auto; padding: 48px 24px 8px; text-align: left; }
  .pt-hero .pt-eyebrow { display: inline-block; font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0 0 12px; }
  .pt-hero h1 { margin: 0; font-size: 44px; line-height: 1.1; letter-spacing: -0.02em; }
  .pt-hero .lead { margin: 12px 0 0; max-width: 640px; }
  .pt-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 24px 0 0; }
  .pt-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 4px); padding: 24px; display: flex; flex-direction: column; }
  .pt-card h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
  .pt-card .pt-kicker { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 0 12px; }
  .pt-card ul { margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .pt-card li { display: flex; gap: 8px; align-items: flex-start; font-size: 15px; line-height: 1.5; }
  .pt-card li .pt-tick { flex: 0 0 auto; color: var(--accent); font-weight: 800; }
  .pt-tiers { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0 0; }
  .pt-tier { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 4px); padding: 16px; }
  .pt-tier .pt-rate { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }
  .pt-tier .pt-tier-name { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .pt-tier p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted); }
  .pt-section { margin: 48px 0 0; }
  .pt-section h2 { font-size: 26px; letter-spacing: -0.01em; margin: 0 0 16px; }
  .pt-signup { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 4px); padding: 24px; max-width: 560px; }
  .pt-field { display: flex; flex-direction: column; gap: 4px; margin: 0 0 16px; }
  .pt-field label { font-size: 13px; font-weight: 600; color: var(--muted); }
  .pt-field input { padding: 12px; border: 1px solid var(--border-strong, var(--border)); border-radius: var(--radius-btn, 4px); background: var(--surface-2, var(--surface)); color: var(--ink); font-size: 15px; }
  .pt-field input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .pt-result { display: none; margin: 16px 0 0; padding: 16px; border: 1px solid var(--accent); border-radius: var(--radius-card, 4px); background: var(--surface-2, var(--surface)); }
  .pt-result.is-shown { display: block; }
  .pt-linkbox { display: flex; gap: 8px; align-items: stretch; margin: 8px 0 0; }
  .pt-linkbox input { flex: 1 1 auto; font-family: var(--font-mono); font-size: 13px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-btn, 4px); background: var(--surface); color: var(--ink); }
  .pt-copy { flex: 0 0 auto; min-width: 88px; }
  .pt-err { color: var(--danger, var(--accent)); font-size: 14px; margin: 8px 0 0; min-height: 16px; }
  .pt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 24px 0 0; }
  .pt-stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card, 4px); padding: 16px; }
  .pt-stat .pt-stat-n { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .pt-stat .pt-stat-l { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
  .pt-progress { height: 8px; border-radius: 4px; background: var(--surface-2, var(--border)); overflow: hidden; margin: 12px 0 0; }
  .pt-progress > span { display: block; height: 8px; background: var(--accent); }
  .pt-muted { color: var(--muted); font-size: 14px; line-height: 1.6; }
  .pt-terms { max-width: 760px; }
  .pt-terms h2 { font-size: 22px; margin: 32px 0 8px; letter-spacing: -0.01em; }
  .pt-terms h3 { font-size: 17px; margin: 20px 0 4px; }
  .pt-terms p, .pt-terms li { font-size: 15px; line-height: 1.6; color: var(--ink); }
  .pt-terms ul { padding-left: 20px; }
  @media (max-width: 720px) {
    .pt-hero h1 { font-size: 32px; }
    .pt-grid, .pt-tiers, .pt-stats { grid-template-columns: 1fr; }
  }
`;

// ── /partners landing ───────────────────────────────────────────────────────
export function renderPartnersLanding(): string {
  const body = `
  <section class="pt-hero">
    <span class="pt-eyebrow">Partner with QuoteFleet</span>
    <h1>Earn by growing freight&#8217;s simplest quote tool</h1>
    <p class="lead">Two ways to earn: refer a fellow carrier and you both win, or join our affiliate program and earn recurring cash for every customer you send.</p>
  </section>
  <main class="pt-shell">
    <div class="pt-grid">
      <div class="pt-card">
        <p class="pt-kicker">For customers</p>
        <h2>Referral program</h2>
        <p class="pt-muted">Already using QuoteFleet? Share your link with a peer &mdash; you both get rewarded.</p>
        <ul>
          <li><span class="pt-tick">&#10003;</span><span><strong>You get ${REFERRER_FREE_MONTHS} free month</strong> of your subscription for every carrier you refer who becomes a paying customer.</span></li>
          <li><span class="pt-tick">&#10003;</span><span><strong>They get a ${REFEREE_TRIAL_DAYS}-day trial</strong> (double the usual 14) plus <strong>${pct(REFEREE_DISCOUNT_PCT)} off their first ${REFEREE_DISCOUNT_MONTHS} months</strong>.</span></li>
          <li><span class="pt-tick">&#10003;</span><span>Your referral link is in your dashboard &mdash; no signup needed.</span></li>
        </ul>
        <p class="pt-muted" style="margin-top:16px;"><a href="/login">Sign in</a> to grab your referral link.</p>
      </div>
      <div class="pt-card">
        <p class="pt-kicker">For marketers &amp; creators</p>
        <h2>Affiliate program</h2>
        <p class="pt-muted">Send us customers and earn recurring commission for as long as they stay.</p>
        <ul>
          <li><span class="pt-tick">&#10003;</span><span><strong>${pct(AFFILIATE_BASE_RATE)} recurring</strong> commission on every referred subscription.</span></li>
          <li><span class="pt-tick">&#10003;</span><span>Grows to <strong>${pct(AFFILIATE_PRO_RATE)} for ${AFFILIATE_PRO_DURATION_MONTHS} months</strong> once you have ${AFFILIATE_PRO_THRESHOLD}+ active customers.</span></li>
          <li><span class="pt-tick">&#10003;</span><span><strong>${REF_COOKIE_DAYS}-day cookie</strong>, monthly payouts, ${money(AFFILIATE_MIN_PAYOUT_CENTS)} minimum.</span></li>
        </ul>
        <p class="pt-muted" style="margin-top:16px;">Sign up below &mdash; it&#8217;s free and takes a minute.</p>
      </div>
    </div>

    <div class="pt-section">
      <h2>Affiliate commission tiers</h2>
      <div class="pt-tiers">
        <div class="pt-tier"><div class="pt-tier-name">Base</div><div class="pt-rate">${pct(AFFILIATE_BASE_RATE)}</div><p>Recurring on every referred subscription from day one.</p></div>
        <div class="pt-tier"><div class="pt-tier-name">Pro</div><div class="pt-rate">${pct(AFFILIATE_PRO_RATE)}</div><p>For ${AFFILIATE_PRO_DURATION_MONTHS} months once you reach ${AFFILIATE_PRO_THRESHOLD}+ active referred customers.</p></div>
        <div class="pt-tier"><div class="pt-tier-name">Partner</div><div class="pt-rate">${pct(AFFILIATE_PARTNER_RATE)}+</div><p>A negotiated lifetime rate for our top-performing partners.</p></div>
      </div>
    </div>

    <div class="pt-section">
      <h2>Become an affiliate</h2>
      <form class="pt-signup" id="pt-signup-form" novalidate>
        <div class="pt-field">
          <label for="pt-email">Your email</label>
          <input type="email" id="pt-email" name="email" required autocomplete="email" placeholder="you@example.com">
        </div>
        <div class="pt-field">
          <label for="pt-name">Name or brand (optional)</label>
          <input type="text" id="pt-name" name="name" autocomplete="name" placeholder="Your name or channel">
        </div>
        <button type="submit" class="btn btn-primary" id="pt-submit">Create my affiliate link</button>
        <p class="pt-err" id="pt-err" role="alert"></p>
        <div class="pt-result" id="pt-result">
          <strong>You&#8217;re in!</strong> Here&#8217;s your unique referral link:
          <div class="pt-linkbox">
            <input type="text" id="pt-link" readonly>
            <button type="button" class="btn btn-secondary pt-copy" id="pt-copy">Copy</button>
          </div>
          <p class="pt-muted" style="margin-top:12px;">Your code: <strong id="pt-code"></strong>. <a id="pt-dash" href="/partners/dashboard">Open your dashboard &rarr;</a></p>
        </div>
      </form>
      <p class="pt-muted" style="margin-top:16px;">By joining you agree to our <a href="/partners/terms">program terms</a>.</p>
    </div>
  </main>
  <script>${SIGNUP_SCRIPT}</script>`;

  return renderMarketingShell({
    title: 'QuoteFleet Partners — referral & affiliate program',
    description:
      'Earn with QuoteFleet. Refer a carrier and you both win, or join our affiliate program for 25% recurring commission (30% at scale), a 90-day cookie and monthly payouts.',
    canonicalPath: '/partners',
    bodyHtml: body,
    headStyles: PARTNERS_CSS,
  });
}

const SIGNUP_SCRIPT = `
(function(){
  var form = document.getElementById('pt-signup-form');
  if (!form) return;
  var errEl = document.getElementById('pt-err');
  var resEl = document.getElementById('pt-result');
  var submit = document.getElementById('pt-submit');
  form.addEventListener('submit', function(e){
    e.preventDefault();
    errEl.textContent = '';
    var email = (document.getElementById('pt-email').value || '').trim();
    var name = (document.getElementById('pt-name').value || '').trim();
    if (!email || email.indexOf('@') < 1) { errEl.textContent = 'Please enter a valid email.'; return; }
    submit.disabled = true; submit.textContent = 'Creating…';
    fetch('/api/partners/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, name: name })
    }).then(function(r){ return r.text().then(function(t){ var j=null; try{j=JSON.parse(t);}catch(_e){} return { ok:r.ok, j:j }; }); })
      .then(function(res){
        submit.disabled = false; submit.textContent = 'Create my affiliate link';
        if (!res.ok || !res.j || !res.j.ok) { errEl.textContent = (res.j && res.j.error) || 'Something went wrong. Try again.'; return; }
        document.getElementById('pt-link').value = res.j.link;
        document.getElementById('pt-code').textContent = res.j.code;
        document.getElementById('pt-dash').href = '/partners/dashboard?code=' + encodeURIComponent(res.j.code);
        resEl.classList.add('is-shown');
      }).catch(function(){ submit.disabled = false; submit.textContent = 'Create my affiliate link'; errEl.textContent = 'Network error. Try again.'; });
  });
  var copy = document.getElementById('pt-copy');
  if (copy) copy.addEventListener('click', function(){
    var inp = document.getElementById('pt-link'); inp.select();
    var done = function(){ copy.textContent = 'Copied ✓'; setTimeout(function(){ copy.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, function(){ try{document.execCommand('copy');}catch(_e){} done(); });
    else { try{document.execCommand('copy');}catch(_e){} done(); }
  });
})();`;

// ── /partners/terms ─────────────────────────────────────────────────────────
export function renderPartnersTerms(): string {
  const body = `
  <section class="pt-hero">
    <span class="pt-eyebrow">Legal</span>
    <h1>Partner program terms</h1>
    <p class="lead">The rules for the QuoteFleet referral and affiliate programs. Plain-English, effective for all participants.</p>
  </section>
  <main class="pt-shell">
    <div class="pt-terms">
      <h2>1. Referral program (for customers)</h2>
      <p>Every QuoteFleet customer has a unique referral link. When someone signs up through your link and becomes a paying subscriber:</p>
      <ul>
        <li><strong>You (the referrer)</strong> receive an account credit equal to <strong>${REFERRER_FREE_MONTHS} free month</strong> of your current subscription for each referred customer who becomes and remains paying.</li>
        <li><strong>The person you referred</strong> receives an extended <strong>${REFEREE_TRIAL_DAYS}-day free trial</strong> (instead of the standard 14 days) and <strong>${pct(REFEREE_DISCOUNT_PCT)} off their first ${REFEREE_DISCOUNT_MONTHS} months</strong>.</li>
      </ul>
      <p>Credits are applied to your account after the referred customer&#8217;s first successful payment. Self-referrals (referring your own additional accounts) do not qualify.</p>

      <h2>2. Affiliate program (for marketers &amp; creators)</h2>
      <h3>Commission</h3>
      <ul>
        <li><strong>Base rate:</strong> ${pct(AFFILIATE_BASE_RATE)} recurring commission on the subscription revenue of each customer you refer, for as long as they remain a paying customer.</li>
        <li><strong>Pro rate:</strong> once you have ${AFFILIATE_PRO_THRESHOLD} or more active referred customers, your rate increases to ${pct(AFFILIATE_PRO_RATE)} recurring for the following ${AFFILIATE_PRO_DURATION_MONTHS} months.</li>
        <li><strong>Partner rate:</strong> top-performing affiliates may be offered a negotiated lifetime rate of ${pct(AFFILIATE_PARTNER_RATE)} or more at QuoteFleet&#8217;s discretion.</li>
      </ul>
      <h3>Attribution</h3>
      <p>Referrals are tracked with a <strong>${REF_COOKIE_DAYS}-day cookie</strong>. If a visitor arrives through your link and signs up within ${REF_COOKIE_DAYS} days, the referral is credited to you. Where multiple affiliates are involved, the most recent link click wins (last-touch attribution).</p>
      <h3>Payouts</h3>
      <ul>
        <li>Commissions are calculated and paid <strong>monthly</strong>.</li>
        <li>A minimum balance of <strong>${money(AFFILIATE_MIN_PAYOUT_CENTS)}</strong> is required to trigger a payout; balances below the minimum roll over to the next month.</li>
        <li>Commissions become payable after the referred customer&#8217;s payment clears and any refund window has passed. Refunded or charged-back payments are deducted.</li>
      </ul>
      <h3>Prohibited methods</h3>
      <p>The following will void commissions and may result in removal from the program:</p>
      <ul>
        <li>Bidding on QuoteFleet trademarks in paid search, or impersonating QuoteFleet.</li>
        <li>Spam, unsolicited bulk email, or misleading advertising.</li>
        <li>Self-referrals, cookie-stuffing, or any artificial inflation of clicks or signups.</li>
        <li>Offering unauthorized cash rebates or incentives that misrepresent the product.</li>
        <li>Referring fraudulent, fake, or non-genuine accounts.</li>
      </ul>

      <h2>3. General</h2>
      <p>QuoteFleet may update these terms, adjust rates, or end either program with reasonable notice. Participation does not create an employment, agency, or partnership relationship. Questions? Email <a href="mailto:partners@quotefleet.net">partners@quotefleet.net</a>.</p>
      <p class="pt-muted">Ready to start? <a href="/partners">Join the program &rarr;</a></p>
    </div>
  </main>`;

  return renderMarketingShell({
    title: 'QuoteFleet Partner Program Terms',
    description:
      'Full terms for the QuoteFleet referral and affiliate programs: rewards, commission tiers, 90-day cookie attribution, monthly payouts, minimum payout and prohibited methods.',
    canonicalPath: '/partners/terms',
    bodyHtml: body,
    headStyles: PARTNERS_CSS,
  });
}

// ── /partners/dashboard ─────────────────────────────────────────────────────
export function renderAffiliateDashboard(d: AffiliateDashboard): string {
  const p = d.tier;
  const progressPct =
    p.nextTier && p.tier === 'base'
      ? Math.min(100, Math.round((p.activeReferredCustomers / AFFILIATE_PRO_THRESHOLD) * 100))
      : 100;
  const nextLine =
    p.tier === 'base'
      ? `${p.toNextTier} more active customer${p.toNextTier === 1 ? '' : 's'} to reach <strong>Pro (${pct(AFFILIATE_PRO_RATE)})</strong>.`
      : p.tier === 'pro'
        ? `You&#8217;re at <strong>Pro (${pct(AFFILIATE_PRO_RATE)})</strong>. Keep going for a Partner rate.`
        : `You&#8217;re a <strong>Partner</strong> at ${pct(d.affiliate.commissionRate)}.`;

  const statusBadge = esc(d.affiliate.status);

  const body = `
  <section class="pt-hero">
    <span class="pt-eyebrow">Affiliate dashboard</span>
    <h1>Your partner performance</h1>
    <p class="lead">Status: <strong>${statusBadge}</strong> &middot; current rate: <strong>${pct(d.affiliate.commissionRate)}</strong> (${esc(d.affiliate.tier)} tier)</p>
  </section>
  <main class="pt-shell">
    <div class="pt-card" style="max-width:640px;">
      <p class="pt-kicker">Your referral link</p>
      <div class="pt-linkbox">
        <input type="text" id="pt-link" readonly value="${esc(d.affiliate.link)}">
        <button type="button" class="btn btn-secondary pt-copy" id="pt-copy">Copy</button>
      </div>
      <p class="pt-muted" style="margin-top:8px;">Code: <strong>${esc(d.affiliate.code)}</strong>. Share this link anywhere &mdash; every signup within ${REF_COOKIE_DAYS} days is credited to you.</p>
    </div>

    <div class="pt-stats">
      <div class="pt-stat"><div class="pt-stat-n">${d.stats.clicks.toLocaleString('en-US')}</div><div class="pt-stat-l">Link clicks</div></div>
      <div class="pt-stat"><div class="pt-stat-n">${d.stats.signups.toLocaleString('en-US')}</div><div class="pt-stat-l">Signups</div></div>
      <div class="pt-stat"><div class="pt-stat-n">${d.stats.convertedCustomers.toLocaleString('en-US')}</div><div class="pt-stat-l">Paying customers</div></div>
      <div class="pt-stat"><div class="pt-stat-n">${money(d.earnings.estimatedMonthlyCents)}</div><div class="pt-stat-l">Est. monthly earnings</div></div>
    </div>

    <div class="pt-section">
      <h2>Tier progress</h2>
      <div class="pt-card" style="max-width:640px;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span class="pt-tier-name">${esc(p.tier)} tier &middot; ${pct(d.affiliate.commissionRate)}</span>
          <span class="pt-muted">${p.activeReferredCustomers} active customer${p.activeReferredCustomers === 1 ? '' : 's'}</span>
        </div>
        <div class="pt-progress"><span style="width:${progressPct}%;"></span></div>
        <p class="pt-muted" style="margin-top:12px;">${nextLine}</p>
      </div>
    </div>

    <div class="pt-section">
      <h2>Payouts</h2>
      <div class="pt-stats" style="grid-template-columns:repeat(3,1fr);">
        <div class="pt-stat"><div class="pt-stat-n">${money(d.earnings.pendingCents)}</div><div class="pt-stat-l">Pending</div></div>
        <div class="pt-stat"><div class="pt-stat-n">${money(d.earnings.approvedCents)}</div><div class="pt-stat-l">Approved</div></div>
        <div class="pt-stat"><div class="pt-stat-n">${money(d.earnings.paidCents)}</div><div class="pt-stat-l">Paid out</div></div>
      </div>
      <p class="pt-muted" style="margin-top:16px;">Payouts run monthly once your balance reaches ${money(AFFILIATE_MIN_PAYOUT_CENTS)}. Commission accrual and payouts are being rolled out &mdash; your clicks and signups are tracked now and will be reconciled into earnings automatically.</p>
      <p class="pt-muted">See the full <a href="/partners/terms">program terms</a>.</p>
    </div>
  </main>
  <script>${DASH_COPY_SCRIPT}</script>`;

  return renderMarketingShell({
    title: 'Affiliate dashboard — QuoteFleet Partners',
    description: 'Your QuoteFleet affiliate stats: clicks, signups, conversions, tier progress and payout status.',
    canonicalPath: '/partners/dashboard',
    bodyHtml: body,
    headStyles: PARTNERS_CSS,
  });
}

const DASH_COPY_SCRIPT = `
(function(){
  var copy = document.getElementById('pt-copy');
  if (!copy) return;
  copy.addEventListener('click', function(){
    var inp = document.getElementById('pt-link'); inp.select();
    var done = function(){ copy.textContent = 'Copied ✓'; setTimeout(function(){ copy.textContent = 'Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(done, function(){ try{document.execCommand('copy');}catch(_e){} done(); });
    else { try{document.execCommand('copy');}catch(_e){} done(); }
  });
})();`;

// ── /partners/dashboard — not-found / gate ──────────────────────────────────
export function renderDashboardGate(message: string): string {
  const body = `
  <section class="pt-hero">
    <span class="pt-eyebrow">Affiliate dashboard</span>
    <h1>Find your dashboard</h1>
    <p class="lead">${esc(message)}</p>
  </section>
  <main class="pt-shell">
    <form class="pt-signup" method="get" action="/partners/dashboard">
      <div class="pt-field">
        <label for="pt-code-in">Your affiliate code</label>
        <input type="text" id="pt-code-in" name="code" required placeholder="e.g. ABCD2345" autocapitalize="characters">
      </div>
      <button type="submit" class="btn btn-primary">Open dashboard</button>
      <p class="pt-muted" style="margin-top:16px;">Don&#8217;t have a code yet? <a href="/partners">Join the affiliate program &rarr;</a></p>
    </form>
  </main>`;
  return renderMarketingShell({
    title: 'Affiliate dashboard — QuoteFleet Partners',
    description: 'Enter your QuoteFleet affiliate code to view your partner dashboard.',
    canonicalPath: '/partners/dashboard',
    bodyHtml: body,
    headStyles: PARTNERS_CSS,
  });
}
