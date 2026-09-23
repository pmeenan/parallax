# Paving asset creation workflow — tested 2026-09-21

**Historical (superseded 2026-09-22, D-196):** the approved paving is the procedural
[photoreal rebuild](proof-2026-09-22/photoreal-results.md). Its script-first method is now
the [standing production workflow](../../production-workflow.md), with techniques in the
[authoring handbook](../../procedural-authoring.md). The generated-image stone material and
bake-transfer recipe below are retained as evidence only. They include the
"next comparison" proposal, which the human resolved by choosing the photoreal method.
Do not follow them for new work.

Status: a substantially improved, editable stone and successful source-to-GLB transfer;
not final reference matching or game acceptance. Cycle 11 is the best source from this
study according to the lead and both independent visual screens. The remaining work
is specific: remove image shading from color, create quieter worn regions, give the
variants different large material patterns, and develop installed soil joints.

## Inspect the actual result

- [Reimported 3900-triangle stone](surface-study-2026-09-21/portable-cycle11/reimport.png)
- [Three source stones on soil](surface-study-2026-09-21/assembly-cycle11/oblique.png)
- [Opposing assembly light](surface-study-2026-09-21/assembly-cycle11/reverse-light.png)
- [Unlit source color — exposes the remaining shading problem](surface-study-2026-09-21/cycle11/basecolor-unlit.png)
- [Gray geometry](surface-study-2026-09-21/cycle11/gray.png)
- [Editable single source](surface-study-2026-09-21/cycle11/source.blend), [assembly source](surface-study-2026-09-21/assembly-cycle11/source.blend)
- [Portable GLB](surface-study-2026-09-21/portable-cycle11/limestone.glb), [portable studio](surface-study-2026-09-21/portable-cycle11/portable.blend)

All result images are native Blender renders. ImageGen supplied two intermediate
surface images; it did not supply or retouch the final renders. No purchased mesh,
photogrammetry scan, external AI provider or engine change was used.

## What changed the outcome

The prior gray master put roughly 1.3 million triangles into a weak control shape.
This study's first procedural attempts also failed: increasing subdivision or
combining unrelated noise did not create the reference's characteristic limestone.
The useful change was developing shape, surface structure and material together,
looking at a native preview after each concrete change, then checking them separately.

| Attempt | Observed outcome | Retained lesson |
| --- | --- | --- |
|1–2: procedural noise and broad color fields | Smooth camouflage, manufactured block | More random detail is not more geological structure |
|3–4: generated scalar field, then reduced/filtered relief | Stone identity improved; initial displacement was crumbly | Interpret any synthetic field at explicit physical scale; never trust its label |
|5–6: macro material interpretation | One invalid blank-image pass, then improved mineral patches | Verify actual pixels after Blender image initialization |
|7–8: aligned generated color and shaped shoulders | Best early stone; a deformation bug left thin lips until fixed | Inspect gray and reverse views alongside material |
|9–10: quieter wear and three source variants | Better perimeter; quiet pass became flat; mineral contrast still pale | Preserve a hierarchy of detail, not blanket smoothing |
|11: stronger worn gray reflectance with unchanged geometry | Closest palette and strongest overall source | Color contrast can fix a material problem without more geometry |

The successful transfer is important but limited: the final stone reduces from
1,730,560 source triangles to 3900 triangles, one material and three embedded textures.
The GLB is 9,912,844 bytes using PNG textures. Base color and normal are 2048²;
roughness is 1024² and is packed into standard glTF metallic/roughness output by the
exporter. This is an uncompressed source proof, not the shipping payload.

The final bake took 5.11 seconds; decimation, UVs, bake, render, export and source save
together took 25.50 seconds on this machine. Native source construction was 9.48 seconds.
These are local observations, not game frame-time or cross-machine benchmarks.

[Verification](surface-study-2026-09-21/portable-cycle11/verification.json) checks actual
GLB bytes, standard material channels, one scene/mesh/material, closed manifold geometry,
finite positions and UVs in 0–1, and a fresh Blender import/render. The original low
mesh and imported GLB renders differ by mean absolute pixel value 0.00000124 in Blender's
loaded image values. Of 8653 sampled source vertices, distance to the reduced surface
is 0.565 mm at p95 and 3.133 mm maximum. This is a sampled approximation, not a complete
surface-error bound. Full UV overlap validation and game QA remain unrun.

## Reusable process

1. **Make one complete asset against selected references.** State real dimensions,
   target camera distance, shape traits, material traits and a finite iteration
   allowance. Here: KIT-002 batch 104, MAT-001 batch 108, KIT-001 batch 103; nominal
   single stone 40 × 30 × 8 cm. Do not start by repeating a weak block across an area.
