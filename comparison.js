const providers = ["jev", "laya"];
const frames = {
  jev: document.querySelector("#jevFrame"),
  laya: document.querySelector("#layaFrame"),
};
const statusPills = {
  jev: document.querySelector("#jevRaceStatus"),
  laya: document.querySelector("#layaRaceStatus"),
};
const startButton = document.querySelector("#startRaceButton");
const pauseButton = document.querySelector("#pauseRaceButton");
const newRaceButton = document.querySelector("#newRaceButton");
const raceStatus = document.querySelector("#raceStatus");
const frameLoaded = { jev: false, laya: false };
let providerStatus = {};
let raceStarted = false;
let racePaused = false;
let statusTimer = null;

for (const provider of providers) {
  frames[provider].addEventListener("load", () => {
    frameLoaded[provider] = true;
    updateRaceControls();
  });
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const provider = providers.find((candidate) => frames[candidate].contentWindow === event.source);
  if (!provider || event.data?.source !== "pacman-pilot") return;

  if (event.data.type === "resize" && Number.isFinite(event.data.height)) {
    frames[provider].style.height = `${Math.max(900, Math.ceil(event.data.height))}px`;
  }
  if (event.data.type === "state") {
    if (event.data.status === "over") setProviderPill(provider, "ready", "Finished");
    if (event.data.status === "paused") setProviderPill(provider, "ready", "Paused");
    if (event.data.status === "playing") setProviderPill(provider, "playing", "Playing");
  }
});

startButton.addEventListener("click", () => {
  if (!bothReady() || raceStarted) return;
  raceStarted = true;
  racePaused = false;
  startButton.disabled = true;
  startButton.textContent = "Race in progress";
  pauseButton.disabled = false;
  raceStatus.textContent = "Both pilots started from the same initial maze. Scroll to compare every decision trace.";
  for (const provider of providers) setProviderPill(provider, "playing", "Starting");
  postToBoth("start");
  window.clearInterval(statusTimer);
});

pauseButton.addEventListener("click", () => {
  if (!raceStarted) return;
  racePaused = !racePaused;
  pauseButton.textContent = racePaused ? "Resume both" : "Pause both";
  raceStatus.textContent = racePaused ? "Both games are paused." : "Both games are running.";
  postToBoth(racePaused ? "pause" : "resume");
});

newRaceButton.addEventListener("click", () => window.location.reload());

document.addEventListener("keydown", (event) => {
  if ((event.key === "p" || event.key === "P" || event.key === " ") && raceStarted) {
    event.preventDefault();
    pauseButton.click();
  }
});

async function refreshStatus() {
  try {
    const response = await fetch("/api/ai/status", { cache: "no-store" });
    if (!response.ok) throw new Error("Status unavailable");
    const result = await response.json();
    providerStatus = result.providers || {};
    for (const provider of providers) {
      const status = providerStatus[provider];
      setProviderPill(provider, status?.available ? "ready" : "offline", status?.available ? "Ready" : offlineLabel(provider, status));
    }
    updateRaceControls();
  } catch {
    providerStatus = {};
    for (const provider of providers) setProviderPill(provider, "offline", "Server offline");
    raceStatus.textContent = "The local Pacman server is not responding.";
    updateRaceControls();
  }
}

function updateRaceControls() {
  if (raceStarted) return;
  const ready = bothReady();
  startButton.disabled = !ready;
  startButton.textContent = ready ? "Start both pilots" : "Waiting for both pilots…";

  const missing = providers.filter((provider) => !providerStatus[provider]?.available);
  if (missing.length === 0 && providers.every((provider) => frameLoaded[provider])) {
    raceStatus.textContent = "Both pilots are ready. Start the race to run them side by side.";
  } else if (missing.length > 0) {
    raceStatus.textContent = `${missing.map(displayName).join(" and ")} ${missing.length === 1 ? "is" : "are"} not ready. Both providers are required for comparison mode.`;
  } else {
    raceStatus.textContent = "Both providers are ready; loading the two game panels…";
  }
}

function bothReady() {
  return providers.every((provider) => providerStatus[provider]?.available && frameLoaded[provider]);
}

function offlineLabel(provider, status) {
  if (provider === "jev") return status?.configured ? "Unavailable" : "No key";
  return status?.configured ? "Offline" : "No URL";
}

function displayName(provider) {
  return provider === "jev" ? "Jev" : "Laya";
}

function setProviderPill(provider, kind, label) {
  const pill = statusPills[provider];
  pill.className = `provider-status ${kind}`;
  pill.lastChild.textContent = label;
}

function postToBoth(action) {
  for (const provider of providers) {
    frames[provider].contentWindow?.postMessage({ source: "pacman-comparison", type: action }, window.location.origin);
  }
}

refreshStatus();
statusTimer = window.setInterval(refreshStatus, 3_000);
