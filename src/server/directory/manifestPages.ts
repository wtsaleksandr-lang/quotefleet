/**
 * Manifest Privacy — server-rendered pages (rendered via layout() with inline
 * `.mcp-*` scoped CSS using QF theme tokens, exactly like IMPORTERS_CSS, so the
 * public-dir spacing/color guards never scan them). Left-aligned headers,
 * title-in-field inputs, theme-aware, mobile-375.
 *
 *   GET /privacy            → renderPrivacyLanding  (marketing + tiers + CTA)
 *   GET /privacy/apply[...]  → renderPrivacyApply    (stepped onboarding flow)
 *   GET /admin/privacy       → renderAdminPrivacyQueue (super-admin filing queue)
 *
 * HONEST-CLAIMS enforced in copy throughout:
 *   • "We prepare and submit your request to CBP on your behalf" — never an automated CBP API claim.
 *   • Status vocabulary Draft → Signed → Submitted → Confirmed → Active → Renewal
 *     due; never "Hidden/Protected" before CBP confirms.
 *   • Redaction described as "Hidden on QuoteFleet" (≠ removal from the CBP feed).
 *   • Uploaded docs are "on file" / "self-reported" — never "Verified".
 */
import { layout, esc } from './pages.js';
import {
  MANIFEST_TIERS,
  manifestTierPurchasable,
  tierMeta,
  type ManifestTierMeta,
  type ManifestIdentity,
} from './manifestEntitlement.js';
import type { PoaApplication, PoaAuditEvent, PoaStatus } from '../../db/schema.js';

const SITE = 'https://quotefleet.net';

// ── shared scoped CSS (QF tokens only — no raw colors) ───────────────────────
const MCP_CSS = `
.mcp-wrap{max-width:920px;margin:0 auto;padding:28px 20px 64px}
.mcp-wrap.mcp-narrow{max-width:760px}
.mcp-back{display:inline-block;color:var(--muted);text-decoration:none;font-size:13px;margin:0 0 14px}
.mcp-back:hover{color:var(--ink)}
.mcp-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:0 0 8px}
.mcp-h1{font-size:30px;line-height:1.12;margin:0 0 10px;color:var(--ink);letter-spacing:-.02em}
.mcp-sub{font-size:15px;color:var(--muted);line-height:1.55;margin:0 0 8px;max-width:60ch}
.mcp-honest{font-size:12.5px;color:var(--muted);line-height:1.5;margin:14px 0 0;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.mcp-honest b{color:var(--ink-soft)}
.mcp-card{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:22px;margin:18px 0}
.mcp-card h2{font-size:18px;margin:0 0 4px;color:var(--ink)}
.mcp-card .mcp-steplead{font-size:13px;color:var(--muted);margin:0 0 16px;line-height:1.5}
/* stepper */
.mcp-steps{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}
.mcp-step{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted);padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--surface)}
.mcp-step .n{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--border);color:var(--ink);font-size:11px;font-weight:700}
.mcp-step.active{border-color:var(--accent);color:var(--ink)}
.mcp-step.active .n{background:var(--accent);color:var(--bg)}
.mcp-step.done .n{background:var(--accent);color:var(--bg)}
/* fields: title-in-field / placeholder-as-label */
.mcp-field{display:flex;flex-direction:column;margin:0 0 14px}
.mcp-field label{font-size:11px;font-weight:600;color:var(--muted);margin:0 0 4px;text-align:left}
.mcp-field input,.mcp-field select,.mcp-field textarea{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--border-strong);border-radius:9px;background:var(--bg);color:var(--ink);font-size:14px;font-family:inherit;min-height:44px}
.mcp-field textarea{min-height:74px;resize:vertical}
.mcp-field input:focus,.mcp-field select:focus,.mcp-field textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.mcp-grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
@media (max-width:560px){.mcp-grid2{grid-template-columns:1fr}}
.mcp-hint{font-size:12px;color:var(--muted);margin:2px 0 0;line-height:1.45}
/* chips */
.mcp-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}
.mcp-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid var(--border-strong);border-radius:999px;background:var(--bg);font-size:13px;color:var(--ink)}
.mcp-chip button{border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1;padding:0}
.mcp-chip button:hover{color:var(--ink)}
.mcp-chipadd{display:flex;gap:8px;margin:10px 0 0}
.mcp-chipadd input{flex:1}
/* consent + signature */
.mcp-consent{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--ink-soft);line-height:1.5;margin:0 0 12px}
.mcp-consent input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}
.mcp-disclosure{font-size:12px;color:var(--muted);line-height:1.55;border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:12px 14px;max-height:180px;overflow:auto;margin:0 0 14px}
.mcp-sig{border:1px dashed var(--border-strong);border-radius:10px;background:var(--bg);touch-action:none;width:100%;height:120px;display:block}
.mcp-sigrow{display:flex;justify-content:space-between;align-items:center;margin:6px 0 0;font-size:12px;color:var(--muted)}
.mcp-linkbtn{border:0;background:transparent;color:var(--accent);cursor:pointer;font-size:12px;font-weight:600;padding:0}
/* buttons */
.mcp-actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 0}
.mcp-btn{display:inline-flex;align-items:center;gap:7px;border-radius:9px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;min-height:46px;box-sizing:border-box;border:1px solid var(--border-strong);background:var(--surface);color:var(--ink)}
.mcp-btn.primary{background:var(--accent);color:var(--bg);border-color:var(--accent)}
.mcp-btn:disabled{opacity:.55;cursor:not-allowed}
.mcp-msg{font-size:13px;margin:12px 0 0;min-height:18px}
.mcp-msg.err{color:var(--danger,#b42318)}
.mcp-msg.ok{color:var(--accent)}
/* plan cards */
.mcp-plans{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:6px 0 0}
@media (max-width:760px){.mcp-plans{grid-template-columns:1fr}}
.mcp-plan{border:1px solid var(--border);border-radius:14px;background:var(--bg);padding:18px;display:flex;flex-direction:column}
.mcp-plan.feat{border-color:var(--accent)}
.mcp-plan h3{font-size:16px;margin:0 0 2px;color:var(--ink)}
.mcp-plan .price{font-size:26px;font-weight:800;color:var(--ink);letter-spacing:-.02em;margin:2px 0 2px}
.mcp-plan .price span{font-size:13px;font-weight:600;color:var(--muted)}
.mcp-plan ul{list-style:none;padding:0;margin:12px 0 16px;display:flex;flex-direction:column;gap:8px}
.mcp-plan li{font-size:12.5px;color:var(--ink-soft);line-height:1.4;padding-left:18px;position:relative}
.mcp-plan li:before{content:"\\2713";position:absolute;left:0;color:var(--accent);font-weight:700}
.mcp-plan .mcp-btn{width:100%;justify-content:center;margin-top:auto}
.mcp-soon{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
/* status timeline */
.mcp-timeline{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:2px}
.mcp-tl{display:flex;gap:12px;align-items:flex-start;padding:10px 0}
.mcp-tl .dot{flex:0 0 auto;width:14px;height:14px;border-radius:50%;border:2px solid var(--border-strong);background:var(--bg);margin-top:2px}
.mcp-tl.done .dot{background:var(--accent);border-color:var(--accent)}
.mcp-tl.cur .dot{border-color:var(--accent)}
.mcp-tl .tl-t{font-size:13.5px;font-weight:600;color:var(--ink)}
.mcp-tl.pending .tl-t{color:var(--muted);font-weight:500}
.mcp-tl .tl-d{font-size:12px;color:var(--muted);line-height:1.45;margin-top:2px}
.mcp-badge{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:5px;background:var(--surface);color:var(--ink-soft);border:1px solid var(--border-strong)}
.mcp-badge.on{background:var(--accent);color:var(--bg);border-color:var(--accent)}
/* admin table */
.mcp-tbl-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:12px;margin:16px 0 0}
.mcp-tbl{width:100%;border-collapse:collapse;font-size:13px}
.mcp-tbl th,.mcp-tbl td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top;white-space:nowrap}
.mcp-tbl th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:var(--surface)}
.mcp-tbl tr:last-child td{border-bottom:0}
.mcp-mono{font-family:var(--font-mono,'JetBrains Mono',monospace);font-size:11px;color:var(--muted);word-break:break-all;white-space:normal;max-width:220px}
.mcp-varlist{white-space:normal;max-width:260px;font-size:12px;color:var(--ink-soft)}
`;

