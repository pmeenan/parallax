# Photoreal cobble paving rebuild — 2026-09-22

**Human approved (2026-09-22) as the visual baseline, replacing `production/candidate3`.**
The human was not happy with the realism of candidate3 and asked for more photorealistic
stone, soil, grit and plants that match the concept art more closely. This rebuild keeps the
approved smaller-cobble scale, but its layout, stones, materials, grit and plants are new.
The human approved it after seeing the lead-inspected handoff below, and asked that its
method become the standing process: D-196 and the
[asset production workflow](../../../production-workflow.md). The independent D-195 screens
were not run before approval. Future candidates run them before handoff. Approval covers
source appearance only. No runtime code, QA ceiling, library asset or budget changed, and
delivery, rights, QA and admission remain open.

References: KIT-001/KIT-003 batch103 (assembly, edge), MAT-001/MAT-018 batch108
(cream limestone, joint earth) and VEG-001 batch116 (joint plants).

![Old approved candidate3 (left) and new candidate1 (right), same camera](photoreal/candidate1/compare-walking.png)

## What changed and why

The old proof had four root causes that parameter tweaks could not fix:
- one repeated image-derived mineral pattern gave every stone the same pink-grey granite look
- an area light flattened the relief
- the joints were smooth mud
- the grit was low-poly hexagons, and the plants were flat clover sprites

[`photoreal/build.py`](photoreal/build.py) rebuilds the patch procedurally, with no
image inputs, as a **periodic 4 × 4 m** field. Candidate1's mesh boundary has the
position and normal limitations recorded below; seamless geometry is not yet qualified.

- **Layout:** coursed setts in 24–36 cm courses. Slot rectangles run 16–54 cm on the
  long side and 11–37 cm on the short side. Joints are staggered
  against adjacent courses (including across the wrap). Some slots split into 2×2 small
  setts, half-depth pairs or split lengths. There are per-edge joint gaps of 1–2.8 cm,
  corner jitter, ±0.7° rotation and a gentle periodic warp, so courses are not
  ruler-straight. 183 stones per tile.
- **Stone form:** each stone is a rounded, jittered quadrilateral. It has a per-stone
  top height and tilt, broad undulation, and eroded shoulders that vary along the edge.
  It also has spalled chips that deepen toward the edge, three scales of irregular pits,
  hairline cracks on some stones, and clast/grain micro-relief.
- **Stone colour:** each stone gets a per-stone cream/tan/grey-beige base. Grey
  weathering zones form clast-by-clast, which gives the granular boundaries seen in
  MAT-001. The stones also carry iron staining, dirt in pits and cracks, paler fresh
  chips, soil staining on stone feet and light cavity occlusion.
- **Joints:** the soil level follows the local stone-top level, so low-set stones are
  never flooded. The joint soil has crumb relief, dry/damp variation and painted
  micro-grit. It also holds 29,204 instanced pebbles (24 rounded/angular variants,
  mixed tones, partially bedded), sparse moss colonies creeping onto stone feet, 5
  broadleaf rosettes, 7 seedlings and grass tufts. The leaves drape over neighbouring
  stones instead of intersecting them.
- **Light:** a warm sun at 30° cross-lights the scene, with a Hosek-Wilkie sky fill,
  Cycles/OptiX and the AgX High Contrast look.

## Views (native Cycles, 256 samples)

- [walking](photoreal/candidate1/walking.png)
- [old-camera match](photoreal/candidate1/walking-matched.png)
- [overview](photoreal/candidate1/overview.png)
- [top/tiling](photoreal/candidate1/top.png)
- [plant close-up](photoreal/candidate1/close.png)
- [joint close-up](photoreal/candidate1/joint.png)
- [low opposing sun](photoreal/candidate1/grazing.png)
- [overcast](photoreal/candidate1/overcast.png)
- [gray geometry](photoreal/candidate1/gray.png)
- [unlit colour](photoreal/candidate1/unlit.png)

Presentation repeats the 4 m patch 3 × 4 by translation. The top camera covers exactly
one tile, placing the boundaries at the image edges; it does not verify tile joins.

Lead-only inspection: no independent screens have run. Each iteration was compared
against the references, and the named defects were fixed across seven build/capture
cycles:
- moss painted onto stone tops
- over-deep joints
- black pits
- camouflage-like mottling
- soil flooding over low stones
- buried pebbles
- glossy plastic leaves

## Known limits

- **Tile boundaries (review finding).** Evaluating the retained candidate1 mesh in
  Blender 5.2.1 found opposite-edge height differences up to 4.083 mm. Its displacement
  texture uses `EXTEND`, which clamps the periodic texel-centre samples. The current
  builder uses `REPEAT`; a full-resolution review rebuild reduces the maximum gap to
  approximately 0.0011 mm. Edge normals still differ (up to 53.1° in the wrapped
  source probe), so delivery must reconcile boundary normals and inspect joins under
  grazing light. The approved candidate1 bytes remain unchanged. Run
  [`photoreal/verify-edges.py`](photoreal/verify-edges.py) on rebuilt sources; candidate1
  is the failing regression control. This check covers edge positions only.
