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
  pacmanSpeed,
  ghostSpeed,
  DOT_PAUSE_SECONDS,
  POWER_DOT_PAUSE_SECONDS,
  POWER_MODE_SECONDS,
  COLLISION_RADIUS,
  makeActor,
  beginActorStep,
  advanceActor,
  actorPosition,
  chooseGhostDirection as chooseGhostDirectionCore,
  nextSeededRandom,
  createSimulationState,
  simulatePath,
} from "./game-core.js";
import { buildDecisionRequest, selectablePrefetchedRoute } from "./ai-state.js";

const pageParams = new URLSearchParams(window.location.search);
const comparisonEmbed = pageParams.get("embed") === "1";
const benchmarkMode = pageParams.get("benchmark") === "1";
const lockedProviderId = ["jev", "laya"].includes(pageParams.get("provider"))
  ? pageParams.get("provider")
  : null;
const layaModelOverride = ["english", "multilingual", "typed-decisions"].includes(pageParams.get("model"))
  ? pageParams.get("model")
  : null;
const initialRandomSeed = Number.isInteger(Number(pageParams.get("seed")))
  ? Number(pageParams.get("seed")) >>> 0
  : 0x51a7c0de;
const simulationRate = benchmarkMode ? Math.min(8, Math.max(1, Number(pageParams.get("speed")) || 4)) : 1;
const benchmarkLevelGoal = benchmarkMode ? Math.min(5, Math.max(1, Math.round(Number(pageParams.get("levels")) || 1))) : 1;
if (comparisonEmbed) document.body.classList.add("comparison-embed");
if (benchmarkMode) document.body.classList.add("benchmark-embed");

const canvas = document.querySelector("#gameCanvas");
const context = canvas.getContext("2d");
const boardLayer = document.createElement("canvas");
boardLayer.width = canvas.width;
boardLayer.height = canvas.height;
const boardContext = boardLayer.getContext("2d");
const MAX_FRAME_DELTA = 0.25;
const MAX_SIMULATION_STEP = 1 / 60;
const RENDER_INTERVAL = benchmarkMode ? 1000 / 12 : comparisonEmbed ? 1000 / 30 : 0;
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
  jevStartButton: document.querySelector("#jevStartButton"),
  layaStartButton: document.querySelector("#layaStartButton"),
  jevSetupHint: document.querySelector("#jevSetupHint"),
  restartButton: document.querySelector("#restartButton"),
  pauseButton: document.querySelector("#pauseButton"),
  soundButton: document.querySelector("#soundButton"),
  soundIcon: document.querySelector("#soundIcon"),
  pilotLabel: document.querySelector("#pilotLabel"),
  jevDecision: document.querySelector("#jevDecision"),
  jevStatus: document.querySelector("#jevStatus"),
  jevCaption: document.querySelector("#jevCaption"),
  jevConfidence: document.querySelector("#jevConfidence"),
  jevLatency: document.querySelector("#jevLatency"),
  jevModel: document.querySelector("#jevModel"),
  jevProbabilities: document.querySelector("#jevProbabilities"),
  jevHistory: document.querySelector("#jevHistory"),
  controlModeButton: document.querySelector("#controlModeButton"),
  jevStatePayload: document.querySelector("#jevStatePayload"),
  jevCandidateDetails: document.querySelector("#jevCandidateDetails"),
  jevRequestCount: document.querySelector("#jevRequestCount"),
  jevResponseCount: document.querySelector("#jevResponseCount"),
  jevErrorCount: document.querySelector("#jevErrorCount"),
  jevTokenCount: document.querySelector("#jevTokenCount"),
  jevAverageLatency: document.querySelector("#jevAverageLatency"),
  jevDecisionWaits: document.querySelector("#jevDecisionWaits"),
  jevDotsPerRequest: document.querySelector("#jevDotsPerRequest"),
  jevScorePerRequest: document.querySelector("#jevScorePerRequest"),
  jevDeaths: document.querySelector("#jevDeaths"),
  jevLoopRoutesExcluded: document.querySelector("#jevLoopRoutesExcluded"),
  jevDecisionLog: document.querySelector("#jevDecisionLog"),
  jevActivity: document.querySelector("#jevActivity"),
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
  lastDrawTime: 0,
  elapsedTime: 0,
  muted: comparisonEmbed,
  audio: null,
  randomSeed: initialRandomSeed,
  controlMode: "manual",
  manualQueue: [],
  trail: [],
  ai: {
    providerId: "jev",
    providers: {
      jev: { id: "jev", name: "Jev", configured: false, available: false, model: "jev-latest", selfHosted: false },
      laya: { id: "laya", name: "Laya", configured: false, available: false, model: "english", selfHosted: true },
    },
    configured: false,
    model: null,
    pending: false,
    pendingFor: null,
    decisionReady: null,
    activePath: [],
    waitingForKey: null,
    retryAt: 0,
    foodTargetKey: null,
    requestId: 0,
    history: [],
    metrics: freshAiMetrics(),
    log: [],
    lastSelection: null,
    lastDeathDiagnostic: null,
  },
};

function makeEntity(position, direction, speed) {
  return makeActor(position, direction, speed);
}

function resetActors() {
  state.ai.requestId += 1;
  state.ai.pending = false;
  state.ai.pendingFor = null;
  state.ai.decisionReady = null;
  state.ai.activePath = [];
  state.ai.waitingForKey = null;
  state.ai.retryAt = 0;
  state.manualQueue = [];
  state.player = makeEntity(parsed.player, "left", pacmanSpeed(state.level));
  state.trail = [cellKey(parsed.player.row, parsed.player.col)];
  state.ghosts = parsed.ghosts.map((position, index) => ({
    ...makeEntity(position, index === 0 ? "up" : index === 1 ? "left" : "right", ghostSpeed(state.level)),
    ...ghostStyles[index % ghostStyles.length],
    home: { ...position },
  }));
  state.frightenedFor = 0;
}

