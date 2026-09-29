# House kit delivery and GPU memory round — results (K2 delivery, in progress)

[Brief](delivery-brief.md). Measurements in pinned Chrome 152 through the K1 delivery preview (lighting
`@5`, 4K, RTX 4080 SUPER).

## Step 1: baseline

- **Walls today:** 275.7 MB of maps (delivery candidate 5). Geometry is 42.6 MB as meshopt streams and
  101.7 MB on the GPU with all three LODs resident (32-byte vertices and 32-bit indices; step 2c).
- **Roof, delivered naively:** about 100 MB of maps, computed from the accepted source maps at the walls'
  delivery factors. The breakdown is below.

  | Roof map | MB |
  | --- | --- |
  | Tile atlas at 1.5 mm | 17.9 |
  | Roof oak atlas at 1.5 mm, mostly soffit boards | 44.6 |
  | Gable plaster at 1 mm normal | 37.3 |
- **The naive house kit** is about 430 MB with its geometry.

## Step 2a: texel density sweep (walls, no engine change)

![Today, mid and low density at six cameras](evidence/walls-density-sweep.jpg)

| Variant | Oak | Plaster normal | Plaster colour and ORM | Stone | Maps |
| --- | --- | --- | --- | --- | --- |
| today (candidate 5) | 1.5 mm | 1 mm | 2 mm | 2.5 mm | 275.7 MB |
| mid | 1.5 mm | 2 mm | 4 mm | 2.5 mm; ORM 5 mm | 158.2 MB |
| low | 3 mm | 4 mm | 4 mm | 5 mm; ORM 5 mm | 49.2 MB |

Share of pixels differing by more than 16 levels from today, and the mean difference:

| View | mid | low |
| --- | --- | --- |
| street | 0.42% (0.5) | 0.53% (0.9) |
| front | 0.17% (0.8) | 0.37% (1.4) |
| window | 0.49% (1.1) | 8.9% (6.2) |
| oak | 0.73% (1.5) | 11.7% (7.1) |
| junction (0.7 m) | 0.70% (1.7) | 13.2% (8.4) |
| close (0.25 m) | 3.3% (2.5) | 21.1% (10.7) |

- **mid** is materially identical from street to 0.7 m. At 0.25 m its plaster pits are slightly softer.
  That is a free 43%.
- **low** holds at street and front distance, but loses fine grain from 1 m in. The plaster pits and
  lime flakes blur, and the oak fibres soften.
- **So** macro density can drop roughly fourfold if something restores the grain up close. That is
  the shared detail layer (step 2b).

## Step 2b: shared detail layer (prototype)

![Today, low, and low plus shared detail](evidence/walls-detail-layer.jpg)

- **Engine:** [`pbr-detail.ts`](../../../../engine/src/render/pbr-detail.ts), a PBR material plugin at
  Lite's `UPDATE_DIFFUSE` hook.
  - One RGBA8 tile per material class: normal offset in RG, albedo ratio in B.
  - It repeats in the material's own UV space.
  - Its frame is the base normal map's cotangent frame, rebuilt from derivatives, so mirrored
    placements shade correctly.
  - Surfaces without detail bind their own base colour at zero gain, so every streamed material keeps
    one pipeline.
- **Tiles:** [`detail.py`](detail.py) cuts each tile from the material's delivered level-0 maps.
  - Window choice: an interior window with median detail energy and the fewest outliers.
  - The window is made periodic (Moisan), then high-passed at the low variant's texel size.
  - Tiles: plaster 512² at 1 mm (0.51 m), oak 512 × 128 at 1.5 mm along the grain, stone 256² at
    2.5 mm. That is about 0.6 MB of RGBA8 in total.
- **Result:**
  - **Plaster works.** At 4 mm plus detail, the sand grain returns at 1 m and 0.7 m and reads close to
    today. The discrete pits and the lime-flake patches do not return at 0.25 m: they are unique
    features, and no shared tile carries them.
  - **Oak does not.** At 3 mm plus detail, the figure (rings, knots, flow lines) is lost, and the generic
    fibre tile makes the surface streaky. That is the "combed" failure K1 already met. Oak's grain is
    its unique figure, so oak keeps its unique map near 1.5 mm.
  - Pixel differences grow with detail (a stochastic tile does not match pixels), so this lever is
    judged by eye and by the screens.

## Step 2c: walls geometry on the GPU

Geometry counts once per kit piece, not per placement. At 32 bytes a vertex and 12 bytes a triangle,
the walls hold 101.7 MB: 80.3 MB at LOD0, 16.0 at LOD1 and 5.4 at LOD2.

- **The plinth stone is 65.0 MB of it** (LOD0 at 1 mm simplifier error). The front plinth alone is
  1.29 M triangles at 1 mm, against 119k at 3 mm.
