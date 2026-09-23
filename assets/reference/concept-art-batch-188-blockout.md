# Batch188 — shared courtyard camera blockout

Status: isolated first-cycle spatial study, pending root terrain reconciliation and review. Not finished game art, runtime geometry, library admission or human Form approval. No imagegen used. No existing scene or world files modified. One of two maximum render cycles used; approximately 12 active minutes including tool reconciliation and verification, excluding waits. No commit.

## Method and authority

Approved [187 layout receipt](concept-art-batch-187-a.md) and [SVG](concepts/batch-187/village-well-courtyard-plan-v1.svg) control horizontal geometry. Registered Blender5.1.2 executable was absent. Background Blender MCP returned executable-not-found. Root authorized installed direct local Blender fallback; verified C:/Program Files/Blender Foundation/Blender 5.2/blender.exe = Blender5.2.1 LTS, build9e2066aef7ef, built2026-08-25. Machine-local registry reconciliation remains root-owned.

[Authoring script](concepts/batch-188/blockout.py) ran in an isolated background factory-startup process. It refuses to overwrite an existing scene, saves [one shared scene](concepts/batch-188/courtyard-layout.blend), then changes only the active camera for four native Cycles24-sample renders. All render files are direct Blender outputs, unedited1536x1024 PNG. No input raster, remote assets, textures or paid services. Script-authored proxy primitives; no finished asset or public-rights clearance claimed. The 3D room skill's geometry/camera principles apply; its production Form/Runtime gates have not been crossed.

Scene saved2026-09-19 20:34:18UTC; renders completed20:34:26 through20:34:45UTC. [Run log](concepts/batch-188/blockout-run.log), [scene facts](concepts/batch-188/blockout-scene.json).

## Geometry and cameras

Game(x,z) maps to Blender(x+516,z+146,height), metres. North is positive BlenderY / gamez. Court reservation x[-540,-492], z[-170,-122]. House1[-540,-527]x[-136,-122]; House2[-506,-492]x[-136,-122]; House3[-540,-528]x[-170,-159]; House4[-505,-492]x[-170,-159]. Four opaque wall masses exactly6m high, pitched roofs9m ridge, no eave overhang beyond footprints. No invented doors/windows on reservation masses.

E-W lane z[-154,-148], south spur x[-521,-515]:6m wide. Extended route strips terminate as local context only, not surveyed roads through external parcels. Separate well(-522,-139), outerdiameter2.5m, ringheight1m with simple posts/crossbeam; bench follows SVG placement. Stairs x[-514,-510], z[-138,-128], opaque entrance at(-512,-128). Actual substrate opening exists above stair trench.

All elevations are PROVISIONAL: datum0, housewalls6m/ridges9m, wellring1m, stair descent2m over10m (20x0.1m risers,0.5m treads), retainingwalltops0.45m, opaque entrance leaf bottom-2m/top0.6m, banktop2.2m. These are camera-study assumptions, not source terrain or construction authority. Bank uses simple masses, not finished terrain. No castle, moat, bridge or distant invented geography.

| View | Game camera x,z | Eyeheight | Horizontal field of view | Direction target x,z |
| --- | --- | --- | --- | --- |
| A | -534,-154 | 1.7m | 65 degrees | -515.125,-135.875 |
| B | -498,-145 | 1.7m | 65 degrees | -519.25,-139.75 |
| C | -518,-164 | 1.7m | 65 degrees | -520.25,-144 |

Horizontal look vectors derive from SVG arrows. Overview is orthographic from Blender(42,-60,50), targetorigin, span72m. No camera/object repositioning between renders. Saved scene activecameraA.

## Actual-view observations

- [A](concepts/batch-188/blockout-a.png): well foreground, benchleft, stair trench behind. Entry mostly obscured by well/low viewing angle.
- [B](concepts/batch-188/blockout-b.png): reverse view, well farther away, stairs foregroundright; lower doorway not established.
- [C](concepts/batch-188/blockout-c.png): south approach and separate well/entrance silhouettes readable, doorway mostly belowgrade and stairs strongly foreshortened.
- [Overview](concepts/batch-188/blockout-overview.png): four building masses, well, separate stair trench and uninterrupted lane reservations visible. This does not establish surrounding town geometry.

Key finding: fixed1.7m cameras plus assumed2m descent obscure much of the entrance. Do not use these as proof of readable entrance-detail coverage or reconciled005 appearance. Root terrain reconciliation and screen review precede a second cycle. No movement/height correction silently made to improve a painting.

## Binary provenance

| File | Bytes | SHA256 |
| --- | --- | --- |
| blockout-a.png | 1548426 | 9423bcd81c0f7ccf40cd652970c107a309efebe20bb938f048cf8bb1428b0faf |
| blockout-b.png | 1522022 | 8c42e48e691a2345c48d38990d48dd3b66f6d4200018a542b35f3b8390265470 |
| blockout-c.png | 1509744 | 5b4ae5d4cd52d9e46b6627152e471a33ad91f5b88d7373ed4220c2b65c2db5e9 |
| blockout-overview.png | 1612652 | b416522d5e606c69e270637738f1ce9b30c14fadb070b42c21be033f00182d62 |
| courtyard-layout.blend | 126391 | c5dfb6dc34f9af93bdcd4cf8f2618ce906d8337122410efac8eda2911a1c20c9 |

All five assigned creative binaries staged under existing LFS attributes; scene pointer verified. Source script SHA256 c74bfe23ddae133dd2284ccbbc3ef2877dddd3313188f3bc89a892c6b9276d1a. No image-generation model/seed applies.

Final verification: all five LFS index SHA256 pointers match native binaries; all four PNG header dimensions1536x1024. Input187-a SHA25632a72c47bd8e83bf2fc77aba9a2db1d8f132abe92e113951e6048fc6c1ed01d5; SVG SHA256281d4390924628bc4d63f80bb562004941eea2c937ceec57f26a5c5fbdebed69.
