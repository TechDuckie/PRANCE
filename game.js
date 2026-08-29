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

  var ux = 90;         // unicorn screen x (left third)
  var uy = 0;          // unicorn body-center y
  var vy = 0;
  var grounded = true;
  var feet = 17;       // body center -> feet distance
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

  // ---------- Terrain ----------
  function difficulty() { return Math.min(1, meters / 2500); }

  function terrainYAt(wx) {
    var amp = 1 + difficulty() * 1.4;
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
    var mid = (a + b) / 2;
    var gy = terrainYAt(mid) - 28;
    var t = Math.random();
    if (t < 0.4) { // ground row
      var n = 3 + (Math.random() * 3 | 0), st = (b - a) / n;
      for (var i = 0; i < n; i++) addStar(a + st * (i + 0.5), gy);
    } else if (t < 0.75) { // arc
      var m = 5, s2 = (b - a) / m, h = 36 + Math.random() * 46;
      for (var j = 0; j < m; j++) {
        var tt = j / (m - 1);
        addStar(a + s2 * j, gy - Math.sin(tt * Math.PI) * h);
      }
    } else { // single high
      addStar(mid, gy - 34 - Math.random() * 22);
    }
  }

  function genAhead() {
    while (cursor < camX + W + 360) {
      var solid = rand(230, 380) - difficulty() * 90;
      solid = Math.max(140, solid);
      placeStars(cursor, cursor + solid);
      cursor += solid;
      var gapChance = 0.45 + Math.min(0.45, meters / 4000);
      if (cursor > 600 && Math.random() < gapChance) {
        var gl = 34 + Math.min(140, meters * 0.03 + rand(0, 36));
        var a = cursor, b = cursor + gl;
        gaps.push({ a: a, b: b });
        if (Math.random() < 0.55) {
          addStar((a + b) / 2, terrainYAt(a) - 96 - rand(0, 30)); // high-risk star
        }
        cursor += gl;
      }
    }
    // prune behind
    while (gaps.length && gaps[0].b < camX - 60) gaps.shift();
    while (stars.length && stars[0].x < camX - 60) stars.shift();
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
      ctx.fillStyle = "rgba(255,228,94,0.25)";
      drawStarShape(sx, s.y, r * 1.9, rot); ctx.fill();
      ctx.fillStyle = "#FFE45E";
      drawStarShape(sx, s.y, r, rot); ctx.fill();
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

    // tail
    ctx.strokeStyle = MANE[3]; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-20, -2);
    ctx.quadraticCurveTo(-32, -8 + Math.sin(runPhase) * 3, -30, 6);
    ctx.stroke();
    ctx.strokeStyle = MANE[4];
    ctx.beginPath();
    ctx.moveTo(-20, 2);
    ctx.quadraticCurveTo(-30, 0, -26, 12);
    ctx.stroke();

    // legs
    var lg = Math.sin(runPhase) * 5;
    var lg2 = Math.sin(runPhase + Math.PI) * 5;
    ctx.strokeStyle = SHAD; ctx.lineWidth = 4; ctx.lineCap = "round";
    leg(-12, 10, lg); leg(-4, 10, lg2); leg(8, 10, lg); leg(14, 10, lg2);

    // body
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 14, 0, 0, 6.2832);
    ctx.fill();

    // shadow side
    ctx.fillStyle = SHAD;
    ctx.beginPath();
    ctx.ellipse(2, 4, 20, 9, 0, 0, 6.2832);
    ctx.fill();

    // mane
    ctx.lineWidth = 3; ctx.lineCap = "round";
    for (var m = 0; m < MANE.length; m++) {
      ctx.strokeStyle = MANE[m];
      ctx.beginPath();
      var mx = 6 - m * 1.5;
      ctx.moveTo(mx, -10);
      ctx.quadraticCurveTo(mx + 6, -16 - m, mx + 2, -2 - m);
      ctx.stroke();
    }

    // head
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.ellipse(18, -8, 10, 8, 0, 0, 6.2832); ctx.fill();
    // ear
    ctx.fillStyle = BODY;
    ctx.beginPath(); ctx.moveTo(14, -14); ctx.lineTo(17, -22); ctx.lineTo(20, -14); ctx.closePath(); ctx.fill();
    // horn
    ctx.save();
    ctx.shadowColor = HORN; ctx.shadowBlur = 8;
    ctx.fillStyle = HORN;
    ctx.beginPath(); ctx.moveTo(20, -16); ctx.lineTo(23, -30); ctx.lineTo(26, -15); ctx.closePath(); ctx.fill();
    ctx.restore();
    // eye
    ctx.fillStyle = EYE;
    ctx.beginPath(); ctx.arc(22, -8, 1.8, 0, 6.2832); ctx.fill();

    ctx.restore();
  }
  function leg(x, y, sw) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sw * 0.4, y + 12);
    ctx.stroke();
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
      // idle bob on title/over
      uy = terrainYAt(camX0()) - feet + Math.sin(time * 2) * 1.5;
      runPhase += dt * 8;
      updateParts(dt);
      return;
    }

    // charge
    if (pointerDown && grounded) {
      chargeT += dt;
      charging = clamp(chargeT / 0.6, 0, 1);
    }

    // speed & distance
    speed = Math.min(540, 200 + meters * 0.14);
    camX += speed * dt;
    meters = camX / 24;
    dist = Math.floor(meters);
    genAhead();

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
      if (!inGap(camX) && vy > 0 && uy + feet >= gy && uy + feet <= gy + 42) {
        // land
        uy = gy - feet; vy = 0; grounded = true; rot = 0; flip = false;
        landSq = 1; sLand();
        spawn(ux, uy + feet, 8, { c: "#ffffff", sp0: 40, sp1: 120, life: 0.35, g: 200, ang: -1.57, spread: 1.1 });
      }
      // high-jump trail
      if (vy < -120) { trail.push({ x: ux, y: uy, life: 0.4 }); }
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

    // death
    if (uy > H + 40) gameOver();

    updateParts(dt);
  }
  // helper for idle bob so it references a stable ground
  function camX0() { return state === "play" ? camX : 0; }

  // ---------- UI ----------
  function drawTrail() {
    for (var i = 0; i < trail.length; i++) {
      var t = trail[i];
      ctx.globalAlpha = clamp(t.life / 0.4, 0, 1) * 0.5;
      ctx.fillStyle = RNB[(i + (time * 10 | 0)) % RNB.length];
      ctx.beginPath(); ctx.arc(t.x, t.y, 6, 0, 6.2832); ctx.fill();
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
    drawRainbow();
    drawStars();
    drawTrail();
    drawUnicorn();
    drawParts();

    if (state === "play") drawHUD();
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
