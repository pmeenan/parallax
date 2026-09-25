# Terrain-conforming paving — brief (engine package 4, 2026-09-24)

**Why now.** The human requires surface modules to follow the ground (2026-09-24). They chose a
GPU drape over per-tile baked copies or planar facets. Today the accepted periodic 4 m module
(candidate 8) is rigid. It sits on the level pad `[0, 16]²` at 18.97375 m, and the
architecture explicitly says a shared height anchor "does not conform a plane to uneven
terrain". The earlier contour direction (tilt whole stones from terrain samples) belonged to the
individual-stone kit, which the install package removed. This package runs before lighting and
ambient occlusion. Its rolling courtyard also gives lighting the slopes it needs.

**Measured constraint.** D1 terrain is sampled every 16 m in 256 m cells. Collision uses
bilinear interpolation of that grid, and the render mesh uses its triangles. The 16 m courtyard
is one terrain quad. A drape onto that grid would fold along 16 m facets. A drape onto a
smoother field would float up to decimetres above the collision surface or sink below it.

**Design.**
- **Terrain detail regions (game data, world contract).** A region is a rectangle aligned to the
  coarse grid with a fine sample spacing (0.25 m). Its height is the coarse bilinear field plus
  an authored rolling term. A C¹ window takes that term to zero at the region edge. Each
  resident cell carries its clipped part as a collision `detail` heightfield. Along coarse grid
  lines, the bilinear and triangle interpolations are both linear. The fine and coarse meshes
  therefore meet without a seam.
- **One surface for everyone.** Navigation and collision `groundHeight` use the detail field
  inside a region. The render terrain replaces the covered coarse quads with the fine mesh.
  Paving placements marked `conformToTerrain` drape onto the same bilinear field.
- **GPU drape (render worker).** A PBR material plugin reads a per-cell `rgba32float` drape
  texture in the vertex stage. The texture holds the bilinear displacement from the placement's
  anchor plane, plus smoothed per-sample normals. The plugin lifts world positions and rotates
  normals from +Y to the terrain normal. Placements, instance matrices and module bytes stay
  shared, so no per-tile geometry is added. The same displacement must reach the CSM
  depth-only pipelines. Lite composes them from the same vertex WGSL; this is verified by
  capture.
- **Rolling courtyard.** The region is `[-16, 32]²` around the courtyard. The rolling term is
  about ±0.35 m with 16–26 m wavelengths, and slopes stay under 10°, so the ground is walkable
  and the stones visibly follow it. The level pad remains the coarse base.

**Scene and states.** The installed D1 courtyard and the eight capture views
([install/capture.mjs](install/capture.mjs)). Add two slope views: across a crest, and along a
dip at grazing sun. Add a traversal across the courtyard that checks the player's ground height
against the paving.

**Question.** Can the shared module follow rolling terrain with no seams, float, sinking or shadow
mismatch? What does the drape cost in GPU frame time and pipelines?

**Must fix.**
- Any visible gap, crack or overlap at tile seams or at the paving/terrain boundary.
- Paving surface more than 25 mm from the collision height anywhere on the courtyard (the
  module's own relief is ±21 mm).
- Shadows cast by un-draped geometry.
- GPU validation errors, or unwarmed pipelines (D-183).
- A cell-load or render-stall regression beyond the drape texture upload.

**Allowance.** Two implementation, capture and evaluation cycles in one work session (4 active
hours). This is a physical-console session, so costs are qualified observations rather than
remote advisories. The physical smoke still waits for the end of the optimization packages
(human direction).

**Ending decision.** Adopt the conforming path with measured cost and captures for human visual
acceptance, and record the new terrain/surface contract in the decision log. Otherwise, name
the failing contract and its measured cause. Lighting balance and ambient occlusion follow as
package 5, using the Cycles calibration already taken in [lighting/](lighting/calibrate.py).
