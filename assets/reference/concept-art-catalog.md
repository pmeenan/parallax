# Concept-art target catalog

**Status: initial inventory prepared, 2026-09-05; no new artwork generated.**
The [endorsed courtyard](d1-courtyard.md) remains the quality anchor. This catalog
turns the [concept-art program](concept-art-program.md) into individually named
generation targets. There is **no total image cap or fixed number of batches**.
Each target can require multiple alternatives, views, states, detail sheets and
temporal boards. Add or split targets when coverage needs it; do not trim unresolved
requirements to meet a count.

## Reading and maintaining the catalog

IDs are permanent: append new IDs without renumbering old ones. Each row plus its
source and output profile below constitutes an initial brief. Status progresses from
**missing → draft → selected → approved**, with rejected alternatives retained in
the target record. Human artistic selection is required; agent curation is not
approval. Concept approval is separate from runtime acceptance and rights clearance.
Earlier material experiments do not automatically satisfy these new targets.

Priority means **generation order**, independently of implementation scope:

- **P0:** select the shared direction before dependent art.
- **P1:** first courtyard, kit, characters, lighting and playable-route references.
- **P2:** remaining authored world, gameplay, characters and content.
- **P3:** deferred research and exploratory presentation/physics references.

Scope **C** means current authored game or committed art/content plan, including
later milestones; it does not mean implemented or required at M4.5 exit. **D**
means deferred, explored or unselected implementation. Exclusions are reconciled
at the end. Broad reference coverage does not promote deferred engine work.

### Source key

Each row's Source field links through this table to its design authority. Where a
row elaborates a broad family, its specifics are proposals for artistic selection,
not newly authored lore, geography or mechanics.

