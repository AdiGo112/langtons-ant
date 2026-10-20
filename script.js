(() => {
  "use strict";

  const canvas = document.getElementById("world");
  const wrap = document.getElementById("canvasWrap");
  const ctx = canvas.getContext("2d", { alpha: false });

  const el = {
    statusDot: document.getElementById("statusDot"),
    statusText: document.getElementById("statusText"),
    playPause: document.getElementById("playPause"),
    playIcon: document.getElementById("playIcon"),
    playText: document.getElementById("playText"),
    stepOnce: document.getElementById("stepOnce"),
    speed: document.getElementById("speed"),
    speedValue: document.getElementById("speedValue"),
    actualSpeed: document.getElementById("actualSpeed"),
    stepsValue: document.getElementById("stepsValue"),
    blackValue: document.getElementById("blackValue"),
    blackLabel: document.getElementById("blackLabel"),
    ruleText: document.getElementById("ruleText"),
    ruleSelect: document.getElementById("ruleSelect"),
    ruleNote: document.getElementById("ruleNote"),
    ruleLegend: document.getElementById("ruleLegend"),
    positionValue: document.getElementById("positionValue"),
    directionValue: document.getElementById("directionValue"),
    directionIcon: document.getElementById("directionIcon"),
    compassNeedle: document.getElementById("compassNeedle"),
    zoomLabel: document.getElementById("zoomLabel"),
    emptyHint: document.getElementById("emptyHint"),
    toolbarPlay: document.getElementById("toolbarPlay"),
    toolbarSpeed: document.getElementById("toolbarSpeed"),
    toolbarSpeedValue: document.getElementById("toolbarSpeedValue"),
    undoStroke: document.getElementById("undoStroke")
  };

  // Square grid directions, clockwise: 0 = north, 1 = east, 2 = south, 3 = west.
  // `angle` is the ant marker's rotation in degrees, 0 = pointing up.
  const SQUARE_DIRS = [
    { name: "NORTH", icon: "↑", angle: 0 },
    { name: "EAST", icon: "→", angle: 90 },
    { name: "SOUTH", icon: "↓", angle: 180 },
    { name: "WEST", icon: "←", angle: 270 }
  ];
  const SQUARE_MOVES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // Hex grid directions, anticlockwise from east, so turning left by 60° is +1.
  const HEX_DIRS = [
    { name: "EAST", icon: "→", angle: 90 },
    { name: "NORTH-EAST", icon: "↗", angle: 30 },
    { name: "NORTH-WEST", icon: "↖", angle: -30 },
    { name: "WEST", icon: "←", angle: -90 },
    { name: "SOUTH-WEST", icon: "↙", angle: -150 },
    { name: "SOUTH-EAST", icon: "↘", angle: 150 }
  ];
  // Hex cells are stored in "odd-r" offset coordinates: rows are ordinary rows, and odd rows sit
  // half a cell to the right. That keeps the square tile storage, so a neighbour's offset depends
  // on whether the row is even or odd.
  const HEX_MOVES_EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const HEX_MOVES_ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

  const CELL_SIZE = 22;
  // ponytail: effectively unbounded (1px ≈ 45k cells); a true 0 breaks the camera math.
  const MIN_ZOOM = 1e-6;
  const MAX_ZOOM = 5;
  const FRAME_BUDGET_MS = 10;

  let ant = { x: 0, y: 0, dir: 0 };
  // The infinite grid is stored as 256×256 tiles of bytes (1 = black), created on demand.
  // Typed arrays keep stepping fast, and drawing costs one image per tile instead of one rect per cell.
  // ponytail: bit ops limit coordinates to ±2^31 cells, hours of max-speed highway away.
  const TILE_BITS = 8;
  const TILE = 1 << TILE_BITS;
  const TILE_MASK = TILE - 1;
  // Each cell stores its colour (state) as a byte. A rule is a list of turns, one per colour:
  // "RL" is the classic ant. Leaving a cell moves it on to the next colour in the cycle.
  // Hex turns: N = none, U = U-turn, L1/R1 = 60°, L2/R2 = 120°.
  const RULES = {
    RL: { grid: "square", text: "Right on white, left on black. Builds a highway after 9,977 steps." },
    LLRR: { grid: "square", text: "4 colours. Grows symmetrically." },
    RLR: { grid: "square", text: "3 colours. Grows chaotically; no one knows if it ever builds a highway." },
    LRRRRRLLR: { grid: "square", text: "9 colours. Fills space in a square around itself." },
    LLRRRLRLRLLR: { grid: "square", text: "12 colours. Builds a convoluted highway." },
    RRLLLRLLLRRR: { grid: "square", text: "12 colours. After about 15,900 steps, builds a filled triangle that grows and moves." },
    L2NNL1L2L1: { grid: "hex", text: "Hexagonal grid, 6 colours. Grows a lumpy blob full of round holes." },
    L1L2NUL2L1R2: { grid: "hex", text: "Hexagonal grid, 7 colours. Grows in a spiral." },
    R1R2NUR2R1L2: { grid: "hex", text: "Hexagonal grid, 7 colours. The mirror image of L₁L₂NUL₂L₁R₂: the same spiral, flipped." }
  };
  const TURN_STEPS = { square: { R: 1, L: 3 }, hex: { N: 0, L1: 1, L2: 2, U: 3, R2: 4, R1: 5 } };
  const parseRule = name => name.match(/[LR][12]|[LRNU]/g);
  // Turn names with subscript digits, as they're usually written: L2 -> L₂.
  const prettyTurn = turn => turn.replace("1", "₁").replace("2", "₂");
  // Colours for states 1..11. State 0 (white) is left transparent over the background.
  const STATE_COLORS = ["#17241d", "#2f7d6d", "#c99a2e", "#3f6fb5", "#7d5aa6", "#8a5a2b",
    "#7a9a3a", "#b0668e", "#5f6b66", "#1f4f7a", "#4fa3a3"];
  // As little-endian RGBA pixels (every mainstream browser is little-endian).
  const STATE_PIXELS = [0, ...STATE_COLORS.map(hex =>
    (0xff << 24) | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16))];
  let turns = [1, 3];
  let hex = false;
  let dirs = SQUARE_DIRS;
  // Hex rows are packed √3/2 apart, the true spacing of hexagons; square rows are 1 apart.
  let rowScale = 1;
  let tiles = new Map();
  let antTile = null;
  // Squares that aren't white.
  let blackCount = 0;
  // Bounding box of every cell ever flipped, for the minimap.
  let bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let steps = 0;
  let running = false;
  // Slider 0..1000 maps to 1..500K steps / sec. Exponential, bent so the midpoint lands on MID_SPEED
  // and most of the travel stays in watchable speeds.
  // ponytail: slower devices may top out below MAX_SPEED; #actualSpeed shows what you really get.
  const MAX_SPEED = 500000;
  const MID_SPEED = 1000;
  const LOG_MAX = Math.log10(MAX_SPEED);
  const CURVE = Math.log(Math.log10(MID_SPEED) / LOG_MAX) / Math.log(0.5);
  const sliderToSpeed = value => Math.round(10 ** (LOG_MAX * (Number(value) / 1000) ** CURVE));
  const speedToSlider = value => 1000 * (Math.log10(value) / LOG_MAX) ** (1 / CURVE);
  let speed = sliderToSpeed(el.speed.value);
  let accumulator = 0;
  let rateStart = 0;
  let rateSteps = 0;
  let lastFrame = 0;
  let animationId = null;
  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = 1;

  const camera = { x: 0, y: 0, zoom: 1 };
  const pointers = new Map();
  let dragState = null;
  let pinchState = null;
  let penMode = false;
  let penStroke = null;
  let following = false;
  // Smooth follow tracks the ant's position and velocity (Holt's double exponential smoothing), in
  // squares. Tracking velocity means steady travel like the highway has no lag, while the random
  // back-and-forth inside a blob is averaged out instead of shaking the view.
  // Raise the time constants for a calmer camera, lower them for a tighter one.
  let smoothFollow = true;
  const FOLLOW_POSITION_S = 0.12;
  const FOLLOW_VELOCITY_S = 0.25;
  // The ant is never allowed outside the middle 70% of the view, however it moves.
  const FOLLOW_MARGIN = 0.15;
  let followPos = null;
  let followVel = { x: 0, y: 0 };
  // Where the ant was at the previous render, to seed the velocity when follow starts.
  let lastAnt = { x: 0, y: 0 };
  let lastRender = 0;
  let settleId = null;
  // Each entry is the set of cells one pen stroke flipped; undo flips them back.
  // ponytail: capped at 100 strokes, raise it if people want deeper history.
  const undoStack = [];
  const UNDO_LIMIT = 100;

  const minimap = document.getElementById("minimap");
  const miniCtx = minimap.getContext("2d");
  let miniView = null;
  let lastMinimap = 0;

  const cellKey = (x, y) => `${x},${y}`;
  // World position of a cell's centre, in cell widths. Odd hex rows sit half a cell to the right.
  const cellCenter = (x, y) => ({ x: x + 0.5 + (hex ? (y & 1) / 2 : 0), y: (y + 0.5) * rowScale });
  // Add a pointy-top hexagon to a path. `w` is half its width, `r` the distance from centre to top corner.
  function addHexagon(path, cx, cy, w, r) {
    path.moveTo(cx, cy - r);
    path.lineTo(cx + w, cy - r / 2);
    path.lineTo(cx + w, cy + r / 2);
    path.lineTo(cx, cy + r);
    path.lineTo(cx - w, cy + r / 2);
    path.lineTo(cx - w, cy - r / 2);
    path.closePath();
  }
  // A hexagon r for a cell w wide, so rows packed √3/2 apart interlock exactly.
  const HEX_R = 1 / Math.sqrt(3);
  // From this cell width (in px) up, hex cells are drawn as real hexagons instead of pixels.
  const HEX_SHAPE_PX = 8;

  // The cell under a world position.
  function worldToCell(wx, wy) {
    const y = Math.floor(wy / rowScale);
    return { x: Math.floor(wx - (hex ? (y & 1) / 2 : 0)), y };
  }

  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    centerCameraOnAnt();
    render();
  }

  function screenToWorld(screenX, screenY) {
    return {
      x: (screenX - camera.x) / (CELL_SIZE * camera.zoom),
      y: (screenY - camera.y) / (CELL_SIZE * camera.zoom)
    };
  }

  function centerCameraOnAnt() {
    const center = cellCenter(ant.x, ant.y);
    camera.x = cssWidth / 2 - center.x * CELL_SIZE * camera.zoom;
    camera.y = cssHeight / 2 - center.y * CELL_SIZE * camera.zoom;
  }

  function setZoom(nextZoom, anchorX = cssWidth / 2, anchorY = cssHeight / 2) {
    const oldZoom = camera.zoom;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (newZoom === oldZoom) return;
    // Keep the world point under the cursor/pinch midpoint fixed on screen.
    const worldX = (anchorX - camera.x) / oldZoom;
    const worldY = (anchorY - camera.y) / oldZoom;
    camera.zoom = newZoom;
    camera.x = anchorX - worldX * newZoom;
    camera.y = anchorY - worldY * newZoom;
    render();
  }

  function getTile(x, y) {
    const tx = x >> TILE_BITS;
    const ty = y >> TILE_BITS;
    const key = cellKey(tx, ty);
    let tile = tiles.get(key);
    if (!tile) {
      tile = { tx, ty, cells: new Uint8Array(TILE * TILE), count: 0, version: 0, mips: [] };
      tiles.set(key, tile);
    }
    return tile;
  }

  // Move a square `by` colours along the rule's cycle; returns the colour it had before.
  function advanceIn(tile, x, y, by) {
    const i = ((y & TILE_MASK) << TILE_BITS) | (x & TILE_MASK);
    const before = tile.cells[i];
    const after = (before + by) % turns.length;
    tile.cells[i] = after;
    const delta = (after !== 0) - (before !== 0);
    blackCount += delta;
    tile.count += delta;
    tile.version++;
    if (x < bounds.minX) bounds.minX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (x + 1 > bounds.maxX) bounds.maxX = x + 1;
    if (y + 1 > bounds.maxY) bounds.maxY = y + 1;
    return before;
  }

  const advanceCell = (x, y, by) => advanceIn(getTile(x, y), x, y, by);

  function doStep() {
    if (!antTile || ant.x >> TILE_BITS !== antTile.tx || ant.y >> TILE_BITS !== antTile.ty) {
      antTile = getTile(ant.x, ant.y);
    }
    // Turn by the rule for this square's colour, move the square to its next colour, step forward.
    // For the classic RL ant: white -> turn right, black -> turn left.
    ant.dir = (ant.dir + turns[advanceIn(antTile, ant.x, ant.y, 1)]) % dirs.length;

    const move = hex ? (ant.y & 1 ? HEX_MOVES_ODD : HEX_MOVES_EVEN)[ant.dir] : SQUARE_MOVES[ant.dir];
    ant.x += move[0];
    ant.y += move[1];
    steps++;
  }

  // Run up to count steps, but stop when the frame's time budget runs out so the page stays responsive.
  function advance(count) {
    const deadline = performance.now() + FRAME_BUDGET_MS;
    let done = 0;
    while (done < count) {
      if ((done & 1023) === 0 && performance.now() > deadline) break;
      doStep();
      done++;
    }
    return done;
  }

  function formatNumber(value) {
    return value.toLocaleString("en-US");
  }

  function formatCompact(value) {
    return Math.round(value).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }

  function updateStats() {
    el.stepsValue.textContent = formatNumber(steps);
    el.blackValue.textContent = formatNumber(blackCount);
    el.positionValue.textContent = `${formatNumber(ant.x)}, ${formatNumber(ant.y)}`;
    const direction = dirs[ant.dir];
    el.directionValue.textContent = direction.name;
    el.directionIcon.textContent = direction.icon;
    el.compassNeedle.textContent = direction.icon;
    el.statusText.textContent = running ? "RUNNING" : "PAUSED";
    el.statusDot.style.opacity = running ? "1" : ".45";
    el.playIcon.textContent = running ? "Ⅱ" : "▶";
    el.playText.textContent = running ? "Pause simulation" : "Start simulation";
    el.emptyHint.classList.toggle("visible", steps === 0 && !running && !penMode);
    el.toolbarPlay.textContent = running ? "Ⅱ" : "▶";
  }

  function render() {
    if (!cssWidth || !cssHeight) return;
    const now = performance.now();
    const antAt = cellCenter(ant.x, ant.y);
    if (following) {
      const dt = (now - lastRender) / 1000;
      if (!smoothFollow || !followPos || dt > 0.25) {
        // Snap: smoothing is off, just started, or the page was idle. Start from the ant's current
        // velocity so the camera is already moving with it instead of taking seconds to catch up.
        followPos = { x: antAt.x, y: antAt.y };
        followVel = dt > 0 && dt <= 0.25 ? { x: (antAt.x - lastAnt.x) / dt, y: (antAt.y - lastAnt.y) / dt } : { x: 0, y: 0 };
      } else if (dt > 0) {
        const predictedX = followPos.x + followVel.x * dt;
        const predictedY = followPos.y + followVel.y * dt;
        const a = 1 - Math.exp(-dt / FOLLOW_POSITION_S);
        const b = 1 - Math.exp(-dt / FOLLOW_VELOCITY_S);
        const nextX = predictedX + a * (antAt.x - predictedX);
        const nextY = predictedY + a * (antAt.y - predictedY);
        followVel.x += b * ((nextX - followPos.x) / dt - followVel.x);
        followVel.y += b * ((nextY - followPos.y) / dt - followVel.y);
        followPos = { x: nextX, y: nextY };
        // Keep the ant inside the middle of the view, whatever the smoothing says.
        const scale = CELL_SIZE * camera.zoom;
        const reachX = cssWidth * (0.5 - FOLLOW_MARGIN) / scale;
        const reachY = cssHeight * (0.5 - FOLLOW_MARGIN) / scale;
        followPos.x = Math.min(Math.max(followPos.x, antAt.x - reachX), antAt.x + reachX);
        followPos.y = Math.min(Math.max(followPos.y, antAt.y - reachY), antAt.y + reachY);
        // While paused nothing else redraws, so keep gliding until the camera arrives.
        if (!running && !settleId && Math.hypot(antAt.x - followPos.x, antAt.y - followPos.y) * scale > 0.5) {
          settleId = requestAnimationFrame(() => { settleId = null; render(); });
        }
      }
      camera.x = cssWidth / 2 - followPos.x * CELL_SIZE * camera.zoom;
      camera.y = cssHeight / 2 - followPos.y * CELL_SIZE * camera.zoom;
    }
    lastRender = now;
    lastAnt = antAt;

    // Clear the screen in screen space.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e8f0df";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const scale = CELL_SIZE * camera.zoom;
    const left = -camera.x / scale;
    const top = -camera.y / scale;
    const right = (cssWidth - camera.x) / scale;
    const bottom = (cssHeight - camera.y) / scale;
    const minX = Math.floor(left) - 1;
    const minY = Math.floor(top) - 1;
    const maxX = Math.ceil(right) + 1;
    const maxY = Math.ceil(bottom) + 1;

    // Black cells come from the tile images. White is the background.
    drawTiles(ctx, mainLayer, camera.x, camera.y, scale, cssWidth, cssHeight);
    ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);

    // Faint neutral grid lines, hidden once cells get small so the view stays readable.
    if (hex && scale >= 12) {
      // One fill with a repeating outline tile, lined up with world (0, 0).
      const art = getHexArt(scale);
      art.outline.setTransform(new DOMMatrix([1 / art.kx, 0, 0, 1 / art.ky, camera.x, camera.y]));
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = art.outline;
      ctx.fillRect(0, 0, cssWidth, cssHeight);
      ctx.restore();
    } else if (scale >= 6 && !hex) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(23, 36, 29, 0.08)";
      ctx.lineWidth = 1 / camera.zoom;
      for (let x = minX; x <= maxX; x++) {
        ctx.moveTo(x * CELL_SIZE, minY * CELL_SIZE);
        ctx.lineTo(x * CELL_SIZE, maxY * CELL_SIZE);
      }
      for (let y = minY; y <= maxY; y++) {
        ctx.moveTo(minX * CELL_SIZE, y * CELL_SIZE);
        ctx.lineTo(maxX * CELL_SIZE, y * CELL_SIZE);
      }
      ctx.stroke();
    }

    // Mark the origin subtly so the user can navigate back to it.
    ctx.strokeStyle = "#56645a";
    ctx.lineWidth = 1 / camera.zoom;
    if (hex) {
      const origin = new Path2D();
      const c = cellCenter(0, 0);
      addHexagon(origin, c.x * CELL_SIZE, c.y * CELL_SIZE, CELL_SIZE / 2 - 0.5, CELL_SIZE * HEX_R - 0.5);
      ctx.stroke(origin);
    } else {
      ctx.strokeRect(0.5, 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
    }

    // Draw the ant on its current cell with a high-contrast direction marker.
    const cx = antAt.x * CELL_SIZE;
    const cy = antAt.y * CELL_SIZE;
    ctx.fillStyle = "#c8322a";
    if (hex) {
      const body = new Path2D();
      const r = Math.max(CELL_SIZE * HEX_R - 1.5, 3 / camera.zoom);
      addHexagon(body, cx, cy, r * Math.sqrt(3) / 2, r);
      ctx.fill(body);
    } else {
      const antSize = Math.max(CELL_SIZE - 3, 5 / camera.zoom);
      ctx.fillRect(cx - antSize / 2, cy - antSize / 2, antSize, antSize);
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rowScale, rowScale);
    ctx.rotate(dirs[ant.dir].angle * Math.PI / 180);
    ctx.fillStyle = "#eef4e8";
    ctx.beginPath();
    // A long, narrow pointer. A squat triangle turned 30° (hex headings) reads as pointing the wrong way.
    ctx.moveTo(0, -CELL_SIZE * 0.4);
    ctx.lineTo(CELL_SIZE * 0.14, CELL_SIZE * 0.28);
    ctx.lineTo(-CELL_SIZE * 0.14, CELL_SIZE * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The minimap is secondary, so ~5 fps is plenty while the simulation runs.
    if (!running || now - lastMinimap > 200) {
      lastMinimap = now;
      drawMinimap({ left, top, right, bottom });
    }
    const percent = camera.zoom * 100;
    el.zoomLabel.textContent = `${percent >= 10 ? Math.round(percent) : +percent.toPrecision(2)}%`;
    updateStats();
  }

  // A tile at 1/2^level resolution: each entry covers 2^level × 2^level cells and holds the highest
  // colour among them, so thin lines never vanish when zoomed out. Built from the level below, cached per version.
  function mipOf(tile, level) {
    if (level === 0) return tile.cells;
    const mip = tile.mips[level];
    if (mip && mip.version === tile.version) return mip.data;
    const src = mipOf(tile, level - 1);
    const size = TILE >> level;
    const srcSize = size * 2;
    const data = mip ? mip.data : new Uint8Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = 2 * y * srcSize + 2 * x;
        data[y * size + x] = Math.max(src[i], src[i + 1], src[i + srcSize], src[i + srcSize + 1]);
      }
    }
    tile.mips[level] = { data, version: tile.version };
    return data;
  }

  // One reusable offscreen canvas per view; visible tiles are copied into it and drawn with one drawImage.
  function makeLayer() {
    const canvas = document.createElement("canvas");
    return { canvas, context: canvas.getContext("2d"), image: null, pixels: null };
  }
  const mainLayer = makeLayer();
  const miniLayer = makeLayer();

  // Draw the visible coloured cells, with world point (x, y) landing at (ox + x * cellPx, oy + y * cellPx)
  // CSS pixels. Each buffer pixel covers 2^level cells and is at least one screen pixel, so the buffer
  // never outgrows the screen and the cost per frame doesn't depend on how many cells exist.
  function drawTiles(context, layer, ox, oy, cellPx, width, height) {
    if (hex && cellPx >= HEX_SHAPE_PX) {
      drawHexagons(context, ox, oy, cellPx, width, height);
      return;
    }
    const rowPx = cellPx * rowScale;
    const level = rowPx >= 1 ? 0 : Math.ceil(Math.log2(1 / rowPx));
    const unit = 2 ** level;
    // Small hex cells use two buffer columns per cell so odd rows can shift by half a cell. At these
    // sizes the cells are a few pixels, so offset bricks look the same as hexagons; zoomed further
    // out the shift is dropped.
    const sub = hex && level === 0 ? 2 : 1;
    const x0 = Math.max(Math.floor(-ox / cellPx) - 1, bounds.minX);
    const y0 = Math.max(Math.floor(-oy / rowPx), bounds.minY);
    const x1 = Math.min(Math.ceil((width - ox) / cellPx), bounds.maxX);
    const y1 = Math.min(Math.ceil((height - oy) / rowPx), bounds.maxY);
    const bx0 = Math.floor(x0 / unit);
    const by0 = Math.floor(y0 / unit);
    const bw = Math.ceil(x1 / unit) - bx0;
    const bh = Math.ceil(y1 / unit) - by0;
    if (bw <= 0 || bh <= 0) return;
    const bufW = bw * sub + sub - 1;

    if (!layer.image || layer.image.width < bufW || layer.image.height < bh) {
      const w = Math.max(bufW, layer.image ? layer.image.width : 0);
      const h = Math.max(bh, layer.image ? layer.image.height : 0);
      layer.canvas.width = w;
      layer.canvas.height = h;
      layer.image = layer.context.createImageData(w, h);
      layer.pixels = new Uint32Array(layer.image.data.buffer);
    }
    const stride = layer.image.width;
    const pixels = layer.pixels;
    pixels.fill(0);

    const mipLevel = Math.min(level, TILE_BITS);
    const size = TILE >> mipLevel;
    for (const tile of tiles.values()) {
      if (!tile.count) continue;
      if (level > TILE_BITS) {
        // Tiles are smaller than a buffer pixel: one pixel per tile that has anything in it.
        const px = Math.floor(tile.tx * TILE / unit) - bx0;
        const py = Math.floor(tile.ty * TILE / unit) - by0;
        if (px >= 0 && px < bw && py >= 0 && py < bh) pixels[py * stride + px] = STATE_PIXELS[1];
        continue;
      }
      const mx = tile.tx * size;
      const my = tile.ty * size;
      const xs = Math.max(mx, bx0);
      const xe = Math.min(mx + size, bx0 + bw);
      const ys = Math.max(my, by0);
      const ye = Math.min(my + size, by0 + bh);
      if (xs >= xe || ys >= ye) continue;
      const mip = mipOf(tile, mipLevel);
      for (let y = ys; y < ye; y++) {
        const src = (y - my) * size - mx;
        if (sub === 1) {
          const dst = (y - by0) * stride - bx0;
          for (let x = xs; x < xe; x++) {
            const state = mip[src + x];
            if (state) pixels[dst + x] = STATE_PIXELS[state];
          }
        } else {
          const dst = (y - by0) * stride - 2 * bx0 + (y & 1);
          for (let x = xs; x < xe; x++) {
            const state = mip[src + x];
            if (state) pixels[dst + 2 * x] = pixels[dst + 2 * x + 1] = STATE_PIXELS[state];
          }
        }
      }
    }

    layer.context.putImageData(layer.image, 0, 0, 0, 0, bufW, bh);
    context.imageSmoothingEnabled = false;
    const px = unit * cellPx;
    const py = unit * rowPx;
    context.drawImage(layer.canvas, 0, 0, bufW, bh, ox + bx0 * px, oy + by0 * py, bufW * px / sub, bh * py);
  }

  // Hexagon images for the current cell size, rebuilt when it changes: one filled hexagon per colour,
  // and a repeating outline tile one column wide and two rows tall (the hex grid's period).
  // Stamping images is far cheaper than filling or stroking thousands of hexagon paths.
  let hexArt = null;
  function getHexArt(cellPx) {
    if (hexArt && hexArt.cellPx === cellPx && hexArt.dpr === dpr) return hexArt;
    // Pad each hexagon by a fraction of a pixel so antialiased neighbours don't show seams.
    const w = cellPx / 2 + 0.3;
    const r = cellPx * HEX_R + 0.3;
    const spriteW = Math.ceil(2 * w * dpr) + 2;
    const spriteH = Math.ceil(2 * r * dpr) + 2;
    const sprites = STATE_COLORS.map(color => {
      const sprite = document.createElement("canvas");
      sprite.width = spriteW;
      sprite.height = spriteH;
      const shape = new Path2D();
      addHexagon(shape, spriteW / 2, spriteH / 2, w * dpr, r * dpr);
      const g = sprite.getContext("2d");
      g.fillStyle = color;
      g.fill(shape);
      return sprite;
    });
    const tile = document.createElement("canvas");
    tile.width = Math.max(1, Math.round(cellPx * dpr));
    tile.height = Math.max(1, Math.round(2 * cellPx * rowScale * dpr));
    // Tile pixels per CSS pixel; about dpr, adjusted so the tile repeats exactly once per period.
    const kx = tile.width / cellPx;
    const ky = tile.height / (2 * cellPx * rowScale);
    const lines = new Path2D();
    for (let row = -1; row <= 2; row++) {
      for (let col = -1; col <= 1; col++) {
        const cx = (col + 0.5 + (row & 1) / 2) * cellPx;
        const cy = (row + 0.5) * cellPx * rowScale;
        addHexagon(lines, cx * kx, cy * ky, cellPx / 2 * kx, cellPx * HEX_R * ky);
      }
    }
    const g = tile.getContext("2d");
    g.strokeStyle = "rgba(23, 36, 29, 0.08)";
    g.lineWidth = 1;
    g.stroke(lines);
    hexArt = { cellPx, dpr, sprites, spriteW: spriteW / dpr, spriteH: spriteH / dpr, outline: ctx.createPattern(tile, "repeat"), kx, ky };
    return hexArt;
  }

  // Zoomed in on the hex grid, stamp a hexagon image on each visible coloured cell.
  // Cost grows with the number of visible cells, which HEX_SHAPE_PX keeps in check.
  function drawHexagons(context, ox, oy, cellPx, width, height) {
    const rowPx = cellPx * rowScale;
    const art = getHexArt(cellPx);
    const halfW = art.spriteW / 2;
    const halfH = art.spriteH / 2;
    const x0 = Math.max(Math.floor(-ox / cellPx) - 1, bounds.minX);
    const y0 = Math.max(Math.floor(-oy / rowPx) - 1, bounds.minY);
    const x1 = Math.min(Math.ceil((width - ox) / cellPx) + 1, bounds.maxX);
    const y1 = Math.min(Math.ceil((height - oy) / rowPx) + 1, bounds.maxY);
    if (x0 >= x1 || y0 >= y1) return;
    for (const tile of tiles.values()) {
      if (!tile.count) continue;
      const tx = tile.tx * TILE;
      const ty = tile.ty * TILE;
      const xs = Math.max(tx, x0);
      const xe = Math.min(tx + TILE, x1);
      const ys = Math.max(ty, y0);
      const ye = Math.min(ty + TILE, y1);
      for (let y = ys; y < ye; y++) {
        const row = (y - ty) << TILE_BITS;
        const cy = oy + (y + 0.5) * rowPx;
        const shift = (y & 1) / 2 + 0.5;
        for (let x = xs; x < xe; x++) {
          const state = tile.cells[row + x - tx];
          if (state) context.drawImage(art.sprites[state - 1], ox + (x + shift) * cellPx - halfW, cy - halfH, art.spriteW, art.spriteH);
        }
      }
    }
  }

  // Fit the whole pattern, the ant and the current viewport into the minimap.
  function drawMinimap(view) {
    const width = minimap.clientWidth;
    const height = minimap.clientHeight;
    if (!width || !height) return;
    if (minimap.width !== Math.round(width * dpr)) {
      minimap.width = Math.round(width * dpr);
      minimap.height = Math.round(height * dpr);
    }
    const antAt = cellCenter(ant.x, ant.y);
    const minX = Math.min(bounds.minX, antAt.x - 0.5, view.left);
    const minY = Math.min(bounds.minY * rowScale, antAt.y - 0.5, view.top);
    const maxX = Math.max(bounds.maxX + 0.5, antAt.x + 0.5, view.right);
    const maxY = Math.max(bounds.maxY * rowScale, antAt.y + 0.5, view.bottom);
    const s = 0.9 * Math.min(width / (maxX - minX), height / (maxY - minY));
    const ox = width / 2 - (minX + maxX) / 2 * s;
    const oy = height / 2 - (minY + maxY) / 2 * s;
    miniView = { s, ox, oy };

    miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    miniCtx.fillStyle = "#eef4e8";
    miniCtx.fillRect(0, 0, width, height);
    drawTiles(miniCtx, miniLayer, ox, oy, s, width, height);
    miniCtx.fillStyle = "#c8322a14";
    miniCtx.strokeStyle = "#c8322a";
    miniCtx.lineWidth = 1;
    const vx = ox + view.left * s;
    const vy = oy + view.top * s;
    const vw = Math.max((view.right - view.left) * s, 2);
    const vh = Math.max((view.bottom - view.top) * s, 2);
    miniCtx.fillRect(vx, vy, vw, vh);
    miniCtx.strokeRect(vx, vy, vw, vh);
    miniCtx.fillStyle = "#c8322a";
    miniCtx.strokeStyle = "#eef4e8";
    miniCtx.beginPath();
    miniCtx.arc(ox + antAt.x * s, oy + antAt.y * s, 3, 0, Math.PI * 2);
    miniCtx.fill();
    miniCtx.stroke();
  }

  // Click the minimap to jump the camera there.
  minimap.addEventListener("pointerdown", event => {
    if (!miniView) return;
    const rect = minimap.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - miniView.ox) / miniView.s;
    const worldY = (event.clientY - rect.top - miniView.oy) / miniView.s;
    camera.x = cssWidth / 2 - worldX * CELL_SIZE * camera.zoom;
    camera.y = cssHeight / 2 - worldY * CELL_SIZE * camera.zoom;
    if (following) setFollow(false);
    else render();
  });

  function frame(timestamp) {
    if (!running) {
      animationId = null;
      return;
    }
    if (!lastFrame) lastFrame = timestamp;
    const elapsed = Math.min((timestamp - lastFrame) / 1000, 0.1);
    lastFrame = timestamp;
    accumulator += elapsed * speed;

    const count = Math.floor(accumulator);
    if (count > 0) {
      const done = advance(count);
      accumulator -= done;
      rateSteps += done;
      // Drop backlog the device can't catch up on instead of letting it grow forever.
      accumulator = Math.min(accumulator, speed * 0.1);
      render();
    } else if (following) {
      render(); // keep the follow camera gliding between slow steps
    }
    if (!rateStart) rateStart = timestamp;
    if (timestamp - rateStart >= 500) {
      el.actualSpeed.textContent = `· actual ${formatCompact(rateSteps * 1000 / (timestamp - rateStart))}`;
      rateStart = timestamp;
      rateSteps = 0;
    }
    animationId = requestAnimationFrame(frame);
  }

  function play() {
    if (running) return;
    running = true;
    lastFrame = 0;
    rateStart = 0;
    rateSteps = 0;
    accumulator = 0;
    updateStats();
    animationId = requestAnimationFrame(frame);
  }

  function pause() {
    running = false;
    if (animationId !== null) cancelAnimationFrame(animationId);
    animationId = null;
    lastFrame = 0;
    el.actualSpeed.textContent = "";
    updateStats();
  }

  function toggleRunning() {
    running ? pause() : play();
  }

  function resetWorld() {
    pause();
    ant = { x: 0, y: 0, dir: 0 };
    followPos = null;
    tiles = new Map();
    antTile = null;
    blackCount = 0;
    bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    steps = 0;
    accumulator = 0;
    undoStack.length = 0;
    updateUndoButton();
    camera.zoom = 1;
    centerCameraOnAnt();
    render();
  }

  function centerOnAnt() {
    centerCameraOnAnt();
    render();
  }

  function zoomFromButton(factor) {
    setZoom(camera.zoom * factor);
  }

  // Pointer Events cover mouse, pen and touch. Two touch pointers enable pinch zoom.
  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function setSmoothFollow(enabled) {
    smoothFollow = enabled;
    const button = document.getElementById("smoothFollow");
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  }

  function setFollow(enabled) {
    following = enabled;
    followPos = null;
    const button = document.getElementById("followAnt");
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    render();
  }

  function setPenMode(enabled) {
    penMode = enabled;
    const button = document.getElementById("penTool");
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", String(enabled));
    wrap.classList.toggle("pen-mode", enabled);
    updateStats();
  }

  // Flip every cell between the last pen cell and this one, so fast drags leave no gaps.
  // Each cell flips at most once per stroke.
  function penTo(point) {
    const world = screenToWorld(point.x, point.y);
    const cell = worldToCell(world.x, world.y);
    const from = penStroke.last || cell;
    const count = Math.max(Math.abs(cell.x - from.x), Math.abs(cell.y - from.y));
    for (let i = 0; i <= count; i++) {
      const t = count ? i / count : 0;
      const x = Math.round(from.x + (cell.x - from.x) * t);
      const y = Math.round(from.y + (cell.y - from.y) * t);
      const key = cellKey(x, y);
      if (penStroke.visited.has(key)) continue;
      penStroke.visited.set(key, [x, y]);
      advanceCell(x, y, 1);
    }
    penStroke.last = cell;
    render();
  }

  function endStroke() {
    if (penStroke && penStroke.visited.size) {
      undoStack.push(penStroke.visited);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      updateUndoButton();
    }
    penStroke = null;
  }

  function undoStroke() {
    const cells = undoStack.pop();
    if (!cells) return;
    for (const [x, y] of cells.values()) advanceCell(x, y, turns.length - 1);
    updateUndoButton();
    render();
  }

  function updateUndoButton() {
    el.undoStroke.disabled = undoStack.length === 0;
  }

  canvas.addEventListener("pointerdown", event => {
    // Left button draws (pen) or pans; right button always pans.
    if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
    canvas.setPointerCapture(event.pointerId);
    const point = pointerPosition(event);
    pointers.set(event.pointerId, point);

    if (pointers.size === 1 && penMode && event.button !== 2) {
      penStroke = { id: event.pointerId, visited: new Map(), last: null };
      pinchState = null;
      penTo(point);
    } else if (pointers.size === 1) {
      dragState = { id: event.pointerId, x: point.x, y: point.y, cameraX: camera.x, cameraY: camera.y };
      pinchState = null;
      wrap.classList.add("dragging");
    } else if (pointers.size === 2) {
      endStroke();
      const points = [...pointers.values()];
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      pinchState = {
        distance: Math.hypot(dx, dy),
        zoom: camera.zoom,
        worldX: (midX - camera.x) / camera.zoom,
        worldY: (midY - camera.y) / camera.zoom
      };
      dragState = null;
    }
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", event => {
    if (!pointers.has(event.pointerId)) return;
    const point = pointerPosition(event);
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2 && pinchState) {
      const points = [...pointers.values()];
      const midX = (points[0].x + points[1].x) / 2;
      const midY = (points[0].y + points[1].y) / 2;
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchState.zoom * distance / Math.max(1, pinchState.distance)));
      camera.zoom = nextZoom;
      camera.x = midX - pinchState.worldX * nextZoom;
      camera.y = midY - pinchState.worldY * nextZoom;
      render();
    } else if (penStroke && penStroke.id === event.pointerId) {
      penTo(point);
    } else if (dragState && dragState.id === event.pointerId) {
      // Panning by hand takes the camera back from follow mode.
      if (following && Math.hypot(point.x - dragState.x, point.y - dragState.y) > 3) setFollow(false);
      camera.x = dragState.cameraX + point.x - dragState.x;
      camera.y = dragState.cameraY + point.y - dragState.y;
      render();
    }
    event.preventDefault();
  });

  function endPointer(event) {
    pointers.delete(event.pointerId);
    endStroke();
    if (pointers.size < 2) pinchState = null;
    if (pointers.size === 1 && !penMode) {
      const [id, point] = [...pointers.entries()][0];
      dragState = { id, x: point.x, y: point.y, cameraX: camera.x, cameraY: camera.y };
      wrap.classList.add("dragging");
    } else {
      dragState = null;
      wrap.classList.remove("dragging");
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", endPointer);

  canvas.addEventListener("contextmenu", event => event.preventDefault());

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const point = pointerPosition(event);
    setZoom(camera.zoom * Math.exp(-event.deltaY * 0.0015), point.x, point.y);
  }, { passive: false });

  el.playPause.addEventListener("click", toggleRunning);
  el.stepOnce.addEventListener("click", () => {
    pause();
    doStep();
    render();
  });
  // Keeps the sidebar and fullscreen toolbar sliders in sync. The slider being dragged is
  // left alone so rounding never snaps its thumb.
  function setSpeed(next, source = null) {
    speed = next;
    for (const slider of [el.speed, el.toolbarSpeed]) {
      if (slider !== source) slider.value = String(speedToSlider(speed));
    }
    el.speedValue.textContent = el.toolbarSpeedValue.textContent = formatCompact(speed);
    document.querySelectorAll("[data-speed]").forEach(button => {
      button.classList.toggle("selected", Number(button.dataset.speed) === speed);
    });
  }
  for (const slider of [el.speed, el.toolbarSpeed]) {
    slider.addEventListener("input", () => setSpeed(sliderToSpeed(slider.value), slider));
  }
  document.querySelectorAll("[data-speed]").forEach(button => {
    button.addEventListener("click", () => setSpeed(Number(button.dataset.speed)));
  });
  el.toolbarPlay.addEventListener("click", toggleRunning);
  el.undoStroke.addEventListener("click", undoStroke);

  // Switching rules resets the world, since colours mean different things under each rule.
  function setRule(name) {
    hex = RULES[name].grid === "hex";
    dirs = hex ? HEX_DIRS : SQUARE_DIRS;
    rowScale = hex ? Math.sqrt(3) / 2 : 1;
    const tokens = parseRule(name);
    turns = tokens.map(turn => TURN_STEPS[RULES[name].grid][turn]);
    el.ruleSelect.value = name;
    el.ruleText.textContent = RULES[name].text;
    el.ruleNote.textContent = hex
      ? "N = no turn, U = U-turn, ₁ = 60°, ₂ = 120°. Switching rules resets the world."
      : "Switching rules resets the world.";
    el.blackLabel.textContent = hex ? "Coloured cells" : turns.length === 2 ? "Black squares" : "Coloured squares";
    el.ruleLegend.replaceChildren(...tokens.map((turn, state) => {
      const item = document.createElement("span");
      item.className = "legend-item";
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = state ? STATE_COLORS[state - 1] : "var(--paper-light)";
      item.append(swatch, prettyTurn(turn));
      return item;
    }));
    resetWorld();
  }
  el.ruleSelect.addEventListener("change", () => setRule(el.ruleSelect.value));
  document.getElementById("zoomIn").addEventListener("click", () => zoomFromButton(1.25));
  document.getElementById("zoomOut").addEventListener("click", () => zoomFromButton(0.8));
  document.getElementById("centerAnt").addEventListener("click", centerOnAnt);
  document.getElementById("resetAll").addEventListener("click", resetWorld);

  const workspace = document.getElementById("workspace");
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else workspace.requestFullscreen?.();
  }
  document.getElementById("fullscreen").addEventListener("click", toggleFullscreen);
  document.getElementById("penTool").addEventListener("click", () => setPenMode(!penMode));
  document.getElementById("followAnt").addEventListener("click", () => setFollow(!following));
  document.getElementById("smoothFollow").addEventListener("click", () => setSmoothFollow(!smoothFollow));
  document.querySelectorAll(".minimize-button").forEach(button => {
    button.addEventListener("click", () => {
      const minimized = button.closest(".panel-head, .control-panel").classList.toggle("minimized");
      button.textContent = minimized ? "+" : "−";
      button.setAttribute("aria-expanded", String(!minimized));
    });
  });

  window.addEventListener("keydown", event => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoStroke();
    } else if (event.code === "Space") {
      event.preventDefault();
      toggleRunning();
    } else if (event.key.toLowerCase() === "r") {
      resetWorld();
    } else if (event.key.toLowerCase() === "l") {
      setFollow(!following);
    } else if (event.key.toLowerCase() === "p") {
      setPenMode(!penMode);
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    } else if (event.key === "0") {
      centerOnAnt();
    } else if (event.key === "+" || event.key === "=") {
      zoomFromButton(1.25);
    } else if (event.key === "-") {
      zoomFromButton(0.8);
    } else if (event.key === "ArrowRight") {
      pause();
      doStep();
      render();
    }
  });

  new ResizeObserver(resizeCanvas).observe(wrap);

  setSpeed(speed);
  setRule("RL");
  resizeCanvas();

  // Hook for tests/run.js, which drives the real page in headless Chrome. The page never uses it.
  window.antLab = {
    cellSize: CELL_SIZE,
    doStep,
    render,
    setZoom,
    setFollow,
    setSmoothFollow,
    centerOnAnt,
    colourAt: (x, y) => {
      const tile = tiles.get(cellKey(x >> TILE_BITS, y >> TILE_BITS));
      return tile ? tile.cells[((y & TILE_MASK) << TILE_BITS) | (x & TILE_MASK)] : 0;
    },
    state: () => ({ ant: { ...ant }, coloured: blackCount, steps, camera: { ...camera }, width: cssWidth, height: cssHeight })
  };
})();
