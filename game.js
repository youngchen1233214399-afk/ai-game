/* ================================================================
   SIGNAL GARDEN — prototype
   --------------------------------------------------------------
   Single-file game logic, organised in commented sections:
     1. Constants & Save / Progression
     2. Game State
     3. Modular Maze Generator
     4. Renderer
     5. Input & Player Movement
     6. Behaviour Interpreter (Focus / Curiosity / Chaos / Overload / Re-entry)
     7. Attention Director (rule-based "AI Director")
     8. Audio Feedback System (Web Audio API, generated tones)
     9. NPC Reflection Generator (templated, no LLM)
    10. Run Lifecycle (start / tick / end)
    11. UI Bindings (Hub / HUD / Summary)
    12. Boot
   --------------------------------------------------------------
   The game does not mention any specific fantasy work and frames
   attention as a system, not as failure. ADHD-inspired but not
   diagnostic.
   ================================================================ */

(() => {
'use strict';

// =================================================================
// 1. CONSTANTS & SAVE / PROGRESSION
// =================================================================

const TILE = 24;
const COLS = 29;          // odd: maze carve uses cells on odd coords
const ROWS = 19;          // odd
const CANVAS_W = COLS * TILE;
const CANVAS_H = ROWS * TILE;

// Tile codes
const T_WALL      = 0;
const T_FLOOR     = 1;
const T_GLOW      = 2;    // glowing object (interactable)
const T_REST      = 3;    // rest zone tile
const T_EXIT      = 4;    // exit
const T_LANDMARK  = 5;    // director-spawned landmark
const T_UNSTABLE  = 6;    // unstable floor (visual flicker only)
const T_HIDDEN    = 7;    // hidden path (revealed by Curiosity director)

const RUN_DURATION_MS  = 110_000;        // 110s — within 90-120s prototype window
const CHAOS_END_THRESH = 100;            // run ends when chaos saturates
const OVER_END_THRESH  = 100;            // run ends when overload saturates
const DIRECTOR_TICK_MS = 3_000;          // how often director re-evaluates

const SAVE_KEY = 'signal-garden:v1';

// Default save shape. Always merge with stored data so old saves still work.
const defaultSave = () => ({
  seeds: 0,
  runNumber: 0,
  upgrades: {},                          // { id: true } when owned
  lastRun: null,                         // last summary object (for hub display + adaptation)
  audioMuted: false,
});

const loadSave = () => {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return Object.assign(defaultSave(), JSON.parse(raw));
  } catch (e) { return defaultSave(); }
};

const persistSave = () => {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
};

const save = loadSave();

// --- Tool definitions (run-start choice) ---
const TOOLS = [
  { id: 'breathing',  name: 'Breathing Anchor',
    desc: 'Chaos rises more slowly.' },
  { id: 'noise',      name: 'Noise Filter',
    desc: 'Overload rises more slowly.' },
  { id: 'curiosity',  name: 'Curiosity Lens',
    desc: 'Glowing objects give more seeds, but raise Curiosity faster.' },
  { id: 'reentry',    name: 'Re-entry Marker',
    desc: 'Once per run, press R to return to last stable point.' },
  { id: 'softfocus',  name: 'Soft Focus',
    desc: 'Focus rises faster, but hidden paths are harder to reveal.' },
];

// --- Permanent upgrades (paid in seeds) ---
const UPGRADES = [
  { id: 'lower_chaos',   name: 'Calm Soil',
    desc: 'Start each run with -10 Chaos.', cost: 5 },
  { id: 'rest_boost',    name: 'Deep Roots',
    desc: 'Rest zones are 1.5× more effective.', cost: 5 },
  { id: 'reveal_exit',   name: 'North Star',
    desc: 'After 60 s, briefly reveal the exit direction.', cost: 10 },
  { id: 'fast_steps',    name: 'Lighter Steps',
    desc: 'Slightly increased movement speed.', cost: 5 },
  { id: 'still_easy',    name: 'Quiet Stillness',
    desc: 'Hesitation raises Overload more slowly.', cost: 5 },
];

// =================================================================
// 2. GAME STATE
// =================================================================
//   `state` holds runtime data only. Persistent data is in `save`.

const state = {
  screen: 'hub',                         // 'hub' | 'run' | 'summary'

  // Maze
  grid: null,                            // 2D array [row][col] of tile codes
  startTile: { x: 1, y: 1 },
  exitTile:  { x: COLS - 2, y: ROWS - 2 },
  mainRoute: new Set(),                  // 'x,y' tile keys on shortest start→exit path
  glowObjects: [],                       // { x, y, taken, seenT } — for "ignored distraction" rule

  // Player
  player: { x: 0, y: 0, r: 7, vx: 0, vy: 0, lastDirAngle: 0 },
  selectedTool: 'breathing',
  reentryUsed: false,
  lastStableTile: null,                  // for Re-entry Marker tool

  // Attention state (0..100)
  attn: { focus: 0, curiosity: 0, chaos: 0, overload: 0 },
  reentryCount: 0,
  seedsThisRun: 0,

  // Behaviour tracking
  bh: {
    lastInputTime: 0,
    stillTime: 0,                        // ms standing still
    moveTime: 0,                         // ms moving in same general direction
    dirHistory: [],                      // recent dir angles + timestamps
    lastSwitchT: 0,
    onMainRoute: true,
    leftRouteAt: 0,
    visitedCells: new Map(),             // cellKey -> visit count (for loop detection)
    lastCellKey: null,
    triggerLog: {},                      // { focus: 'forward movement', ... } main triggers
  },

  // Run timing
  runStartT: 0,
  runEndReason: null,                    // 'exit' | 'chaos' | 'overload' | 'time' | 'aborted'
  runActive: false,

  // Director
  directorLastTick: 0,
  directorEvent: null,                   // current event display
  directorEventUntil: 0,
  exitHinted: false,
  cameraShakeUntil: 0,

  // Logging
  log: [],
};

// =================================================================
// 3. MODULAR MAZE GENERATOR
// =================================================================
//   Strategy:
//     * Standard recursive-backtracker carve over a cell grid where
//       cells live at odd tile coordinates. Walls between cells live
//       at even coords.
//     * After carving, classify dead-end and corridor cells, then
//       drop in MODULES (rest zone, glow room, loop, unstable, exit)
//       with weights influenced by the previous run's dominant state
//       — this is the "next run is shaped by your last run" rule.

const cellKey = (x, y) => `${x},${y}`;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS;

// Adapt module weights based on save.lastRun (per-state rules in spec)
function moduleWeights(lastRun) {
  // baseline weights (probability multipliers)
  const w = {
    restZone:    1.0,
    glowObject:  1.0,
    hiddenGlow:  0.4,    // requires curiosity director to reveal
    loop:        1.0,
    unstable:    0.5,
    landmark:    0.5,
    openness:    0.0,    // chance to knock out extra walls (more open)
    complexity:  1.0,    // multiplier on glow / loop count
  };
  if (!lastRun) return w;

  const dom = lastRun.dominant;
  if (dom === 'chaos')     { w.restZone += 0.8; w.landmark += 0.6; w.unstable -= 0.3; }
  if (dom === 'focus')     { w.glowObject += 0.6; w.loop += 0.4; }   // more temptations
  if (dom === 'curiosity') { w.hiddenGlow += 0.6; w.glowObject += 0.3; }
  if (dom === 'overload')  { w.openness += 0.25; w.unstable -= 0.4; }

  // If they reached exit quickly, bump complexity slightly
  if (lastRun.outcome === 'exit' && lastRun.timeMs < RUN_DURATION_MS * 0.5) {
    w.complexity += 0.4;
    w.loop += 0.4;
  }
  return w;
}

function generateMaze() {
  const w = moduleWeights(save.lastRun);

  // Init all walls
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(T_WALL));

  // Carve recursive backtracker over cell-at-odd-coords graph
  const cellW = (COLS - 1) / 2;          // number of cells along x  (e.g. 14)
  const cellH = (ROWS - 1) / 2;
  const visited = Array.from({ length: cellH }, () => Array(cellW).fill(false));
  const stack = [[0, 0]];
  visited[0][0] = true;
  grid[1][1] = T_FLOOR;

  const DIRS = [[1,0],[-1,0],[0,1],[0,-1]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = DIRS
      .map(([dx, dy]) => [cx + dx, cy + dy, dx, dy])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cellW && ny < cellH && !visited[ny][nx]);
    if (!opts.length) { stack.pop(); continue; }
    const pick = opts[(Math.random() * opts.length) | 0];
    const [nx, ny, dx, dy] = pick;
    visited[ny][nx] = true;
    // tile coords
    const tx = 1 + cx * 2, ty = 1 + cy * 2;
    const wx = tx + dx, wy = ty + dy;    // wall between cells
    const ntx = 1 + nx * 2, nty = 1 + ny * 2;
    grid[ty][tx] = T_FLOOR;
    grid[wy][wx] = T_FLOOR;
    grid[nty][ntx] = T_FLOOR;
    stack.push([nx, ny]);
  }

  // Add LOOP modules: knock out random walls between two adjacent cells
  // → produces alternative paths. Count scaled by weights.
  const loopCount = Math.round(4 * w.loop);
  for (let i = 0; i < loopCount; i++) {
    const cx = (Math.random() * cellW) | 0;
    const cy = (Math.random() * cellH) | 0;
    const [dx, dy] = DIRS[(Math.random() * 4) | 0];
    const nx = cx + dx, ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= cellW || ny >= cellH) continue;
    const wx = 1 + cx * 2 + dx, wy = 1 + cy * 2 + dy;
    grid[wy][wx] = T_FLOOR;
  }

  // Extra OPENNESS (overload-driven): knock out random walls
  if (w.openness > 0) {
    const extra = Math.round(20 * w.openness);
    for (let i = 0; i < extra; i++) {
      const x = 1 + ((Math.random() * (COLS - 2)) | 0);
      const y = 1 + ((Math.random() * (ROWS - 2)) | 0);
      if (grid[y][x] === T_WALL) grid[y][x] = T_FLOOR;
    }
  }

  // EXIT module: place an exit at far cell
  const exitTile = { x: COLS - 2, y: ROWS - 2 };
  grid[exitTile.y][exitTile.x] = T_EXIT;

  // Find dead-end cells (cell tiles with exactly one floor neighbour)
  const deadEnds = [];
  for (let cy = 0; cy < cellH; cy++) {
    for (let cx = 0; cx < cellW; cx++) {
      const tx = 1 + cx * 2, ty = 1 + cy * 2;
      let n = 0;
      for (const [dx, dy] of DIRS) if (grid[ty + dy] && grid[ty + dy][tx + dx] === T_FLOOR) n++;
      if (n === 1) deadEnds.push({ x: tx, y: ty });
    }
  }
  // Shuffle dead ends
  for (let i = deadEnds.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [deadEnds[i], deadEnds[j]] = [deadEnds[j], deadEnds[i]];
  }

  // REST ZONE module: open up a 3×3 patch around chosen dead-end cell
  const restCount = Math.max(1, Math.round(2 * w.restZone));
  let placed = 0;
  for (const c of deadEnds) {
    if (placed >= restCount) break;
    if (c.x === 1 && c.y === 1) continue;          // not start
    if (c.x === exitTile.x && c.y === exitTile.y) continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (x > 0 && y > 0 && x < COLS - 1 && y < ROWS - 1) grid[y][x] = T_REST;
      }
    }
    placed++;
  }

  // GLOWING OBJECT modules: drop into remaining dead-end cells
  const glowObjects = [];
  const glowCount = Math.max(2, Math.round(4 * w.glowObject * w.complexity));
  let glowPlaced = 0;
  for (const c of deadEnds) {
    if (glowPlaced >= glowCount) break;
    if (grid[c.y][c.x] !== T_FLOOR) continue;
    grid[c.y][c.x] = T_GLOW;
    glowObjects.push({ x: c.x, y: c.y, taken: false, seenT: 0, hidden: false });
    glowPlaced++;
  }

  // HIDDEN GLOW: a few placed inside walls, only revealed by Curiosity director
  const hiddenCount = Math.round(2 * w.hiddenGlow);
  for (let i = 0; i < hiddenCount; i++) {
    // find a wall cell with at least one floor neighbour — flag it as T_HIDDEN
    let tries = 30;
    while (tries--) {
      const x = 2 + ((Math.random() * (COLS - 4)) | 0);
      const y = 2 + ((Math.random() * (ROWS - 4)) | 0);
      if (grid[y][x] !== T_WALL) continue;
      let touchesFloor = false;
      for (const [dx, dy] of DIRS) {
        if ((grid[y + dy] || [])[x + dx] === T_FLOOR) { touchesFloor = true; break; }
      }
      if (touchesFloor) { grid[y][x] = T_HIDDEN; break; }
    }
  }

  // UNSTABLE module: visual flicker on a few floor tiles (cosmetic)
  const unstableCount = Math.round(6 * w.unstable);
  for (let i = 0; i < unstableCount; i++) {
    const x = 1 + ((Math.random() * (COLS - 2)) | 0);
    const y = 1 + ((Math.random() * (ROWS - 2)) | 0);
    if (grid[y][x] === T_FLOOR) grid[y][x] = T_UNSTABLE;
  }

  // Compute main route (BFS from start to exit) — used by re-entry rule.
  state.mainRoute = bfsRoute(grid, { x: 1, y: 1 }, exitTile);

  state.grid = grid;
  state.startTile = { x: 1, y: 1 };
  state.exitTile = exitTile;
  state.glowObjects = glowObjects;
}

