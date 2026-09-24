# Procedural asset authoring handbook

The technique reference behind the [production workflow](production-workflow.md). It records what produced
the human-approved [photoreal paving](source/d1-paving/proof-2026-09-22/photoreal-results.md)
(2026-09-22). Its [builder](source/d1-paving/proof-2026-09-22/photoreal/build.py) is the reference
implementation: copy its helpers when starting a new asset. Move them into a shared module once a
second asset needs them. The numbers below are the paving values that worked. They are starting
points for similar materials, not standards for every asset.

## Environment

- **Blender:** 5.2.1 LTS. Take the path from `.parallax-toolchain.local.json`. Run it headless:
  `blender -b --factory-startup --python build.py -- --out candidateN [args]`.
  The script reads everything after `--`.
- **Python:** Blender bundles NumPy 2.3 but not SciPy. On this Windows machine `python`/`python3`
  resolve to the Microsoft Store stub, which hangs waiting on stdin. Run helper scripts
  (crops, side-by-sides, JSON reads) through Blender: `--python script.py -- args` or
  `--python-expr`.
- **Rendering:** Cycles with OptiX on the RTX 4080 SUPER. A 1.5 MP view at 256 samples plus
  OptiX denoising takes about 3 s. A full 4096² paving build with ten views takes about
  150 s; a 2048² preview takes about 15 s. Set `scene.render.use_persistent_data = True`
  for multi-view runs. The HIP warning at startup is harmless.

## Field toolkit (NumPy, all periodic on the tile)

| Helper | Use |
| --- | --- |
| `gnoise(sigma)` | Gaussian-filtered white noise via `rfft2`, normalized to unit standard deviation. `sigma` is in metres and sets the feature size. Periodic, so the tile repeats seamlessly. About 0.6 s at 4096². |
| `fbm([(sigma, weight), ...])` | Weighted octaves of `gnoise`. |
| `blur(a, sigma)` | Periodic Gaussian blur in the frequency domain. Use it for low-pass height, cavity and soft masks. |
| `worley(cell_m)` | Periodic jittered-grid Voronoi returning F1, F2, nearest-cell ID and cell count. Index per-cell random arrays with the ID to get grains, clasts, pits and soil crumbs. About 5–8 s at 4096². |
| `sstep(a, b, x)` | Smoothstep. Every threshold is a soft band, never a hard compare. |
| `poly_sdf` + `inset_poly` | Exact signed distance to a convex polygon. Inset by `r` and subtract `r` to get rounded corners. |
| `write_png` | Writes 8-bit RGB/gray and 16-bit gray PNGs byte-exact, with no colour management. Array row 0 is y = 0, so rows are flipped on write. Load results with `bpy.data.images.load` and set the colour space. |
| `srgb2lin` / `lin2srgb` | Choose palettes in sRGB; compute in linear. |
| `write_json` | Writes evidence JSON in the repository's Biome format (byte-identical to `biome format`). Plain `json.dump` output fails `pnpm lint`. |

Per-object rasterization: loop over objects and evaluate each one only in its bounding
window. Use `np.ix_(rows % N, cols % N)` so a window can cross the tile edge. Keep
max-height ownership in an ID map (`SID`), then look per-object parameters up through it:
`param_array[SID]`, with the last element as the default for "no object". Global noise fields
are gathered inside each window, so every object gets a unique part of the field.

## Surface representation

Author height (H), linear albedo, roughness and a detail normal directly at the texel density
the closest camera needs. For paving that was 4096² over 4 m, about 1 mm per texel.

- **Geometry:** a 200² grid, a SIMPLE Subdivision modifier (level 3) and a Displace modifier
  (UV, Z, mid-level 0, strength = height range) reading a 16-bit PNG of `H_low`. This gives
  2.5 mm vertex spacing and 2.56 M vertices at render time, while the `.blend` stays about
  3 MB and editable.
