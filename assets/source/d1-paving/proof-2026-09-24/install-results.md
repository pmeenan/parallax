# Photoreal paving installation — result (2026-09-24)

**The ordinary build, install, stream and render path now carries the delivered paving.** The
D1 courtyard renders the admitted module as 4 × 4 tiles in the game. The build packages the
module and the installer-repair production replay installs it. The streaming worker reads it
from OPFS package handles, the decode pool decodes it, and the render worker draws it through
the existing PBR placements. There were no browser errors, decode failures or pipeline failures.

One budget is busted, and its cause is recorded and attributed. The paving cell loads in 367 ms
against the 250 ms cell-load p95 budget. Its 237 MB RGBA8 upload blocks the render worker for
146 ms, against the 50 ms hitch budget. Both costs come from uploading uncompressed RGBA8. The
GPU-compressed texture package addresses them (below). Human visual acceptance of the installed
views remains open; the look is unchanged from the accepted delivery.

![Installed game, walking view, clear daylight](install/walking-matched.png)

Other views, all at 3841 × 2161 downscaled to 1920 wide:
- [joint close-up](install/joint.png)
- [12° grazing sun](install/grazing.png)
- [courtyard overview](install/courtyard-overview.png)

The overview shows no tile seams, and the tile repetition reads as a pattern only across the
open pad. The grazing view shows the engine gap: centimetre relief casts no shadow.

## What changed

- **Asset: candidate 4.** This is accepted candidate 2 with two changes:
  - A pebble LOD2: shells of 16 mm or more, 12 triangles each.
  - The normal map stored as plain RGBA8 instead of zstd. zstd level 19 on a 4096² chain took
    430 ms to decode in the worker; plain RGBA8 takes 22 ms and adds 43 MB on disk.

  [provenance.json](provenance.json) records the procedural-original lineage. The library
  manifest `assets/library/d1-paving.json` admits it under D-186 (candidate
  `83a0ebc0…35b4d`), with a production-worker decode receipt covering all 26 runtime resources.
  The previous individual-stone kit, its QA scripts and its game placements are removed. That
  includes the slope diagnostic's stones, because the library manifest now binds only this
  module. The kit remains in git history.
- **Streaming.** D-197 turns the size caps into telemetry rails: 8 GiB resident encoded, 1 GiB
  encoded or decoded per dependency, and 8 GiB of batch staging. Tests now assert the rails,
  not the old caps.
- **Decode worker.**
  - zstd supercompression uses the pinned `@babylonjs/ktx2decoder` zstd wasm, now shipped as a
    decode-worker artifact. Compression Streams have no zstd in Chrome 152 (RE-050).
  - `engine/src/streaming/ktx2-rgba8.ts` reads uncompressed RGBA8 KTX2 (UNORM or sRGB, plain or
    zstd). It validates the header, colour space, level sizes and payload sizes. The pinned
    Babylon decoder accepts only Basis payloads.
- **Packaging.** `harness/scripts/pbr-asset-packaging.mjs` has a single periodic-surface-module
  mode. Each placement names its part through `variantId`, and bounds are checked against the
  owning cell.
- **Game data.** `game/src/world/district-1-paving.ts` places 16 tiles with a 21 mm lift and
  a shared anchor. The field starts 5 cm inside the pad: edge-crossing pebbles and leaves
  overhang a tile by up to 2.2 cm, and every placement must stay inside its owning cell. LOD
  distances are 12/32 m for the ground, 6/12 m for pebbles and 8/24 m for plants.

## Measurements

Build `193f0f4d…` in pinned Chrome 152.0.7977.54 on dev-01. The capture used
`?parallaxAutomation=runtime`. That route provisions packages over the network into the same
OPFS handles, then runs the same streaming worker, decode pool and render path. It is focused
inspection, not a budget gate ([capture-summary.json](install/capture-summary.json),
[capture.mjs](install/capture.mjs)).

**Paving cell load (initial residency, 29 dependencies):**

