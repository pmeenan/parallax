# Paving production diagnosis — 2026-09-21

The failures demonstrate an unsuccessful authoring method and feedback process. They
do not establish a Blender limitation, a web-renderer limitation, or that another
language model cannot do better. No usable replacement asset was produced by this
investigation; the following production method is a recommendation to test.

## Evidence inspected

- Recent turns in **Plan concept art catalog**, task
  `01a0744d-934b-7233-9464-19d574b3e48f`, including the assembly and master outcomes.
- Selected [stone family](../../reference/concepts/batch-104/kit-002-stone-family-v4.png),
  [limestone close study](../../reference/concepts/batch-108/mat-001-cream-limestone-v1.png),
  and [generated surface](../../reference/d1-paving-clean/limestone-single-surface-v1.png).
- Actual oblique images of all three fresh masters and the second assembly's walking
  daylight image; generation scripts, metrics, briefs and material provenance.
- Read-only MCP inspection of the active Blender 5.2.1 scene, named
  `Paving master 2026-09-20 cycle3`. The active object is
  `Connected fracture limestone master`. Its dimensions and counts match the saved
  cycle-3 metrics. The live scene was not modified.
- The installed renderer's material bindings in
  `engine/src/render/streamed-pbr-asset.ts`.

## What failed and why

