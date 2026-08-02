# Game design

The creative seed for the game. A living document like the rest — but the elements here
are the *given* creative direction; agents elaborate within it and log anything that
would change it. Details below feed M1 (world scale/layout), M3 (loop, NPCs), M5 (art).

## Setting

A **medieval-era fantasy village on the shore**, with:

- A **castle at the center**, on a hill, surrounded by a moat — the visual anchor from
  everywhere in the district.
- **Shoreline** on one side; **mountains in the distance** (vista/skybox scale, not
  playable in this experiment).
- **Fields with crops** outside the village gates; a **forest beyond the fields** with
  paths leading out.
- **Catacombs underneath** — this is District 2 (D-008) — with **multiple entrances**
  surfacing in different parts of the world (castle, village, forest…). Each entrance is
  a hard-transition choke point.

## D1 greybox scale and layout (D-090)

The M1 playable surface is a 4,096 m × 4,096 m square centered at the world origin,
using Y-up coordinates and one world unit per metre. Its 16 × 16 grid of 256 m cells is
a streaming and packaging structure, not a visible design grid. The standard greybox
traversal moves at 12 m/s so a ten-minute run crosses a representative share of the
district and repeatedly exercises cell and LOD boundaries.

Generator/schema v1 with fixed seed `0x5eedD101` lays out the central hilltop castle and
moat, village, fields, forest, south shore, connecting paths, and mountain-vista
metadata. The village begins outside the complete castle-and-moat footprint; moat cells
are never also village cells. Three distinct catacomb entrance markers sit in castle,
village, and forest contexts; later transition work treats them as data and applies the
same contract to each. All of those district-specific choices live in a versioned data
descriptor consumed by a district-agnostic generator. Visual content starts as three
hybrid terrain-grid and triangle-box LOD tiers (maximum distances 320 m, 960 m, and
4,096 m with 64 m hysteresis), while collision is authored separately and does not
change with visual LOD. Compound landmarks are reduced as tagged feature groups, so a
tree never separates into a trunk-only or foliage-only proxy and castle far LODs retain
castle geometry even in cells that also carry paths. The visual terrain reads those
collision samples so the streaming grid is not exposed by surface discontinuities.
These greybox choices establish representative scale without deciding the final geometry
representation or M3 physics runtime.

## Genre and mechanics

Fantasy in the **D&D tradition — but original**: multiple playable races, monsters,
magic, a vein of science/alchemy, weapons, food, and crafting, with familiar
tabletop-style mechanics (stats, abilities, loot). **Nothing may use D&D-protected
names, creatures, or mechanics text** (licensing) — original names and our own rule
implementations throughout.

Structure: the normal AAA quest scaffolding — **high-level objectives** (a main arc)
plus **side quests**, tracked in a journal (which also feeds the Summarizer-recap
feature). The slice-scale ruleset below (v1, D-142) makes this concrete.

## Mechanics — slice-scale ruleset v1 (D-142)

The concrete ruleset behind the genre paragraph above. **Slice-scale** means deep
enough that no system is toy-grade, small enough to build and balance for a
two-district demo. Every number here is a starting point for M3.5's iterative
balancing — replays are the balance instrument — not a sacred constant; tuning changes
freely, structural changes (new pools, new resolution model) go through decisions. All
names are original; anything marked *(working name)* is a placeholder until the M5
art/creative pass. Nothing here may reproduce D&D-protected names, creatures, or
mechanics text.

### Resolution core

- Everything resolves inside the deterministic sim as contested **checks** — a seeded
  roll plus an attacker rating against a defender rating — with all randomness drawn
  from named, sim-owned seeded RNG streams (`combat`, `loot`, `ambient`, …). One
  stream per system, so adding a system never perturbs another system's replay
  sequence.
- Four attributes: **Might** (melee power, carry, force checks), **Finesse**
  (accuracy, evasion, ranged, subtle actions), **Vitality** (health, resistances,
  stamina depth), **Attunement** (aether pool, spell potency, catalyst efficiency).
- Three pools: **Health**, **Stamina** (dodges, sprints, power attacks, blocking),
  **Aether** (spellcasting; regenerates slowly in combat, quickly at rest).
- Damage channels (slice): **physical**, **ember**, **frost**, **venom**, **aether** —
  chosen deliberately to double as rendering/VFX showcases (fire lighting, frost/snow
  and wet-surface response).
