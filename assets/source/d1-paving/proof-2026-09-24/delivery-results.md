# Photoreal paving delivery — result (2026-09-24)

**Candidate 2 is ready for human review.** It preserves the approved photoreal look through
export and fresh import, and renders the same asset correctly in pinned Chrome. It is not yet
installed: the streaming path rejects its maps, and making the ordinary install path carry it is
the next engine package ([brief](install-brief.md)). D-197 suspends the greybox-era size caps
while real costs are measured.

In Chrome, the remaining gap to the approved image comes mostly from the game's current lighting
model, not from the asset. Rights, class QA, admission and human artistic acceptance remain
open. The package used its two candidate handoffs within one work session ([brief](delivery-brief.md)).

![Approved source, fresh import, pinned Chrome with game lighting](candidate2/compare-walking-matched.png)

Left to right:
1. the approved Cycles source
2. the delivery GLBs, freshly imported and rendered under the same camera and light
3. the same runtime bytes in pinned Chrome 152 with Babylon Lite 1.12, under the game's lighting

The [1:1 crop](candidate2/compare-walking-matched-crop.png) shows the stone mineral pattern,
joints, pebbles and plants matching.

## Cycles

- **Candidate 1** passed lead inspection. Both independent screens then found black slits and
  shards: 450 LOD0 ground triangles faced downward and 1,416 were steeper than 75°
  ([quality](quality-delivery1.md), [fidelity](fidelity-delivery1.md)). meshoptimizer rejects
  a single collapse that flips a face, but successive collapses folded steep sidewalls over.
  Earlier previews had also shown that a 5 mm starting grid lost joint depth.
- **Candidate 2** changes:
  - Ground simplification runs on a copy with height × 0.02, so every fold becomes a rejected
    flip. It measured 0 downward faces against 1,142, and the packer now asserts this.
  - Pebble shells have 64 triangles, and the smooth variants keep the source's normals.
  - A 10% plant LOD2 replaces the plant cut-off at 24 m.
  - The normal map ships losslessly.

## Representation

One periodic 4 m module: ground, pebbles and plants, each with three LODs. Everything uses the
engine's existing 32-byte position/normal/UV layout and PBR material.

- **Ground.** The approved 16-bit height field is sampled on the source's 2.5 mm grid, then
  decimated with every border vertex locked. Opposite edges keep identical vertex sets and
  heights, so tiles close exactly. Vertex normals face up; a full-height normal map (low-pass
  slopes plus the approved detail normal) carries all shading. Every LOD therefore shades
  identically, and the boundary-normal mismatch found in review cannot occur.
- **Pebbles.** A top-down Cycles render draws all 29,204 source pebbles into the base colour,
  normal and roughness at their exact placements (3.35% of the tile). The 3,927 of 9 mm or more
  are also real shells with true normals. They take their colour from the same base-colour map
  through planar UVs. LOD1 keeps the 884 of 13 mm or more.
- **Plants.** Unchanged source geometry with a 1024 × 512 atlas (leaves, grass, stem) and a
  luminance bump normal, plus explicit back faces. The pipeline is opaque and back-face
  culled. Translucency is not reproduced.
- **Maps.** Base colour 4096², UASTC. Normal 4096², lossless RGBA8 + zstd 19. ORM 2048²: R = 1,
  G = roughness, B = 0 metallic, UASTC. Lite applies ORM occlusion only to image-based
  lighting, which the game has none of. The height map is not shipped; the geometry carries it.

| Part | LOD0 triangles | LOD1 | LOD2 | Meshopt bytes (all LODs) |
| --- | ---: | ---: | ---: | ---: |
| Ground (1 / 3 / 6 mm vertical error) | 180,748 | 31,316 | 4,936 | 1,833,573 |
| Pebbles (≥ 9 mm, 64 tris / ≥ 13 mm, 24 tris) | 251,328 | 21,216 | — | 9,668,992 |
| Plants (100 / 35 / 10%) | 38,408 | 13,442 | 3,780 | 1,018,804 |

Runtime resources total 88.8 MB: 12.5 MB of geometry and 76.3 MB of maps. Of the maps, the
lossless normal is 46.2 MB and the UASTC base colour 22.4 MB. zstd on the UASTC maps would bring
the total to 82.6 MB.

Uploaded as RGBA8, the maps need 209.7 MB of GPU memory. The UASTC maps could use BC7, but the
lossless normal stays at 85 MB. Merged pebble shells are 77% of the geometry bytes; per-instance
GPU data would shrink them to about 0.1 MB.

