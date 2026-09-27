import {
  LEVEL_MAP, OPPOSITE, availableDirections, cellKey, createSimulationState,
  isWalkable, mazeRegion, nextCell, simulatePath,
} from "./game-core.js";

export const DEFAULT_SEARCH_DEPTH = 3;
export const DEFAULT_MAX_NODES = 240;

export function enumerateRouteCandidates({
  player, ghosts = [], pellets = new Set(), powerPellets = new Set(), frightenedFor = 0,
  recentTrail = [], playerSpeed, planningLeadTime = 0, foodTarget = null, rows = LEVEL_MAP,
  level = 1, elapsedTime = 0, randomSeed = 0x51a7c0de, searchDepth = DEFAULT_SEARCH_DEPTH,
  maxSearchNodes = DEFAULT_MAX_NODES, simulationState = null,
}) {
  void planningLeadTime;
  const initial = simulationState || createSimulationState({
    player: { ...player, speed: playerSpeed }, ghosts, pellets, powerPellets,
    frightenedFor, level, elapsedTime, seed: randomSeed,
  });
  const trail = new Set(recentTrail);
  const originDistances = buildDistanceMap(player, "player", rows);
  const allFood = new Set([...pellets, ...powerPellets]);
  const localFood = new Set([...allFood].filter((key) => (originDistances.get(key) ?? Infinity) <= 8));
  const context = { rows, foodTarget, trail, localFood, searchDepth: Math.max(1, searchDepth), maxSearchNodes, nodes: 0 };
  const routes = availableDirections(player.row, player.col, "player", rows).map((firstMove) => {
    const leg = traceCorridor(player, firstMove, rows);
    const before = cloneCounts(initial);
    const projected = simulatePath(initial, leg.path, { rows });
    const branch = explore(projected, context.searchDepth - 1, context, [firstMove]);
    return buildRoute({ firstMove, leg, initial, projected, branch, before, context });
  });
  return rankRoutes(routes);
}

function explore(state, depth, context, preview) {
  context.nodes += 1;
  if (state.dead || depth === 0 || context.nodes >= context.maxSearchNodes) return leaf(state, preview, depth === 0);
  const options = availableDirections(state.player.row, state.player.col, "player", context.rows);
  if (!options.length) return leaf(state, preview, false);
  const branches = options.map((direction) => {
    const leg = traceCorridor(state.player, direction, context.rows);
    return explore(simulatePath(state, leg.path, { rows: context.rows }), depth - 1, context, [...preview, direction]);
  });
  const safeCount = branches.filter((branch) => branch.survivedHorizon).length;
  const best = [...branches].sort(compareForecasts)[0];
  return { ...best, safeChoiceCount: safeCount, forcedTrap: safeCount === 0 };
}

function leaf(state, preview, reachedDepth) {
  return {
    survivedHorizon: !state.dead && reachedDepth, collisionOccurred: state.dead,
    survivalHorizon: state.simulatedSeconds, minClearance: state.minClearance,
    safeChoiceCount: state.dead ? 0 : 1, forcedTrap: state.dead, preview, endState: state,
  };
}

