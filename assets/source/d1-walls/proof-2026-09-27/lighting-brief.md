# Lighting on every surface — brief (engine package 7, 2026-09-27)

The K1 wall delivery found that the game's calibrated lighting
([D-205](../../../../docs/decisions.md)) fits horizontal paving but not walls
([results](../proof-2026-09-26/delivery-results.md#open-items)). The human agreed to calibrate it
against Cycles now and to reopen the paving's accepted look where needed (2026-09-27).

## What is wrong (measured on the wall delivery)

- **Vertical walls are darker and warmer.** In Chrome, lit plaster measures RGB 186/165/124 against
  Cycles' 200/179/150. Ambient-only on the wall gives 74/65/46 against Cycles' sky-only 82/84/72.
  - The PBR ambient blends one horizontal-sky and one ground value linearly by N.y.
  - A wall gets half the horizontal sky irradiance and a 0.2-albedo ground bounce. A Cycles wall
    facing the sun side also sees the brighter circumsolar sky and a cream paving bounce.
- **Tone-map chroma.** The AgX fit was calibrated on neutral patches only. Warm colours stay more
  saturated than in Blender's AgX High Contrast (plaster red/blue 1.57 against 1.40).
- **Weather states.** Sun-off overcast renders about 40% darker than Cycles' overcast diagnostic,
  and the 12° low sun renders brighter than the source.

## Question

Can the analytic ambient and tone map reproduce Cycles' lighting on any surface orientation, to
within a few percent, at no measurable cost? What does that change in the accepted paving?

## Method

1. **Measure** with an extended `calibrate.py` under the source's exact sun and Hosek sky:
   - White Lambert probes facing up, down, and sunward, anti-sun and sideways horizontally, plus
     45° tilts. Measure them sky-only and sun-only, over a ground plane with the admitted paving's
     mean albedo.
   - Cases: 12°, 30° and 38° sun, and the overcast diagnostic.
   - Coloured emission patches through AgX High Contrast, at several exposures: plaster, oak,
     stone, sky blue, grass and saturated primaries.
2. **Fit the simplest model that reaches the target:**
   - Sky irradiance as a function of the normal: the isotropic blend plus a sunward lobe.
   - A ground bounce from the paving albedo under sun and sky.
   - The AgX inset and outset matrices fitted to the coloured patches.
3. **Change the engine.** The environment sample, the ambient plugin and the tone map, plus the
   overcast and low-sun exposure if the measurements show it.

## Cameras and states

- The wall delivery's `front`, `junction`, `low`, `overcast` and `street` views against the
  approved source.
- The paving's walking-matched view against its Cycles source, with D-205's statistics
  (mean, p10, p50, p90 display levels).
- The states board (clear, 12°, overcast, dusk, night, storm), which must stay distinct and
  readable.

## Targets

- **Probes.** Irradiance on every probe orientation within 3% of Cycles, and within 5% for the
  low sun.
- **Views.** Lit and ambient-only wall colour within 3 levels per channel of Cycles in the matched
  views. The paving's walking-matched statistics must be no worse than D-205's, or equal.
- **Colour.** Tone-mapped colour patches within ΔE 3 of Blender's AgX High Contrast.
- **Cost.** GPU time within noise.

## Allowance and end

- **Estimate:** one work session (D-207: the quality gate, not the estimate, ends it).
- **Ends with:**
  - the calibrated model
  - the lighting model identity `@5`, re-pinned WGSL and a rebound replay
  - installed paving captures and the walls in the preview against Cycles
  - the human's re-acceptance of the paving and wall looks
- **Out of scope:** local lights (night and storm, M4.5 step 2), image-based lighting, and
  contact occlusion between separate members. Those are follow-ups if the measurements show they
  are what remains.
