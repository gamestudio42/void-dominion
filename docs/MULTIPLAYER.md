# Multiplayer plan (milestone 7)

Status: proposed. Nothing here is built yet. This document records the model, the protocol, the order of work and the questions still open before code starts.

## Goal

Two people play the current skirmish map against each other over the internet, with no game server to pay for or run. The client stays a static site on GitHub Pages.

Three rules hold:

- The guest never receives what its fog hides.
- Neither player can order the other seat's units.
- After the match, the guest can check that the host played the rules.

Out of scope for milestone 7:

- more than two seats or teams;
- matchmaking and ranking;
- accounts, chat and spectators;
- mobile;
- a dedicated server;
- a TURN relay;
- a language-model commander in a seat.

## Model: the host's browser is the authority, peers talk over WebRTC

The player who creates the match is the **host**. The host's browser runs the only `Simulation`, as it already does against General Varek. The other player is the **guest**. The guest sends commands and draws the fog-filtered views the host sends back. The two browsers talk directly over a WebRTC data channel. A public MQTT broker carries only the initial handshake: the offer, the answer and the ICE candidates. After that the broker is out of the match.

| | Lockstep over WebRTC | Host simulation, filtered views (proposed) |
| --- | --- | --- |
| What the guest holds | The whole world | Only what its seat sees, plus what it remembers |
| What the host holds | The whole world | The whole world |
| Map hack | Both players | Host only |
| Desync | Possible across browsers; needs checksum exchange | Cannot happen: there is one world |
| Traffic | Commands only | Commands up, about 1 KB views down, 10 times a second |
| Host leaves | Match ends | Match ends |

Host authority keeps decision 016's fog rule for the guest. It costs bandwidth the numbers below show is small. Lockstep would let both players read the whole map.

### What the host can still do

The host is a player, not a neutral server:

- **It sees the whole map.** Nothing in the browser can hide the world from the browser that simulates it. This is accepted for play between friends, and it is why ranking is out of scope.
- **It plays with no network delay.** The guest's orders arrive one round trip later. A mitigation for later is to hold the host's own commands for the measured one-way delay. It is not in milestone 7.
- **It could edit its copy of the rules.** This is detected, not prevented:
  - At the end, the host sends the guest the replay v2 file and the final checksum.
  - The guest replays the file locally and compares checksums.
  - The guest also checks that every command it sent appears at the tick its `ack` named.
  - A mismatch is shown as an unverified result, not as a win or a loss.

### Measured view size

Measured on 2026-11-05 on the unattended seed `0x5eed`, both seats, one view every second tick:

- **View size:**
  - JSON: mean 901 bytes, p95 1661 bytes, max 2165 bytes;
  - gzip: mean 279 bytes, max 543 bytes.
- **Cost:** `observe` plus `JSON.stringify` takes 34 µs on average and 62 µs at p95.
- **Scale:** at most 23 entities were visible at once.

At 10 views a second, the host's upload is about 9 KB/s raw. Any home connection carries that.

The host's browser also pays for:

- one step of about 90 µs per tick (`docs/BENCHMARKS.md`);
- one view for the guest every second tick.

That is well inside a 50 ms tick, next to the renderer it already runs.

## Pieces

```
packages/protocol      new: message types, version, parse/validate, no I/O
packages/net           new: signaling over MQTT, WebRTC session, transport interface
packages/simulation    small changes: seats without Varek, seat-aware replay, client view
apps/game              new: host mode, guest mode, the match link
```

### Simulation changes

1. **Seat control.** `stepAi` always drives player 2 today.
   - `Simulation.create(seed, { ai: [false, true] })` chooses which seats Varek drives.
   - The default stays `[false, true]`, so every pinned checksum and the arena are unchanged.
2. **Replay v2.**
   - The format becomes `{ version: 2, seed, seats, ticks, commands }`, with commands for every human seat.
   - `deserializeReplay` still reads v1 files: player 1 only, Varek on seat 2.
   - The host stamps the guest's commands with the guest's seat, whatever `playerId` they carry. This is the per-seat rule from decision 016.
3. **Client view.** This is `observe()` grown to what a renderer needs:
   - for the seat's own entities: units with order, hp and carry; buildings with progress, queue and production;
   - visible foreign units and buildings with hp, plus remembered ghosts;
   - explored nodes with their amounts;
   - stock, supply and power for the seat;
   - fog as a change list, run-length encoded. The first view, and the one after a reconnect, carry the full grid, about 2 KB;
   - cooldowns of visible units, so the effect watcher (decision 023) still reads shots.

   Neither the enemy stock nor its queue is sent. A test walks a whole match and asserts that no view contains an entity outside the seat's sight or memory.

### Signaling (`packages/net`)

- **Broker.** The public EMQX broker (`broker.emqx.io`) over secure WebSocket, through the `mqtt` package (MQTT.js) in the browser.
  - The broker URL is configuration, not code, so a second public broker, or one hosted by the studio later, is a one-line change.
  - The public broker is offered for testing, without a service guarantee. If it is down, no new match can start; a match already connected keeps running.
- **The match link.** The host creates a 128-bit random secret and shares `…/void-dominion/#join=<secret>`.
  - The secret sits in the URL fragment, so it never reaches GitHub Pages or any server log.
  - The topic is `void-dominion/v1/<first 16 bytes of SHA-256(secret), hex>`. Anyone can subscribe to a public broker, so the topic name is not the protection.
