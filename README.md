# Ant / Langton's Ant Lab

A complete, dependency-free JavaScript mini-project using HTML Canvas and vanilla JS.

**Live:** https://adigo112.github.io/langtons-ant/

## Run it locally

Open `index.html` in a modern browser.

No build step, npm install, backend, or API key is required. The Google Fonts import is optional; the page falls back to system fonts if offline.

## Files

- `index.html`: the lab (simulation UI and controls).
- `wiki.html`: history, rules, the three phases, the highway, known results and sources.
- `style.css`: the computation-pad look (green squared paper, ink, red ant) and responsive layout.
- `script.js`: simulation rules, rendering, camera controls, pointer input, telemetry, and animation loop.

## Controls

- **Start / Pause**: run or pause the simulation.
- **Step**: advance one move.
- **Speed slider / presets**: control simulation steps per second.
- **Drag**: pan the camera.
- **Mouse wheel**: zoom toward the pointer.
- **Pinch**: zoom on touchscreens.
- **+ / −**: zoom in or out.
- **Center ant** (◎) or **0**: center the camera on the ant without changing the simulation.
- **Follow ant** (◉) or **L**: keep the camera on the ant; panning by hand turns it off.
- **Pen** (✎) or **P**: click or drag to flip cells; right-drag pans.
- **Undo** (↶) or **Ctrl+Z**: undo the last pen stroke.
- **Fullscreen** (⛶) or **F**: canvas fills the screen with floating, minimizable panels (play and speed live in the toolbar there).
- **Minimap**: shows the whole pattern and your viewport; click to jump.
- **Rule**: pick the classic RL ant or one of 8 variants: 5 more on the square grid (up to 12 colours) and 3 on a hexagonal grid. Switching resets the world.
- **Reset world** or **R**: clear all black cells and return the ant to `(0, 0)`.
- **Space**: play / pause.
- **Right arrow**: advance one step.

## Algorithm

The grid is logically infinite. Only black cells are stored in a JavaScript `Set`; every coordinate not in the set is treated as white. Each step:

1. If the current cell is white, turn right and flip it to black.
2. If the current cell is black, turn left and flip it to white.
3. Move one cell in the new direction.

Direction indices are `0 = north`, `1 = east`, `2 = south`, `3 = west`.

## Notes

- Rendering uses device-pixel-ratio scaling for sharper canvas output.
- Grid lines disappear at low zoom levels to keep the canvas legible.
- Speed slider is logarithmic (1 to 500,000 steps/sec requested; the measured actual rate is shown next to it); simulation work is time-boxed per animation frame to keep the browser responsive.
- The UI is responsive for desktop and mobile.
