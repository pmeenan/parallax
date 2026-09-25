# Texture compression A/B — result (engine package 3, 2026-09-24)

**Adopted; the human accepted candidate 7's look on 2026-09-24.** Base colours now ship as
pre-encoded BC1 (D-201), and the ground normal ships at 2048². Paving candidate 7 halves the
paving's map bytes and its GPU memory, and it cuts the cell load nearly in half. In-game close
and joint views are indistinguishable from accepted candidate 6. ([Brief](compression-brief.md).)

| Paving cell, runtime route (this session) | Candidate 6 | Candidate 7 |
| --- | ---: | ---: |
| Map bytes, download and GPU | 52.5 MB | 24.1 MB |
| All runtime resources | 58.2 MB | 29.9 MB |
| GPU memory, maps and geometry | 65.9 MB | 37.6 MB |
| Dependency decode | 82 ms | 40 ms |
| Total cell load | 157 ms | 85 ms |
| Render-worker batch stall | 29.8 ms | 19.7 ms |
| Installed OPFS | 2,679,943,915 B | 2,651,632,282 B |

## Cycle 1: what each option buys

- **BC1 base colours.**
  - **Look.** A temporary in-game A/B, using the pinned decoder's runtime UASTC→BC1 target,
    matched BC7: mean change 0.8–0.96/255 and nothing visible
    ([close view](compression/ingame-close-c6-c7.png)).
  - **Cost.** That transcode is a real BC1 encode. The 4096² base colour took 276 ms against
    33 ms for BC7. That run's paving cell loaded in 393 ms, over the 250 ms budget.
  - **Delivery.** The pinned decoder cannot pass BC levels through; it reads unknown colour
    models as ETC1S. So BC1 ships pre-encoded (below).
- **2048² ground normal.** In the preview it changed little: mean ≤0.67/255, max 23/255, and at
  most about 1,200 of 1.6 M pixels over 8/255 in luminance
  ([joint, 4096² | 2048² | difference](compression/preview-joint-normal-4096-2048.png)). This is
  unlike the earlier all-maps-at-2048² test, which softened the base colour visibly. Saving:
  16.8 MB on disk and on the GPU.
- **Dropped: BC5 normals and BC4 ORM.** BC5 is the same size as BC7, so it saves nothing. BC4
  would save 2.8 MB, but it needs a transcode outside the pinned decoder's decision tree and a
  roughness swizzle in the shader.

## Cycle 2: candidate 7

- **Packer.**
  - `pack.mjs` encodes each base colour to UASTC, then transcodes it to BC1 with Web-libktx.
    The ground normal is packed from its 2048² authored level.
  - `PAVING_BASECOLOR_GPU=bc7` and `PAVING_GROUND_NORMAL_SIZE=4096` reproduce candidate 6.
  - Level-0 mean error against the source: base colour 2.87/255 (BC1), ground normal 2.61/255
    (UASTC at 2048²).
  - A JS BC1 decoder produces the preview dumps and the error figures from the shipped blocks.
- **Engine.**
  - `bc1` is a streamed GPU format. The decode worker validates a raw BC1 container (vkFormat,
    colour space, level count, exact level sizes, no supercompression) and copies the levels.
    A UASTC container requested as `bc1` fails closed.
  - The render worker uploads 8-byte block rows.
  - Packaging and the decode receipt derive the GPU format from the admitted `encoding`
    (`uastc` → BC7, `bc1` → BC1, RGBA8 → RGBA8).
  - The decoder gap is recorded in the rendering research's interop table.
- **QA.**
  - Preparation accepts BC1 containers. The class config sets a separate ground-normal
    density: 512 texels/m, against 1024 for the base colour.
  - Admitted as candidate `97cab678…e598` with a production-worker decode receipt covering all 26
    resources. The base colour now decodes in 2 ms.
  - Provenance extends the lineage and binds the new `pack.mjs`, on the same procedural rights
    basis.
- **Look.** Across the eight in-game views the mean change is 0.06–1.17/255. The close and
  joint views show nothing visible
  ([close](compression/ingame-close-c6-c7.png), [joint](compression/ingame-joint-c6-c7.png);
  candidate 6 | 7 | difference × 4).

**Library status.** Readmission reset the paving to pending. After the human accepted it, the
library records `QA-admitted-runtime-visual-accepted` bound to candidate `97cab678…e598`.

## Follow-up: no client transcoding (candidate 8, D-202, D-203)

| Paving cell, runtime route (this session) | Candidate 7 | Candidate 8 |
| --- | ---: | ---: |
| Dependency decode | 39.8 ms | 17.4–18.5 ms |
| Total cell load | 85 ms | 61–65 ms |
| Render-worker batch stall | 19.7 ms | 19.8–20.7 ms |
| Runtime bytes | 29,885,264 | 29,885,264 |

