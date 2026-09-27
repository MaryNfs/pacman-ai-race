export const TILE_SIZE = 24;
export const SPEED_UNIT = 7;
export const DOT_PAUSE_SECONDS = 1 / 60;
export const POWER_DOT_PAUSE_SECONDS = 3 / 60;
export const POWER_MODE_SECONDS = 8;
export const COLLISION_RADIUS = 0.62;
// Match the live loop's maximum step so projected arrivals do not drift from
// the world they predict. At current actor speeds this remains sub-tile.
export const SIMULATION_STEP_SECONDS = 1 / 60;

export const LEVEL_MAP = Object.freeze([
  "#####################",
  "#o........#........o#",
  "#.###.###.#.###.###.#",
  "#...................#",
  "#.###.#.#####.#.###.#",
  "#.....#...#...#.....#",
  "#####.### # ###.#####",
  "    #.#       #.#    ",
  "#####.# ##=## #.#####",
  "     .  #GGG#  .     ",
  "#####.# ##### #.#####",
  "    #.#       #.#    ",
  "#####.# ##### #.#####",
  "#.........#.........#",
  "#.###.###.#.###.###.#",
  "#o..#.....P.....#..o#",
  "###.#.#.#####.#.#.###",
  "#.....#...#...#.....#",
  "#.#######.#.#######.#",
  "#...................#",
  "#.###.#########.###.#",
  "#o.................o#",
  "#####################",
]);

export const DIRECTIONS = Object.freeze({
  up: { row: -1, col: 0, angle: -Math.PI / 2 },
  down: { row: 1, col: 0, angle: Math.PI / 2 },
  left: { row: 0, col: -1, angle: Math.PI },
  right: { row: 0, col: 1, angle: 0 },
});

export const OPPOSITE = Object.freeze({ up: "down", down: "up", left: "right", right: "left" });

export function pacmanSpeed(level = 1, frightened = false) {
  if (level >= 21) return SPEED_UNIT * 0.9;
  if (level >= 5) return SPEED_UNIT;
  if (level >= 2) return SPEED_UNIT * (frightened ? 0.95 : 0.9);
  return SPEED_UNIT * (frightened ? 0.9 : 0.8);
}

export function ghostSpeed(level = 1, frightened = false) {
  if (frightened) {
    if (level >= 5) return SPEED_UNIT * 0.6;
    if (level >= 2) return SPEED_UNIT * 0.55;
    return SPEED_UNIT * 0.5;
  }
  if (level >= 5) return SPEED_UNIT * 0.95;
  if (level >= 2) return SPEED_UNIT * 0.85;
  return SPEED_UNIT * 0.75;
}

export function parseLevel(rows = LEVEL_MAP) {
  const width = rows[0].length;
  if (!rows.length || rows.some((row) => row.length !== width)) {
    throw new Error("Every maze row must have the same width.");
  }

  const pellets = new Set();
  const powerPellets = new Set();
  const ghosts = [];
  let player = null;

  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, colIndex) => {
      const key = cellKey(rowIndex, colIndex);
      if (cell === ".") pellets.add(key);
      if (cell === "o") powerPellets.add(key);
      if (cell === "P") player = { row: rowIndex, col: colIndex };
      if (cell === "G") ghosts.push({ row: rowIndex, col: colIndex });
    });
  });

  if (!player || ghosts.length === 0) throw new Error("The maze needs a player and at least one ghost.");
  return { width, height: rows.length, pellets, powerPellets, player, ghosts };
}

export function cellKey(row, col) {
  return `${row},${col}`;
}

export function mazeRegion(key, rows = LEVEL_MAP) {
  const [row, col] = key.split(",").map(Number);
  const vertical = row < rows.length / 3 ? "top" : row >= rows.length * 2 / 3 ? "bottom" : "middle";
  const horizontal = col < rows[0].length / 3 ? "left" : col >= rows[0].length * 2 / 3 ? "right" : "center";
  return `${vertical}-${horizontal}`;
}

export function getCell(row, col, rows = LEVEL_MAP) {
  if (row < 0 || row >= rows.length) return "#";
  if (col < 0 || col >= rows[0].length) return rows[row][0] === " " ? " " : "#";
  return rows[row][col];
}

export function isWalkable(row, col, actor = "player", rows = LEVEL_MAP) {
  const cell = getCell(row, col, rows);
  if (cell === "#") return false;
  return actor === "ghost" || cell !== "=";
}

export function nextCell(row, col, direction, rows = LEVEL_MAP) {
  const delta = DIRECTIONS[direction];
  let nextRow = row + delta.row;
  let nextCol = col + delta.col;
  if (nextCol < 0) nextCol = rows[0].length - 1;
  if (nextCol >= rows[0].length) nextCol = 0;
  return { row: nextRow, col: nextCol };
}

