# Game review — 2026-11-25

## Scope and conclusion

Reviewed the local `main` checkout at `1cf1f44793c981e340403ae1476899bd39e2d58e`, including the recent changes through November 20. The working tree was clean before this documentation update. Remote branch freshness, deployed GitHub Pages and remote CI were not checked.

Void Dominion has a playable RTS foundation with unusually useful determinism, replay and agent infrastructure. The human-facing product is still a compact skirmish slice: production visibility, session controls and learning support lag behind the engine. The strongest next investment is completing one understandable Helion match, then demonstrating that different economic and army choices matter.

The fantasy is commanding the Helion Directorate to take and hold the Erebus Frontier. This review prioritizes **direct command** and the loop **gather → build → produce → fight → expand**, while preserving the shared simulation and original setting. The working hypothesis is that clearer orders, learning and retry will improve the human experience more immediately than another faction or agent integration. That remains a design hypothesis, not measured retention.

## Evidence gathered

- `pnpm check`: typecheck, lint and all **198 tests in 31 files passed**. The successful test phase took 39.25 seconds on Node 22.23.5 and pnpm 10.28.0. This is a local run, not a performance benchmark.
- The first restricted run had seven failures in three Arena files (191 tests passed). A focused repeat reproduced those failures. The same unchanged source passed the complete check outside the restricted environment. Record this as execution-environment sensitivity of the subprocess tests, not a confirmed gameplay regression; the exact restriction was not isolated.
- `pnpm build`: passed, Vite 7.3.7, 110 modules, 7.53 seconds. The main JS chunks were 475.12 kB for application code and 566.49 kB for Three.js before gzip. Sizes are a loading baseline, not proof of a frame-rate problem.
- A Chrome session exercised the production build served locally at `http://127.0.0.1:4173/`, in pt-BR, at the browser's existing 2560×964 viewport. The tester was the coding agent, already familiar with the source; this was not a first-time human playtest.
- In the skirmish, selected engineers, attempted a barracks on occupied ground and saw **“Não cabe aí”**, placed a barracks on free ground, observed completion, selected it and requested two riflemen. By the displayed 0:37, supply had risen from 4/12 to 6/16 and produced infantry appeared. The building card showed health and cost but no production queue or remaining training time.
- Loaded the published replay, paused it and moved its slider to tick **6826**. The field showed **“VITÓRIA”** and **“Assento 1 vence”**. Return to menu worked. This verifies loading, seeking and the final display; it is not a complete real-time playback or a human victory.
- Opened the Arena and verified easy, normal and hard Varek choices. The ordinary skirmish menu had no difficulty selection. No new browser Arena match was run.
- Captured browser warnings/errors during the opening: only GoatCounter's expected localhost exclusion was returned. Its remote analytics dashboard was not inspected.

Not executed: a complete human-commanded skirmish, two-network multiplayer, a fresh full leaderboard generation, audible listening, measured GPU/frame-time profiling, Firefox/Safari, smaller viewports, touch controls or independent player sessions. The existing leaderboard numbers below are versioned historical evidence; the current tests validate selected properties and consistency, not a fresh replay of its entire schedule.

## Assessment of recent implementations

### Varek difficulty — keep; bring it to the human match

Commit `7396256` adds easy/normal/hard plans in content, replay seat support and the Arena selector. Normal preserves the published skirmish behavior. Tests for relative army/base growth, valid seat controls and replay checksums passed.

The versioned [leaderboard](LEADERBOARD.md) records reference-agent results of 20–0–0 against easy, 19–0–1 against normal and 6–14–0 against hard, each over 20 seeded matches. This shows useful separation for that agent. It does not establish suitable difficulty for a novice human, and seeded benchmarks are not the fixed-layout human match.

**Decision:** keep the shared plans and default behavior. Expose difficulty in human setup and validate it with newcomers before retuning. Roadmap milestone 9.

### Agent feedback and fault handling — keep as infrastructure

Commits `a0345fc` and `0354890` add own orders, cargo, construction/production state and per-action results to observations, and improve malformed/late/crashed-agent handling. Optional fields retain schema 1.0.0 and observations remain based on `clientView`. Their tests passed in the successful full run.

These are valuable improvements to the Arena's contract. They do not make the human command panel show production, nor connect a language model to the skirmish. There is now richer production feedback available to an external agent than to the human building card.

**Decision:** keep. Preserve the tests and contract while prioritizing human readability. Do not treat additional Arena features as a substitute for that work.

### Replay viewer and browser Arena — keep; distinguish the two audiences

Commits `4158f93`, `78ea87b`, `3294ac6` and `8114d85` added viewing, browser scripts, a reproducible leaderboard and a fighting reference agent. The browser replay is a useful demonstration and debugging tool; its final result and return path worked in this session. The Arena exposes programming-specific controls that are appropriate for agent authors.

**Decision:** keep both entry points. Complete the ordinary match's exit/retry flow to the same standard as the viewer. Do not require a player to write an agent to use difficulty selection.

### Ground, meshes, selection and interceptor — keep; validate readability next

The recent presentation work includes irregular regolith and resource stains (`877e334`), panels/team colors (`bdf8700`), contact discs/health bars (`53f9cc9`), separated approach cells (`a0d4818`) and the interceptor (`faa6d5b`). In this session the command center and barracks had distinct silhouettes, the ore and aether areas were visually different, and selected engineers had clear rings.

