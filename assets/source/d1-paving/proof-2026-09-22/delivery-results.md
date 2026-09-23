# Shared-resource delivery result — 2026-09-23

**Historical:** the [photoreal rebuild](photoreal-results.md) supersedes this source
lineage. The soil-bake follow-up below is the disposition at the time, not active work.

**Not ready for admission.** The two-cycle [delivery proof](delivery-brief.md)
produces three shared materials, three explicit detail levels and measured meshopt/
KTX2 resources. The corrected candidate preserves the approved stone appearance,
leaf color, moss and pale grit, but loses the soil's fine granular response.
Both independent screens and lead inspection reject that remaining transfer defect.
The approved `production/candidate3` remains the visual baseline, unchanged.
No runtime code, QA ceiling, library asset or installed release changed.

## Visual result

Candidate1 treated floating-point linear leaf pixels and linear grit constants as
encoded sRGB, darkening both. Candidate2 corrects that transfer, restores the leaf
normal strength to 0.6, and raises the soil bake from 2,000 to 4,000 pixels across
the patch. Leaf green/variation and pale grit return and survive a fresh GLB import.
The larger soil bake still fails the close comparison; increasing map size alone
did not close it. Do not blame compression: this defect exists before export.

Compare the actual approved-source control and corrected shared-material result:

![Approved-source soil and moss](delivery/candidate2-corrected/control-moss-contact.png)

![Shared-material soil still loses grain](delivery/candidate2-corrected/shared-moss-contact.png)

[Walking import](delivery/candidate2-corrected/reimport-walking.png) and
[leaf/grit import](delivery/candidate2-corrected/reimport-plant-contact.png)
retain the corrected overall appearance. Near contact remains the deciding failure.
See the independent [quality](delivery/quality-candidate2.md) and
[fidelity](delivery/fidelity-candidate2.md) screens, and their candidate1 counterparts.
Lead inspected walking, leaf/moss contact, fresh import, decoded KTX leaf contact
and matched distance comparisons. Agent screening does not grant human acceptance.

The [comparison receipt](delivery/candidate2-corrected/verification/receipt.json)
records full-image differences, which are diagnostics rather than acceptance thresholds.
The source/shared moss-contact mean loaded-RGB difference is 0.007119; it is visually
material despite its small whole-image average. Fresh shared/import means are
0.00000908 walking, 0.00001364 plant contact and 0.00003998 moss contact. The maximum
walking import difference is 0.494, so this is not a pixel-identical transfer claim.

## Geometry and delivery measurements

The unchanged near geometry has 137 stone placements, 32 exported shared meshes,
three materials and 27 primitives retaining `COLOR_0`. Stone meshes remain shared;
the patch does not store 137 independent stone copies. LODs are exploratory
decimation outputs, not accepted transition distances or runtime no-pop evidence.

| Detail | Unique triangles | Placed triangles | Raw geometry bytes | Meshopt bytes |
| --- | ---: | ---: | ---: | ---: |
| LOD0 | 92,901 | 615,501 | 3,852,566 | 2,213,432 |
| LOD1 | 46,323 | 307,623 | 1,944,826 | 1,174,012 |
| LOD2 | 18,382 | 122,902 | 772,372 | 478,522 |

[Compression receipt](delivery/candidate2-corrected/compression.json) verifies
every decoded geometry byte, including index order and plant colors, using pinned
meshoptimizer 1.2.0. Single cold Node decoding took 2.226/1.045/0.510 ms; these are
not worker timings or performance-budget evidence. Standard GLBs are
107,936,188 / 106,028,540 / 104,855,988 bytes because each embeds the same PNG maps.
Do not sum them as the proposed installed working set.

The nine shared maps are three 4096² limestone maps, three 4096² ground/grit maps,
and three 1024² plant maps. Full mip chains encoded with pinned KTX 4.4.2,
UASTC without RDO and Zstd level 9 total **63,718,441 bytes** (60.77 MiB), shared
across LODs. The three meshopt streams plus one shared texture set total
**67,584,407 bytes** (64.45 MiB), excluding container/placement metadata.
The corresponding BC7-sized logical texture allocation is about 132 MiB with
all mip levels, before geometry and other scene resources; this is not measured
GPU residency. Constant ORM channels and atlas occupancy leave optimization work.
These costs do not justify admitting the current candidate or raising a budget.

[KTX receipt](delivery/candidate2-corrected/ktx-receipt.json) binds serialized bytes
and their fresh RGBA decode. [Decoded-texture captures](delivery/candidate2-corrected/verification/ktx-plant-contact.png)
exercise the serialized texture conversion in Blender. They do not exercise GPU BC7
transcoding, atlas-tail mip bleeding or the game worker. Pinned Khronos validator
2.0.0-dev.3.10 reports zero errors for all three GLBs, with 32 warnings each for
runtime-generated tangent space; [full report](delivery/candidate2-corrected/validation.json).
Blender also warned about the retained grit mesh during export. Successful import
and zero validator errors do not waive cleanup/tangent qualification before admission.

## Disposition and next action

The initial allowance ends with a specific failed requirement, not a visual handoff
for approval: **recover the approved soil grain through the delivery material**.
Next isolate a small soil-and-grit coupon from the unchanged source. Compare the
procedural source against baked color/normal separately at the same physical scale,
including grazing and opposing light, to identify whether the loss comes from bake
evaluation or spatial sampling. Test a small reusable detail tile if supported by
that diagnosis; do not automatically grow the whole-patch atlas again. Preserve the
successful stone/plant sharing work. That follow-up needs its own bounded brief.

After fidelity passes, qualify explicit tangents and mip/LOD motion in pinned Chrome,
then use combined-scene cost/resource measurements to propose deliberate class
calibration. Current geometry/map ceilings, runtime vertex-color support, rights,
full QA/admission and installed-game artistic acceptance remain open. No new
platform finding is claimed for this authoring failure.

## Reproduction, provenance and checks

Run `delivery/build.py -- candidate-name` with Blender 5.2.1; it refuses existing
output paths and verifies the approved source hash. Each measured candidate keeps
its builder snapshot. `measure.mjs`, `mips.py`, `ktx.mjs`, `verify.py` and
`validate.mjs` provide source-only compression, comparison and structural checks.
Measurement intermediates live under ignored `harness/results/paving-delivery-*`.
An accidental duplicate launch ran the old builder after a shell edit failed; it was
stopped and moved to session scratch, not counted as a new visual candidate.

The two builds/capture/export/import passes took 109.7 and 128.0 seconds respectively;
analysis, tool setup, compression and visual screening are additional work. No new
kit piece was accepted. Existing source/reference provenance and pending public-build
rights carry forward; no provider job, new image generation or rights grant occurred.

Focused scripts, receipt identities, structural validation, scoped lint and whitespace
checks accompany the handoff. Pinned `pnpm check` passes the build and stops at the
same 117 pre-existing lint errors outside this package; its unit stage does not run.
No green repository-check claim is made. Physical smoke: deferred to M4.5 exit —
source captures, compression roundtrips and export checks only. Changes remain
uncommitted for human review; creative outputs follow existing Git LFS attributes.
