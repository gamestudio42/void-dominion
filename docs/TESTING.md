# Testing

All tests run in Vitest. `pnpm test` or `pnpm check` runs the full suite.

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
- 100 consecutive headless matches without crash/deadlock/orphan process
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
