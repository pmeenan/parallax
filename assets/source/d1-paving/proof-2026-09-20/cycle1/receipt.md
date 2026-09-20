# Paving source proof — cycle 1

Native Blender 5.2.1 LTS, build `9e2066aef7ef`, isolated factory scene. Authoring script: `assets/source/d1-paving/proof_20260920.py` (SHA-256 `d3b93f0922dd7577b9f56c642bd687237977511d98532c353db7921165cd276b`). Original `stone_geometry.py` reused unchanged (SHA-256 `eb1e14461c8bab0175063771c92c1ff652bcfc885582d90afa6382e201ba3be4`). Executable: `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`. No historical source/result replacement, export, admission, commit, or game placement.

Native author/render interval: 2026-09-20 20:52:53–20:54:54 UTC. Cycle 1 contains five direct native 1536×1024 PNGs, an image-packed source.blend, run.log, source-metrics.json, and a separate read-only topology audit. No postprocessing or concept pixels sampled into materials. Source/render SHA-256 hashes and byte lengths are in source-metrics.json; selected original texture/reference hashes are recorded there too. Source.blend was saved with the walking daylight camera before capture variants; script reproduces all five states.

Actual-viewed visual authorities before authoring: selected batch-103 assembly, batch-104 stone-family-v4, batch-108 cream limestone and joint soil, batch-116 courtyard broadleaf plants; selected single-surface source texture also viewed. Only the explicitly selected generated single-surface texture is sampled in the shader. Original procedural broad variation, bump, soil and leaf geometry supplement it.

## Measured source

- Paving construction cells span 4×4 m, with stone outlines inset at joints; substrate spans 4.7×4.7 m.
- 88 individually generated stone meshes; 179,300 stone triangles. Native BMesh audit: zero nonmanifold edges across all 88 stones.
- 64,800 substrate triangles, 1,800 instanced grit meshes (20 triangles each), 1,408 broadleaf triangles plus modeled vein curves; seven materials.
- Six rooted crowns actually placed. The target of 22 was not reached because conservative bounding-box clearance rejected remaining positions; no claim of 22 plants.
- Walking camera at (0, -3.5, 1.7) m, target (0, 0.15, 0), 40 mm lens. Sunny and overcast use identical geometry, camera and materials. Source-metrics.json records stone bounds, heights/exposure, root positions, and conservative crown clearance. Source-topology.json includes per-stone dimensions and image sizes.

## Actual-view findings — not accepted

All five outputs inspected. Unequal stone dimensions, broken course spans, infill and broadleaf forms are present, but the proof still looks too pale and slab-like compared with the selected references. Several shoulders remain rounded/manufactured; broad joint areas read as flat brown channels. Soil intersects localized depressions on some low stone tops, leaving unnatural brown islands. Plants are visibly broadleaf but too angular/folded and sparse. The top orthographic diagnostic clips the patch vertically because its 4.7 m horizontal span is used with a landscape frame; it is not a complete packing view.

These are disclosed failed or uncertain visual criteria, not waivers. Crown clearance does not prove full leaf contact/collision. Closed topology and source triangle counts do not prove LOD, runtime performance, calibrated PBR, collision, temporal stability or installed Chrome acceptance. Await both independent screens and root adjudication before the one remaining authorized author/render cycle.
