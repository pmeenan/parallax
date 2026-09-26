# Small-scale shadows — result (engine package 6, 2026-09-25)

**Outcome: adopted (D-206). The human visually accepted the look and paving candidate 10
(2026-09-25); the library records the acceptance against the candidate.**
The paving now casts sun shadows from its own relief, the greybox grass acne and the sunlit-wall
striping are gone, and the CSM pass is about 2 ms cheaper. Both allowed cycles were used in one
session on dev-01 ([brief](shadows-brief.md)).

![Grazing 12° sun: before and after](shadows/grazing-before-after.png)

Before (left, build `eb482d02…`) and after (right, build `8439134a…`) at the 12° sun. The stones'
sun-away edges now throw shadows across the joint soil.

## What changed

- **Sun micro-shadowing** (`render/pbr-sun-microshadow.ts`). Paving candidate 10 stores the
  occluding height (ground plus drawn-in pebble tops, the AO bake's surface) in ORM.B, over its
  31.1 mm range. A PBR plugin at the final-composition hook marches it toward the sun:
  - 12 quadratically spaced steps, ending once the ray clears the top of the field or at 0.25 m;
  - a cone penumbra 0.03 per metre wide (about 1.7°), with a 0.3 mm bias for BC7 noise;
  - the sun direction in the tangent plane of the geometric normal, mapped to texture space by the
    placement's exact world-to-UV gradient (the canonical X mirror included);
  - it fades out over two mip levels from 2.5 texels per pixel, and scales only
    `directDiffuse + directSpecular`, so ambient and AO are untouched.
- **CSM receiver normal offset** (`render/csm-normal-offset-receiver.ts`). Lite's receiver fragment
  is replaced for Standard and PBR materials. Each lookup moves 3 cascade texels along the
  geometric normal, scaled by the sine of its angle to the light. The caster bias drops from
  0.12 to 0.06 m.
- **Caster set.** `castsCsmShadows: false` keeps the paving ground and pebbles out of the CSM; the
  plants still cast.
- **Candidate 10** (`3c64cf17…dabe`). `maps.py --orm-b-height 1` (the default) writes the height,
  and the packer carries its range into the library as `ormHeightRangeMetres`. Every other map and
  all geometry are byte-identical to candidate 9. Encode error: R/G mean 1.06/1.17 per 255 (about
  0.8 in candidate 9, where B was constant), B 1.27 per 255, which is 0.16 mm of height. Bytes and
  GPU memory are unchanged. Structural QA, a production decode receipt (26 of 26), admission and
  runtime visual acceptance passed.

## Why not Lite's screen-space contact shadows

The exact pin's `createScreenSpaceContactShadowsPostProcessTask` was read at source and not taken:
- **Depth.** It requires single-sample colour and depth; the renderer is MSAA 4, so it would need
  a full depth prepass.
- **Composition.** It multiplies the final, tone-mapped colour, so ambient and CSM shade darken too.
- **Coverage.** It sees rasterised depth only, missing the relief LOD1–2 carry in their maps.

It stays the candidate for contacts between placed objects.

## Findings

- **The joint gap is not mostly direct shadow.** A CPU march of the shipped field shades 1.6% of
  the paving at a 30° sun and 7.4% at 12°. The full-resolution 4096² source gives 2.3% and 10.6%.
  In the `joint` view, p10 moves 40 → 39 and the change is limited to thin strips beside
  sun-away walls. The Cycles joints stay darker (D-205's p10 41 against 48). D-205 attributed
  that gap to direct shadowing; it is not, and it stays open.
- **The first micro-shadow build darkened every flat top by half.** A constant-width penumbra
  centred on zero clearance gives 50% at the first step. A penumbra proportional to distance
  fixes it, and it is scale-free.
- **Bias.** With the normal offset, 0.12 m left the greybox walls striped; 0.03 m brought terrain
  and wall acne back; 0.06 m with 3 texels is clean.

![Greybox walls: before and after](shadows/walls-before-after.png)

![Grass on the slope, 12° sun: before and after](shadows/grass-before-after.png)

![Joint view: before and after](shadows/joint-before-after.png)

## Costs (dev-01, short diagnostic windows; remote-desktop timings are advisory)

| CSM casters | CSM task (ms, median of 60 frames per view) |
| --- | ---: |
| Everything (baseline, 4K) | 2.10–2.88 |
| Everything (same session, larger display) | 1.05–1.25 |
| Without the paving ground | 0.26–0.46 |
| Without the ground and pebbles (adopted) | 0.13–0.20 |
| Without any paving part | 0.07 |

Excluding the paving parts changed no pixel (mean ≤ 0.23/255 in every view): at the old bias
their 3 cm relief could not cast. Micro-shadowing is within whole-frame GPU noise at 4K
(walking-matched 5.40 against 5.50 ms, joint 5.49 against 5.86, close 5.80 against 5.70, grazing
5.88 against 5.83). Whole-frame GPU medians swing ±0.5 ms with the GPU's power state, so the
task time is the reliable measure.

**Session change.** Partway through the package, dev-01's session became a remote desktop (three
displays, a 6017 × 3386 canvas). The baseline and the first micro-shadow captures ran at the
physical console in 4K. The caster, bias and final captures ran over remote desktop, so their
timings are advisory. Comparisons are within one environment; the before/after images scale
the final capture to 4K.

## Verification

- **Tests.** New `engine/test/small-scale-shadows.test.ts`: world-to-UV gradients under rotation,
  scale and mirroring, UBO writes, uniform-flow derivatives, direct-light-only shading, the
  receiver install and offsets, caster exclusion, and the contract and grouping rules. A packaging
  test covers the new fields. The PSO contract re-pins the PBR WGSL (vertex `294524ca…`, colour
  `b2d29987…`, depth `cb0a2b6f…`) and the Standard receiver (`51e9d155…`).
- **Final build** `8439134a…`, captured with no browser errors in all 16 views, including dusk,
  night and storm, which stay readable ([capture summary](shadows/capture-summary.json)). It is
  pixel-identical to the pre-lint build `ae29ee24…`, which differed only in import order.
- **Installer-repair replay.** Rebound to semantic contract v25 and passed on the final build:
  `installer-repair-production-replay-v4-2026-09-25T20-24-24-199Z.json` (SHA-256 `558e0ee6…9977`).
- **Installed scale-streaming** on dev-01's physical console passed on the final build and release
  (`c3f0d83c…`), with a traversal cell-load p95 of 1.82 ms:
  `scale-streaming-v1-2026-09-26T01-45-41-698Z.json` (SHA-256 `f777320c…87be5`).
- **Retained failed report.** An earlier run failed closed on the physical-environment check,
  because the session had become a remote desktop: `scale-streaming-v1-2026-09-25T20-20-54-329Z.json`
  (SHA-256 `0356ae37…0363`). It loaded nothing.
- **`pnpm check`** passes: build and repeatability, lint (779 files) and unit tests (225 files;
  2,748 passed, one existing skip).

## Known limits

- The plugin shades all PBR direct light as sunlight. Local lights need their own term.
- The shipped 1024² field loses about 30% of the source's shadow area; a 2048² ORM would recover
  it for 4 MiB.
- The greybox is still not tone mapped (D-205).
- The micro-shadow march was inspected in stills only; the moving-sun behaviour rests on the
  bilinear field and the soft penumbra.
