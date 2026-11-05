# Roadmap

Each milestone ends with automated tests. A player-facing milestone also ends with a browser session. There are no dates.

| # | Milestone | Status |
| --- | --- | --- |
| 0 | Deterministic simulation, commands, checksums | Done |
| 1 | Isometric field, selection, movement around obstacles | Done |
| 2 | Workers, ore, aether, construction, production | Done |
| 3 | Combat, destruction, victory and defeat | Done |
| 4 | Conventional opponent, fog of war, replay file | Done |
| 5 | Optional commander gateway and deterministic fallback | Done |
| 6 | Headless arena, benchmarks, comparable seeds | Done |
| 7 | Authoritative multiplayer | In progress (`docs/MULTIPLAYER.md`) |

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

## Milestone 5

- A plan is produce, group or defend. Between ticks the engine turns it into ordinary commands.
- The view for that player omits hidden units, unseen buildings and unexplored nodes.
- A missing, malformed, throwing or refused plan does not change the checksum. General Varek keeps running on the next tick.
- No model, socket or prompt is connected. The client does not call the gateway. The unattended seed is unchanged.

## Milestone 6

- `runArena` plays a seed and a command list until the match ends or a step cap.
- Seeds `0x5eed`, `0x51eed` and `0xa11ce` share the unattended winner, tick, ore and living units. The checksum changes with the seed. No rule draws from the random stream yet.
- The three matches together finish in under 20 seconds. That ceiling is a test, not a clock inside the simulation.
- The same commands on the same seed return the same report.
- `pnpm bench` times every step of the three seeds. The speed table in `docs/BENCHMARKS.md` shows a full match in about 0.3 s, roughly 550 times real time, with every step under 4 ms against the 50 ms budget. The renderer is not timed, and there is no network match.

## Milestone 7 (in progress)

- Peer to peer with no game server: the host's browser runs the only `Simulation` and sends the guest a fog-filtered view over WebRTC. The public EMQX MQTT broker carries only the encrypted handshake.
- The order of work:
  1. seats without Varek and replay v2 (done);
  2. the client view and a whole-match no-leak test (done);
  3. the protocol package (in review);
  4. signaling and session, tested in memory;
  5. host and guest modes;
  6. a field test across networks.
- Done when:
  - two players on different networks finish a match;
  - the guest never receives a hidden entity;
  - the guest's replay audit matches the host's checksum.
- There is no TURN relay, so two players both behind CGNAT cannot connect.

## Later milestones

Milestones 2, 3 and 4 are the skirmish: economy, combat, fog, General Varek and a human replay file. The commander gateway lives in the simulation and this client does not consult it. The headless arena compares three seeds and publishes a speed table. Multiplayer is not in this build.
