/**
 * Widget MAP INTERACTION guards.
 *
 * The embedded quote map is a static Google bitmap driven by a hand-rolled
 * pan/zoom layer in widget.js. It was reported as "slow and laggy" twice, and
 * the second report came eight days after the first fix attempt — so the
 * properties that make it feel instant are pinned here rather than left to be
 * re-derived. Each assertion below corresponds to a measured regression:
 *
 *   - pinch used to quantise to whole Google zoom levels, so nothing moved until
 *     the fingers had spread past sqrt(2): a measured 182ms of dead time at the
 *     start of every pinch.
 *   - every pointermove wrote style.transform to BOTH map images synchronously —
 *     182 writes / 92 style recalcs for one drag, and that cost scales with the
 *     INPUT rate, so a 120Hz+ pointer paid multiples of it.
 *   - each settled gesture also fired two SPECULATIVE zoom±1 Static Maps renders
 *     that the user never saw — 3 billable renders per interaction, 1 useful.
 *   - a pan only refreshed the bitmap on RELEASE, so the map uncovered unbounded
 *     empty backdrop while the finger was down (measured up to 100% blank).
 *
 * These are source-shape assertions in the style of the other widget.js guards
 * (widgetPreviewInit / widgetStructure): widget.js is un-bundled browser code
 * with no export surface, so its invariants are pinned by inspection.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'src/server/public');
const widgetJs = () => readFile(resolve(publicDir, 'widget.js'), 'utf8');
const widgetHtml = () => readFile(resolve(publicDir, 'widget.html'), 'utf8');

describe('widget map — gesture responsiveness', () => {
  it('drives pinch from a CONTINUOUS zoom, not whole Google levels', async () => {
    const js = await widgetJs();
    // The fractional zoom the gesture drives, separate from the integer level
    // the network is asked for.
    expect(js).toContain('gZoomF');
    // Continuous: log2 of the pinch ratio feeds the fractional zoom directly.
    expect(js).toMatch(/gZoomF = clampZ\(pinchStartZoom \+ Math\.log\(ratio\) \/ Math\.LN2\)/);
    // The old dead-zone shape — rounding the ratio to a whole level before the
    // map is allowed to respond — must not come back.
    expect(js).not.toMatch(/pinchStartZoom \+ Math\.round\(Math\.log\(ratio\)/);
  });

  it('zooms the wheel continuously and normalises the notch across browsers', async () => {
    const js = await widgetJs();
    // Firefox reports lines and some setups report pages; a raw deltaY makes one
    // physical notch mean different things per browser.
    expect(js).toContain('e.deltaMode === 1');
    expect(js).toContain('e.deltaMode === 2');
    // Fractional zoom per notch rather than a whole-level 2x teleport.
    expect(js).toMatch(/nudgeBaseZoom\(Math\.max\(-1, Math\.min\(1, -dy \/ \d+\)\)\)/);
  });

  it('keeps the #415 no-scroll-hijack contract on the wheel handler', async () => {
    const js = await widgetJs();
    // Wheel over the map zooms the map and never chains out to the host page...
    expect(js).toContain("surface.addEventListener('wheel'");
    expect(js).toContain('{ passive: false }');
    expect(js).toContain('e.stopPropagation();');
    // ...but route mode, fully zoomed out, releases a downward scroll back to the
    // page instead of dead-zoning on the card.
    expect(js).toMatch(/surface === canvas && !isBase\(\) && scale <= 1 && e\.deltaY > 0/);
  });
});

describe('widget map — main-thread cost', () => {
  it('throttles transform writes to one per frame instead of one per event', async () => {
    const js = await widgetJs();
    expect(js).toContain('_applyRaf = requestAnimationFrame(');
    // Leading edge: the FIRST write of a frame is synchronous, so frame-throttling
    // never costs input latency. A pure trailing rAF measured +9ms on first paint.
    expect(js).toMatch(/function apply\(\) \{\s*\n\s*if \(_applyRaf\) \{ _applyDirty = true; return; \}\s*\n\s*writeTransform\(\);/);
    // The commit path still needs a synchronous write: the bitmap swap and the
    // transform rebase must land in the same frame or the map visibly jumps.
    expect(js).toContain('function applyNow()');
  });

  it('writes the transform only to the surface the user is looking at', async () => {
    const js = await widgetJs();
    expect(js).toContain('var modalOpen = !!(modal && !modal.hidden);');
    // Modal open -> only the modal image is driven; the inline one is blanked
    // ONCE (guarded), not rewritten every frame.
    expect(js).toContain("if (iimg && iimg.style.transform !== '') iimg.style.transform = '';");
  });

  it('registers the non-cancelling pointer handlers as passive', async () => {
    const js = await widgetJs();
    expect(js).toMatch(/addEventListener\('pointermove',[\s\S]*?\{ passive: true \}\)/);
    expect(js).toContain("surface.addEventListener('pointerup', endPointer, { passive: true });");
    expect(js).toContain("surface.addEventListener('pointercancel', endPointer, { passive: true });");
  });

  it('caches the frame size per gesture instead of reading layout in pointermove', async () => {
    const js = await widgetJs();
    expect(js).toContain('frameW = surface.clientWidth || 1;');
    // The read must live in pointerdown, not in the move handler.
    const move = js.slice(js.indexOf("surface.addEventListener('pointermove'"));
    const moveBody = move.slice(0, move.indexOf('function endPointer'));
    expect(moveBody).not.toContain('clientWidth');
    expect(moveBody).not.toContain('getBoundingClientRect');
  });
});

describe('widget map — Google Static Maps spend', () => {
  it('fires no speculative neighbour renders', async () => {
    const js = await widgetJs();
    // Two extra billable renders per settled gesture, for frames the user
    // usually never reached.
    expect(js).not.toContain('preloadNeighbors');
    expect(js).not.toContain('lastPreloadKey');
  });

  it('still coalesces a gesture into a single debounced crisp fetch', async () => {
    const js = await widgetJs();
    expect(js).toContain('if (baseFetchTimer) { clearTimeout(baseFetchTimer); baseFetchTimer = null; }');
    expect(js).toContain('baseFetchTimer = setTimeout(run, 120)');
    // Repeat pan/zoom over ground already visited must come from memory, never
    // the network.
    expect(js).toContain('bmpLru');
  });

  it('LATCHES the mid-drag refresh so it cannot re-arm on every move', async () => {
    const js = await widgetJs();
    // fetchBaseCrisp's debounce is reset by every call; pointermoves arrive
    // ~16ms apart, so a debounced trigger here would never fire until the drag
    // STOPPED — which is the "nothing happens until I let go" bug. The latch
    // fires once per threshold crossing and re-arms only once that frame lands,
    // which also bounds the number of renders a long drag can cost.
    expect(js).toContain('panCommitArmed');
    expect(js).toContain('panCommitArmed = false;');
    expect(js).toContain('PAN_COMMIT_FRACTION');
    expect(js).toMatch(/onCrispCommit = function \(dxCommitted, dyCommitted\)/);
  });
});

describe('widget map — accessibility is preserved', () => {
  it('keeps an explicit focusable expand control for keyboard / screen readers', async () => {
    const html = await widgetHtml();
    // The map surface itself is a div driven by pointer handlers, so this button
    // is THE keyboard/SR path to the full map. It must stay a real <button>.
    expect(html).toMatch(/<button[^>]*class="qf-map-expand"[^>]*id="qf-map-open"/);
    expect(html).toMatch(/<button[^>]*id="qf-map-open"[^>]*aria-label=/);
  });

  it('never begins a drag or captures the pointer on a control inside the map', async () => {
    const js = await widgetJs();
    // Pointer capture retargets the ensuing click to the surface, which would
    // make the expand and close buttons unclickable.
    expect(js).toContain("if (e.target && e.target.closest && e.target.closest('button')) return;");
  });
});
