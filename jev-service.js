import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

export const JEV_MODEL = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
export const DIRECTIONS = new Set(["up", "down", "left", "right"]);

const decisionInstructions = {
  task: "Choose Pacman's best two-junction route. Pacman will execute the first move, then replan with fresh state.",
  priorities: [
    "Avoid routes with predicted active-ghost collision risk before pursuing food.",
    "When ghosts are frightened, prefer a reachable interception that finishes before power mode expires.",
    "Otherwise prefer food yield, power-pellet access, multiple exits, and low recent-path repetition.",
    "Choose exactly one supplied route candidate.",
  ],
  note: "Route simulation, timing, food counts, and escape routes were calculated by the game. Treat them as facts; do not recalculate them.",
};

export function validateDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw requestError("The request body must be an object.");
  }
  if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) {
    throw requestError("state must be an object.");
  }
  if (!Array.isArray(payload.routeCandidates) || payload.routeCandidates.length < 2 || payload.routeCandidates.length > 16) {
    throw requestError("routeCandidates must contain between two and sixteen routes.");
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

export function createJevService({ apiKey = process.env.TYPESAFE_API_KEY, client } = {}) {
  const configured = Boolean(apiKey?.trim() || client);
  const configuredBaseUrl = process.env.TYPESAFE_BASE_URL?.trim();
  const typeSafe = client || (configured ? new TypeSafeClient({
    apiKey,
    defaultModel: JEV_MODEL,
    timeout: 6_000,
    logLevel: "off",
    ...(configuredBaseUrl ? { baseURL: configuredBaseUrl } : {}),
  }) : null);

  return {
    configured,
    model: JEV_MODEL,
    async decide(rawPayload) {
      if (!typeSafe) {
        const error = new Error("Jev is not configured on this server.");
        error.statusCode = 503;
        error.code = "JEV_NOT_CONFIGURED";
        throw error;
      }

      const payload = validateDecisionPayload(rawPayload);
      const criteria = Object.fromEntries(payload.routeCandidates.map(({ id, summary }) => [id, summary]));
      const startedAt = performance.now();
      const result = await typeSafe.systemOne({
        model: JEV_MODEL,
        state: payload.state,
        questions: {
          route: choice(decisionInstructions, criteria),
        },
      });

      const answer = result.answers?.route;
      const selectedRoute = payload.routeCandidates.find((move) => move.id === answer?.choice);
      if (!answer || !selectedRoute) {
        const error = new Error("Jev returned a route outside the supplied candidate set.");
        error.statusCode = 502;
        error.code = "INVALID_JEV_RESPONSE";
        throw error;
      }

      return {
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

function requestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_DECISION_REQUEST";
  return error;
}