function resetGame() {
  state.score = 0;
  state.level = 1;
  state.lives = 3;
  state.elapsedTime = 0;
  state.randomSeed = initialRandomSeed;
  state.ai.foodTargetKey = null;
  state.ai.history = [];
  state.ai.metrics = freshAiMetrics();
  state.ai.log = [];
  state.ai.lastSelection = null;
  state.ai.lastDeathDiagnostic = null;
  resetDecisionDisplay();
  resetTelemetryDisplay();
  loadLevel();
  updateHud();
}

function loadLevel() {
  state.ai.foodTargetKey = null;
  state.pellets = new Set(parsed.pellets);
  state.powerPellets = new Set(parsed.powerPellets);
  resetActors();
}

function beginGame(controlMode = state.controlMode) {
  if (!state.muted) ensureAudio();
  setControlMode(controlMode);
  resetGame();
  state.status = "playing";
  state.lastTime = performance.now();
  state.lastDrawTime = 0;
  elements.startOverlay.classList.add("hidden");
  elements.messageOverlay.classList.add("hidden");
  elements.pauseButton.firstChild.textContent = "Pause ";
  announce(`${state.controlMode === "ai" ? `${activeProvider().name} control` : "Manual game"} started. Level 1.`);
  notifyComparisonParent("state", { status: "playing" });
  playTone(330, 0.08, "square", 0.035);
  requestAnimationFrame(gameLoop);
}

function advanceLevel() {
  if (benchmarkMode && state.level >= benchmarkLevelGoal) {
    state.score += 500;
    updateHud();
    endGame(true);
    return;
  }
  state.level += 1;
  state.score += 500;
  loadLevel();
  updateHud();
  announce(`Level ${state.level}. Ghosts are getting faster.`);
  playSequence([523, 659, 784], 0.08);
}

