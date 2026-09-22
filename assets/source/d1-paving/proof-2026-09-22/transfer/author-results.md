# Restored-family transfer — author result

Completed one technical transfer package using Blender 5.2.1 LTS, build 9e2066aef7ef. The successful three-member run took 116.17 seconds. An initial wrapper path typo was corrected before any bake/export; no artistic repair or material tuning was performed.

Input is exactly `../restored-family/source.blend`, SHA256 `3e5de2f09d3aeaa3613ed10135d2ad550c928efe2ebf516661a43a781ee2fa9b`. Its file hash remains unchanged. This carries original cycle11 A and color-corrected remapped cycle11 B/C materials (seeds 787/829), with the lineage and unresolved rights recorded in that source's receipts. Reference lineage remains batch-104 kit-002-stone-family-v4 and batch-108 mat-001-cream-limestone-v1. No sidewall candidate is included.

Each member uses a four-object temporary source studio: the exact high stone, neutral ground, camera and light. Dense contact soil/grit is never linked into these studios. Adaptations of the prior study bake and verify procedures are retained as resolved scripts beside each output. Each low mesh is decimated to 3900 triangles, triangulated and freshly unwrapped; base color and tangent normal are 2048 square, roughness 1024 square. Standard PBR channels export into a single-mesh, single-material GLB. Native low studios remain editable as `a/portable.blend`, `b/portable.blend`, `c/portable.blend`.

| Member | Triangles | Raw GLB bytes | Import seconds | 8 MiB resource ceiling |
| --- | ---: | ---: | ---: | --- |
| A | 3900 | 10,157,440 | 0.159 | FAIL |
| B | 3900 | 10,502,016 | 0.014 | FAIL |
| C | 3900 | 10,957,176 | 0.015 | FAIL |

Actual GLB headers, lengths, embedded buffer, mesh/material/scene counts and standard texture channel presence were checked. Low coordinates and UVs are finite, UV values stay inside the unit square, and all low meshes are closed manifolds. Sampled source-to-low distances and native-versus-reimport pixel deltas are recorded in each verification and `results.json`; these are focused checks, not complete geometric or image-error bounds. A native/reimport mean absolute loaded-pixel difference is approximately 8.81e-7. Import timing excludes subsequent rendering.

Five matched native captures per member show high source, native low, fresh import, high source with opposing light, and import with opposing light. Author inspected A high/native low at full size and B/C high/low/opposing comparison sheets. Broad mineral identity, color and lighting response appear retained. Silhouette and fine relief are simplified; the captures do not establish production quality or conceal the original material's limitations. Independent screens and lead decide visual disposition.

All three raw GLBs exceed the existing resource ceiling. No KTX2, meshopt, LOD chain, shared-material conformance, UV overlap/inversion test, full glTF validator, engine roundtrip, texel-density check, runtime measurements or full asset QA were completed. RightsReviewed=false; source-only evidence, no library admission or public upload. The approved contact source, soil and live Blender session remain untouched.

`file-inventory.json` records hashes and bytes; `finalize.py` creates only mechanical comparison sheets and refreshes inventories. Run it after the Blender build to produce the final non-self-referential verification inventories. Full-size original PNGs remain available for visual judgment.
