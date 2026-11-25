# Roadmap

Each milestone ends with automated tests. A player-facing milestone also ends with a browser session. There are no dates.

## Review baseline — 2026-11-25

Reviewed local `main` at `1cf1f44`. See [the game review](GAME_REVIEW.md) for executed checks, recent changes, observations and limits. This is a development roadmap, not a claim that every planned feature is implemented.

The skirmish has a working economy, construction, production and combat foundation. Recent work improved presentation and made the Agent Arena substantially more useful, but the human match still lacks a complete session flow, production visibility and an introduction. Prioritize making one Helion match understandable and worth replaying before adding factions or a campaign.

`pnpm check` passed all 198 tests across 31 files outside the restricted execution environment; `pnpm build` passed. The browser session covered the opening, rejected and accepted construction, rifleman production, the published replay's final result and the Arena's difficulty choices. It did not complete a human-commanded skirmish or the cross-network field test.

Work remains sequential under decision 040: milestone 7's external field session is deferred, and milestone 8 is complete. The two-network test remains incomplete and is still a release gate. Milestone 9 is in progress; subsequent milestones retain their order.

## Milestone status

| # | Milestone | Status |
| --- | --- | --- |
| 0 | Deterministic simulation, commands, checksums | Done |
| 1 | Isometric field, selection, movement around obstacles | Done |
| 2 | Workers, ore, aether, construction, production | Done |
| 3 | Combat, destruction, victory and defeat | Done |
| 4 | Conventional opponent, fog of war, replay file | Done |
| 5 | Optional commander gateway and deterministic fallback | Done |
| 6 | Headless arena, benchmarks, comparable seeds | Done |
| 7 | Authoritative multiplayer | Implemented; cross-network field test pending (decision 040) |
| 8 | Complete the human match flow and show production | Done locally; validation recorded 2026-11-25 |
| 9 | Teach the opening and expose Varek difficulty | Implemented locally; five first-time-player sessions pending |
| 10 | Make army and economy control practical | Planned |
| 11 | Validate strategic variety within Helion | Planned |
| 12 | Add replay-safe skirmish variation | Planned |
| 13 | Validate presentation, performance and release readiness | Planned |

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

## Milestone 2

- Engineers gather ore, return cargo to a depot, and build through validated commands.
- Aether requires a completed refinery touching its node; construction and production spend catalog resources.
- Production observes supply and queue limits. Invalid orders return reason keys without changing state.
- Existing evidence: `packages/simulation/test/match.test.ts` and the opening browser checks in [the review](GAME_REVIEW.md).

## Milestone 3

- Visible targets take damage according to catalog armor, range and cooldown; destroyed entities leave the field.
- Losing every command center decides defeat; simultaneous loss decides a draw.
- Existing automated checks cover combat and victory. The review exercised the published victory replay; a new complete human match is still needed for the later usability milestones.

## Milestone 4

- General Varek uses validated commands, fog limits visible entities, and explored buildings retain memories.
- Saved human commands reproduce the match with Varek simulated again.
- The normal opening remains pinned at tick 3338 and checksum 3280354694 for the unattended default seed.
- Easy and hard exist in the engine and Arena (decision 038), and milestone 9 now exposes them in human setup. Normal remains the default.

## Milestone 5

- A plan is produce, group or defend. Between ticks the engine turns it into ordinary commands.
- The view for that player omits hidden units, unseen buildings and unexplored nodes.
- A missing, malformed, throwing or refused plan does not change the checksum. General Varek keeps running on the next tick.
- No model, socket or prompt is connected. The client does not call the gateway. The unattended seed is unchanged.

## Milestone 6

- `runArena` plays a seed and a command list until the match ends or a step cap.
- Seeds `0x5eed`, `0x51eed` and `0xa11ce` share the unattended winner, tick, ore and living units on the published layout. The checksum changes with the seed. This path does not use the opt-in seeded resource variation added later in decision 036.
- The three matches together finish in under 20 seconds. That ceiling is a test, not a clock inside the simulation.
- The same commands on the same seed return the same report.
- `pnpm bench` times every step of the three seeds. The historical speed table in `docs/BENCHMARKS.md` shows a full match in about 0.3 s, roughly 550 times real time, with every step under 4 ms against the 50 ms budget. That measurement does not include rendering or an online match and was not rerun in the 2026-11-25 review.

## Milestone 7 (in progress)

- Peer to peer with no game server: the host's browser runs the only `Simulation` and sends the guest a fog-filtered view over WebRTC. The public EMQX MQTT broker carries only the encrypted handshake.
- The order of work:
  1. seats without Varek and replay v2 (done);
  2. the client view and a whole-match no-leak test (done);
  3. the protocol package (done);
  4. signaling and session, tested in memory (done);
  5. host and guest modes (done, on main since `4887ab5`);
  6. a field test across networks (prepared, not run; `docs/FIELD_TEST.md`).
- Done when:
  - two players on different networks finish a match;
  - the guest never receives a hidden entity;
  - the guest's replay audit matches the host's checksum.