function loseLife() {
  state.lives -= 1;
  if (state.controlMode === "ai") state.ai.metrics.deaths += 1;
  playSequence([180, 140, 100], 0.12);
  updateHud();
  if (state.lives <= 0) {
    endGame();
    return;
  }
  state.ai.foodTargetKey = null;
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

function endGame(completed = false) {
  state.status = "over";
  elements.messageKicker.textContent = completed ? "Maze cleared" : state.score >= state.highScore && state.score > 0 ? "New high score" : "Run over";
  elements.messageTitle.textContent = completed ? "Pilot wins!" : state.score >= state.highScore && state.score > 0 ? "Maze legend!" : "Great run!";
  elements.messageScore.textContent = `${state.score.toLocaleString()} points · level ${state.level}`;
  elements.messageOverlay.classList.remove("hidden");
  elements.restartButton.focus();
  announce(`Game over. Final score ${state.score}.`);
  notifyComparisonParent("state", {
    status: "over",
    score: state.score,
    level: state.level,
    levelsCleared: completed ? state.level : Math.max(0, state.level - 1),
    completed,
    deaths: state.ai.metrics.deaths,
    dotsCollected: state.ai.metrics.dotsCollected,
    remainingDots: state.pellets.size + state.powerPellets.size,
    requests: state.ai.metrics.requests,
    responses: state.ai.metrics.responses,
    averageLatencyMs: state.ai.metrics.responses > 0 ? Math.round(state.ai.metrics.totalLatency / state.ai.metrics.responses) : null,
    predictedSafeDeaths: state.ai.metrics.predictedSafeDeaths,
    forcedDangerStates: state.ai.metrics.forcedDangerStates,
    averageSearchTimeMs: state.ai.metrics.requests > 0 ? state.ai.metrics.totalSearchTimeMs / state.ai.metrics.requests : 0,
    maximumSearchTimeMs: state.ai.metrics.maximumSearchTimeMs,
    lastDeathDiagnostic: state.ai.lastDeathDiagnostic,
    prefetchInvalidations: state.ai.metrics.prefetchInvalidations,
    prefetchRevalidations: state.ai.metrics.prefetchRevalidations,
    seed: initialRandomSeed,
    model: state.ai.model,
  });
}

function togglePause() {
  if (state.status === "playing") {
    state.status = "paused";
    elements.pauseButton.firstChild.textContent = "Resume ";
    announce("Game paused.");
    notifyComparisonParent("state", { status: "paused" });
  } else if (state.status === "paused") {
    state.status = "playing";
    state.lastTime = performance.now();
    elements.pauseButton.firstChild.textContent = "Pause ";
    announce("Game resumed.");
    notifyComparisonParent("state", { status: "playing" });
  }
}

function updatePlayer(delta) {
  const player = state.player;
  player.speed = pacmanSpeed(state.level, state.frightenedFor > 0);
  if (player.pauseFor > 0) {
    player.pauseFor = Math.max(0, player.pauseFor - delta);
    return;
  }
  if (player.progress === 0) {
    if (state.controlMode === "ai") {
      if (!chooseAiStep(player)) return;
    } else {
      const command = state.manualQueue.shift();
      if (!command) return;
      player.queuedDirection = command;
      const queued = nextCell(player.row, player.col, command);
      if (!isWalkable(queued.row, queued.col)) return;
      player.direction = command;
      beginStep(player, command, "player");
    }
  }

  moveEntity(player, delta, () => {
    collectAt(player.row, player.col);
    state.trail.push(cellKey(player.row, player.col));
    state.trail = state.trail.slice(-16);
  });
}

function chooseAiStep(player) {
  const checkpointKey = cellKey(player.row, player.col);

  if (state.ai.activePath.length > 0) return startNextPlannedStep(player);

  if (state.ai.decisionReady?.junctionKey === checkpointKey) {
    let ready = state.ai.decisionReady;
    if (state.ai.decisionReady.expectedStateKey && state.ai.decisionReady.expectedStateKey !== decisionStateKey()) {
      const actualDecision = makeDecisionRequest(player, { trigger: "prefetch arrival validation" });
      const validatedRoute = selectablePrefetchedRoute(actualDecision, ready.route.id);
      if (!validatedRoute) {
        state.ai.decisionReady = null;
        state.ai.metrics.prefetchInvalidations += 1;
        markAiWait(checkpointKey);
        requestAiDecision(actualDecision, checkpointKey, "prefetch safety changed");
        return false;
      }
      state.ai.metrics.prefetchRevalidations += 1;
      ready = {
        ...ready,
        route: validatedRoute,
        selection: selectionTelemetry(actualDecision, validatedRoute),
      };
    }
    const route = ready.route;
    state.ai.lastSelection = ready.selection;
    state.ai.decisionReady = null;
    state.ai.waitingForKey = null;
    state.ai.activePath = route.path.map((cell) => ({ ...cell }));
    prefetchNextRoute(player, route);
    return startNextPlannedStep(player);
  }

  if (state.ai.pendingFor === checkpointKey) {
    markAiWait(checkpointKey);
    return false;
  }

  if (state.ai.pending) {
    markAiWait(checkpointKey);
    return false;
  }

  markAiWait(checkpointKey);
  if (performance.now() < state.ai.retryAt) return false;

  const decision = makeDecisionRequest(player, { trigger: "route start" });
  requestAiDecision(decision, checkpointKey, "route start");
  return false;
}

function markAiWait(checkpointKey) {
  if (state.ai.waitingForKey === checkpointKey) return;
  state.ai.waitingForKey = checkpointKey;
  state.ai.metrics.decisionWaits += 1;
  updateTelemetryMetrics();
}

function startNextPlannedStep(player) {
  const target = state.ai.activePath.shift();
  if (!target) return false;
  const direction = Object.keys(DIRECTIONS).find((candidate) => {
    const next = nextCell(player.row, player.col, candidate);
    return next.row === target.row && next.col === target.col;
  });
  if (!direction) {
    state.ai.activePath = [];
    return false;
  }
  return startAiStep(player, direction);
}

function startAiStep(player, direction) {
  player.direction = direction;
  player.queuedDirection = direction;
  return beginStep(player, direction, "player");
}

function prefetchNextRoute(player, route) {
  const projectedWorld = simulatePath(liveSimulationState(), route.path);
  const target = {
    ...route.endpoint,
    steps: route.path.length,
    path: route.path,
  };
  const trigger = "route endpoint";
  const junctionKey = cellKey(target.row, target.col);
  if (state.ai.pendingFor === junctionKey || state.ai.decisionReady?.junctionKey === junctionKey) return;

  const decision = makeDecisionRequest(target, {
    ghosts: projectedWorld.ghosts,
    pellets: projectedWorld.pellets,
    powerPellets: projectedWorld.powerPellets,
    frightenedFor: projectedWorld.frightenedFor,
    recentTrail: [...state.trail, ...target.path.map((cell) => cellKey(cell.row, cell.col))],
    planningLeadTime: projectedWorld.simulatedSeconds,
    simulationState: projectedWorld,
    trigger,
  });
  requestAiDecision(decision, junctionKey, trigger, decisionStateKey(projectedWorld));
}

function makeDecisionRequest(player, {
  ghosts = ghostSnapshot(),
  pellets = state.pellets,
  powerPellets = state.powerPellets,
  frightenedFor = state.frightenedFor,
  recentTrail = state.trail,
  planningLeadTime = 0,
  simulationState = null,
  trigger = "route start",
} = {}) {
  const decision = buildDecisionRequest({
    player,
    ghosts,
    pellets,
    powerPellets,
    frightenedFor,
    level: state.level,
    lives: state.lives,
    recentTrail,
    playerSpeed: state.player.speed,
    planningLeadTime,
    preferredFoodTargetKey: state.ai.foodTargetKey,
    elapsedTime: simulationState?.elapsedTime ?? state.elapsedTime,
    randomSeed: simulationState?.seed ?? state.randomSeed,
    simulationState,
  });
  state.ai.foodTargetKey = decision.meta.foodTargetKey;
  decision.meta.trigger = trigger;
  decision.state.planningPolicy = `${activeProvider().name} chooses every route to the next junction; no local route fallback`;
  decision.state.decisionTrigger = trigger;
  return decision;
}

function ghostSnapshot() {
  return state.ghosts.map((ghost) => ({
    ...ghost,
    home: { ...ghost.home },
    corner: { ...ghost.corner },
    name: ghost.name,
    direction: ghost.direction,
    speed: ghost.speed,
  }));
}

function liveSimulationState() {
  return createSimulationState({
    player: state.player,
    ghosts: ghostSnapshot(),
    pellets: state.pellets,
    powerPellets: state.powerPellets,
    frightenedFor: state.frightenedFor,
    level: state.level,
    elapsedTime: state.elapsedTime,
    seed: state.randomSeed,
  });
}

function decisionStateKey(world = null) {
  const player = world?.player || state.player;
  const ghosts = world?.ghosts || state.ghosts;
  const pellets = world?.pellets || state.pellets;
  const powerPellets = world?.powerPellets || state.powerPellets;
  const frightenedFor = world?.frightenedFor ?? state.frightenedFor;
  const ghostKey = ghosts.map((ghost) => {
    const position = actorPosition(ghost);
    return `${Math.round(position.row * 4) / 4},${Math.round(position.col * 4) / 4},${ghost.direction}`;
  }).join("|");
  return `${player.row},${player.col};${pellets.size},${powerPellets.size};${Math.round(frightenedFor * 4) / 4};${ghostKey}`;
}

async function requestAiDecision(decision, junctionKey, trigger, expectedStateKey = decisionStateKey()) {
  const provider = activeProvider();
  const requestId = ++state.ai.requestId;
  state.ai.pending = true;
  state.ai.pendingFor = junctionKey;
  state.ai.decisionReady = null;
  state.ai.metrics.requests += 1;
  state.ai.metrics.totalSearchTimeMs += decision.meta.searchTimeMs || 0;
  state.ai.metrics.maximumSearchTimeMs = Math.max(state.ai.metrics.maximumSearchTimeMs, decision.meta.searchTimeMs || 0);
  if (decision.state.forecast.noCollisionFreeRouteFound) state.ai.metrics.forcedDangerStates += 1;
  state.ai.metrics.loopRoutesExcluded += decision.state.antiLoopRule.blockedRouteIds.length;
  const foodTarget = decision.state.foodNavigation?.target;
  const targetLabel = foodTarget
    ? `target ${foodTarget.row},${foodTarget.col} in ${decision.state.foodNavigation.targetRegion}`
    : "the cleared maze";
  setAiStatus("thinking", "Thinking");
  elements.jevDecision.textContent = "EVALUATING";
  elements.jevCaption.textContent = `Comparing ${decision.routeChoices.length} routes toward ${targetLabel} because of ${trigger}.`;
  elements.jevActivity.textContent = isWaitingForAi()
    ? `Planning for ${trigger} at cell ${decision.meta.row},${decision.meta.col} · Holding this tile so only ${provider.name} chooses the route.`
    : `Planning for ${trigger} at cell ${decision.meta.row},${decision.meta.col} · Pacman and ghosts keep moving.`;
  renderAiInput(decision);
  updateTelemetryMetrics();

  try {
    const response = await fetch("/api/ai/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: provider.id,
        ...(provider.id === "laya" && layaModelOverride ? { model: layaModelOverride } : {}),
        state: decision.state,
        routeCandidates: decision.routeChoices,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `${provider.name} request failed`);
    if (requestId !== state.ai.requestId || state.controlMode !== "ai" || provider.id !== state.ai.providerId) return;
    const route = decision.routes.find((candidate) => candidate.id === result.routeId);
    if (!route) throw new Error(`${provider.name} selected a route that is no longer available.`);
    const selection = selectionTelemetry(decision, route);
    state.ai.decisionReady = { route, junctionKey, trigger, expectedStateKey, selection };
    showAiDecision(result, decision);
  } catch (error) {
    if (requestId !== state.ai.requestId || state.controlMode !== "ai" || provider.id !== state.ai.providerId) return;
    state.ai.metrics.requestErrors += 1;
    state.ai.retryAt = performance.now() + 800;
    showAiRequestError(error.message, decision);
  } finally {
    if (requestId === state.ai.requestId) {
      state.ai.pending = false;
      state.ai.pendingFor = null;
    }
  }
}

function selectionTelemetry(decision, route) {
  return {
    level: state.level,
    decisionPosition: { row: decision.meta.row, col: decision.meta.col },
    routeId: route.id,
    candidateSafetyForecast: decision.state.routeCandidates[route.id],
    predictedMinimumClearance: route.minClearance,
    predictedSurvivalHorizon: route.survivalHorizon,
    collisionPredicted: route.collisionOccurred,
    searchDepth: route.searchDepth,
    simulationSeed: route.simulationSeed,
  };
}

function updateGhosts(delta) {
  for (const ghost of state.ghosts) {
    ghost.speed = ghostSpeed(state.level, state.frightenedFor > 0);
    if (ghost.progress === 0) {
      ghost.direction = chooseGhostDirection(ghost);
      beginStep(ghost, ghost.direction, "ghost");
    }
    moveEntity(ghost, delta);
  }
}

function beginStep(entity, direction, actor) {
  return beginActorStep(entity, direction, actor);
}

function moveEntity(entity, delta, onArrive = () => {}) {
  if (advanceActor(entity, delta)) onArrive();
}

function chooseGhostDirection(ghost) {
  const choice = chooseGhostDirectionCore({ ghost, player: state.player, frightenedFor: state.frightenedFor, elapsedTime: state.elapsedTime, seed: state.randomSeed });
  state.randomSeed = choice.seed;
  return choice.direction;
}

function seededRandom() {
  const random = nextSeededRandom(state.randomSeed);
  state.randomSeed = random.seed;
  return random.value;
}

function collectAt(row, col) {
  const key = cellKey(row, col);
  if (state.pellets.delete(key)) {
    if (state.controlMode === "ai") state.ai.metrics.dotsCollected += 1;
    addScore(10);
    state.player.pauseFor = Math.max(state.player.pauseFor, DOT_PAUSE_SECONDS);
    playTone(440 + (state.score % 80), 0.025, "square", 0.012);
  } else if (state.powerPellets.delete(key)) {
    if (state.controlMode === "ai") state.ai.metrics.dotsCollected += 1;
    addScore(50);
    state.frightenedFor = POWER_MODE_SECONDS;
    state.player.pauseFor = Math.max(state.player.pauseFor, POWER_DOT_PAUSE_SECONDS);
    playSequence([220, 330, 440], 0.055);
    announce("Power mode active.");
  }
  if (state.pellets.size + state.powerPellets.size === 0) advanceLevel();
}

function addScore(points) {
  state.score += points;
  if (state.score > state.highScore) {
    state.highScore = state.score;
    try { localStorage.setItem(highScoreStorageKey(), String(state.highScore)); } catch { /* Private browsing can block storage. */ }
  }
  updateHud();
}

function checkCollisions() {
  const player = renderedPosition(state.player);
  for (const ghost of state.ghosts) {
    const position = renderedPosition(ghost);
    const distance = Math.hypot(player.row - position.row, player.col - position.col);
    if (distance >= COLLISION_RADIUS) continue;
    if (state.frightenedFor > 0) {
      addScore(200);
      Object.assign(ghost, makeEntity(ghost.home, "up", ghost.speed));
      announce(`${ghost.name} caught. 200 points.`);
      playSequence([600, 820], 0.06);
    } else {
      recordDeathDiagnostic(ghost, player, position);
      loseLife();
    }
    break;
  }
}

function recordDeathDiagnostic(ghost, playerPosition, ghostPosition) {
  const selected = state.ai.lastSelection;
  const diagnostic = {
    ...(selected || {}),
    level: state.level,
    actualPacmanPosition: { row: playerPosition.row, col: playerPosition.col },
    actualGhostPosition: { row: ghostPosition.row, col: ghostPosition.col },
    ghostName: ghost.name,
    ghostHeading: ghost.direction,
    powerTimeRemaining: state.frightenedFor,
    forecastMismatch: Boolean(selected && !selected.collisionPredicted),
  };
  state.ai.lastDeathDiagnostic = diagnostic;
  if (diagnostic.forecastMismatch) state.ai.metrics.predictedSafeDeaths += 1;
  state.ai.log.unshift({
    number: state.ai.metrics.responses,
    cell: selected ? `${selected.decisionPosition.row},${selected.decisionPosition.col}` : "—",
    trigger: diagnostic.forecastMismatch ? "DEATH · FORECAST MISMATCH" : "DEATH · PREDICTED DANGER",
    candidates: JSON.stringify(diagnostic),
    direction: ghost.direction,
    routeId: selected?.routeId,
    confidence: NaN,
    latencyMs: null,
    model: ghost.name,
    source: "death",
  });
  state.ai.log = state.ai.log.slice(0, 10);
  renderTelemetryLog();
}

function renderedPosition(entity) {
  return actorPosition(entity);
}

function gameLoop(now) {
  let remainingDelta = Math.min(Math.max((now - state.lastTime) / 1000, 0) * simulationRate, MAX_FRAME_DELTA);
  state.lastTime = now;

  while (state.status === "playing" && remainingDelta > 0) {
    const simulationStep = Math.min(remainingDelta, MAX_SIMULATION_STEP);
    updateSimulation(simulationStep);
    remainingDelta -= simulationStep;
  }

  if (RENDER_INTERVAL === 0 || now - state.lastDrawTime >= RENDER_INTERVAL) {
    draw(now);
    state.lastDrawTime = now;
  }
  if (["playing", "paused", "countdown"].includes(state.status)) requestAnimationFrame(gameLoop);
}

function updateSimulation(delta) {
  updatePlayer(delta);
  if (state.status !== "playing") return;
  if (!isWaitingForAi()) {
    state.elapsedTime += delta;
    state.frightenedFor = Math.max(0, state.frightenedFor - delta);
    updateGhosts(delta);
    checkCollisions();
  }
}

function draw(now = 0) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(boardLayer, 0, 0);

  drawCollectibles(now);
  drawPlayer(now);
  state.ghosts.forEach((ghost) => drawGhost(ghost, now));

  if (state.status === "paused" || state.status === "countdown") {
    context.fillStyle = "rgba(3, 5, 13, .7)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#f7f5ff";
    context.font = "700 28px 'Avenir Next', 'Segoe UI', sans-serif";
    context.textAlign = "center";
    context.fillText(state.status === "paused" ? "PAUSED" : "READY!", canvas.width / 2, canvas.height / 2);
  } else if (state.ai.pending || isWaitingForAi()) {
    context.fillStyle = "rgba(3, 5, 13, .82)";
    context.fillRect(canvas.width / 2 - 86, 8, 172, 24);
    context.fillStyle = "#24e0ff";
    context.font = "700 10px 'Avenir Next', 'Segoe UI', sans-serif";
    context.textAlign = "center";
    const pilot = activeProvider().name.toUpperCase();
    context.fillText(isWaitingForAi() ? `WAITING FOR ${pilot} · NO LOCAL MOVE` : `${pilot} PLANNING AHEAD · GAME LIVE`, canvas.width / 2, 24);
  }
}

