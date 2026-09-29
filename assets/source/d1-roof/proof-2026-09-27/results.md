# Terracotta roof — result (kit package K2, 2026-09-27/28)

**Status: accepted (candidate 8), 2026-09-28.** The human accepted candidate 8 with its disclosed
limits, including the lap detail at the 1 m close view. The consistency screen found it "consistent
with disclosed limits". The quality screen held it "not ready" on that 1 m view only; everything from
street distance up passes. It is source only: no runtime delivery, class QA or library admission yet
([brief](brief.md)).

![Tile close-up: MAT-011 reference and candidate 8](candidate8/compare-tile.png)

![Gable: KIT-008 A reference and candidate 8](candidate8/compare-gable.png)

## What was built

[build.py](build.py) opens the accepted [K1 walls source](../../d1-walls/proof-2026-09-25/results.md)
(candidate 20), with its house, paving, calibrated sun and sky. It then adds a 40° gable roof, built as
kit pieces (kit spec: 2 m along the eave, pivot at the eave midpoint):
- **Slope pieces:** three 2 m bay variants (A, B and C) and left and right verge pieces. The front
  slope places them along the eave, and the back slope reuses them turned 180° about the house's centre.
- **Ridge pieces:** one per bay and one per verge span. Caps are 0.45 × 0.40 m, lapping one way on a
  lime mortar bed, with mortar-packed gable ends.
- **Gable piece:** placed at both ends. It has a king post and raking plates in K1's oak, with a K1
  plaster field over the triangle.
- **Tiles:** real curved Roman pans and covers, 0.40 m long and 24 mm thick, seven channels per 2 m bay
  (0.286 m pitch).
  - **Stacking.** A support solver sets each course's pose. Pans nest nose-down on the pan below.
    Covers rest on the pan rims either side of their joint and on the cover below.
  - **Texture.** An atlas of 28 unique tile faces (0.75 mm per texel) carries the clay: moulding,
    sand, pits, kiln flashing, lichen crusts, and moss and damp in the channels. The cut edges use a
    procedural fired-body material.
  - **Variation.** Each tile gets a kiln tint, about one in twelve dark and one in fourteen pale. A
    broad weathering field dulls the lower slope.
- **Eave and verge:** oak rafter tails with end grain, eave boards, soffit boards and eaves blocking,
  purlins and a ridge beam running out through each gable, barge boards, and mortar pointing along the
  verge.
- **Shared code.** The field toolkit and K1's member, oak, plaster and atlas code now live in
  [`../../common/`](../../common) (`fields.py`, `members.py`). They are copied from K1's accepted
  builder, which keeps its own frozen copy. The roof's oak is K1's recipe, and its gable plaster is
  K1's plaster field.

## What it took (8 candidates, 16 independent screens)

| Candidate | What the screens found | Root cause and fix |
| --- | --- | --- |
| 1–2 | Ridge open to the sky under a flat strip; washed salmon tiles with chalky mottle; wood-grain tile edges; perfectly regular field; street view missing the roof | Caps set below the covers' crowns → caps rest on the top covers; palette and weathering retuned; a fired-body edge material; per-tile jitter and bellying; street camera reframed |
| 3–4 | Laps cutting through the tile above; boxy pans; peach/dark patchwork; pale grey rafter-tail ends; sky at the eave–verge corners | Tiles 50% too wide → the brief was revised to MAT-011's proportions (seven channels a bay); nesting tapers; the tail ends' pale read was sun **specular** on flat, dark end grain (proved by a near-black albedo render), so end-grain specular is now masked to a quarter; a verge tail and full-width blocking |
| 5–6 | Fins and blades still cutting through covers; ridge a flat band; corner pinholes | A course-to-course sideways wander exceeded the nesting clearance, so channels now keep one offset. The real cause was structural: every course was lifted **and** tilted nose-up, so each sank into the one above. |
| 7 | No fins; remaining: ridge band, verge staircase, too little kiln variation, hollow ridge end | A support solver replaces the lifts. It rests every pan and cover on what is under it, including the eave and ridge courses' edge cases. |
| 8 | Laps at 1 m; the rest passes or is a disclosed limit | Kiln variation widened; verge pointing; right ridge end closed behind its overrunning cap; lower ridge bed; a rear overview added |

Only candidate 8 is retained. The rejected candidates were never committed, and this table records
what each round found.

## Views

