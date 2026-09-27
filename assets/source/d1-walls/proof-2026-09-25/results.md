# Timber-framed wall family — result (kit package K1, 2026-09-25/26)

**Status: accepted (candidate 20).** The human accepted candidate 18 on 2026-09-26 ("That looks SO
much better!"). It passed both independent screens with disclosed limits. On 2026-09-27 the human had
its open front-left corner fixed in the source, and accepted
[candidate 19](#candidate-19-the-front-left-corner-2026-09-27) the same day. Viewing it installed in
the game, the human had its corner braces mitred and pegged and an upper-floor corner slot closed:
[candidate 20](#candidate-20-mitred-braces-and-closed-corners-2026-09-27) passed both screens with
disclosed limits, and the human accepted it the same day. Only candidate 20 is retained. Candidate 18
is in git history. Candidate 19 was never committed; its changed views survive in candidate 20's
comparison boards, and delivery candidate 4 was built on it. The runtime delivery follows the accepted source
([delivery results](../proof-2026-09-26/delivery-results.md)); see the [brief](brief.md) for scope.

The package ran under D-207 (quality-gated, not effort-gated), adopted on 2026-09-26 at candidate 8,
when the human directed "Extend until success or no viable path for progress exists."

![Oak: MAT-009 reference and candidate 20](candidate20/compare-oak.png)

![Front: KIT-005 reference and candidate 20](candidate20/compare-front.png)

## What was built

One seeded headless Blender script, [build.py](build.py), makes a two-storey, 6 × 3-bay test house
on the approved paving. The house is built from kit pieces, each instanced as a collection:
- **Ground bays:** plain, two window variants, door, a mid-bay braced variant, and a corner-braced
  variant for each facade.
- **Upper bays:** the same set, without the door.
- **Corner posts.** Each corner has one continuous plate over its post, showing end grain on the side
  face.

Plinth runs with corner footing stones, and foot soil with weeds, are laid per wall run.

- **Timbers are "members":** a rounded-rectangle profile swept along an axis and textured over its
  unrolled surface. Members buried in the wall keep only their exposed shell. End caps are
  concentric-ring tessellated.
- **Maps:**
  - The oak atlas is at 0.75 mm, plaster at 1 mm and stone at 1.25 mm.
  - Each bay variant has its own plaster field.
  - A tiled 0.25 mm fibre layer on the oak adds close-range detail. A mask keeps it off the end grain.
  - Geometry is displaced from the low-passed height at 2.5 mm. The oak's fine grain lives only in
    the normal map, so the geometry carries just the hewn form, checks and wane.
- **Oak (MAT-009, human direction):**
  - **Figure from growth rings.** Each face cuts the rings around a wandering pith axis. Boxed-heart
    members show straight grain near the pith and arches where the face runs out through the rings.
    Posts mostly run out.
  - **Knots.** They are elongated along the grain, with a dark heart and rings. The surrounding grain
    parts around them in contour loops, in both relief and colour.
  - **Surface.** Eroded earlywood leaves raised fibre islands on a dark ground, with open pores and a
    torn fibre surface. Each member has its own erosion.
  - **Hewing.** Faces carry adze scallops across the grain, and arrises break away unevenly along
    each member.
  - **Checks.** Short hairline splits and long deep checks follow the grain, and every long member
    has at least one on its face.
  - **Weathering.** Exposed and up-facing faces are silvered. The finish is matte (roughness
    0.85–1.0), and wear on each arris scales with the member's size.
- **Plaster (MAT-008):**
  - The field is bellied and trowelled, with sparse pits.
  - A rounded return with a shrinkage gap meets every timber.
  - Stepped finish-coat losses expose coarse brown backing. They are a quantile-fixed 0.4–1.4% of
    each panel, mostly at the timber edges, with speck-sized islands removed.
  - One warm limewash repair per panel, with hairline cracks at the timber and at opening corners.
  - Runoff below sills and plates, and a splash band above the plinth.
- **Plinth (KIT-007):** two uneven courses of rough-pitched cream-buff limestone. The faces are
  pillowed with chipped arrises. Joints are recessed buff mortar, with lichen, soil staining and moss
  low down. A full-height footing stone sits under each corner post (KIT-006).
- **Openings:**
  - Windows have real reveals and recessed four-light casements (about 0.66 × 0.86 m clear), glazed
    with uneven glass over a dim interior.
  - Plank shutters hang on strap hinges, with turn-button holdbacks lapping their edges.
  - The plank door is set back 50 mm, with a flush threshold.
- **Diagnostics:** `extreme` finds the longest check on a front ground post and frames it against a
  plaster loss at the timber edge.

## What it took (18 candidates, D-195 screens on each built candidate)

| Candidates | What the screens or human found | Root cause and fix |
| --- | --- | --- |
| 1–2 | No corner braces or footing stone; sandpaper plaster; plaster showing around leaves and sashes; plinth ledge; log-like thin members | Missing KIT-006 pieces; opening cuts stopping short of frames; arris radius independent of member size |
| 3 (human) | Oak read as plastic: straight, even grain with no hand-cut age; wanted knots and cracking | Anisotropic noise stretched along members cannot make real figure; the oak model was rebuilt |
| 4–8 | Combed grain, waxy close-up, knots as holes, mirrored corner sills, doubled-looking brace split | Fine grain moved to the normal map only; checks capped to member size; side walls given their own corner variants |
| 8 → D-207 | Both screens still failing | The human made quality, not effort, the stop condition |
| 9–11 | Plinth pressed into a mortar skin; plate end grain painted on the long face; flat plaster band around panels; knots with no bending | Corner plates resolved into one continuous member per corner; separate recessed stones; the flat band was cast shadow (a sky-only render proved it) and a loss band, and losses were redistributed; the growth-ring figure model introduced |
| 12–15 | Chevron ripples round knots; knots too faint or too dot-like; rust-like halos | Irregular ring spacing; knots elongated along the grain with a broad lens; halo contrast reduced |
| 16–17 | Grain running straight through knots; brace foot through the post arris; posts straight and knotless; end grain hatched by the fibre layer | Contour-loop flow lines round knots; shallower brace; posts biased to run-out figure with at least two knots; detail mask keeps fibres off end grain |
| 18 | Both screens pass with disclosed limits | — |

Only the accepted candidate (now 20) is retained. The rejected candidates' renders were deleted to keep
Git LFS lean; the table above records what each round found and fixed.

## Views

[front](candidate20/front.png), [corner](candidate20/corner.png), [corner-left](candidate20/corner-left.png),
[right](candidate20/right.png), [junction](candidate20/junction.png),
[extreme](candidate20/extreme.png), [oak](candidate20/oak.png), [window](candidate20/window.png),
[street](candidate20/street.png), [overview](candidate20/overview.png),
[overcast](candidate20/overcast.png), [low](candidate20/low.png), [gray](candidate20/gray.png),
[unlit](candidate20/unlit.png), [brace-foot](candidate20/brace-foot.png),
[brace-head](candidate20/brace-head.png), [slot-left](candidate20/slot-left.png),
[slot-right](candidate20/slot-right.png).

Reference comparisons: [front](candidate20/compare-front.png), [corner](candidate20/compare-corner.png),
[junction](candidate20/compare-junction.png), [window](candidate20/compare-window.png),
[street](candidate20/compare-street.png), [oak](candidate20/compare-oak.png).

## Independent screens (D-195), candidate 18

Fresh subagents were given only the brief, the reference images, the human's oak direction and the
renders.

- **Quality: ready with disclosed limits.**
  - All eight must-fix items pass.
  - The oak is not plastic and its grain is non-uniform; cracking along the grain passes.
  - Hand-cut age and knots are partial.
- **Consistency: consistent with disclosed limits.**
  - Construction, lighting and repetition all pass, and scale holds: a 1.7 m eye height, 2 m bays,
    a 1.02 × 2.24 m door and a 0.49 m plinth.
  - The oak meets the human's direction at 1–1.5 m.
- **Lead inspection** agrees with both screens.

## Candidate 19: the front-left corner (2026-09-27)

The delivery's screens found the approved test house open at its front-left corner. The braced bays'
post was a shell post, which left a slot through the corner, and the left facade's brace ended in
the air. The human directed "change the accepted source to fix the geometry now."

![Front-left corner and right facade, candidate 19 (left) and 20](candidate20/compare-c19-corners.jpg)

- **Corner post.** The braced bays' post is now the house's full-depth corner post. It stands 35 mm
  proud of the left facade's plaster plane, as the corner piece's post does at the front-right.
- **Staging.** The house stands on the paving continued, undisplaced, to the horizon. Engine
  package 7 found that Blender's Hosek sky is bright below the horizon, about ten times the paving's
  radiance ([lighting results](../proof-2026-09-27/lighting-results.md#source-staging-a-finding)).
  Past the old 32 × 24 m patch, walls took 13–37% more sky light than a street gives. The mean of a
  sunlit view moves by at most 2.4% (overview), and the sun-off overcast diagnostic is 7.5% darker.
- **Everything else is unchanged.** Changing one member had reshuffled the others' seeded look
  twice. The post had drawn a bow value from the shared random sequence as a beam, and the oak
  detail tile is sampled in atlas space. Now:
  - the post keeps its old draw, in the old order;
  - its old atlas rectangles stay as empty placeholders, and its own are packed last.

  `layout.json` is byte-identical to candidate 18's. The junction, extreme and window views match
  candidate 18 within 24 levels at every pixel. The corner, oak and street views differ only at the
  horizon.
- **New views:** `corner-left` and `right`, the runtime delivery's views of the fixed corner and
  the mirrored right facade.
- **Independent screens (D-195).**
  - **Quality: ready with disclosed limits.** The corner is closed, both braces seat on the post,
    and there is no z-fighting. Nothing else regressed.
  - **Consistency: consistent with disclosed limits.** The two corners now follow the same framing
    logic.
  - **Both flagged the first staging plane.** A flat paving-coloured plane read as a beige
    backdrop and did not take the clay override. The final candidate uses the paving material
    instead.
- **Disclosed:**
  - The corner post's face is about 0.285 m, 35 mm wider than a bay post. A heavier corner post is
    period-correct.
  - `corner-left` crops the post's head and foot. The plate over the post is visible only in
    `front`, `low` and `overview`.
  - The oak atlas grows from 8896 to 10304 rows. Source only: the delivery re-packs its own atlas.

## Candidate 20: mitred braces and closed corners (2026-09-27)

Viewing the installed test house, the human found two defects in candidate 19:
- "The diagonal boards in the corners don't look tight - they need to run all the way to a mitre
  cut and be aligned with the pegs."
- "The side view also showed daylight gap in the corner of the upper floor."

![Brace joints and the corner slots, candidate 20](candidate20/joints.jpg)

- **Braces.**
  - **Mitred ends.** Each brace end is cut parallel to the post face and the plate underside, and
    seated 75 mm into them, as a tenoned brace is. The visible shoulder runs the brace's full
    width against its post or plate. The square ends had left a plaster triangle at one edge.
  - **Pegs on the brace axis.** Each brace has two pegs on its axis, 50 mm into the post and 50 mm
    into the plate, so each passes through the hidden tenon. They had been 15–20 cm off it.
  - **Plate pegs stand on the plate's real surface.** The plate bows and is hewn with up to about
    6 mm of relief, which buried pegs 2 mm proud of its nominal face. Plate pegs now stand 3 mm
    proud of the highest point of the plate's displaced surface under them. Post pegs stand
    4 mm prouder than the frame's other pegs.
- **Corner slot.** Both corner posts now reach 5 mm past the side facade's plaster line. They had
  stopped 35 mm short. Seen along the side wall, that slot showed through the roofless shell to
  the sky. The posts are now 0.285 × 0.29 m. `slot-left` and `slot-right` graze along each side
  facade into its front corner.
- **Everything else is unchanged.**
  - **Braces keep candidate 19's grain.** Each brace keeps candidate 19's length, so its texture
    is byte-identical. The mitred geometry spreads that texture along each edge. A first build
    with new brace lengths re-rolled the grain into straight streaks with a long check, reading
    as two boards. Both screens flagged it, and one found a chipped edge showing plaster.
  - **Atlas.** The corner posts' old atlas rectangles stay as placeholders. Their new ones are
    packed on one fresh shelf, and the posts' end caps fill the old holes.
  - **Checked by diff against candidate 19.** `layout.json` is identical. The oak atlas grows
    from 10304 to 10432 rows. The maps are stored bottom-up, so candidate 19's rows sit 128 rows
    lower. With that offset, only the corner posts, braces and pegs change. So do their rows and
    holes, and the plaster of the six braced panels near the brace ends.
  - **Renders.** `junction` and `extreme` match candidate 19 within 8 levels. Every other view
    differs only at the corners and braces.
- **New views:** `brace-foot`, `brace-head`, `slot-left` and `slot-right`.
- **Independent screens (D-195), on the build with the restored brace grain.**
  - **Quality: ready with disclosed limits.** Every brace joint is a tight full-width cut, with no
    gap, overshoot or open end. The pegs are on the brace axes, and there is no daylight at any
    corner. The brace grain and knots match candidate 19, and no plaster shows along brace edges.
  - **Consistency: consistent with disclosed limits.** All braces follow one joint logic on both
    corners, both side facades and both floors. The corner posts match each other.
  - **Consistency also found:** the pegs, 50 mm in, sat past a 40 mm seat, so they missed the
    tenon. The seat is now 75 mm. That geometry is hidden inside the post and plate, and the
    final build's renders were checked against the screened ones.
- **Disclosed:**
  - **Corner-post grain changed.** Deepening the posts changed their surface grid, so their
    grain is new, with a knot in a new place in `oak`. It still reads as the same oak.
  - **Pegs in shade are barely visible:** the left facade's post peg in `corner-left`, and the
    right facade's plate peg in `right`. At grazing angles, the pegs at post edges show as small
    nubs.
  - **An existing lengthwise check** on the front-left upper brace reads as a split board in the
    new `brace-foot` close-up. Candidate 19 had it too, but no candidate 19 view came this close.

## Known limits (disclosed, none blocking at play distance)

- **Oak colour.** Warmer and more even than MAT-009 v5 and KIT-006. Silvering and grime in the checks
  are lighter than in the concepts, and under overcast the oak falls toward charcoal.
- **Knots.** They read as soft colour figure with rings and grain looping round them. One brace knot
  barely deflects the relief, and none has a hard, raised core.
- **Close range.** The oak softens inside about 0.5 m and smears at 0.25 m (`extreme`). A faint
  beaded ridge pattern shows along some grain lines at about 1 m.
- **Plaster.** Its relief is an even stucco rather than MAT-008's broad trowel planes. The repair
  patch is faint, and the facade reads less weathered than DIR-002 B.
- **Plinth.** Some bed joints read as flat shelves where an upper stone overhangs the lower course.
  The corner stone is a flush quoin rather than a projecting footing.
- **Minor details.**
  - Glazing is near-uniform dark, not slightly uneven.
  - Braces are about half the post width.
  - The door's right jamb sits about 0.18 m from the bay post, as in KIT-005 v3.
  - Plate joints fall at the post faces.
  - The eaves plate is about 6.5 m above grade including the plinth.
- **Size.** Candidate 18 is about 1.2 GB in Git LFS, almost all maps. The runtime density is chosen at
  delivery (D-200).
- **Scope.** No roof (K2) and no lanterns. The ground is the approved paving's source maps, without
  its scatter.

## Cost of the package

- **Time.** About 30 hours elapsed over 2026-09-25/26. That covers 29 scripted preview passes, 18
  full-quality builds of 15–25 minutes each, and 32 independent screens.
- **Lost time.** A wait loop keyed on the process name `blender` also matched two unrelated
  `blender-mcp.exe` helpers. It never ran, which lost several hours. Builds now start directly.
- **GPU memory.** Rendering all 12 views in one process runs out of GPU memory at full resolution.
  Candidates render `unlit` in a second seeded pass, which reproduced byte-identical maps.
  At candidate 20 even that pass ran out: as emitters, the unlit view's surfaces put every displaced
  triangle into Cycles' light tree. Unlit materials now turn emission sampling off.

## Reproduce

```bash
blender -b --factory-startup --python build.py -- --out candidate20 --px 1.0 --oak-px 0.75 --stone-px 1.25 --subdiv 3 --paving-subdiv 3 --samples 256 --views front,corner,corner-left,right,junction,extreme,oak,window,street,overview,overcast,low,gray,brace-foot,brace-head,slot-left,slot-right --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate20 --force --px 1.0 --oak-px 0.75 --stone-px 1.25 --subdiv 3 --paving-subdiv 3 --samples 256 --views unlit --save-blend
```

```bash
python compare.py candidate20
```

Blender 5.2.1, seed 7. The candidate's `build-snapshot.py` is the exact recipe. The ground uses the
approved paving [candidate1 maps](../../d1-paving/proof-2026-09-22/photoreal/candidate1).

## Where the ground-surface method had to change (first architecture asset)

- **Unrolled members instead of a single height field.** Each timber or stone is a swept profile
  with its own periodic field grid, packed into a shared atlas. The handbook's field toolkit carries
  over once `gnoise`/`worley` accept non-square, anisotropic grids.
- **Wood figure needs a physical model.** Anisotropic noise reads as plastic or combed. Growth rings
  around a wandering pith, cut by each face, give believable figure. Knots must perturb that ring
  field and be drawn as flow loops, not as colour decals.
- **Keep fine detail out of the geometry.** Displacing fine grain melts it. The geometry carries the
  form, and the normal map plus a tiled fibre layer carry the detail. The fibre layer must be masked
  off the end grain.
- **Buried faces get no texels.** Shell profiles cut at the plaster plane save about half the oak
  atlas.
- **Caps need even tessellation.** Exposed ends need the same surface recipe as the faces beside them.
- **Wear scales with member size.** A fixed arris radius turns thin members into logs.
- **Integration derives from neighbours:**
  - Plaster reads the timber footprint: the return gap, losses, cracks and runoff.
  - The plinth reads height above ground: stains, damp and moss.
  - Opening cuts must reach under the frames.
- **Quantile-defined damage.** Loss masks set by area fraction behave the same at every map
  resolution. Fixed thresholds do not.
- **Repetition is a layout problem.** Separate variants per facade corner, and randomized loss and
  runoff per variant, remove stamps.
- **Screens misread cast shadow.** Verify a "flat band" claim with a sky-only render before changing
  the asset.

## Next

Candidate 18 is accepted. The K1 delivery package follows:
- modular piece export
- LODs and KTX2 maps at a measured runtime density
- architecture class QA
- kit-piece instancing and non-ground sun micro-shadowing in the engine
- installed inspection
- measured cost

