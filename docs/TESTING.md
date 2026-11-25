# Testing

Unit and simulation tests run in Vitest. `pnpm test` or `pnpm check` runs the full suite.

## Unit Tests

Every package under `packages/*/test/` has unit tests. The deterministic packages (`kernel`, `content`, `simulation`) have no DOM, no wall clock, and no `Math.random`, so they run identically in Node and the browser.

## Simulation Tests

`packages/simulation/test/` verifies:
- Same seed + same commands = same `hashState()`
- Rejected commands do not change `hashState()`
- Units never enter blocked cells
- Unreachable orders leave units where they were
- Replay v2 produces identical checksums
- `clientView` leaks nothing hidden by fog

## Arena Tests

`packages/arena/test/` verifies Agent Arena functionality:

### MVP1: External vs Varek
- 100 consecutive headless matches using in-process noop agents (scheduler/simulation stress, not child-process cleanup proof)
- Same replay+engine+seed produces identical final checksum
- Invalid commands rejected without state change
- Timeouts/crashed processes/malformed JSON trigger correct policy
- Observations contain nothing hidden by fog

### MVP2: Two External Agents
- Two independent processes control seats 1 and 2
- Seat alternation per seed
- Replay reproducible without processes
- Response arrival order does not change outcome
- Benchmark records W/L/D and per-agent metrics
- Win rate over seed pairs with swapped seats

All Arena tests run without Ollama, network, or external APIs.

## Running Tests

```bash
pnpm test                                      # all tests
pnpm test packages/simulation/test/arena.test.ts  # specific file
vitest run packages/arena/test/mvp1.test.ts    # Arena MVP1
```

## Coverage

No coverage target yet. Focus on invariants and acceptance criteria from `docs/ROADMAP.md`.

## Browser smoke gate

Run `pnpm build && pnpm test:browser`. The script serves the production build on localhost, launches an isolated headless Chrome profile, and checks English and pt-BR at 1280×720 and 1920×1080. Additional pt-BR touch checks at 360×800 and 844×390 cover selection and session controls. It requires Node 22 and Chrome (`CHROME` can override `/usr/bin/google-chrome-stable`). `SMOKE_URL` can target an already running local build. `SMOKE_CASE` filters scenario names by substring for a focused rerun (for example, `SMOKE_CASE=360x800 pnpm test:browser`). CI runs this after the build and keeps screenshots under the `browser-smoke` artifact.

The checks select one worker and place a building using pointer input, verify occupied placement rejection, finish a barracks and train two riflemen, inspect the current/waiting production, pause and compare state, export and independently replay the saved file, resume, restart and return to title. Complete deterministic victory and defeat files are loaded through the player's file input to exercise result/export/retry. This outcome coverage does not claim a human played those full matches live.

Screenshots go to `test-results/browser/`, including a failure capture. The existing localhost drive exposes a read-only projection and checksum for assertions; the smoke test does not assign a winner or modify the world. Unit checks in `packages/view3d/test/session-ui.test.ts` cover clock scheduling, authoritative production reads, power starvation and guest-mirror equivalence. They do not substitute for rendering checks.

Additional easy/hard setup cases in both locales check difficulty seats in exported replays, dismissal, skipped guidance, retry and expanded help scrolling. Normal opening cases follow the guide through completed rifleman production and an engine-rejected aether order with visible explanatory text. Touch cases also expand and dismiss the compact guidance.

This gate uses software rendering and reports functionality, not a GPU frame-rate benchmark. It does not contact multiplayer brokers, start Ollama or close the two-network field-test requirement.

### Session and production slice — 2026-11-25

Validated the local milestone 8 working tree based on `1cf1f44`, before any commit or publication:

- `pnpm check`: 205 tests across 32 files passed, including seven new session/production checks. Child-process tests ran outside the restricted execution environment.
- `pnpm build`: production build passed. Final typecheck, lint and whitespace checks passed.
- `pnpm test:browser`: all four locale/viewport combinations passed. Each exercised the opening, placement rejection, construction, two produced riflemen, pause/resume, independently verified replay export, restart, restored victory/defeat and return to title. No uncaught browser exceptions were reported.
- Screenshots were inspected for production, pause and result layout; final captures and the run log are in the ignored `test-results/browser/` directory.

Initial smoke runs exposed a test click that selected a passing worker instead of the barracks and a wall-time limit too short for loaded software rendering. The final script clicks the building roof and uses bounded functional waits. The complete matrix was rerun successfully. This is not a frame-rate result, external-player playtest or remote CI result.

### PR integration with touch controls — 2026-11-25

Integrated `origin/main` at `efff2f6` (PR #31) before opening this PR. The existing touch decision 039 is preserved verbatim; the scheduling decision is appended as 040. `pnpm check` passed 214 tests across 34 files and the production build passed. The four desktop scenarios passed after integration. Focused final runs also passed touch selection, pause/resume, restart and menu at 360×800 and 844×390; assertions verify session controls do not cover resources or the minimap. Screenshots were inspected in both orientations.

The touch harness queues press and release together so a slow software-rendering round trip cannot accidentally turn a tap into a hold. Result dialog buttons are scrolled into view before tapping. Portrait session controls sit below the minimap, landscape controls below the resource bar, and pause/restart clear pending touch gestures. The earlier one-machine multiplayer evidence is from before this integration; no new cross-network evidence is claimed.

### Human difficulty and opening guidance — 2026-11-25

Validated the local milestone 9 working tree on `codex/opening-guidance`, based on `47b36a6` (merged PR #32):

- `pnpm check`: 223 tests across 35 files passed. Nine new checks cover all three human starts, human-command replay round trips, the unchanged normal default, observed tutorial progress, foreign-entity exclusion, dismissal/retry, resource refusal explanations and unchanged simulation hashes. The focused nine-test suite was also rerun successfully after presentation adjustments.
- Final typecheck, lint and production build passed.
- `pnpm test:browser`: all ten scenarios passed. Four setup cases exercise easy/hard in English and pt-BR, including saved seats, skipped/dismissed guidance, retry and expanded help scrolling. Four normal-opening cases exercise English/pt-BR at 1280×720 and 1920×1080, following one engineer through barracks construction, accepted training, completed riflemen and an aether refusal with visible explanation. Two touch cases at 360×800 and 844×390 select a worker, expand/dismiss compact goals and pause/resume/restart/exit.
- Screenshots were inspected for setup, completed opening/resource refusal and touch layout. Captures and `opening-run.log` are in the ignored `test-results/browser/` folder. Replays exported from the browser reproduce their checksum independently and retain their selected seats.

Early runs exposed an all-worker construction order that stopped the test economy, a Portuguese unit-name mismatch in the test, and full guidance covering workers on a landscape touch viewport. The final opening selects one builder and leaves the others mining; touch goals use a short expandable summary. Refusals share the command flow so goals cannot cover them, and expanded menu help remains scrollable. The full ten-case matrix passed after these corrections.

This is local automated functional evidence, not five first-time-player sessions, a GPU benchmark, a remote CI run, a deployment or a new multiplayer field test. The external learning gate remains pending in `docs/OPENING_PLAYTEST.md`.
