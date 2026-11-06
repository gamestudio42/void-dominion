![Void Dominion emblem: an amber chevron on a dark field](/gamestudio42/void-dominion/raw/main/apps/game/public/favicon.svg)

# Void Dominion

**Every order is checked. Every match replays exactly.**

[![Play Void Dominion](https://img.shields.io/badge/Play_in_browser-e0a045?style=for-the-badge&labelColor=12151c&color=e0a045)](https://gamestudio42.github.io/void-dominion/) [![GitHub Pages deployment status](https://img.shields.io/github/actions/workflow/status/gamestudio42/void-dominion/pages.yml?branch=main&style=for-the-badge&labelColor=12151c&label=Pages)](https://github.com/gamestudio42/void-dominion/actions/workflows/pages.yml) [![GitHub stars](https://img.shields.io/github/stars/gamestudio42/void-dominion?style=for-the-badge&labelColor=12151c&color=c9a74a)](https://github.com/gamestudio42/void-dominion/stargazers) [![Game Studio 42](https://img.shields.io/badge/Game_Studio_42-12151c?style=for-the-badge&labelColor=12151c&color=6fb6db)](https://github.com/gamestudio42)

A real-time strategy game in the browser. You command the Helion Directorate on the Erebus Frontier, against General Varek on the other side of the same field. Engineers mine ore, the command card builds and trains, and the fog keeps the enemy base hidden until you have seen it. Ore and aether pay for everything, supply caps what you can field, and destroying the enemy command center ends the match. Both sides issue the same validated orders; a refused order names its reason and spends nothing. No installation is needed to play, and no network or language model is required to play the bot.

[ ![Play Void Dominion in the browser](/gamestudio42/void-dominion/raw/main/docs/screenshots/play.svg) ](https://gamestudio42.github.io/void-dominion/)

[ ![The Void Dominion title screen](/gamestudio42/void-dominion/raw/main/docs/screenshots/menu.jpg) ](https://gamestudio42.github.io/void-dominion/)

## Take the frontier

1. **Mine before you spend.** Four engineers start on the nearest ore and keep delivering to the command center. A finished extractor gives that patch its own drop-off, so the haul is shorter; aether needs a refinery touching its node before it is worth anything.
2. **Build in the order the base needs.** An extractor, a refinery, a generator, a barracks, a vehicle factory, a defense turret and a second command center are on the card, each with its ore and aether price. A site that does not fit, a missing refinery or a short wallet is refused by name, and nothing is charged.
3. **Watch supply and power.** Every unit takes supply, and the generator has to cover what the base draws. Power that falls short turns red on the top bar, and the unit that would exceed supply is refused.
4. **Scout, then commit.** Unexplored ground is black. Explored ground remembers enemy buildings, and keeps a wreck where one fell out of sight. A unit or turret only shoots what its player can see.
5. **Break the command center.** Destroy every command center the opponent owns to win. Both lost on the same tick is a draw. General Varek holds his first march until your opening has a finished building, so the match opens on economy rather than on a rush.

Every command is validated against ownership, bounds, path, cost and sight before it changes the world. The simulation is deterministic: the same seed and the same command list produce the same state and the same checksum, so a saved replay returns the exact match.

## See the frontier

[ ![The Helion base at the opening, four engineers selected and mining the nearest ore](/gamestudio42/void-dominion/raw/main/docs/screenshots/field.jpg) ](/gamestudio42/void-dominion/blob/main/docs/screenshots/field.jpg)

| [ ![General Varek's column reaches the base and the CONTATO banner appears](/gamestudio42/void-dominion/raw/main/docs/screenshots/contact.jpg) ](/gamestudio42/void-dominion/blob/main/docs/screenshots/contact.jpg) Contact: General Varek's first units come into sight, announced by the banner. | [ ![The title screen with a skirmish and an online match](/gamestudio42/void-dominion/raw/main/docs/screenshots/menu.jpg) ](/gamestudio42/void-dominion/blob/main/docs/screenshots/menu.jpg) The title screen: a skirmish against Varek, or a link to play a friend. |
|---|---|

## Status

The skirmish is playable end to end: mine, build, train, fight, win or lose, and save the replay to a file. Two people can also play each other online. One hosts, sends a link, and the host's browser runs the only simulation, so the guest only ever receives what its fog allows. At the end the guest checks the host's replay and the result is shown as verified or not. There is no TURN relay, so two players both behind carrier-grade NAT cannot connect.

Still open: the field test of online play across two networks, a campaign, the Mycelian and Aether factions, and a language-model commander. The gateway for a plan is in the simulation; this client never calls it, and the conventional opponent keeps playing when no plan arrives. See the [project roadmap](/gamestudio42/void-dominion/blob/main/docs/ROADMAP.md).

## Play

Open **[gamestudio42.github.io/void-dominion](https://gamestudio42.github.io/void-dominion/)**. Choose **Escaramuça contra o General Varek** to play the skirmish, or **Hospedar partida online** to create a match and send the link to a friend. The interface follows the browser language: Portuguese and English. A refused order leaves its reason on screen and spends nothing.

| Action | Shortcut |
|---|---|
| Select units | left click, drag a box (`Shift` adds) |
| Move, attack, gather | right click on the ground, a unit or a node |
| Place a building | `Construir`, pick the kind, then left click on the site |
| Leave the current order mode | right click or `Esc` |
| Pan / zoom / focus the camera | `W` `A` `S` `D` / wheel / click the minimap |
| Stop, mine, attack, build, train | the command card |
| Tick and frames per second | `F3` |
| Save / load a replay | `Salvar replay` / `Carregar replay` (JSON file) |

A replay file is version 2: the seed, the seats, the tick count and the human orders. Loading it resimulates General Varek; his decisions are never stored. The build is a static site with relative paths, so it runs from any folder, and the field itself is played on a 128×128 grid at a fixed 20 steps per second.

## Develop

Requires Node.js 22+ and pnpm 10.

```
pnpm install
pnpm dev        # http://localhost:5173
```

| Command | Purpose |
|---|---|
| `pnpm check` | Type check, lint and unit tests |
| `pnpm sim` | Plays the three pinned seeds headless and compares the reports |
| `pnpm bench` | Times every step of those seeds and prints the speed table (`docs/BENCHMARKS.md`) |
| `pnpm bench:view` | Measures the view a multiplayer host sends its guest (`docs/BENCHMARKS.md`) |
| `pnpm build` | Static build in `apps/game/dist` |
| `pnpm preview` | Serves the build |

The simulation is a pure TypeScript package with a fixed 20 Hz step and a seeded RNG; it never touches Three.js, React or the clock. The Three.js view and the React interface only send commands and read state. See the [architecture](/gamestudio42/void-dominion/blob/main/docs/ARCHITECTURE.md), the [game design](/gamestudio42/void-dominion/blob/main/docs/GDD.md), the [decisions](/gamestudio42/void-dominion/blob/main/docs/DECISIONS.md), the [testing plan](/gamestudio42/void-dominion/blob/main/docs/TESTING.md), the [multiplayer plan](/gamestudio42/void-dominion/blob/main/docs/MULTIPLAYER.md), the [benchmarks](/gamestudio42/void-dominion/blob/main/docs/BENCHMARKS.md), the [asset register](/gamestudio42/void-dominion/blob/main/docs/assets.md) and the [rules for agents](/gamestudio42/void-dominion/blob/main/AGENTS.md).

## Licence

Void Dominion is free software under the GNU Affero General Public License, version 3 or any later version ([`AGPL-3.0-or-later`](/gamestudio42/void-dominion/blob/main/LICENSE)). Copyright (c) 2026 Marcel Savegnago. If you run a modified version for other people, including as a website or over a network, you must offer them its source under the same licence.

Void Dominion is an original game. Its command loop is inspired by the real-time strategy genre; it uses no names, art or code from another game. Code, field, models, effects and interface are original, and every asset is listed in the [asset register](/gamestudio42/void-dominion/blob/main/docs/assets.md).

## Files

[.claude/](https://github.com/gamestudio42/void-dominion/tree/main/.claude), [.cursor/rules/](https://github.com/gamestudio42/void-dominion/tree/main/.cursor/rules), [.github/workflows/](https://github.com/gamestudio42/void-dominion/tree/main/.github/workflows), [.gs42/](https://github.com/gamestudio42/void-dominion/tree/main/.gs42), [.hermes/skills/](https://github.com/gamestudio42/void-dominion/tree/main/.hermes/skills), [.opencode/skills/](https://github.com/gamestudio42/void-dominion/tree/main/.opencode/skills), [.pi/](https://github.com/gamestudio42/void-dominion/tree/main/.pi), [apps/](https://github.com/gamestudio42/void-dominion/tree/main/apps), [assets/](https://github.com/gamestudio42/void-dominion/tree/main/assets), [docs/](https://github.com/gamestudio42/void-dominion/tree/main/docs), [packages/](https://github.com/gamestudio42/void-dominion/tree/main/packages), [tools/](https://github.com/gamestudio42/void-dominion/tree/main/tools), [.gitignore](https://github.com/gamestudio42/void-dominion/blob/main/.gitignore), [.gitmessage](https://github.com/gamestudio42/void-dominion/blob/main/.gitmessage), [.hermes.md](https://github.com/gamestudio42/void-dominion/blob/main/.hermes.md), [AGENTS.md](https://github.com/gamestudio42/void-dominion/blob/main/AGENTS.md), [CLAUDE.md](https://github.com/gamestudio42/void-dominion/blob/main/CLAUDE.md), [LICENSE](https://github.com/gamestudio42/void-dominion/blob/main/LICENSE), [README.md](https://github.com/gamestudio42/void-dominion/blob/main/README.md), [eslint.config.js](https://github.com/gamestudio42/void-dominion/blob/main/eslint.config.js), [gs42.json](https://github.com/gamestudio42/void-dominion/blob/main/gs42.json), [opencode.json](https://github.com/gamestudio42/void-dominion/blob/main/opencode.json), [package.json](https://github.com/gamestudio42/void-dominion/blob/main/package.json), [pnpm-lock.yaml](https://github.com/gamestudio42/void-dominion/blob/main/pnpm-lock.yaml), [pnpm-workspace.yaml](https://github.com/gamestudio42/void-dominion/blob/main/pnpm-workspace.yaml), [tsconfig.base.json](https://github.com/gamestudio42/void-dominion/blob/main/tsconfig.base.json), [tsconfig.json](https://github.com/gamestudio42/void-dominion/blob/main/tsconfig.json), [tsconfig.sim.json](https://github.com/gamestudio42/void-dominion/blob/main/tsconfig.sim.json), [tsconfig.web.json](https://github.com/gamestudio42/void-dominion/blob/main/tsconfig.web.json), [vitest.config.ts](https://github.com/gamestudio42/void-dominion/blob/main/vitest.config.ts)
