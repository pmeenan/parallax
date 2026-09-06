# Game concept art and visual targets

**Status: next creative work, not yet generated or approved (2026-09-05).**
D-187 inserts this stage now, before further cobblestone modeling or other asset
iteration. The existing paired courtyard remains the endorsed quality anchor; the
latest individual-stone previews were rejected. Technical installer/streaming closure
is separate. Blender MCP setup is handled separately by the human; concept generation
does not depend on that connection.

## Purpose and scope

Build an extensive, coherent reference library for the whole game and every planned
rendered effect or physics behavior. Target AAA photorealistic, movie-style imagery,
credible materials/construction and bright, readable daylight with convincing gloomy
conditions. Use [game design](../../docs/game-design.md) for setting and mechanics,
[features](../../docs/features.md) for coverage, and the
[rendering backlog](../../docs/plan.md#rendering-research-backlog--promote-only-for-a-named-need)
for future ambitions. Reference coverage includes deferred features; it does not
promote their implementation into M4.5. Destructible environments remain excluded.

Use imagegen as the primary concept-production tool, with selected real photographs
and motion footage for material and physical grounding. Generated images are concepts,
not photographs, measured PBR maps or proof that a behavior is physically correct.
Retain existing world layout, district scale, entrances, gameplay and original setting;
do not redesign geography to reproduce an attractive composition.

## Coverage inventory

Create a catalog before generation. Give each subject a stable target ID, scope
(current/deferred/excluded), source feature or game-design link, required views/states,
and status (missing/draft/selected/approved/rejected). Expand every row below into
named targets; a row is a coverage family, not one image that completes the family.
Map every visual feature and planned physics behavior to a target or an explicit
not-applicable/excluded rationale. Unresolved subjects stay visibly missing.

| Family | Required subjects and comparisons |
| --- | --- |
| World and composition | D1 castle/hill/moat, coastal village streets and courtyard, fields/crops, forest/path/ruins, shoreline, mountain vistas; D2 catacomb passages, chambers, Warden arena and all three entrance contexts; long vistas, playable eye-level views, enclosed spaces and transitions |
| Architecture and props | Limestone paving/walls/well, plaster, timber framing, roof tiles, doors/windows, stairs, bridges, gates, furnishings, tools, gathering/crafting stations and environmental storytelling; construction joints, scale and wear |
| Materials and ground | Limestone variants in cream/buff/red/gray where appropriate, other stone types, wood, brick, plaster, metal, soil, gravel, mud, grass and crops; broad surface variation, edge wear, contact, dry/wet response, close and walking-distance detail |
| Characters and creatures | Player/NPC silhouettes and required body types, faces/skin/eyes/hair, clothing/armor/equipment, slice bestiary including the Warden; proportions, expressions, turnarounds and locomotion/combat silhouettes tied to the actual ruleset |
| Lighting and image quality | Matched sunny/overcast/dawn/dusk/night scenes, torch/fire/magic interiors, contact and distant shadows, indirect light and reflections; fog, aerial perspective, clouds and shafts; exposure, color, bloom, edge stability and fine-detail stability during motion |
| Weather, water and vegetation | Clear-to-storm progression, rain/lightning, wet streets/puddles, shore/ocean/moat water, ripples/wakes/foam/splashes, underwater views if selected; calm/gust/storm foliage and crop movement, interaction and recovery; snow only as a labeled deferred surface study |
| Gameplay and environmental VFX | Every named aetherwork ability and gameplay telegraph, projectiles/impacts, fire/smoke/embers, dust/debris, sparks, gathering/crafting feedback and status effects; anticipation, onset, peak, decay and residue, including overlapping effects and background readability |
| Animation and physics | Locomotion, turns, stairs/slopes, foot contact, impacts, knockback, falling/landing, object contact/rolling/sliding where planned; scoped ragdoll, cloth, ropes/chains, buoyancy/rowboat and surface deformation/friction studies; settling, constraints and terrain interaction |
| Gameplay presentation | Representative HUD/dialog/world markers, encounter and navigation readability over bright, dark, busy and effects-heavy scenes; scripted-camera concepts remain exploratory until scope is decided |

## Production sequence and allowance

1. Inventory the coverage above and reconcile it with all visual rows in the live
   feature matrix, named abilities/bestiary and rendering/physics backlog. Mark future
   concepts separately so breadth of reference is not mistaken for a delivery promise.
2. Establish a coherent world/color/material direction using the endorsed courtyard.
   Produce several distinct alternatives for key scenes before choosing a consistent
   family. Reuse selected references in subsequent prompts to preserve the same place,
   construction, characters and scale across views and weather.
3. Generate environment, asset and character sheets, then effect and physics boards.
   Initial planning envelope: eight batches of roughly 6–12 images/sheets (48–96 total),
   up to two generation/review passes and 90 minutes of active work per batch. Report
   generation waiting separately. These are planning allowances, not an image quota
   or a quality waiver; extend explicitly for named missing/failed targets.
4. Curate contact sheets and a short critique: what each image establishes, physical
   inconsistencies, alternatives rejected, and remaining gaps. Seek human artistic
   selection in manageable batches; do not wait until dozens of inconsistent images
   have accumulated before checking the direction.
5. Assemble the selected world-wide reference set and its coverage review. Resolve
   required gaps before resuming asset iteration; proposed physics values remain
   labeled provisional until grounded in footage or an explicit design choice.
6. Return to cobblestone only after the program review and explicit selection of its
   scene/material/assembly targets. The first resumed proof is a small assembled patch
   compared at the selected walking and grazing cameras, before library expansion.

For each major environment, include an establishing view, gameplay view and useful
material/assembly detail, with matched sunny and gloomy states. For hero assets,
include neutral views from multiple angles, a metric scale cue, construction/edge
details and an in-context assembly. A dramatic wide shot alone is insufficient for
modeling. Do not invent unseen construction details without labeling the interpretation.

## Effects and physics target sheets

An effect needs both an appearance target and a temporal specification. Supply a
timestamped storyboard (anticipation/onset/peak/decay/settled), multiple viewing
distances and lighting states, plus real motion footage where available. State what
must remain readable when the effect overlaps characters, terrain or other effects.

A physics target also records scenario geometry and metric scale, initial conditions,
gravity/design assumptions, contact/friction or constraint behavior, motion path,
settling time and acceptable penetration/stretch/jitter. Set numerical ranges from
real references or explicit gameplay decisions, not inferred from an AI still. Include
failure examples such as foot sliding, floating contacts, implausible splashes, rigid
cloth or unstable ropes. Generated frame sequences can propose appearance and timing;
they cannot validate conservation, collision response or simulation stability.

## Catalog and comparison contract

Store the catalog and approved briefs under `assets/reference/`; retain image originals
and motion sources under the existing binary/provenance policy. Each target record has:

- ID, subject, district/feature, scope and acceptance status; links to chosen images,
  alternatives and source footage, with durable file locations and hashes.
- Exact prompt, model/provider when available, seed when supplied, input-image lineage,
  rights/source URLs, and review status. Label generated, photographed and rendered
  references separately. Referencing an image does not authorize sampling its pixels
  into a shipping texture; that still requires the asset rights/QA gate.
- Camera/framing, lens or field-of-view target, scale, lighting/weather, material and
  wear notes; list inferred/unmeasured settings instead of presenting them as facts.
- Observable acceptance criteria and must-fix defects. For cobblestone these include
  construction/proportions, broken courses, broad color/wear variation, discontinuous
  shoulders, soil burial, believable joint plants, and stable fine detail in motion.
- For effects/physics: temporal board, reference clip and test conditions/tolerances.
  Record later in-game capture links, deviations, measured cost and human feedback.

Future implementation briefs must cite the selected target IDs. Compare real Chrome
output at matched framing, scale and light, including moving sequences for temporal
effects. Record shape/material/lighting/motion differences separately. Technical tests,
Blender renders, image similarity scores and elapsed effort do not grant artistic
acceptance. Do not lower targets silently to match the implementation.

## Exit checklist

- [ ] Coverage catalog reconciled against the game, effects and physics plans.
- [ ] Extensive coherent scene, asset and character references generated and curated.
- [ ] Every planned effect/physics family has a temporal/behavior target; deferred and
  excluded subjects are labeled, and ungrounded physical assumptions remain explicit.
- [ ] Provenance/rights and required camera/state details retained with selected targets.
- [ ] Human review selects the overall direction and cobblestone assembly targets;
  unresolved required gaps are named rather than hidden behind a generation count.
- [ ] Active implementation briefs link to those targets before asset iteration resumes.
