# Leaf color refinement — 2026-09-22

Human feedback: vegetation looks better, but leaf color remains too uniform. The
human authorized the proposed continuation: lighter new growth, darker mature
leaves, subtle interveinal mottling, occasional faded margins and small blemishes,
with variation both within and between leaves. Most surface stays healthy; avoid
uniform random speckle, harsh hue shifts or exaggerated painted vein shadows.

Reference VEG-001 batch116; baseline vegetation/candidate2. Color-only package:
preserve geometry, normals, roughness, stone/soil, camera and lighting. Existing
moss, grass-shape, paving-layout and production-budget limitations stay separate.
Use native Blender 5.2.1 and original authored texture/leaf color variation, explicit
sRGB encoding followed by reload. Preserve original files and live Blender session.

Two artistic cycles maximum, 30 active / 45 elapsed minutes. Inspect actual matched
close, opposing, unlit and walking views. Both independent screens and lead inspect
before a second cycle. Check representative export/reimport retains within-leaf
and between-leaf color; native-only random tint is insufficient. Retain editable
source, maps, geometry/preserved-channel checks, provenance, hashes and timings.

Finish with a human-reviewable color revision or named unmet criteria. Existing
512-square source map and vegetation triangle excesses do not become production
passes. No new budget change, QA admission, engine acceptance or rights clearance.

## First cycle disposition

Both screens and lead find modest improvement only: a warmer front leaf and darker
upper leaf, but within-leaf variation remains too faint and faded margins unreadable.
Use the second/final color cycle for clearer broad interveinal variation and partial
faded margins on a minority of leaves, keeping most healthy and preserving vein relief.

First transfer exposed wrong exported color-layer selection and lost common shader
gain. The equivalent technical correction selects LeafAgeTint as COLOR_0 and moves
common gain into the color map. Corrected transfer retains intended relative colors;
final candidate must repeat this check. Native lighting and geometry are unchanged.

## Final disposition

[Candidate2 results](leaf-color-results.md) retain clearer within-leaf variation
and verified representative color transfer for human judgment. Both screens agree
on improvement; age/faded-margin differences remain restrained. Both cycles complete.
