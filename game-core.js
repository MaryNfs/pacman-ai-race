export const TILE_SIZE = 24;

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
