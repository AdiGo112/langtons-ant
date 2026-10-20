#!/usr/bin/env node
// Runs every test: first the facts the wiki states, checked in Node on the reference implementation,
// then the real app in headless Chrome (correctness against the reference, pen and undo, frame times,
// follow camera). Exits with code 1 if anything fails.
//
//   node tests/run.js          (or: npm test)
//   CHROME=/path/to/chrome node tests/run.js   if Chrome isn't found automatically
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");
const { createAnt } = require("./reference.js");

const root = path.join(__dirname, "..");
const results = [];
const check = (name, pass, detail = "") => results.push({ name, pass, detail });

// ---------- Wiki facts, on the reference implementation ----------

const run = (rule, steps) => {
  const ant = createAnt(rule);
  for (let i = 0; i < steps; i++) ant.step();
  return ant;
};

// The ant's position after every step, and the first step from which its motion repeats with
// period p for the rest of the run (so long as it held for at least 20 periods).
function highway(rule, steps, period) {
  const ant = createAnt(rule);
  const pos = [[0, 0]];
  for (let i = 0; i < steps; i++) {
    ant.step();
    pos.push([ant.x, ant.y]);
  }
  const end = steps - period;
  const dx = pos[end + period][0] - pos[end][0];
  const dy = pos[end + period][1] - pos[end][1];
  let u = end;
  while (u >= 0 && pos[u + period][0] - pos[u][0] === dx && pos[u + period][1] - pos[u][1] === dy) u--;
  if (end - u < 20 * period) return null;
  // pos[k] is the position after k steps, so the motion repeats from step u + 2 (counting from 1).
  return { from: u + 2, dx, dy };
}

