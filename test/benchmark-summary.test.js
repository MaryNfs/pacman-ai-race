import test from "node:test";
import assert from "node:assert/strict";
import { benchmarkSeeds, summarizeBenchmark } from "../benchmark-summary.js";

test("benchmark seeds are deterministic and distinct", () => {
  assert.deepEqual(benchmarkSeeds(137, 3), [137, 2654435906, 1013904379]);
  assert.deepEqual(benchmarkSeeds(137, 3), benchmarkSeeds(137, 3));
});

test("benchmark summary pairs every Laya checkpoint with Jev by seed", () => {
  const results = [
    { provider: "jev", model: "jev-latest", seed: 1, score: 100, dotsCollected: 8, deaths: 3, completed: false, averageLatencyMs: 300 },
    { provider: "jev", model: "jev-latest", seed: 2, score: 200, dotsCollected: 18, deaths: 2, completed: true, averageLatencyMs: 400 },
    { provider: "laya", model: "english", seed: 1, score: 120, dotsCollected: 10, deaths: 2, completed: false, averageLatencyMs: 40 },
    { provider: "laya", model: "english", seed: 2, score: 160, dotsCollected: 14, deaths: 3, completed: false, averageLatencyMs: 60 },
    { provider: "laya", model: "multilingual", seed: 1, score: 90, dotsCollected: 7, deaths: 3, completed: false, averageLatencyMs: 50 },
  ];
  const summary = summarizeBenchmark(results);

  assert.equal(summary[0].id, "jev");
  assert.equal(summary[0].averageScore, 150);
  assert.equal(summary[1].id, "laya:english");
  assert.equal(summary[1].pairedScoreDelta, -10);
  assert.equal(summary[1].averageLatencyMs, 50);
  assert.equal(summary[2].id, "laya:multilingual");
  assert.equal(summary[2].pairedScoreDelta, -10);
});
