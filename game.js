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
  var HORN = "#FFE66D", EYE = "#21153D";

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
    if (t === 5) return meters >= 450;
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
        if (stageAllows(5) && Math.random() < 0.45) {
          hazards.push({ type: 5, wx: b, len: 34 + Math.random() * 30 }); // spike at landing edge
        }
        cursor += gl;
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

    // bands (violet bottom -> red top)
    ctx.save();
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var i = 0; i < RNB.length; i++) {
      ctx.strokeStyle = RNB[i];
      ctx.lineWidth = band;
      drawRainbowPath(i * band);
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
      ctx.fillStyle = "rgba(255,228,94,0.22)";
      drawStarShape(sx, s.y, r * 2.0, rot); ctx.fill();
      // crisp body
      ctx.fillStyle = "#FFE45E";
      drawStarShape(sx, s.y, r, rot); ctx.fill();
      // outline for readability
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      drawStarShape(sx, s.y, r, rot); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(122,44,118,0.9)";
      drawStarShape(sx, s.y, r * 1.45, rot + 0.2); ctx.stroke();
      ctx.restore();
    }
  }

  // ---------- Unicorn ----------
  function drawUnicorn() {
    var sx = ux;
    var crouch = charging * 6;
    var sq = 1, sy = 1;
    if (landSq > 0) { sq = 1 + landSq * 0.35; sy = 1 - landSq * 0.3; }

    ctx.save();
    ctx.translate(sx, uy + crouch);
    ctx.rotate(rot);
    ctx.scale(sq, sy);

    // tail — two clean flowing strands behind the rump
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var ti = 0; ti < 2; ti++) {
      ctx.strokeStyle = MANE[ti + 2];
      ctx.lineWidth = 3.4;
      var tw = Math.sin(time * 9 + ti * 1.4) * 3;
      ctx.beginPath();
      ctx.moveTo(-22, -2 - ti * 2);
      ctx.quadraticCurveTo(-34 - ti * 2, -4 + tw, -39 - ti * 3, 12 + tw);
      ctx.stroke();
    }

    // legs — rounded with a run cycle
    var lg = Math.sin(runPhase) * 4.5;
    var lg2 = Math.sin(runPhase + Math.PI) * 4.5;
    legShape(-13, lg); legShape(-4, lg2); legShape(9, lg); legShape(17, lg2);

    // body — smooth capsule
    ctx.fillStyle = BODY;
    roundRect(-24, -11, 48, 22, 11); ctx.fill();
    // soft belly shade
    ctx.fillStyle = SHAD;
    roundRect(-20, 5, 40, 6, 3); ctx.fill();

    // neck — smooth wedge flowing into the head
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.moveTo(14, -6);
    ctx.quadraticCurveTo(20, -16, 27, -19);
    ctx.lineTo(31, -10);
    ctx.quadraticCurveTo(22, -2, 16, 3);
    ctx.closePath();
    ctx.fill();

    // mane — three clean wind-blown strands
    for (var m = 0; m < 3; m++) {
      ctx.strokeStyle = MANE[m];
      ctx.lineWidth = 3.4; ctx.lineCap = "round";
      var w = Math.sin(time * 9 + m * 0.9) * 3.5;
      ctx.beginPath();
      ctx.moveTo(24 - m * 0.6, -19 - m * 0.4);
      ctx.quadraticCurveTo(10 - m, -25 + w, -9 - m * 1.5, -9 + w * 0.5);
      ctx.stroke();
    }

    // head — tilted forward; horn + ear follow the head angle
    var headAngle = 0.12;
    ctx.save();
    ctx.translate(27, -19);
    ctx.rotate(headAngle);
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.ellipse(4, 0, 10, 6.5, 0, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13, 2.5, 6, 4, 0, 0, 6.2832); ctx.fill();
    // ear
    ctx.beginPath(); ctx.moveTo(-1, -6); ctx.lineTo(-2, -14); ctx.lineTo(4, -7); ctx.closePath(); ctx.fill();
    // forelock
    ctx.strokeStyle = MANE[1]; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(1, -6); ctx.quadraticCurveTo(-3, -12, 3, -14); ctx.stroke();
    // horn — points up-forward, rotates with the head
    ctx.save();
    ctx.shadowColor = HORN; ctx.shadowBlur = 10; ctx.fillStyle = HORN;
    ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(7, -19); ctx.lineTo(11, -3); ctx.closePath(); ctx.fill();
    ctx.restore();
    // eye + highlight
    ctx.fillStyle = EYE;
    ctx.beginPath(); ctx.arc(7, -1, 1.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(7.6, -1.6, 0.6, 0, 6.2832); ctx.fill();
    // nostril
    ctx.fillStyle = SHAD;
    ctx.beginPath(); ctx.arc(17, 3, 1, 0, 6.2832); ctx.fill();
    ctx.restore();

    ctx.restore();
  }
  function legShape(x, sw) {
    ctx.save();
    ctx.translate(x, 8);
    ctx.rotate(sw * 0.05);
    ctx.fillStyle = SHAD;
    roundRect(-2.5, 0, 5, 12, 2.5); ctx.fill();
    ctx.fillStyle = EYE;
    roundRect(-2.5, 10, 5, 2.5, 1.2); ctx.fill(); // hoof
    ctx.restore();
  }

  // ---------- Input ----------
  function startCharge() {
    if (state === "title" || state === "over") { startGame(); return; }
    if (state === "play" && grounded) chargeT = 0;
    pointerDown = true;
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
      if (vy < -120) { trail.push({ wx: camX, y: uy, life: 0.45 }); }
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
        if (Math.abs(ux - sx) < 8 + R && uy > sy - 2 && uy < sy + h.len) return true;
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
    for (var i = 0; i < trail.length; i++) {
      var t = trail[i];
      ctx.globalAlpha = clamp(t.life / 0.45, 0, 1) * 0.5;
      ctx.fillStyle = RNB[(i + (time * 10 | 0)) % RNB.length];
      ctx.beginPath(); ctx.arc(ux + (t.wx - camX), t.y, 5, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
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

  function drawTitle() {
    ctx.fillStyle = "rgba(10,6,30,0.35)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.save();
    ctx.shadowColor = "#A855F7"; ctx.shadowBlur = 18;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 56px system-ui, sans-serif";
    ctx.fillText("PRANCE", W / 2, H * 0.4);
    ctx.restore();
    ctx.fillStyle = "#FFE45E";
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("🦄  Run the rainbow  🌈", W / 2, H * 0.4 + 34);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "16px system-ui, sans-serif";
    var pulse = 0.6 + Math.sin(time * 3) * 0.4;
    ctx.globalAlpha = pulse;
    ctx.fillText("tap & hold to jump — release to leap", W / 2, H * 0.78);
    ctx.fillText("hold longer = jump higher", W / 2, H * 0.78 + 24);
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  }

  function drawOver() {
    ctx.fillStyle = "rgba(10,6,30,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.save();
    ctx.shadowColor = "#FF4D6D"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 42px system-ui, sans-serif";
    ctx.fillText("GAME OVER", W / 2, H * 0.34);
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText(dist + " m", W / 2, H * 0.46);
    ctx.fillStyle = "#FFE45E";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("⭐ " + starsGot, W / 2, H * 0.46 + 30);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("BEST  " + best + " m", W / 2, H * 0.46 + 56);

    // big restart button
    var bw = 180, bh = 56, bx = W / 2 - bw / 2, by = H * 0.64;
    ctx.fillStyle = "#A855F7";
    ctx.save(); ctx.shadowColor = "#A855F7"; ctx.shadowBlur = 16;
    roundRect(bx, by, bw, bh, 16); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText("↻  PLAY AGAIN", W / 2, by + 37);
    ctx.textAlign = "left";
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
    // big cartoon spikes with dark outlines, radiating from the ball
    for (var k = 0; k < 8; k++) {
      var a = k / 8 * 6.2832;
      var b0x = Math.cos(a - 0.18) * 14, b0y = Math.sin(a - 0.18) * 14;
      var b1x = Math.cos(a + 0.18) * 14, b1y = Math.sin(a + 0.18) * 14;
      var tx = Math.cos(a) * 28, ty = Math.sin(a) * 28;
      ctx.beginPath();
      ctx.moveTo(b0x, b0y); ctx.lineTo(tx, ty); ctx.lineTo(b1x, b1y); ctx.closePath();
      ctx.fillStyle = "#C77DFF"; ctx.fill();
      ctx.lineWidth = 2.6; ctx.strokeStyle = "#241338"; ctx.stroke();
    }
    // ball body with thick cartoon outline
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, 6.2832);
    ctx.fillStyle = "#7A43B8"; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#241338"; ctx.stroke();
    // glossy highlight
    ctx.beginPath(); ctx.arc(-5, -5, 6, 0, 6.2832);
    ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fill();
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
    ctx.beginPath(); ctx.moveTo(x - 9, sy); ctx.lineTo(x + 9, sy); ctx.lineTo(x, sy + len); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#F1B3FF";
    ctx.beginPath(); ctx.moveTo(x - 3, sy); ctx.lineTo(x + 3, sy); ctx.lineTo(x, sy + len * 0.7); ctx.closePath(); ctx.fill();
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
    var bw = 12, bh = 120, bx = ux - 56, by = hy - bh - 8;
    // track
    ctx.fillStyle = "rgba(0,0,0,0.35)"; roundRect(bx, by, bw, bh, 6); ctx.fill();
    // fill bottom-up by charge (jump height)
    var fh = bh * clamp(charging, 0, 1);
    var c = chargingColor(charging);
    ctx.fillStyle = c;
    if (charging > 0.9) { ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; }
    roundRect(bx, by + (bh - fh), bw, fh, 6); ctx.fill();
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
    render();
    requestAnimationFrame(frame);
  }
  // init idle scene
  uy = terrainYAt(0) - feet;
  genAhead();
  requestAnimationFrame(frame);
})();