On the normal map, UASTC left 24% of texels more than 5° off. Under today's lighting, a Chrome
A/B still differed by only 0.8/255 mean in rendered pixels. The lossless map is cheap insurance
for stronger light.

## Checks

- **Seams.** Packer assertions prove identical border sets and heights for every ground LOD. The
  [four-tile corner](candidate2/import/join.png) shows no join line under a 12° sun, in Cycles
  or [in Chrome](candidate2/chrome/join.png). The approved source's own clamped-displacement
  seam is absent.
- **Encoding.** Meshopt vertices roundtrip byte-exactly, and triangles roundtrip up to cyclic
  rotation. Every KTX2 decodes from its serialized bytes, and the lossless normal matches its
  source exactly. The Khronos validator (2.0.0-dev.3.10) reports zero errors on all three GLBs,
  with only the expected runtime tangent-space warnings.
- **Fresh import.** Two Cycles-only artifacts come from choices made for the rasterizer, and
  the fresh-import views correct both:
  - **Terminator offset 1.0 on the ground.** At Blender's default, flat-normal steep faces
    self-shadow into thin black wedges
    ([diagnostic](candidate2/import/joint-default-terminator-diagnostic.png)).
  - **One plant face per coincident pair.** Cycles shades both sides of a single face and can
    hit either copy of the explicit back faces. With both copies, lit plants measured 0.72×
    the source's green ([diagnostic](candidate2/import/close-coincident-plants-diagnostic.png));
    with one, 1.21×. Chrome measures 1.08×.

  The game's rasterizer back-face culls the copies and does not ray-trace its own geometry for
  lighting, so neither artifact can occur there. The views:
  - [walking](candidate2/import/walking-matched.png)
  - [close](candidate2/import/close.png)
  - [joint](candidate2/import/joint.png)
  - [grazing](candidate2/import/grazing.png)
  - [gray relief](candidate2/import/gray.png)
  - [mixed-LOD walking](candidate2/import/walking-mixed-lod.png)
- **Chrome.** The worker renders the decoded runtime bytes through the engine's own
  `uploadStreamedPbrTexture`, `createStreamedPbrMaterial`, `repeat` sampler, thin-instance pool,
  `sampleEnvironmentLighting` and `createDirectionalShadows`. It bypasses only the caps. There
  were no browser errors or external requests. Layout, UV orientation and normal-map handedness
  match the source:
  - [walking](candidate2/chrome/walking-matched.png)
  - [close](candidate2/chrome/close.png)
  - [joint](candidate2/chrome/joint.png)
  - [4K crop](candidate2/chrome/walking-4k-mixed-crop.png)
- **LOD.** A [12–32 m view](candidate2/chrome/mid-mixed-lod.png) is visually identical between
  all-LOD0 and the game's LOD selection. The 4 m repetition is visible across large open areas,
  as the source already disclosed.

## Costs (isolated preview, RTX 4080 SUPER; diagnostic, not budget evidence)

The view is 4K with the game's LOD selection over 195 tiles (52 × 60 m), CSM included. After a
60-frame warm-up:

| Configuration | p50 GPU | p95 GPU |
| --- | ---: | ---: |
| Empty scene | 0.20 ms | 0.22 ms |
| Ground only | 3.39 ms | 3.56 ms |
| + pebbles | 4.33 ms | 4.45 ms |
| + plants | 4.80 ms | 4.89 ms |
| 2048² maps instead of 4096² | 4.60 ms | 4.86 ms |

Thin instances have no culling, so tiles behind the camera are drawn too, and GPU time
includes the CSM passes. Candidate 1's forced all-LOD0 view measured 21 ms at 67M triangles.
2048² maps were [visibly softer](candidate2/chrome/texture-4096-vs-2048.png) near the camera at
4K, which justifies 1024 texels/m. Loading and uploading all maps took 1.8 s.

## What the runtime exposes (engine work, not asset defects)

The [raised-exposure diagnostic](candidate2/chrome/walking-matched-bright-diagnostic.png) brings
the asset close to the source, so most of the remaining gap is the renderer:

1. **Lighting balance.** At 30° elevation the game's sun is 0.6 intensity with 0.25 hemispheric
   ambient, and there is no exposure or tone mapping. The result is dim and flat.