function buildRoute({ firstMove, leg, initial, projected, branch, before, context }) {
  const uniquePath = [...new Map(leg.path.map((cell) => [cellKey(cell.row, cell.col), cell])).values()];
  const pelletCount = before.pellets - projected.pellets.size;
  const powerPelletCount = before.powerPellets - projected.powerPellets.size;
  const repeatedCells = uniquePath.filter((cell) => context.trail.has(cellKey(cell.row, cell.col))).length;
  const escapeRoutes = availableDirections(leg.end.row, leg.end.col, "player", context.rows).length;
  const futureFood = assessFutureFood(leg.end, leg.path, initial.pellets, initial.powerPellets, context.rows);
  const targetProgress = assessTargetProgress(context.foodTarget, leg.end, leg.path, context.rows);
  const localFoodCollected = uniquePath.filter((cell) => context.localFood.has(cellKey(cell.row, cell.col))).length;
  const immediateReverse = firstMove === OPPOSITE[initial.player.direction];
  const collisionOccurred = projected.dead || branch.collisionOccurred;
  const survivedHorizon = !collisionOccurred && branch.survivedHorizon;
  const minClearance = Math.min(projected.minClearance, branch.minClearance);
  const survivalHorizon = branch.survivalHorizon;
  const safeContinuationCount = projected.dead ? 0 : branch.safeChoiceCount;
  const forcedTrap = projected.dead || branch.forcedTrap;
  const duration = projected.simulatedSeconds - initial.simulatedSeconds;
  const loopRisk = describeLoopRisk(immediateReverse, repeatedCells, uniquePath.length, pelletCount + powerPelletCount);
  const pressureAtPower = powerPelletCount > 0 && projected.minClearance < 2;
  const ghostsEaten = branch.endState.ghostsEaten - initial.ghostsEaten;
  const powerUse = ghostsEaten > 0 && survivedHorizon ? "edible ghost contact with safe continuation"
    : powerPelletCount === 0 ? "none"
      : pressureAtPower ? "escape under ghost pressure" : "low-pressure use";
  return {
    id: firstMove, direction: firstMove, directions: [firstMove], path: leg.path, endpoint: leg.end, duration,
    collisionOccurred, survivedHorizon, survivalHorizon, safetyMargin: minClearance, minClearance,
    safeContinuationCount, cautionContinuationCount: !forcedTrap && safeContinuationCount === 0 ? 1 : 0,
    bestContinuationSafetyMargin: minClearance, forcedTrap, searchDepth: context.searchDepth,
    simulationSeed: initial.seed, continuationPreview: branch.preview.join(" then "), pelletCount,
    powerPelletCount, powerUse, powerModeRemaining: branch.endState.frightenedFor,
    ghostsEaten, repeatedCells, immediateReverse,
    loopRisk, localFoodTotal: context.localFood.size, localFoodCollected,
    localFoodLeftBehind: Math.max(0, context.localFood.size - localFoodCollected), escapeRoutes,
    ghostRisk: collisionOccurred ? "simulated fatal collision" : `collision-free through ${context.searchDepth} junction decisions`,
    ...futureFood, ...targetProgress, summary: "",
  };
}

function rankRoutes(routes) {
  return [...routes].sort(compareRoutes).map((route, index) => {
    const safety = route.collisionOccurred ? `FATAL after ${round(route.survivalHorizon)}s` : `SAFE for full ${route.searchDepth}-junction horizon`;
    const trap = route.forcedTrap ? "forced trap forecast" : `${route.safeContinuationCount} safe follow-up choices`;
    const summary = `code strategic rank ${index + 1} (lexicographic safety facts); ${safety}; minimum clearance ${round(route.minClearance)} tiles; ${trap}; power use ${route.powerUse}; collects ${route.pelletCount} dots and ${route.powerPelletCount} power pellets; ${route.globalFoodProgress}; ${route.targetPlan}; escape count ${route.escapeRoutes}; ${route.loopRisk}; best continuation ${route.continuationPreview}.`;
    return { ...route, strategicRank: index + 1, strategicScore: null, summary: limitSummary(summary) };
  });
}

function compareRoutes(a, b) {
  const aSafe = a.survivedHorizon ?? (!a.collisionOccurred && finite(a.safetyMargin) > 0.35);
  const bSafe = b.survivedHorizon ?? (!b.collisionOccurred && finite(b.safetyMargin) > 0.35);
  const aClearance = a.minClearance ?? a.safetyMargin ?? -Infinity;
  const bClearance = b.minClearance ?? b.safetyMargin ?? -Infinity;
  const aSurvival = a.survivalHorizon ?? (aSafe ? Infinity : aClearance);
  const bSurvival = b.survivalHorizon ?? (bSafe ? Infinity : bClearance);
  return Number(bSafe) - Number(aSafe)
    || (aSafe && bSafe ? clearanceBand(bClearance) - clearanceBand(aClearance) : bSurvival - aSurvival)
    || Number(a.forcedTrap) - Number(b.forcedTrap) || Number(b.safeContinuationCount > 0) - Number(a.safeContinuationCount > 0)
    || Number(b.escapeRoutes > 1) - Number(a.escapeRoutes > 1) || powerPriority(b) - powerPriority(a)
    || b.powerPelletCount - a.powerPelletCount
    || (a.targetTravelTiles ?? a.nearestRemainingFoodDistance ?? Infinity) - (b.targetTravelTiles ?? b.nearestRemainingFoodDistance ?? Infinity)
    || (b.targetProgressTiles ?? 0) - (a.targetProgressTiles ?? 0)
    || Number(a.immediateReverse) - Number(b.immediateReverse) || b.pelletCount - a.pelletCount || a.repeatedCells - b.repeatedCells
    || b.safeContinuationCount - a.safeContinuationCount || b.escapeRoutes - a.escapeRoutes
    || finite(bClearance) - finite(aClearance)
    || a.id.localeCompare(b.id);
}

