/* Halftone component scatter (Figma: "Scatter intro · animated background" + "Scatter field · to footer").
   Positions / types / depth come from Figma (js/scatter-data.js). The halftone artwork itself is
   re-generated procedurally: isometric 45°/30° shapes, dot grid with 6 px pitch, dot radius by
   face tone, 3 colours #bbddff / #a0d2ff / #93a9e2, layer opacity 0.42, light grain.
   Motion: one-shot intro on scroll (halftone disc → burst → parts fly to their places),
   then endless chaotic drift. prefers-reduced-motion → static final layout. */
(function () {
  "use strict";
  var D = window.PW_SCATTER;
  var canvas = document.getElementById("scatter");
  var zone = document.getElementById("zone");
  if (!D || !canvas || !zone) return;
  var ctx = canvas.getContext("2d");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  var COLORS = { top: "#bbddff", left: "#a0d2ff", right: "#93a9e2" };
  var DOT = { top: 1.35, left: 1.9, right: 2.35 }; // radius by face tone (darker face → larger dot)
  var PITCH = 6;
  var LAYER_OPACITY = 0.42;
  var AMP = [5, 9, 14], ROT = [2.5, 4, 6];
  var C30 = Math.cos(Math.PI / 6), S30 = 0.5;

  // ---------- data ----------
  function parse(str, oy, intro) {
    return str.split(";").map(function (s) {
      var p = s.split(",");
      return { type: p[0], depth: +p[1], x: +p[2], y: +p[3] + oy, w: Math.max(2, +p[4]), h: Math.max(2, +p[5]), intro: intro };
    });
  }
  // One composition only (Figma "Scatter intro"), pinned to the viewport while the zone scrolls.
  // The "Scatter field · to footer" layer in Figma just repeats it to show the idea — not rendered.
  var items = parse(D.intro, 0, true);
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  items.forEach(function (it) {
    var k = it.type === "tube" ? 0.5 : 1;
    it.amp = AMP[it.depth] * k;
    it.rotAmp = ROT[it.depth] * k * Math.PI / 180;
    it.cx = it.x + it.w / 2; it.cy = it.y + it.h / 2;
    it.dx = 0; it.dy = 0; it.dr = 0;
    it.from = [0, 0, 0]; it.to = [0, 0, 0]; it.t0 = 0; it.dur = 1;
    it.phase = rnd();
  });
  var disc = D.disc;
  var maxDist = 0;
  items.forEach(function (it) {
    if (!it.intro) return;
    var vx = it.cx - disc.cx, vy = it.cy - disc.cy, d = Math.hypot(vx, vy);
    it.dist = d; maxDist = Math.max(maxDist, d);
    var r0 = 30 + rnd() * 120; // start somewhere inside the circle
    it.sx = disc.cx + (d ? vx / d : 0) * Math.min(r0, d);
    it.sy = disc.cy + (d ? vy / d : 0) * Math.min(r0, d);
  });
  items.forEach(function (it) {
    if (!it.intro) return;
    var n = it.dist / maxDist;
    it.flyStart = 1.0 + n * 0.25;           // leaves the circle as it bursts
    it.flyEnd = 1.75 + n * 0.85;            // arrival 1.75–2.6 s, far ones later
  });

  // ---------- easing ----------
  function bezier(x1, y1, x2, y2) {
    function a(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function b(a1, a2) { return 3 * a2 - 6 * a1; }
    function c(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t; }
    function slope(t, a1, a2) { return 3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1); }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var s = slope(t, x1, x2); if (Math.abs(s) < 1e-6) break;
        t -= (calc(t, x1, x2) - x) / s;
      }
      t = Math.min(1, Math.max(0, t));
      return calc(t, y1, y2);
    };
  }
  var easeFly = bezier(0.05, 0.7, 0.1, 1);
  var easeInOut = bezier(0.42, 0, 0.58, 1);
  var easeOut = bezier(0, 0, 0.58, 1);
  function seg(t, a, b) { return Math.min(1, Math.max(0, (t - a) / (b - a))); }

  // ---------- halftone sprite rendering ----------
  var sprites = {};
  var scaleCSS = 1, dpr = 1;

  function dotFill(g, path, face, w, h, k) {
    g.save();
    g.clip(path);
    g.fillStyle = COLORS[face];
    var p = PITCH * k, r = DOT[face] * k;
    for (var y = p / 2; y < h + p; y += p) {
      for (var x = ((Math.round(y / p) % 2) ? p / 2 : 0) + p / 2; x < w + p; x += p) {
        g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
      }
    }
    g.restore();
  }
  function poly(pts) { var p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]); for (var i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); return p; }
  function ellipsePath(cx, cy, rx, ry, a0, a1, ccw) { var p = new Path2D(); p.ellipse(cx, cy, Math.max(rx, .1), Math.max(ry, .1), 0, a0 || 0, a1 === undefined ? 6.2832 : a1, !!ccw); return p; }

  // isometric box fitted into W×H. dims: L (x-axis), B (y-axis), Z (height)
  function box(L, B, Z, W, H, ox, oy) {
    var pw = (L + B) * C30, ph = (L + B) * S30 + Z;
    var sx = W / pw, sy = H / ph;
    function P(x, y, z) { return [ox + (x - y) * C30 * sx + B * C30 * sx, oy + ((x + y) * S30 - z) * sy + Z * sy]; }
    return {
      top: poly([P(0, 0, Z), P(L, 0, Z), P(L, B, Z), P(0, B, Z)]),
      left: poly([P(0, B, Z), P(L, B, Z), P(L, B, 0), P(0, B, 0)]),
      right: poly([P(L, 0, Z), P(L, B, Z), P(L, B, 0), P(L, 0, 0)]),
      P: P, sx: sx, sy: sy
    };
  }
  function drawBox(g, b, w, h, k) { dotFill(g, b.right, "right", w, h, k); dotFill(g, b.left, "left", w, h, k); dotFill(g, b.top, "top", w, h, k); }
  function legs(g, b, n, along, L, B, len, w, h, k) {
    // thin pins under a box; drawn as 1-dot-wide strips
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      var a = along === "x" ? b.P(L * t, B, 0) : b.P(L, B * t, 0);
      var path = poly([[a[0] - 1.2 * k, a[1]], [a[0] + 1.2 * k, a[1]], [a[0] + 1.2 * k, a[1] + len], [a[0] - 1.2 * k, a[1] + len]]);
      dotFill(g, path, "right", w, h, k);
    }
  }

  function render(type, w, h, k) {
    var c = document.createElement("canvas");
    var W = Math.ceil(w * k), H = Math.ceil(h * k);
    c.width = Math.max(1, W); c.height = Math.max(1, H);
    var g = c.getContext("2d");
    var b, legH;
    switch (type) {
      case "dip16":
        legH = H * 0.18; b = box(3.2, 1, 0.42, W, H - legH, 0, 0);
        legs(g, b, 8, "x", 3.2, 1, legH, W, H, k); drawBox(g, b, W, H, k); break;
      case "sip8":
        legH = H * 0.14; b = box(3, 0.55, 1.7, W, H - legH, 0, 0);
        legs(g, b, 8, "x", 3, 0.55, legH, W, H, k); drawBox(g, b, W, H, k); break;
      case "smd":
        b = box(1.7, 1, 0.45, W, H, 0, 0); drawBox(g, b, W, H, k); break;
      case "to220":
        legH = H * 0.3; var tab = box(1, 0.16, 1.9, W, H - legH, 0, 0);
        var body = box(1, 0.5, 1.0, W * 0.98, (H - legH) * 0.55, W * 0.02, (H - legH) * 0.45);
        legs(g, body, 3, "x", 1, 0.5, legH, W, H, k); drawBox(g, tab, W, H, k); drawBox(g, body, W, H, k); break;
      case "res":
        var rb = box(3, 0.7, 0.7, W, H, 0, 0);
        dotFill(g, rb.right, "right", W, H, k); dotFill(g, rb.left, "left", W, H, k); dotFill(g, rb.top, "top", W, H, k);
        break;
      case "ecap":
        var rx = W / 2, ry = Math.min(rx * 0.5, H * 0.25);
        var bodyH = H - 2 * ry;
        var side = new Path2D(); side.moveTo(0, ry); side.lineTo(0, ry + bodyH); side.ellipse(rx, ry + bodyH, rx, ry, 0, Math.PI, 0, true); side.lineTo(W, ry); side.closePath();
        var leftHalf = new Path2D(); leftHalf.rect(0, 0, rx, H);
        g.save(); g.clip(leftHalf); dotFill(g, side, "left", W, H, k); g.restore();
        g.save(); var rh = new Path2D(); rh.rect(rx, 0, rx, H); g.clip(rh); dotFill(g, side, "right", W, H, k); g.restore();
        dotFill(g, ellipsePath(rx, ry, rx, ry), "top", W, H, k); break;
      case "toroid":
        var orx = W / 2, ory = Math.min(orx * 0.5, H * 0.4), th = H - 2 * ory;
        var outerSide = new Path2D(); outerSide.moveTo(0, ory); outerSide.lineTo(0, ory + th); outerSide.ellipse(orx, ory + th, orx, ory, 0, Math.PI, 0, true); outerSide.lineTo(W, ory); outerSide.closePath();
        dotFill(g, outerSide, "left", W, H, k);
        var ring = new Path2D(); ring.ellipse(orx, ory, orx, ory, 0, 0, 6.2832); ring.ellipse(orx, ory, orx * 0.45, ory * 0.45, 0, 0, 6.2832, true);
        g.save(); g.clip(ring, "evenodd"); dotFill(g, ellipsePath(orx, ory, orx, ory), "top", W, H, k); g.restore();
        g.save(); g.clip(ellipsePath(orx, ory + Math.min(th, ory * 0.4), orx * 0.45, ory * 0.45)); g.globalCompositeOperation = "destination-out"; g.fillRect(0, 0, W, H); g.restore();
        break;
      case "tube":
        b = box(6, 0.9, 0.55, W, H, 0, 0); drawBox(g, b, W, H, k);
        // open channel on top
        var inner = box(5.6, 0.45, 0.4, W * 0.94, H * 0.94, W * 0.03, H * 0.02);
        g.save(); g.globalCompositeOperation = "destination-out"; g.fill(inner.top); g.restore();
        dotFill(g, inner.top, "right", W, H, k);
        break;
      default:
        b = box(1, 1, 1, W, H, 0, 0); drawBox(g, b, W, H, k);
    }
    // light grain (Figma NOISE · monotone #333 / 16%, size 1.5) — only on painted dots
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = "rgba(51,51,51,0.16)";
    var n = Math.floor(W * H * 0.035);
    for (var i = 0; i < n; i++) g.fillRect(Math.random() * W, Math.random() * H, 1.5 * k, 1.5 * k);
    g.restore();
    return c;
  }
  function sprite(it) {
    var k = scaleCSS * dpr;
    var key = it.type + "|" + it.w + "|" + it.h + "|" + k.toFixed(2);
    if (!sprites[key]) sprites[key] = render(it.type, it.w, it.h, k);
    return sprites[key];
  }
  var discSprite = null;
  function discCanvas() {
    var k = scaleCSS * dpr;
    if (discSprite && discSprite.k === k) return discSprite.c;
    var R = disc.rings[0][0], S = Math.ceil(R * 2 * k);
    var c = document.createElement("canvas"); c.width = c.height = S;
    var g = c.getContext("2d");
    var faces = ["top", "left", "right"];
    disc.rings.forEach(function (r, i) {
      g.save();
      g.globalCompositeOperation = i === 0 ? "source-over" : "source-over";
      var p = ellipsePath(S / 2, S / 2, r[0] * k, r[0] * k);
      if (i > 0) { g.save(); g.globalCompositeOperation = "destination-out"; g.fill(p); g.restore(); }
      dotFill(g, p, faces[i], S, S, k);
      g.restore();
    });
    discSprite = { c: c, k: k };
    return c;
  }

  // ---------- layout ----------
  var W = 0, H = 0, colLeft = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // soft halftone at 0.42 opacity: 1.5× is enough
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var s = Math.min(1, W / 1440);
    if (s !== scaleCSS) { scaleCSS = s; sprites = {}; discSprite = null; }
    colLeft = Math.max(0, (W - 1440 * scaleCSS) / 2);
    if (!running) draw(performance.now());
  }

  // ---------- intro state ----------
  var introStart = null; // ms timestamp
  var introDone = false;
  var reduced = reduce.matches;
  if (reduced) introDone = true;

  function startIntro() { if (introStart === null && !introDone) { introStart = performance.now(); kick(); } }

  var sentinel = document.createElement("div");
  sentinel.style.cssText = "position:absolute;left:0;right:0;top:0;height:" + D.introHeight + "px;pointer-events:none";
  zone.appendChild(sentinel);
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && e.intersectionRatio >= 0.2) { startIntro(); io.disconnect(); }
        else if (!e.isIntersecting && e.boundingClientRect.bottom < 0 && introStart === null) { introDone = true; io.disconnect(); kick(); }
      });
    }, { threshold: [0, 0.2] });
    io.observe(sentinel);
  } else { introDone = true; }

  // ---------- drift ----------
  function retarget(it, now, first) {
    it.from = [it.dx, it.dy, it.dr];
    it.to = [(rnd() * 2 - 1) * it.amp, (rnd() * 2 - 1) * it.amp, (rnd() * 2 - 1) * it.rotAmp];
    it.t0 = now; it.dur = (0.9 + rnd() * 0.8) * 1000;
    if (first) it.t0 -= it.phase * it.dur * 0.9;
  }
  function stepDrift(it, now) {
    if (!it.t0) retarget(it, now, true);
    var t = (now - it.t0) / it.dur;
    if (t >= 1) { it.dx = it.to[0]; it.dy = it.to[1]; it.dr = it.to[2]; retarget(it, now, false); t = 0; }
    var e = easeInOut(t);
    it.dx = it.from[0] + (it.to[0] - it.from[0]) * e;
    it.dy = it.from[1] + (it.to[1] - it.from[1]) * e;
    it.dr = it.from[2] + (it.to[2] - it.from[2]) * e;
  }

  // ---------- draw ----------
  var running = false, raf = 0;
  function draw(now) {
    var s = scaleCSS;
    var ky = H / D.introHeight; // spread the 640-px composition over the viewport height
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var t = introStart === null ? -1 : (now - introStart) / 1000;
    if (t > 2.7) { introDone = true; }
    var animate = !reduced;

    // halftone disc (0 → 1.5 s)
    if (!introDone && t >= 0 && t <= 1.5) {
      var op = t < 0.55 ? easeOut(seg(t, 0, 0.55)) : t < 0.95 ? 1 : 1 - easeOut(seg(t, 0.95, 1.5));
      var sc = t < 0.55 ? 0.55 + 0.45 * easeFly(seg(t, 0, 0.55)) : t < 0.95 ? 1 - 0.05 * easeInOut(seg(t, 0.55, 0.95)) : 0.95 + 0.55 * easeOut(seg(t, 0.95, 1.5));
      var dc = discCanvas(), R = disc.rings[0][0];
      ctx.save();
      ctx.globalAlpha = LAYER_OPACITY * op;
      ctx.translate(colLeft + disc.cx * s, disc.cy * ky);
      ctx.scale(sc * s, sc * s);
      ctx.drawImage(dc, -R, -R, 2 * R, 2 * R);
      ctx.restore();
    }

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var alpha = LAYER_OPACITY, scale = 1, px = it.cx, py = it.cy;
      if (it.intro && !introDone) {
        if (t < 0) continue; // waiting for the scroll trigger
        var f = seg(t, it.flyStart, it.flyEnd);
        if (f <= 0) continue;
        var e = easeFly(f);
        px = it.sx + (it.cx - it.sx) * e; py = (it.sy + (it.cy - it.sy) * e);
        scale = 0.25 + 0.75 * e;
        alpha *= easeOut(Math.min(1, f / 0.3));
      } else if (animate) {
        stepDrift(it, now);
      }
      var sp = sprite(it);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(colLeft + (px + it.dx) * s, py * ky + it.dy);
      if (it.dr) ctx.rotate(it.dr);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.drawImage(sp, -it.w * s / 2, -it.h / 2 * s, it.w * s, it.h * s);
      ctx.restore();
    }
  }
  var FRAME_MS = 1000 / 30, lastDraw = 0; // drift is slow: 30 fps halves canvas + backdrop-blur work
  function loop(now) {
    var intro = introStart !== null && !introDone;
    if (intro || now - lastDraw >= FRAME_MS - 1) { lastDraw = now; draw(now); }
    if (running) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (reduced) { draw(performance.now()); return; }
    if (!running) { running = true; raf = requestAnimationFrame(loop); }
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // Only animate while the zone is on screen
  var zoneVisible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      zoneVisible = es[0].isIntersecting;
      if (zoneVisible) kick(); else stop();
    }).observe(zone);
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else if (zoneVisible) kick(); });
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", function () { if (!running) draw(performance.now()); }, { passive: true });
  reduce.addEventListener && reduce.addEventListener("change", function (e) { reduced = e.matches; if (reduced) { introDone = true; stop(); items.forEach(function (it) { it.dx = it.dy = it.dr = 0; }); draw(performance.now()); } else kick(); });

  resize();
  if (reduced) draw(performance.now()); else kick();
})();