- There is no TURN relay, so two players both behind CGNAT cannot connect.
- Close this milestone by following [FIELD_TEST.md](FIELD_TEST.md) with two people on different networks, including a mobile connection. Record the exact build, join time, final result and both diagnostics notes. Both audits must pass. The historical one-machine session and the current automated session tests do not replace that evidence.
- Fix reproducible failures in this slice before widening multiplayer scope. Reconnection, matchmaking and a TURN service are not part of the current acceptance gate.

## Milestone 8 — Complete the human match flow and show production

**Priority:** P1. **Pillars:** direct command, reproducible matches. **Loop:** spend, read the result, recover and retry.

**Hypothesis:** a player can tell what a production order did and start another match without reloading the page.

- [x] Add an offline pause/menu with resume, restart and return to title. Define leave behavior separately for an online match; an offline pause must not silently change network rules.
- [x] Give victory and defeat a result panel with the outcome, replay export, play again and menu actions. Explain the command-center victory condition in the match.
- [x] Show the selected building's current production, remaining time and queued units, using existing simulation data. Show construction progress and resource labels clearly; do not add client-side validation rules.
- [x] Add a repeatable browser smoke check to CI for start, selection, rejected placement, completed construction, production, result and retry. Keep deterministic outcome fixtures reproducible.
- [x] Correct testing documentation that describes the 100-match in-process stress test as proof of child-process cleanup; test real process cleanup separately if claiming that guarantee.

**Acceptance:** automated checks prove pause/resume preserves state, retry resets the intended match and displayed production follows the authoritative queue. Browser checks exercise victory and defeat, no-input/no-selection feedback, replay export and restart. Repeat in English and pt-BR at 1280×720 and 1920×1080. Run `pnpm check` and `pnpm build`.

**Owners:** `apps/game/src/App.tsx`, `field.ts`, `locales.ts`, `styles.css`, browser verification tooling and `.github/workflows/pages.yml`.

**Validated 2026-11-25:** `pnpm check` passed 205 tests across 32 files; the production build passed. Browser smoke passed all four English/pt-BR and 1280×720/1920×1080 combinations. A separate one-machine multiplayer match verified online leave cancellation and accessible result diagnostics; both replay audits passed at tick 2045. See [TESTING.md](TESTING.md) and [FIELD_TEST.md](FIELD_TEST.md). This local working-tree validation does not claim a commit, publication, remote CI run or cross-network field test.

**PR integration:** the updated main (`efff2f6`, touch controls) passed 214 tests and the build. All four desktop scenarios and focused touch checks at 360×800 and 844×390 passed; see [TESTING.md](TESTING.md).

## Milestone 9 — Teach the opening and expose Varek difficulty

**Priority:** P1. **Pillar:** direct command. **Loop:** gather, build, produce, meet the first attack.

**Hypothesis:** a first-time player can complete a barracks and train a rifleman before first contact, then explain what to defend.

- [x] Let a human choose easy, normal or hard before starting. Reuse `VAREK_LEVELS`; keep normal as the existing default and preserve difficulty in replay seats.
- [x] Add short, dismissible opening goals driven by observed progress: select an engineer, build a barracks, select it and train a rifleman. Add discoverable camera, selection and attack-move help.
- [x] Explain supply, aether prerequisites and power consequences at the relevant action, using the engine's reason keys.
- [x] Clarify that normal Varek's first march is permitted at tick 2400 (120 simulation seconds); it does not wait for the human to finish a building. Update misleading README wording.
- [ ] Run five first-time-player sessions, recording time to first completed barracks, first rifleman, first contact, outcome and the player's explanation of defeat. Keep agent benchmark results separate.

**Acceptance:** tests cover all three human starts, replay round trips, skipped guidance and no guidance-induced world changes. Browser sessions cover each level and locale. As a proposed usability gate, at least four of five new players complete the opening before first contact without verbal coaching; if not, revise one cause at a time and repeat. Do not tune combat solely to match the reference agent's win rate.

**Owners:** human setup and field UI, `packages/content/src/field.ts`, existing replay tests and playtest notes.

**Technical validation — 2026-11-25:** `pnpm check` passed 223 tests across 35 files. Final typecheck, lint, build and browser checks passed. Ten browser scenarios cover easy/hard setup in both locales, the normal opening in both locales at both desktop resolutions, and touch session/guidance controls in portrait and landscape. The default normal checksum and replay format are unchanged. See [TESTING.md](TESTING.md).

**Acceptance still pending:** zero of the five first-time-player sessions have been run. Use [OPENING_PLAYTEST.md](OPENING_PLAYTEST.md); do not infer learning or the four-of-five target from automated play. Milestone 9 remains open and milestone 10 has not started.

## Milestone 10 — Make army and economy control practical

**Priority:** P2. **Pillars:** direct command, one simulation. **Loop:** manage production while scouting and fighting.

