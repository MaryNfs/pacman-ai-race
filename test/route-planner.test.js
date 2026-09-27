import test from "node:test";
import assert from "node:assert/strict";
import { chooseRouteFallback, enumerateRouteCandidates, filterSelectableRoutes, selectFoodTarget, traceCorridor } from "../route-planner.js";
import { parseLevel } from "../game-core.js";

test("route planner enumerates one next-junction plan for every legal move", () => {
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
  assert.ok(routes.every((route) => route.directions.length === 1));
  assert.ok(routes.every((route) => route.path.length > 0));
  assert.ok(routes.every((route) => Number.isFinite(route.pelletCount)));
  assert.ok(routes.every((route) => Number.isFinite(route.safetyMargin)));
  assert.ok(routes.every((route) => Number.isInteger(route.safeContinuationCount)));
  assert.ok(routes.every((route) => Number.isInteger(route.cautionContinuationCount)));
  assert.ok(routes.every((route) => route.summary.length <= 500));
});

test("ghost safety timing includes every food pause along a route", () => {
  const level = parseLevel();
  const input = {
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 13, col: 13, speed: 5.25 }],
    powerPellets: new Set(),
  };
  const withDots = enumerateRouteCandidates({ ...input, pellets: level.pellets });
  const withoutDots = enumerateRouteCandidates({ ...input, pellets: new Set() });
  const dottedRoute = withDots.find((route) => route.id === "up");
  const clearRoute = withoutDots.find((route) => route.id === "up");

  assert.ok(dottedRoute.duration > clearRoute.duration);
  assert.ok(dottedRoute.safetyMargin < clearRoute.safetyMargin);
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

test("predicted fatal timing overrides final-dot target pressure", () => {
  const selected = chooseRouteFallback([
    { id: "target", safetyMargin: -0.68, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 3, repeatedCells: 0, remainingFoodAfterRoute: 4, nearestRemainingFoodDistance: 3, nearbyRemainingFood: 4, targetCollected: true, targetTravelTiles: 1, targetProgressTiles: 1 },
    { id: "escape", safetyMargin: 0.07, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 3, repeatedCells: 0, remainingFoodAfterRoute: 4, nearestRemainingFoodDistance: 5, nearbyRemainingFood: 4, targetCollected: false, targetTravelTiles: 9, targetProgressTiles: -4 },
  ]);

  assert.equal(selected.id, "escape");
});

test("route fallback can intercept an edible ghost during power mode", () => {
  const selected = chooseRouteFallback([
    { id: "left_then_up", safetyMargin: 0.15, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0 },
    { id: "right_then_down", safetyMargin: 3, pelletCount: 1, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0 },
  ], true);
  assert.equal(selected.id, "left_then_up");
});

test("late-game routes know which plan approaches a distant final dot", () => {
  const foodTarget = selectFoodTarget({
    player: { row: 15, col: 9 },
    pellets: new Set(["1,1"]),
    powerPellets: new Set(),
  });
  const routes = enumerateRouteCandidates({
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 9, col: 10, speed: 5.2 }],
    pellets: new Set(["1,1"]),
    powerPellets: new Set(),
    foodTarget,
  });
  const closer = routes.find((route) => route.id === "up");
  const farther = routes.find((route) => route.id === "left");

  assert.equal(closer.nearestRemainingFoodRegion, "top-left");
  assert.ok(closer.nearestRemainingFoodDistance < farther.nearestRemainingFoodDistance);
  assert.match(closer.summary, /travel tiles to the next food/);
  assert.equal(closer.targetTravelTiles, farther.targetTravelTiles);
  assert.ok(closer.targetProgressTiles > farther.targetProgressTiles);
  assert.ok(closer.strategicRank < farther.strategicRank);
  assert.match(closer.summary, /committed regular dot target 1,1/);
});

test("food targeting stays committed while the selected dot remains", () => {
  const food = new Set(["1,1", "21,19"]);
  const selected = selectFoodTarget({
    player: { row: 21, col: 18 },
    pellets: food,
    powerPellets: new Set(),
  });
  const committed = selectFoodTarget({
    player: { row: 1, col: 2 },
    pellets: food,
    powerPellets: new Set(),
    preferredKey: selected.key,
  });

  assert.equal(selected.key, "21,19");
  assert.equal(committed.key, "21,19");
});

test("final-dot ranking strongly prefers safe progress toward the committed target", () => {
  const player = { row: 19, col: 10, direction: "down" };
  const pellets = new Set(["1,1", "1,2", "1,3"]);
  const foodTarget = selectFoodTarget({ player, pellets, powerPellets: new Set() });
  const routes = enumerateRouteCandidates({ player, ghosts: [], pellets, powerPellets: new Set(), foodTarget });

  assert.equal(routes[0].id, "left");
  assert.ok(routes[0].targetProgressTiles > 0);
  assert.ok(routes.at(-1).targetTravelTiles > routes[0].targetTravelTiles);
});

