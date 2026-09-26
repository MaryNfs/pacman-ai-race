import { DIRECTIONS, LEVEL_MAP, OPPOSITE, availableDirections, cellKey, isWalkable, mazeRegion, nextCell } from "./game-core.js";
import { enumerateRouteCandidates, filterSelectableRoutes } from "./route-planner.js";

export function buildDecisionRequest({ player, ghosts, pellets, powerPellets, frightenedFor, level, lives = 3, recentTrail = [], playerSpeed = 6.35, planningLeadTime = 0 }) {
  const options = availableDirections(player.row, player.col);
  const frightened = frightenedFor > 0;

  const assessments = options.map((direction) => {
    const destination = nextCell(player.row, player.col, direction);
    const pelletDistance = nearestDistance(destination, new Set([...pellets, ...powerPellets]));
    const powerDistance = nearestDistance(destination, powerPellets);
    const ghostDistance = nearestGhostDistance(destination, ghosts);
    const danger = describeDanger(ghostDistance, frightened);
    const food = describeDistance(pelletDistance);
    const power = powerPellets.size === 0 ? "none remain" : describeDistance(powerDistance);
    return {
      direction,
      destination,
      pelletDistance,
      powerDistance,
      ghostDistance,
      danger,
      food,
      power,
      maneuver: describeManeuver(direction, player.direction),
      summary: `${direction}: walkable; ${describeManeuver(direction, player.direction)}; ${danger}; regular food is ${food}; power food is ${power}.`,
    };
  });
  const assessmentByDirection = new Map(assessments.map((assessment) => [assessment.direction, assessment]));
  const allRoutes = enumerateRouteCandidates({ player, ghosts, pellets, powerPellets, frightenedFor, recentTrail, playerSpeed, planningLeadTime });
  const routes = filterSelectableRoutes(allRoutes, frightened);
  const blockedRouteIds = allRoutes.filter((route) => !routes.includes(route)).map((route) => route.id);

  return {
    meta: { row: player.row, col: player.col },
    state: {
      game: "Pacman maze chase",
      objective: "Survive and clear every food dot.",
      mode: frightened ? "power mode: ghosts are edible" : "normal mode: ghosts are dangerous",
      progress: progressLabel(pellets.size + powerPellets.size),
      lives,
      currentHeading: player.direction,
      plannedDecisionPosition: { row: player.row, col: player.col },
      powerModeSecondsRemaining: rounded(frightenedFor),
      recentPacmanTiles: recentTrail.slice(-8),
      forecast: {
        planStartsInSeconds: rounded(planningLeadTime),
        method: "conservative shortest-path ghost timing from the live snapshot",
      },
      levelNumber: level,
      level: level > 3 ? "advanced speed" : level > 1 ? "increased speed" : "base speed",
      antiLoopRule: {
        blockedRouteIds,
        explanation: "Recent foodless U-turns are excluded unless they improve Pacman's ghost-danger band.",
      },
      wholeMazeSnapshot: buildMazeSnapshot(player, ghosts, pellets, powerPellets, frightenedFor),
      directionAssessments: Object.fromEntries(Object.keys(DIRECTIONS).map((direction) => {
        const assessment = assessmentByDirection.get(direction);
        return [direction, assessment
          ? {
              availability: "walkable",
              maneuver: assessment.maneuver,
              ghostSafety: assessment.danger,
              regularFood: assessment.food,
              powerFood: assessment.power,
            }
          : { availability: "blocked by wall" }];
      })),
      routeCandidates: Object.fromEntries(routes.map((route) => [route.id, {
        firstMove: route.directions[0],
        secondMove: route.directions[1] || "none",
        routeTiles: route.path.length,
        routeDurationSeconds: rounded(route.duration),
        nearestGhostLeadSeconds: Number.isFinite(route.safetyMargin) ? rounded(route.safetyMargin) : "unreachable",
        ghostTiming: route.ghostRisk,
        foodDots: route.pelletCount,
        powerPellets: route.powerPelletCount,
        remainingDotsAfterRoute: route.remainingFoodAfterRoute,
        estimatedTravelTilesToNextDot: route.estimatedTilesToNextFood,
        nearestRemainingDotDistance: route.nearestRemainingFoodDistance,
        nearestRemainingDotRegion: route.nearestRemainingFoodRegion,
        remainingDotsWithin8Tiles: route.nearbyRemainingFood,
        destinationExitCount: route.escapeRoutes,
        recentPathTiles: route.repeatedCells,
        immediateReverse: route.immediateReverse,
        nearbyStartingDotsLeftBehind: route.localFoodLeftBehind,
        codeStrategicRank: route.strategicRank,
        codeStrategicScore: route.strategicScore,
      }])),
    },
    routeChoices: routes.map(({ id, direction, directions, summary }) => ({ id, direction, directions, summary })),
    assessments,
    routes,
  };
}

