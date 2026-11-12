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
- Accepts one produce, group or defend plan between ticks. The plan becomes an ordinary command and cannot see hidden units. The client does not consult a model.
- Compares three unattended seeds headless. They end on the same tick. The checksum changes with the seed, because no rule draws from the random stream yet.
- Shows ore, aether, supply, power and the match clock in one panel. The command card stops, mines, attacks, builds and trains. WASD pans, the wheel zooms, F3 shows tick and FPS.
- Paints the ground in the view: regolith that varies by cell, a faint line every four cells, and a stain on an explored ore or aether node. The menu is that opening, frozen, until a match starts. Building hulls carry a panel map drawn in the view; the owner colour stays on the team stripe. A selected unit or building shows hit points, damage, range and cost. A disc sits under each mesh, the selection band is brighter, and a unit draws a bar only after it loses hit points. The build preview is the footprint outline. Accept, refuse, a shot and a finished building each play one short synthesized tone.

## What this build does not do

No language model is connected. Meshes and sprites from other RTS projects are not used. The vehicle factory trains an interceptor: the studio hull, with its atlas, on the same ground grid as the other vehicles. The other three hulls in that kit are not units. Two people can play each other online: one hosts and shares a link, and the host's browser runs the match (`docs/MULTIPLAYER.md`). The five Helion ground units and the interceptor, plus seven buildings, are meshes. Ground units are low-poly and tinted by owner. The interceptor keeps the studio atlas and only shifts that colour toward its owner. Units turn toward their movement; buildings rise from the ground while under construction and flatten into a dark wreck in memory. Resource nodes and the rock ridges use meshes from the same pipeline. Shots, hits and deaths play EffectCraft sprite sheets: a muzzle flash, a spark burst and an explosion, only where the player can see. A finished building and a newly trained unit of the player play a beam of light from a ring on the ground. An engineer of the player that drops ore at a depot plays a small gold pulse.

## Factions

Helion Directorate is the only faction on the field: mechanised units, turrets, long-range guns and a modular base. Mycelian and Aether remain design notes.

## Hypothesis

The player will mine, refuse an illegal building, and spend ore on a structure or a soldier before Varek's army arrives. Contact stays off until an enemy unit is visible. Revert the opening delay if the command center still dies before the march tick, or if the player loses without ever seeing the army.
