/**
 * Importer Search round 5 — COST SAFETY for the shareable search link, plus the
 * holistic polish pass over the surfaces a real user hits first.
 *
 * Round 4 made a search deep-linkable and had the arrival AUTO-RUN it. That is
 * the right UX and the wrong economics: a link pasted into a channel, kept in a
 * bookmark, or re-opened a week later triggered a PAID ImportYeti pull for any
 * lane that had fallen out of (or never entered) the cache. ~$20 of credits were
 * burned in two days; the standing rule is that credits are spent DELIBERATELY,
 * for a real user who asked for the data.
 *
 * The fix is a CACHE PROBE: a deep-linked arrival sends `cacheOnly: true`, which
 * forces live pulls off for that request. A cached lane is served in full for $0
 * (the shared link still works exactly like a shared search); an uncached lane
 * answers `needsLivePull` without opening a socket, and the client renders the
 * restored form plus an explicit "Run search" button.
 *
 * NO NETWORK. `globalThis.fetch` is replaced with a spy that THROWS, so any test
 * here that reached a provider would fail loudly rather than spend a credit.
 *
 *   R5-1  probe on a cache MISS  → needsLivePull, zero leads, zero fetches
 *   R5-2  probe on a cache HIT   → full results, cached, still zero fetches
 *   R5-3  probe flag parsing     → opt-in only; a normal search is never probed
 *   R5-4  probe is side-effect-free on the anti-abuse live-search counter
 *   R5-5  client wiring          → the deep-link arrival probes, a typed search does not
 *   R5-6  the "Run search" gate  → a real button, honest copy, and it re-runs for real
 *   R5-7  first-hit surfaces    → visible h1, card-shaped skeleton, honest busy state
 *   R5-8  the first card        → no contradictory flag, AA badges, readable facets
 *   R5-9  layout defects        → lock-pill shove, 2px rhythm, toolbar, rings, typeahead
 *   R5-10 the profile page      → port spelling, y/x axes, plot width, the fold
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { __setLivePullsForTests } from './externalPullGuard.js';
import { renderImporterSearchPage, handleImporterSearch } from './importerPages.js';
import { normalizePortName } from './importerLeads.js';
import {
  aggregateProfile,
  renderImporterProfilePage,
  anonRevealState,
} from './importerProfile.js';
import { FIXTURE_PROFILE_ROWS, FIXTURE_PROFILE_SLUG } from './importerFixture.js';
import { __resetQuotaStateForTests } from './importerQuota.js';

const realFetch = globalThis.fetch;

/** Any outbound call from this file is a bug — make it explode, not bill. */
function forbidNetwork() {
  const spy = vi.fn(() => {
    throw new Error('R5: a cache probe must never open a socket');
  });
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  process.env.IMPORTYETI_API_KEY = 'test';
});
afterEach(() => {
  __setLivePullsForTests(null);
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.IMPORTYETI_API_KEY;
  __resetQuotaStateForTests();
});

function fakeRes(): Response & { _status: number; _json: Record<string, unknown> } {
  const res: Partial<Response> & { _status: number; _json: Record<string, unknown> } = {
    _status: 200,
    _json: {},
    status(code: number) {
      this._status = code;
      return this as Response;
    },
    json(body: unknown) {
      this._json = body as Record<string, unknown>;
      return this as Response;
    },
    type() {
      return this as Response;
    },
    send() {
      return this as Response;
    },
  };
  return res as Response & { _status: number; _json: Record<string, unknown> };
}
const fakeReq = (body: unknown): Request => ({ body } as Request);

/** In-memory BOL store. `seeded` makes every lookup a HIT (key-agnostic), which
 *  is how a lane that is genuinely in `importer_bol_cache` behaves. */