- **Low-pass:** `H_low = blur(H, 0.55 × mesh spacing)`. Sampling the full H at vertices aliases.
- **Tile boundaries:** the displacement texture must use `REPEAT`, not `EXTEND`.
  Clamping the half-texel edge samples opened up to 4.083 mm gaps in candidate1.
  Run the paving `verify-edges.py` source check on evaluated geometry. Wrapping closes
  positions to sampling precision but does not reconcile independently computed edge
  normals; delivery must qualify those separately under grazing light. A one-tile top
  view does not show interior tile joins.
- **Detail normal:** use `D = H − H_low`. Take periodic central differences with `np.roll`, then
  a tangent-space normal `(−dx, −dy, 1)`, normalized. Feed it through a Normal Map node on an
  explicit `UVMap` where u = x/tile and v = y/tile. Never encode the full H into the normal map
  on a displaced mesh, or the slopes are counted twice.
- **Why this layout:** these source maps are already the delivery maps. There is no bake
  step to lose grain. That bake step is what defeated the earlier paving delivery proof.

## Scale hierarchy and paving values

Author each scale deliberately, with quiet areas between features:

| Scale | Paving feature | Values that worked |
| --- | --- | --- |
| Layout (m) | Coursed setts | Courses 24–36 cm; slots 17–52 cm; joints staggered from the adjacent courses, including across the wrap (target ≥ 8.5 cm, best of 400 draws); about 7% of eligible slots become 2×2 small setts, 10% split lengths and 7% half-depth pairs; periodic ±3.5 cm warp |
| Form (cm) | Outline and top | Joint gap 5–14 mm per edge; corner jitter σ 3.5 mm; rotation σ 0.7°; corner radius 12–35 mm; top z0 σ 2.2 mm; tilt σ 0.006; crown ≤ 0.8 mm; undulation 1.7 mm × fbm(35 mm, 12 mm) |
| Edge (cm–mm) | Worn shoulder and chips | Circular shoulder R 6–14 mm × (0.55–1.45 by noise); side slope 2.2; shoulder roughness 0.9 mm; chips 2–4.5 mm deep, deepest at the edge and feathering 12–30 mm inward |
| Surface (mm) | Pits, cracks, grain | Pits in three Worley scales (4.5/13/45 mm cells; radii ≤ 1.1/2.8/6 mm); grain plus clast relief ≤ ~0.3 mm total; 0.6 mm-deep hairline cracks on about 30% of stones |
| Contact | Joint soil | Soil = local stone top − 9 mm ± 2.2 mm, rising 3.5 mm against stone sides, capped at local top − 3.8 mm; crumbs 0.8 mm |

Once mm-scale relief goes above about 0.3 mm, stone reads as sandpaper or felt. Put mineral
character into colour structure instead.

## Colour structure

- **Per-object base:** give each object its own tone, weighted from a small palette. Varying
  base tone between objects does more than any amount of in-object noise.
- **Structure-driven zones:** weathering zones form cell by cell. Threshold
  `fbm + per-stone bias + 1.3·(clast − 0.5) + 0.6·(grain − 0.5)` with a narrow band
  (0.15–0.32). This gives the granular boundaries of MAT-001; plain fbm thresholds gave soft
  camouflage blobs.
- **Geometry-derived colour:** dirt in pits (≤ 40%, since 70% read as black holes). Paler fresh
  chips. Soil stain within 3.5 mm above the soil line. Cavity darkening ≤ 25%. Slightly paler
  worn high points. Occasional iron staining.
- **Low uniform noise:** keep per-pixel noise contrast low (0.88–1.1). Put contrast at clast
  scale (0.8–1.16) instead.
- **Soil:** dark brown (sRGB 50/37/26 to 92/72/52) with dry/damp variation, crumb shading and
  sparse painted micro-grit at ≤ 80% opacity. Full-strength white dots read as paint.

## Integration layers

Derive every secondary layer from the primary fields; don't hand-place anything.

- **Levels:** set soil relative to the local stone top, `LTOP = blur(TOPREF·mask)/blur(mask)`.
  An absolute soil height floods stones that sit a few millimetres low.
- **Masks:** restrict every paint mask to its region. An unrestricted moss mask painted moss
  across the stone tops.