function isWaitingForAi() {
  if (state.controlMode !== "ai" || !state.player || state.player.progress !== 0) return false;
  return state.ai.waitingForKey === cellKey(state.player.row, state.player.col);
}

function buildBoardLayer() {
  const gradient = boardContext.createRadialGradient(canvas.width / 2, canvas.height / 2, 40, canvas.width / 2, canvas.height / 2, canvas.width * 0.75);
  gradient.addColorStop(0, "#0a0e24");
  gradient.addColorStop(1, "#03050d");
  boardContext.fillStyle = gradient;
  boardContext.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < parsed.height; row += 1) {
    for (let col = 0; col < parsed.width; col += 1) {
      const cell = getCell(row, col);
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (cell === "#") drawWall(boardContext, x, y, row, col);
      if (cell === "=") {
        boardContext.fillStyle = "#ff72c7";
        boardContext.fillRect(x + 3, y + TILE_SIZE / 2 - 1, TILE_SIZE - 6, 2);
      }
    }
  }
}

function drawCollectibles(now) {
  for (let row = 0; row < parsed.height; row += 1) {
    for (let col = 0; col < parsed.width; col += 1) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const key = cellKey(row, col);
      if (state.pellets.has(key)) drawPellet(x + 12, y + 12, 2.2, "#f7e9c2");
      if (state.powerPellets.has(key)) {
        const pulse = 5.2 + Math.sin(now / 160) * 1.2;
        drawPellet(x + 12, y + 12, pulse, "#ffe234", true);
      }
    }
  }
}

