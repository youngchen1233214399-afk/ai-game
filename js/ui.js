/* =====================================================================
   ui.js — DOM bindings for HUD, summary panel, and side controls.
   ===================================================================== */
(function () {
  const SG = window.SG;
  const C = SG.C;

  const els = {};
  function refs() {
    if (els.hud) return;
    els.hud = document.getElementById('hud');
    els.run = document.getElementById('hud-run');
    els.timer = document.getElementById('hud-timer');
    els.bars = {
      focus: document.getElementById('bar-focus'),
      curiosity: document.getElementById('bar-curiosity'),
      chaos: document.getElementById('bar-chaos'),
      overload: document.getElementById('bar-overload'),
    };
    els.seeds = document.getElementById('hud-seeds');
    els.reentry = document.getElementById('hud-reentry');
    els.tool = document.getElementById('hud-tool');
    els.vine = document.getElementById('vine');
    els.log = document.getElementById('log');
    els.muteBtn = document.getElementById('mute-btn');
    els.abortBtn = document.getElementById('abort-btn');
    els.summary = document.getElementById('summary');
    els.summaryBack = document.getElementById('summary-back');
    els.title = document.getElementById('title');
    els.titleBegin = document.getElementById('title-begin');
  }

  function showHud(show) {
    refs();
    els.hud.classList.toggle('hidden', !show);
  }

  function showSummary(show) {
    refs();
    els.summary.classList.toggle('hidden', !show);
  }

  function updateHud(elapsedMs = 0) {
    refs();
    els.run.textContent = String(SG.save.runNumber).padStart(2, '0');
    const remaining = Math.max(0, C.RUN_DURATION_MS - elapsedMs) / 1000;
    const m = Math.floor(remaining / 60), s = Math.floor(remaining % 60);
    els.timer.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    for (const k of ['focus','curiosity','chaos','overload']) {
      els.bars[k].style.width = SG.state.attn[k] + '%';
    }
    els.seeds.textContent = SG.state.seedsThisRun;
    els.reentry.textContent = SG.state.reentryCount;
    const tool = SG.TOOLS.find(t => t.id === SG.save.selectedTool);
    els.tool.textContent = tool ? tool.name : '—';
    els.vine.textContent = makeVine(SG.state.attn);
    els.vine.className = 'vine ' + dominantClass(SG.state.attn);
    els.log.innerHTML = SG.state.log.slice(-7).map(l => `<li>${escapeHtml(l)}</li>`).join('');
    els.muteBtn.textContent = `audio: ${SG.save.audioMuted ? 'off' : 'on'}`;
  }

  function makeVine(a) {
    const len = 22, parts = [];
    for (let i = 0; i < len; i++) {
      if (a.chaos > 70)         parts.push(['/','\\','~','X','*'][(Math.random()*5)|0]);
      else if (a.overload > 60) parts.push('-');
      else if (a.curiosity > 60) parts.push(['~','*','·','o'][(Math.random()*4)|0]);
      else if (a.focus > 60)    parts.push('—');
      else                       parts.push('~');
    }
    return parts.join('');
  }
  function dominantClass(a) {
    let best = 'focus', v = -1;
    for (const k of ['focus','curiosity','chaos','overload']) if (a[k] > v) { v = a[k]; best = k; }
    return best;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

  function bindButtons() {
    refs();
    els.muteBtn.addEventListener('click', () => { SG.audio.setMuted(!SG.save.audioMuted); updateHud(); });
    els.abortBtn.addEventListener('click', () => SG.run.endRun('aborted'));
    els.summaryBack.addEventListener('click', () => {
      showSummary(false);
      SG.scene.fadeTo('hub');
    });
    els.titleBegin.addEventListener('click', () => {
      SG.audio.ensure();
      els.title.classList.add('hidden');
      SG.scene.fadeTo('hub');
    });
  }

  SG.ui = { refs, showHud, showSummary, updateHud, bindButtons };
})();