function memBolStore(seeded?: Record<string, unknown>[]) {
  const m = new Map<string, { rows: Record<string, unknown>[]; creditsRemaining: number | null; fetchedAt: Date }>();
  return {
    gets: [] as string[],
    async get(k: string) {
      this.gets.push(k);
      if (seeded) return { rows: seeded, creditsRemaining: 42, fetchedAt: new Date() };
      return m.get(k) ?? null;
    },
    async put(k: string, rows: Record<string, unknown>[], creditsRemaining: number | null) {
      m.set(k, { rows, creditsRemaining, fetchedAt: new Date() });
    },
  };
}
const memContactStore = () => ({
  async get() {
    return null;
  },
  async getMany() {
    return new Map();
  },
  async put() {
    /* no-op */
  },
});

const CACHED_ROWS = [
  {
    company_name: 'Robert Bosch Tool Corp',
    company_address: '1980 Indian Creek Rd, Lincolnton, NC 28092',
    company_state: 'NC',
    supplier_name: 'Scintilla AG',
    supplier_country_code: 'DE',
    product_description: 'Saw blades & parts',
    hs_code: '820299',
    entry_port: 'Savannah, Ga.',
    company_shipments_12m: 10761,
    company_total_shipments: 169818,
    company_teu_12m: 18910,
    notify_party_name: 'Expeditors Intl',
    arrival_date: '07/31/2026',
  },
];

const SHARED_LINK_BODY = { entryPort: 'Savannah, GA', cacheOnly: true };

describe('R5-1 · a deep-linked search on a cache MISS never spends a credit', () => {
  it('answers needsLivePull with zero leads and ZERO outbound calls', async () => {
    // The guard is deliberately opted IN here, proving the probe — not the cost
    // guard — is what stops the pull. Even with live pulls fully permitted, a
    // shared link must not buy data on its own.
    __setLivePullsForTests(true);
    const fetchSpy = forbidNetwork();
    const res = fakeRes();

    await handleImporterSearch(fakeReq(SHARED_LINK_BODY), res, {
      bolCache: memBolStore(),
      contactCache: memContactStore(),
    });

    expect(res._status).toBe(200);
    expect(res._json.needsLivePull).toBe(true);
    expect(res._json.cacheProbe).toBe(true);
    expect(res._json.leads).toEqual([]);
    expect(res._json.count).toBe(0);
    expect(res._json.pulledLive).toBe(false);
    expect(res._json.cached).toBe(false);
    expect(res._json.source).toBe('cache-probe');
    // The single thing this round exists to guarantee.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says plainly that nothing was charged and what running it would cost', async () => {
    // Copy honesty is part of the contract: the user is being asked to authorise
    // a spend, so the message must state the current position (nothing charged)
    // and the consequence (a live pull) — never imply a broken link or a failure.
    __setLivePullsForTests(true);
    forbidNetwork();
    const res = fakeRes();
    await handleImporterSearch(fakeReq(SHARED_LINK_BODY), res, {
      bolCache: memBolStore(),
      contactCache: memContactStore(),
    });
    const msg = String(res._json.message);
    expect(msg).toMatch(/nothing has been charged/i);
    expect(msg).toMatch(/live customs records/i);
    expect(msg).not.toMatch(/error|unavailable|failed/i);
  });

  it('is distinguishable from the guard-blocked cache-only environment state', async () => {
    // The two states LOOK alike (no data, no spend) but mean different things:
    // `cacheOnly` = this environment can never pull; `needsLivePull` = it can,
    // and it is waiting for the user. The client renders different UI for each,
    // so the response keys must not collide.
    __setLivePullsForTests(true);
    forbidNetwork();
    const res = fakeRes();
    await handleImporterSearch(fakeReq(SHARED_LINK_BODY), res, {
      bolCache: memBolStore(),
      contactCache: memContactStore(),
    });
    expect(res._json.needsLivePull).toBe(true);
    expect(res._json.cacheOnly).toBeUndefined();
  });
});