/** Human status label — the honest vocabulary. */
export function statusLabel(status: PoaStatus | string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'signed':
      return 'Signed';
    case 'submitted':
      return 'Submitted to CBP';
    case 'confirmed':
      return 'Confirmed by CBP';
    case 'active':
      return 'Active — hidden on QuoteFleet';
    case 'renewal_due':
      return 'Renewal due';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    default:
      return String(status);
  }
}

function planCard(t: ManifestTierMeta, ctx: 'landing' | 'flow'): string {
  const purchasable = manifestTierPurchasable(t.tier);
  const feat = t.tier === 'professional' ? ' feat' : '';
  const btn = purchasable
    ? ctx === 'flow'
      ? `<button type="button" class="mcp-btn primary" data-plan="${t.tier}">Choose ${esc(t.name)}</button>`
      : `<a class="mcp-btn primary" href="/privacy/apply">Get started <span class="arr">&rarr;</span></a>`
    : `<button type="button" class="mcp-btn" disabled aria-disabled="true"><span class="mcp-soon">Coming soon</span></button>`;
  return `<div class="mcp-plan${feat}">
    <h3>${esc(t.name)}</h3>
    <div class="price">$${t.priceUsd}<span> / year</span></div>
    <ul>${t.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    ${btn}
  </div>`;
}

/** The ESIGN consent disclosure text (the version stamped on each signed POA). */
export const DISCLOSURE_TEXT =
  'By checking the box and signing below, you agree to use an electronic signature and to receive ' +
  'this Limited Power of Attorney and related records electronically, under the ESIGN Act ' +
  '(15 U.S.C. §7001) and UETA. You confirm you are authorized to execute this authorization on behalf ' +
  'of the named business. This authorization is LIMITED to preparing, submitting, maintaining, and ' +
  'renewing a U.S. Customs vessel manifest confidentiality request (19 CFR 103.31(d)) on your behalf ' +
  '— it grants no other customs authority. QuoteFleet prepares and submits this request to CBP on your ' +
  'behalf; QuoteFleet is not CBP and has no automated filing connection to CBP. Hiding your data on QuoteFleet is not ' +
  'the same as removal from CBP’s public manifest feed — the CBP filing is what removes your future ' +
  'shipments from third-party trackers. You may revoke this authorization in writing at any time.';

