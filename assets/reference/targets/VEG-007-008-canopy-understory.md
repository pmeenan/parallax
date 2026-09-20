# VEG-007 / VEG-008 — canopy tree and forest understory

Status: B1 human-approved. A2 human-rejected for synthetic appearance; fresh A3 passes both realism screens/root, A3 human-approved.
[Brief, exact prompts and receipts](../concept-art-batch-118.md).

Built-in imagegen with the approved Batch072 forest clearing as sole raster style
reference. New views establish plant appearance and placement, not new geography.
Independent quality/construction and theme/consistency reviewers use GPT-6 Astra /
low and inspect actual images, followed by root adjudication. Seed/model version
unavailable; rights/terms review pending public shipping. No library admission.

## A — canopy tree

Full crown, trunk, branching and root flare at a clearing edge, with nearby path
kept open. Natural irregular broadleaf tree rather than a magical landmark.
[A1 original](../concepts/batch-118/veg-007-forest-canopy-tree-v1.png):
SHA256 `1b30c61bc326844ff421b9d820c770bdc3825f42cc304bbb606984c757873106`,
1536 × 1024, 3,919,246 bytes. Root inspection: convincing trunk/root flare and
irregular branching, but crown reaches the top edge and lacks required margin.
Both reviews FAIL for that framing defect; second allowed pass pulls view back.
No exact species or scale inferred.

[A2 current candidate](../concepts/batch-118/veg-007-forest-canopy-tree-v2.png):
SHA256 `2e0476b5eeeae19746748c415b37b46dad39a53c11450a3086e0695b04248b22`,
1536 × 1024, 3,518,634 bytes. A1 is the sole edit target. Root PASS: full primary
crown and root base are visible with sky/lateral margins, coherent broad branching
and a clear adjacent path. Roughly 80% frame height instead of the prompt's 75%
suggestion; the actual full-silhouette requirement is met. No exact pixel-preserved
geometry claimed. Quality PASS and theme PASS: full silhouette clearance, retained
branching/material character, ground contact and open path. Lower crown overlaps
background foliage, making some outer twigs less distinct. A1 retained as rejected
framing provenance only. Subsequent human rejection supersedes A2's agent passes:
repeated leaf clusters, sculpted branching/roots, coarse uniform bark and staged
golden lighting. Both reviewers and root acknowledge the missed whole-image quality
problem. A2 is rejected provenance only. B1 is human-approved.

[A3 human-correction candidate](../concepts/batch-118/veg-007-forest-canopy-tree-v3.png):
SHA256 `84affe51fa52210755a52084230d4b51bf053306fcfa353d441b6f9d5cf27b81`,
1312 × 1199 native pixels, 3,356,266 bytes. New text-only generation, no prior
raster attached. Root sees a substantial realism improvement: finer layered foliage,
irregular partly obscured branches, subtler bark, mostly buried roots and ordinary
overcast daylight. Different tree/composition, not an exact A2 recolor or relighting.
Upper margin is narrow and right crown overlaps neighboring foliage; no claim of
an isolated silhouette or exact branch/leaf anatomy. Quality PASS and theme PASS:
the whole image reads plausibly photographic and resolves A2's sculpted appearance.
Residual similar star-shaped arrangements in some outer leaf sprays, plus narrow top
margin and right crown/background overlap. A3 human-approved; one of two
human-correction passes used.

## B — understory and litter

Sapling, ferns, supported fallen limb, leaf litter and limited moss beside clear
earth path. Sparse varied dressing with coherent anatomy and substrate contact.
[B1 original](../concepts/batch-118/veg-008-forest-understory-v1.png):
SHA256 `7256816c63b78cb1f4ca8bdc8fcbcdb11798b53b4f7dff00706626d6628069fb`,
1536 × 1024, 3,938,039 bytes. Root inspection: readable sapling/fern attachment,
grounded broken limb and open path. Leaf litter is dense at the verge, appropriately
sparser in the walking strip. Both reviews PASS: natural varied grounded plants,
limb and litter. Residuals: foreground fern cropped; exposed splintered wood is
unusually clean/bright against weathered bark, compatible with a recent break but
no age or decomposition behavior established. Sapling is not asserted
to be the same botanical species as A. No new gathering species/interactions.

## Remaining coverage

Additional family silhouettes, close branch/leaf/root views, neutral and varied
lighting, metric scale, seasons, wind, recovery, decomposition and applicable
interaction/LOD behavior remain open. These stills are not runtime validation.
