/**
 * QFLogoCropper — a small, self-contained square logo crop/zoom editor.
 *
 * Used by the Customize page's logo upload: after a raster image is picked the
 * carrier can pan (drag) and zoom (slider / wheel) inside a square frame, then
 * Apply to export a 256×256 data-URL. Vanilla JS, styles injected once, no
 * dependencies. Exposes window.QFLogoCropper.open(imgSrc, onApply).
 *
 *   window.QFLogoCropper.open(dataUrlOrSrc, function (croppedDataUrl) { ... });
 *
 * onApply receives the cropped 256×256 data-URL (webp when supported, else png).
 * Cancel simply closes without calling onApply.
 */
(function () {
  'use strict';
  if (window.QFLogoCropper) return;

  var V = 260;      // on-screen viewport size (square, px)
  var OUT = 256;    // exported crop size (square, px)
  var MAX_ZOOM = 4; // max zoom multiplier over the cover scale

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
      '.qf-cropper-stage{position:relative;width:' + V + 'px;height:' + V + 'px;max-width:100%;margin:0 auto;border-radius:14px;overflow:hidden;background:#eef1f5;cursor:grab;touch-action:none;user-select:none;}',
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
    var nw = img.naturalWidth || V, nh = img.naturalHeight || V;
    var cover = Math.max(V / nw, V / nh); // min scale so the image fills the frame
    var z = 1;                            // zoom multiplier over cover
    var scale = cover * z;
    var dw = nw * scale, dh = nh * scale;
    var tx = (V - dw) / 2, ty = (V - dh) / 2; // centered

    var overlay = document.createElement('div');
    overlay.className = 'qf-cropper';
    var back = document.createElement('div'); back.className = 'qf-cropper-back';
    var panel = document.createElement('div'); panel.className = 'qf-cropper-panel';
    panel.innerHTML =
      '<div class="qf-cropper-title">Adjust your logo</div>' +
      '<div class="qf-cropper-hint">Drag to reposition, and use the slider to zoom.</div>' +
      '<div class="qf-cropper-stage"><img alt=""><div class="qf-cropper-ring"></div></div>' +
      '<div class="qf-cropper-zoom"><span>−</span><input type="range" min="1" max="' + MAX_ZOOM + '" step="0.01" value="1" aria-label="Zoom"><span>+</span></div>' +
      '<div class="qf-cropper-actions"><button type="button" class="qf-cropper-cancel">Cancel</button><button type="button" class="qf-cropper-apply">Apply</button></div>';
    overlay.appendChild(back); overlay.appendChild(panel);
    document.body.appendChild(overlay);

    var stage = panel.querySelector('.qf-cropper-stage');
    var imgEl = panel.querySelector('.qf-cropper-stage img');
    var range = panel.querySelector('input[type=range]');
    imgEl.src = img.src;

    function clamp() {
      if (tx > 0) tx = 0; if (ty > 0) ty = 0;
      if (tx < V - dw) tx = V - dw;
      if (ty < V - dh) ty = V - dh;
    }
    function apply() {
      imgEl.style.width = dw + 'px'; imgEl.style.height = dh + 'px';
      imgEl.style.left = tx + 'px'; imgEl.style.top = ty + 'px';
    }
    function setZoom(nz, cx, cy) {
      nz = Math.max(1, Math.min(MAX_ZOOM, nz));
      // keep the point under (cx,cy) in the stage stable while zooming
      var px = (cx - tx) / scale, py = (cy - ty) / scale;
      z = nz; scale = cover * z; dw = nw * scale; dh = nh * scale;
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
    range.addEventListener('input', function () { setZoom(parseFloat(range.value), V / 2, V / 2); });

    function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
    back.addEventListener('click', close);
    panel.querySelector('.qf-cropper-cancel').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    panel.querySelector('.qf-cropper-apply').addEventListener('click', function () {
      // The visible frame shows image source pixels starting at (-tx/scale,-ty/scale)
      // spanning (V/scale) — render that square onto a 256×256 canvas.
      var canvas = document.createElement('canvas');
      canvas.width = OUT; canvas.height = OUT;
      var ctx = canvas.getContext('2d');
      var sSize = V / scale;
      ctx.drawImage(img, -tx / scale, -ty / scale, sSize, sSize, 0, 0, OUT, OUT);
      var out = '';
      try { out = canvas.toDataURL('image/webp', 0.85); } catch (_e) { out = ''; }
      if (!out || out.indexOf('data:image/webp') !== 0) out = canvas.toDataURL('image/png');
      close();
      if (typeof onApply === 'function') onApply(out);
    });
  }

  window.QFLogoCropper = { open: open };
})();