[gable](candidate8/gable.png), [eave](candidate8/eave.png), [tile](candidate8/tile.png),
[underside](candidate8/underside.png), [street](candidate8/street.png), [verge](candidate8/verge.png),
[overview](candidate8/overview.png), [overview-rear](candidate8/overview-rear.png),
[front](candidate8/front.png), [ridgecheck](candidate8/ridgecheck.png),
[cornercheck](candidate8/cornercheck.png), [overcast](candidate8/overcast.png), [low](candidate8/low.png),
[gray](candidate8/gray.png), [unlit](candidate8/unlit.png).

Reference comparisons: [gable](candidate8/compare-gable.png), [eave](candidate8/compare-eave.png),
[tile](candidate8/compare-tile.png), [street](candidate8/compare-street.png).

## Independent screens (D-195), candidate 8

- **Consistency: consistent with disclosed limits.**
  - Drainage passes: every lap runs uphill over downhill, the pan mouths are open, and nothing shows
    through.
  - The structure is sound: eave, verge, ridge and the join to the walls.
  - Scale matches the brief: 45 channels across 12.85 m, a 0.45 m eave, a 0.3 m verge and about 40°.
  - The new oak and plaster match K1, and every view agrees with the others.
  - Open items: the 1 m laps; the ridge caps shedding onto a band of mortar before the top course;
    hard-edged mortar blocks at the verge corner and ridge end; a dark pocket at the verge corner it
    could not confirm is closed.
- **Quality: not ready.**
  - Pass: stamping, support, gables, lighting, the join to the walls, and the ridge and eave lines.
  - Partial: drainage (the 1 m laps read as interpenetration), plastic clay (no chips, cracks or
    replaced tiles), and the verge (a sawtooth of tile ends above the barge board).
  - Its must-fix list is the 1 m lap detail and the pans' dark troughs, then the corner mortar block
    and hooked corner tile, then the verge sawtooth.

## Open items

**Accepted as a limit (2026-09-28): the 1 m lap detail.** Both screens name it first.
- Cause: the covers rest on the pan rims near their crowns. With pans this close together, each
  cover sits high over a dark void, and the pans' rim ends and heads show beneath it.
- MAT-011's covers sit down into the pans, tight and thick.
- A fix is a geometry round, probably one or two candidates:
  - a wider gap between pans, so covers bear low on their own sides;
  - rounded, thickened pan rims and heads;
  - a lighter trough interior.
- The alternative is to accept it for the 1 m view, as the K1 oak's texels inside 0.5 m were
  accepted. At walking distance the roof is 5 m or more away, so 1 m is reachable only from raised
  streets and stairs.

**Minor, fixable in the same round:**
- trowelled rather than block-faced mortar at the verge corner and ridge end;
- ridge caps reaching over the top course's heads;
- a darker verge-corner pocket closure, so it can be shown to be closed;
- a few chipped, cracked or replaced tiles.

## Where the wall method had to change

- **Repeated units are geometry, not texture.** Thousands of tiles are real curved shells drawn from a
  small atlas of unique faces. Variation comes from per-tile tint, jitter and a broad weathering field,
  not from unique maps. No atlas stamp shows at street or overview distance.
- **Stacked shells need a support model.** Hand-set lifts and tilts made every course sink into the
  next. Only a solver that rests each tile on what is beneath it (deck, lower course, pan rims)
  removed the interpenetration. Its edge courses (eave and ridge) need clamping to the field's pose.
- **Screens misread specular as albedo.** The pale rafter-tail ends were a sun glint on flat, dark end
  grain, not texture or UV error. A near-black albedo render proved it, as K1's sky-only render proved
  a "flat band" was cast shadow.
- **Scene memory limits the source renders, not the game.** Measured on candidate 8's `source.blend`:
  - 11.3 GB of uncompressed authoring textures (walls 8.3, roof 2.6, paving 0.5). The K1 oak atlas alone
    is five 16384 × 10432 maps.
  - About 420 M evaluated triangles from subdivision and displacement (paving 246 M, walls 125 M,
    roof 49 M).
  - A 22.6 GB Cycles peak, which spills into shared host memory, so full passes intermittently run out
    of memory.

  The runtime delivery of the same walls is 276 MB of BC1/BC7 maps and 2.9 M LOD0 triangles; the
  installed cell with the paving holds 409 MB on the GPU. Authoring a whole courtyard in Cycles will
  need neighbours rendered from their delivered LODs, or Cycles' texture size limit.

## Candidate 9 (2026-09-28): the eave course and the ridge bedding

In the installed game, the human found two geometry defects that candidate 8 already had.

![Candidates 8 and 9 at the eave corner, the ridge and the 1 m close view](candidate9/compare-c8-eave-ridge.jpg)

