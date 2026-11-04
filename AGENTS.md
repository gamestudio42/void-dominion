# AGENTS.md

Instructions for AI coding agents working on Void Dominion. Read `docs/GDD.md`, `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before changing code, then the GameStudio42 standards in `.gs42/standards/` (start with `.gs42/standards/AGENTS.md`). This file wins over the studio defaults where they differ.

Generated art follows `docs/artcraft-pipeline.md` and `docs/blender-pipeline.md`.

## Core principle

**One simulation, every commander.** Humans, conventional bots and later language-model agents issue the same validated commands. The renderer and the interface never write world state. The game must be playable with no language model at all.

## Rules

1. Work one milestone at a time, in `docs/ROADMAP.md` order. A milestone is done when its acceptance criteria have automated tests that pass and, when the milestone is player-facing, the build has been exercised in a browser. Compiling is not done.
2. `packages/kernel`, `packages/content` and `packages/simulation` are pure deterministic TypeScript: no DOM, no wall clock, no `Math.random`, no transcendental `Math` functions. ESLint enforces this; do not disable the rule.
3. React has no game rules. It reads snapshots and sends commands. The Three.js view never mutates the simulation.
4. Commands are intentions. Every rejected command returns a reason key. The interface translates that key; it does not invent a second validation.
5. Game numbers live in `packages/content`. Do not copy a gameplay constant into a system or a scene.
6. Every new system gets unit tests in `packages/<package>/test/`.
7. Run `pnpm check` (typecheck, lint, unit tests) before each commit. Run `pnpm build` when the client changes.
8. Original work only. No names, art, text or unit designs from the games that inspired this one. Third-party assets need a license entry in `docs/assets.md`.
9. Code, comments, docs and commits are in English. Player text goes through `apps/game/src/locales.ts` (English source, `pt-BR` translation).
10. Commits use the studio format in `.gitmessage`: `[TAG] area: short description`, with the reason in the body.
11. 2D generated art goes through ArtCraft and lands in the client only after `manifest.json` says `pass` or `warn`. 3D meshes are generated from a JSON spec by the headless Blender pipeline and ship as verified GLB. Do not rotate a mesh in the client to fix an export.
12. If a rule in the docs proves wrong in practice, implement the simplest alternative that keeps the pillars, record it in `docs/DECISIONS.md` and continue.

## Invariants (each has a test)

- The same seed and the same command list produce the same `hashState()` on the same ticks.
- A rejected command does not change `hashState()` compared with a run that never received it.
- A unit never enters a blocked cell.
- An unreachable or blocked order leaves every selected unit where it was, and the client can show the reason key.

## Commands

```bash
pnpm install
pnpm dev          # browser build at http://localhost:5173
pnpm check        # typecheck + lint + unit tests
pnpm build        # production web build in apps/game/dist
```
