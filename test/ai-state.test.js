import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest, chooseSafeFallback, findNextJunction, nearestDistance } from "../ai-state.js";
import { cellKey, parseLevel } from "../game-core.js";

test("decision state exposes every walkable choice, including a U-turn", () => {
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

  assert.deepEqual(decision.legalMoves.map((move) => move.direction).sort(), ["down", "right", "up"]);
  assert.equal(decision.state.mode, "normal mode: ghosts are dangerous");
  assert.match(decision.legalMoves.find((move) => move.direction === "up").summary, /U-turn/);
  assert.equal(decision.state.directionAssessments.left.availability, "blocked by wall");
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

test("Jev planning can find the next decision point before arrival", () => {
  const junction = findNextJunction({ row: 15, col: 10 }, "left");
  assert.deepEqual(junction, { row: 15, col: 9, direction: "left" });
});