- **Scatter:** build a point mesh with `rot`, `scl` (FLOAT_VECTOR), `variant` (INT) and `tint`
  (FLOAT_COLOR) point attributes. Run it through Geometry Nodes Instance on Points with
  Collection Info (Separate/Reset Children on, Pick Instance on, Instance Index from
  `variant`). Keep the variant objects in an unlinked collection. The material reads `tint`
  with an Attribute node of type INSTANCER.
- **Pebbles:** 24 variants (half angular via plane cuts), 2.5–19 mm with a power-law mix, about
  20,000 per m² of visible soil, clustered by noise. Bury them by at most 16% of size: their
  half-height is only about 0.3 × size, so larger burial hides them.
- **Plants:** build leaves and blades as NumPy vertex grids with UVs, placed at joint crossings.
  Then drape them: clamp every vertex to `H + 0.9 mm` so leaves rest over neighbouring stones
  instead of intersecting them. Start leaf pitch at 0.35–1.1 rad, with 0.6–0.8 width ratio
  ovate blades. The material is Principled (roughness 0.7, Specular IOR Level 0.22, vein bump)
  mixed with 22% Translucent. Glossier settings read as plastic.

## Lighting, capture and diagnostics

- **Sun:** angle 0.6°, colour (1.0, 0.88, 0.72), 4.6 W/m², cross-lighting from the side
  (elevation 30°, azimuth 165° against a camera looking along +y).
- **Sky:** Hosek-Wilkie, turbidity 2.6, strength 2.0, `sun_direction` matched to the lamp.
- **Colour management:** AgX with the High Contrast look.
- **Avoid:** studio area lights, which flatten outdoor relief, and backlit key angles, which
  hide it.
- **Calibration:** calibrate early with `--sunk 1 --skyk 0` against `--sunk 0 --skyk 1` at tiny
  resolution, and compare mean values. At the first sky strength of 0.9, shadows went nearly black.
- **Fixed views:** walking-height oblique, a camera matched to any prior candidate, overview,
  plant close-up, 22 cm joint close-up, low opposing sun, overcast (sun off, sky ×3) and
  orthographic top (for the tiling check).
- **Diagnostics:** gray (albedo unlinked, base 0.18) and unlit (emission of albedo under the
  Standard view transform). Also crop the raw albedo map regularly: several defects were
  obvious in the map before they were diagnosable in renders.

## Failure modes seen and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every stone shares one pattern | Image-derived texture reused across objects | Unique procedural fields per object window |
| Flat, washed-out relief | Area light or backlit sun; sky too weak/strong | Side sun and calibrated sky |
| Grey "concrete/snow" stone | Albedo too bright and cool; low-contrast mottling | Warmer, darker palette; clast-level zones |
| Camouflage blotches | fbm threshold alone | Threshold including clast/grain terms |
| Sandpaper or felt surface | Grain relief ≥ 0.3 mm everywhere | ≤ 0.3 mm total; colour carries grain |
| Black holes | Pit dirt at 70% | 40% |
| Melted "icing" edges, dark undercut bites | Deep, sharp-walled chips; lumpy shoulder noise | Chips deepest at the edge and feathered inward; 0.9 mm shoulder noise |
| Soil flooding stone tops | Absolute soil level | Level from local stone top, with a cap |
| Moss on stone tops | Unrestricted mask | Mask ∧ soil-visible, plus low stone feet only |
| Invisible pebbles | Burial larger than half-height | Burial ≤ 16% of size |
| White bead pebbles | Pale-heavy tint palette | Mid-tone palette; 6% whites |
| Plant buried in the joint | Flat rosette at soil level | Higher pitch plus drape clamp |
| Plastic leaves | Low roughness, high specular, saturated colour | 0.7 roughness, 0.22 specular, muted greens, veins |

## Blender 5.2 API notes

- **ImageTexture:** the texture datablock has no `use_mipmap` or `filter_type`. Set only
  `image`, `extension` and `use_interpolation`.
