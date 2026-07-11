# game/ — the game itself

World definition, gameplay systems, NPC content, quests, and UI logic. Read the root
`AGENTS.md`, [docs/architecture.md](../docs/architecture.md),
[docs/game-design.md](../docs/game-design.md) (the creative direction — setting, art
direction, mechanics — is given there, including the no-D&D-protected-content licensing
rule), and [docs/features.md](../docs/features.md) (the multiplayer/N-district
constraints bind every system in this directory).

## Scope

**In:** world graph (districts, cells, transitions — as data), gameplay simulation
systems, entities/components, NPC personas + dialog design, quest/interaction logic,
HUD/menus, game balance data.

**Out:** anything touching a browser API directly. All platform access goes through
`engine/` interfaces (root rule 4). If you need a capability `engine/` doesn't expose,
extend the engine interface (in `engine/`, following its rules) — don't tunnel past it.

## Planned structure (create as milestones start; update this list)

```
game/
  world/       district/cell definitions, world graph, spawn tables (data-first)
  sim/         gameplay systems running in the sim worker (entities, movement,
               interaction, quests)
  npc/         persona cards, dialog schemas, memory policies
  ui/          HUD, menus, installer/launch screens
  balance/     tunable-numbers data (never inline constants in sim code)
```

## Rules

1. **The multiplayer constraints are law today** (docs/features.md): all input as
   serializable commands; deterministic sim (seeded RNG from the sim's RNG service, no
   wall-clock in sim steps, no iteration-order dependence); stable entity IDs;
   serializable state. The harness's determinism check (same command log ⇒ same state
   hash) gates sim changes from M3 on.
2. **World structure is data.** No code may name a specific district or hard-code the
   world graph. Content lives in data files; systems interpret them.
3. **Sim code runs in the sim worker** and may not import render- or DOM-adjacent
   modules. Rendering reads interpolated snapshots; it never reaches into sim state.
4. **NPC dialog:** persona cards + rolling summarized memory; anything that can affect
   game state comes back through a JSON-schema-constrained intent, validated before the
   sim sees it as a command. Freeform model text is flavor only. Design for nano-class
   model quality — constrain hard, tolerate weirdness gracefully (it's characterful).
5. **Tunables live in `balance/` data**, not as magic numbers in systems — this is also
   what lets agents iterate on feel without touching sim correctness.
6. **Placeholder-first.** Gameplay is built and proven against greybox content; nothing
   in this directory may depend on final art existing.
