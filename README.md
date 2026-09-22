# Packman — Neon Run

A dependency-free, browser-based maze chase game with keyboard and touch controls, lightweight synthesized sound, persistent high scores, and responsive layouts.

## Run locally

Requirements: Node.js 18 or newer.

```sh
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

## Controls

- Arrow keys or `WASD`: move
- `P` or Space: pause/resume
- On small screens, use the on-screen direction pad

## Development

No install step is required. Run all checks with:

```sh
npm run check
```

The game is built with semantic HTML, modern CSS, Canvas, and plain JavaScript modules. Core maze rules live in `game-core.js` so they can be tested independently of the browser.