function compareForecasts(a, b) {
  return Number(b.survivedHorizon) - Number(a.survivedHorizon) || b.survivalHorizon - a.survivalHorizon
    || finite(b.minClearance) - finite(a.minClearance) || Number(a.forcedTrap) - Number(b.forcedTrap)
    || b.safeChoiceCount - a.safeChoiceCount || a.preview.join(",").localeCompare(b.preview.join(","));
}

function finite(value) { return Number.isFinite(value) ? value : value === -Infinity ? -1e6 : 1e6; }
function clearanceBand(value) { return value >= 2 ? 4 : value >= 1 ? 3 : value >= 0.5 ? 2 : value >= 0 ? 1 : 0; }
function powerPriority(route) { return route.powerUse?.startsWith("edible") ? 3 : route.powerUse?.startsWith("escape") ? 2 : 1; }
function round(value) { return Number.isFinite(value) ? Math.round(value * 100) / 100 : "unbounded"; }
function cloneCounts(state) { return { pellets: state.pellets.size, powerPellets: state.powerPellets.size }; }

export function chooseRouteFallback(routes, frightened = false) {
  if (frightened) return [...routes].sort((a, b) => Math.abs(a.safetyMargin ?? Infinity) - Math.abs(b.safetyMargin ?? Infinity) || compareRoutes(a, b))[0];
  return [...routes].sort(compareRoutes)[0];
}

export function filterSelectableRoutes(routes) {
  const safe = routes.filter((route) => route.survivedHorizon && !route.collisionOccurred);
  const pool = safe.length ? safe : routes;
  if (pool.some((route) => "survivedHorizon" in route)) return pool;
  const nonReversals = pool.filter((route) => !isNoProgressReversal(route));
  if (!nonReversals.length) return pool;
  const alternative = chooseRouteFallback(nonReversals);
  return pool.filter((route) => !isNoProgressReversal(route) || dangerBand(route.safetyMargin) < dangerBand(alternative.safetyMargin));
}

export function traceCorridor(start, initialDirection, rows = LEVEL_MAP) {
  let row = start.row; let col = start.col; let direction = initialDirection; const path = [];
  const limit = rows[0].length * rows.length;
  for (let steps = 0; steps < limit; steps += 1) {
    const next = nextCell(row, col, direction, rows);
    if (!isWalkable(next.row, next.col, "player", rows)) break;
    row = next.row; col = next.col; path.push({ row, col });
    const forward = availableDirections(row, col, "player", rows).filter((option) => option !== OPPOSITE[direction]);
    if (forward.length >= 2 || forward.length === 0) break;
    direction = forward[0];
  }
  return { path, end: { row, col, direction } };
}

export function selectFoodTarget({ player, pellets, powerPellets, preferredKey = null, rows = LEVEL_MAP }) {
  const allFood = new Set([...pellets, ...powerPellets]);
  if (!allFood.size) return null;
  const distances = buildDistanceMap(player, "player", rows);
  const reachable = [...allFood].filter((key) => distances.has(key)).sort((a, b) => distances.get(a) - distances.get(b) || a.localeCompare(b));
  if (!reachable.length) return null;
  const key = preferredKey && allFood.has(preferredKey) && distances.has(preferredKey) ? preferredKey : reachable[0];
  const [row, col] = key.split(",").map(Number);
  return { key, row, col, distance: distances.get(key), region: mazeRegion(key, rows), kind: powerPellets.has(key) ? "power dot" : "regular dot" };
}

