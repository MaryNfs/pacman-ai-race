# Pacman × Jev/Laya — Neon Run

A browser-based maze chase game that lets you play manually, watch TypeSafe AI's hosted Jev, or run Laya on your own machine. Both pilots use the same full-maze state and typed route choices. The decision inspector shows the selected route, every candidate probability, confidence, model, latency, and recent plans.

## Run locally

Requirements: Node.js 20 or newer.

```sh
npm install
```

To play manually:

```sh
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

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
LAYA_HOST=127.0.0.1 LAYA_MODELS=typed-decisions .laya-venv/bin/laya-serve
```

The first launch downloads the model weights. Leave that server running, then start Pacman in the original terminal:

```sh
LAYA_BASE_URL="http://127.0.0.1:8000" npm start
```

Laya uses the `typed-decisions` checkpoint by default. Override it with `LAYA_MODEL`. If you secure Laya with `LAYA_API_KEY`, pass the same value to the Pacman server. The browser never receives the URL or key.

To enable both choices at once:

```sh
TYPESAFE_API_KEY="your-jev-key" LAYA_BASE_URL="http://127.0.0.1:8000" npm start
```

Laya is not bundled into the Node process: it remains a separate, self-hosted service that can use CPU, CUDA, or MPS. See the [official Laya repository](https://github.com/NandhaKishorM/laya) for device and Docker deployment options.

## How the AI pilots drive

- Before every decision, code builds a fresh whole-board snapshot containing the full maze, every remaining dot, Pacman's planned position and heading, every ghost's position and heading, lives, power timer, and recent path. The score stays in the UI and is not sent to the model because it does not change the best route.
- Code then ranks every legal route across the next two junctions using ghost timing, local-area cleanup, distance to future food, escape options, and recent-path overlap.
- Before each planned route begins, the local server sends compact structured route summaries and one typed `choice` question through the official `@typesafe-ai/sdk`.
- The selected provider receives routes beginning with every walkable direction at that junction, including reverse/U-turn options. The state also lists blocked directions explicitly so the omission is never ambiguous.
- U-turns remain available for genuine escapes, but a safety-aware rule removes foodless recent reversals whenever another route is in the same or a safer ghost-danger band. The game never replaces the provider's returned route.
- The selected provider is the only route chooser in AI mode. Pacman executes its complete multi-tile route while the next route is prefetched, avoiding a network wait on every tile.
- If a prefetched answer is still late at the route endpoint, the world briefly holds there until the selected provider responds; no local safety route is substituted.
- Failed requests are shown and retried. They never create a `Local safety` entry in the decision log.
- The model can return only a supplied route ID. The server validates that invariant before the browser acts.
- Pacman executes the complete selected route and asks the provider for the following route immediately. This receding-horizon loop gives it enough planning time while keeping control of every meaningful turn.
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

The game is built with semantic HTML, modern CSS, Canvas, JavaScript modules, and TypeSafe AI's official SDK. Laya exposes the Jev-compatible wire protocol, so both providers share one validated server path. Core maze rules, two-junction route simulation, decision-state preparation, server validation, and response handling are tested independently of the browser. Tests use fake clients and never spend API credits or load local model weights.
