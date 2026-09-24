# Photoreal paving installation — brief (engine package 1, 2026-09-24)

Follows the [delivery result](delivery-results.md). The human directed that engine work proceed
alongside asset delivery, and that self-imposed caps not constrain quality while costs are learned
(D-197). This is the first of three engine packages the delivery exposed:
1. install path
2. lighting balance and ambient occlusion
3. small-scale shadows

**Scene and states.** The periodic 4 m module is placed as 4 × 4 tiles over the D1 courtyard pad
([0, 16]² at 18.97375 m). It replaces the individual-stone kit there; the slope diagnostic
keeps its stones. It is inspected in the ordinary installed game through the flythrough
`previewScene` cameras: walking, close, joint, grazing and overcast states, plus a traversal
across the tiles.

**Question.** Can the ordinary install, launch, stream and render path carry the delivery
candidate unchanged? That path covers OPFS residency, decode workers, upload, PBR placements and
PSO warmup. The candidate is 4096² maps, a lossless normal, and three parts × three LODs. What
do cell load, decode, upload, memory and frame costs measure?

**Work.**
- **Streaming.** Convert the D-197 caps to telemetry, together with their tests. The smoke
  evidence's resident-encoded check is a harness evidence contract: relax it explicitly and
  flag it for review.
- **Decode worker.**
  - zstd supercompression, reusing the render worker's pinned zstd artifact.
  - An engine-owned parser for uncompressed RGBA8 KTX2, for the lossless normal. The pinned
    Babylon decoder accepts only Basis payloads.
- **Packaging.** A periodic surface-module library mode, with a class config that keeps the
  structural checks and records sizes. Admission uses the production-worker decode receipt.
- **Game data.** Tile placements, and removal of the courtyard's stone kit.
- **Telemetry.** Per-part triangles and draw groups, dependency decode and upload times, and
  GPU bytes.

**Must fix.**
- Any decode, upload or pipeline-compile failure.
- Missing or mis-oriented tiles, visible seams, or LOD pop in the installed game.
- A cell load that busts the player-visible p95 budget without a recorded, attributed cause.

**Allowance.** Two implementation/capture/evaluation cycles within one work session (4 active
hours). Focused tests, then `pnpm check`. Physical smoke stays at M4.5 exit.

**Ending decision.** Either the courtyard renders the candidate in the installed game with
measured costs, or a named failing contract with its measured cause. BC7 GPU upload, lighting
and shadows are separate packages. Human artistic acceptance, rights and final QA remain open.
