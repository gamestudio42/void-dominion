# Decisions

Short architecture and design records. Newest last.

## 001. License: AGPL-3.0-or-later

The code uses the GNU Affero General Public License, version 3 or later, which is the GameStudio42 policy for a complete game. Copyright (c) 2026 Marcel Savegnago.

## 002. English is the source language

Code, comments, technical docs and commits are English. Player-facing strings are authored in English and translated to Brazilian Portuguese. The original brief was Portuguese; it is not stored in the tree. `docs/GDD.md` is the design source.

## 003. Studio layout, not a second stack

The repository follows the Vazante and Void Frontier monorepo: `apps/game`, `packages/kernel`, `packages/content`, `packages/simulation`, `packages/view3d`. The brief's `apps/web`, Colyseus server and Python gateway are not created in the foundation. Multiplayer and the commander gateway wait for their milestones.

## 004. Twenty simulation steps per second

Rendering is independent. The fixed step is 1/20 s. Excess frame time is dropped, matching the studio stepper, so a slow machine slows down instead of simulating a backlog.

## 005. Determinism without fixed-point

Checksums use a seeded sfc32 generator, stable entity order and FNV-1a over the state. IEEE-754 is accepted. Transcendental `Math` calls are linted out of the deterministic packages. Fixed-point is a later change if two engines disagree.

## 006. No language model inside a tick

Commanders, when they exist, propose plans outside the loop. The engine validates them into ordinary commands. The game remains playable with the integration absent.

## 007. Data without a schema library

Field size, movement and the demo spawns are TypeScript constants in `packages/content`. A schema library is not justified for this set of numbers.

## 008. CI checks the build and does not publish it

`.github/workflows/ci.yml` runs `pnpm check` and `pnpm build`. GitHub Pages is not configured, so a push of this foundation does not publish the boot screen as the game.

## 009. Simulation on the main thread for now

The simulation stays free of the DOM, so a worker can host it later. The first field does not add that host.

## 010. Art pipelines ship into Three.js

`docs/artcraft-pipeline.md` and `docs/blender-pipeline.md` still record Godot measurements. This game loads verified PNG sequences and GLB files in the web client. A mesh is not rotated in the client to correct an export. The scout ship spec is a pipeline example, not a Helion unit.

## 011. The first player-facing slice is select and move

Success and failure of a move order were the definition of done for that slice. It has been replaced as the boot experience by the skirmish in 012.

## 012. The boot experience is one Helion skirmish

The playable game is player against General Varek on a shared deterministic match: ore, aether, construction, production, combat, fog and a human replay. Varek uses personality weights and the same commands as the player. He is simulated again when a replay loads, so his orders are not written into the file. The enemy start is public scenario data; unit positions still have to be seen. Colyseus, the language-model gateway and Docker are not added. The match has to run without them. Numbers live in `packages/content`. Visuals stay geometric until a mesh or effect sequence passes its pipeline.

## 013. The first march waits for the opening

An unattended match used to lose its workers while the player was still learning to spend ore, and the army stayed hidden until it was already on the base. Varek still mines, builds and trains immediately. The attack-move waits until tick 2400. Defense is not delayed. The client shows Contact when an enemy unit is visible, so the arrival can be named. `pnpm sim` pins that seed's winner, tick and checksum.

## 014. A commander plan is host input between ticks

`considerCommander` reads one player's visible world and may apply one plan: produce, group or defend. Those become the same commands a human can issue. `step()` does not call it. A timeout, a malformed payload or a refusal leaves General Varek in control, and the unattended seed checksum stays pinned. The client does not connect a model. A plan is not written into the human replay. Two hosts stay in lockstep when both feed the same plan on the same tick.

## 015. The arena compares seeds before the rules draw