// BFS that treats most tiles as walkable; returns Set of 'x,y' on shortest path.
function bfsRoute(grid, start, goal) {
  const walk = (x, y) => {
    const t = (grid[y] || [])[x];
    return t === T_FLOOR || t === T_REST || t === T_GLOW || t === T_EXIT
        || t === T_UNSTABLE || t === T_LANDMARK;
  };
  const q = [[start.x, start.y]];
  const prev = new Map();
  prev.set(cellKey(start.x, start.y), null);
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal.x && y === goal.y) break;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walk(nx, ny)) continue;
      const k = cellKey(nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, cellKey(x, y));
      q.push([nx, ny]);
    }
  }
  const route = new Set();
  let k = cellKey(goal.x, goal.y);
  if (!prev.has(k)) return route;
  while (k) { route.add(k); k = prev.get(k); }
  return route;
}

// =================================================================
// 4. RENDERER
// =================================================================

const canvas = document.getElementById('maze-canvas');
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;
const ctx = canvas.getContext('2d');

function render(now) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // Camera shake offset under chaos / director
  let sx = 0, sy = 0;
  if (now < state.cameraShakeUntil || state.attn.chaos > 70) {
    const intensity = state.attn.chaos > 70 ? (state.attn.chaos - 70) / 30 : 0.6;
    sx = (Math.random() - 0.5) * 4 * intensity;
    sy = (Math.random() - 0.5) * 4 * intensity;
  }
  ctx.save();
  ctx.translate(sx, sy);

  // Background grid lines (very faint)
  ctx.strokeStyle = 'rgba(110,255,168,0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    ctx.beginPath(); ctx.moveTo(x*TILE+0.5, 0); ctx.lineTo(x*TILE+0.5, CANVAS_H); ctx.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    ctx.beginPath(); ctx.moveTo(0, y*TILE+0.5); ctx.lineTo(CANVAS_W, y*TILE+0.5); ctx.stroke();
  }

  // Tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = state.grid[y][x];
      if (t === T_WALL) {
        ctx.fillStyle = '#0c1412';
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(110,255,168,0.18)';
        ctx.strokeRect(x*TILE+0.5, y*TILE+0.5, TILE-1, TILE-1);
      } else if (t === T_FLOOR) {
        // empty floor — leave bg
      } else if (t === T_REST) {
        ctx.fillStyle = 'rgba(110,255,168,0.06)';
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(110,255,168,0.18)';
        ctx.strokeRect(x*TILE+1.5, y*TILE+1.5, TILE-3, TILE-3);
      } else if (t === T_EXIT) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 240);
        ctx.fillStyle = `rgba(110,255,168,${0.18 * pulse})`;
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        ctx.strokeStyle = `rgba(110,255,168,${0.7 * pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x*TILE+2.5, y*TILE+2.5, TILE-5, TILE-5);
        ctx.lineWidth = 1;
      } else if (t === T_GLOW) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 300 + x + y);
        const r = TILE * 0.32;
        const cx = x*TILE + TILE/2;
        const cy = y*TILE + TILE/2;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
        grad.addColorStop(0, `rgba(154,217,255,${0.5 + 0.4*pulse})`);
        grad.addColorStop(1, 'rgba(154,217,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(cx, cy, r * 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(154,217,255,${0.8})`;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2); ctx.fill();
      } else if (t === T_LANDMARK) {
        const cx = x*TILE + TILE/2, cy = y*TILE + TILE/2;
        ctx.strokeStyle = 'rgba(240,192,117,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 7, cy); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx - 7, cy); ctx.closePath();
        ctx.stroke();
        ctx.lineWidth = 1;
      } else if (t === T_UNSTABLE) {
        const flick = Math.random() < 0.05;
        if (flick) {
          ctx.fillStyle = 'rgba(255,90,106,0.06)';
          ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        }
      } else if (t === T_HIDDEN) {
        // hidden — render as wall but with a faint shimmer
        ctx.fillStyle = '#0c1412';
        ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        ctx.strokeStyle = 'rgba(110,255,168,0.18)';
        ctx.strokeRect(x*TILE+0.5, y*TILE+0.5, TILE-1, TILE-1);
        if (Math.random() < 0.02) {
          ctx.fillStyle = 'rgba(154,217,255,0.06)';
          ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
        }
      }
    }
  }

  // Exit hint arrow if upgrade unlocked + after 60s
  if (save.upgrades.reveal_exit && state.runActive) {
    const elapsed = now - state.runStartT;
    if (elapsed > 60_000 && elapsed < 64_000) {
      const px = state.player.x, py = state.player.y;
      const ex = state.exitTile.x*TILE + TILE/2, ey = state.exitTile.y*TILE + TILE/2;
      const ang = Math.atan2(ey - py, ex - px);
      ctx.strokeStyle = 'rgba(110,255,168,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(ang) * 30, py + Math.sin(ang) * 30);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  }

  // Player
  const p = state.player;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
  grad.addColorStop(0, 'rgba(110,255,168,0.9)');
  grad.addColorStop(1, 'rgba(110,255,168,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#dffce8';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// =================================================================
// 5. INPUT & PLAYER MOVEMENT
// =================================================================

const keys = new Set();
addEventListener('keydown', (e) => {
  if (state.screen !== 'run') return;
  const k = e.key.toLowerCase();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (k === ' ' || k === 'e') tryInteract();
  if (k === 'r' && state.selectedTool === 'reentry') tryReentryMarker();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function getInputVector() {
  let dx = 0, dy = 0;
  if (keys.has('arrowup') || keys.has('w'))    dy -= 1;
  if (keys.has('arrowdown') || keys.has('s'))  dy += 1;
  if (keys.has('arrowleft') || keys.has('a'))  dx -= 1;
  if (keys.has('arrowright') || keys.has('d')) dx += 1;
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  return [dx, dy];
}

// Walkable for movement
function tileWalkable(t) {
  return t === T_FLOOR || t === T_REST || t === T_GLOW || t === T_EXIT
      || t === T_UNSTABLE || t === T_LANDMARK;
}

// Resolve player position vs walls (axis-separated AABB-vs-tiles)
function moveAndCollide(p, dx, dy) {
  const apply = (axisDx, axisDy) => {
    p.x += axisDx; p.y += axisDy;
    const r = p.r;
    const minTX = Math.max(0, Math.floor((p.x - r) / TILE));
    const maxTX = Math.min(COLS - 1, Math.floor((p.x + r) / TILE));
    const minTY = Math.max(0, Math.floor((p.y - r) / TILE));
    const maxTY = Math.min(ROWS - 1, Math.floor((p.y + r) / TILE));
    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const t = state.grid[ty][tx];
        if (tileWalkable(t)) continue;
        // collide
        const left = tx*TILE, right = tx*TILE + TILE;
        const top = ty*TILE, bot = ty*TILE + TILE;
        const cx = Math.max(left, Math.min(p.x, right));
        const cy = Math.max(top, Math.min(p.y, bot));
        const ddx = p.x - cx, ddy = p.y - cy;
        const d2 = ddx*ddx + ddy*ddy;
        if (d2 < r*r) {
          if (axisDx !== 0) p.x = axisDx > 0 ? left - r - 0.001 : right + r + 0.001;
          if (axisDy !== 0) p.y = axisDy > 0 ? top - r - 0.001 : bot + r + 0.001;
        }
      }
    }
  };
  apply(dx, 0);
  apply(0, dy);
}

function tryInteract() {
  const { x, y } = playerTile();
  // Glowing object on current tile?
  const obj = state.glowObjects.find(o => o.x === x && o.y === y && !o.taken);
  if (!obj) {
    // Maybe also adjacent? Forgive 1 tile around
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const o2 = state.glowObjects.find(o => o.x === x+dx && o.y === y+dy && !o.taken);
      if (o2) return collectGlow(o2);
    }
    return;
  }
  collectGlow(obj);
}

function collectGlow(obj) {
  obj.taken = true;
  state.grid[obj.y][obj.x] = T_FLOOR;
  // Curiosity Lens tool gives more seeds
  const isLens = state.selectedTool === 'curiosity';
  const gain = isLens ? 2 : 1;
  state.seedsThisRun += gain;
  // Curiosity bump
  const cBump = isLens ? 22 : 14;
  bumpAttn('curiosity', cBump, 'glowing object');
  pushLog(`+${gain} signal seed${gain > 1 ? 's' : ''}`);
  audio.curiosityPing();
}

function tryReentryMarker() {
  if (state.reentryUsed || !state.lastStableTile) return;
  state.reentryUsed = true;
  const t = state.lastStableTile;
  state.player.x = t.x*TILE + TILE/2;
  state.player.y = t.y*TILE + TILE/2;
  pushLog('re-entry marker used');
  bumpAttn('focus', 6, 're-entry marker');
}

function playerTile() {
  return { x: Math.floor(state.player.x / TILE), y: Math.floor(state.player.y / TILE) };
}

// =================================================================
// 6. BEHAVIOUR INTERPRETER
// =================================================================
//   Translates raw movement / interaction into the four attention
//   states. All numeric weights are deliberately small so that
//   states evolve gradually over a 110s run.

function bumpAttn(name, amount, trigger) {
  const tools = state.selectedTool;
  // Tool effects
  if (name === 'chaos' && tools === 'breathing') amount *= 0.5;
  if (name === 'overload' && tools === 'noise')  amount *= 0.5;
  if (name === 'curiosity' && tools === 'curiosity') amount *= 1.5;
  if (name === 'focus' && tools === 'softfocus')     amount *= 1.5;

  // Permanent upgrade: hesitation Overload reduced
  if (name === 'overload' && save.upgrades.still_easy && trigger === 'hesitation') amount *= 0.6;

  // Rest zone bonus (applied where used)
  state.attn[name] = Math.max(0, Math.min(100, state.attn[name] + amount));
  if (amount > 0 && trigger) state.bh.triggerLog[name] = trigger;
}

function updateBehaviour(dt, now) {
  const [ix, iy] = getInputVector();
  const moving = ix !== 0 || iy !== 0;
  const bh = state.bh;

  // 6.1 standing still → Overload
  if (!moving) {
    bh.stillTime += dt;
    bh.moveTime = 0;
    if (bh.stillTime > 1200) {
      bumpAttn('overload', 0.10 * (dt / 16.67), 'hesitation');
    }
  } else {
    bh.stillTime = 0;
    bh.moveTime += dt;
  }

  // 6.2 forward / stable movement → Focus
  if (moving) {
    const ang = Math.atan2(iy, ix);
    const last = bh.dirHistory[bh.dirHistory.length - 1];
    let stable = true;
    if (last) {
      let diff = Math.abs(ang - last.a);
      if (diff > Math.PI) diff = Math.PI*2 - diff;
      if (diff > Math.PI * 0.6) stable = false;     // sharp change
    }
    if (stable && bh.moveTime > 800) {
      bumpAttn('focus', 0.06 * (dt / 16.67), 'forward movement');
    }
    // 6.3 sharp direction switch → Chaos
    if (!stable) {
      const sinceLast = now - bh.lastSwitchT;
      bh.lastSwitchT = now;
      if (sinceLast < 350) {
        // rapid back-and-forth
        bumpAttn('chaos', 4.0, 'rapid back-and-forth');
      } else if (sinceLast < 900) {
        bumpAttn('chaos', 1.6, 'frequent direction changes');
      }
      bh.moveTime = 0;
    }
    bh.dirHistory.push({ a: ang, t: now });
    if (bh.dirHistory.length > 12) bh.dirHistory.shift();
  }

  // 6.4 Rest zone reduces Overload + Chaos slightly
  const pt = playerTile();
  const onRest = state.grid[pt.y] && state.grid[pt.y][pt.x] === T_REST;
  if (onRest) {
    const mult = save.upgrades.rest_boost ? 1.5 : 1;
    bumpAttn('overload', -0.18 * (dt / 16.67) * mult, 'rest zone');
    bumpAttn('chaos',    -0.10 * (dt / 16.67) * mult, 'rest zone');
  }

  // 6.5 Re-entry: leaving and returning to main route
  const onMain = state.mainRoute.has(cellKey(pt.x, pt.y));
  if (bh.onMainRoute && !onMain) {
    bh.onMainRoute = false;
    bh.leftRouteAt = now;
  } else if (!bh.onMainRoute && onMain) {
    bh.onMainRoute = true;
    if (now - bh.leftRouteAt > 2500) {
      state.reentryCount++;
      bumpAttn('focus', 4, 're-entry');
      pushLog('re-entry: returned to main route');
    }
  }
  if (onMain) state.lastStableTile = { x: pt.x, y: pt.y };

  // 6.6 Loop detection: visit same cell repeatedly
  const k = cellKey(pt.x, pt.y);
  if (k !== bh.lastCellKey) {
    bh.lastCellKey = k;
    bh.visitedCells.set(k, (bh.visitedCells.get(k) || 0) + 1);
  }

  // 6.7 Ignored distractions: if a glowing object has been on screen
  //     for a while and player did not interact → small Focus gain.
  for (const obj of state.glowObjects) {
    if (obj.taken) continue;
    const dx = obj.x*TILE + TILE/2 - state.player.x;
    const dy = obj.y*TILE + TILE/2 - state.player.y;
    const d = Math.hypot(dx, dy);
    if (d < TILE * 4) obj.seenT += dt;
    if (obj.seenT > 6000 && !obj._rewardedIgnore) {
      obj._rewardedIgnore = true;
      bumpAttn('focus', 5, 'ignored a distraction');
      pushLog('you let one signal pass');
    }
  }

  // 6.8 Reach exit
  if (state.grid[pt.y][pt.x] === T_EXIT) {
    endRun('exit');
  }
}

// =================================================================
// 7. ATTENTION DIRECTOR
// =================================================================
//   Rule-based scheduler that observes attention state every few
//   seconds and fires adaptive events. Each event sets a banner and
//   may mutate the maze.

function setDirectorEvent(label, kind, durationMs = 3500) {
  state.directorEvent = { label, kind };
  state.directorEventUntil = performance.now() + durationMs;
  const banner = document.getElementById('director-banner');
  banner.textContent = label;
  banner.classList.toggle('chaos', kind === 'chaos');
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), durationMs);
  pushLog(`[director] ${label}`);
}

