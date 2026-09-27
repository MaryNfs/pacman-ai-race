import { choice } from "@typesafe-ai/sdk";
import { createTypeSafeClient, decisionResult, requireClient, validateDecisionPayload } from "./provider-utils.js";

export const JEV_MODEL = process.env.TYPESAFE_MODEL?.trim() || "jev-latest";

const instructions = {
  task: "Choose Pacman's best route to the next junction. Pacman executes it while the following junction is planned.",
  priorities: [
    "Never select a simulated-fatal route when a collision-free candidate exists. Survival is the first priority.",
    "A dangerous ghost is fatal on contact from every direction, including when Pacman catches it from behind. Never chase, overtake, pass through, or rely on outrunning a dangerous ghost.",
    "Only a frightened ghost is edible, and only when power mode will remain active through the predicted contact time.",
    "In normal mode, avoid predicted dangerous-ghost collision risk before pursuing food.",
    "Compare the supplied factual safety metrics lexicographically: survival, clearance, traps and escapes, power tactics, food progress, then repetition.",
    "The foodNavigation target is a real dot selected from the full live maze and stays committed until collected. Prefer routes with fewer targetTravelTiles and positive targetProgressTiles. Move away from it only to avoid concrete ghost danger.",
    "Avoid routes marked TRAP RISK. A safe first leg is not enough when every follow-up exit at its destination has predicted fatal timing.",
    "During final dots, do not wander toward another region when a safe route approaches the committed target.",
    "Choose exactly one supplied route candidate.",
    "The continuation preview is a forecast used to assess the immediate route; only the immediate corridor is executed before replanning.",
  ],
  note: "The state contains a fresh whole-board snapshot and code-computed route timing. Keep arithmetic and pathfinding in code; make the final typed judgment.",
};

export function createJevProvider({ apiKey = process.env.TYPESAFE_API_KEY, baseURL = process.env.TYPESAFE_BASE_URL, model = JEV_MODEL, client } = {}) {
  const normalizedBaseUrl = baseURL?.trim().replace(/\/$/, "");
  const configured = Boolean(client || apiKey?.trim());
  const typeSafe = createTypeSafeClient({ client, configured, apiKey, baseURL: normalizedBaseUrl, model });
  return {
    id: "jev",
    name: "Jev",
    selfHosted: false,
    configured,
    model,
    async isAvailable() { return configured; },
    async decide(rawPayload) {
      requireClient(typeSafe, "Jev");
      const payload = validateDecisionPayload(rawPayload);
      const criteria = Object.fromEntries(payload.routeCandidates.map(({ id, summary }) => [id, summary]));
      const startedAt = performance.now();
      const result = await typeSafe.systemOne({ model, state: payload.state, questions: { route: choice(instructions, criteria) } });
      return decisionResult({ answer: result.answers?.route, result, payload, id: "jev", name: "Jev", startedAt });
    },
  };
}
