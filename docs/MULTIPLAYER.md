# Multiplayer plan (milestone 7)

Status: proposed. Nothing in this document is built yet. It records the model, the protocol, the order of work and the questions that need an owner's answer before code starts.

## Goal

Two people play the current skirmish map against each other over the internet. The match stays fair: neither client can see what its fog hides, order the other seat's units, or change the outcome by editing its own copy.

Out of scope for milestone 7:

- more than two seats or teams;
- matchmaking and ranking;
- accounts, chat and spectators;
- mobile;
- a language-model commander in a seat.

The server shape below leaves room for each of these later.

## Model: one authoritative simulation on the server, fog-filtered views to clients

The roadmap says "authoritative", and decision 016 says a refusal must not reveal what the fog hides. Those two rules choose between the usual RTS models:

| | Deterministic lockstep (clients simulate) | Server simulation, filtered views (proposed) |
| --- | --- | --- |
| What a client holds | The whole world, every tick | Only what its seat sees, plus what it remembers |
| Map hack | Possible: the hidden enemy is in client memory | Not possible: the hidden enemy is never sent |
| Desync | Possible; needs checksum exchange and resync | Cannot happen: there is one world |
| Bandwidth | Commands only, a few bytes per order | One view per seat, 10 to 20 times a second |
| Server CPU | Relay only | One `Simulation.step()` per match per tick |
| Late join and reconnect | Replay the log from tick 0 | Send the current view |

Lockstep is the classic answer because of bandwidth, but the numbers here remove that reason.

Measured on 2026-11-05, unattended seed `0x5eed`, both seats, a view on every second tick:

- **View size:**
  - JSON: mean 901 bytes, p95 1661 bytes, max 2165 bytes;
  - gzip: mean 279 bytes, max 543 bytes.
- **Cost:** `observe` plus `JSON.stringify` takes 34 µs on average and 62 µs at p95.
- **Scale:** at most 23 entities were visible at once.

These figures are what `observe()` returns today. The client view below adds memory ghosts and the fog delta, so the real message is somewhat larger.

At 10 views a second, that is about 9 KB/s raw per player, or about 3 KB/s with WebSocket `permessage-deflate`.

A match steps in about 90 µs (`docs/BENCHMARKS.md`). With two views every second tick added, one match costs about 0.2 ms of each 50 ms tick on one core. On the small map that leaves room for on the order of a hundred concurrent matches before anything is optimized. Larger armies will lower that figure.

The cost of this model is input latency. An order takes effect on the server's next tick, and the client sees the result one view later, so a round trip plus 50 to 100 ms. For an RTS at 20 Hz that is normal. The client already shows the order marker at once and waits for the server's verdict.

**Decision proposed (024):** the server runs the same `@void-dominion/simulation` package in Node and owns the only world. Clients send commands and draw views. The simulation package does not change shape: it already runs headless, refuses foreign and hidden orders, and builds per-seat views in `commander.ts`.

## Pieces

```
apps/server            new: Node host, WebSocket, rooms, seats, tick loop
packages/protocol      new: message types, version, parse/validate (no I/O)
packages/simulation    small changes: seats without Varek, seat-aware replay, client view
apps/game              new net mode: connect, send commands, draw views
```

### Simulation changes

1. **Seat control.** `stepAi` always drives player 2 today.
   - `Simulation.create(seed, { ai: [false, true] })` chooses which seats Varek drives.
   - The default stays `[false, true]`, so every pinned checksum and the arena are unchanged.
2. **Replay v2.**
   - The format becomes `{ version: 2, seed, seats, ticks, commands }`, with commands for every human seat.
   - `deserializeReplay` still reads v1 files: player 1 only, Varek on seat 2.
   - The per-seat rule from decision 016 moves to the host. A connection may only issue orders for its own seat, whatever `playerId` it writes.
3. **Client view.** This is `observe()` grown to what a renderer needs:
   - for the seat's own entities: units with order, hp and carry; buildings with progress, queue and production;
   - visible foreign units and buildings with hp, plus the seat's remembered ghosts;
   - explored nodes with their amounts;
   - stock, supply and power for the seat;
   - fog as a change list: cells that turned visible or hidden since the last view, run-length encoded. The first view, and the one after a reconnect, carry the full 128×128 grid, about 2 KB as runs;
   - for the effect watcher: cooldowns of visible units, so the client can still read shots (decision 023).

   Neither the enemy stock nor its queue is sent. A test walks a whole match and asserts that no view contains an entity outside the seat's sight or memory.

### Protocol (`packages/protocol`)

JSON over one WebSocket per player, `permessage-deflate` on. Every message carries `v` (the protocol version). The server closes a connection whose version it does not speak.