function directorTick(now) {
  if (now - state.directorLastTick < DIRECTOR_TICK_MS) return;
  state.directorLastTick = now;
  const a = state.attn;

  // Chaos exceeds threshold → end run as Maze Rebuilt
  if (a.chaos >= CHAOS_END_THRESH - 5) {
    setDirectorEvent('the garden is rebuilding…', 'chaos', 1200);
    setTimeout(() => endRun('chaos'), 800);
    return;
  }

  // Overload threshold → similarly end
  if (a.overload >= OVER_END_THRESH - 5) {
    setDirectorEvent('signal too loud — fade', 'chaos', 1200);
    setTimeout(() => endRun('overload'), 800);
    return;
  }

  // High Focus → spawn a tempting glowing object on a side path
  if (a.focus > 70) {
    const placed = spawnTemptation();
    if (placed) setDirectorEvent('a temptation glows nearby', 'curiosity');
    return;
  }

  // High Curiosity → reveal a hidden path (T_HIDDEN -> T_FLOOR)
  if (a.curiosity > 70) {
    const revealed = revealHiddenNearPlayer();
    if (revealed) setDirectorEvent('a hidden path opens', 'curiosity');
    return;
  }

  // High Chaos → distort visuals + warn
  if (a.chaos > 70) {
    setDirectorEvent('the garden is shaking', 'chaos');
    state.cameraShakeUntil = now + 2200;
    document.querySelector('.maze-wrap').classList.add('glitch');
    setTimeout(() => document.querySelector('.maze-wrap').classList.remove('glitch'), 2400);
    return;
  }

  // High Overload → open a rest zone near the player
  if (a.overload > 70) {
    if (openRestNearPlayer()) setDirectorEvent('a quiet patch opens', 'rest');
    return;
  }

  // Looping behaviour → drop a landmark
  for (const [k, n] of state.bh.visitedCells) {
    if (n >= 4) {
      placeLandmarkAt(k);
      setDirectorEvent('a landmark appears', 'rest');
      state.bh.visitedCells.set(k, 0);
      return;
    }
  }
}