- **Stone LOD0 at 2 mm** (with LOD1 at 4 mm and LOD2 at 10 mm) brings the walls to 52.9 MB and 1.24 M
  LOD0 triangles. At 1 m and at 0.4 m it matches the 1 mm geometry by eye; the normal map and ORM
  height carry the relief. At 3 mm the arrises start to round at 0.4 m (37.8 MB).
- **Lite finding (candidate):** `createMeshFromStorageBuffer` takes attribute byte offsets but no
  formats, so streamed PBR vertices must be float32. Snorm16 positions, octahedral normals and
  unorm16 UVs (16 bytes a vertex) would halve every kit's geometry again.

## Step 2d: stone and plaster at macro density

- **Plaster at 4 mm with a 2 mm normal plus the shared detail tile holds at 1 m** (the `plaster-1m`
  view), as step 2b found. This is the mid variant's density.
- **Stone at 5 mm does not hold at 1 m,** even with its detail tile. The plinth is always seen from
  standing height, 1–1.5 m away, and at 5 mm its lichen, tooling and pits smear. (A first run also
  shipped the stone ORM at 20 mm by compounding `--stone-orm-factor` on the stone factor; its AO
  minimum was 0.82 against 0.35, and the pits went flat.) Stone stays at 2.5 mm with its ORM at 5 mm,
  as in mid, and needs no detail tile.

![Plinth at 1 m and 0.4 m: today, stone at 5 mm, stone at 2.5 mm](evidence/walls-stone-plinth.jpg)

## Step 2e: oak normal at 3 mm

The oak's figure (rings, knots and flow lines) is in its base colour, and its checks and arrises are in
its normal. `maps.py --oak-normal-factor 4` ships the normal at 3 mm and keeps the colour at 1.5 mm.

![Oak at 0.25 m, 0.7 m and 1.5 m: today, normal at 3 mm, and 3 mm plus the oak detail tile](evidence/walls-oak-normal.jpg)

- **At 1.5 m and beyond** (the `oak` and `window` views), the 3 mm normal matches today.
- **At 0.7 m** (`junction`), the fibre relief softens. The oak detail tile, applied to the normal
  only (albedo gain 0), restores it. That tile is cut from the delivered normal and high-passed at
  3 mm, so it adds exactly what the 3 mm normal dropped.
- **At 0.25 m** (`close`), the ring figure holds, and the fibre is busier than today's. This is a
  disclosure candidate at the delivery's extreme range.
- **Walls maps:** 115.4 MB, against 158.2 MB for mid and 275.7 MB today.

## Step 3: the roof delivered (first pass)

The pipeline lives in [`delivery/`](delivery/). The roof's own [extract](delivery/extract.py) and
[maps](delivery/maps.py) stages write K1's formats. K1's `geometry.mjs`, `pack.mjs` and the preview
are generalised behind fields only the roof carries; a rerun of K1's geometry stays byte-identical
(805 files). Shared map helpers moved to
[`common/delivery_maps.py`](../../common/delivery_maps.py).

- **Tiles share one variant atlas.** Each tile's kiln and weathering tint is two quantized steps
  added to its UVs' integer parts. The new engine plugin
  [`pbr-tint.ts`](../../../../engine/src/render/pbr-tint.ts) decodes them: floor(u) is brightness,
  floor(v) is a cast along the builder's (−0.3, 0.1, 0.35). The worst quantization error is 0.53%.
  The tint costs no texels and no vertex-format change.
- **Tile sky occlusion is baked per variant slot.** The extract ray-casts per-vertex AO in the
  assembled house, and the maps stage averages it over each slot's visible instances.
- **Hidden faces are culled.** Cover undersides and pan bottoms lying on the course below are dropped
  by a per-triangle ray test from the assembled house (47% of tile triangles stay visible). LOD0 keeps
  one ring of hidden triangles around the visible ones. Without it, cover mouths showed black slivers
  at grazing angles.
