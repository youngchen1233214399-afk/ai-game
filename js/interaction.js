/* =====================================================================
   interaction.js — Interaction System
   Each scene can register a list of interactables. Every frame we pick
   the closest one within range, show a [E] prompt above the player,
   and fire its callback when E is pressed.
   An interactable is:
     { x, y, radius, label, onActivate(), enabled? }
   ===================================================================== */
(function () {
  const SG = window.SG;

  let interactables = [];
  let active = null;     // currently in-range interactable

  function setInteractables(list) {
    interactables = list || [];
    active = null;
  }

  function clearInteractables() {
    interactables = [];
    active = null;
    hidePrompt();
  }

  function update() {
    if (SG.dialogue.isOpen()) {
      // Don't override prompts during dialogue — dialogue.js handles its own UI
      hidePrompt();
      active = null;
      return;
    }
    const p = SG.state.player;
    let best = null, bestD = Infinity;
    for (const it of interactables) {
      if (it.enabled === false) continue;
      const dx = it.x - p.x, dy = it.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d <= it.radius && d < bestD) { best = it; bestD = d; }
    }
    active = best;
    if (best) showPrompt(best.label);
    else hidePrompt();
  }

  function tryActivate() {
    if (active && active.onActivate) {
      active.onActivate();
    }
  }

  // ----- prompt DOM ----------------------------------------------------
  let promptEl, promptLabel;
  function ensurePromptRefs() {
    if (!promptEl)    promptEl    = document.getElementById('prompt');
    if (!promptLabel) promptLabel = document.getElementById('prompt-label');
  }
  function showPrompt(label) {
    ensurePromptRefs();
    if (!promptEl || !promptLabel) return;
    promptEl.classList.remove('hidden');
    promptLabel.textContent = ' ' + label;
  }
  function hidePrompt() {
    ensurePromptRefs();
    if (promptEl) promptEl.classList.add('hidden');
  }

  SG.interaction = {
    setInteractables, clearInteractables, update, tryActivate,
    get active() { return active; },
    showPrompt, hidePrompt,
  };
})();
