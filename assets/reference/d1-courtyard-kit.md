# D1 courtyard kit — draft v1

**Status:** implementation brief; human artistic acceptance pending. Paving has an
admitted binary prototype and installed runtime path; the individual-stone correction
below is paused after rejected source previews. Complete the
[game-wide concept-art program](concept-art-program.md) and select its courtyard,
paving, material and assembly targets before further modeling. Other kit pieces remain
proposals. Exact active QA limits live in
`assets/qa/`, and current implementation/evidence status lives in `docs/plan.md`.
Visual reference: [paired sunny/gloomy courtyard](d1-courtyard-sunny-gloomy.png),
endorsed by the human as the quality benchmark, not as finished runtime acceptance.
The reference is an appearance target, not a replacement world layout. Follow
[game design](../../docs/game-design.md#art-direction), D-182, and the existing D1
terrain, castle/moat footprint, village placement and catacomb entrances.

## Visual target

An inviting village courtyard: warm cream plaster framed by dark oak, terracotta
roofs, pale limestone paving and a modest limestone well. Shrubs soften building
bases without obscuring the route. A hilltop castle remains legible beyond the
village roofline. Target AAA-quality photorealistic, movie-style scenery: convincing
construction, physically credible material response, natural surface variation and
rich lighting. Readability and bright daylight do not authorize cartoon proportions,
flat toy-like materials or simplified decorative substitutes. Preserve readable
forms, restrained edge wear and saturated daylight; avoid uniformly brown/gray
surfaces or ornament on every module. The proposed limits below must support this
quality target; reconsider a limiting proposal rather than accept visibly cheap art.

### First-asset correction: individual paving stones

The repeated 2 m surface is superseded as the target strategy by a reusable stone
library and controlled nonrepeating placement. First prove a 4×4 m courtyard section
and terrain fitting on a slope. Individual outlines should read as quarried and worn,
with broad relatively calm tops, localized pits/chips, irregular shoulders, and
modest height differences. Avoid equally noisy surfaces, identical photographic
stamps, continuous courses and random scattered boulders. Small infill stones close
gaps; earthy joints contain varied fine aggregate and sparse low vegetation.
Use original or rights-reviewed generated/photo-based material maps, targeting color
without directional lighting; the first procedural-only surface failed evaluation.
The [generated limestone surface](d1-paving-clean/single-surface-v1.md) is selected
after comparison with the [worn-rock proof](d1-paving-clean/worn-rock-material.md).
The generated color is not calibrated PBR data; authored geometry supplies macro
relief and restrained original normals supply fine relief. Scan maps are excluded.
Preserve stone geometry and transforms separately for shared runtime instancing;
terrain fitting rotates/translates rigid stones instead of bending the complete patch.
The first source library proposes eight variants, with actual limits declared in its
QA configuration. Visual inspection in the installed renderer remains required.

Sunny and gloomy views use the same geometry and material set. Lighting supplies
the mood change; do not paint directional shadows or ambient darkness into albedo.
The first slice needs dry materials only. Storm wetness, moving foliage and local
fire illumination follow later packages.

## Assembly and pieces

Use metres, Y-up exports and a 0.25 m assembly grid. A standard façade bay is
2 m wide × 3 m high; store its pivot at the bottom centre of its exterior face,
with exterior facing +Z. Horizontal pieces use a bottom-centre pivot; a roof uses
the eave midpoint. Apply source transforms before export. Module seams must align
without interpenetrating decorative trim; avoid unique materials per instance.

| Piece | Nominal dimensions | Assembly intent |
| --- | --- | --- |
| Plaster/oak wall bay | 2 × 3 × 0.25 m | Plain, window and door variants share border dimensions |
| Door opening | 1 × 2.25 m clear | Preserve clearance; opening belongs in geometry and collision |
| Oak post / beam | 0.25 × 3 × 0.25 m / 2 × 0.25 × 0.25 m | Reuse at bay boundaries; one owner per shared seam |
| Limestone plinth | 2 × 0.5 × 0.25 m | Wall foundation; fit to authored terrain without altering it |
| Terracotta roof section | 2 m along eave × 2 m horizontal run, 40° pitch | Ridge/end-cap variants preserve shared eave alignment |
| Limestone paving panel | 2 × 0.125 × 2 m | First vertical slice; restrained joints and edge variation |
| Limestone well | 2 m outside diameter × 1 m rim height | One courtyard landmark; no new entrance or interaction implied |
| Shrub clump | Up to 1 × 1 × 1 m | A few reusable silhouettes; retain clear movement/camera space |
| Castle silhouette group | Existing castle footprint | Preserve authored location, moat clearance and recognizable towers |

Place the first paving panel on a verified walkable village patch. Fit decorative
geometry to terrain/collision; no new traversable raised surface. The periodic paving
stage deliberately levels a local courtyard pad at the existing anchor elevation,
updating visual terrain and collision together because the six-metre footprint spans
120 mm of ground variation. Record the sample-grid extent in the stage evidence. Choose
the courtyard footprint and world transforms from actual terrain and route data
before assembly. A reference-image well does not relocate the existing village
catacomb entrance. Collision-changing pieces require an explicit matching authored
collision update through the existing deterministic world-data path.

## Shared materials

Keep six kit material identities: `d1-plaster-cream`, `d1-oak-dark`,
`d1-terracotta`, `d1-limestone`, `d1-leaf`, and `d1-iron-dark`. All are nonmetallic
except iron. Start with base color, normal and packed occlusion/roughness/metalness;
base color is sRGB, the other maps linear. Limestone paving and well reuse one
material family. No baked illumination, emissive plaster, or separate shader for
weather. Introduce leaf alpha handling only when the foliage slice requires it.

## Proposed class limits — not activated budgets

These are initial production proposals, not enforced checks or changes to
[runtime budgets](../../docs/budgets.md). Encode and validate the applicable subset
before admission; revise with representative geometry and captures, recording the
rationale in the QA configuration. Counts are per exported piece at LOD0.

| Class | Triangles | Material slots | Largest texture edge | LOD1 / LOD2 triangle ceilings |
| --- | ---: | ---: | ---: | --- |
| Paving / plinth / post / beam | 2,000 | 1 | 2,048 px shared | 50% / 20% of LOD0 |
| Wall bay / roof section | 8,000 | 3 | 2,048 px shared | 50% / 20% of LOD0 |
| Well landmark | 12,000 | 2 | 2,048 px shared | 50% / 20% of LOD0 |
| Shrub | 4,000 | 1 | 1,024 px shared | 50% / 20% of LOD0 |
| Castle silhouette group | 20,000 | 2 | 2,048 px shared | 50% / 20% of LOD0 |

Propose 512 texels/m for near architecture/paving and 256 texels/m for foliage and
vista surfaces, each ±20% using the declared source texture dimensions. Tiled UVs
must declare their repeat scale. Shared/mirrored UV sets require explicit metadata;
otherwise reject overlaps, inverted islands and degenerate UV triangles. Reject
nonfinite attributes, degenerate mesh triangles and exports exceeding declared
dimensions by more than 1 cm. Static classes have no bones. Reduction alone does
not qualify LOD appearance: preserve boundary alignment and silhouette, then inspect
motion at the existing 12 m/s traversal and unchanged LOD-distance contract.

## First vertical slice and admission requirements

Deliver one limestone paving panel with three LODs and shared PBR maps before
expanding the kit. Retain the Blender source, generating script/tool versions,
reference identities, prompt/seed lineage where applicable, rights metadata and
gate results. A reference citation does not itself establish rights approval.
Resolve P-004 binary storage before retaining binary library outputs; keep large
binaries out of ordinary git. Only QA-admitted, immutable content-addressed library
outputs may enter packaging.

The gate must verify the applicable limits above, UV density/overlap, metric scale,
pivot/orientation, material identities, LOD chain, valid GLB and KTX2 payloads, and
meshopt compression. Call the engine's `canonicalMeshoptLayoutErrors` validator:
one glTF buffer, with compressed source and uncompressed views all referencing
buffer 0. Round-trip through the actual shipping worker loader. Include malformed
input rejection tests; a Blender preview is not loader evidence.

The current streamed binary dependencies are synthetic meshopt vertex/index data
and separately cached KTX2 textures. They do not yet constitute a PBR GLB instance
path: the renderer assigns the first world material to those dependency meshes.
The implementation therefore needs:

- Data-owned asset/LOD/material references and placement in the existing cell schema.
- QA-admitted GLB/texture packaging with release hashes and installed OPFS reads.
- The pinned Lite `loadGltf` worker path, preinstalled decoders and explicit PBR
  texture binding, using supported loader behavior verified on the exact pin.
- Shared resource and per-cell instance ownership, cancellation and eviction cleanup,
  with unchanged deterministic terrain/collision and no hidden reference/source loads.
- Load/decode/upload timing, owned CPU/GPU bytes, cache hit/miss and disposal evidence,
  plus release-owned PSO warmup for the introduced material variants.

Inspect near material response, mid-distance seams/contact shadows, and vista
composition in sunny and gloomy states, plus moving LOD/residency transitions.
Retain representative captures and short diagnostic costs; record implementation,
build/launch/capture waiting, inspection time and rework separately. Human acceptance
remains open until those results are reviewed. Full physical smoke stays deferred
to the converged M4.5 exit candidate.
