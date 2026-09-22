# Cobblestone production reduction — 2026-09-22

**Human approved (2026-09-22):** `production/candidate3` is now the approved reduced
visual baseline for production delivery. The previously approved
`cobble-study/candidate1` remains its source lineage. This appearance approval
does not change production budgets or establish QA/admission. The 137
stone placements, three stone meshes, UVs, materials and packed image pixels are
unchanged. The native source now uses 48,720 ground triangles and 32,481 plant
triangles, reductions of 58.4% and 40.6% respectively.

![Reduced paving at walking distance](production/candidate3/walking.png)

The approval applies to the presented walking view, SHA-256
`80d6198f58c480d83f3f6848efd3bbc26111e29268762de4075f868bf4cde283`,
and the candidate3 source identified below. Preserve this reduced appearance
through packaging. Receipts, provenance and reviewer reports remain unchanged
as evidence captured before this human approval; this dated record updates the
current selection.

The [brief](production-brief.md) allowed two cycles, followed by one explicit
correction of a demonstrated grit regression. Both independent screens rejected
the strict-budget candidate1: it met the old geometry numbers but erased leafy
moss, distorted small leaves and removed most grit. Candidate2 restored foliage,
but its decimated grit became dark triangular shards. Candidate3 retains the
original grit vertices and corner normals, removing only faces whose vertices
all lie at least 0.3 mm below the fitted soil. It restores the pale volumetric
contact accents without further stone or material iteration.

Representative matched views: [plant contact](production/candidate3/plant-contact.png),
[moss and grit](production/candidate3/moss-contact.png),
[sunny overview](production/candidate3/sunny-oblique.png),
[opposing light](production/candidate3/opposing-light.png),
[overcast](production/candidate3/overcast.png),
[grazing](production/candidate3/grazing.png),
[gray](production/candidate3/gray.png) and
[unlit](production/candidate3/unlit.png). Lead actually inspected the contact,
overview and grazing images and all three native/reimport comparison pairs.
Lead also inspected the opposing, overcast, gray and unlit controls. Both
[quality](production/quality-candidate3.md) and
[theme](production/theme-candidate3.md) screens supported provisional retention of
the corrected appearance before human approval. Production qualification remains
outstanding.
The reduced foliage keeps all 1,434 moss shoots, their stems and seven leaves per
shoot; each tiny raised leaf ridge becomes a simpler two-triangle leaf. Larger
leaves and stems receive moderate reduction. The source's known repetition,
longer joints and close-up moss limitations are not reopened.

## Measured source costs and preservation

| Component | Previously approved source | Approved reduction |
| --- | ---: | ---: |
| Placed stones | 534,300 triangles | 534,300 triangles |
| Soil and embedded grit | 117,048 triangles | 48,720 triangles |
| Plants, native one-sided accounting | 54,665 triangles | 32,481 triangles |
| Native asset total | 706,013 triangles | 615,501 triangles |
| Plants if every face is explicitly duplicated | 109,330 triangles | 64,962 triangles |

The reduced asset total excludes the surrounding presentation ground outside the
4 × 4 m export. This trims the source's surrounding render surface as well as
simplifying its interior. A source-like surrounding surface remains in the native
presentation and is explicitly marked excluded from runtime. Counts with doubled
plant faces are accounting projections, not an exported runtime artifact.

[Reopened-source verification](production/candidate3/native-verification.json)
checks finite geometry, bounds, all 137 exact stone geometry/UV/transform signatures,
unchanged active shader graphs and packed pixels, all 2,500 source grit pieces, and
root support. The soil differs from the source by at most 2.871 mm at 31,568
source-vertex samples (p99 1.576 mm); these include occluded areas. Plants are
re-seated on that soil. Actual retained stem vertices stay embedded, and moss
leaf vertices have at least 0.429 mm soil clearance. This is vertex/ray evidence,
not an exhaustive triangle collision or mathematical buried-face proof.
Of the 2,500 source grit pieces, 2,311 retain surface faces; 189 are wholly below
the soil and are omitted. The saved-source check excludes unused source vertices
when counting connected visible pieces, verifies rigid vertical repositioning and
original corner normals, and confirms the wholly omitted pieces are buried.

Approved input SHA-256:
`c5778d6d17cede747e546d6b4792d7db73f01e31b59bb399e69441b297feea20`.
Retained native source SHA-256:
`61a22f7efdb3ef0f665cfbb7983e15674561034acf91c487b0dc6bcb068dd421`.

## Representative delivery checks

Fresh standard-GLB exports were inspected and reimported into separate native
comparison scenes. Lead visually checked every pair. Leaf and moss retain explicit
COLOR_0; grit retains original normals and flat material colors. The neutral
comparison floor is intentionally separate from the fitted soil and does not
establish rooting. In particular, some grit and peripheral moss appear above that
flat floor in both images. Actual source contact is checked in the patch.

| Export | Triangles | Bytes | Mean loaded RGB difference |
| --- | ---: | ---: | ---: |
| Representative leaf and petioles | 656 | 2,465,328 | 0.0001721 |
| Representative moss colony | 7,800 | 472,396 | 0.0000944 |
| Full retained grit geometry, close camera | 30,721 | 746,608 | 0.000000265 |

[Transfer receipts and hashes](production/candidate3/transfer/summary.json) bind
the outputs. Leaf and moss p99 differences are one 8-bit level; grit p99 is zero.
The native leaf's 2.5% subsurface contribution remains a known standard-glTF
limitation. These comparisons establish representative Blender transfer only;
they are not a compressed full assembly or an engine-loader proof. Native build
and eleven captures took 71.8 seconds; the three transfer comparisons took about
25 seconds. Tool startup and agent inspection are additional elapsed work.

## Disposition and next production requirement

The class still allows 8,192 ground and 4,000 vegetation triangles at LOD0. The
retained source exceeds both. Its maps/materials also do not yet meet the three
shared-material contract; the old vegetation profile assumes four-pixel constant
color and the runtime vertex layout has no color stream. No class ceiling,
runtime budget, gate or library asset was changed to make this pass.

Defer further blind geometry collapse: it visibly damages the approved art.
The next bounded delivery question is whether shared baked materials, explicit
near/far LODs and measured compressed resources support this geometry within
the whole-scene costs. A deliberate class recalibration must use that resource
and runtime evidence and update the decision/affected docs before admission.
Preserve this reduced source and the approved original while answering it.
Material sharing, LODs/compression, rights review, full QA, immutable admission
and installed-game inspection remain open. This turn does not install paving in
the game or complete M4.5. Physical smoke remains deferred to the milestone exit.

Reproduce with Blender 5.2.1: `production/build.py -- candidate3`, then
`production/verify.py -- candidate3` and `production/transfer.py -- candidate3`.
Builders refuse existing output directories; use a separate workspace for a
replay. Each candidate retains its exact build snapshot. The Blender MCP endpoint
again failed to find its executable, so the verified machine-local Blender was
used in isolated background processes. No provider job or new generated image
was used. Original source bytes and prior evidence remain untouched.

Focused JSON checks and Python source compilation pass; declared native/transfer
hashes and the retained inventory are verified. Git LFS rules cover the new Blender,
PNG and GLB files. `git diff --check` passes. Pinned Node 24.18.1 / pnpm 11.12.0
`pnpm check` passes the build and stops at the same 117 pre-existing lint errors
outside this package (114 formatting and three SVG accessibility diagnostics).
Its unit stage does not run. Earlier evidence was not reformatted to hide that
repository failure. Machine-local logs are under
`%TEMP%/parallax-production-20260922/`. All changes remain uncommitted.
