import {
  LEVEL_MAP,
  TILE_SIZE,
  DIRECTIONS,
  OPPOSITE,
  parseLevel,
  cellKey,
  getCell,
  isWalkable,
  nextCell,
  availableDirections,
  squaredDistance,
} from "./game-core.js";

const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d");
const elements = {
  score: document.querySelector("#score"),
  highScore: document.querySelector("#highScore"),
  level: document.querySelector("#level"),
  lives: document.querySelector("#lives"),
  startOverlay: document.querySelector("#startOverlay"),
  messageOverlay: document.querySelector("#messageOverlay"),
  messageKicker: document.querySelector("#messageKicker"),
  messageTitle: document.querySelector("#messageTitle"),
  messageScore: document.querySelector("#messageScore"),
  startButton: document.querySelector("#startButton"),
  restartButton: document.querySelector("#restartButton"),
  pauseButton: document.querySelector("#pauseButton"),
  soundButton: document.querySelector("#soundButton"),
  soundIcon: document.querySelector("#soundIcon"),
  announcement: document.querySelector("#announcement"),
};

const parsed = parseLevel();
const ghostStyles = [
  { color: "#ff4f6d", name: "Blaze", corner: { row: 1, col: 19 } },
  { color: "#ff72c7", name: "Flicker", corner: { row: 1, col: 1 } },
  { color: "#35e2ef", name: "Glitch", corner: { row: 21, col: 19 } },
];

const state = {
  status: "ready",
  score: 0,
  highScore: readHighScore(),
  level: 1,
  lives: 3,
  pellets: new Set(),
  powerPellets: new Set(),
  player: null,
  ghosts: [],
  frightenedFor: 0,
  pauseStartedAt: 0,
  lastTime: 0,
  muted: false,
  audio: null,
};

function makeEntity(position, direction, speed) {
  return {
    row: position.row,
    col: position.col,
    fromRow: position.row,
    fromCol: position.col,
    toRow: position.row,
    toCol: position.col,
    direction,
    queuedDirection: direction,
    progress: 0,
    speed,
  };
}

function resetActors() {
  state.player = makeEntity(parsed.player, "left", 6.35);
  state.ghosts = parsed.ghosts.map((position, index) => ({
    ...makeEntity(position, index === 0 ? "up" : index === 1 ? "left" : "right", 5.25 + state.level * 0.1),
    ...ghostStyles[index % ghostStyles.length],
    home: { ...position },
  }));
  state.frightenedFor = 0;
}

function resetGame() {
  state.score = 0;
  state.level = 1;
  state.lives = 3;
  loadLevel();
  updateHud();
}

function loadLevel() {
  state.pellets = new Set(parsed.pellets);
  state.powerPellets = new Set(parsed.powerPellets);
  resetActors();
}

function beginGame() {
  ensureAudio();
  resetGame();
  state.status = "playing";
  state.lastTime = performance.now();
  elements.startOverlay.classList.add("hidden");
  elements.messageOverlay.classList.add("hidden");
  elements.pauseButton.firstChild.textContent = "Pause ";
  announce("Game started. Level 1.");
  playTone(330, 0.08, "square", 0.035);
  requestAnimationFrame(gameLoop);
}

function advanceLevel() {
  state.level += 1;
  state.score += 500;
  loadLevel();
  updateHud();
  announce(`Level ${state.level}. Ghosts are getting faster.`);
  playSequence([523, 659, 784], 0.08);
}

function loseLife() {
  state.lives -= 1;
  playSequence([180, 140, 100], 0.12);
  updateHud();
  if (state.lives <= 0) {
    endGame();
    return;
  }
  resetActors();
  state.status = "countdown";
  window.setTimeout(() => {
    if (state.status === "countdown") {
      state.status = "playing";
      state.lastTime = performance.now();
      announce(`${state.lives} lives remaining.`);
    }
  }, 700);
}

function endGame() {
  state.status = "over";
  elements.messageKicker.textContent = state.score >= state.highScore && state.score > 0 ? "New high score" : "Run over";
  elements.messageTitle.textContent = state.score >= state.highScore && state.score > 0 ? "Maze legend!" : "Great run!";
  elements.messageScore.textContent = `${state.score.toLocaleString()} points · level ${state.level}`;
  elements.messageOverlay.classList.remove("hidden");
  elements.restartButton.focus();
  announce(`Game over. Final score ${state.score}.`);
}

