import { LEVEL_MAP, OPPOSITE, availableDirections, cellKey, isWalkable, mazeRegion, nextCell } from "./game-core.js";

export function enumerateRouteCandidates({
  player,
  ghosts,
  pellets,
  powerPellets,
  frightenedFor = 0,
  recentTrail = [],
  playerSpeed = 6.35,
  planningLeadTime = 0,
  rows = LEVEL_MAP,
}) {
  const ghostDistanceMaps = ghosts.map((ghost) => ({
    ghost,
    distances: buildDistanceMap({ row: Math.round(ghost.row), col: Math.round(ghost.col) }, "ghost", rows),
  }));
  const trail = new Set(recentTrail);
  const food = new Set([...pellets, ...powerPellets]);
  const originDistances = buildDistanceMap(player, "player", rows);
  const localFood = new Set([...food].filter((key) => (originDistances.get(key) ?? Infinity) <= 8));
  const routes = [];

  for (const firstMove of availableDirections(player.row, player.col, "player", rows)) {
    const firstLeg = traceCorridor(player, firstMove, rows);
    const secondMoves = availableDirections(firstLeg.end.row, firstLeg.end.col, "player", rows);

    if (secondMoves.length === 0) {
      routes.push(assessRoute({
        id: firstMove,
        directions: [firstMove],
        path: firstLeg.path,
        endpoint: firstLeg.end,
        ghosts: ghostDistanceMaps,
        pellets,
        powerPellets,
        frightenedFor,
        trail,
        localFood,
        currentHeading: player.direction,
        playerSpeed,
        planningLeadTime,
        rows,
      }));
      continue;
    }

    for (const secondMove of secondMoves) {
      const secondLeg = traceCorridor(firstLeg.end, secondMove, rows);
      routes.push(assessRoute({
        id: `${firstMove}_then_${secondMove}`,
        directions: [firstMove, secondMove],
        path: [...firstLeg.path, ...secondLeg.path],
        endpoint: secondLeg.end,
        ghosts: ghostDistanceMaps,
        pellets,
        powerPellets,
        frightenedFor,
        trail,
        localFood,
        currentHeading: player.direction,
        playerSpeed,
        planningLeadTime,
        rows,
      }));
    }
  }

  return rankRoutes(routes, frightenedFor > 0);
}

export function traceCorridor(start, initialDirection, rows = LEVEL_MAP) {
  let row = start.row;
  let col = start.col;
  let direction = initialDirection;
  const path = [];
  const limit = rows[0].length * rows.length;

  for (let steps = 0; steps < limit; steps += 1) {
    const next = nextCell(row, col, direction, rows);
    if (!isWalkable(next.row, next.col, "player", rows)) break;
    row = next.row;
    col = next.col;
    path.push({ row, col });

    const forward = availableDirections(row, col, "player", rows)
      .filter((option) => option !== OPPOSITE[direction]);
    if (forward.length >= 2 || forward.length === 0) break;
    direction = forward[0];
  }

  return { path, end: { row, col, direction } };
}

export function chooseRouteFallback(routes, frightened = false) {
  return routes.reduce((best, route) => {
    const value = routeUtility(route, frightened);
    return !best || value > best.value ? { route, value } : best;
  }, null)?.route;
}

export function guardAgainstRepeatedReversal(routes, selectedRouteId, frightened = false) {
  const selectedRoute = routes.find((route) => route.id === selectedRouteId);
  if (!selectedRoute || !isNoProgressReversal(selectedRoute)) {
    return { route: selectedRoute, overridden: false, proposedRoute: selectedRoute };
  }

  const alternatives = routes.filter((route) => !isNoProgressReversal(route));
  const alternative = chooseRouteFallback(alternatives, frightened);
  if (!alternative || isSafetyUpgrade(selectedRoute, alternative, frightened)) {
    return { route: selectedRoute, overridden: false, proposedRoute: selectedRoute };
  }

  return {
    route: alternative,
    overridden: true,
    proposedRoute: selectedRoute,
    reason: "blocked a no-progress U-turn because another route was at least as safe",
  };
}

