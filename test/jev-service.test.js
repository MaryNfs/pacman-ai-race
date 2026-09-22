import test from "node:test";
import assert from "node:assert/strict";
import { createJevService, validateDecisionPayload } from "../jev-service.js";

const validPayload = {
  state: { mode: "normal", legalMoveAssessments: { left: "safe", right: "danger" } },
  legalMoves: [
    { direction: "left", summary: "left: safe and near food" },
    { direction: "right", summary: "right: ghost danger" },
  ],
};

test("decision payload validation rejects duplicate or unknown directions", () => {
  assert.throws(() => validateDecisionPayload({
    ...validPayload,
    legalMoves: [validPayload.legalMoves[0], validPayload.legalMoves[0]],
  }), /unique valid direction/);
  assert.throws(() => validateDecisionPayload({
    ...validPayload,
    legalMoves: [...validPayload.legalMoves, { direction: "teleport", summary: "not legal" }],
  }), /unique valid direction/);
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
            direction: {
              choice: "left",
              confidence: 0.88,
              probabilities: { left: 0.91, right: 0.09 },
            },
          },
          usage: { input_tokens: 100, output_tokens: 8 },
        };
      },
    },
  });

  const result = await service.decide(validPayload);
  assert.equal(result.direction, "left");
  assert.equal(result.confidence, 0.88);
  assert.equal(result.model, "jev-test");
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].questions.direction.criteria), ["left", "right"]);
});

test("Jev service fails closed when the model returns an illegal move", async () => {
  const service = createJevService({
    client: {
      async systemOne() {
        return { answers: { direction: { choice: "up", probabilities: { up: 1 }, confidence: 1 } } };
      },
    },
  });
  await assert.rejects(service.decide(validPayload), /outside the legal move set/);
});