function togglePause() {
  if (state.status === "playing") {
    state.status = "paused";
    elements.pauseButton.firstChild.textContent = "Resume ";
    announce("Game paused.");
  } else if (state.status === "paused") {
    state.status = "playing";
    state.lastTime = performance.now();
    elements.pauseButton.firstChild.textContent = "Pause ";
    announce("Game resumed.");
  }
}

function updatePlayer(delta) {
  const player = state.player;
  if (player.progress === 0) {
    const queued = nextCell(player.row, player.col, player.queuedDirection);
    if (isWalkable(queued.row, queued.col)) player.direction = player.queuedDirection;
    beginStep(player, player.direction, "player");
  }

  moveEntity(player, delta, () => {
    collectAt(player.row, player.col);
  });
}

function updateGhosts(delta) {
  for (const ghost of state.ghosts) {
    if (ghost.progress === 0) {
      ghost.direction = chooseGhostDirection(ghost);
      beginStep(ghost, ghost.direction, "ghost");
    }
    ghost.speed = (5.15 + state.level * 0.12) * (state.frightenedFor > 0 ? 0.7 : 1);
    moveEntity(ghost, delta);
  }
}

function beginStep(entity, direction, actor) {
  const next = nextCell(entity.row, entity.col, direction);
  if (!isWalkable(next.row, next.col, actor)) return false;
  entity.fromRow = entity.row;
  entity.fromCol = entity.col;
  entity.toRow = next.row;
  entity.toCol = next.col;
  entity.progress = Number.EPSILON;
  return true;
}

function moveEntity(entity, delta, onArrive = () => {}) {
  if (entity.progress === 0) return;
  entity.progress += entity.speed * delta;
  if (entity.progress < 1) return;
  entity.row = entity.toRow;
  entity.col = entity.toCol;
  entity.fromRow = entity.row;
  entity.fromCol = entity.col;
  entity.progress = 0;
  onArrive();
}

function chooseGhostDirection(ghost) {
  let options = availableDirections(ghost.row, ghost.col, "ghost");
  if (options.length > 1) options = options.filter((direction) => direction !== OPPOSITE[ghost.direction]);
  if (!options.length) return OPPOSITE[ghost.direction];

  if (state.frightenedFor > 0) return options[Math.floor(Math.random() * options.length)];

  const target = ghostTarget(ghost);
  return options.reduce((best, direction) => {
    const candidate = nextCell(ghost.row, ghost.col, direction);
    const bestCell = nextCell(ghost.row, ghost.col, best);
    return squaredDistance(candidate, target) < squaredDistance(bestCell, target) ? direction : best;
  }, options[0]);
}

function ghostTarget(ghost) {
  const playerPosition = renderedPosition(state.player);
  const mode = Math.floor(performance.now() / 7000) % 4;
  if (mode === 3) return ghost.corner;
  if (ghost.name === "Flicker") {
    const direction = DIRECTIONS[state.player.direction];
    return { row: playerPosition.row + direction.row * 4, col: playerPosition.col + direction.col * 4 };
  }
  if (ghost.name === "Glitch") {
    const distance = squaredDistance(ghost, playerPosition);
    return distance < 36 ? ghost.corner : playerPosition;
  }
  return playerPosition;
}

function collectAt(row, col) {
  const key = cellKey(row, col);
  if (state.pellets.delete(key)) {
    addScore(10);
    playTone(440 + (state.score % 80), 0.025, "square", 0.012);
  } else if (state.powerPellets.delete(key)) {
    addScore(50);
    state.frightenedFor = 8;
    playSequence([220, 330, 440], 0.055);
    announce("Power mode active.");
  }
  if (state.pellets.size + state.powerPellets.size === 0) advanceLevel();
}

function addScore(points) {
  state.score += points;
  if (state.score > state.highScore) {
    state.highScore = state.score;
    try { localStorage.setItem("packman-high-score", String(state.highScore)); } catch { /* Private browsing can block storage. */ }
  }
  updateHud();
}

function checkCollisions() {
  const player = renderedPosition(state.player);
  for (const ghost of state.ghosts) {
    const position = renderedPosition(ghost);
    const distance = Math.hypot(player.row - position.row, player.col - position.col);
    if (distance >= 0.62) continue;
    if (state.frightenedFor > 0) {
      addScore(200);
      Object.assign(ghost, makeEntity(ghost.home, "up", ghost.speed));
      announce(`${ghost.name} caught. 200 points.`);
      playSequence([600, 820], 0.06);
    } else {
      loseLife();
    }
    break;
  }
}

