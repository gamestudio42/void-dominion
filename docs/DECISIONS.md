# Architecture Decisions

Record significant choices that differ from the original plan or resolve ambiguities.

## 1. Agent Arena uses `clientView` instead of `observe`

**Context**: `observe()` used to copy a resource node's current `amount` whenever the cell had been explored, including cells no longer in sight. `clientView()` (the multiplayer guest view, and the view the Arena sends) includes `amount` only while `canSee` is true and omits it otherwise.

**Decision**: External agents receive observations built from `clientView`. `observe()` now follows the same rule: a visible node carries its current amount, and an explored-but-not-visible node is listed without `amount`. There is no last-seen stock, because `clientView` does not store one.

**Consequences**: A commander that calls `observe()` cannot read a hidden node's current stock. The function is a read, so pinned checksums and Varek's `stepAi` path are unchanged. The Arena still builds agent observations from `clientView`.

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

## 6. Seeded variation is opt-in and is not the skirmish

**Context**: The world seed is stored and mixed into `hashState()`, but no match rule reads it. Every benchmark seed therefore plays the same two games, one per seat.

**Decision**: `Simulation.create(seed, seats, variation)` accepts `variation: 'seeded'`. The Arena sets that only when its config says `variation: 'seeded'`. The variation adds the same ore and aether bonus to both seats and shifts their nodes by opposite one-cell offsets chosen from the seed. The default argument is `'none'`, which is the published layout. Replay v2 does not grow a field; a seeded match is reproduced by creating the world with the same seed and `'seeded'`.

**Consequences**: The client, multiplayer, and the pinned skirmish checksum never take the new path. A benchmark can ask for it and get a different opening per seed without giving either seat more resources than the other.
