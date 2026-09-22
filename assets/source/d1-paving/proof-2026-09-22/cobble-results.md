# Smaller cobblestone-scale proof — 2026-09-22

**Human approved on 2026-09-22:** [candidate1](cobble-study/candidate1/source.blend)
is the accepted visual baseline for the smaller-stone layout and vegetation
integration. Approval follows the presented walking capture and disclosed
remaining repetition/joint limits. One artistic cycle
returns to the earlier three stone sources and their physical detail scale, fits
the approved leaf color and moss into new joints, and shortens the longest modeled
straight joint. Repeated mineral markings and visibly registered joint runs remain
as disclosed baseline limitations. Further appearance refinement is optional;
production delivery and installed-game acceptance remain open.

Approved source SHA-256:
`c5778d6d17cede747e546d6b4792d7db73f01e31b59bb399e69441b297feea20`.
The presented walking capture SHA-256 is
`7b97c288b01821600d07ccec6092d501f2c3f45551cb9a739b648538bd255e4d`.
Native receipts, provenance and independent screens retain their preapproval
state; this dated approval records the subsequent human disposition without
rewriting measured evidence or implying QA, rights or runtime approval.

## Actual appearance

- [Sunny overview](cobble-study/candidate1/sunny-oblique.png)
- [Walking height](cobble-study/candidate1/walking.png)
- [Complete packing](cobble-study/candidate1/top-packing.png)
- [Opposing light](cobble-study/candidate1/opposing-light.png) and
  [overcast](cobble-study/candidate1/overcast.png)
- [Leaf/contact detail](cobble-study/candidate1/plant-contact.png) and
  [moss/contact detail](cobble-study/candidate1/moss-contact.png)
- [Grazing](cobble-study/candidate1/grazing.png),
  [reverse](cobble-study/candidate1/reverse.png),
  [gray geometry](cobble-study/candidate1/gray.png), and
  [unlit color](cobble-study/candidate1/unlit.png)

Lead inspected all eleven native views against the earlier small patches and
selected references. The compact rectangles and squares restore the user's
preferred cobbled character. More joints end at another stone, but some long
alignments remain evident at walking and grazing angles. The three pale mineral
patterns are still recognizable; rotations and adjacency changes have not made
new stone identities. The existing material has not been rewritten or enlarged.

Both independent [quality](quality-cobble1.md) and [theme](theme-cobble1.md)
screens inspected the actual candidate and support retention for human review.
Neither identifies a concrete new integration regression requiring the optional
second artistic cycle. Their disposition agrees with the lead's inspection.
The subsequent human approval above accepts this visible baseline with the
documented limitations.

Approved leaves retain their geometry, UVs, color attributes and material maps;
their rigid translations place the roots into the new soil. The accepted low
moss uses all original shoots and colors, with each shoot rigidly repositioned
against actual soil height. The colony footprint therefore changes. In close
views a few separated upright shoots and the crisp colony boundary remain visible.
These close-up limits were disclosed with the now-approved integration. Soil reuses
the approved
shader and 64 mm/+2 mm contact recipe with continuous adaptive ground and grit;
its topology follows the new placements rather than copying the old soil mesh.

## Scope and verification

| Measure | Retained result |
| --- | ---: |
| Paving field | 4 × 4 m |
| Stone placements / unique stone meshes | 137 / 3 |
| Longest modeled internal joint | 10/28 planning cells, about 1.43 m |
| Earlier mixed layout's longest joint | 16/28 cells, about 2.29 m |
| Stone triangles | 534,300 |
| Ground triangles, including embedded grit | 117,048 |
| Plant triangles, including moss | 54,665 |
| Total source scene triangles | 706,013 |
| Minimum conservative stone AABB clearance | 9.892 mm |
| Build, eleven captures and save | 60.35 s |

A bounded 6,000-proposal local retiling search evaluated 5,439 valid alternatives
in 6.98 s. It replaces whole stones within irregular holes, preserving exact
field coverage; the earlier rectangular-only preflight stayed at 16 cells.
The longest-joint statistic is a planning-grid measure, not artistic acceptance
or a complete description of visible near-alignments.

[Saved-source verification](cobble-study/candidate1/native-verification.json)
reopens the native file and confirms all three stone meshes/UVs/materials/packed
maps match their original portable sources. It verifies all 27 plant objects'
topology, UVs, color attributes and materials/maps against the accepted source.
Nonmoss vertex geometry is unchanged; moss relative shoot geometry agrees within
float storage precision. Roots match the intended local soil depth. Scene triangle
counts and finite coordinates were independently recomputed. Stone checks use
conservative AABBs; plant placement combines actual stone top ray samples and
conservative moss footprints. These are not full triangle collision proofs.

A [fresh representative moss transfer](cobble-study/candidate1/transfer/receipt.json)
exports the newly fitted colony and renders a fresh import. Lead inspected
[native](cobble-study/candidate1/transfer/native.png) and
[reimport](cobble-study/candidate1/transfer/reimport.png). They agree visually;
mean loaded RGB difference is 0.0000958, p99 0.003922. The GLB contains one
mesh/material, 13,260 triangles, vertex color and no textures; it is 592,504 bytes,
SHA-256 `2a9bd0005b1a9eb796572fb630691aad7cfce2305b83e0bff7b46294e82fa8d2`.
The neutral transfer floor is not the fitted terrain and does not qualify rooting.
Transfer took 8.15 s. Earlier unchanged stone/leaf transfer evidence is reused;
the failed broad-family bake is not part of this package.

The source total is below the 750,000 study ceiling, but ground and plant costs
still exceed their 8,192 / 4,000 production targets. Material/resource sharing,
LODs, compression, full QA, rights review, admission and installed-game proof remain
open. No engine/game code, production budget or QA class was changed.

## Disposition and reproduction

Preserve this human-approved smaller-stone integration baseline. Do not restart
source appearance iteration merely to remove the disclosed repetitions or joint
alignments; those refinements are optional backlog work. Next, reduce the ground
and vegetation costs, prepare shared/compressed materials and LODs, complete rights
review and QA, then verify the approved appearance in the installed game. Approval
does not waive those production checks or establish M4.5 completion.

Run `cobble-study/layout.py`, then `build.py`, `verify.py`, and `transfer.py` using
separate Blender 5.2.1 processes for the native scripts. `layout.py` also runs in
Blender's bundled Python with NumPy. Builders refuse existing output paths; keep
this evidence and redirect a replay into a new directory. `finalize.py` binds
exact consumed inputs, formats package JSON and checks its retained inventory.
The first unrendered plant-placement preflight rejected an overly conservative
grass-footprint test; actual stone surface rays resolved that technical check.
No second artistic cycle was needed for an identified integration regression.

The final inventory independently matches all 31 retained files and eight native
source inputs. Original consumed layout bytes and a byte-exact build snapshot are
retained separately from formatted JSON. Focused Biome checking passes for all
seven new JSON files; `git diff --check` passes, and Blender/PNG/GLB outputs match
the existing Git LFS rules. Pinned Node 24.18.1 / pnpm 11.12.0 `pnpm check` passes
the build but stops on the same 117 lint diagnostics outside this new package
(114 formatting, three SVG accessibility). Its unit stage does not run. Earlier
source evidence was not reformatted to clear that unrelated gate; the full
repository check remains failing. Machine-local logs are retained under
`%TEMP%/parallax-cobble-20260922/`.

Physical smoke: deferred to M4.5 exit — native views, source-preservation/support
checks and the representative moss transfer cover this source-only change.
All work is uncommitted.
