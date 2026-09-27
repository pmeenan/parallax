# Timber-framed wall family — result (kit package K1, 2026-09-25/26)

**Status: accepted.** The human accepted candidate 18 on 2026-09-26 ("That looks SO much
better!"). It passed both independent screens with disclosed limits. It is source only: no runtime delivery, class QA, library admission or rights
review yet ([brief](brief.md)).

The package ran under D-207 (quality-gated, not effort-gated), adopted on 2026-09-26 at candidate 8,
when the human directed "Extend until success or no viable path for progress exists."

![Oak: MAT-009 reference and candidate 18](candidate18/compare-oak.png)

![Front: KIT-005 reference and candidate 18](candidate18/compare-front.png)

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

Only the accepted candidate 18 is retained. The rejected candidates' renders were deleted to keep
Git LFS lean; the table above records what each round found and fixed.

## Views

[front](candidate18/front.png), [corner](candidate18/corner.png), [junction](candidate18/junction.png),
[extreme](candidate18/extreme.png), [oak](candidate18/oak.png), [window](candidate18/window.png),
[street](candidate18/street.png), [overview](candidate18/overview.png),
[overcast](candidate18/overcast.png), [low](candidate18/low.png), [gray](candidate18/gray.png),
[unlit](candidate18/unlit.png).

Reference comparisons: [front](candidate18/compare-front.png), [corner](candidate18/compare-corner.png),
[junction](candidate18/compare-junction.png), [window](candidate18/compare-window.png),
[street](candidate18/compare-street.png), [oak](candidate18/compare-oak.png).

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

## Reproduce

```bash
blender -b --factory-startup --python build.py -- --out candidate18 --px 1.0 --oak-px 0.75 --stone-px 1.25 --subdiv 3 --paving-subdiv 3 --samples 256 --views front,corner,junction,extreme,oak,window,street,overview,overcast,low,gray --save-blend
```

```bash
blender -b --factory-startup --python build.py -- --out candidate18 --force --px 1.0 --oak-px 0.75 --stone-px 1.25 --subdiv 3 --paving-subdiv 3 --samples 256 --views unlit --save-blend
```

```bash
python compare.py candidate18
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

