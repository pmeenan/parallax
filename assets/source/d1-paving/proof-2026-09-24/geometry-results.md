# Render-path geometry — result (engine package 2, 2026-09-24)

**Adopted: streamed PBR geometry draws straight from the decode worker's interleaved bytes.**
The paving cell's render-worker stall fell from 89.7 ms to 32.5–37.1 ms, inside the 50 ms hitch
budget. The capture views are pixel-identical to the baseline. The pebble A/B (cycle 2) produced
two pebble options. The human accepted the combined one on 2026-09-24, and it ships as
**candidate 6**: crease-angle normals plus an 11 mm 3D cut-off. Candidate 6 brings the stall to
28–30 ms and the paving's GPU memory to 65.9 MB. ([Brief](geometry-brief.md).)

## Cycle 1: the engine path

| Paving cell, runtime route (this session) | Baseline `601c5b0` | Final build |
| --- | ---: | ---: |
| Render-worker batch stall | 89.7 ms | 32.5 ms (37.1 ms in the first run) |
| Paving cell upload | 85.8 ms | 28.3 ms (32.9 ms) |
| Dependency decode (decode worker) | 102 ms | 106 ms (120 ms) |
| Total cell load | 228 ms | 175 ms (197 ms) |
| GPU bytes, maps and geometry | 79,849,964 | 79,849,964 |

- **Decode worker.** After rejecting non-finite values, the vertex decode computes position
  bounds in a second scan. Merging the two scans would be a small optional optimization. The index decode already range-checked every index. The streaming worker's
  decoded-payload check now requires finite, ordered bounds.
- **Render worker.** PBR geometry uses Lite 1.31's `createStorageBuffer` and
  `createMeshFromStorageBuffer`. There is one 32-byte interleaved vertex buffer and one index
  buffer per LOD, plus the decode worker's bounds. The render thread no longer re-validates,
  de-interleaves or scans the data. The per-LOD work is two mapped-buffer copies.
- **Memory.** Lite keeps no CPU copies of these meshes. Before, it retained about 27 MB of
  de-interleaved arrays for the paving, a figure computed from the stream sizes, not measured.
- **Ownership.** PBR source meshes stay out of the scene; only their placement clones draw. The
  dependency cache disposes each mesh and its two allocations on final release. The old hidden
  Standard-material source meshes are gone. Non-PBR meshopt fixtures keep the old path.
- **PSO warmup.** The PBR colour and depth states pin the slab layout: stride 32, offsets
  0/12/24. The warmup mesh draws through the same helper. The composed WGSL hashes are
  unchanged. Installed warmup compiled all five pipelines and stayed `ready`.
- **Pixels.** Across all eight views, only the HUD telemetry text differs from the baseline.
  That is 0.02–0.03% of pixels, and the scene is identical.

The remaining 28–33 ms is about 15 ms of BC7 texture upload plus the geometry copies. At this
level, spreading uploads across frames is not needed.

## Cycle 2: pebble A/B

A patch to `pack.mjs` added two overrides:
- `PAVING_PEBBLE_CREASE_DEG` shades angular variants with crease-angle normals, so faces within
  the angle share vertices.
- `PAVING_PEBBLE_LOD0_MIN_MM` raises the LOD0 3D-pebble cut-off.

Each variant was repacked from candidate 1's stage-2 maps and validated. Each was then compared
with candidate 5 in the isolated pinned-Chrome preview, which now uses the runtime's slab
geometry path.

| Variant | Pebble LOD0 vertices / triangles | Pebble meshopt (all LODs) | All geometry decoded | 4K GPU p50* | Look vs candidate 5 |
| --- | ---: | ---: | ---: | ---: | --- |
| Candidate 5 | 439,248 / 251,328 | 9.88 MB | 27.18 MB | 5.29 ms | — |
| Crease 40° | 284,288 / 251,328 | 7.86 MB | 21.90 MB | 4.75 ms | Max 10/255, ≤3 pixels over 8/255 luminance |
| 11 mm cut-off | 125,094 / 72,192 | 3.56 MB | 14.98 MB | 4.54 ms | 9–11 mm joint pebbles lose relief |
| Both | 81,241 / 72,192 | 2.91 MB | 13.25 MB | 4.39 ms | As the 11 mm cut-off |

\*Advisory. This is a remote session, so frame times are not budget evidence.

- **Crease 40°** is visually a no-op. It cuts pebble LOD0 vertices by 35% and total geometry
  bytes by 19%.
- **Combined option.** With the 11 mm cut-off, the 2,799 pebbles of 9–11 mm are drawn only in
  the maps, which already carry all 29,204 pebbles. Walking-view triangles fall from 5.65 M to
  3.50 M, and geometry bytes halve.
- **Cost of the cut-off.** In the joint and close views, those small pebbles lose their 3D
  highlight and silhouette. This is the flat-pebble limit the delivery screens already
  noted. Up to 6,687 pixels change by more than 8/255 in luminance.