function spawnTemptation() {
  // Find a dead-end cell off the main route, place a glowing object
  for (let i = 0; i < 30; i++) {
    const x = 1 + 2 * ((Math.random() * ((COLS - 1) / 2)) | 0);
    const y = 1 + 2 * ((Math.random() * ((ROWS - 1) / 2)) | 0);
    if (state.mainRoute.has(cellKey(x, y))) continue;
    const t = state.grid[y][x];
    if (t !== T_FLOOR) continue;
    state.grid[y][x] = T_GLOW;
    state.glowObjects.push({ x, y, taken: false, seenT: 0, hidden: false });
    return true;
  }
  return false;
}

function revealHiddenNearPlayer() {
  const pt = playerTile();
  const radius = state.selectedTool === 'softfocus' ? 3 : 5;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = pt.x + dx, y = pt.y + dy;
      if (!inBounds(x, y)) continue;
      if (state.grid[y][x] === T_HIDDEN) {
        state.grid[y][x] = T_GLOW;
        state.glowObjects.push({ x, y, taken: false, seenT: 0, hidden: true });
        return true;
      }
    }
  }
  return false;
}

function openRestNearPlayer() {
  const pt = playerTile();
  // Pick nearest wall tile within radius and convert to rest patch
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = pt.x + dx, y = pt.y + dy;
        if (!inBounds(x, y)) continue;
        if (state.grid[y][x] !== T_WALL) continue;
        // Knock out a 2×2 patch as rest zone
        for (let oy = 0; oy <= 1; oy++) {
          for (let ox = 0; ox <= 1; ox++) {
            const px = Math.min(COLS - 2, x + ox), py = Math.min(ROWS - 2, y + oy);
            if (state.grid[py][px] === T_WALL) state.grid[py][px] = T_REST;
          }
        }
        return true;
      }
    }
  }
  return false;
}

