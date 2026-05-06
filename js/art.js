/* =====================================================================
   art.js — procedural drawing primitives
   Everything in this file is original procedural canvas art. There are
   no copied character designs, names, or visual references from any
   specific game.
   The functions take a 2D context already translated into world space
   (camera applied), and draw a self-contained element at (x, y) world
   pixels, where (x, y) is the *ground point* of the entity.
   ===================================================================== */
(function () {
  const SG = window.SG;
  const PAL = SG.PAL;

  // ------ small utilities ----------------------------------------------
  function shadow(ctx, x, y, rx, ry, alpha = 0.55) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function radialGlow(ctx, x, y, r, color, intensity = 0.7) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace(/[\d.]+\)$/, `${intensity})`));
    g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------ floor (tile-style stone with moss) ---------------------------
  // Pre-rendered to an offscreen canvas for performance.
  const floorCache = new Map();
  function floorTile(seed = 0) {
    if (floorCache.has(seed)) return floorCache.get(seed);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = PAL.floor;
    x.fillRect(0, 0, 64, 64);
    // Variation noise
    const rng = mulberry32(seed * 9301 + 49297);
    for (let i = 0; i < 70; i++) {
      const px = (rng() * 64) | 0, py = (rng() * 64) | 0;
      x.fillStyle = `rgba(${(rng()*30)|0},${(rng()*40)|0},${(rng()*30)|0},${0.12 + rng()*0.18})`;
      x.fillRect(px, py, 1 + (rng()*2|0), 1 + (rng()*2|0));
    }
    // Moss patch
    if (rng() < 0.3) {
      const mx = 8 + rng()*48, my = 8 + rng()*48, mr = 6 + rng()*10;
      const mg = x.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, 'rgba(60,120,80,0.35)');
      mg.addColorStop(1, 'rgba(60,120,80,0)');
      x.fillStyle = mg;
      x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
    }
    // Tile seam
    x.strokeStyle = 'rgba(0,0,0,0.4)';
    x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, 63, 63);
    floorCache.set(seed, c);
    return c;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawFloor(ctx, x, y, w, h, seedBase = 0) {
    // Tile a 64×64 floor texture across (x,y,w,h)
    for (let py = 0; py < h; py += 64) {
      for (let px = 0; px < w; px += 64) {
        const tile = floorTile(seedBase + ((px / 64) * 13 + (py / 64) * 7) | 0);
        ctx.drawImage(tile, x + px, y + py);
      }
    }
  }

  // ------ wall block (top-down 2.5D) -----------------------------------
  // Walls are drawn as boxes with a top face plus a darker side face.
  // Call once per wall AABB.
  function drawWall(ctx, x, y, w, h) {
    const SIDE_H = 8;
    // shadow on floor below
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x + 4, y + h, w, SIDE_H);
    // side face (dark)
    ctx.fillStyle = PAL.wallSide;
    ctx.fillRect(x, y + h, w, SIDE_H);
    // top face
    ctx.fillStyle = PAL.wallTop;
    ctx.fillRect(x, y, w, h);
    // top highlight ridge
    ctx.fillStyle = PAL.wallEdge;
    ctx.fillRect(x, y, w, 2);
    // sparse cracks / moss specks (deterministic by position)
    const r = mulberry32((x * 7 + y * 13) | 0);
    for (let i = 0; i < 4; i++) {
      const rx = x + r() * w, ry = y + 2 + r() * (h - 2);
      ctx.fillStyle = `rgba(60,120,80,${0.06 + r()*0.12})`;
      ctx.fillRect(rx, ry, 2, 1);
    }
  }

  // ------ stone column -------------------------------------------------
  function drawColumn(ctx, x, y, t = 0) {
    shadow(ctx, x, y + 4, 18, 6);
    // base
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(x - 14, y - 6, 28, 8);
    // shaft (with vertical gradient)
    const g = ctx.createLinearGradient(x - 10, y - 60, x + 10, y - 60);
    g.addColorStop(0, PAL.stoneHi);
    g.addColorStop(0.5, PAL.stone);
    g.addColorStop(1, '#1d1814');
    ctx.fillStyle = g;
    ctx.fillRect(x - 10, y - 60, 20, 54);
    // capital
    ctx.fillStyle = PAL.stoneHi;
    ctx.fillRect(x - 14, y - 66, 28, 6);
    // gold band
    ctx.fillStyle = PAL.gold;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x - 14, y - 64, 28, 1);
    ctx.globalAlpha = 1;
  }

  // ------ glowing flower / signal-seed plant ---------------------------
  function drawGlowPlant(ctx, x, y, t, color = 'rgba(110,255,168,1)') {
    shadow(ctx, x, y + 2, 12, 4, 0.5);
    const pulse = 0.6 + 0.4 * Math.sin(t / 280 + (x * 0.13));
    // stem
    ctx.strokeStyle = '#2d4438';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - 2, y - 14, x, y - 22);
    ctx.stroke();
    // leaves
    ctx.fillStyle = '#385f48';
    ctx.beginPath();
    ctx.ellipse(x - 6, y - 10, 5, 2.5, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + 6, y - 14, 5, 2.5, 0.6, 0, Math.PI * 2);
    ctx.fill();
    // bulb glow
    radialGlow(ctx, x, y - 24, 22, color, 0.45 + 0.3 * pulse);
    // bulb core
    ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.9)');
    ctx.beginPath();
    ctx.arc(x, y - 24, 3 + pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------ rest fountain -------------------------------------------------
  function drawFountain(ctx, x, y, t) {
    shadow(ctx, x, y + 2, 32, 10);
    // basin outer ring
    ctx.fillStyle = PAL.stone;
    ctx.beginPath(); ctx.ellipse(x, y, 30, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.stoneHi;
    ctx.beginPath(); ctx.ellipse(x, y - 1, 30, 11, 0, 0, Math.PI * 2); ctx.fill();
    // water
    const wg = ctx.createRadialGradient(x, y - 2, 2, x, y - 2, 24);
    wg.addColorStop(0, 'rgba(154,217,255,0.6)');
    wg.addColorStop(1, 'rgba(154,217,255,0.04)');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(x, y - 2, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
    // ripple
    const rp = (t / 600) % 1;
    ctx.strokeStyle = `rgba(154,217,255,${0.35 * (1 - rp)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y - 2, 4 + rp * 18, 1 + rp * 7, 0, 0, Math.PI * 2); ctx.stroke();
    // central little plinth + light
    ctx.fillStyle = PAL.stoneHi;
    ctx.fillRect(x - 3, y - 14, 6, 12);
    radialGlow(ctx, x, y - 16, 22, 'rgba(154,217,255,1)', 0.4 + 0.2 * Math.sin(t / 500));
  }

  // ------ ritual gate / portal -----------------------------------------
  // Both the hub portal and the run exit gate use this. Pass a colour.
  function drawGate(ctx, x, y, t, color = 'rgba(110,255,168,1)') {
    shadow(ctx, x, y + 4, 60, 14, 0.55);
    // Stone arch (drawn as two side pillars + arched top)
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(x - 38, y - 6, 12, 12);                  // left base
    ctx.fillRect(x + 26, y - 6, 12, 12);                  // right base
    ctx.fillRect(x - 36, y - 90, 8, 84);                  // left pillar
    ctx.fillRect(x + 28, y - 90, 8, 84);                  // right pillar
    // arched top
    ctx.beginPath();
    ctx.moveTo(x - 36, y - 84);
    ctx.quadraticCurveTo(x, y - 130, x + 36, y - 84);
    ctx.lineTo(x + 28, y - 84);
    ctx.quadraticCurveTo(x, y - 116, x - 28, y - 84);
    ctx.closePath();
    ctx.fill();
    // gold filigree
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 28, y - 84);
    ctx.quadraticCurveTo(x, y - 116, x + 28, y - 84);
    ctx.stroke();
    // inner glow plane
    const pulse = 0.55 + 0.3 * Math.sin(t / 360);
    const ig = ctx.createRadialGradient(x, y - 56, 6, x, y - 56, 50);
    ig.addColorStop(0, color.replace(/[\d.]+\)$/, `${0.6 * pulse})`));
    ig.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(x, y - 56, 30, 38, 0, 0, Math.PI * 2);
    ctx.fill();
    // floating dust particles drifting upward
    const r = mulberry32((t / 200 | 0) % 9999);
    for (let i = 0; i < 6; i++) {
      const px = x - 26 + r() * 52;
      const py = y - 12 - ((t * 0.04 + i * 60) % 90);
      ctx.fillStyle = color.replace(/[\d.]+\)$/, `${0.25 + r()*0.3})`);
      ctx.fillRect(px, py, 2, 2);
    }
  }

  // ------ NPC: The Observer --------------------------------------------
  // Tall slender hooded figure. Original design.
  function drawObserver(ctx, x, y, t) {
    shadow(ctx, x, y + 2, 18, 6, 0.6);
    const bob = Math.sin(t / 1200) * 1.2;
    const yy = y + bob;
    // robe (long triangular cloak)
    ctx.fillStyle = PAL.cloth;
    ctx.beginPath();
    ctx.moveTo(x - 18, yy);
    ctx.lineTo(x + 18, yy);
    ctx.lineTo(x + 11, yy - 50);
    ctx.lineTo(x - 11, yy - 50);
    ctx.closePath();
    ctx.fill();
    // robe highlight
    ctx.fillStyle = PAL.clothHi;
    ctx.beginPath();
    ctx.moveTo(x - 14, yy - 4);
    ctx.lineTo(x - 6, yy - 50);
    ctx.lineTo(x - 11, yy - 50);
    ctx.closePath();
    ctx.fill();
    // gold trim
    ctx.strokeStyle = PAL.gold;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 18, yy);
    ctx.lineTo(x + 18, yy);
    ctx.stroke();
    // hood
    ctx.fillStyle = '#101814';
    ctx.beginPath();
    ctx.moveTo(x - 13, yy - 50);
    ctx.quadraticCurveTo(x, yy - 76, x + 13, yy - 50);
    ctx.lineTo(x + 9, yy - 50);
    ctx.quadraticCurveTo(x, yy - 70, x - 9, yy - 50);
    ctx.closePath();
    ctx.fill();
    // glowing eyes inside hood
    const eyeP = 0.6 + 0.4 * Math.sin(t / 800);
    ctx.fillStyle = `rgba(110,255,168,${eyeP})`;
    ctx.fillRect(x - 5, yy - 60, 2, 2);
    ctx.fillRect(x + 3, yy - 60, 2, 2);
    radialGlow(ctx, x, yy - 60, 14, 'rgba(110,255,168,1)', 0.18);
    // small lantern at hand
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    ctx.arc(x + 14, yy - 22, 2.5, 0, Math.PI * 2);
    ctx.fill();
    radialGlow(ctx, x + 14, yy - 22, 18, 'rgba(214,168,90,1)', 0.4);
  }

  // ------ Player: cloaked traveller ------------------------------------
  // Drawn as upright sprite; facing affects shoulder + eye positions.
  function drawPlayer(ctx, p, t) {
    shadow(ctx, p.x, p.y + 2, 11, 4);
    const bob = p.moving ? Math.sin(p.animPhase * 8) * 1.5 : Math.sin(t / 900) * 0.6;
    const yy = p.y + bob;
    const facing = p.facing;

    // legs (small steps when moving)
    const stepOffset = p.moving ? Math.sin(p.animPhase * 8) * 2 : 0;
    ctx.fillStyle = '#0e1714';
    ctx.fillRect(p.x - 4, yy - 4, 3, 6 + (stepOffset > 0 ? 0 : 1));
    ctx.fillRect(p.x + 1, yy - 4, 3, 6 + (stepOffset > 0 ? 1 : 0));

    // body cloak
    ctx.fillStyle = PAL.cloth;
    ctx.beginPath();
    ctx.moveTo(p.x - 8, yy - 4);
    ctx.lineTo(p.x + 8, yy - 4);
    ctx.lineTo(p.x + 7, yy - 22);
    ctx.lineTo(p.x - 7, yy - 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PAL.clothHi;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, yy - 6);
    ctx.lineTo(p.x - 3, yy - 22);
    ctx.lineTo(p.x - 7, yy - 22);
    ctx.closePath();
    ctx.fill();

    // chest signal (inner glow)
    radialGlow(ctx, p.x, yy - 14, 12, 'rgba(110,255,168,1)', 0.45);

    // head (with hood)
    ctx.fillStyle = '#0e1714';
    ctx.beginPath();
    ctx.ellipse(p.x, yy - 26, 6, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // hood top
    ctx.fillStyle = PAL.cloth;
    ctx.beginPath();
    ctx.moveTo(p.x - 7, yy - 22);
    ctx.quadraticCurveTo(p.x, yy - 34, p.x + 7, yy - 22);
    ctx.closePath();
    ctx.fill();

    // eye spot (depending on facing)
    ctx.fillStyle = 'rgba(110,255,168,0.95)';
    let ex = p.x, ey = yy - 26;
    if (facing === 'left')  { ex = p.x - 2.5; }
    if (facing === 'right') { ex = p.x + 2.5; }
    if (facing === 'up')    { ey = yy - 28; }
    if (facing === 'down')  { ey = yy - 25; }
    ctx.fillRect(ex - 0.5, ey - 0.5, 1.5, 1.5);
  }

  // ------ exit gate (run scene) ----------------------------------------
  function drawExitGate(ctx, x, y, t) {
    drawGate(ctx, x, y, t, 'rgba(110,255,168,1)');
    // additional inner shimmer
    radialGlow(ctx, x, y - 46, 60, 'rgba(110,255,168,1)', 0.18);
  }

  // ------ landmark beacon ----------------------------------------------
  function drawLandmark(ctx, x, y, t) {
    shadow(ctx, x, y + 2, 10, 3);
    const pulse = 0.5 + 0.5 * Math.sin(t / 300);
    ctx.fillStyle = PAL.stone;
    ctx.fillRect(x - 5, y - 4, 10, 6);
    ctx.fillStyle = PAL.gold;
    ctx.beginPath();
    ctx.moveTo(x, y - 22);
    ctx.lineTo(x + 5, y - 4);
    ctx.lineTo(x - 5, y - 4);
    ctx.closePath();
    ctx.fill();
    radialGlow(ctx, x, y - 16, 22, 'rgba(214,168,90,1)', 0.35 + 0.25 * pulse);
  }

  // ------ ambient particles --------------------------------------------
  // Drifting dust over the whole world. Drawn last.
  const particles = [];
  function spawnParticles(count, w, h) {
    particles.length = 0;
    for (let i = 0; i < count; i++) {
      particles.push({ x: Math.random() * w, y: Math.random() * h, s: 0.3 + Math.random() * 0.6, a: Math.random() * 0.3 + 0.1 });
    }
  }
  function drawParticles(ctx, dt, worldW, worldH, color = 'rgba(110,255,168,') {
    for (const p of particles) {
      p.y -= p.s * dt * 0.05;
      p.x += Math.sin((p.y + p.x) / 40) * 0.05;
      if (p.y < -4) { p.y = worldH + 4; p.x = Math.random() * worldW; }
      ctx.fillStyle = color + p.a + ')';
      ctx.fillRect(p.x, p.y, 1, 1);
    }
  }

  // ------ vignette overlay ---------------------------------------------
  function drawVignette(ctx, w, h, intensity = 0.55) {
    const g = ctx.createRadialGradient(w/2, h/2, Math.min(w, h) * 0.4, w/2, h/2, Math.max(w, h) * 0.85);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${intensity})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Public art namespace
  SG.art = {
    shadow, radialGlow, drawFloor, drawWall, drawColumn, drawGlowPlant,
    drawFountain, drawGate, drawObserver, drawPlayer, drawExitGate,
    drawLandmark, spawnParticles, drawParticles, drawVignette,
  };
})();
