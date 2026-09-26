# Pacman × Jev — Neon Run

A browser-based maze chase game that lets you play manually or watch TypeSafe AI's Jev plan every turn. The decision inspector shows Jev's selected two-junction route, the probability of every candidate, confidence, model, latency, and recent plans.

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

- Before every decision, code builds a fresh whole-board snapshot containing the full maze, every remaining dot, Pacman's planned position and heading, every ghost's position and heading, lives, power timer, and recent path. The score stays in the UI and is not sent to Jev because it does not change the best route.
- Code then ranks every legal route across the next two junctions using ghost timing, local-area cleanup, distance to future food, escape options, and recent-path overlap—the exact work Jev's documentation recommends keeping deterministic.
- Before every tile, the local server sends compact structured route summaries and one typed `choice` question through the official `@typesafe-ai/sdk`.
- Jev receives routes beginning with every walkable direction at that junction, including reverse/U-turn options. The state also lists blocked directions explicitly so the omission is never ambiguous.
- U-turns remain available for genuine escapes, but a safety-aware rule removes foodless recent reversals from Jev's choices whenever another route is in the same or a safer ghost-danger band. The game never replaces Jev's returned route.
- Jev is the only route chooser in AI mode. If a prefetched answer is late, the world briefly holds at the tile until Jev responds; no local safety route is substituted.
- Failed requests are shown and retried. They never create a `Local safety` entry in the decision log.
- The model can return only a supplied route ID. The server validates that invariant before the browser acts.
- Pacman executes the first move of the selected route and asks Jev again for the next tile. This receding-horizon loop lets Jev respond to newly observed ghost movement instead of blindly committing to an old plan.
- Pacman, ghosts, timers, and collisions keep moving while Jev plans ahead whenever the prefetched answer arrives on time.
- The telemetry view shows the live whole-maze food map, complete structured state, route criteria, route probabilities, usage, latency, and a ten-decision trace. It does not invent chain-of-thought text that Jev does not return.

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

The game is built with semantic HTML, modern CSS, Canvas, JavaScript modules, and TypeSafe AI's official SDK. Core maze rules, two-junction route simulation, decision-state preparation, server validation, and response handling are tested independently of the browser. Tests use a fake Jev client and never spend API credits.