function assessRoute({ id, directions, path, endpoint, ghosts, pellets, powerPellets, frightenedFor, trail, localFood, currentHeading, playerSpeed, planningLeadTime, rows }) {
  const uniquePath = [...new Map(path.map((cell) => [cellKey(cell.row, cell.col), cell])).values()];
  const pelletCount = uniquePath.filter((cell) => pellets.has(cellKey(cell.row, cell.col))).length;
  const powerPelletCount = uniquePath.filter((cell) => powerPellets.has(cellKey(cell.row, cell.col))).length;
  const repeatedCells = uniquePath.filter((cell) => trail.has(cellKey(cell.row, cell.col))).length;
  const escapeRoutes = availableDirections(endpoint.row, endpoint.col, "player", rows).length;
  const duration = path.length / playerSpeed;
  const safetyMargin = calculateSafetyMargin(path, ghosts, playerSpeed, planningLeadTime);
  const futureFood = assessFutureFood(endpoint, path, pellets, powerPellets, rows);
  const localFoodCollected = uniquePath.filter((cell) => localFood.has(cellKey(cell.row, cell.col))).length;
  const localFoodLeftBehind = Math.max(0, localFood.size - localFoodCollected);
  const immediateReverse = directions[0] === OPPOSITE[currentHeading];
  const ghostRisk = describeRouteRisk(safetyMargin, frightenedFor, duration);
  const foodYield = describeYield(pelletCount);
  const powerYield = powerPelletCount > 0 ? "collects a power pellet" : "collects no power pellet";
  const escapeQuality = escapeRoutes >= 3 ? "many exits" : escapeRoutes === 2 ? "two exits" : "a dead end";
  const repetition = repeatedCells === 0 ? "avoids the recent path" : repeatedCells >= Math.ceil(uniquePath.length / 2) ? "mostly repeats the recent path" : "partly repeats the recent path";
  const localFoodCoverage = describeLocalFood(localFood.size, localFoodCollected, localFoodLeftBehind);
  const loopRisk = describeLoopRisk(immediateReverse, repeatedCells, uniquePath.length, pelletCount + powerPelletCount);
  const label = directions.join(" then ");

  return {
    id,
    direction: directions[0],
    directions,
    path,
    endpoint,
    pelletCount,
    powerPelletCount,
    repeatedCells,
    immediateReverse,
    loopRisk,
    localFoodTotal: localFood.size,
    localFoodCollected,
    localFoodLeftBehind,
    localFoodCoverage,
    escapeRoutes,
    duration,
    safetyMargin,
    ...futureFood,
    ghostRisk,
    foodYield,
    powerYield,
    escapeQuality,
    repetition,
    summary: `${label}: ${ghostRisk}; ${loopRisk}; ${foodYield}; ${powerYield}; ${futureFood.globalFoodProgress}; ${localFoodCoverage}; ends with ${escapeQuality}; ${repetition}.`,
  };
}

function rankRoutes(routes, frightened) {
  return routes
    .map((route) => ({ ...route, strategicScore: Math.round(routeUtility(route, frightened)) }))
    .sort((a, b) => b.strategicScore - a.strategicScore || a.id.localeCompare(b.id))
    .map((route, index, ranked) => ({
      ...route,
      strategicRank: index + 1,
      summary: limitSummary(`code strategic rank ${index + 1} of ${ranked.length} (score ${route.strategicScore}); ${route.summary}`),
    }));
}

function limitSummary(summary) {
  return summary.length <= 500 ? summary : `${summary.slice(0, 497)}...`;
}

function routeUtility(route, frightened) {
  const safety = Number.isFinite(route.safetyMargin) ? route.safetyMargin : 3;
  const ghostValue = frightened
    ? -Math.abs(safety) * 6
    : safety <= 0.35
      ? -180 + Math.max(-3, safety) * 10
      : safety <= 1.25
        ? -45 + safety * 10
        : Math.min(3, safety) * 25;
  const remainingFood = Number.isFinite(route.remainingFoodAfterRoute) ? route.remainingFoodAfterRoute : Infinity;
  const foodTravel = Number.isFinite(route.estimatedTilesToNextFood)
    ? route.estimatedTilesToNextFood
    : (Number.isFinite(route.nearestRemainingFoodDistance) ? route.nearestRemainingFoodDistance : 0);
  const finalHuntWeight = remainingFood <= 40 ? 5 : 1.5;
  const globalFoodValue = remainingFood === 0
    ? 120
    : (Number.isFinite(remainingFood) ? -foodTravel * finalHuntWeight + (route.nearbyRemainingFood || 0) : 0);
  const collectionValue = (route.pelletCount || 0) * 16 + (route.powerPelletCount || 0) * 32;
  const localCompletionValue = -(route.localFoodLeftBehind || 0) * 7;
  const repetitionPenalty = (route.repeatedCells || 0) * 6;
  const emptyReversePenalty = route.immediateReverse && collectionValue === 0 ? 80 : 0;
  return ghostValue + collectionValue + globalFoodValue + localCompletionValue
    + (route.escapeRoutes || 0) * 2 - repetitionPenalty - emptyReversePenalty;
}

function isNoProgressReversal(route) {
  return route.immediateReverse === true
    && (route.pelletCount || 0) + (route.powerPelletCount || 0) === 0
    && (route.loopRisk?.startsWith("HIGH") || (route.repeatedCells || 0) > 0);
}

function isSafetyUpgrade(reversal, alternative, frightened) {
  if (frightened) return false;
  return dangerBand(reversal.safetyMargin) < dangerBand(alternative.safetyMargin);
}

function dangerBand(margin) {
  if (!Number.isFinite(margin) || margin > 1.25) return 0;
  if (margin > 0.35) return 1;
  return 2;
}