export function buildMazeSnapshot(player, ghosts, pellets, powerPellets, frightenedFor = 0, rows = LEVEL_MAP) {
  const regions = {};
  for (const key of [...pellets, ...powerPellets]) {
    const region = mazeRegion(key, rows);
    regions[region] = (regions[region] || 0) + 1;
  }

  const ghostTiles = new Map();
  ghosts.forEach((ghost, index) => {
    const key = cellKey(Math.round(ghost.row), Math.round(ghost.col));
    const marker = ghostMarker(index, frightenedFor > 0);
    ghostTiles.set(key, ghostTiles.has(key) ? "*" : marker);
  });

  const mapTopToBottom = rows.map((row, rowIndex) => [...row].map((cell, colIndex) => {
    const key = cellKey(rowIndex, colIndex);
    if (rowIndex === player.row && colIndex === player.col) return "P";
    if (ghostTiles.has(key)) return ghostTiles.get(key);
    if (pellets.has(key)) return ".";
    if (powerPellets.has(key)) return "o";
    if (cell === "#" || cell === "=") return cell;
    return " ";
  }).join(""));

  return {
    legend: "# wall, . food dot, o power dot, P planned decision cell, A/B/C dangerous ghosts, a/b/c edible ghosts, * stacked ghosts, blank cleared path",
    remainingRegularDots: pellets.size,
    remainingPowerDots: powerPellets.size,
    dotsByRegion: regions,
    ghosts: ghosts.map((ghost, index) => ({
      marker: ghostMarker(index, frightenedFor > 0),
      name: ghost.name || `Ghost ${index + 1}`,
      position: { row: rounded(ghost.row), col: rounded(ghost.col) },
      tile: { row: Math.round(ghost.row), col: Math.round(ghost.col) },
      heading: ghost.direction || "unknown",
      speedTilesPerSecond: rounded(ghost.speed || 5.2),
      state: frightenedFor > 0 ? "edible" : "dangerous",
      approximateTileDistanceFromPacman: rounded(approximateDistance(player, ghost, rows)),
    })),
    mapTopToBottom,
  };
}

export function projectRouteState({ path, pellets, powerPellets, frightenedFor = 0, playerSpeed = 6.35 }) {
  const projectedPellets = new Set(pellets);
  const projectedPowerPellets = new Set(powerPellets);
  let projectedFrightenedFor = frightenedFor;

  path.forEach((cell) => {
    projectedFrightenedFor = Math.max(0, projectedFrightenedFor - 1 / playerSpeed);
    const key = cellKey(cell.row, cell.col);
    projectedPellets.delete(key);
    if (projectedPowerPellets.delete(key)) projectedFrightenedFor = 8;
  });

  return {
    pellets: projectedPellets,
    powerPellets: projectedPowerPellets,
    frightenedFor: projectedFrightenedFor,
  };
}

function ghostMarker(index, frightened) {
  const marker = String.fromCharCode(65 + Math.min(index, 25));
  return frightened ? marker.toLowerCase() : marker;
}

function approximateDistance(player, ghost, rows) {
  const rowDistance = Math.abs(player.row - ghost.row);
  const rawColDistance = Math.abs(player.col - ghost.col);
  return rowDistance + Math.min(rawColDistance, rows[0].length - rawColDistance);
}

function describeManeuver(direction, currentHeading) {
  if (direction === currentHeading) return "continues forward";
  if (direction === OPPOSITE[currentHeading]) return "reverses direction with a U-turn";
  return "turns at the junction";
}

