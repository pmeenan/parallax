# Lighting balance with ambient occlusion — result (engine package 5, 2026-09-24)

**Outcome: adopted (D-205). The human visually accepted the lighting and paving candidate 9
(2026-09-24); the library records the acceptance against the candidate.** The in-game paving now matches the approved Cycles image in brightness, warmth and
highlights. Dusk, night, storm and overcast stay distinct and readable. Both allowed cycles were
used in one session on dev-01's physical console ([brief](lighting-brief.md)).

![Cycles source, game before, game after](lighting/compare-walking-matched.png)

Left to right: the approved Cycles source, the game before this package (package 4), and the
game after. The ground now rolls, so the framing is close but not pixel-matched.

## What changed

- **Calibration** ([lighting/calibrate.py](lighting/calibrate.py),
  [calibration.json](lighting/calibration/calibration.json)). Cycles renders the source's exact
  sun and Hosek sky on a white Lambert plane, and AgX High Contrast on emission patches.
  - `sampleEnvironmentLighting` now reproduces 30° clear to within 1%: sun on white
    (0.732, 0.644, 0.527) against (0.727, 0.640, 0.523), and sky (0.085, 0.133, 0.211) exactly.
  - Sky luminance and chroma follow the 12° and 30° measurements by elevation, and are
    desaturated and scaled by weather.
  - Night has a moonlit floor, and the sun colour reaches the source's (1, 0.88, 0.72) by about
    12°.
- **Units.** Lights stay in radiance on white, which Standard materials and the ambient share.
  Lite's PBR divides direct diffuse by π, so streamed PBR materials set `directIntensity = π`.
  This was found in cycle 1: without it the paving received 1/π of the calibrated sun (median
  display 78 against Cycles' 129).
- **Occluded PBR ambient** (`render/pbr-ambient.ts`).
  - It is hemispheric sky/ground radiance × ORM occlusion, plus sky specular with the Karis
    analytic BRDF and Lagarde specular and horizon occlusion.
  - The greybox hemispheric light excludes PBR meshes through one shared mesh id.
  - Lite's procedural-sky IBL was considered and deferred: it needs a shipped BRDF image,
    regenerates on every sun change, and has no weather or night model.
- **Tone mapping** (`render/tone-mapping.ts`). A custom Lite `ToneMapping` bakes an AgX fit into
  the PBR shaders. The minimal-AgX matrices and sigmoid run over [−13.65, 1.75] EV with display
  power 2.55, and match the measured Blender curve with rms 0.006 (maximum 0.014). Exposure is
  live, 1 at the calibrated day, and adapts with exponent 0.5 within [0.6, 16].
- **Greybox.** It is not tone mapped. The lights' specular channel is zero, because only Standard
  materials read it: the calibrated sun had blown a hot spot into the grass.
- **Paving candidate 9** (`4b2707a4…6329`).
  - `maps.py --ao-radius-mm 40` bakes a horizon-based AO of the periodic height field, pebble
    tops included, into ORM.R: 16 directions with sin² horizon blocking and a smooth falloff. It
    averages 0.976, with p10 0.915 and a minimum of 0.49.
  - Every other map and all geometry are byte-identical to candidate 8, and the generator
    reproduced candidate 1's maps exactly.
  - The ORM ships at 1024², which cuts runtime bytes from 29.89 to 25.69 MB.
- **Evidence identity.** The lighting model is now
  `calibrated-sun-occluded-pbr-ambient-agx-csm@2`. The PSO contract re-pins the PBR WGSL:
  vertex `dc697137…`, colour `2e9152e4…` and depth `4cb03f48…`. Lite's composer reproduces them
  in the contract test.

## Views (dev-01, pinned Chrome 152.0.7977.54, 4K)

![States: clear, 12° sun, overcast, dusk, night, storm](lighting/states.png)

| View (display 0–255) | Mean | p10 | p50 | p90 |
| --- | ---: | ---: | ---: | ---: |
| Cycles walking-matched | 117.9 | 41.4 | 128.7 | 167.9 |
| Game before (package 4) | 76.3 | 43.7 | 80.4 | 100.5 |
| Game after | 123.0 | 48.1 | 135.0 | 170.2 |

![AO off and on, overcast and joint](lighting/ao-before-after.png)

- **AO.** The AO only scales ambient light, so it shows most where ambient dominates. p10 falls
  by 1.7 display levels in overcast, 1.1 in storm and 0.9 at night, with a small visible
  deepening of joints and stone edges. In clear sun it is nearly invisible (0.5–0.8).
- **Remaining joint gap.** p10 is 48 against Cycles' 41. That is direct sunlight shadowed inside
  the joints, the small-scale shadows of package 6. A stronger AO would be an artistic
  exaggeration of the measured geometry.
- **1024² ORM A/B.** Against the 2048² ORM, the in-game mean difference is 0.22–0.36/255 per
  view, with p99 2/255 and isolated maxima of 9–20. That is a slight D-200 trade for 4.19 MB of
  GPU memory and download.

## Costs (dev-01; short diagnostic windows)

GPU time (median of 60 frames of `gpuFrameEmaMs`) is within run-to-run noise in every view
against package 4's final captures, for example walking-matched 5.16 against 5.19–5.24 ms, and
close 5.37 against 5.28–5.44 ms. The ambient plugin, tone curve and AO add no measurable
cost. The first streaming batch stall is 22.9 ms (21.6–24.1 before).

## Verification

- **Tests.** Calibration against the Cycles sun and sky, ordering of states and bounds on
  exposure. The tone curve against the measured Blender table. The PSO contract with both
  plugins and the baked tone curve.
- **Candidate 9.** Structural QA, a production decode-worker receipt (26 of 26 passed),
  admission to the library, and recorded runtime visual acceptance. Recording it leaves the
  build identity unchanged.
- **Final build.** `85751f51…0c52`, release `cb707040…f98f`.
  - **Installer-repair replay.** Rebound to semantic contract v24 and passed:
    `installer-repair-production-replay-v4-2026-09-25T02-43-45-832Z.json` (SHA-256
    `01fcd41e…694e`).
  - **Installed scale-streaming** on dev-01's physical console passed with a traversal cell-load
    p95 of 2.24 ms: `scale-streaming-v1-2026-09-25T02-46-09-635Z.json` (SHA-256 `8e538f85…ade4`).
- **Retained failed report.** An earlier scale-streaming run on the intermediate build
  `1b9cecc2…` (`…2026-09-25T02-30-51-577Z`) measured p95 2.34 ms. It then failed post-validation
  with `source[path] postvalidation drifted`, because I edited the tree during the run. The
  final run was made with no edits.
- **Captures.** No browser errors. The [capture summary](lighting/capture-summary.json) records
  every view on the final build. The images above come from it.

## Known limits

- The greybox (Standard materials) is not tone mapped. It is a placeholder, but it sits beside
  AgX-mapped paving in every view.
- Sky reflections are analytic hemispheric colours, fine for rough stone. Wet or polished
  surfaces will need an environment probe or Lite's IBL.
- The AO covers only the paving module's own relief. Contact occlusion between placed objects,
  and joint shadowing by direct light, are package 6.
