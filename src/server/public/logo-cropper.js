/**
 * QFLogoCropper — a small, self-contained logo crop/zoom editor.
 *
 * Used by the Customize page's logo upload. The crop frame takes the LOGO'S OWN
 * shape (clamped so extreme ratios stay a usable size), so a wide wordmark is
 * kept in full — never forced into a square. At zoom=1 the whole logo fits the
 * frame ('contain'); drag + zoom only if you want to crop in. Apply exports a
 * data-URL up to 512px on the long edge, aspect preserved. Vanilla JS, styles
 * injected once, no dependencies.
 *
 *   window.QFLogoCropper.open(dataUrlOrSrc, function (croppedDataUrl) { ... });
 *
 * onApply receives the data-URL (webp when supported, else png). Cancel closes
 * without calling onApply.
 */
(function () {
  'use strict';
  if (window.QFLogoCropper) return;

  var LONG = 280;      // longest on-screen frame edge (px)
  var OUTLONG = 512;   // exported long edge (px) — crisper than the old 256 square
  var MAX_ZOOM = 4;    // max zoom multiplier over the 'contain' (whole-logo) scale
  var MAX_AR = 4;      // clamp the frame to at most 4:1 / 1:4 so it stays draggable

  function injectStyles() {
    if (document.getElementById('qf-cropper-styles')) return;
    var s = document.createElement('style');
    s.id = 'qf-cropper-styles';
    s.textContent = [
      '.qf-cropper{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;}',
      '.qf-cropper-back{position:absolute;inset:0;background:rgba(15,23,42,.62);}',
      '.qf-cropper-panel{position:relative;width:min(92vw,340px);background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.4);padding:20px;box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;}',
      '.qf-cropper-title{font-size:15px;font-weight:800;color:#0c1424;margin:0 0 4px;}',
      '.qf-cropper-hint{font-size:12px;color:#5a6478;margin:0 0 14px;}',
      // width/height are set inline per-logo (aspect-aware); the checkerboard hints transparency.
      '.qf-cropper-stage{position:relative;max-width:100%;margin:0 auto;border-radius:14px;overflow:hidden;cursor:grab;touch-action:none;user-select:none;background:#eef1f5;background-image:linear-gradient(45deg,#e2e6ec 25%,transparent 25%,transparent 75%,#e2e6ec 75%),linear-gradient(45deg,#e2e6ec 25%,transparent 25%,transparent 75%,#e2e6ec 75%);background-size:16px 16px;background-position:0 0,8px 8px;}',
      '.qf-cropper-stage:active{cursor:grabbing;}',
      '.qf-cropper-stage img{position:absolute;left:0;top:0;max-width:none;pointer-events:none;-webkit-user-drag:none;}',
      '.qf-cropper-ring{position:absolute;inset:0;border-radius:14px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.85);pointer-events:none;}',
      '.qf-cropper-zoom{display:flex;align-items:center;gap:10px;margin:16px 0 4px;}',
      '.qf-cropper-zoom input{flex:1;}',
      '.qf-cropper-zoom span{font-size:16px;color:#5a6478;width:16px;text-align:center;}',
      '.qf-cropper-actions{display:flex;gap:10px;margin-top:14px;}',
      '.qf-cropper-actions button{flex:1;border-radius:10px;padding:11px 14px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid transparent;font-family:inherit;}',
      '.qf-cropper-cancel{background:#fff;border-color:#dbe0e8;color:#0c1424;}',
      '.qf-cropper-apply{background:#0D3CFC;color:#fff;}'
    ].join('');
    document.head.appendChild(s);
  }

  function open(src, onApply) {
    injectStyles();
    var img = new Image();
    img.onload = function () { build(img, onApply); };
    img.onerror = function () { if (typeof onApply === 'function') onApply(src); }; // fall back to original
    img.src = src;
  }

  function build(img, onApply) {
    var nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    // Frame aspect = the logo's own aspect, clamped so extreme ratios stay usable.
    var ar = Math.max(1 / MAX_AR, Math.min(MAX_AR, nw / nh));
    var VW = ar >= 1 ? LONG : Math.round(LONG * ar);
    var VH = ar >= 1 ? Math.round(LONG / ar) : LONG;
    var OW = ar >= 1 ? OUTLONG : Math.round(OUTLONG * ar);
    var OH = ar >= 1 ? Math.round(OUTLONG / ar) : OUTLONG;

    // 'contain' base scale: at zoom=1 the WHOLE logo fits the frame (letterboxed
    // only if its own ratio is outside the clamp) — never cropped. Zoom to crop.
    var base = Math.min(VW / nw, VH / nh);
    var z = 1, scale = base * z;
    var dw = nw * scale, dh = nh * scale;
    var tx = (VW - dw) / 2, ty = (VH - dh) / 2;

    var overlay = document.createElement('div');
    overlay.className = 'qf-cropper';
    var back = document.createElement('div'); back.className = 'qf-cropper-back';
    var panel = document.createElement('div'); panel.className = 'qf-cropper-panel';
    panel.innerHTML =
      '<div class="qf-cropper-title">Adjust your logo</div>' +
      '<div class="qf-cropper-hint">Your whole logo is kept. Drag or zoom only if you want to crop in.</div>' +
      '<div class="qf-cropper-stage"><img alt=""><div class="qf-cropper-ring"></div></div>' +
      '<div class="qf-cropper-zoom"><span>−</span><input type="range" min="1" max="' + MAX_ZOOM + '" step="0.01" value="1" aria-label="Zoom"><span>+</span></div>' +
      '<div class="qf-cropper-actions"><button type="button" class="qf-cropper-cancel">Cancel</button><button type="button" class="qf-cropper-apply">Apply</button></div>';
    overlay.appendChild(back); overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var stage = panel.querySelector('.qf-cropper-stage');
    stage.style.width = VW + 'px'; stage.style.height = VH + 'px';
    var imgEl = panel.querySelector('.qf-cropper-stage img');
    var range = panel.querySelector('input[type=range]');
    imgEl.src = img.src;

    function clamp() {
      // Center the logo on an axis where it is smaller than the frame; otherwise
      // keep it covering the frame (once zoomed in).
      if (dw <= VW) tx = (VW - dw) / 2; else { if (tx > 0) tx = 0; if (tx < VW - dw) tx = VW - dw; }
      if (dh <= VH) ty = (VH - dh) / 2; else { if (ty > 0) ty = 0; if (ty < VH - dh) ty = VH - dh; }
    }
    function apply() {
      imgEl.style.width = dw + 'px'; imgEl.style.height = dh + 'px';
      imgEl.style.left = tx + 'px'; imgEl.style.top = ty + 'px';
    }
    function setZoom(nz, cx, cy) {
      nz = Math.max(1, Math.min(MAX_ZOOM, nz));
      var px = (cx - tx) / scale, py = (cy - ty) / scale;
      z = nz; scale = base * z; dw = nw * scale; dh = nh * scale;
      tx = cx - px * scale; ty = cy - py * scale;
      clamp(); apply();
      if (Math.abs(parseFloat(range.value) - z) > 0.001) range.value = String(z);
    }
    apply();

    // Drag to pan
    var dragging = false, sx = 0, sy = 0;
    stage.addEventListener('pointerdown', function (e) { dragging = true; sx = e.clientX - tx; sy = e.clientY - ty; if (stage.setPointerCapture) stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', function (e) { if (!dragging) return; tx = e.clientX - sx; ty = e.clientY - sy; clamp(); apply(); });
    stage.addEventListener('pointerup', function () { dragging = false; });
    stage.addEventListener('pointercancel', function () { dragging = false; });
    stage.addEventListener('wheel', function (e) { e.preventDefault(); var r = stage.getBoundingClientRect(); setZoom(z + (e.deltaY < 0 ? 0.2 : -0.2), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    range.addEventListener('input', function () { setZoom(parseFloat(range.value), VW / 2, VH / 2); });

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    back.addEventListener('click', close);
    panel.querySelector('.qf-cropper-cancel').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    panel.querySelector('.qf-cropper-apply').addEventListener('click', function () {
      // The visible frame shows source pixels from (-tx/scale,-ty/scale) spanning
      // (VW/scale × VH/scale) — render that region onto the OW×OH canvas. Out-of-
      // bounds source (a letterboxed logo) stays transparent, so nothing is cropped.
      var canvas = document.createElement('canvas');
      canvas.width = OW; canvas.height = OH;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, -tx / scale, -ty / scale, VW / scale, VH / scale, 0, 0, OW, OH);
      var out = '';
      try { out = canvas.toDataURL('image/webp', 0.9); } catch (_e) { out = ''; }
      if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
      close();
      if (typeof onApply === 'function') onApply(out);
    });
  }

  window.QFLogoCropper = { open: open };
})();
