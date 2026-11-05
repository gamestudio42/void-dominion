# AI commanders

A host may submit one plan between ticks through `considerCommander`. No model, prompt or socket is connected. The client does not call the gateway.

## Role

A commander proposes a plan: produce, group, or defend a region. The engine checks the plan and turns it into the same commands a human can issue. The commander cannot create resources, skip the tech tree, order another faction's units, or read hidden information. The view omits units the player cannot see, buildings that were never seen, and nodes on unexplored ground.

## When the model is absent

Movement, gathering and combat keep running on the last valid conventional policy. A timeout, a malformed plan or a refused action does not stop the match and does not change the checksum.

## Budget

The simulation ticks at 20 Hz. A language model is not consulted on that clock. Strategic plans are occasional and happen outside the tick. Token counts and latency, when a model exists, are telemetry, not rules.

## Personalities

A commander can be a set of weights (aggression, defence, expansion, technology, risk) with no model at all. General Varek is that commander. A model may later choose among those policies. It does not replace them.

## Fallback

With no plan, milestones 0–4 still form a complete skirmish. The unattended seed stays pinned. A plan is host input, not part of the human replay.