function placeLandmarkAt(key) {
  const [x, y] = key.split(',').map(Number);
  if (state.grid[y][x] === T_FLOOR) state.grid[y][x] = T_LANDMARK;
}

// =================================================================
// 8. AUDIO FEEDBACK SYSTEM
// =================================================================
//   Pure Web Audio API. Four layered "voices":
//     - focus    : subtle steady sine tone, gain rises with focus
//     - curiosity: short ping triggered when collecting a glow object
//     - chaos    : irregular pulse on a detuned saw
//     - overload : low-pass filter cutoff drops as overload rises

const audio = (() => {
  let ctx = null, master = null, focusOsc = null, focusGain = null;
  let chaosOsc = null, chaosGain = null;
  let lpFilter = null;
  let started = false;

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = save.audioMuted ? 0 : 0.4;
      lpFilter = ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = 16000;
      lpFilter.connect(master);
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function start() {
    ensure();
    if (!ctx || started) return;
    started = true;
    // Focus tone
    focusOsc = ctx.createOscillator();
    focusOsc.type = 'sine';
    focusOsc.frequency.value = 196;
    focusGain = ctx.createGain();
    focusGain.gain.value = 0.0;
    focusOsc.connect(focusGain).connect(lpFilter);
    focusOsc.start();
    // Chaos pulse on a slightly detuned sawtooth
    chaosOsc = ctx.createOscillator();
    chaosOsc.type = 'sawtooth';
    chaosOsc.frequency.value = 73;
    chaosGain = ctx.createGain();
    chaosGain.gain.value = 0.0;
    chaosOsc.connect(chaosGain).connect(lpFilter);
    chaosOsc.start();
  }

  function stop() {
    if (!ctx || !started) return;
    started = false;
    try { focusOsc.stop(); chaosOsc.stop(); } catch (e) {}
    focusOsc = chaosOsc = focusGain = chaosGain = null;
  }

  function update(attn) {
    if (!ctx || !started) return;
    // Focus drone gain
    focusGain.gain.linearRampToValueAtTime(0.04 + (attn.focus / 100) * 0.10, ctx.currentTime + 0.4);
    // Chaos rhythm: pulse irregularly as chaos rises
    const c = attn.chaos / 100;
    chaosGain.gain.cancelScheduledValues(ctx.currentTime);
    if (c > 0.15) {
      const now = ctx.currentTime;
      const pulse = 0.04 + c * 0.10;
      chaosGain.gain.setValueAtTime(pulse, now);
      chaosGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + Math.random() * 0.2);
      chaosOsc.frequency.setValueAtTime(60 + Math.random() * 40 * c, now);
    }
    // Overload: lowpass drops cutoff
    const o = attn.overload / 100;
    lpFilter.frequency.linearRampToValueAtTime(16000 - o * 14500, ctx.currentTime + 0.4);
  }

  function curiosityPing() {
    ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(1320, t + 0.15);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(lpFilter);
    o.start(t); o.stop(t + 0.32);
  }

  function setMuted(m) {
    save.audioMuted = m;
    persistSave();
    if (master) master.gain.value = m ? 0 : 0.4;
  }

  return { ensure, start, stop, update, curiosityPing, setMuted, get muted() { return save.audioMuted; } };
})();