Comparisons (candidate 5 | variant | difference × 4):
- [crease 40°, close](geometry/close-crease40.png)
- [both, close](geometry/close-crease40-min11.png)
- [both, joint](geometry/joint-crease40-min11.png)

The agent recommended crease 40° alone. The human accepted both changes as a slight D-200
trade: pebbles are a minor detail that is not inspected close up.

## Candidate 6: admitted and installed

- **Packer.** `pack.mjs` now defaults to both settings. Setting `PAVING_PEBBLE_LOD0_MIN_MM=9`
  and `PAVING_PEBBLE_CREASE_DEG=none` reproduces candidates 1–5's pebbles.
- **Provenance.** [provenance.json](provenance.json) extends the lineage to candidate 6 and binds
  the new `pack.mjs`. The rights basis is unchanged: the same procedural, project-authored
  inputs.
- **Pack.** The pack's runtime streams are byte-identical to the previewed A/B pack.
- **Admission.** Structural QA passed (29 resources, 58,196,896 runtime bytes), then a
  production-worker decode receipt covering all 26 runtime resources. The library admits
  candidate `107c1f60…7f35`. `D1_PAVING.candidateSha256` in the game data follows it.
- **Install size.** The installed OPFS size is 2,679,943,915 bytes, 6.97 MB smaller than
  candidate 5.

| Paving cell, runtime route (this session) | Candidate 5 | Candidate 6 |
| --- | ---: | ---: |
| Render-worker batch stall | 32.5 ms | 28.0–29.8 ms |
| Dependency decode | 106 ms | 82 ms |
| Total cell load | 175 ms | 154–157 ms |
| GPU bytes, maps and geometry | 79,849,964 | 65,922,732 |

The in-game close and joint views match the accepted preview. The large joint pebbles shade
smoothly, and the smallest ones sit flat in the maps
([in-game joint, candidate 5 | 6 | difference](geometry/ingame-joint-c5-c6.png)).

**Installed-game visual acceptance.** The human accepted it on 2026-09-24. The library records
this as status `QA-admitted-runtime-visual-accepted` with a `runtimeVisualAcceptance` entry
bound to candidate `107c1f60…7f35`. Packaging now rejects an acceptance that names any other
candidate, and it rejects an acceptance record on a pending manifest. The build output is
unchanged.

The instanced pebble library stays out of this package. Pebbles take their colour from the
ground map through world-planar UVs, so instancing them needs a shader-side UV. Lite 1.31's
`MaterialPlugin`, which package 3 explores for BC5 normals, may provide it.

## Also fixed

The delivery preview (`chrome-worker.ts`) had been broken since the BC7 package changed
`uploadStreamedPbrTexture`'s signature; the esbuild bundle is not typechecked. It now passes
the GPU format and draws through `createStreamedPbrGeometry`.

## Evidence

- Pinned Chrome 152.0.7977.54 on dev-01, remote session. Timings are advisory, and there is no
  physical-console run.
- **Engine-only build (cycle 1).** Build manifest `601ab51a…389c`, runtime-route capture
  ([install/capture.mjs](install/capture.mjs)). No browser errors, and PSO warmup reached
  `ready` with five entries. The replay passed at semantic contract v17
  (`…T21-15-34-604Z.json`).
- **Final build, candidate 6.** Build manifest `0a54d957…a65c`. The runtime-route capture has no
  browser errors, and PSO warmup is `ready`.
- **Installer-repair production replay.** Rebound to semantic contract v18 and passed:
  `installer-repair-production-replay-v4-2026-09-24T22-25-41-766Z.json`, SHA-256
  `bf707aff…d502`. Other attempts in that directory failed on stale identity pins while the
  rebinds were in progress.
- **Candidate 6 QA.** Pack, candidate and decode receipt are in
  `harness/results/paving-photoreal-delivery-2026-09-24/candidate6/`.
- **A/B packs and previews.** `harness/results/paving-photoreal-delivery-2026-09-24/geometry-ab/`
  (ignored, machine-local).
- **`pnpm check`.** It passed on the final tree, exit 0: build/repeatability, lint on 758 files,
  and 219 test files (2,713 tests, one skipped).
  - **Earlier full runs, during cycle 1.** One failed only in `pso-warmup-qualification-run.test.ts`, with
    result-file close races. Another failed only in `scale-streaming-corpus.test.ts`, on a local
    `fetch failed`.
  - **Isolated reruns.** Both files pass when run on their own.
  - **Treatment.** Neither failure mode touches the changed geometry path, so these look like
    load-dependent flakes. They are not proved pre-existing.
- **Harness pins updated.** The harness's own copy of the PBR PSO state now pins the slab
  layout. The serialized PSO warmup trace grew by 6 bytes, and candidate 6's geometry is smaller.
  The scale-streaming corpus total is now 2,681,544,452.
- **Not run.** The installed scale-streaming run needs dev-01's physical console. `smoke@1`
  stays at M4.5 exit (D-181).
