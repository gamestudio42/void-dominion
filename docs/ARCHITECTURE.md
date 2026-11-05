# Architecture

```text
apps/game            Vite + React shell: frame loop, input, locale
packages/view3d      three.js renderer: field, camera, picking
packages/simulation  world, commands, systems (pure, deterministic)
packages/content     field size, costs, spawns
packages/kernel      RNG, FNV-1a, fixed-step clock
```

Dependencies point down only: `game` uses `view3d` and `simulation`; `view3d` does not import the simulation; `simulation` uses `content` and `kernel`. The deterministic packages have no DOM and no clock, so they run the same in the browser and in Vitest.

`apps/game` owns the frame loop. `FixedStepper` converts frame time into whole 1/20 s steps. Frames longer than 0.25 s and anything beyond 8 steps per frame are dropped. The renderer interpolates with the leftover alpha. Wall time never enters the simulation.

`packages/view3d` draws units, buildings, nodes, rocks and the fog. It does not decide whether an order is legal. Selection is interface state. The client sends intentions: move, stop, attack, attack-move, gather, build and produce.

## Commands

A command is an intention. The engine applies queued human commands at the start of a tick, in sequence order. General Varek then issues the same kind of command directly. Rejected intentions do not change the world.

```ts
type Command =
  | { type: 'move' | 'attack_move'; playerId: number; unitIds: number[]; to: { x: number; y: number } }
  | { type: 'stop'; playerId: number; unitIds: number[] }
| { type: 'attack'; playerId: number; unitIds: number[]; targetId: number }
  | { type: 'gather'; playerId: number; unitIds: number[]; nodeId: number }
  | { type: 'build'; playerId: number; unitIds: number[]; kind: string; at: { x: number; y: number } }
  | { type: 'produce'; playerId: number; buildingId: number; kind: string };
```

A rejected command returns a reason key (`unknown_unit`, `not_owner`, `out_of_bounds`, `blocked`, `no_path`, `no_ore`, `no_aether`, `no_supply`, `footprint`, `no_refinery`, `not_visible`, `cannot_produce`, `not_engineer`, `own_target`) and does not change the checksum. A refusal never reveals what the fog hides: a foreign unit or building out of sight answers `unknown_unit` like a missing one, a missing attack target answers `not_visible` like a hidden one, a build site has to be in sight before its units are consulted, and a gather needs an explored node. The client previews a site with the same `siteRefusal`.

After commands, one tick steers, moves, gathers and builds, refreshes vision, resolves shots and deaths, then remembers buildings. A decided match stops stepping. `Simulation.create(seed, seats)` says who drives each seat: `'human'` or `'varek'`. The default is the skirmish, `['human', 'varek']`. Seat control is not part of the world, so it never enters the checksum. The log keeps every human seat's orders and nothing Varek decides. A replay file is version 2: `{ version, seed, seats, ticks, commands }`. A file without a version is read as version 1, which means the skirmish seed with a human on seat 1 and Varek on seat 2. A file with an order for a seat Varek drives is unreadable, and `Simulation.replay` skips such orders. Varek is simulated again on load.

## Determinism

Same seed, same commands, same `hashState()`. Random draws go through `Rng`. No match rule draws from it yet, so two seeds currently share the unattended result and differ in the checksum. `runArena(seed, commands, cap)` is the headless report. Replay files record the seed. A version 1 file replays on `MATCH.seed`. `clientView(world, seat, full)` builds what one seat may know, for a multiplayer guest. It never includes anything that seat's fog hides. `Simulation.enqueue` returns a number, and `results` holds each command's reason after the step that applied it, so a host can acknowledge every guest command.

`packages/protocol` defines the multiplayer messages and validates them. It does no I/O.

`packages/net` carries a match between two browsers:
- the sealed handshake over public MQTT brokers;
- WebRTC data channels;
- view compression;
- the host and guest sessions.

The plan is in `docs/MULTIPLAYER.md`. Transcendental `Math` functions are forbidden in the deterministic packages. Fixed-point arithmetic is not used yet; revisit only if checksums diverge across engines.

## What stays out of the loop

Language-model calls, HTTP and network replication do not run inside a tick. Between ticks a host may call `considerCommander` with a produce, group or defend plan. The engine turns an accepted plan into ordinary commands and refuses hidden or foreign orders. If the source is absent, throws, or the plan is refused, General Varek's weights continue on the next tick. This client never calls the gateway. A plan is not stored in the human replay.

## Art

2D animation and VFX enter through `docs/artcraft-pipeline.md`. Meshes enter through `docs/blender-pipeline.md` as verified GLB. This client is Three.js. Do not follow the Godot import notes in those documents.
