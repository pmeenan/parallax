# Packages 4–5 review — 2026-09-25

Review of the uncommitted terrain-conforming and calibrated-lighting changes against HEAD
`0381e352a08eb1cc85ecd2c5551e999453ce2440`, including their packaging, shader warmup, tests and
retained captures. The accepted appearance and runtime shader code are unchanged by this review.

## Confirmed findings, corrected

- **P2 — Include detail heights in smoke evidence.** Location:
  `harness/src/greybox-world-evidence.ts:198`. For the generated D1 world,
  `validateGreyboxDistrict` now reports 83,588 samples under D-204, but the smoke validator
  still required 73,984. Render readiness passes that summary to the validator, so every
  ordinary D1 smoke run would reject readiness before checking lighting. The validator and
  its dependent fixtures now require the exact new count; omitting detail still fails.
- **P2 — Accept steady calibrated daylight strength.** Locations:
  `harness/src/greybox-world-evidence.ts:50` and `:152`. The default D1 cycle starts at noon.
  Under D-205 both the sun strength and legacy perceived-intensity aggregate stay constant
  throughout a short daylight measurement. The live and persisted validators still required
  both scalar ranges to exceed 1e-6, rejecting a moving, correctly calibrated sun. Phase and
  normalized sun direction must now advance; finite, bounded intensities and exact range
  consistency remain enforced. D-205 records this interpretation; no performance budget changes.

`game/test/lighting-evidence.test.ts` exercises the real generated D1 terrain and actual
lighting sampler against live and persisted evidence. The original rejection was reproduced,
then the intensity rejection was reproduced after correcting the terrain count. Frozen sun
direction and the old coarse-only sample count remain rejected.

## Opportunities, in priority order

