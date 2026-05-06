/* =====================================================================
   run.js — Run Scene
   A room-based garden maze. The world is a 3×2 grid of rooms; adjacent
   rooms are connected by doorways carved in the shared wall. Rooms
   contain props, glowing flowers, rest fountains, columns, and (in the
   far room) the exit gate.
   This file owns:
     - maze / room generation (with adaptation rules from last run)
     - run scene update + render
     - run lifecycle (start / end)
     - exposed "world" interface for attention.js (isOnRest,
       isOnMainRoute, roomAt, spawnTemptation, revealHidden, openRest,
       placeLandmark, glowObjects)
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C  = SG.C;
  const A  = SG.art;
  const PAL = SG.PAL;

  let world = null;

  // ----- generation helpers --------------------------------------------
  function moduleWeights(lastRun) {
    const w = {
      restZone: 1, glowObject: 1, hiddenGlow: 0.5, prop: 1, openness: 0, complexity: 1,
    };
    if (!lastRun) return w;
    const d = lastRun.dominant;
    if (d === 'chaos')     { w.restZone += 0.8; w.prop += 0.4; }
    if (d === 'focus')     { w.glowObject += 0.7; }
    if (d === 'curiosity') { w.hiddenGlow += 0.6; w.glowObject += 0.4; }
    if (d === 'overload')  { w.openness   += 0.4; w.prop -= 0.3; }
    if (lastRun.outcome === 'exit' && lastRun.timeMs < C.RUN_DURATION_MS * 0.5) {
      w.complexity += 0.4;
    }
    return w;
  }

  // Build a tile grid for the run world.
  // Returns { grid, rooms, worldW, worldH, glowObjects, rests, exit, ... }
  function generate() {
    const w = moduleWeights(SG.save.lastRun);
    const RX = C.ROOMS_X, RY = C.ROOMS_Y;
    const RTX = C.ROOM_TILES_X, RTY = C.ROOM_TILES_Y;
    const GW = RX * (RTX - 1) + 1;             // shared inner walls between rooms
    const GH = RY * (RTY - 1) + 1;
    const T = C.TILE;

    // Init all walls
    const grid = Array.from({ length: GH }, () => Array(GW).fill(C.T_WALL));

    // Carve each room interior
    const rooms = [];
    for (let ry = 0; ry < RY; ry++) {
      for (let rx = 0; rx < RX; rx++) {
        const x0 = rx * (RTX - 1);
        const y0 = ry * (RTY - 1);
        const ix0 = x0 + 1, iy0 = y0 + 1;
        const ix1 = x0 + RTX - 2, iy1 = y0 + RTY - 2;
        for (let y = iy0; y <= iy1; y++)
          for (let x = ix0; x <= ix1; x++) grid[y][x] = C.T_FLOOR;
        rooms.push({ id: rooms.length, rx, ry, x0, y0, ix0, iy0, ix1, iy1, special: null });
      }
    }

    // Build a spanning tree over the room graph, then carve doorways.
    // Always at least one extra cycle to allow loop choices.
    const visited = Array.from({ length: RY }, () => Array(RX).fill(false));
    const stack = [[0, 0]];
    visited[0][0] = true;
    const edges = [];
    const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = DIRS.map(([dx, dy]) => [cx+dx, cy+dy, dx, dy])
                       .filter(([nx, ny]) => nx>=0 && ny>=0 && nx<RX && ny<RY && !visited[ny][nx]);
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = opts[(Math.random() * opts.length) | 0];
      visited[ny][nx] = true;
      edges.push([cx, cy, nx, ny]);
      stack.push([nx, ny]);
    }
    // Add extra loop edges to richen layout
    let extraLoops = 1 + Math.round(w.complexity * 0.5);
    while (extraLoops-- > 0) {
      const cx = (Math.random() * RX) | 0, cy = (Math.random() * RY) | 0;
      const [dx, dy] = DIRS[(Math.random() * 4) | 0];
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= RX || ny >= RY) continue;
      const exists = edges.some(([a, b, c, d]) => (a===cx&&b===cy&&c===nx&&d===ny) || (a===nx&&b===ny&&c===cx&&d===cy));
      if (!exists) edges.push([cx, cy, nx, ny]);
    }
    // Carve doorways for each edge (3-tile-wide opening)
    for (const [ax, ay, bx, by] of edges) carveDoor(grid, ax, ay, bx, by);

    // Openness from overload
    if (w.openness > 0) {
      const extra = Math.round(20 * w.openness);
      for (let i = 0; i < extra; i++) {
        const x = 1 + ((Math.random() * (GW - 2)) | 0);
        const y = 1 + ((Math.random() * (GH - 2)) | 0);
        if (grid[y][x] === C.T_WALL) grid[y][x] = C.T_FLOOR;
      }
    }

    // Place exit in far corner room (bottom-right)
    const exitRoom = rooms[rooms.length - 1];
    exitRoom.special = 'exit';
    const exit = {
      tx: (exitRoom.ix0 + exitRoom.ix1) >> 1,
      ty: (exitRoom.iy0 + exitRoom.iy1) >> 1,
      x:  (((exitRoom.ix0 + exitRoom.ix1) >> 1) + 0.5) * T,
      y:  (((exitRoom.iy0 + exitRoom.iy1) >> 1) + 0.5) * T,
    };
    grid[exit.ty][exit.tx] = C.T_EXIT;

    // Pick a non-start, non-exit room as rest zone(s)
    const candidates = rooms.filter(r => r.id !== 0 && r.id !== exitRoom.id);
    shuffle(candidates);
    const rests = [];
    const restCount = Math.max(1, Math.round(1 * w.restZone));
    for (let i = 0; i < Math.min(restCount, candidates.length); i++) {
      const r = candidates[i];
      r.special = r.special || 'rest';
      // place a 3x3 rest patch in centre of room
      const cx = (r.ix0 + r.ix1) >> 1;
      const cy = (r.iy0 + r.iy1) >> 1;
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let x = cx - 1; x <= cx + 1; x++) grid[y][x] = C.T_REST;
      rests.push({ x: (cx + 0.5) * T, y: (cy + 0.5) * T, room: r.id });
    }

    // Place glowing flowers in remaining rooms (and a few in rest rooms too)
    const glowObjects = [];
    const glowCount = Math.round(2 + 2 * w.glowObject * w.complexity);
    let placed = 0;
    while (placed < glowCount) {
      const r = rooms[(Math.random() * rooms.length) | 0];
      if (r.special === 'exit') continue;
      // place inside the room interior, avoid walls and rest centres
      let tries = 12;
      while (tries-- > 0) {
        const tx = r.ix0 + 1 + ((Math.random() * (r.ix1 - r.ix0 - 1)) | 0);
        const ty = r.iy0 + 1 + ((Math.random() * (r.iy1 - r.iy0 - 1)) | 0);
        if (grid[ty][tx] !== C.T_FLOOR) continue;
        grid[ty][tx] = C.T_GLOW;
        glowObjects.push({ tx, ty, x: (tx + 0.5) * T, y: (ty + 0.5) * T, taken: false, seenT: 0, color: 'rgba(110,255,168,1)' });
        placed++;
        break;
      }
      if (tries <= 0) placed++;
    }

    // Hidden glow markers (in walls; revealed by Curiosity director)
    const hiddenCount = Math.round(2 * w.hiddenGlow);
    for (let i = 0; i < hiddenCount; i++) {
      let tries = 30;
      while (tries-- > 0) {
        const x = 2 + ((Math.random() * (GW - 4)) | 0);
        const y = 2 + ((Math.random() * (GH - 4)) | 0);
        if (grid[y][x] !== C.T_WALL) continue;
        let touchesFloor = false;
        for (const [dx, dy] of DIRS) {
          const t = (grid[y + dy] || [])[x + dx];
          if (t === C.T_FLOOR || t === C.T_REST) { touchesFloor = true; break; }
        }
        if (touchesFloor) { grid[y][x] = C.T_HIDDEN; break; }
      }
    }

    // Add columns inside rooms as decorative props (impassable)
    const propsCount = Math.max(0, Math.round(3 * w.prop));
    const propTiles = [];
    for (let i = 0; i < propsCount; i++) {
      const r = rooms[(Math.random() * rooms.length) | 0];
      if (r.special === 'exit') continue;
      let tries = 8;
      while (tries-- > 0) {
        const tx = r.ix0 + 1 + ((Math.random() * (r.ix1 - r.ix0 - 1)) | 0);
        const ty = r.iy0 + 1 + ((Math.random() * (r.iy1 - r.iy0 - 1)) | 0);
        if (grid[ty][tx] !== C.T_FLOOR) continue;
        grid[ty][tx] = C.T_COLUMN;
        propTiles.push({ tx, ty, x: (tx + 0.5) * T, y: (ty + 1) * T });
        break;
      }
    }

    // Compute main route (BFS from start to exit) for re-entry rule
    const start = { tx: (rooms[0].ix0 + rooms[0].ix1) >> 1, ty: (rooms[0].iy0 + rooms[0].iy1) >> 1 };
    const mainRoute = bfsRoute(grid, start, { tx: exit.tx, ty: exit.ty });

    return {
      grid, rooms, exitRoom, exit,
      glowObjects, propTiles, rests,
      worldW: GW * T, worldH: GH * T,
      GW, GH,
      start: { x: (start.tx + 0.5) * T, y: (start.ty + 0.5) * T, tx: start.tx, ty: start.ty },
      mainRoute,
    };
  }

  function carveDoor(grid, ax, ay, bx, by) {
    const RTX = C.ROOM_TILES_X, RTY = C.ROOM_TILES_Y;
    const dx = bx - ax, dy = by - ay;
    if (dx === 1 || dx === -1) {
      // horizontal neighbour → vertical wall between them
      const wx = (Math.max(ax, bx)) * (RTX - 1);
      const cy = ay * (RTY - 1) + (RTY >> 1);
      for (let oy = -1; oy <= 1; oy++) grid[cy + oy][wx] = C.T_FLOOR;
    } else {
      const wy = (Math.max(ay, by)) * (RTY - 1);
      const cx = ax * (RTX - 1) + (RTX >> 1);
      for (let ox = -1; ox <= 1; ox++) grid[wy][cx + ox] = C.T_FLOOR;
    }
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } }

  function bfsRoute(grid, start, goal) {
    const walk = (x, y) => {
      const t = (grid[y] || [])[x];
      return t === C.T_FLOOR || t === C.T_REST || t === C.T_GLOW || t === C.T_EXIT || t === C.T_LANDMARK;
    };
    const q = [[start.tx, start.ty]];
    const prev = new Map();
    const key = (x, y) => `${x},${y}`;
    prev.set(key(start.tx, start.ty), null);
    while (q.length) {
      const [x, y] = q.shift();
      if (x === goal.tx && y === goal.ty) break;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy;
        if (!walk(nx, ny)) continue;
        const k = key(nx, ny);
        if (prev.has(k)) continue;
        prev.set(k, key(x, y));
        q.push([nx, ny]);
      }
    }
    const set = new Set();
    let k = key(goal.tx, goal.ty);
    if (!prev.has(k)) return set;
    while (k) { set.add(k); k = prev.get(k); }
    return set;
  }

  // ----- world interface used by attention.js / interpreter ------------
  function buildWorldInterface(w) {
    const T = C.TILE;
    return {
      isOnRest(x, y) {
        const tx = (x / T) | 0, ty = (y / T) | 0;
        return (w.grid[ty] || [])[tx] === C.T_REST;
      },
      isOnMainRoute(x, y) {
        const tx = (x / T) | 0, ty = (y / T) | 0;
        return w.mainRoute.has(tx + ',' + ty);
      },
      roomAt(x, y) {
        const tx = (x / T) | 0, ty = (y / T) | 0;
        for (const r of w.rooms) if (tx >= r.x0 && tx <= r.x0 + C.ROOM_TILES_X - 1 && ty >= r.y0 && ty <= r.y0 + C.ROOM_TILES_Y - 1) return r.id;
        return null;
      },
      glowObjects: w.glowObjects,
      // Director: spawn a glowing temptation in a non-main-route floor tile
      spawnTemptation() {
        for (let i = 0; i < 30; i++) {
          const tx = 1 + ((Math.random() * (w.GW - 2)) | 0);
          const ty = 1 + ((Math.random() * (w.GH - 2)) | 0);
          if (w.grid[ty][tx] !== C.T_FLOOR) continue;
          if (w.mainRoute.has(tx + ',' + ty)) continue;
          w.grid[ty][tx] = C.T_GLOW;
          w.glowObjects.push({ tx, ty, x: (tx + 0.5) * T, y: (ty + 0.5) * T, taken: false, seenT: 0, color: 'rgba(110,255,168,1)' });
          return true;
        }
        return false;
      },
      // Reveal a hidden tile near the player
      revealHidden() {
        const ptx = (SG.state.player.x / T) | 0, pty = (SG.state.player.y / T) | 0;
        const radius = SG.save.selectedTool === 'softfocus' ? 3 : 5;
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const x = ptx + dx, y = pty + dy;
            if (!w.grid[y] || w.grid[y][x] !== C.T_HIDDEN) continue;
            w.grid[y][x] = C.T_GLOW;
            w.glowObjects.push({ tx: x, ty: y, x: (x + 0.5) * T, y: (y + 0.5) * T, taken: false, seenT: 0, color: 'rgba(154,217,255,1)' });
            return true;
          }
        return false;
      },
      // Open a small rest patch near the player
      openRest() {
        const ptx = (SG.state.player.x / T) | 0, pty = (SG.state.player.y / T) | 0;
        for (let r = 1; r <= 4; r++) {
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              const x = ptx + dx, y = pty + dy;
              if (!w.grid[y] || w.grid[y][x] !== C.T_WALL) continue;
              for (let oy = 0; oy <= 1; oy++)
                for (let ox = 0; ox <= 1; ox++) {
                  const px = Math.min(w.GW - 2, x + ox), py = Math.min(w.GH - 2, y + oy);
                  if (w.grid[py][px] === C.T_WALL) w.grid[py][px] = C.T_REST;
                }
              return true;
            }
        }
        return false;
      },
      // Place a landmark in the centre of a room id
      placeLandmark(roomId) {
        const r = w.rooms[roomId];
        if (!r) return false;
        const cx = (r.ix0 + r.ix1) >> 1, cy = (r.iy0 + r.iy1) >> 1;
        if (w.grid[cy][cx] !== C.T_FLOOR && w.grid[cy][cx] !== C.T_REST) return false;
        w.grid[cy][cx] = C.T_LANDMARK;
        return true;
      },
    };
  }

  // ----- run lifecycle -------------------------------------------------
  function startRun() {
    SG.audio.ensure();
    SG.audio.start();

    SG.save.runNumber += 1;
    SG.persist();

    const w = generate();
    Object.assign(w, buildWorldInterface(w));
    world = w;
    SG.state.world = world;

    SG.player.spawn(w.start.x, w.start.y, 'down');
    SG.attention.initRun(world);
    SG.state.runActive = true;
    SG.state.runStartT = SG.now();
    SG.state.runEndReason = null;
    SG.state.cam = { x: 0, y: 0 };
    SG.state.log.length = 0;
    SG.pushLog(`run ${SG.save.runNumber} begins`);

    SG.art.spawnParticles(80, w.worldW, w.worldH);

    SG.interaction.setInteractables([]); // run does not use proximity prompts
    SG.dialogue.close();
    SG.ui.showHud(true);
    SG.scene.fadeTo('run');
  }

  function endRun(reason) {
    if (!SG.state.runActive) return;
    SG.state.runActive = false;
    SG.state.runEndReason = reason;
    SG.audio.stop();

    const stats = SG.attention.finalize(reason);
    SG.save.seeds += SG.state.seedsThisRun;
    SG.save.lastRun = stats;
    SG.persist();

    document.getElementById('summary-text').textContent = SG.summary.buildReflection(stats);
    SG.ui.showHud(false);
    SG.ui.showSummary(true);
    SG.state.scene = 'summary';
  }

  // ----- per-frame: input → movement + interactions -------------------
  function update(dt, now) {
    if (!SG.state.runActive) return;
    const t = C.TILE;

    // Build movement collision: walls (T_WALL & T_HIDDEN) and columns (T_COLUMN)
    const walls = collectWallRects(world);
    SG.player.update(dt, walls);
    // glow pickup
    const ptx = (SG.state.player.x / t) | 0, pty = (SG.state.player.y / t) | 0;
    if (world.grid[pty] && world.grid[pty][ptx] === C.T_GLOW) {
      const obj = world.glowObjects.find(o => o.tx === ptx && o.ty === pty && !o.taken);
      if (obj) collectGlow(obj);
    }

    // Reach exit?
    if (world.grid[pty] && world.grid[pty][ptx] === C.T_EXIT) endRun('exit');

    SG.attention.update(dt, now, world);
    SG.attention.directorTick(now, world);

    // Run timer
    const elapsed = now - SG.state.runStartT;
    if (elapsed >= C.RUN_DURATION_MS) endRun('time');

    // Camera follows player smoothly, clamped
    const camTargetX = SG.state.player.x - C.CANVAS_W / 2;
    const camTargetY = SG.state.player.y - C.CANVAS_H / 2;
    SG.state.cam.x += (camTargetX - SG.state.cam.x) * Math.min(1, dt * 6);
    SG.state.cam.y += (camTargetY - SG.state.cam.y) * Math.min(1, dt * 6);
    SG.state.cam.x = Math.max(0, Math.min(world.worldW - C.CANVAS_W, SG.state.cam.x));
    SG.state.cam.y = Math.max(0, Math.min(world.worldH - C.CANVAS_H, SG.state.cam.y));

    SG.ui.updateHud(elapsed);
  }

  // Cache wall AABBs to speed up collisions; rebuild whenever grid changes
  function collectWallRects(w) {
    if (w._wallCacheVersion !== w.grid.length) w._wallRects = null;
    if (!w._wallRects) {
      const arr = [];
      const T = C.TILE;
      for (let y = 0; y < w.GH; y++) {
        for (let x = 0; x < w.GW; x++) {
          const t = w.grid[y][x];
          if (t === C.T_WALL || t === C.T_HIDDEN) arr.push({ x: x*T, y: y*T, w: T, h: T });
          else if (t === C.T_COLUMN) arr.push({ x: x*T + 8, y: y*T + 8, w: T - 16, h: T - 16 });
        }
      }
      w._wallRects = arr;
      w._wallCacheVersion = w.grid.length;
    }
    return w._wallRects;
  }

  function collectGlow(obj) {
    obj.taken = true;
    world.grid[obj.ty][obj.tx] = C.T_FLOOR;
    world._wallRects = null; // invalidate (not strictly needed but safe)
    const lens = SG.save.selectedTool === 'curiosity';
    const seeds = lens ? 2 : 1;
    SG.state.seedsThisRun += seeds;
    SG.attention.bump('curiosity', lens ? 22 : 14, 'glowing object');
    SG.pushLog(`+${seeds} signal seed${seeds > 1 ? 's' : ''}`);
    SG.audio.curiosityPing();
  }

  // R key: re-entry marker
  function tryReentryMarker() {
    if (SG.save.selectedTool !== 'reentry' || SG.state.reentryUsed || !SG.state.lastStablePoint) return;
    SG.state.reentryUsed = true;
    SG.state.player.x = SG.state.lastStablePoint.x;
    SG.state.player.y = SG.state.lastStablePoint.y;
    SG.attention.bump('focus', 6, 're-entry marker');
    SG.pushLog('re-entry marker used');
  }

  // ----- render --------------------------------------------------------
  function render(ctx, now, dt) {
    if (!world) return;
    const cam = SG.state.cam;
    ctx.save();
    // camera shake under chaos
    let sx = 0, sy = 0;
    if (SG.state.attn.chaos > 70 || now < SG.state.director.glitchUntil) {
      const k = Math.max(0, (SG.state.attn.chaos - 60) / 40);
      sx = (Math.random() - 0.5) * 4 * k;
      sy = (Math.random() - 0.5) * 4 * k;
    }
    ctx.translate(-cam.x + sx, -cam.y + sy);

    // Background floor (only the visible region)
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillRect(cam.x, cam.y, C.CANVAS_W, C.CANVAS_H);
    A.drawFloor(ctx, Math.floor(cam.x / 64) * 64, Math.floor(cam.y / 64) * 64,
                Math.ceil(C.CANVAS_W / 64) * 64 + 64,
                Math.ceil(C.CANVAS_H / 64) * 64 + 64,
                42);

    const T = C.TILE;
    // Tint over rest tiles
    for (const r of world.rests) {
      const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, T * 2.5);
      g.addColorStop(0, 'rgba(154,217,255,0.10)');
      g.addColorStop(1, 'rgba(154,217,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, T * 2.5, T * 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Walls & columns (drawn from grid). Painter's-algo with y so they
    // overlap correctly with characters.
    const draws = [];
    for (let y = 0; y < world.GH; y++) {
      for (let x = 0; x < world.GW; x++) {
        const t = world.grid[y][x];
        if (t === C.T_WALL || t === C.T_HIDDEN) {
          const py = y * T + T;          // sort by bottom-edge y
          // shimmer for hidden tiles
          const isHidden = (t === C.T_HIDDEN);
          draws.push({ y: py, draw: () => {
            A.drawWall(ctx, x * T, y * T, T, T);
            if (isHidden && Math.random() < 0.04) {
              ctx.fillStyle = 'rgba(154,217,255,0.06)';
              ctx.fillRect(x * T, y * T, T, T);
            }
          }});
        } else if (t === C.T_GLOW) {
          const obj = world.glowObjects.find(o => o.tx === x && o.ty === y && !o.taken);
          const color = obj ? obj.color : 'rgba(110,255,168,1)';
          draws.push({ y: y * T + T - 4, draw: () => A.drawGlowPlant(ctx, x * T + T/2, y * T + T - 4, now, color) });
        } else if (t === C.T_REST) {
          // floor tile already drawn; rest fountain placed once below
        } else if (t === C.T_COLUMN) {
          draws.push({ y: y * T + T, draw: () => A.drawColumn(ctx, x * T + T/2, y * T + T, now) });
        } else if (t === C.T_LANDMARK) {
          draws.push({ y: y * T + T, draw: () => A.drawLandmark(ctx, x * T + T/2, y * T + T, now) });
        }
      }
    }
    // Rest fountains (one per rest cluster)
    for (const r of world.rests) draws.push({ y: r.y + 8, draw: () => A.drawFountain(ctx, r.x, r.y, now) });
    // Exit gate
    draws.push({ y: world.exit.y + 4, draw: () => A.drawExitGate(ctx, world.exit.x, world.exit.y, now) });
    // Player
    draws.push({ y: SG.state.player.y + 2, draw: () => A.drawPlayer(ctx, SG.state.player, now) });
    // Sort and draw (only those near the camera for perf)
    draws.sort((a, b) => a.y - b.y);
    for (const d of draws) d.draw();

    A.drawParticles(ctx, dt * 1000, world.worldW, world.worldH, 'rgba(110,255,168,');
    ctx.restore();

    // North Star upgrade: draw arrow toward exit briefly after 60s
    if (SG.save.upgrades.reveal_exit) {
      const elapsed = now - SG.state.runStartT;
      if (elapsed > 60_000 && elapsed < 64_000) {
        const px = SG.state.player.x - cam.x, py = SG.state.player.y - cam.y;
        const ex = world.exit.x - cam.x, ey = world.exit.y - cam.y;
        const ang = Math.atan2(ey - py, ex - px);
        ctx.strokeStyle = 'rgba(110,255,168,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * 36, py + Math.sin(ang) * 36);
        ctx.stroke();
      }
    }

    A.drawVignette(ctx, C.CANVAS_W, C.CANVAS_H, SG.state.attn.chaos > 70 ? 0.7 : 0.5);
  }

  SG.run = { startRun, endRun, update, render, tryReentryMarker };
})();
