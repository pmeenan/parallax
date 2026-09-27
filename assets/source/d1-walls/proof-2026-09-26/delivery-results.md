# Timber-framed wall delivery, step 1 — result (kit package K1, 2026-09-26)

**Status: accepted (candidate 4); candidate 5 screened.** Delivery candidate 4 passed both screens
with disclosed limits, and the human accepted it with the limits below on 2026-09-27. After the
human accepted source candidate 20 (mitred, pegged braces and closed corner slots), candidate 5
reran the same pipeline on it
([candidate 5](#candidate-5-2026-09-27-source-candidate-20)). Both screens passed it with the same
limits. Its look is accepted with step 2's installed-game acceptance.
- **Export.** It keeps the accepted [source](../proof-2026-09-25/results.md) look from
  street distance down to walking range, and renders in pinned Chrome through the game's own
  material, lighting (`@5`) and CSM ([candidate 4](#candidate-4-2026-09-27-source-candidate-19-lighting-5-geometric-plaster-ao)).
- **Screens (D-195).**
  - Quality: "ready with disclosed limits".
  - Consistency: "consistent with disclosed limits".
- **Limits accepted by the human.**
  - **0.25 m export details:** a check ends in a square notch, and the plaster return shows two
    texel-stepped arris jogs. Pits and loss-edge flakes read harder than the source's, because
    displacement is baked into normals. Fixing these needs a finer plaster LOD0 or a height term.
  - **Shaded facades:** a facade facing away from the sun reads too bright near the ground (the
    analytic ground bounce, a lighting follow-up).
  - **Oak atlas:** 13.5 MB of mostly empty shelf that candidate 19's corner post needs. Candidate
    20's deeper posts fill most of it, for 1.2 MB more.
- **Candidate 3** did not pass. The human decided its three open items on 2026-09-27:
  - **Corner.** Fix it in the accepted source: source candidate 19.
  - **Lighting.** Run engine package 7, re-opening the paving's look
    ([results](../proof-2026-09-27/lighting-results.md)).
  - **Oak.** Accept its texels inside 0.5 m.

Installation, class QA, rights review and admission are step 2
([brief](delivery-brief.md#step-2-outline-installation)).

![Front: approved source, fresh import of the runtime bytes, pinned Chrome](candidate3/compare-front.png)

Left to right, on every board:
1. the approved Cycles source
2. the runtime meshes and shipped maps, freshly imported and rendered in Cycles under the same
   camera, sun and sky
3. the same runtime bytes in pinned Chrome 152 with Babylon Lite 1.31.1 and the game's lighting

## Representation

The kit's 14 pieces, their mirrored variants, and the test house's plinth, footing, mortar, foot
soil, plants and interior. All use the engine's 32-byte position/normal/UV slab, meshopt streams and
the streamed PBR material with its ambient, drape and micro-shadow plugins.

- **Frames.** glTF Y-up; a bay pivots at the bottom centre of its plaster face, exterior +Z, and
  upper bays at their own 3.5 m base. The 25 placements are exported as matrices.
- **Mirrored facade.** The right facade's mirrored placements use mirrored geometry (X negated,
  winding reversed), so every instance keeps the engine's single front-face convention. Otherwise
  Lite would need its mirrored-mesh pipeline variant, a new PSO. Cost: 16 extra meshes, 95k LOD0
  triangles and 2.5 MB of meshopt streams.
- **Geometry.**
  - The geometry carries a low-passed displacement: σ 6 mm for plaster, 2 mm for oak and stone.
    Sharp small relief stays in the full normal map and the micro-shadow height: plaster-loss
    steps, air pits and check walls.
  - Three LODs by absolute error: oak 1 / 1.5 / 5 mm, stone and plaster 1 / 3 / 8 mm. LOD switches
    are at 12 and 40 m. Oak LOD1 stays below the 3 mm that the door and shutter straps stand proud.
  - Simplification runs on the smooth base surface, with the displacement vector as a weighted
    attribute (weight 16). The paving's squashed-height method does not transfer: the bowed,
    rounded members' base surface alone needed 66k triangles at the squashed tolerance.
  - Vertex normals are the undisplaced base surface's, and a full normal map carries the relief.
  - Folded area is checked against the source's own micro-folds, up to 1% on oak and stone arrises,
    which Cycles shades from both sides. Unsimplified meshes must ship identical LODs.
  - Corner welding uses a tolerance, because subdivision leaves one vertex's UVs differing by
    float noise.
- **Maps.** Base colour BC1, normal and ORM BC7, all pre-encoded (D-201/D-203). R = height-field AO
  (40 mm), G = roughness, B = occluding height.
  - Oak and stone keep candidate 18's atlas packing. Re-running the builder snapshot's packing stage
    recovers all 834 islands exactly, so normals and AO never read a neighbouring island. Empty
    atlas texels are push-pull filled, so mips do not bleed black into member edges.
  - Each plaster map carries a 100 mm margin holding the timber and iron around the panel: the
    plates above, the next bay's post, and the panel's own sill, frames and shutters. Their sun
    shadows therefore fall on the plaster
    ([before](candidate3/ab/plate-shadow-before-margin.png), [after](candidate3/ab/plate-shadow-with-margin.png)).
    - The timber footprint is closed and then eroded 3 mm.
    - The plaster's own part of that height is low-passed at σ 3 mm, so shadow edges follow the
      member instead of the stucco's pits
      ([source, candidate 2, candidate 3](candidate3/ab/post-shadow-source-c2-c3.png)).
  - The mortar core carries a constant 0.4 joint occlusion.
  - Iron: the source's object-space rust noise becomes a periodic 0.1 m tile on box-projected UVs.
    Glass is dark and opaque, with slightly uneven glazing, and the interior is near black.
- **Density (D-200).** Oak 1.5 mm; stone 2.5 mm, with its ORM at 2.5 mm; plaster base colour and ORM
  2 mm with the normal at 1 mm. The source is 0.75 / 1.25 / 1 mm.
  - Oak and stone at half density are materially similar from about 1 m
    ([A/B](candidate3/ab/density-junction-near-vs-economy.png)).
  - Plaster keeps its 1 mm normal because its air pits and loss steps live there, and 2 mm lost
    them inside a metre.
  - GPU maps total 261 MB: plaster ×13 146, oak 85, stone 26 and other 4. All maps at source
    density would be 348 MB and all at half 88 MB; plaster normals at 2 mm would save 100 MB.
  - Oak at 0.75 mm would need a 16384-wide texture, or an atlas split, and about 340 MB.

## Engine work (in this step)

- **Micro-shadowing on any surface** (D-206 amended). The march derived its texture direction from
  one per-material matrix that assumed planar tile UVs on horizontal ground. It now takes the world
  gradients of u and v per fragment from screen-space derivatives. The per-material uniforms and
  `ormHeight.tileMeters` are removed, and height surfaces no longer group by orientation.
- **Texel-spaced march.** The fixed 12 quadratic steps skipped the 85 mm window sill at the far end
  of a long march, stair-stepping its shadow edge
  ([12 steps](candidate3/ab/microshadow-12-fixed-steps.png), [texel-spaced](candidate3/ab/microshadow-texel-steps.png)).
  Steps are now about 1.5 texels of the sampled mip apart, 4 to 64 per fragment.
- **The paving is unchanged in effect.** It renders within 1.1/255 mean of the HEAD engine at a
  12° sun, and 0.03/255 at 38° ([joint at 12°](candidate3/ab/paving-joint-12deg-head-vs-new.png)).
  At 4K the GPU time is within noise: the street view is 3.38 against 3.34 ms, and the paving alone
  1.47 against 1.55 ms.
- **Identities.**
  - The lighting model is `…-microshadow-agx-csm@4`.
  - The PBR vertex, colour and depth WGSL pins are recaptured. Before re-pinning, the preview's
    capture hook reproduced all three HEAD pins exactly from HEAD sources, and the Node-side PSO
    contract test recomposes the same hashes.
  - The installer-repair replay is rebound to semantic contract v26 and passes
    (`harness/results/installer-repair-production-replay/installer-repair-production-replay-v4-2026-09-27T01-56-43-484Z.json`).
  - The scale-streaming corpus pin moves by the same −240 bytes, from dropping `tileMeters`.

## What it took (4 candidates, 12 independent screens)

| Candidate | What the screens or lead inspection found | Root cause and fix |
| --- | --- | --- |
| Previews | Plate shadow missing or jagged; stair-stepped sill shadows; iron flat | Occluders outside the plaster panel (margin); fixed march steps (texel-spaced); iron given the source's noise |
| 1 | Sliver shards at plaster losses and oak checks, in the export too ([source, candidate 1, candidate 2](candidate3/ab/close-slivers-source-c1-c2.png)) | Simplification spanned displacement cliffs with long sloped triangles; the geometry now carries a low-passed displacement |
| 1 | Iron straps, mortar cores and the interior vanished or leaked at LOD1–2 | A real bug: `reorderMesh` remaps its index buffer in place, and unsimplified meshes reused the mutated buffer for LOD1–2. Each LOD now gets a copy, guarded by an identical-LOD check |
| 1 | Straps hidden and door planks ragged at lower LODs | Oak LOD1 1.5 mm, LOD2 5 mm; switches at 12 and 40 m |
| 1 | Plaster air pits and loss edges lost inside a metre; hard stair-stepped timber shadows | Plaster normal at 1 mm, ORM at 2 mm (was 4 mm) |
| 1 | A bright sliver along a post's shadowed side ([candidate 1, candidate 2](candidate3/ab/close-seam-c1-c2-chrome.png)) | The plaster's edge texels carried the timber's height; the footprint is eroded 3 mm |
| 1 | Rust-pattern iron; light glass; a Chrome "overcast" with a sun | Subtler rust ([source, candidate 2](candidate3/ab/iron-window-source-vs-c2.png)); darker glass; the diagnostic's sun turned off |
| 2 | Plinth flat in Chrome; interior lit grey through the corner slot; post shadow lumpy; flakes read as holes; a Cycles-only dark line | Stone ORM at 2.5 mm and mortar joint occlusion ([plinth](candidate3/ab/plinth-low-sun-source-c2-c3.png)); near-black interior; occluder closing and a low-passed plaster height; a terminator offset in the fresh import |
| 3 | Round 3: see [open items](#open-items) | The human decided the corner, lighting and oak items (2026-09-27) |
| 4 (first build) | Close view: a pale ribbon on the post-shadow edge; its shadow ~1 cm too wide; junction shadow short | The margin stood in neighbours by repeating the piece, now the braced bays' corner post; it now carries the real neighbours, with 1 mm net erosion |

Candidate 2's flat corner end blocks match the approved source at the same camera
([source, import, Chrome](candidate3/ab/corner-end-blocks-source-import-chrome.png)).

## Candidate 4 (2026-09-27): source candidate 19, lighting @5, geometric plaster AO

![Front-left corner: source, fresh import, Chrome](candidate4/compare-corner-left.png)

- **Input.** Source candidate 19 (the corner fixed) under lighting model `@5` (engine package 7).
  The scripts now read the accepted source by name. `extract.py` skips the source's staging
  ground, and `reimport.py` keeps it.
- **Corner.** It is closed in the fresh import and in Chrome, at every LOD
  ([LOD0](candidate4/chrome/corner-fl-lod0.png), [LOD1](candidate4/chrome/corner-fl-lod1.png),
  [LOD2](candidate4/chrome/corner-fl-lod2.png)).
- **Items 4 and 5: post shadows now match the source at 0.7 m and 0.25 m**
  ([junction, lit](candidate4/ab/junction-post-shadow-source-c3-c4.png),
  [junction, sun only](candidate4/ab/junction-sun-only-source-c3-c4.png),
  [close](candidate4/ab/close-post-shadow-edge.png)).
  - **Junction.** The shadow starts at the same pixel as the source's in every sampled row;
    candidate 3's started about 24 px (10 mm) late. Across the recess its level is within 3–4 of
    the source's: (93, 74, 47) against (89, 70, 44).
  - **Close.** The lit face's edge follows the source's to about 1 mm; candidate 3's shadow
    reached about 1 cm too far over it.
  - **Real neighbours in the margin.** A panel's margin used to stand in its neighbours by
    repeating the piece itself ±2 m. Each bay's post carries its own seeded relief, and the braced
    bays now carry the corner post, so the stand-in put the wrong post beside the plaster:
    - too narrow at the junction;
    - too wide at 0.25 m;
    - in the first candidate 4 build, a pale ribbon along the shadow edge.

    `maps.py` now rasterizes the pieces actually placed on the facade into the margin, including
    the corner piece.
  - **Erosion.** The occluder footprint's net erosion falls from 3 mm to 1 mm. The 3 mm left
    shadows about 5 mm short, and 1 mm brings back no lit sliver along timber edges.
- **Plaster AO is now geometric.** The ORM's AO takes a 150 mm radius with no distance falloff,
  and includes the proud timber.
  - **Why.** Beside a post 40 mm proud, the paving's 40 mm radius and falloff kept only the last
    12–20 mm. A wall point there loses (1 − cos(atan(h/d)))/2 of its sky: 27% at 20 mm, 9% at 60 mm.
  - **Result.** The AO beside a post reads 0.81 at 25 mm, against 0.77 analytic.
- **Item 4's pale patches.** They are not sun leaks, and not BC1
  ([decomposition](candidate4/ab/close-flakes-decomposition.png)):
  - Under the sun alone the recess is fully shadowed.
  - They appear identically from uncompressed maps.
  - They are the source's own pale lime flakes left in the loss backing, lit by the sky. In
    Cycles the flakes are displaced geometry and read darker in that shadow.
  - Disclosed as an extreme-range difference.
- **Item 6 (close-range export details).** Unchanged: the check's sharper notch, the two arris
  decimation notches and the pit contrast at 0.25 m.
- **Wall levels** at the source's exposure (whole-view plaster means against Cycles):
  - Lit views: −3 to −6 in red and green, −5 to −8 in blue (street: −11 in red, +2 in blue).
  - Sun-off overcast: −4 to −5. The AO has no bounce light.
- **Shaded facades.** A facade facing away from the sun reads 7 levels too bright at the game's
  exposure (17 at the source's) ([corner-left](candidate4/compare-corner-left.png)).
  - The game's analytic ground bounce assumes sunlit ground. Beside such a facade the ground is
    in the house's own shadow.
  - It depends on building height and street width, so a local GI or ground-shadow term is a
    follow-up, not a constant.
- **Costs.**
  - **Maps: 274.5 MB, from 261.** The oak atlas grows by the shelf that candidate 19 packs its
    corner post into. The post's strips are 1,392 texels tall, taller than any free shelf space,
    so they cannot fit. The shelf is 75% empty.
  - **Geometry:** 42.6 MB. House triangles: 2.877 M / 0.568 M / 0.174 M.
  - **GPU at 4K:** street 3.35 ms, junction 2.82 ms, walls alone 2.43 ms. Unchanged within noise.

## Candidate 5 (2026-09-27): source candidate 20

![Front-left corner: source, fresh import, Chrome](candidate5/compare-corner-left.png)

- **Input.** The accepted source candidate 20: mitred braces pegged on their axes, and corner posts
  deepened to close the upper-floor slot. The pipeline, its settings and lighting `@5` are
  candidate 4's; only the scripts' source name changed.
- **The fix survives delivery.** In the fresh import and in Chrome, at LOD0, LOD1 and LOD2
  ([LOD0](candidate5/chrome/corner-fl-lod0.png), [LOD1](candidate5/chrome/corner-fl-lod1.png),
  [LOD2](candidate5/chrome/corner-fl-lod2.png)):
  - every brace meets its post and plate in a full-width joint;
  - the pegs sit on the brace axes ([right facade](candidate5/compare-right.png),
    [oak](candidate5/compare-oak.png));
  - no slot opens at either corner.

  Candidate 4's light wedges at the brace feet are gone.
- **Nothing else moved.**
  - Views away from the corners match candidate 4.
  - Small BC7 differences on window trims come from the re-encoded oak atlas.
  - LOD popping is unchanged. Pixels differing by more than 40 levels between LOD0 and LOD1:
    2,288 in candidate 4, 2,312 now.
- **Costs.**
  - **Maps:** 275.7 MB (+1.2 MB, all oak).
  - **House triangles:** 2.878 M / 0.567 M / 0.174 M.
  - **GPU p50 at 4K:** street 3.33 ms, overview 2.40, junction 2.81, walls alone 2.40.
    Unchanged within noise.
- **Screens (D-195).**
  - Quality: "ready with disclosed limits". No must-fixes; candidate 4's three limits apply
    unchanged.
  - Consistency: "consistent with disclosed limits". Pegs in Chrome read lower in contrast than
    in Cycles, as they did in candidate 4.

## Open items

From the round-3 screens, grouped by what is needed to close each one.

**Needed a human decision** (decided 2026-09-27, see the status above):
1. **Front-left corner (source layout).** *Decided: fixed in the source (candidate 19).* The
   approved test house has a corner piece only at the front-right, and no rear wall. The
   front-left corner is a gap about one post wide, with the brace ending in the air. Cycles renders the gap black; Chrome shows the dark interior box behind
   it ([source and Chrome](candidate3/ab/front-left-corner-source-vs-chrome.png)).
   - Closing it means changing the accepted source layout: a mirrored corner piece, or leaving it
     to Assembly A1's closed houses.
2. **Game lighting on vertical walls (engine).** *Decided: engine package 7, done; lighting model
   `@5`.* Both screens separate this from the asset.
   Chrome's lit plaster is about 12% darker and much less blue than Cycles (sample RGB 186/165/124
   against 200/179/150).
   - An ambient-only decomposition gives 74/65/46 in Chrome against 82/84/72 for Cycles' sky-only
     ([Cycles](candidate3/ab/lighting-cycles-sky-only.png), [Chrome](candidate3/ab/lighting-chrome-ambient-only.png)).
   - D-205 calibrated the ambient on horizontal paving. Its linear N.y blend gives a wall half the
     horizontal sky and a 0.2-albedo ground bounce, and its AgX fit was calibrated on neutral
     patches only.
   - The overcast state is about 40% darker than Cycles, and there is no contact occlusion between
     separate members.
   - The proposed next engine package calibrates vertical irradiance and tone-map chroma against
     Cycles. That re-opens the accepted paving's look.
3. **Oak inside 0.5 m.** *Decided: accepted as is ("not worth the added size to be perfect").*
   The 1.5 mm atlas shows texels at the 0.25 m close view, and the source's
   0.25 mm fibre layer is not carried. Three options:
   - accept this for walking range
   - a shared detail-normal layer in the engine (a new sampler and plugin)
   - 0.75 mm oak (16k textures and about 340 MB)

**Agent work for the next candidate:**
4. **Light patches in shadow.** Small texel-shaped lit patches appear inside the post's shadow over
   the deep plaster-loss backing, in Chrome only ([close](candidate3/ab/close-source-vs-c3-chrome.png)).
5. **Post shadow at the junction.** The post's shadow on the plaster return is lighter and narrower
   than the source's at 0.7 m ([source, candidate 2, candidate 3](candidate3/ab/post-shadow-source-c2-c3.png)).
   There are also single-texel black flecks on some stones and flakes.
6. **Close-range export details.**
   - A check on the junction post ends in a sharper notch than the source's small jog.
   - The plaster return arris shows two decimation notches at 0.25 m.
   - Plaster pits read more contrasted than the source's at close range: the full normal adds the
     low-pass slope the source's geometry carried.
7. **Oak in the fresh import.** It is 10–20% lighter than the source, although its albedo matches
   within 1–2/255. It lacks the source's sub-texel fibre shading, which is the same limit as item 3.
   In Chrome the oak's luminance is close to the source's.

## Checks

- **Fresh import.** From street distance to about 1 m, the runtime bytes in Cycles track the
  approved source: relief, checks, arris wear, plaster returns, losses and air pits, coursing,
  openings and iron. Plaster and stone are within 1–3 levels.
- **Chrome.** No browser errors or external requests. Layout, UV orientation and normal-map
  handedness match on normal and mirrored placements
  ([right facade](candidate3/chrome/right.png), [source](candidate3/ab/source-right-facade.png)).
- **LODs.** All-LOD0 against distance-selected LODs differs by 0.9/255 mean in the street view and
  0.5/255 at 38 m ([LOD0](candidate3/chrome/street-lod0.png), [mixed](candidate3/chrome/street-mixed.png)).
  Each forced LOD shows the same front-left corner ([LOD0](candidate3/chrome/corner-fl-lod0.png),
  [LOD1](candidate3/chrome/corner-fl-lod1.png), [LOD2](candidate3/chrome/corner-fl-lod2.png)).
  LOD2 differs visibly only when forced up close; it is selected beyond 40 m.
- **Encoding.** BC1 base colours average 1.3/255 level-0 error, and BC7 maps 0.8/255. Meshopt
  streams roundtrip byte-exactly.
- **Screens (D-195).** Six independent screens, two per candidate:
  - Candidate 1: "not ready" and "not consistent".
  - Candidate 2: "not ready" and "not consistent". The export was judged faithful at walking range.
  - Candidate 3: "not ready" and "not consistent", on the open items above. Must-fixes 3, 4, 5, 6
    and 8 pass; 1, 2 and 7 are partial. Street distance is judged identical to the source.
  - Candidate 4, first build: "not ready" at 0.25 m only (a ribbon on the post-shadow edge, the
    shadow too wide, item 6), and "consistent with disclosed limits".
  - Candidate 4, final build: "ready with disclosed limits" and "consistent with disclosed limits".
    Items (1) and (2) are fixed with no new lit slivers. Item 6 remains as small 0.25 m effects,
    fit to go to the human as an accepted extreme-range limit. The consistency screen notes the
    preview's finite pad and flat sky backdrop (staging only).

## Costs (isolated preview, RTX 4080 SUPER, 4K; diagnostic, not budget evidence)

| Item | Value |
| --- | --- |
| GPU maps (BC1/BC7, all mips) | 261 MB: plaster ×13 146, oak 85, stone 26, other 4 |
| Meshopt geometry (kit, mirrored variants, house parts; all LODs) | 42.5 MB (101 MB decoded) |
| House triangles, LOD0 / LOD1 / LOD2 | 2.87 M / 0.56 M / 0.17 M (plinth 2.30 M / 0.26 M / 0.03 M) |
| Street view, walls and paving, GPU p50 | 3.29 ms (walls alone 2.39, paving alone 1.45; CSM included) |
| Overview / junction, GPU p50 | 2.37 / 2.78 ms |
| Draw calls, street view | 470 (about 250 for the house: one pool per mesh and LOD) |
| Upload of all maps and meshes | 4.9 s in the preview |

- **Plinth.** The per-run plinth is 80% of the house's LOD0 triangles. Step 2 replaces it with
  modular pieces fitted to terrain.
- **Draw calls.** Merging a piece's meshes that share a material is a step-2 option.
- **Foot plants.** They lose their translucency, as the paving's did.

## Reproduce

Scripts in [delivery/](delivery/); intermediate outputs stay outside the repository.

```bash
blender -b --factory-startup --python-exit-code 1 --python extract.py -- --out <x>
node geometry.mjs <x> <g>
blender -b --factory-startup --python-exit-code 1 --python maps.py -- --extract <x> --out <m> --oak-factor 2 --stone-factor 2 --plaster-factor 2 --plaster-normal-factor 1 --plaster-orm-factor 2 --stone-orm-factor 1 --plaster-ao-radius-mm 150 --plaster-ao-falloff 0
node pack.mjs <m> <p> --jobs 12
node chrome-preview.mjs <root> <g> <p> <out> views
blender -b --factory-startup --python-exit-code 1 --python reimport.py -- --geometry <g> --textures <p> --out <i> --samples 128
blender -b ../../proof-2026-09-25/candidate20/source.blend --python-exit-code 1 --python source_views.py -- --out <s> --views close,corner-fl,right,junction-sun
python compare.py <boards> <i> <chrome views> <s>
```

The tool versions are Blender 5.2.1, Node 24.18.1, pinned Chrome 152.0.7977.54, Babylon Lite
1.31.1, meshoptimizer 1.2.0 and Web-libktx 4.4.2, with a UASTC `LEVEL_SLOWER` intermediate.
- **`chrome-preview.mjs` modes:** `views`, `lod`, `cost`, `shadow`, `paving`, `decomp`,
  `corner-lods`, `corner-debug`, `matched` (the source's fixed exposure), `junction-sun`,
  `close-decomp`, and `shaders`, which records the composed WGSL hashes.
- **`WALL_PREVIEW_WORKER`** bundles a worker against other engine sources, used for the HEAD A/B
  and the pin check.
- **`WALLS_PACK_REUSE`** copies maps whose levels are unchanged from an earlier pack.
- **Close view.** The source package's `extreme` camera came from build-time check data that is not
  retained. The delivery's `close` view is the extreme-range camera instead, rendered from the
  source by `source_views.py`.
- **Receipts:** [candidate5/receipts](candidate5/receipts), and candidate 4's in
  [candidate4/receipts](candidate4/receipts) (candidate 3's in
  [candidate3/receipts](candidate3/receipts)).

## Cost of the step

About one and a half long work sessions, over the brief's estimate (D-207). That covered three
candidates, eleven full map builds of about 20 minutes each, four UASTC→BC encodes of 20–25 minutes
each (unchanged maps are reused), about 40 Chrome preview runs, nine geometry builds and six
independent screens.
