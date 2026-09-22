# Larger paving patch — 2026-09-22

The two-cycle native source study is complete. Retain candidate2 for human review,
not as a reference-complete or production-approved paving proof. The human-approved
small-sample contact and moving-light appearance remain preserved.

## Reviewable result

- [Sunny overview](patch/candidate2/sunny-oblique.png)
- [Opposing light](patch/candidate2/opposing-light.png)
- [Overcast](patch/candidate2/overcast.png)
- [Walking distance](patch/candidate2/walking.png)
- [Complete top packing](patch/candidate2/top-packing.png)
- [Plant/contact detail](patch/candidate2/plant-contact.png)
- [Editable native source](patch/candidate2/source.blend)
- [Receipt](patch/candidate2/receipt.json), [geometry audit](patch/candidate2/geometry-audit.json)

References are KIT-001 batch103, KIT-002 batch104, MAT-001/MAT-018 batch108 and
VEG-001 batch116. Native Blender 5.2.1 isolated processes preserved the live session
and staged original source. No stone material regeneration or global recoloring.

## Evaluation

Candidate1 failed both independent screens and lead inspection: bank-strip lines,
cropped framing, long seams, repeated mineral landmarks and flat pointed leaves.
Candidate2 replaces the strips with one continuous soil mesh, restores embedded
grit, frames the full field and improves leaf outlines, stems and midribs.

Both [quality](quality-patch2.md) and [theme](theme-patch2.md) reviewers inspected all
six final captures, as did the lead. Both retain it for human review with unresolved
criteria. The lead agrees: three recognizable mineral identities repeat conspicuously;
long lane-like joints remain; close foliage is visibly polygonal and too simple
against VEG-001. Scoring 80 layouts did not eliminate the longest internal seam,
which still spans the full 28-cell planning grid. These limitations are not waived
by successful structural checks. No third artistic cycle occurred.

## Measured source scope

| Item | Candidate2 |
| --- | ---: |
| Stone field | 4 × 4 m |
| Stones | 131 |
| Stone triangles | 510,900 (3,900 each) |
| Soil triangles | 65,904 |
| Grit triangles | 50,000 |
| Plant triangles | 2,768 across eight groups |
| Total triangles | 629,572 |
| Conservative minimum stone clearance | 9.850 mm |

The total is below the 750,000 study ceiling, but ground totals 115,904 triangles,
above the 8,192 substrate target. This is a disclosed source-only excess, not a
production budget change. XY stone scales span 0.892216–1.080000; Z stays 1.
Conservative stone bounds do not overlap. Plant vertices below 84 mm clear those
bounds; this does not prove triangle-interior collision freedom. Soil is a single
connected mesh with finite coordinates, no degenerate faces below the audit threshold
and no nonmanifold interior edges. Its only four boundary edges are the distant
outer square. The final build/capture took 35.27 seconds, excluding authoring/review.

Lead verified all 13 inventory file sizes and SHA-256 hashes. Native source SHA-256:
`94b392cd18cc309dc9c70a0376c9c5f4a6f0694525c1c9e74268c269c6eb5f3c`.
The staged cycle11 source/workflow still have no unstaged changes.

## Boundary and next dependency

End this bounded package with the named unmet appearance criteria above. Human
review determines the next focused revision; the technical priorities are a layout
that actually interrupts long seams, more distinct stone identities within the
existing eight-variant ceiling, and a convincing representative joint plant before
replication. Do not silently resume unlimited tuning or discard approved lighting.

The overall proof remains open. Shared materials, ground reduction/baking, raw
resource overages, the known small C transfer mark, compression, LODs, full asset QA,
rights review, admission and installed WebGPU verification remain outstanding.
RightsReviewed=false. No runtime admission, public upload or commit occurred.
