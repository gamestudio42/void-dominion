# AI commanders

Design only. No gateway, model or prompt is in the repository.

## Role

A commander proposes a plan: produce, group, defend a region. The engine checks the plan and turns it into the same commands a human can issue. The commander cannot create resources, skip the tech tree, order another faction's units, or read hidden information.

## When the model is absent

Movement, gathering and combat keep running on the last valid conventional policy. A timeout, a malformed plan or a refused action does not stop the match.

## Budget

The simulation ticks at 20 Hz. A language model is not consulted on that clock. Strategic plans are occasional and happen outside the tick. Token counts and latency, when the gateway exists, are telemetry, not rules.

## Personalities

A commander can be a set of weights (aggression, defence, expansion, technology, risk) with no model at all. A model may later choose among those policies. It does not replace them.

## Fallback

If milestone 5 is delayed or cut, milestones 0–4 still form a complete skirmish against a conventional opponent.