function assessTargetProgress(foodTarget, endpoint, routeCells, rows) {
  if (!foodTarget) return { targetCollected: false, targetDistanceAfterRoute: null, targetTravelTiles: null, targetProgressTiles: 0, targetDetourTiles: null, targetPlan: "no food target remains" };
  const targetIndex = routeCells.findIndex((cell) => cellKey(cell.row, cell.col) === foodTarget.key);
  if (targetIndex >= 0) return { targetCollected: true, targetDistanceAfterRoute: 0, targetTravelTiles: targetIndex + 1, targetProgressTiles: foodTarget.distance, targetDetourTiles: Math.max(0, targetIndex + 1 - foodTarget.distance), targetPlan: `reaches committed ${foodTarget.kind} target ${foodTarget.key}` };
  const distance = buildDistanceMap(endpoint, "player", rows).get(foodTarget.key) ?? Infinity;
  const travel = Number.isFinite(distance) ? routeCells.length + distance : Infinity;
  const progress = Number.isFinite(distance) ? foodTarget.distance - distance : 0;
  return { targetCollected: false, targetDistanceAfterRoute: distance, targetTravelTiles: travel, targetProgressTiles: progress, targetDetourTiles: Number.isFinite(travel) ? Math.max(0, travel - foodTarget.distance) : Infinity, targetPlan: `${progress > 0 ? `moves ${progress} tiles closer to` : progress < 0 ? `moves ${-progress} tiles farther from` : "makes no net progress toward"} committed ${foodTarget.kind} target ${foodTarget.key}` };
}

function assessFutureFood(endpoint, routeCells, pellets, powerPellets, rows) {
  const allFood = new Set([...pellets, ...powerPellets]);
  const firstFoodIndex = routeCells.findIndex((cell) => allFood.has(cellKey(cell.row, cell.col)));
  const traversed = new Set(routeCells.map((cell) => cellKey(cell.row, cell.col)));
  const remaining = new Set([...allFood].filter((key) => !traversed.has(key)));
  if (!remaining.size) return { remainingFoodAfterRoute: 0, nearestRemainingFoodDistance: 0, nearestRemainingFoodRegion: "none — route clears the maze", nearbyRemainingFood: 0, estimatedTilesToNextFood: Math.max(0, firstFoodIndex + 1), globalFoodProgress: "clears every remaining dot" };
  const distances = buildDistanceMap(endpoint, "player", rows); let nearest = Infinity; let key = null; let nearby = 0;
  for (const candidate of remaining) { const distance = distances.get(candidate); if (distance === undefined) continue; if (distance <= 8) nearby += 1; if (distance < nearest) { nearest = distance; key = candidate; } }
  const travel = firstFoodIndex >= 0 ? firstFoodIndex + 1 : routeCells.length + nearest;
  return { remainingFoodAfterRoute: remaining.size, nearestRemainingFoodDistance: nearest, nearestRemainingFoodRegion: key ? mazeRegion(key, rows) : "unreachable", nearbyRemainingFood: nearby, estimatedTilesToNextFood: travel, globalFoodProgress: `estimated ${travel} travel tiles to the next food` };
}

function buildDistanceMap(start, actor, rows) {
  const queue = [{ row: start.row, col: start.col, distance: 0 }]; const distances = new Map([[cellKey(start.row, start.col), 0]]);
  for (const current of queue) for (const direction of ["up", "down", "left", "right"]) {
    const next = nextCell(current.row, current.col, direction, rows); const key = cellKey(next.row, next.col);
    if (distances.has(key) || !isWalkable(next.row, next.col, actor, rows)) continue;
    distances.set(key, current.distance + 1); queue.push({ ...next, distance: current.distance + 1 });
  }
  return distances;
}

function isNoProgressReversal(route) { return route.immediateReverse && route.pelletCount + route.powerPelletCount === 0 && (route.loopRisk.startsWith("HIGH") || route.repeatedCells > 0); }
function dangerBand(margin) { return !Number.isFinite(margin) || margin > 1.25 ? 0 : margin > 0.35 ? 1 : 2; }
function describeLoopRisk(immediateReverse, repeatedCells, pathLength, foodCollected) {
  if (immediateReverse && foodCollected === 0 && repeatedCells >= Math.max(1, Math.ceil(pathLength / 3))) return "HIGH LOOP RISK: reverses through a recent empty corridor";
  if (repeatedCells >= Math.max(2, Math.ceil(pathLength / 2))) return "moderate loop risk";
  return "low loop risk";
}
function limitSummary(value) { return value.length <= 500 ? value : `${value.slice(0, 497)}...`; }