// =================================================================
// 9. NPC REFLECTION GENERATOR (rule-based; LLM-style templates)
// =================================================================
//   Picks templates based on dominant attention state and trigger.
//   Easy to swap with a real LLM call later — see TODO at bottom.

const OBSERVER_LINES = {
  none: [
    'Welcome. The garden is listening. When you are ready, enter.',
    'Begin when you wish. Your rhythm is already part of the system.',
  ],
  chaos: [
    'The garden did not punish you. It copied the rhythm of your switching.',
    'You moved many times in many directions. The walls are still tasting it.',
  ],
  curiosity: [
    'You followed many signals. Some were distractions, but one of them became a door.',
    'You looked sideways often. The garden grew small lights to match.',
  ],
  focus: [
    'You walked in a clear line, but the garden wondered what you chose not to see.',
    'You held a single thread. It made the path narrower and brighter.',
  ],
  overload: [
    'Stillness is not failure. Sometimes the system becomes too loud to enter.',
    'You stood at the edge of the next step for a long time. That is information, too.',
  ],
  reentry: [
    'You left the path and returned. That is not losing focus. That is re-entry.',
    'You drifted, and you came back. The garden remembers the shape of return.',
  ],
};

const REFLECTION_LINES = {
  chaos: 'You moved with many minds at once. The garden tried to keep up.',
  curiosity: 'You followed too many lights, but one of them remembered your path.',
  focus: 'You held a line. The garden noticed which signals you ignored.',
  overload: 'The system became too loud to walk through. Standing was the honest reply.',
  reentry: 'You left the route and returned. That return is its own kind of progress.',
};

const SUGGESTED_TOOL = {
  chaos: 'Breathing Anchor',
  curiosity: 'Soft Focus',
  focus: 'Curiosity Lens',
  overload: 'Noise Filter',
  reentry: 'Re-entry Marker',
};

function pickObserverLine(lastRun) {
  if (!lastRun) return rand(OBSERVER_LINES.none);
  if (lastRun.reentry >= 3) return rand(OBSERVER_LINES.reentry);
  return rand(OBSERVER_LINES[lastRun.dominant] || OBSERVER_LINES.none);
}

