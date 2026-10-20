# Ant Lab: Langton's ant and 8 variants

A browser simulator for [Langton's ant](https://en.wikipedia.org/wiki/Langton%27s_ant) and eight multi-colour variants on square and hexagonal grids, with a wiki explaining each one. Plain HTML, CSS and JavaScript on a canvas: no framework, no build step, no dependencies.

**Live:** [adigo112.github.io/langtons-ant](https://adigo112.github.io/langtons-ant/) · [wiki](https://adigo112.github.io/langtons-ant/wiki.html)

- Runs up to 500,000 steps per second while staying at 60 fps on patterns of 600,000+ cells.
- Zooms from single cells out to the whole pattern without losing thin structures like the highway.
- 9 rules: the classic `RL`, five more square-grid rules with up to 12 colours, and three hexagonal-grid rules.
- Pen tool with undo, a follow camera, a minimap and fullscreen mode.
- Every rule is checked cell by cell against an independent reference implementation (`npm test`).

## Run it

Open `index.html` in a browser. To run the tests (Node 18+ and Chrome or Edge installed):

```sh
npm test
```

## Files

| File | What it is |
| --- | --- |
| `index.html`, `style.css` | The lab page and the shared stylesheet |
| `script.js` | Simulation, rendering, camera, input and UI, in one file |
| `wiki.html` | History, rules, proofs and a card for each ant, with live pictures |
| `tests/run.js` | Test runner: wiki facts in Node, then the real page in headless Chrome |
| `tests/reference.js` | Independent reference implementation of every rule |
| `tests/app.test.js`, `tests/follow.test.js` | Tests that run inside the page |

## Controls

| Action | How |
| --- | --- |
| Play / pause, one step | Space, → (or the buttons) |
| Speed | Slider or presets, 1 to 500,000 steps/s |
| Pan, zoom | Drag, mouse wheel, pinch, + / − |
| Center on ant, follow ant | 0, L (the ≈ button toggles smooth follow) |
| Pen, undo | P, then click or drag to change cells; right-drag pans; Ctrl+Z |
| Fullscreen | F (panels float over the grid and can be minimised) |
| Rule | Rule dropdown (switching resets the world) |
| Reset | R |

## Engineering notes

### The rules as data

Each cell stores a colour number. A rule is a list of turns, one per colour (`RL` = right on colour 0, left on colour 1). A step is: turn by the current cell's entry, move the cell on to the next colour, step forward. On the square grid a turn is ±1 of 4 directions. On the hex grid it is 0–5 of 6 (`N`, `L1`, `L2`, `U`, `R2`, `R1`). The same loop runs all nine rules.

### Storage: byte tiles instead of a set of strings

The first version kept black cells in a `Set` of `"x,y"` strings. After 5 million steps that is 576,486 strings, and every frame parsed all of them twice, once for the main view and once for the minimap. One pass took 48 ms, so frames took about 100 ms and the frame rate collapsed as the pattern grew.

The grid is now a `Map` of 256 × 256 `Uint8Array` tiles, created only where the ant has been. A cell lookup is a shift and a mask, and the ant's current tile is cached, so most steps never touch the `Map`. Coordinates are limited to ±2³¹ by the bit operations, which is hours of max-speed highway away.

| After 5 million steps | Before | After |
| --- | --- | --- |
| 5 million steps | ~0.8 s (Node) | 88 ms (Chrome) |
| Frame at 500,000 steps/s (8,333 steps + draw) | ~100 ms | median 0.5–0.7 ms, worst 2.5 ms |

### Rendering: cost follows the screen, not the pattern

Each frame copies only the visible cells into one reusable `ImageData`, at most one buffer pixel per screen pixel, and draws it with a single `drawImage`. When zoomed out, a buffer pixel covers 2ⁿ × 2ⁿ cells. Its colour comes from a per-tile level-of-detail pyramid that keeps the **highest** colour in each block rather than averaging, so a 1-cell-wide highway stays visible at any zoom. Pyramid levels are rebuilt only for tiles that changed, so in practice only the tile the ant is on. The minimap uses the same path at about 5 fps.

The first tile renderer gave every tile its own canvas. With about 1,000 tiles that churned the browser's memory and GPU textures: 78 of 240 frames went over 16 ms, the worst at 265 ms. One shared buffer brought that to 0 of 240.

### Hexagonal grid on square storage

Hex cells use "odd-r" offset coordinates: rows stay rows, and odd rows count as shifted half a cell. That reuses the tile storage, pen, undo and minimap unchanged. Only two things differ: the neighbour table depends on the row's parity, and geometry goes through one `cellCenter()` helper, with rows packed √3/2 apart.

Drawing has three regimes:

- **Under 8 px per cell:** the pixel buffer, at two buffer columns per cell so odd rows can shift by half a cell.
- **8 px and up:** a pre-rendered hexagon image per colour is stamped onto each visible cell.
- **12 px and up:** the outline grid is a repeating tile, one column wide and two rows tall, drawn with a single `fillRect` and a pattern transform.

Building a path for every hexagon cost 32 ms per frame at 6 px and 155 ms at 12 px. With image stamps and the pattern it is 5.9 ms at 8 px and 0.3 ms at 22 px, on a 600,000-cell spiral.

### Frame budget and the speed slider

The simulation gets a 10 ms slice of each frame, checking the clock every 1,024 steps, so a slow device runs as fast as it can instead of freezing. Backlog it can't catch up on is dropped, and the measured rate is shown next to the requested one. The slider is exponential and bent so its midpoint is 1,000 steps/s: 1 to 500,000 in one control, with most of its travel in speeds you can watch.

### Smooth follow camera

Locking the camera to the ant shakes badly at high speed, because the ant jumps hundreds of cells per frame. A plain exponential ease fixed the shake but lagged on steady motion. On the highway at 500,000 steps/s it trailed by about 4,600 cells, far off screen.

The camera now uses Holt's double exponential smoothing, which tracks position and velocity, so steady travel has no lag while jitter is averaged out. Two more details matter:

- **Velocity seed:** when follow starts, the velocity is seeded from the ant's last move. Without this it took 5.7 s to catch up at 50,000 steps/s, and never at 500,000.
- **Hard clamp:** the ant is always kept inside the middle 70% of the view.

Result on the highway at 500,000 steps/s: 0 of 600 frames with the ant off screen, caught up in 0.52 s, and the frame-to-frame change in camera movement cut from 54 px to 6 px on average.

### Testing

`npm test` runs 29 checks:

- **Correctness:** all 9 rules are compared cell by cell, plus the ant's position and heading, after 200,000 steps against `tests/reference.js`. That file is a deliberately different implementation: a `Map` of string keys, and axial coordinates on the hex grid. The tests drive the real page in headless Chrome through a small `window.antLab` hook.
- **Behaviour:** pen and undo, frame times against a 60 fps budget, and the follow camera, run under a fake clock so each render is exactly one frame.
- **Wiki facts:** every number the wiki marks as *measured* is checked on the reference: the highway at step 9,977 with a 104-step cycle and +12 squares per cycle, the 1,968-step highway of `LLRRRLRLRLLR`, the symmetry counts, both mirror pairs, and running backwards.

The tests do catch real mistakes: a single wrong entry in the hex neighbour table fails 5 of them.

### Known limits

- Pixel colours assume a little-endian CPU, which every mainstream browser platform is.
- The tests need a local Chrome or Edge. Set `CHROME=/path/to/chrome` if it isn't found automatically.
- Fonts load from Google Fonts. Offline, the page falls back to system fonts.
