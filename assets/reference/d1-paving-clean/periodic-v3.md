# Periodic surface attempt

Built-in imagegen edit of accepted `limestone-v2-rough.png`, 2026-09-05.
Output: `limestone-v3-periodic-attempt.png`. Not validated as seamless; no library
admission. Same generated-only lineage and reviewed output terms as v2.

Evaluation: rejected as a periodic source. The Blender 2×2 repeat at
`harness/results/d1-paving-periodic-2026-09-05/v3-repeat-2x2.png` exposes interrupted
stone faces and displaced joints at the central joins. Wrapped RGB steps were about
1.91× horizontal and 1.46× vertical ordinary adjacent steps; these support the visual
finding but are not a standalone seamlessness criterion. Next approach reuses whole
accepted-v2 stone samples and contours in a periodic Blender material bake.

## Prompt

Edit this accepted photorealistic rough pale limestone paving texture into a seamlessly repeating square material tile. Preserve the same stone material: coarse shallow pits, irregular hand-hewn flaked faces, chipped worn edges, pale warm grey limestone, clean mineral faces and narrow bare earth joints. Reorganize the outer stones as necessary so cropped stone shapes and joints continue at EXACTLY matching positions across left/right and top/bottom boundaries. Both axes must repeat naturally. Stones should CROSS the image boundaries, no square border of dirt or straight perimeter gutter. Use roughly rectangular irregular staggered blocks, varied sizes with a few small infill stones, about 4-5 stones across. Avoid mirrored or kaleidoscope symmetry, repetitive brick grid, or smooth slab faces. Neutral flat diffuse overcast illumination without directional shadows, highlights or lighting gradient; this is a base color material starting point. No vegetation, moss, leaves or debris. Output one square full-frame top-down orthographic texture, not a tiled montage, no text. Preserve believable AAA photographed mineral surface detail from the input. Tileability is the key requested edit; preserve the accepted rough surface character.
