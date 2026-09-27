import { benchmarkSeeds, summarizeBenchmark } from "./benchmark-summary.js";

const LAYA_MODELS = ["english", "multilingual", "typed-decisions"];
const elements = {
  form: document.querySelector("#benchmarkForm"),
  runCount: document.querySelector("#runCount"),
  baseSeed: document.querySelector("#baseSeed"),
  levelGoal: document.querySelector("#levelGoal"),
  speed: document.querySelector("#simulationSpeed"),
  start: document.querySelector("#startBenchmark"),
  stop: document.querySelector("#stopBenchmark"),
  status: document.querySelector("#benchmarkStatus"),
  progress: document.querySelector("#benchmarkProgress"),
  current: document.querySelector("#currentRun"),
  frame: document.querySelector("#benchmarkFrame"),
  summary: document.querySelector("#summaryBody"),
  runs: document.querySelector("#runBody"),
};

let providerStatus = {};
let queue = [];
let results = [];
let currentScenario = null;
let running = false;
let runTimeout = null;

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!providersReady() || running) return;
  const count = clampNumber(elements.runCount.value, 1, 10, 3);
  const baseSeed = Number(elements.baseSeed.value) >>> 0;
  const speed = clampNumber(elements.speed.value, 1, 8, 4);
  const levels = clampNumber(elements.levelGoal.value, 1, 5, 1);
  const seeds = benchmarkSeeds(baseSeed, count);
  queue = [
    ...seeds.map((seed) => ({ provider: "jev", model: providerStatus.jev.model, seed, speed, levels })),
    ...LAYA_MODELS.flatMap((model) => seeds.map((seed) => ({ provider: "laya", model, seed, speed, levels }))),
  ];
  results = [];
  running = true;
  elements.start.disabled = true;
  elements.stop.disabled = false;
  elements.summary.replaceChildren(emptyRow(15, "Results appear after the first completed run."));
  elements.runs.replaceChildren(emptyRow(13, "The first seeded run is starting."));
  startNextRun();
});

elements.stop.addEventListener("click", () => finishBenchmark("Comparison stopped. Partial results are preserved."));

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.source !== elements.frame.contentWindow || event.data?.source !== "pacman-pilot") return;
  if (event.data.type === "resize" && Number.isFinite(event.data.height)) {
    elements.frame.style.height = `${Math.min(980, Math.max(720, Math.ceil(event.data.height)))}px`;
  }
  if (event.data.type === "state" && event.data.status === "playing") {
    elements.current.textContent = `${scenarioName(currentScenario)} is playing seed ${currentScenario.seed}.`;
  }
  if (event.data.type === "state" && event.data.status === "over" && currentScenario) completeRun(event.data);
});

async function refreshStatus() {
  try {
    const response = await fetch("/api/ai/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status unavailable");
    const data = await response.json();
    providerStatus = data.providers || {};
    const serverModels = providerStatus.laya?.models || [];
    const missingModels = LAYA_MODELS.filter((model) => !serverModels.includes(model));
    if (missingModels.length > 0) {
      elements.status.textContent = `This server does not expose all Laya checkpoints: ${missingModels.join(", ")}.`;
    } else if (providersReady()) {
      elements.status.textContent = "Jev and Laya are ready. Every pilot will receive the same seeds.";
    } else {
      const missing = ["jev", "laya"].filter((provider) => !providerStatus[provider]?.available).map(displayName);
      elements.status.textContent = `${missing.join(" and ")} must be available before the comparison can start.`;
    }
  } catch {
    providerStatus = {};
    elements.status.textContent = "The local Pacman server is not responding.";
  }
  elements.start.disabled = running || !providersReady();
  if (!running) elements.start.textContent = providersReady() ? "Start comparison" : "Waiting for pilots…";
}

function startNextRun() {
  window.clearTimeout(runTimeout);
  if (!running || queue.length === 0) {
    finishBenchmark(results.length ? "Comparison complete." : "No runs completed.");
    return;
  }
  currentScenario = queue.shift();
  const total = results.length + queue.length + 1;
  elements.progress.value = results.length;
  elements.progress.max = total;
  elements.current.textContent = `Loading ${scenarioName(currentScenario)} · seed ${currentScenario.seed}`;
  elements.status.textContent = `Run ${results.length + 1} of ${total}`;
  const params = new URLSearchParams({
    embed: "1",
    benchmark: "1",
    provider: currentScenario.provider,
    seed: String(currentScenario.seed),
    speed: String(currentScenario.speed),
    levels: String(currentScenario.levels),
  });
  if (currentScenario.provider === "laya") params.set("model", currentScenario.model);
  elements.frame.onload = () => {
    elements.frame.contentWindow?.postMessage({ source: "pacman-comparison", type: "start" }, window.location.origin);
  };
  elements.frame.src = `pilot.html?${params}`;
  runTimeout = window.setTimeout(() => {
    if (!currentScenario) return;
    results.push({ ...currentScenario, failed: true, score: 0, completed: false, deaths: 0, dotsCollected: 0, averageLatencyMs: null });
    renderResults();
    currentScenario = null;
    startNextRun();
  }, 8 * 60 * 1000);
}