function drawWall(targetContext, x, y, row, col) {
  targetContext.fillStyle = "rgba(59, 74, 183, .16)";
  targetContext.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  targetContext.strokeStyle = "#5268ef";
  targetContext.lineWidth = 1.4;
  targetContext.shadowColor = "rgba(64, 91, 255,.55)";
  targetContext.shadowBlur = 5;
  if (getCell(row - 1, col) !== "#") line(targetContext, x + 2, y + 2, x + TILE_SIZE - 2, y + 2);
  if (getCell(row + 1, col) !== "#") line(targetContext, x + 2, y + TILE_SIZE - 2, x + TILE_SIZE - 2, y + TILE_SIZE - 2);
  if (getCell(row, col - 1) !== "#") line(targetContext, x + 2, y + 2, x + 2, y + TILE_SIZE - 2);
  if (getCell(row, col + 1) !== "#") line(targetContext, x + TILE_SIZE - 2, y + 2, x + TILE_SIZE - 2, y + TILE_SIZE - 2);
  targetContext.shadowBlur = 0;
}

function line(targetContext, x1, y1, x2, y2) {
  targetContext.beginPath();
  targetContext.moveTo(x1, y1);
  targetContext.lineTo(x2, y2);
  targetContext.stroke();
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
  if (lockedProviderId) return;
  if (!state.player || !DIRECTIONS[direction]) return;
  if (state.controlMode === "ai") setControlMode("manual");
  if (state.manualQueue.length < 8) state.manualQueue.push(direction);
  ensureAudio();
}

