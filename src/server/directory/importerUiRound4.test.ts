/**
 * Importer Search UI round 4 — honesty, affordances, functional parity.
 *
 * NO NETWORK. Everything renders from the committed fixture, so not a single
 * ImportYeti / Hunter credit can be spent by this file.
 *
 *   R4-1  sample-scope disclosure → the page states what sort/filters cover
 *   R4-2  shareable search state  → the URL carries the search, and it is copyable
 *   R4-3  tab-strip affordance    → the section strip announces it can scroll
 *   R4-4  sortable table columns  → both real tables carry sortable, keyed headers
 *   R4-5  dayKey()                → the Date column's sort key is a real number
 *   R4-6  copyable contact        → nothing provider-supplied lands in an attribute
 *   R4-7  no-orphan actions row   → the open "More filters" state is paired, not 3+1
 */
import { describe, it, expect } from 'vitest';
import { renderImporterSearchPage } from './importerPages.js';
import {
  aggregateProfile,
  renderImporterProfilePage,
  anonRevealState,
  dayKey,
} from './importerProfile.js';
import { FIXTURE_PROFILE_ROWS, FIXTURE_PROFILE_SLUG } from './importerFixture.js';

const search = renderImporterSearchPage();

const quota = { allowed: true, used: 2, remaining: 3, limit: 5, signedIn: false } as const;
const profile = aggregateProfile([...FIXTURE_PROFILE_ROWS], FIXTURE_PROFILE_SLUG);
const profileHtml = renderImporterProfilePage(profile, quota, anonRevealState());

describe('R4-1 · the page discloses what sort and filters actually cover', () => {
  it('renders a scope line beside the result count', () => {
    expect(search).toContain('id="imp-scope-t"');
    expect(search).toContain('class="imp-scope"');
  });

  it('speaks BOTH scopes — a partial set names "Load more", a complete set does not hedge', () => {
    // The wording splits on whether more pages exist: hedging on a set that is
    // genuinely complete would be false modesty, and claiming completeness on a
    // partial set is the dishonesty this round exists to remove.
    expect(search).toContain('loaded so far');
    expect(search).toContain('"Load more" widens the set');
    expect(search).toContain('this search returned');
  });

  it('says it at the other two points of use — the sort control and the filter chips', () => {
    expect(search).toMatch(/<select id="imp-sort" title="[^"]*already loaded[^"]*"/);
    expect(search).toMatch(/class="imp-chips-cap" title="[^"]*already loaded[^"]*"/);
  });

  it('tells the user what "Load more" is FOR, not just that it exists', () => {
    expect(search).toMatch(/id="imp-loadmore" title="[^"]*widens the set[^"]*"/);
  });

  it('promises an export of the CURRENT view, and ships one', () => {
    expect(search).toMatch(/id="imp-export"[^>]*title="[^"]*filtered, sorted rows currently on screen/);
    // The POST body is the sorted+filtered projection, never the raw accumulation.
    expect(search).toContain('var rows=sortLeads(visibleLeads());');
    expect(search).toContain('body:JSON.stringify({leads:rows})');
  });
});

describe('R4-2 · a search is shareable and bookmarkable', () => {
  it('writes the search, sort and facets into the URL', () => {
    expect(search).toContain('history.replaceState');
    for (const key of ["add('sort',sortBy)", "add('oc',oc.join(','))", "add('hs',hs.join(','))", "add('ms',facetState.minShip)", "add('mt',facetState.minTeu)", "add('vo','1')"]) {
      expect(search).toContain(key);
    }
  });

  it('rehydrates from the URL WITHOUT going through submit — which would drop the facets', () => {
    // form.submit() resets facetState; restoring must call doSearch directly or a
    // shared link silently loses exactly the facets it was carrying.
    // R5 added a 4th argument (cacheOnly) so the arrival runs as a cache PROBE
    // and can never spend a credit — the direct-call requirement this spec exists
    // to protect is unchanged, so the pattern allows the optional flag.
    expect(search).toContain('function restoreFromUrl()');
    expect(search).toMatch(/curPayload=collectPayload\(\); curPage=1;[\s\S]*?doSearch\(curPayload,1,false(,true)?\);/);
    expect(search).toContain('restoreFromUrl();');
  });

  it('reopens "More filters" when the link carries one — a hidden filter is an invisible filter', () => {
    expect(search).toContain("if(secondary&&moreEl) moreEl.setAttribute('open','');");
  });

  it('offers a Copy link control and stores the URL for the profile back-link', () => {
    expect(search).toContain('id="imp-copylink"');
    expect(search).toContain("sessionStorage.setItem('qf_imp_back',url)");
  });

  it('returns the visitor to their RESULTS from a profile, and only to a safe path', () => {
    expect(profileHtml).toContain("sessionStorage.getItem('qf_imp_back')");
    expect(profileHtml).toContain("back.indexOf('/importers')===0");
    expect(profileHtml).toContain("back.charAt(1)!=='/'");
    expect(profileHtml).toContain('Back to your results');
  });
});

