# Lighting on every surface — results (engine package 7, 2026-09-27)

[Brief](lighting-brief.md). D-205 is amended ([decisions](../../../../docs/decisions.md)).
**Accepted.** On 2026-09-27 the human re-accepted the paving's and the walls' looks and source
candidate 19, and accepted the remaining blue gap on lit walls.

## Answer

Yes, for sky and ground light on any orientation, at no measurable cost. Tone-map colour is only
partly there.
- **Sky light.** The analytic ambient now follows Cycles on every surface orientation:
  - In pinned Chrome, white probes' sky light relative to the up-facing sky is within 2.3% of
    Cycles, including the 12° sun.
  - The shader matches its CPU model within 1.8%.
- **Walls.** At the source's fixed exposure, lit and sun-off plaster are within 0–4 levels of
  Cycles in red and green. Blue is 4–13 levels low, and about 6 of that is the tone map.
- **Paving.** It moves closer to Cycles on all four D-205 statistics and in colour.
- **Cost.** GPU time is unchanged within noise.

Three differences found on the way are not lighting-model errors:
- **Source staging.** The K1 source's walls were over-lit by the sky below the horizon.
  Candidate 19 fixes that in the source.
- **Exposure.** The game adapts exposure: 0.91 at 38° and 1.5 at 12°. The source renders at 1.
  This is D-205's design, and the reason the low-sun view reads brighter than the source.
- **Low-sun colour.** At 12° the game's sun is warmer than the source's single sun colour, by
  design.

## What changed

| Part | Before (D-205) | After |
| --- | --- | --- |
| Sky on a surface | linear blend of sky and ground by `n.y` | the sky dome shaped by the normal in the sun's frame: nine terms per channel, tabled by sun elevation (`pbrSkyShape`) |
| Clear sky by elevation | fitted to 12° and 30°: 9–29% bright above 38° | Cycles' up-probe at nine elevations (3°–80°); twilight fade unchanged below 12° |
| Ground bounce | neutral 0.2 × sky and sun | `(1 − n.y)/2` × the paving's mean albedo (0.319, 0.255, 0.167) × its sun and sky irradiance |
| Tone map | minimal-AgX matrices | inset/outset refitted in CIELAB to Blender's AgX High Contrast; neutral curve pinned (max change 0.0002) |
| Identity | `…-microshadow-agx-csm@4` | `…@5`; PBR vertex, colour and depth WGSL pins recaptured |

Code: [`environment-lighting.ts`](../../../../engine/src/render/environment-lighting.ts),
[`pbr-ambient.ts`](../../../../engine/src/render/pbr-ambient.ts),
[`tone-mapping.ts`](../../../../engine/src/render/tone-mapping.ts) (now with a CPU colour mirror).

## Measurements

Scripts are in [lighting/](lighting). Outputs are in [lighting/calibration](lighting/calibration).
- **`calibrate.py` (Cycles).** White Lambert probes over ground of the paving's albedo, at 13
  orientations × 9 sun elevations plus the brief's four cases, and the AgX colour grid.
- **`dome.py` (Cycles).** Equirectangular panoramas of the Hosek sky. Integrating them gives the
  sky irradiance for 801 normals. The panoramas agree with the probes within 1.3–2.2%.
- **`fit.py`.** Fits the dome table (probes weighted as the reference) and the AgX matrices.
- **`probes.mjs` / `probe-worker.ts` (pinned Chrome).**
  - It draws the probe quad through the engine's PBR material at albedo 0.25 and 0.
  - Each draw is re-exposed to mid-grey: at the curve's toe, one 8-bit level is 4% of radiance.
  - It inverts the tone map's CPU mirror and subtracts the specular.

### Sky dome

- **Basis.** The sky's symmetric second-order harmonics (1, y, y², h, h·y, s²) left low-sun walls
  8% out. A greedy search of the fourth order added h²y², s⁴ and h³y. Odd third-order terms did
  not help.
- **Fit.** Every one of the 141 Cycles probes is within 2.3%. Walls (n.y > −0.3) are within
  1.9–3.6% of the panorama integral, the most at 8–12° sun.
- **Chrome against Cycles.** Sky only, relative to the up probe: 38° within 2.3%, 30° within
  1.7%, 12° within 1.9% (target 3%, 5% at low sun).
- **Chrome against the CPU model:** within 1.8% everywhere.
- **Absolute sun and sky** (informational). Chrome is 3–5% under Cycles. Lite's diffuse carries
  (1 − F), while the probes are pure Lambert. At 12° blue and green are 6–8% under because the
  game's low sun is warmer.

### Tone map (CIELAB ΔE against Blender's AgX High Contrast)

| Patches | Before (minimal AgX) | After |
| --- | ---: | ---: |
| Earth tones (24; saturation < 0.6) | max 3.6 | max 2.5 |
| Plaster, oak, stone, sky blue | — | ≤ 2.9 |
| Mid grass (0.12, 0.20, 0.05) | 8.8 | 5.9 |
| Saturated primaries | up to 39 | up to 23 |

- **Matrices only.** A log-space saturation term was tried. It trades against the outset gain:
  the fit drove it to 0.05, with outset entries near 27.
- **Palette weights.** Weighting plaster, oak and stone ×30 cuts plaster to ΔE 2.0 but takes mid
  grass to 10 and sky blue to 5.2.
- **The limit.** A 3×3 matrix model cannot bend hue by region. On mid plaster it leaves blue 6
  levels low.
