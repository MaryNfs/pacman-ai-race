import { performance } from "node:perf_hooks";
import { cellKey, createSimulationState, parseLevel, simulatePath } from "./game-core.js";
import { enumerateRouteCandidates, filterSelectableRoutes, selectFoodTarget } from "./route-planner.js";

export const SAFETY_BENCHMARK_SEEDS = Object.freeze([137, 2_654_435_906, 1_013_904_379]);
const GHOSTS = Object.freeze([
  { name: "Blaze", corner: { row: 1, col: 19 }, direction: "up" },
  { name: "Flicker", corner: { row: 1, col: 1 }, direction: "left" },
  { name: "Glitch", corner: { row: 21, col: 19 }, direction: "right" },
]);

export function runOfflineBenchmark({ policy = "safety-first", seeds = SAFETY_BENCHMARK_SEEDS, levelGoal = 2, decisionLimit = 600 } = {}) {
  return seeds.map((seed) => runSeed({ policy, seed, levelGoal, decisionLimit }));
}

function runSeed({ policy, seed, levelGoal, decisionLimit }) {
  let parsed = parseLevel();
  let level = 1;
  let deaths = 0;
  let dotsCollected = 0;
  let decisionsMade = 0;
  let predictedSafeDeaths = 0;
  let forcedDangerStates = 0;
  let targetKey = null;
  let trail = [];
  const searchTimes = [];
  let world = freshWorld(parsed, level, seed);

  while (level <= levelGoal && deaths < 3 && decisionsMade < decisionLimit) {
    const target = selectFoodTarget({ player: world.player, pellets: world.pellets, powerPellets: world.powerPellets, preferredKey: targetKey });
    targetKey = target?.key || null;
    const startedAt = performance.now();
    const evaluated = enumerateRouteCandidates({
      player: world.player, ghosts: world.ghosts, pellets: world.pellets, powerPellets: world.powerPellets,
      frightenedFor: world.frightenedFor, level, elapsedTime: world.elapsedTime, randomSeed: world.seed,
      foodTarget: target, recentTrail: trail, simulationState: world,
    });
    searchTimes.push(performance.now() - startedAt);
    const selectable = filterSelectableRoutes(evaluated);
    if (!evaluated.some((route) => route.survivedHorizon && !route.collisionOccurred)) forcedDangerStates += 1;
    const selected = policy === "safety-first" ? selectable[0] : legacySingleCorridorChoice(evaluated);
    const forecastSafe = selected.survivedHorizon && !selected.collisionOccurred;
    const foodBefore = world.pellets.size + world.powerPellets.size;
    world = simulatePath(world, selected.path);
    dotsCollected += foodBefore - world.pellets.size - world.powerPellets.size;
    decisionsMade += 1;
    trail.push(...selected.path.map((cell) => cellKey(cell.row, cell.col)));
    trail = trail.slice(-16);

    if (world.dead) {
      deaths += 1;
      if (forecastSafe) predictedSafeDeaths += 1;
      world = freshWorld(parsed, level, world.seed, world.pellets, world.powerPellets, world.elapsedTime);
      targetKey = null;
      trail = [];
    } else if (world.pellets.size + world.powerPellets.size === 0) {
      level += 1;
      if (level <= levelGoal) {
        parsed = parseLevel();
        world = freshWorld(parsed, level, world.seed, parsed.pellets, parsed.powerPellets, world.elapsedTime);
        targetKey = null;
        trail = [];
      }
    }
  }

  return {
    policy, seed, highestLevelReached: Math.min(level, levelGoal + 1), levelsCleared: Math.min(level - 1, levelGoal),
    deaths, dotsCollected, decisionsMade, predictedSafeDeaths,
    averageSearchTimeMs: searchTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, searchTimes.length),
    maximumSearchTimeMs: Math.max(0, ...searchTimes), forcedDangerStates,
  };
}

function legacySingleCorridorChoice(routes) {
  return [...routes].sort((a, b) => (a.targetTravelTiles ?? Infinity) - (b.targetTravelTiles ?? Infinity)
    || b.pelletCount - a.pelletCount || a.id.localeCompare(b.id))[0];
}

function freshWorld(parsed, level, seed, pellets = parsed.pellets, powerPellets = parsed.powerPellets, elapsedTime = 0) {
  return createSimulationState({
    player: { ...parsed.player, direction: "left" },
    ghosts: parsed.ghosts.map((ghost, index) => ({ ...ghost, ...GHOSTS[index], home: ghost })),
    pellets, powerPellets, level, elapsedTime, seed,
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const baseline = runOfflineBenchmark({ policy: "legacy-single-corridor" });
  const safetyFirst = runOfflineBenchmark({ policy: "safety-first" });
  console.log(JSON.stringify({ baseline, safetyFirst }, null, 2));
}