describe('R4-3 · the section strip says it can scroll', () => {
  it('wraps the strip so the fade and chevrons have somewhere to live', () => {
    expect(profileHtml).toContain('class="impp-tabswrap" id="impp-tabswrap" data-scroll="none"');
  });

  it('keys the affordance to the direction that can ACTUALLY scroll', () => {
    for (const state of ['left', 'right', 'both']) {
      expect(profileHtml).toContain(`.impp-tabswrap[data-scroll="${state}"] .impp-tabs{`);
    }
    // "none" gets no mask and no chevron — a strip that already fits must not
    // advertise content that is not there.
    expect(profileHtml).not.toContain('.impp-tabswrap[data-scroll="none"] .impp-tabs{-webkit-mask-image');
  });

  it('recomputes the state on scroll and on resize', () => {
    expect(profileHtml).toContain('function syncTabScroll()');
    expect(profileHtml).toContain("tabsEl.addEventListener('scroll', syncTabScroll, {passive:true})");
    expect(profileHtml).toContain("window.addEventListener('resize', syncTabScroll)");
  });

  it('does not resize the scroller per state — that would jump the strip under a finger', () => {
    for (const state of ['left', 'right', 'both']) {
      const rule = profileHtml.match(new RegExp(`\\.impp-tabswrap\\[data-scroll="${state}"\\] \\.impp-tabs\\{([^}]*)\\}`));
      expect(rule).not.toBeNull();
      expect(rule?.[1]).not.toMatch(/padding/);
    }
  });
});

describe('R4-4 · the two real tables sort by column', () => {
  it('marks every column of both tables sortable, typed as text or number', () => {
    const ths = profileHtml.match(/<th[^>]*data-sort="[tn]"[^>]*>/g) ?? [];
    // 3 supplier columns + 7 recent-shipment columns.
    expect(ths.length).toBe(10);
    // Numeric: Shipments · and Date / Weight / Qty / Cntrs. Date is numeric
    // because dayKey() gives it a real ordinal — sorting it as text would put
    // 12/01/2025 above 03/14/2026.
    expect(ths.filter((t) => t.includes('data-sort="n"')).length).toBe(5);
  });

  it('carries a raw sort key on the cells, so "8,100 kg" sorts as a number', () => {
    expect(profileHtml).toMatch(/<td class="impp-num" data-v="\d+">[\d,]+ kg</);
    expect(profileHtml).toMatch(/<td data-v="\d{8}">\d{2}\/\d{2}\/\d{4}</);
  });

  it('sinks missing data instead of ranking it as zero', () => {
    expect(profileHtml).toContain("if(!va) return 1;");
    expect(profileHtml).toContain("if(!vb) return -1;");
  });

  it('makes the header a real button and tracks aria-sort', () => {
    expect(profileHtml).toContain("b.className='impp-sortbtn'");
    expect(profileHtml).toContain("ths[k].setAttribute('aria-sort'");
  });

  it('opens a measure biggest-first and a name A-Z', () => {
    expect(profileHtml).toContain("var dir = numeric ? 'desc' : 'asc';");
  });

  it('tells the reader the headings are clickable', () => {
    expect(profileHtml).toContain('click a column heading to sort');
  });
});

describe('R4-5 · dayKey — the Date column sort key', () => {
  it('turns MM/DD/YYYY into a comparable YYYYMMDD number', () => {
    expect(dayKey('03/14/2026')).toBe('20260314');
    expect(dayKey('12/01/1999')).toBe('19991201');
  });

  it('accepts ISO too', () => {
    expect(dayKey('2026-03-14')).toBe('20260314');
  });

  it('orders correctly across a month and a year boundary', () => {
    expect(Number(dayKey('01/02/2026'))).toBeGreaterThan(Number(dayKey('12/31/2025')));
    expect(Number(dayKey('03/02/2026'))).toBeGreaterThan(Number(dayKey('03/01/2026')));
  });

  it('returns empty for junk, so the row sinks rather than sorting as the oldest', () => {
    for (const bad of ['', '—', 'n/a', '13/01/2026', '03/32/2026', '03/14/1800']) {
      expect(dayKey(bad)).toBe('');
    }
  });
});

describe('R4-6 · the revealed contact is copyable — safely', () => {
  it('renders a copy control for each contact field', () => {
    expect(profileHtml).toContain("cbtn('email address')");
    expect(profileHtml).toContain("cbtn('all role inboxes',true)");
    expect(profileHtml).toContain("cbtn('phone number')");
    expect(profileHtml).toContain("cbtn('address')");
  });

  it('never puts a provider-supplied value in an attribute', () => {
    // e2() escapes markup but NOT quotes, so a value with a quote in it would
    // break out of data-copy="…". The handler reads rendered text instead.
    expect(profileHtml).not.toMatch(/data-copy="'\+e2\(/);
    expect(profileHtml).toContain('btn.previousElementSibling.textContent.trim()');
  });

  it('falls back when the async clipboard is unavailable', () => {
    expect(profileHtml).toContain('navigator.clipboard.writeText');
    expect(profileHtml).toContain('function legacyCopy(text, ok)');
  });
});

describe('R4-7 · the 560px actions row never orphans a chip', () => {
  it('spans the primary action in BOTH odd-chip cases, not just the open one', () => {
    // Half-width chips are Search, Export, Saved (signed in only) and More
    // (closed only — open it spans the row). An ODD count strands one:
    //   signed out + closed → 3   ·   signed in + open → 3
    // The original rule keyed on the open state alone, which fixed the signed-IN
    // case and broke the signed-OUT one — and signed out is the default state
    // every first-time visitor lands in, since Saved ships hidden until
    // /nav-auth.js confirms a session.
    expect(search).toContain(
      '.imp-actions:has(#imp-saved-link[hidden]):has(.imp-more:not([open])) #imp-search,',
    );
    expect(search).toContain(
      '.imp-actions:not(:has(#imp-saved-link[hidden])):has(.imp-more[open]) #imp-search{grid-column:1 / -1}',
    );
  });
});

describe('R4-8 · a search that returns nothing does not keep the old count on screen', () => {
  it('replaces the count sentence and clears the scope line', () => {
    expect(search).toContain("countEl.textContent='No importers matched this search.';");
    expect(search).toContain("if(scopeEl) scopeEl.textContent='';");
  });
});