- **Tile rims** (the source's procedural body) sample one texel per rim band: the tile's own clay,
  tinted. Sampling the face's border strip streaked.
- **Roof oak** follows K1's oak processing at 3 mm, with its ORM at 6 mm. Islands are recovered as the
  UV rectangles of connected triangles, and all but 0.0003% of occupied texels land in one.
- **Gable plaster** follows K1's plaster processing: 4 mm, with a 2 mm normal and the shared plaster
  detail tile. **Roof mortar** is a 0.5 m repeat tile standing in for the source's object-space noise.
- **Budget:** roof maps are 21.8 MB, and roof geometry is 22.5 MB with all LODs. Tile LOD0 is 34.8k
  triangles per bay piece, against 103.9k in the source.

![Source and delivered roof at five cameras](evidence/roof-first-pass.jpg)

**Contact shadows are missing (engine gap).** At 1 m (`tile`), the covers cast no shadow into the pan
troughs, and the troughs read lit. The source's are dark.

![Tile, eave and street: source, the CSM as shipped, and 4096² cascades with a 1 cm bias](evidence/roof-contact-shadows.jpg)

- **Cause:** the CSM offsets casters by `worldSpaceBias` 0.06 m (engine package 6's fix for
  wall striping), on 1024² cascades. A cover's crown stands about 7 cm above its trough, so its
  shadow is biased away.
- **D-206 can't cover it:** its height-field micro-shadows march within one surface's texture, and a
  shared variant atlas cannot hold a neighbouring tile's height.
- **Test:** 4096² cascades with a 1 cm bias bring the tile and eave shadows back. They cost about
  268 MB of depth against 16 MB, and the wall-striping trade-off would need re-checking.
- **So** cm-scale shadowing between meshes needs an engine answer. It is a question for the human,
  not a delivery fix.

**Cascade retune (0 MB).** Cascade texel size was the dominant cause, more than the bias.

- **Sweep:** at 1024² with four cascades to 180 m, the split λ and `worldSpaceBias` were varied,
  rendering the roof cameras and the walls cameras. The engine file was restored after each run.
- **Split distances:** with the game's 0.1 m near plane, cascade 0 ends at 14.0 m for λ 0.7, 5.1 m for
  λ 0.9 and 2.9 m for λ 0.95. The last cascade starts at 59.8 m, 38.3 m and 33.0 m.

| Variant | Tile, 1 m | Roof, about 15 m | Walls (striping check) |
| --- | --- | --- | --- |
| λ 0.7, 6 cm (shipped) | troughs lit | flat courses | clean |
| λ 0.9, 6 cm | cover shadows return, soft | faint course shadows | clean |
| **λ 0.9, 2 cm** | **crisp shadow under each cover mouth, closest to the source** | **course shading returns** | **clean** |
| λ 0.95, 2 cm and 1 cm | as λ 0.9, 2 cm | as λ 0.9, 2 cm | clean |

- **Walls:** the mean pixel difference from shipped is at most 0.24 levels on sunlit plaster. There
  is no striping at 2 cm or 1 cm with the receiver's 3-texel normal offset. Small shadows under
  shutters and frames get crisper.
- **Paving at distance:** unchanged (0.01 levels).
- **Choice:** λ 0.95 buys nothing over 0.9, and it shortens the near cascades that carry most of the
  frame. λ 0.9 with a 2 cm offset is the candidate.
- **Adopted (D-209, human visual acceptance 2026-09-28).**
- **Installed game** (K1 walls as installed, 14 views): the only change against the K1 install
  captures is this retune. There is no striping on the walls, no acne on the grass, the greybox
  blocks' distant shadows hold, and there are no browser errors. Frame time is not measured while
  the human is remote.

![Installed game with the retuned cascades](evidence/csm-retune-ingame.jpg)

![Roof: source, shipped and the retuned cascades](evidence/csm-retune-roof.jpg)

![Walls and paving at full resolution across the sweep](evidence/csm-retune-walls.jpg)

## Step 4: the last levers

- **Walls oak ORM at 6 mm** (`maps.py --oak-orm-factor 4`; it carries AO, roughness and the
  micro-shadow height). Walls maps go from 115.4 MB to 104.7 MB.
- **Roof oak geometry at 1.5 / 3 / 8 mm** (`GEOMETRY_ERRORS_ROOF_OAK`; walls oak stays at 1 mm). The
  roof timbers are seen from 3 m or more. Roof geometry goes from 22.5 MB to 17.5 MB, and the gable
  oak's LOD0 from 61k to 10.5k triangles.
- **Look:** before and after under the adopted cascades (D-209), the mean pixel difference is at most
  0.36 levels (the 0.25 m close view). The eave, verge and underside views are unchanged.

![Before and after the last two levers](evidence/last-levers.jpg)

## Where the bytes are, measured

| Part | Today or naive | Now |
| --- | --- | --- |
| Walls maps: oak 1.5 mm colour, 3 mm normal, 6 mm ORM; plaster 4 mm, 2 mm normal; stone 2.5 mm | 275.7 | 104.7 |
| Walls geometry, all LODs (stone LOD0 at 2 mm) | 101.7 | 52.9 |
| Roof maps: tiles 3 mm; oak 3 mm; gable plaster 4 mm, 2 mm normal | about 100 | 21.8 |
| Roof geometry, all LODs (tiles culled and simplified; roof oak at 1.5 mm) | not delivered | 17.5 |
| Shared detail tiles (plaster, oak; RGBA8 with mips) | — | about 0.7 |
| **House kit** | **about 480** | **197.6** |

- **Under the ≤ 200 MB target**, with every lever judged by eye against the source or today's
  delivery at matched cameras.
- **Disclosure candidates for the human:** the oak's busier fibre at 0.25 m, and plaster pits and
  lime flakes that are slightly softer at 0.25 m. Both are at the delivery's extreme range.
- **Lite finding (candidate):** quantized vertex formats would halve the 70 MB of geometry (step 2c).