export function findNextJunction(player, initialDirection, rows = LEVEL_MAP) {
  return scanCorridor(player, initialDirection, rows).junction;
}

export function findCorridorThreat(player, initialDirection, ghosts, playerSpeed = 6.35, frightenedFor = 0, rows = LEVEL_MAP) {
  const scan = scanCorridor(player, initialDirection, rows);
  for (const checkpoint of scan.checkpoints) {
    const playerArrival = checkpoint.steps / playerSpeed;
    if (frightenedFor > playerArrival) continue;

    let nearestLead = Infinity;
    for (const ghost of ghosts) {
      const target = new Set([cellKey(Math.round(ghost.row), Math.round(ghost.col))]);
      const distance = nearestDistance(checkpoint, target, rows);
      const ghostArrival = distance / Math.max(ghost.speed || 5.2, 0.1);
      nearestLead = Math.min(nearestLead, ghostArrival - playerArrival);
    }

    if (nearestLead <= 0.9) {
      return { ...checkpoint, ghostLeadSeconds: rounded(nearestLead) };
    }
  }
  return null;
}

function scanCorridor(player, initialDirection, rows) {
  let row = player.row;
  let col = player.col;
  let direction = initialDirection;
  const path = [];
  const checkpoints = [];
  const limit = rows[0].length * rows.length;

  for (let steps = 0; steps < limit; steps += 1) {
    const next = nextCell(row, col, direction, rows);
    if (!isWalkable(next.row, next.col, "player", rows)) return { checkpoints, junction: null };
    row = next.row;
    col = next.col;
    path.push({ row, col });
    const checkpoint = { row, col, direction, steps: steps + 1, path: [...path] };
    checkpoints.push(checkpoint);
    const forward = availableDirections(row, col, "player", rows)
      .filter((option) => option !== OPPOSITE[direction]);
    if (forward.length >= 2) return { checkpoints, junction: checkpoint };
    if (forward.length === 0) return { checkpoints, junction: null };
    direction = forward[0];
  }
  return { checkpoints, junction: null };
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function nearestDistance(start, targets, rows = LEVEL_MAP) {
  if (!targets.size) return Infinity;
  const startKey = cellKey(start.row, start.col);
  if (targets.has(startKey)) return 0;
  const queue = [{ ...start, distance: 0 }];
  const visited = new Set([startKey]);

  for (const current of queue) {
    for (const direction of Object.keys({ up: 1, down: 1, left: 1, right: 1 })) {
      const next = nextCell(current.row, current.col, direction, rows);
      const key = cellKey(next.row, next.col);
      if (visited.has(key) || !isWalkable(next.row, next.col, "player", rows)) continue;
      if (targets.has(key)) return current.distance + 1;
      visited.add(key);
      queue.push({ ...next, distance: current.distance + 1 });
    }
  }
  return Infinity;
}

function nearestGhostDistance(position, ghosts) {
  return ghosts.reduce((nearest, ghost) => {
    const rowDistance = Math.abs(position.row - Math.round(ghost.row));
    const rawColDistance = Math.abs(position.col - Math.round(ghost.col));
    const colDistance = Math.min(rawColDistance, LEVEL_MAP[0].length - rawColDistance);
    return Math.min(nearest, rowDistance + colDistance);
  }, Infinity);
}

function describeDanger(distance, frightened) {
  if (frightened) {
    if (distance <= 2) return "an edible ghost is within reach";
    if (distance <= 5) return "an edible ghost is nearby";
    return "no edible ghost is nearby";
  }
  if (distance <= 2) return "immediate active-ghost danger";
  if (distance <= 5) return "active ghost nearby; use caution";
  return "safe from active ghosts for now";
}

function describeDistance(distance) {
  if (distance === 0) return "on the next tile";
  if (distance <= 2) return "very close";
  if (distance <= 5) return "nearby";
  if (Number.isFinite(distance)) return "farther away";
  return "unavailable";
}

function progressLabel(remaining) {
  if (remaining < 40) return "final dots";
  if (remaining < 110) return "mid-maze";
  return "early maze";
}
