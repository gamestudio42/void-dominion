# Testing

`pnpm check` is typecheck, lint and Vitest. Tests live in `packages/<package>/test/`.

## Required for the simulation

- Two simulations with the same seed and the same human commands report the same `hashState()` after the same ticks, including Varek's resimulated orders.
- A rejected command leaves the checksum equal to a run that did not receive it.
- A path around `DEMO_OBSTACLE` does not cut corners, and a match unit never finishes a tick on a blocked cell.
- Ore rises when the starting engineers mine. An unaffordable building, an aether gather without a refinery, a hidden attack and a supply overflow are refused.
- A seen building that dies out of sight remains a wreck in memory. A replay file of human commands restores the checksum.
- The player command center is intact when the march is allowed.
- `pnpm sim` compares seeds `0x5eed`, `0x51eed` and `0xa11ce`. The unattended winner, tick, ore and living units match. The checksums stay pinned, and the three matches together finish in under 20 seconds. The same commands on the same seed return the same report.
- A commander view hides the other base. A produce, group or defend plan matches the same command issued directly. A missing, malformed, throwing or foreign plan leaves the checksum on the conventional match.

## What a browser session must show

When the skirmish is in the client: ore increasing, a refused build or train with a readable reason, and the enemy base hidden at the start. Contact stays off until an enemy unit is actually visible. Record what happened separately from why you think it happened. An agent session is not a player playtest.

## Not in this stage

Playwright and performance benches are not set up. The match itself already runs headless under Vitest.