**Dense geometry was mistaken for detailed geometry.** The live object has 666,236
vertices and 1,332,468 triangles. Its retained control mesh has only 102 vertices and
152 faces. In [cycle 3's construction](master-2026-09-20/build_master_cycle3.py),
27 perimeter sections and eleven side junctions define broad planar patches. Voxel
remeshing at 0.7 mm densifies those patches; it does not invent their missing fracture
detail. The only broad top hollow is 0.6 mm deep. The resulting large triangular
planes and nearly blank top are visible in the render. Higher source counts have
therefore supplied little additional visual information.

**The revisions changed the wrong representation.** Cycle 1 uses a quarry-like blank
and isolated cuts. Cycle 2 adds broad side noise beneath a much smoother top, giving
a rough-coated block appearance. Cycle 3 removes that noise and exposes the coarse
facets. These are different recipes, but none models the reference's combination of
irregular flake boundaries, localized erosion, and worn transitions across scales.
Procedural modeling itself is not disproven; these particular procedures failed.

**The assembly's mineral pattern has a specific shader cause.** In
[proof_20260920_v2.py](proof_20260920_v2.py), a noise field at scale 11 passes through
a narrow color transition between 0.455 and 0.515, then multiplies the generated
surface image. Dark gray and buff regions dominate the image as camouflage-like
patches. Fine bump comes from another noise field at scale 230, while roughness is
constant. A localized fracture attribute does influence edge color, but the dominant
mineral regions do not carry corresponding modeled or normal-map structure.

**The material input is incomplete for the selected target.** The earlier generated
surface is pale, fine-grained and relatively uniform; the approved 104/108 references
show larger differentiated worn regions and flaking. The surface's own provenance
correctly says it is a color/detail source, not a calibrated PBR set. Independent
noise did not supply the missing correspondence. Do not derive physical height
directly from image brightness or attach an unrelated scan's normals.

**Variation replicated the construction weaknesses.** The assembly generator starts
from one hard-coded outline and patch arrangement, perturbs them, and scales them
to fit different stones. It also fills a rectangular lattice. More seeds and pieces
cannot turn that limited shape vocabulary into the selected family and packing.

**The gray checkpoint was useful but too isolated as a production strategy.** The
reviewers were correct to reject the visible shape defects, and their briefs
explicitly excluded absent mineral color as a failure criterion. Nevertheless,
requiring geometry acceptance before any material development left the complete
surface untested. A gray view should expose silhouette, contact, broad relief and
shading defects alongside a material view. It should not require every pore or
mineral boundary to be sculpted into the shipping mesh. This is a proposed change to
the next brief, not retroactive acceptance of a failed master.

**The feedback loop detected defects more effectively than it repaired them.** Both
review screens and the lead found real failures. The missing step was translating
those observations into a tested construction mechanism. The master log estimates
45–50 active minutes across three cycles, excluding waits; this is not stopwatch
evidence. Full five-view capture and review followed each substantial build. A small
problem such as an edge transition needs cheap, frequent local previews before a
complete review packet. More review agents alone would not solve this.

**These failures precede the game renderer.** They occur in native Cycles captures.
The runtime already binds base color, normal and ORM maps. Additional engine features
may help the eventual asset, but cannot explain the present source defects. Neither
this audit nor the master attempts establish export or in-game appearance parity.

## Why successful public Blender demonstrations can look different

The [OpenAI architectural visualization case study](https://developers.openai.com/blog/architectural-visualization-with-astra)
describes editable geometry built with `bpy`, repeated render inspection, and a mixture
of authored procedural finishes and scanned materials. Its cinematic sequence uses
offline Cycles frames; transfer to Unreal involves separate material and lighting
work. That is evidence for a complete scene workflow, not a benchmark for original
worn-stone authoring. It also rules out treating background Python as inherently the
wrong authoring interface. The user's particular social posts were not identified.

Our inference: composed architectural scenes and isolated weathered stone impose
different demands. A simple outline can still require complex surface structure.
Lighting and material integration matter, but a beauty shot cannot substitute for
editable geometry or runtime acceptance. No comparative evidence here ranks OpenAI,
Anthropic or Google for this task.

## Proposed next experiment: one complete surface, then a small assembly

Keep selected 103/104/108 references and existing artistic standards. Start a new
source rather than continue tuning the three rejected masters. The unit of work is
one roughly 0.4 × 0.3 × 0.08 m stone with its complete material, followed only if
viable by three distinct stones and one soil joint. Plants wait for that result.

1. **Describe the visible construction at three scales.** Use geometry for the
   outline, thickness, major broken corners and exposed shoulders; authored relief
   for intermediate flaking and worn depressions; normal/roughness detail for fine
   pores and grain. Set dimensions from the reference interpretation explicitly.
   Flat tops can be intentional; perfectly uniform side treatment should not be.
2. **Build related surface signals.** Author fracture, wear, mineral and dirt masks
   as distinct fields with a common spatial basis. Use the relevant fields to drive
   relief, color and roughness together, without making every color change a height
   change. Begin with one small surface region and edge, then cover the whole stone.
   Generated images can guide or supply color, but do not automatically supply
   physically corresponding normals or displacement.
3. **Inspect gray and material versions together.** Keep camera, exposure and light
   fixed for comparisons. Add a raking-light view, rotate the light to expose painted
   shadows, and inspect at walking distance as well as close up. Isolate albedo,
   relief and roughness when diagnosing a defect. No paintover may stand in for the
   native render.
4. **Use a preview allowance suited to sculptural work.** Proposed allowance: at
   most six small author/capture/evaluation cycles and 90 active minutes, with
   elapsed time and waits recorded separately. This deliberately differs from the
   default two-cycle allowance because the previous work needed more local feedback.
   Retain cheap fixed-camera previews; make the full multi-angle review packet when
   a complete candidate is viable. Record a failure or justified new experiment at
   the boundary; time spent does not grant acceptance. Required independent screens
   and human artistic selection remain.
5. **Test transfer before kit expansion.** Retain the detailed source, derive the
   game mesh and matching maps, then compare source and installed Chrome under
   comparable camera/light conditions. Check normal direction, color space, texture
   scale, surface response, LODs and motion. Diagnose source, bake/export and runtime
   discrepancies separately. Any missing engine capability gets a focused test.
6. **Make actual variants.** Vary fracture arrangement, shoulder profile and outline,
   not just the proportions of one blank. Assemble three stones with embedded soil
   and scale-appropriate aggregate, inspect contact, then add one independently
   convincing plant. Only then enlarge the paving kit.

This is an original-authoring route consistent with the current selected inputs.
An existing locally retained scan could be proposed as a diagnostic control to test
lighting and transfer. It is not silently reinstated as the artistic baseline. New
external scans or paid 3D generation are separate choices; none were downloaded or
invoked in this investigation.

## Extending the process to the asset catalog

| Asset family | Starting representation to evaluate |
| --- | --- |
| Buildings, joinery, furniture, modular props | Dimensioned Blender geometry, reusable parts and shared materials |
| Stone, bark, ground and weathered surfaces | Shape plus coherent surface relief/material authoring, then baked game representations |
| Plants | A small set of authored leaf shapes/atlases with thickness or suitable light transmission, instanced around a believable plant structure |
| Organic hero objects and characters | A separate sculpting or specialized 3D-generation study, followed by topology, material and animation checks |

These are proposed routes, not claims that each is already proven in Parallax. A
single generic primitive-and-noise recipe should not become the entire art pipeline.
Turn a successful recipe into reusable tooling only after its output survives the
source-to-game test. Preserve the current QA/library boundary.

## Comparing authoring models fairly

A fresh author is reasonable now. Give each candidate the same selected images,
dimensions, allowed input assets/tools, preview/time allowance, and complete-surface
brief. Record the exact model and settings instead of inferring them from reviewer
names. Allow the author to choose the construction method, and compare resulting
workflows; this is not a controlled model-only benchmark unless the method is also
held fixed. Label renders without provider names for human comparison.

Require an editable native source, multi-angle gray/material renders, a relighting
test, and source provenance. Compare visual fidelity, rework effort, repeatability
and export loss. One good result proves a candidate workflow, not broad model
superiority. A specialized image-to-3D service is a different tool from asking a
language model to write Blender code; evaluate its actual mesh separately from a
convincing generated preview.

Investigation verification: live read-only geometry/material inspection, saved-image
inspection, script/metric cross-checks and documentation link checks. No new asset,
game code, engine code, dependency, budget or accepted-art status changed. No runtime
or performance test was run or claimed.
