/**
 * /admin/guides — the human-review gate for the SEO content engine.
 *
 * The generator files drafts into seo_content_pages with status='in_review'.
 * These superadmin-only routes let a reviewer see the queue, read a draft
 * alongside the FROZEN data snapshot it was generated from, and then approve
 * (→ published, feeds /guides + the sitemap) or reject (→ archived).
 *
 * THE REVIEWER IS THE ONLY PATH TO LIVE. There is no route here — or anywhere —
 * that publishes without an explicit human approve action, and approveSeoPage
 * only ever promotes a row that is currently 'in_review'. Every mutation
 * appends an immutable row to seo_content_approvals inside the store helper, so
 * "who published this" is always answerable.
 *
 * WHY THE DATA SNAPSHOT IS ON SCREEN: the reviewer's actual job is not
 * proofreading, it is verifying that the numbers in the prose match the numbers
 * the corpus produced. Showing the frozen aggregate next to the body makes that
 * a glance instead of an investigation.
 *
 * Gating follows the house split: requireSuperAdminPage for the HTML page (it
 * redirects a browser to /login rather than returning 401 JSON), and
 * requireAuth + requireSuperAdmin for the JSON mutations.
 */

import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin, requireSuperAdminPage } from '../middleware.js';
import { esc, layout } from '../directory/pages.js';
import { setNoStore } from '../directory/httpCache.js';
import {
  approveSeoPage,
  editSeoPage,
  getSeoPageById,
  listSeoApprovals,
  listSeoPagesInReview,
  countPublishedGuides,
  getSeoEngineSettings,
  setSeoEngineKillSwitch,
} from './store.js';
import { renderMarkdown } from './guidesPages.js';
import { rejectSeoPage } from './store.js';
import { isSeoEngineFlagEnabled } from './seoEngineGate.js';
import { livePullsAllowed } from '../directory/externalPullGuard.js';
import type { SeoContentPage } from '../../db/schema.js';

const ADMIN_CSS = `
.gq-wrap{max-width:1100px;margin:0 auto;padding:32px 24px 80px}
.gq-head{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:space-between;margin:0 0 24px}
.gq-head h1{margin:0 0 8px;font-size:26px;line-height:1.25;color:var(--ink)}
.gq-head p{margin:0;color:var(--muted);font-size:14px;line-height:1.6}
.gq-status{display:flex;flex-wrap:wrap;gap:8px}
.gq-pill{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:var(--radius-chip);border:1px solid var(--border);background:var(--surface-2);color:var(--ink-soft);font-size:12px;min-height:24px}
.gq-pill-off{border-color:var(--border-strong);color:var(--muted)}
.gq-card{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface);padding:24px;margin:0 0 16px}
.gq-card h2{margin:0 0 8px;font-size:18px;line-height:1.35;color:var(--ink)}
.gq-card .gq-sub{margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.6}
.gq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin:0 0 16px}
.gq-stat{border:1px solid var(--border);border-radius:var(--radius);background:var(--surface-2);padding:12px}
.gq-stat dt{margin:0 0 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.gq-stat dd{margin:0;font-size:16px;color:var(--ink);font-family:var(--font-mono)}
.gq-actions{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0 0}
.gq-body{border-top:1px solid var(--border);margin:16px 0 0;padding:16px 0 0;color:var(--ink);font-size:15px;line-height:1.6;max-height:480px;overflow:auto}
.gq-body h2{font-size:19px;margin:24px 0 8px}
.gq-body h3{font-size:16px;margin:16px 0 8px}
.gq-body p{margin:0 0 12px}
.gq-body ul,.gq-body ol{margin:0 0 12px;padding-left:24px}
.gq-empty{border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface-2);padding:32px;color:var(--muted)}
.gq-audit{margin:16px 0 0;font-size:12px;color:var(--muted);line-height:1.6}
`;

const ADMIN_JS = `
(function(){
  function post(url, body){
    return fetch(url, {
      method:'POST', headers:{'Content-Type':'application/json'},
      credentials:'same-origin', body: JSON.stringify(body||{})
    }).then(function(r){ return r.json().then(function(j){ return {ok:r.ok, j:j}; }); });
  }
  document.addEventListener('click', function(ev){
    var btn = ev.target.closest('[data-act]');
    if(!btn) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');
    if(act === 'approve' && !confirm('Publish this guide to /guides/? It will be live and enter the sitemap.')) return;
    if(act === 'reject' && !confirm('Archive this draft? It will not be published.')) return;
    if(act === 'killswitch'){
      var on = btn.getAttribute('data-on') === '1';
      btn.disabled = true;
      post('/api/admin/guides/kill-switch', {killSwitch: !on}).then(function(){ location.reload(); });
      return;
    }
    btn.disabled = true;
    post('/api/admin/guides/' + id + '/' + act, {}).then(function(res){
      if(res.ok){ location.reload(); }
      else { alert('Failed: ' + ((res.j && res.j.error) || 'unknown')); btn.disabled = false; }
    });
  });
})();
`;