- **The fix would be a LUT.** Blender's AgX is LUT-based. Lite's tone-mapping hook takes WGSL
  only, with no texture binding. A LUT would need a hook change or a large WGSL constant table
  (follow-up).

### Source staging (a finding)

The K1 source stages the house on a 32 × 24 m paving patch. Blender's Hosek-Wilkie texture is not
dark below the horizon: its mean there is about ten times the paving's radiance. Past the patch's
edge, walls saw that "ground" as bright near-horizon sky:
- **Front wall at 1.5 m:** 13–15% more sky irradiance than on paving reaching the horizon.
- **Front wall at 4 m:** 21–37% more.
- **Right wall:** 17–30% more.

It shows as the source's sun-off overcast diagnostic being 16 levels brighter than the game. The
game's model (a street to the horizon) is the intended world. Source candidate 19 adds a far
ground plane at the paving's albedo; the paving source's views are unaffected.

## Views

### Walls (the delivery's candidate 3 in the preview, at the source's fixed exposure, against source candidate 19)

![Cycles source candidate 19, game @4, game @5: front, junction, overcast, low](lighting/walls-matched.jpg)

Lit plaster, the median of each panel's brightest 20% (display levels, R/G/B difference from
Cycles):

| View | Cycles | Game @4 (adapted exposure) | Game @5 (exposure 1) |
| --- | --- | --- | --- |
| front | 202 180 150 | −8 −10 −17 | −2 −3 −11 |
| junction | 185 157 121 | −11 −11 −11 | −4 −3 −6 |
| street | 201 180 151 | −7 −10 −16 | −1 −2 −10 |
| overcast (sun off, sky ×3) | 131 135 119 | +49 +27 +13 | 0 −1 −4 |
| low (12° sun) | 199 174 140 | +17 +18 +16 | −2 −4 −13 |

- **@4's overcast.** It kept the sun's ground bounce with the sun off. The preview's sun-off
  diagnostics now scale that share too.
- **At the game's own exposure,** the walls are 9% darker at 38° and 50% brighter at 12° than at
  exposure 1 (D-205's partial adaptation).

### Paving (installed game, walking-matched, dev-01)

Measured on the same board as D-205's
([paving-walking-matched.jpg](lighting/paving-walking-matched.jpg)): a left-aligned 4:3 crop of
the 4K capture at 1000 × 750, with the label strip and HUD masked.

| Display luminance | Mean | p10 | p50 | p90 | R − B |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cycles | 119.6 | 45.9 | 130.7 | 168.3 | 37.3 |
| Game, D-205 | 122.9 | 53.5 | 133.8 | 168.7 | 41.5 |
| Game, package 7 | 121.9 | 53.5 | 132.1 | 167.6 | 39.8 |

- **Board method.** It reproduces D-205's table means for the game (122.9 against 123.0). Its
  p10 runs higher than the table's because downscaling fills the joints.
- **States.** The six states stay distinct and readable
  ([paving-states.jpg](lighting/paving-states.jpg)): clear 30°, clear 12°, overcast, dusk,
  night and storm.

## Cost

In the wall preview at 4K (`chrome-preview.mjs cost`, pinned Chrome, dev-01), @5 against @4 is
unchanged within noise:
- **street:** 3.32 ms against 3.29
- **junction:** 2.80 ms against 2.78
- **walls only:** 2.40 ms against 2.39
- **paving only:** 1.46 ms against 1.45

The shader adds three uniforms and a few multiply-adds.

## Verification

- **Unit tests.**
  - Every Cycles probe is within 3%, the up-facing sky is exact, and weather flattens the dome.
  - The clear sky follows Cycles within 1% from 12° to 80°.
  - Palette patches are within ΔE 3 (mid grass 6), and the neutral axis stays on the calibrated
    curve.
  - The ambient UBO test covers nine shape terms.
- **PSO pins.** Recaptured: vertex `32b93a18…`, colour `84bae6ca…`, depth `e9b7cd92…`.
- **Installer-repair replay.** Rebound (semantic contract v26, digest `d34cfe67…`). It passed
  `installer-repair-production-replay-v4-2026-09-27T12-16-30-119Z.json`.
- **`pnpm check`.** Passed: 225 files, 2,754 tests, one skipped.
- **Build and captures.** Build manifest `518cd2b3…`. The paving captures show no browser errors.

## Open items

- **Blue on lit walls, 4–13 levels low.** About 6 is the matrix tone map; the rest is under the
  measurement's noise. The human accepted it (2026-09-27); a LUT tone map stays the route if it
  matters later.
- **Shaded facades' ground bounce.** The analytic bounce assumes sunlit ground. Beside a facade
  facing away from the sun the ground is in the building's own shadow. On the K1 test house's
  left facade the game reads 7 levels too bright at its exposure (about 17 at the source's), found
  in delivery candidate 4. The size depends on building height and street width, so the fix is a
  local GI or ground-shadow term (a follow-up), not a constant.
- **Down-facing soffits.** The dome is within 6.7% of the integral there. Jetty soffits are rare
  and in shade.
- **Telemetry.** `rendering.pbrLighting` records sky and ground radiance, not the dome shape. The
  shape is a pure function of the recorded phase and weather.

## Time

About one long work session, as estimated. The dome needed a dense panorama fit after the
13-probe fit proved too sparse; the staging finding and a two-point sky model surfaced on the way.