function renderedPosition(entity) {
  if (!entity || entity.progress === 0) return { row: entity?.row ?? 0, col: entity?.col ?? 0 };
  let fromCol = entity.fromCol;
  let toCol = entity.toCol;
  if (Math.abs(toCol - fromCol) > 1) {
    if (toCol === 0) toCol = parsed.width;
    else fromCol = parsed.width;
  }
  let col = fromCol + (toCol - fromCol) * entity.progress;
  if (col >= parsed.width) col -= parsed.width;
  return { row: entity.fromRow + (entity.toRow - entity.fromRow) * entity.progress, col };
}

function gameLoop(now) {
  const delta = Math.min((now - state.lastTime) / 1000, 0.05);
  state.lastTime = now;

  if (state.status === "playing") {
    state.frightenedFor = Math.max(0, state.frightenedFor - delta);
    updatePlayer(delta);
    updateGhosts(delta);
    checkCollisions();
  }
  draw(now);
  if (["playing", "paused", "countdown"].includes(state.status)) requestAnimationFrame(gameLoop);
}

function draw(now = 0) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 40, canvas.width / 2, canvas.height / 2, canvas.width * 0.75);
  gradient.addColorStop(0, "#0a0e24");
  gradient.addColorStop(1, "#03050d");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  drawMaze(now);
  drawPlayer(now);
  state.ghosts.forEach((ghost) => drawGhost(ghost, now));

  if (state.status === "paused" || state.status === "countdown") {
    context.fillStyle = "rgba(3, 5, 13, .7)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f7f5ff";
    context.font = "700 28px 'Avenir Next', 'Segoe UI', sans-serif";
    context.textAlign = "center";
    context.fillText(state.status === "paused" ? "PAUSED" : "READY!", canvas.width / 2, canvas.height / 2);
  }
}

function drawMaze(now) {
  for (let row = 0; row < parsed.height; row += 1) {
    for (let col = 0; col < parsed.width; col += 1) {
      const cell = getCell(row, col);
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (cell === "#") drawWall(x, y, row, col);
      if (cell === "=") {
        context.fillStyle = "#ff72c7";
        context.fillRect(x + 3, y + TILE_SIZE / 2 - 1, TILE_SIZE - 6, 2);
      }
      const key = cellKey(row, col);
      if (state.pellets.has(key)) drawPellet(x + 12, y + 12, 2.2, "#f7e9c2");
      if (state.powerPellets.has(key)) {
        const pulse = 5.2 + Math.sin(now / 160) * 1.2;
        drawPellet(x + 12, y + 12, pulse, "#ffe234", true);
      }
    }
  }
}

function drawWall(x, y, row, col) {
  context.fillStyle = "rgba(59, 74, 183, .16)";
  context.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  context.strokeStyle = "#5268ef";
  context.lineWidth = 1.4;
  context.shadowColor = "rgba(64, 91, 255, .55)";
  context.shadowBlur = 5;
  if (getCell(row - 1, col) !== "#") line(x + 2, y + 2, x + TILE_SIZE - 2, y + 2);
  if (getCell(row + 1, col) !== "#") line(x + 2, y + TILE_SIZE - 2, x + TILE_SIZE - 2, y + TILE_SIZE - 2);
  if (getCell(row, col - 1) !== "#") line(x + 2, y + 2, x + 2, y + TILE_SIZE - 2);
  if (getCell(row, col + 1) !== "#") line(x + TILE_SIZE - 2, y + 2, x + TILE_SIZE - 2, y + TILE_SIZE - 2);
  context.shadowBlur = 0;
}

function line(x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function drawPellet(x, y, radius, color, glow = false) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  if (glow) { context.shadowColor = color; context.shadowBlur = 13; }
  context.fill();
  context.shadowBlur = 0;
}

function drawPlayer(now) {
  if (!state.player) return;
  const position = renderedPosition(state.player);
  const x = (position.col + 0.5) * TILE_SIZE;
  const y = (position.row + 0.5) * TILE_SIZE;
  const base = DIRECTIONS[state.player.direction].angle;
  const mouth = 0.2 + Math.abs(Math.sin(now / 75)) * 0.25;
  context.beginPath();
  context.moveTo(x, y);
  context.arc(x, y, 9.5, base + mouth, base + Math.PI * 2 - mouth);
  context.closePath();
  context.fillStyle = "#ffe234";
  context.shadowColor = "rgba(255,226,52,.65)";
  context.shadowBlur = 11;
  context.fill();
  context.shadowBlur = 0;
}

