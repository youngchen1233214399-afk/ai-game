/* =====================================================================
   main.js — Boot, scene management, game loop, key dispatch
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C  = SG.C;

  // ----- canvas + DPI handling ----------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function fitCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const wCss = canvas.clientWidth, hCss = canvas.clientHeight;
    canvas.width  = Math.floor(wCss * dpr);
    canvas.height = Math.floor(hCss * dpr);
    // Scale the drawing buffer so we always think in CANVAS_W × CANVAS_H units
    const sx = canvas.width  / C.CANVAS_W;
    const sy = canvas.height / C.CANVAS_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);

  // ----- scene management ---------------------------------------------
  const scene = (SG.scene = {
    current: 'title',
    fadeTo(name) {
      const fade = document.getElementById('fade');
      fade.classList.add('show');
      setTimeout(() => {
        scene.current = name;
        SG.state.scene = name;
        if (name === 'hub') {
          SG.hub.build();
          SG.ui.showHud(false);
          SG.ui.showSummary(false);
        } else if (name === 'run') {
          // run.startRun already set up the world before fadeTo
        }
        fade.classList.remove('show');
      }, 240);
    },
  });

  // ----- key handling --------------------------------------------------
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();

    // Dialogue eats most keys when open
    if (SG.dialogue.handleKey(k)) return;

    SG.player.keys.add(k);

    if (k === 'e') {
      if (scene.current === 'hub') SG.interaction.tryActivate();
    }
    if (k === 'r' && scene.current === 'run') SG.run.tryReentryMarker();
    if (k === 'escape' && scene.current === 'run') {
      // pause via abort? prefer not to add a pause for this prototype
    }
  });
  addEventListener('keyup', (e) => SG.player.keys.delete(e.key.toLowerCase()));

  // ----- game loop -----------------------------------------------------
  let lastT = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000);
    lastT = now;

    // clear
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);

    if (scene.current === 'hub') {
      SG.hub.update(dt, now);
      SG.hub.render(ctx, now, dt);
    } else if (scene.current === 'run') {
      SG.run.update(dt, now);
      SG.run.render(ctx, now, dt);
    } else if (scene.current === 'summary') {
      // Keep last run frame visible; nothing to update
      SG.run.render(ctx, now, dt);
    }

    requestAnimationFrame(loop);
  }

  // ----- boot ----------------------------------------------------------
  function boot() {
    fitCanvas();
    SG.ui.bindButtons();
    // Wire mute button label initial value
    SG.ui.refs();
    document.getElementById('mute-btn').textContent = `audio: ${SG.save.audioMuted ? 'off' : 'on'}`;
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ================================================================
   NEXT IMPROVEMENTS (post-MVP)
   ----------------------------------------------------------------
   - Replace the templated Observer text in summary.js with a real
     LLM call. The runStats object exposes every variable a prompt
     would need.
   - More authored hub props: bookcases, tapestries, a mirror that
     shows attention as colour tints.
   - Multi-room hub with a corridor leading to the portal (camera
     follow in hub instead of fixed).
   - Pre-rendered art layers (offscreen canvas) for the hub floor +
     walls so we don't redraw the whole floor every frame.
   - Modular run rooms loaded from a small data file: each room
     module lists prop placements + glow positions.
   - Touch / virtual joystick controls for mobile.
   - Replace the procedural character sprites with hand-drawn ones
     when the prototype is ready for art polish.
   ================================================================ */