**Hypothesis:** a player can switch between workers, base and army without losing orders or repeatedly searching the map.

- [ ] Add control-group assignment/recall, focus selection/base and an idle-engineer selector as interface state.
- [ ] Make attack-move mode, accepted/refused orders and selected unit roles legible at the default zoom.
- [ ] Add a discoverable attack notification with a location that can be focused, using only that seat's visible information.
- [ ] Verify that every new shortcut has a visible equivalent/help entry and does not consume typing in forms.

**Acceptance:** tests cover selection lifecycle, dead units and fog-safe notifications. In a browser, produce units, recall an army, focus the attacked base and resume gathering without losing selection or moving the camera unintentionally. Commands and checksums remain unchanged for UI-only additions. Rally points and queued world orders require their own command/protocol design and are outside this slice.

**Owners:** `apps/game/src/field.ts`, UI/locales, renderer markers and UI tests.

## Milestone 11 — Validate strategic variety within Helion

**Priority:** P2. **Pillars:** direct command, an original frontier. **Loop:** scout, choose a composition, expand and counterattack.

**Hypothesis:** gathering aether or expanding enables a useful alternative to the existing barracks-and-riflemen opening.

- [ ] Measure the current opening before changing numbers: ore/aether spent, time to first army, composition, first contact, outcome and seat.
- [ ] Play infantry pressure, turret defense and aether/vehicle openings on the same scenario; include the interceptor's ground movement and the scout's vision role.
- [ ] Identify one concrete weak choice from those sessions, then change one catalog value or one AI decision at a time. Record the before/after and a revert condition.
- [ ] Evaluate whether Varek needs one additional economic or army response. His current plans produce riflemen; do not present difficulty levels as different tactical personalities.

**Acceptance:** document at least two viable openings, each demonstrated in three completed human sessions against normal, with failed attempts retained in the notes. This is a viability gate, not proof of competitive balance. Add deterministic tests for changed rules, rerun fixed-seed agent comparisons, regenerate all affected checksum pins, the published replay and leaderboard in the same change. Explain every changed result.

**Owners:** `packages/content`, simulation AI/combat/economy, invariant tests and generated match artifacts.

## Milestone 12 — Add replay-safe skirmish variation

**Priority:** P2. **Pillars:** reproducible matches, an original frontier. **Loop:** scout and adapt on the next match.

**Hypothesis:** a second scenario changes a scouting or expansion decision while preserving understandable starts and exact replays.

- [ ] First make scenario/variation settings self-contained in saved matches and validate compatibility. Seed alone currently does not encode the opt-in `seeded` layout (decision 036).
- [ ] Keep old version-1/version-2 files playable on their documented layout; choose and record a backward-compatible extension or a versioned format before implementation.
- [ ] Then expose one alternate original scenario or the existing mirrored resource variation in human setup. Do not label arbitrary seeds as different maps while running the default layout.
- [ ] Verify both seats have reachable resources, legal construction space and comparable opening opportunities; record seat-swapped results.

**Acceptance:** every offered configuration exports a file that independently reproduces its final checksum and outcome in the browser. Legacy replay fixtures still pass. Exercise the alternate scenario from start to finish on both seats before expanding to more maps. Multiplayer settings change only with protocol tests and a browser host/guest session.

**Owners:** content/scenario setup, simulation replay serialization, setup UI, Arena exporters and protocol readers when affected.

## Milestone 13 — Validate presentation, performance and release readiness

**Priority:** P2. **Pillars:** direct command, an original frontier. **Loop:** recognize, order, read combat and choose another match.

**Hypothesis:** the existing roster is recognizable and the full match remains responsive on the declared desktop target.

- [ ] Test silhouettes, owner colors, construction, resource nodes and combat feedback at default and close zoom; prioritize recognition over additional mesh detail.
- [ ] Add master volume/mute and audibly verify command, refusal, completion and combat cues. Any new art follows the existing verified ArtCraft/Blender pipelines.
- [ ] Measure initial loading and frame-time percentiles in opening, base growth and a representative battle; include machine, GPU, browser, viewport and entity counts. Set the supported-device performance budget from that baseline before accepting optimizations.
- [ ] Run the browser smoke suite in Chromium and Firefox, both locales and the two desktop resolutions. Publish explicit touch/mobile support limits until a separate input design is validated.
- [ ] Repeat full human matches and the network field test on the release candidate; record the build identifier, failures and replay reproduction.

**Acceptance:** no blocked essential control, clipped result flow or reproducible critical match failure on the declared targets; measured performance meets the recorded budget. Required tests/build/browser checks pass. Audio has been heard by a tester and both victory and defeat have been played, not inferred from compilation.

## Deferred scope

Campaign, additional factions, the remaining studio ship hulls, terrain-height rules, a connected language-model commander, ranked matchmaking and distributed tournaments remain outside these milestones. The Arena is already a useful testing and agent-authoring surface; expand it when a concrete need supports the main match or its existing contract. A page-view counter does not establish tutorial completion, retention or fun.