- Status conditions (slice, bounded): Burning (damage over time, fire-lit), Chilled
  (slowed recovery), Envenomed (damage over time, healing suppressed), Staggered
  (action interrupted), Exposed (guard broken). A new condition is a design change,
  not a content add.

### Combat — deliberate real-time

- Attacks are committed actions with wind-up → active → recovery phases measured in
  sim ticks. Player intent arrives as input commands (features.md M7 constraint 2) and
  monsters use the same action model — one resolution path for everyone.
- Contact during the active phase triggers the check: accuracy (Finesse + weapon +
  stance) against guard (Finesse + armor + state). Blocking and dodging spend Stamina
  to raise guard or grant avoidance frames. No twitch aiming: targeting is soft-lock;
  skill expression is positioning, stamina management, and reading telegraphs.
- Every monster attack has a readable telegraph with a minimum wind-up. "Fast" enemies
  get shorter recoveries, never unreadable wind-ups.

### Magic — aetherwork

Magic is **aetherwork**: shaping ambient aether through a **catalyst**. The
science/alchemy vein is load-bearing, not flavor:

- Spells are abilities (see loadout below) that spend Aether and require an equipped
  catalyst; the catalyst determines potency and specialization.
- Catalysts and **tonics** are crafted at the alembic from **reagents** harvested in
  the world; better catalysts are the crafting endgame of the slice.
- Base catalysts are bought or found so magic is accessible early; crafting is what
  makes it yours.

### Progression — classless, loadout-driven

- XP from quests, combat, and discovery. Level cap **10** for the slice. Each level
  grants one attribute point plus one **ability pick** from a single shared pool.
- Ability pool (slice): **12–16 authored abilities** across martial techniques,
  aetherwork spells, and **knacks** (passives/utility).
- Loadout: **4 active slots + 2 knack slots**. Build identity comes from the loadout
  limit, not class walls.
