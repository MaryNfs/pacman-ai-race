import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest, chooseSafeFallback, nearestDistance } from "../ai-state.js";
import { cellKey, parseLevel } from "../game-core.js";

test("decision state exposes only legal forward choices with semantic labels", () => {
  const level = parseLevel();
  const decision = buildDecisionRequest({
    player: { row: 3, col: 1, direction: "down" },
    ghosts: [{ row: 3, col: 5 }],
    pellets: level.pellets,
    powerPellets: level.powerPellets,
    frightenedFor: 0,
    level: 1,
    score: 200,
  });

  assert.deepEqual(decision.legalMoves.map((move) => move.direction).sort(), ["down", "right"]);
  assert.equal(decision.state.mode, "normal mode: ghosts are dangerous");
  assert.match(decision.legalMoves[0].summary, /regular food/);
});

test("nearest distance is calculated in code around maze walls", () => {
  const target = new Set([cellKey(1, 11)]);
  assert.equal(nearestDistance({ row: 1, col: 9 }, target), 6);
});

test("fallback prioritizes ghost safety in normal mode", () => {
  const direction = chooseSafeFallback([
    { direction: "left", ghostDistance: 1, pelletDistance: 0, powerDistance: 2 },
    { direction: "right", ghostDistance: 7, pelletDistance: 3, powerDistance: 8 },
  ], false);
  assert.equal(direction, "right");
});

test("fallback can pursue edible ghosts during power mode", () => {
  const direction = chooseSafeFallback([
    { direction: "left", ghostDistance: 1, pelletDistance: 4, powerDistance: Infinity },
    { direction: "right", ghostDistance: 7, pelletDistance: 1, powerDistance: Infinity },
  ], true);
  assert.equal(direction, "left");
});
