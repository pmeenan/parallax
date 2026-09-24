# Delivery candidate 1 — independent fidelity screen

**Verdict:** It is the same asset, and it holds the approved look at walking distance and beyond. It is not clean, though. The LOD0 ground geometry adds black slit and shard shadows that the source doesn't have, including small ones at walking distance. At 22 cm the pebbles look faceted, and plants render darker after the fresh import.

**Method.** I paired every delivery render with its baseline at native resolution. I made signed luminance difference maps (3 px blur) and a local dark-spot detector, then compared 2–8× crops of near, mid and far regions. The crops covered stone faces, shoulders, joints, pebbles, plants and moss. I scored vegetation by counting green pixels. For Chrome, I isolated the normal-map shading term (`wm-bright` ÷ `wm-flat-normal`) and correlated it with the baseline `gray.png` relief. Coordinates below are x,y pixels from the top-left of the named file.

## What matches
- **Layout and pattern.** Every stone outline, lichen and moss patch, vein/fossil line, plant and pebble position lines up in every view. UVs aren't mirrored or rotated, and the `unlit` stone albedo matches crop for crop.
- **Overall tone.** Mean colour is within 0.5% in all nine views. After an 8 px blur, the mean difference is only 0.003–0.005 in walking, walking-matched, overview, grazing, overcast and gray (0.012–0.014 in close and joint).
- **Joints and grain.** Mineral and soil grain, stone shoulders and joint depth hold at walking distance. The delivery is slightly crisper: +11% high-frequency energy in walking-matched and +17% in gray. That comes from the map-drawn pebble bumps and sharper pits, not from lost detail.
- **LODs.** `reimport-mixed` against LOD0 differs by a mean of 0.0002–0.0007, only as speckle on the farthest tiles, with no tile-shaped brightness step. In Chrome, `mid-mixed` against `mid-lod0` blurs to 0.0005. There is no shading pop.
- **Tile joins.** Neither `reimport-lod0/join.png` nor `chrome1/join.png` shows a straight discontinuity anywhere in frame. Caveat: the corner's pixel position isn't recorded, so I could only check the whole frame for lines, not the corner itself.
- **One improvement.** Baseline `overcast.png` has bright specular slivers along straight joint rows at y≈295 and y≈20, likely the source tile-boundary normal mismatch. They're gone in the delivery.

## Differences, reimport-lod0 against baseline
1. **Black slits on stone faces (new defect, visible at walking distance).**
   - Where: `walking-matched` (330,590), about 35 px, and (884,1312); `walking` (412,652) and (548,724); `joint` (700–770, 250–310), a thin diagonal crease.
   - They also appear in `gray` but not in `unlit` or the baseline. The baseline has only a tiny pit where the first slit starts. So this is geometry casting a shadow, not albedo.
   - Likely cause: LOD0 decimation (1 mm error) makes long, thin triangles that drop into single-sample pits. The normal map can't hide the shadows they cast.
   - Each slit is small, but it catches the eye on light stone. Chrome's current shadows don't resolve them; finer shadows would.
2. **Shard shadows and spikes in the joints (matters at close range).**
   - `joint.png` has straight-edged black triangles at (80–180, 725–775), (200–240, 520–610) and (1000–1130, 390–540), plus a thin upright spike at (1252, 560–625).
   - A rounded source pebble at (130–170, 715–750) becomes a sharp spike.
   - `close.png` has a straight diagonal crease in the foreground soil at (100–170, 845–895).
   - Same likely cause: decimated pebble and soil relief.
   - At walking distance this only shows as slightly larger shadow notches under the stone shoulders, e.g. `walking-matched` (532,732), (28,564) and (732,1004).
3. **Faceted 3D pebbles (matters only at 22 cm).**
   - `joint` (307,810) reads as a cut gem. The round pebble at (1355,975) becomes a rounded box.
   - The same shapes appear in `chrome1/joint.png`, so the asset causes it, not the renderer. That fits the 40-triangle LOD0 pebble in `pack.json`.
   - Not visible at walking distance.
4. **Map-drawn small pebbles look flat (expected from the design).**
   - In the `close` foreground and in `joint`, they lose volume and contact shadows and read as pale smudges.
   - At walking distance they sit in the same places and look slightly brighter; the difference map shows red speckle in the joints.
   - In `unlit` they look lighter and bluer than the source pebble albedo, but the lit views agree, so that's a diagnostic-only difference.
5. **Vegetation darker (mild at walking distance).**
   - Examples: the plant in `close`, the plants in `grazing` at (1410,850) and (130,700), and the moss tufts.
   - Lit green values are 20–27% lower in walking, overview, grazing and close (8% lower in walking-matched).
   - Albedo is nearly unchanged: 90% of the baseline green-pixel count in `unlit`, 84% overlap. So the lighting response differs, most likely lost leaf translucency or sheen in the glTF material on reimport. Chrome's plants read closer to the baseline.
   - One moss patch, `walking-matched` (1180–1250, 670–720), is smaller and patchier in albedo. The rest of the moss coverage matches.

## Chrome (pinned Babylon Lite) against baseline
- **Same asset.** Layout, lichen pattern, UV orientation, plants, grass tufts and pebble positions all match, in `walking-matched` and `wm-bright` especially.
- **Normal map correct.** On stone faces, the albedo-free normal-map term correlates r=0.72 (2 px high-pass) and r=0.85 (6 px) with the baseline relief. A 2 px offset drops it to 0.31–0.35, and it's about 0 against albedo. So it's registered with correct handedness; I found no inverted slopes.
- **Differences are lighting-model only.**
  - The image is about 38% dimmer, with half the local contrast.
  - With no small-scale shadows, joints read shallow and grass-blade shadows disappear.
  - `grazing` and `overcast` are nearly identical: the engine reproduces neither the low sun nor the blue overcast sky.
  - The `wm-bright` diagnostic confirms the pattern matches once exposure is raised.

## Against the brief's must-fix list
- **No failures** on: seams or join lines; lost grain; missing or floating pebbles and plants; lost joint depth at walking distance in the reimport; LOD shading pop; normal-map handedness or UV orientation in Chrome.
- **Not on the list, but should be fixed before acceptance:** the slit and shard shadow artifacts (item 1 is visible at walking distance) and the faceted pebbles at close range.
- **Worth confirming:** the plant darkening, since it may come from the reimport material rather than the delivery maps.