test("late-game fallback prefers progress toward the final dot", () => {
  const selected = chooseRouteFallback([
    { id: "toward", safetyMargin: 3, pelletCount: 0, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0, remainingFoodAfterRoute: 1, nearestRemainingFoodDistance: 4, nearbyRemainingFood: 1 },
    { id: "away", safetyMargin: 3, pelletCount: 0, powerPelletCount: 0, escapeRoutes: 2, repeatedCells: 0, remainingFoodAfterRoute: 1, nearestRemainingFoodDistance: 14, nearbyRemainingFood: 0 },
  ]);
  assert.equal(selected.id, "toward");
});

test("projected recent corridors expose and demote no-progress reversals", () => {
  const level = parseLevel();
  const recentTrail = ["15,12", "15,11", "15,10", "15,9"];
  recentTrail.forEach((key) => level.pellets.delete(key));
  const routes = enumerateRouteCandidates({
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 9, col: 10, speed: 5.2 }],
    pellets: level.pellets,
    powerPellets: level.powerPellets,
    recentTrail,
  });
  const reversal = routes.find((route) => route.id === "right");
  const progressing = routes.find((route) => route.id === "left");

  assert.equal(reversal.immediateReverse, true);
  assert.match(reversal.loopRisk, /HIGH LOOP RISK/);
  assert.ok(reversal.strategicRank > progressing.strategicRank);
  assert.match(routes[0].summary, /code strategic rank 1/);
});

test("route filter excludes a no-progress reversal when another route is equally safe", () => {
  const routes = [
    { id: "right_then_left", immediateReverse: true, loopRisk: "HIGH LOOP RISK", pelletCount: 0, powerPelletCount: 0, repeatedCells: 3, safetyMargin: 2, escapeRoutes: 2 },
    { id: "left_then_down", immediateReverse: false, loopRisk: "low loop risk", pelletCount: 1, powerPelletCount: 0, repeatedCells: 0, safetyMargin: 2, escapeRoutes: 2 },
  ];

  const selectable = filterSelectableRoutes(routes);

  assert.deepEqual(selectable.map((route) => route.id), ["left_then_down"]);
});

test("route filter preserves a U-turn that escapes a worse danger band", () => {
  const routes = [
    { id: "right_then_left", immediateReverse: true, loopRisk: "HIGH LOOP RISK", pelletCount: 0, powerPelletCount: 0, repeatedCells: 3, safetyMargin: 2, escapeRoutes: 2 },
    { id: "left_then_down", immediateReverse: false, loopRisk: "low loop risk", pelletCount: 1, powerPelletCount: 0, repeatedCells: 0, safetyMargin: 0.2, escapeRoutes: 2 },
  ];

  const selectable = filterSelectableRoutes(routes);

  assert.deepEqual(selectable.map((route) => route.id), ["right_then_left", "left_then_down"]);
});

test("fatal candidates are excluded whenever a full-horizon survivor exists", () => {
  const routes = [
    { id: "fatal", survivedHorizon: false, collisionOccurred: true, immediateReverse: false, pelletCount: 20, powerPelletCount: 1 },
    { id: "safe", survivedHorizon: true, collisionOccurred: false, immediateReverse: false, pelletCount: 0, powerPelletCount: 0 },
  ];
  assert.deepEqual(filterSelectableRoutes(routes).map((route) => route.id), ["safe"]);
});

test("all-fatal states retain every least-bad candidate", () => {
  const routes = [
    { id: "short", survivedHorizon: false, collisionOccurred: true, survivalHorizon: 0.4, immediateReverse: false, pelletCount: 0, powerPelletCount: 0 },
    { id: "long", survivedHorizon: false, collisionOccurred: true, survivalHorizon: 1.2, immediateReverse: false, pelletCount: 0, powerPelletCount: 0 },
  ];
  assert.deepEqual(filterSelectableRoutes(routes).map((route) => route.id), ["short", "long"]);
  assert.equal(chooseRouteFallback(routes).id, "long");
});

test("forward forecasts are deterministic and reach three junction decisions", () => {
  const level = parseLevel();
  const input = {
    player: { row: 15, col: 9, direction: "left" },
    ghosts: [{ row: 9, col: 9, direction: "left", name: "Blaze", home: { row: 9, col: 9 }, corner: { row: 1, col: 19 } }],
    pellets: level.pellets, powerPellets: level.powerPellets, randomSeed: 1234, searchDepth: 3,
  };
  const first = enumerateRouteCandidates(input);
  const second = enumerateRouteCandidates(input);
  assert.deepEqual(first.map((route) => [route.id, route.collisionOccurred, route.continuationPreview, route.minClearance]), second.map((route) => [route.id, route.collisionOccurred, route.continuationPreview, route.minClearance]));
  assert.ok(first.every((route) => route.searchDepth === 3 && route.continuationPreview.split(" then ").length === 3));
});