// ── the marketing / landing page ─────────────────────────────────────────────
export function renderPrivacyLanding(): string {
  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap">
    <p class="mcp-eyebrow">Manifest Privacy</p>
    <h1 class="mcp-h1">Hide your shipment data from competitors</h1>
    <p class="mcp-sub">Your ocean imports are public in U.S. Customs vessel-manifest data — visible to competitors on trackers like ImportYeti and Panjiva. Manifest Privacy prepares and submits a confidentiality request to CBP on your behalf, and hides your company on QuoteFleet.</p>
    <p class="mcp-sub">CBP protection lasts 2 years and CBP won’t remind you when it lapses — we watch the clock and refile before it expires, so your data never quietly goes public again.</p>
    <div class="mcp-actions">
      <a class="mcp-btn primary" href="/privacy/apply">Start my request <span class="arr">&rarr;</span></a>
      <a class="mcp-btn" href="/importers">Find my company first</a>
    </div>

    <div class="mcp-card">
      <h2>How it works</h2>
      <p class="mcp-steplead">Fully online — build it, sign it, and we handle the filing.</p>
      <ul class="mcp-timeline">
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">1. Tell us who to protect</div><div class="tl-d">Your legal entity plus every name and address variation on your bills of lading.</div></div></li>
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">2. E-sign a limited authorization</div><div class="tl-d">A scope-restricted Power of Attorney for the confidentiality filing only — signed online (ESIGN/UETA).</div></div></li>
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">3. We prepare &amp; submit to CBP on your behalf</div><div class="tl-d">A human specialist files your request through CBP’s official channels — we do the filing for you.</div></div></li>
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">4. Confirmed &amp; tracked for 2 years</div><div class="tl-d">Once CBP confirms, we hide you on QuoteFleet and track your 2-year renewal so protection never lapses.</div></div></li>
      </ul>
    </div>

    <div class="mcp-card">
      <h2>Plans</h2>
      <p class="mcp-steplead">Annual — includes managed filing and 2-year renewal tracking.</p>
      <div class="mcp-plans">
        ${MANIFEST_TIERS.map((t) => planCard(t, 'landing')).join('')}
      </div>
    </div>

    <p class="mcp-honest"><b>How we describe this, honestly:</b> We prepare and submit your request to CBP on your behalf — QuoteFleet is not CBP and has no automated filing connection to it. Being “Hidden on QuoteFleet” is not the same as removal from CBP’s feed; the CBP filing is what removes your future shipments from third-party trackers (it is not retroactive). Uploaded documents are kept on file and treated as self-reported, not as an independent verification.</p>
  </main>`;
  return layout({
    title: 'Manifest Privacy — Hide Your Shipment Data | QuoteFleet',
    description:
      'Managed U.S. Customs vessel manifest confidentiality (19 CFR 103.31(d)). We prepare and submit your CBP confidentiality request on your behalf and hide your company on QuoteFleet. Annual plans from $79.',
    canonicalPath: '/manifest-privacy',
    bodyHtml: body,
  });
}

/** JSON-safe embed of the current application state for the client flow. */
function appState(
  app: PoaApplication | null,
  prefill: { slug?: string; name?: string },
  isSubscriber: boolean,
): string {
  const s = app
    ? {
        isSubscriber,
        token: app.publicToken,
        status: app.status,
        grantorLegalName: app.grantorLegalName ?? '',
        entityType: app.entityType ?? '',
        stateOfOrg: app.stateOfOrg ?? '',
        grantorAddress: app.grantorAddress ?? '',
        einOrImporterNo: app.einOrImporterNo ?? '',
        nameVariations: app.nameVariations ?? [],
        addressVariations: app.addressVariations ?? [],
        importerSlug: app.importerSlug ?? (prefill.slug ?? ''),
        signerName: app.signerName ?? '',
        signerTitle: app.signerTitle ?? '',
        signerEmail: app.signerEmail ?? '',
        docSha256: app.docSha256 ?? '',
      }
    : {
        isSubscriber,
        token: '',
        status: 'draft',
        grantorLegalName: prefill.name ?? '',
        entityType: '',
        stateOfOrg: '',
        grantorAddress: '',
        einOrImporterNo: '',
        nameVariations: prefill.name ? [prefill.name] : [],
        addressVariations: [],
        importerSlug: prefill.slug ?? '',
        signerName: '',
        signerTitle: '',
        signerEmail: '',
        docSha256: '',
      };
  return JSON.stringify(s).replace(/</g, '\\u003c');
}

// ── the stepped onboarding flow ──────────────────────────────────────────────
export function renderPrivacyApply(opts: {
  app: PoaApplication | null;
  prefill: { slug?: string; name?: string };
  isSubscriber?: boolean;
}): string {
  const { app, prefill } = opts;
  const isSubscriber = opts.isSubscriber ?? false;
  const steps = ['Your business', 'What to protect', 'Authorize & e-sign', 'Plan', 'Done'];
  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap mcp-narrow">
    <a class="mcp-back" href="/manifest-privacy">&larr; Manifest Privacy</a>
    <p class="mcp-eyebrow">Manifest Privacy</p>
    <h1 class="mcp-h1">Hide my shipment data</h1>
    <p class="mcp-sub">Fully online. Build your request, sign it, and we prepare and submit it to U.S. Customs on your behalf.</p>

    <div class="mcp-steps" id="mcp-stepper">
      ${steps.map((s, i) => `<div class="mcp-step${i === 0 ? ' active' : ''}" data-step="${i}"><span class="n">${i + 1}</span>${esc(s)}</div>`).join('')}
    </div>

    <!-- Step 1 -->
    <section class="mcp-card" data-panel="0">
      <h2>Your business</h2>
      <p class="mcp-steplead">The legal entity to protect. This becomes the Principal on the authorization.</p>
      <div class="mcp-field"><label for="f-legal">Legal business name</label><input id="f-legal" type="text" placeholder="Acme Imports LLC" autocomplete="organization"></div>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-entity">Entity type</label>
          <select id="f-entity">
            <option value="">Select…</option>
            <option>Limited Liability Company (LLC)</option>
            <option>Corporation</option>
            <option>S-Corporation</option>
            <option>Partnership</option>
            <option>Sole Proprietorship</option>
            <option>Other</option>
          </select>
        </div>
        <div class="mcp-field"><label for="f-state">State / country of organization</label><input id="f-state" type="text" placeholder="Delaware"></div>
      </div>
      <div class="mcp-field"><label for="f-addr">Principal business address</label><textarea id="f-addr" placeholder="123 Harbor Way, Long Beach, CA 90802"></textarea></div>
      <div class="mcp-field"><label for="f-ein">EIN / Importer number</label><input id="f-ein" type="text" placeholder="12-3456789" autocomplete="off"><p class="mcp-hint">Used only on your CBP confidentiality request.</p></div>
      <div class="mcp-actions"><button type="button" class="mcp-btn primary" data-next="1">Continue <span class="arr">&rarr;</span></button></div>
      <p class="mcp-msg" data-msg="0"></p>
    </section>

    <!-- Step 2 -->
    <section class="mcp-card" data-panel="1" hidden>
      <h2>What to protect</h2>
      <p class="mcp-steplead">Add every name and address variation that appears on your bills of lading — misspellings, abbreviations, DBAs, and former names. The more variations, the more complete your protection.</p>
      <div class="mcp-field"><label>Name variations</label>
        <div class="mcp-chips" data-chips="name"></div>
        <div class="mcp-chipadd"><input type="text" data-chipinput="name" placeholder="Add a name variation" maxlength="120"><button type="button" class="mcp-btn" data-chipadd="name">Add</button></div>
      </div>
      <div class="mcp-field"><label>Address variations (optional)</label>
        <div class="mcp-chips" data-chips="address"></div>
        <div class="mcp-chipadd"><input type="text" data-chipinput="address" placeholder="Add an address variation" maxlength="160"><button type="button" class="mcp-btn" data-chipadd="address">Add</button></div>
      </div>
      <div class="mcp-actions"><button type="button" class="mcp-btn" data-prev="0">Back</button><button type="button" class="mcp-btn primary" data-next="2">Continue <span class="arr">&rarr;</span></button></div>
      <p class="mcp-msg" data-msg="1"></p>
    </section>

    <!-- Step 3 -->
    <section class="mcp-card" data-panel="2" hidden>
      <h2>Authorize &amp; e-sign</h2>
      <p class="mcp-steplead">Sign a LIMITED Power of Attorney authorizing QuoteFleet to prepare and submit your confidentiality request to CBP on your behalf — for that filing only.</p>
      <div class="mcp-disclosure" id="mcp-disclosure">${esc(DISCLOSURE_TEXT)}</div>
      <label class="mcp-consent"><input type="checkbox" id="f-consent"> <span>I have read the authorization and disclosure above, I agree to sign electronically (ESIGN/UETA), and I certify I am authorized to sign on behalf of this business.</span></label>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-signer">Your full name (typed signature)</label><input id="f-signer" type="text" placeholder="Jane Doe" autocomplete="name"></div>
        <div class="mcp-field"><label for="f-title">Your title / capacity</label><input id="f-title" type="text" placeholder="Owner / CFO"></div>
      </div>
      <div class="mcp-field"><label for="f-email">Your email (for your signed copy)</label><input id="f-email" type="email" placeholder="jane@acme.com" autocomplete="email"></div>
      <div class="mcp-field"><label>Draw your signature <span style="font-weight:500;color:var(--muted)">(optional)</span></label>
        <canvas class="mcp-sig" id="f-sig" width="600" height="120" aria-label="Signature pad (optional)"></canvas>
        <div class="mcp-sigrow"><span>Optional — your typed name above is your legal signature (ESIGN/UETA). Draw here only if you prefer.</span><button type="button" class="mcp-linkbtn" id="f-sig-clear">Clear</button></div>
      </div>
      <p class="mcp-hint">On signing we generate your PDF, record a tamper-evident SHA-256 and an audit trail (time, IP), and email you a copy. This template is a DRAFT pending attorney review before live use.</p>
      <div class="mcp-actions"><button type="button" class="mcp-btn" data-prev="1">Back</button><button type="button" class="mcp-btn primary" id="mcp-sign">Sign &amp; continue <span class="arr">&rarr;</span></button></div>
      <p class="mcp-msg" data-msg="2"></p>
    </section>

    <!-- Step 4 -->
    <section class="mcp-card" data-panel="3" hidden>
      <h2>Choose your plan</h2>
      <p class="mcp-steplead">Managed filing plus 2-year renewal tracking. Your signed authorization is saved — pick a plan to have us submit it to CBP.</p>
      <div class="mcp-plans">${MANIFEST_TIERS.map((t) => planCard(t, 'flow')).join('')}</div>
      <div class="mcp-actions"><button type="button" class="mcp-btn" data-prev="2">Back</button><button type="button" class="mcp-btn" data-next="4">I’ll decide later</button></div>
      <p class="mcp-msg" data-msg="3"></p>
    </section>

    <!-- Step 5 -->
    <section class="mcp-card" data-panel="4" hidden>
      <h2>You’re set</h2>
      <p class="mcp-steplead" id="mcp-done-lead">Your authorization is signed and saved.</p>
      <ul class="mcp-timeline" id="mcp-done-timeline"></ul>
      <div class="mcp-actions">
        <a class="mcp-btn primary" id="mcp-dl" href="#" target="_blank" rel="noopener">Download signed PDF</a>
        <a class="mcp-btn" id="mcp-account-link" href="/privacy/account">View my account</a>
        <a class="mcp-btn" href="/manifest-privacy">Done</a>
      </div>
      <p class="mcp-honest" id="mcp-done-next"><b>What happens next:</b> We prepare and submit your request to CBP on your behalf (a human files it through CBP’s official channels). Your status stays honest — you’ll see Submitted, then Confirmed, then Active. We’ll track your 2-year renewal and refile before it lapses.</p>
      <p class="mcp-msg" data-msg="4"></p>
    </section>
  </main>
  <script>window.__MCP_STATE=${appState(app, prefill, isSubscriber)};</script>
  <script>${FLOW_JS}</script>`;
  return layout({
    title: 'Hide My Shipment Data — Manifest Privacy | QuoteFleet',
    description:
      'Build and e-sign your U.S. Customs vessel manifest confidentiality request online. We prepare and submit it to CBP on your behalf and hide your company on QuoteFleet.',
    canonicalPath: '/privacy/apply',
    bodyHtml: body,
  });
}

