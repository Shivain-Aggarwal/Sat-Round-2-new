# Hacker Terminal Heist

A playable retro-terminal hacking game. Five missions against the fictional Nexus Corp, watched by a security AI called SENTINEL. All game logic is deterministic server-side JavaScript. AI is an optional layer for SENTINEL's dialogue only.

Everything is simulated. Nothing scans networks, attacks passwords, or touches real systems.

## Run
```
npm install
npm start          # http://localhost:3000
npm test           # 38 tests (engine, parser, API, security headers), node's built-in runner
npm run test:e2e   # 12 real-browser tests; needs `npm i -D playwright && npx playwright install chromium`
```
Node 18+ required. Copy `config/.env.example` to `.env` and export the values (the app reads `process.env`; use `node --env-file=.env backend/server.js` on Node 20+).

## Configure
| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `JWT_SECRET` | Token signing secret. If unset, a random one is generated per run |
| `ANTHROPIC_API_KEY` | Optional. Enables AI-written SENTINEL lines on lockouts, mission clears and high alert |
| `SENTINEL_MODEL` | Optional model override |

Thresholds, penalties, lockout length and scoring live in `CONFIG` in `backend/engine/state.js`.

## Playing
`help` lists commands for the current mission. Syntax: `name arg --flag value` (or `--flag=value`). `notes` lists intel recovered from solved missions (free; stored server-side, so it survives a reload and mission 5 can always be finished). Alert rises on wrong answers, inapplicable commands and hints (5%). At 100% the terminal locks for 30 seconds (enforced by the server; refreshing does not help). Mission 5 adds alert on every `scan`.

Spoiler-free nudges: read output carefully, and use `hint` if stuck (costs 5% alert and 250 points).

## Architecture
- `backend/engine/parser.js` tokenizes and validates input. `levels.js` holds puzzles. `state.js` holds sessions, alert, lockout, hints, scoring.
- The server is the source of truth. The client never sends level, alert or score. `POST /api/mission/complete` only advances a mission the server has already marked solved.
- Auth: HS256 JWT (2h expiry, algorithm pinned, signature verified) pointing at an in-memory session.
- `ai/sentinel.js`: scripted lines by default. With a key, it calls the model for significant events only (3s timeout, output validated, length capped). Output never affects game state.

API: `POST /api/session`, `GET /api/state`, `POST /api/command`, `POST /api/hint`, `GET /api/sentinel`, `POST /api/mission/complete`, `POST /api/score`, `GET /api/leaderboard`.

## Limits and troubleshooting
- Sessions and the leaderboard are in memory and reset on restart. Add a database for persistence.
- The UI is covered by Chromium end-to-end tests (`tests/e2e`): full playthrough, lockout (including a dropped request at lock expiry), resume, reload-in-mission-5 recovery, victory-transition race, storage failures, phone layout. Not yet run in Firefox or Safari.
- Scores are computed server-side, but the puzzle answers ship in this repo, so a determined player can script a perfect run. Treat the leaderboard as casual.
- Behind a reverse proxy every player shares one IP for rate limiting unless you add `app.set('trust proxy', ...)`.
- Set a real `JWT_SECRET` (32+ characters). The value in `.env.example` is a public placeholder: with `NODE_ENV=production` the server refuses to start with it or with a shorter secret, and warns otherwise.
- "Server unreachable" in the terminal: check `npm start` is running and the port matches.
- 401 after a restart: the old token points at a lost session. Press restart in the game.
- Fonts load from Google Fonts; offline it falls back to system monospace.

## Hardening notes
- Security headers (CSP, nosniff, DENY framing) on every response; `Cache-Control: no-store` on `/api`. The CSP allows only Google Fonts as an external host.
- Sessions are capped (`CONFIG.MAX_SESSIONS`), oldest evicted first. SENTINEL model calls are limited to one per 10s and 20 per session; player-typed text never enters the model prompt.
- `/api/state` omits titles of missions the player has not reached.

## Planned competition extensions
- Mission 6 (Counter-Hack): add an entry to `LEVELS` with a per-turn hook beside the existing `tick` flag in `execute()`. Change `LEVELS.length`-based checks only where "5" is hardcoded in the UI text.
- Scoring hints: `hint` already exists, with alert and score penalties. Tune them in `CONFIG`.
