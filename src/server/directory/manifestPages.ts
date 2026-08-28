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
 * EMPHASIS RULE (Alex, 2026-08 — this page starts SELLING on the next deploy):
 * lead with what the customer is actually buying, which is the CBP filing. It
 * suppresses their company name and address from U.S. Customs' PUBLIC
 * vessel-manifest records — the records ImportYeti / Panjiva / ImportGenius are
 * built from — for all FUTURE shipments. The QuoteFleet redaction is the
 * secondary, immediate benefit while CBP processes, NOT the product. The old
 * copy led with the disclaimer and read as "we hide you on QuoteFleet, and
 * something about CBP", which undersold the thing being sold. Every surface that
 * describes this (landing, plan cards + tier bullets, onboarding steps, the
 * Done/status screen, the importer-profile "Hide my data" CTA) states the CBP
 * suppression first and the not-retroactive limit plainly — BEFORE payment.
 *
 * HONEST-CLAIMS enforced in copy throughout (load-bearing — never soften these,
 * the emphasis fix above is about clarity, not accuracy):
 *   • "We prepare and submit your request to CBP on your behalf" — never an automated CBP API claim.
 *   • NOT RETROACTIVE, said plainly: shipments already published stay published.
 *   • Status vocabulary Draft → Signed → Submitted → Confirmed → Active → Renewal
 *     due; never "Hidden/Protected" before CBP confirms.
 *   • Redaction described as "Hidden on QuoteFleet" (≠ removal from the CBP feed).
 *   • Uploaded docs are "on file" / "self-reported" — never "Verified".
 *   • Never described as customs brokerage (protects the non-broker posture).
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
import {
  POA_GOVERNING_LAW_STATE,
  POA_RETENTION_YEARS,
  SIGNER_TITLE_ALLOWLIST,
  renewalPhase,
  type PoaGateResult,
} from '../manifestPoaValidation.js';

const SITE = 'https://quotefleet.net';

