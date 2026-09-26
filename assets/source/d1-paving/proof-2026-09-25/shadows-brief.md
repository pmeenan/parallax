# Small-scale shadows — brief (engine package 6, 2026-09-25)

Follows the [lighting result](../proof-2026-09-24/lighting-results.md) (D-205). Package 5 matched
the approved Cycles image in brightness and warmth, but left two gaps: the joints stay lighter
than Cycles (p10 48 against 41) because direct sunlight inside them is unshadowed, and the
greybox grass shows CSM acne bands, worse on the rolling slopes
([conform result](../proof-2026-09-24/conform-results.md#known-limits)).

**Measured starting point** (build `eb482d02…`, clean commit `42b9903`, dev-01, pinned Chrome
152.0.7977.54, 4K; scratch capture with the package 4 capture script).
- **Joints.** The Cycles [joint render](../proof-2026-09-22/photoreal/candidate1/joint.png)
  shows sharp stone-edge shadows cast onto the joint soil, and small pebble shadows. The game's
  joint view has neither: joint floors beside sun-facing and sun-away walls are lit alike.
- **Why CSM cannot supply them.** The paving relief is 31 mm (ground LOD0 bounds −20 to
  +11 mm), and most of it lives in the maps at LOD1–2. The CSM caster bias is 0.12 m (four
  times the relief), and its texels are centimetres wide. Earlier attempts to lower the bias
  (0.01–0.015 m, slope scale 2) produced terrain acne and were rejected
  ([architecture](../../../../docs/architecture.md), 2026-09-05).
- **Grass acne.** Diagonal bands on the Standard-material grass in `rolling-grazing` and `dip`
  (12° sun). Lite's CSM receiver has no normal offset or receiver-plane bias. Its 5×5 PCF kernel
  spans about 2.5 texels, so a sloped receiver compares against its own caster depth.
- **Cost.** The CSM task is 2.1–2.9 ms of a 5.3–5.9 ms GPU frame in every near-courtyard view
  (median of 60 frames). The paving's LOD0 ground and pebble geometry is redrawn into four
  cascades every frame, although a 0.12 m bias means that geometry cannot shadow itself.

**Established implementation first.** Lite 1.18's screen-space contact shadows
(`createScreenSpaceContactShadowsPostProcessTask`, exact pin 1.31.1) were read at source and are
not taken for this question, because of three named gaps:
- It requires single-sample colour and depth; the renderer is MSAA 4, so it would need an extra
  depth prepass of the whole scene.
- It multiplies the final (already tone-mapped) colour by a tint, darkening ambient and
  CSM-shadowed light alike, instead of occluding only direct sunlight.
- It only sees rasterised depth, so it misses the relief that LOD1–2 carry in their maps.

It stays the candidate for contacts between placed objects (characters, props) if the receiver
fix below leaves them detached.

**Scene and states.** The installed rolling courtyard and the package 4/5 capture views: `joint`,
`close`, `walking-matched` and `grazing` against the Cycles renders, plus `rolling-grazing`,
`dip` and `crest` for acne, with dusk, night, storm and overcast spot checks.

**Question.** Can sun-only height-field shadowing give the paving its joint and pebble shadows,
and can a receiver normal offset remove the CSM acne, at no more than a fraction of a
millisecond? Can the paving then leave the CSM caster set to pay for it?

**Design, cycle 1.**
- **Height in ORM.B (asset, paving candidate 10).** The ORM's blue channel is metallic, which
  the paving multiplies by a factor of 0; it ships at 1024² as a constant. `maps.py` writes the
  occluding surface already used for the AO bake (ground plus drawn-in pebble tops), normalised
  over its range, and the range goes into the library descriptor. This needs no new texture,
  binding or pipeline; the cost is BC7 error in R/G, which is measured against candidate 9.
- **Sun micro-shadowing (engine).** A PBR plugin at the final-composition hook marches the height
  toward the sun in texture space, through the derivative tangent frame the PBR shader already
  builds, with a cone-soft penumbra and an early exit above the tile's maximum height. It
  scales only `directDiffuse + directSpecular`. The only direct light on PBR surfaces today is
  the sun (the hemispheric light excludes them), so ambient and AO are untouched. It fades out
  with texture minification. Materials without a height range (pebbles, plants) take a
  uniform-zero range, so all streamed PBR keeps one pipeline variant.
- **CSM receiver normal offset (engine).** Replace Lite's CSM receiver fragment for Standard and
  PBR with a Parallax variant that offsets the lookup position along the geometric normal by
  the selected cascade's world-space texel size, which it derives from the cascade matrix.
  Lite exposes no hook here, so this reaches its internal receiver registry. The library gap is
  recorded in the rendering research doc. Then A/B the caster `worldSpaceBias` down from 0.12 m.
- **Caster set (engine).** A/B excluding the paving ground and pebbles from the CSM casters once
  micro-shadows carry that relief.

**Cycle 2.** Fix what cycle 1's captures find, for example march aliasing, over-dark or haloed
joints, detached contact shadows, acne on steep stone sidewalls, and night/storm regressions.
Then tune the step count against cost.

**Must fix.**
- GPU validation errors or unwarmed pipelines (D-183).
- Visible banding, swimming or shimmer from the march under the moving sun.
- Shadows on the wrong side of stones.
- Renewed acne or detached contact shadows elsewhere in the world.
- A readable night or storm view that becomes unreadable.
- A GPU cost regression beyond a fraction of a millisecond, net of any caster saving.

**Allowance.** Two cycles in one work session (4 active hours), on dev-01's physical console.
Physical `smoke@1` waits for the end of the optimization packages (human direction).

**Ending decision.** Adopt, adjust or drop each of the three parts (micro-shadowing with
candidate 10, the receiver offset with its bias, and caster exclusion), with captures against
Cycles and measured costs, for human visual acceptance. Candidate 10 goes through the QA gate
and needs its own runtime visual acceptance.
