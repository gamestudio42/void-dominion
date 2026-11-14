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
2. **Observations use `clientView`.** External agents never receive information hidden by fog. `observe()` follows the same rule for resource amounts: the current stock is included only while the node is in sight.
3. **Commands go through `Simulation.enqueue()`.** The CommanderAdapter injects `playerId` from the seat and submits commands that appear in replay v2.
4. **Varek is unchanged.** The conventional opponent continues to use `stepAi` and is not an external agent. A match passes `engineSeats` of `'human' | 'varek'`. A `varek` seat gets no child process and no observation.
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
- Gathers ore with engineers, leaving the engineer who is raising the barracks on that order
- Builds barracks, aether refineries, and vehicle factories
- Produces riflemen and assault walkers
- Attack-moves the army once it has three combat units

The attack target comes only from that observation. A visible or remembered enemy command center is the target. Any other enemy building in the observation is used when the command center has not been seen. With nothing remembered, the army scouts to the opposite corner of the map from its own command center (`MAP_SIZE - 1` minus that building's coordinates). It does not read the world, the other seat's stocks, or the scenario base list.

### Example agent against Varek

`tools/arena/vs-varek.ts` runs `examples/deterministic.ts` against the engine's Varek seat (`stepAi`, no process, no observation). The external seat alternates: even index on seat 1, odd index on seat 2. Cap is 8000 ticks, the same ceiling as `runArena`. Seeds are `MATCH.seed + 0..9` (24301 through 24310). The script sets `variation: 'seeded'`, so each seed nudges both seats' resource nodes by a mirrored one-cell offset and the same amount bonus. The default skirmish does not. Replay v2 still records the published layout; reproducing a seeded match means `Simulation.create(seed, seats, 'seeded')`.

The table below replaces the earlier run, which had no rule reading the seed and therefore repeated two games.

| seed | external seat | winner | end reason | ticks | ownDecisions | fallbackDecisions | invalidActions |
|---|---|---|---|---|---|---|---|
| 24301 | 1 | 2 | victory | 3988 | 40 | 0 | 0 |
| 24302 | 2 | 1 | victory | 3996 | 40 | 0 | 0 |
| 24303 | 1 | 2 | victory | 3851 | 39 | 0 | 0 |
| 24304 | 2 | 1 | victory | 3957 | 40 | 0 | 0 |
| 24305 | 1 | 2 | victory | 4156 | 42 | 0 | 0 |
| 24306 | 2 | 1 | victory | 3885 | 39 | 0 | 0 |
| 24307 | 1 | 2 | victory | 4015 | 41 | 0 | 0 |
| 24308 | 2 | 1 | victory | 3988 | 40 | 0 | 0 |
| 24309 | 1 | 2 | victory | 3988 | 40 | 0 | 0 |
| 24310 | 2 | 1 | victory | 3996 | 40 | 0 | 0 |

Totals, from the example agent's side: **0 wins, 10 losses, 0 draws**. Every match ended in `victory` for Varek before the tick cap. Tick counts now move with the seed (3851 through 4156) instead of repeating one number per seat. Fallback decisions and invalid actions were zero. The army still does not destroy Varek's command center before his march destroys its own. The CI test covers three of these seeds for 400 ticks only, on the default layout, so it stays on `tick_cap` and checks that Varek's seat records no decisions.

### Ollama Agent (Optional, not in CI)

Install [Ollama](https://ollama.ai), start it, and pull a model. The example reads two environment variables and blocks on each `agent.observe`, calling the local API once per decision. It is never started by tests or by the benchmark script.

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_API` | `http://localhost:11434` | Generate endpoint, without `/api/generate` |
| `OLLAMA_MODEL` | `llama3.2` | Model name already pulled |

```bash
ollama pull llama3.2
OLLAMA_MODEL=llama3.2 node --experimental-transform-types --no-warnings examples/ollama.ts
```

The Arena, not the example, owns the clock. `strategicPeriodTicks` (default 100) is the match config: one observation every 100 ticks, with `decisionTimeoutMs` (default 10 seconds) as the wait. A local match against Varek passes `variation: 'seeded'` when the openings should differ by seed:

```typescript
const factory = new ScriptAgentFactory('node', [
  '--experimental-transform-types',
  '--no-warnings',
  'examples/ollama.ts',
]);
const config = {
  ...DEFAULT_ARENA_CONFIG,
  variation: 'seeded' as const,
  strategicPeriodTicks: 100,
  maxTicks: 8000,
  seats: [
    { ...DEFAULT_SEAT_CONFIG, agentId: 'ollama', decisionTimeoutMs: 10_000 },
    { ...DEFAULT_SEAT_CONFIG, agentId: 'varek' },
  ],
};
await runMatch({
  seed: 24301,
  engineSeats: ['human', 'varek'],
  agentFactories: [factory, factory],
  config,
});
```

The second factory is not spawned, because that seat is `varek`.

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

## Future Work

- Distributed Arena across multiple machines
- Tournament brackets and ELO ratings
- Real-time spectator views
- Pause/resume and checkpoint/restore