describe('R5-2 · a deep-linked search on a cache HIT still opens instantly, for free', () => {
  it('auto-runs and returns the full result set with no gate and no fetch', async () => {
    const fetchSpy = forbidNetwork();
    const res = fakeRes();

    await handleImporterSearch(fakeReq(SHARED_LINK_BODY), res, {
      bolCache: memBolStore(CACHED_ROWS),
      contactCache: memContactStore(),
    });

    expect(res._status).toBe(200);
    // No gate: the shared link behaves exactly as it did in round 4.
    expect(res._json.needsLivePull).toBeUndefined();
    expect(res._json.cached).toBe(true);
    expect(res._json.pulledLive).toBe(false);
    expect((res._json.leads as unknown[]).length).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the cache exactly as a normal search does — no extra probe request', async () => {
    // "Without adding an API call": the auto-run POST *is* the probe, and it
    // performs the same single indexed cache lookup a normal search performs
    // first anyway.
    forbidNetwork();
    const store = memBolStore(CACHED_ROWS);
    await handleImporterSearch(fakeReq(SHARED_LINK_BODY), fakeRes(), {
      bolCache: store,
      contactCache: memContactStore(),
    });
    expect(store.gets).toHaveLength(1);
  });
});

describe('R5-3 · probing is strictly opt-in', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['boolean true', true, true],
    ['string "true"', 'true', true],
    ['string "1"', '1', true],
    ['number 1', 1, true],
    ['absent', undefined, false],
    ['false', false, false],
    ['string "0"', '0', false],
  ];
  for (const [label, value, expected] of cases) {
    it(`cacheOnly=${label} → ${expected ? 'probe' : 'normal search'}`, async () => {
      __setLivePullsForTests(true);
      const fetchSpy = vi.fn(async () => ({
        ok: true,
        json: async () => ({ requestCost: 1, creditsRemaining: 9, data: { data: CACHED_ROWS } }),
      })) as unknown as typeof fetch;
      globalThis.fetch = fetchSpy;

      const body: Record<string, unknown> = { entryPort: 'Savannah, GA' };
      if (value !== undefined) body.cacheOnly = value;
      const res = fakeRes();
      await handleImporterSearch(fakeReq(body), res, {
        bolCache: memBolStore(),
        contactCache: memContactStore(),
      });

      if (expected) {
        expect(res._json.needsLivePull).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
      } else {
        // A NON-probe search on a miss is still allowed to pull — round 5 must
        // not quietly break the normal, deliberate search path.
        expect(res._json.needsLivePull).toBeUndefined();
        expect(fetchSpy).toHaveBeenCalled();
      }
    });
  }
});