2. **Separate the scales of detail.** Author the silhouette and localized edge loss
   in centimetres; worn mineral regions in centimetres; shallow pits and grain in
   millimetres. Leave quiet areas. Reserve geometry for form and silhouette and
   use the bake for detail that need not survive in the mesh.
3. **Treat generated images as provisional art inputs.** Retain exact prompts,
   original bytes and reference hashes. Our requested height image still contained
   photographic-looking illumination; it was a filtered, capped artistic displacement
   input, not a recovered or calibrated height map. A prompt saying "no lighting"
   is not evidence that an image is free of lighting. Do not blindly convert arbitrary
   photograph brightness to height.
4. **Develop shape and material together; diagnose them separately.** Save fixed
   oblique, opposing-light, reverse-camera, grazing, gray, walking-distance and unlit
   color views. Start the unlit view in the first textured cycle. This study added it
   too late and caught baked-looking pore shading after substantial surface tuning.
   Change one named defect per pass and reject regressions explicitly.
5. **Bake the first viable candidate early.** Reduce to the existing 4000-triangle
   ceiling, unwrap, and bake color without direct/indirect illumination, tangent
   normals from the source and roughness. A color-only bake excludes Blender scene
   light; it does not remove illumination already inside an input image. Preserve
   the source and render the actual exported/reimported GLB.
6. **Test a small family and actual contact.** Change silhouette, dimensions and
   large material-region placement. Three seeds and shifted texture coordinates
   were enough to test the method here, but reviewers could still recognize shared
   patches. Cropping/rotating one source is not sufficient variety for a full kit.
   Judge recessed soil and shadows before decorative foliage or cinematic dressing.
7. **Keep source success separate from delivery.** Human artistic review comes next.
   A selected production candidate still needs rights review, full library QA,
   LODs, KTX2, meshopt and Babylon/WebGPU installed-game inspection. This study
   creates no library entry and makes no runtime quality/performance claim.

## Exact reproduction of this candidate

The retained [authoring files](surface-study-2026-09-21/) target native Blender 5.2.1
LTS with NumPy, Cycles, AgX and the existing OptiX device. They use fixed seeds and
absolute paths for this checkout. Use a fresh Blender instance for a clean replay;
the scripts create new scenes and do not delete existing work. Re-running a saved
cycle in the same session can reuse its named material, so use a new cycle identity
when testing a changed material.

In Blender's Python console or through the live Blender MCP, execute each retained
file with `exec(compile(Path(path).read_text(), path, 'exec'))`, with
`from pathlib import Path` first. The order is:

1. `build.py` — selected single source, default cycle11; generates its source scene.
2. `capture.py` — seven fixed source diagnostics, packed single source and receipt.
3. `bake.py` — 3900-triangle UV mesh, 2048/2048/1024 maps, low studio and GLB.
4. `verify_portable.py` — byte inspection, sampled mesh check and fresh import render.
5. `assembly.py` — three independent geometry seeds and a procedural soil contact scene.
6. `save_standalone.py` — run only in a separate background Blender process with
   `--background --factory-startup --python-exit-code 1 --python <script path>`.
   It packages the three final scene libraries as ordinary standalone Blender files
   with the intended scene/camera active. All material images are packed.

The two retained generated inputs make this replay independent of another ImageGen
call; image generation itself is not deterministic. Do not overwrite accepted sources
with a replay. Earlier cycle scripts and previews are experimental history, not
alternative current production entry points.

Two Blender-specific fixes belong in the recipe: set generated-image color space
**before** writing pixels, then verify RGB data; and export with both selection and
**active scene** scope. Otherwise this live multi-scene session exported selected
objects from older scenes. Neither issue was a Babylon limitation.

## Next comparison and acceptance question

Give Anthropic/Google the same selected references, 40 × 30 × 8 cm brief, tool access,
camera/light profile and finite allowance. Require editable source, the seven
diagnostics, three variants and a 3900–4000-triangle textured export. Record whether
they start fresh or improve this candidate; those answer different questions.
If a scan or external generator is used, disclose that separately from model-authored
geometry. Compare the actual assets under the same views, not only selected beauty
images. No provider ranking is established by this single run.

The next material experiment should answer one question: can separately authored
reflectance and true relief preserve the current stone identity while eliminating
fixed pore lighting? Then reduce pervasive grain, break shared broad patterns and
add irregular compacted joint fill. Both reviewers and the lead consider cycle11 a
useful experimental baseline; all three still identify gaps from the selected art.
The existence of an editable model and successful bake does not close those gaps.
