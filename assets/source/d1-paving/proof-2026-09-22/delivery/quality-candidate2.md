# Corrected delivery candidate2 independent quality screen

Screened 2026-09-23. Actual control/shared/reimport walking, plant-contact,
moss-contact and grazing PNGs in `candidate2-corrected` were opened and inspected
(twelve images). The criterion remains preservation of approved production/candidate3,
not a new artistic assessment of the source.

**Disposition: substantial correction, but soil fidelity still fails.**

The broad leaves again retain the control's green variation, pale veins and small
warm flecks. The pale grit accents are restored. Both improvements survive the
fresh import in the inspected images. Moss form, green color, plant placement,
stone mineral pattern and stone silhouettes show no concrete new defect in this
screen. Walking and grazing are visually close to their controls, without the
previous conspicuous charcoal foliage/grit.

The unresolved mismatch is **loss of fine soil grain in both contact views**.
The corrected shared and reimport moss-contact views retain broad brown mottles,
but these remain visibly blurred compared with the control's granular surface.
The open soil around the colony and the foreground pale grit provide clear
matched comparison regions. Plant-contact similarly loses fine texture along
the open joint below the main plant and around the lower-left seedling. This
was not resolved by the stated resolution increase. It is already present in
the shared render and persists through reimport, so the screen does not identify
an additional import-only cause. Rooting and soil geometry are not the finding.

No additional shared-to-reimport mismatch is apparent at the inspected display
scale. That is a visual observation, not an exact pixel or geometry guarantee.

At the two-cycle boundary, retain the corrected outputs as evidence and record
the specific failed soil-fidelity requirement. Further implementation requires
an explicit bounded extension or a later reopened proof; the completed allowance
does not convert the remaining regression into acceptance. Keep approved art
unchanged. Other lighting states, LODs, compression and engine/runtime qualification
are outside this screen.

## Supplemental static LOD and decoded-texture screen

Opened and inspected `verification/lod0-at-1.png` against `lod1-import.png`,
and `lod0-at-2.png` against `lod2-import.png`. At these matched static distances,
the patch outline, stone/joint layout, material identity and visible green accents
remain visually consistent. No conspicuous new LOD defect is apparent at the
displayed scale. Small edge/detail differences are not qualified for transition
behavior by these stills; motion and LOD popping remain untested.

Also opened `verification/ktx-plant-contact.png` and `ktx-moss-contact.png` and
compared them with the already inspected shared contact images. Green leaves,
veins, pale grit and moss retain the shared candidate's visible appearance; no
additional conspicuous decoded-texture regression is apparent. The same blurred
soil remains, so this does not change the failed-soil disposition. These are
static Blender renders using decoded texture evidence, not a Chrome/WebGPU BC7
runtime, motion or production-loader qualification.