function setControlMode(mode) {
  if (mode === "ai" && !state.ai.configured) return false;
  state.controlMode = mode === "ai" ? "ai" : "manual";
  state.ai.requestId += 1;
  state.ai.pending = false;
  state.ai.pendingFor = null;
  state.ai.decisionReady = null;
  state.ai.activePath = [];
  state.ai.waitingForKey = null;
  state.ai.retryAt = 0;
  state.manualQueue = [];
  const provider = activeProvider();
  elements.controlModeButton.textContent = state.controlMode === "ai" ? "Take manual control" : `Let ${provider.name} drive`;
  elements.jevCaption.textContent = state.controlMode === "ai"
    ? `${provider.name} chooses complete routes from fresh whole-board state. The next route is planned ahead.`
    : `Manual pilot. Switch to ${provider.name} at any time.`;
  if (state.ai.configured) setAiStatus("ready", state.controlMode === "ai" ? "Driving" : "Ready");
  return true;
}

function showAiDecision(result, decision) {
  const provider = activeProvider();
  const foodTarget = decision.state.foodNavigation?.target;
  const targetLabel = foodTarget ? `target ${foodTarget.row},${foodTarget.col}` : "the final cleared state";
  state.ai.model = result.model || state.ai.model;
  state.ai.metrics.responses += 1;
  state.ai.metrics.inputTokens += Number(result.usage?.input_tokens) || 0;
  state.ai.metrics.outputTokens += Number(result.usage?.output_tokens) || 0;
  state.ai.metrics.totalLatency += Number(result.latencyMs) || 0;
  elements.jevDecision.textContent = routeLabel(result.routeId);
  elements.jevConfidence.textContent = percent(result.confidence);
  elements.jevLatency.textContent = `${result.latencyMs} ms`;
  elements.jevModel.textContent = result.model || state.ai.model || provider.name;
  elements.jevCaption.textContent = `${provider.name} selected a complete route toward ${targetLabel}. Pacman follows it while ${provider.name} plans ahead.`;
  renderProbabilities(result.probabilities, result.routeId);
  renderCandidateTelemetry(decision.routeChoices, result.probabilities, result.routeId);
  addDecisionHistory(result.direction);
  addTelemetryLog({
    decision,
    direction: result.direction,
    routeId: result.routeId,
    confidence: result.confidence,
    latencyMs: result.latencyMs,
    model: result.model || state.ai.model || provider.name,
    source: provider.name,
  });
  elements.jevActivity.textContent = `Route selected for ${decision.meta.trigger}: ${routeLabel(result.routeId)}. The complete path is queued from cell ${decision.meta.row},${decision.meta.col}.`;
  updateTelemetryMetrics();
  setAiStatus("ready", "Driving");
  announce(`${provider.name} chose ${routeLabel(result.routeId)} with ${percent(result.confidence)} confidence.`);
}

function showAiRequestError(message, decision) {
  const provider = activeProvider();
  elements.jevDecision.textContent = "RETRYING";
  elements.jevConfidence.textContent = "—";
  elements.jevLatency.textContent = "—";
  elements.jevModel.textContent = state.ai.model || provider.name;
  elements.jevCaption.textContent = `${message}. No local route was chosen; ${provider.name} will be asked again.`;
  renderProbabilities();
  renderCandidateTelemetry(decision.routeChoices);
  elements.jevActivity.textContent = `${provider.name} request failed at cell ${decision.meta.row},${decision.meta.col}. Holding the decision tile and retrying without a local fallback.`;
  updateTelemetryMetrics();
  setAiStatus("error", "Retrying");
}

function renderProbabilities(probabilities = {}, selected) {
  const rows = Object.entries(probabilities)
    .sort(([, left], [, right]) => right - left)
    .map(([direction, probability]) => {
      const row = document.createElement("div");
      row.className = `probability-row${direction === selected ? " selected" : ""}`;
      const label = document.createElement("span");
      label.textContent = routeLabel(direction);
      const track = document.createElement("span");
      track.className = "probability-track";
      const fill = document.createElement("i");
      fill.style.setProperty("--probability", `${Math.max(0, Math.min(1, probability)) * 100}%`);
      track.append(fill);
      const value = document.createElement("span");
      value.textContent = percent(probability);
      row.append(label, track, value);
      return row;
    });
  elements.jevProbabilities.replaceChildren(...rows);
}

function renderAiInput(decision) {
  elements.jevStatePayload.textContent = JSON.stringify(decision.state, null, 2);
  renderCandidateTelemetry(decision.routeChoices);
}

function renderCandidateTelemetry(routeChoices, probabilities = {}, selected = null) {
  const cards = routeChoices.map((move) => {
    const item = document.createElement("li");
    if (move.id === selected) item.className = "selected";

    const heading = document.createElement("div");
    const direction = document.createElement("strong");
    direction.textContent = routeLabel(move.id);
    const probability = document.createElement("span");
    probability.textContent = Number.isFinite(probabilities[move.id])
      ? percent(probabilities[move.id])
      : "candidate";
    heading.append(direction, probability);

    const summary = document.createElement("p");
    summary.textContent = move.summary;
    item.append(heading, summary);
    return item;
  });
  elements.jevCandidateDetails.replaceChildren(...cards);
}

function addTelemetryLog({ decision, direction, routeId, confidence, latencyMs, model, source }) {
  state.ai.log.unshift({
    number: state.ai.metrics.responses,
    cell: `${decision.meta.row},${decision.meta.col}`,
    trigger: decision.meta.trigger,
    candidates: `${decision.routeChoices.length} routes`,
    direction,
    routeId,
    confidence,
    latencyMs,
    model,
    source,
  });
  state.ai.log = state.ai.log.slice(0, 10);

  renderTelemetryLog();
}