function rand(arr) { return arr[(Math.random() * arr.length) | 0]; }

function buildReflection(runStats) {
  const { runNumber, dominant, mainTrigger, seeds, outcome, reentry, attnPeak } = runStats;
  const outcomeLabel = ({
    exit: 'Reached Exit',
    chaos: 'Maze Rebuilt',
    overload: 'Signal Faded',
    time: 'Time Elapsed',
    aborted: 'Run Aborted',
  })[outcome] || outcome;

  const niceName = d => d === 'reentry' ? 'Re-entry' : cap(d);
  const dominantLabel = (() => {
    if (reentry >= 3 && dominant !== 'overload' && dominant !== 'reentry')
      return `${niceName(dominant)} → Re-entry`;
    // detect a transition: if curiosity peak was high but ended in chaos
    if (attnPeak.curiosity > 70 && attnPeak.chaos > 60 && dominant === 'chaos') return 'Curiosity → Chaos';
    if (attnPeak.focus > 70 && attnPeak.chaos > 60 && dominant === 'chaos') return 'Focus → Chaos';
    return niceName(dominant);
  })();

  const reflection = REFLECTION_LINES[dominant] || REFLECTION_LINES.focus;
  const tool = SUGGESTED_TOOL[dominant] || 'Breathing Anchor';

  return [
    `Run ${String(runNumber).padStart(2, '0')} Summary:`,
    `Dominant State: ${dominantLabel}`,
    `Main Trigger: ${mainTrigger || '—'}`,
    `Signal Seeds Collected: ${seeds}`,
    `Outcome: ${outcomeLabel}`,
    `Reflection: ${reflection}`,
    `Suggested Tool: ${tool}`,
  ].join('\n');
}

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '—');

// =================================================================
// 10. RUN LIFECYCLE
// =================================================================

function startRun() {
  audio.ensure();
  audio.start();

  save.runNumber += 1;
  state.runActive = true;
  state.runEndReason = null;
  state.attn = { focus: 0, curiosity: 0, chaos: 0, overload: 0 };
  state.reentryCount = 0;
  state.seedsThisRun = 0;
  state.reentryUsed = false;
  state.bh = {
    lastInputTime: 0, stillTime: 0, moveTime: 0,
    dirHistory: [], lastSwitchT: 0,
    onMainRoute: true, leftRouteAt: 0,
    visitedCells: new Map(),
    lastCellKey: null,
    triggerLog: {},
  };
  state.attnPeak = { focus: 0, curiosity: 0, chaos: 0, overload: 0 };

  generateMaze();

  // Permanent upgrade: lower starting Chaos
  if (save.upgrades.lower_chaos) state.attn.chaos = Math.max(0, state.attn.chaos - 10);

  // Spawn player at start tile center
  state.player.x = state.startTile.x * TILE + TILE / 2;
  state.player.y = state.startTile.y * TILE + TILE / 2;
  state.lastStableTile = { ...state.startTile };

  // Reset director
  state.directorLastTick = performance.now();
  state.directorEvent = null;
  state.directorEventUntil = 0;
  state.cameraShakeUntil = 0;

  // Show run screen
  switchScreen('run');
  state.runStartT = performance.now();
  state.log.length = 0;
  pushLog(`run ${save.runNumber} begins`);
  updateHUD();
}

function tick(now) {
  if (state.runActive && state.screen === 'run') {
    const dt = Math.min(50, now - (state._lastNow || now));
    state._lastNow = now;

    // Movement
    const [ix, iy] = getInputVector();
    let speed = 110 / 1000; // px per ms
    if (save.upgrades.fast_steps) speed *= 1.15;
    if (state.attn.overload > 60) speed *= 1 - (state.attn.overload - 60) / 200; // sluggish under overload
    moveAndCollide(state.player, ix * speed * dt, iy * speed * dt);

    updateBehaviour(dt, now);

    // Track peaks
    for (const k of ['focus','curiosity','chaos','overload']) {
      state.attnPeak[k] = Math.max(state.attnPeak[k] || 0, state.attn[k]);
    }

    directorTick(now);
    audio.update(state.attn);

    // Run timer
    const elapsed = now - state.runStartT;
    if (elapsed >= RUN_DURATION_MS) endRun('time');

    updateHUD(elapsed);
    render(now);
  } else {
    state._lastNow = now;
  }
  requestAnimationFrame(tick);
}

function endRun(reason) {
  if (!state.runActive) return;
  state.runActive = false;
  state.runEndReason = reason;
  audio.stop();

  // Compute dominant
  const a = state.attn;
  let dominant = 'focus', best = -Infinity;
  for (const k of ['focus','curiosity','chaos','overload']) {
    if (a[k] > best) { best = a[k]; dominant = k; }
  }
  // If re-entry was the standout behaviour
  if (state.reentryCount >= 3 && best < 60) dominant = 'reentry';

  const trigger = state.bh.triggerLog[dominant] || (
    dominant === 'focus' ? 'forward movement' :
    dominant === 'curiosity' ? 'glowing side objects' :
    dominant === 'chaos' ? 'rapid direction changes' :
    dominant === 'overload' ? 'long hesitation' : 're-entry'
  );

  const runStats = {
    runNumber: save.runNumber,
    dominant,
    mainTrigger: trigger,
    seeds: state.seedsThisRun,
    outcome: reason,
    reentry: state.reentryCount,
    attnPeak: state.attnPeak,
    timeMs: performance.now() - state.runStartT,
  };

  save.seeds += state.seedsThisRun;
  save.lastRun = runStats;
  persistSave();

  const text = buildReflection(runStats);
  document.getElementById('summary-text').textContent = text;
  switchScreen('summary');
}

// =================================================================
// 11. UI BINDINGS (Hub / HUD / Summary)
// =================================================================

function switchScreen(name) {
  state.screen = name;
  for (const id of ['hub','run','summary']) {
    const el = document.getElementById(`screen-${id}`);
    el.classList.toggle('active', id === name);
  }
  if (name === 'hub') refreshHub();
}