export function availableDirections(row, col, actor = "player", rows = LEVEL_MAP) {
  return Object.keys(DIRECTIONS).filter((direction) => {
    const next = nextCell(row, col, direction, rows);
    return isWalkable(next.row, next.col, actor, rows);
  });
}

export function squaredDistance(a, b) {
  return (a.row - b.row) ** 2 + (a.col - b.col) ** 2;
}

export function makeActor(position, direction, speed) {
  return {
    row: position.row,
    col: position.col,
    fromRow: position.fromRow ?? position.row,
    fromCol: position.fromCol ?? position.col,
    toRow: position.toRow ?? position.row,
    toCol: position.toCol ?? position.col,
    direction,
    queuedDirection: position.queuedDirection ?? direction,
    progress: position.progress ?? 0,
    speed,
    pauseFor: position.pauseFor ?? 0,
  };
}

export function beginActorStep(entity, direction, actor = "player", rows = LEVEL_MAP) {
  const next = nextCell(entity.row, entity.col, direction, rows);
  if (!isWalkable(next.row, next.col, actor, rows)) return false;
  entity.fromRow = entity.row;
  entity.fromCol = entity.col;
  entity.toRow = next.row;
  entity.toCol = next.col;
  entity.progress = Number.EPSILON;
  entity.direction = direction;
  return true;
}

export function advanceActor(entity, delta) {
  if (entity.progress === 0) return false;
  entity.progress += entity.speed * delta;
  if (entity.progress < 1) return false;
  entity.row = entity.toRow;
  entity.col = entity.toCol;
  entity.fromRow = entity.row;
  entity.fromCol = entity.col;
  entity.progress = 0;
  return true;
}

export function actorPosition(entity, rows = LEVEL_MAP) {
  if (!entity || entity.progress === 0) return { row: entity?.row ?? 0, col: entity?.col ?? 0 };
  let fromCol = entity.fromCol;
  let toCol = entity.toCol;
  if (Math.abs(toCol - fromCol) > 1) {
    if (toCol === 0) toCol = rows[0].length;
    else fromCol = rows[0].length;
  }
  let col = fromCol + (toCol - fromCol) * entity.progress;
  if (col >= rows[0].length) col -= rows[0].length;
  return { row: entity.fromRow + (entity.toRow - entity.fromRow) * entity.progress, col };
}

export function nextSeededRandom(seed) {
  const nextSeed = (Math.imul(seed >>> 0, 1_664_525) + 1_013_904_223) >>> 0;
  return { seed: nextSeed, value: nextSeed / 0x1_0000_0000 };
}

export function ghostTarget({ ghost, player, elapsedTime = 0, rows = LEVEL_MAP }) {
  const playerPosition = actorPosition(player, rows);
  const mode = Math.floor(elapsedTime / 7) % 4;
  if (mode === 3) return ghost.corner;
  if (ghost.name === "Flicker") {
    const direction = DIRECTIONS[player.direction];
    return { row: playerPosition.row + direction.row * 4, col: playerPosition.col + direction.col * 4 };
  }
  if (ghost.name === "Glitch") return squaredDistance(ghost, playerPosition) < 36 ? ghost.corner : playerPosition;
  return playerPosition;
}

export function chooseGhostDirection({ ghost, player, frightenedFor = 0, elapsedTime = 0, seed = 0, rows = LEVEL_MAP }) {
  let options = availableDirections(ghost.row, ghost.col, "ghost", rows);
  if (options.length > 1) options = options.filter((direction) => direction !== OPPOSITE[ghost.direction]);
  if (!options.length) return { direction: OPPOSITE[ghost.direction], seed };
  if (frightenedFor > 0) {
    const random = nextSeededRandom(seed);
    return { direction: options[Math.floor(random.value * options.length)], seed: random.seed };
  }
  const target = ghostTarget({ ghost, player, elapsedTime, rows });
  const direction = options.reduce((best, option) => {
    const candidate = nextCell(ghost.row, ghost.col, option, rows);
    const bestCell = nextCell(ghost.row, ghost.col, best, rows);
    return squaredDistance(candidate, target) < squaredDistance(bestCell, target) ? option : best;
  }, options[0]);
  return { direction, seed };
}

export function cloneSimulationState(state) {
  return {
    ...state,
    player: { ...state.player },
    ghosts: state.ghosts.map((ghost) => ({ ...ghost, home: { ...ghost.home }, corner: { ...ghost.corner } })),
    pellets: new Set(state.pellets),
    powerPellets: new Set(state.powerPellets),
  };
}

