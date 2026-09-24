# Delivery candidate 1 — independent quality screen

**Verdict: not deliverable as is.** Tile joins and LOD switching pass. However, the LOD0 ground mesh adds black sliver and shard faults that are visible at walking distance (blocking). The Chrome frames also lose candidate1's look, because of the game lighting and the normal-map response.

The screen compares native-resolution crops at 2–6× in Blender, abs-diff maps against the baseline, and per-band luminance, contrast and detail statistics. Pixel coordinates are (x, y) from the top-left.

## Passes
- **Overall match (A vs baseline).** Colour, tone and layout match. Mean |Δ| is ≤0.016 for walking, walking-matched, overview, grazing, overcast and gray. Stone-top mineral grain is kept: relative detail is at or above baseline in every band. The UV orientation and the stone layout are the same.
- **Plants and large pebbles.** They are in the same places, and none are floating or buried at any site inspected. Plant shadows match, for example grazing.png ≈(1330–1440, 820–900).
- **Tile join.** In `join.png`, neither reimport-lod0 nor chrome1 shows a line, step or shading change at the four-tile corner. I inspected ±200 px around the centre at 3×.
- **LOD in A.** reimport-mixed vs lod0 has mean |Δ| 0.0002–0.0007. The differences are sub-pixel joint noise on the far tiles, e.g. overview ≈(330–880, 0–110). Per-band luminance is equal to 3 decimals, and the plant pixel counts are unchanged. There is no shading pop.
- **Chrome walking views.** walking-4k lod0 vs mixed are identical (mean |Δ| 3.6e-5).
- **Chrome orientation.** There is no mirrored UV. Sun-facing bevels brighten on the same side as in Cycles, so the normal-map handedness looks correct.

## (1) Asset representation defects (visible in A)
- **Black sliver/shard faults in the LOD0 ground mesh — blocking.** These are new relative to the baseline, and they also appear in `gray.png`, so they come from the geometry, not the material. Locations:
  - walking-matched ≈(310–330, 580–600) and ≈(868–882, 1304–1312): black gashes of about 15 px on stone tops.
  - walking ≈(432–442, 644–652).
  - close ≈(300–330, 215–240): a diagonal hairline; ≈(92–127, 283–288) and ≈(945–960, 380–386): black spikes on bevels; ≈(1505–1510, 470–500): a vertical sliver.
  - joint ≈(710–770, 250–300): a hairline; ≈(85–200, 600–780): large faceted black triangles on the left joint wall.

  These look like folded or sliver triangles from decimating steep features such as cracks and bevel undercuts. Chrome hides them only because its shadow map is coarse.
- **Joint pebbles lose volume at 22 cm — should fix.** In `joint.png` (100–300, 560–820), the baseline has about 15 rounded pebbles with contact shadows. The delivery has ghosted, flattened pebble decals and a faceted joint wall. `close.png` holds up much better.
- **Joint floors are noisier — minor.** In `gray.png` (700–1000, 820–1020), the delivery joint floors are streaky, and the small pebbles become faint bumps. The baseline shows a smooth soil floor with discrete pebbles.
- **Pebbles drawn into the maps have albedo faults — minor.** Examples in `unlit.png`: an orange ring with a dark centre at ≈(134, 1179), and a blown-white blob at ≈(124, 1195). They are barely visible once lit.
- **Lost pebble glints — minor.** Along the baseline `walking.png` transverse joint at y≈300–305 (x 60–250 and 1300–1500), the grey-blue pebble glints are gone; the delivery shows plain dark soil.

## (2) Runtime renderer and lighting differences (visible only in B)
- **Exposure, colour and contrast — blocking for the appearance question, but not an asset defect.**
  - Chrome frames are about 40% darker than the Cycles renders (mean luminance ≈0.30 vs 0.49) and about 30% flatter (relative std 0.20–0.27 vs 0.28–0.38).
  - They also have a grey-blue ambient cast. The cream limestone reads grey-khaki, far from MAT-001/KIT-001.
  - In the diagnostics, ambient-only (mean 0.27) outweighs sun-only (0.20). `wm-bright` recovers brightness (0.49) and some of the contrast.
- **No visible cast shadows in any Chrome frame — should fix (engine).** Plants, pebbles and bevels cast none. The close.png plant at (580–860, 440–700) has none, where Cycles shows a large one, and joints read shallow. Either CSM at 1024² can't resolve these shadows, or the plant and pebble thin instances don't cast shadows. Worth checking which.
- **Normal map has almost no effect on stone tops — should fix (engine).**
  - `grazing-bright` and `grazing-bright-flat-normal` are the same inside the stones: at (590–730, 690–780) the luminance std is 0.0668 in both, and the whole-frame mean |Δ| is 0.005. Only the bevel rims differ.
  - Cycles shows strong grain there, so the mineral grain relief is lost in B.
  - Suspects: sampler anisotropy/mip selection, normal strength, or the weak sun.
- **Bevel edges look wrong — minor to should fix.**
  - Bevels read as a soft, furry pale fringe: close ≈(900–1100, 380–410), joint ≈(1000–1100, 500–545).
  - Sun-facing bevels have salmon rims in grazing ≈(395–405, 465–505) and ≈(450, 520).
- **Pebbles drawn into the maps read as flat white "confetti" in the joints** (`joint.png`, `close.png`). This follows from the missing shadows and the weak normal response.
- **Overcast state not reproduced — minor.** `chrome1/overcast` is the walking frame dimmed, with the same relative statistics and no cool sky tint.
- **Blocky "camo" edges on the lichen patches dominate once relief is lost** (`close-4k`, `joint.png`). The pattern is present in the source albedo and amplified in Chrome — minor.
- **Map resolution.** `chrome-tex2048/close-4k` is visibly blurrier than the 4096² render: stone grain and pebble edges soften, with detail about 41% lower. 2048² is not acceptable at close range.
- **LOD in B — minor.** mid-lod0 vs mid-mixed band luminance agrees within ±0.002. In the mixed view:
  - The far band is slightly softer: detail −17% at y 420–500.
  - Plants are hard-culled past the 24 m plant boundary: green pixels drop 115→0 at y 420–500 and 91→58 at y 500–560. This will show as a pop line in motion.

## Other notes
- **Repetition.** The 4 m module shows as converging streaks and repeated dark-patch clusters in the far field: chrome mid-lod0 y≈420–560 and the overview top band. This is inherited from the approved source; world-level variation is needed — minor.
- **Broken diagnostics.** `chrome-diag1/*flat-normal.png` (8–13 KB) are failed renders, superseded by diag2.
