// Independent reference implementation of every rule the lab runs, used to check the app.
// Deliberately simple and different from script.js: a Map of "x,y" keys instead of byte tiles,
// and axial coordinates on the hex grid instead of the app's odd-r offset rows.
// Loads in Node (require) and in the browser (window.reference).
(function (root) {
  "use strict";

  const RULES = ["RL", "LLRR", "RLR", "LRRRRRLLR", "LLRRRLRLRLLR", "RRLLLRLLLRRR",
    "L2NNL1L2L1", "L1L2NUL2L1R2", "R1R2NUR2R1L2"];
  // Turns in direction steps. Square: 4 directions clockwise from north. Hex: 6 anticlockwise from east.
  const TURNS = { R: 1, L: 3, N: 0, L1: 1, L2: 2, U: 3, R2: 4, R1: 5 };
  const SQUARE_MOVES = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const HEX_MOVES = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function createAnt(rule) {
    const turns = rule.match(/[LR][12]|[LRNU]/g).map(turn => TURNS[turn]);
    const hex = /[12NU]/.test(rule);
    const moves = hex ? HEX_MOVES : SQUARE_MOVES;
    const colours = turns.length;
    const grid = new Map();

    return {
      x: 0, y: 0, dir: 0, steps: 0, grid, hex,
      step() {
        const key = this.x + "," + this.y;
        const colour = grid.get(key) || 0;
        this.dir = (this.dir + turns[colour]) % moves.length;
        const next = (colour + 1) % colours;
        if (next) grid.set(key, next); else grid.delete(key);
        this.x += moves[this.dir][0];
        this.y += moves[this.dir][1];
        this.steps++;
      },
      // Exactly undo step(): move back, return the cell to its previous colour, undo that colour's turn.
      back() {
        this.x -= moves[this.dir][0];
        this.y -= moves[this.dir][1];
        const key = this.x + "," + this.y;
        const colour = ((grid.get(key) || 0) + colours - 1) % colours;
        if (colour) grid.set(key, colour); else grid.delete(key);
        this.dir = (this.dir - turns[colour] + 4 * moves.length) % moves.length;
        this.steps--;
      },
      // A cell position in the app's storage coordinates (odd-r offset rows on the hex grid).
      toApp(x, y) {
        return hex ? { x: x + (y - (y & 1)) / 2, y } : { x, y };
      }
    };
  }

  const api = { RULES, createAnt };
  if (typeof module !== "undefined") module.exports = api;
  else root.reference = api;
})(this);