export function createSimulationState({ player, ghosts = [], pellets = new Set(), powerPellets = new Set(), frightenedFor = 0, level = 1, elapsedTime = 0, seed = 0x51a7c0de }) {
  return {
    player: makeActor(player, player.direction || "left", pacmanSpeed(level, frightenedFor > 0)),
    ghosts: ghosts.map((ghost, index) => ({
      ...makeActor(ghost, ghost.direction || "up", ghostSpeed(level, frightenedFor > 0)),
      name: ghost.name || ["Blaze", "Flicker", "Glitch"][index % 3],
      home: { ...(ghost.home || { row: ghost.row, col: ghost.col }) },
      corner: { ...(ghost.corner || [{ row: 1, col: 19 }, { row: 1, col: 1 }, { row: 21, col: 19 }][index % 3]) },
    })),
    pellets: new Set(pellets),
    powerPellets: new Set(powerPellets),
    frightenedFor,
    level,
    elapsedTime,
    seed: seed >>> 0,
    dead: false,
    collisionGhost: null,
    simulatedSeconds: 0,
    minClearance: Infinity,
    dotsCollected: 0,
    powerPelletsCollected: 0,
    ghostsEaten: 0,
  };
}

export function advanceSimulation(state, delta, desiredDirection = null, rows = LEVEL_MAP) {
  const player = state.player;
  player.speed = pacmanSpeed(state.level, state.frightenedFor > 0);
  if (player.pauseFor > 0) player.pauseFor = Math.max(0, player.pauseFor - delta);
  else {
    if (player.progress === 0 && desiredDirection) beginActorStep(player, desiredDirection, "player", rows);
    if (advanceActor(player, delta)) {
      const key = cellKey(player.row, player.col);
      if (state.pellets.delete(key)) {
        state.dotsCollected += 1;
        player.pauseFor = Math.max(player.pauseFor, DOT_PAUSE_SECONDS);
      } else if (state.powerPellets.delete(key)) {
        state.powerPelletsCollected += 1;
        state.frightenedFor = POWER_MODE_SECONDS;
        player.pauseFor = Math.max(player.pauseFor, POWER_DOT_PAUSE_SECONDS);
      }
    }
  }

  state.elapsedTime += delta;
  state.simulatedSeconds += delta;
  state.frightenedFor = Math.max(0, state.frightenedFor - delta);
  for (const ghost of state.ghosts) {
    ghost.speed = ghostSpeed(state.level, state.frightenedFor > 0);
    if (ghost.progress === 0) {
      const choice = chooseGhostDirection({ ghost, player, frightenedFor: state.frightenedFor, elapsedTime: state.elapsedTime, seed: state.seed, rows });
      state.seed = choice.seed;
      beginActorStep(ghost, choice.direction, "ghost", rows);
    }
    advanceActor(ghost, delta);
  }

  const playerPosition = actorPosition(player, rows);
  for (const ghost of state.ghosts) {
    const ghostPosition = actorPosition(ghost, rows);
    const clearance = Math.hypot(playerPosition.row - ghostPosition.row, playerPosition.col - ghostPosition.col) - COLLISION_RADIUS;
    state.minClearance = Math.min(state.minClearance, clearance);
    if (clearance >= 0) continue;
    if (state.frightenedFor > 0) {
      const reset = makeActor(ghost.home, "up", ghost.speed);
      Object.assign(ghost, reset);
      state.ghostsEaten += 1;
    } else {
      state.dead = true;
      state.collisionGhost = { name: ghost.name, direction: ghost.direction, position: ghostPosition };
      break;
    }
  }
  return state;
}

export function simulatePath(initialState, path, { stepSeconds = SIMULATION_STEP_SECONDS, rows = LEVEL_MAP } = {}) {
  const state = cloneSimulationState(initialState);
  let pathIndex = 0;
  const maxSeconds = Math.max(2, path.length * 2 + 2);
  while (!state.dead && state.simulatedSeconds - initialState.simulatedSeconds < maxSeconds) {
    let direction = null;
    if (state.player.progress === 0 && state.player.pauseFor === 0 && pathIndex < path.length) {
      const target = path[pathIndex];
      direction = Object.keys(DIRECTIONS).find((candidate) => {
        const next = nextCell(state.player.row, state.player.col, candidate, rows);
        return next.row === target.row && next.col === target.col;
      }) || null;
      if (!direction) break;
      pathIndex += 1;
    }
    advanceSimulation(state, stepSeconds, direction, rows);
    if (pathIndex >= path.length && state.player.progress === 0 && state.player.pauseFor === 0) break;
  }
  return state;
}
