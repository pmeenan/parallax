# 3D asset production workflow

This is the standing process for authored 3D assets (D-196). It is the method that produced the
human-approved [photoreal paving](source/d1-paving/proof-2026-09-22/photoreal-results.md)
(2026-09-22), after more than a dozen earlier bounded packages had not reached the concept art.
[procedural-authoring.md](procedural-authoring.md) holds the techniques, tested values,
failure modes and Blender API notes. The paving
[builder](source/d1-paving/proof-2026-09-22/photoreal/build.py) is the reference implementation.
This guide does not grant artistic acceptance or replace the reference → QA → library
boundary in [AGENTS.md](AGENTS.md).

## What made the difference

1. **Diagnose root causes before tuning.** Compare the current render with the selected
   references and name why it differs: its inputs, its representation, its lighting. Earlier
   paving cycles tuned a pipeline that could not reach the target:
   - a reused image-derived mineral texture
   - a studio area light
   - smooth mud joints

   Replace a foundation that caps quality. Don't polish it.
2. **One seeded script builds everything.** A headless Blender script generates geometry,
   material fields, scatter, plants, scene, lighting, captures, the source `.blend` and a
   receipt. Each iteration is an edit and a rerun, so every result is reproducible.
   Generated images are references to compare against, not texture inputs. They carry baked
   lighting and repeat recognizably; a brief must justify any exception.
3. **Author at explicit physical scales, and let structure drive colour.** Work down from
   layout (m) to form (cm) to surface (mm), leaving quiet areas. Give each object its own
   parameters. Derive colour from the same features as the geometry: pits hold dirt, chips
   are paler, stone feet are stained, grain drives the weathering boundaries.
4. **Author the delivery representation directly.** For surfaces, the height, albedo,
   roughness and detail-normal fields are made at the texel density the closest camera needs,
   and the geometry is displaced from low-passed height. The source maps are the delivery
   maps, so no bake step can lose detail.
5. **Derive integration, don't place it.** Contact comes from the primary fields:
   - soil level relative to the local object top
   - scatter drawn from visibility masks
   - plants draped onto the surface
6. **Judge under the reference's lighting.** Use a calibrated sun and sky, and match the
   concept's key direction. Keep overcast, low opposing sun, gray-geometry and unlit-colour
   views as standing diagnostics.
7. **Iterate fast and look every time.** Each preview loop takes one to two minutes. Inspect
   the renders and the raw maps, fix the named defects, repeat. The paving took seven
   previews and one final build in about an hour.

## Procedure

1. **Brief** — a few lines in the active plan note:
   - the selected reference IDs, plus any human direction that overrides them (for paving,
     the preferred smaller cobble scale overrode KIT-001's slab scale)
   - dimensions and viewing distances
   - the camera set, including a camera matched to any prior candidate
   - the must-fix defects
   - a time box (default: one work session) and the decision that ends the work
2. **Reference breakdown.** For each scale, list the visible traits to reproduce: layout,
   silhouette, edge wear, surface marks, colour structure, contact, vegetation, lighting.
   This list becomes the defect checklist.
3. **Scaffold the build** from the reference implementation:
   - seeded arguments, and a refusal to overwrite existing output
   - field generation and map writing
   - scene assembly, fixed views and the diagnostic modes
   - a receipt with hashes

   Keep iteration output in the session scratchpad.
4. **Preview loop.** Build at reduced settings: 2048² maps, 48–64 samples, 0.75 render
   scale, and two or three decisive views (walking-height, close, extreme close).
   - Calibrate sun against sky in the first pass.
   - Each pass, write down the defects you see against the reference, change their causes,
     rerun and compare with both the reference and the previous pass.
   - Crop the raw maps.
   - Snapshot the script at each pass.
   - Stop when the checklist is met or the time box ends.
5. **Final build into the repository:** full resolution, 256 samples, the full view set,
   `--save-blend`, plus a side-by-side against the prior candidate from the matched camera.
6. **Independent screens (D-195).** Give fresh subagents only the references, the brief and
   the renders, for a quality screen and a consistency screen. Fix what they find, or
   disclose it.
7. **Handoff.** Write a short results note:
   - status
   - root causes and what changed
   - the views, and known limits
   - reproduction steps

   Update the plan and the source README pointers. The human decides artistic acceptance;
   record that decision in the note, the README and the plan. Agents never commit.
8. **Delivery is a separate package.** It covers:
   - LOD meshes (decimated heightfield or retopology) and the authored maps as KTX2
   - runtime instancing for scatter
   - export, the Khronos validator and a fresh import
   - an installed Babylon/WebGPU inspection
   - measured costs against the class budgets
   - rights review, QA and library admission

   Source approval makes no runtime, budget or QA claim. The handbook's
   [delivery section](procedural-authoring.md#delivery-tested-on-the-photoreal-paving-2026-09-24)
   records the tested decimation, map and inspection methods. D-197 suspends the old size caps
   while real costs are measured.

## Iteration allowance (D-196)

Scripted preview passes inside a time-boxed work session don't consume D-182's
implementation/capture/evaluation cycles. Those cycles count **full-quality candidate
handoffs**, two by default. The time box, the extension rules and the rule that time expiry
never grants acceptance are unchanged. An extension names the remaining question and a new
time box.

## Keep this current

Update this guide and the handbook when a tested asset changes the reusable process. The first
asset of each new class (props, walls, vegetation kits, characters) records where the
ground-surface method had to change. Keep asset-specific recipes, failed attempts and evidence
with their source packages. The earlier
[paving study recipe](source/d1-paving/asset-creation-workflow.md), which covered
generated-image stone material and bake transfer, is historical evidence, not the current
method.