- **Eave course.** "The frontmost row of tiles … is vertically offset … and is embedded in the beam."
  - **Cause:** the support solver rests each course on the one below. The eave course had nothing
    below it, so its pans lay on the bare deck, about a lap below the field. Its covers rested on those
    pans' rims alone and sat 38 mm under the field line, against the eave board.
  - **Fix:** the solver now solves pans and covers twice. The eave course rests on a virtual course
    below, posed as the field. A tilting fillet carries it: an oak batten on the eave board whose top
    follows the eave pans' bottom line, bowed with the bays' 12 mm belly.
  - **Result:** every course now shares the field pose, pans at lift 37 mm and tilt −0.092, covers at
    111 mm and −0.048, with the ridge course as before.
- **Ridge.** "The beam they are embedded in right now looks wrong."
  - **Cause:** the mortar bed was a slab wider than the caps, standing up to their rims. In each pan
    channel it showed as a grey wall that the top courses butted into.
  - **Fix:** the bedding now stays 35 mm inside the cap rims, so the caps lie directly across both
    slopes' top courses. The mortar shows only as shadowed packing in the channel ends.
- **Kept:** the fillet battens are made after every accepted member and packed late, so the existing
  timbers keep their random draws and atlas positions. They paint from their own seed range, with the
  members' seed counter restored afterwards.
  - The first render seeded them from the shared counter. That moved the seeds of the two fields made
    after the members, the oak detail tile and the gable plaster; the consistency screen caught it.
  - The tile, oak detail and gable plaster maps are now byte-identical to candidate 8's.
- **Disclosed: the lower slope settles.** Each course's pose rests on the one below. In candidate 8,
  courses 1–8 of 16 were a transition zone above the low eave course: covers in courses 1–3 stood up to
  38 mm high, and course 2 was tilted differently (the consistency screen recomputed the poses).
  - In candidate 9 every course takes the field pose except the top cover row, which is unchanged.
  - Roughly the lower 40% of each slope therefore moves visibly in the `front`, `overview` and `tile`
    views. It is more even than before.
- **First screen round:** both screens failed the first render's ridge. The caps' rims were set at
  the top covers' highest crown, which is at their downhill ends. Under the rims, the covers are near
  their narrower, lower upper ends, so the rims stood 30–40 mm above them and the recessed bedding
  still showed as a band.
  - The rims now rest on the covers' crowns exactly where they land, 57 mm lower. Over each bay the
    caps also follow the courses' 12 mm belly.
  - The verge pointing now starts over the eave board, so its flat end no longer shows under the eave
    course (the quality screen's optional item).
- **Second screen round** (second render):
  - **Quality: ready with disclosed limits.** Both defects are fixed, with no new defect, floating tile,
    interpenetration or sky gap.
  - **Consistency: consistent with disclosed limits.** The builder diff is only the eave, ridge and
    verge-pointing changes. The tile, gable plaster and oak detail maps are byte-identical to candidate 8.
  - The oak atlas grew 832 rows for the late-packed battens, and every candidate 8 texel is unchanged
    within it.
  - Outside the eave, ridge and verge feet, the renders differ only by render noise and by the eave's
    and roof's own shadow edges.
- **Disclosed limits:**
  - the 1 m `tile` lap detail, carried from candidate 8;
  - cool grey mortar packing in the pan channels under the ridge caps, set back in their shadow;
  - cap rims that may float about 3 mm over the covers' cross-slope sag, hidden in the rim shadow.
- **Ridge ends** (the human's question after the second round: "Is it normal for there to be that big of
  a block of mortar at the end of the ridgeline?").
  - **Before:** candidates 1–9 closed each ridge end with a flat mortar plate over the whole cap arch,
    running down past the tiles to below the deck. It stood on the gable like a tombstone.
  - **Now:** a ridge end is normally a mortar plug inside the end cap's arch, or a closed end tile. It
    is now a plug inside the last cap's arch only, down to its rims' chord and 15 mm in from the end.
    It is sized to the cap's actual end: at the right ridge, that is the narrow, lapped-up end.
  - **Third render:** all views were re-rendered with this change.
- **Status:** awaiting the third render's check and the human's acceptance.

## Reproduce

Views render in several processes because a full pass can run out of GPU memory; outputs are seeded
and identical across passes.

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views gable,eave --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views tile --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views underside --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views street,verge,overview,overview-rear,front --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views ridgecheck,cornercheck,overcast,low,gray --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate9 --force --samples 256 --views unlit --save-blend
```

```bash
python compare.py candidate9
```
