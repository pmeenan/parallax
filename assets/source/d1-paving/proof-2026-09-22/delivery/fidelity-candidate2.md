# Delivery candidate2-corrected independent fidelity screen

Disposition: retain the corrected color transfer as progress, but do not claim
complete source fidelity. Soil detail remains visibly reduced in the required
contact views. This screen is not human artistic acceptance or QA admission.

Actually inspected `candidate2-corrected` control/shared/reimport triplets for
walking, plant contact and moss contact; control/shared pairs for sunny oblique,
opposing light and overcast; and both LOD distance images.

## Corrected and preserved

Green leaf color, mottling, spots and subtle veins are restored in the large
four-leaf weed and smaller seedlings. The charcoal appearance from candidate1 is
gone. Pale grit again reads as the approved mineral contact accents. Moss keeps
its green color, leafy shoots, colony coverage and contact shadows. Stone mineral
patterns, bevels, joint layout and placements remain visually matched. Walking
and lighting overview pairs show no obvious new material regression.

The inspected fresh-import triplets introduce no additional obvious discrepancy
relative to the shared native scene. Plants and grit retain their corrected
colors. No newly obvious floating roots or colony displacement is visible.

## Remaining mismatch

`control-moss-contact.png` has fine granular soil across the exposed region
around the colony. `shared-moss-contact.png` and `reimport-moss-contact.png`
replace that with visibly broader, blurred brown mottling. The same reduction
is present around the weeds in the plant-contact triplet. Doubling the soil map
resolution improves on candidate1 but does not restore the approved fine surface
detail. It is much less noticeable in the walking and overview views; that does
not remove the required close-contact mismatch. Preserve this as a specific
unmet fidelity requirement if this package closes at its allowance boundary.

## LOD evidence limit

`lod1-distance.png` and `lod2-distance.png` retain a coherent paving patch with
readable stone courses and small green plant accents at their respective scales;
neither has obvious gross holes or broken geometry. No matched LOD0 image at each
distance was available during this inspection, so these images cannot establish
reduction fidelity or transition quality. No temporal transition, runtime render,
decoded resource identity or compression fidelity was evaluated by this screen.

## Supplemental static delivery inspection

Subsequently inspected `verification/lod0-at-1.png` against `lod1-import.png`
and `lod0-at-2.png` against `lod2-import.png`. At these matched distances, the
stone course layout, patch edge and visible green accents remain closely matched;
no obvious gross silhouette break, hole or loss of a major plant accent is visible.
This supplies the previously missing static comparison only. It does not establish
moving LOD transition quality, threshold choice or closer-distance fidelity.

Also inspected `verification/ktx-plant-contact.png` and `ktx-moss-contact.png`
against their shared native counterparts. Serialized KTX decoded to RGBA retains
the green leaves, pale grit and moss colony. Small changes in stone surface
shading/detail are visible in the moss close view, but no new large color shift
or contact failure is apparent. The existing broad, blurred soil appearance is
still present; this extra transfer does not recover the approved fine grain.
These are static Blender captures of the RGBA decode, not a qualification of GPU
BC7 sampling, mip behavior, motion, the shipping worker or in-game rendering.
