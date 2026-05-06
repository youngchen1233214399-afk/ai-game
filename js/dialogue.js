/* =====================================================================
   dialogue.js — NPC Dialogue System
   A small modal at the bottom of the screen. Each dialogue node has:
     {
       speaker: 'The Observer',
       text: 'string',
       options: [
         { text: '...', onChoose: () => nextNode | null, disabled?, owned?, cost? }
       ]
     }
   - E or click → "continue" if no options, or the focused option
   - 1..9 → pick option
   - Esc → close
   ===================================================================== */
(function () {
  const SG = window.SG;

  let open = false;
  let currentNode = null;
  let onCloseCb = null;
  let focusIdx = 0;

  let elBox, elName, elText, elOptions;
  function ensureRefs() {
    if (elBox) return;
    elBox     = document.getElementById('dialogue');
    elName    = document.getElementById('dialogue-name');
    elText    = document.getElementById('dialogue-text');
    elOptions = document.getElementById('dialogue-options');
  }

  function show(node, onClose) {
    ensureRefs();
    open = true;
    onCloseCb = onClose || null;
    setNode(node);
    elBox.classList.remove('hidden');
  }

  function close() {
    if (!open) return;
    ensureRefs();
    elBox.classList.add('hidden');
    open = false;
    currentNode = null;
    const cb = onCloseCb; onCloseCb = null;
    if (cb) cb();
  }

  function setNode(node) {
    currentNode = node;
    focusIdx = 0;
    if (!node) { close(); return; }
    elName.textContent = node.speaker || '';
    elText.textContent = node.text || '';
    elOptions.innerHTML = '';
    if (node.options && node.options.length) {
      node.options.forEach((opt, i) => {
        const b = document.createElement('button');
        if (opt.owned) b.classList.add('owned');
        b.disabled = !!opt.disabled;
        const numHtml = `<span class="num">${i + 1}</span>`;
        const costHtml = opt.cost != null ? `<span class="cost">${opt.cost}</span>` : '';
        b.innerHTML = numHtml + escapeHtml(opt.text) + costHtml;
        if (i === 0) b.classList.add('focus');
        b.addEventListener('click', () => choose(i));
        elOptions.appendChild(b);
      });
    } else {
      // No options means "press E to continue / close"
      const b = document.createElement('button');
      b.classList.add('focus');
      b.innerHTML = `<span class="num">E</span>continue`;
      b.addEventListener('click', () => close());
      elOptions.appendChild(b);
    }
  }

  function choose(i) {
    if (!currentNode) return;
    const opts = currentNode.options;
    if (!opts || !opts.length) { close(); return; }
    if (i < 0 || i >= opts.length) return;
    const opt = opts[i];
    if (opt.disabled) return;
    const next = opt.onChoose ? opt.onChoose() : null;
    if (next) setNode(next);
    else close();
  }

  function focusNext(d) {
    if (!currentNode || !currentNode.options) return;
    const buttons = elOptions.querySelectorAll('button');
    if (!buttons.length) return;
    buttons[focusIdx]?.classList.remove('focus');
    focusIdx = (focusIdx + d + buttons.length) % buttons.length;
    buttons[focusIdx]?.classList.add('focus');
  }

  function activateFocus() {
    if (!currentNode) { close(); return; }
    const opts = currentNode.options;
    if (!opts || !opts.length) { close(); return; }
    choose(focusIdx);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  // Keyboard handler invoked from main.js
  function handleKey(k) {
    if (!open) return false;
    if (k === 'escape') { close(); return true; }
    if (k === 'e' || k === ' ' || k === 'enter') { activateFocus(); return true; }
    if (k === 'arrowup' || k === 'w') { focusNext(-1); return true; }
    if (k === 'arrowdown' || k === 's') { focusNext(+1); return true; }
    if (/^[1-9]$/.test(k)) { choose(parseInt(k, 10) - 1); return true; }
    return false;
  }

  SG.dialogue = {
    show, close, setNode, handleKey,
    isOpen: () => open,
  };
})();