At the observed wide desktop viewport, the active starting area occupied a small portion of the screen and individual units were small. The interpretation is that default camera framing and unit recognition deserve testing before adding surface detail. This session did not validate every combat unit or the interceptor in play. The interceptor is a ground-grid vehicle despite its ship-like hull, as specified in decision 025.

**Decision:** keep the art direction and verified pipeline. Test recognition at normal play zoom and measure rendering before more art work. Milestones 10 and 13.

### Multiplayer, test timeout and analytics — retain their actual scope

Commit `4355794` added final-result verification and diagnostics. The current host/guest and fog tests passed, but [FIELD_TEST.md](FIELD_TEST.md) still has only historical same-machine evidence. Milestone 7 remains open.

Commit `b119828` raises the default test timeout to 30 seconds while the explicit timing gate remains. Passing checks establish the tested behavior, not browser smoothness. Commit `9ec6510` adds a page-view counter; it does not measure completion of the first building, first match or retry.

**Decision:** keep. Close the actual network evidence gap, add browser verification, and use focused playtest notes before proposing more analytics.

## Main-game findings and priorities

### P1 — The ordinary match lacks a complete session flow

**Observation:** `Field` in `apps/game/src/App.tsx` renders the result banner and command card, but no offline pause, restart or return-to-menu control. `onKey` in `field.ts` uses Escape to cancel order modes. The replay viewer has its own return button, which worked. Returning from the reviewed skirmish required a page reload.

**Interpretation:** a player can issue orders but has poor support for stopping, understanding an outcome and trying again. This affects every match, regardless of content quantity. **Action:** milestone 8, including replay export and explicit outcome/retry browser checks.

### P1 — Production is functional but its progress is hidden

**Observation:** two production requests changed resources/supply and produced infantry, but `SelectionCard` exposes only name, health, combat values and cost. The simulation and agent view already contain current production, ticks left and queued jobs. A construction percentage exists in the selected building title; unit-training progress does not.

**Interpretation:** spending is visible before the reason for waiting is visible. Repeated clicks can become guesswork. **Action:** milestone 8; read existing queue state rather than adding another production model. Label costs and resource icons so a bare “150” has an explicit meaning.

### P1 — The opening depends on prior RTS knowledge

**Observation:** the menu goes straight into normal Varek. The match shows resources and command buttons but no introductory objective sequence or in-game control reference. Initial workers mine automatically. Normal's attack condition uses a fixed earliest march tick of 2400 plus its army requirement; it does not check whether the human finished a building. The unattended default match is pinned to defeat at tick 3338, about 2:47 of simulation time.

**Interpretation:** a newcomer can accumulate resources without learning which action advances the game before pressure arrives. This is an onboarding hypothesis, not a measured novice failure rate. **Action:** milestone 9; guide one opening, expose existing levels, then run independent sessions.

### P2 — Tactical management and strategic variety need separate proof

**Observation:** the current input layer supports selection, orders, WASD, zoom and minimap focus. It has no control groups, idle-worker selector or base-focus shortcut. The roster contains six unit kinds and seven buildings, while Varek's production plans focus on engineers and riflemen. The human match always uses the published layout; changing an Arena seed without opting into variation does not create a new map.

**Interpretation:** management friction can conceal whether the existing roster provides meaningful choices. Unit count alone is not evidence of depth. **Action:** improve control in milestone 10, then compare infantry, defense and aether/vehicle openings in milestone 11. Change numbers only after identifying a specific weak choice.

### P2 — Verification is stronger below the browser than in the player flow

**Observation:** Vitest includes `packages/*/test/**/*.test.ts` in a Node environment. CI runs check/build, with no browser smoke job. The 100-match test in `packages/arena/test/mvp1.test.ts` uses `DeterministicAgentFactory`, an in-process noop implementation; it cannot prove absence of orphaned child processes despite its title. Real subprocess failure tests exist separately. Published leaderboard tests check short reproducible runs and stored data consistency.

**Interpretation:** the passing suite is valuable evidence for rules and contracts but leaves UI wiring, result flow, accessibility and renderer behavior under-tested. **Action:** establish a browser gate in milestone 8, keep claims precise, and perform the declared-device checks in milestone 13.

### P2 — Audio, visual clarity and long-term replay compatibility remain gates

**Observation:** `audio.ts` contains four synthesized event cues and no user volume/mute control. The current session did not listen to the output. The opt-in seeded scenario is not encoded in the ordinary replay file; reproducing it requires the variation setting separately, as documented in decision 036.

**Interpretation:** audio polish needs listening evidence, and exposing scenario variation prematurely would undermine self-contained sharing. **Action:** milestone 12 handles the replay contract before new maps; milestone 13 handles audible verification, recognition and measured performance.

## Recommended sequence and limits

Close milestone 7's cross-network evidence, then finish session/production feedback, introduce the opening and difficulty, improve control, validate existing strategic choices, add replay-safe variation and validate a release candidate. The [roadmap](ROADMAP.md) defines the tasks, owners, hypotheses and acceptance gates.

No gameplay constants, source code, assets, decision records, replays or leaderboard values changed in this review. No numeric quality score is assigned: the available evidence supports specific observations and priorities, not a reliable measure of fun, retention or competitive balance.
