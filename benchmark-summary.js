export function summarizeBenchmark(results) {
  const valid = results.filter((result) => Number.isFinite(result.score) && Number.isInteger(result.seed));
  const jevScores = new Map(valid
    .filter((result) => result.provider === "jev")
    .map((result) => [result.seed, result.score]));
  const groups = new Map();

  for (const result of valid) {
    const id = result.provider === "laya" ? `laya:${result.model}` : "jev";
    if (!groups.has(id)) groups.set(id, { id, provider: result.provider, model: result.model, runs: [] });
    groups.get(id).runs.push(result);
  }

  return [...groups.values()].map((group) => {
    const pairedDeltas = group.runs
      .filter((run) => jevScores.has(run.seed))
      .map((run) => run.score - jevScores.get(run.seed));
    return {
      id: group.id,
      provider: group.provider,
      model: group.model,
      runs: group.runs.length,
      clears: group.runs.filter((run) => run.completed).length,
      clearRate: mean(group.runs.map((run) => Number(Boolean(run.completed)))),
      averageScore: mean(group.runs.map((run) => run.score)),
      averageDots: mean(group.runs.map((run) => run.dotsCollected)),
      averageDeaths: mean(group.runs.map((run) => run.deaths)),
      averageLatencyMs: mean(group.runs.map((run) => run.averageLatencyMs).filter(Number.isFinite)),
      pairedScoreDelta: group.provider === "jev" ? 0 : mean(pairedDeltas),
      pairedRuns: group.provider === "jev" ? group.runs.length : pairedDeltas.length,
    };
  }).sort((left, right) => {
    if (left.provider === "jev") return -1;
    if (right.provider === "jev") return 1;
    return left.model.localeCompare(right.model);
  });
}

export function benchmarkSeeds(baseSeed, count) {
  const normalized = Number(baseSeed) >>> 0;
  return Array.from({ length: count }, (_, index) => (
    normalized + Math.imul(index, 0x9e3779b9)
  ) >>> 0);
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
