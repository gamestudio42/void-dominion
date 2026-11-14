# Agent Arena

Agent Arena allows external agents to play Void Dominion matches against each other or the built-in Varek opponent. The Arena owns the clock, manages child processes, applies failure policies, records decisions, and produces reproducible replays and benchmarks.

## Architecture

```text
packages/arena          Match orchestrator, scheduler, child processes, recorder
packages/void-dominion-agent  Observation builder, CommanderAdapter
packages/agent-sdk      JSON contracts, validation, JSONL transport
examples/               deterministic.ts, reference.ts, ollama.ts (optional)
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

### Reference agent

```bash
node --experimental-transform-types --no-warnings examples/reference.ts
pnpm arena:bench
```

`examples/reference.ts` is the agent measured by `pnpm arena:bench`. It uses the same observation and command path as any external agent: `clientView` in, `Simulation.enqueue` out. It does not read the world, the other seat's stock, or the scenario base list. The same observation stream produces the same actions.

The opening leaves the starting gather orders in place. One engineer builds an ore extractor, a barracks, a turret just east of the command center (the side Varek's march aims at), and a second barracks. Both barracks train riflemen. The army holds that approach until eight riflemen are up and the turret has had time to finish, then attack-moves toward a remembered enemy building, or to the opposite corner of the map when nothing has been seen. Once the enemy command center is in sight, the army attacks that building. Enemy units redirect the army only when they are already next to our command center.

`pnpm arena:bench` runs that agent against Varek with `variation: 'seeded'`. The default is 20 matches, cap 12000 ticks, strategic period 100. Even indexes seat the reference agent on seat 1, odd indexes on seat 2. `ARENA_MATCHES` and `ARENA_MAX_TICKS` override the defaults. The run is not part of CI. The CI test checks the opening decisions and that two short matches on one seed share a checksum.

Seeds are `MATCH.seed + 0..19` (24301 through 24320).

| seed | external seat | winner | end reason | ticks | ownDecisions | fallbackDecisions | invalidActions |
|---|---|---|---|---|---|---|---|
| 24301 | 1 | 1 | victory | 4038 | 41 | 0 | 0 |
| 24302 | 2 | 2 | victory | 4401 | 45 | 0 | 0 |
| 24303 | 1 | 1 | victory | 5509 | 56 | 0 | 0 |
| 24304 | 2 | 2 | victory | 7919 | 80 | 0 | 0 |
| 24305 | 1 | 1 | victory | 4326 | 44 | 0 | 0 |
| 24306 | 2 | 2 | victory | 7213 | 73 | 0 | 0 |
| 24307 | 1 | 1 | victory | 4487 | 45 | 0 | 0 |
| 24308 | 2 | 2 | victory | 7048 | 71 | 0 | 0 |
| 24309 | 1 | 1 | victory | 4038 | 41 | 0 | 0 |
| 24310 | 2 | 2 | victory | 4375 | 44 | 0 | 0 |
| 24311 | 1 | 1 | victory | 5507 | 56 | 0 | 0 |
| 24312 | 2 | 2 | victory | 6101 | 62 | 0 | 0 |
| 24313 | 1 | 1 | victory | 4326 | 44 | 0 | 0 |
| 24314 | 2 | 2 | victory | 5735 | 58 | 0 | 0 |
| 24315 | 1 | 1 | victory | 4487 | 45 | 0 | 0 |
| 24316 | 2 | 2 | victory | 6974 | 70 | 0 | 0 |
| 24317 | 1 | 1 | victory | 4038 | 41 | 0 | 0 |
| 24318 | 2 | 0 | tick_cap | 12000 | 120 | 0 | 0 |
| 24319 | 1 | 1 | victory | 5499 | 55 | 0 | 0 |
| 24320 | 2 | 2 | victory | 7189 | 72 | 0 | 0 |

Totals, from the reference agent's side: **19 wins, 0 losses, 1 draw**. Every victory is the reference agent destroying Varek's command center. The draw is seed 24318 with the agent on seat 2: the match reaches the 12000 tick cap with our command center intact. In that game the enemy command center is reduced to a sliver, then the ore extractor is destroyed and the engineers die with less than a rifle's cost in ore, so the remaining squad never finishes the building. Fallback decisions and invalid actions were zero. Duration of the wins runs from 4038 to 7919 ticks.

### Ollama agent (optional, not in CI)

`examples/ollama.ts` asks a local [Ollama](https://ollama.ai) model for one JSON action and submits it through the same `clientView` / `enqueue` path as any other external agent. Tests never start Ollama. They pass a fake client into `decide`.

The measured model is `qwen2.5:1.5b`. It is about one gigabyte, runs on CPU, and follows a short JSON verb more reliably than `llama3.2:3b`, which is larger and slower on the same machine. The prompt lists only the verbs that fit the current observation and names one preferred verb (extractor, then barracks, then riflemen until eight exist, then attack). The process binds that verb to ids from the observation. A full command with legal ids is also accepted. If the call exceeds `OLLAMA_TIMEOUT_MS` or the text is not usable JSON, the process answers `noop`. That is still its own decision. The Arena fallback runs only when the process misses `decisionTimeoutMs` or breaks the protocol.

| Variable | Default | Meaning |
|---|---|---|
| `OLLAMA_API` | `http://127.0.0.1:11434` | Generate endpoint, without `/api/generate` |
| `OLLAMA_MODEL` | `qwen2.5:1.5b` | Model name already pulled |
| `OLLAMA_TIMEOUT_MS` | `20000` | Abort the HTTP call and answer noop |
| `OLLAMA_TRACE` | unset | Append one JSON line per decision |
| `ARENA_MATCHES` | `6` | Matches in `pnpm arena:ollama` |
| `ARENA_PERIOD` | `200` | `strategicPeriodTicks` for that script |
| `ARENA_MAX_TICKS` | `8000` | Cap for that script |

