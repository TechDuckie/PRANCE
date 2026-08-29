/* PRANCE 🦄🌈 — JS13kGames 2026
 * Unicorns & Rainbows. Mobile portrait endless runner.
 * Everything is procedural Canvas 2D. No assets. Vanilla JS.
 */
(function () {
  "use strict";

  // ---------- Setup ----------
  var LW = 360;            // logical width (fixed)
  var H = 640;             // logical height (recomputed on resize)
  var W = LW;
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var dpr = 1, scale = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = window.innerWidth, ch = window.innerHeight;
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = (cw * dpr) / LW;     // logical x in [0..360] -> full width
    H = Math.round((ch * dpr) / scale); // logical height fills screen
    W = LW;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Helpers ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- Palette ----------
  var RNB = ["#FF4D6D", "#FF9F43", "#FFE45E", "#65E572", "#38D9FF", "#4D8DFF", "#A855F7"];
  var BODY = "#F7F2FF", SHAD = "#D8C8F2";
  var MANE = ["#FF4FA3", "#FF9A3C", "#FFE45C", "#4DE8FF", "#A96CFF"];
  var HORN = "#FFE45C", EYE = "#21153D";

  // ---------- World state ----------
  var state = "title"; // title | play | over
  var camX = 0;        // world scroll (px)
  var speed = 0;
  var meters = 0;
  var dist = 0;        // floor(meters)
  var starsGot = 0;
  var best = +(localStorage.getItem("prance_best") || 0);

  var gaps = [];       // {a,b} world x gap ranges
  var stars = [];      // {x,y,c,p}
  var cursor = 0;      // generation cursor (world x)
  var hazards = [];    // enemies/hazards {type, wx, ...}
  var shots = [];      // projectiles {wx, y}
  var lastHazardX = 0; // spacing control
  var hiJump = false;  // high-jump landing shake flag
  var firstRoller = false; // guaranteed intro enemy

  var ux = 90;         // unicorn screen x (left third)
  var uy = 0;          // unicorn body-center y
  var vy = 0;
  var grounded = true;
  var feet = 20;       // body center -> feet distance
  var rot = 0;         // flip rotation
  var flip = false;
  var charging = 0;    // 0..1 charge
  var chargeT = 0;
  var runPhase = 0;
  var landSq = 0;      // landing squash timer
  var airT = 0, airDur = 0;
  var dead = false, deadT = 0;

  var pointerDown = false;
  var shake = 0;
  var time = 0;
  var trail = [];     // high-jump trail points
  var camOffY = 0;    // vertical camera offset (world follows the unicorn)
  var GROUND_ANCHOR = 0.62; // where the unicorn's feet rest on screen (fraction of H)

  // ---------- Audio (procedural) ----------
  var AC = null;
  function actx() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (AC && AC.state === "suspended") AC.resume();
    return AC;
  }
  function beep(f, d, type, vol, f2) {
    var a = actx(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || "square";
    var t = a.currentTime;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + d);
    g.gain.setValueAtTime(vol || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + d + 0.02);
  }
  function sJump(p) { beep(280 + p * 240, 0.18, "square", 0.05, 620 + p * 300); }
  function sStar() { beep(880, 0.09, "triangle", 0.06, 1320); }
  function sLand() { beep(150, 0.07, "sine", 0.05, 90); }
  function sDeath() { beep(220, 0.5, "sawtooth", 0.08, 60); }
  function sFlip() { beep(660, 0.12, "triangle", 0.04, 990); }
  function sBolt() { beep(200, 0.18, "sawtooth", 0.05, 80); }

  // ---------- Background music (tiny looping chiptune) ----------
  var musicOn = false, mGain = null, mNext = 0, mStep = 0;
  var BPM = 128, MSTEP = 60 / BPM / 2;   // eighth notes
  var MUSVOL = 0.05;
  var BASE = 523.25;                      // C5
  function mFreq(s) { return BASE * Math.pow(2, s / 12); }
  // three happy phrase variations (semitone offsets from C5, -1 = rest)
  var MEL = [
    [4, 7, 0, 7, 4, 9, 4, -1, 7, 0, 7, 4, 9, 4, 7, 0],
    [0, 2, 4, 7, 9, 7, 4, 2, 0, 2, 4, 9, 12, 9, 7, 4],
    [4, 7, 9, 12, 9, 7, 4, 2, 0, 4, 2, 4, 7, 0, -1, -1]
  ];
  var BASS = [0, -1, 4, -1, 7, -1, 2, -1, 0, -1, 4, -1, 2, -1, 0, -1];
  function startMusic() {
    var a = actx(); if (!a || musicOn) return;
    musicOn = true; mGain = a.createGain(); mGain.gain.value = 1; mGain.connect(a.destination);
    mNext = a.currentTime + 0.15; mStep = 0;
  }
  function mNote(f, t, d, type, vol) {
    var a = actx(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * MUSVOL, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(mGain);
    o.start(t); o.stop(t + d + 0.02);
  }
  function musicTick() {
    if (!musicOn) return;
    var a = AC; if (!a) return;
    if (mNext < a.currentTime - 0.1) mNext = a.currentTime + 0.05; // avoid catch-up burst
    var look = a.currentTime + 0.2;
    while (mNext < look) {
      var s = mStep % 16;
      var ph = ((mStep / 16 | 0) % MEL.length);
      var m = MEL[ph][s];
      if (m >= 0) mNote(mFreq(m), mNext, MSTEP * 0.95, "square", 0.7);
      var b = BASS[s];
      if (b >= 0) mNote(mFreq(b) / 2, mNext, MSTEP * 0.95, "triangle", 0.5); // bass an octave down
      mNext += MSTEP; mStep++;
    }
  }

  // ---------- Terrain ----------
  function difficulty() { return Math.min(1, meters / 2500); }

  function terrainYAt(wx) {
    var amp = 1 + difficulty() * 0.5;
    var base = H * 0.66;
    base += Math.sin(wx * 0.012) * 22 * amp;
    base += Math.sin(wx * 0.027 + 1.3) * 12 * amp;
    base += Math.sin(wx * 0.006 + 4.2) * 28 * amp;
    return base;
  }
  function inGap(wx) {
    for (var i = 0; i < gaps.length; i++) {
      if (wx >= gaps[i].a && wx < gaps[i].b) return true;
    }
    return false;
  }

  function addStar(x, y) { stars.push({ x: x, y: y, c: false, p: Math.random() * 6.28 }); }

  function placeStars(a, b) {
    var t = Math.random();
    if (t < 0.4) { // ground row — hug the surface at each star's own x
      var n = 3 + (Math.random() * 3 | 0), st = (b - a) / n;
      for (var i = 0; i < n; i++) {
        var x = a + st * (i + 0.5);
        addStar(x, terrainYAt(x) - 28);
      }
    } else if (t < 0.75) { // arc — capped so it stays reachable
      var m = 5, s2 = (b - a) / m, h = Math.min(150, 40 + Math.random() * 60);
      for (var j = 0; j < m; j++) {
        var tt = j / (m - 1);
        var ax = a + s2 * j;
        addStar(ax, terrainYAt(ax) - 26 - Math.sin(tt * Math.PI) * h);
      }
    } else { // single high
      var sx2 = (a + b) / 2;
      addStar(sx2, terrainYAt(sx2) - 40 - Math.random() * 22);
    }
  }

  function stageAllows(t) {
    if (t === 1) return meters >= 180;
    if (t === 2) return meters >= 450;
    if (t === 3) return meters >= 900;
    if (t === 4) return meters >= 1400;
    if (t === 5) return meters >= 300;
    return false;
  }
  function spawnHazard(ty, wx) {
    if (ty === 1) hazards.push({ type: 1, wx: wx, rot: 0 });
    else if (ty === 2) hazards.push({ type: 2, wx: wx, phase: Math.random() * 6.28, spd: 3 + Math.random() * 2, amp: 36 + Math.random() * 30, base: terrainYAt(wx) });
    else if (ty === 3) hazards.push({ type: 3, wx: wx, y: terrainYAt(wx) - rand(70, 130), cd: rand(0.6, 1.4) });
    else if (ty === 4) hazards.push({ type: 4, wx: wx, y: terrainYAt(wx) - rand(150, 210), st: "idle", tm: rand(1.2, 2.2) });
  }
  function maybeSpawnHazard(a, b) {
    var opts = [];
    if (stageAllows(1)) opts.push(1);
    if (stageAllows(2)) opts.push(2);
    if (stageAllows(3)) opts.push(3);
    if (stageAllows(4)) opts.push(4);
    if (!opts.length) return;
    if (Math.random() > 0.7) return;
    var wx = (a + b) / 2 + rand(-(b - a) * 0.18, (b - a) * 0.18);
    if (lastHazardX && wx - lastHazardX < 160) return;
    spawnHazard(opts[(Math.random() * opts.length) | 0], wx);
    lastHazardX = wx;
  }

  function genAhead() {
    while (cursor < camX + W + 360) {
      var solid = rand(280, 460) - difficulty() * 60;
      solid = Math.max(180, solid);
      placeStars(cursor, cursor + solid);
      maybeSpawnHazard(cursor, cursor + solid);
      cursor += solid;
      var gapChance = 0.28 + Math.min(0.32, meters / 6000);
      if (cursor > 2000 && Math.random() < gapChance) {
        var gl = 52 + Math.min(150, meters * 0.045 + rand(0, 40));
        var a = cursor, b = cursor + gl;
        gaps.push({ a: a, b: b });
        if (Math.random() < 0.6) {
          addStar((a + b) / 2, terrainYAt(a) - 110 - rand(0, 30)); // high-risk star
        }
        cursor += gl;
        // spike cluster (small-long-small) on the solid ground just after the gap
        if (stageAllows(5) && Math.random() < 0.6) {
          var sp = 16, sl = [26 + Math.random() * 8, 44 + Math.random() * 12, 26 + Math.random() * 8];
          for (var si = 0; si < 3; si++) hazards.push({ type: 5, wx: cursor + 18 + si * sp, len: sl[si] });
        }
      }
    }
    // prune behind
    while (gaps.length && gaps[0].b < camX - 60) gaps.shift();
    while (stars.length && stars[0].x < camX - 60) stars.shift();
    while (hazards.length && (hazards[0].wx < camX - 80 || hazards[0].wx > camX + W + 900)) hazards.shift();
  }

  // ---------- Particles ----------
  var parts = [];
  function spawn(x, y, n, opt) {
    opt = opt || {};
    for (var i = 0; i < n; i++) {
      var a = opt.ang != null ? opt.ang + rand(-opt.spread, opt.spread) : rand(0, 6.28);
      var sp = rand(opt.sp0 || 40, opt.sp1 || 160);
      parts.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opt.up || 0),
        life: opt.life || rand(0.3, 0.7), max: opt.life || 0.7,
        c: opt.c || "#fff", s: opt.s || rand(1.5, 3.5),
        g: opt.g != null ? opt.g : 200, sh: opt.sh || 0
      });
    }
  }
  function updateParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function drawParts() {
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      if (p.sh) { ctx.shadowColor = p.c; ctx.shadowBlur = p.sh; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.s * (p.life / p.max), 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Background ----------
  var bgStars = [];
  for (var i = 0; i < 70; i++) bgStars.push({ x: Math.random() * W, y: Math.random() * H * 0.8, r: rand(0.4, 1.6), p: Math.random() * 6.28 });
  var clouds = [];
  for (var c = 0; c < 5; c++) clouds.push({ x: Math.random() * W, y: rand(H * 0.12, H * 0.45), s: rand(0.7, 1.4), sp: rand(6, 16) });

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#120C35");
    g.addColorStop(0.55, "#24145A");
    g.addColorStop(1, "#5A2B76");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // moon
    ctx.save();
    ctx.shadowColor = "#fff4cf"; ctx.shadowBlur = 30;
    ctx.fillStyle = "#FFF1C9";
    ctx.beginPath(); ctx.arc(W - 56, H * 0.16, 20, 0, 6.2832); ctx.fill();
    ctx.restore();

    // bg stars
    for (var i = 0; i < bgStars.length; i++) {
      var s = bgStars[i];
      var a = 0.35 + Math.sin(time * 1.5 + s.p) * 0.3;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = "#E9E2FF";
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMountains() {
    var cols = ["#24164B", "#2E1C58", "#392365"];
    for (var layer = 0; layer < 3; layer++) {
      var off = (camX * (0.08 + layer * 0.06)) % 240;
      ctx.fillStyle = cols[layer];
      ctx.beginPath();
      ctx.moveTo(-off - 240, H * 0.72);
      var step = 240, base = H * (0.6 + layer * 0.04);
      for (var x = -off - 240; x < W + 240; x += step) {
        var peak = base - (40 + layer * 18) - (x * 0.13 % 30);
        ctx.lineTo(x + step * 0.5, peak);
        ctx.lineTo(x + step, base);
      }
      ctx.lineTo(W + 240, H); ctx.lineTo(-off - 240, H);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawClouds() {
    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      var x = cl.x % (W + 120) - 60;
      drawCloud(x, cl.y, cl.s, ["#34215F", "#4A2B70", "#57377D"][i % 3]);
    }
  }
  function drawCloud(x, y, s, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 14 * s, 0, 6.2832);
    ctx.arc(x + 16 * s, y - 6 * s, 18 * s, 0, 6.2832);
    ctx.arc(x + 36 * s, y, 15 * s, 0, 6.2832);
    ctx.arc(x + 18 * s, y + 6 * s, 16 * s, 0, 6.2832);
    ctx.fill();
  }

  // ---------- Rainbow ----------
  function drawRainbow() {
    var band = 6, total = band * RNB.length;
    // glow pass
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = total + 14;
    drawRainbowPath(0);
    ctx.stroke();
    ctx.restore();

    // bands, centered on the running surface (terrainYAt) so the unicorn runs mid-rainbow
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    var mid = (RNB.length - 1) / 2;
    for (var i = 0; i < RNB.length; i++) {
      ctx.strokeStyle = RNB[i];
      ctx.lineWidth = band;
      drawRainbowPath((i - mid) * band);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRainbowPath(offsetY) {
    ctx.beginPath();
    var started = false;
    var step = 8;
    for (var sx = -20; sx <= W + 20; sx += step) {
      var wx = camX + (sx - ux);
      if (inGap(wx)) { started = false; continue; }
      var y = terrainYAt(wx) - offsetY;
      if (!started) { ctx.moveTo(sx, y); started = true; }
      else ctx.lineTo(sx, y);
    }
  }

  // ---------- Stars (collectibles) ----------
  function drawStarShape(cx, cy, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = rot + i * Math.PI / 5;
      var rr = (i % 2 === 0) ? r : r * 0.45;
      var x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawStars() {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (s.c) continue;
      var sx = ux + (s.x - camX);
      if (sx < -20 || sx > W + 20) continue;
      var r = 6 + Math.sin(time * 3 + s.p) * 0.8;
      var rot = time * 1.5 + s.p;
      ctx.save();
      ctx.shadowColor = "#FFE45E"; ctx.shadowBlur = 12;
      // soft glow
      ctx.fillStyle = "rgba(255,228,94,0.25)";
      drawStarShape(sx, s.y, r * 1.9, rot); ctx.fill();
      // bright body (no outline)
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#FFE45E";
      drawStarShape(sx, s.y, r, rot); ctx.fill();
      // lighter center for a cartoon pop
      ctx.fillStyle = "#FFF3A8";
      drawStarShape(sx, s.y, r * 0.5, rot); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Unicorn ----------
  function drawUnicorn() {
    var crouch = charging * 6;
    var sq = 1, sy = 1;
    if (landSq > 0) { sq = 1 + landSq * 0.35; sy = 1 - landSq * 0.3; }
    var US = 0.7;
    var sw = Math.sin(runPhase) * 8;          // running leg swing
    var bob = Math.abs(Math.sin(runPhase)) * 2;
    var wind = Math.sin(time * 9) * 2;        // mane/tail flow

    ctx.save();
    ctx.translate(ux, uy + crouch - bob);
    ctx.rotate(rot);
    ctx.scale(US * sq, US * sy);
    ctx.translate(0, 21);                      // align spec feet with the ground
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // 1. TAIL — rainbow ribbons flowing back
    ctx.lineWidth = 8;
    ctx.strokeStyle = MANE[0]; ctx.beginPath(); ctx.moveTo(-29, -28); ctx.bezierCurveTo(-48 + wind, -32, -56 + wind, -45, -69, -42); ctx.bezierCurveTo(-76 + wind, -40, -80 + wind, -35, -84, -30); ctx.stroke();
    ctx.strokeStyle = MANE[1]; ctx.beginPath(); ctx.moveTo(-29, -27); ctx.bezierCurveTo(-48 + wind, -30, -57 + wind, -40, -71, -37); ctx.bezierCurveTo(-78 + wind, -35, -82 + wind, -30, -87, -26); ctx.stroke();
    ctx.strokeStyle = MANE[2]; ctx.beginPath(); ctx.moveTo(-30, -24); ctx.bezierCurveTo(-49 + wind, -26, -58 + wind, -35, -72, -32); ctx.bezierCurveTo(-79 + wind, -30, -84 + wind, -25, -89, -21); ctx.stroke();
    ctx.strokeStyle = MANE[3]; ctx.beginPath(); ctx.moveTo(-31, -21); ctx.bezierCurveTo(-49 + wind, -22, -60 + wind, -30, -73, -27); ctx.bezierCurveTo(-81 + wind, -25, -85 + wind, -20, -91, -16); ctx.stroke();
    ctx.strokeStyle = MANE[4]; ctx.beginPath(); ctx.moveTo(-31, -18); ctx.bezierCurveTo(-49 + wind, -18, -61 + wind, -25, -75, -21); ctx.bezierCurveTo(-82 + wind, -19, -87 + wind, -14, -93, -10); ctx.stroke();

    // 2. REAR LEGS — straight, swinging back and forth
    ctx.strokeStyle = BODY; ctx.lineWidth = 8;
    leg(-17, -15, -sw, 23);
    leg(3, -12, sw, 20);

    // 3. BODY
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(-30, -38);
    ctx.bezierCurveTo(-15, -47, 15, -47, 32, -35);
    ctx.bezierCurveTo(42, -27, 42, -10, 28, -5);
    ctx.bezierCurveTo(10, 2, -18, 1, -32, -10);
    ctx.bezierCurveTo(-43, -20, -42, -31, -30, -38);
    ctx.closePath(); ctx.fill();

    // 4. BODY SHADOW
    ctx.fillStyle = SHAD;
    ctx.beginPath(); ctx.ellipse(-1, -11, 28, 10, 0, 0, Math.PI); ctx.fill();

    // 5. NECK
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(17, -30); ctx.lineTo(30, -54); ctx.lineTo(46, -48); ctx.lineTo(34, -17);
    ctx.closePath(); ctx.fill();

    // 6. FRONT LEGS — straight, swinging back and forth
    ctx.strokeStyle = BODY; ctx.lineWidth = 8;
    leg(20, -18, sw, 20);
    leg(14, -16, -sw, 20);

    // 7. MANE — rainbow ribbons flowing back
    ctx.lineWidth = 7;
    ctx.strokeStyle = MANE[0]; ctx.beginPath(); ctx.moveTo(34, -67); ctx.bezierCurveTo(19 + wind, -72, 9 + wind, -63, 3, -53); ctx.stroke();
    ctx.strokeStyle = MANE[1]; ctx.beginPath(); ctx.moveTo(31, -62); ctx.bezierCurveTo(17 + wind, -67, 5 + wind, -58, -3, -48); ctx.stroke();
    ctx.strokeStyle = MANE[2]; ctx.beginPath(); ctx.moveTo(30, -59); ctx.bezierCurveTo(16 + wind, -64, 5 + wind, -55, -4, -44); ctx.stroke();
    ctx.strokeStyle = MANE[3]; ctx.beginPath(); ctx.moveTo(29, -55); ctx.bezierCurveTo(15 + wind, -60, 5 + wind, -52, -5, -42); ctx.stroke();
    ctx.strokeStyle = MANE[4]; ctx.beginPath(); ctx.moveTo(28, -51); ctx.bezierCurveTo(14 + wind, -55, 4 + wind, -47, -7, -37); ctx.stroke();

    // 8. HEAD
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(25, -55);
    ctx.bezierCurveTo(29, -68, 43, -74, 57, -69);
    ctx.bezierCurveTo(68, -66, 73, -57, 69, -48);
    ctx.bezierCurveTo(65, -40, 54, -37, 43, -40);
    ctx.bezierCurveTo(34, -42, 28, -47, 25, -55);
    ctx.closePath(); ctx.fill();

    // 9. MUZZLE
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.ellipse(62, -49, 12, 8, 0, 0, 6.2832); ctx.fill();

    // 10. EAR
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.moveTo(35, -67); ctx.lineTo(33, -81); ctx.lineTo(44, -71); ctx.closePath(); ctx.fill();
    ctx.fillStyle = SHAD;
    ctx.beginPath(); ctx.moveTo(36, -70); ctx.lineTo(35, -77); ctx.lineTo(41, -72); ctx.closePath(); ctx.fill();

    // 11. HORN — small golden cone
    ctx.save();
    ctx.shadowColor = HORN; ctx.shadowBlur = 8;
    ctx.fillStyle = HORN;
    ctx.beginPath(); ctx.moveTo(45, -69); ctx.lineTo(52, -86); ctx.lineTo(56, -68); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#FFF3A0"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(50, -72); ctx.lineTo(53, -81); ctx.stroke();

    // 12. EYE
    ctx.fillStyle = EYE;
    ctx.beginPath(); ctx.arc(56, -56, 2.8, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(57, -57, 0.8, 0, 6.2832); ctx.fill();

    // nostril
    ctx.fillStyle = SHAD;
    ctx.beginPath(); ctx.arc(69, -47, 1.2, 0, 6.2832); ctx.fill();

    ctx.restore();

    function leg(x0, y0, s, len) {
      var fx = x0 + s, fy = y0 + len;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.fillStyle = EYE;
      ctx.beginPath(); ctx.arc(fx, fy, 3, 0, 6.2832); ctx.fill();
    }
  }

  // ---------- Input ----------
  function startCharge() {
    if (state === "title" || state === "over") { startGame(); return; }
    if (state === "play" && grounded) chargeT = 0;
    pointerDown = true;
    startMusic();
  }
  function releaseCharge() {
    pointerDown = false;
    if (state === "play" && grounded && charging > 0.02) doJump();
    charging = 0;
  }
  function doJump() {
    var p = charging;
    vy = lerp(-380, -780, p);
    grounded = false;
    flip = p > 0.55;
    hiJump = p > 0.55;
    airT = 0; airDur = 2 * Math.abs(vy) / 1400;
    rot = 0;
    sJump(p);
    spawn(ux, uy + feet, 6, { c: "#D8C8F2", sp0: 30, sp1: 90, life: 0.4, g: 300 });
  }

  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); startCharge(); }, { passive: false });
  window.addEventListener("pointerup", function (e) { releaseCharge(); });
  window.addEventListener("pointercancel", function (e) { releaseCharge(); });
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp") { if (!pointerDown) startCharge(); }
  });
  window.addEventListener("keyup", function (e) {
    if (e.code === "Space" || e.code === "ArrowUp") releaseCharge();
  });
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });

  // ---------- Game flow ----------
  function startGame() {
    actx();
    startMusic();
    state = "play";
    camX = 0; speed = 200; meters = 0; dist = 0; starsGot = 0;
    gaps.length = 0; stars.length = 0; parts.length = 0; trail.length = 0;
    hazards.length = 0; shots.length = 0; lastHazardX = 0; hiJump = false; firstRoller = false;
    cursor = -50; uy = terrainYAt(0) - feet; vy = 0; grounded = true;
    rot = 0; flip = false; charging = 0; chargeT = 0; landSq = 0;
    dead = false; deadT = 0; shake = 0;
    genAhead();
  }

  function gameOver() {
    state = "over";
    dead = true; deadT = 0;
    shake = 14;
    sDeath();
    spawn(ux, uy, 26, { c: "#FF4FA3", sp0: 60, sp1: 220, life: 0.8, g: 260, sh: 6 });
    spawn(ux, uy, 16, { c: "#4DE8FF", sp0: 40, sp1: 180, life: 0.8, g: 260 });
    if (dist > best) { best = dist; localStorage.setItem("prance_best", best); }
  }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    // clouds drift always
    for (var i = 0; i < clouds.length; i++) {
      clouds[i].x -= clouds[i].sp * dt;
      if (clouds[i].x < -80) { clouds[i].x = W + 80; clouds[i].y = rand(H * 0.12, H * 0.45); }
    }
    if (landSq > 0) landSq = Math.max(0, landSq - dt * 4);
    if (shake > 0) shake = Math.max(0, shake - dt * 30);

    if (state !== "play") {
      if (state === "title") {
        uy = terrainYAt(camX0()) - feet + Math.sin(time * 2) * 1.5; // idle bob
      }
      // on "over" the unicorn stays where it fell (beside the broken rainbow)
      runPhase += dt * 8;
      updateCamera(dt);
      updateParts(dt);
      return;
    }

    // charge
    if (pointerDown && grounded) {
      chargeT += dt;
      charging = clamp(chargeT / 0.6, 0, 1);
    }

    // speed & distance
    speed = Math.min(560, 200 + meters * 0.18);
    camX += speed * dt;
    meters = camX / 24;
    dist = Math.floor(meters);
    genAhead();
    // guarantee the player meets at least one enemy early, so they learn hazards exist
    if (!firstRoller && meters >= 140) {
      spawnHazard(1, camX + W * 0.6);
      firstRoller = true;
    }

    // physics
    if (!grounded) {
      vy += 1400 * dt;
      uy += vy * dt;
      airT += dt;
      if (flip) {
        rot = clamp(airT / Math.max(0.001, airDur), 0, 1) * 6.2832;
        if (Math.random() < 0.5) spawn(ux, uy - 4, 1, { c: MANE[(Math.random() * 5) | 0], sp0: 10, sp1: 40, life: 0.4, g: 0, sh: 4 });
      }
      var gy = terrainYAt(camX);
      var tol = 26 + (1 - difficulty()) * 16; // forgiving early, strict late
      if (!inGap(camX) && vy > 0 && uy + feet >= gy && uy + feet <= gy + tol) {
        // land
        uy = gy - feet; vy = 0; grounded = true; rot = 0; flip = false;
        if (hiJump) { shake = 4; hiJump = false; }
        landSq = 1; sLand();
        spawn(ux, uy + feet, 8, { c: "#ffffff", sp0: 40, sp1: 120, life: 0.35, g: 200, ang: -1.57, spread: 1.1 });
      }
      // high-jump trail (stored in world space so it flows left with travel)
      if (flip && vy < -120) { trail.push({ wx: camX, y: uy, life: 0.45 }); }
    } else {
      // grounded: hug terrain
      var g = terrainYAt(camX);
      if (inGap(camX)) {
        grounded = false; vy = 0; charging = 0; // run off edge
      } else {
        uy = g - feet;
      }
    }

    // trail decay
    for (var t = trail.length - 1; t >= 0; t--) {
      trail[t].life -= dt;
      if (trail[t].life <= 0) trail.splice(t, 1);
    }

    runPhase += dt * (8 + speed * 0.02);

    // stars collection
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      if (st.c) continue;
      var ssx = ux + (st.x - camX);
      if (ssx < -20 || ssx > W + 20) continue;
      var dx = ssx - ux, dy = st.y - uy;
      if (dx * dx + dy * dy < 22 * 22) {
        st.c = true; starsGot++; sStar();
        spawn(ssx, st.y, 8, { c: "#FFE45E", sp0: 40, sp1: 140, life: 0.5, g: 120, sh: 5 });
      }
    }

    // hazards
    updateHazards(dt);
    if (checkHazards()) gameOver();

    // death
    if (uy > H + 40) gameOver();

    updateCamera(dt);
    updateParts(dt);
  }
  // vertical camera: the world follows the unicorn so jumps feel like forward motion
  function updateCamera(dt) {
    var anchor = H * GROUND_ANCHOR;
    var target = anchor - (uy + feet);
    target = clamp(target, -H * 0.22, H * 0.4);
    camOffY += (target - camOffY) * Math.min(1, dt * 5);
  }
  // helper for idle bob so it references a stable ground
  function camX0() { return state === "play" ? camX : 0; }

  // ---------- Hazards ----------
  function updateHazards(dt) {
    for (var i = hazards.length - 1; i >= 0; i--) {
      var h = hazards[i];
      if (h.type === 1) {
        h.rot -= (speed + 60) * dt / 16; // roll LEFT (toward player) as it travels
        h.wx -= 60 * dt; // drift slowly toward the player
      } else if (h.type === 3) {
        h.cd -= dt;
        var sx = ux + (h.wx - camX);
        if (h.cd <= 0 && sx > 0 && sx < W) {
          shots.push({ wx: h.wx - 12, y: h.y });
          h.cd = rand(1.4, 2.4);
        }
      } else if (h.type === 4) {
        h.tm -= dt;
        if (h.st === "idle") { if (h.tm <= 0) { h.st = "warn"; h.tm = 0.6; } }
        else if (h.st === "warn") { if (h.tm <= 0) { h.st = "strike"; h.tm = 0.25; sBolt(); } }
        else if (h.st === "strike") { if (h.tm <= 0) { h.st = "idle"; h.tm = rand(1.4, 2.4); } }
      }
      if (h.wx < camX - 80) hazards.splice(i, 1);
    }
    for (var j = shots.length - 1; j >= 0; j--) {
      shots[j].wx -= 230 * dt;
      if (shots[j].wx < camX - 40) shots.splice(j, 1);
    }
  }
  function checkHazards() {
    var R = 12; // unicorn hit radius (smaller than visual = fair)
    for (var i = 0; i < hazards.length; i++) {
      var h = hazards[i], sx = ux + (h.wx - camX);
      if (sx < -40 || sx > W + 40) continue;
      if (h.type === 1) {
        var ry = terrainYAt(h.wx) - 15;
        if (Math.abs(ux - sx) < 14 + R && Math.abs(uy - ry) < 14 + R) return true;
      } else if (h.type === 2) {
        var hy = h.base - 30 + Math.sin(time * h.spd + h.phase) * h.amp;
        if ((ux - sx) * (ux - sx) + (uy - hy) * (uy - hy) < (R + 9) * (R + 9)) return true;
      } else if (h.type === 3) {
        if ((ux - sx) * (ux - sx) + (uy - h.y) * (uy - h.y) < (R + 9) * (R + 9)) return true;
      } else if (h.type === 4 && h.st === "strike") {
        var top = h.y + 10, bot = terrainYAt(h.wx) - 34;
        if (Math.abs(ux - sx) < 8 + R && uy > top - 30 && uy < bot) return true;
      } else if (h.type === 5) {
        var sy = terrainYAt(h.wx);
        if (Math.abs(ux - sx) < 8 + R && uy > sy - h.len - R) return true;
      }
    }
    for (var k = 0; k < shots.length; k++) {
      var sh = shots[k], ssx = ux + (sh.wx - camX);
      if ((ux - ssx) * (ux - ssx) + (uy - sh.y) * (uy - sh.y) < (R + 5) * (R + 5)) return true;
    }
    return false;
  }

  // ---------- UI ----------
  function drawTrail() {
    if (trail.length < 2) return;
    var pts = [];
    for (var i = 0; i < trail.length; i++) {
      pts.push({ x: ux + (trail[i].wx - camX), y: trail[i].y, a: clamp(trail[i].life / 0.45, 0, 1) });
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var c = 0; c < 7; c++) {
      ctx.strokeStyle = RNB[c];
      // soft glow pass
      ctx.globalAlpha = 0.2 * pts[0].a;
      ctx.lineWidth = 18;
      strokeRibbon(pts, c);
      // bright pass
      ctx.globalAlpha = 0.95 * pts[0].a;
      ctx.lineWidth = 9;
      strokeRibbon(pts, c);
    }
    ctx.globalAlpha = 1;
    function strokeRibbon(pts, c) {
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        var wave = Math.sin(i * 0.8 + time * 6) * 2;
        var y = pts[i].y + c * 1.7 + wave;
        if (i) ctx.lineTo(pts[i].x, y); else ctx.moveTo(pts[i].x, y);
      }
      ctx.stroke();
    }
  }

  function drawHUD() {
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(dist + "m", 14, 34);
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFE45E";
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillText("⭐ " + starsGot, W - 14, 32);
    ctx.textAlign = "left";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTitleParade() {
    // cosmetic enemies drifting across behind the title
    var rx1 = W + 40 - ((time * 110) % (W + 120));
    drawRoller(rx1, H * 0.62, -time * 5);
    var rx2 = W + 40 - (((time + 2.3) * 110) % (W + 120));
    drawRoller(rx2, H * 0.46, -time * 5);
    var hx = W + 40 - (((time * 80 + 1.1 * (W + 120)) % (W + 120)));
    drawHopper(hx, H * 0.5 + Math.abs(Math.sin(time * 3)) * 18);
    for (var i = 0; i < 3; i++) {
      var sx = W + 30 - (((time * 60 + i * 140) % (W + 80)));
      var sy = H * (0.28 + i * 0.13) + Math.sin(time * 2 + i) * 8;
      ctx.save();
      ctx.shadowColor = "#FFE45E"; ctx.shadowBlur = 10;
      ctx.fillStyle = "#FFE45E"; drawStarShape(sx, sy, 7, time + i); ctx.fill();
      ctx.fillStyle = "#FFF3A8"; drawStarShape(sx, sy, 3.5, time + i); ctx.fill();
      ctx.restore();
    }
  }
  function drawTitle() {
    // soft vignette so the title pops but the rainbow still glows
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(18,10,45,0.22)");
    g.addColorStop(0.5, "rgba(18,10,45,0.10)");
    g.addColorStop(1, "rgba(18,10,45,0.30)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    drawTitleParade();

    ctx.textAlign = "center";
    // big PRANCE — thick pink outline + white fill, gentle bounce
    var bob = Math.sin(time * 2) * 6;
    ctx.save();
    ctx.translate(W / 2, H * 0.36 + bob);
    ctx.shadowColor = "#FF4FA3"; ctx.shadowBlur = 16;
    ctx.font = "bold 66px system-ui, sans-serif";
    ctx.lineJoin = "round"; ctx.lineWidth = 9; ctx.strokeStyle = "#FF4FA3";
    ctx.strokeText("PRANCE", 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff"; ctx.fillText("PRANCE", 0, 0);
    ctx.restore();

    ctx.fillStyle = "#FFE45E";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("🦄  Run the rainbow  🌈", W / 2, H * 0.36 + 44);

    var pulse = 0.55 + Math.sin(time * 3) * 0.45;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 21px system-ui, sans-serif";
    ctx.fillText("tap & hold to jump", W / 2, H * 0.8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "15px system-ui, sans-serif";
    ctx.fillText("hold longer = jump higher", W / 2, H * 0.8 + 26);

    // sleek credit, bottom-left, in the rainbow palette
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.8;
    ctx.font = "12px system-ui, sans-serif";
    var cx = 14, cyy = H - 14;
    ctx.fillStyle = "#fff"; ctx.fillText("made for ", cx, cyy);
    cx += ctx.measureText("made for ").width;
    ctx.fillStyle = "#FF4FA3"; ctx.fillText("JS13k 2026", cx, cyy);
    cx += ctx.measureText("JS13k 2026").width;
    ctx.fillStyle = "#4DE8FF"; ctx.fillText(" by Badankan", cx, cyy);
    ctx.globalAlpha = 1;
  }

  function drawOver() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(18,10,45,0.30)");
    g.addColorStop(0.5, "rgba(18,10,45,0.18)");
    g.addColorStop(1, "rgba(18,10,45,0.36)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    drawTitleParade();

    ctx.textAlign = "center";
    // GAME OVER — pink outline + white fill, gentle bounce (matches title)
    var bob = Math.sin(time * 2) * 5;
    ctx.save();
    ctx.translate(W / 2, H * 0.3 + bob);
    ctx.shadowColor = "#FF4FA3"; ctx.shadowBlur = 16;
    ctx.font = "bold 52px system-ui, sans-serif";
    ctx.lineJoin = "round"; ctx.lineWidth = 8; ctx.strokeStyle = "#FF4FA3";
    ctx.strokeText("GAME OVER", 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff"; ctx.fillText("GAME OVER", 0, 0);
    ctx.restore();

    // stats, on-theme colors
    ctx.fillStyle = "#fff"; ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText(dist + " m", W / 2, H * 0.45);
    ctx.fillStyle = "#FFE45E"; ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("⭐ " + starsGot, W / 2, H * 0.45 + 30);
    ctx.fillStyle = "#4DE8FF"; ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("BEST  " + best + " m", W / 2, H * 0.45 + 56);

    // cute restart button — pink fill, white thick outline, gentle pulse
    var bw = 200, bh = 56;
    var pulse = 1 + Math.sin(time * 3) * 0.03;
    ctx.save();
    ctx.translate(W / 2, H * 0.66 + bh / 2);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = "#FF4FA3"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#FF4FA3";
    roundRect(-bw / 2, -bh / 2, bw, bh, 16); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3; ctx.strokeStyle = "#fff";
    roundRect(-bw / 2, -bh / 2, bw, bh, 16); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText("↻  PLAY AGAIN", 0, 8);
    ctx.restore();

    // sleek credit, bottom-left, matches the menu
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.8; ctx.font = "12px system-ui, sans-serif";
    var cx = 14, cyy = H - 14;
    ctx.fillStyle = "#fff"; ctx.fillText("made for ", cx, cyy);
    cx += ctx.measureText("made for ").width;
    ctx.fillStyle = "#FF4FA3"; ctx.fillText("JS13k 2026", cx, cyy);
    cx += ctx.measureText("JS13k 2026").width;
    ctx.fillStyle = "#4DE8FF"; ctx.fillText(" by Badankan", cx, cyy);
    ctx.globalAlpha = 1;
  }

  // ---------- Hazard drawing ----------
  function drawHazards() {
    for (var i = 0; i < hazards.length; i++) {
      var h = hazards[i], sx = ux + (h.wx - camX);
      if (sx < -60 || sx > W + 60) continue;
      if (h.type === 1) drawRoller(sx, terrainYAt(h.wx) - 15, h.rot);
      else if (h.type === 2) { var hy = h.base - 30 + Math.sin(time * h.spd + h.phase) * h.amp; drawHopper(sx, hy); }
      else if (h.type === 3) drawShooter(sx, h.y);
      else if (h.type === 4) drawStorm(sx, h.y, h.st, h.wx);
      else if (h.type === 5) drawSpikes(sx, terrainYAt(h.wx), h.len);
    }
  }
  function drawShots() {
    for (var i = 0; i < shots.length; i++) {
      var sh = shots[i], sx = ux + (sh.wx - camX);
      ctx.save();
      ctx.shadowColor = "#FF5DFF"; ctx.shadowBlur = 12;
      ctx.fillStyle = "#FF5DFF"; ctx.beginPath(); ctx.arc(sx, sh.y, 5, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,93,255,0.28)"; ctx.beginPath(); ctx.arc(sx + 7, sh.y, 8, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  }
  function drawRoller(x, y, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.lineJoin = "round";
    // soft glow so it pops
    ctx.shadowColor = "#C77DFF"; ctx.shadowBlur = 12;
    // bright cartoon spikes (no outlines), radiating from the ball
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * 6.2832;
      var b0x = Math.cos(a - 0.2) * 15, b0y = Math.sin(a - 0.2) * 15;
      var b1x = Math.cos(a + 0.2) * 15, b1y = Math.sin(a + 0.2) * 15;
      var tx = Math.cos(a) * 30, ty = Math.sin(a) * 30;
      ctx.beginPath();
      ctx.moveTo(b0x, b0y); ctx.lineTo(tx, ty); ctx.lineTo(b1x, b1y); ctx.closePath();
      ctx.fillStyle = "#FF4FA3"; ctx.fill();
    }
    // bright ball body
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, 6.2832);
    ctx.fillStyle = "#A96CFF"; ctx.fill();
    ctx.shadowBlur = 0;
    // lighter top crescent for cartoon shading
    ctx.beginPath(); ctx.arc(0, 0, 17, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fillStyle = "#D7A6FF"; ctx.fill();
    // glossy highlight
    ctx.beginPath(); ctx.arc(-5, -6, 6, 0, 6.2832);
    ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
    ctx.restore();
  }
  function drawHopper(x, y) {
    ctx.save();
    ctx.shadowColor = "#D95CFF"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#B84DFF"; ctx.beginPath(); ctx.ellipse(x, y, 11, 13, 0, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#E47CFF"; ctx.beginPath(); ctx.ellipse(x - 3, y - 4, 5, 6, 0, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = "#7026B5"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for (var t = -2; t <= 2; t++) {
      ctx.beginPath(); ctx.moveTo(x + t * 3, y + 11);
      ctx.lineTo(x + t * 3 + Math.sin(time * 8 + t) * 3, y + 18); ctx.stroke();
    }
    ctx.fillStyle = "#24133F";
    ctx.beginPath(); ctx.arc(x - 3, y - 2, 1.6, 0, 6.2832); ctx.arc(x + 3, y - 2, 1.6, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
  function drawShooter(x, y) {
    ctx.save();
    ctx.shadowColor = "#C45CFF"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#33205F"; ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#6335A8"; ctx.beginPath(); ctx.arc(x - 3, y - 3, 5, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 18, y - 6); ctx.lineTo(x - 12, y + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#FFFFFF"; ctx.beginPath(); ctx.arc(x + 2, y, 4, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#FF5DFF"; ctx.beginPath(); ctx.arc(x + 2, y, 2, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
  function drawStorm(x, y, st, wx) {
    ctx.save();
    ctx.fillStyle = "#35205F";
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, 6.2832); ctx.arc(x + 16, y - 4, 18, 0, 6.2832);
    ctx.arc(x + 34, y, 15, 0, 6.2832); ctx.arc(x + 16, y + 6, 17, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "#56327A"; ctx.beginPath(); ctx.arc(x + 14, y - 4, 10, 0, 6.2832); ctx.fill();
    if (st === "warn") {
      ctx.fillStyle = "rgba(255,228,94," + (0.25 + 0.3 * Math.abs(Math.sin(time * 18))) + ")";
      ctx.fillRect(x + 14 - 3, y + 12, 6, terrainYAt(wx) - 34 - (y + 12));
    } else if (st === "strike") {
      ctx.strokeStyle = "#FFE45E"; ctx.lineWidth = 4; ctx.lineCap = "round";
      ctx.shadowColor = "#FFF1A3"; ctx.shadowBlur = 16;
      ctx.beginPath();
      var lx = x + 16, ly = y + 12, by = terrainYAt(wx) - 34;
      ctx.moveTo(lx, ly);
      for (var s = 1; s <= 5; s++) {
        var ny = ly + (by - ly) * (s / 5);
        ctx.lineTo(lx + (s % 2 ? 8 : -8), ny);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
  function drawSpikes(x, sy, len) {
    ctx.save();
    ctx.shadowColor = "#C85CFF"; ctx.shadowBlur = 10;
    ctx.fillStyle = "#B95CFF";
    ctx.beginPath(); ctx.moveTo(x - 9, sy); ctx.lineTo(x + 9, sy); ctx.lineTo(x, sy - len); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#F1B3FF";
    ctx.beginPath(); ctx.moveTo(x - 3, sy); ctx.lineTo(x + 3, sy); ctx.lineTo(x, sy - len * 0.7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function chargingColor(c) {
    if (c < 0.33) return "#FF4FA3";
    if (c < 0.66) return "#FF9A3C";
    if (c < 0.9) return "#4DE8FF";
    return "#FFFFFF";
  }
  function drawJumpMeter() {
    if (charging <= 0.001) return; // only while charging
    var hy = uy + camOffY;                 // horse feet in screen space
    var bw = 14, bh = 80, bx = ux - 56, by = hy - bh - 8, r = 3;
    // track
    ctx.fillStyle = "rgba(20,12,40,0.55)"; roundRect(bx, by, bw, bh, r); ctx.fill();
    // pink outline
    ctx.lineWidth = 3; ctx.strokeStyle = "#FF4FA3"; roundRect(bx, by, bw, bh, r); ctx.stroke();
    // fill bottom-up by charge (jump height)
    var fh = bh * clamp(charging, 0, 1);
    ctx.fillStyle = chargingColor(charging);
    if (charging > 0.9) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; }
    roundRect(bx, by + (bh - fh), bw, fh, r); ctx.fill();
    ctx.shadowBlur = 0;
    if (charging > 0.9) {
      for (var s = 0; s < 3; s++) {
        var a = time * 6 + s * 2.1;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(bx + bw / 2 + Math.cos(a) * 7, by - 6 + Math.sin(a) * 5, 1.6, 0, 6.2832); ctx.fill();
      }
    }
  }

  // ---------- Render ----------
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var shx = 0, shy = 0;
    if (shake > 0) { shx = rand(-shake, shake); shy = rand(-shake, shake); }
    ctx.setTransform(scale, 0, 0, scale, shx * scale, shy * scale);

    drawSky();
    drawMountains();
    drawClouds();

    // gameplay layer follows the unicorn vertically so jumps move with it
    ctx.save();
    ctx.translate(0, camOffY);
    drawRainbow();
    drawStars();
    drawHazards();
    drawShots();
    drawTrail();
    drawUnicorn();
    drawParts();
    ctx.restore();

    if (state === "play") { drawHUD(); drawJumpMeter(); }
    if (state === "title") drawTitle();
    if (state === "over") drawOver();
  }

  // ---------- Loop ----------
  var last = performance.now();
  function frame(now) {
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big gaps
    update(dt);
    musicTick();
    render();
    requestAnimationFrame(frame);
  }
  // init idle scene
  uy = terrainYAt(0) - feet;
  genAhead();
  requestAnimationFrame(frame);
})();