`runArena` plays one seed and one command list until the match ends or a step cap. The report records the winner, the tick, the checksum, both stocks of ore and the living units. Seeds `0x5eed`, `0x51eed` and `0xa11ce` share that result except the checksum, because the checksum already includes the seed and no system draws from `Rng` yet. A later draw has to update those pins. The twenty-second ceiling sits in the test. Wall time does not enter the simulation. The client is unchanged.

## 016. A refusal does not see through the fog

A reason key is information. `footprint` on an unseen site, `not_owner` on a hidden unit and `not_visible` against `unknown_unit` on an attack each told the player, or a commander, what the fog was hiding. A foreign entity out of sight now answers like a missing one. A build site must be in sight whole before units and buildings on it are checked, and the client's placement preview calls the same `siteRefusal` instead of a second check. A gather needs an explored node, matching what the client already draws. General Varek's finders choose only sites he can see; the pinned arena seeds did not change.

A human replay file is player 1 only. Before this, a file could carry orders for Varek and steer him. The same per-seat check belongs in the multiplayer host when it exists.

## 017. Unit meshes before the arena benchmarks

Milestone 6 still lacks its speed table, but the units were boxes and the player could not tell a rifleman from a rocketeer except by size. The five unit meshes go in now, before that table, because they touch only the view and do not change a rule or a checksum. Buildings, nodes and effects stay geometric.

Each spec in `tools/asset-pipeline/blender/specs/` owns its size through `unit_scale` (cells), so the client draws the model at scale 1 and does not resize it. The palette is shared: `hull`, `dark`, `glow` and `team`. The client clones `team` per unit and tints it by owner and health; geometry and the other materials are shared. Facing comes from the drawn movement in the view, since the simulation has no heading. A kind whose model is missing or fails to load keeps its box. `GLTFLoader` sits in its own `three-addons` chunk so the `three` chunk stays under the build warning.


## 018. General Varek is red

The enemy tint was a blue grey (`#8aa0b5`). On the unit meshes it nearly matched the hull, and with low health it faded further; on the minimap enemy cells were close to visible ground. The enemy is now red (`#d0504a` in the view, the same family on the minimap), apart from the player's amber, the grey hull and the cyan glow. Health still darkens the tint.

## 019. CI publishes the game to GitHub Pages

Replaces 008. The skirmish is playable, so the repository now uses the studio workflows from Vazante. `pages.yml` ("CI and Pages") runs `pnpm check` and `pnpm build` on every push and pull request, publishes `apps/game/dist` from `main` to the `gh-pages` branch, and publishes a preview under `/pr-preview/pr-<number>/` for a pull request from this repository. `pages-preview-fork.yml` publishes a fork's already built preview without checking out the fork. Vazante's `snap.yml` is not copied: this game has no desktop shell or snap.

## 020. Building meshes fill 92% of the footprint

The seven buildings follow the unit meshes. Each spec is drawn in cells: the base spans the footprint from `packages/content` at 92%, the margin the boxes used, and `unit_scale` is that longest side so normalisation changes nothing. Height stays below that side. A test fails if a model drifts from its footprint, so a footprint change in content needs a re-bake.

The client loads units and buildings through one `setModels` call. A building under construction is the model scaled in height by its progress, from 15% to full. A remembered wreck is the model at a quarter height with one shared dark material. The placement preview stays a box. Turrets do not turn: the view has no target to aim at.

## 021. Rock ridges are tiled boulders, hidden until explored

Nodes and rocks follow the building meshes. A node model fits its one cell. A rock rect from the match is not one model stretched to 10 by 24 cells: the view tiles it with two boulder models about two cells apart, over a low slab so the ridge reads as one wall. Position, turn, size and the spire share come from a hash of the boulder's place in the rect, so the ridge looks the same on every load. That hash lives in the view and never touches the simulation.

Boulders stand up to about 2.4 cells, well above the fog plane at 0.95. A boulder is shown only once its cell is explored, so the black fog never shows where unexplored rock is. The slab stays below the fog and is always drawn, as the old boxes were. Until both boulder models load, each rect stays one box.