function drawGhost(ghost, now) {
  const position = renderedPosition(ghost);
  const x = (position.col + 0.5) * TILE_SIZE;
  const y = (position.row + 0.5) * TILE_SIZE;
  const frightened = state.frightenedFor > 0;
  const flashing = state.frightenedFor < 2 && Math.floor(now / 180) % 2 === 0;
  const color = frightened ? (flashing ? "#f5f2ff" : "#334dff") : ghost.color;
  context.fillStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(x, y - 1, 9, Math.PI, 0);
  context.lineTo(x + 9, y + 9);
  context.lineTo(x + 4.5, y + 5.5);
  context.lineTo(x, y + 9);
  context.lineTo(x - 4.5, y + 5.5);
  context.lineTo(x - 9, y + 9);
  context.closePath();
  context.fill();
  context.shadowBlur = 0;

  context.fillStyle = "white";
  context.beginPath(); context.ellipse(x - 3.5, y - 1, 2.7, 3.5, 0, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.ellipse(x + 3.5, y - 1, 2.7, 3.5, 0, 0, Math.PI * 2); context.fill();
  const look = DIRECTIONS[ghost.direction];
  context.fillStyle = frightened ? "#101a60" : "#17205a";
  context.beginPath(); context.arc(x - 3.5 + look.col, y - 1 + look.row, 1.35, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.arc(x + 3.5 + look.col, y - 1 + look.row, 1.35, 0, Math.PI * 2); context.fill();
}

function queueDirection(direction) {
  if (!state.player || !DIRECTIONS[direction]) return;
  state.player.queuedDirection = direction;
  ensureAudio();
}

function updateHud() {
  elements.score.textContent = String(state.score).padStart(6, "0");
  elements.highScore.textContent = String(state.highScore).padStart(6, "0");
  elements.level.textContent = String(state.level).padStart(2, "0");
  elements.lives.replaceChildren(...Array.from({ length: state.lives }, () => {
    const life = document.createElement("span");
    life.className = "life-icon";
    return life;
  }));
  elements.lives.setAttribute("aria-label", `${state.lives} ${state.lives === 1 ? "life" : "lives"}`);
}

function announce(message) {
  elements.announcement.textContent = "";
  window.setTimeout(() => { elements.announcement.textContent = message; }, 20);
}

function readHighScore() {
  try { return Number(localStorage.getItem("packman-high-score")) || 0; } catch { return 0; }
}

function ensureAudio() {
  if (!state.audio) state.audio = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audio.state === "suspended") state.audio.resume();
}

function playTone(frequency, duration, type = "sine", volume = 0.025, delay = 0) {
  if (state.muted || !state.audio) return;
  const oscillator = state.audio.createOscillator();
  const gain = state.audio.createGain();
  const starts = state.audio.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, starts);
  gain.gain.setValueAtTime(volume, starts);
  gain.gain.exponentialRampToValueAtTime(0.0001, starts + duration);
  oscillator.connect(gain).connect(state.audio.destination);
  oscillator.start(starts);
  oscillator.stop(starts + duration);
}

function playSequence(notes, duration) {
  notes.forEach((note, index) => playTone(note, duration, "square", 0.025, index * duration));
}

function toggleSound() {
  state.muted = !state.muted;
  elements.soundButton.setAttribute("aria-pressed", String(state.muted));
  elements.soundButton.setAttribute("aria-label", state.muted ? "Unmute sound" : "Mute sound");
  elements.soundIcon.textContent = state.muted ? "◖×" : "◖))";
  if (!state.muted) { ensureAudio(); playTone(440, 0.08); }
}

const keyDirections = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
document.addEventListener("keydown", (event) => {
  if (keyDirections[event.key]) {
    event.preventDefault();
    queueDirection(keyDirections[event.key]);
  } else if (event.key === "p" || event.key === "P" || event.key === " ") {
    event.preventDefault();
    togglePause();
  }
});

elements.startButton.addEventListener("click", beginGame);
elements.restartButton.addEventListener("click", beginGame);
elements.pauseButton.addEventListener("click", togglePause);
elements.soundButton.addEventListener("click", toggleSound);
document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    queueDirection(button.dataset.direction);
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "playing") togglePause();
});

loadLevel();
updateHud();
draw();
