import test from "node:test";
import assert from "node:assert/strict";
import { createDecisionProvider, createJevService, validateDecisionPayload } from "../ai-service.js";
import { LEVEL_MAP } from "../game-core.js";
import { prepareLayaDecision } from "../providers/laya-provider.js";

const validPayload = {
  state: { mode: "normal", routeCandidates: { left_then_up: "safe", right_then_down: "danger" } },
  routeCandidates: [
    { id: "left_then_up", direction: "left", directions: ["left", "up"], summary: "left then up: safe and near food" },
    { id: "right_then_down", direction: "right", directions: ["right", "down"], summary: "right then down: ghost danger" },
  ],
};

test("decision payload validation rejects duplicate or malformed routes", () => {
  assert.doesNotThrow(() => validateDecisionPayload({
    ...validPayload,
    routeCandidates: [validPayload.routeCandidates[0]],
  }));
  assert.throws(() => validateDecisionPayload({
    ...validPayload,
    routeCandidates: [validPayload.routeCandidates[0], validPayload.routeCandidates[0]],
  }), /unique valid id/);
  assert.throws(() => validateDecisionPayload({
    ...validPayload,
    routeCandidates: [...validPayload.routeCandidates, { id: "teleport", direction: "teleport", directions: ["teleport"], summary: "not legal" }],
  }), /valid directions/);
});

test("Jev service returns the typed choice and decision metadata", async () => {
  const calls = [];
  const service = createJevService({
    client: {
      async systemOne(request) {
        calls.push(request);
        return {
          model: "jev-test",
          answers: {
            route: {
              choice: "left_then_up",
              confidence: 0.88,
              probabilities: { left_then_up: 0.91, right_then_down: 0.09 },
            },
          },
          usage: { input_tokens: 100, output_tokens: 8 },
        };
      },
    },
  });

  const result = await service.decide(validPayload);
  assert.equal(result.direction, "left");
  assert.equal(result.routeId, "left_then_up");
  assert.deepEqual(result.directions, ["left", "up"]);
  assert.equal(result.confidence, 0.88);
  assert.equal(result.model, "jev-test");
  assert.equal(result.provider, "jev");
  assert.equal(result.providerName, "Jev");
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions.route.criteria), ["left_then_up", "right_then_down"]);
});

test("self-hosted Laya uses the shared typed-decision contract", async () => {
  const calls = [];
  const service = createDecisionProvider({
    id: "laya",
    name: "Laya",
    selfHosted: true,
    model: "typed-decisions",
    client: {
      async systemOne(request) {
        calls.push(request);
        return {
          model: "typed-decisions",
          answers: {
            route: {
              choice: "right_then_down",
              confidence: 0.74,
              probabilities: { left_then_up: 0.26, right_then_down: 0.74 },
            },
          },
          usage: { input_tokens: 92, output_tokens: 2 },
        };
      },
    },
  });

  assert.equal(service.configured, true);
  assert.equal(service.selfHosted, true);
  assert.equal(await service.isAvailable(), true);
  const result = await service.decide(validPayload);
  assert.equal(result.provider, "laya");
  assert.equal(result.providerName, "Laya");
  assert.equal(result.routeId, "right_then_down");
  assert.deepEqual(result.directions, ["right", "down"]);
  assert.equal(calls[0].model, "typed-decisions");
  assert.deepEqual(Object.keys(calls[0].questions.route.criteria), ["left_then_up", "right_then_down"]);
  assert.notDeepEqual(calls[0].state, validPayload.state);
});

test("Laya alone receives a compact full-maze state and short route criteria", () => {
  const payload = {
    state: {
      mode: "normal mode: ghosts are dangerous",
      lives: 3,
      currentHeading: "left",
      plannedDecisionPosition: { row: 15, col: 10 },
      powerModeSecondsRemaining: 0,
      forecast: { planStartsInSeconds: 0.5 },
      wholeMazeSnapshot: {
        remainingRegularDots: 100,
        remainingPowerDots: 4,
        mapTopToBottom: ["#####", "#P.A#", "#####"],
        ghosts: [{ marker: "A", position: { row: 1, col: 3 }, heading: "left", state: "dangerous" }],
      },
      routeCandidates: {
        left_then_up: {
          codeStrategicRank: 1,
          nearestGhostLeadSeconds: 2.4,
          ghostTiming: "safe from active-ghost timing",
          foodDots: 2,
          powerPellets: 0,
          estimatedTravelTilesToNextDot: 1,
          destinationExitCount: 2,
          immediateReverse: false,
          recentPathTiles: 0,
        },
      },
      verboseJevOnlyField: "x".repeat(2_000),
    },
    routeCandidates: [validPayload.routeCandidates[0]],
  };

  const prepared = prepareLayaDecision(payload);
  assert.equal(prepared.state.maze, "#####\n#P.A#\n#####");
  assert.match(prepared.state.fatalRule, /behind/);
  assert.equal("verboseJevOnlyField" in prepared.state, false);
  assert.ok(JSON.stringify(prepared.state).length < 1_000);
  assert.ok(prepared.criteria.left_then_up.length < 180);

  const fullMazePrepared = prepareLayaDecision({
    ...payload,
    state: {
      ...payload.state,
      wholeMazeSnapshot: { ...payload.state.wholeMazeSnapshot, mapTopToBottom: LEVEL_MAP },
    },
  });
  assert.ok(JSON.stringify(fullMazePrepared.state).length < 1_200);
});

test("Laya supports explicit checkpoint comparison without changing Jev", async () => {
  const models = [];
  const service = createDecisionProvider({
    id: "laya",
    model: "english",
    client: {
      async systemOne(request) {
        models.push(request.model);
        return {
          model: request.model,
          answers: { route: { choice: "left_then_up", confidence: 1, probabilities: { left_then_up: 1, right_then_down: 0 } } },
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
  });
  await service.decide({ ...validPayload, model: "multilingual" });
  assert.deepEqual(models, ["multilingual"]);
  await assert.rejects(service.decide({ ...validPayload, model: "unknown" }), /Unsupported Laya model/);
});

test("Laya stays disabled until a self-hosted URL or client is supplied", async () => {
  const service = createDecisionProvider({
    id: "laya",
    name: "Laya",
    selfHosted: true,
    model: "typed-decisions",
  });
  assert.equal(service.configured, false);
  assert.equal(await service.isAvailable(), false);
});

test("Jev service fails closed when the model returns an illegal move", async () => {
  const service = createJevService({
    client: {
      async systemOne() {
        return { answers: { route: { choice: "up_then_up", probabilities: { up_then_up: 1 }, confidence: 1 } } };
      },
    },
  });
  await assert.rejects(service.decide(validPayload), /outside the supplied candidate set/);
});
