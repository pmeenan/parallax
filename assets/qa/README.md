# Asset QA

## D1 procedural greybox v1

D-090 treats the procedural descriptors as game-owned world data and the build-emitted,
content-addressed cell JSON as the greybox library/package output. The QA gate is:

1. `validateGreyboxDistrict()` checks schema, units, unique IDs, representation payloads,
   material references, three ordered non-increasing LOD tiers, collision heightfields,
   AABBs, neighbors, and finite geometry. `pnpm build` runs this shared validator before
   writing any package artifact.
2. `game/test/greybox-world.test.ts` checks descriptor-driven byte-stable generation,
   exact 256-cell coverage, seam-identical visual/collision terrain samples,
   scale/LOD/collision constants, inclusive spatial bounds, whole compound-feature LOD
   reduction, landmark identity at far LOD, required zones, and three distinct future
   D2 entrance contexts.
3. `harness/src/build-contract.test.ts` parses all 256 cell wrappers, verifies their
   index/hash/coordinate identity, reconstructs the district, and reruns the shared
   validator over the packaged bytes. The production packager iterates the complete
   district registry and rejects duplicate district IDs or artifact-scope collisions.
4. The physical-console smoke gate checks the render worker materializes the target-scale
   preview, exports its counts/timing, observes and persists lighting phase/intensity
   ranges, requires 35–<99.9% of a hashed canvas-only PNG to differ from the
   telemetry-derived clear color, and remains within the current harness budgets.
5. `engine/test/greybox-heightfield-geometry.test.ts` verifies that single-sided
   downward skirts cover fine-to-coarse boundaries and are omitted between equal-LOD
   interior neighbors, and that their winding uses the same front-face convention as the
   terrain surface.

The retained physical-console QA artifact is
`smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json`: schema v27,
mandatory metric-set v12, six complete fresh/warm core runs, all three facets passed,
and all 24 blocking checks passed. Canvas coverage was 87.78% in every run with observed
lighting motion. The immediately preceding same-artifact RE-008 trace failure is retained
alongside it.

Blender mesh, UV, texture, and compressed-export checks are not applicable to greybox
v1 because it contains no binary mesh or texture assets. Under D-182 they become
mandatory before M4.5's first representative binary assets enter the library, rather
than waiting for M5. The pipeline is planned, not implemented by this documentation.

## First representative art and animation (M4.5, planned)

The [animation source import and validation path](animation-import.md) is implemented:
Khronos GLB validation, rig/skin/clip policy, immutable candidate receipts and pinned
Babylon worker import/capture checks. It is a pre-admission tool; actual NPC/enemy
content, full character-class QA and installed motion acceptance remain pending.

Start from sunny/gloomy reference sheets and a small D1 modular kit. Apply the asset
class budgets, scale, UV/texel-density, material, provenance/rights, LOD, and compressed
export checks in `../AGENTS.md`; round-trip the accepted outputs through the actual
worker loader. D-186 resolves P-004 storage for the first binary library outputs.
For the NPC/enemy, include rig/export integrity and the selected locomotion, idle, and
combat clips, inspecting deformation and motion in the shipping scene. Introduce only
the class-specific checks needed by those assets; later content extends the gate.

Deterministic route captures and motion inspection establish visual consistency and
no-visible-pop evidence for this finished area. Human acceptance and structural QA are
both required; neither substitutes for the other. M5 extends coverage across D1.
Track accepted kit pieces/animations per work session and rework during the two-week
trial to expose pipeline bottlenecks before expanding content generation.

M4.5's selected spatial SFX/ambience also needs a provenance/rights and audio QA path
before library admission: validate decodable format, duration/channel metadata and
authored level/loop behavior, then audition the asset in the surface/underground scene.
Class-specific audio checks replace inapplicable mesh checks; M6 expands this first set.

## D1 paving: photoreal periodic surface module

