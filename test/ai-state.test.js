import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest, buildMazeSnapshot, findCorridorThreat, findNextJunction, nearestDistance, projectRouteState, selectablePrefetchedRoute } from "../ai-state.js";
import { cellKey, parseLevel } from "../game-core.js";

test("decision state evaluates every legal choice and exposes only collision-free candidates", () => {
  const level = parseLevel();
  const decision = buildDecisionRequest({
    player: { row: 3, col: 1, direction: "down" },
    ghosts: [{ row: 3, col: 5, name: "Blaze", direction: "left", speed: 5.2 }],
    pellets: level.pellets,
    powerPellets: level.powerPellets,
    frightenedFor: 0,
    level: 1,
    lives: 2,
  });

  assert.deepEqual([...new Set(decision.evaluatedRoutes.map((move) => move.direction))].sort(), ["down", "right", "up"]);
  assert.deepEqual([...new Set(decision.routeChoices.map((move) => move.direction))].sort(), ["down", "up"]);
  assert.deepEqual(decision.state.antiLoopRule.blockedRouteIds, ["right"]);
  assert.equal(decision.state.mode, "normal mode: ghosts are dangerous");
  assert.match(decision.state.directionAssessments.up.maneuver, /U-turn/);
  assert.equal(decision.state.directionAssessments.left.availability, "blocked by wall");
  assert.equal(Object.keys(decision.state.routeCandidates).length, 2);
  assert.equal(typeof Object.values(decision.state.routeCandidates)[0].nearestGhostLeadSeconds, "number");
  assert.equal(typeof Object.values(decision.state.routeCandidates)[0].nearestRemainingDotDistance, "number");
  assert.equal(Object.values(decision.state.routeCandidates)[0].codeStrategicRank, 1);
  assert.equal("score" in decision.state, false);
  assert.equal("scoreBand" in decision.state, false);
  assert.equal(decision.state.lives, 2);
  assert.equal(decision.state.wholeMazeSnapshot.mapTopToBottom.length, 23);
  assert.equal(decision.state.wholeMazeSnapshot.ghosts[0].name, "Blaze");
  assert.equal(decision.meta.foodTargetKey, decision.state.foodNavigation.targetKey);
  assert.equal(typeof decision.state.foodNavigation.shortestDistanceFromDecision, "number");
  assert.deepEqual(decision.state.foodNavigation.remainingDotsByRegion, decision.state.wholeMazeSnapshot.dotsByRegion);
  assert.equal(typeof Object.values(decision.state.routeCandidates)[0].targetTravelTiles, "number");
});

test("prefetched route reuse requires the route to remain selectable in the live forecast", () => {
  const safe = { id: "left", collisionOccurred: false };
  const fatal = { id: "right", collisionOccurred: true };
  const decision = { routeChoices: [{ id: "left" }], routes: [safe, fatal] };
  assert.equal(selectablePrefetchedRoute(decision, "left"), safe);
  assert.equal(selectablePrefetchedRoute(decision, "right"), null);
  assert.equal(selectablePrefetchedRoute(decision, "up"), null);
});

test("whole-maze snapshot preserves food and places visible ghost state", () => {
  const scan = buildMazeSnapshot(
    { row: 15, col: 10 },
    [{ row: 3, col: 5, name: "Blaze", direction: "right", speed: 5.25 }],
    new Set(["1,1", "1,2", "21,10"]),
    new Set(["21,1"]),
  );

  assert.equal(scan.remainingRegularDots, 3);
  assert.equal(scan.remainingPowerDots, 1);
  assert.deepEqual(scan.dotsByRegion, { "top-left": 2, "bottom-center": 1, "bottom-left": 1 });
  assert.equal(scan.mapTopToBottom[1][1], ".");
  assert.equal(scan.mapTopToBottom[21][1], "o");
  assert.equal(scan.mapTopToBottom[15][10], "P");
  assert.equal(scan.mapTopToBottom[3][5], "A");
  assert.deepEqual(scan.ghosts[0], {
    marker: "A",
    name: "Blaze",
    position: { row: 3, col: 5 },
    tile: { row: 3, col: 5 },
    heading: "right",
    speedTilesPerSecond: 5.25,
    state: "dangerous",
    approximateTileDistanceFromPacman: 17,
  });
});

test("whole-maze snapshot marks frightened ghosts as edible", () => {
  const scan = buildMazeSnapshot(
    { row: 15, col: 10 },
    [{ row: 15, col: 8, direction: "left", speed: 4 }],
    new Set(),
    new Set(),
    5,
  );
  assert.equal(scan.mapTopToBottom[15][8], "a");
  assert.equal(scan.ghosts[0].state, "edible");
});

test("route projection removes collected food and activates power mode", () => {
  const projection = projectRouteState({
    path: [{ row: 1, col: 1 }, { row: 1, col: 2 }, { row: 1, col: 3 }],
    pellets: new Set(["1,1", "1,3", "2,1"]),
    powerPellets: new Set(["1,2", "3,1"]),
    playerSpeed: 5,
  });

  assert.deepEqual([...projection.pellets], ["2,1"]);
  assert.deepEqual([...projection.powerPellets], ["3,1"]);
  assert.ok(Math.abs(projection.frightenedFor - 7.7333) < 0.001);
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