function completeRun(data) {
  window.clearTimeout(runTimeout);
  results.push({
    ...currentScenario,
    score: Number(data.score) || 0,
    completed: Boolean(data.completed),
    deaths: Number(data.deaths) || 0,
    dotsCollected: Number(data.dotsCollected) || 0,
    remainingDots: Number(data.remainingDots) || 0,
    requests: Number(data.requests) || 0,
    level: Number(data.level) || 1,
    levelsCleared: Number(data.levelsCleared) || 0,
    predictedSafeDeaths: Number(data.predictedSafeDeaths) || 0,
    forcedDangerStates: Number(data.forcedDangerStates) || 0,
    averageSearchTimeMs: Number(data.averageSearchTimeMs) || 0,
    maximumSearchTimeMs: Number(data.maximumSearchTimeMs) || 0,
    averageLatencyMs: Number.isFinite(data.averageLatencyMs) ? data.averageLatencyMs : null,
  });
  currentScenario = null;
  renderResults();
  window.setTimeout(startNextRun, 250);
}

function finishBenchmark(message) {
  running = false;
  queue = [];
  currentScenario = null;
  window.clearTimeout(runTimeout);
  elements.frame.onload = null;
  elements.frame.src = "about:blank";
  elements.start.disabled = !providersReady();
  elements.stop.disabled = true;
  elements.progress.value = results.length;
  elements.status.textContent = message;
  elements.current.textContent = results.length ? `${results.length} runs recorded.` : "No active run.";
}

function renderResults() {
  const summaryRows = summarizeBenchmark(results).map((group) => row([
    group.provider === "jev" ? "Jev" : "Laya",
    group.model,
    group.runs,
    `${group.clears}/${group.runs}`,
    rounded(group.averageScore),
    signed(group.pairedScoreDelta, group.provider === "jev"),
    rounded(group.averageDots),
    rounded(group.averageDeaths, 2),
    group.highestLevel,
    rounded(group.averageLevelsCleared, 2),
    group.predictedSafeDeaths,
    rounded(group.averageSearchTimeMs, 2),
    rounded(group.maximumSearchTimeMs, 2),
    group.forcedDangerStates,
    group.averageLatencyMs === null ? "—" : `${rounded(group.averageLatencyMs)} ms`,
  ]));
  elements.summary.replaceChildren(...summaryRows);

  const runRows = results.map((result, index) => row([
    index + 1,
    scenarioName(result),
    result.seed,
    result.completed ? "Cleared" : result.failed ? "Timed out" : "Lives lost",
    result.score,
    result.dotsCollected,
    result.deaths,
    result.level,
    result.levelsCleared,
    result.predictedSafeDeaths,
    `${rounded(result.averageSearchTimeMs, 2)}/${rounded(result.maximumSearchTimeMs, 2)} ms`,
    result.forcedDangerStates,
    result.averageLatencyMs === null ? "—" : `${result.averageLatencyMs} ms`,
  ]));
  elements.runs.replaceChildren(...runRows);
  elements.progress.value = results.length;
}

function row(values) {
  const tr = document.createElement("tr");
  tr.append(...values.map((value) => {
    const td = document.createElement("td");
    td.textContent = String(value);
    return td;
  }));
  return tr;
}

function emptyRow(columns, message) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = columns;
  td.textContent = message;
  tr.append(td);
  return tr;
}

function providersReady() {
  return Boolean(providerStatus.jev?.available && providerStatus.laya?.available);
}

function scenarioName(scenario) {
  if (!scenario) return "Pilot";
  return scenario.provider === "jev" ? "Jev" : `Laya · ${scenario.model}`;
}

function displayName(provider) {
  return provider === "jev" ? "Jev" : "Laya";
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function rounded(value, digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function signed(value, baseline = false) {
  if (baseline) return "baseline";
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${Math.round(value)}`;
}

refreshStatus();
