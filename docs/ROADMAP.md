# Roadmap

Each milestone ends with automated tests. A player-facing milestone also ends with a browser session. There are no dates.

| # | Milestone | Status |
| --- | --- | --- |
| 0 | Deterministic simulation, commands, checksums | Done |
| 1 | Isometric field, selection, movement around obstacles | Done |
| 2 | Workers, ore, aether, construction, production | Not started |
| 3 | Combat, destruction, victory and defeat | Not started |
| 4 | Conventional opponent, fog of war, replay file | Not started |
| 5 | Optional commander gateway and deterministic fallback | Not started |
| 6 | Headless arena, benchmarks, comparable seeds | Not started |
| 7 | Authoritative multiplayer | Not started |

## Milestone 0

- Fixed 20 Hz step, seeded RNG, FNV-1a checksum.
- Entity ids in insertion order.
- `move` validated against ownership, bounds and a path.
- Two runs with the same seed and commands share checksums. A rejected command does not change the checksum.

## Milestone 1

- 128×128 field, orthographic isometric camera, pan and zoom.
- Select, box-select, shift-add, right-click move.
- Twenty units path around one blockage. A blocked or unreachable order is visible as a refusal.
- No resource bar, no commander panel, no audio.

## Later milestones

Economy, combat, fog, a conventional opponent, replays, commanders, the arena and multiplayer wait until the move slice is playable. Language-model integration does not begin before milestone 5, and the match must still run with that integration disabled.