- **Encryption.** Every signaling message is encrypted and authenticated with AES-GCM under a key derived from the secret with HKDF (WebCrypto).
  - A stranger who finds the topic cannot read the SDP or inject an answer.
  - After the handshake, DTLS protects the data channel. Its fingerprint arrived inside an authenticated message.
- **Handshake.** Non-trickle: each side waits for ICE gathering, then sends one offer or answer.
  - The host republishes its offer every few seconds until an answer arrives, so the guest can open the link late.
  - Messages are not retained on the broker.
- **NAT traversal.**
  - STUN only, through a public STUN server listed in configuration.
  - There is no TURN relay: two players behind symmetric NAT or carrier-grade NAT cannot connect. That is common on mobile networks and on several Brazilian providers. The client says so plainly instead of hanging.
  - Step 6 measures how often it happens.
- **Channels.**
  - Commands, acks and the end message use a reliable, ordered channel.
  - Views use an unreliable, unordered channel, where the newest tick wins. A lost view is replaced 100 ms later.
- **Transport interface.**
  - `packages/net` exposes `send` and `onMessage` per channel, and the game code sees only that.
  - A WebSocket transport to a dedicated server can implement the same interface later, without touching the protocol or the game.

### Protocol (`packages/protocol`)

JSON messages, each carrying `v`, the protocol version. A peer with another version is refused with a readable message.

| Direction | Message | Payload |
| --- | --- | --- |
| guest → host | `hello` | `v`, client build id |
| host → guest | `seated` | seat, seed, start tick |
| guest → host | `cmd` | `seq`, command without `playerId` |
| host → guest | `ack` | `seq`, tick applied, reason key or null |
| host → guest | `view` | tick, client view |
| host → guest | `end` | winner, final tick, checksum, replay v2 |
| both | `ping` / `pong` | timestamps for the latency readout |

Rules:

- Commands are parsed with the same `parseLogged` the replay uses. Anything else is dropped and counted.
- The guest may send at most 20 commands a second.
- A message larger than 64 KB closes the session.
- Views are full, not deltas, at 10 Hz. Deltas come only if the large-army measurement in step 2 asks for them.

### Host and guest in the client (`apps/game`)

- The title screen offers:
  - "Skirmish vs Varek": today's offline game, unchanged;
  - "Host a match": shows the link and a copy button;
  - "Join": opening a `#join=` link goes straight to joining.
- **Host mode** is today's loop with Varek off for seat 2. It also applies the guest's commands on the next tick and sends a view every second tick.
- **Guest mode** keeps no `Simulation`.
  - It interpolates between the last two views.
  - It takes fog, minimap and HUD from the views.
  - It shows the order marker at once and turns it into a refusal when the `ack` carries a reason.
- **Shown on both sides:**
  - a latency readout;
  - a "the other player lost connection" banner;
  - a pause while the guest is away, up to 60 seconds, then a forfeit.
- If the host's page closes, the match ends for both, and the guest sees why.

## Order of work

Each step ends with tests, and the client steps end with a browser session, as the roadmap asks.

1. **Seats and replay v2.**
   - The `ai` option on `Simulation.create` and replay v2.
   - All pinned checksums are unchanged, and a match with two scripted logs is deterministic.
2. **Client view and its fog test.**
   - The view builder in the simulation package.
   - A whole-match test: no view leaks a hidden entity.
   - A stress scenario with large armies added to `pnpm bench`.
3. **Protocol package.** Types, version check and parsing, with tests for malformed, oversized and foreign-seat messages.
4. **Signaling and session.**
   - `packages/net` with an in-memory broker and an in-memory transport for tests.
   - Encryption round trip, and a wrong secret that cannot join.
   - A full host and guest session in Vitest without a network.
5. **Host and guest modes.**
   - Two browser windows on one machine through the real broker.
   - The guest audits the replay at the end.
6. **Field test.**
   - Two machines on different networks, one of them on a mobile connection.
   - Record connection success, latency and bandwidth in `docs/BENCHMARKS.md`.

Milestone 7 is done when:

- two players on different networks finish a match;
- the guest never receives a hidden entity;
- the guest's replay audit matches the host's checksum.

## Open questions for the owner

1. **The second broker.** Should a fallback broker be listed from the start, or only after the public EMQX broker fails us once? A studio-hosted broker is later work.
2. **Players who cannot connect** (symmetric NAT or CGNAT on both ends). Is it acceptable for milestone 7 to tell them it will not work? A TURN relay costs money and a server, which this plan avoids.
3. **Varek as an online seat**, for co-op or practice. The seat option makes it cheap, but it is not in the milestone unless asked.

## Risks

- **Large armies.** The measured views come from a match with at most 23 visible entities. Step 2 measures a large army before the protocol is fixed.
- **The public broker changes its terms or limits.** The broker URL is configuration, and only match setup depends on it.
- **A slow host.**
  - A host whose tab is in the background gets throttled timers, and the match slows down for both players.
  - Host mode keeps the tab active with a visible warning. It steps from `requestAnimationFrame` only while visible, and from a worker clock when hidden. Step 5 measures which one holds 20 Hz.
- **A cheating host.**
  - Map reading cannot be stopped.
  - Rule edits are caught by the replay audit.
  - Both are accepted for play between friends.
