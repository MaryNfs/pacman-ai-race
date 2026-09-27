import test from "node:test";
import assert from "node:assert/strict";
import {
  DOT_PAUSE_SECONDS,
  LEVEL_MAP,
  POWER_DOT_PAUSE_SECONDS,
  availableDirections,
  cellKey,
  ghostSpeed,
  isWalkable,
  nextCell,
  pacmanSpeed,
  parseLevel,
  squaredDistance,
  advanceActor,
  beginActorStep,
  chooseGhostDirection,
  createSimulationState,
  ghostTarget,
  makeActor,
  simulatePath,
} from "../game-core.js";

test("maze is rectangular and contains all required actors", () => {
  const parsed = parseLevel();
  assert.equal(parsed.width, 21);
  assert.equal(parsed.height, 23);
  assert.ok(parsed.player);
  assert.equal(parsed.ghosts.length, 3);
  assert.ok(parsed.pellets.size > 100);
  assert.equal(parsed.powerPellets.size, 6);
});

test("players cannot enter walls or the ghost gate", () => {
  assert.equal(isWalkable(0, 0), false);
  const gateRow = LEVEL_MAP.findIndex((row) => row.includes("="));
  const gateCol = LEVEL_MAP[gateRow].indexOf("=");
  assert.equal(isWalkable(gateRow, gateCol), false);
  assert.equal(isWalkable(gateRow, gateCol, "ghost"), true);
});

test("tunnel movement wraps across the board", () => {
  assert.deepEqual(nextCell(9, 0, "left"), { row: 9, col: 20 });
  assert.deepEqual(nextCell(9, 20, "right"), { row: 9, col: 0 });
});

test("available directions only include traversable cells", () => {
  const directions = availableDirections(1, 1);
  assert.deepEqual(directions.sort(), ["down", "right"]);
});

test("every collectible is reachable from the player start", () => {
  const parsed = parseLevel();
  const queue = [parsed.player];
  const visited = new Set([cellKey(parsed.player.row, parsed.player.col)]);

  for (const position of queue) {
    for (const direction of availableDirections(position.row, position.col)) {
      const next = nextCell(position.row, position.col, direction);
      const key = cellKey(next.row, next.col);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(next);
      }
    }
  }

  const unreachable = [...parsed.pellets, ...parsed.powerPellets].filter((key) => !visited.has(key));
  assert.deepEqual(unreachable, []);
});

test("distance helper uses squared Euclidean distance", () => {
  assert.equal(squaredDistance({ row: 1, col: 2 }, { row: 4, col: 6 }), 25);
});

test("arcade-style movement keeps Pacman only slightly faster before dot pauses", () => {
  assert.ok(Math.abs(pacmanSpeed(1) - 5.6) < 1e-12);
  assert.equal(ghostSpeed(1), 5.25);
  assert.ok(pacmanSpeed(1) / ghostSpeed(1) < 1.07);
  assert.equal(pacmanSpeed(1, true), 6.3);
  assert.equal(ghostSpeed(1, true), 3.5);
  assert.equal(DOT_PAUSE_SECONDS, 1 / 60);
  assert.equal(POWER_DOT_PAUSE_SECONDS, 3 / 60);
});

test("invalid uneven mazes are rejected", () => {
  assert.throws(() => parseLevel(["###", "##"]), /same width/);
});

test("shared actor movement preserves live tile-step semantics", () => {
  const actor = makeActor({ row: 3, col: 1 }, "right", pacmanSpeed(1));
  assert.equal(beginActorStep(actor, "right"), true);
  assert.equal(advanceActor(actor, 0.1), false);
  assert.ok(actor.progress > 0 && actor.progress < 1);
  assert.equal(advanceActor(actor, 0.1), true);
  assert.deepEqual({ row: actor.row, col: actor.col, progress: actor.progress }, { row: 3, col: 2, progress: 0 });
});

test("fixed-step simulation includes regular and power-dot pauses and activation", () => {
  const noFood = createSimulationState({ player: { row: 3, col: 1, direction: "right" }, pellets: new Set(), powerPellets: new Set(), ghosts: [], level: 1 });
  const withFood = createSimulationState({ player: { row: 3, col: 1, direction: "right" }, pellets: new Set(["3,2"]), powerPellets: new Set(["3,3"]), ghosts: [], level: 1 });
  const path = [{ row: 3, col: 2 }, { row: 3, col: 3 }];
  const clear = simulatePath(noFood, path);
  const fed = simulatePath(withFood, path);
  assert.ok(fed.simulatedSeconds - clear.simulatedSeconds >= DOT_PAUSE_SECONDS + POWER_DOT_PAUSE_SECONDS - 1 / 120);
  assert.ok(fed.frightenedFor > 7.9);
});

test("continuous collision checks catch head-on passing between tile centers", () => {
  const rows = ["#######", "#     #", "#######"];
  const world = createSimulationState({
    player: { row: 1, col: 1, direction: "right" },
    ghosts: [{ row: 1, col: 5, direction: "left", name: "Blaze", home: { row: 1, col: 5 }, corner: { row: 1, col: 5 } }],
    pellets: new Set(), powerPellets: new Set(), level: 1,
  });
  const result = simulatePath(world, [{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }], { rows });
  assert.equal(result.dead, true);
  assert.ok(result.minClearance < 0);
});

test("power expiration before contact makes the ghost dangerous again", () => {
  const rows = ["#######", "#     #", "#######"];
  const world = createSimulationState({
    player: { row: 1, col: 1, direction: "right" },
    ghosts: [{ row: 1, col: 5, direction: "left", name: "Blaze", home: { row: 1, col: 5 }, corner: { row: 1, col: 5 } }],
    frightenedFor: 0.1, pellets: new Set(), powerPellets: new Set(), level: 1,
  });
  const result = simulatePath(world, [{ row: 1, col: 2 }, { row: 1, col: 3 }, { row: 1, col: 4 }], { rows });
  assert.equal(result.dead, true);
  assert.equal(result.ghostsEaten, 0);
});

test("chase/scatter targeting and frightened choices are deterministic", () => {
  const player = makeActor({ row: 3, col: 1 }, "right", pacmanSpeed(1));
  const ghost = { ...makeActor({ row: 3, col: 5 }, "left", ghostSpeed(1)), name: "Blaze", corner: { row: 1, col: 19 } };
  assert.deepEqual(ghostTarget({ ghost, player, elapsedTime: 0 }), { row: 3, col: 1 });
  assert.deepEqual(ghostTarget({ ghost, player, elapsedTime: 21 }), ghost.corner);
  const first = chooseGhostDirection({ ghost, player, frightenedFor: 2, elapsedTime: 0, seed: 99 });
  const second = chooseGhostDirection({ ghost, player, frightenedFor: 2, elapsedTime: 0, seed: 99 });
  assert.deepEqual(first, second);
});
