# 3D asset production workflow

Use this process for authored 3D assets. It carries the reusable lessons from the
[paving study](source/d1-paving/asset-creation-workflow.md) into future production;
that study's stone material, scripts, dimensions and budgets remain a provisional
asset-specific example. This guide does not grant artistic acceptance or replace
the reference → QA → library boundary in [AGENTS.md](AGENTS.md).

1. **Define one bounded proof.** Cite selected reference IDs and the applicable kit
   specification and QA class. State dimensions, intended viewing distance, material
   and silhouette traits, relevant camera/light states, must-fix defects and a finite
   allowance under [the project workflow](../docs/workflow.md#bounded-visual-and-research-work).
   Start with one complete representative asset before expanding a kit or scene.
2. **Develop shape and material together.** Distinguish silhouette, larger surface
   features and fine grain. Author them at explicit physical scales, with deliberate
   quiet areas. More subdivisions or uniform noise do not establish reference fidelity.
   Use the local Blender tools and retain editable source.
3. **Inspect every meaningful iteration.** Capture and inspect the actual native
   result against the reference. Use stable cameras and lighting for comparisons;
   change a named defect and record the outcome. For surface work, inspect gray
   geometry, unlit base color and opposing light from the first textured candidate,
   plus reverse/grazing views and intended viewing distance where relevant. Add
   motion or other states when the asset requires them. Do not substitute a generated
   still or paintover for a render of the asset being evaluated.
4. **Verify generated inputs instead of trusting their labels.** Preserve prompts,
   reference identities, original bytes and provenance. A requested height map may
   contain photographic shading; a requested albedo may retain highlights and shadows.
   Inspect those properties before building around them. A color-only bake excludes
   scene illumination but cannot remove lighting already embedded in a source image.
5. **Test delivery early.** At the first viable source, produce a representative
   export within the applicable asset-class budgets. Bake detail where appropriate,
   inspect actual file contents and render a fresh import. Preserve source and export
   separately. Record which checks ran; a successful Blender import is not evidence
   of Babylon/WebGPU compatibility or game performance.
6. **Test a small family in context.** Check distinct silhouettes and large material
   patterns, repetition, physical contact, seams and scale before broad replication.
   Texture offsets or rotations alone may leave recognizable repeated features.
7. **Deliver evidence and retain the acceptance boundaries.** Save representative
   captures, editable source, reproduction steps, measured costs, hashes, provenance,
   known limitations and the next unresolved question. Apply the bounded-work outcome
   and human artistic gate. Production delivery still requires rights review, full
   asset QA, library admission and installed-game inspection. Follow
   [asset storage](storage.md); agents leave changes for the human commit.

Update this guide when a tested production lesson changes the reusable process.
Keep asset-specific recipes and failed-attempt evidence with their source packages;
do not silently promote experimental material techniques into accepted standards.