| Direction | Message | Payload |
| --- | --- | --- |
| client → server | `hello` | `v`, client build id |
| client → server | `create` / `join` | match code for `join` |
| server → client | `seated` | seat, seed, match code, reconnect token |
| client → server | `cmd` | `seq` (client counter), command without `playerId` |
| server → client | `ack` | `seq`, tick applied, reason key or null |
| server → client | `view` | tick, client view (above) |
| server → client | `end` | winner, final tick, checksum, replay id |
| both | `ping` / `pong` | timestamps for the latency readout |

Rules:

- The server stamps `playerId` from the seat, never from the payload.
- Commands are parsed with the same `parseLogged` the replay uses. Anything else is dropped and counted.
- A client sends at most 20 commands a second, so a flood cannot stall the tick.
- Views go out every second tick (10 Hz) at first. The client interpolates between two views as it already does between two steps.
- Deltas between views are the second optimization, only if a large-army measurement asks for it. Binary encoding is the third.

### Server (`apps/server`)

- Node 22 and the `ws` package. The server has no framework.
  - The original brief named Colyseus. Its strength is schema state sync, which would duplicate the deterministic world and its own fog filtering.
  - A thin host around `Simulation` is less code than adapting Colyseus to it. Revisit only if rooms, matchmaking and presence grow past what a small map can hold.
- **Rooms.**
  - A match code creates a room. The second `join` starts the countdown.
  - The room steps with a fixed-step loop on the server clock, at the same 20 Hz as `FixedStepper`.
  - When the match ends, the room writes the v2 replay and closes.
- **Disconnects.**
  - A seat is held for 60 seconds. The world keeps running, and the absent seat's units keep their last orders.
  - Reconnecting with the token from `seated` restores the seat with a full view.
  - After 60 seconds the seat forfeits.
- **Checksums.**
  - With one world there is no desync to detect. `end` carries `hashState()`.
  - The test suite replays the stored v2 file and expects the same checksum. That proves the server log is a complete record of the match.
- **Hosting** is an open question below. GitHub Pages and the current `gs42gameserver` (Flask, static uploads) serve files only and cannot hold a WebSocket. The static client stays on Pages and connects to the server by URL.

### Client net mode (`apps/game`)

- The title screen offers "Skirmish vs Varek" (today's offline game, unchanged) and "Play online": create a match, or join with a code.
- In online mode the client keeps no `Simulation`.
  - It renders the last two views.
  - The minimap and fog come from the fog in the views.
  - The HUD comes from the seat's stock.
- Orders go out as `cmd`. The marker shows at once and turns into a refusal when the `ack` carries a reason, as offline refusals do now.
- Shown on screen:
  - a latency readout from `ping`;
  - a banner while the other player is disconnected.

## Order of work

Each step ends with tests, and the client steps end with a browser session, as the roadmap asks.

1. **Seats and replay v2.**
   - `ai` option on `Simulation.create` and replay v2.
   - All pinned checksums are unchanged, and a PvP match with two scripted logs is deterministic.
2. **Client view and its fog test.**
   - The view builder in the simulation package.
   - A whole-match test: no view leaks a hidden entity.
   - Sizes added to `pnpm bench`.
3. **Protocol package.** Types, version check and parsing, with tests for malformed, oversized and foreign-seat messages.
4. **Server.**
   - Rooms, the tick loop, seats, reconnect and forfeit.
   - Tests run the server in process on port 0, with two scripted Node clients.
   - The stored replay reproduces the final checksum.
5. **Client net mode.**
   - Connect, join by code, draw views, orders with acks.
   - A browser session with two windows on one machine.
6. **Deploy.**
   - The server image and the client's server URL.
   - A two-machine session over the internet, with latency and bandwidth recorded in `docs/BENCHMARKS.md`.

Milestone 7 is done when two players on different networks finish a match, neither client receives a hidden entity, and the stored replay reproduces the server's checksum.

## Open questions for the owner

1. **Where the server runs.** Options:
   - extend `infra/gs42gameserver`, which today is Flask with static uploads and no WebSocket;
   - a small VPS with Docker;
   - a managed host with WebSocket support.

   This decides the deploy step and the cost. The plan works with any of them.
2. **Who may create a match.**
   - Anyone with the link: no accounts, codes expire with the room.
   - Or a shared secret during testing.
3. **Whether Varek stays available online**, as a co-op or practice seat. The seat option makes this cheap, but it is not in the milestone unless asked.

## Risks

- **Large armies.**
  - The measured views come from a match that never had more than 23 visible entities.
  - A 200-unit match could reach 10 to 20 KB per view. Step 2 adds a stress scenario to the bench before the protocol is fixed.
- **Floating point across machines.**
  - With one server world, client and server never have to agree bit for bit.
  - The replay check runs on the server's own Node, so the existing determinism rules are enough.
- **Server clock drift under load.**
  - The tick loop catches up with a capped number of steps, as `FixedStepper` does in the client.
  - A match that falls behind for more than a second logs it, so a slow host shows up in the logs.
