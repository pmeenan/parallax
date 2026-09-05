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

## D2 greybox scale and layout (D-174)

The catacombs occupy a 1,024 m × 1,024 m underground district divided row-major into an
8 × 8 grid of 128 m cells. Generator/schema v1 uses fixed seed `0x5eedD201`. Sixteen
connected cells form the traversable greybox: a four-cell central Warden arena, separate
castle and village passages, and a bent forest passage. The other 48 cells are sealed
rock, making the route network and full-occlusion boundary explicit rather than treating
the whole underground square as walkable. Collision samples remain independent of visual
LOD at 8 m spacing.

Castle undercroft, village well, and forest ruin transition markers pair one-to-one with
their D1 counterparts through world-graph schema v2. Each undirected hard-transition edge
owns its context and two arrival headings; district and marker identities are references,
not code paths. The graph validator requires every registered district exactly once,
every authored transition marker on exactly one edge, and a positive finite prefetch
trigger. D-177 calibrates those latest-start distances at 6 m for castle and 5 m for
village and forest against the standard 12 m/s traversal.

## Genre and mechanics

Fantasy in the **D&D tradition — but original**: multiple playable races, monsters,
magic, a vein of science/alchemy, weapons, food, and crafting, with familiar
tabletop-style mechanics (stats, abilities, loot). **Nothing may use D&D-protected
names, creatures, or mechanics text** (licensing) — original names and our own rule
implementations throughout.

Structure: the normal AAA quest scaffolding — **high-level objectives** (a main arc)
plus **side quests**, tracked in a journal (which also feeds the Summarizer-recap
feature). The slice-scale ruleset below (v2, D-142/D-165) makes this concrete.

## Mechanics — slice-scale ruleset v2 (D-142/D-165)

The concrete ruleset behind the genre paragraph above. v1 (D-142) fixed the structural
forks — deliberate real-time combat, aether + crafted catalysts, classless loadout
progression, waystone/satchel death. v2 (D-165, M3.5 entry) concretizes them into
buildable numbers: resolution math, tick timings, the authored ability list, bestiary
stat blocks, the XP curve, recipes, affixes, and quest content, under the chosen feel
target — **deliberate but forgiving**: committed attacks and readable telegraphs
matter, but ordinary enemies take several mistakes to kill you.