- **Heightfield source.** The stones have no undercuts. At the 22 cm-high joint camera,
  the stone sides and tops look soft; detail is limited by the 0.98 mm texel.
  At walking distance this does not read.
- **Plants are simple procedural geometry.** Each rosette has 5–8 ovate leaves, the
  grass is ribbon blades, and the moss is painted relief plus colour, not strands.
- **Repetition.** The 4 m translation period could show on very large open areas.
  Also, 183 stones is more than the 137 in the approved layout.
- **Not delivered.** The source ground is a 2.56 M-vertex displaced grid. Delivery would
  use a decimated heightfield mesh plus the albedo, normal, roughness and height maps,
  with runtime grit instancing. None of that has been built or measured, and no
  QA/admission, rights review or installed-game check has run.
- **Rights.** All content is procedural; no generated or external images were used.

## Reproduce

Run with Blender 5.2.1 from `proof-2026-09-22/photoreal/`:

```text
blender -b --factory-startup --python-exit-code 1 --python build.py -- --out candidateN --save-blend --samples 256 --views walking,walking-matched,overview,close,joint,grazing,overcast,top,gray,unlit
blender -b --factory-startup --python-exit-code 1 --python verify-edges.py -- candidateN/source.blend
```

The original abbreviated command selected only `walking` at 128 samples, omitting
the nine other evidence views. For the exact pre-review recipe, use
[`candidate1/build-snapshot.py`](photoreal/candidate1/build-snapshot.py) in place of
`build.py` with the full arguments above. This snapshot was retained during review
before correcting the builder (SHA-256
`3f791ded4fc479e9ac14bffcf8e50eed19efbaa5435832c947b9d17d482466d1`).
It retains the clamped-edge defect. New builds retain and hash their own script snapshot.

The builder refuses to overwrite a non-empty output. The full build (4096² maps and ten
renders) took 148.5 s on the RTX 4080 SUPER. [receipt.json](photoreal/candidate1/receipt.json)
records the arguments, counts and file hashes. `source.blend` references the maps
under `maps/` and regenerates the ground through Subdivision + Displace modifiers.
The comparison image was composed afterwards from the two walking renders. The
interactive Blender MCP was not used; isolated background Blender ran every build.
Changes remain uncommitted.

## Review verification — 2026-09-23

A fresh full-resolution, ten-view rebuild with the corrected builder passed the
position-edge regression check (maximum 0.001054 mm), while the original source
failed (maximum 4.082503 mm). Its layout and all eight maps are byte-identical to
candidate1. The rebuild is review scratch, not a newly accepted asset. Walking and
overview captures were inspected; boundary normals remain the limitation above.
The original 20-file receipt and historical delivery's 96-file inventory match their
bytes and hashes. All six historical delivery GLBs independently validate with zero
errors and 32 tangent warnings each, matching their retained reports.

The repository build and independent engine rebuild pass. `pnpm check` stopped at
119 lint errors, including two formatting errors in this proof's retained JSON
evidence; the unit-test stage does not run. No green full-check claim is made.

**Follow-up verification (lead, 2026-09-23):**
- **JSON formatting.** The builder now writes `layout.json` and `receipt.json` in the
  repository's Biome format; its output was compared byte-for-byte with Biome on all
  three evidence files. Candidate1's two files were re-serialized with parsed content
  asserted unchanged. The receipt's `layout.json` entry was updated to the new bytes, and
  all 20 receipt identities verify. The pre-reformat SHA-256s were
  `2c3831d7af1ec33cad575e841b943c1457b0ec5c50233615089b07d91003e6c1` (layout) and
  `13fe5ca11c4ed3a249a1ecd68cf0dd86c1be3ad66db0588ee1bb5bbd641d0932` (receipt). Biome
  reports no errors in `photoreal/`, so the two added lint errors are gone and the
  repository returns to its 117 pre-existing lint errors.
- **Independent rebuild.** A separate full-resolution rebuild with the corrected builder
  reproduced candidate1's layout and all eight maps byte-for-byte. It passed
  `verify-edges.py` (maximum gap 0.0011 mm), while candidate1 failed it (4.083 mm), which
  confirms the finding.
- **Render comparison.** Against candidate1, 0.04% of walking-matched pixels differ
  by more than 2/255, and none in the plant close-up. In the gray view the only coherent
  difference is the distant tile seam; the rest is scattered sampling noise.
- **Edited builder.** A smoke build with the JSON-writer change completes and passes
  the edge check.
Physical smoke: deferred to M4.5 exit — source rebuild, edge regression, artifact
identities and structural checks only.
