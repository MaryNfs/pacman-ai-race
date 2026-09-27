import { TypeSafeClient } from "@typesafe-ai/sdk";

export const PROVIDER_IDS = new Set(["jev", "laya"]);
export const DIRECTIONS = new Set(["up", "down", "left", "right"]);

export function validateDecisionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw requestError("The request body must be an object.");
  if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) throw requestError("state must be an object.");
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

  if (JSON.stringify(payload.state).length > 12_000) throw requestError("The supplied game state is too large.");
  return payload;
}

export function createTypeSafeClient({ client, configured, apiKey, baseURL, model }) {
  if (client) return client;
  if (!configured) return null;
  return new TypeSafeClient({
    apiKey: apiKey?.trim() || "local-laya",
    ...(baseURL ? { baseURL } : {}),
    defaultModel: model,
    timeout: 6_000,
    logLevel: "off",
  });
}

export function requireClient(client, providerName) {
  if (client) return;
  const error = new Error(`${providerName} is not configured on this server.`);
  error.statusCode = 503;
  error.code = "AI_PROVIDER_NOT_CONFIGURED";
  throw error;
}

export function decisionResult({ answer, result, payload, id, name, startedAt }) {
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
}

export function requestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = "INVALID_DECISION_REQUEST";
  return error;
}
