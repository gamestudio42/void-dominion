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

An unattended match used to lose its workers while the player was still learning to spend ore, and the army stayed hidden until it was already on the base. Varek still mines, builds and trains immediately. The attack-move waits until tick 2400. Defense is not delayed. The client shows Contact when an enemy unit is visible, so the arrival can be named. `pnpm sim` pins that seed's winner, tick and checksum. Benchmarks and the commander gateway stay out.