- **BC7 at rest.** Every remaining UASTC map (the ground normal and ORM, the plant normal and
  ORM, the pebble maps) ships pre-transcoded to BC7. That costs no bytes: UASTC and BC7 are both
  one byte per texel. The packer uses the pinned Babylon `uastc_bc7.wasm` in Node, the same
  transcoder the decode worker used, so the blocks are identical; Web-libktx's own UASTC→BC7
  picks different blocks. A generated fixture checks that the runtime transcode matches the
  pack-time output block for block. The eight in-game views match candidate 7 outside the
  diagnostic overlay. Map decode in the receipt fell from 23.0 to 5.4 ms.
- **Transcoder currency.** The library records the transcoder
  (`encoders.bc7Transcoder` = `@babylonjs/ktx2decoder` 9.27.1 and the wasm SHA-256). Packaging
  warns when the pack lags the engine's pin. [Dependencies](../../../../docs/dependencies.md)
  make repacking part of every decoder upgrade, so maps pick up transcoder fixes.
- **Geometry validation at build time (D-202).** The decode worker no longer scans for
  non-finite attributes or out-of-range indices. The build validates every meshopt payload once,
  and QA preparation checks the paving library. Geometry decode in the receipt fell from 19.2 to
  11.7 ms.
- **GPU-ready delivery rule (D-203).** The build refuses any streamed resource needing client
  work unless a registered exception covers it. The one exception is meshopt geometry: 2.3×
  smaller, a 7.5 MB saving on the paving, for about 6 ms of decode with the pinned decoder's
  wasm SIMD build. The compact production fixture now ships as raw RGBA8. The build log reports
  `meshopt-geometry × 20` and nothing else.
- **Admission.** Candidate `51a20ab4…0febd`, with a production-worker decode receipt covering
  all 26 resources. Build `42700196…b402`; the installer-repair replay was rebound to v21 and
  passed (`…2026-09-25T00-06-15-642Z.json`, SHA-256 `ab87a0d0…7e0f`). Its look is pixel-identical
  to accepted candidate 7; recording its acceptance is the human's step.

## Follow-up: zero-copy texture levels (optimisation review)

The [optimisation review](optimization-review.md) found that the decode worker still copied
every pre-encoded level: 24.1 MB, about 5.3 ms in a Node diagnostic.
- **Views, not copies.** Each level is now a `Uint8Array` view into the one transferred KTX2
  buffer. Both worker boundaries transfer each distinct buffer once, and the render worker's
  `writeTexture` copies exactly each view's range.
- **Tests.** A test checks the shared buffer, and that a single-entry transfer preserves every
  view's exact bytes.
- **In Chrome** (build `c2728534…fc5f`):
  - Decode is 10.9–11.4 ms, from 18.5, and the cell load is 54–57 ms, from 65.
  - All eight views match the previous build outside the diagnostic overlay.
  - An eviction probe moved the observer 1.5 km away. The paving cell left residency (GPU
    37.6 MB → 0.3 MB), then reloaded on return with identical GPU bytes, identical pixels and
    no browser errors. The reload decoded in 8.9 ms.
- **Replay.** Rebound to v22 and passed: `…2026-09-25T00-36-56-147Z.json`, SHA-256
  `0f257d21…173f`.
- **Deferred to package 4.** A 1024² ground ORM saves 4 MiB and should be judged under the
  lighting and AO work. Bounds precompute (about 0.55 ms), 16-bit indices and packed vertices
  are deferred as low return.

## Deferred: RDO UASTC download

Without RDO, zstd-19 saves only 12% on the 4096² UASTC maps. Candidate 7 leaves 12.7 MB of UASTC
maps: 5.6 MB normal, 5.6 MB ORM and the plants. BC1 base colours compress by 18% with zstd-9
(11.19 → 9.14 MB). HTTP `Content-Encoding: zstd` is the cheaper download win; it is a human-admin
nginx change. Reopen RDO if the download itself becomes a named bottleneck.

## Evidence

- Pinned Chrome 152.0.7977.54 on dev-01, remote session: timings are advisory.
- **Final build.** Build manifest `670d7722…953f`; runtime-route capture with no browser errors,
  and PSO warmup `ready`.
- **Installer-repair production replay.** Rebound to semantic contract v19 and passed:
  `installer-repair-production-replay-v4-2026-09-24T23-04-05-593Z.json`, SHA-256
  `174913c0…2b0e`.
- **A/B runs and candidate 7 QA.** In
  `harness/results/paving-photoreal-delivery-2026-09-24/compression-ab/` and `candidate7/`
  (ignored, machine-local).
- **Tests.** Focused tests cover BC1 level sizes, the exact BC1 passthrough of a generated
  Web-libktx fixture and its rejection cases, BC1 upload, and the packaging mapping.
- **Physical smoke.** It waits until the optimisation packages finish (human direction).
- **Candidate 8 evidence** is in `harness/results/paving-photoreal-delivery-2026-09-24/candidate8/`.
