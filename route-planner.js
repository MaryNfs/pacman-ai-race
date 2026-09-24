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
        playerSpeed,
        planningLeadTime,
        rows,
      }));
    }
  }

  return routes;
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
    const safety = Number.isFinite(route.safetyMargin) ? route.safetyMargin : 20;
    const ghostValue = frightened ? -Math.abs(safety) : safety * 8;
    const remainingFood = Number.isFinite(route.remainingFoodAfterRoute) ? route.remainingFoodAfterRoute : Infinity;
    const foodDistance = Number.isFinite(route.nearestRemainingFoodDistance) ? route.nearestRemainingFoodDistance : 0;
    const finalHuntWeight = remainingFood <= 40 ? 5 : 2;
    const globalFoodValue = remainingFood === 0
      ? 100
      : (Number.isFinite(remainingFood) ? -foodDistance * finalHuntWeight + route.nearbyRemainingFood * 1.5 : 0);
    const value = ghostValue + route.pelletCount * 3 + route.powerPelletCount * 12 + route.escapeRoutes * 2 - route.repeatedCells * 2 + globalFoodValue;
    return !best || value > best.value ? { route, value } : best;
  }, null)?.route;
}

function assessRoute({ id, directions, path, endpoint, ghosts, pellets, powerPellets, frightenedFor, trail, playerSpeed, planningLeadTime, rows }) {
  const uniquePath = [...new Map(path.map((cell) => [cellKey(cell.row, cell.col), cell])).values()];
  const pelletCount = uniquePath.filter((cell) => pellets.has(cellKey(cell.row, cell.col))).length;
  const powerPelletCount = uniquePath.filter((cell) => powerPellets.has(cellKey(cell.row, cell.col))).length;
  const repeatedCells = uniquePath.filter((cell) => trail.has(cellKey(cell.row, cell.col))).length;
  const escapeRoutes = availableDirections(endpoint.row, endpoint.col, "player", rows).length;
  const duration = path.length / playerSpeed;
  const safetyMargin = calculateSafetyMargin(path, ghosts, playerSpeed, planningLeadTime);
  const futureFood = assessFutureFood(endpoint, uniquePath, pellets, powerPellets, rows);
  const ghostRisk = describeRouteRisk(safetyMargin, frightenedFor, duration);
  const foodYield = describeYield(pelletCount);
  const powerYield = powerPelletCount > 0 ? "collects a power pellet" : "collects no power pellet";
  const escapeQuality = escapeRoutes >= 3 ? "many exits" : escapeRoutes === 2 ? "two exits" : "a dead end";
  const repetition = repeatedCells === 0 ? "avoids the recent path" : repeatedCells >= Math.ceil(uniquePath.length / 2) ? "mostly repeats the recent path" : "partly repeats the recent path";
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
    escapeRoutes,
    duration,
    safetyMargin,
    ...futureFood,
    ghostRisk,
    foodYield,
    powerYield,
    escapeQuality,
    repetition,
    summary: `${label}: ${ghostRisk}; ${foodYield}; ${powerYield}; ${futureFood.globalFoodProgress}; ends with ${escapeQuality}; ${repetition}.`,
  };
}

function assessFutureFood(endpoint, routeCells, pellets, powerPellets, rows) {
  const collectedKeys = new Set(routeCells.map((cell) => cellKey(cell.row, cell.col)));
  const remainingFood = new Set([...pellets, ...powerPellets].filter((key) => !collectedKeys.has(key)));

  if (remainingFood.size === 0) {
    return {
      remainingFoodAfterRoute: 0,
      nearestRemainingFoodDistance: 0,
      nearestRemainingFoodRegion: "none — route clears the maze",
      nearbyRemainingFood: 0,
      globalFoodProgress: "clears every remaining dot",
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
  const globalFoodProgress = Number.isFinite(nearestDistance)
    ? `nearest remaining food after this route is ${nearestDistance} maze tiles away in the ${nearestRemainingFoodRegion}; ${nearbyRemainingFood} remaining dots are within 8 tiles`
    : "remaining food is unreachable from this endpoint";

  return {
    remainingFoodAfterRoute: remainingFood.size,
    nearestRemainingFoodDistance: nearestDistance,
    nearestRemainingFoodRegion,
    nearbyRemainingFood,
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
