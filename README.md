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
- At each junction, the local server sends compact structured state and one typed `choice` question through the official `@typesafe-ai/sdk`.
- The model can return only a legal direction. The server validates that invariant before the browser acts.
- The maze pauses while a decision is in flight, making network latency fair and the decision easy to inspect.
- If a request fails, a visible local safety fallback keeps the run moving; it is never presented as a Jev result.

Reference: [TypeSafe JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) and [Choice primitive](https://docs.typesafe.ai/primitives/choice).

## Controls

- Arrow keys or `WASD`: move
- `P` or Space: pause/resume
- On small screens, use the on-screen direction pad

## Development

No install step is required. Run all checks with:

```sh
npm run check
```

The game is built with semantic HTML, modern CSS, Canvas, JavaScript modules, and TypeSafe AI's official SDK. Core maze rules, decision-state preparation, server validation, and response handling are tested independently of the browser. Tests use a fake Jev client and never spend API credits.
