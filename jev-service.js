import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

export const JEV_MODEL = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";
export const DIRECTIONS = new Set(["up", "down", "left", "right"]);

const decisionInstructions = {
  task: "Choose Pacman's next move at this maze junction.",
  priorities: [
    "Avoid a nearby active ghost before pursuing food.",
    "When ghosts are frightened, prefer a safe opportunity to catch one.",
    "Otherwise prefer routes toward power dots, then routes toward regular dots.",
    "Choose exactly one of the supplied legal moves.",
  ],
  note: "Distances and danger labels were calculated by the game. Treat them as facts; do not recalculate them.",
};

export function validateDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw requestError("The request body must be an object.");
  }
  if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) {
    throw requestError("state must be an object.");
  }
  if (!Array.isArray(payload.legalMoves) || payload.legalMoves.length < 2 || payload.legalMoves.length > 4) {
    throw requestError("legalMoves must contain between two and four moves.");
  }

  const seen = new Set();
  for (const move of payload.legalMoves) {
    if (!move || !DIRECTIONS.has(move.direction) || seen.has(move.direction)) {
      throw requestError("Every legal move must have a unique valid direction.");
    }
    if (typeof move.summary !== "string" || move.summary.length < 1 || move.summary.length > 300) {
      throw requestError("Every legal move needs a short summary.");
    }
    seen.add(move.direction);
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
      const criteria = Object.fromEntries(payload.legalMoves.map(({ direction, summary }) => [direction, summary]));
      const startedAt = performance.now();
      const result = await typeSafe.systemOne({
        model: JEV_MODEL,
        state: payload.state,
        questions: {
          direction: choice(decisionInstructions, criteria),
        },
      });

      const answer = result.answers?.direction;
      if (!answer || !seenDirection(payload.legalMoves, answer.choice)) {
        const error = new Error("Jev returned a direction outside the legal move set.");
        error.statusCode = 502;
        error.code = "INVALID_JEV_RESPONSE";
        throw error;
      }

      return {
        direction: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence,
        model: result.model,
        usage: result.usage,
        latencyMs: Math.round(performance.now() - startedAt),
      };
    },
  };
}

function seenDirection(moves, direction) {
  return DIRECTIONS.has(direction) && moves.some((move) => move.direction === direction);
}

function requestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_DECISION_REQUEST";
  return error;
}
