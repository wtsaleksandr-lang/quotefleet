/* ==========================================================================
   QuoteFleet — Free Rates Database interactive globe
   --------------------------------------------------------------------------
   Vanilla-JS port of the WeFixTrades globe.gl marketing animation, re-themed
   for QuoteFleet's anonymous, always-free trucking-rate database.

   Libraries are self-hosted under /vendor/ (no runtime CDN calls):
     - /vendor/globe.gl.min.js        → window.Globe   (bundles three.js)
     - /vendor/topojson-client.min.js → window.topojson
     - /vendor/land-110m.json         → world-atlas land topojson

   Behaviour ported verbatim from GlobeCanvas.tsx / GlobeSection.tsx:
     dotted-earth emissive texture, camera centred on North America with a
     ±75° azimuth / 45–115° polar drag clamp, animated dashed arcs, pulsing
     rings, floating htmlElements marker cards, 3.5s active-marker cycle.

   Recoloured from the WFT cyan accent to QuoteFleet blue:
     accent fill #0D3CFC, on-dark glow #6E8BFF (110,139,255).
   ========================================================================== */
(function () {
  "use strict";

  /* ── Config ─────────────────────────────────────────────────────────── */
  var ACCENT = "#0d3cfc";                 // brand fill — dot emissive + marker stroke
  var GLOW_RGB = "110,139,255";           // #6E8BFF — arcs / rings / glows (readable on dark)
  var SITE_BG = "#161616";                // page near-black
  var LAND_DATA_URL = "/vendor/land-110m.json";
  var CYCLE_INTERVAL = 3500;

  // Dot texture settings (match WFT)
  var TEX_W = 2048;
  var TEX_H = 1024;
  var DOT_GAP = 7;
  var DOT_R = 1.2;

  var DEG = Math.PI / 180;
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── SVG icons ──────────────────────────────────────────────────────── */
  var ICON_TRUCK =
    '<path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/>' +
    '<path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1"/>' +
    '<circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>';
  var ICON_DB =
    '<ellipse cx="12" cy="5" rx="9" ry="3"/>' +
    '<path d="M3 5v14a9 3 0 0 0 18 0V5"/>' +
    '<path d="M3 12a9 3 0 0 0 18 0"/>';

  /* ── Central database hub (geographic centre of North America) ───────── */
  var HUB = { location: [39.1, -94.58], label: "Kansas City, MO" };

  /* ── Contributing cities — anonymous rate submissions streaming in ──── */
  // stat renders as "{service} rate added"; label is the origin city.
  var MARKERS = [
    { id: "longbeach", location: [33.77, -118.19], service: "Drayage",     label: "Long Beach, CA" },
    { id: "seattle",   location: [47.61, -122.33], service: "Reefer",      label: "Seattle, WA" },
    { id: "vancouver", location: [49.28, -123.12], service: "Power Only",  label: "Vancouver, BC" },
    { id: "calgary",   location: [51.05, -114.07], service: "Flatbed",     label: "Calgary, AB" },
    { id: "phoenix",   location: [33.45, -112.07], service: "Hotshot",     label: "Phoenix, AZ" },
    { id: "denver",    location: [39.74, -104.99], service: "Step Deck",   label: "Denver, CO" },
    { id: "dallas",    location: [32.78, -96.80],  service: "53ft Dry Van", label: "Dallas, TX" },
    { id: "houston",   location: [29.76, -95.37],  service: "Drayage",     label: "Houston, TX" },
    { id: "chicago",   location: [41.88, -87.63],  service: "Intermodal",  label: "Chicago, IL" },
    { id: "memphis",   location: [35.15, -90.05],  service: "LTL",         label: "Memphis, TN" },
    { id: "detroit",   location: [42.33, -83.05],  service: "Box Truck",   label: "Detroit, MI" },
    { id: "atlanta",   location: [33.75, -84.39],  service: "Flatbed",     label: "Atlanta, GA" },
    { id: "savannah",  location: [32.08, -81.09],  service: "Drayage",     label: "Savannah, GA" },
    { id: "miami",     location: [25.76, -80.19],  service: "Reefer",      label: "Miami, FL" },
    { id: "newark",    location: [40.74, -74.17],  service: "53ft Dry Van", label: "Newark, NJ" },
    { id: "toronto",   location: [43.65, -79.38],  service: "Intermodal",  label: "Toronto, ON" },
    { id: "montreal",  location: [45.50, -73.57],  service: "LTL",         label: "Montreal, QC" }
  ];

  /* ── Dotted-earth texture generator (ported) ────────────────────────── */
  function createDottedEarthCanvas(landFeatures) {
    var canvas = document.createElement("canvas");
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    var ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Rasterise land mask
    var mask = document.createElement("canvas");
    mask.width = TEX_W;
    mask.height = TEX_H;
    var mCtx = mask.getContext("2d");
    mCtx.fillStyle = "#fff";

    landFeatures.forEach(function (feature) {
      var geom = feature.geometry;
      var polys =
        geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
      polys.forEach(function (polygon) {
        polygon.forEach(function (ring, ringIdx) {
          mCtx.beginPath();
          ring.forEach(function (pt, j) {
            var x = ((pt[0] + 180) / 360) * TEX_W;
            var y = ((90 - pt[1]) / 180) * TEX_H;
            if (j === 0) mCtx.moveTo(x, y);
            else mCtx.lineTo(x, y);
          });
          mCtx.closePath();
          if (ringIdx === 0) mCtx.fill();
        });
      });
    });

    var maskData = mCtx.getImageData(0, 0, TEX_W, TEX_H);

    // Graticule
    ctx.strokeStyle = "rgba(" + GLOW_RGB + ", 0.12)";
    ctx.lineWidth = 0.8;
    for (var lng = -180; lng <= 180; lng += 30) {
      var gx = ((lng + 180) / 360) * TEX_W;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, TEX_H);
      ctx.stroke();
    }
    for (var lat = -90; lat <= 90; lat += 30) {
      var gy = ((90 - lat) / 180) * TEX_H;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(TEX_W, gy);
      ctx.stroke();
    }

    // Dots over land only (white — emissive colour tints them blue)
    ctx.fillStyle = "#fff";
    for (var y = DOT_GAP / 2; y < TEX_H; y += DOT_GAP) {
      for (var x = DOT_GAP / 2; x < TEX_W; x += DOT_GAP) {
        var idx = (Math.round(y) * TEX_W + Math.round(x)) * 4;
        if (maskData.data[idx] > 128) {
          ctx.beginPath();
          ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    return canvas;
  }

  /* ── Marker DOM element ─────────────────────────────────────────────── */
  function makeMarkerEl(d, idx, onClick) {
    var isHub = d.__hub === true;
    var el = document.createElement("div");
    el.className = "qfg-marker" + (isHub ? " qfg-marker--hub" : "");
    el.dataset.idx = String(idx);

    // Hub renders as the glowing database core only (no floating card) so a
    // single active contributor card is ever visible at once — no clutter.
    var card = isHub
      ? ""
      : '<div class="qfg-card" data-idx="' + idx + '">' +
        '<div class="qfg-card__stat">' + d.service + " rate added</div>" +
        '<div class="qfg-card__label">' + d.label + "</div>" +
        "</div>";

    el.innerHTML =
      card +
      '<div class="qfg-circle" data-idx="' + idx + '">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' +
      ACCENT +
      '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (isHub ? ICON_DB : ICON_TRUCK) +
      "</svg></div>";

    el.style.cursor = "pointer";
    el.style.pointerEvents = "auto";
    el.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!isHub) onClick(idx);
    });
    return el;
  }

  /* ── Globe bootstrap ────────────────────────────────────────────────── */
  function initGlobe(container) {
    if (typeof window.Globe !== "function") {
      console.warn("[qf-globe] globe.gl not loaded; skipping globe.");
      return;
    }

    // Full marker list: contributors + the central hub (last index).
    var hubMarker = {
      id: "hub",
      location: HUB.location,
      service: "Database",
      label: HUB.label,
      __hub: true
    };
    var allMarkers = MARKERS.concat([hubMarker]);
    var HUB_IDX = allMarkers.length - 1;

    var size = computeSize(container);
    container.innerHTML = "";

    var globe = new window.Globe(container)
      .backgroundColor("rgba(0,0,0,0)")
      .showGlobe(true)
      .showAtmosphere(false)
      .width(size)
      .height(size);

    // Camera controls — clamped drag around North America (ported order).
    var controls = globe.controls();
    controls.autoRotate = false;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;
    controls.dampingFactor = 0.15;
    controls.enableDamping = true;

    globe.pointOfView({ lat: 38, lng: -98, altitude: 2.6 });

    requestAnimationFrame(function () {
      var center = controls.getAzimuthalAngle();
      controls.minAzimuthAngle = center - 75 * DEG;
      controls.maxAzimuthAngle = center + 75 * DEG;
      controls.minPolarAngle = 45 * DEG;
      controls.maxPolarAngle = 115 * DEG;
      controls.update();
    });

    // ── Arcs: every contributing city → central hub (rates streaming in) ──
    var arcs = MARKERS.map(function (m) {
      return {
        startLat: m.location[0],
        startLng: m.location[1],
        endLat: HUB.location[0],
        endLng: HUB.location[1]
      };
    });
    globe
      .arcsData(arcs)
      .arcColor(function () {
        return ["rgba(" + GLOW_RGB + ",0.10)", "rgba(" + GLOW_RGB + ",0.6)"];
      })
      .arcDashLength(0.4)
      .arcDashGap(0.25)
      .arcDashAnimateTime(reduceMotion ? 0 : 3000)
      .arcStroke(0.5)
      .arcsTransitionDuration(0);

    // ── Rings: persistent pulse at hub + pulse at active marker ──────────
    globe
      .ringColor(function () {
        return function (t) {
          return "rgba(" + GLOW_RGB + "," + (1 - t) + ")";
        };
      })
      .ringMaxRadius(4)
      .ringPropagationSpeed(3)
      .ringRepeatPeriod(reduceMotion ? 0 : 1200);

    // ── HTML marker cards ────────────────────────────────────────────────
    globe
      .htmlElementsData(allMarkers)
      .htmlLat(function (d) { return d.location[0]; })
      .htmlLng(function (d) { return d.location[1]; })
      .htmlAltitude(0.02)
      .htmlElement(function (d) {
        var idx = allMarkers.indexOf(d);
        return makeMarkerEl(d, idx, setActive);
      });

    // ── Dotted-earth emissive texture ────────────────────────────────────
    // Load land topojson → build dotted canvas → feed globe.gl as its image,
    // then repurpose the loaded texture (globe.gl's own three instance) as an
    // emissive map so the dots glow brand-blue on a dark sphere.
    fetch(LAND_DATA_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("land-110m HTTP " + res.status);
        return res.json();
      })
      .then(function (landTopo) {
        var land = window.topojson.feature(landTopo, landTopo.objects.land);
        var canvas = createDottedEarthCanvas(land.features);
        globe.globeImageUrl(canvas.toDataURL("image/png"));
        globe.onGlobeReady(function () {
          try {
            var mat = globe.globeMaterial();
            if (mat && mat.map) {
              mat.emissiveMap = mat.map;
              mat.map = null;
              if (mat.color && mat.color.set) mat.color.set(SITE_BG);
              if (mat.emissive && mat.emissive.set) mat.emissive.set(ACCENT);
              // Kill the specular limb highlight so the emissive continents
              // (North America, centred) are the brightest thing on the sphere.
              if (mat.specular && mat.specular.set) mat.specular.set("#000000");
              mat.emissiveIntensity = 2.6;
              mat.shininess = 2;
              mat.transparent = true;
              mat.opacity = 1;
              mat.needsUpdate = true;
            }
          } catch (e) {
            console.warn("[qf-globe] emissive material tweak skipped:", e && e.message);
          }
        });
      })
      .catch(function (err) {
        console.warn("[qf-globe] dotted-earth texture skipped:", err && err.message);
      });

    // ── Active-marker state ──────────────────────────────────────────────
    var activeIndex = 0;
    var timer = null;

    function paintActive() {
      // Rings: hub always pulses; active contributor also pulses.
      var rings = [{ lat: HUB.location[0], lng: HUB.location[1] }];
      if (activeIndex != null && activeIndex >= 0 && activeIndex !== HUB_IDX) {
        rings.push({
          lat: allMarkers[activeIndex].location[0],
          lng: allMarkers[activeIndex].location[1]
        });
      }
      globe.ringsData(rings);

      container.querySelectorAll(".qfg-circle").forEach(function (el) {
        var i = Number(el.dataset.idx);
        el.classList.toggle("active", i === activeIndex);
      });
      container.querySelectorAll(".qfg-card").forEach(function (el) {
        var i = Number(el.dataset.idx);
        el.classList.toggle("active", i === activeIndex);
      });
    }

    function setActive(idx) {
      activeIndex = idx;
      paintActive();
      startCycle();
    }

    function startCycle() {
      if (reduceMotion) return;
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        var next;
        do {
          next = Math.floor(Math.random() * MARKERS.length);
        } while (next === activeIndex && MARKERS.length > 1);
        activeIndex = next;
        paintActive();
      }, CYCLE_INTERVAL);
    }

    paintActive();
    startCycle();

    // Fade in
    setTimeout(function () {
      container.style.opacity = "1";
    }, 350);

    // Responsive resize
    var resizeRaf = null;
    function onResize() {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(function () {
        var s = computeSize(container);
        globe.width(s).height(s);
      });
    }
    window.addEventListener("resize", onResize);
  }

  function computeSize(container) {
    // Globe is sized larger than its cropping viewport so North America fills
    // the frame; the viewport (CSS) clips the rest.
    var w = container.parentElement
      ? container.parentElement.clientWidth
      : container.clientWidth;
    if (!w || w < 320) w = 320;
    // Oversize the canvas relative to its cropping viewport so North America
    // fills the frame and the city markers spread apart (less overlap).
    return Math.min(Math.max(Math.round(w * 1.35), 620), 1080);
  }

  /* ── Lazy init on scroll into view (heavy WebGL asset) ───────────────── */
  function boot() {
    var container = document.getElementById("qf-globe-canvas");
    if (!container) return;

    var started = false;
    function start() {
      if (started) return;
      started = true;
      initGlobe(container);
    }

    if (!("IntersectionObserver" in window)) {
      start();
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            io.disconnect();
            start();
          }
        });
      },
      { rootMargin: "200px 0px" }
    );
    io.observe(container);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