function renderTelemetryLog() {
  const rows = state.ai.log.map((entry) => {
    const row = document.createElement("tr");
    const values = [
      `#${entry.number}`,
      entry.cell,
      entry.trigger,
      entry.candidates,
      routeLabel(entry.routeId),
      percent(entry.confidence),
      entry.latencyMs === null ? "—" : `${entry.latencyMs} ms`,
      entry.model,
    ];
    row.append(...values.map((value, index) => {
      const cell = document.createElement(index === 0 ? "th" : "td");
      if (index === 0) cell.scope = "row";
      cell.textContent = value;
      return cell;
    }));
    row.dataset.source = entry.source.toLowerCase();
    return row;
  });
  elements.jevDecisionLog.replaceChildren(...rows);
}

function updateTelemetryMetrics() {
  const metrics = state.ai.metrics;
  elements.jevRequestCount.textContent = String(metrics.requests);
  elements.jevResponseCount.textContent = String(metrics.responses);
  elements.jevErrorCount.textContent = String(metrics.requestErrors);
  elements.jevTokenCount.textContent = String(metrics.inputTokens + metrics.outputTokens);
  elements.jevAverageLatency.textContent = metrics.responses > 0
    ? `${Math.round(metrics.totalLatency / metrics.responses)} ms`
    : "—";
  elements.jevDecisionWaits.textContent = String(metrics.decisionWaits);
  elements.jevDotsPerRequest.textContent = metrics.requests > 0
    ? (metrics.dotsCollected / metrics.requests).toFixed(2)
    : "—";
  elements.jevScorePerRequest.textContent = metrics.requests > 0
    ? Math.round(state.score / metrics.requests).toString()
    : "—";
  elements.jevDeaths.textContent = String(metrics.deaths);
  elements.jevLoopRoutesExcluded.textContent = String(metrics.loopRoutesExcluded);
}

function resetTelemetryDisplay() {
  const provider = activeProvider();
  elements.jevStatePayload.textContent = `${provider.name} has not received a tile state yet.`;
  const candidate = document.createElement("li");
  candidate.className = "empty-candidate";
  candidate.textContent = "Simulated routes and their computed risk summaries will appear here.";
  elements.jevCandidateDetails.replaceChildren(candidate);
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 8;
  cell.textContent = "No decisions yet.";
  row.append(cell);
  elements.jevDecisionLog.replaceChildren(row);
  elements.jevActivity.textContent = `Waiting for ${provider.name} mode and the first tile decision.`;
  updateTelemetryMetrics();
}

function freshAiMetrics() {
  return {
    requests: 0,
    responses: 0,
    requestErrors: 0,
    decisionWaits: 0,
    dotsCollected: 0,
    deaths: 0,
    loopRoutesExcluded: 0,
    prefetchInvalidations: 0,
    prefetchRevalidations: 0,
    predictedSafeDeaths: 0,
    forcedDangerStates: 0,
    totalSearchTimeMs: 0,
    maximumSearchTimeMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalLatency: 0,
  };
}

function addDecisionHistory(direction) {
  state.ai.history.unshift(direction);
  state.ai.history = state.ai.history.slice(0, 7);
  elements.jevHistory.replaceChildren(...state.ai.history.map((item) => {
    const entry = document.createElement("li");
    entry.textContent = directionArrow(item);
    entry.title = item;
    return entry;
  }));
}

function resetDecisionDisplay() {
  const provider = activeProvider();
  elements.pilotLabel.textContent = `${provider.name} pilot${provider.selfHosted ? " · self-hosted" : ""}`;
  elements.jevDecision.textContent = "STANDBY";
  elements.jevConfidence.textContent = "—";
  elements.jevLatency.textContent = "—";
  elements.jevModel.textContent = state.ai.model || "—";
  const empty = document.createElement("p");
  empty.className = "empty-decisions";
  empty.textContent = "Waiting for a decision.";
  elements.jevProbabilities.replaceChildren(empty);
  const history = document.createElement("li");
  history.textContent = "No decisions yet";
  elements.jevHistory.replaceChildren(history);
}

function setAiStatus(kind, label) {
  elements.jevStatus.className = `status-pill ${kind}`;
  elements.jevStatus.lastChild.textContent = label;
}

function directionArrow(direction) {
  return { up: "↑", down: "↓", left: "←", right: "→" }[direction] || "·";
}

