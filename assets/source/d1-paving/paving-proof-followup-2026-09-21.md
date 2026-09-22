# Apply the complete-stone workflow to the paving proof

Status: applicability reviewed on 2026-09-21; use surface-study cycle11 as the
experimental starting point for the next paving package. This selects a continuation
baseline, not final artistic acceptance. No new artwork, engine implementation or
asset admission was performed during this assessment.

Continuation executed later the same day: [bounded proof results](proof-2026-09-21/results.md)
retain a revised three-stone family, compacted contact sample and three reduced
bake/reimport checks. The original staged surface study is unchanged. This advances
the source proof; it does not complete the 4 m assembly or installed-game acceptance.

2026-09-22: the human approved the restored-family soil-to-stone edge. A
[moving-light diagnostic](proof-2026-09-22/relighting-results.md) with two independent
screens found no concrete directional conflict. Unlit relief-like contrast alone
did not establish contamination because mineral color intentionally correlates with
height. Preserve the restored material/contact and advance current portable evidence;
the clean-reflectance concern remains unproven, not a reason for another blind rewrite.

## Authority and retained baseline

Follow the new [production workflow](../../production-workflow.md) and its
[tested paving recipe](asset-creation-workflow.md). Develop shape, relief, color and
roughness together; inspect gray geometry, unlit color and opposite light separately.
The earlier gray-only prerequisite is historical and must not block this continuation.
Earlier failed masters remain rejected. A different authoring model is no longer a
prerequisite for progress: the new study supplies a materially better native asset
and an evidenced source-to-portable transfer path.

Preserve these originals; make changes in a new dated source directory with new scene,
material and output identities. Existing study scripts write fixed cycle paths and
may reuse named materials, so do not execute them in place as a new experiment.

- [Single source](surface-study-2026-09-21/cycle11/source.blend), its build script,
  seven diagnostics and retained generated inputs/provenance.
- [Three-stone source](surface-study-2026-09-21/assembly-cycle11/source.blend).
- [Portable stone](surface-study-2026-09-21/portable-cycle11/limestone.glb) and
  [verification](surface-study-2026-09-21/portable-cycle11/verification.json).
  Assessment independently matched GLB SHA-256
  `ddfbdd74f860f9c102d609cfbb3c00af725140f6ec79fcfcbd403f28529a8fbe`
  and parsed its actual header/material metadata: 9,912,844 bytes, one mesh/material,
  3900 triangles, three textures, base color, tangent normal and metallic/roughness.
  This is not a fresh full validator or engine run.

Lead actual-viewed the portable reimport, source gray/unlit/opposite-light images,
and assembly oblique/walking/opposite-light images. These establish visible progress
over the old masters. Their limitations agree with the study's existing screens:
fixed-looking pore lighting in color, pervasive grain, recognizable broad material
patches shared between variants, and overly clean sample-like soil joints.

## Apply in this order

| Stage | Work and exit evidence |
| --- | --- |
| Complete stone correction | Preserve the improved shape/material identity. Separate reflectance from lighting in the color source, restrain fine grain and restore quieter worn regions. Inspect textured, gray, unlit, opposite-light, reverse, grazing and walking-distance views from the first changed candidate. The unlit pass must not retain directional pore shadows/highlights that fight relighting. A color-only bake alone cannot fix lighting already in the input. |
| Small family and joints | Reuse the three-stone test first. Vary silhouette, dimensions and broad mineral placement together; texture shifts/rotations alone are insufficient. Develop recessed irregular compacted soil and embedded grit against MAT-018 batch108. Check no top intersections, floating stones, exposed continuous lips or decorative flat channels. |
| Portable family early | Bake each representative variant, not only the first stone. Render fresh imports and compare at walking/grazing distances. The existing 3900-triangle transfer is a useful template; it does not prove all three high-resolution source stones have portable equivalents. |
| 4 × 4 m installed-pattern proof | After the small sample survives screening, assemble the family using KIT-001 batch103's mixed sizes, short broken courses and infill. Judge recognizable repeats, material consistency, soil contact and edge transitions. Add sparse rooted broadleaf plants against VEG-001 batch116 using the same complete-asset workflow, not the rejected smooth fans. Use matched sunny/overcast geometry and cameras, plus a packing view and grazing contact detail. |
| Delivery and engine proof | Produce LODs, required texture/mesh compression and QA-admitted resources, then inspect the small sample through the ordinary installed game before enlarging runtime placement. Check moving camera, normal/tangent response, lighting, shadows, collision and LOD transitions. Measure generation/bake/install/load times, bytes, resident memory and representative frame costs. Human artistic acceptance and milestone performance qualification remain distinct. |

The three-stone assembly currently contains three approximately 1.73-million-triangle
source meshes. Do not populate the 4 m proof with dozens of those and call it a runtime
result. Use the source for authoring and the reduced family for delivery comparisons.
Current QA class remains eight variants, 4000/1200/400 stone triangles, three materials,
and the existing texture/scene/resource ceilings; no budget is changed by this plan.
The 9.9 MB uncompressed GLB is a transfer artifact, not a compliant shipping resource.
UV overlap/inversion, the LOD chain, KTX2/meshopt, full QA and rights review remain open.
Preserve accurate tangents/UVs and map color spaces; convert standard glTF roughness/
metallic packing into the engine's required ORM contract deliberately.

## First continuation package

Question: can the cycle11 stone retain its convincing material identity with clean
reflectance, quieter wear and distinct large-scale patterns in a three-stone joint
sample, while surviving the existing portable bake?

Initial allowance: six meaningful author/capture/evaluation cycles, 90 active minutes
and three hours elapsed including waits. Preserve each candidate and inspect it before
the next change; change a named defect, not unrelated parameters. Keep the two
independent first-pass quality/theme screens and lead actual inspection before
dependent revisions or handoff. Batch complementary diagnostics for each candidate.
Use a finite recorded extension only for a specific remaining question with expected
payoff; do not silently reset cycles. End with a human-reviewable complete candidate
or explicit unresolved criteria. Do not return to a mandatory gray-only gate.

Later family expansion, plants and engine integration each receive their own bounded
brief at their dependency boundary. These are the overall proof's remaining stages,
not claims that this assessment has executed them or that one session covers them all.

## Engine support remains part of the proof

Current PBR bindings support base color, normal and ORM maps, so first test this portable
representation through them. Seeded shape/edge variation, material variation or better
contact/foliage rendering remain valid engine candidates when the sample demonstrates
a need. Compare author-time variants with install-time generation/cache and runtime
generation on visual outcome and measured cost. Preserve deterministic seeds, matching
bounds/collision/LODs, QA and layer boundaries. Do not trade away the selected appearance
to avoid useful engine changes, or infer an engine limitation from a Blender-only test.

## Assessment verification

The staged workflow/source package matched its working-tree bytes before these planning
edits. The original staged assets and scripts were left unchanged. Actual images and
GLB identity/metadata were inspected; no new render, game test, full code review or
library gate is claimed. Physical smoke: deferred to M4.5 exit.
