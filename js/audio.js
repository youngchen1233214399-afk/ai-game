/* =====================================================================
   audio.js — Audio Feedback System
   Web Audio API only, no asset files.
     - focus    : steady sine drone whose gain rises with Focus
     - curiosity: short triangle ping when collecting a glowing object
     - chaos    : irregular saw pulse, rate scales with Chaos
     - overload : low-pass filter cutoff drops as Overload rises
   ===================================================================== */
(function () {
  const SG = window.SG;

  let ctx = null, master = null, lp = null;
  let focusOsc = null, focusGain = null;
  let chaosOsc = null, chaosGain = null;
  let started = false;

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = SG.save.audioMuted ? 0 : 0.4;
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 16000;
      lp.connect(master);
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  function start() {
    ensure();
    if (!ctx || started) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    started = true;

    focusOsc = ctx.createOscillator();
    focusOsc.type = 'sine';
    focusOsc.frequency.value = 196;
    focusGain = ctx.createGain();
    focusGain.gain.value = 0.0;
    focusOsc.connect(focusGain).connect(lp);
    focusOsc.start();

    chaosOsc = ctx.createOscillator();
    chaosOsc.type = 'sawtooth';
    chaosOsc.frequency.value = 73;
    chaosGain = ctx.createGain();
    chaosGain.gain.value = 0.0;
    chaosOsc.connect(chaosGain).connect(lp);
    chaosOsc.start();
  }

  function stop() {
    if (!started) return;
    started = false;
    try { focusOsc.stop(); chaosOsc.stop(); } catch (e) {}
    focusOsc = chaosOsc = focusGain = chaosGain = null;
  }

  function update(attn) {
    if (!ctx || !started) return;
    focusGain.gain.linearRampToValueAtTime(0.04 + (attn.focus / 100) * 0.10, ctx.currentTime + 0.4);
    const c = attn.chaos / 100;
    chaosGain.gain.cancelScheduledValues(ctx.currentTime);
    if (c > 0.15) {
      const now = ctx.currentTime;
      chaosGain.gain.setValueAtTime(0.04 + c * 0.10, now);
      chaosGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + Math.random() * 0.2);
      chaosOsc.frequency.setValueAtTime(60 + Math.random() * 40 * c, now);
    }
    const o = attn.overload / 100;
    lp.frequency.linearRampToValueAtTime(16000 - o * 14500, ctx.currentTime + 0.4);
  }

  function ping(freq = 880, dur = 0.3, type = 'triangle') {
    ensure(); if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(lp);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function setMuted(m) {
    SG.save.audioMuted = m;
    SG.persist();
    if (master) master.gain.value = m ? 0 : 0.4;
  }

  SG.audio = {
    ensure, start, stop, update,
    curiosityPing: () => ping(880, 0.3, 'triangle'),
    softTone:      () => ping(440, 0.2, 'sine'),
    setMuted,
    get muted() { return SG.save.audioMuted; },
  };
})();
