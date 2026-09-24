import { LEVEL_MAP, OPPOSITE, availableDirections, cellKey, isWalkable, nextCell } from "./game-core.js";

export function buildDecisionRequest({ player, ghosts, pellets, powerPellets, frightenedFor, level, score }) {
  const legalDirections = availableDirections(player.row, player.col)
    .filter((direction) => direction !== OPPOSITE[player.direction]);
  const options = legalDirections.length > 0
    ? legalDirections
    : availableDirections(player.row, player.col);
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
      summary: `${direction}: ${danger}; regular food is ${food}; power food is ${power}; ${direction === player.direction ? "continues forward" : "turns at the junction"}.`,
    };
  });

  return {
    meta: { row: player.row, col: player.col },
    state: {
      game: "Pacman maze chase",
      objective: "Survive and clear every food dot.",
      mode: frightened ? "power mode: ghosts are edible" : "normal mode: ghosts are dangerous",
      progress: progressLabel(pellets.size + powerPellets.size),
      currentHeading: player.direction,
      level: level > 3 ? "advanced speed" : level > 1 ? "increased speed" : "base speed",
      scoreBand: score >= 5_000 ? "high score run" : score >= 1_000 ? "established run" : "early run",
      legalMoveAssessments: Object.fromEntries(assessments.map(({ direction, danger, food, power }) => [
        direction,
        { ghostSafety: danger, regularFood: food, powerFood: power },
      ])),
    },
    legalMoves: assessments.map(({ direction, summary }) => ({ direction, summary })),
    assessments,
  };
}

export function chooseSafeFallback(assessments, frightened = false) {
  return assessments.reduce((best, candidate) => {
    const candidateScore = utility(candidate, frightened);
    return !best || candidateScore > best.score
      ? { direction: candidate.direction, score: candidateScore }
      : best;
  }, null)?.direction;
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
    if (forward.length >= 2) return { row, col, direction };
    if (forward.length === 0) return null;
    direction = forward[0];
  }
  return null;
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

function utility(assessment, frightened) {
  const ghostValue = Number.isFinite(assessment.ghostDistance)
    ? (frightened ? -assessment.ghostDistance * 2 : assessment.ghostDistance * 5)
    : 50;
  const pelletValue = Number.isFinite(assessment.pelletDistance) ? -assessment.pelletDistance * 2 : -100;
  const powerValue = !frightened && Number.isFinite(assessment.powerDistance) ? -assessment.powerDistance : 0;
  return ghostValue + pelletValue + powerValue;
}
