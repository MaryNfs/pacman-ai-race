import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_MAP,
  availableDirections,
  cellKey,
  isWalkable,
  nextCell,
  parseLevel,
  squaredDistance,
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

test("invalid uneven mazes are rejected", () => {
  assert.throws(() => parseLevel(["###", "##"]), /same width/);
});
