# Lighting balance with ambient occlusion — brief (engine package 5, 2026-09-24)

Follows the [terrain-conforming result](conform-results.md). The delivery package found the
game's lighting to be the largest remaining gap to the approved Cycles image
([delivery results](delivery-results.md#what-the-runtime-exposes-engine-work-not-asset-defects)).
The lighting is dim and flat, with no ambient occlusion.

**Measured starting point.** [lighting/calibrate.py](lighting/calibrate.py) renders the source's
exact Cycles lighting on a white Lambert plane: sun 4.6 W/m² with colour (1, 0.88, 0.72), plus a
Hosek-Wilkie sky at turbidity 2.6 and strength 2. Values are radiance on white, which equals Lite
light units.

| | Sun | Sky | Sun : sky |
| --- | ---: | ---: | ---: |
| Cycles, 30° | 0.727 / 0.640 / 0.523 | 0.085 / 0.133 / 0.211 | 4.9 : 1 |
| Cycles, 12° | 0.296 / 0.260 / 0.213 | 0.063 / 0.090 / 0.121 | 2.9 : 1 |
| Game, 30° | 0.30 (intensity 0.6 × cos 60°) | 0.21 (hemispheric 0.25) | 1.4 : 1 |

AgX High Contrast maps 0.18 to 0.459, like sRGB, but crushes the shadows: 0.0225 becomes 0.071,
against 0.178 in sRGB. The game has no tone mapping and no exposure. Lite's ORM occlusion only
reaches image-based lighting, which the game does not use. The paving's ORM.R is also a constant 1.

**Scene and states.** The installed rolling courtyard and the capture views
([conform/capture.mjs](conform/capture.mjs)), including overcast and 12° sun. Add night and storm
spot checks, which must stay readable and must not regress. The Cycles
[walking-matched](../proof-2026-09-22/photoreal/candidate1/walking-matched.png),
[joint](../proof-2026-09-22/photoreal/candidate1/joint.png) and
[grazing](../proof-2026-09-22/photoreal/candidate1/grazing.png) renders are the targets for
brightness, contrast and joint darkness. The ground now rolls, so the comparison is of tone and
contrast, not pixels.

**Question.** Which lighting model brings the in-game paving materially close to the approved
Cycles look in daylight, while staying dynamic across time of day and weather? What does it
cost?

**Design, cycle 1 (engine).**
- **Radiometric sun and sky.** Sun intensity becomes 4.6/π ≈ 1.46 in daylight, faded near the
  horizon, with the reference colour above 30°. Sky irradiance follows the measured Hosek values
  by elevation, desaturated and scaled by weather. Night keeps a low moonlit sky.
- **Occluded ambient for PBR.** The existing PBR plugin gains a fragment term: hemispheric
  sky/ground irradiance (the ground term is bounce light), multiplied by ORM occlusion. A sky
  specular term uses an analytic environment BRDF with specular and horizon occlusion. The
  hemispheric light excludes PBR meshes (one shared mesh id) and keeps lighting the greybox.
  Lite's procedural-sky IBL was considered and not taken now. It needs a shipped BRDF image, it
  regenerates the environment on every sun change, and it has no weather or night model. It stays
  the route for later reflective surfaces.
- **Tone mapping and exposure.** A custom Lite `ToneMapping` fits AgX High Contrast (`lighting/`
  calibration curve), baked into the PBR shaders. Exposure is 1 at the calibrated daylight and
  adapts partially from the lighting sample's key luminance, so night and storm stay readable.
  Standard greybox materials are not tone mapped; this is disclosed, not fixed.

**Cycle 2 (asset).** A height-derived AO goes into ORM.R, built from the approved source's
height and pebble fields, as paving candidate 9. Include the 1024² ORM A/B from the optimization
review. Judge the joint, sidewall and close views against Cycles.

**Must fix.** GPU validation errors or unwarmed pipelines (D-183). A night or storm scene that
becomes unreadable. Any cost regression beyond a fraction of a millisecond. Visible banding or
clipping from the tone curve.

**Allowance.** Two cycles in one work session (4 active hours), on dev-01's physical console.
Physical `smoke@1` waits for the end of the optimization packages (human direction).

**Ending decision.** Adopt the model with measured costs and captures against Cycles, for human
visual acceptance. Adopt or drop candidate 9's AO and the 1024² ORM with measured reasons. Small-
scale shadows (package 6) follow.
