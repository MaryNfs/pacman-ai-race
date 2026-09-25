import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest, buildMazeFoodScan, findCorridorThreat, findNextJunction, nearestDistance } from "../ai-state.js";
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

  assert.deepEqual([...new Set(decision.routeChoices.map((move) => move.direction))].sort(), ["down", "right", "up"]);
  assert.equal(decision.state.mode, "normal mode: ghosts are dangerous");
  assert.match(decision.state.directionAssessments.up.maneuver, /U-turn/);
  assert.equal(decision.state.directionAssessments.left.availability, "blocked by wall");
  assert.ok(Object.keys(decision.state.routeCandidates).length > 3);
  assert.equal(typeof Object.values(decision.state.routeCandidates)[0].nearestGhostLeadSeconds, "number");
  assert.equal(typeof Object.values(decision.state.routeCandidates)[0].nearestRemainingDotDistance, "number");
  assert.equal(Object.values(decision.state.routeCandidates)[0].codeStrategicRank, 1);
  assert.equal(decision.state.wholeMazeFoodScan.mapTopToBottom.length, 23);
});

test("whole-maze scan preserves every remaining dot and its region", () => {
  const scan = buildMazeFoodScan(
    { row: 15, col: 10 },
    new Set(["1,1", "1,2", "21,10"]),
    new Set(["21,1"]),
  );

  assert.equal(scan.remainingRegularDots, 3);
  assert.equal(scan.remainingPowerDots, 1);
  assert.deepEqual(scan.dotsByRegion, { "top-left": 2, "bottom-center": 1, "bottom-left": 1 });
  assert.equal(scan.mapTopToBottom[1][1], ".");
  assert.equal(scan.mapTopToBottom[21][1], "o");
  assert.equal(scan.mapTopToBottom[15][10], "P");
});

test("nearest distance is calculated in code around maze walls", () => {
  const target = new Set([cellKey(1, 11)]);
  assert.equal(nearestDistance({ row: 1, col: 9 }, target), 6);
});

test("Jev planning can find the next decision point before arrival", () => {
  const junction = findNextJunction({ row: 15, col: 10 }, "left");
  assert.deepEqual(junction, { row: 15, col: 9, direction: "left", steps: 1, path: [{ row: 15, col: 9 }] });
});

test("corridor threat forecasting creates an early decision checkpoint", () => {
  const threat = findCorridorThreat(
    { row: 21, col: 10, direction: "right" },
    "right",
    [{ row: 21, col: 16, speed: 5.2 }],
  );

  assert.deepEqual(
    { row: threat.row, col: threat.col, direction: threat.direction, steps: threat.steps },
    { row: 21, col: 11, direction: "right", steps: 1 },
  );
  assert.ok(threat.ghostLeadSeconds < 0.9);
});

test("corridor threat forecasting ignores edible ghosts that stay frightened through arrival", () => {
  const threat = findCorridorThreat(
    { row: 21, col: 10, direction: "right" },
    "right",
    [{ row: 21, col: 16, speed: 5.2 }],
    6.35,
    2,
  );
  assert.equal(threat, null);
});