{
  const h = highway("RL", 20000, 104);
  const ant = run("RL", 15000);
  const before = ant.grid.size;
  for (let i = 0; i < 104; i++) ant.step();
  check("RL builds its highway from step 9,977 with a 104-step cycle",
    h !== null && h.from === 9977 && Math.abs(h.dx) === 2 && Math.abs(h.dy) === 2,
    h ? `from step ${h.from}, moving (${h.dx}, ${h.dy}) per cycle` : "no highway");
  check("Each RL highway cycle adds exactly 12 black squares", ant.grid.size - before === 12, `${ant.grid.size - before} added`);
}
{
  const h = highway("LLRRRLRLRLLR", 200000, 1968);
  check("LLRRRLRLRLLR's highway has a 1,968-step cycle moving 16 squares in a straight line",
    h !== null && Math.abs(h.dx) + Math.abs(h.dy) === 16 && (h.dx === 0 || h.dy === 0),
    h ? `from step ${h.from}, moving (${h.dx}, ${h.dy}) per cycle` : "no highway");
}
{
  const rl = run("RL", 50000);
  const lr = run("LR", 50000);
  let mirrored = rl.grid.size === lr.grid.size && rl.x === -lr.x && rl.y === lr.y;
  for (const key of rl.grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    if (!lr.grid.has(-x + "," + y)) mirrored = false;
  }
  check("LR draws exactly RL's pattern, mirrored", mirrored);
}
{
  // Mirror across the hex grid's east-west axis, in the app's offset rows: (x, y) -> (x, -y).
  const a = run("L1L2NUL2L1R2", 200000);
  const b = run("R1R2NUR2R1L2", 200000);
  const cells = ant => new Map([...ant.grid].map(([key, colour]) => {
    const [q, r] = key.split(",").map(Number);
    const c = ant.toApp(q, r);
    return [c.x + "," + c.y, colour];
  }));
  const ca = cells(a);
  const cb = cells(b);
  let mirrored = ca.size === cb.size;
  for (const [key, colour] of ca) {
    const [x, y] = key.split(",").map(Number);
    if (cb.get(x + "," + -y) !== colour) mirrored = false;
  }
  const pa = a.toApp(a.x, a.y);
  const pb = b.toApp(b.x, b.y);
  check("R₁R₂NUR₂R₁L₂ draws exactly L₁L₂NUL₂L₁R₂'s spiral, mirrored", mirrored && pa.x === pb.x && pa.y === -pb.y,
    `${ca.size.toLocaleString("en-US")} cells each; ants at (${pa.x}, ${pa.y}) and (${pb.x}, ${pb.y})`);
}
for (const rule of ["RL", "RRLLLRLLLRRR", "L1L2NUL2L1R2"]) {
  const ant = run(rule, 100000);
  for (let i = 0; i < 100000; i++) ant.back();
  check(`${rule} runs backwards: 100,000 steps forward and back gives a blank grid`,
    ant.grid.size === 0 && ant.x === 0 && ant.y === 0 && ant.dir === 0);
}
{
  // Mirror-symmetric about a straight or diagonal line through the pattern's bounding-box centre.
  const symmetric = grid => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const cells = [...grid].map(([key, colour]) => {
      const [x, y] = key.split(",").map(Number);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      return [x, y, colour];
    });
    const sx = x0 + x1, sy = y0 + y1;
    const mirrors = [(x, y) => [sx - x, y], (x, y) => [x, sy - y]];
    if (x1 - x0 === y1 - y0) mirrors.push((x, y) => [y + (sx - sy) / 2, x + (sy - sx) / 2], (x, y) => [(sx + sy) / 2 - y, (sx + sy) / 2 - x]);
    return mirrors.some(mirror => cells.every(([x, y, colour]) => grid.get(mirror(x, y).join(",")) === colour));
  };
  const count = rule => {
    const ant = createAnt(rule);
    let hits = 0;
    for (let i = 0; i < 60000; i++) {
      ant.step();
      if (ant.grid.size > 4 && symmetric(ant.grid)) hits++;
    }
    return hits;
  };
  const llrr = count("LLRR");
  const rlr = count("RLR");
  check("LLRR (pairs of letters) is mirror-symmetric far more often than RLR in 60,000 steps",
    llrr === 1878 && rlr === 4, `LLRR ${llrr} times, RLR ${rlr} times`);
}
{
  const ant = run("LRRRRRLLR", 200000);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const key of ant.grid.keys()) {
    const [x, y] = key.split(",").map(Number);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const fill = ant.grid.size / (w * h);
  check("LRRRRRLLR fills over 95% of a square", w === h && fill > 0.95, `${w} × ${h}, ${(fill * 100).toFixed(0)}% coloured`);
}

// ---------- The real app, in headless Chrome ----------

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  return candidates.find(file => file && fs.existsSync(file));
}

// Loads index.html with a test script after the app's own script, and reads back its JSON results.
function runInBrowser(chrome, testFile, beforeApp = "") {
  const url = file => pathToFileURL(file).href;
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8")
    .replace('href="style.css"', `href="${url(path.join(root, "style.css"))}"`)
    .replace('<script src="script.js"></script>', `${beforeApp}
  <script src="${url(path.join(root, "script.js"))}"></script>
  <script src="${url(path.join(__dirname, "reference.js"))}"></script>
  <script src="${url(path.join(__dirname, testFile))}"></script>`);
  const page = path.join(os.tmpdir(), `ant-lab-${testFile}.html`);
  fs.writeFileSync(page, html);
  const dom = execFileSync(chrome, [
    "--headless=new", "--allow-file-access-from-files", "--window-size=1280,900", "--dump-dom", url(page)
  ], { encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const match = dom.match(/<pre id="results">([\s\S]*?)<\/pre>/);
  if (!match) throw new Error(`${testFile} produced no results; open the page in a browser to see the error`);
  return JSON.parse(match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
}

const chrome = findChrome();
if (!chrome) {
  check("Found Chrome or Edge to run the app tests", false, "set CHROME=/path/to/chrome");
} else {
  results.push(...runInBrowser(chrome, "app.test.js"));
  results.push(...runInBrowser(chrome, "follow.test.js", "<script>let fakeNow = 1000; performance.now = () => fakeNow;</script>"));
}

// ---------- Report ----------

for (const { name, pass, detail } of results) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