2. **No ambient occlusion.** The hemispheric ambient is unoccluded, so joints and sidewalls stay
   lit. The [rim diagnostic](candidate2/chrome/rim-diagnostic.png) localizes the pale, fringed
   stone edges:
   - Under ambient only they look the same with or without the normal map, so they are
     stretched planar-UV sidewall albedo.
   - Under the sun only, the normal map correctly darkens sidewalls that face away.

   Cycles hides these texels in shadow. The fix is an occlusion term for the ambient: a
   height-derived AO in ORM.R that the engine applies to hemispheric light. Lite shades
   hemispheric specular with the light's diffuse colour, so an earlier "ambient specular off"
   test changed nothing and was discarded.
3. **Small-scale shadows.** The CSM (four 1024² cascades) puts its first split near 13.6 m, so
   leaf, pebble and joint contact shadows never appear.
4. **Stone-top grain.** Mip filtering averages the grain normals away, so stone tops look flatter
   than the path-traced source.
5. **Installation.** The streaming path transcodes UASTC to RGBA8 on the CPU and enforces the
   caps D-197 suspends. It has no zstd or uncompressed KTX2 path, and Compression Streams offer
   no zstd ([RE-050](../../../../docs/rough-edges.md)).

Two preview-only Lite observations were not investigated, because the game path does neither:
- a material swap after registration rendered black frames
- so did every frame after the shadow-caster list became empty

## Known limits

- Plants lose the source's 22–35% translucency. Front-lit leaves read slightly brighter; the
  backlit glow is gone. Leaf translucency would need a new PBR pipeline state.
- Small drawn-in pebbles look flat at a 22 cm eye height, and 3D pebbles lose the source's
  surface grain.
- Angular 64-triangle pebbles still look faceted up close.
- Tile repetition is visible across large open areas (source limit).
- With better shadows, the flat vertex normals on steep joint walls may need a shadow bias.
  The shadows package should test for acne there.

## Independent screens

- **Candidate 1** failed both screens, as described above.
- **Candidate 2** passes both, with no blocking defect ([quality](quality-delivery2.md),
  [fidelity](fidelity-delivery2.md)):
  - The slivers and shards are gone.
  - Pebble silhouettes are smooth, and plants persist past 24 m.
  - Brightness is within ±1% of the source and structural similarity is 0.99–0.997 at walking
    distance.
  - Neither tile joins nor LOD switches show.
- **Items the screens raised, and their disposition:**
  - Plant darkening: a Cycles artifact, resolved above.
  - The pale rims: engine work.
  - Two small dark needles at the 22 cm joint view.
  - Flat drawn-in pebbles up close: a known limit.

## Delivery screens are not acceptance

Lead inspection and the agent screens do not grant artistic acceptance. The human reviews the
delivered look in the fresh-import and Chrome captures above.

## Reproduce

Blender 5.2.1 and pinned Node, from the repository root. `R` is an ignored results directory and
`P` is `assets/source/d1-paving/proof-2026-09-24/delivery`:

```text
blender -b --factory-startup --python-exit-code 1 --python $P/extract.py -- --out $R/extract
blender -b ... --python $P/maps.py -- --extract $R/extract --out $R/candidate1/maps
node $P/pack.mjs $R/candidate1/maps $R/candidate2/pack
node $P/validate.mjs $R/candidate2/pack
blender -b ... --python $P/reimport.py -- --pack $R/candidate2/pack --extract $R/extract --out $R/candidate2/reimport-lod0 --terminator-offset 1.0 --single-sided-plants
pnpm build && node $P/chrome-preview.mjs $R/candidate2/pack $R/candidate1/maps $R/candidate2/chrome1 [cost|tex2048|diag|rim]
blender -b ... --python $P/evidence.py -- --results $R/candidate2 --maps $R/candidate1/maps --candidate candidate2 --out <package>/candidate2
```

Stage 2 is unchanged between candidates. Each stage verifies the hashes of its inputs and refuses
to overwrite its output. The pipeline takes about two minutes, including the 40 s zstd-19 encode
of the normal map, and each Chrome run takes about 20 s. The lossless-normal A/B copied a
candidate 1 pack with `decoded/ground-normal-*` replaced by the stage-2 mips.

[receipt.json](candidate2/receipt.json) consolidates the stage identities, per-resource sizes and
hashes, validator counts and preview measurements. Physical smoke is deferred to M4.5 exit;
this package ran source-package and isolated-preview checks only.
