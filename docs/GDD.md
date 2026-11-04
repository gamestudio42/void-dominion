# Game design

## Fantasy

You are a commander of the Helion Directorate on the Erebus Frontier. You take and hold ground by spending ore and aether faster than a rival can answer. Inferred from the project brief.

## Pillars

1. **Direct command.** Select, order, read the result, order again. The game is fun with no language model.
2. **One simulation.** Humans, bots and later commanders use the same validated commands. Hidden information stays hidden.
3. **Reproducible matches.** The same seed and the same command list produce the same state.
4. **An original frontier.** Helion industry, ore, aether and, later, void instability. No borrowed faction, unit or map.

## Loop

Scout, gather, build, produce, fight, expand.

The beat this build changes is the whole skirmish: gather ore, spend it, train soldiers, and lose the match if the command center falls. Success is ore rising and a building or unit appearing after you pay. Failure is a refused order whose reason stays on screen, or a command center destroyed by the opponent.

## What this build does

- Starts a Helion versus Helion skirmish on the 128×128 field. The human is player 1. General Varek, a weight-driven opponent, is player 2.
- Engineers already mine the nearest ore. Ore is delivered to a command center or a finished extractor. Aether needs a finished refinery touching the node.
- Builds the Helion roster from `packages/content`: extractor, refinery, generator, barracks, factory, turret and a second command center. Barracks and the factory train the combat units.
- Fights with hit points, armor and cooldown. A unit or turret only shoots what its player can see. Destroying every command center of a player ends the match. Both lost on the same tick is a draw.
- Hides unexplored ground. Explored ground keeps a memory of enemy buildings, including a wreck if one falls out of sight.
- Records the human's commands. Loading that file resimulates Varek; his orders are not stored.
- Holds Varek's first march until the opening can finish a building. Shows Contact when an enemy unit is visible.
- Pins the unattended seed: `pnpm sim` checks that the same winner, tick and checksum come back.
- Shows ore, aether, supply, power and the match clock. The command card stops, mines, attacks, builds and trains. WASD pans, the wheel zooms, F3 shows tick and FPS.

## What this build does not do

Language-model commanders, network multiplayer, and the Mycelian Collective and Aether Ascendancy. The match runs with those absent. Meshes and effect sequences are not baked into this client; units and buildings are still geometric.

## Factions

Helion Directorate is the only faction on the field: mechanised units, turrets, long-range guns and a modular base. Mycelian and Aether remain design notes.

## Hypothesis

The player will mine, refuse an illegal building, and spend ore on a structure or a soldier before Varek's army arrives. Contact stays off until an enemy unit is visible. Revert the opening delay if the command center still dies before the march tick, or if the player loses without ever seeing the army.
