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
  sim/         ✅ gameplay adapter/state plus runtime binding; D1 movement,
               collision, transition interaction, deterministic NPC navigation/
               schedules/avoidance, and the M3.5 combat core + combat system
               (checks, conditions, monsters, respawn, deterministic creature AI)
               are live; classless level/XP, attributes, learned abilities, active/
               knack loadouts, combat consumers, and save-schema-v7 progression
               state are live under D-167
  npc/         ✅ persona cards, dialog schemas, rolling memory + fallback policy
  ui/          in-game UI only: HUD, menus, journal, inventory, dialog presentation
               (installer/updater/launcher screens belong to app/, per D-012)
  balance/     ✅ tunable-numbers data (never inline constants in sim code); ruleset
               v2 combat/creature-AI tables and the headless balancer (the D-165
               balance instrument, asserted in the unit gate) live here; progression
               owns the stable 14-ability vocabulary, XP curve, and asserted scripted-
               slice pacing ledger; the recurring multi-creature pressure fixture
               covers encounter-only AI dynamics
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
   Every persona card includes **authored fallback dialog** sufficient to keep the NPC
   functional when the on-device model is unavailable (Chrome can evict it — D-017);
   quest-critical interactions must never require the model.
5. **Tunables live in `balance/` data**, not as magic numbers in systems — this is also
   what lets agents iterate on feel without touching sim correctness.
6. **Placeholder-first.** Gameplay is built and proven against greybox content; nothing
   in this directory may depend on final art existing.
