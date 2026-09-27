import { choice } from "@typesafe-ai/sdk";
import { createTypeSafeClient, decisionResult, requestError, requireClient, validateDecisionPayload } from "./provider-utils.js";

export const LAYA_MODELS = Object.freeze(["english", "multilingual", "typed-decisions"]);
export const LAYA_MODEL = process.env.LAYA_MODEL?.trim() || "english";

const instructions = {
  task: "Choose one safe Pacman route.",
  rules: [
    "Never choose a simulated-fatal route when any collision-free candidate exists. Survival comes first.",
    "DANGEROUS ghost contact is fatal from every direction, even when Pacman catches it from behind. Never chase or overtake one.",
    "EDIBLE ghosts may be approached only when power time lasts through contact.",
    "Compare survival, clearance, traps and exits, power tactics, food progress, then repetition.",
    "The continuation preview is only a forecast; Pacman replans at the next junction.",
    "Choose exactly one supplied route id.",
  ],
};

export function createLayaProvider({ apiKey = process.env.LAYA_API_KEY, baseURL = process.env.LAYA_BASE_URL, model = LAYA_MODEL, client } = {}) {
  const normalizedBaseUrl = baseURL?.trim().replace(/\/$/, "");
  const configured = Boolean(client || normalizedBaseUrl);
  const typeSafe = createTypeSafeClient({ client, configured, apiKey, baseURL: normalizedBaseUrl, model });
  return {
    id: "laya",
    name: "Laya",
    selfHosted: true,
    configured,
    model,
    models: LAYA_MODELS,
    async isAvailable() {
      if (!configured) return false;
      if (client) return true;
      try {
        const response = await fetch(`${normalizedBaseUrl}/health`, {
          headers: apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {},
          signal: AbortSignal.timeout(1_500),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    async decide(rawPayload) {
      requireClient(typeSafe, "Laya");
      const payload = validateDecisionPayload(rawPayload);
      const selectedModel = requestedModel(payload.model, model);
      const prepared = prepareLayaDecision(payload);
      const startedAt = performance.now();
      const result = await typeSafe.systemOne({
        model: selectedModel,
        state: prepared.state,
        questions: { route: choice(instructions, prepared.criteria) },
      });
      return decisionResult({ answer: result.answers?.route, result, payload, id: "laya", name: "Laya", startedAt });
    },
  };
}

export function prepareLayaDecision(payload) {
  return {
    state: compactLayaState(payload.state),
    criteria: Object.fromEntries(payload.routeCandidates.map((route) => [
      route.id,
      compactRouteCriterion(route, payload.state.routeCandidates?.[route.id]),
    ])),
  };
}

export function compactLayaState(state) {
  const board = state.wholeMazeSnapshot || {};
  return {
    goal: "survive; clear all dots",
    mode: state.mode?.startsWith("power") ? "POWER" : "NORMAL",
    fatalRule: "A/B/C contact is fatal, including catching from behind; never chase or overtake. a/b/c edible only while power>0.",
    lives: state.lives,
    heading: state.currentHeading,
    at: [state.plannedDecisionPosition?.row, state.plannedDecisionPosition?.col],
    power: state.powerModeSecondsRemaining,
    delay: state.forecast?.planStartsInSeconds,
    dots: [board.remainingRegularDots, board.remainingPowerDots],
    target: state.foodNavigation?.target ? [state.foodNavigation.target.row, state.foodNavigation.target.col, state.foodNavigation.targetRegion, state.foodNavigation.shortestDistanceFromDecision] : null,
    legend: "# wall . dot o power P Pacman A/B/C fatal a/b/c edible * stacked",
    maze: board.mapTopToBottom?.join("\n"),
    ghosts: board.ghosts?.map((ghost) => [ghost.marker, ghost.position?.row, ghost.position?.col, ghost.heading, ghost.state]),
  };
}

export function compactRouteCriterion(route, metrics = {}) {
  const lead = typeof metrics.nearestGhostLeadSeconds === "number" ? `${metrics.nearestGhostLeadSeconds}s` : String(metrics.nearestGhostLeadSeconds || "unknown");
  return [
    `rank=${metrics.codeStrategicRank ?? "?"}`,
    `fatal=${metrics.collisionOccurred ? "y" : "n"}`,
    `horizon=${metrics.simulatedSurvivalSeconds ?? "?"}s`,
    `clear=${metrics.minimumClearanceTiles ?? "?"}`,
    `trap=${metrics.forcedTrap ? "y" : "n"}`,
    `lead=${lead}`,
    `risk=${riskCode(metrics.ghostTiming)}`,
    `food=${metrics.foodDots ?? 0}+${metrics.powerPellets ?? 0}p`,
    `next=${metrics.estimatedTravelTilesToNextDot ?? "?"}`,
    `target=${metrics.targetTravelTiles ?? "?"}/${metrics.targetProgressTiles ?? 0}`,
    `exits=${metrics.destinationExitCount ?? "?"}`,
    `safeNext=${metrics.safeContinuationCount ?? "?"}`,
    `powerLeft=${metrics.powerModeRemainingAtHorizon ?? 0}`,
    `preview=${metrics.continuationPreview ?? route.direction}`,
    `uturn=${metrics.immediateReverse ? "y" : "n"}`,
    `repeat=${metrics.recentPathTiles ?? 0}`,
  ].join(" ");
}

function riskCode(timing) {
  const value = String(timing || "unknown").toLowerCase();
  if (value.includes("immediate") || value.includes("collision")) return "danger";
  if (value.includes("safe") || value.includes("cannot") || value.includes("unreachable")) return "safe";
  if (value.includes("edible")) return "edible";
  return "caution";
}

function requestedModel(candidate, fallback) {
  if (candidate === undefined) return fallback;
  if (!LAYA_MODELS.includes(candidate)) throw requestError(`Unsupported Laya model: ${candidate}.`);
  return candidate;
}
