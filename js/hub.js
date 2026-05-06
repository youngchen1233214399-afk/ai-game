/* =====================================================================
   hub.js — Hub Scene
   A single fixed-camera screen depicting a dark fantasy garden hall.
   Contents:
     - Walled stone room (HUB_W × HUB_H)
     - 4 stone columns
     - Glowing plants in corners
     - The Observer (NPC, original design) standing at left
     - The Portal (ritual gate) at right — E to start a run
   The player walks around with WASD; pressing E near interactables
   either starts a run or opens The Observer's dialogue (which is
   where tools and upgrades live).
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C  = SG.C;
  const A  = SG.art;
  const PAL = SG.PAL;

  let world = null;

  function build() {
    const W = C.HUB_W, H = C.HUB_H;
    const wallT = 32;                              // wall thickness
    const walls = [
      { x: 0, y: 0, w: W, h: wallT },              // top
      { x: 0, y: H - wallT, w: W, h: wallT },      // bottom
      { x: 0, y: 0, w: wallT, h: H },              // left
      { x: W - wallT, y: 0, w: wallT, h: H },      // right
    ];

    const observerPos = { x: 250, y: 360 };
    const portalPos   = { x: 720, y: 320 };

    // Decorative columns (impassable). 4 corners in a grand-hall layout.
    const columns = [
      { x: 220, y: 180 },
      { x: 480, y: 180 },
      { x: 740, y: 180 },
      { x: 220, y: 480 },
      { x: 480, y: 480 },
      { x: 740, y: 480 },
    ];
    for (const c of columns) {
      walls.push({ x: c.x - 12, y: c.y - 6, w: 24, h: 14 });
    }

    // Glowing plants in corners and along walls
    const plants = [
      { x:  90, y: 150, color: 'rgba(110,255,168,1)' },
      { x:  90, y: 530, color: 'rgba(110,255,168,1)' },
      { x: 870, y: 150, color: 'rgba(214,168,90,1)' },
      { x: 870, y: 530, color: 'rgba(214,168,90,1)' },
      { x: 480, y: 540, color: 'rgba(154,217,255,1)' },
    ];

    // Player spawn — center-bottom
    SG.player.spawn(480, 470, 'up');

    // Particle field
    SG.art.spawnParticles(60, W, H);

    world = {
      W, H, walls,
      observerPos, portalPos,
      columns, plants,
      bg: { ringT: 0 },
    };
    SG.state.world = world;

    // Register interactables
    SG.interaction.setInteractables([
      {
        x: observerPos.x, y: observerPos.y - 24,
        radius: C.NPC_TALK_RADIUS, label: 'speak with The Observer',
        onActivate: openObserverDialogue,
      },
      {
        x: portalPos.x, y: portalPos.y - 30,
        radius: C.NPC_TALK_RADIUS, label: 'enter the portal',
        onActivate: () => SG.run.startRun(),
      },
    ]);
  }

  // ----- Observer dialogue ---------------------------------------------
  // The Observer is the NPC and the meta-progression hub. Three options:
  //   1. "How was my last run?" → reflects last run
  //   2. "Choose a tool"         → tool sub-menu
  //   3. "Spend my Signal Seeds" → upgrade sub-menu
  //   4. "Leave"
  function openObserverDialogue() {
    SG.audio.ensure();
    SG.audio.softTone();
    SG.dialogue.show(buildRootNode());
  }

  function buildRootNode() {
    const greet = SG.summary.pickObserverLine(SG.save.lastRun);
    return {
      speaker: 'The Observer',
      text: greet,
      options: [
        { text: 'How was my last run?',  onChoose: () => buildReflectNode() },
        { text: 'Choose a tool',         onChoose: () => buildToolsNode() },
        { text: 'Spend Signal Seeds',    onChoose: () => buildUpgradesNode() },
        { text: 'Step away',             onChoose: () => null },
      ],
    };
  }

  function buildReflectNode() {
    if (!SG.save.lastRun) {
      return {
        speaker: 'The Observer',
        text: 'You have not yet entered. The garden is empty of memory.',
        options: [{ text: 'Back', onChoose: () => buildRootNode() }],
      };
    }
    const text = SG.summary.buildReflection(SG.save.lastRun);
    return {
      speaker: 'The Observer',
      text,
      options: [{ text: 'Back', onChoose: () => buildRootNode() }],
    };
  }

  function buildToolsNode() {
    return {
      speaker: 'The Observer',
      text: 'Each run begins with one held shape. Choose what you carry.',
      options: SG.TOOLS.map(t => ({
        text: (SG.save.selectedTool === t.id ? '◉ ' : '○ ') + t.name + ' — ' + t.desc,
        onChoose: () => {
          SG.save.selectedTool = t.id;
          SG.persist();
          return buildToolsNode();
        },
      })).concat([{ text: 'Back', onChoose: () => buildRootNode() }]),
    };
  }

  function buildUpgradesNode() {
    return {
      speaker: 'The Observer',
      text: `You hold ${SG.save.seeds} signal seed${SG.save.seeds === 1 ? '' : 's'}. The garden grows what you plant in it.`,
      options: SG.UPGRADES.map(u => {
        const owned = !!SG.save.upgrades[u.id];
        const can = !owned && SG.save.seeds >= u.cost;
        return {
          text: (owned ? '✓ ' : '') + u.name + ' — ' + u.desc,
          cost: owned ? 'owned' : u.cost,
          owned, disabled: owned || !can,
          onChoose: () => {
            if (owned || SG.save.seeds < u.cost) return buildUpgradesNode();
            SG.save.seeds -= u.cost;
            SG.save.upgrades[u.id] = true;
            SG.persist();
            return buildUpgradesNode();
          },
        };
      }).concat([{ text: 'Back', onChoose: () => buildRootNode() }]),
    };
  }

  // ----- per-frame update / render ------------------------------------
  function update(dt, now) {
    if (SG.dialogue.isOpen()) return;
    SG.player.update(dt, world.walls);
    SG.interaction.update();
  }

  function render(ctx, now, dt) {
    const W = world.W, H = world.H;

    // floor
    ctx.fillStyle = PAL.bgDeep;
    ctx.fillRect(0, 0, W, H);
    A.drawFloor(ctx, 0, 0, W, H, 100);

    // central ritual ring on floor (concentric circles)
    ctx.save();
    ctx.translate(W / 2, H / 2);
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(110,255,168,${0.05 + 0.06 * i})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 200 - i * 50, 90 - i * 22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // gold runic dashes around outer ring
    ctx.strokeStyle = 'rgba(214,168,90,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 14]);
    ctx.beginPath();
    ctx.ellipse(0, 0, 220, 100, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // walls
    for (const w of world.walls) {
      // skip column AABBs (drawn as columns separately)
      if (w.w === 24 && w.h === 14) continue;
      A.drawWall(ctx, w.x, w.y, w.w, w.h);
    }

    // sort drawables by y (painter's algorithm) — columns, plants, NPC,
    // portal, player all drawn in y-order so closer ones overlap.
    const draws = [];
    for (const c of world.columns) draws.push({ y: c.y + 4, draw: () => A.drawColumn(ctx, c.x, c.y, now) });
    for (const p of world.plants)  draws.push({ y: p.y + 2, draw: () => A.drawGlowPlant(ctx, p.x, p.y, now, p.color) });
    draws.push({ y: world.observerPos.y + 4, draw: () => A.drawObserver(ctx, world.observerPos.x, world.observerPos.y, now) });
    draws.push({ y: world.portalPos.y + 4,   draw: () => A.drawGate(ctx, world.portalPos.x, world.portalPos.y, now, 'rgba(110,255,168,1)') });
    draws.push({ y: SG.state.player.y + 2,   draw: () => A.drawPlayer(ctx, SG.state.player, now) });
    draws.sort((a, b) => a.y - b.y);
    for (const d of draws) d.draw();

    // ambient particles
    A.drawParticles(ctx, dt * 1000, W, H, 'rgba(110,255,168,');

    // soft vignette
    A.drawVignette(ctx, W, H, 0.55);
  }

  SG.hub = { build, update, render };
})();