- Three playable folk at character creation *(working names)*: **Human**, **Skarn**
  (stone-blooded, sturdy), and **Wickfolk** (small, quick, catacomb-canny) — minor
  attribute modifiers plus cosmetic identity. Full visual distinctiveness is an M5
  character-pipeline deliverable (design implication #5).

### Crafting, gathering, economy — slice depth

- Three stations, each an NPC-owned world landmark (feeding schedules and the
  living-village showcase): **forge** (weapons/armor and upgrades), **alembic**
  (catalysts and tonics), **hearth** (food buffs).
- Gathering is district content: crops and herbs in the fields, timber and game in the
  forest, fish and salvage on the shore, ores and relics in the catacombs. Materials
  are cell content and stream like everything else.
- **20–30 recipes** total for the slice. Single currency: **marks** *(working name)*.
  Vendor NPCs hold stock and buy back; prices are static data for the slice — a
  dynamic economy is explicitly out of scope (below).
- Loot: containers and monster drops from seeded deterministic tables; rarity tiers
  Common / Fine / Exceptional / Mythic; found and crafted gear carries **0–2
  modifiers** from a bounded affix list.

### Death — respawn with a recoverable cost

- **Waystones** *(working name)* at landmarks (village square, castle gate, forest
  edge, each catacomb entrance) are rest and respawn anchors; resting restores pools
  and sets the respawn point.
- On defeat the player wakes at the last waystone; a **satchel** holding carried loose
  materials (never equipped gear or quest items) drops at the fall site and persists
  until recovered. A second death replaces it — one satchel in the world at a time.
  Local aggro resets; no world-time or XP penalty.

### Bestiary (slice)

Six to eight archetypes chosen for AI/animation variety, not volume *(all working
names)*: **burrow-gnawers** (field vermin, swarm behavior), **greymaws** (forest pack
predator), **wayland brigands** (humanoid — they fight *and* talk, exercising the
dialog/combat seam), **skitterlings** (catacomb swarm), **hollow wardens** (armored
catacomb sentinels, elite), and one slice boss beneath the catacombs *(working title:
the Warden Below)*. Monster kits use the same action and resolution model as players.

### Quests and journal

- Quest state machines are data: stages with typed objectives (reach / collect /
  defeat / talk / craft / deliver), advanced **only** by semantic sim events (the
  D-141 event stream). LLM dialog can surface, flavor, and hand out quests, but a
  state transition happens only through a validated structured intent (D-074) —
  free-form model text never mutates quest state.
- Slice content: one main arc *(working title: "The Undercroft Stirs")* — signs of
  disturbance beneath the village lead from fields/village investigation down into the
  catacombs and the slice boss, deliberately driving repeated D1↔D2 transitions
  through different entrances (M4's exercise). Plus **6–10 side quests**, at least one
  exercising each system: a bounty (combat), a commission (crafting), a
  harvest/delivery (gathering/economy), a persuasion errand (LLM dialog), and a
  vista/exploration hunt (streaming world).
- The journal is the append-only, save-schema-versioned play-history log — the same
  stream that feeds Summarizer recaps and localization.

### Explicitly out of scope for the slice

No stealth system, no mounts/vehicles, no factions/reputation, no dynamic economy
simulation, no equipment durability, no companion/pet system, no fast travel
(waystones are anchors, not a teleport network). Each is a deliberate slice-scale cut,
not an oversight; adding one back is a decision-log change, not a content add.

## Art direction

**Bright and vibrant, not graywashed.** Normal daylight scenes should pop —
"Fortnite-bright" saturation and readability — while overcast, storms, night, and the
catacombs go genuinely gloomy when conditions call for it. The dynamic range between
those states is itself part of the showcase. Reference sheets in `assets/reference/`
must encode both states for every environment kit (same asset, sunny vs. gloomy
lighting).

## Weather, time, and light

Full weather system as a core feature, not a bolt-on: bright sun → overcast → storms
with lightning; day/night cycle; local light sources (fire, torches, magic) that matter
at night and underground. Lightning and fire are signature lighting moments.

## Characters and NPCs

A mix of player characters and NPCs — and a core aspiration: **with LLM-driven dialog,
it should not be blindingly obvious which is which.** NPCs have persona cards, memory,
schedules, and conversational range closer to "person in a village" than "quest
dispenser." This is a demo headline if it lands (and an on-device small-model quality
finding either way). Full indistinguishability gets a real test only when multiplayer (M7)
brings actual humans in; until then the bar is "NPCs don't feel like vending machines."

## Design implications (binding on architecture/plan)

1. **Dynamic lighting is mandatory.** Day/night + weather rules out a fully-baked
   lighting approach; the renderer must be designed around dynamic time-of-day from M1
   greybox onward. D-098 exercised this requirement for P-002's bounded
   Gaussian-billboard arm, but post-run adjudication invalidated its visual contract in
   clear, overcast, and storm: the provisional full-frame RMSE threshold accepted
   grossly divergent clear/overcast images. No splat visual-parity evidence survives,
   and the arm was not adopted. Any future research-grade or capture-origin splat
   proposal must qualify under *dynamic relighting* with a validated perceptual gate; a
   static-lighting or provisional-threshold result cannot reopen the representation
   decision.
2. **Multiple D1↔D2 transitions.** The catacombs' multiple entrances mean the
   transition system handles N choke points with different surface contexts, not one
   bespoke elevator. The transition contract (budgets.md) applies per entrance.
3. **Weather × streaming interaction.** Weather and time-of-day multiply the PSO/variant
   surface and change what "representative content" means for the M1 spike and harness
   flythroughs — standard runs must sweep lighting/weather states, not just geography.
   D-100's first standard route binds clear/overcast/storm-labelled renderer
   environment states across dawn/daylight/dusk/night while streamed residents own
   presentation. This is M1 binding coverage, not the M6 precipitation, wind,
   wet-surface, or particle implementation.
4. **Crafting/inventory/loot** imply an item/economy data model in the sim from M3
   (serializable, sim-worker-owned, save-schema versioned — same constraints as all sim
   state).
5. **Races and monsters** set the bar for the character pipeline (M5): multiple rigged,
   animated body types, not one hero mesh.
6. **Rules are data; rolls are streams** (D-142). Ability, status, loot, recipe, and
   quest definitions are versioned data tables in `game/` consumed by the sim, and all
   randomness flows through named per-system seeded RNG streams — both are what keep
   repeated same-host replays stable on pinned dev-01 as content grows. Cross-machine
   replay stability remains a future-P2P design objective, not a current gate (D-150;
   features.md M7 constraint 3).
7. **LLM output never mutates state directly** (D-074/D-142). Quest, trade, and any
   other state-affecting outcome of dialog crosses into the sim only as a validated
   structured intent; free-form text is presentation.
