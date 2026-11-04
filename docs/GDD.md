# Game design

## Fantasy

You are a commander of the Helion Directorate on the Erebus Frontier. You take and hold ground by spending ore and aether faster than a rival can answer. Inferred from the project brief; this build does not yet contain a rival.

## Pillars

1. **Direct command.** Select, order, read the result, order again. The game is fun with no language model.
2. **One simulation.** Humans, bots and later commanders use the same validated commands. Hidden information stays hidden.
3. **Reproducible matches.** The same seed and the same command list produce the same state.
4. **An original frontier.** Helion industry, ore, aether and, later, void instability. No borrowed faction, unit or map.

## Loop

Scout, gather, build, produce, fight, expand.

The beat this build changes is **select and order a move**. Success is the engineers arriving on open ground by walking around the blockage. Failure is a blocked cell: the engineers stay, a mark sits on the blockage, and the interface says why.

## What this build does

- Shows a 128×128 field, one blockage and twenty engineers.
- Selects one engineer or a box of them. Shift adds to the selection.
- Right-click walks the selection around the blockage to open ground.
- Refuses a blocked cell without moving anyone, and shows the reason.
- Pans with WASD, zooms with the wheel. Tick and FPS stay behind F3.

## What this build does not do

Ore, aether, supply, workers, construction, production, weapons, fog of war, a conventional opponent, replays on disk, language-model commanders, multiplayer, and the Mycelian Collective and Aether Ascendancy. Those stay on the roadmap. The interface must not show counters for them.

## Factions, later

Helion Directorate is the only faction in the first playable match: mechanised units, turrets, long-range guns, repairs, modular bases, slow logistics. Mycelian and Aether are design notes only until that match exists.

## Hypothesis for the move slice

The player will select the engineers and send them around the blockage, and will see a refusal when the destination cannot be reached. Revert the slice if a unit crosses the blockage, if the refusal is not readable, or if two runs with the same orders disagree.
