# Void Dominion

A science-fiction real-time strategy game for the browser. You command the Helion Directorate on the Erebus Frontier: select forces, spend ore and aether, and take ground from a rival. The same orders will later be available to a conventional opponent and to optional AI commanders. The match does not require a language model.

This build is the foundation plus the deterministic simulation. The page is still a boot screen. Unit tests move twenty engineers around the blockage and refuse an illegal order. The field itself is the next client change.

## Develop

Requires Node.js 22 and pnpm 10.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm check      # typecheck, lint and unit tests
pnpm build      # static build in apps/game/dist
```

The simulation is deterministic TypeScript in `packages/simulation`, separate from the Three.js view and the React interface. Read [AGENTS.md](AGENTS.md), the [design](docs/GDD.md) and the [architecture](docs/ARCHITECTURE.md) before contributing.

## License

Code: [AGPL-3.0-or-later](LICENSE). Copyright (c) 2026 Marcel Savegnago. Documentation is part of the same repository. Generated art, when it exists, keeps the license recorded in [docs/assets.md](docs/assets.md).

Void Dominion is an original game. Its command loop is inspired by the real-time strategy genre. It uses no names, art or code from other games.
