import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest } from "../ai-state.js";
import { OPPOSITE, availableDirections, cellKey, nextCell, parseLevel } from "../game-core.js";

test("rank-one food strategy clears the maze without cycling", () => {
  const level = parseLevel();
  const player = { ...level.player, direction: "left" };
  const trail = [cellKey(player.row, player.col)];
  const visitedStates = new Set();
  let reversals = 0;
  let steps = 0;

  while (level.pellets.size + level.powerPellets.size > 0 && steps < 1_000) {
    level.pellets.delete(cellKey(player.row, player.col));
    level.powerPellets.delete(cellKey(player.row, player.col));
    const options = availableDirections(player.row, player.col);
    const forward = options.filter((direction) => direction !== OPPOSITE[player.direction]);
    let direction;

    if (forward.length === 1) {
      [direction] = forward;
    } else {
      const decision = buildDecisionRequest({
        player,
        ghosts: [],
        pellets: level.pellets,
        powerPellets: level.powerPellets,
        frightenedFor: 0,
        level: 1,
        score: 0,
        recentTrail: trail.slice(-16),
      });
      direction = decision.routes[0].direction;
    }

    if (direction === OPPOSITE[player.direction]) reversals += 1;
    player.direction = direction;
    Object.assign(player, nextCell(player.row, player.col, direction));
    trail.push(cellKey(player.row, player.col));
    steps += 1;

    const stateKey = `${player.row},${player.col},${player.direction},${level.pellets.size},${level.powerPellets.size}`;
    assert.equal(visitedStates.has(stateKey), false, `strategy cycled at ${stateKey}`);
    visitedStates.add(stateKey);
  }

  assert.equal(level.pellets.size + level.powerPellets.size, 0);
  assert.equal(reversals, 0);
  assert.ok(steps < 400, `expected an efficient clear, received ${steps} moves`);
});
