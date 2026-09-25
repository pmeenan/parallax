# Render-path geometry — brief (engine package 2, 2026-09-24)

Follows the [texture result](texture-results.md) and the Lite 1.31.1 upgrade. The installed
paving cell loads in 218 ms against the 250 ms cell-load p95 budget. Its render-worker batch
upload stalls for 86 ms against the 50 ms hitch budget. A runtime-route capture on build
`601c5b0` at the start of this package measured a paving upload of 85.8 ms (89.7 ms for the batch)
and a 102 ms decode.

About 15 ms of the stall is BC7 texture upload. The rest is geometry: 642,945 vertices
(20.6 MB interleaved) and 1.65 M indices (6.6 MB) across nine LODs. On the render thread each
LOD is re-validated, de-interleaved into three arrays, bounded and copied into four GPU buffers.
Lite also keeps the CPU arrays. The decode worker has already validated the same data. Pebble
LOD0 is 439,248 of those vertices: 3,927 merged shells at about 112 vertices each.

**Scene and states.** The installed D1 courtyard and its capture views: walking, walking
matched, close, joint, grazing, overcast, overview and far
([install/capture.mjs](install/capture.mjs)). Telemetry comes from the same runtime-route run:
the paving cell's `uploadMs`/`dependencyUploadMs` and the batch's `batchDirectUploadMs`.

**Question.** How much of the stall goes when the render thread only moves prepared bytes to the
GPU? What remains, and is it the pebble geometry or the upload mechanism?

**Cycle 1: engine path (no asset change).**
- **Decode worker.** Vertex decode computes the position bounds in its existing finite-value
  pass. Index decode already range-checks. The render thread stops repeating both loops.
- **Render worker.** PBR geometry draws straight from one interleaved 32-byte vertex buffer
  and one index buffer. It uses Lite 1.31's `createStorageBuffer` and
  `createMeshFromStorageBuffer`, with bounds from the decode worker. Nothing is de-interleaved
  and no CPU copies are retained. PBR source meshes are no longer added to the scene as hidden
  Standard-material meshes; only their placement clones draw.
- **PSO warmup.** The PBR colour and depth states pin the slab's vertex layout (stride 32;
  offsets 0/12/24). The warmup mesh uses the same slab, so D-183's installed warmup still covers
  every runtime PBR pipeline. Standard pipelines are unchanged.
- **Must fix.** Any GPU validation error, missing or unwarmed pipeline, or pixel change in the
  capture views. The change is engine-only, so captures must match the baseline. Also any
  cell-load regression or leak on eviction.

**Cycle 2: chosen from cycle 1's numbers.**
- **Stall still over 50 ms, mostly upload mechanism:** spread the batch's geometry and texture
  uploads across frames.
- **Stall within budget:** start the pebble A/B from the plan as a new paving candidate. Pebbles
  dominate bytes, vertices and GPU time. The pebble candidate needs QA and human visual
  acceptance. Engine work may land before it is accepted.

**Allowance.** Two implementation, capture and evaluation cycles within one work session (4
active hours). Focused tests, the runtime-route capture, then `pnpm check`. This session runs on
a remote console. Frame times here are advisory, and the physical installed scale-streaming
run and `smoke@1` wait for the console (D-181).

**Ending decision.** Adopt the geometry path with measured before/after numbers. Otherwise, name
the failing contract and its measured cause. The next package is the texture-compression A/B.
