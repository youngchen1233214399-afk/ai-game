/* =====================================================================
   attention.js — Attention State Manager
   Two responsibilities:
     1. Behaviour Interpreter — every frame, read input + position +
        events and update Focus / Curiosity / Chaos / Overload / Re-entry.
     2. Attention Director — every few seconds, evaluate state and fire
        adaptive events (spawn temptation, reveal hidden, glitch, open
        rest zone, drop landmark, end run on threshold).
   The run scene calls initRun(), then update() each frame, then
   finalize() at the end to compute the dominant state.
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C  = SG.C;

  function initRun(world) {
    SG.state.attn = { focus: 0, curiosity: 0, chaos: 0, overload: 0 };
    SG.state.attnPeak = { focus: 0, curiosity: 0, chaos: 0, overload: 0 };
    SG.state.reentryCount = 0;
    SG.state.seedsThisRun = 0;
    SG.state.reentryUsed = false;
    SG.state.lastStablePoint = { x: SG.state.player.x, y: SG.state.player.y };
    SG.state.bh = {
      stillTime: 0,
      moveTime: 0,
      dirHistory: [],
      lastSwitchT: 0,
      onMainRoute: true,
      leftRouteAt: 0,
      visitedRooms: new Map(),
      lastRoom: null,
      triggerLog: {},
    };

    // Permanent upgrade: lower starting Chaos
    if (SG.save.upgrades.lower_chaos) SG.state.attn.chaos = Math.max(0, SG.state.attn.chaos - 10);
  }

  // ----- bump with tool / upgrade modifiers ----------------------------
  function bump(name, amount, trigger) {
    const tool = SG.save.selectedTool;
    if (name === 'chaos'     && tool === 'breathing') amount *= 0.5;
    if (name === 'overload'  && tool === 'noise')     amount *= 0.5;
    if (name === 'curiosity' && tool === 'curiosity') amount *= 1.5;
    if (name === 'focus'     && tool === 'softfocus') amount *= 1.5;
    if (name === 'overload' && SG.save.upgrades.still_easy && trigger === 'hesitation') amount *= 0.6;
    SG.state.attn[name] = Math.max(0, Math.min(100, SG.state.attn[name] + amount));
    if (amount > 0 && trigger) SG.state.bh.triggerLog[name] = trigger;
  }

  // ----- main per-frame update ----------------------------------------
  function update(dt, now, world) {
    const [ix, iy] = SG.player.getInputVector();
    const moving = ix !== 0 || iy !== 0;
    const bh = SG.state.bh;
    const dtMs = dt * 1000;

    // hesitation → Overload
    if (!moving) {
      bh.stillTime += dtMs; bh.moveTime = 0;
      if (bh.stillTime > 1200) bump('overload', 0.10 * (dtMs / 16.67), 'hesitation');
    } else {
      bh.stillTime = 0; bh.moveTime += dtMs;
    }

    // forward-stable → Focus / sharp switch → Chaos
    if (moving) {
      const ang = Math.atan2(iy, ix);
      const last = bh.dirHistory[bh.dirHistory.length - 1];
      let stable = true;
      if (last) {
        let diff = Math.abs(ang - last.a);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff > Math.PI * 0.6) stable = false;
      }
      if (stable && bh.moveTime > 800) bump('focus', 0.06 * (dtMs / 16.67), 'forward movement');
      if (!stable) {
        const since = now - bh.lastSwitchT;
        bh.lastSwitchT = now;
        if (since < 350)      bump('chaos', 4.0, 'rapid back-and-forth');
        else if (since < 900) bump('chaos', 1.6, 'frequent direction changes');
        bh.moveTime = 0;
      }
      bh.dirHistory.push({ a: ang, t: now });
      if (bh.dirHistory.length > 12) bh.dirHistory.shift();
    }

    // rest zone → reduce
    if (world.isOnRest && world.isOnRest(SG.state.player.x, SG.state.player.y)) {
      const mult = SG.save.upgrades.rest_boost ? 1.5 : 1;
      bump('overload', -0.18 * (dtMs / 16.67) * mult, 'rest zone');
      bump('chaos',    -0.10 * (dtMs / 16.67) * mult, 'rest zone');
    }

    // re-entry: leaving and returning to main route
    if (world.isOnMainRoute) {
      const onMain = world.isOnMainRoute(SG.state.player.x, SG.state.player.y);
      if (bh.onMainRoute && !onMain) { bh.onMainRoute = false; bh.leftRouteAt = now; }
      else if (!bh.onMainRoute && onMain) {
        bh.onMainRoute = true;
        if (now - bh.leftRouteAt > 2500) {
          SG.state.reentryCount++;
          bump('focus', 4, 're-entry');
          SG.pushLog('re-entry: returned to main route');
        }
      }
      if (onMain) SG.state.lastStablePoint = { x: SG.state.player.x, y: SG.state.player.y };
    }

    // looping detection per-room
    if (world.roomAt) {
      const r = world.roomAt(SG.state.player.x, SG.state.player.y);
      if (r && r !== bh.lastRoom) {
        bh.lastRoom = r;
        bh.visitedRooms.set(r, (bh.visitedRooms.get(r) || 0) + 1);
      }
    }

    // ignored distractions
    if (world.glowObjects) {
      const px = SG.state.player.x, py = SG.state.player.y;
      for (const obj of world.glowObjects) {
        if (obj.taken) continue;
        const d = Math.hypot(obj.x - px, obj.y - py);
        if (d < 150) obj.seenT = (obj.seenT || 0) + dtMs;
        if (obj.seenT > 6000 && !obj._rewardedIgnore) {
          obj._rewardedIgnore = true;
          bump('focus', 5, 'ignored a distraction');
          SG.pushLog('you let one signal pass');
        }
      }
    }

    // peaks
    for (const k of ['focus','curiosity','chaos','overload']) {
      if (SG.state.attn[k] > SG.state.attnPeak[k]) SG.state.attnPeak[k] = SG.state.attn[k];
    }

    SG.audio.update(SG.state.attn);
  }

  // ----- director ------------------------------------------------------
  function directorTick(now, world) {
    const d = SG.state.director;
    if (now - d.lastTick < C.DIRECTOR_TICK_MS) return;
    d.lastTick = now;
    const a = SG.state.attn;

    if (a.chaos >= C.CHAOS_END_THRESH - 5) {
      banner('the garden is rebuilding…', 'chaos', 1200);
      setTimeout(() => SG.run && SG.run.endRun('chaos'), 800);
      return;
    }
    if (a.overload >= C.OVER_END_THRESH - 5) {
      banner('signal too loud — fade', 'chaos', 1200);
      setTimeout(() => SG.run && SG.run.endRun('overload'), 800);
      return;
    }
    if (a.focus > 70 && world.spawnTemptation && world.spawnTemptation()) {
      banner('a temptation glows nearby', 'curiosity'); return;
    }
    if (a.curiosity > 70 && world.revealHidden && world.revealHidden()) {
      banner('a hidden path opens', 'curiosity'); return;
    }
    if (a.chaos > 70) {
      banner('the garden is shaking', 'chaos');
      d.glitchUntil = now + 2400;
      document.getElementById('app').classList.add('glitch');
      setTimeout(() => document.getElementById('app').classList.remove('glitch'), 2400);
      return;
    }
    if (a.overload > 70 && world.openRest && world.openRest()) {
      banner('a quiet patch opens', 'rest'); return;
    }
    // Looping → drop landmark
    for (const [room, n] of SG.state.bh.visitedRooms) {
      if (n >= 4 && world.placeLandmark) {
        if (world.placeLandmark(room)) {
          banner('a landmark appears', 'rest');
          SG.state.bh.visitedRooms.set(room, 0);
          return;
        }
      }
    }
  }

  function banner(text, kind, dur = 3500) {
    const el = document.getElementById('director-banner');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('chaos', kind === 'chaos');
    el.classList.remove('hidden');
    SG.pushLog('[director] ' + text);
    clearTimeout(banner._t);
    banner._t = setTimeout(() => el.classList.add('hidden'), dur);
  }

  // ----- finalise: compute dominant for run summary --------------------
  function finalize(reason) {
    const a = SG.state.attn;
    let dominant = 'focus', best = -Infinity;
    for (const k of ['focus','curiosity','chaos','overload']) {
      if (a[k] > best) { best = a[k]; dominant = k; }
    }
    if (SG.state.reentryCount >= 3 && best < 60) dominant = 'reentry';

    const trigger = SG.state.bh.triggerLog[dominant] || ({
      focus: 'forward movement',
      curiosity: 'glowing side objects',
      chaos: 'rapid direction changes',
      overload: 'long hesitation',
      reentry: 're-entry',
    })[dominant];

    return {
      runNumber: SG.save.runNumber,
      dominant,
      mainTrigger: trigger,
      seeds: SG.state.seedsThisRun,
      outcome: reason,
      reentry: SG.state.reentryCount,
      attnPeak: { ...SG.state.attnPeak },
      timeMs: SG.now() - SG.state.runStartT,
    };
  }

  SG.attention = { initRun, update, directorTick, finalize, bump, banner };
})();
