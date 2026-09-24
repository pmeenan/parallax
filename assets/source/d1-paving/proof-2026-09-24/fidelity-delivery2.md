# Delivery candidate 2 — independent fidelity screen

**Verdict:** At walking distance, the re-import keeps candidate1's appearance. Three of the four earlier defects are fixed. Plants are still 22–27% darker because the delivered material has no translucency. Remaining losses show only at close/macro range.

Method: I paired each render with its baseline at native resolution and compared matched crops at 2–5× (near, mid, far; faces, shoulders, joints, pebbles, plants, moss). I also used signed difference maps, band-pass correlation (NCC), and luminance statistics under masks (joint, stone and plant).

## Earlier defects
- **Black slits on stone faces: resolved.** All four sites match the baseline under both terminator settings: walking-matched (330,590) and (884,1312), walking (412,652) and (548,724).
- **Black shards in joint.png: resolved at offset 1.0.** The default-offset render still shows a thin black spike at about (915–950, 500). Two leftovers at offset 1.0 sit inside shadow that is already dark: an angular dark wedge at about (225,550), and a sharper-edged pebble shadow at about (1112,560). Neither shows at walking distance.
- **Faceted pebbles: mostly resolved.** Rounded 3D pebbles now shade smoothly. The angular pebble at joint.png (300,812) still shows hard planar facets and a ridge line. The big brown pebble at close.png (1100,830) has a slightly polygonal outline. All 3D pebbles have lost their fine surface grain and look smooth. This matters only at close/macro range.
- **Plants darker: not resolved.** Where plants overlap, lit plant luminance is 0.73× the baseline in close, 0.76× walking, 0.73× joint, 0.76× overview, 0.77× grazing, 0.78× overcast and 0.86× walking-matched. Unlit albedo is 0.98×, so the loss comes from the missing translucency, not the textures. Leaf shape, placement and cast shadows match. The leaves read darker and duller at close range and in low sun; at walking distance they are small and the difference is minor.

## Blender re-import vs baseline
Matches:
- Mean luminance is within ±1% in every view.
- Band-pass NCC is 0.99–0.997 for walking, overview, grazing and overcast, and 0.87–0.91 for close and joint. Stone layout, mottling, moss, grass, plant and large-pebble placement line up. Nothing is mirrored or offset.
- Stone-face albedo is 1.00× the baseline. Joint soil is +3% lit and +6–7% in albedo; soil grain is kept.
- reimport-mixed vs reimport-lod0 differs by MAE 0.0002–0.0007, confined to the far band. There is no shading pop.
- A high-pass of join.png shows no straight join line.

Differences, most visible first:
1. **joint.png, painted pebbles (22 cm macro).** Below 9 mm, pebbles are now flat, smeared blobs with no contact shadows, and they streak along the joint walls. See the left joint (x 150–380, y 400–960) and the mid joint (y 500–640). This is the largest visible loss, but it is by design and macro-only. In walking-matched, the joints read the same as the baseline.
2. **close.png, steep faces.** Painted pebbles on steep joint walls stretch into vertical white streaks at about (1245–1290, 830–870). Stone shoulders facing the camera (y 370–400, x 460–980) streak more than in the baseline, and their shadow edge is sawtoothed. Likely cause: texels projected from above onto steep faces, plus the resolution of the height-field shoulders. Close range only.
3. **Terminator offset 1.0 lightens some self-shadow** on shoulders and joint walls. Pixels much brighter than the baseline: gray.png 10.3k vs 5.8k at the default offset; grazing 2.7k vs 1.4k. Examples are grazing (392,504) and (1400,776–888), and a lit sawtooth shoulder in join.png at x 0–300, y 420–590. Mean joint depth is unchanged (gray joint mean 1.00×). Not visible at walking distance.
4. **gray.png, stone faces.** Micro-relief is slightly crisper (+15% standard deviation) and pits are darker, e.g. close.png (993,665). Harmless. Small pebbles going flat in gray and unlit is by design.
5. **The baseline has a flaw the delivery lacks.** In overcast, walking and grazing, the baseline shows a straight bright dashed line along one joint across the full width at y≈293–305. The delivery joint there is dark. Because the line is straight and full-width, it is probably a seam or light leak in the source along a module edge, which makes the delivery cleaner here. The source author should confirm.

## Chrome (Babylon Lite WebGPU)
Matches:
- Layout, mottling, moss, and plant and pebble placement match the baseline.
- **UV orientation is correct:** band-pass NCC is 0.92–0.94 for walking and overview, and about 0 when the render is mirrored.
- **Normal-map handedness is correct:** what the normal map adds correlates positively with the source relief (+0.76 against gray.png, +0.54 against grazing). With a flat normal, the walking-matched match drops from 0.91 to 0.81.
- mid-lod0 vs mid-mixed differs by MAE 0.003, only as far-band shimmer; there is no pop.
- A high-pass of join.png shows no join seam.

Lighting-model differences, which are not asset faults:
- Overall luminance is 0.63–0.67× the baseline, and overcast has no sky-blue tint.
- Plants and grass cast no shadows: see the grazing plant at (1400,850) and the walking-matched grass at (230,1100).
- Pebbles get no contact shadows, so 3D pebbles look pasted on and painted pebbles read as bright specks in the joints (most visible in grazing-bright).
- In grazing light the paving reads flat, because a normal map cannot cast shadows.

Asset issue that Chrome exposes: every stone shoulder shows a pale, furry fringe of stretched texels. Examples are close.png at y 180–200 and 380–410, and the joint.png walls. The streaks exist in the source and Blender renders too, but shadow hides them there; Babylon has neither ambient occlusion nor small-scale shadows. In wm-bright it shows as soft pale rims at walking distance, which is mild. At close range it is obvious. It will show in-game unless AO or contact shadows are added, or the shoulder texels are fixed.
