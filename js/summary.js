/* =====================================================================
   summary.js — Run Summary Generator + Observer Reflection Generator
   Templated, no LLM call. The runStats object exposes every variable a
   real LLM prompt would need, so swapping these generators for a
   model-driven version later is trivial.
   ===================================================================== */
(function () {
  const SG = window.SG;

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

  function rand(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function pickObserverLine(lastRun) {
    if (!lastRun) return rand(OBSERVER_LINES.none);
    if (lastRun.reentry >= 3) return rand(OBSERVER_LINES.reentry);
    return rand(OBSERVER_LINES[lastRun.dominant] || OBSERVER_LINES.none);
  }

  function buildReflection(stats) {
    const { runNumber, dominant, mainTrigger, seeds, outcome, reentry, attnPeak } = stats;
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
      if (attnPeak && attnPeak.curiosity > 70 && attnPeak.chaos > 60 && dominant === 'chaos') return 'Curiosity → Chaos';
      if (attnPeak && attnPeak.focus     > 70 && attnPeak.chaos > 60 && dominant === 'chaos') return 'Focus → Chaos';
      return niceName(dominant);
    })();

    return [
      `Run ${String(runNumber).padStart(2, '0')} Summary:`,
      `Dominant State: ${dominantLabel}`,
      `Main Trigger: ${mainTrigger || '—'}`,
      `Signal Seeds Collected: ${seeds}`,
      `Outcome: ${outcomeLabel}`,
      `Reflection: ${REFLECTION_LINES[dominant] || REFLECTION_LINES.focus}`,
      `Suggested Tool: ${SUGGESTED_TOOL[dominant] || 'Breathing Anchor'}`,
    ].join('\n');
  }

  function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : '—'; }

  SG.summary = { pickObserverLine, buildReflection };
})();
