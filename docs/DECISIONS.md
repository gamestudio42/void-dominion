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

Success and failure of a move order are the definition of done for that slice. Ore, aether, combat and a commander strip are not shown before those systems exist.