// ── client JS for the flow (autosave + chips + signature + sign + checkout) ──
const FLOW_JS = `
(function(){
  var S = window.__MCP_STATE || {};
  function $(sel,root){return (root||document).querySelector(sel);}
  function $all(sel,root){return [].slice.call((root||document).querySelectorAll(sel));}
  function api(method,url,body){
    return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,body:j};}).catch(function(){return {ok:r.ok,status:r.status,body:{}};});});
  }
  function msg(step,text,kind){var m=$('[data-msg="'+step+'"]');if(m){m.textContent=text||'';m.className='mcp-msg'+(kind?' '+kind:'');}}

  // ---- fields <-> state ----
  var F={legal:'#f-legal',entity:'#f-entity',state:'#f-state',addr:'#f-addr',ein:'#f-ein',signer:'#f-signer',title:'#f-title',email:'#f-email'};
  var MAP={legal:'grantorLegalName',entity:'entityType',state:'stateOfOrg',addr:'grantorAddress',ein:'einOrImporterNo',signer:'signerName',title:'signerTitle',email:'signerEmail'};
  Object.keys(F).forEach(function(k){var el=$(F[k]);if(el&&S[MAP[k]])el.value=S[MAP[k]];});

  function collect(){
    Object.keys(F).forEach(function(k){var el=$(F[k]);if(el)S[MAP[k]]=el.value.trim();});
    S.nameVariations=chips.name.slice();S.addressVariations=chips.address.slice();
    return S;
  }
  function payload(){return {grantorLegalName:S.grantorLegalName,entityType:S.entityType,stateOfOrg:S.stateOfOrg,grantorAddress:S.grantorAddress,einOrImporterNo:S.einOrImporterNo,nameVariations:S.nameVariations,addressVariations:S.addressVariations,importerSlug:S.importerSlug,signerName:S.signerName,signerTitle:S.signerTitle,signerEmail:S.signerEmail};}

  function ensureDraft(){
    if(S.token)return Promise.resolve(S.token);
    return api('POST','/api/privacy/application',payload()).then(function(r){if(r.ok&&r.body.token){S.token=r.body.token;var u=new URL(window.location.href);u.pathname='/privacy/apply/'+S.token;window.history.replaceState({},'',u.toString());return S.token;}throw new Error(r.body.error||'Could not start');});
  }
  function save(){collect();if(!S.token)return ensureDraft();return api('PATCH','/api/privacy/application/'+S.token,payload()).then(function(){return S.token;});}

  // ---- chips ----
  var chips={name:(S.nameVariations||[]).slice(),address:(S.addressVariations||[]).slice()};
  function renderChips(kind){
    var box=$('[data-chips="'+kind+'"]');if(!box)return;box.innerHTML='';
    chips[kind].forEach(function(v,i){var c=document.createElement('span');c.className='mcp-chip';c.appendChild(document.createTextNode(v));var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove');b.textContent='\\u00d7';b.addEventListener('click',function(){chips[kind].splice(i,1);renderChips(kind);save();});c.appendChild(b);box.appendChild(c);});
  }
  function addChip(kind){var inp=$('[data-chipinput="'+kind+'"]');if(!inp)return;var v=inp.value.trim();if(!v)return;if(chips[kind].indexOf(v)===-1){chips[kind].push(v);}inp.value='';renderChips(kind);save();}
  $all('[data-chipadd]').forEach(function(btn){btn.addEventListener('click',function(){addChip(btn.getAttribute('data-chipadd'));});});
  $all('[data-chipinput]').forEach(function(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();addChip(inp.getAttribute('data-chipinput'));}});});
  renderChips('name');renderChips('address');

  // ---- stepper ----
  var current=0;
  function show(step){
    current=step;
    $all('[data-panel]').forEach(function(p){p.hidden=(+p.getAttribute('data-panel')!==step);});
    $all('.mcp-step').forEach(function(s){var i=+s.getAttribute('data-step');s.classList.toggle('active',i===step);s.classList.toggle('done',i<step);});
    window.scrollTo({top:0,behavior:'smooth'});
  }
  $all('[data-next]').forEach(function(b){b.addEventListener('click',function(){var to=+b.getAttribute('data-next');collect();
    if(to===1&&!S.grantorLegalName){msg(0,'Enter your legal business name.','err');return;}
    save().then(function(){msg(current,'');show(to);}).catch(function(e){msg(current,e.message||'Save failed','err');});});});
  $all('[data-prev]').forEach(function(b){b.addEventListener('click',function(){show(+b.getAttribute('data-prev'));});});

  // ---- signature pad ----
  var canvas=$('#f-sig'),drawn=false;
  if(canvas){var ctx=canvas.getContext('2d'),drawing=false;
    function pos(e){var r=canvas.getBoundingClientRect();var t=e.touches?e.touches[0]:e;return {x:(t.clientX-r.left)*(canvas.width/r.width),y:(t.clientY-r.top)*(canvas.height/r.height)};}
    function start(e){drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);e.preventDefault();}
    function move(e){if(!drawing)return;var p=pos(e);ctx.lineTo(p.x,p.y);ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.lineCap='round';ctx.stroke();drawn=true;e.preventDefault();}
    function end(){drawing=false;}
    canvas.addEventListener('mousedown',start);canvas.addEventListener('mousemove',move);window.addEventListener('mouseup',end);
    canvas.addEventListener('touchstart',start,{passive:false});canvas.addEventListener('touchmove',move,{passive:false});canvas.addEventListener('touchend',end);
    var clr=$('#f-sig-clear');if(clr)clr.addEventListener('click',function(){ctx.clearRect(0,0,canvas.width,canvas.height);drawn=false;});
  }

  // ---- sign ----
  var signBtn=$('#mcp-sign');
  if(signBtn)signBtn.addEventListener('click',function(){
    collect();
    if(!$('#f-consent').checked){msg(2,'Please check the consent box to continue.','err');return;}
    if(!S.signerName){msg(2,'Type your full name as your signature.','err');return;}
    // The drawn signature is OPTIONAL — typed name + consent satisfies ESIGN/UETA
    // (keyboard/AT users can sign without a pointer). Include the canvas only if
    // the signer actually drew on it.
    signBtn.disabled=true;msg(2,'Signing…','');
    var sig=(drawn&&canvas)?canvas.toDataURL('image/png'):null;
    save().then(function(){return api('POST','/api/privacy/application/'+S.token+'/consent',{disclosureVersion:'shown'});})
      .then(function(){return api('POST','/api/privacy/application/'+S.token+'/sign',{signerName:S.signerName,signerTitle:S.signerTitle,signerEmail:S.signerEmail,signatureDrawnPng:sig});})
      .then(function(r){signBtn.disabled=false;if(!r.ok){throw new Error(r.body.error||'Could not sign');}
        S.status=r.body.status||'signed';S.docSha256=r.body.docSha256||'';renderDone();show(3);})
      .catch(function(e){signBtn.disabled=false;msg(2,e.message||'Could not sign','err');});
  });

  // ---- plan checkout ----
  $all('[data-plan]').forEach(function(b){b.addEventListener('click',function(){
    var tier=b.getAttribute('data-plan');b.disabled=true;msg(3,'Starting checkout…','');
    api('POST','/api/privacy/billing/checkout',{tier:tier,token:S.token}).then(function(r){
      b.disabled=false;
      if(r.ok&&r.body.url){window.location.href=r.body.url;return;}
      if(r.status===401){msg(3,'Please sign in or create a free account to subscribe.','err');window.location.href='/signup?next='+encodeURIComponent('/privacy/apply/'+(S.token||''));return;}
      if(r.body.comingSoon){msg(3,'This plan is coming soon — we’ll email you when checkout opens. Your signed authorization is saved.','ok');return;}
      msg(3,r.body.error||'Could not start checkout.','err');
    }).catch(function(){b.disabled=false;msg(3,'Could not start checkout.','err');});
  });});

  // ---- done timeline ----
  function renderDone(){
    var dl=$('#mcp-dl');if(dl&&S.token)dl.href='/api/privacy/application/'+S.token+'/pdf';
    // HONEST-CLAIMS: only a PAID subscriber is actually filed with CBP. An unpaid
    // signer ("I'll decide later") must NOT be told we submit to CBP — nothing is
    // submitted until they choose a plan.
    var nx=$('#mcp-done-next');
    if(nx){
      if(S.isSubscriber){
        nx.innerHTML='<b>What happens next:</b> We prepare and submit your request to CBP on your behalf (a human files it through CBP\\u2019s official channels). Your status stays honest \\u2014 you\\u2019ll see Submitted, then Confirmed, then Active. We\\u2019ll track your 2-year renewal and refile before it lapses.';
      }else{
        nx.innerHTML='<b>What happens next:</b> Your authorization is saved. Choose a plan and we\\u2019ll file it with CBP on your behalf \\u2014 until then nothing is submitted to CBP. You can pick a plan any time from your account.';
      }
    }
    var order=['signed','submitted','confirmed','active'];
    var labels={signed:['Signed',(S.docSha256?('Tamper-evident SHA-256 recorded: '+S.docSha256.slice(0,16)+'…'):'Your authorization is signed and saved.')],
      submitted:['Submitted to CBP','We prepare and submit your request to CBP on your behalf.'],
      confirmed:['Confirmed by CBP','CBP acknowledges receipt of your confidentiality request.'],
      active:['Active — hidden on QuoteFleet','You’re hidden on QuoteFleet and tracked for 2-year renewal.']};
    var idx=order.indexOf(S.status);if(idx<0)idx=0;
    var tl=$('#mcp-done-timeline');if(!tl)return;tl.innerHTML='';
    order.forEach(function(k,i){var li=document.createElement('li');li.className='mcp-tl '+(i<idx?'done':(i===idx?'cur':'pending'));
      li.innerHTML='<span class="dot"></span><div><div class="tl-t">'+labels[k][0]+'</div><div class="tl-d">'+labels[k][1]+'</div></div>';tl.appendChild(li);});
  }

  // resume: if already signed, jump ahead
  if(S.status&&S.status!=='draft'){renderDone();show(S.status==='signed'?3:4);}
})();
`.trim();

