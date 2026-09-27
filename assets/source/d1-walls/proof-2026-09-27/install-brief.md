# Timber-framed wall installation — brief (K1 delivery step 2, 2026-09-27)

Follows the accepted [step 1 result](../proof-2026-09-26/delivery-results.md) (delivery
candidate 4, accepted 2026-09-27) and the [delivery brief's step 2 outline](../proof-2026-09-26/delivery-brief.md#step-2-outline-installation).
It is the first asset beyond ground surfaces through the ordinary install path.

## Scene and states

- **Placement.** The step-1 test house (25 kit placements, the plinth runs, foot soil and plants)
  stands beside the prototype paving pad in cell 08-08, on ground flat enough for its per-run
  plinth. Assembly A1 moves it to the well court later (D-208 applies there).
- **Where it is seen.** The ordinary installed game (`?parallaxAutomation=runtime`), through the
  installed capture script's cameras:
  - street, front, junction, window, corner, the fixed front-left corner and the right facade;
  - a traversal past the house;
  - the clear 38° key, the 12° low sun, overcast, dusk and night.

## Question

Can the install, launch, stream and render path carry the accepted delivery unchanged? That is a
kit of about 14 pieces with mirrored variants, several materials per piece, three LODs and
274.5 MB of BC1/BC7 maps. What do cell load, decode, upload, GPU memory and frame costs measure,
against the isolated preview's?

## Work

- **Library.**
  - The packaging reads every manifest in `assets/library/`, not the one paving file.
  - It gains a kit-piece mode beside the periodic-surface-module mode: named pieces, each with
    several meshes (one material each) and three LODs, with shared atlas and tile materials.
- **Placement contract.**
  - Mirrored placements use the pre-mirrored geometry variants that step 1 ships (`~m`). The
    engine's instance matrices keep one handedness.
  - Pass through the rotation, the per-mesh material, and the micro-shadow height ranges and
    address modes that step 1 used.
- **D-197 cap.** Measure the house's placements per cell. If they pass 256, convert the cap to
  telemetry with its tests; otherwise record the count.
- **Class QA and admission.**
  - A new architecture-kit class config under `assets/qa/`: structural checks, bounds, LOD
    monotonicity, texel densities, height ranges and recorded sizes.
  - A production-worker decode receipt.
  - Provenance generalized beyond the paving: procedural original, Apache-2.0, rights reviewed.
  - Library admission is write-once, with human runtime visual acceptance recorded separately.
- **Game data.**
  - The house's placements, and building collision for its footprint (explicit boxes).
  - Removal of any greybox box it overlaps.
- **Evidence.**
  - Installed captures against the step-1 preview and the source.
  - Telemetry: placements, draw groups and triangles, dependency decode and upload times, GPU
    bytes, cell load p95, and frame time.
  - The PSO warmup trace, the installer-repair replay rebind, and `pnpm check`.

## Must fix

- **Failures:** any decode, upload, admission or pipeline-compile failure.
- **Look:**
  - missing, mis-oriented or mis-mirrored pieces, seams at piece joins, or LOD pop;
  - any look that departs from the accepted step-1 preview under the same lighting.
- **Budget:** a cell load that busts the player-visible p95 budget without a recorded,
  attributed cause.

## Out of scope

- **Modular plinth.** Pieces fitted to any wall run and to authored terrain need a source
  change. They belong to Assembly A1, which also fits the house to terrain at the well court.
- **Also out:**
  - draw-call merging of a piece's same-material meshes (measured, not done);
  - the shaded-facade ground-bounce follow-up;
  - interiors (D-208).

## Allowance and end

- **Estimate:** one and a half work sessions. Under D-207 the quality gate, not the estimate,
  ends it.
- **Ends with one of:**
  - the house renders in the installed game with measured costs, is admitted to the library,
    and gets the human's runtime visual acceptance;
  - a named failing contract with its measured cause.