function refreshHub() {
  document.getElementById('hub-run-number').textContent = String(save.runNumber + 1).padStart(2, '0');
  document.getElementById('hub-seeds').textContent = save.seeds;

  // Observer line
  document.getElementById('observer-text').textContent = pickObserverLine(save.lastRun);

  // Last reflection
  document.getElementById('last-reflection').textContent =
    save.lastRun ? buildReflection(save.lastRun) : 'No runs yet. The garden is empty of memory.';

  // Tools
  const toolList = document.getElementById('tool-list');
  toolList.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'tool-btn' + (state.selectedTool === t.id ? ' selected' : '');
    b.innerHTML = `<strong>${t.name}</strong><br><span class="label">${t.desc}</span>`;
    b.onclick = () => { state.selectedTool = t.id; refreshHub(); };
    toolList.appendChild(b);
  }

  // Upgrades
  const upList = document.getElementById('upgrade-list');
  upList.innerHTML = '';
  for (const u of UPGRADES) {
    const owned = !!save.upgrades[u.id];
    const b = document.createElement('button');
    b.className = 'upgrade-btn' + (owned ? ' owned' : '');
    b.innerHTML = `<strong>${u.name}</strong> <span class="cost">${owned ? 'owned' : u.cost + ' seeds'}</span><br><span class="label">${u.desc}</span>`;
    b.disabled = owned;
    b.onclick = () => {
      if (owned) return;
      if (save.seeds < u.cost) return;
      save.seeds -= u.cost;
      save.upgrades[u.id] = true;
      persistSave();
      refreshHub();
    };
    upList.appendChild(b);
  }

  // Audio button
  document.getElementById('mute-btn-hub').textContent = `audio: ${save.audioMuted ? 'off' : 'on'}`;
}

function updateHUD(elapsed = 0) {
  document.getElementById('hud-run').textContent = String(save.runNumber).padStart(2, '0');
  const remaining = Math.max(0, RUN_DURATION_MS - elapsed) / 1000;
  const m = Math.floor(remaining / 60), s = Math.floor(remaining % 60);
  document.getElementById('hud-timer').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  document.getElementById('bar-focus').style.width     = state.attn.focus + '%';
  document.getElementById('bar-curiosity').style.width = state.attn.curiosity + '%';
  document.getElementById('bar-chaos').style.width     = state.attn.chaos + '%';
  document.getElementById('bar-overload').style.width  = state.attn.overload + '%';
  document.getElementById('hud-seeds').textContent = state.seedsThisRun;
  document.getElementById('hud-reentry').textContent = state.reentryCount;
  const tool = TOOLS.find(t => t.id === state.selectedTool);
  document.getElementById('hud-tool').textContent = tool ? tool.name : '—';

  // Vine: ASCII representation of attention shape
  document.getElementById('vine').textContent = makeVine(state.attn);
  document.getElementById('vine').className = 'vine ' + dominantClass(state.attn);

  // Log
  const logEl = document.getElementById('log');
  logEl.innerHTML = state.log.slice(-7).map(l => `<li>${escapeHtml(l)}</li>`).join('');

  // Audio buttons
  document.getElementById('mute-btn-run').textContent = `audio: ${save.audioMuted ? 'off' : 'on'}`;
}

function makeVine(a) {
  // Generate a vine string whose shape changes with attention.
  // High focus → straight, high chaos → jagged, high overload → flat dim,
  // high curiosity → branching with sparkles.
  const len = 22;
  const parts = [];
  for (let i = 0; i < len; i++) {
    const ph = i / len;
    if (a.chaos > 70) parts.push(rand(['/', '\\', '~', 'X', '*']));
    else if (a.overload > 60) parts.push('-');
    else if (a.curiosity > 60) parts.push(rand(['~', '*', '·', '~', 'o']));
    else if (a.focus > 60) parts.push('—');
    else parts.push('~');
  }
  return parts.join('');
}

function dominantClass(a) {
  let best = 'focus', v = -1;
  for (const k of ['focus','curiosity','chaos','overload']) if (a[k] > v) { v = a[k]; best = k; }
  return best;
}

function pushLog(s) {
  state.log.push(s);
  if (state.log.length > 40) state.log.shift();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}

// =================================================================
// 12. BOOT
// =================================================================

function boot() {
  // Default tool: Breathing Anchor
  state.selectedTool = 'breathing';

  document.getElementById('start-run-btn').addEventListener('click', () => startRun());
  document.getElementById('back-to-hub-btn').addEventListener('click', () => switchScreen('hub'));
  document.getElementById('abort-btn').addEventListener('click', () => endRun('aborted'));
  document.getElementById('mute-btn-hub').addEventListener('click', () => {
    audio.setMuted(!save.audioMuted);
    refreshHub();
  });
  document.getElementById('mute-btn-run').addEventListener('click', () => {
    audio.setMuted(!save.audioMuted);
    updateHUD();
  });
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (!confirm('Reset all progress?')) return;
    localStorage.removeItem(SAVE_KEY);
    Object.assign(save, defaultSave());
    refreshHub();
  });

  refreshHub();
  requestAnimationFrame(tick);
}

document.addEventListener('DOMContentLoaded', boot);

})();

/* ================================================================
   NEXT IMPROVEMENTS (post-MVP, easy extension points)
   ----------------------------------------------------------------
   - Replace the templated NPC text in section 9 with a real LLM
     call (small server proxy). Keep the same `runStats` shape;
     the templates already define the variables a prompt would use.
   - Add more maze MODULES: narrow corridor (forced single tile),
     unstable room (wall flips after N seconds), branch/loop
     compositions sourced from a library of hand-authored shapes.
   - Replace the dead-end-based placement in section 3 with a
     module composer that stitches authored chunks into the grid.
   - Track fine-grained behaviour: cursor / mouse movement,
     keyboard bursts, average tile-residency time. Feed into
     attention states with tunable weights.
   - Add second NPC or in-run whispers from "The Garden" when
     specific director events fire.
   - Persist run history (last N runs) in localStorage, show a
     small graph in the hub.
   - Accessibility: remappable keys, motion-reduction toggle that
     disables shake / glitch effects.
   - Mobile / touch controls: virtual joystick pad over canvas.
   - Convert tile constants to a registry of { id, walkable,
     onEnter, render } so new tile types plug in cleanly.
   ================================================================ */