// ── admin filing queue / review page ─────────────────────────────────────────
const CBP_CERT_HINT =
  'Copy the CBP certification text, then file it through CBP’s Vessel Manifest Confidentiality Online ' +
  'Application (or the vesselmanifestconfidentiality@cbp.dhs.gov mailbox). There is no automated filing API — this is a human step.';

export function renderAdminPrivacyQueue(rows: Array<{ app: PoaApplication; events: PoaAuditEvent[] }>): string {
  const fmt = (d: Date | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—';

  const rowsHtml = rows.length
    ? rows
        .map(({ app, events }) => {
          const names = (app.nameVariations ?? []).join('; ') || app.grantorLegalName || '—';
          const audit = events
            .slice(0, 8)
            .map((e) => `${esc(e.event)} @ ${fmt(e.createdAt)}`)
            .join('<br>');
          const certText = buildCbpCertText(app);
          return `<tr>
      <td>
        <div><b>${esc(app.grantorLegalName || '—')}</b></div>
        <div class="mcp-mono">${esc(app.einOrImporterNo || 'EIN n/a')}</div>
        <div class="mcp-mono">token ${esc(app.publicToken)}</div>
      </td>
      <td><span class="mcp-badge${app.status === 'active' ? ' on' : ''}">${esc(statusLabel(app.status))}</span></td>
      <td class="mcp-varlist">${esc(names)}</td>
      <td>
        ${app.docSha256 ? `<div class="mcp-mono">${esc(app.docSha256)}</div>` : '<span class="mcp-mono">unsigned</span>'}
        ${app.docSha256 ? `<a class="mcp-linkbtn" href="/api/privacy/application/${esc(app.publicToken)}/pdf" target="_blank" rel="noopener">View PDF</a>` : ''}
      </td>
      <td class="mcp-mono">${audit || '—'}</td>
      <td>
        <button type="button" class="mcp-linkbtn" data-cert="${esc(app.publicToken)}">Copy CBP text</button>
        <textarea data-certtext="${esc(app.publicToken)}" hidden>${esc(certText)}</textarea>
        <div class="mcp-actions" style="margin-top:8px">
          <button type="button" class="mcp-btn" data-act="submit" data-id="${app.id}">Mark submitted</button>
          <button type="button" class="mcp-btn primary" data-act="confirm" data-id="${app.id}">Confirm + hide</button>
          <button type="button" class="mcp-btn" data-act="revoke" data-id="${app.id}">Revoke</button>
        </div>
      </td>
    </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" style="color:var(--muted)">No applications yet.</td></tr>`;

  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap">
    <p class="mcp-eyebrow">Admin · Manifest Privacy</p>
    <h1 class="mcp-h1">CBP filing queue</h1>
    <p class="mcp-sub">${esc(CBP_CERT_HINT)}</p>
    <div class="mcp-tbl-wrap">
      <table class="mcp-tbl">
        <thead><tr><th>Applicant</th><th>Status</th><th>Variations</th><th>Signed PDF · SHA-256</th><th>Audit trail</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="mcp-msg" id="mcp-admin-msg"></p>
  </main>
  <script>${ADMIN_JS}</script>`;
  return layout({
    title: 'Manifest Privacy — Admin Queue | QuoteFleet',
    description: 'Manifest Privacy admin filing queue.',
    canonicalPath: '/admin/privacy',
    bodyHtml: body,
  });
}

/** The plain-text certification an admin pastes into CBP's online application /
 *  mailbox. No automated filing API — this is the human filing step. */
export function buildCbpCertText(app: PoaApplication): string {
  const names = (app.nameVariations ?? []).length
    ? (app.nameVariations ?? []).join('; ')
    : app.grantorLegalName || '';
  const addrs = (app.addressVariations ?? []).length
    ? (app.addressVariations ?? []).join('; ')
    : app.grantorAddress || '';
  return [
    'Request for confidential treatment of vessel manifest data under 19 CFR 103.31(d).',
    `Importer / consignee: ${app.grantorLegalName || ''}`,
    `EIN / Importer number: ${app.einOrImporterNo || ''}`,
    `Name(s) to be kept confidential: ${names}`,
    `Address(es): ${addrs}`,
    'The undersigned certifies this request is made by the importer/consignee (or its authorized agent under a limited power of attorney on file).',
    `Authorized agent: QuoteFleet (agent). Signed authorization on file; document SHA-256: ${app.docSha256 || 'n/a'}.`,
  ].join('\n');
}

const ADMIN_JS = `
(function(){
  function msg(t,kind){var m=document.getElementById('mcp-admin-msg');if(m){m.textContent=t||'';m.className='mcp-msg'+(kind?' '+kind:'');}}
  [].slice.call(document.querySelectorAll('[data-cert]')).forEach(function(b){b.addEventListener('click',function(){
    var ta=document.querySelector('[data-certtext="'+b.getAttribute('data-cert')+'"]');if(!ta)return;
    ta.hidden=false;ta.select();try{document.execCommand('copy');msg('CBP certification text copied.','ok');}catch(e){msg('Select the text and copy manually.','err');}
    setTimeout(function(){ta.hidden=true;},50);
  });});
  [].slice.call(document.querySelectorAll('[data-act]')).forEach(function(b){b.addEventListener('click',function(){
    var act=b.getAttribute('data-act'),id=b.getAttribute('data-id');
    if(act==='confirm'&&!window.confirm('Confirm CBP receipt and hide this importer on QuoteFleet?'))return;
    if(act==='revoke'&&!window.confirm('Revoke this authorization?'))return;
    b.disabled=true;
    fetch('/api/admin/privacy/'+id+'/'+act,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:'{}'})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
      .then(function(r){b.disabled=false;if(r.ok){msg('Done — reloading…','ok');setTimeout(function(){location.reload();},600);}else{msg(r.body.error||'Action failed','err');}})
      .catch(function(){b.disabled=false;msg('Action failed','err');});
  });});
})();
`.trim();

// ── customer account portal ──────────────────────────────────────────────────
/** Format a date as "Aug 22, 2026" (or an em-dash when absent). */
function fmtDate(d: Date | null | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

/** The ordered protection lifecycle for the account timeline. */
const ACCOUNT_STAGES: ReadonlyArray<{ key: PoaStatus; label: string }> = [
  { key: 'draft', label: 'Draft' },
  { key: 'signed', label: 'Signed' },
  { key: 'submitted', label: 'Submitted to CBP' },
  { key: 'confirmed', label: 'Confirmed by CBP' },
  { key: 'active', label: 'Active — hidden on QuoteFleet' },
];

/** Render one entity's status timeline (Draft→Signed→Submitted→Confirmed→Active,
 *  plus a Renewal-due note). Honest vocabulary; never claims "hidden" pre-confirm. */
function accountTimeline(app: PoaApplication): string {
  const isRevoked = app.status === 'revoked';
  const isRenewal = app.status === 'renewal_due' || app.status === 'expired';
  // Effective progress index: renewal/expired sit at the "active" stage.
  let idx = ACCOUNT_STAGES.findIndex((s) => s.key === app.status);
  if (isRenewal) idx = 4;
  if (idx < 0) idx = 0;

  const dateFor = (key: PoaStatus): string => {
    switch (key) {
      case 'signed':
        return app.signedAt ? `Signed ${fmtDate(app.signedAt)}` : '';
      case 'submitted':
        return app.cbpSubmittedAt ? `Submitted ${fmtDate(app.cbpSubmittedAt)}` : '';
      case 'confirmed':
        return app.cbpConfirmedAt ? `Confirmed ${fmtDate(app.cbpConfirmedAt)}` : '';
      case 'active':
        return app.effectiveAt ? `Effective ${fmtDate(app.effectiveAt)}` : '';
      default:
        return '';
    }
  };

  const items = ACCOUNT_STAGES.map((s, i) => {
    const cls = isRevoked ? 'pending' : i < idx ? 'done' : i === idx ? 'cur' : 'pending';
    const sub = dateFor(s.key);
    return `<li class="mcp-tl ${cls}"><span class="dot"></span><div><div class="tl-t">${esc(s.label)}</div>${sub ? `<div class="tl-d">${esc(sub)}</div>` : ''}</div></li>`;
  }).join('');

  let renewalNote = '';
  if (app.expiresAt && (app.status === 'active' || isRenewal)) {
    const verb = isRenewal ? 'Renewal due' : 'Renews';
    renewalNote = `<li class="mcp-tl ${isRenewal ? 'cur' : 'pending'}"><span class="dot"></span><div><div class="tl-t">${verb} ${esc(fmtDate(app.expiresAt))}</div><div class="tl-d">We track your 2-year renewal and refile before protection lapses — you don’t have to remember.</div></div></li>`;
  }
  return `<ul class="mcp-timeline">${items}${renewalNote}</ul>`;
}

/** The logged-in customer's account portal — every entity they filed, its status,
 *  its signed POA, plus account-level plan + manage-billing + protect-another. */
export function renderPrivacyAccount(opts: {
  email: string;
  identity: ManifestIdentity;
  applications: PoaApplication[];
}): string {
  const { email, identity, applications } = opts;
  const hasPlan = !!identity.tier || (identity.status != null && identity.status !== 'inactive');
  const planName = identity.tier ? tierMeta(identity.tier).name : null;
  const planLine = planName
    ? `${esc(planName)} plan${identity.isSubscriber ? '' : ` (${esc(identity.status || 'inactive')})`}`
    : 'No active plan yet';
  const renewLine =
    identity.isSubscriber && identity.currentPeriodEnd
      ? `Renews ${esc(fmtDate(identity.currentPeriodEnd))}`
      : '';

  const entityCards = applications.length
    ? applications
        .map((app) => {
          const name = app.grantorLegalName || 'Unnamed entity';
          const badgeOn = app.status === 'active';
          const variations = (app.nameVariations ?? []).length
            ? `${(app.nameVariations ?? []).length} name variation${(app.nameVariations ?? []).length === 1 ? '' : 's'} protected`
            : '';
          const pdf = app.docSha256
            ? `<a class="mcp-btn" href="/api/privacy/application/${esc(app.publicToken)}/pdf" target="_blank" rel="noopener">Download signed POA</a>`
            : '';
          const resume =
            app.status === 'draft'
              ? `<a class="mcp-btn primary" href="/privacy/apply/${esc(app.publicToken)}">Finish &amp; sign <span class="arr">&rarr;</span></a>`
              : `<a class="mcp-btn" href="/privacy/apply/${esc(app.publicToken)}">Open</a>`;
          return `<div class="mcp-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0 0 4px">${esc(name)}</h2>
          ${variations ? `<p class="mcp-steplead" style="margin:0">${esc(variations)}</p>` : ''}
        </div>
        <span class="mcp-badge${badgeOn ? ' on' : ''}">${esc(statusLabel(app.status))}</span>
      </div>
      ${accountTimeline(app)}
      <div class="mcp-actions">${resume}${pdf}</div>
    </div>`;
        })
        .join('')
    : `<div class="mcp-card"><h2>No entities yet</h2><p class="mcp-steplead" style="margin:0 0 12px">You haven’t filed a confidentiality authorization yet. Start one — it takes a few minutes.</p><div class="mcp-actions"><a class="mcp-btn primary" href="/privacy/apply">Protect an entity <span class="arr">&rarr;</span></a></div></div>`;

  const manageBilling = hasPlan
    ? `<button type="button" class="mcp-btn" id="mcp-portal">Manage billing</button>`
    : `<a class="mcp-btn primary" href="/privacy/apply">Choose a plan</a>`;

  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap">
    <a class="mcp-back" href="/manifest-privacy">&larr; Manifest Privacy</a>
    <p class="mcp-eyebrow">Manifest Privacy · Account</p>
    <h1 class="mcp-h1">Your protected entities</h1>
    <p class="mcp-sub">Signed in as ${esc(email)}. Track each entity’s status, download your signed authorizations, and manage your plan.</p>

    <div class="mcp-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0 0 2px">${esc(planLine)}</h2>
          ${renewLine ? `<p class="mcp-steplead" style="margin:0">${renewLine}</p>` : `<p class="mcp-steplead" style="margin:0">Multi-entity plans let you protect more than one business under one subscription.</p>`}
        </div>
      </div>
      <div class="mcp-actions">
        ${manageBilling}
        <a class="mcp-btn${hasPlan ? ' primary' : ''}" href="/privacy/apply">Protect another entity <span class="arr">&rarr;</span></a>
      </div>
      <p class="mcp-msg" id="mcp-account-msg"></p>
    </div>

    ${entityCards}

    <p class="mcp-honest"><b>How this works, honestly:</b> We prepare and submit your request to CBP on your behalf — QuoteFleet is not CBP and has no automated filing connection to it. Being “Hidden on QuoteFleet” is not the same as removal from CBP’s feed; the CBP filing is what removes your future shipments from third-party trackers (it is not retroactive).</p>
  </main>
  <script>${ACCOUNT_JS}</script>`;
  return layout({
    title: 'Your Account — Manifest Privacy | QuoteFleet',
    description: 'Manage your Manifest Privacy protection: entity status, signed authorizations, plan, and renewals.',
    canonicalPath: '/privacy/account',
    bodyHtml: body,
  });
}

const ACCOUNT_JS = `
(function(){
  var btn=document.getElementById('mcp-portal');
  var msg=document.getElementById('mcp-account-msg');
  function say(t,kind){if(msg){msg.textContent=t||'';msg.className='mcp-msg'+(kind?' '+kind:'');}}
  if(btn)btn.addEventListener('click',function(){
    btn.disabled=true;say('Opening billing…','');
    fetch('/api/privacy/billing/portal',{credentials:'same-origin'})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,status:r.status,body:j};});})
      .then(function(r){btn.disabled=false;
        if(r.ok&&r.body.url){window.location.href=r.body.url;return;}
        if(r.status===404){say('No billing set up yet — choose a plan to subscribe.','err');return;}
        say(r.body.error||'Billing is unavailable right now.','err');})
      .catch(function(){btn.disabled=false;say('Billing is unavailable right now.','err');});
  });
})();
`.trim();

/** The magic-link sign-in gate for the account portal. Reuses the platform
 *  magic-link endpoint (/api/auth/magic-link/send) with a redirect back to
 *  /privacy/account — the same passwordless flow directory shippers use. */
export function renderPrivacyLogin(): string {
  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap mcp-narrow">
    <a class="mcp-back" href="/manifest-privacy">&larr; Manifest Privacy</a>
    <p class="mcp-eyebrow">Manifest Privacy · Sign in</p>
    <h1 class="mcp-h1">Sign in to your account</h1>
    <p class="mcp-sub">Enter the email you used to sign your authorization. We’ll email you a secure sign-in link — no password needed.</p>
    <div class="mcp-card">
      <form id="mcp-login-form">
        <div class="mcp-field"><label for="mcp-email">Email</label><input id="mcp-email" name="email" type="email" placeholder="you@company.com" autocomplete="email" required></div>
        <div class="mcp-actions"><button type="submit" class="mcp-btn primary" id="mcp-login-btn">Email me a sign-in link</button></div>
        <p class="mcp-msg" id="mcp-login-msg"></p>
      </form>
      <p class="mcp-hint">Prefer a password? <a href="/login" style="color:var(--accent)">Use the full sign-in page</a>.</p>
    </div>
  </main>
  <script>${LOGIN_JS}</script>`;
  return layout({
    title: 'Sign in — Manifest Privacy | QuoteFleet',
    description: 'Sign in to manage your Manifest Privacy protection.',
    canonicalPath: '/privacy/login',
    bodyHtml: body,
  });
}

const LOGIN_JS = `
(function(){
  var form=document.getElementById('mcp-login-form');
  var msg=document.getElementById('mcp-login-msg');
  var btn=document.getElementById('mcp-login-btn');
  function say(t,kind){if(msg){msg.textContent=t||'';msg.className='mcp-msg'+(kind?' '+kind:'');}}
  if(form)form.addEventListener('submit',function(e){
    e.preventDefault();
    var email=(document.getElementById('mcp-email')||{}).value;
    email=(email||'').trim();
    if(!email||email.indexOf('@')<1){say('Enter a valid email address.','err');return;}
    btn.disabled=true;say('Sending…','');
    fetch('/api/auth/magic-link/send',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email:email,redirectTo:'/privacy/account'})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
      .then(function(r){btn.disabled=false;
        if(r.ok){say('\\u2713 If that email has an account, a sign-in link is on the way.','ok');return;}
        say(r.body.error||'Could not send the link. Try again.','err');})
      .catch(function(){btn.disabled=false;say('Network error — try again.','err');});
  });
})();
`.trim();

void SITE;
