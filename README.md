# Pacman × Jev — Neon Run

A browser-based maze chase game that lets you play manually or watch TypeSafe AI's Jev choose every turn. The decision inspector shows Jev's selected direction, the probability of every legal option, confidence, model, latency, and recent turns.

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

## How Jev drives

- Code calculates legal moves, food distance, and ghost risk—the exact work Jev's documentation recommends keeping deterministic.
- Corridors and forced turns are handled locally, so Jev is called only when there is a meaningful choice.
- Before each upcoming junction, the local server sends compact structured state and one typed `choice` question through the official `@typesafe-ai/sdk`.
- Jev receives every walkable direction at that junction, including a reverse/U-turn option. The state also lists blocked directions explicitly so the omission is never ambiguous.
- The model can return only a legal direction. The server validates that invariant before the browser acts.
- Pacman, ghosts, timers, and collisions keep moving while Jev plans ahead. If an answer misses the junction deadline, a visible local safety fallback keeps the run moving.
- The telemetry view shows the complete structured state, legal Choice criteria, probabilities, usage, latency, and a ten-decision trace. It does not invent chain-of-thought text that Jev does not return.

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

The game is built with semantic HTML, modern CSS, Canvas, JavaScript modules, and TypeSafe AI's official SDK. Core maze rules, decision-state preparation, server validation, and response handling are tested independently of the browser. Tests use a fake Jev client and never spend API credits.
