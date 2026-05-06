/* =====================================================================
   player.js — Player Controller
   Owns:
     - input keys (WASD / arrows)
     - velocity, facing, animation phase
     - generic AABB-vs-rect collision routine used by both scenes
   The current scene supplies a list of walls (rectangles) and a list of
   solid props (also rectangles). Player just calls update().
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C = SG.C;

  // Input set, populated by main.js to keep all key handling in one place
  const keys = (SG.keys = new Set());

  // ----- input vector --------------------------------------------------
  function getInputVector() {
    let dx = 0, dy = 0;
    if (keys.has('arrowup')    || keys.has('w')) dy -= 1;
    if (keys.has('arrowdown')  || keys.has('s')) dy += 1;
    if (keys.has('arrowleft')  || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    return [dx, dy];
  }

  // ----- collision: circle vs list of AABBs ----------------------------
  function resolveCollisions(p, walls) {
    const r = p.r;
    for (const w of walls) {
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      const dx = p.x - cx, dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (r - d) + 0.001;
        p.x += (dx / d) * push;
        p.y += (dy / d) * push;
      } else if (d2 <= 0.0001) {
        // dead-centre on the wall — push out toward nearest edge
        const left = Math.abs(p.x - w.x), right = Math.abs(p.x - (w.x + w.w));
        const top = Math.abs(p.y - w.y), bot = Math.abs(p.y - (w.y + w.h));
        const m = Math.min(left, right, top, bot);
        if (m === left)  p.x = w.x - r - 0.01;
        else if (m === right) p.x = w.x + w.w + r + 0.01;
        else if (m === top)   p.y = w.y - r - 0.01;
        else                  p.y = w.y + w.h + r + 0.01;
      }
    }
  }

  // ----- per-frame update ---------------------------------------------
  function update(dt, walls, opts = {}) {
    const p = SG.state.player;
    const speedMul = opts.speedMul || 1;
    let baseSpeed = C.PLAYER_SPEED;
    if (SG.save.upgrades.fast_steps) baseSpeed *= 1.12;
    const overload = SG.state.attn.overload;
    if (overload > 60) baseSpeed *= 1 - (overload - 60) / 220;

    const [ix, iy] = getInputVector();
    p.vx = ix * baseSpeed * speedMul;
    p.vy = iy * baseSpeed * speedMul;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    resolveCollisions(p, walls);

    // facing
    if (Math.abs(p.vx) > Math.abs(p.vy)) p.facing = p.vx > 0 ? 'right' : (p.vx < 0 ? 'left' : p.facing);
    else if (Math.abs(p.vy) > 0)         p.facing = p.vy > 0 ? 'down'  : 'up';

    p.moving = (ix !== 0 || iy !== 0);
    if (p.moving) p.animPhase += dt; else p.animPhase = 0;

    return [ix, iy];
  }

  // ----- spawn helper --------------------------------------------------
  function spawn(x, y, facing = 'down') {
    const p = SG.state.player;
    p.x = x; p.y = y;
    p.vx = p.vy = 0;
    p.facing = facing;
    p.animPhase = 0; p.moving = false;
  }

  SG.player = {
    update, spawn, getInputVector, resolveCollisions, keys,
  };
})();
