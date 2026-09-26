import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

export const JEV_MODEL = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
export const LAYA_MODEL = process.env.LAYA_MODEL?.trim() || "typed-decisions";
export const PROVIDER_IDS = new Set(["jev", "laya"]);
export const DIRECTIONS = new Set(["up", "down", "left", "right"]);

const decisionInstructions = {
  task: "Choose Pacman's best two-junction route. Pacman will execute the complete route while the next route is planned ahead.",
  priorities: [
    "In normal mode, avoid predicted active-ghost collision risk before pursuing food.",
    "Reconsider ghost timing and the complete map at every planned route endpoint; survival takes priority over the previous direction.",
    "In power mode, prefer a safe edible-ghost interception that finishes before power mode expires.",
    "Use the code strategic rank as the default ordering; it already combines safety, food progress, nearby-dot cleanup, escape options, and repetition.",
    "Recent foodless reversals are filtered out before this choice unless they provide a genuine ghost-safety upgrade.",
    "During the final dots, strongly prefer routes that reduce maze distance to the nearest remaining dot, even when the route itself collects no food yet.",
    "Choose exactly one supplied route candidate.",
  ],
  note: "The state contains a fresh whole-board snapshot with Pacman, ghosts, walls, food, lives, and power timing. Route simulation and strategic ranks were calculated by the game; use them instead of redoing pathfinding from the raw map.",
};

export function validateDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw requestError("The request body must be an object.");
  }
  if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) {
    throw requestError("state must be an object.");
  }
  if (!Array.isArray(payload.routeCandidates) || payload.routeCandidates.length < 1 || payload.routeCandidates.length > 16) {
    throw requestError("routeCandidates must contain between one and sixteen routes.");
  }

  const seen = new Set();
  for (const move of payload.routeCandidates) {
    if (!move || typeof move.id !== "string" || !/^[a-z]+(?:_then_[a-z]+)?$/.test(move.id) || seen.has(move.id)) {
      throw requestError("Every route candidate must have a unique valid id.");
    }
    if (!DIRECTIONS.has(move.direction) || !Array.isArray(move.directions) || move.directions.length < 1 || move.directions.length > 2) {
      throw requestError("Every route candidate must contain one or two valid directions.");
    }
    if (move.directions.some((direction) => !DIRECTIONS.has(direction)) || move.directions[0] !== move.direction) {
      throw requestError("Route directions must be valid and start with direction.");
    }
    if (typeof move.summary !== "string" || move.summary.length < 1 || move.summary.length > 500) {
      throw requestError("Every route candidate needs a short summary.");
    }
    seen.add(move.id);
  }

  if (JSON.stringify(payload.state).length > 12_000) {
    throw requestError("The supplied game state is too large.");
  }
  return payload;
}

export function createDecisionProvider({
  id,
  name,
  selfHosted = false,
  apiKey,
  baseURL,
  model,
  client,
} = {}) {
  if (!PROVIDER_IDS.has(id)) throw new TypeError(`Unsupported decision provider: ${id}`);

  const normalizedBaseUrl = baseURL?.trim().replace(/\/$/, "");
  const configured = Boolean(client || (id === "jev" ? apiKey?.trim() : normalizedBaseUrl));
  const typeSafe = client || (configured ? new TypeSafeClient({
    // The SDK requires a key. Laya ignores this local placeholder unless its own
    // optional LAYA_API_KEY authentication is enabled.
    apiKey: apiKey?.trim() || "local-laya",
    ...(normalizedBaseUrl ? { baseURL: normalizedBaseUrl } : {}),
    defaultModel: model,
    timeout: 6_000,
    logLevel: "off",
  }) : null);

  return {
    id,
    name,
    selfHosted,
    configured,
    model,
    async isAvailable() {
      if (!configured) return false;
      if (!selfHosted || client) return true;
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
      if (!typeSafe) {
        const error = new Error(`${name} is not configured on this server.`);
        error.statusCode = 503;
        error.code = "AI_PROVIDER_NOT_CONFIGURED";
        throw error;
      }

      const payload = validateDecisionPayload(rawPayload);
      const criteria = Object.fromEntries(payload.routeCandidates.map(({ id: routeId, summary }) => [routeId, summary]));
      const startedAt = performance.now();
      const result = await typeSafe.systemOne({
        model,
        state: payload.state,
        questions: {
          route: choice(decisionInstructions, criteria),
        },
      });

      const answer = result.answers?.route;
      const selectedRoute = payload.routeCandidates.find((move) => move.id === answer?.choice);
      if (!answer || !selectedRoute) {
        const error = new Error(`${name} returned a route outside the supplied candidate set.`);
        error.statusCode = 502;
        error.code = "INVALID_AI_RESPONSE";
        throw error;
      }

      return {
        provider: id,
        providerName: name,
        routeId: answer.choice,
        direction: selectedRoute.direction,
        directions: selectedRoute.directions,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        model: result.model,
        usage: result.usage,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    },
  };
}

export function createDecisionProviders({ jevClient, layaClient } = {}) {
  return {
    jev: createDecisionProvider({
      id: "jev",
      name: "Jev",
      apiKey: process.env.TYPESAFE_API_KEY,
      baseURL: process.env.TYPESAFE_BASE_URL,
      model: JEV_MODEL,
      client: jevClient,
    }),
    laya: createDecisionProvider({
      id: "laya",
      name: "Laya",
      selfHosted: true,
      apiKey: process.env.LAYA_API_KEY,
      baseURL: process.env.LAYA_BASE_URL,
      model: LAYA_MODEL,
      client: layaClient,
    }),
  };
}

// Compatibility wrapper for code using the original service API.
export function createJevService({ apiKey = process.env.TYPESAFE_API_KEY, client } = {}) {
  return createDecisionProvider({
    id: "jev",
    name: "Jev",
    apiKey,
    baseURL: process.env.TYPESAFE_BASE_URL,
    model: JEV_MODEL,
    client,
  });
}

function requestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_DECISION_REQUEST";
  return error;
}

