import { DIRECTIONS, LEVEL_MAP, OPPOSITE, availableDirections, cellKey, isWalkable, nextCell } from "./game-core.js";
import { enumerateRouteCandidates } from "./route-planner.js";

export function buildDecisionRequest({ player, ghosts, pellets, powerPellets, frightenedFor, level, score, recentTrail = [], playerSpeed = 6.35, planningLeadTime = 0 }) {
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
  const routes = enumerateRouteCandidates({ player, ghosts, pellets, powerPellets, frightenedFor, recentTrail, playerSpeed, planningLeadTime });

  return {
    meta: { row: player.row, col: player.col },
    state: {
      game: "Pacman maze chase",
      objective: "Survive and clear every food dot.",
      mode: frightened ? "power mode: ghosts are edible" : "normal mode: ghosts are dangerous",
      progress: progressLabel(pellets.size + powerPellets.size),
      currentHeading: player.direction,
      forecast: {
        planStartsInSeconds: rounded(planningLeadTime),
        method: "conservative shortest-path ghost timing from the live snapshot",
      },
      level: level > 3 ? "advanced speed" : level > 1 ? "increased speed" : "base speed",
      scoreBand: score >= 5_000 ? "high score run" : score >= 1_000 ? "established run" : "early run",
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
        foodYield: route.foodYield,
        powerPellets: route.powerPelletCount,
        powerPellet: route.powerYield,
        destinationExitCount: route.escapeRoutes,
        destinationEscapeRoutes: route.escapeQuality,
        recentPathTiles: route.repeatedCells,
        recentPathOverlap: route.repetition,
      }])),
    },
    routeChoices: routes.map(({ id, direction, directions, summary }) => ({ id, direction, directions, summary })),
    assessments,
    routes,
  };
}

function describeManeuver(direction, currentHeading) {
  if (direction === currentHeading) return "continues forward";
  if (direction === OPPOSITE[currentHeading]) return "reverses direction with a U-turn";
  return "turns at the junction";
}

export function findNextJunction(player, initialDirection, rows = LEVEL_MAP) {
  let row = player.row;
  let col = player.col;
  let direction = initialDirection;
  const limit = rows[0].length * rows.length;

  for (let steps = 0; steps < limit; steps += 1) {
    const next = nextCell(row, col, direction, rows);
    if (!isWalkable(next.row, next.col, "player", rows)) return null;
    row = next.row;
    col = next.col;
    const forward = availableDirections(row, col, "player", rows)
      .filter((option) => option !== OPPOSITE[direction]);
    if (forward.length >= 2) return { row, col, direction, steps: steps + 1 };
    if (forward.length === 0) return null;
    direction = forward[0];
  }
  return null;
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
