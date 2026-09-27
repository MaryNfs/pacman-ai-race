# Pacman × Jev/Laya — Neon Run

A browser-based maze chase experiment that runs TypeSafe AI's hosted Jev and self-hosted Laya side by side. Both pilots start from the same maze and receive the same full-board state and typed route choices. Each column exposes its own score, selected route, candidate probabilities, confidence, latency, metrics, and decision log.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
```

Start the local server:

```sh
npm start
```

Then open [http://localhost:4173](http://localhost:4173) for the side-by-side race. Solo and manual play remain available at [http://localhost:4173/pilot.html](http://localhost:4173/pilot.html).

For repeatable model comparison, open [http://localhost:4173/benchmark.html](http://localhost:4173/benchmark.html). It runs Jev and all three Laya checkpoints sequentially over the same seeds and reports score, clears, dots, deaths, latency, and each Laya checkpoint's paired score difference from Jev. Choose one to five levels per run when testing whether a pilot can progress beyond the first maze.

## Side-by-side comparison

- Jev runs on the left and Laya runs on the right.
- The single **Start both pilots** control starts both independent simulations together.
- Each maze has its decision inspector directly underneath it. Continue scrolling for that pilot's whole-board state, route candidates, run metrics, and decision log.
- The two games never share scores, ghosts, routes, pending requests, or telemetry.
- Both simulations use the same deterministic ghost seed and simulation clock, so provider latency does not change the underlying ghost strategy.
- Comparison mode requires both providers to be ready. It clearly reports a missing Jev key or an unavailable Laya server before the race begins.

## Enable the Jev pilot

1. Create a key in the [TypeSafe console](https://console.typesafe.ai/keys).
2. Start the local server with the key in its environment:

```sh
TYPESAFE_API_KEY="your-key" npm start
```

You can optionally select a model with `TYPESAFE_MODEL`; the default is `jev-latest`.

```sh
TYPESAFE_API_KEY="your-key" TYPESAFE_MODEL="jev-1.13.0" npm start
```

The API key stays on the local Node server. It is never included in frontend JavaScript, browser storage, decision history, or Git. `.env` files are ignored as an additional safeguard.

## Enable the self-hosted Laya pilot

Laya requires Python 3.10 or newer. In a second terminal, create an isolated environment and install Laya's official HTTP server:

```sh
python3 -m venv .laya-venv
.laya-venv/bin/python -m pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_MODELS=english,multilingual,typed-decisions .laya-venv/bin/laya-serve
```

The first launch downloads the model weights. Leave that server running, then start Pacman in the original terminal:

```sh
LAYA_BASE_URL="http://127.0.0.1:8000" npm start
```

Laya uses the `english` checkpoint by default because this game is an English route-choice task. Override it with `LAYA_MODEL`. The benchmark explicitly tests `english`, `multilingual`, and `typed-decisions`; preloading all three avoids a cold model load between runs, but requires enough memory to keep them resident. If you secure Laya with `LAYA_API_KEY`, pass the same value to the Pacman server. The browser never receives the URL or key.

To enable both choices at once:

```sh
TYPESAFE_API_KEY="your-jev-key" LAYA_BASE_URL="http://127.0.0.1:8000" npm start
```

Laya is not bundled into the Node process: it remains a separate, self-hosted service that can use CPU, CUDA, or MPS. See the [official Laya repository](https://github.com/NandhaKishorM/laya) for device and Docker deployment options.

## How the AI pilots drive

- Before every decision, code builds a fresh whole-board snapshot containing the full maze, every remaining dot, Pacman's planned position and heading, every ghost's position and heading, lives, power timer, and recent path. The score stays in the UI and is not sent to the model because it does not change the best route.
- Jev receives that rich state unchanged. Laya alone receives a compact adapter with the same full maze, live actors, power timer, remaining-dot counts, and shorter route criteria so the request fits its smaller checkpoint contexts.
- The planner selects one real remaining dot from the full maze as a committed target. That target stays fixed until collected; every route tells the model whether it reaches the target, moves closer, makes no progress, or detours away. Remaining-dot counts by region are included explicitly, so final dots cannot disappear inside the raw map representation.
- Route safety timing includes Pacman's pause on every regular and power dot. This prevents a route from being labelled safe using open-corridor speed while ghosts continue moving during food collection.
- A normal ghost is fatal from every direction, including when Pacman catches it from behind. Both provider prompts say this explicitly; only a still-frightened ghost is edible.
- Level-one movement follows the arcade-style ratio: Pacman moves at 80% base speed and normal ghosts at 75%, but Pacman pauses briefly for every dot and longer for a power dot. That means a small empty-corridor advantage exists, but ordinary dot eating usually makes Pacman slower overall and never makes dangerous contact safe.
- Code runs a deterministic fixed-step simulation of Pacman, food pauses, power mode, and the real ghost targeting rules for every legal route. The bounded search looks three junction decisions ahead (up to 240 search nodes), filters simulated-fatal routes whenever any full-horizon survivor exists, and ranks the survivors lexicographically rather than allowing food value to outweigh death.
- Before each planned route begins, the local server sends compact structured route summaries and one typed `choice` question through the official `@typesafe-ai/sdk`.
- The selected provider receives routes beginning with every walkable direction at that junction, including reverse/U-turn options. The state also lists blocked directions explicitly so the omission is never ambiguous.
- U-turns remain available. Repetition is considered only after survival, continuation, escape, power, and food facts. The game never replaces the provider's returned route.
- The selected provider is the only route chooser in AI mode. Pacman executes its complete multi-tile route while the next route is prefetched, avoiding a network wait on every tile.
- If a prefetched answer is still late at the route endpoint, the world briefly holds there until the selected provider responds; no local safety route is substituted.
- Failed requests are shown and retried. They never create a `Local safety` entry in the decision log.
- The model can return only a supplied route ID. The server validates that invariant before the browser acts.
- Pacman executes only the selected immediate corridor and replans at the next junction. Prefetch starts from a simulated projection of the remaining active corridor, including concurrent ghost movement; a materially mismatched arrival snapshot invalidates the prefetched answer.
- Pacman, ghosts, timers, and collisions keep moving while the next route is planned.
- The telemetry view shows the live whole-maze food map, complete structured state, route criteria, route probabilities, usage, latency, and a ten-decision trace. It does not invent chain-of-thought text that neither provider returns.

Reference: [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) and [Choice primitive](https://docs.typesafe.ai/primitives/choice).

## Controls

- Arrow keys or `WASD`: move exactly one tile per press; holding a key does not auto-run
- `P` or Space: pause/resume
- On small screens, use the on-screen direction pad

## Development

After installing dependencies, run all checks with:

```sh
npm run check
```

Run the fixed-seed, two-level, active-ghost benchmark without provider credentials with `npm run benchmark:offline`. It reports highest level, clears, deaths, dots, decisions, forecast mismatches, search time, and forced-danger states for both a legacy-style immediate-food policy and the safety-first rank-one policy. Simulation advances in fixed time steps and never uses wall-clock timing for game state.

The game is built with semantic HTML, modern CSS, Canvas, JavaScript modules, and TypeSafe AI's official SDK. Jev and Laya have separate provider adapters, while sharing only payload validation and response normalization. Core maze rules, next-junction route simulation, decision-state preparation, benchmark aggregation, server validation, and response handling are tested independently of the browser. Tests use fake clients and never spend API credits or load local model weights.