- **`ShaderNodeMix` sockets:** looking them up by name (`'A'`, `'Result'`) returns the float
  variants. Index the colour sockets, or use VectorMath MULTIPLY for tints.
- **Enums:** view transform and look enums are only valid at runtime. Set them on
  `scene.view_settings` and wrap the look in try/except.
- **Mesh basics:** `Mesh.shade_smooth()` replaces per-polygon smooth flags. `from_pydata` is
  fine for small meshes; build large surfaces with modifiers.
- **World:** `World.use_nodes` prints a deprecation warning but still works.
- **Saving:** load maps from disk before saving with `relative_remap=True`. The `.blend` then
  references `//maps/...` and stays small. Pack images only for standalone exchange files.

## Delivery (tested on the photoreal paving, 2026-09-24)

The [delivery package](source/d1-paving/proof-2026-09-24/delivery-results.md) turned the approved
paving into runtime LODs, maps and GLBs. Its scripts are the reference for surface assets. These
lessons generalize:

- **Decimate on the source's own grid.** Sample the height field at the source's mesh spacing
  (2.5 mm), not a coarser one: a 5 mm grid lost the depth of 1–2.8 cm joints.
- **Periodic tiles.** Lock every border vertex. Opposite edges then keep identical vertex sets,
  and heights sampled from the wrapped field match exactly.
- **Squash height before simplifying.** meshoptimizer rejects a single collapse that flips a
  face, but successive collapses can fold steep sidewalls over (1,142 downward faces).
  Simplify a copy with height × 0.02 and the absolute error × 0.02. Then assert that no face
  points down.
- **Flat vertex normals plus a full-height normal map.** Every LOD then shades identically, and
  there is no boundary-normal seam. Lite's derivative tangent frame reads this correctly on
  heightfields. Cycles self-shadows steep flat-normal faces, so fresh-import checks set a
  shadow-terminator geometry offset of 1.0 on the ground. Keep one default-offset render as a
  diagnostic. Explicit plant back faces (the opaque, back-face-culled runtime needs them) are
  coincident copies that darken Cycles renders by about 30%, so render one face per pair.
- **Small scatter goes into the maps.** Render the scatter top-down in Cycles: albedo, normal
  and a one-sample height pass. Composite it where it sits above the ground. Keep only the large
  pieces as geometry, and colour them from the same base-colour map through planar UVs with
  their true normals. Normal-mapped geometry needs a normal that roughly matches its surface:
  Lite's frame degenerates on near-vertical faces.
- **Formats.** Maps are UASTC at rest and BC7 on the GPU (D-199). Set the UASTC level through
  Web-libktx's enum (`basis.uastcFlags = k.pack_uastc_flag_bits.LEVEL_SLOWER`): the binding
  silently ignores a number, and the paving's first four candidates shipped at `LEVEL_FASTEST`.
  At `LEVEL_SLOWER` the albedo error is 0.66/255 mean. A full-height normal moves 2.2° mean,
  with 8.6% of texels over 5°, and an in-game A/B could not tell it from the lossless normal.
  Keep raw RGBA8 (`rgba8` descriptors) for a map whose A/B shows visible loss. BC5 normals are
  unavailable because Lite's PBR shader needs RGB normals.
- **Inspect in pinned Chrome.** Use the package's `chrome-preview.mjs`, which runs the
  production material, sampler, instancing, lighting and CSM code on the decoded bytes.
- **Screens.** Fresh subagent screens caught folded triangles that lead inspection had
  missed. Run both screens on every handoff.

## Beyond ground surfaces (untested guidance)

This method is proven only on a tileable ground surface. For masonry faces, a heightfield on
a vertical plane should apply directly. For discrete props (stairs, walls, barrels, trims),
keep the same principles:
- build the base mesh in script (NumPy/bmesh)
- author height, albedo and roughness fields in UV space at an explicit texel density
- displace from the low-pass, with a detail normal
- derive colour from geometry
- give per-object parameters

The first asset of each new class should record where this guidance needed to change.
Characters, rigs and animation stay under their own QA profiles.
