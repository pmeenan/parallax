# Timber-framed wall family — brief (kit package K1, 2026-09-25)

The first package of the [daylight courtyard kit](../../../../docs/plan.md#daylight-kit-program)
and the first authored asset outside the ground-surface class. It follows the
[production workflow](../../../production-workflow.md) (D-196) and tests the handbook's untested
[guidance for non-ground assets](../../../procedural-authoring.md#beyond-ground-surfaces-untested-guidance).

## References

Binding appearance, all human-approved:

| Target | Reference | What it binds |
| --- | --- | --- |
| KIT-005 wall bays | [087 A v3](../../../reference/concepts/batch-087/kit-005-wall-bays-v3.png) | Equal 2 m bays; plain, window and door variants; sill, head beam, posts at bay lines; plinth under the sill; flush door threshold |
| KIT-006 oak corner | [087 B v2](../../../reference/concepts/batch-087/kit-006-oak-corner-v2.png) | Corner post over a larger footing stone, two orthogonal plates, connected braces, staggered corner courses |
| MAT-008 lime plaster | [104 B v1](../../../reference/concepts/batch-104/mat-008-lime-plaster-v1.png) | Broad intact trowelled cream field, localized repair patch, edge loss revealing granular backing, hairline cracks at the timber |
| MAT-009 structural oak | [105 A v5](../../../reference/concepts/batch-105/mat-009-structural-oak-v5.png) | Grain along each member, deep checks, knots, pegs only where a member is received |
| KIT-007 foundation | [089 A v1](../../../reference/concepts/batch-089/kit-007-foundation-slope-v1.png) | Continuous timber bearing on coursed rough limestone, staggered corner, grade contact, lichen, plants rooted at the foot |
| KIT-009 door | [090 A v2](../../../reference/concepts/batch-090/kit-009-open-door-v2.png), [Batch187 B1](../../../reference/concept-art-batch-187-review.md) | Plank leaf, strap hinges, ring latch, flush floor; the closed state ships here |
| KIT-010 window | [090 B v3](../../../reference/concepts/batch-090/kit-010-window-shutters-v3.png) | Framed four-light casement, projecting sill, plank shutters on strap hinges, wall-mounted holdbacks, subdued uneven glazing |
| DIR-002 village | [001 B](../../../reference/concepts/batch-001/dir-002-b-sunny-v1.png), [courtyard sheet](../../../reference/d1-courtyard-sunny-gloomy.png) | Weathered timber-led character, two storeys, the facade read at street distance |
| Lighting | [LIGHT-001 sunny](../../../reference/concepts/batch-060/light-001-courtyard-sunny-v1.png) | Warm side sun, cool open shadow |

**Human direction and corrections that override the pictures.**
- MAT-008's calm trowelled plaster is the plaster authority. KIT-005 v3's scaly, cobbled plaster
  and the rough plaster in KIT-006/007 are not reproduced (the handbook's "sandpaper or felt"
  failure).
- Pegs sit only in receiving members at joints (the MAT-009 v5 correction).
- Flame-only lighting; no lantern in this package (KIT-029 is later).
- Complete buildings need the pitched terracotta roof (KIT-008, package K2). The wall family ends
  at the head plate; the flat stone cap in KIT-006/MAT-009 is context only.

## Dimensions and viewing

From the [kit spec](../../../reference/d1-courtyard-kit.md#assembly-and-pieces) and the
[approved blockout](../../../reference/concept-art-batch-188-blockout-v2.md):
- Bay 2 m wide × 3 m storey, wall 0.25 m thick. Houses are two storeys (6 m walls, 9 m ridges).
- Oak posts and plates 0.25 m square in section at bay lines; one owner per shared seam. The
  plaster infill sits 25–40 mm behind the timber face.
- Limestone plinth 0.5 m high under the sill, fitting the terrain without changing it.
- Door opening 1 × 2.25 m clear, flush threshold. Windows about 0.7 × 0.9 m with shutters.
- Pivot at the bottom centre of the exterior face, exterior facing +Z, metres, Y-up export.
- Viewing: the player walks the 6 m lane and the court at 1.7 m eye height. The nearest
  common distance is 0.5–1 m (walking along a wall); facades read whole at 8–25 m.

## Camera set

- `front`: frontal view of one storey of plain, window and door bays on the plinth, matching
  KIT-005 v3's framing.
- `corner`: low oblique on the corner post and footing, matching KIT-006 v2.
- `junction`: about 0.8 m wide on plaster, sill, post and plinth, matching MAT-008 v1.
- `street`: 1.7 m eye height, looking along a two-storey, six-bay facade on the approved paving
  (repetition and street-distance read, DIR-002 B).
- `extreme`: about 0.25 m wide on timber checks and a plaster loss edge.
- `window`: oblique on the window and shutters, matching KIT-010 v3.
- Standing diagnostics: low opposing sun, overcast (sun off, sky ×3), gray and unlit.

No prior candidate exists; the in-game greybox walls are the before image at delivery.

## Reference breakdown (the defect checklist)

| Scale | Traits to reproduce |
| --- | --- |
| Layout (m) | Equal bays; posts on every bay line; sill on the plinth, head plate on the posts; corner braces from the corner post to the plate; door offset within its bay; window centred with shutters clear of the posts |
| Form (cm) | Timbers stand 25–40 mm proud of the plaster; slightly out-of-true members (a few mm over a storey); plaster fields gently bellied; plinth stones 25–60 cm long in two uneven courses with a larger corner footing stone; plinth face projects slightly beyond the sill |
| Edge (cm–mm) | Oak arrises worn round 5–15 mm; checks along the grain, 2–8 mm wide and 0.2–1 m long; end grain on exposed ends; plaster returns rounded against the timber with a shrinkage gap; plaster loss patches with a stepped edge showing coarse brown backing; stones rough-pitched with chipped arrises and recessed mortar |
| Surface (mm) | Plaster: trowel undulation, sparse 1–3 mm air pits, fine grain carried in colour (relief ≤ 0.3 mm); oak: raised weathered grain and knots; stone: tooled pits like the paving limestone |
| Colour | Cream plaster with warmer limewash repairs, runoff streaks below sills and beams, a splash-stained band above the plinth; oak dark brown, silvered on up-facing and exposed faces, darkest in checks and joints; iron staining under nails and straps; plinth cream-buff limestone with lichen, soil staining on the lower course and moss in the joints |
| Contact | Plinth seated into the ground with soil and sparse rooted plants at its foot; sill bearing continuous on a mortar bed; no floating or interpenetrating member |
| Openings | Real apertures with reveals; flush door threshold; subdued, slightly uneven glazing, never mirror-blue; a dark interior, not a modelled room |
| Lighting | No lighting in albedo; relief must read under the calibrated side sun and survive overcast |

## Question

Can the script-first method build a timber-framed wall family at the references' quality? And
which surface representation holds up across a repeated multi-bay facade?
- **Default:** each variant carries unique authored maps (albedo, normal, ORM with height)
  over its own UV layout, at about 1 mm per texel on the closest surfaces, as the paving does.
- **Named fallback, if the `street` view shows a stamp:** unique low-frequency staining per
  variant plus shared tiling detail per material. The street view decides.

Architecture is the first class that is not a height field on a plane. Record where the
handbook's ground method had to change, and move the helpers shared with the paving into a
common module once this builder needs them.

## Must-fix defects

1. Scaly, cobbled or sandpaper plaster instead of MAT-008's calm trowelled field.
2. Oak that reads as flat brown boxes or as plastic: no checks, sharp arrises, grain that
   ignores member direction, missing end grain.
3. Decorative pegs on free faces.
4. Timbers floating on or sunk into the plaster; plaster intersecting timber without a return
   or gap.
5. A plinth of identical bricks; uncoursed corners; a plinth floating above the ground.
6. Painted openings: no reveal depth, a raised door step, mirror glazing or a visible room.
7. Directional light or occlusion painted into albedo.
8. A recognizable stamp along the six-bay `street` facade.

## Allowance and end

- **Time box:** one work session of about three active hours for the preview loop and the final
  build. Scripted previews inside it are free; full-quality candidate handoffs count, two at
  most (D-196).
- **Ends with:** the human's artistic decision on the source. Accepted leads to the K1 delivery
  package (LODs, KTX2 maps, class QA for architecture, installed inspection and measured cost).
  Otherwise extend with a named question and a new time box, or defer with the limitation.
- **Out of scope:** the roof (K2), lanterns, jettied upper storeys, interiors, door or shutter
  motion, collision, runtime delivery, QA admission and the courtyard assembly.

## Outputs

`build.py` (seeded, refusing to overwrite), `candidateN/` with the views, diagnostics, maps,
`--save-blend` source and receipt, and a results note. Iteration output stays in the session
scratchpad. Independent quality and consistency screens run before handoff (D-195).
