# Signal Garden

A 2.5D top-down attention-based roguelite. The system watches how you
move — your rhythm, hesitations, switches, returns — and translates
that into four attention states: **Focus, Curiosity, Chaos, Overload**.
Those states reshape the next maze, the audio, and what The Observer
says when you return to the hub.

ADHD-inspired attention model, framed as a system that watches and
adapts, not as failure or diagnosis. Original world, characters, and art
direction.

## Run it

No build step, no backend, no external assets. Either open `index.html`
in a modern browser, or serve the folder:

```bash
cd /path/to/this/repo
python3 -m http.server 8000
# then visit http://localhost:8000
```

If you want audio, the page must be served over HTTP rather than
opened with `file://` in some browsers, because of `AudioContext`
gesture rules. Audio starts on first click.

## Controls

| Key                              | Action                          |
|----------------------------------|---------------------------------|
| WASD or arrow keys               | move                            |
| E                                | interact (hub) · dialogue advance |
| 1-9                              | dialogue option pick            |
| Esc                              | leave dialogue                  |
| R                                | use Re-entry Marker (if held)   |

## Loop

1. **Hub.** A dark fantasy garden hall: stone columns, glowing plants,
   a central ritual ring, ambient dust, soft vignette. Walk around with
   WASD. Two interactables:
   - **The Observer** — hooded NPC. Press E to open a dialogue. Asks
     after your last run, lets you pick a run-time tool, lets you spend
     Signal Seeds on permanent upgrades.
   - **The Portal** — the green ritual gate. Press E to begin a run.
2. **Run.** A 3×2 grid of rooms connected by doorways, generated from
   modules (rest fountain, glowing flower, decorative column, etc.).
   Camera follows the player. The HUD shows attention bars, timer,
   tool, vine, system log. The Attention Director ticks every few
   seconds and fires events (temptations, hidden paths, glitches, rest
   patches, landmarks, run-end thresholds) based on your state.
3. **End.** Reach the exit gate, hit Chaos or Overload threshold, or
   run out of time. A reflection appears.
4. **Return.** The next maze is shaped by your last dominant state:
   - chaos prev → more rest zones and landmarks
   - focus prev → more side-path temptations
   - curiosity prev → more glowing flowers and hidden paths
   - overload prev → more open layout
   - exited fast → bumped complexity

Progress (seeds, owned upgrades, run number, last run, selected tool,
mute) persists in `localStorage` under the key `signal-garden:v2`.

## File layout (refactored modules)

| File                | System                                          |
|---------------------|-------------------------------------------------|
| `index.html`        | DOM layout, script load order                   |
| `styles.css`        | Theme, HUD, dialogue, summary, title overlays   |
| `js/constants.js`   | tile codes, dimensions, tools, upgrades, palette|
| `js/state.js`       | save (localStorage) + runtime state             |
| `js/audio.js`       | Web Audio API drone + ping + lowpass            |
| `js/art.js`         | procedural drawing primitives (player, NPC, walls, columns, plants, fountain, gate, particles, vignette) |
| **`js/player.js`**  | **Player Controller** — input, movement, AABB collision |
| **`js/interaction.js`** | **Interaction System** — proximity prompts + E |
| **`js/dialogue.js`**| **NPC Dialogue System** — modal, options, keyboard nav |
| **`js/attention.js`** | **Attention State Manager** — interpreter + director |
| **`js/hub.js`**     | **Hub Scene** — garden hall, NPC, portal, render loop |
| **`js/run.js`**     | **Run Scene** — room-graph maze, render loop, run lifecycle |
| **`js/summary.js`** | **Run Summary Generator** — templated reflection + observer lines |
| `js/ui.js`          | HUD bindings, summary overlay, title button     |
| `js/main.js`        | boot, scene switching, game loop, key dispatch  |

The seven systems the spec asked for are bolded.

## Notes on intent

- Re-entry is treated as meaningful, not as failure.
- Stillness is treated as information. Overload is a tone, not a punishment.
- The Observer is short, ambiguous, quiet. The summary templates are
  swappable for a real LLM call later — the `runStats` object exposes
  every variable a prompt would need.
- All visuals are procedural canvas drawing. No game's characters,
  names, mythology, UI, or assets are reproduced.
