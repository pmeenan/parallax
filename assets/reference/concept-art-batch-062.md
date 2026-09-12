# Batch 062 — courtyard night and rainstorm

## A v2 — second-pass background light correction

Construction passes both v1 scenes; theme passes storm but flags one distant warm
window outside the two-source night scope. Lead resolves this with a local edit.
Input night v1. Exact prompt:

```text
Make one tiny targeted correction to this night courtyard. Extinguish the small orange glowing window/slit in the LEFT BACKGROUND HOUSE above the stairs, just behind the LEFT edge of the well roof. It is the little vertical warm rectangle in the distant timber/plaster building around one quarter of image width and upper-middle height. Make this window dark unlit with the same subdued cool night fill as adjacent distant windows. All distant houses/windows must be unlit. Preserve EXACTLY the two intended candle sources: bright wall lantern beside far LEFT foreground door and portable candle lantern on RIGHT well rim, together with their existing local warm light pools. Do not alter those lanterns, their flames or surrounding foreground lighting. Preserve all geometry, sky, camera, well, paving, colors and moon fill. No added lights or props, no other changes. One small background window correction only.
```

LIGHT-003/004, related WEATHER-001/WATER-005 appearance only. Two parallel generation
lanes, two passes each, 60 minutes active. Two independent GPT-6 Astra/low screens
plus lead before revision/dependent generation. Human approval ends batch.
Must-fix: camera/layout drift, electric-looking light sources, unreadable path,
uniform wet mirror/flood, rain through shelter, impossible reflection/shadow sources.
Night is dry; storm is active wet daylight without lightning flash in this still.
Transition/flash recovery, rain motion, local light motion, runoff simulation and
quantitative renderer evaluation remain open. No new map layout or lighting algorithm.

Both input: concepts/batch-060/light-001-courtyard-sunny-v1.png, approved camera/layout.

## A — exact night prompt

Output: concepts/batch-062/light-003-courtyard-night-v1.png.

```text
Relight this EXACT Project Parallax approved medieval courtyard as a clear NIGHT with real FLAME lantern light and restrained moon/sky fill. Preserve camera, framing, well/roof/posts/bucket, houses/windows/stairs/plants, paving geometry, distant castle/coast and every major object. Night sky deep desaturated blue with sparse small stars, moon outside frame upper left, no huge fantasy moon. No daylight orange horizon or sun shafts. Existing iron wall lantern beside LEFT house door now contains one visible small candle flame, producing a localized warm amber pool on adjacent plaster, door threshold and stones with coherent falloff. Add just ONE small practical portable iron candle lantern resting solidly on the RIGHT SIDE of the stone well rim, clear of well opening and rope; square simple iron cage with glass panes, one visible candle/flame, metal cap/handle. Its amber light illuminates only nearby stone lip, post and a small pool on surrounding paving; do not illuminate whole courtyard uniformly. These two real flame sources are the only warm lights, no electric bulbs, LED stripes, glowing metal, new lampposts or uniformly emissive windows. Restrained cool moon/sky illumination lets the lane, steps, dark timber, well and distant castle silhouette remain legible, while corners genuinely dark, no crushed route or bright blue daylight. Dry matte materials unchanged, NO wetness or puddle reflections. Fine detailed flame cores with small natural bloom not giant glare. Light occluded correctly by solid well structure, warm-to-cool contact believable. High fidelity photoreal cinematic medieval night, not cartoon. Exact input composition except specified portable lantern; no people, text, fog wall or architecture changes. Appearance proposal only, not a photometric measurement.
```

## B — exact rainstorm prompt

Output: concepts/batch-062/light-004-courtyard-rainstorm-v1.png.

```text
Transform this EXACT Project Parallax approved medieval courtyard into ACTIVE DAYTIME RAINSTORM, preserving exact camera, crop, well/roof/posts/bucket, houses/windows/stairs/plants, paving geometry and distant castle/coast. Heavy layered charcoal-gray cloud cover with cool diffuse daylight, no lightning bolt or flash in this frame. Visible fine slanting rain streaks in the open air consistently falling down and slightly left, moderate rain density that leaves the village readable, not opaque diagonal white lines. Exposed paving becomes darker wet limestone with broken soft sky reflections on stone tops and shallow water in LOWER joints, a few small irregular puddles only in depressions. Keep individual raised stone boundaries/roughness visible, NOT a flat uniform mirror or courtyard flood. Water collects and drains along existing downhill lane; subtle tiny splashes/ripples in puddles, no new channels or modern drains. Roof tiles and exposed wall ledges darken with wetness. Under well canopy and deep house eaves, materials are relatively dry and rain streaks stop at shelter; no rain through solid roofs. Plaster mostly matte with limited damp lower edges, foliage slightly rain-darkened, no polished plastic vegetation. Cooler gloomy exposure with readable route and well; distant castle remains recognizable through modest rain haze, not erased. Existing lamps UNLIT, no added lantern or people. Natural photoreal material response with realistic restrained specular highlights, no blue neon, sun shadows, snow or motion-blur smear across architecture. Same medieval courtyard, no altered stone layout, larger well, moved buildings or zoom. This still specifies appearance only; runoff, rain motion, accumulation and lightning transition behavior need separate references.
```