```bash
ollama serve
ollama pull qwen2.5:1.5b
OLLAMA_MODEL=qwen2.5:1.5b node --experimental-transform-types --no-warnings examples/ollama.ts
ARENA_MATCHES=8 ARENA_PERIOD=100 pnpm arena:ollama
```

`pnpm arena:ollama` seats the example against Varek with `variation: 'seeded'`. Even indexes use seat 1, odd indexes seat 2. The Arena deadline is five seconds above `OLLAMA_TIMEOUT_MS`. The run below used period 100, cap 8000, and eight seeds (`24301`–`24308`) on a 4-core CPU.

| seed | external seat | winner | end reason | ticks | ownDecisions | fallbackDecisions | invalidActions | latency mean ms | latency p95 ms |
|---|---|---|---|---|---|---|---|---|---|
| 24301 | 1 | 2 | victory | 5171 | 52 | 0 | 0 | 271 | 320 |
| 24302 | 2 | 1 | victory | 7025 | 71 | 0 | 0 | 276 | 320 |
| 24303 | 1 | 0 | tick_cap | 8000 | 80 | 0 | 0 | 946 | 1051 |
| 24304 | 2 | 1 | victory | 4826 | 49 | 0 | 0 | 814 | 999 |
| 24305 | 1 | 0 | tick_cap | 8000 | 80 | 0 | 0 | 959 | 1091 |
| 24306 | 2 | 1 | victory | 5261 | 53 | 0 | 0 | 851 | 1049 |
| 24307 | 1 | 0 | tick_cap | 8000 | 80 | 0 | 0 | 1006 | 1162 |
| 24308 | 2 | 1 | victory | 3771 | 38 | 0 | 0 | 811 | 958 |

Totals, from the model's side: **0 wins, 5 losses, 3 draws**. Across 503 decisions the fallback rate and the invalid-action rate were both 0. The mean of the per-match latency means is 742 ms, and every p95 is under 1.2 s. The trace of those decisions is 29 gather, 29 build, 280 produce, 115 attack_move, and 50 noop. The army does march, and three matches with the model on seat 1 are still undecided at the cap. The five losses are Varek destroying the model's command center, between tick 3771 and 7025. All four matches with the model on seat 2 are in that loss group. The model does not destroy Varek's command center in this sample.

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
pnpm arena:bench        # Reference agent vs Varek, 20 seeded matches
pnpm arena:ollama       # Ollama example vs Varek (needs a local daemon; not CI)
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
