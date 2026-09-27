import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionRequest } from "../ai-state.js";
import { OPPOSITE, availableDirections, createSimulationState, simulatePath, cellKey, nextCell, parseLevel } from "../game-core.js";
import { enumerateRouteCandidates, filterSelectableRoutes, selectFoodTarget } from "../route-planner.js";

test("rank-one food strategy clears the maze without cycling", () => {
  const level = parseLevel();
  const player = { ...level.player, direction: "left" };
  const trail = [cellKey(player.row, player.col)];
  const visitedStates = new Set();
  let reversals = 0;
  let steps = 0;
  let foodTargetKey = null;

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
        recentTrail: trail.slice(-16),
        preferredFoodTargetKey: foodTargetKey,
      });
      foodTargetKey = decision.meta.foodTargetKey;
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
  assert.ok(reversals <= 10, `expected only bounded target-correction reversals, received ${reversals}`);
  assert.ok(steps < 350, `expected an efficient clear, received ${steps} moves`);
});

const FIXED_SURVIVAL_SEEDS = [137, 2_654_435_906, 1_013_904_379];
const ghostProfiles = [
  { name: "Blaze", corner: { row: 1, col: 19 }, direction: "up" },
  { name: "Flicker", corner: { row: 1, col: 1 }, direction: "left" },
  { name: "Glitch", corner: { row: 21, col: 19 }, direction: "right" },
];

test("fixed-seed rank-one policy clears two levels with active ghosts", () => {
  for (const seed of FIXED_SURVIVAL_SEEDS) {
    let levelNumber = 1;
    let deaths = 0;
    let decisions = 0;
    let predictedSafeDeaths = 0;
    let targetKey = null;
    let trail = [];
    let parsed = parseLevel();
    let world = newWorld(parsed, levelNumber, seed);

    while (levelNumber <= 2 && deaths < 3 && decisions < 600) {
      const target = selectFoodTarget({ player: world.player, pellets: world.pellets, powerPellets: world.powerPellets, preferredKey: targetKey });
      targetKey = target?.key || null;
      const routes = filterSelectableRoutes(enumerateRouteCandidates({
        player: world.player, ghosts: world.ghosts, pellets: world.pellets, powerPellets: world.powerPellets,
        frightenedFor: world.frightenedFor, level: levelNumber, elapsedTime: world.elapsedTime,
        randomSeed: world.seed, foodTarget: target, recentTrail: trail, simulationState: world,
      }));
      const selected = routes[0];
      const forecastSafe = selected.survivedHorizon && !selected.collisionOccurred;
      world = simulatePath(world, selected.path);
      decisions += 1;
      trail.push(...selected.path.map((cell) => cellKey(cell.row, cell.col)));
      trail = trail.slice(-16);

      if (world.dead) {
        deaths += 1;
        if (forecastSafe) predictedSafeDeaths += 1;
        world = newWorld(parsed, levelNumber, world.seed, world.pellets, world.powerPellets, world.elapsedTime);
        targetKey = null;
        trail = [];
      } else if (world.pellets.size + world.powerPellets.size === 0) {
        levelNumber += 1;
        if (levelNumber <= 2) {
          parsed = parseLevel();
          world = newWorld(parsed, levelNumber, world.seed, parsed.pellets, parsed.powerPellets, world.elapsedTime);
          targetKey = null;
          trail = [];
        }
      }
    }

    assert.equal(levelNumber, 3, `seed ${seed} did not clear two levels`);
    assert.equal(deaths, 0, `seed ${seed} lost a life`);
    assert.equal(predictedSafeDeaths, 0, `seed ${seed} had a forecast mismatch`);
    assert.ok(decisions < 600, `seed ${seed} exceeded the decision bound`);
  }
});

function newWorld(parsed, level, seed, pellets = parsed.pellets, powerPellets = parsed.powerPellets, elapsedTime = 0) {
  return createSimulationState({
    player: { ...parsed.player, direction: "left" },
    ghosts: parsed.ghosts.map((ghost, index) => ({ ...ghost, ...ghostProfiles[index], home: ghost })),
    pellets, powerPellets, level, elapsedTime, seed,
  });
}
