# Architecture

```text
apps/game            Vite + React shell: frame loop, input, locale
packages/view3d      three.js renderer: field, camera, picking
packages/simulation  world, commands, systems (pure, deterministic)
packages/content     field size, costs, spawns
packages/kernel      RNG, FNV-1a, fixed-step clock
```

Dependencies point down only: `game → view3d → simulation → content, kernel`. The deterministic packages have no DOM and no clock, so they run the same in the browser and in Vitest.

`apps/game` owns the frame loop. `FixedStepper` converts frame time into whole 1/20 s steps. Frames longer than 0.25 s and anything beyond 8 steps per frame are dropped. The renderer interpolates with the leftover alpha. Wall time never enters the simulation.

`packages/view3d` draws the field and picks points on the ground. It does not decide whether an order is legal. Selection is interface state. A `move` command carries the selected ids.

## Commands

A command is an intention. The engine applies queued commands at the start of a tick, in sequence order, then moves units.

```ts
interface CommandEnvelope { seq: number; tick: number; cmd: Command }
type Command = {
  type: 'move';
  playerId: number;
  unitIds: number[];
  to: { x: number; y: number };
};
```

A rejected command returns a reason key (`unknown_unit`, `not_owner`, `out_of_bounds`, `blocked`, `no_path`) and does not change the checksum.

## Determinism

Same seed, same commands, same `hashState()`. Random draws go through `Rng`. Transcendental `Math` functions are forbidden in the deterministic packages. Fixed-point arithmetic is not used yet; revisit only if checksums diverge across engines.

## What stays out of the loop

Language-model calls, HTTP and network replication do not run inside a tick. A later commander may propose a plan. The engine remains the authority and turns that plan into ordinary commands. If the model is absent, the last valid conventional policy continues. That gateway is not part of this build.

## Art

2D animation and VFX enter through `docs/artcraft-pipeline.md`. Meshes enter through `docs/blender-pipeline.md` as verified GLB. This client is Three.js. Do not follow the Godot import notes in those documents.
