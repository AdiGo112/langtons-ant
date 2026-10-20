// Runs inside headless Chrome with a fake clock (run.js replaces performance.now before the page
// loads), so each render is exactly one 60 fps frame. Checks that the follow camera keeps the ant on
// screen and catches up quickly, even on the highway at 500,000 steps per second.
(function () {
  "use strict";
  const lab = window.antLab;
  const results = [];
  const check = (name, pass, detail = "") => results.push({ name, pass, detail });
  const STEPS_PER_FRAME = 8333;
  const frame = () => {
    fakeNow += 1000 / 60;
    for (let i = 0; i < STEPS_PER_FRAME; i++) lab.doStep();
    lab.render();
  };

  try {
    for (const smooth of [true, false]) {
      lab.setFollow(false);
      for (let i = 0; i < 12000; i++) lab.doStep(); // well onto the highway
      lab.setZoom(1);
      lab.setSmoothFollow(smooth);
      for (let f = 0; f < 3; f++) frame(); // the ant is already running when follow is switched on
      fakeNow += 1000 / 60;
      for (let i = 0; i < STEPS_PER_FRAME; i++) lab.doStep();
      lab.setFollow(true);

      let offScreen = 0;
      let caughtUp = -1;
      for (let f = 0; f < 600; f++) {
        frame();
        const s = lab.state();
        const px = s.camera.x + (s.ant.x + 0.5) * lab.cellSize * s.camera.zoom;
        const py = s.camera.y + (s.ant.y + 0.5) * lab.cellSize * s.camera.zoom;
        if (px < 0 || px > s.width || py < 0 || py > s.height) offScreen++;
        if (caughtUp < 0 && Math.hypot(px - s.width / 2, py - s.height / 2) < s.width * 0.1) caughtUp = f;
      }
      const mode = smooth ? "Smooth follow" : "Exact follow";
      check(`${mode} keeps the ant on screen on the highway at 500k steps/s`, offScreen === 0, `${offScreen} of 600 frames off screen`);
      check(`${mode} catches up within 1 second`, caughtUp >= 0 && caughtUp < 60, caughtUp < 0 ? "never" : `${(caughtUp / 60).toFixed(2)} s`);
    }
  } catch (error) {
    check("Follow tests ran without throwing", false, error.message);
  }

  const pre = document.createElement("pre");
  pre.id = "results";
  pre.textContent = JSON.stringify(results);
  document.body.append(pre);
})();
