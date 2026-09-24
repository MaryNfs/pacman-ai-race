import test from "node:test";
import assert from "node:assert/strict";
import { chooseRouteFallback, enumerateRouteCandidates, traceCorridor } from "../route-planner.js";
import { parseLevel } from "../game-core.js";

test("route planner enumerates two-junction plans for every first move", () => {
  const level = parseLevel();
  const routes = enumerateRouteCandidates({
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 9, col: 10, speed: 5.2 }],
    pellets: level.pellets,
    powerPellets: level.powerPellets,
    recentTrail: ["15,10", "15,9"],
    planningLeadTime: 0.5,
  });

  assert.deepEqual([...new Set(routes.map((route) => route.direction))].sort(), ["left", "right", "up"]);
  assert.equal(new Set(routes.map((route) => route.id)).size, routes.length);
  assert.ok(routes.every((route) => route.directions.length === 2));
  assert.ok(routes.every((route) => route.path.length > 0));
  assert.ok(routes.every((route) => Number.isFinite(route.pelletCount)));
  assert.ok(routes.every((route) => Number.isFinite(route.safetyMargin)));
});

test("corridor tracing reaches the next real decision point", () => {
  const leg = traceCorridor({ row: 15, col: 9 }, "up");
  assert.deepEqual(leg.end, { row: 13, col: 7, direction: "left" });
  assert.deepEqual(leg.path, [
    { row: 14, col: 9 },
    { row: 13, col: 9 },
    { row: 13, col: 8 },
    { row: 13, col: 7 },
  ]);
});

test("route fallback prefers survival margin and escape options", () => {
  const selected = chooseRouteFallback([
    { id: "left_then_up", safetyMargin: 0.1, pelletCount: 8, powerPelletCount: 0, escapeRoutes: 1, repeatedCells: 0 },
    { id: "right_then_down", safetyMargin: 2.5, pelletCount: 2, powerPelletCount: 0, escapeRoutes: 3, repeatedCells: 0 },
  ]);
  assert.equal(selected.id, "right_then_down");
});

test("route fallback can intercept an edible ghost during power mode", () => {
  const selected = chooseRouteFallback([
    { id: "left_then_up", safetyMargin: 0.15, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0 },
    { id: "right_then_down", safetyMargin: 3, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0 },
  ], true);
  assert.equal(selected.id, "left_then_up");
});

test("late-game routes know which plan approaches a distant final dot", () => {
  const routes = enumerateRouteCandidates({
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 9, col: 10, speed: 5.2 }],
    pellets: new Set(["1,1"]),
    powerPellets: new Set(),
  });
  const closer = routes.find((route) => route.id === "up_then_left");
  const farther = routes.find((route) => route.id === "left_then_down");

  assert.equal(closer.nearestRemainingFoodRegion, "top-left");
  assert.ok(closer.nearestRemainingFoodDistance < farther.nearestRemainingFoodDistance);
  assert.match(closer.summary, /nearest remaining food/);
});

test("late-game fallback prefers progress toward the final dot", () => {
  const selected = chooseRouteFallback([
    { id: "toward", safetyMargin: 3, pelletCount: 0, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0, remainingFoodAfterRoute: 1, nearestRemainingFoodDistance: 4, nearbyRemainingFood: 1 },
    { id: "away", safetyMargin: 3, pelletCount: 0, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0, remainingFoodAfterRoute: 1, nearestRemainingFoodDistance: 14, nearbyRemainingFood: 0 },
  ]);
  assert.equal(selected.id, "toward");
});
