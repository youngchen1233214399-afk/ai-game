# Signal Garden — Prototype

An attention-based roguelite maze game. The garden watches how you move:
your forward motion, your hesitations, your switches, your re-entries.
Those behaviours feed four attention states — **Focus**, **Curiosity**,
**Chaos**, **Overload** — which in turn reshape the maze, the audio, and
the way an in-hub NPC ("The Observer") talks to you.

This is an MVP / playable prototype. It is intentionally minimal in art
direction (neo-noir terminal lines) and focuses on game-feel and the
systemic loop. ADHD-inspired attention model — framed as a system, not as
a diagnosis or a failure.

## Run it

There is no build step, no backend, no dependencies.

Either open `index.html` directly in a modern browser, or serve the folder:

```bash
cd /path/to/this/repo
python3 -m http.server 8000
# then visit http://localhost:8000
```

Audio uses the Web Audio API and starts on the first run (browser
autoplay rules). There is a mute toggle in the hub and during a run.

## Controls

- **WASD** or **arrow keys** — move
- **Space** or **E** — interact with a glowing object
- **R** — use the Re-entry Marker tool (if selected) to teleport back to
  your last stable point on the main route

## Loop

1. **Hub / Safe Room.** Pick a tool. Optionally spend Signal Seeds on a
   permanent upgrade. Read what The Observer says about your last run.
2. **Run.** Explore a maze for ~110 seconds. The garden watches your
   movement and updates the four attention states. The "Attention
   Director" fires adaptive events every few seconds (temptations, hidden
   paths, rest zones, glitches, landmarks) based on your state.
3. **End.** Reach the exit, hit the Chaos or Overload threshold, or run
   out of time. A short reflection appears.
4. **Return.** The next maze is shaped by your last dominant state:
   - chaos prev → more rest zones and landmarks
   - focus prev → more side-path temptations and loops
   - curiosity prev → more glowing objects and hidden paths
   - overload prev → more open / less dense
   - quick exit → bumped complexity

Progress (seeds, owned upgrades, run number, last run) persists in
`localStorage` under the key `signal-garden:v1`.

## File layout

- `index.html` — three screens: hub, run, summary
- `styles.css` — neo-noir dark theme, glowing accents, vine UI
- `game.js` — all logic, organised by system:
  1. Constants & save / progression
  2. Game state
  3. Modular maze generator
  4. Renderer
  5. Input & player movement
  6. Behaviour interpreter (movement → attention)
  7. Attention Director (rule-based AI Director)
  8. Audio Feedback System (Web Audio API tones)
  9. NPC reflection generator (templated, no LLM)
  10. Run lifecycle
  11. UI bindings
  12. Boot

A list of post-MVP improvements is at the bottom of `game.js`.

## Notes on intent

- The four states are not "good" or "bad". Re-entry is treated as
  meaningful, not as failure.
- Stillness is treated as information, not punishment.
- The Observer is short, ambiguous, and quiet. Templates are easy to
  swap for a real LLM call later (the `runStats` object exposes all the
  variables a prompt would need).