| Stage | ms | Bytes |
| --- | ---: | ---: |
| OPFS read | 42.6 | 132,272,295 encoded (maps 119.5 MB, geometry 12.7 MB) |
| Decode (4 workers) | 156.4 | 236,894,048 decoded |
| Upload | 140.6 | 236,894,048 |
| **Total** | **367.2** | resident GPU 237 MB |

- **Per-map decode** (production receipt):
  - base colour UASTC → RGBA8: 64.8 ms
  - lossless normal: 22.0 ms
  - ORM: 25.4 ms
  - largest geometry stream (pebble LOD0 vertices): 11.5 ms
- **Batch commit.** The boot batch of nine cells commits together, so its other cells report the
  same 320–367 ms totals, although their own work is under 5 ms each. Later cell loads took
  0.8–1.7 ms.
- **Textures** are 210 MB of the 237 MB resident: two 4096² RGBA8 maps at 89.5 MB each, the
  ORM at 22.4 MB, and the plant maps at 8.4 MB.

**Frame cost** (60-frame p50 at 3841 × 2161, whole frame including CSM):

| View | GPU ms | PBR triangles submitted |
| --- | ---: | ---: |
| Walking | 4.86 | 5.08 M |
| Walking (matched) | 5.25 | 5.08 M |
| Close | 5.16 | 5.33 M |
| Joint | 5.11 | 5.38 M |
| Grazing | 5.50 | 5.38 M |
| Overcast | 5.63 | 5.38 M |
| Courtyard overview | 5.25 | 3.97 M |
| Courtyard far | 2.36 | 0.59 M |

CPU submit is 0.23–0.28 ms p50. The triangle counts include tiles outside the view. Thin
instances are culled per draw group, not per tile, so per-tile culling is a cheap win if the
GPU time matters.

**Install.** The installer-repair production replay passed:
`installer-repair-production-replay-v4-2026-09-24T16-02-00-668Z.json`, SHA-256 `be1381c9…4943`.
It installed 357 OPFS resources totalling 2,754,019,327 bytes, then repaired an injected
corruption, in both the same-worker and restarted modes. The replay contract is rebound to this
build (semantic contract version 15).

**Checks.** `pnpm check` passed: build, lint, and 2,689 unit tests in 219 files, with one
skipped. The scale-streaming corpus test now expects the periodic paving inventory: 375 install
resources, 2,755,619,864 bytes and 47 cache keys.

## Not done

- **An installer-provisioned runtime capture.** The ordinary installer → launch route is proven
  by the replay. The courtyard frame and cell numbers above come from the runtime route.
  `pnpm harness:scale-streaming --physical-console-confirmed` measures an installed profile end
  to end, but it requires a person at the physical console.
- **Human review.**
  - Visual acceptance of the installed views.
  - Rights: `rightsReview` in provenance.json was approved by the lead agent for this
    procedural-original asset, and a human should confirm it.
- **Physical `smoke@1`** stays at M4.5 exit (D-181).

## Next engine packages

1. **GPU-compressed textures.** Transcode UASTC to BC7 in the decode worker instead of to RGBA8.
   Encode the normal as BC5 and measure it against the lossless map under grazing light, then
   chunk uploads across frames. BC7/BC5 are 1 byte per texel, a quarter of RGBA8. That brings the
   paving's 210 MB of textures to about 52 MB, shrinks the upload and the stall with it, and
   removes most of the decode time. The adapter reports `texture-compression-bc`.
2. **Lighting and ambient occlusion.** Calibrate sun and ambient levels, and use the ORM
   occlusion for direct and hemispheric light, not only IBL. Lite applies it to IBL only, and
   the game has no IBL.
3. **Small-scale shadows.** The CSM (four 1024² cascades, 0.12 m world-space bias) cannot
   resolve centimetre relief. Candidates are screen-space contact shadows or normal-map
   self-shadowing for joints and pebbles, with a tighter near-cascade bias.