| Key | Source |
| --- | --- |
| AD | [Art direction](../../docs/game-design.md#art-direction) and [courtyard kit](d1-courtyard-kit.md) |
| D1 | [Setting](../../docs/game-design.md#setting) and [D1 layout](../../docs/game-design.md#d1-greybox-scale-and-layout-d-090) |
| D2 | [D2 layout and paired entrances](../../docs/game-design.md#d2-greybox-scale-and-layout-d-174) |
| CO | [Combat](../../docs/game-design.md#combat--deliberate-real-time) |
| RC | [Damage channels, statuses and interactions](../../docs/game-design.md#resolution-core) |
| MA | [Aetherwork](../../docs/game-design.md#magic--aetherwork) |
| AB | [Abilities and playable folk](../../docs/game-design.md#progression--classless-loadout-driven) |
| IT | [Items, recipes, gathering, affixes and economy](../../docs/game-design.md#crafting-gathering-economy--slice-depth) |
| DE | [Waystones, defeat and satchel](../../docs/game-design.md#death--respawn-with-a-recoverable-cost) |
| BE | [Bestiary and boss phases](../../docs/game-design.md#bestiary-slice) |
| QU | [Quests and journal](../../docs/game-design.md#quests-and-journal) |
| NP | [Characters and NPCs](../../docs/game-design.md#characters-and-npcs) |
| WL | [Weather, time and light](../../docs/game-design.md#weather-time-and-light) |
| FM | [Feature matrix](../../docs/features.md#matrix) |
| WEB | [Web-native ambitions](../../docs/features.md#beyond-aaa-features-even-native-aaa-titles-dont-usually-ship) |
| RB | [Rendering research backlog](../../docs/plan.md#rendering-research-backlog--promote-only-for-a-named-need) |
| PR | [Concept and behavior reference program](concept-art-program.md) |

### Output profiles and acceptance

Profiles apply in full to each row. The Particulars column adds requirements.
These are observable appearance/behavior targets, not prescriptions for rendering algorithms.

| Profile | Required views, states and review criteria |
| --- | --- |
| DIR | Distinct alternatives, palette/material relationships and eye-level examples; critique against courtyard anchor, then select a coherent family. |
| ENV | Establishing, playable eye-level and construction/detail views; matched sunny/gloomy exterior geometry. Underground uses low ambient/torch/magic comparisons and surface threshold context. Preserve authored layout, metric scale cues and clear traversal. |
| KIT | Neutral front/side/back or top as useful, metric scale cue, construction joints, edge/wear details and assembled context under sunny/gloomy light (interior equivalents underground). Unspecified dimensions are proposals; use existing kit dimensions where supplied. |
| MAT | Neutral surface appearance, close/grazing and walking-distance application; dry/wet and sunny/gloomy response. Broad variation and credible contact without uniform noise. Not calibrated PBR maps. |
| CHAR | Silhouette alternatives, front/side/back, human scale comparison, face/expression/equipment detail, idle/locomotion/combat poses and daylight/overcast/interior readability. Anatomy and costume must agree across views. |
| LIGHT | Same camera/geometry/materials across named light states; near contact and distant detail, exposure notes and planned moving-camera comparison. No geometry changes disguised as relighting. |
| FX | Timestamped anticipation/onset/peak/decay/residue board; close/combat/far views, bright/dark backgrounds, overlap with characters/other effects. Check current authored timing/range when briefing; otherwise label timing proposed. Include motion-reference acquisition notes where behavior needs grounding. |
| MOT | Timestamped motion/contact board and motion-reference acquisition brief: scale, initial conditions, path, contact, settling, visible failure cases. Footage/data required before claiming physical grounding; numeric tolerances provisional unless sourced or explicitly designed. |
| UI | Gameplay-size layouts over bright/dark/busy/effects-heavy scenes; focus/selection/error and scaled-text variants where applicable. Intended text supplied separately from generated typography. |

Every missing target initially has **no artifacts**, **no generated provenance**,
**rights pending**, **camera/scale to record**, and **motion sources missing** where
needed. On first generation create a linked record at
`assets/reference/targets/<ID>.md` containing:

- Exact prompt, provider/model and seed when exposed, input-image lineage.
- Output paths and hashes, alternatives, source/rights notes and review status.
- Camera/framing, scale and lighting; distinguish known values from inferred settings.
- Must-fix defects, critique, selection feedback and remaining views/states.
- FX/MOT timing, reference footage, test conditions and grounded versus proposed values.

Do not create empty record files for every target. Commit image originals and
contact sheets in git under `assets/reference/` (D-188); record hashes in the target
record. Motion footage and other third-party sources follow their own rights and size
handling. Source images cannot silently become shipping textures. Missing motion
footage is not satisfied by generated frame sequences.

## Direction and shared visual language

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DIR-001 | Existing courtyard quality anchor | P0 | C | AD | DIR | Existing image/provenance in d1-courtyard.md; endorsement is quality only, not metric layout or rights clearance | Endorsed anchor; rights pending |
| DIR-002 | Coastal village world direction | P0 | C | AD,D1 | DIR | Distinct coherent alternatives using the courtyard's warm materials and credible lived-in construction | Missing |
| DIR-003 | Castle and village architectural relationship | P0 | C | D1 | DIR | Hill, complete moat and village outside footprint; near skyline and distant silhouette | Missing |
| DIR-004 | Catacomb visual language | P0 | C | D2 | DIR | Passage/arena construction alternatives; historical layering is proposed interpretation | Missing |
| DIR-005 | World palette and material hierarchy | P0 | C | AD | DIR | Village/fields/forest/shore/underground palette in bright and gloomy states | Missing |
| DIR-006 | Playable folk and costume language | P0 | C | AB | DIR | Human/Skarn/Wickfolk lineup with everyday and equipped silhouettes | Missing |
| DIR-007 | Creature family and threat hierarchy | P0 | C | BE | DIR | All six archetypes at comparative scale; distinguish elite and boss | Missing |
| DIR-008 | Aetherwork and alchemy language | P0 | C | MA,RC | DIR | Five damage channels, crafted catalysts and restrained emissive accents | Missing |
| DIR-009 | Interface visual language | P0 | C | FM | DIR,UI | Readable hierarchy and restrained world overlay | Missing |

## D1 environments and landmarks

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ENV-001 | Courtyard from playable route | P1 | C | AD,D1 | ENV | Well, castle silhouette and clear lane; do not move authored features to imitate anchor | Missing |
| ENV-002 | Courtyard reverse and side views | P1 | C | AD | ENV | Same selected courtyard; resolve unseen construction consistently | Missing |
| ENV-003 | Courtyard-to-village lane | P1 | C | D1 | ENV | Walking sequence, paving transitions and continuous sightlines | Missing |
| ENV-004 | Village square and waystone | P2 | C | D1,DE | ENV | Rest landmark and everyday NPC activity | Missing |
| ENV-005 | Residential street assembly | P2 | C | D1 | ENV | Reusable house variations, alleys and clear entrances | Missing |
| ENV-006 | Forge frontage and work area | P2 | C | IT | ENV | NPC station, hot work and pedestrian separation | Missing |
| ENV-007 | Apothecary and alembic work area | P2 | C | IT,QU | ENV | Reagent storage and crafted science | Missing |
| ENV-008 | Hearth and food preparation area | P2 | C | IT | ENV | Utensils, fuel and working room | Missing |
| ENV-009 | Dock trader and salvager setting | P2 | C | IT,QU | ENV | Fish/salt/salvage economy and dialogue framing | Missing |
| ENV-010 | Village gates and field approach | P2 | C | D1 | ENV | Terrain transition and castle orientation | Missing |
| ENV-011 | Castle distant silhouette | P1 | C | D1 | ENV | Village/field/forest/shore viewpoints, existing hill/moat footprint | Missing |
| ENV-012 | Castle gate and waystone approach | P2 | C | D1,DE | ENV | Arrival route, moat crossing and gate clearance | Missing |
| ENV-013 | Moat banks and crossing | P2 | C | D1 | ENV | Bank construction, bridge scale and waterline; simulation remains deferred | Missing |
| ENV-014 | Castle approach to undercroft | P2 | C | D1,D2 | ENV | Route-supporting interior only, no invented playable wing | Missing |
| ENV-015 | Fields and crop lanes | P2 | C | D1,IT | ENV | Harvestable grain/herbs within coherent field pattern | Missing |
| ENV-016 | Gnawed crop cellar and collapsed tunnel | P2 | C | QU | ENV | Signs in the Fields evidence; static collapse, not destruction | Missing |
| ENV-017 | Forest edge and waystone | P2 | C | D1,DE | ENV | Fields transition and navigable opening | Missing |
| ENV-018 | Forest path and clearing | P2 | C | D1,BE | ENV | Greymaw circling/flank space and roots/ground contact | Missing |
| ENV-019 | Forest ruins and brigand approach | P2 | C | D1,QU | ENV | Loot site; parley and ambush readability | Missing |
| ENV-020 | South shoreline | P2 | C | D1,IT | ENV | Beach/rock/tide-edge assembly and gathering | Missing |
| ENV-021 | Coastal docks and fishing edge | P2 | C | IT | ENV | Supported dock and working shore; no transport system | Missing |
| ENV-022 | Mountain vista and atmospheric layers | P2 | C | D1 | ENV | Distant nonplayable mountains, coastline and castle orientation | Missing |
| ENV-023 | Village-to-fields panoramic vista | P2 | C | D1,QU | ENV | Painter viewpoint candidate; authored landmark coordinates govern framing | Missing |
| ENV-024 | Forest-to-castle panoramic vista | P2 | C | D1,QU | ENV | Second viewpoint candidate, canopy and distant silhouette | Missing |
| ENV-025 | Shore-to-world panoramic vista | P2 | C | D1,QU | ENV | Third viewpoint candidate, no new discovery coordinates | Missing |
| ENV-026 | Finished five-minute route continuity | P1 | C | FM,D1,D2 | ENV | Courtyard/NPC/encounter/entrance sequence with common scale and kit | Missing |
| ENV-027 | Village crowd and schedule composition | P2 | C | NP,FM | ENV | Working/resting/traversing NPCs, clear navigation and dialogue | Missing |

## D2 and all three transition pairs

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UND-001 | Village-well entrance, surface side | P1 | C | D2 | ENV | Existing transition well accessible; decorative courtyard well does not create an edge | Missing |
| UND-002 | Village passage arrival, underground side | P1 | C | D2 | ENV | Pair with UND-001, arrival heading and return legibility | Missing |
| UND-003 | Castle-undercroft entrance, surface side | P2 | C | D2 | ENV | Undercroft context and full occlusion | Missing |
| UND-004 | Castle passage arrival, underground side | P2 | C | D2 | ENV | Pair with UND-003, construction continuity | Missing |
| UND-005 | Forest-ruin entrance, surface side | P2 | C | D2 | ENV | Vegetation/ruin threshold and clear movement | Missing |
| UND-006 | Bent forest passage arrival, underground side | P2 | C | D2 | ENV | Pair with UND-005, retain bend and occlusion | Missing |
| UND-007 | Catacomb passage assembly | P2 | C | D2 | ENV | Floor/wall/vault joins and narrow-route readability | Missing |
| UND-008 | Catacomb chamber assembly | P2 | C | D2 | ENV | Room variations within authored traversable cells | Missing |
| UND-009 | Warden sentinel encounter space | P2 | C | D2,BE | ENV | Maul/slam clearance and Exposed opening | Missing |
| UND-010 | Skitterling nest area | P2 | C | BE | ENV | Clutch emergence, venom gathering and small-body visibility | Missing |
| UND-011 | Relic and dimstone gathering context | P2 | C | IT,QU | ENV | Readable nodes without blanket emissive walls | Missing |
| UND-012 | Warden Below arena establishing view | P2 | C | D2,BE | ENV | Authored four-cell arena, cover pillars and edge vents | Missing |
| UND-013 | Arena combat views, three phases | P2 | C | BE | ENV | Same geometry across clutch/vent states, readable safe space | Missing |
| UND-014 | Arena after optional vent preparation | P2 | C | QU | ENV,FX | Active versus quenched vents, no arena redesign | Missing |
| UND-015 | Three entrance lighting transitions | P1 | C | D2,WL | LIGHT | Day/gloom/night to underground and return, full occlusion and no pop | Missing |

## Architecture and reusable props

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KIT-001 | Limestone paving assembly | P1 | C | AD | KIT | 4 m patch, broken courses, infill, buried shoulders, earthy joints and sparse plants | Missing |
| KIT-002 | Paving stone shape family | P1 | C | AD | KIT | Broad calm tops, localized chips, varied outlines; avoid pillows and uniform slabs | Missing |
| KIT-003 | Paving slope and edge assembly | P1 | C | AD | KIT | Walking/grazing/top; rigid stones and continuous substrate, no floating plants | Missing |
| KIT-004 | Courtyard well construction | P1 | C | AD | KIT | Rim/interior/base and bonds; proposed 2 m diameter and 1 m rim cue | Missing |
| KIT-005 | Plaster wall bays | P1 | C | AD | KIT | Plain/window/door variants on existing 2 m by 3 m bay | Missing |
| KIT-006 | Oak posts, beams and braces | P1 | C | AD | KIT | Joined frame, end grain and corner ownership | Missing |
| KIT-007 | Limestone plinths and foundations | P1 | C | AD | KIT | Slope fit, corners, plaster contact and damp edge | Missing |
| KIT-008 | Terracotta roof, ridge and eaves | P1 | C | AD | KIT | Existing 40-degree pitch, end caps, overlaps and drainage | Missing |
| KIT-009 | Doors, thresholds and fittings | P1 | C | AD | KIT | 1 m by 2.25 m clear opening, hinges/latch/open state | Missing |
| KIT-010 | Windows, shutters and reveals | P1 | C | AD | KIT | Inside/outside agreement, open/closed and glass interpretation | Missing |
| KIT-011 | Low garden walls and coping | P1 | C | AD | KIT | Corners, terminals and planting contact | Missing |
| KIT-012 | Stone stairs and landings | P2 | C | D1,D2 | KIT | Rise/run cues and credible foot placement | Missing |
| KIT-013 | Timber stairs, rails and platforms | P2 | C | D1 | KIT | Supported joints and traversable clearance | Missing |
| KIT-014 | Castle wall, tower and battlement kit | P2 | C | D1 | KIT | Near construction and far silhouette variation | Missing |
| KIT-015 | Castle gate and bridge components | P2 | C | D1 | KIT | Select supported construction before detailing | Missing |
| KIT-016 | Catacomb walls, vaults and arches | P2 | C | D2 | KIT | Ceiling junctions, corners and restrained static damage | Missing |
| KIT-017 | Catacomb floors and stairs | P2 | C | D2 | KIT | Worn paths and readable height changes | Missing |
| KIT-018 | Arena pillars and ember vents | P2 | C | BE | KIT | Cover silhouette and vent opening, intact geometry across phases | Missing |
| KIT-019 | Forest ruin masonry | P2 | C | D1 | KIT | Standing/broken pieces and roots, static damage only | Missing |
| KIT-020 | Dock decking and pilings | P2 | C | IT | KIT | Wet/dry/submerged zones and supported planks | Missing |
| KIT-021 | Fences and field gates | P2 | C | D1 | KIT | Posts/ends/corners and track crossings | Missing |
| KIT-022 | Forge station | P2 | C | IT | KIT | Hearth, anvil, bellows, tongs and work clearance | Missing |
| KIT-023 | Alembic station | P2 | C | IT,MA | KIT | Vessels, tubing, heat source and reagent preparation | Missing |
| KIT-024 | Hearth station | P2 | C | IT | KIT | Pot support, utensils, fuel and working posture | Missing |
| KIT-025 | Market and trader furniture | P2 | C | IT | KIT | Counter, stock display and interaction clearance | Missing |
| KIT-026 | Everyday furniture kit | P2 | C | PR,NP | KIT | Table/chair/bench/shelf/bed proposals, no new playable interiors | Missing |
| KIT-027 | Containers and loose stores | P2 | C | IT | KIT | Crate/barrel/basket/sack, lids and loot-open states | Missing |
| KIT-028 | Gathering and workshop tools | P2 | C | IT | KIT | Harvest/mining/woodwork/fishing, grip and scale | Missing |
| KIT-029 | Torch, lantern and brazier fixtures | P1 | C | WL | KIT | Fuel/support/glass when selected, lit and extinguished | Missing |
| KIT-030 | Waystone family | P2 | C | DE | KIT | Village/gate/forest/entrance contexts and rest states | Missing |
| KIT-031 | Dropped material satchel | P2 | C | DE | KIT | Closed/open and grounded recoverable silhouette | Missing |
| KIT-032 | Relics and boss catalyst core | P2 | C | BE,QU | KIT | Fragments, Mythic core and quest-item alternatives; distinct identities | Missing |
| KIT-033 | Village signs and wayfinding | P2 | C | PR,IT | KIT | Original station/route symbols, no new faction semantics | Missing |
| KIT-034 | Environmental story dressing | P2 | C | QU | KIT | Gnaw marks, looted stores, abandoned tools, sealed/opened-door evidence | Missing |

## Materials and surface assembly

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MAT-001 | Cream worn limestone | P1 | C | AD | MAT | Courtyard baseline, calm faces and localized pits | Missing |
| MAT-002 | Buff limestone | P2 | C | PR | MAT | Restrained palette variant beside cream | Missing |
| MAT-003 | Red limestone candidate | P2 | C | PR | MAT | Select appropriate context, not world-wide replacement | Missing |
| MAT-004 | Gray limestone candidate | P2 | C | PR | MAT | Separate stone color from gloomy lighting | Missing |
| MAT-005 | Castle dressed and rough stone | P2 | C | D1 | MAT | Block/mortar scale and distant pattern | Missing |
| MAT-006 | Catacomb stone and damp masonry | P2 | C | D2 | MAT | Deposits, moisture and worn paths | Missing |
| MAT-007 | Forest and shoreline rock | P2 | C | D1 | MAT | Natural fracture/erosion, distinct from quarry paving | Missing |
| MAT-008 | Cream lime plaster | P1 | C | AD | MAT | Thickness, patching and timber contact | Missing |
| MAT-009 | Dark structural oak | P1 | C | AD | MAT | Grain direction, end grain, joints and worn edges | Missing |
| MAT-010 | Weathered boards and dock timber | P2 | C | D1 | MAT | Splits, grain scale and salt/water line | Missing |
| MAT-011 | Terracotta tile | P1 | C | AD | MAT | Face/edge/section, kiln variation and restrained moss | Missing |
| MAT-012 | Brick, clay and straw studies | P3 | D | RB | MAT | Separate samples and proposed assembly; no mandatory new kit | Missing |
| MAT-013 | Forged iron and rust | P1 | C | AD,IT | MAT | Worked/handled/worn areas, no plastic highlights | Missing |
| MAT-014 | Weapon steel and armor scale | P2 | C | IT | MAT | Polished/worked areas and overlap | Missing |
| MAT-015 | Alchemy glaze, glass and crystal | P2 | C | MA,IT | MAT | Thickness, transmission and crafted joins | Missing |
| MAT-016 | Cloth weave and seams | P2 | C | IT,AB | MAT | Garment-distance weave, folds and stitching | Missing |
| MAT-017 | Leather and hide | P2 | C | IT | MAT | Stretched/folded/worn, straps and seams | Missing |
| MAT-018 | Paving joint soil and aggregate | P1 | C | AD | MAT | Recessed discontinuous joints, avoid pale uniform grout | Missing |
| MAT-019 | Packed soil and field earth | P2 | C | D1 | MAT | Compacted path versus tilled crop bed | Missing |
| MAT-020 | Gravel and soil-to-stone transitions | P2 | C | D1 | MAT | Size distribution and burial, no floating scatter | Missing |
| MAT-021 | Mud and footprints | P3 | D | RB | MAT,MOT | Dry/damp/saturated and cosmetic deformation | Missing |
| MAT-022 | Shore sand and salt deposits | P2 | C | D1,IT | MAT | Tide edge, packed/loose and gathering deposits | Missing |
| MAT-023 | Moss, lichen and wear dressing | P2 | C | AD,RB | MAT | Moisture/exposure placement, avoid uniform noise | Missing |
| MAT-024 | Snow blending study | P3 | D | RB | MAT | Coverage/melt/contact; not a new snow biome | Missing |
| MAT-025 | Large-area material repetition | P2 | C | FM | MAT | Street/forest/courtyard near/mid/far, no obvious motif or seams | Missing |

## Vegetation

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VEG-001 | Courtyard joint plants | P1 | C | AD | KIT | Low varied tufts rooted in soil; broad leaves rather than spikes | Missing |
| VEG-002 | Courtyard shrubs | P1 | C | AD | KIT | Leaf detail and clump silhouette, retain route clearance | Missing |
| VEG-003 | Meadow and verge grasses | P2 | C | D1 | KIT | Species/height variation, patch edges and seed heads | Missing |
| VEG-004 | Grain crop | P2 | C | IT | KIT | Mature/harvested/regrown states and density | Missing |
| VEG-005 | Bittergreen | P2 | C | IT | KIT | Original herb, harvested/depleted state | Missing |
| VEG-006 | Emberpetal | P2 | C | IT | KIT | Distinct original flower, no mandatory emission | Missing |
| VEG-007 | Forest canopy tree family | P2 | C | D1 | KIT | Trunk/branch/root/leaves and near/far silhouettes | Missing |
| VEG-008 | Forest understory and litter | P2 | C | D1 | KIT | Sapling/fern/deadwood proposals, clear paths | Missing |
| VEG-009 | Coastal vegetation | P2 | C | D1 | KIT | Wind-shaped shrub and shore-grass placement | Missing |
| VEG-010 | Shared calm and gust wind | P1 | C | FM | MOT | Grass/shrub/tree phase relationships, fixed roots and recovery | Missing |
| VEG-011 | Storm vegetation motion | P3 | D | RB | MOT | Gust fronts and wet weight, no identical synchronized swaying | Missing |
| VEG-012 | Vegetation interaction and recovery | P3 | D | PR,RB | MOT | Body passage, bend limits, recovery and failure cases | Missing |
| VEG-013 | Dense foliage and LOD continuity | P2 | C | FM | LIGHT,MOT | Near-to-vista motion, stable silhouette/shadows and no pop | Missing |

## Characters and creatures

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CHAR-001 | Human playable folk | P1 | C | AB | CHAR | Body/face variation and martial/caster/hybrid loadouts | Missing |
| CHAR-002 | Skarn playable folk | P2 | C | AB | CHAR | Sturdy stone-blooded identity; literal rock skin requires selection | Missing |
| CHAR-003 | Wickfolk playable folk | P2 | C | AB | CHAR | Small quick body, scale and equipment fit | Missing |
| CHAR-004 | Village conversational NPC | P1 | C | NP | CHAR | Speaking/listening/emotion and daily work; first rig candidate | Missing |
| CHAR-005 | Smith and forge worker | P2 | C | IT | CHAR | Protective clothing and work poses | Missing |
| CHAR-006 | Apothecary and alembic worker | P2 | C | IT,QU | CHAR | Practical alchemy equipment and reagent handling | Missing |
| CHAR-007 | Hearth keeper | P2 | C | IT | CHAR | Food work, idle and trade | Missing |
| CHAR-008 | Dock trader | P2 | C | IT | CHAR | Coastal work clothing and inventory handling | Missing |
| CHAR-009 | Dock salvager / reluctant witness | P2 | C | QU | CHAR | Work wear and guarded/cooperative expressions | Missing |
| CHAR-010 | Field and forest workers | P2 | C | NP,IT | CHAR | Shared costume kit with harvesting/carrying variants | Missing |
| CHAR-011 | Quest role costume variants | P2 | C | QU | CHAR | Bounty/hunt/reliquary/vista roles; reuse authored NPC identities, no invented roster | Missing |
| CHAR-012 | Burrow-gnawer | P1 | C | BE | CHAR | Field vermin, bite and pack flee silhouettes; first enemy rig candidate | Missing |
| CHAR-013 | Greymaw | P2 | C | BE | CHAR | Predator anatomy, lunge/pounce and circling | Missing |
| CHAR-014 | Wayland brigand | P2 | C | BE | CHAR | Sword/block/dodge plus parley/yield | Missing |
| CHAR-015 | Skitterling | P2 | C | BE | CHAR | Original swarm anatomy, bite/nest emergence and venom cue | Missing |
| CHAR-016 | Hollow warden | P2 | C | BE | CHAR | Armored sentinel, maul/slam and clear Exposed opening | Missing |
| CHAR-017 | The Warden Below | P2 | C | BE | CHAR | Distinct boss silhouette, all phases, unchanged wind-up readability | Missing |
| CHAR-018 | Face, skin and eye baseline | P1 | C | FM,NP | CHAR,LIGHT | Conversational distance, varied skin tones and credible gaze | Missing |
| CHAR-019 | Hair and fur baseline | P2 | C | FM,BE | CHAR,LIGHT | Hair clumps/strand silhouette and greymaw fur | Missing |
| CHAR-020 | Advanced skin, eye and hair response | P3 | D | FM | LIGHT | Backlit skin, cornea/wetline and hair/fur response; no technique mandate | Missing |
| CHAR-021 | Garment and muscle deformation | P3 | D | FM | MOT | Joint extremes, cloth/body separation and failure examples | Missing |

## Equipment, recipes and gathering items

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ITEM-001 | Sword / Tempered Sword | P2 | C | IT | KIT | Grip/blade/sheath and crafted upgrade delta | Missing |
| ITEM-002 | Axe / Tempered Axe | P2 | C | IT | KIT | Head/haft assembly and upgrade delta | Missing |
| ITEM-003 | Spear / Tempered Spear | P2 | C | IT | KIT | Point/socket/shaft and reach | Missing |
| ITEM-004 | Bow / Laminated Bow | P2 | C | IT | KIT | Strung/unstrung/drawn, arrows and quiver | Missing |
| ITEM-005 | Cloth garb | P2 | C | IT | KIT | Layers/seams and all-folk fit | Missing |
| ITEM-006 | Leather jack | P2 | C | IT | KIT | Flexible joints and body fit | Missing |
| ITEM-007 | Scale Coat | P2 | C | IT | KIT | Scale attachment/overlap and mobility | Missing |
| ITEM-008 | Reinforced Buckler | P2 | C | IT | KIT | Front/back/grip and reinforcement | Missing |
| ITEM-009 | Weapon Whetting | P2 | C | IT | KIT | Before/after edge and station tool, no magical upgrade implied | Missing |
| ITEM-010 | Armor Fitting | P2 | C | IT | KIT | Adjusted straps/fit and station detail | Missing |
| ITEM-011 | Ashwood Focus | P2 | C | MA,IT | KIT | Accessible base catalyst, held scale | Missing |
| ITEM-012 | Glazed Focus | P2 | C | MA,IT | KIT | Craft/material upgrade language | Missing |
| ITEM-013 | Resonant Focus | P2 | C | MA,IT | KIT | Ember/frost/aether attunement variants, common construction | Missing |
| ITEM-014 | Vigor Tonic | P2 | C | IT | KIT | Vessel/liquid/closure and inventory silhouette | Missing |
| ITEM-015 | Stone Tonic | P2 | C | IT | KIT | Distinct container; no petrification implied | Missing |
| ITEM-016 | Clearing Draught | P2 | C | IT,QU | KIT | Consumable and vent-dousing context | Missing |
| ITEM-017 | Emberdust Oil | P2 | C | IT | KIT | Applicator, oil and coated weapon | Missing |
| ITEM-018 | Frostglass Oil | P2 | C | IT | KIT | Distinct from Emberdust in shape/material | Missing |
| ITEM-019 | Aether Salts | P2 | C | IT | KIT | Container and crystalline dose | Missing |
| ITEM-020 | Hearthloaf | P2 | C | IT | KIT | Whole/cut and starter-satchel context | Missing |
| ITEM-021 | Fisher's Stew | P2 | C | IT | KIT | Vessel, ingredients and serving | Missing |
| ITEM-022 | Orchard Preserve | P2 | C | IT | KIT | Jar/fruit texture; no new orchard region implied | Missing |
| ITEM-023 | Hunter's Roast | P2 | C | IT | KIT | Cooked food and serving | Missing |
| ITEM-024 | Tidebroth | P2 | C | IT | KIT | Distinct ingredients/color from stew | Missing |
| ITEM-025 | Waybread | P2 | C | IT | KIT | Travel portion and wrapping | Missing |
| ITEM-026 | Mulled Cordial | P2 | C | IT | KIT | Flask/cup and warm serving | Missing |
| ITEM-027 | Harvested grain, bittergreen and emberpetal | P2 | C | IT | KIT | Loose/stacked forms matching VEG-004–006 | Missing |
| ITEM-028 | Timber, meat, hides, pelts and sinew | P2 | C | IT,BE | KIT | Gathered/drop forms matching source creatures | Missing |
| ITEM-029 | Fish, sea salt and salvage iron | P2 | C | IT | KIT | Shore node and inventory forms | Missing |
| ITEM-030 | Dimstone ore, relic fragments and venom sacs | P2 | C | IT | KIT | Underground node/drop forms distinguishable from dressing | Missing |
| ITEM-031 | Marks and loot rarity language | P2 | C | IT | KIT,UI | Currency and Common/Fine/Exceptional/Mythic, redundant cues | Missing |
| ITEM-032 | Non-elemental affix presentation | P2 | C | IT | KIT,UI | Keen, Weighted, Bulwark, Attuned, Light, Bracing, Nimble; restrained details/icons | Missing |
| ITEM-033 | Elemental affix presentation | P2 | C | IT | KIT,FX | Emberbound/Frostbound/Venombound, equipped and on-hit | Missing |

## Lighting, atmosphere and image quality

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LIGHT-001 | Courtyard sunny versus overcast | P1 | C | AD,WL | LIGHT | Warm direct/cool open shadows and material readability | Missing |
| LIGHT-002 | Courtyard dawn and dusk | P1 | C | WL | LIGHT | Low sun, terrain/stone contact and long shadows | Missing |
| LIGHT-003 | Courtyard night with local lights | P1 | C | WL | LIGHT | Fire/lantern pools, faces and navigable darkness | Missing |
| LIGHT-004 | Courtyard approaching and active storm | P1 | C | WL | LIGHT | Pre-rain versus wet state labeled separately, flash recovery | Missing |
| LIGHT-005 | Shadows at all distances | P1 | C | FM | LIGHT | Shallow paving contact, foliage and castle; moving sun/camera | Missing |
| LIGHT-006 | Interior torch and Wardlight | P1 | C | WL,AB | LIGHT | Same passage with each source and overlap | Missing |
| LIGHT-007 | Baseline exposure, grading and bloom | P1 | C | FM | LIGHT | Skin/plaster/fire highlight retention and controlled emissive spread | Missing |
| LIGHT-008 | Fine-detail and edge stability | P1 | C | FM | LIGHT,MOT | Moving paving/roof/foliage/highlights; no shimmer/ghost trails | Missing |
| LIGHT-009 | Distant aerial perspective | P2 | C | D1,WL | LIGHT | Castle/mountain separation without graywashed foreground | Missing |
| LIGHT-010 | Dynamic indirect light and color bleed | P3 | D | RB | LIGHT | Sun/torch/emissive bounce, moving occluders and leakage failures | Missing |
| LIGHT-011 | Many overlapping shadowed lights | P3 | D | RB | LIGHT | Market/interior, moving sources and coherent shadows | Missing |
| LIGHT-012 | Volumetric clouds and storm fronts | P3 | D | RB | LIGHT,MOT | Cloud scale/drift and ground-light relationship | Missing |
| LIGHT-013 | God rays and volumetric shafts | P3 | D | RB | LIGHT,MOT | Forest/interior openings, camera rotation and occlusion | Missing |
| LIGHT-014 | Reflections and indirect visibility | P3 | D | RB | LIGHT,MOT | Wet ground/glass/metal, offscreen objects and disocclusion | Missing |
| LIGHT-015 | HDR presentation study | P3 | D | RB | LIGHT | Highlight intent and display comparison brief; SDR concept cannot prove HDR | Missing |
| LIGHT-016 | Depth of field | P3 | D | RB | LIGHT | Optional portrait/photo framing versus gameplay legibility | Missing |
| LIGHT-017 | Motion blur | P3 | D | RB | MOT | Camera/object motion, explicit shutter assumptions and telegraph visibility | Missing |
| LIGHT-018 | Transparency and decal layering | P3 | D | RB | LIGHT,MOT | Glass/smoke/foliage, moss/wear/puddle edges and sorting failures | Missing |
| LIGHT-019 | High-density scene continuity | P2 | C | FM,RB | LIGHT,MOT | Occlusion reveal, LOD and residency transitions without visual changes | Missing |
| LIGHT-020 | Sky, sun, moon and cloud states | P1 | C | D1,WL | LIGHT,MOT | Clear/overcast/storm skies, sun/moon/star positions and ordinary cloud forms across the cycle as backdrop to LIGHT-001–004 and ENV-022; mountain vista horizon; volumetric rendering stays LIGHT-012 | Missing |

## Water

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WATER-001 | Coastal ocean surface | P2 | C | D1,RB | MAT,MOT | Authored shoreline appearance: calm/chop/storm near/far and wave scale; static appearance is committed D1 content, simulation/reflection technique deferred | Missing |
| WATER-002 | Shore break, foam and retreat | P3 | D | RB | FX,MOT | Sand/rock contact, foam lifetime and receding flow | Missing |
| WATER-003 | Moat water | P2 | C | D1,RB | MAT,MOT | Authored moat appearance: bank/pier contact, reflections, ripples and waterline; static appearance committed, simulation deferred | Missing |
| WATER-004 | Lake appearance study | P3 | D | RB | MAT,MOT | Research reference only; no authored D1 lake added | Missing |
| WATER-005 | Puddles and wet streets | P2 | C | WL,RB | MAT,MOT | Storm-scene wet courtyard for LIGHT-004: shallow edges, broken reflections and dry-to-wet progression; wetness technique selection deferred | Missing |
| WATER-006 | Object splash and ripple | P3 | D | PR | FX,MOT | Source size/speed, impact/cavity/splash/settling | Missing |
| WATER-007 | Wake and buoyancy reference | P3 | D | PR,FM | MOT | Floating object and optional rowboat study; no playable vehicle | Missing |
| WATER-008 | Underwater appearance candidate | P3 | D | PR | LIGHT,MOT | Optional camera study, no swim/dive mechanic | Missing |

## Weather effects

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEATHER-001 | Rain near player and in distance | P2 | C | WL | FX | Streak/drop scale and occlusion on bright/night backgrounds | Missing |
| WEATHER-002 | Rain surface impacts and runoff | P3 | D | RB | FX,MOT | Tile/stone/soil/water responses and drainage continuity | Missing |
| WEATHER-003 | Signature lightning strike | P1 | C | WL | FX,LIGHT | Sky/scene flash, shadows and exposure recovery; no new combat hazard | Missing |
| WEATHER-004 | Clear-to-storm-to-clear progression | P2 | C | WL | LIGHT,MOT | Sky/light/wind/rain timeline; wetness and advanced wind use deferred targets | Missing |
| WEATHER-005 | Ground mist and coastal fog | P3 | D | RB | FX,MOT | Density/height/drift and multi-distance silhouettes | Missing |

## Authored abilities

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ABIL-001 | Cleaving Arc | P2 | C | AB | FX,MOT | Committed wide arc, multiple contacts and readable reach | Missing |
| ABIL-002 | Answering Strike | P2 | C | AB | FX | Caught-block opportunity, empowered next strike and expiry | Missing |
| ABIL-003 | Piercing Lunge | P2 | C | AB | FX,MOT | Gap-closing thrust/contact, no teleport appearance | Missing |
| ABIL-004 | Ironset Stance | P2 | C | AB | FX,MOT | Planted/held/released/exhausted and slowed movement | Missing |
| ABIL-005 | Steady Loose | P2 | C | AB | FX,MOT | Draw/hold/full charge/release and arrow readability | Missing |
| ABIL-006 | Emberlash | P2 | C | AB | FX | Catalyst cast, ember bolt/impact and keen Burning | Missing |
| ABIL-007 | Frostbind | P2 | C | AB | FX | Burst extent/onset and Chilled application | Missing |
| ABIL-008 | Aetherpulse | P2 | C | AB | FX | Force-wave expansion, impact and stagger | Missing |
| ABIL-009 | Mendweave | P2 | C | AB | FX | Healing over time/completion and Envenomed suppression | Missing |
| ABIL-010 | Wardlight | P1 | C | AB | FX,LIGHT | Lantern-strength light, absorb hit, break and expiry | Missing |
| ABIL-011 | Forager's Eye | P2 | C | AB | FX,UI | Node shimmer at authored distance, no scenery-wide glow | Missing |
| ABIL-012 | Wellspring | P2 | C | AB | UI | Passive regeneration cue; world particles optional | Missing |
| ABIL-013 | Quiet Tread | P2 | C | AB | UI,MOT | Passive movement cue, no invisibility/stealth system | Missing |
| ABIL-014 | Tinker's Thrift | P2 | C | AB | UI | Ingredient savings and salvage payoff | Missing |
| ABIL-015 | Aetherspark | P2 | C | MA | FX | Zero-cost bolt, less forceful appearance than paid spells | Missing |

## Gameplay VFX

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FX-001 | Physical strike and deflection | P1 | C | CO,RC | FX | Landed/keen/failed check; guard deflection instead of empty whiff | Missing |
| FX-002 | Spell resist flash | P2 | C | CO | FX | Resisted impact without implying damage | Missing |
| FX-003 | Burning condition | P2 | C | RC | FX | Attachment/light, refresh and extinction | Missing |
| FX-004 | Chilled condition | P2 | C | RC | FX | Frost appearance and slowed recovery, no total freeze | Missing |
| FX-005 | Envenomed condition | P2 | C | RC | FX | Venom and suppressed healing distinct from aether | Missing |
| FX-006 | Staggered condition | P2 | C | RC | FX,MOT | Action interruption/recovery without prolonged stun | Missing |
| FX-007 | Exposed condition | P2 | C | RC | FX,UI | Opening/expiry on player and wardens | Missing |
| FX-008 | Ember on Chilled thermal shock | P2 | C | RC | FX | Consume Chilled, apply Staggered | Missing |
| FX-009 | Frost on Burning thermal shock | P2 | C | RC | FX | Consume Burning, apply Exposed | Missing |
| FX-010 | Caught block and block break | P2 | C | CO | FX,MOT | Success versus exhaustion, re-raise lockout | Missing |
| FX-011 | Bow projectile and material impacts | P2 | C | CO | FX | Flight/guard/stone/soil/wood, no new penetration rule | Missing |
| FX-012 | Warden maul and slam | P2 | C | BE | FX,MOT | Warning/active/recovery and dodged-slam opening | Missing |
| FX-013 | Boss aether lance | P2 | C | BE | FX | Wind-up/projectile, pillar cover and resist/hit | Missing |
| FX-014 | Boss clutch summon | P2 | C | BE | FX | Phase-two transition and readable emerging skitterlings | Missing |
| FX-015 | Boss ember vents | P2 | C | BE | FX | One-second warning, Burning zone and quenched variant | Missing |
| FX-016 | Boss enrage and break opening | P2 | C | BE | FX,MOT | Faster recovery, no faster wind-up | Missing |
| FX-017 | Gathering and node depletion/regrowth | P2 | C | IT | FX | Harvest/collect/depleted/restored across plant/wood/ore/shore | Missing |
| FX-018 | Forge crafting feedback | P2 | C | IT | FX | Hammer/heat/sparks and finished item | Missing |
| FX-019 | Alembic crafting feedback | P2 | C | IT | FX | Heat/distillation/catalyst/tonic completion | Missing |
| FX-020 | Hearth cooking feedback | P2 | C | IT | FX | Flame/steam/food completion and readable work | Missing |
| FX-021 | Consumable and weapon-oil use | P2 | C | IT | FX | Health/soak/cleansing/aether/food, oil application/expiry | Missing |
| FX-022 | Loot, rarity and recovery feedback | P2 | C | IT,DE | FX,UI | Drop/collect/overflow/satchel, restrained rarity cues | Missing |
| FX-023 | Waystone rest, defeat and respawn | P2 | C | DE | FX | Fall-to-wake and anchor activation, no teleport network | Missing |
| FX-024 | Level-up and selection payoff | P2 | C | AB | FX,UI | Stamina/aether refill only, no healing implication | Missing |
| FX-025 | Concurrent combat effects | P2 | C | CO,BE | FX | Player/enemy overlaps in sun/night/arena; telegraphs remain primary | Missing |

## Environmental effects

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EFX-001 | Torch flame and illumination | P1 | C | WL | FX,LIGHT | Attached flame/flicker/smoke, nearby face and masonry | Missing |
| EFX-002 | Hearth and brazier fire | P1 | C | WL | FX,LIGHT | Fuel bed, convection and light extent | Missing |
| EFX-003 | Forge fire, sparks and embers | P2 | C | IT | FX | Hot work, particles settling and surface contact | Missing |
| EFX-004 | Wind-driven smoke plume | P3 | D | RB | FX,MOT | Source/plume continuity, gusts and dissipation | Missing |
| EFX-005 | Authored burning-building spectacle | P3 | D | RB | FX,LIGHT | Intact static building; flame/smoke/light only, destruction excluded | Missing |
| EFX-006 | Dust and small cosmetic debris | P3 | D | RB | FX,MOT | Footsteps/impacts/settling without breakable environments | Missing |
| EFX-007 | Steam and condensation | P3 | D | RB | FX,MOT | Alembic/vent/hot-water appearance and drift | Missing |
| EFX-008 | Gas and magical mist | P3 | D | RB | FX | Volume edges/occlusion, no new damage rules | Missing |
| EFX-009 | Electrical arcs | P3 | D | RB | FX | Endpoints/branching/light, no new player spell | Missing |
| EFX-010 | Persistent trails and residual marks | P3 | D | RB | FX | Moving source, aging/fade and frost/ember/mud layering | Missing |
| EFX-011 | Heat refraction | P3 | D | RB | FX,MOT | Flame/hot-surface distortion and temporal failure cases | Missing |

## Animation and physical behavior

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MOT-001 | Player locomotion | P1 | C | FM,CO | MOT | Idle/walk/run/sprint/start/stop with folk scale variants | Missing |
| MOT-002 | Turns, strafing and direction changes | P1 | C | FM,CO | MOT | Facing/feet/hips alignment without foot sliding | Missing |
| MOT-003 | Stairs, slopes and paving contact | P1 | C | FM | MOT | Up/downhill tread placement; IK implementation unselected | Missing |
| MOT-004 | Light and heavy melee attacks | P2 | C | CO | MOT | Sword/axe/spear wind-up/contact/recovery/interruption | Missing |
| MOT-005 | Blocking and dodging | P2 | C | CO | MOT | Raised/held/caught/broken guard and dodge recovery | Missing |
| MOT-006 | Bow and catalyst handling | P2 | C | CO,MA | MOT | Draw/hold/release, bolt/rite and continuous equipment | Missing |
| MOT-007 | Hit reactions and knockback studies | P2 | C | CO,PR | MOT | Authored stagger baseline; added displacement provisional, no new rules | Missing |
| MOT-008 | Falling and landing | P2 | C | PR,FM | MOT | Height/velocity/contact assumptions; no jump mechanic invented | Missing |
| MOT-009 | NPC conversation and listening | P1 | C | NP | MOT | Gaze, gestures, turn-taking and expression transitions | Missing |
| MOT-010 | NPC work and rest schedules | P2 | C | NP,IT | MOT | Station use/walk/carry/sit and prop contact | Missing |
| MOT-011 | Village crowd passing and avoidance | P2 | C | FM | MOT | Opposing paths, queues and dialogue space | Missing |
| MOT-012 | Gnawer pack locomotion and bite | P1 | C | BE | MOT | Swarm/attack/flee, fast wind-up floor and contact | Missing |
| MOT-013 | Greymaw circle, lunge and pounce | P2 | C | BE | MOT | Flank turns, planted launch/landing and pack spacing | Missing |
| MOT-014 | Brigand fight, parley and yield | P2 | C | BE | MOT | Sword/block/dodge and de-escalation | Missing |
| MOT-015 | Skitterling swarm and bite | P2 | C | BE | MOT | Multi-limb contact, nest emergence and group readability | Missing |
| MOT-016 | Hollow warden maul and slam | P2 | C | BE | MOT | Weight, anticipation, recovery and exposed poses | Missing |
| MOT-017 | Warden Below phase choreography | P2 | C | BE | MOT | Lance/maul/slam/summon/enrage and shared attack limits | Missing |
| MOT-018 | Scoped ragdoll | P3 | D | FM | MOT | Standing/falling/stairs, constraints/contact/settling and failures | Missing |
| MOT-019 | Cloth simulation | P3 | D | FM | MOT | Hanging/run/wind/contact and stretch/penetration | Missing |
| MOT-020 | Rope simulation | P3 | D | FM | MOT | Anchored slack/tension/swing/contact and failures | Missing |
| MOT-021 | Chain simulation | P3 | D | PR | MOT | Link scale, hanging/impact/settling without stretching | Missing |
| MOT-022 | Loose-object rolling and sliding | P3 | D | PR | MOT | Stone/wood/metal on slope/steps, friction assumptions | Missing |
| MOT-023 | Buoyancy and rowboat study | P3 | D | FM,PR | MOT | Load/rocking/settling, link WATER-007; no playable vehicle | Missing |
| MOT-024 | Surface deformation and friction | P3 | D | RB | MOT | Mud footprint/track/depth/recovery, unmeasured values explicit | Missing |
| MOT-025 | Animation and streaming continuity | P2 | C | FM | MOT | Near/far/return without pose pop or broken equipment attachments | Missing |

## Gameplay and optional platform presentation

| ID | Target | Priority | Scope | Source | Profile | Particulars | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-001 | Core gameplay HUD | P1 | C | FM,AB | UI | Health/stamina/aether, slots, XP and unspent choices | Missing |
| UI-002 | NPC dialogue | P1 | C | FM,NP | UI | Authored/generated replies, input, waiting/fallback and long translated text | Missing |
| UI-003 | World interaction and navigation markers | P1 | C | FM | UI | NPC/node/entrance/waystone/discovery, occlusion and distance | Missing |
| UI-004 | Combat targeting and telegraphs | P1 | C | CO | UI | Soft-lock, intent, conditions/openings and boss phases | Missing |
| UI-005 | Inventory and equipment | P2 | C | FM,IT | UI | Equipped/unequipped, details/rarity/affixes and satchel | Missing |
| UI-006 | Crafting and recipe screens | P2 | C | FM,IT | UI | Three stations, ingredients/missing inputs/output and knack savings | Missing |
| UI-007 | Vendor trade | P2 | C | IT | UI | Buy/sell/half-price, unsellable items and insufficient marks | Missing |
| UI-008 | Progression and loadout | P2 | C | AB | UI | Attributes/picks, four active/two knack slots and respec | Missing |
| UI-009 | Quest journal and history | P2 | C | QU | UI | Main/side objectives, preparation consequences and pagination | Missing |
| UI-010 | Quest, discovery and reward feedback | P2 | C | QU | UI | Reach/collect/defeat/talk/craft/deliver and overflow messages | Missing |
| UI-011 | Defeat, respawn and satchel recovery | P2 | C | DE | UI | Recoverable cost, replaced satchel and rest anchor | Missing |
| UI-012 | Input prompts and accessibility | P3 | D | FM | UI | Keyboard/gamepad, remap/scaling/subtitles and non-color-only cues | Missing |
| UI-013 | Character creation and folk comparison | P2 | C | AB | UI | Cosmetic identity and attributes, no new class system | Missing |
| UI-014 | Photo mode and capture composition | P3 | D | FM | UI | Controls, framing and gameplay/capture state | Missing |
| UI-015 | Scripted camera / epilogue proposal | P3 | D | FM,QU | UI,MOT | Optional sealing-choice framing; scope unresolved before M6 | Missing |
| UI-016 | Voice NPC interaction | P3 | C | WEB | UI | Listening/transcribing/speaking/denied/offline and permission framing | Missing |
| UI-017 | Localization and recap presentation | P3 | D | WEB | UI | Long text and recap loading/unavailable/source context | Missing |
| UI-018 | Highlight capture controls | P3 | D | WEB | UI | Record/clip/save/share states, no automatic publication | Missing |
| UI-019 | Companion map/inventory/dialog surface | P3 | D | WEB | UI | Second-window/PiP layout and focus ownership | Missing |
| UI-020 | Multi-camera scenic research surface | P3 | D | WEB | UI | Independent scenic views; no drone/security gameplay added | Missing |
| UI-021 | Future multiplayer and proximity voice | P3 | D | FM,WEB | UI | Remote identity/voice status; topology/player count undecided | Missing |
| UI-022 | Future mod/UGC admission presentation | P3 | D | WEB | UI | Preview/source/validation and unapproved state | Missing |
| UI-023 | Optional hardware and adaptive presentation | P3 | D | WEB | UI | Opt-in status, room-light/fidelity comparison; no new encounters | Missing |

## Coverage reconciliation

This mapping reconciles the feature matrix, rendering backlog and named gameplay
content as read on 2026-09-05. **Inventoried does not mean generated, grounded,
selected or approved.** Future feature additions require updates. Rows with multiple
named variants need every named variant; a shared sheet is acceptable only if each
is readable and separately reviewable.

| Feature or content group | Targets or disposition |
| --- | --- |
| Open-world streaming; geometry/LOD; GPU-driven rendering; texture residency | ENV-011/022–026, VEG-013, MAT-025, LIGHT-019, MOT-025. Algorithms need no separate painting; targets specify visible continuity and density. |
| Install/update; benchmark; live content hooks | No new concept required: existing app/measurement/delivery mechanisms. Later art drops consume this catalog; no website redesign. |
| High-fidelity rendering and image pipeline | DIR-001–005, MAT-001–025, LIGHT-001–020. TAA/upscaling targets are temporal stability and cost questions, not separate fictional scenes. |
| Lighting/GI and atmosphere | LIGHT-001–014/020, WEATHER-001–005, EFX-001–011. Appearance selection does not choose a GI/volumetric algorithm. |
| Terrain/procedural materials and transparency/decals | ENV-015–025, KIT-001–003, MAT-001–025, LIGHT-018. Generate-versus-bake is a measured implementation question. |
| Water, vegetation, wind and dynamic surfaces | VEG-001–013, WATER-001–008, WEATHER-002/004, MAT-021/024, MOT-023/024. Authored ocean, moat and storm wetness appearance is C; water simulation, reflections and wetness techniques remain D. |
| NPC navigation/crowds and conversational NPCs | ENV-027, CHAR-004–011, MOT-009–011, UI-002. Model/memory internals have no independent concept image. |
| Combat/progression/crafting and UI stack | ITEM-001–033, ABIL-001–015, FX-001–025, MOT-004–007, UI-001–013. |
| Quests and journal | ENV-016/019/023–025, UND-001–014, KIT-032/034, UI-009/010/015/017; named mapping below. |
| Music/audio content and spatial audio | No raster target for sound or acoustic correctness. ENV-026/UND-015 provide scene contexts; audio briefs need sound references and listening tests. |
| Animation and character rendering | CHAR-001–021, MOT-001–021/025. Baseline bodies/poses C, advanced deformation/physics D. |
| Physics | MOT-003/007/008/018–024, WATER-006/007, VEG-012. Footage/data required for physical grounding. |
| VFX/weather | ABIL, FX, EFX, WEATHER tables cover all named abilities/statuses and the broader effect families. |
| Simulation/save | No independent art; observable restored states use existing scene/UI targets and MOT-025. |
| Cinematics/photo mode | UI-014/015 and LIGHT-015–017, exploratory scope retained. |
| P2P multiplayer/input/accessibility | UI-012/021; protocols, determinism and haptic actuator behavior are nonvisual. |
| Rich NPC dialog/voice/localization/recaps | UI-002/016/017, MOT-009. Capability claims require separate platform verification. Voice remains committed; its P3 is concept-production priority, not a demotion of that commitment. |
| Highlights/companion surfaces/multi-camera | UI-018–020. Scenic cameras only; no modern drones introduced into the world. |
| Adaptive triggers/self-tuning fidelity/install ergonomics | UI-012/023 for controls/status; haptics, thermal sensing and background installation need no concept image. |
| Modding/scanned UGC | UI-022. Imported content is user-supplied; no generated library or splat renderer implied. |
| Webcam lean/biometric world/absence/room light | UI-023, MOT-009, LIGHT-003/006. Stretch presentation studies only, no new mechanics or required permissions. |
| VR | Parked, no headset-specific deliverable before scope/cameras are selected; existing environment references reusable. |
| N districts beyond D1/D2 | Architecture constraint only; no invented third district or new region. |
| Destructible environments | Excluded. ENV-016/KIT-019/034 depict static damaged scenery; EFX-005 depicts fire without structural destruction. |
| Stealth, mounts/vehicles, factions/reputation, dynamic economy, durability, companions/pets, fast travel | Excluded by slice rules. Quiet Tread is not stealth; waystones are not teleports. MOT-023 is a deferred physical study, not playable transport. |

### Named content cross-check

| Authored content | Coverage |
| --- | --- |
| Human / Skarn / Wickfolk | DIR-006, CHAR-001–003, ITEM-005–008, MOT-001, UI-013 |
| Six bestiary archetypes | DIR-007, CHAR-012–017, MOT-012–017, UND-009/010/012/013 |
| Fourteen abilities plus Aetherspark | ABIL-001–015, one named target per ability; passive knacks may select UI-only cues |
| Physical / ember / frost / venom / aether | DIR-008, FX-001–009, ABIL-006–010/015, ITEM-033 |
| Burning / Chilled / Envenomed / Staggered / Exposed | FX-003–007; the two thermal interactions are FX-008/009 |
| Eight forge recipes | ITEM-001–004 and ITEM-007–010 |
| Nine alembic recipes | ITEM-011–019 |
| Seven hearth recipes | ITEM-020–026 |
| Reagents and creature drops | VEG-004–006, ITEM-027–030, UND-011, FX-017 |
| Ten affixes and four rarity tiers | ITEM-031–033; Mythic core in KIT-032 |
| Main 1: Signs in the Fields | ENV-015/016, KIT-034, CHAR-012, UI-009/010 |
| Main 2: The Sealed Door | UND-001/002, KIT-034 |
| Main 3: Words with the Wardens | UND-003/004/009/011, CHAR-016, KIT-032 |
| Main 4: The Apothecary's Ask | ENV-007, ITEM-013/016/027–030, UND-014, FX-015/019 |
| Main 5: The Forest Throat | ENV-019, UND-005/006, CHAR-014, MOT-014 |
| Main 6: The Warden Below | UND-012–014, CHAR-017, FX-012–016, KIT-032, UI-015 (camera optional) |
| A Bounty of Teeth | ENV-015/016, CHAR-012, MOT-012 |
| The Greymaw Alpha | ENV-018, CHAR-013, MOT-013; alpha identification is a variant, not a seventh archetype |
| The Smith's Commission | ENV-006, CHAR-005, ITEM-001–003, FX-018 |
| Cold Larder | ENV-008/021, ITEM-021/029, FX-020 |
| First Fruits | ENV-015, VEG-004–006, ITEM-027, FX-017 |
| The Reluctant Witness | ENV-009, CHAR-009, UI-002 |
| Relics for the Reliquary | UND-011, KIT-032, ITEM-030, UI-009 |
| The Painter of the Vista | ENV-023–025; use authored viewpoint locations when framing |
| Death/rest/material recovery | KIT-030/031, FX-022/023, UI-011 |

## Production queue and review checkpoints

Use as many batches as coverage needs. These waves organize dependencies and
generation order only, not image allocations or fixed batch counts. Every wave,
including the deferred studies, completes before the coverage review; wave 2 contains
every P1 target so early production references are complete before wave 3. Each
batch brief names target IDs, selected input references, concrete outputs and the
program's bounded review allowance. Do not generate the whole catalog in one
unattended run.

1. **Direction selection:** DIR-002–009, using DIR-001 throughout. Start with village,
   castle and underground alternatives. Review folk/creature/magic/UI direction in
   separate manageable groups before their detailed dependent sheets.
2. **First usable production references (all P1 targets):** ENV-001–003/011/026,
   UND-001/002/015, KIT-001–011/029, MAT-001/008/009/011/013/018, VEG-001/002/010,
   CHAR-001/004/012/018, LIGHT-001–008/020, WEATHER-003, ABIL-010, FX-001,
   EFX-001/002, MOT-001–003/009/012 and UI-001–004. The first NPC/enemy pairing is
   proposed, not artistically selected; select before rigging.
3. **World expansion:** remaining D1/D2 environments, architecture, materials and
   vegetation. Reuse selected places across establishing/gameplay/detail/state views.
4. **People, creatures and equipment:** body/costume/prop construction, every named
   recipe/item and required animation body type. Preserve anatomy across poses.
5. **Gameplay appearance and motion:** abilities/statuses, encounter phases, crafting,
   quest feedback and HUD on selected scene backgrounds.
6. **Deferred reference studies:** advanced lighting, water, surfaces, environmental
   effects, physics and optional presentation. Keep missing physical sources explicit.
7. **Coverage review:** human selects the coherent collection; resolve required
   missing targets or record an explicit scoped disposition. Image count never proves
   completion, and optional studies are not silently required engine features.

Cobblestone and other asset iteration resume only after wave 7 completes for the
whole catalog; no earlier wave or selection shortens that gate. The D-187 review
must also have selected DIR-002/005, ENV-001/002, KIT-001–003, MAT-001/018, VEG-001
and LIGHT-001/002/005/008 specifically. A wide shot cannot close
construction/contact/slope/motion requirements.

## Artistic questions to resolve through alternatives

There is no blocking question for this inventory: the current docs establish the
original coastal-fantasy setting and photorealistic courtyard quality anchor.
Castle/catacomb ornament, folk and creature anatomy, costume culture and aether
colors should receive alternatives in their direction batches. Do not silently
make those alternatives canonical. NPC rows describe roles, not new personal names.

Choose the first NPC/enemy pairing and optional underwater/rowboat/cinematic studies
at their batch reviews. Unspecified dimensions remain proposed scale cues until
bound to authored world/kit data or explicitly selected. A generated still does
not settle physical behavior or authorize additional gameplay.
