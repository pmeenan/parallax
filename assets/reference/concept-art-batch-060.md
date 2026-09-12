# Batch 060 — courtyard sunny and overcast lighting

## B v2 — second-pass matched-camera relight

Both independent screens and lead pass lighting/materials but block A/B camera
drift. Adopt A's standalone 3:2 framing as proposed presentation adaptation (not
an exact extraction of old anchor); use A as sole edit input for B. This retains
main anchor landmarks and does not revise geography. Exact correction prompt:

```text
Relight this EXACT sunny courtyard image as gloomy dry OVERCAST DAYLIGHT. This input is the sole fixed camera and geometry reference. Preserve every pixel's object placement as closely as possible: exact well size and location, roof silhouette, bucket and posts, castle silhouette, building/window/door silhouettes, chimney, vegetation, individual paving joints, foreground extent, perspective and crop. DO NOT zoom out, reposition camera, move or rescale any object, extend roofs or add/delete architecture. Change ONLY sky and illumination. Replace blue sky and white cumulus with dense layered gray overcast, remove all direct sunshine and hard diagonal shadows across foreground paving, use soft diffuse cool skylight and gentle local contact shadow. Material albedo and roughness remain the same, warm terracotta and cream plaster retain natural subdued color. Considerably gloomier than sunny input yet exposed enough to read shaded oak, all stones, well and passage. Surfaces entirely DRY: no rain, puddles, glossy wet sheen, snow, fog wall, lightning, lit lamps, people or props. Preserve small cloud highlight detail with no blown sky, no black crushed corners and no uniform gray overlay. AAA photoreal material/light quality. Output one identical-size landscape image of exactly this camera and composition, now overcast; no split panel or text.
```

LIGHT-001, standalone readable lighting targets from the endorsed paired anchor.
Two independent generation lanes, two passes each, 60 minutes active. Both
independent GPT-6 Astra/low screens plus lead before revision. Human approval
ends batch. Must-fix: major scene/camera drift, different material/wetness between
states, crushed shadows, graywashed sunshine, illegible gloomy traversal, wrong
shadow direction. Minor generated stone/leaf differences recorded, never accepted
as runtime weather-dependent geometry. No new map/layout contract: existing anchor's
coastal castle/terraces are composition only, not authored castle/moat coordinates.
No measured renderer claims, photometric calibration or temporal closure.

Both input: d1-courtyard-sunny-gloomy.png. Use TOP panel geometry/camera for both.
No people in this lighting isolation study; this does not change the world's
Human/Skarn/Wickfolk population or fantasy roles.

## A — exact sunny prompt

Output: concepts/batch-060/light-001-courtyard-sunny-v1.png.

```text
Project Parallax AAA photoreal medieval fantasy COURTYARD SUNNY LIGHTING TARGET. Supplied paired courtyard is the endorsed project reference. Reproduce the TOP panel as ONE standalone wide landscape image, no split panels, using the exact same eye-level camera, framing, roofed circular well left of center, rope drum and bucket, stairs behind well at left, cream lime-plaster dark-oak houses, terracotta roofs, low limestone planting walls, open lane to right of well, distant castle/mountain/coastal silhouette. Preserve arrangement and object geometry; do not add doors, windows, structures, props or people. This is lighting evaluation, not a new location. Richly tactile believable limestone paving with modest irregular edges and joints, weathered plaster and wood, natural foliage; no cartoon, plastic stone or luxury clean walls. Bright clear sunny daylight from upper left: warm direct illumination, distinct coherent cast shadows across paving, cool open sky fill retaining shadow detail, cheerful rich terracotta and green color without oversaturation. Small white clouds in blue sky. Dry paving and dry roofs, no rain, puddles, wet shine, haze obscuring castle or artificial lamps glowing. Keep bright plaster and clouds detailed without clipping, well shadow attached to structure, paving gaps dark only locally, readable unobstructed traversal around well. High fidelity movie-style natural lighting, no text, labels, overlay or people. Keep original top panel perspective and composition rather than redesigning the courtyard. This reference's geography remains a nonmetric composition study, not revised world layout.
```

## B — exact overcast prompt

Output: concepts/batch-060/light-001-courtyard-overcast-v1.png.

```text
Project Parallax AAA photoreal medieval fantasy COURTYARD OVERCAST LIGHTING TARGET. Supplied paired courtyard is endorsed project reference. Use the TOP SUNNY panel's exact geometry and camera, but change ONLY sky and illumination to gloomy overcast, producing ONE standalone wide landscape image, no split panels. Preserve roofed circular well left of center, rope drum and bucket, left stairs, every house/roof/window, low limestone planting walls, paving layout, plants, open lane right of well and distant castle/mountain/coastal silhouette. Same cream plaster, dark oak, terracotta, limestone and foliage colors/materials under changed light, no new objects or people. Dense layered gray cloud cover blocks direct sun, cool diffuse skylight, soft broad contact shadows and reduced directional shadow contrast. Noticeably gloomier than sun but retain local material color and dark-oak detail; readable path and castle silhouette, no uniform gray filter, black crushed corners or night exposure. Important DRY surfaces: no rain yet, no wet paving, puddles, gloss, lightning, fog wall or artificial lights. Bright cloud portions retain detail, no white blown sky. Authentic aged handmade medieval construction, tactile realistic stones/wood/plaster, same camera/framing as TOP panel, not altered architecture from bottom panel. High fidelity photoreal cinematic cloudy daylight. No text, labels, overlay or people. Geometry, surface roughness and weathering are invariant; only sky and light change. This remains a nonmetric lighting target, not a new world layout or a renderer measurement.
```
