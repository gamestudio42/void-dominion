# Architecture Decisions

Record significant choices that differ from the original plan or resolve ambiguities.

## 1. Agent Arena uses `clientView` instead of `observe`

**Context**: The `observe()` function in `packages/simulation/src/commander.ts` leaks resource node `amount` even when explored but not visible. The `clientView()` function (used for multiplayer guests) correctly hides amounts until the node's cell is in sight.

**Decision**: External agents receive observations built from `clientView`. The `observe()` leak remains unfixed in this PR to minimize engine changes, but is documented as a known issue.

**Consequences**: External agents never receive information hidden by fog. The Arena adapter is correctly isolated from the leak.

## 2. CommanderAdapter submits via `Simulation.enqueue()`

**Context**: The `considerCommander()` function applies commands directly to the world outside `Simulation.enqueue()`, so they do NOT appear in replay v2.

**Decision**: The Arena's CommanderAdapter translates agent actions into ordinary commands and submits them via `Simulation.enqueue()`. External agent commands appear in replay v2. `considerCommander` is not called for external agents.

**Consequences**: External agent matches are fully replayable. The existing `considerCommander` API remains unchanged for any future local language-model integration in the client.

## 3. Seats remain `human|varek`; no `agent` seat type

**Context**: Adding an `agent` seat type to the engine would require changes to serialization, validation, and replay logic.

**Decision**: External agents use `human` seats. The Arena controls which process drives each seat. Varek continues to use `stepAi` with a `varek` seat.

**Consequences**: The engine remains unchanged. Arena-controlled seats and Varek-controlled seats are distinguished only by the Arena's configuration, not by the engine's seat type.

## 4. Fallback agent is distinguishable

**Context**: The approved plan requires that fallback decisions be reported separately from the agent under test, and that matches with excessive fallback share be marked invalid for benchmarking.

**Decision**: The fallback agent always returns noop actions and is identified as `"fallback"` in decision traces. Results include `ownDecisions`, `fallbackDecisions`, and `validForBenchmark`.

**Consequences**: Benchmark consumers can distinguish agent decisions from fallback decisions. A match where fallback was used heavily (default >20%) is marked invalid for benchmarking but remains recorded.

## 5. Decision trace is JSONL, not embedded in replay v2

**Context**: Replay v2 (`{ version, seed, seats, ticks, commands }`) stores only validated commands, not agent request/response cycles or metrics.

**Decision**: The Arena writes a separate JSONL trace file with `decision`, `timeout`, `fallback`, and `match_end` events. Each event includes `schemaVersion` for forward compatibility. Replay v2 remains unchanged.

**Consequences**: Replays are still reproducible without the trace. The trace provides observability for debugging, benchmarking, and analysis, but is not required to reproduce the match outcome.
