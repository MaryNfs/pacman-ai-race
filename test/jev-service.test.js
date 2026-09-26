import test from "node:test";
import assert from "node:assert/strict";
import { createJevService, validateDecisionPayload } from "../jev-service.js";

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
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions.route.criteria), ["left_then_up", "right_then_down"]);
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
