# Terrain-conforming paving — result (engine package 4, 2026-09-24)

**Outcome: adopted (D-204). The human visually accepted the rolling courtyard (2026-09-24).**
The shared periodic paving module now follows rolling ground through a GPU vertex drape. It
rests on the same surface that collision and navigation use. Both allowed cycles were used in
one session on dev-01's physical console ([brief](conform-brief.md)).

![Rolling courtyard, low eye across the crest](conform/rolling-across.png)

## What changed

- **Terrain detail regions (game data and world contract).** The courtyard's region is
  `[-16, 32]²` at 0.5 m. It is the coarse bilinear field plus three crossing waves (0.22, 0.14 and
  0.05 m; 22, 15 and 10 m wavelengths), faded to zero with a C¹ window over its outer 8 m.
  Across the courtyard the ground spans −0.38 to +0.33 m around the level pad, with a steepest
  slope of 7.25°. Each of the four cells carries its clipped part as `collision.detail`.
- **One ground.** `sampleCellGroundHeight` feeds navigation (and so every sim ground height),
  the build's asset anchors and the drape. Validation holds detail fields to the coarse
  lattice. Their interior edges must meet the coarse field and their cell-boundary edges the
  neighbour's ground.
- **Render terrain.** The fine mesh replaces the covered coarse quads. Cell-edge skirts now
  follow the ground, including every detail sample on the edge.
- **GPU drape.** Placements marked `conformToTerrain` carry `terrainDrape.referenceHeightMeters`.
  Every streamed PBR material has one vertex-stage plugin. It reads a per-cell `rgba16float` field
  (height above the reference, x and z slopes) with collision's bilinear lookup. It lifts the
  world position and shears the normal, in both the colour and the CSM depth pipelines. Rigid
  placements bind a 1 × 1 zero field.
- **PSO warmup.** The contract pins the new PBR WGSL: vertex `7590ba16…`, colour fragment
  `b72818f9…` and depth fragment `0193b873…`. It also pins the material group, now with a
  vertex-visible UBO and drape texture/sampler at bindings 8/9. The engine contract test
  recomposes the same WGSL from Lite's composer with the plugin registered, and the observer
  requires exactly the drape plugin.

## Cycles

1. **Drape and terrain.** The first captures showed the paving following the ground with no gaps.
   They also showed long lens-shaped slivers in the grass: cell-edge skirts drawn at the coarse
   16 m edge height, poking through where the rolling ground crosses a cell boundary (x = 0 and
   z = 0). The terrain batch always draws skirts on streamed cells.
2. **Skirts on the ground.** Skirt tops now sample the ground along the edge, detail samples
   included, and the slivers are gone. Telemetry also showed `terrainDrapeUploadMs` timing the
   whole placement setup, and a per-call allocation in the float16 encoder. After both fixes the
   drape build measures 0.9–1.0 ms and placement setup fell from 5.8 to 1.6–1.7 ms.

## Views (dev-01, pinned Chrome 152.0.7977.54, 4K)

[capture.mjs](conform/capture.mjs) seats the install package's eight views on the rolling ground
and adds five slope views. The six below are kept at half resolution; the
[summary](conform/capture-summary.json) records every view's request, full-resolution hash and
costs.
- [rolling across the courtyard](conform/rolling-across.png)
- [rolling at 12° sun](conform/rolling-grazing.png)
- [crest edge](conform/crest.png)
- [dip at 12° sun](conform/dip.png)
- [paving/terrain edge](conform/edge-seam.png)
- [overview](conform/courtyard-overview.png)

The paving meets the grass with no gaps, float or sinking, and tile seams stay closed on the
slopes. The courtyard still reads through today's dim, flat lighting, which is package 5.

## Costs (dev-01; short diagnostic windows, not budget verdicts)

GPU frame time is the median of 60 frames of Lite's `gpuFrameEmaMs`. The baseline is committed
HEAD `0381e35` with the install package's capture on the flat courtyard.

| View | HEAD | Run 1 | Run 2 |
| --- | ---: | ---: | ---: |
| walking | 2.90 | 3.06 | 3.01 |
| walking-matched | 5.23 | 5.19 | 5.24 |
| close | 5.49 | 5.44 | 5.28 |
| joint | 5.31 | 5.28 | 5.34 |
| grazing | 5.51 | 5.37 | 5.47 |
| overcast | 5.40 | 5.37 | 5.36 |
| courtyard-overview | 5.27 | 5.29 | 5.25 |
| courtyard-far | 2.37 | 2.63 | 2.63 |

- **Paving views** are within ±0.15 ms of the baseline. The far view's +0.26 ms is the four
  cells' fine terrain meshes (about 19k extra triangles), not the drape.
- **Drape field:** one per cell, 33,800 GPU bytes, built in 0.86–1.01 ms on the render worker.
- **First streaming batch stall:** 18.6 ms at HEAD, 21.6–24.1 ms now, against the 50 ms hitch
  budget.
- **Install size:** +181,196 bytes of cell JSON for 9,604 detail heights.

## Verification

- **Tests.** Focused tests for the detail contract, seams, fine mesh, skirts, float16 encoding
  and a CPU mirror of the drape shader: within 0.5 mm of collision's bilinear ground. The rolling
  courtyard is tested against navigation's ground height. The PSO composer and contract, the
  packaging drape reference and footprint checks, and the placement validator are covered too.
- **Installer-repair production replay.** Rebound to semantic contract v23 on build
  `627af17e…bf9e` and passed:
  `installer-repair-production-replay-v4-2026-09-25T01-27-16-408Z.json`
  (SHA-256 `ed3722ba…2faa`).
- **Installed scale-streaming on dev-01's physical console, build `627af17e…`.**
  - The first run's runtime phase completed with a cell-load p95 of 2.23 ms. Its post-validation
    header re-check then failed with an uncaused `fetch failed` against the loopback server. That
    matches the loopback flake the optimization review recorded. The report is retained:
    `scale-streaming-v1-2026-09-25T01-29-32-588Z.json` (SHA-256 `389be609…31b6`).
  - One same-artifact retry (D-097) passed, with a traversal cell-load p95 of 2.125 ms:
    `scale-streaming-v1-2026-09-25T01-32-32-692Z.json` (SHA-256 `99c59ffe…737a`).
  - This also closes package 2's pending physical-console run.
- **`pnpm check`** passes: build and repeatability, lint (768 files) and unit tests (221 files;
  2,730 passed, one existing skip).
- **Captures.** No browser errors in either capture run.

## Known limits

- **Stones bend with the ground.** Curvature under the paving must stay gentle (D-204). The
  vertical shear keeps stone sidewalls vertical instead of rotating them with the slope, which
  is invisible at these grades.
- **Greybox grass artifacts.** The Standard-material grass shows CSM acne bands, faint on flat
  ground and more visible on the slopes, plus a banded sun specular. Paving is unaffected. This
  belongs to package 6 (small-scale shadows and CSM bias) or to real ground material.
- **Render-thread drape build.** The field is built from the cell's JSON on the render worker
  (about 1 ms). Precompute it at build time if detail regions grow.