function assessFutureFood(endpoint, routeCells, pellets, powerPellets, rows) {
  const allFood = new Set([...pellets, ...powerPellets]);
  const firstFoodIndex = routeCells.findIndex((cell) => allFood.has(cellKey(cell.row, cell.col)));
  const collectedKeys = new Set(routeCells.map((cell) => cellKey(cell.row, cell.col)));
  const remainingFood = new Set([...allFood].filter((key) => !collectedKeys.has(key)));

  if (remainingFood.size === 0) {
    return {
      remainingFoodAfterRoute: 0,
      nearestRemainingFoodDistance: 0,
      nearestRemainingFoodRegion: "none — route clears the maze",
      nearbyRemainingFood: 0,
      estimatedTilesToNextFood: firstFoodIndex >= 0 ? firstFoodIndex + 1 : 0,
      globalFoodProgress: `clears every remaining dot; next food is reached in ${firstFoodIndex + 1} travel tiles`,
    };
  }

  const distances = buildDistanceMap(endpoint, "player", rows);
  let nearestDistance = Infinity;
  let nearestKey = null;
  let nearbyRemainingFood = 0;

  for (const key of remainingFood) {
    const distance = distances.get(key);
    if (distance === undefined) continue;
    if (distance <= 8) nearbyRemainingFood += 1;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  }

  const nearestRemainingFoodRegion = nearestKey ? mazeRegion(nearestKey, rows) : "unreachable";
  const estimatedTilesToNextFood = firstFoodIndex >= 0
    ? firstFoodIndex + 1
    : routeCells.length + nearestDistance;
  const globalFoodProgress = Number.isFinite(nearestDistance)
    ? `estimated ${estimatedTilesToNextFood} total travel tiles to the next food; nearest food after this route is ${nearestDistance} tiles away in the ${nearestRemainingFoodRegion}; ${nearbyRemainingFood} remaining dots are within 8 tiles`
    : "remaining food is unreachable from this endpoint";

  return {
    remainingFoodAfterRoute: remainingFood.size,
    nearestRemainingFoodDistance: nearestDistance,
    nearestRemainingFoodRegion,
    nearbyRemainingFood,
    estimatedTilesToNextFood,
    globalFoodProgress,
  };
}

function calculateSafetyMargin(path, ghosts, playerSpeed, planningLeadTime) {
  let margin = Infinity;
  path.forEach((cell, index) => {
    const playerArrival = (index + 1) / playerSpeed;
    for (const { ghost, distances } of ghosts) {
      const steps = distances.get(cellKey(cell.row, cell.col));
      if (steps === undefined) continue;
      const ghostArrival = steps / Math.max(ghost.speed || 5.2, 0.1) - planningLeadTime;
      margin = Math.min(margin, ghostArrival - playerArrival);
    }
  });
  return margin;
}

function buildDistanceMap(start, actor, rows) {
  const queue = [{ ...start, distance: 0 }];
  const distances = new Map([[cellKey(start.row, start.col), 0]]);
  for (const current of queue) {
    for (const direction of ["up", "down", "left", "right"]) {
      const next = nextCell(current.row, current.col, direction, rows);
      const key = cellKey(next.row, next.col);
      if (distances.has(key) || !isWalkable(next.row, next.col, actor, rows)) continue;
      distances.set(key, current.distance + 1);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }
  return distances;
}

function describeRouteRisk(margin, frightenedFor, duration) {
  if (frightenedFor > 0) {
    if (frightenedFor <= duration) return "power mode may expire before the route ends";
    if (margin <= 0.5) return "strong opportunity to intercept an edible ghost";
    if (margin <= 1.5) return "an edible ghost may be reachable";
    return "no edible ghost interception is likely";
  }
  if (margin <= 0.35) return "high predicted collision risk";
  if (margin <= 1.25) return "tight ghost timing; use caution";
  return "comfortable predicted ghost margin";
}

function describeYield(count) {
  if (count >= 6) return "collects many food dots";
  if (count >= 3) return "collects several food dots";
  if (count >= 1) return "collects few food dots";
  return "collects no food dots";
}

function describeLocalFood(total, collected, leftBehind) {
  if (total === 0) return "no food was within 8 tiles of the starting junction";
  if (leftBehind === 0) return `clears all ${total} dots that were within 8 tiles of the starting junction`;
  return `collects ${collected} of ${total} nearby starting dots and leaves ${leftBehind} behind`;
}

function describeLoopRisk(immediateReverse, repeatedCells, pathLength, foodCollected) {
  if (immediateReverse && foodCollected === 0 && repeatedCells >= Math.max(1, Math.ceil(pathLength / 3))) {
    return "HIGH LOOP RISK: immediately reverses through a recent corridor without collecting food";
  }
  if (repeatedCells >= Math.max(2, Math.ceil(pathLength / 2))) {
    return "moderate loop risk from repeating much of the recent path";
  }
  return "low loop risk";
}
