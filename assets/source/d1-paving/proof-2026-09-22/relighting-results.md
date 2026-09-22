# Moving-light result — preserve the restored material

Human approval: on 2026-09-22 the human agreed the lighting looks good and explicitly
authorized the larger paving patch. Lighting appearance in this reviewed sample is
accepted; preserve it. This supplements the previous soil-to-stone edge approval.

No concrete directional shading conflict was demonstrated by this bounded test.
Both [quality](quality-relighting.md) and [theme](theme-relighting.md) support
preserving the material and advancing the practical paving proof. Lead independently
inspected both 12-frame sheets and eight original cardinal close/control/walking
frames. The earlier unlit-only interpretation was too strong to establish a blocker.

The [brief](relighting-brief.md) specified unchanged restored-family geometry,
soil and material, with an orbiting light. The test captured eight azimuths at each
of two fixed cameras, plus four gray controls per camera: 24 native 1600×1200 frames.
The gray controls disconnect only base color, keeping geometry, bump and roughness.
Light elevation is 30 degrees, distance 1.5 m, area size 0.35 m, power 145 W;
ambient and exposure remain fixed. Native capture took 92.84 seconds in Blender 5.2.1.

Observed pores, the near-edge notch and sidewall illumination change consistently
with the gray controls under opposing light. No fixed highlight/shadow pair was
identified that clearly contradicts the moving light. Dark mineral islands persist,
as expected for color. The source prompt and material explicitly correlate mineral
color with height; this can explain depth-like contrast in an unlit view without
establishing unwanted directional illumination.

## Reviewable evidence

- [Light-orbit animation](relighting/close-light-orbit.gif): eight original close
  renders resized to 800×600 with GIF palette conversion, 550 ms per frame. This is
  a stepped native-render sequence, not a smooth animation or runtime capture.
- [Close comparison](relighting/close-sheet.png) and
  [walking comparison](relighting/walking-sheet.png): all full and gray frames.
- [Native receipt](relighting/receipt.json), [presentation receipt](relighting/sheets.json),
  [editable diagnostic scene](relighting/source.blend) and
  [author inspection](relighting/author-diagnostic.md).

The test does not certify measured intrinsic reflectance or all possible lighting.
Its sampled area-light elevation, native renderer and fixed cameras bound the result.
Preserve the material and the human-approved contact; neither deeper displacement
nor a color rewrite is justified by this evidence. Reopen the shading concern only
if a concrete contradictory feature appears in delivery or installed-game tests.

Next dependency is the current restored-family bake/reimport, followed by the 4 m
repetition and joint-plant proof. Older portable checks cover a different material.
Full packaging/LOD/compression, QA, rights, admission and installed WebGPU evidence
remain outstanding. No artwork changes, runtime admission or public upload occurred.
