# Agent Arena

Agent Arena allows external agents to play Void Dominion matches against each other or the built-in Varek opponent. The Arena owns the clock, manages child processes, applies failure policies, records decisions, and produces reproducible replays and benchmarks.

## Architecture

```text
packages/arena          Match orchestrator, scheduler, child processes, recorder
packages/void-dominion-agent  Observation builder, CommanderAdapter
packages/agent-sdk      JSON contracts, validation, JSONL transport
examples/               deterministic.ts, ollama.ts (optional)
```

### Key Principles

1. **Arena owns the clock.** `reset` and `step` are privileged operations never exposed to agent processes.
2. **Observations use `clientView`.** External agents never receive information hidden by fog (unlike `observe()`, which leaks resource amounts).
3. **Commands go through `Simulation.enqueue()`.** The CommanderAdapter injects `playerId` from the seat and submits commands that appear in replay v2.
4. **Varek is unchanged.** The conventional opponent continues to use `stepAi` and is not an external agent.
5. **Failure policies are configurable.** Timeouts, crashes, and malformed JSON trigger fallback, noop, or forfeit policies.

## Protocol

Transport: **JSON Lines** over stdin/stdout. Each message is a single line of JSON terminated by `\n`.

### Messages

#### Arena → Agent: `agent.observe`

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "tick-100",
  "type": "agent.observe",
  "seat": 1,
  "tick": 100,
  "ore": 250,
  "aether": 120,
  "units": [{"id": 1, "owner": 1, "kind": "engineer", "x": 50, "y": 50, "hp": 100}],
  "buildings": [],
  "nodes": []
}
```

#### Agent → Arena: `agent.act`

```json
{
  "schemaVersion": "1.0.0",
  "requestId": "tick-100",
  "type": "agent.act",
  "actions": [
    {"type": "noop"}
  ],
  "usage": {
    "promptTokens": 150,
    "completionTokens": 20,
    "totalTokens": 170
  }
}
```

### Action Types

1. **strategic_plan**: High-level plans (produce, group, defend)
2. **command**: Direct engine commands (move, attack_move, stop, attack, gather, build, produce)
3. **noop**: Do nothing this tick

### Timing

- **Strategic period**: Default 100 ticks between decisions
- **Decision timeout**: Default 10 seconds per agent per decision
- **Order**: Commands are applied by `(tick, seat, action index)`, never by arrival order
- **Late responses**: Discarded and never affect future ticks
- **Max pending**: One decision per seat at a time

## Failure Policies

Configured per seat. Applied on timeout, crashed process, or malformed JSON.

1. **fallback** (default): A simple defensive fallback agent takes over. It keeps engineers gathering ore and defends the base with available units. Results report own vs fallback decisions separately. The fallback agent is distinct from the example deterministic agent.
2. **noop**: Skip this decision tick entirely.
3. **forfeit**: After N consecutive failures (default 3), the seat forfeits the match.

A match is **invalid for benchmarking** when fallback share exceeds the threshold (default 20%). Results include `validForBenchmark` and `invalidReason`.

## Artifacts

### Replay v2 (unchanged)

```json
{"version": 2, "seed": 123, "seats": ["human", "human"], "ticks": 500, "commands": [...]}
```

Replays deterministically produce the same final checksum.

### Decision Trace (JSONL)

Every event includes `schemaVersion` for forward compatibility.

**decision**:
```json
{"schemaVersion": "1.0.0", "type": "decision", "matchId": "uuid", "seat": 1, "tick": 100, "observationHash": "sha256...", "agentId": "deterministic", "decisionMs": 45, "fallbackUsed": false}
```

**timeout**:
```json
{"schemaVersion": "1.0.0", "type": "timeout", "matchId": "uuid", "seat": 1, "tick": 200}
```

**fallback**:
```json
{"schemaVersion": "1.0.0", "type": "fallback", "matchId": "uuid", "seat": 1, "tick": 200, "reason": "timeout"}
```

**match_end**:
```json
{"schemaVersion": "1.0.0", "type": "match_end", "matchId": "uuid", "winner": 1, "ticks": 500, "endReason": "victory"}
```

### Match Result

```typescript
{
  matchId: string,
  seed: number,
  status: 'completed' | 'error',
  winner: number,
  ticks: number,
  finalChecksum: number,
  endReason: 'victory' | 'draw' | 'tick_cap' | 'forfeit',
  engineVersion: string,
  commitSha: string,
  config: ArenaConfig,
  seats: [SeatMetrics, SeatMetrics],
  validForBenchmark: boolean,
  invalidReason?: string
}
```

**SeatMetrics** includes: decisions, ownDecisions, fallbackDecisions, invalidActions, timeouts, fallbacks, latencyMean, latencyP95.

## Examples

### Deterministic Agent

```bash
node --experimental-transform-types examples/deterministic.ts
```

A fully deterministic agent that plays strategically using only its authorized observation. It:
- Gathers ore with engineers
- Builds barracks, refineries, and vehicle factories
- Produces soldiers and tanks
- Attacks when it has an army

All decisions are deterministic based on game state (tick, resources, units, buildings). No randomness, network, or external dependencies.

### Ollama Agent (Optional)

```bash
OLLAMA_MODEL=llama3.2 node --experimental-transform-types examples/ollama.ts
```

Requires Ollama installed and running. Not used in CI or tests.

## Running Matches

### Programmatic

```typescript
import { runMatch, DeterministicAgentFactory, DEFAULT_ARENA_CONFIG, DEFAULT_SEAT_CONFIG } from '@void-dominion/arena';

const factory = new DeterministicAgentFactory();
const config = {
  ...DEFAULT_ARENA_CONFIG,
  maxTicks: 1000,
  seats: [
    { ...DEFAULT_SEAT_CONFIG, agentId: 'agent1' },
    { ...DEFAULT_SEAT_CONFIG, agentId: 'agent2' },
  ],
};

const result = await runMatch({
  seed: 12345,
  agentFactories: [factory, factory],
  config,
});

console.log(result);
```

### Scripts

```bash
pnpm arena              # Run a single match
pnpm arena:bench        # Run benchmark suite
pnpm arena:replay       # Replay from trace
```

## Testing

All tests run without Ollama, network, or external APIs.

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

## Known Issues

1. **observe() leak**: The `observe()` function in `packages/simulation/src/commander.ts` includes resource node `amount` even when the node is explored but not visible. This is NOT used by the Arena (which uses `clientView` instead), but remains unfixed in this PR to minimize engine changes.

## Future Work

- Distributed Arena across multiple machines
- Tournament brackets and ELO ratings
- Real-time spectator views
- Pause/resume and checkpoint/restore