function adminUserId(req: Request): number | undefined {
  const id = (req as unknown as { user?: { id?: number } })?.user?.id;
  return typeof id === 'number' ? id : undefined;
}

function stat(label: string, value: string): string {
  return `<div class="gq-stat"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

/** The frozen aggregate, rendered as the reviewer's fact-check panel. */
function renderDataPanel(page: SeoContentPage): string {
  const d = (page.originalData ?? {}) as Record<string, unknown>;
  const n = (k: string): string => {
    const v = d[k];
    return typeof v === 'number' ? v.toLocaleString('en-US') : '—';
  };
  const share = (k: string): string => {
    const v = d[k];
    return typeof v === 'number' ? `${Math.round(v * 100)}%` : '—';
  };
  return `<div class="gq-grid">
    ${stat('Carriers in cut', n('totalInCut'))}
    ${stat('Sample (with fleet)', n('sampleSize'))}
    ${stat('Median fleet', n('median'))}
    ${stat('P25 / P75', `${n('p25')} / ${n('p75')}`)}
    ${stat('Max fleet', n('max'))}
    ${stat('Total trucks', n('totalPowerUnits'))}
    ${stat('Owner-operators', share('ownerOperatorShare'))}
    ${stat('Unique-data score', page.uniqueDataScore == null ? '—' : String(page.uniqueDataScore))}
  </div>`;
}

export function renderGuidesReviewQueue(
  drafts: Array<{ page: SeoContentPage; audit: Array<{ action: string; actorType: string; createdAt: Date | null }> }>,
  meta: { published: number; flagEnabled: boolean; killSwitch: boolean; spendReason: string; spendAllowed: boolean },
): string {
  const cards = drafts
    .map(({ page, audit }) => {
      const hist = audit
        .map((a) => `${esc(a.action)} by ${esc(a.actorType)}${a.createdAt ? ` · ${esc(new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' '))}` : ''}`)
        .join(' — ');
      return `<article class="gq-card">
      <h2>${esc(page.title)}</h2>
      <p class="gq-sub">/guides/${esc(page.slug)} · ${esc(page.authorEntity)}</p>
      ${renderDataPanel(page)}
      <div class="gq-body">${renderMarkdown(page.content)}</div>
      <div class="gq-actions">
        <button class="btn btn-primary" data-act="approve" data-id="${page.id}">Approve &amp; publish</button>
        <button class="btn btn-secondary" data-act="reject" data-id="${page.id}">Reject &amp; archive</button>
      </div>
      ${hist ? `<p class="gq-audit">${hist}</p>` : ''}
    </article>`;
    })
    .join('\n');

  const body = `<style>${ADMIN_CSS}</style>
  <div class="gq-wrap">
    <div class="gq-head">
      <div>
        <h1>Guides review queue</h1>
        <p>Drafts generated from the FMCSA carrier census. Nothing is published until you approve it. Check the prose against the frozen data panel before approving.</p>
      </div>
      <div class="gq-status">
        <span class="gq-pill${meta.flagEnabled ? '' : ' gq-pill-off'}">Engine ${meta.flagEnabled ? 'enabled' : 'OFF (SEO_ENGINE_ENABLED unset)'}</span>
        <span class="gq-pill${meta.spendAllowed ? '' : ' gq-pill-off'}">LLM spend ${meta.spendAllowed ? 'allowed' : 'blocked'}</span>
        <span class="gq-pill">${meta.published} published</span>
        <button class="gq-pill" data-act="killswitch" data-on="${meta.killSwitch ? '1' : '0'}" type="button">Kill switch: ${meta.killSwitch ? 'ON' : 'off'}</button>
      </div>
    </div>
    ${
      drafts.length
        ? cards
        : `<div class="gq-empty"><p>No drafts awaiting review.</p><p>${esc(meta.spendReason)}</p></div>`
    }
  </div>
  <script>${ADMIN_JS}</script>`;

  return layout({
    title: 'Guides review queue — Admin | QuoteFleet',
    description: 'SEO guides awaiting human review.',
    canonicalPath: '/admin/guides',
    bodyHtml: body,
    // An admin surface must never be indexed, and must never be shared-cached.
    robots: 'noindex, nofollow',
  });
}

export function registerAdminGuidesRoutes(app: Express): void {
  /* ─── The review screen ─── */
  app.get('/admin/guides', requireSuperAdminPage, async (_req: Request, res: Response, next) => {
    try {
      const rows = await listSeoPagesInReview();
      const drafts = [];
      for (const page of rows) {
        drafts.push({ page, audit: await listSeoApprovals(page.id) });
      }
      const [published, settings] = await Promise.all([
        countPublishedGuides(),
        getSeoEngineSettings().catch(() => ({ killSwitch: false }) as { killSwitch: boolean }),
      ]);
      const spend = livePullsAllowed('anthropic_seo');
      setNoStore(res);
      res.type('html').send(
        renderGuidesReviewQueue(drafts, {
          published,
          flagEnabled: isSeoEngineFlagEnabled(),
          killSwitch: settings.killSwitch,
          spendReason: spend.reason,
          spendAllowed: spend.allowed,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  /* ─── Approve → publish ─── */
  app.post(
    '/api/admin/guides/:id/approve',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
      try {
        const published = await approveSeoPage(id, adminUserId(req));
        // Null means the row was missing or not in_review (already published /
        // archived) — the store only promotes in_review, so this is a safe 409.
        if (!published) {
          return res
            .status(409)
            .json({ error: 'not_in_review', message: 'Only in_review drafts can be approved.' });
        }
        // The new URL must enter the sitemap; recompute off the request path.
        void import('../directory/sitemapCache.js')
          .then((m) => m.recomputeAndPersistSitemap())
          .catch((err) => console.warn('[seo] sitemap recompute after publish failed:', err));
        return res.json({ ok: true, slug: published.slug, status: published.status });
      } catch (err) {
        console.error('[seo] approve failed:', (err as Error)?.message);
        return res.status(500).json({ error: 'approve_failed' });
      }
    },
  );

  /* ─── Reject → archive ─── */
  app.post(
    '/api/admin/guides/:id/reject',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
      try {
        const archived = await rejectSeoPage(id, adminUserId(req));
        if (!archived) {
          return res
            .status(409)
            .json({ error: 'not_in_review', message: 'Only in_review drafts can be rejected.' });
        }
        return res.json({ ok: true, status: archived.status });
      } catch (err) {
        console.error('[seo] reject failed:', (err as Error)?.message);
        return res.status(500).json({ error: 'reject_failed' });
      }
    },
  );

  /* ─── Edit a draft (does not change status) ─── */
  const editSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    metaDescription: z.string().max(320).nullable().optional(),
    excerpt: z.string().max(600).nullable().optional(),
    content: z.string().min(1).optional(),
    canonical: z.string().url().max(2048).nullable().optional(),
    notes: z.string().max(2000).optional(),
  });

  app.patch(
    '/api/admin/guides/:id',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const id = Number.parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid_id' });
      const parsed = editSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
      const { notes, ...fields } = parsed.data;
      try {
        const updated = await editSeoPage(id, fields, adminUserId(req), notes);
        if (!updated) return res.status(404).json({ error: 'not_found' });
        return res.json({ ok: true, status: updated.status });
      } catch (err) {
        console.error('[seo] edit failed:', (err as Error)?.message);
        return res.status(500).json({ error: 'edit_failed' });
      }
    },
  );

  /* ─── Kill switch ─── */
  app.post(
    '/api/admin/guides/kill-switch',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const parsed = z.object({ killSwitch: z.boolean() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
      try {
        const row = await setSeoEngineKillSwitch(parsed.data.killSwitch, adminUserId(req));
        return res.json({ ok: true, killSwitch: row.killSwitch });
      } catch (err) {
        console.error('[seo] kill-switch write failed:', (err as Error)?.message);
        return res.status(500).json({ error: 'kill_switch_failed' });
      }
    },
  );

  /* ─── Generate a batch (explicit, superadmin-triggered, never a cron) ─── */
  app.post(
    '/api/admin/guides/generate',
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const parsed = z.object({ limit: z.number().int().min(1).max(25).optional() }).safeParse(
        req.body ?? {},
      );
      if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
      try {
        const [{ generateMatrixBatch }, { SEED_CELLS, DEFAULT_BATCH_LIMIT }] = await Promise.all([
          import('./articleGenerator.js'),
          import('./seedMatrix.js'),
        ]);
        const out = await generateMatrixBatch(
          SEED_CELLS,
          parsed.data.limit ?? DEFAULT_BATCH_LIMIT,
        );
        return res.json({ ok: true, ...out });
      } catch (err) {
        // A stale seed matrix throws here BY DESIGN — surface it verbatim so a
        // misconfigured cell is visible instead of silently producing nothing.
        console.error('[seo] batch generation failed:', (err as Error)?.message);
        return res.status(500).json({ error: 'generate_failed', message: (err as Error)?.message });
      }
    },
  );
}