1. **Compare hardware filtering with the manual drape lookup.** `terrain-drape.ts` performs
   four `textureLoad` calls and three vector interpolations per vertex, in both the colour and
   CSM depth shaders. The field is now `rgba16float`, a filterable format; a linear sampler
   and `textureSampleLevel(..., (grid + 0.5) / dimensions, 0)` can express the same bilinear
   operation with one sampling instruction. See the [WebGPU format capabilities](https://gpuweb.github.io/gpuweb/#texture-format-caps)
   and [WGSL explicit-level sampling](https://www.w3.org/TR/WGSL/#texturesamplelevel).
   This is a candidate, not a measured speedup: check filtering precision against the existing
   0.5 mm ground tolerance, edge clamps, normals and shadow alignment, then compare matched
   whole-frame and shadow-task times. Adopt only if the gain exceeds noise. It changes the
   sampler layout and WGSL, so both warmup authorities must be recaptured.
2. **Remove redundant CPU work when next touching material updates.** Each PBR group shares
   one material across its three LOD meshes, but `markPbrAmbientDirty` increments its version
   three times. Mark once per group. The ambient and drape `writeUbo` callbacks also construct
   temporary arrays; indexed writes avoid those allocations. Cache the immutable conforming
   placement count instead of allocating `.filter()` output in every frame's snapshot.
   These are small savings, with no measured frame-time claim. Marking once does not eliminate
   Lite's separate per-renderable UBO uploads, including shadow views; that would need a
   separate measured justification for shared scene-level storage.
3. **Expose the actual PBR lighting inputs in diagnostics.** `exposure`, `pbrSky`, `pbrGround`
   and applied `sunLightIntensity` are available in the lighting sample but not the frame
   telemetry. The legacy scalar can remain flat while PBR exposure changes. Recording those
   values at lighting changes would make package 6's direct-shadow versus ambient-occlusion
   comparisons easier to diagnose. This needs a deliberate telemetry-contract update.

The largest remaining visible improvement is still package 6's small-scale direct shadows.
The AO comparison is intentionally subtle and the accepted night/storm captures remain readable.
Keep the calibrated sun/sky ratio and avoid darkening ambient to compensate for sunlight in
unshadowed joints. The retained cost evidence is within noise, so replacing the analytic ambient,
adding IBL or changing AgX is not supported as a performance priority for this rough paving.
Wet/reflective materials and scene-wide tone mapping retain D-205's explicit reopening triggers.

## Validation

Focused live/persisted smoke, baseline and warmup-qualification tests: 100 passed.
`pnpm check` passed: build and repeatability checks, Biome, and 223 test files with 2,736 tests
passed and one skipped. `git diff --check` passed. The rebuilt build/install manifest hashes
still match the current replay contract. No new GPU cost or visual acceptance is claimed.
Physical smoke: deferred to M4.5 exit — focused contract regression coverage; the prior captured
runtime build and asset identities remain unchanged.

## Follow-up — opportunities taken (2026-09-25)

All three opportunities were worked on dev-01; the final measurements are from its physical
console. The runtime look is unchanged. The package 5 capture states match the accepted
capture to two decimals in mean, p10, p50 and p90 display luminance.

1. **Hardware-filtered drape: measured, not adopted.** The variant used one
   `textureSampleLevel` at the texel-centre coordinate, through a linear clamp sampler. Its PSO
   pins were vertex `f37069c2…` and a filtering sampler at binding 9.
   - **Measurement.** Three captures per variant across 13 views
     ([lighting/drape-filtering-ab.json](lighting/drape-filtering-ab.json)). The filtered variant
     changed mean GPU frame time by −0.044 ms and the CSM shadow task by −0.015 ms.
   - **Why not adopted.** Both deltas are below the per-view run-to-run spread (about
     0.1–0.3 ms) and the shadow timer's step (about 0.066 ms). The four-load lookup also matches
     collision's bilinear ground exactly, whereas filtering uses fixed-point weights. It is
     retained. A remote-session trial earlier the same day was too noisy to use.
2. **Redundant CPU work: removed.**
   - A lighting change marks each PBR group's shared material once, not once per LOD mesh.
   - The ambient and drape `writeUbo` callbacks write their lanes in place.
   - Each resident group caches its material and conforming-placement count, so the frame
     snapshot no longer allocates `.filter()` output.
   - Covered by `engine/test/pbr-plugin-ubo.test.ts`. The all-states capture shows every
     lighting change still reaching the materials.
3. **PBR lighting diagnostics: added.** Frame telemetry now carries
   `rendering.pbrLighting`: `exposure`, `sunLightIntensity`, `ambientSky` and `ambientGround`.
   One frozen object is created per lighting change, and the render service freezes the copies.
   Verified end to end in live telemetry, for example 30° clear: exposure 0.9994, sun 1.4642,
   sky (0.0850, 0.1330, 0.2110). Render recovery accepts the frames.

**Environment note.** All of today's physical-console captures run 0.3–0.6 ms slower in
paving-heavy views than the package 5 capture of 2026-09-24. A control build of the exact
package 5 engine code, captured today, shows the same shift, so it is machine state rather than
these changes. Compare only within one session.

**Verification on build `eb482d02…597b`** (release `11c1005d…295a`):
- `pnpm check`: 224 files; 2,738 passed, one skipped.
- Installer-repair replay rebound to semantic v24 identities and passed:
  `installer-repair-production-replay-v4-2026-09-25T15-32-54-124Z.json` (SHA-256 `1825a053…73bd`).
- Installed scale-streaming passed with p95 2.13 ms:
  `scale-streaming-v1-2026-09-25T15-43-07-300Z.json` (SHA-256 `b4f15bb1…a59d`).
- Render recovery passed all facets:
  `render-recovery-2-eb482d02013e-dev-01-showcase-2026-09-25T15-47-25-793Z.json`
  (SHA-256 `da405a80…52ea`).
- **Retained earlier failure.** A same-day render-recovery run under the remote session failed
  its environment facet, as designed (`remoteSession: true` with a remote display adapter).
  Recovery itself passed in that run.
