/* =====================================================================
   constants.js
   Shared, immutable game constants. Attaches to window.SG.
   ===================================================================== */
(function () {
  const SG = (window.SG = window.SG || {});

  SG.C = {
    // Render canvas (logical resolution; scaled to fit viewport)
    CANVAS_W: 960,
    CANVAS_H: 600,

    // Hub world dimensions (no camera scroll — fits the canvas)
    HUB_W: 960,
    HUB_H: 600,

    // Run world is a 3×2 grid of rooms.
    TILE: 32,
    ROOM_TILES_X: 14,        // tiles per room horizontally (incl. shared walls)
    ROOM_TILES_Y: 11,
    ROOMS_X: 3,
    ROOMS_Y: 2,

    // Game pacing
    RUN_DURATION_MS: 110_000,
    DIRECTOR_TICK_MS: 3_000,
    CHAOS_END_THRESH: 100,
    OVER_END_THRESH:  100,

    // Tile codes (run scene grid)
    T_FLOOR:    1,
    T_WALL:     0,
    T_DOOR:     8,           // doorway floor (purely visual marker)
    T_REST:     3,
    T_GLOW:     2,           // glowing flower / signal seed
    T_EXIT:     4,
    T_LANDMARK: 5,
    T_COLUMN:   9,           // decorative column (impassable)
    T_HIDDEN:   7,

    // Player physics
    PLAYER_RADIUS: 9,
    PLAYER_SPEED:  150,      // px/sec
    NPC_TALK_RADIUS: 88,

    // Save key (bumped when shape changes)
    SAVE_KEY: 'signal-garden:v2',
  };

  // Run-time tools (one chosen per run via Observer dialogue)
  SG.TOOLS = [
    { id: 'breathing', name: 'Breathing Anchor',
      desc: 'Chaos rises more slowly.' },
    { id: 'noise',     name: 'Noise Filter',
      desc: 'Overload rises more slowly.' },
    { id: 'curiosity', name: 'Curiosity Lens',
      desc: 'Glowing things give more seeds, but raise Curiosity faster.' },
    { id: 'reentry',   name: 'Re-entry Marker',
      desc: 'Once per run, press R to return to your last stable spot.' },
    { id: 'softfocus', name: 'Soft Focus',
      desc: 'Focus rises faster, but hidden lights are harder to find.' },
  ];

  // Permanent upgrades (paid in Signal Seeds at the Observer)
  SG.UPGRADES = [
    { id: 'lower_chaos', name: 'Calm Soil',
      desc: 'Begin each run with -10 Chaos.', cost: 5 },
    { id: 'rest_boost',  name: 'Deep Roots',
      desc: 'Rest zones are 1.5× more soothing.', cost: 5 },
    { id: 'reveal_exit', name: 'North Star',
      desc: 'Reveal the exit briefly after 60 s.', cost: 10 },
    { id: 'fast_steps',  name: 'Lighter Steps',
      desc: 'Move slightly faster.', cost: 5 },
    { id: 'still_easy',  name: 'Quiet Stillness',
      desc: 'Hesitation raises Overload more slowly.', cost: 5 },
  ];

  // Colour palette for procedural drawing
  SG.PAL = {
    bgDeep:    '#04060a',
    floor:     '#1c2521',
    floorDark: '#141b18',
    floorMoss: '#2d4438',
    wallTop:   '#2d2620',
    wallSide:  '#0e0c08',
    wallEdge:  '#3b342a',
    stone:     '#312820',
    stoneHi:   '#4a4034',
    cloth:     '#1d2c25',
    clothHi:   '#2e4438',
    skin:      '#e2d3b3',
    gold:      '#d6a85a',
    goldDim:   '#8c7440',
    green:     '#6effa8',
    greenDim:  '#4f9a72',
    red:       '#ff5a6a',
    blue:      '#9ad9ff',
    shadow:    'rgba(0,0,0,0.55)',
    text:      '#d6e8d8',
    textDim:   '#88a08a',
  };
})();
