/* =====================================================================
   state.js
   Two things:
     1. SG.save — persistent progression (localStorage)
     2. SG.state — runtime, ephemeral state (current scene, attention,
        log, etc.). Reset across runs as needed.
   ===================================================================== */
(function () {
  const SG = window.SG;

  // -------- save --------------------------------------------------------
  const KEY = SG.C.SAVE_KEY;
  const defaultSave = () => ({
    seeds: 0,
    runNumber: 0,
    upgrades: {},          // { id: true }
    lastRun: null,
    selectedTool: 'breathing',
    audioMuted: false,
  });
  function loadSave() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultSave();
      return Object.assign(defaultSave(), JSON.parse(raw));
    } catch (e) { return defaultSave(); }
  }
  const save = loadSave();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} };
  const reset   = () => { Object.assign(save, defaultSave()); persist(); };

  SG.save = save;
  SG.persist = persist;
  SG.resetSave = reset;
  SG.defaultSave = defaultSave;

  // -------- runtime state ----------------------------------------------
  // Filled in by hub.js / run.js when scenes start.
  SG.state = {
    scene: 'title',                  // 'title' | 'hub' | 'run' | 'summary'
    world: null,                     // current scene's world model

    // Player (shared across scenes)
    player: {
      x: 0, y: 0,
      vx: 0, vy: 0,
      r: SG.C.PLAYER_RADIUS,
      facing: 'down',                // 'up'|'down'|'left'|'right'
      animPhase: 0,                  // walk cycle phase
      moving: false,
    },

    // Attention
    attn: { focus: 0, curiosity: 0, chaos: 0, overload: 0 },
    attnPeak: { focus: 0, curiosity: 0, chaos: 0, overload: 0 },
    reentryCount: 0,
    seedsThisRun: 0,
    reentryUsed: false,
    lastStablePoint: null,           // {x,y} world coords

    // Behaviour interpreter scratch
    bh: null,                        // initialised by attention.js when run starts

    // Director
    director: { lastTick: 0, banner: null, bannerUntil: 0, glitchUntil: 0 },

    // Run timing
    runStartT: 0,
    runActive: false,
    runEndReason: null,

    // Log
    log: [],

    // Camera (run scene)
    cam: { x: 0, y: 0 },
  };

  // -------- helpers -----------------------------------------------------
  SG.pushLog = function (msg) {
    SG.state.log.push(msg);
    if (SG.state.log.length > 30) SG.state.log.shift();
  };

  SG.now = () => performance.now();
})();