// ── shared scoped CSS (QF tokens only — no raw colors) ───────────────────────
const MCP_CSS = `
/* The conditional blocks in the flow are toggled with the [hidden] attribute,
   whose UA rule is only \`display:none\` at element specificity — a class rule
   like .mcp-field{display:flex} silently beats it and the block stays visible.
   That shipped the nonresident-corporation prompt to partnership grantors, so
   the attribute is made authoritative here for everything in this stylesheet. */
[hidden]{display:none !important}
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
/* Break at word boundaries first — word-break:break-all snapped names in half
   ("Manag/er") in the applicant cell. Only the SHA-256 wants a hard break. */
.mcp-mono{font-family:var(--font-mono,'JetBrains Mono',monospace);font-size:11px;color:var(--muted);overflow-wrap:anywhere;word-break:normal;white-space:normal;max-width:220px}
.mcp-mono.hash{word-break:break-all;font-size:10.5px}
/* min-width, not just max-width: with table-layout:auto a max-width alone lets
   the column collapse narrower than its content, which spilled the variations
   list over the pre-filing checklist beside it. */
.mcp-varlist{white-space:normal;min-width:190px;max-width:260px;font-size:12px;color:var(--ink-soft);overflow-wrap:anywhere}
.mcp-badge.unpaid{background:#fdecec;color:#b42318;border-color:#f3b4ae}
.mcp-exp{display:inline-block;font-size:11px;font-weight:600;color:var(--muted);margin-top:2px}
.mcp-exp.soon{color:#b54708}
.mcp-exp.due{color:#b42318;font-weight:700}
/* filter tabs */
.mcp-tabs{display:flex;gap:8px;margin:14px 0 0;flex-wrap:wrap}
.mcp-tab{font-size:12.5px;font-weight:600;padding:6px 14px;border-radius:999px;border:1px solid var(--border-strong);color:var(--ink-soft);text-decoration:none;background:var(--surface)}
.mcp-tab.on{background:var(--accent);color:var(--bg);border-color:var(--accent)}
/* radio group (residency) — selected reads as an OUTLINE, never a bright fill */
.mcp-radios{display:flex;gap:8px;flex-wrap:wrap;margin:2px 0 0}
.mcp-radios label{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--ink);border:1px solid var(--border-strong);border-radius:9px;padding:10px 13px;cursor:pointer;background:var(--bg);min-height:44px;box-sizing:border-box;flex:1 1 160px}
.mcp-radios label.on{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.mcp-radios input{width:16px;height:16px;flex:0 0 auto;accent-color:var(--accent)}
/* inline notice (conditional rules: PO box, partnership cap, off-list title) */
.mcp-note{font-size:12.5px;line-height:1.5;color:var(--ink-soft);border:1px solid var(--border-strong);border-left-width:3px;border-radius:8px;background:var(--surface);padding:10px 12px;margin:0 0 14px}
.mcp-note b{color:var(--ink)}
.mcp-note.warn{border-left-color:var(--accent)}
/* section subhead inside a step card */
.mcp-sub2{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px;text-align:left}
/* Admin pre-filing gate checklist. Only the BLOCKING failures are listed inline
   (usually none) — the full 13-check list lives behind a <details>, so a clean
   row stays two lines tall instead of leaving a 500px void beside its neighbours. */
.mcp-gatecell{white-space:normal;min-width:240px;max-width:320px}
.mcp-gate{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:4px;white-space:normal}
.mcp-gate li{display:flex;gap:7px;align-items:flex-start;font-size:11.5px;line-height:1.35;color:var(--ink-soft)}
.mcp-gate .gk{flex:0 0 auto;font-weight:700;width:11px;color:var(--muted)}
.mcp-gate li.fail .gk{color:var(--danger,#b42318)}
.mcp-gate li.pass .gk{color:var(--accent)}
.mcp-gate li.soft{color:var(--muted)}
.mcp-gate .gd{display:block;color:var(--muted);font-size:11px}
.mcp-gatehead{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin:0 0 6px;color:var(--muted)}
.mcp-gatehead.ok{color:var(--accent)}
.mcp-gatehead.no{color:var(--danger,#b42318)}
/* Inside the admin table the action buttons set the ROW height — four full-size
   46px buttons stacked in a narrow cell left a ~250px void beside every short
   cell. Compact them from tablet up; mobile keeps the 44px tap target. */
.mcp-tbl .mcp-actions{gap:6px;margin:8px 0 0}
@media (min-width:761px){
  .mcp-tbl .mcp-btn{min-height:34px;padding:7px 11px;font-size:12.5px;border-radius:7px}
  .mcp-tbl td{padding:9px 12px}
}
/* Nine columns never fit 375px, so the wrapper scrolls — say so, otherwise the
   most important columns (checks, PDF, actions) look like they are missing. */
.mcp-scrollhint{display:none;font-size:12px;color:var(--muted);line-height:1.45;margin:10px 0 0}
@media (max-width:760px){.mcp-scrollhint{display:block}}
.mcp-gatemore{margin:8px 0 0}
.mcp-gatemore summary{font-size:11.5px;font-weight:600;color:var(--accent);cursor:pointer;list-style:revert}
.mcp-gatemore[open] summary{margin-bottom:6px}
@media print{.mcp-tabs,.mcp-actions,.mcp-back{display:none}}
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
  '(15 U.S.C. §7001) and UETA. You may withdraw that consent as to future records, and you may ' +
  'request a paper copy at no charge, by contacting us. You confirm you are authorized to execute ' +
  'this authorization on behalf of the named business and to bind it. This authorization is LIMITED ' +
  'to preparing, submitting, maintaining, and renewing a U.S. Customs vessel manifest ' +
  'confidentiality request (19 CFR 103.31(d)) on your behalf — it expressly grants no authority to ' +
  'transact customs business (no entry, classification, valuation, duties, drawback, protests, ' +
  'bonds, importer of record, or CBP Form 5106), and QuoteFleet does not act as your customs broker. ' +
  'You make the certification to CBP; QuoteFleet prepares and transmits it for you. QuoteFleet is ' +
  'not CBP and has no automated filing connection to CBP. CBP suppresses only records matching your ' +
  'certified name and address EXACTLY, so list every variation. Hiding your data on QuoteFleet is not ' +
  'the same as removal from CBP’s public manifest feed — the CBP filing is what removes your future ' +
  'shipments from third-party trackers, and it is not retroactive. This authorization runs for two ' +
  'years from signing (and, for a partnership, no longer than two years and only until the ' +
  'partnership’s membership changes), is governed by the law of the State of ' +
  `${POA_GOVERNING_LAW_STATE}, and is retained by us for at least ${POA_RETENTION_YEARS} years and ` +
  'produced to CBP on request. You may revoke this authorization in writing at any time.';

// ── the marketing / landing page ─────────────────────────────────────────────
export function renderPrivacyLanding(): string {
  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap">
    <p class="mcp-eyebrow">Manifest Privacy</p>
    <h1 class="mcp-h1">Keep your future shipments out of public customs records</h1>
    <p class="mcp-sub">Every ocean import you make is published in U.S. Customs vessel-manifest data — the public feed that ImportYeti, Panjiva, ImportGenius and the rest of the trade-data industry are built from. We prepare and submit a confidentiality request to CBP on your behalf under 19 CFR 103.31(d). Once it is on file, CBP suppresses your company name and address on those manifest records for all of your future shipments, so new shipments stop showing up on the sites your competitors search.</p>
    <div class="mcp-note"><b>It is not retroactive — and you should know that before you pay, not after.</b> Shipments already published stay in the historical record. The filing suppresses records going forward; it does not delete the ones already out there.</div>
    <p class="mcp-sub">We also hide your company on QuoteFleet the moment you subscribe, while CBP works through the filing. That part is immediate — but it only covers QuoteFleet. The CBP filing is what reaches everyone else. Protection then runs 2 years, and CBP sends no expiry reminder, so we track the clock and refile before it lapses.</p>
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
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">3. We prepare &amp; submit to CBP on your behalf</div><div class="tl-d">A human specialist files your request through CBP’s official channels — there is no automated connection to CBP, so we do the filing for you.</div></div></li>
        <li class="mcp-tl done"><span class="dot"></span><div><div class="tl-t">4. Confirmed &amp; tracked for 2 years</div><div class="tl-d">Once CBP confirms, your future shipments stop appearing in the public manifest records the trade-data sites pull from. We hide you on QuoteFleet and track your 2-year renewal so protection never lapses.</div></div></li>
      </ul>
    </div>

    <div class="mcp-card">
      <h2>Plans</h2>
      <p class="mcp-steplead">Annual. Every plan includes the CBP confidentiality filing prepared and submitted for you, immediate redaction on QuoteFleet, and 2-year renewal tracking.</p>
      <div class="mcp-plans">
        ${MANIFEST_TIERS.map((t) => planCard(t, 'landing')).join('')}
      </div>
    </div>

    <p class="mcp-honest"><b>How we describe this, honestly:</b> The CBP filing is the product — it is what stops your future shipments appearing on third-party trade-data trackers, and it is not retroactive: shipments already published stay in the historical record. We prepare and submit that request to CBP on your behalf; QuoteFleet is not CBP and has no automated filing connection to it, so a person files it through CBP’s official channels. Being “Hidden on QuoteFleet” is the immediate part, and is not the same as removal from CBP’s feed. Uploaded documents are kept on file and treated as self-reported, not as an independent verification.</p>
  </main>`;
  return layout({
    title: 'Manifest Privacy — Keep Shipments Out of Public Customs Records | QuoteFleet',
    description:
      'Managed U.S. Customs vessel manifest confidentiality (19 CFR 103.31(d)). We prepare and submit your CBP confidentiality request on your behalf, so your future shipments stop appearing in the public manifest records ImportYeti and Panjiva are built from. Not retroactive. Annual plans from $79.',
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
  const s = {
    isSubscriber,
    titleAllowlist: SIGNER_TITLE_ALLOWLIST,
    token: app?.publicToken ?? '',
    status: app?.status ?? 'draft',
    grantorLegalName: app?.grantorLegalName ?? prefill.name ?? '',
    dbaNames: app?.dbaNames ?? [],
    entityType: app?.entityType ?? '',
    stateOfOrg: app?.stateOfOrg ?? '',
    countryOfOrg: app?.countryOfOrg ?? '',
    residency: app?.residency ?? '',
    grantorAddress: app?.grantorAddress ?? '',
    mailingAddress: app?.mailingAddress ?? '',
    einOrImporterNo: app?.einOrImporterNo ?? '',
    iorNumber: app?.iorNumber ?? '',
    partnerNames: app?.partnerNames ?? [],
    nameVariations: app?.nameVariations ?? (prefill.name ? [prefill.name] : []),
    addressVariations: app?.addressVariations ?? [],
    importerSlug: app?.importerSlug ?? prefill.slug ?? '',
    signerName: app?.signerName ?? '',
    signerTitle: app?.signerTitle ?? '',
    signerEmail: app?.signerEmail ?? '',
    signerPhone: app?.signerPhone ?? '',
    certSignerName: app?.certSignerName ?? '',
    certSignerTitle: app?.certSignerTitle ?? '',
    certSignerEmail: app?.certSignerEmail ?? '',
    authorityDocsNote: app?.authorityDocsNote ?? '',
    emailVerified: !!app?.signerEmailVerifiedAt,
    docSha256: app?.docSha256 ?? '',
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
    <p class="mcp-sub">Fully online. Build your request, sign it, and we prepare and submit it to U.S. Customs on your behalf — so CBP suppresses your company name and address on the public manifest records for your future shipments. It is not retroactive: shipments already published stay in the historical record. We hide you on QuoteFleet right away while CBP processes the filing.</p>

    <div class="mcp-steps" id="mcp-stepper">
      ${steps.map((s, i) => `<div class="mcp-step${i === 0 ? ' active' : ''}" data-step="${i}"><span class="n">${i + 1}</span>${esc(s)}</div>`).join('')}
    </div>

    <!-- Step 1 -->
    <section class="mcp-card" data-panel="0">
      <h2>Your business</h2>
      <p class="mcp-steplead">The legal entity to protect. This becomes the Principal on the authorization, so every field here has to match your CBP records exactly.</p>
      <div class="mcp-field"><label for="f-legal">Legal business name</label><input id="f-legal" type="text" placeholder="Acme Imports LLC" autocomplete="organization"><p class="mcp-hint">Exactly as it appears in CBP’s ACE system. CBP suppresses only exact matches.</p></div>
      <div class="mcp-field"><label>DBA / trade names <span style="font-weight:500;color:var(--muted)">(optional)</span></label>
        <div class="mcp-chips" data-chips="dba"></div>
        <div class="mcp-chipadd"><input type="text" data-chipinput="dba" placeholder="Add a trade name" maxlength="120"><button type="button" class="mcp-btn" data-chipadd="dba">Add</button></div>
        <p class="mcp-hint">A DBA missing from the authorization is a common cause of rejection.</p>
      </div>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-entity">Entity type</label>
          <select id="f-entity">
            <option value="">Select…</option>
            <option>Limited Liability Company (LLC)</option>
            <option>Corporation</option>
            <option>S-Corporation</option>
            <option>Partnership</option>
            <option>Sole Proprietorship</option>
            <option>Individual</option>
            <option>Other</option>
          </select>
        </div>
        <div class="mcp-field"><label for="f-state">State of organization</label><input id="f-state" type="text" placeholder="Delaware"></div>
      </div>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-country">Country of organization</label><input id="f-country" type="text" placeholder="United States" autocomplete="country-name"></div>
        <div class="mcp-field"><label>U.S. residency</label>
          <div class="mcp-radios" id="f-residency">
            <label data-res="resident"><input type="radio" name="mcp-res" value="resident"> Resident</label>
            <label data-res="nonresident"><input type="radio" name="mcp-res" value="nonresident"> Nonresident</label>
          </div>
        </div>
      </div>
      <div class="mcp-note" id="f-nonres-note" hidden><b>Nonresident corporation.</b> CBP may ask for evidence that your signer can bind the company (19 CFR 141.37). Tell us what you can produce — a board resolution, corporate secretary certificate, or similar — and we’ll hold it on file.</div>
      <div class="mcp-field" id="f-authdocs-wrap" hidden><label for="f-authdocs">Supporting authority documentation on file</label><input id="f-authdocs" type="text" placeholder="Board resolution dated 2026-03-14" maxlength="200"><p class="mcp-hint">Self-reported — we record what you tell us, we don’t independently verify it.</p></div>
      <div class="mcp-field"><label for="f-addr">Physical business address</label><textarea id="f-addr" placeholder="123 Harbor Way, Long Beach, CA 90802"></textarea><p class="mcp-hint">Must be a physical street address. CBP rejects PO boxes and mail drops.</p></div>
      <div class="mcp-note warn" id="f-pobox-note" hidden><b>That looks like a PO box or mail drop.</b> CBP requires a physical street address on the authorization. Enter the address where your business actually operates — you can add the PO box as a mailing address below.</div>
      <div class="mcp-field"><label for="f-mailaddr">Mailing address <span style="font-weight:500;color:var(--muted)">(only if different)</span></label><input id="f-mailaddr" type="text" placeholder="PO Box 4120, Long Beach, CA 90802" maxlength="200"></div>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-ein">EIN (IRS employer ID)</label><input id="f-ein" type="text" placeholder="12-3456789" autocomplete="off"><p class="mcp-hint">Used only on your CBP confidentiality request.</p></div>
        <div class="mcp-field"><label for="f-ior">Importer of record number <span style="font-weight:500;color:var(--muted)">(if different)</span></label><input id="f-ior" type="text" placeholder="Same as EIN" autocomplete="off"></div>
      </div>
      <div id="f-partners-wrap" hidden>
        <div class="mcp-note"><b>Partnership.</b> Every partner has to be named (19 CFR 141.39), and the authorization can run no longer than two years and ends if the partnership’s membership changes (19 CFR 141.34).</div>
        <div class="mcp-field"><label>All partners</label>
          <div class="mcp-chips" data-chips="partner"></div>
          <div class="mcp-chipadd"><input type="text" data-chipinput="partner" placeholder="Add a partner’s full name" maxlength="120"><button type="button" class="mcp-btn" data-chipadd="partner">Add</button></div>
        </div>
      </div>
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
        <p class="mcp-hint">At least one is required — this becomes Schedule A of your authorization.</p>
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
        <div class="mcp-field"><label for="f-title">Your title with the business</label><input id="f-title" type="text" placeholder="President" list="mcp-titles" autocomplete="organization-title"><datalist id="mcp-titles"></datalist><p class="mcp-hint" id="f-title-hint">Pick your entity type first and we’ll show the titles CBP accepts.</p></div>
      </div>
      <div class="mcp-note" id="f-title-note" hidden><b>Your title is outside the list CBP normally accepts for this entity type.</b> That’s the single most common reason a filing is rejected. We won’t block you — instead, have a second officer certify that you’re authorized to sign. Their name and title go on the authorization.</div>
      <div id="f-cert-wrap" hidden>
        <p class="mcp-sub2">Corporate certification (second officer)</p>
        <div class="mcp-grid2">
          <div class="mcp-field"><label for="f-certname">Certifying officer’s full name</label><input id="f-certname" type="text" placeholder="Robert Chen" autocomplete="off"></div>
          <div class="mcp-field"><label for="f-certtitle">Their title</label><input id="f-certtitle" type="text" placeholder="Secretary" autocomplete="off"></div>
        </div>
        <div class="mcp-field"><label for="f-certemail">Their business email <span style="font-weight:500;color:var(--muted)">(optional)</span></label><input id="f-certemail" type="email" placeholder="rchen@acme.com" autocomplete="off"></div>
      </div>
      <div class="mcp-grid2">
        <div class="mcp-field"><label for="f-email">Your business email</label><input id="f-email" type="email" placeholder="jane@acme.com" autocomplete="email"><p class="mcp-hint">We email a confirmation link here — your request isn’t filed until you click it.</p></div>
        <div class="mcp-field"><label for="f-phone">Your business phone</label><input id="f-phone" type="tel" placeholder="+1 562 555 0142" autocomplete="tel"></div>
      </div>
      <div class="mcp-note warn" id="f-freemail-note" hidden><b>That’s a personal mailbox.</b> For a company, CBP expects the signer to use the business’s own email domain — a personal address weakens the authorization and is a common cause of rejection.</div>
      <div class="mcp-field"><label>Draw your signature <span style="font-weight:500;color:var(--muted)">(optional)</span></label>
        <canvas class="mcp-sig" id="f-sig" width="600" height="120" aria-label="Signature pad (optional)"></canvas>
        <div class="mcp-sigrow"><span>Optional — your typed name above is your legal signature (ESIGN/UETA). Draw here only if you prefer.</span><button type="button" class="mcp-linkbtn" id="f-sig-clear">Clear</button></div>
      </div>
      <p class="mcp-hint">On signing we generate your authorization as a PDF, record a tamper-evident SHA-256 and an audit trail (time, IP, browser) inside it, email you a copy, and retain it for at least ${POA_RETENTION_YEARS} years. It is governed by the law of the State of ${esc(POA_GOVERNING_LAW_STATE)} and runs two years from signing.</p>
      <div class="mcp-actions"><button type="button" class="mcp-btn" data-prev="1">Back</button><button type="button" class="mcp-btn primary" id="mcp-sign">Sign &amp; continue <span class="arr">&rarr;</span></button></div>
      <p class="mcp-msg" data-msg="2"></p>
    </section>

    <!-- Step 4 -->
    <section class="mcp-card" data-panel="3" hidden>
      <h2>Choose your plan</h2>
      <p class="mcp-steplead">Your signed authorization is saved. Pick a plan and we submit it to CBP, which suppresses your company on the public manifest records for your future shipments — not the ones already published — plus immediate redaction on QuoteFleet and 2-year renewal tracking.</p>
      <div class="mcp-plans">${MANIFEST_TIERS.map((t) => planCard(t, 'flow')).join('')}</div>
      <div class="mcp-actions"><button type="button" class="mcp-btn" data-prev="2">Back</button><button type="button" class="mcp-btn" data-next="4">I’ll decide later</button></div>
      <p class="mcp-msg" data-msg="3"></p>
    </section>

    <!-- Step 5 -->
    <section class="mcp-card" data-panel="4" hidden>
      <h2>You’re set</h2>
      <p class="mcp-steplead" id="mcp-done-lead">Your authorization is signed and saved.</p>
      <div class="mcp-note warn" id="mcp-verify-note" hidden><b>One last step — confirm your email.</b> We sent a confirmation link to your business address. We can’t submit your request to CBP until you click it. <button type="button" class="mcp-linkbtn" id="mcp-verify-resend">Resend the link</button></div>
      <ul class="mcp-timeline" id="mcp-done-timeline"></ul>
      <div class="mcp-actions">
        <a class="mcp-btn primary" id="mcp-dl" href="#" target="_blank" rel="noopener">Download signed PDF</a>
        <a class="mcp-btn" id="mcp-account-link" href="/privacy/account">View my account</a>
        <a class="mcp-btn" href="/manifest-privacy">Done</a>
      </div>
      <p class="mcp-honest" id="mcp-done-next"><b>What happens next:</b> We prepare and submit your request to CBP on your behalf (a human files it through CBP’s official channels). Once CBP has it on file, your company name and address are suppressed on the public manifest records for your future shipments — not for shipments already published. Your status stays honest — you’ll see Submitted, then Confirmed, then Active. We’ll track your 2-year renewal and refile before it lapses.</p>
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
  var F={legal:'#f-legal',entity:'#f-entity',state:'#f-state',country:'#f-country',addr:'#f-addr',mailaddr:'#f-mailaddr',ein:'#f-ein',ior:'#f-ior',authdocs:'#f-authdocs',signer:'#f-signer',title:'#f-title',email:'#f-email',phone:'#f-phone',certname:'#f-certname',certtitle:'#f-certtitle',certemail:'#f-certemail'};
  var MAP={legal:'grantorLegalName',entity:'entityType',state:'stateOfOrg',country:'countryOfOrg',addr:'grantorAddress',mailaddr:'mailingAddress',ein:'einOrImporterNo',ior:'iorNumber',authdocs:'authorityDocsNote',signer:'signerName',title:'signerTitle',email:'signerEmail',phone:'signerPhone',certname:'certSignerName',certtitle:'certSignerTitle',certemail:'certSignerEmail'};
  Object.keys(F).forEach(function(k){var el=$(F[k]);if(el&&S[MAP[k]])el.value=S[MAP[k]];});
  $all('#f-residency input').forEach(function(r){if(S.residency&&r.value===S.residency)r.checked=true;});

  function collect(){
    Object.keys(F).forEach(function(k){var el=$(F[k]);if(el)S[MAP[k]]=el.value.trim();});
    var res=$('#f-residency input:checked');S.residency=res?res.value:'';
    S.nameVariations=chips.name.slice();S.addressVariations=chips.address.slice();
    S.dbaNames=chips.dba.slice();S.partnerNames=chips.partner.slice();
    return S;
  }
  function payload(){return {grantorLegalName:S.grantorLegalName,dbaNames:S.dbaNames,entityType:S.entityType,stateOfOrg:S.stateOfOrg,countryOfOrg:S.countryOfOrg,residency:S.residency,grantorAddress:S.grantorAddress,mailingAddress:S.mailingAddress,einOrImporterNo:S.einOrImporterNo,iorNumber:S.iorNumber,partnerNames:S.partnerNames,nameVariations:S.nameVariations,addressVariations:S.addressVariations,importerSlug:S.importerSlug,signerName:S.signerName,signerTitle:S.signerTitle,signerEmail:S.signerEmail,signerPhone:S.signerPhone,certSignerName:S.certSignerName,certSignerTitle:S.certSignerTitle,certSignerEmail:S.certSignerEmail,authorityDocsNote:S.authorityDocsNote};}

  // ---- entity-conditional rules (mirror src/server/manifestPoaValidation.ts) ----
  // Kept in lockstep with the server module: the client only ever GUIDES; the
  // server re-runs every rule at /sign and is the authority.
  var FREEMAIL=['gmail.com','googlemail.com','yahoo.com','ymail.com','yahoo.co.uk','hotmail.com','outlook.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com','protonmail.com','proton.me','gmx.com','gmx.net','mail.com','zoho.com','yandex.com','qq.com','163.com','126.com','comcast.net','verizon.net','sbcglobal.net','att.net','cox.net','bellsouth.net'];
  function entityClass(v){
    var s=String(v||'').toLowerCase().replace(/[^a-z ]+/g,' ').replace(/\\s+/g,' ').trim();
    if(!s)return 'other';
    if(/\\bllc\\b|limited liability company/.test(s))return 'llc';
    if(/\\bsole proprietor|sole prop\\b|\\bdba\\b/.test(s))return 'sole_proprietorship';
    if(/\\bpartnership\\b|\\bllp\\b|\\blp\\b/.test(s))return 'partnership';
    if(/\\bcorporation\\b|\\bcorp\\b|\\binc\\b/.test(s))return 'corporation';
    if(/\\bindividual\\b|\\bnatural person\\b|\\bself\\b/.test(s))return 'individual';
    return 'other';
  }
  function normTitle(t){
    var s=String(t||'').toLowerCase().replace(/[./,&]+/g,' ').replace(/\\s+/g,' ').trim();
    if(!s)return '';
    s=s.replace(/\\bv ?p\\b/g,'vice president').replace(/\\bevp\\b|\\bsvp\\b/g,'vice president').replace(/\\bpres\\b/g,'president').replace(/\\bsec\\b|\\bsecy\\b/g,'secretary').replace(/\\btreas\\b/g,'treasurer').replace(/\\bg ?p\\b/g,'general partner').replace(/\\bmng\\b|\\bmgng\\b/g,'managing');
    s=s.replace(/^(executive|senior|sr|exec|assistant|asst|deputy|first|1st) /g,'');
    return s.replace(/\\s+/g,' ').trim();
  }
  function isPoBox(a){
    var s=String(a||'');if(!s.trim())return false;
    return /\\bp[.\\s]*o[.\\s]*box\\b/i.test(s)||/\\bp[.\\s]*o[.\\s]*b\\b/i.test(s)||/\\bpost\\s+office\\s+box\\b/i.test(s)||/\\bpostal\\s+box\\b/i.test(s)||/\\bpost\\s+box\\b/i.test(s)||/\\bpo\\s+bin\\b/i.test(s)||/\\bpmb\\b\\s*#?\\s*\\d/i.test(s)||/(^|[\\n,;]\\s*)box\\s+(no\\.?\\s*)?#?\\s*\\d/i.test(s);
  }
  function titlesFor(cls){var m=S.titleAllowlist||{};return m[cls]||[];}
  function titleOk(cls,t){var n=normTitle(t);return !!n&&titlesFor(cls).indexOf(n)>=0;}
  function toggle(el,on){if(el)el.hidden=!on;}

  function applyRules(){
    var cls=entityClass($('#f-entity')?$('#f-entity').value:'');
    var res=$('#f-residency input:checked');res=res?res.value:'';
    // Partnership → all partners + the 2-year cap notice.
    toggle($('#f-partners-wrap'),cls==='partnership');
    // Nonresident corporation → 19 CFR 141.37 supporting authority prompt.
    var nonresCorp=(cls==='corporation'&&res==='nonresident');
    toggle($('#f-nonres-note'),nonresCorp);toggle($('#f-authdocs-wrap'),nonresCorp);
    // PO box on the physical address.
    var addrEl=$('#f-addr');toggle($('#f-pobox-note'),!!addrEl&&isPoBox(addrEl.value));
    // Title allowlist → datalist + the corporate-certification fallback.
    var titles=titlesFor(cls);
    var dl=$('#mcp-titles');
    if(dl){dl.innerHTML='';titles.forEach(function(t){var o=document.createElement('option');o.value=t.replace(/\\b\\w/g,function(c){return c.toUpperCase();});dl.appendChild(o);});}
    var hint=$('#f-title-hint');
    if(hint)hint.textContent=titles.length?('CBP accepts: '+titles.map(function(t){return t.replace(/\\b\\w/g,function(c){return c.toUpperCase();});}).join(', ')+'. Another title is fine — we\\u2019ll add a second-officer certification.'):'Any title is fine — we\\u2019ll add a second-officer certification so your authority is documented.';
    var tEl=$('#f-title');var typed=tEl?tEl.value.trim():'';
    var needsCert=!titleOk(cls,typed);
    toggle($('#f-title-note'),needsCert&&!!typed);
    toggle($('#f-cert-wrap'),needsCert);
    // Personal mailbox for a company.
    var em=$('#f-email');var dom=em?(em.value.split('@')[1]||'').toLowerCase():'';
    var corpNeeded=(cls==='corporation'||cls==='llc'||cls==='partnership');
    toggle($('#f-freemail-note'),corpNeeded&&!!dom&&FREEMAIL.indexOf(dom)>=0);
  }
  ['#f-entity','#f-addr','#f-title','#f-email'].forEach(function(sel){var el=$(sel);if(el){el.addEventListener('input',applyRules);el.addEventListener('change',applyRules);}});
  $all('#f-residency input').forEach(function(r){r.addEventListener('change',function(){
    $all('#f-residency label').forEach(function(l){l.classList.toggle('on',l.getAttribute('data-res')===r.value&&r.checked);});
    applyRules();save();
  });});
  $all('#f-residency label').forEach(function(l){var i=l.querySelector('input');if(i&&i.checked)l.classList.add('on');});

  function ensureDraft(){
    if(S.token)return Promise.resolve(S.token);
    return api('POST','/api/privacy/application',payload()).then(function(r){if(r.ok&&r.body.token){S.token=r.body.token;var u=new URL(window.location.href);u.pathname='/privacy/apply/'+S.token;window.history.replaceState({},'',u.toString());return S.token;}throw new Error(r.body.error||'Could not start');});
  }
  function save(){collect();if(!S.token)return ensureDraft();return api('PATCH','/api/privacy/application/'+S.token,payload()).then(function(){return S.token;});}

  // ---- chips ----
  var chips={name:(S.nameVariations||[]).slice(),address:(S.addressVariations||[]).slice(),dba:(S.dbaNames||[]).slice(),partner:(S.partnerNames||[]).slice()};
  function renderChips(kind){
    var box=$('[data-chips="'+kind+'"]');if(!box)return;box.innerHTML='';
    chips[kind].forEach(function(v,i){var c=document.createElement('span');c.className='mcp-chip';c.appendChild(document.createTextNode(v));var b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove');b.textContent='\\u00d7';b.addEventListener('click',function(){chips[kind].splice(i,1);renderChips(kind);save();});c.appendChild(b);box.appendChild(c);});
  }
  function addChip(kind){var inp=$('[data-chipinput="'+kind+'"]');if(!inp)return;var v=inp.value.trim();if(!v)return;if(chips[kind].indexOf(v)===-1){chips[kind].push(v);}inp.value='';renderChips(kind);save();}
  $all('[data-chipadd]').forEach(function(btn){btn.addEventListener('click',function(){addChip(btn.getAttribute('data-chipadd'));});});
  $all('[data-chipinput]').forEach(function(inp){inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();addChip(inp.getAttribute('data-chipinput'));}});});
  renderChips('name');renderChips('address');renderChips('dba');renderChips('partner');
  applyRules();

  // ---- stepper ----
  var current=0;
  function show(step){
    current=step;
    $all('[data-panel]').forEach(function(p){p.hidden=(+p.getAttribute('data-panel')!==step);});
    $all('.mcp-step').forEach(function(s){var i=+s.getAttribute('data-step');s.classList.toggle('active',i===step);s.classList.toggle('done',i<step);});
    window.scrollTo({top:0,behavior:'smooth'});
  }
  $all('[data-next]').forEach(function(b){b.addEventListener('click',function(){var to=+b.getAttribute('data-next');collect();
    // Step 1 → 2: everything CBP requires on the Grantor block. Blocking here is
    // far cheaper than a rejected filing (which costs the customer a re-signature).
    if(to===1){
      var cls=entityClass(S.entityType);
      if(!S.grantorLegalName){msg(0,'Enter your legal business name.','err');return;}
      if(!S.entityType){msg(0,'Select your entity type.','err');return;}
      if(!S.stateOfOrg&&!S.countryOfOrg){msg(0,'Enter the state or country where your business is organized.','err');return;}
      if(!S.grantorAddress){msg(0,'Enter your physical business address.','err');return;}
      if(isPoBox(S.grantorAddress)){msg(0,'CBP requires a physical street address \\u2014 a PO box or mail drop can\\u2019t be used.','err');return;}
      if(!S.einOrImporterNo){msg(0,'Enter your EIN or importer of record number.','err');return;}
      if(cls==='partnership'&&!(S.partnerNames||[]).length){msg(0,'A partnership authorization must name every partner.','err');return;}
    }
    if(to===2&&!(S.nameVariations||[]).length){msg(1,'Add at least one name variation \\u2014 CBP suppresses only exact matches.','err');return;}
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
    var cls=entityClass(S.entityType);
    if(!$('#f-consent').checked){msg(2,'Please check the consent box to continue.','err');return;}
    if(!S.signerName){msg(2,'Type your full name as your signature.','err');return;}
    if(!S.signerTitle){msg(2,'Enter your title with the business.','err');return;}
    if(!S.signerEmail){msg(2,'Enter your business email address.','err');return;}
    if(!S.signerPhone){msg(2,'Enter a business phone number.','err');return;}
    if(!titleOk(cls,S.signerTitle)&&!(S.certSignerName&&S.certSignerTitle)){
      msg(2,'Your title is outside the list CBP normally accepts. Add a second officer\\u2019s name and title in the corporate certification below.','err');
      toggle($('#f-cert-wrap'),true);var cn=$('#f-certname');if(cn)cn.focus();return;
    }
    // The drawn signature is OPTIONAL — typed name + consent satisfies ESIGN/UETA
    // (keyboard/AT users can sign without a pointer). Include the canvas only if
    // the signer actually drew on it.
    signBtn.disabled=true;msg(2,'Signing…','');
    var sig=(drawn&&canvas)?canvas.toDataURL('image/png'):null;
    save().then(function(){return api('POST','/api/privacy/application/'+S.token+'/consent',{disclosureVersion:'shown'});})
      .then(function(){return api('POST','/api/privacy/application/'+S.token+'/sign',{signerName:S.signerName,signerTitle:S.signerTitle,signerEmail:S.signerEmail,signerPhone:S.signerPhone,certSignerName:S.certSignerName,certSignerTitle:S.certSignerTitle,certSignerEmail:S.certSignerEmail,authorityDocsNote:S.authorityDocsNote,signatureDrawnPng:sig});})
      .then(function(r){signBtn.disabled=false;if(!r.ok){throw new Error(r.body.error||'Could not sign');}
        S.status=r.body.status||'signed';S.docSha256=r.body.docSha256||'';
        if(r.body.emailVerificationPending===false)S.emailVerified=true;
        renderDone();show(3);})
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
    // Email round-trip: a BLOCKING pre-filing check, so say so plainly.
    toggle($('#mcp-verify-note'),!S.emailVerified&&!!S.signerEmail);
    // HONEST-CLAIMS: only a PAID subscriber is actually filed with CBP. An unpaid
    // signer ("I'll decide later") must NOT be told we submit to CBP — nothing is
    // submitted until they choose a plan.
    var nx=$('#mcp-done-next');
    if(nx){
      if(S.isSubscriber){
        nx.innerHTML='<b>What happens next:</b> We prepare and submit your request to CBP on your behalf (a human files it through CBP\\u2019s official channels). Once CBP has it on file, your company name and address are suppressed on the public manifest records for your future shipments \\u2014 not for shipments already published. Your status stays honest \\u2014 you\\u2019ll see Submitted, then Confirmed, then Active. We\\u2019ll track your 2-year renewal and refile before it lapses.';
      }else{
        nx.innerHTML='<b>What happens next:</b> Your authorization is saved. Choose a plan and we\\u2019ll file it with CBP on your behalf \\u2014 that filing is what suppresses your company on the public manifest records for your future shipments, and until then nothing is submitted to CBP. You can pick a plan any time from your account.';
      }
    }
    var order=['signed','submitted','confirmed','active'];
    var labels={signed:['Signed',(S.docSha256?('Tamper-evident SHA-256 recorded: '+S.docSha256.slice(0,16)+'…'):'Your authorization is signed and saved.')],
      submitted:['Submitted to CBP','We prepare and submit your request to CBP on your behalf — a human files it through CBP\\u2019s official channels.'],
      confirmed:['Confirmed by CBP','CBP acknowledges receipt of your confidentiality request. Suppression applies to manifest records from here forward, not to shipments already published.'],
      active:['Active — hidden on QuoteFleet','CBP is suppressing your company name and address on new manifest records, you\\u2019re hidden on QuoteFleet, and we track your 2-year renewal.']};
    var idx=order.indexOf(S.status);if(idx<0)idx=0;
    var tl=$('#mcp-done-timeline');if(!tl)return;tl.innerHTML='';
    order.forEach(function(k,i){var li=document.createElement('li');li.className='mcp-tl '+(i<idx?'done':(i===idx?'cur':'pending'));
      li.innerHTML='<span class="dot"></span><div><div class="tl-t">'+labels[k][0]+'</div><div class="tl-d">'+labels[k][1]+'</div></div>';tl.appendChild(li);});
  }

  // ---- resend the email confirmation ----
  var rs=$('#mcp-verify-resend');
  if(rs)rs.addEventListener('click',function(){
    if(!S.token)return;rs.disabled=true;
    api('POST','/api/privacy/application/'+S.token+'/verify-email',{}).then(function(r){
      rs.disabled=false;msg(4,r.ok?'Confirmation link sent \\u2014 check your inbox.':'Could not send the link.',r.ok?'ok':'err');
    }).catch(function(){rs.disabled=false;msg(4,'Could not send the link.','err');});
  });

  // resume: if already signed, jump ahead
  if(S.status&&S.status!=='draft'){renderDone();show(S.status==='signed'?3:4);}
})();
`.trim();

// ── admin filing queue / review page ─────────────────────────────────────────
const CBP_CERT_HINT =
  'Copy the CBP certification text, then file it through CBP’s Vessel Manifest Confidentiality Online ' +
  'Application (or the vesselmanifestconfidentiality@cbp.dhs.gov mailbox). There is no automated filing API — this is a human step.';

export function renderAdminPrivacyQueue(
  rows: Array<{
    app: PoaApplication;
    events: PoaAuditEvent[];
    sub?: { tier: string | null; paid: boolean };
    gate?: PoaGateResult;
  }>,
  opts?: { filter?: 'all' | 'renewals' },
): string {
  const filter = opts?.filter === 'renewals' ? 'renewals' : 'all';
  const fmt = (d: Date | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—';
  const fmtDay = (d: Date | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 10) : '—';

  const rowsHtml = rows.length
    ? rows
        .map(({ app, events, sub, gate }) => {
          const names = (app.nameVariations ?? []).join('; ') || app.grantorLegalName || '—';
          const audit = events
            .slice(0, 8)
            .map((e) => `${esc(e.event)} @ ${fmt(e.createdAt)}`)
            .join('<br>');
          const certText = buildCbpCertText(app);

          // PRE-FILING GATE — the 15 documented CBP rejection causes rendered as
          // a per-application checklist so nothing has to be remembered.
          // Inline = label only (one line each), so a blocked row stays compact;
          // the "why" rides along as a title tooltip and in the expanded list.
          const checkLi = (c: PoaGateResult['checks'][number], withDetail = true) =>
            `<li class="${c.ok ? 'pass' : c.blocking ? 'fail' : 'soft'}" title="${esc(c.detail)}"><span class="gk">${c.ok ? '&#10003;' : c.blocking ? '&#10007;' : '&#8226;'}</span><span>${esc(c.label)}${withDetail ? `<span class="gd">${esc(c.detail)}</span>` : ''}</span></li>`;
          let gateHtml = '<span class="mcp-mono">—</span>';
          if (gate) {
            const head = gate.ok
              ? `<p class="mcp-gatehead ok">Ready to file · ${gate.passed}/${gate.total}</p>`
              : `<p class="mcp-gatehead no">${gate.failures.length} blocking · ${gate.passed}/${gate.total}</p>`;
            // Blocking failures inline (what the operator must act on); the full
            // list one click away, so a passing row does not tower over the table.
            const inline = gate.failures.length
              ? `<ul class="mcp-gate">${gate.failures.map((c) => checkLi(c, false)).join('')}</ul>`
              : '';
            gateHtml =
              head +
              inline +
              `<details class="mcp-gatemore"><summary>All ${gate.total} checks</summary><ul class="mcp-gate">${gate.checks
                .map((c) => checkLi(c))
                .join('')}</ul></details>`;
          }

          // Renewal timing — CBP does NOT auto-renew and sends no notice, so the
          // queue says outright when to remind (18 months in) and when to file
          // (the 60–90 day window before the 2-year expiry).
          const phase = renewalPhase(app.expiresAt ?? null);
          const flag =
            phase.phase === 'expired' || phase.phase === 'overdue'
              ? ' due'
              : phase.phase === 'file_now' || phase.phase === 'remind'
                ? ' soon'
                : '';
          const expiryHtml = app.expiresAt
            ? `<div class="mcp-mono">${esc(fmtDay(app.expiresAt))}</div><span class="mcp-exp${flag}">${esc(phase.label)}</span>`
            : `<span class="mcp-exp">${esc(phase.label)}</span>`;

          // Paid/tier cell — JOINed manifest subscription so ops never files for
          // a non-payer. paid=false renders a loud "UNPAID" flag.
          const paid = sub?.paid ?? false;
          const tierLabel = sub?.tier ? sub.tier[0].toUpperCase() + sub.tier.slice(1) : null;
          const paidHtml = paid
            ? `<span class="mcp-badge on">Paid${tierLabel ? ` · ${esc(tierLabel)}` : ''}</span>`
            : `<span class="mcp-badge unpaid">Unpaid</span>`;
          const pdfUrl = `/api/privacy/application/${esc(app.publicToken)}/pdf`;
          return `<tr>
      <td>
        <div><b>${esc(app.grantorLegalName || '—')}</b></div>
        <div class="mcp-mono">${esc(app.einOrImporterNo || 'EIN n/a')}</div>
        <div class="mcp-mono">${esc(app.signerName || 'unsigned')}${app.signerTitle ? ` · ${esc(app.signerTitle)}` : ''}</div>
        <div class="mcp-mono">token ${esc(app.publicToken)}</div>
      </td>
      <td><span class="mcp-badge${app.status === 'active' ? ' on' : ''}">${esc(statusLabel(app.status))}</span></td>
      <td>${paidHtml}</td>
      <td>${expiryHtml}</td>
      <td class="mcp-varlist">${esc(names)}</td>
      <td class="mcp-gatecell">${gateHtml}</td>
      <td>
        ${app.docSha256 ? `<div class="mcp-mono hash">${esc(app.docSha256)}</div>` : '<span class="mcp-mono">unsigned</span>'}
        ${
          app.docSha256
            ? `<div class="mcp-actions" style="margin-top:6px">
          <a class="mcp-btn" href="${pdfUrl}" target="_blank" rel="noopener">View</a>
          <button type="button" class="mcp-btn" data-print="${pdfUrl}">Print</button>
          <a class="mcp-btn" href="${pdfUrl}?download=1" download="poa-${esc(app.publicToken)}.pdf">Download</a>
        </div>`
            : ''
        }
        ${app.cbpReference ? `<div class="mcp-mono">ref ${esc(app.cbpReference)}</div>` : ''}
        ${app.cbpChannel ? `<div class="mcp-mono">via ${esc(app.cbpChannel)}</div>` : ''}
      </td>
      <td class="mcp-mono">${audit || '—'}</td>
      <td>
        <button type="button" class="mcp-linkbtn" data-cert="${esc(app.publicToken)}">Copy CBP text</button>
        <textarea data-certtext="${esc(app.publicToken)}" hidden>${esc(certText)}</textarea>
        <div class="mcp-actions" style="margin-top:8px">
          <button type="button" class="mcp-btn" data-act="submit" data-id="${app.id}">Record submission</button>
          <button type="button" class="mcp-btn primary" data-act="confirm" data-id="${app.id}">Confirm + hide</button>
          <button type="button" class="mcp-btn" data-act="refile" data-id="${app.id}">Re-file (renew)</button>
          <button type="button" class="mcp-btn" data-act="revoke" data-id="${app.id}">Revoke</button>
        </div>
      </td>
    </tr>`;
        })
        .join('')
    : `<tr><td colspan="9" style="color:var(--muted)">${filter === 'renewals' ? 'No filings due for renewal.' : 'No applications yet.'}</td></tr>`;

  const tab = (key: 'all' | 'renewals', label: string) =>
    `<a class="mcp-tab${filter === key ? ' on' : ''}" href="/admin/privacy${key === 'renewals' ? '?filter=renewals' : ''}">${esc(label)}</a>`;

  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap">
    <p class="mcp-eyebrow">Admin · Manifest Privacy</p>
    <h1 class="mcp-h1">CBP filing queue</h1>
    <p class="mcp-sub">${esc(CBP_CERT_HINT)}</p>
    <p class="mcp-sub">Work each row left to right: clear the pre-filing checklist, open the executed PDF, copy the certification text, file it, then record the submission and CBP's reference. CBP does not auto-renew — remind the customer at 18 months and re-file 60–90 days before expiry.</p>
    <div class="mcp-tabs">${tab('all', 'All')}${tab('renewals', 'Renewals due')}</div>
    <div class="mcp-tbl-wrap">
      <table class="mcp-tbl">
        <thead><tr><th>Applicant</th><th>Status</th><th>Paid</th><th>Renewal</th><th>Variations</th><th>Pre-filing checks</th><th>Executed PDF · SHA-256</th><th>Audit trail</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <p class="mcp-scrollhint">Swipe the table sideways for the pre-filing checklist, the executed PDF, and the filing actions.</p>
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
  const dbas = (app.dbaNames ?? []).filter(Boolean);
  const jurisdiction = [app.stateOfOrg, app.countryOfOrg].filter(Boolean).join(', ');
  const lines = [
    'Request for confidential treatment of vessel manifest data under 19 CFR 103.31(d).',
    `Importer / consignee: ${app.grantorLegalName || ''}`,
    dbas.length ? `Also does business as: ${dbas.join('; ')}` : '',
    `Entity type: ${app.entityType || ''}${jurisdiction ? ` organized under ${jurisdiction}` : ''}`,
    app.residency ? `U.S. residency: ${app.residency}` : '',
    `IRS EIN: ${app.einOrImporterNo || ''}`,
    app.iorNumber ? `Importer of record number: ${app.iorNumber}` : '',
    `Physical address: ${app.grantorAddress || ''}`,
    `Name(s) to be kept confidential: ${names}`,
    `Address(es): ${addrs}`,
    (app.partnerNames ?? []).length ? `Partners: ${(app.partnerNames ?? []).join('; ')}` : '',
    'The importer/consignee named above certifies that it requests confidential treatment of the above names and addresses appearing in vessel manifest data pursuant to 19 CFR 103.31(d), and that the information supplied is true and correct to the best of its knowledge and belief.',
    `Submitted by its authorized agent and attorney under 19 CFR 103.31(d): QuoteFleet, Inc. A limited power of attorney restricted to this confidentiality request is on file and will be produced on request.`,
    `Signed by: ${app.signerName || ''}${app.signerTitle ? `, ${app.signerTitle}` : ''}${app.signerEmail ? ` (${app.signerEmail})` : ''}`,
    `Authorization executed: ${app.signedAt ? new Date(app.signedAt).toISOString().slice(0, 10) : 'n/a'}; document SHA-256: ${app.docSha256 || 'n/a'}.`,
  ];
  return lines.filter(Boolean).join('\n');
}

const ADMIN_JS = `
(function(){
  function msg(t,kind){var m=document.getElementById('mcp-admin-msg');if(m){m.textContent=t||'';m.className='mcp-msg'+(kind?' '+kind:'');}}
  [].slice.call(document.querySelectorAll('[data-cert]')).forEach(function(b){b.addEventListener('click',function(){
    var ta=document.querySelector('[data-certtext="'+b.getAttribute('data-cert')+'"]');if(!ta)return;
    ta.hidden=false;ta.select();try{document.execCommand('copy');msg('CBP certification text copied.','ok');}catch(e){msg('Select the text and copy manually.','err');}
    setTimeout(function(){ta.hidden=true;},50);
  });});
  // Print the executed PDF: open it in a hidden frame and drive the browser's
  // own print dialog, so the operator never has to download-then-open.
  [].slice.call(document.querySelectorAll('[data-print]')).forEach(function(b){b.addEventListener('click',function(){
    var url=b.getAttribute('data-print');var f=document.createElement('iframe');
    f.style.position='fixed';f.style.right='0';f.style.bottom='0';f.style.width='0';f.style.height='0';f.style.border='0';
    f.src=url;f.onload=function(){try{f.contentWindow.focus();f.contentWindow.print();}catch(e){window.open(url,'_blank','noopener');}};
    document.body.appendChild(f);msg('Opening the print dialog\\u2026','ok');
  });});
  [].slice.call(document.querySelectorAll('[data-act]')).forEach(function(b){b.addEventListener('click',function(){
    var act=b.getAttribute('data-act'),id=b.getAttribute('data-id');
    var payload={};
    if(act==='submit'){
      var ch=window.prompt('How was this filed with CBP? (portal / email / mail)','portal');
      if(ch===null)return; payload.channel=(ch||'portal').trim().toLowerCase();
      var sref=window.prompt('CBP reference / confirmation number, if one was issued (optional):','');
      if(sref===null)return; if(sref.trim())payload.reference=sref.trim();
    }
    if(act==='confirm'){
      if(!window.confirm('Confirm CBP receipt and hide this importer on QuoteFleet?'))return;
      var ref=window.prompt('CBP confirmation / receipt reference (leave blank if none issued):','');
      if(ref===null)return; if(ref.trim())payload.reference=ref.trim();
      var cch=window.prompt('Channel it was filed through (portal / email / mail):','portal');
      if(cch===null)return; payload.channel=(cch||'portal').trim().toLowerCase();
    }
    if(act==='refile'){
      if(!window.confirm('Re-file this authorization for a fresh 2-year term? This clones the signed filing into a new Submitted request.'))return;
      var rch=window.prompt('How are you re-filing with CBP? (portal / email / mail)','portal');
      if(rch===null)return; payload.channel=(rch||'portal').trim().toLowerCase();
      var rref=window.prompt('CBP reference for this re-filing (optional):','');
      if(rref===null)return; if(rref.trim())payload.reference=rref.trim();
    }
    if(act==='revoke'&&!window.confirm('Revoke this authorization?'))return;
    b.disabled=true;
    fetch('/api/admin/privacy/'+id+'/'+act,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
      .then(function(r){b.disabled=false;
        if(r.ok){msg('Done \\u2014 reloading\\u2026','ok');setTimeout(function(){location.reload();},600);return;}
        // The pre-filing gate refused. Show WHICH checks are failing and offer a
        // deliberate override (recorded in the audit trail as forced).
        if(r.body&&r.body.failures&&r.body.failures.length){
          var names=r.body.failures.map(function(f){return '\\u2022 '+f.label+' \\u2014 '+f.detail;}).join('\\n');
          if(window.confirm('Pre-filing checks are failing:\\n\\n'+names+'\\n\\nFile anyway? This is recorded in the audit trail as an override.')){
            payload.force=true;b.disabled=true;
            fetch('/api/admin/privacy/'+id+'/'+act,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(payload)})
              .then(function(r2){b.disabled=false;if(r2.ok){msg('Filed with override \\u2014 reloading\\u2026','ok');setTimeout(function(){location.reload();},600);}else{msg('Action failed','err');}})
              .catch(function(){b.disabled=false;msg('Action failed','err');});
            return;
          }
          msg('Not filed \\u2014 fix the failing checks first.','err');return;
        }
        msg(r.body.error||'Action failed','err');})
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

    <p class="mcp-honest"><b>How this works, honestly:</b> The CBP filing is what stops your future shipments appearing on third-party trade-data trackers, and it is not retroactive — shipments already published stay in the historical record. We prepare and submit that request to CBP on your behalf; QuoteFleet is not CBP and has no automated filing connection to it. Being “Hidden on QuoteFleet” is the immediate part, and is not the same as removal from CBP’s feed.</p>
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

/** The landing page for the signer's email round-trip link. Rendered for both
 *  outcomes so a browser navigation never lands on a raw JSON error. */
export function renderPrivacyVerified(opts: {
  ok: boolean;
  token: string | null;
  email: string | null;
}): string {
  const { ok, token, email } = opts;
  const body = `
  <style>${MCP_CSS}</style>
  <main class="mcp-wrap mcp-narrow">
    <a class="mcp-back" href="/manifest-privacy">&larr; Manifest Privacy</a>
    <p class="mcp-eyebrow">Manifest Privacy</p>
    <h1 class="mcp-h1">${ok ? 'Email confirmed' : 'This link has expired'}</h1>
    <p class="mcp-sub">${
      ok
        ? `Thanks${email ? ` — ${esc(email)} is confirmed` : ''}. Your authorization can now go to CBP. We prepare and submit it on your behalf, and once CBP has it on file your company is suppressed on the public manifest records for your future shipments. You’ll see your status move from Signed to Submitted to Confirmed.`
        : 'This confirmation link has already been used or is no longer valid. Open your request and send yourself a fresh link — nothing has been filed, and nothing is lost.'
    }</p>
    <div class="mcp-card">
      <div class="mcp-actions">
        ${token ? `<a class="mcp-btn primary" href="/privacy/apply/${esc(token)}">Open my request <span class="arr">&rarr;</span></a>` : `<a class="mcp-btn primary" href="/privacy/apply">Open my request <span class="arr">&rarr;</span></a>`}
        <a class="mcp-btn" href="/privacy/account">View my account</a>
      </div>
    </div>
    <p class="mcp-honest"><b>How this works, honestly:</b> The CBP filing is what stops your future shipments appearing on third-party trade-data trackers, and it is not retroactive — shipments already published stay in the historical record. We prepare and submit that request to CBP on your behalf; QuoteFleet is not CBP and has no automated filing connection to it. Being “Hidden on QuoteFleet” is the immediate part, and is not the same as removal from CBP’s feed.</p>
  </main>`;
  return layout({
    title: `${ok ? 'Email confirmed' : 'Link expired'} — Manifest Privacy | QuoteFleet`,
    description: 'Confirm the business email on your Manifest Privacy authorization.',
    canonicalPath: '/privacy/verify',
    bodyHtml: body,
  });
}

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
