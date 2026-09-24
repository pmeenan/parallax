# GPU-compressed streamed textures — result (2026-09-24)

**Adopted: streamed PBR textures reach the GPU as BC7.** UASTC maps transcode to BC7 blocks in
the decode worker, and the render worker uploads them as `bc7-rgba-unorm(-srgb)`.
`texture-compression-bc` is now a required device feature (D-199). The paving is re-delivered
as candidate 5: every map, the ground normal included, is UASTC encoded at `LEVEL_SLOWER`.

| Paving cell (installed game, 4K) | RGBA8 (install result) | BC7 (this package) |
| --- | ---: | ---: |
| Total cell load | 367 ms | 230 ms |
| OPFS read | 43 ms | 24 ms |
| Decode | 156 ms | 101 ms |
| Upload | 141 ms | 83 ms |
| Render-worker batch stall | 146 ms | 90 ms |
| Encoded bytes read | 132.3 MB | 65.2 MB |
| GPU bytes (maps + geometry) | 237 MB | 80 MB |

Captured views match the RGBA8 build to within 0.4/255 mean per channel (maximum 15/255), with
no luminance difference above 8/255 at any pixel. Frame times are unchanged within run-to-run
variance: 4.9–5.8 ms GPU p50 near the paving, 0.16–0.20 ms CPU submit.

The cell now loads inside the 250 ms cell-load budget. The render-worker stall is still over
the 50 ms hitch budget. Texture uploads now take about 15 ms of it; the rest is mesh
construction on the render thread (below). The package used its two cycles in one session
([brief](texture-brief.md)).

![Joint close-up: RGBA8 (left) and BC7 candidate 5 (right), 1:1 crops](texture/joint-compare.png)

## Cycle 1: the engine path

- **Descriptors** declare each texture's GPU format, `rgba8` or `bc7`. BC7 requires a complete
  mip chain with a whole-block base level; expected sizes count 16-byte 4 × 4 blocks, with
  sub-block mips padded to one block.
- **Decode worker.** UASTC transcodes with Babylon's pinned `uastc_bc7.wasm`, which already
  shipped for the render worker's glTF loader. Raw RGBA8 KTX2 cannot be requested as BC7.
- **Upload.** Mip levels copy as block rows. A device without `texture-compression-bc` fails
  closed.
- **Packaging.** UASTC library maps get `bc7` descriptors; raw RGBA8 maps keep `rgba8`.

With candidate 4's maps unchanged, the BC7 build rendered identically to the RGBA8 build
(0.1–0.2/255 mean difference). It cut GPU bytes from 237 to 147 MB and the load from 367 to
292 ms. The lossless 89.5 MB RGBA8 normal then dominated the upload.

## Cycle 2: the asset and the normal

- **UASTC level.** Web-libktx 4.4.2's embind binding silently ignores a numeric `uastcFlags`;
  only the enum object (`pack_uastc_flag_bits.LEVEL_SLOWER`) sets it. So candidates 1–4 were
  all encoded at `LEVEL_FASTEST`. Re-encoding at `LEVEL_SLOWER` cut the ground base colour's
  mean error from 0.73 to 0.66/255, and the plant maps' from 0.15–0.22 to 0.06–0.08/255.
- **The ground normal.** At `LEVEL_SLOWER`, UASTC moves the mean texel 2.2° (was 4.0°); 8.6%
  of texels move more than 5° (was 24%) and 0.7% more than 10° (was 8%). Level `DEFAULT` measured
  2.3°, 9.5% and 0.8% at a third of the encode time.
- **The A/B.** Candidates 5a (UASTC normal) and 5b (lossless RGBA8 normal) differ only in the
  normal. In-game they differ by 0.08–0.22/255 mean, maximum 10, with no pixel above 8/255 in
  luminance. That is smaller than the base colour's own level-0 to level-3 change. Candidate 5a
  was admitted: the lossless normal bought nothing visible for 67 MB on disk and on the GPU.
- **Mesh construction.** Profiling the batch found the render worker splitting each interleaved
  vertex stream with three typed-array views per vertex: about 1.9 million allocations for the
  paving's 640k vertices. Plain indexed copies cut the upload from 110 to 85 ms.

## What remains

The 90 ms stall is now mostly mesh construction for about 640k vertices and 3.3M indices across
18 geometry streams. The pebble LOD0 mesh alone takes about 20 ms. Removing it needs either
geometry prepared off the render thread (de-interleaved, bounds precomputed) or batch uploads
spread across frames. Both change the render batch transaction, so they are a next package, not
an extension of this one. Merged pebble shells are 77% of geometry bytes; per-instance pebbles
would also shrink this.

BC5 normals are unavailable: Lite 1.12's PBR shader reads the normal's `.rgb`, and its
normal-scale hook cannot rebuild Z.

## Evidence

- Build `748dec8c…`, pinned Chrome 152.0.7977.54, dev-01. Runtime-route capture
  (`install/capture.mjs`), with retained [joint](texture/joint-compare.png) and
  [grazing](texture/grazing-compare.png) comparisons.
- Candidate `79fc60ec…ebfa`, admitted with a production-worker decode receipt covering all 26
  runtime resources. The base colour decodes to BC7 in 32 ms (65 ms to RGBA8), the normal in
  24 ms.
- Installer-repair production replay passed on the final build:
  `installer-repair-production-replay-v4-2026-09-24T17-28-46-368Z.json`, SHA-256
  `3b1845c4…7b`. The installed OPFS inventory is 357 resources, 2,686,910,439 bytes.
- Installed profile: `pnpm harness:scale-streaming` passed at the physical console,
  `scale-streaming-v1-2026-09-24T17-32-12-608Z` (JSON SHA-256 `a8aa08dd…43b3`). The installer
  wrote 2,688,510,976 bytes in 375 resources in 129 s. The runtime bound 304 resources,
  67,942,807 bytes. The paving cell hydrated with read 23 ms, decode 109 ms and upload 68 ms,
  80.1 MB decoded. Traversal cell-load p95 was 2.2 ms over 36 loads.
- `pnpm check` passed: build, lint, and 2,693 unit tests in 219 files, with one skipped.
