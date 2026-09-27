# Timber-framed wall installation — result (K1 delivery step 2, 2026-09-27)

**Status: installed; the human's runtime visual acceptance is pending.** The accepted walls now
run through the ordinary install, launch, stream and render path. The library holds delivery
candidate 5, built on source candidate 20, and the test house stands in cell 08-08 beside the paving
pad. Everything below was measured in the built game in pinned Chrome 152.0.7977.54 on an RTX 4080
SUPER at 4K ([brief](install-brief.md)).

![Installed game: front, front-left corner, right facade, street, oak, from the pad](install/results/installed-views.jpg)

## What was built

- **Library.** Packaging reads every manifest in `assets/library/` and resolves assets by id.
  - **Kit-piece mode.** It sits beside the paving's periodic-surface mode. It covers named parts
    and pieces, three LODs, shared atlas and tile materials, and pre-mirrored `~m` variants.
  - **The house as an assembly.** An assembly request expands to one placement per part. Each
    placement is checked against the engine's own matrix, and collision boxes come from the
    transformed LOD0 bounds.
  - **Dedupe.** Identical streams are stored once. An index stream shared by parts with
    different base colours is re-encoded with a rotated triangle order, so every stream keeps one
    dependency chain.
- **Class QA and admission.**
  - [`d1-timber-walls.json`](../../../qa/d1-timber-walls.json) is the architecture-kit class
    config, run by [`prepare-kit-piece-set.mjs`](../../../qa/prepare-kit-piece-set.mjs). It
    checks structure, bounds, LOD monotonicity, unit normals, atlas UV ranges, height ranges and
    the mirrors, and records sizes.
  - Provenance is generalized for any asset
    ([`asset-provenance.mjs`](../../../qa/asset-provenance.mjs)): procedural original,
    Apache-2.0, rights reviewed.
  - A pinned-Chrome production decode receipt checked all 465 resources and passed. Admission
    wrote them to the library as 389 unique objects, with no replacement allowed
    ([`admit-library-candidate.mjs`](../../../qa/admit-library-candidate.mjs)).
  - The manifest's status is `QA-admitted-runtime-visual-acceptance-pending`.
- **Game data.** [`district-1-walls.ts`](../../../../game/src/world/district-1-walls.ts)
  places the house as the `test-house` assembly with building collision:
  - centre (8.5, 30.4), turned a quarter so its front faces +X;
  - standing on the highest ground under it, 3 cm down.
- **Engine: the house stalled the render worker, now fixed**
  ([RE-051](../../../../docs/rough-edges.md#re-051-lite-rebuilds-the-pbr-family-once-per-runtime-thin-instance-pool)).
  - **Stall.** When the cell became resident, Babylon Lite rebuilt the whole PBR family and its
    CSM casters once per streamed thin-instance pool. That meant 340,316 buffers and 170,540
    bind groups in one frame, and a 9.2 s stall that tripped the render heartbeat.
  - **Fix.** [`lite-thin-pool-build.ts`](../../../../engine/src/render/lite-thin-pool-build.ts)
    routes streamed pools through Lite's per-mesh build, which the warmup mesh's group already
    covers. It is a runtime-guarded seam, like D-104's.
  - **Result.** The house now loads with 2,203 buffers and 649 bind groups. All 14 views are
    pixel-identical to the stalled build's.
  - **Upstream.** [UP-005](../../../../docs/upstream-contributions.md#up-005-build-runtime-thin-instance-pbr-meshes-per-mesh-when-the-group-already-covers-them)
    proposes the fix to Lite.
- **Source fixes found in the game.** The first installed views showed two defects: square brace
  ends that were not tight, and daylight through a corner slot on the upper floor
  ([before and after](install/results/from-pad-slot-before-after.png)). The human had both fixed
  in the source: [source candidate 20](../proof-2026-09-25/results.md#candidate-20-mitred-braces-and-closed-corners-2026-09-27)
  and [delivery candidate 5](../proof-2026-09-26/delivery-results.md#candidate-5-2026-09-27-source-candidate-20).

## Measurements

From the capture ([capture.json](install/results/capture.json),
[streaming telemetry](install/results/telemetry-streaming.json)).

| Item | Value |
| --- | --- |
| Launch to ready | 5.3 s, no browser errors, no decode failures, no render recovery |
| Cell 08-08 (house and paving) load | 375 ms total: OPFS read 93, decode 70, upload 168, render transaction 185 (overlapping) |
| Cell 08-08 dependencies | 416; 343 MB read from OPFS, 409 MB to the GPU |
| Placements in cell 08-08 | 131 (83 house parts, 48 paving): under D-197's 256, so the cap stays |
| House triangles, LOD0 / LOD1 / LOD2 | 2.878 M / 0.567 M / 0.174 M |
| Whole-frame GPU p50, 4K | 3.9–5.5 ms over 14 views (street 5.39, front 5.43, overview 3.87) |
| CPU submit p50 | 0.32–0.39 ms |
| Streamed visible meshes | 95–109 per view |
| Wall maps (GPU) | 275.7 MB of BC1/BC7 |

- **Cell load against the budget.** The 250 ms p95 budget is for traversal. This load came in
  the first launch batch, at 375 ms. The cause is attributed: the cell is the first to need
  the whole kit, 409 MB to the GPU, mostly upload (168 ms for 409 MB).
  - The upload benchmark ([upload-bench.json](install/results/upload-bench.json)) wrote the
    kit's 274 MB of BC mips with `writeTexture` in 166 ms, so the time is the copy itself.
  - Later cells reuse the kit through the dependency cache, and Assembly A1's well-court houses
    will share it. Progressive mip residency or time-sliced upload would shorten this first
    load. It is recorded here, not yet a budget bust on a traversal.
- **Frame time.** The whole game frame (terrain, greybox, paving and house) stays under 5.5 ms
  of GPU at 4K. The isolated step-1 preview measured 3.3 ms for walls and paving alone.
- **Frame gaps while streaming.** Since the fix the longest render-frame gap during the launch
  batch is about 300 ms. That hitch predates the house (earlier builds show 266 ms) and belongs
  to streaming, not to this asset.

## Checks

- **Look.** The installed views match the step-1 preview and the source under the same lighting:
  every piece placed, mirrored pieces correct on the side facades, no seams at piece joins, and the
  fixed corners and braces closed. The shaded-facade ground bounce and the 0.25 m details are the
  step-1 limits the human accepted.
- **Contracts.** The installer-repair production replay is rebound to this build (semantic
  contract 27: 744 OPFS resources, 2,965,098,100 bytes) and passes. `pnpm check` passes.

## Reproduce

```bash
node assets/qa/prepare-kit-piece-set.mjs assets/qa/d1-timber-walls.json <delivery dir> <candidate dir>
```

```bash
node assets/qa/production-decode-receipt.mjs <candidate dir> <receipt.json>
```

```bash
node assets/qa/admit-library-candidate.mjs <candidate dir> <receipt.json> d1-timber-walls.json
```

```bash
pnpm build
```

```bash
node assets/source/d1-walls/proof-2026-09-27/install/capture.mjs <out dir>
```

The delivery directory holds step 1's `extract.json`, `maps.json`, `geometry/` and `pack/`
([delivery reproduce](../proof-2026-09-26/delivery-results.md#reproduce)).
