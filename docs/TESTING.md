# Testing

`pnpm check` is typecheck, lint and Vitest. Tests live in `packages/<package>/test/`.

## Required for the simulation

- Two simulations with the same seed and the same commands report the same `hashState()` after the same ticks.
- A rejected `move` leaves the checksum equal to a run that did not receive the command.
- A path from the demo spawns to the far side of the field does not enter `DEMO_OBSTACLE`.
- Twenty units given one order finish on distinct walkable cells.

## What a browser session must show

When the field is in the client: select units, move them around the blockage, and order a cell they cannot enter. Record what happened separately from why you think it happened. An agent session is not a player playtest.

## Not in this stage

Playwright, performance benches and headless match reports start when a match exists.
