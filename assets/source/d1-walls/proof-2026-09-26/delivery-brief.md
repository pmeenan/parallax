# Timber-framed wall delivery — brief (kit package K1, 2026-09-26)

The delivery package for the human-accepted [candidate 18](../proof-2026-09-25/results.md) of the
[daylight kit program](../../../../docs/plan.md#daylight-kit-program). It follows production
workflow step 8 ([workflow](../../../production-workflow.md)) and the paving's
[delivery precedent](../../d1-paving/proof-2026-09-24/delivery-results.md). Like the paving, it runs
in two steps with their own evidence: this brief covers **step 1, the runtime representation and its
inspection in pinned Chrome**. Step 2, installation, is outlined at the end and briefed once step 1
is accepted.

**Input.** Candidate 18; from 2026-09-27 candidate 19 (its front-left corner fixed at the human's
direction), and since later that day candidate 20 (mitred, pegged braces and closed corner slots),
with the identities in its [receipt](../proof-2026-09-25/candidate20/receipt.json):
`source.blend` `8bbffdca…b61d`, `layout.json` and the maps. The source art is not reopened. Its
approved renders are the visual baseline, and the binding references stay those of the
[source brief](../proof-2026-09-25/brief.md#references).

## Representation under test

The kit's 14 pieces (13 bay variants and the corner post), plus the test house's plinth runs,
footing stones, mortar cores, foot soil, foot plants and dark interior. Each is exported from the
evaluated source, so the runtime starts from exactly the approved geometry.

- **Frames.** glTF Y-up metres. A bay's pivot is the bottom centre of its plaster face, with the
  exterior facing +Z (kit spec). Upper bays pivot at their own base, 3.5 m up. The house-specific
  parts use the house frame. The 25 placements of the test house are exported as transforms.
- **Geometry.** Each mesh is simplified from its displaced 2.5 mm source with meshoptimizer, as the
  paving was:
  - three LODs by absolute error, starting from 0.5 mm (oak and stone) and 1 mm (plaster)
  - UV and sharp-edge seams stay welded in position, and open borders are locked
  - simplification runs on a copy with the displacement squashed × 0.02, so a successive-collapse
    fold becomes a rejected flip, and every output face is checked against its base normal
- **Normals.** Vertex normals are the undisplaced base surface's. A full normal map (the low-pass
  height slopes plus the approved detail normal) carries all shading, so every LOD shades alike.
  Lite's derivative tangent frame reads it; there is no tangent attribute.
- **Maps.** One material per source material, with base colour, normal and ORM:
  - Base colour BC1 sRGB; normal and ORM BC7, all pre-encoded and GPU-ready (D-201/D-203).
  - ORM: R = height-field AO, G = roughness, B = the occluding height for sun micro-shadowing
    (D-206).
  - The plaster's occluding height also carries the timber that stands proud of it, so timbers
    cast their short sun shadows onto the plaster, which the CSM cannot resolve.
  - Atlas texels outside any member are filled from their neighbours, so mips don't bleed black
    into member edges.
- **Materials without source maps.**
  - Iron: a small generated tile with metallic in ORM.B and no micro-shadow height.
  - Glass: an opaque, dark, smooth material on the outward face (the runtime has no transmission).
  - Interior: a dark volume.
  - Mortar and soil: the source's 1 m tiles, with repeat addressing.
  - Foot plants: one atlas of the leaf, grass and stem textures, with explicit back faces, like the
    paving's plants. Translucency is lost.
- **Density A/B (D-200).** The source maps are too large to ship as they are (about 245 M texels;
  the 16384-wide oak atlas exceeds WebGPU's default 8192 texture limit).
  - Oak at 1.5 and 3 mm per texel, plaster at 1 and 2 mm, stone at 1.25 and 2.5 mm.
  - ORM at half the normal's resolution, as the paving's is.
  - Judged in Chrome at the `oak`, `junction` and `window` views, weighed against GPU memory and
    bytes. The oak detail fibre layer is dropped first; it comes back as an engine detail map only
    if the close views need it.

## Engine work in this step

- **Micro-shadowing on any surface.** The `parallax-pbr-sun-microshadow` plugin maps its march to
  UV through one per-material matrix that assumes planar tile UVs on horizontal ground. It will
  compute the UV-per-metre gradient per fragment from screen-space derivatives, so atlas-mapped,
  vertical and rotated surfaces work. The paving must render as before (within derivative
  precision), and the composed-WGSL pins are recaptured.
- **The Chrome preview.** The paving's `chrome-preview.mjs` and worker predate the current material
  signature, calibrated lighting, AO and micro-shadowing. A typed wall preview uses the engine's own
  material, texture upload, samplers, thin instances, ambient, rigid drape, CSM and lighting. It
  bypasses only the packaging path, which step 2 builds. Mirrored placements (the right facade)
  use a mirrored draw group, because Lite resolves winding per mesh, not per instance.

## Cameras and states

- **Matched source views:** `front`, `corner`, `junction`, `extreme`, `oak`, `window`, `street`,
  `overview`, plus the `low` and `overcast` diagnostics, under the calibrated sun at the source's
  key direction.
- **Fresh import:** the runtime meshes and maps re-rendered in Cycles from the same cameras, which
  proves the export before any engine difference.
- **Chrome:** the same views on the approved paving, with the game's calibrated lighting.
- **Delivery checks:** a mixed-LOD street view at 8–40 m against all-LOD0, the mirrored right
  facade, a far view for atlas bleed, and a close grazing view on a timber–plaster junction.

## Question

Does the representation keep candidate 18's appearance through export, fresh import and
pinned-Chrome rendering? At which texel density per material, and at what cost in bytes, GPU
memory, triangles, draw calls and GPU time for one house?

## Must-fix defects

1. Cracks, holes or light leaks between members, plaster and stones; open UV or sharp-edge seams
   in any LOD.
2. Folded or flipped triangles, or lost relief at walking distance: checks, arris wear, plinth
   stones, plaster returns and losses.
3. A shading pop between LODs.
4. Wrong normal-map orientation or handedness, on normal or mirrored placements.
5. Dark or coloured fringes at member edges from atlas mip bleed.
6. Missing or floating iron, glass, plants or soil, or z-fighting between the mortar and the stones.
7. Timber shadows on the plaster missing, detached or pointing the wrong way.
8. Lighting baked into the maps (the source's must-fix 7), or a stamp along the street facade.

## Estimate and end

- **Estimate:** one work session of about five active hours for step 1. Under D-207 this is a
  planning figure: the step continues until its quality gate passes, or ends in a justified
  "no viable path" defer.
- **Quality gate:** both D-195 screens on every candidate handoff, lead inspection, and the human's
  acceptance of the delivered look in the fresh-import and Chrome views.
- **Ends with:** a delivery candidate, its measured costs, the chosen densities, and the list of
  engine and packaging changes that installation needs.
- **Out of scope for step 1:** packaging and installation, class QA, rights review, library
  admission, collision, the roof (K2) and physical smoke (M4.5 exit).

## Step 2 outline: installation

Briefed after step 1 is accepted. Expected scope, from the engine survey:
- a general PBR asset library, beyond the single hard-coded paving manifest, and a kit-piece
  packaging mode alongside the periodic-surface-module mode
- the architecture class QA and admission (structural checks, rights review, provenance)
- mirrored placements, and conversion of the 256-placement-per-cell cap to telemetry (D-197)
- the test house in the ordinary installed game beside the prototype paving pad, for installed
  inspection and measured cell-load and frame costs. Assembly A1 moves it to the well court and
  handles the x = −512 cell edge, collision and terrain fitting.
- a modular plinth that fits any wall run and the terrain, which the test house's per-run plinth
  does not yet do (kit spec: 2 m plinth pieces fitted to authored terrain)
