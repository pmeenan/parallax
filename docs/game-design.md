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
feature).

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
dispenser." This is a demo headline if it lands (and a Prompt API quality finding
either way). Full indistinguishability gets a real test only when multiplayer (M7)
brings actual humans in; until then the bar is "NPCs don't feel like vending machines."

## Design implications (binding on architecture/plan)

1. **Dynamic lighting is mandatory.** Day/night + weather rules out a fully-baked
   lighting approach; the renderer must be designed around dynamic time-of-day from M1
   greybox onward. This also sharpens P-002: the Gaussian-splat branch must be evaluated
   under *dynamic relighting*, its weakest axis — splats may end up confined to
   lighting-stable contexts (e.g., catacomb set dressing) if relighting doesn't pan out.
2. **Multiple D1↔D2 transitions.** The catacombs' multiple entrances mean the
   transition system handles N choke points with different surface contexts, not one
   bespoke elevator. The transition contract (budgets.md) applies per entrance.
3. **Weather × streaming interaction.** Weather and time-of-day multiply the PSO/variant
   surface and change what "representative content" means for the M1 spike and harness
   flythroughs — standard runs must sweep lighting/weather states, not just geography.
4. **Crafting/inventory/loot** imply an item/economy data model in the sim from M3
   (serializable, sim-worker-owned, save-schema versioned — same constraints as all sim
   state).
5. **Races and monsters** set the bar for the character pipeline (M5): multiple rigged,
   animated body types, not one hero mesh.