The admitted paving is `d1-photoreal-paving`, a periodic 4 m module generated from the
human-approved photoreal source (D-196). Its class config is `d1-photoreal-paving.json`.
D-197 suspends size ceilings, so sizes and triangle counts are recorded measurements, and
only structural checks gate admission. Reproduction, representation and results are in
[the delivery result](../source/d1-paving/proof-2026-09-24/delivery-results.md),
[the install result](../source/d1-paving/proof-2026-09-24/install-results.md) and
[the texture result](../source/d1-paving/proof-2026-09-24/texture-results.md).

```powershell
node assets/source/d1-paving/proof-2026-09-24/delivery/pack.mjs <stage-2 maps dir> <pack dir>
node assets/qa/prepare-photoreal-paving.mjs <pack dir> <candidate dir>
pnpm build; node assets/qa/production-decode-receipt.mjs <candidate dir> <receipt.json>
node assets/qa/admit-d1-paving.mjs <candidate dir> <receipt.json>
pnpm exec biome format --write assets/library/d1-paving.json
```

Shipped maps must be GPU-ready (D-203): pre-encoded BC1/BC7 or plain RGBA8, never UASTC or
zstd at rest. The build refuses anything else unless a registered client-decode exception
covers it. The packer encodes UASTC at `PAVING_UASTC_LEVEL` (default `LEVEL_SLOWER`) as the
intermediate for its BC1 and BC7 output.
`PAVING_GROUND_NORMAL=rgba8` keeps the lossless ground normal; the default is UASTC.
Candidate 8 ships every other map as BC7, pre-transcoded by the pinned Babylon `uastc_bc7.wasm`
(`PAVING_OTHER_MAPS_AT_REST=uastc` restores candidate 7). The library records that transcoder
in `encoders.bc7Transcoder`, and packaging warns when it lags the engine's decoder pin.
Candidate 7 made pre-encoded BC1 base colours (D-201) and a 2048² ground normal the defaults
(`PAVING_BASECOLOR_GPU=bc7` and `PAVING_GROUND_NORMAL_SIZE=4096` restore candidate 6;
[compression result](../source/d1-paving/proof-2026-09-24/compression-results.md)).
Candidate 6 made 3D pebbles from 11 mm with 40° crease-angle normals the defaults
([geometry result](../source/d1-paving/proof-2026-09-24/geometry-results.md)).
`PAVING_PEBBLE_LOD0_MIN_MM=9` and `PAVING_PEBBLE_CREASE_DEG=none` restore the earlier pebbles.

- **Preparation** checks:
  - provenance identity and approved rights (`paving-provenance.mjs`, procedural-original)
  - finite attributes, unit normals and index ranges
  - planar tile UVs
  - flat, fold-free ground normals
  - identical opposite-edge border vertices and heights for every ground LOD
  - LOD reduction
  - KTX2 headers and full mip chains: UASTC, plain pre-encoded BC1 for an opaque colour map
    (D-201), or RGBA8 plain or zstd for a lossless map; it records GPU bytes, with UASTC
    counted as BC7 (D-199)
  - the engine's canonical meshopt layout
  - byte-exact meshopt vertex roundtrips (triangles may rotate cyclically)
- **The receipt** decodes every runtime resource with the engine's own compressed streaming
  codec, in a pinned-Chrome module worker with external requests blocked. UASTC maps decode to
  BC7, as they do in the game.
- **Admission** requires that receipt, bound to the candidate manifest SHA-256. It then
  rechecks every object hash and length, including the three canonical GLBs. It writes objects
  without replacement and publishes `assets/library/d1-paving.json`; a conflicting object fails
  closed.

Library admission covers structure and rights. It does not accept runtime lighting, LOD
transitions, seams or appearance; those remain part of the installed game captures.
- **Admitted:** the manifest status is `QA-admitted-runtime-visual-acceptance-pending`.
- **Accepted:** after the human accepts the installed look, the status becomes
  `QA-admitted-runtime-visual-accepted`. A `runtimeVisualAcceptance` record carries the same
  `candidateSha256`, the date, `acceptedBy: "human"` and the evidence.
- **Readmission:** packaging enforces both forms. Readmitting a new candidate resets the status
  to pending.

The earlier scanned, generated-periodic and individual-stone paving candidates, with their
QA scripts, are superseded. Their evidence and scripts remain in git history and in their
`source/d1-paving/` proof folders.
