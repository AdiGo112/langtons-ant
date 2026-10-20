// Runs inside headless Chrome on the real page (see run.js), through the page's window.antLab hook.
// Writes its results as JSON into <pre id="results"> for run.js to read.
(function () {
  "use strict";
  const lab = window.antLab;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass, detail });
  const pickRule = rule => {
    const select = document.getElementById("ruleSelect");
    select.value = rule;
    select.dispatchEvent(new Event("change"));
  };
  const time = fn => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

  try {
    // Correctness: every rule matches the reference, cell by cell, after 200,000 steps.
    for (const rule of reference.RULES) {
      pickRule(rule);
      const ref = reference.createAnt(rule);
      for (let i = 0; i < 200000; i++) {
        lab.doStep();
        ref.step();
      }
      const s = lab.state();
      const ant = ref.toApp(ref.x, ref.y);
      let mismatches = 0;
      for (const [key, colour] of ref.grid) {
        const [x, y] = key.split(",").map(Number);
        const cell = ref.toApp(x, y);
        if (lab.colourAt(cell.x, cell.y) !== colour) mismatches++;
      }
      const same = mismatches === 0 && s.coloured === ref.grid.size && s.ant.x === ant.x && s.ant.y === ant.y && s.ant.dir === ref.dir;
      check(`${rule} matches the reference after 200,000 steps`, same,
        same ? `${s.coloured.toLocaleString("en-US")} coloured cells` : `${mismatches} cells differ; app ${s.coloured} vs reference ${ref.grid.size}`);
    }

    // Pen and undo: a drag colours cells, Ctrl+Z puts them all back.
    pickRule("RL");
    const canvas = document.getElementById("world");
    canvas.setPointerCapture = () => {};
    const rect = canvas.getBoundingClientRect();
    const pointer = (type, x) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: "mouse", button: 0, bubbles: true,
      clientX: rect.left + rect.width / 2 + x, clientY: rect.top + rect.height / 2
    }));
    document.getElementById("penTool").click();
    pointer("pointerdown", 40);
    pointer("pointermove", 160);
    pointer("pointerup", 160);
    const drawn = lab.state().coloured;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    const undone = lab.state().coloured;
    check("Pen drag colours a line of cells and Ctrl+Z undoes it", drawn >= 5 && undone === 0, `${drawn} cells drawn, ${undone} left after undo`);
    document.getElementById("penTool").click();

    // Performance on a big pattern. Budgets are generous so slower machines still pass; the numbers
    // are reported either way.
    pickRule("RL");
    const stepMs = time(() => { for (let i = 0; i < 5000000; i++) lab.doStep(); });
    check("5 million steps run in under 2 s", stepMs < 2000, `${stepMs.toFixed(0)} ms, ${lab.state().coloured.toLocaleString("en-US")} black cells`);
    for (const [label, zoom] of [["100%", 1], ["0.05% (whole pattern)", 0.0005]]) {
      lab.setZoom(zoom);
      lab.centerOnAnt();
      const frames = [];
      for (let f = 0; f < 60; f++) {
        frames.push(time(() => {
          for (let i = 0; i < 8333; i++) lab.doStep(); // 500,000 steps per second at 60 fps
          lab.render();
        }));
      }
      check(`Max-speed frame at ${label} zoom fits a 60 fps budget`, median(frames) < 16,
        `median ${median(frames).toFixed(1)} ms, worst ${Math.max(...frames).toFixed(1)} ms`);
    }

    // Hex rendering at its most expensive size: real hexagons start at 8 px cells.
    pickRule("L1L2NUL2L1R2");
    for (let i = 0; i < 2000000; i++) lab.doStep();
    for (const px of [8, 22]) {
      lab.setZoom(px / lab.cellSize);
      lab.centerOnAnt();
      lab.render();
      const frames = [];
      for (let f = 0; f < 20; f++) frames.push(time(lab.render));
      check(`Hex frame with ${px} px hexagons fits a 60 fps budget`, median(frames) < 16,
        `median ${median(frames).toFixed(1)} ms on ${lab.state().coloured.toLocaleString("en-US")} cells`);
    }
  } catch (error) {
    check("App tests ran without throwing", false, error.message);
  }

  const pre = document.createElement("pre");
  pre.id = "results";
  pre.textContent = JSON.stringify(results);
  document.body.append(pre);
})();
