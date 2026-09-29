# House kit delivery and GPU memory round — brief (K2 delivery, 2026-09-28)

The roof's runtime delivery, run as a memory optimization round for the whole house kit. The human
accepted the [K2 roof source](../proof-2026-09-27/results.md) on 2026-09-28 and directed that the next
round "maintains quality but radically reduces GPU because real scenes are going to be a lot more
involved". It follows the [production workflow](../../../production-workflow.md) step 8 and D-200:
optimization may trade a slight, disclosed quality loss for a significant memory gain, judged by an
in-game A/B at materially similar quality.

## Baseline (measured 2026-09-28)

- **Installed game.** Cell 08-08 (test house and paving pad) holds 409 MB on the GPU. That is 416
  dependencies with 343 MB read from OPFS ([install results](../../d1-walls/proof-2026-09-27/install-results.md)).
- **K1 walls delivery** (candidate 5): 275.7 MB of BC1/BC7 maps and 42.6 MB of meshopt geometry. House
  triangles are 2.88 M / 0.57 M / 0.17 M by LOD.

  | Map group | MB | Share |
  | --- | --- | --- |
  | Plaster normal, 13 unique bay fields at 1 mm (BC7) | 106.4 | 39% |
  | Oak normal, one 0.75 mm atlas at 1.5 mm delivered (BC7) | 57.0 | 21% |
  | Oak base colour (BC1) and ORM (BC7) | 42.7 | 15% |
  | Plaster ORM and base colour | 39.9 | 14% |
  | Stone (plinth) maps | 26.2 | 10% |
  | Everything else | 3.5 | 1% |

  The plinth runs are 80% of the house's LOD0 triangles.
- **The roof** has not been delivered yet. Its source maps are 2.6 GB uncompressed:
  - a 28-variant tile atlas at 0.75 mm;
  - its own oak atlas;
  - a gable plaster field.

  Delivered through the K1 pipeline unchanged, it would add on the order of 150–250 MB (an estimate,
  to be measured in step 1).
- **Budget context** ([budgets](../../../../docs/budgets.md)): the GPU memory envelope is ≤ 4 GB at
  Standard and ≤ 14 GB at Showcase. That covers everything in a district: terrain, props, vegetation,
  characters, render targets and transients. The house kit is one class among many.

## Question

How small can the house kit (walls, roof and plinth) be on the GPU while it keeps the accepted look
from street distance to walking range? What engine and pipeline features does that take?

**Target (revised 2026-09-28, with the human's approval, after step 2b):** the complete house kit at
≤ 200 MB of GPU memory (maps plus geometry, all LODs resident), against about 430 MB naive. It must
show no visible loss at 1 m or more against the accepted source, and only disclosed, slight loss closer.
The original ≤ 120 MB proved unreachable while each bay's oak keeps its unique figure, which needs
about 100 MB at 1.5 mm ([results](delivery-results.md#where-the-bytes-are-projected)). District-scale
memory is left to a follow-up engine package: finest-mip residency by distance.

**Measurement note:** the human is on a remote session. Screenshots can differ slightly, and vsync or
frame-pacing performance is not tested here.

## Work

1. **Baseline.** Deliver the roof through the K1 pipeline as it stands: extract, geometry, maps and
   pack. Measure the kit with it, in the isolated preview and in the installed game, and attribute
   every MB by material, slot, mip level and geometry.
2. **Shared detail layers (engine).** A PBR material plugin, like the sun micro-shadow plugin, that
   samples one small shared tiling detail texture per material class (plaster, oak, stone, clay) in
   world or UV space. It modulates the normal, and the albedo and roughness slightly.
   - Unique maps then carry only macro structure and drop to macro density. For example, plaster falls
     from 1 mm to 3–4 mm, and oak and clay to 2–3 mm.
   - Fine grain, pits and fibres come from the shared tiles.
   - This is the largest expected lever: about 70% of today's bytes are the plaster and oak normals and
     ORMs at fine density.
   - The fields are authored split at the source (macro field plus a periodic detail tile), with the
     same seeds, so the look is regenerated, not approximated.
3. **Density by viewing distance.** Each surface's texel density follows its closest reachable camera:
   - Roof tiles are seen from 1 m only on raised streets; mostly from 5 m or more.
   - The eave underside is seen from 3 m or more.
   - Plinth tops and the paving are seen at 1.7 m eye height.
4. **Atlas and format.** Tighten the oak atlas packing (13.5 MB of empty shelf today). Put roughness and
   AO where BC1 suffices, and use two-channel normal formats wherever quality holds. Dedupe identical
   material content across the walls and roof (the same oak recipe).
5. **Geometry.**
   - Plinth: its runs are 80% of the house's triangles; decimate more aggressively where the normal
     map carries the relief.
   - Roof: LODs for the tiles; merge per-piece meshes that share a material.
   - Quantized vertex streams where meshopt does not already reach the floor.
6. **Residency (measure, design, build if it pays).** Stream the finest mip level only while a house
   using the kit is within its closest-camera range. Report how many MB that would save at district
   scale, given that the kit is shared by every house.
7. **Authoring.** Source renders of multi-house scenes use neighbours' delivered LODs and maps, or
   Cycles' texture limit. A courtyard must render within 16 GB.
8. **Roof installation.** Package the roof pieces as a library kit (or extend the walls kit). Add them to
   the test house assembly, then run class QA, the decode receipt and admission.

## Evidence and gates

- **In-game A/B** at matched cameras (street, 5 m, 1 m, 0.25 m) under lighting `@5`:
  1. today's walls;
  2. the naive roof delivery;
  3. the optimized kit.

  These use the delivery pipeline's Cycles re-import and pinned Chrome.
- **Measurements:**
  - GPU memory per material and slot;
  - triangles and draw calls;
  - GPU frame time at 4K street;
  - cell load time;
  - a projection to a four-house courtyard and to a full district.
- **D-195 quality and consistency screens.** The human decides acceptance of the look and of any
  disclosed loss.
- **Records:** a [decision](../../../../docs/decisions.md) entry for the per-house memory target and
  the detail-layer representation, both load-bearing for every later kit. The pin, WGSL and replay
  contracts are updated, and `pnpm check` passes.

## Must fix

- Any visible loss at 1 m or more, relative to the accepted source, under the same lighting.
- Visible tiling of the shared detail layers, such as a repeat grid or moiré at any distance.
- Seams, swimming, or detail that slides against the macro field when the camera moves.
- A kit over the target without a recorded, attributed cause and an approved target change.
- Any decode, upload, admission or pipeline-compile failure; a GPU frame-time regression over 10% at
  4K street.

## Out of scope

- Hip roofs.
- Interiors (D-208).
- Night presentation.
- Assembly A1's well-court placement.
- Chimneys and gutters.

## Allowance and end

- **Estimate:** two to three work sessions. Under D-207 the quality gate ends it, not the estimate.
- **Ends with one of:**
  - the house kit at or under target, installed with the roof and accepted by the human;
  - a measured, attributed failing lever with a proposed target change for the human.