function routeLabel(routeId) {
  if (!routeId) return "—";
  return routeId.split("_then_")
    .map((direction) => `${directionArrow(direction)} ${direction.toUpperCase()}`)
    .join("  ›  ");
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function activeProvider() {
  return state.ai.providers[state.ai.providerId];
}

function selectAiProvider(providerId) {
  const provider = state.ai.providers[providerId];
  if (!provider?.available) return false;
  state.ai.providerId = providerId;
  state.ai.configured = true;
  state.ai.model = provider.model;
  elements.pilotLabel.textContent = `${provider.name} pilot${provider.selfHosted ? " · self-hosted" : ""}`;
  elements.jevModel.textContent = provider.model;
  elements.controlModeButton.disabled = false;
  if (state.controlMode !== "ai") elements.controlModeButton.textContent = `Let ${provider.name} drive`;
  return true;
}

function beginAiGame(providerId) {
  if (!selectAiProvider(providerId)) return;
  beginGame("ai");
}

async function checkAiStatus() {
  try {
    const response = await fetch("/api/ai/status");
    if (!response.ok) throw new Error("Status unavailable");
    const result = await response.json();
    for (const providerId of ["jev", "laya"]) {
      if (result.providers?.[providerId]) state.ai.providers[providerId] = result.providers[providerId];
    }

    const jev = state.ai.providers.jev;
    const laya = state.ai.providers.laya;
    if (comparisonEmbed && lockedProviderId) {
      const provider = state.ai.providers[lockedProviderId];
      if (lockedProviderId === "laya" && layaModelOverride) provider.model = layaModelOverride;
      if (provider.available) selectAiProvider(lockedProviderId);
      else {
        state.ai.configured = false;
        state.ai.model = provider.model;
        elements.pilotLabel.textContent = `${provider.name} pilot${provider.selfHosted ? " · self-hosted" : ""}`;
        elements.jevModel.textContent = provider.model;
        elements.controlModeButton.disabled = true;
      }
      configureComparisonOverlay(provider);
      setAiStatus(provider.available ? "ready" : "error", provider.available ? "Ready" : "Offline");
      notifyComparisonParent("readiness", { provider: lockedProviderId, available: provider.available });
      return provider.available;
    }

    elements.jevStartButton.disabled = !jev.available;
    elements.layaStartButton.disabled = !laya.available;
    elements.jevStartButton.textContent = jev.available ? "Watch Jev play" : "Jev key required";
    elements.layaStartButton.textContent = laya.available
      ? "Watch Laya play"
      : laya.configured ? "Laya is offline" : "Laya URL required";

    const firstReady = [activeProvider(), jev, laya].find((provider) => provider.available);
    if (firstReady) selectAiProvider(firstReady.id);
    else {
      state.ai.configured = false;
      state.ai.model = null;
      elements.controlModeButton.disabled = true;
    }

    const readyNames = [jev, laya].filter((provider) => provider.available).map((provider) => provider.name);
    elements.jevSetupHint.textContent = readyNames.length
      ? `${readyNames.join(" and ")} ${readyNames.length === 1 ? "is" : "are"} ready. Laya runs on your own server.`
      : laya.configured
        ? "Laya is configured but its local server is not responding. Start laya-serve and refresh."
        : "Set TYPESAFE_API_KEY for Jev or LAYA_BASE_URL for self-hosted Laya.";
    setAiStatus(firstReady ? "ready" : "error", firstReady ? "Ready" : "Not set");
    return Boolean(firstReady);
  } catch {
    Object.values(state.ai.providers).forEach((provider) => { provider.available = false; });
    state.ai.configured = false;
    elements.jevStartButton.disabled = true;
    elements.layaStartButton.disabled = true;
    elements.controlModeButton.disabled = true;
    elements.jevStartButton.textContent = "Jev unavailable";
    elements.layaStartButton.textContent = "Laya unavailable";
    elements.jevSetupHint.textContent = "The local game server is unavailable.";
    setAiStatus("error", "Offline");
    if (comparisonEmbed) notifyComparisonParent("readiness", { provider: lockedProviderId, available: false });
    return false;
  }
}

function configureComparisonOverlay(provider) {
  const kicker = elements.startOverlay.querySelector(".overlay-kicker");
  const heading = elements.startOverlay.querySelector("h2");
  kicker.textContent = `${provider.name} pilot`;
  heading.textContent = provider.available ? "Ready for the race." : `${provider.name} is not ready.`;
  elements.jevSetupHint.textContent = provider.available
    ? "Use Start both pilots above to begin the comparison."
    : provider.id === "laya" && provider.configured
      ? "Start the self-hosted Laya server, then refresh this page."
      : `Configure ${provider.name} on the local server, then refresh.`;
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
  try { return Number(localStorage.getItem(highScoreStorageKey())) || 0; } catch { return 0; }
}

function highScoreStorageKey() {
  return comparisonEmbed && lockedProviderId
    ? `packman-high-score-${lockedProviderId}`
    : "packman-high-score";
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

function notifyComparisonParent(type, detail = {}) {
  if (!comparisonEmbed || window.parent === window) return;
  window.parent.postMessage({ source: "pacman-pilot", type, provider: lockedProviderId, ...detail }, window.location.origin);
}

function reportComparisonHeight() {
  if (!comparisonEmbed) return;
  const height = document.documentElement.scrollHeight;
  if (height !== reportComparisonHeight.lastHeight) {
    reportComparisonHeight.lastHeight = height;
    notifyComparisonParent("resize", { height });
  }
}
reportComparisonHeight.lastHeight = 0;

if (comparisonEmbed) {
  window.addEventListener("message", async (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent || event.data?.source !== "pacman-comparison") return;
    if (event.data.type === "start") {
      const ready = await checkAiStatus();
      if (ready && state.status !== "playing") beginAiGame(lockedProviderId);
    }
    if (event.data.type === "pause" && state.status === "playing") togglePause();
    if (event.data.type === "resume" && state.status === "paused") togglePause();
  });

  const resizeObserver = new ResizeObserver(() => window.requestAnimationFrame(reportComparisonHeight));
  resizeObserver.observe(document.body);
  window.addEventListener("load", reportComparisonHeight);
}

const keyDirections = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
document.addEventListener("keydown", (event) => {
  if (keyDirections[event.key]) {
    event.preventDefault();
    if (event.repeat) return;
    queueDirection(keyDirections[event.key]);
  } else if (event.key === "p" || event.key === "P" || event.key === " ") {
    if (comparisonEmbed) return;
    event.preventDefault();
    togglePause();
  }
});

elements.startButton.addEventListener("click", () => beginGame("manual"));
elements.jevStartButton.addEventListener("click", () => beginAiGame("jev"));
elements.layaStartButton.addEventListener("click", () => beginAiGame("laya"));
elements.restartButton.addEventListener("click", () => beginGame(state.controlMode));
elements.pauseButton.addEventListener("click", togglePause);
elements.soundButton.addEventListener("click", toggleSound);
elements.controlModeButton.addEventListener("click", () => {
  const nextMode = state.controlMode === "ai" ? "manual" : "ai";
  if (setControlMode(nextMode)) announce(nextMode === "ai" ? `${activeProvider().name} has control.` : "Manual control restored.");
});
document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    queueDirection(button.dataset.direction);
  });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.status === "playing") togglePause();
});

buildBoardLayer();
loadLevel();
updateHud();
draw();
checkAiStatus();
