# Current restored-family export evidence

Three fresh 3,900-triangle stones were baked and reimported from the corrected
restored-family source. The isolated studios contain only the target stone, neutral
ground, light and camera. Approved source geometry and soil remain untouched.

| Member | Raw GLB bytes | Sampled source-to-low p95 | Native/import pixel mean |
| --- | ---: | ---: | ---: |
| A | 10,157,440 | 0.537 mm | 0.000000881 |
| B | 10,502,016 | 0.476 mm | 0.000000797 |
| C | 10,957,176 | 0.555 mm | 0.000001036 |

All have one mesh/material, embedded buffers, standard base color/roughness/normal
channels, finite positions and UVs in the unit square, and closed manifold low meshes.
Pixel p99 is zero for each matched native-low/fresh-import pair. These are narrow
checks: sampled distances are not maximum-error guarantees and near-identical imports
do not prove that the reduction preserved all high-source detail.

The three-member native run took 116.17 seconds. Base color and normal are 2048²,
roughness 1024². Each member has high-source, native-low, fresh-import and matched
opposing-light source/import captures. Lead inspected all three comparison sheets
and selected full-size pairs; broad mineral identity survives with silhouette and
fine-detail simplification. Independent screen disposition is recorded below.

Both [quality](quality-transfer.md) and [theme](theme-transfer.md) give a conditional
visual pass for source-only transfer and the 4 m repetition study. Main mineral
identity and opposing-light response survive. They record smoother small chips,
more planar corners and a small dark angular top mark in C's opposing-light import
that is not evident in the corresponding high source. Lead also observed that mark.
It is a localized suspected bake/shading artifact, not a proven mesh hole; resolve
it before final delivery. No broad normal inversion or color-transfer regression was
identified. These findings do not grant human artistic or production QA acceptance.

## Evidence

[A comparison](transfer/a-comparison.png), [B comparison](transfer/b-comparison.png),
[C comparison](transfer/c-comparison.png), [author report](transfer/author-results.md),
[measurements](transfer/results.json), [file inventory](transfer/file-inventory.json).
Editable low studios and GLBs are retained in transfer/a, b and c alongside their
maps and resolved bake/verification scripts. Lead independently verified all 49
inventory hashes. The original restored-family source hash remains unchanged.

## Remaining delivery requirements

Every raw GLB exceeds the existing 8 MiB resource ceiling. Three separate stone
materials plus soil/plants also require shared-material work. No compression,
LOD chain, full UV/texel-density validation, full QA, rights clearance, library
admission or installed WebGPU test is claimed. No budget has been changed.

The next source dependency is the 4 m repetition/assembly with sparse joint plants;
these exports provide current reduced assets for that check. Shipping packaging
and installed-engine evidence remain separate requirements. Work stays uncommitted.
