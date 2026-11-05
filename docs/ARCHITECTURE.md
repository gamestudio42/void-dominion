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

A rejected command returns a reason key (`unknown_unit`, `not_owner`, `out_of_bounds`, `blocked`, `no_path`, `no_ore`, `no_aether`, `no_supply`, `footprint`, `no_refinery`, `not_visible`, `cannot_produce`, `not_engineer`) and does not change the checksum.

After commands, one tick steers, moves, gathers and builds, refreshes vision, resolves shots and deaths, then remembers buildings. A decided match stops stepping. The human replay stores `{ ticks, commands }` for player 1 only. Varek is simulated again on load.

## Determinism

Same seed, same commands, same `hashState()`. Random draws go through `Rng`. Transcendental `Math` functions are forbidden in the deterministic packages. Fixed-point arithmetic is not used yet; revisit only if checksums diverge across engines.

## What stays out of the loop

Language-model calls, HTTP and network replication do not run inside a tick. Between ticks a host may call `considerCommander` with a produce, group or defend plan. The engine turns an accepted plan into ordinary commands and refuses hidden or foreign orders. If the source is absent, throws, or the plan is refused, General Varek's weights continue on the next tick. This client never calls the gateway. A plan is not stored in the human replay.

## Art

2D animation and VFX enter through `docs/artcraft-pipeline.md`. Meshes enter through `docs/blender-pipeline.md` as verified GLB. This client is Three.js. Do not follow the Godot import notes in those documents.