**Slice-scale** means deep enough that no system is toy-grade, small enough to build
and balance for a two-district demo. This doc is the spec home for formulas, shapes,
and target bands; the authoritative tunable *values* live as versioned data tables in
`game/balance/` as each system lands (design implication #6). Every number here is a
starting point for M3.5's balancing — the headless balancer below is the instrument —
not a sacred constant; tuning changes freely, structural changes (new pools, new
resolution model) go through decisions. All names are original; anything marked
*(working name)* is a placeholder until the M5 art/creative pass. Nothing here may
reproduce D&D-protected names, creatures, or mechanics text.

### Resolution core

- Everything resolves inside the deterministic sim as contested **checks**, with all
  randomness drawn from named, sim-owned seeded RNG streams (`combat`, `loot`,
  `behavior`, `ambient`, …). One stream per system, so adding a system never perturbs
  another system's replay sequence.
- **Rules math is integer-only** (design implication #8). Ratings, pools, damage, and
  ticks are integers; multipliers are small rationals applied with floor division
  (×3/2, ×3/4, ×1/4). Floats never enter rules resolution — same-host replay hashing
  stays trivially stable and future cross-machine replay (features.md M7) isn't
  hostage to floating-point divergence.
- **The check:** draw `R`, a uniform integer in **[−8, +8]**, from the owning stream;
  `score = R + attacker rating − defender rating`. `score < 0` fails, `0–7` succeeds,
  `≥ 8` is a **keen** success (effect ×3/2, floor). Edge rule: `R = −8` always fails
  and `R = +8` always at least succeeds, so no rating gap makes an outcome certain.
  Equal ratings succeed ≈53% of the time; each rating point shifts ≈6%.
- Four attributes on a **1–10** scale: **Might** (melee power, carry, force checks),
  **Finesse** (accuracy, evasion, ranged, subtle actions), **Vitality** (health,
  resistances, stamina depth), **Attunement** (aether pool, spell potency, catalyst
  efficiency). Creation: 3 base in each, plus 2 free points, plus folk modifiers
  (below); one more point per level.
- Three derived pools: **Health** `50 + 10×Vitality` (regenerates only via rest,
  tonics, food, or Mendweave), **Stamina** `70 + 10×Vitality` (dodges, sprints, power
  attacks, blocking; regenerates 35/s after a 30-tick delay out of actions, 10/s while
  blocking), **Aether** `20 + 10×Attunement` (spellcasting; 2/s in combat, 12/s at
  rest). Per-second regeneration accrues through integer per-tick accumulators.
- **Ratings:** accuracy = Finesse + weapon accuracy + stance/ability modifiers; guard
  = ⌊Finesse/2⌋ + armor guard (+6 while blocking); spell potency = Attunement +
  catalyst potency; resist = ⌊Vitality/2⌋ + gear ward.
- **Damage:** each weapon/spell names its scaling attribute; `raw = base + attribute`
  (heavy attacks ×3/2 floor), `dealt = max(1, raw − soak[channel])`. Armor gives
  physical soak; wards and tonics give elemental soak. Keen multiplies `raw` before
  soak.
- Damage channels (slice): **physical**, **ember**, **frost**, **venom**, **aether** —
  chosen deliberately to double as rendering/VFX showcases (fire lighting, frost/snow
  and wet-surface response).
- Status conditions (slice, bounded — durations in sim ticks at 60 Hz): **Burning**
  (4 ember damage/s for 300t, fire-lit, refresh not stack), **Chilled** (recoveries
  ×3/2, stamina regen ×1/2, 360t), **Envenomed** (2 venom damage/s for 600t, healing
  suppressed), **Staggered** (current action canceled, 30t action lockout),
  **Exposed** (guard −6 for 240t). A new condition is a design change, not a content
  add.
- Exactly two **condition interactions** exist in the slice — the thermal-shock
  pair: an ember hit on a Chilled target consumes Chilled and applies Staggered; a
  frost hit on a Burning target consumes Burning and applies Exposed. Deterministic,
  non-stacking, and deliberately readable — combo play for caster and hybrid builds
  without growing the condition pool. A new interaction is a design change, not a
  content add.

### Combat — deliberate real-time

- Attacks are committed actions with wind-up → active → recovery phases measured in
  sim ticks. Player intent arrives as input commands (features.md M7 constraint 2) and
  monsters use the same action model — one resolution path for everyone.
- Contact during the active phase triggers the check: accuracy against guard. Blocking
  and dodging spend Stamina to raise guard or grant avoidance frames. No twitch
  aiming: targeting is soft-lock; skill expression is positioning, stamina management,
  and reading telegraphs.
- **Player action timings** (ticks at 60 Hz; starting values):

  | Action | Wind-up | Active | Recovery | Stamina |
  | --- | --- | --- | --- | --- |
  | Light attack | 18 | 6 | 14 | 0 |
  | Heavy attack (raw ×3/2) | 34 | 8 | 26 | 25 |
  | Ranged loose (draw is holdable) | 24 | — | 16 | 10 |
  | Dodge (avoidance frames 5–16) | — | 24 total | — | 20 |
  | Sprint | — | held | — | 10/s |

- **Blocking** is held, not timed: +6 guard while up; a blocked physical hit deals
  ×1/4 damage (floor) and drains stamina equal to ⌊raw/2⌋. Running out of stamina
  while blocking breaks the block, applies Exposed, and locks re-raising for 30
  ticks. A block raised within 12 ticks of impact is a **caught block** — no stamina
  drain — and is the trigger for the Answering Strike ability.
- **Spell casts** share the committed-action model: bolts wind up 24/2/18, rites
  (heals, wards) 30/2/20 — casting is a commitment you fit into openings, exactly
  like a heavy swing.
- **Stagger:** taking a keen hit mid-wind-up, or any hit while Exposed, applies
  Staggered (action canceled, 30t lockout).
- **Hits are reliable; misses are legible.** Baseline (unmodified) player offensive
  checks are tuned to land 70–85% at-level against chaff and commons, while monster
  baseline checks stay at 45–65% — a correctly positioned, committed attack rarely
  whiffs, exploiting openings pushes above the band by design, and the
  player's real defense is dodging and blocking, not the roll. Elites and the boss
  sit below that baseline by design: their Exposed openings are the intended lane.
  A failed check is never an empty whiff — a failed weapon check presents as a
  visible deflection off guard, a failed spell check as a resist flash (presentation
  only, no damage).
- Every monster attack has a readable telegraph. There are exactly two wind-up
  floors: **30 ticks** normally, **24 ticks** for attacks explicitly tagged *fast*
  in their kit data — nothing goes lower. Fast attacks get shorter recoveries too,
  never sub-floor wind-ups. Boss enrage phases accelerate recoveries only.
- **Feel bands (deliberate but forgiving):** an at-level player kills a common enemy
  in 4–8 landed hits and survives common hits within per-loadout envelopes (martial
  reference 6–10; caster and hybrid below); chaff (gnawers, skitterlings) dies in
  2–3 hits but arrives in packs; elites take 30–90 s; the slice boss is a 3–7 minute
  fight. These are the headless balancer's assertion bands (below).

### Magic — aetherwork

Magic is **aetherwork**: shaping ambient aether through a **catalyst**. The
science/alchemy vein is load-bearing, not flavor:

- Spells are abilities (see loadout below) that spend Aether and require an equipped
  catalyst; the catalyst determines potency and specialization.
- An empty pool never means standing idle: every equipped catalyst grants
  **Aetherspark** *(working name)*, outside the 14-ability pool — a zero-cost
  spell-type bolt (base 4, aether channel, light-attack timings).
- Skill refunds aether: a **keen** spell success refunds ⌊cost/2⌋. Reading openings
  is the caster's version of stamina management.
- Catalyst tiers (slice, all alembic-crafted above the base; *(working names)*):
  **Ashwood Focus** (potency +1, buyable — magic is accessible early), **Glazed
  Focus** (potency +2), **Resonant Focus** (potency +3, attuned at crafting to ember,
  frost, or aether: that channel's spell raw ×5/4). Potencies were retuned down from
  +2/+4/+6 by the balancer so spell checks track weapon-accuracy growth and stay
  inside the baseline hit band. Better catalysts are the crafting endgame of the
  slice; crafting is what makes magic yours.
- Catalysts and **tonics** are crafted at the alembic from **reagents** harvested in
  the world (gathering table below).

### Progression — classless, loadout-driven

- XP from quests, combat, and discovery. Level cap **10** for the slice. Each level
  grants one attribute point plus one **ability pick** from the single shared pool —
  nine picks by cap, from **14 authored abilities**, so no two builds need overlap
  much. Reshaping (respec) at any waystone costs 25 marks.
- Loadout: **4 active slots + 2 knack slots**, all available from level 2. The empty
  early slots advertise the full build shape and let every learned ability be tried in
  any matching slot; access does not stage by level or add saved unlock state. Build
  identity comes from the loadout limit, not class walls.
- **The ability pool** (slice; costs are starting values):

  | Ability | Type | Cost | Effect |
  | --- | --- | --- | --- |
  | Cleaving Arc | Martial | 35 stamina | Heavy arc hitting every target in a 2.5 m, 120° front; raw ×3/4 per target |
  | Answering Strike | Martial | — | After a caught block, next light attack within 60t is auto-keen and costs no stamina |
  | Piercing Lunge | Martial | 25 stamina | 4 m gap-closing thrust; ignores half of physical soak |
  | Ironset Stance | Martial | 20 + 5/s stamina | Plant: +4 guard, immune to Staggered, movement ×1/2, up to 240t |
  | Steady Loose | Martial | 15 stamina | Chargeable shot: full 45t draw gives +3 accuracy and raw ×3/2 |
  | Emberlash | Aetherwork | 12 aether | Ember bolt, base 10; applies Burning on keen |
  | Frostbind | Aetherwork | 15 aether | 3 m frost burst, base 8; applies Chilled on success |
  | Aetherpulse | Aetherwork | 18 aether | 3 m force wave, aether channel, base 6; Staggers non-elites |
  | Mendweave | Aetherwork | 25 aether | Restore 30 Health over 360t (5/s); suppressed by Envenomed |
  | Wardlight | Aetherwork | 20 aether | Ward absorbing 25 damage for up to 1200t; emits lantern-strength light (night/catacomb showcase) |
  | Forager's Eye | Knack | — | Gathering nodes yield +1 and shimmer within 30 m |
  | Wellspring | Knack | — | Stamina regeneration +10/s |
  | Quiet Tread | Knack | — | Monster perception radius against you ×3/4 |
  | Tinker's Thrift | Knack | — | Recipes need one fewer common material (min 1); salvage yields +1 |

- Three playable folk at character creation *(working names)*: **Human** (+1 to any
  one attribute), **Skarn** (stone-blooded, sturdy: +1 Might, +1 Vitality,
  −1 Finesse), and **Wickfolk** (small, quick, catacomb-canny: +1 Finesse,
  +1 Attunement, −1 Might) — minor modifiers plus cosmetic identity. Full visual
  distinctiveness is an M5 character-pipeline deliverable (design implication #5).
- **XP curve:** reaching level `n+1` from `n` costs `100×n` XP (4,500 total to cap).
  A level gain refills stamina and aether, resets their fractional regeneration
  bookkeeping, and deliberately leaves health unchanged: the reward immediately opens
  another offensive sequence without erasing encounter attrition.
  Sources (starting values): common kills 4–20 by archetype (bestiary table), elites
  60, boss 400, main-arc stages 100–200, side quests 75–150, first visit to a named
  landmark 25. Target pacing: completing the slice content lands level 9–10 in a
  6–8 hour playthrough.

### Crafting, gathering, economy — slice depth

- Three stations, each an NPC-owned world landmark (feeding schedules and the
  living-village showcase): **forge** (weapons/armor and upgrades), **alembic**
  (catalysts and tonics), **hearth** (food buffs).
- **Base gear** (starting values; base damage scales by the named attribute):

  | Item | Numbers | Notes |
  | --- | --- | --- |
  | Sword | base 10, accuracy +1, Might | The reference weapon |
  | Axe | base 12, accuracy 0, Might | Recoveries +4t |
  | Spear | base 9, accuracy +1, Might | +0.5 m reach |
  | Bow | base 8, accuracy +2, Finesse | Ranged; draw is holdable |
  | Cloth garb | guard +1, soak 1 | — |
  | Leather jack | guard +2, soak 2 | — |
  | Scale coat | guard +3, soak 4 | Stamina regen −5/s |

- Gathering is district content, and every reagent exists to feed a recipe: **fields**
  — grain, bittergreen, emberpetal *(working names)*; **forest** — timber, game meat,
  greymaw pelts; **shore** — fish, sea salt, salvage iron; **catacombs** — dimstone
  ore, relic fragments, skitterling venom. Materials are cell content and stream like
  everything else.
- **24 recipes** for the slice (counts fix v1's 20–30 range): **forge (8)** —
  Tempered Sword / Axe / Spear, Laminated Bow, Scale Coat, Reinforced Buckler, Weapon
  Whetting (+2 base damage, once per weapon), Armor Fitting (+1 guard, once per
  armor); **alembic (9)** — Ashwood / Glazed / Resonant Focus, Vigor Tonic (40 Health
  over 8 s), Stone Tonic (+2 physical soak, 60 s), Clearing Draught (cures Burning /
  Chilled / Envenomed), Emberdust Oil and Frostglass Oil (weapon +3 of that channel,
  120 s), Aether Salts (restore 30 Aether); **hearth (7)** — Hearthloaf (+10 max
  Stamina), Fisher's Stew (+10 max Health), Orchard Preserve (+1 Finesse), Hunter's
  Roast (+1 Might), Tidebroth (+1 Attunement), Waybread (1 Health/s out of combat,
  5 min), Mulled Cordial (stamina regen +5/s). Other hearth buffs last 10 minutes;
  one food buff is active at a time.
- The recipe language is intentionally learnable without a wiki: each recipe has
  only two or three ingredients, its station states its purpose, and ingredient
  families point back to a place (fields feed hearth/alembic, forest feeds
  wood/leather cooking and forge work, shore feeds salt/fish/salvage). There are no
  hidden intermediate-component trees. The crafting screen previews exact costs and
  the result before confirmation. Tinker's Thrift visibly reduces each common
  ingredient by one (minimum one), rather than hiding the saving in an end-of-craft
  roll.
- Surface gathering nodes regrow after five minutes of simulation time. A harvested
  node's cooldown and first-harvest bit are deterministic saved state; Forager's Eye
  adds one item at the node and supplies the presentation shimmer, so its value is
  immediate and legible. Catacomb nodes append to the same stable vocabulary in M4.
- Crafted gear is **Fine** and receives exactly one seeded, slot-eligible affix;
  Exceptional gear remains a loot chase and Mythic gear remains boss/quest-only. The
  slice's Mythic **Warden's Echo** focus has one immediately legible unique property:
  ember, frost, and aether spells all receive its resonance bonus, so the boss reward
  invites mixed-channel loadouts without adding another meter or proc rule.
  Resonant Focus crafting asks for one plain-language choice — ember, frost, or
  aether — and shows the affected spell channel. Its pre-boss recipe uses dimstone ore,
  relic fragments, and emberpetal; the Mythic catalyst core remains a boss reward and is
  not a prerequisite for the stage-4 craft. Weapons, armor, shield, and catalyst
  each have one equipped slot that may be empty, while materials and consumables stack. This keeps the
  loadout readable even when the affix combinations become interesting.
- Single currency: **marks** *(working name)*; starting purse 25. Price bands
  (static data for the slice — a dynamic economy is explicitly out of scope):
  reagents 1–4, tonics/food 8–15, base weapons and armor 30–60, Fine gear 80–150;
  vendors buy back at half price (floor). The station NPCs plus one general trader at
  the docks hold stock.
- The starter satchel includes one Hearthloaf. It makes food preparation discoverable
  through use instead of tutorial prose, while the 25-mark purse still forces an
  early choice rather than funding a full loadout.
- Vendor offers are static and do not secretly deplete or reprice. Every offer shows
  buy price and the universal half-price (floored) sell value; materials and
  consumables sell singly, while equipped and Mythic gear cannot be sold. Scarcity
  comes from authored gathering/loot access and recipe choices, not from an opaque
  market simulation. No recipe whose complete input is vendor-stocked may sell for
  more than those inputs cost, including after Tinker's Thrift. In particular, salvage
  iron is gathered or looted rather than vendor-sold, so buying inputs cannot fund a
  repeatable forge-profit loop.
- Loot: containers and monster drops from seeded deterministic tables on the `loot`
  stream; rarity tiers **Common / Fine / Exceptional / Mythic**. Found and crafted
  gear carries **0–2 affixes** gated by rarity (Common 0, Fine 1, Exceptional 2,
  Mythic 2 plus an authored unique property — boss/quest loot only) from the bounded
  list: **Keen** (+1 accuracy), **Weighted** (+2 damage), **Bulwark** (+1 guard),
  **Attuned** (+1 spell potency), **Emberbound** / **Frostbound** (+3 of that channel
  on hit), **Venombound** (+2 venom; Envenomed on keen), **Light** (the item's
  stamina costs ×3/4) — plus a bounded **conditional** pair, on Exceptional and
  Mythic gear only, that changes decisions rather than numbers: **Bracing** (a
  caught block restores 10 Stamina) and **Nimble** (a dodge whose avoidance frames
  beat an attack grants +2 accuracy for 120t). Affix scope and aggregation are
  fixed: each affix names its eligible slots — Keen, Weighted, Emberbound,
  Frostbound, and Venombound roll on weapons and apply only to attacks made with
  that weapon; Light rolls on weapons and shields (that item's stamina costs);
  Attuned rolls on catalysts; Bulwark and Bracing roll on armor and shields; Nimble
  rolls on armor. Affixes never stack across equipped items: at most one equipped
  copy of a given affix is active (duplicates are inert), a caught block triggers
  Bracing once, and re-triggering Nimble resets its 120t window rather than
  extending or stacking it. A new flat affix is a content add; a new affix
  *mechanic*, trigger, or aggregation rule is a design change.
- Loot never silently disappears at inventory limits. Material overflow auto-salvages
  into its half-price marks value (minimum one mark per excess item), ordinary gear
  overflow auto-salvages at half price, and guaranteed Mythic loot replaces the
  lowest-preservation-priority unequipped item while paying its sell value and naming
  the displacement. The order is non-unique before unique, Common before Fine before
  Exceptional before Mythic, fewer upgrades before more, lower base price, then newest
  serial as the deterministic tie-breaker.

### Death — respawn with a recoverable cost

- **Waystones** *(working name)* are explicitly tagged world landmarks (village square, castle gate, forest
  edge, each catacomb entrance) are rest and respawn anchors; resting restores pools
  and sets the respawn point.
- On defeat the player wakes at the last waystone; a **satchel** holding carried loose
  materials (never equipped gear or quest items) drops at the fall site and persists
  until recovered. A second death replaces it — one satchel in the world at a time.
  Local aggro resets; no world-time or XP penalty.

### Bestiary (slice)

Six archetypes chosen for AI/animation variety, not volume *(all working names)*.
Monster kits use the same action and resolution model as players, but their ratings
are **authored flat**, not derived from attributes: the table gives each archetype's
accuracy, guard, and resist ratings directly, and attack damage is the final raw
value (no scaling attribute) in the **physical** channel unless another channel is
named. Check type is per-attack: weapon-type attacks check accuracy vs. guard
whatever their damage channel (the skitterling's venom bite is still accuracy vs.
guard); spell-type attacks — marked with an inline potency rating — check potency
vs. resist. Exposed lowers guard only, so an armored kit can still be authored
spell-soft (the hollow warden is). Attacks tagged *fast* use the 24-tick wind-up
floor. Soak is physical/elemental. **At-level** is the sweep level the balancer
treats this archetype as tuned for.

D-166 makes the Behavior column executable through `game/balance/creature-ai.ts`; the
authoritative perception/leash/tactic values live there and district pack placement
lives in `game/world/creature-spawns.ts`. Wayland brigands have 70 Stamina for their
player-model block/dodge defense. Those are tunables within the behaviors below, not a
second ruleset. Monster body and locomotion requirements remain inputs to M5's
character/animation pipeline even while M3.5 uses capsules.

Encounter readability is also profile-driven: creatures turn at authored rates and
must face the player before committing an attack; each deterministic encounter group
caps concurrent wind-up/active attackers; and authored spawn rank gives flanking
members stable, opposite-first angles that do not reshuffle when a packmate falls.
The boss and its bounded clutch share one encounter group even though the summons are
spawned later. Phase-3 vents publish a one-second warning before applying Burning, and
a depleted fleeing pack cannot re-aggro merely because the player camps its home.

| Archetype | HP | Acc/Guard/Res | Soak | Attacks (raw, wind-up/active/recovery) | At-level | XP | Behavior |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Burrow-gnawer** (field vermin, chaff) | 24 | 3/2/3 | 0/0 | bite 6 (24/4/16, *fast*) | 2 | 5 | Swarms of 3–6; pack flees below 2 |
| **Greymaw** (forest pack predator) | 70 | 4/3/6 | 1/0 | lunge 12 (30/6/24), pounce 16 (40/6/30) | 5 | 15 | Packs of 2–4 circle and flank |
| **Wayland brigand** (humanoid) | 90 | 5/3/6 | 2/1 | sword 12 (30/6/20) | 5 | 20 | Blocks (+6 guard while up) and dodges on the player action model; fights *and* talks — parleyable before aggro, may yield below 25% HP (the dialog/combat seam) |
| **Skitterling** (catacomb swarm, chaff) | 40 | 5/4/8 | 0/1 | bite 4 venom + Envenomed on keen (24/4/12, *fast*) | 8 | 4 | Clutches of 4–8 from nests; drops skitterling venom (alembic reagent) |
| **Hollow warden** (elite catacomb sentinel) | 800 | 6/8/7 | 6/4 | maul 20 (44/8/60), slam 26 + Stagger (54/10/70) | 8 | 60 | Immune to Staggered; a dodged slam or 40+ damage within 120t applies Exposed for 240t — the intended opening; guard-heavy but spell-softer (resist 7 under guard 8); long recoveries are the attack windows |
| **The Warden Below** (slice boss) | 3000 | 7/7/9 | 6/6 | maul 18 (44/8/70), slam 22 + Stagger (54/10/80), aether lance 14 aether, spell-type, potency 7, ranged 12 m on a ≥5 s cooldown (60/2/70) | 10 | 400 | Three phases: warden kit → at 66% summons skitterling clutches, pillars give lance cover → at 33% enrage (recoveries ×3/4, never shorter wind-ups) plus arena-edge ember vents (Burning zones); shares the warden's break opening |

Drop tables per archetype live in `game/balance/` loot data: hides, pelts, sinew,
venom sacs, relic fragments, marks, and rarity-gated gear; the boss drops a Mythic
catalyst core plus the main-arc quest item.

### Quests and journal

- Quest state machines are data: stages with typed objectives (reach / collect /
  defeat / talk / craft / deliver), advanced **only** by semantic sim events (the
  D-141 event stream). LLM dialog can surface, flavor, and hand out quests, but a
  state transition happens only through a validated structured intent (D-074) —
  free-form model text never mutates quest state.
- Main arc *(working title: "The Undercroft Stirs")*, six stages engineered so the
  middle stages each use a **different** catacomb entrance, driving repeated D1↔D2
  transitions (M4's exercise): **1. Signs in the Fields** — gnawed crop cellars and a
  collapsed tunnel (reach / collect / talk); **2. The Sealed Door** — the village
  entrance stands opened from below; first descent (defeat); **3. Words with the
  Wardens** — recover a relic fragment from the newly hostile hollow wardens and
  surface via the castle entrance (defeat / collect); **4. The Apothecary's Ask** —
  craft a Clearing Draught and a Resonant Focus to withstand the deep vents,
  gathering across fields, shore, and forest (craft / collect), with an *optional*
  objective: brew spare Clearing Draughts and douse the arena vents with them on an
  early descent — the existing recipe put to a second use, not a new item; **5. The Forest
  Throat** — brigands are looting the disturbed vaults under the forest entrance
  (defeat, or parley via validated dialog intent); **6. The Warden Below** — the boss,
  and a sealing choice epilogue at the castle (defeat / talk).
- **Eight side quests**, each tagged to the system it exercises: A Bounty of Teeth
  (gnawer cull — combat), The Greymaw Alpha (elite hunt — pack AI), The Smith's
  Commission (craft a tempered weapon — forge), Cold Larder (fisher's stew chain —
  hearth/shore), First Fruits (harvest and deliver — gathering/economy), The
  Reluctant Witness (persuade a dock salvager — LLM dialog with validated intent),
  Relics for the Reliquary (fragment collection — catacomb loop), The Painter of the
  Vista (reach three viewpoints — streaming world/exploration).
- **Preparation changes encounters** — deterministically, through quest flags
  consumed as encounter data (never LLM output): stage 4's *optional* vent-dousing
  with spare Clearing Draughts quenches the boss's phase-3 ember vents (the
  mandatory draught work only
  makes them survivable, so the authored vent mechanic stays reachable in every
  playthrough that skips the option); a successful stage-5 parley clears the forest
  entrance of brigand ambushes; completing Relics for the Reliquary records the
  hollow wardens' Exposed opening and spell-softness in the journal. Bounded to
  authored hooks: a new hook is a content add, a new consequence *type* is a design
  change.
- The journal is the append-only, save-schema-versioned play-history log — the same
  stream that feeds Summarizer recaps and localization. D-171 implements the canonical
  quest-beat and landmark-discovery history, with stable localization keys and bounded
  pagination; presentation and Summarizer consumption remain separate consumers.

### Balance validation — the headless balancer (D-165)

M3.5's "iterative balancing" is a measured check, not vibes. Because the sim is
deterministic, worker-pure TypeScript, combat runs **headless in Node at far faster
than real time** — no browser, no renderer. The balancer is built
(`game/src/balance/headless-balancer.ts`) and runs in the ordinary unit gate; it is
the fast inner loop, and the separate harness gameplay scenario (M3.5 exit) is the
physical outer proof in the real runtime. The values in this section reflect its
first converged tuning pass: skitterling, warden, and boss stat blocks, catalyst
potencies, and elite/boss recovery windows were all retuned by band violations.

- **Sweep:** three reference loadouts (a martial, a caster, a hybrid — defined in
  `game/balance/` data) × levels {2, 5, 8, 10} with level-appropriate reference gear
  × every bestiary archetype (boss at level 10 only), driven by simple scripted
  rotation policies (no LLM anywhere near it). A fixed root seed deterministically
  derives ~32 seeds per matchup. A matchup is **at-level** when the sweep level
  equals the archetype's bestiary *At-level* value; higher is overlevel, lower is
  underlevel.
- **Asserted bands** (tuning moves the numbers *within* bands freely; band changes
  are ordinary tuning unless structural). At each archetype's at-level matchup:
  player **baseline** offensive hit chance 70–85% against chaff and commons, where
  baseline means the unmodified check — no conditions on either side, no affix
  triggers, no ability/stance modifiers (elite/boss baseline hit chance is
  unasserted — their Exposed openings are the intended lane); monster baseline
  offensive hit chance 45–65%; modified checks (Exposed targets, Nimble windows,
  stance bonuses) are *supposed* to exceed the band — that reward is tracked by the
  opening-exploitation proxy, never asserted against the baseline bands; TTK 4–8 landed hits for commons (greymaws, brigands)
  and 2–3 for chaff (gnawers, skitterlings); survivability per reference loadout
  with **both bounds asserted each** so overtanky builds fail too — martial 6–10
  common hits, hybrid 5–9, caster 4–7 (build identity comes from different
  envelopes, not one shared band); win rate vs. commons and chaff ≥95%; elite
  duration 30–90 s. Boss (level 10): duration 180–420 s, win rate 40–80% across the
  reference builds. Overlevel matchups assert only the ≥95% win rate; underlevel
  matchups run as report-only diagnostics. The XP ledger for the scripted slice
  completion lands level 9–10.
- **Output:** a diffable per-matchup report (win rate, TTK distribution, damage by
  channel, resource pressure) so a tuning change shows its blast radius; band
  violations fail the ordinary unit gate. Balance regressions become visible the same
  way replay-hash regressions do. The report also carries **engagement proxies**,
  report-only: time spent resource-starved, action-use distribution, damage share by
  ability, rotation dominance across seeds, and measured benefit from condition
  interactions and Exposed openings. TTK and win rate can pass while the optimal
  rotation is degenerate — these are the instruments that catch it. Promoting a
  proxy to an asserted band takes a decision entry, after real runs show where it
  sits.

The seeded-duel sweep cannot validate group-only behavior. The recurring deterministic
`creature-engagement-fixture.ts` therefore drives four concurrent gnawers in the
ordinary unit gate and records attack starts, slot-wait ticks, an active-attacker
histogram, overlap ticks, and the concurrent-attacker high-water. It asserts both
readable pressure (real overlap) and the authored two-attacker ceiling; it complements
the duel bands rather than pretending they measure pack coordination.

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

The rendering/art quality target is **AAA-quality, photorealistic movie-style visuals**
(human clarification, 2026-09-05). Bright saturation and readability describe the
lighting/color direction, not cartoon proportions or toy-like materials. The first
[courtyard reference](../assets/reference/d1-courtyard.md) is the human-endorsed quality
benchmark; implemented assets must earn acceptance through actual in-game inspection.

## Weather, time, and light

D-182 proves this direction first in one finished D1 courtyard/street with a castle
silhouette, a rigged NPC and enemy, and a playable route to a catacomb entrance. Sunny
and gloomy references govern the same kit. Judge composition, materials, animation,
encounter readability, and sound together in moving gameplay. Expand the accepted kit
across D1 in M5; additional character techniques or effect variants enter only for a
chosen visual deficiency or showcase. This sequencing does not change the world layout,
ruleset, required body-type variety at district scale, or dynamic-lighting direction.

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
8. **Rules math is integer-only** (D-165). All rules resolution — ratings, damage,
   pools, durations, regeneration accumulators — uses integer arithmetic with
   floor-division rational multipliers; floats never enter rules state. This keeps
   same-host replay hashing trivially stable and removes floating-point divergence as
   a risk for future cross-machine replay (features.md M7 constraint 3).