describe('R5-4 · the probe is invisible to the anti-abuse live-search counter', () => {
  it('does not record a live search, so following links cannot exhaust the daily cap', async () => {
    __setLivePullsForTests(true);
    forbidNetwork();
    const deps = { bolCache: memBolStore(), contactCache: memContactStore() };
    // Hammer the shared link far past the per-IP daily live-pull cap.
    for (let i = 0; i < 40; i++) {
      await handleImporterSearch(fakeReq(SHARED_LINK_BODY), fakeRes(), deps);
    }
    // A real, deliberate search afterwards must still be allowed to pull.
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ requestCost: 1, creditsRemaining: 9, data: { data: CACHED_ROWS } }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchSpy;
    const res = fakeRes();
    await handleImporterSearch(fakeReq({ entryPort: 'Savannah, GA' }), res, {
      bolCache: memBolStore(),
      contactCache: memContactStore(),
    });
    expect(res._json.searchLimited).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ── client wiring (the rendered page's inline script) ────────────────────────
const html = renderImporterSearchPage();
const pQuota = { allowed: true, used: 2, remaining: 3, limit: 5, signedIn: false } as const;
const profileHtml5 = renderImporterProfilePage(
  aggregateProfile([...FIXTURE_PROFILE_ROWS], FIXTURE_PROFILE_SLUG),
  pQuota,
  anonRevealState(),
);

describe('R5-5 · the client only probes on a deep-linked arrival', () => {
  it('doSearch takes a cacheOnly arg and puts it on the request body', () => {
    expect(html).toContain('function doSearch(payload,page,append,cacheOnly)');
    expect(html).toContain('if(cacheOnly) body.cacheOnly=true;');
  });

  it('restoreFromUrl (the shared-link path) passes it', () => {
    expect(html).toContain('doSearch(curPayload,1,false,true);');
  });

  it('the form submit and Load more do NOT — a deliberate search still pulls', () => {
    // Both call doSearch with the 4th arg omitted/undefined.
    expect(html).toContain('doSearch(payload,1,false);');
    expect(html).toContain('doSearch(curPayload,curPage,true);');
  });

  it('the status line tells the truth about which of the two is running', () => {
    expect(html).toContain('Opening a shared search \\u2014 checking the cache\\u2026');
    expect(html).toContain('Searching live customs records\\u2026');
  });
});

describe('R5-6 · the un-cached shared link renders a deliberate "Run search" gate', () => {
  it('branches on needsLivePull before the generic error path', () => {
    expect(html).toContain('if(j.needsLivePull){');
  });

  it('offers a real button that re-runs the SAME search without the probe flag', () => {
    expect(html).toContain("label:'Run search'");
    // The 4th arg is omitted → a normal, live-allowed search.
    expect(html).toContain('onClick:function(){ doSearch(payload,page,false); }');
    expect(html).toContain('imp-empty-run');
  });

  it('emptyState supports an action button, and it is styled in both themes', () => {
    expect(html).toContain('function emptyState(icon,title,body,tips,warn,action)');
    // Tokens only — no hardcoded colours beyond the on-accent foreground.
    expect(html).toContain('.imp-empty-act .imp-empty-run{background:var(--accent-fill)');
    expect(html).toContain('.imp-empty-act .imp-empty-hint{font-size:12px;font-weight:600;color:var(--muted)}');
  });

  it('keeps the button from being orphaned beside a wrapped hint at 375', () => {
    expect(html).toContain('.imp-empty-act .imp-empty-run{flex:1 1 100%;justify-content:center}');
  });

  it('is honest: it says the state is restored, that nothing was charged, and what running costs', () => {
    expect(html).toContain('This shared search is ready to run');
    expect(html).toContain('nothing has been charged');
    expect(html).toContain('Shared search restored \\u2014 nothing charged.');
    expect(html).toContain("hint:'Pulls live customs records'");
    // It must NOT read as a broken link — the shared state is still there.
    expect(html).toContain('Filters, sort and facets are already set');
  });

  it('clears the stale results toolbar so no old count describes an empty view', () => {
    expect(html).toContain("toolbar.classList.remove('on');");
  });
});

// ── R5-7 · the round-5 polish pass ──────────────────────────────────────────
describe('R5-7 · the surfaces a user hits FIRST', () => {
  it('the initial state has a real, visible, left-aligned page header', () => {
    // It was sr-only, so the most-visited surface on the page opened on a bare
    // filter panel with no title and no statement of what the tool does.
    expect(html).toContain('<header class="imp-head">');
    expect(html).toContain('<h1>US Importers Directory</h1>');
    expect(html).toContain('.imp-head{text-align:left');
    expect(html).not.toContain('<h1 class="imp-sr-only"');
  });

  it('the loading skeleton is built from the CARD\'S OWN layout, so it reserves the real height', () => {
    // 4 plain bars (115px) standing in for a 327px card made the results column
    // jump ~1,650px the instant the response landed.
    expect(html).toContain('function skelCard()');
    expect(html).toContain(".imp-card,.imp-skel{position:relative");
    expect(html).toContain("var c=T('div','imp-skel');");
    // …and NOT .imp-card, which is the results-only selector.
    expect(html).not.toContain("T('div','imp-card imp-skel')");
    // the footer stands in button-shaped blocks at the real 44px control height
    expect(html).toContain('.imp-skel .sk-btn{width:112px;height:44px');
  });

  it('the skeleton is mixed against --ink so it is visible in DARK too', () => {
    // On the raw surface tokens it measured 1.13:1 in dark — an invisible
    // loading state that read as an empty card.
    expect(html).toContain('color-mix(in srgb,var(--ink) 16%,var(--surface-2)) 50%');
  });

  it('the busy button says what it is doing instead of just greying out', () => {
    expect(html).toContain('id="imp-search-l"');
    expect(html).toContain("btnLabel.textContent = busy ? 'Searching\\u2026' : 'Search importers'");
    expect(html).toContain('.imp-actions .btn-primary[disabled]{opacity:1');
  });

  it('the record strip stops telling the user to do what they just did', () => {
    expect(html).toContain("recordLine.textContent=cacheOnly?'checking the cache for this lane':'searching this lane now'");
  });

  it('a phone scrolls to the results, which otherwise start ~1,080px down', () => {
    expect(html).toContain('if(window.innerWidth<=900){');
    expect(html).toContain("results.scrollIntoView({block:'start',behavior:'smooth'})");
  });
});

describe('R5-8 · the first result card tells the truth', () => {
  it('carries no supplier flag beside the US importer\'s name', () => {
    // It rendered flag(supplier_country) directly above "United States · NC",
    // and degraded to the literal letters "DE" wherever flag glyphs are absent.
    expect(html).not.toContain("T('span','imp-flag',flag(l.supplier_country))");
  });

  it('the winnability badge and incumbent chip are mixed toward --ink for AA', () => {
    expect(html).toContain('.imp-win.hi{background:color-mix(in srgb,var(--success) 15%,transparent);color:color-mix(in srgb,var(--success) 62%,var(--ink))');
    expect(html).toContain('color:color-mix(in srgb,var(--warn) 72%,var(--ink))');
  });

  it('facet rows are readable — no doubled country code, and named HS chapters', () => {
    // The label was `code + flag(code)`, which renders "DE de" wherever the flag
    // falls back to letterforms.
    expect(html).not.toContain("label:k+' '+flag(k)");
    expect(html).toContain('function countryLabel(code)');
    expect(html).toContain('function chapterName(c)');
  });
});

describe('R5-9 · layout defects that misdirected the eye', () => {
  it('the filter row top-aligns, so the lock pill cannot shove its neighbours', () => {
    // Now a declared grid (four filters, stepping 4 → 2 → 1 so none is ever
    // orphaned on its own line), but align-items:start is the load-bearing half
    // of this rule and must survive: it is what lets the Entry-port field grow
    // downward for the lock pill without re-centring its neighbours.
    expect(html).toContain('.imp-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;align-items:start}');
  });

  it('stacked input clusters use the 2px rhythm', () => {
    expect(html).toContain('.imp-grid{gap:2px 8px}');
    expect(html).toContain('.imp-more-grid{gap:2px 12px}');
  });

  it('the toolbar declares its two rows and starts both at the left edge', () => {
    expect(html).toContain('.imp-countwrap{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1 1 100%}');
    expect(html).toContain('flex:1 1 100%;margin-left:0}');
  });

  it('the quota chip is a status, not a look-alike of a selected control', () => {
    expect(html).toContain('.imp-profiles-left{display:none;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--ink-soft);background:var(--surface-2)');
  });

  it('the selected audience ring is not overpainted by the sibling divider', () => {
    expect(html).toContain('.imp-aud button[aria-pressed="true"],.imp-aud button[aria-pressed="true"]+button{border-left-color:transparent}');
    // …and in the 2x2 mobile grid, where the grey edge can land on top instead.
    expect(html).toContain('{border-left-color:transparent;border-top-color:transparent}');
  });

  it('the suggestion list closes before it can swallow a click on Search', () => {
    expect(html).toContain("document.addEventListener('pointerdown'");
  });
});

// ── R5-10 · the profile surface ─────────────────────────────────────────────
describe('R5-10 · the profile page above the fold and its chart', () => {
  it('normalizePortName fixes the provider spelling once, at the boundary', () => {
    // "Savannah, Ga." rendered on every card, in its title attribute AND inside
    // the origin= parameter of the RFQ deep link, so the quote request carried a
    // differently-spelled port from the one the user picked.
    expect(normalizePortName('Savannah, Ga.')).toBe('Savannah, GA');
    expect(normalizePortName('Long Beach, Ca')).toBe('Long Beach, CA');
    expect(normalizePortName('  Newark, nj.  ')).toBe('Newark, NJ');
    // Anything that is not a trailing 2-letter state token is left alone.
    expect(normalizePortName('Rotterdam, Netherlands')).toBe('Rotterdam, Netherlands');
    expect(normalizePortName('Yantian')).toBe('Yantian');
    expect(normalizePortName('')).toBeNull();
    expect(normalizePortName(null)).toBeNull();
  });

  it('the y-axis prints five DISTINCT ticks even when the peak is tiny', () => {
    // The gridlines are locked to four bands, so a peak of 2 used to print
    // "2, 2, 1, 1, 0" — Math.round collapsing 1.5 and 0.5 onto their neighbours.
    const small = aggregateProfile(
      [...FIXTURE_PROFILE_ROWS].slice(0, 3),
      FIXTURE_PROFILE_SLUG,
    );
    const h = renderImporterProfilePage(small, pQuota, anonRevealState());
    const yaxis = /<div class="impp-yaxis"[^>]*>(.*?)<\/div>/s.exec(h)?.[1] ?? '';
    const ticks = [...yaxis.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(ticks).toHaveLength(5);
    expect(new Set(ticks).size).toBe(5);
    expect(ticks[ticks.length - 1]).toBe('0');
  });

  it('a short series does not stretch into full-bleed slabs', () => {
    expect(profileHtml5).toMatch(/class="impp-chartwrap" style="--impp-plot-cap:\d+px"/);
    expect(profileHtml5).toContain('.impp-plot,.impp-xaxis{max-width:var(--impp-plot-cap,none)}');
  });

  it('every x-axis slot is a month, so a label sits under its OWN bar', () => {
    expect(profileHtml5).toContain('.impp-xaxis span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap}');
    expect(profileHtml5).not.toContain('.impp-xaxis{display:flex;justify-content:space-between');
  });

  it('the CBP privacy pitch no longer spends a quarter of the first screen', () => {
    // It is aimed at the importer being profiled, not the freight seller who is
    // actually visiting — so it sits after the data, not above it.
    const headEnd = profileHtml5.indexOf('impp-secbar');
    const privacyAt = profileHtml5.indexOf('impp-privacy"');
    expect(privacyAt).toBeGreaterThan(headEnd);
  });

  it('the header actions take the full row on a phone instead of hugging the right', () => {
    expect(profileHtml5).toContain('.impp-head-act{margin-left:0;width:100%}');
    expect(profileHtml5).toContain('.impp-head-act>*{flex:1 1 0;min-width:0;justify-content:center}');
  });

  it('"Quote this lane" is accent-filled, matching the search page\'s primary', () => {
    expect(profileHtml5).toContain('.impp-head-act .btn-primary{background:var(--accent-fill)');
  });

  it('the sticky section bar reads as chrome, not a hole cut through the cards', () => {
    expect(profileHtml5).toContain('backdrop-filter:blur(10px)');
    expect(profileHtml5).not.toContain('padding:8px 0;background:var(--bg)}');
  });

  it('"Expand all" sheds its second word on a phone, and the JS keeps the span', () => {
    expect(profileHtml5).toContain('<span class="impp-expand-x"> all</span>');
    expect(profileHtml5).toContain('.impp-expand-x{display:none}');
    // The old syncExpand set textContent, which destroyed the span on first run.
    expect(profileHtml5).toContain("if(verb && verb.nodeType === 3) verb.nodeValue");
  });

  it('the scroll chevrons are backed chips, so they cannot sit inside a label', () => {
    expect(profileHtml5).toContain('background:var(--surface-2);border:1px solid var(--border-strong);box-shadow:var(--shadow-sm)}');
  });

  it('KPI labels are sentence case on a phone and cannot orphan a word', () => {
    expect(profileHtml5).toContain('.impp-stat .sl{text-transform:none;letter-spacing:0;font-size:11px}');
    // Non-breaking spaces hold "12 mo" and "TEU / shipment" together.
    expect(profileHtml5).toContain('last 12 mo');
    expect(profileHtml5).toContain('Avg TEU / shipment');
  });

  it('the chart tooltip bails instead of clipping when the plot has no width', () => {
    expect(profileHtml5).toContain('if(!r.width) return;');
  });
});
