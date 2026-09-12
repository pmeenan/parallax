# Batch 001 — coastal village direction

Status: B selected by the human; follow-up views open. Target: **DIR-002** (P0). Input: the
[endorsed courtyard](d1-courtyard.md), used for quality/material language only.

## Brief and allowance

Resolve how the coastal village can retain the anchor's photorealism, bright color
and human scale across distinct architectural treatments. Planned sequence: A sunny,
A overcast, B sunny, B overcast, C sunny, C overcast. Alternatives explore plaster-led,
timber-led and limestone-led construction within the same cream/oak/terracotta kit.
Each is a proposed street composition, not a change to authored world coordinates.
Eye-level target: 1.7 m, roughly 55-degree horizontal field of view; all image-derived
dimensions remain unmeasured. No invented geography, mechanics or lore.

Initial allowance: six images, at most two generation/review passes per image,
90 minutes active work; generation waiting recorded separately. Stop at this batch's
human direction-selection checkpoint before producing dependent target families.
An unresolved blocker stops its paired continuation; document any revised queue.

## Sequential first-pass review

For **each** generated image, save the original and exact prompt, then have subagents
visually inspect it before another generation call. One reviews theme, established
world constraints and consistency against the anchor and prior batch images. Another
reviews photoreal quality, construction, materials, human scale and gameplay readability.
The lead consolidates their findings and records pass-for-human-review, revise or reject.
Resolve must-fix defects through the remaining pass before moving on; a rejected result
cannot become a continuity reference. Agent passes never mean human artistic approval.

Review sunny/overcast pairs for camera and geometry drift; generated correspondence
does not prove runtime relighting. Distinguish an attractive direction reference from
a modeling sheet or exact physical specification. Keep unfulfilled DIR profile views
and rights clearance open in the target record.

Must-fix: cartoon/toy forms, uniformly gray/brown daylight, implausible load paths,
blocked walking route, incoherent doors/roof joins, contradictory castle placement,
or weather-dependent architecture. Keep wear localized, joints credible and planting
restrained. The castle remains on the central hill with village outside its complete
moat; absence of a visible moat at street level does not establish its footprint.

Review configuration: initial reviews through A overcast v1 used GPT-6 Astra at
medium thinking, inherited from the parent task (verified in its session record).
Human-authorized override now uses **GPT-6 Astra at low thinking**, with fresh compact
reviewer briefs. Keep both roles and the per-image gate; request concise findings,
and focus rechecks on the defect plus visual regressions. Watch for missed defects
or superficial screening; no equivalence to medium is assumed or claimed.

## Queue revision after A overcast's allowance

Both overcast attempts retain paving/wear drift and are rejected as matched pairs.
At the two-pass boundary, defer further relighting attempts until human selection of
the sunny direction. Finish B sunny and C sunny; move B/C overcast and the unresolved
A matched-state requirement to the next selected-direction batch. This avoids paying
for weather variants of discarded directions. It does not waive paired-state coverage
or complete DIR-002. No allowance extension is being taken. Final review package:
three sunny alternatives plus the visibly rejected overcast examples and open gap.

## Results

[Comparison board](concept-art-batch-001-review.md): A sunny v2, B sunny v1 and
C sunny v2 pass both first-pass reviewers and lead inspection. Seven originals were
generated, including three correction attempts. A sunny v1 and C sunny v1 are
superseded; both A overcast attempts are rejected as matched-state references.
No image exceeded two passes. Originals, exact prompts, hashes, input lineage and
critiques are in [DIR-002](targets/DIR-002.md). The human subsequently selected B for
character and quality, with flame-only lamps; A's plaster and C's pristine/high-end
walls and gutter treatment are not selected. Preserve B's weathered character in
follow-up views. Rights remain pending; B's gloomy and construction/lamp details are
next. No further weather variants of A/C are needed for direction selection.

Generation tool waiting: approximately **268 seconds** across seven calls, separate
from active work. Active session remained within the 90-minute allowance; no precise
active-only stopwatch or token-cost comparison was collected. The low reviewers caught
the known overcast defects and the insufficiently distinct C v1; this limited observation
is not a controlled demonstration of equal screening effectiveness.

Verification: PNG dimensions/model metadata and all seven SHA-256 hashes inspected;
linked originals retained. `pnpm check` passed (build, lint, 216 test files;
2,662 tests passed, one skipped). Subsequent changes are reference Markdown and PNGs,
with no built/runtime/gate inputs changed. Physical smoke: deferred to M4.5 exit —
visual reviews and artifact/provenance checks cover this reference-only work.
