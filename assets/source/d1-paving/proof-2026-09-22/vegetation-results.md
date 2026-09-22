# Varied joint vegetation — 2026-09-22

The two-cycle package retains candidate2 for human review. Broadleaf shape and leaf
color/relief improve, and grass and seedlings introduce distinct forms. Moss fails:
unobstructed native views show thin green ribbons rather than living cushions.
This is not full vegetation acceptance or a completed paving proof.

## Actual evidence

- [Close mixed planting](vegetation/candidate2/close.png)
- [Walking context](vegetation/candidate2/walking.png)
- [Full patch](vegetation/candidate2/overview.png)
- [Grass detail](vegetation/candidate2/grass-detail.png)
- [Unobstructed moss](vegetation/candidate2/moss-pocket-2.png)
- [Opposing light](vegetation/candidate2/close-opposing.png)
- [Unlit plants](vegetation/candidate2/close-unlit.png)
- [Geometry-only gray](vegetation/candidate2/close-geometry.png)
- [Gray with relief](vegetation/candidate2/close-gray.png)
- [Editable source](vegetation/candidate2/source.blend)

Four broadleaf rosettes, five seedlings, five grass tufts and four moss surfaces
occupy sparse clusters; most joints remain bare. Stone/soil mesh, transform and
material signatures match patch candidate2; camera/light comparisons also pass.
The closer walking camera is explicitly a new contextual view. No accepted paving
lighting or soil-edge appearance was reopened.

Both independent [quality](quality-vegetation2.md) and [theme](theme-vegetation2.md)
screens retain the improved source for human review, without a full pass. Lead
inspected all eleven native scene views and both transfer images. The lower leaves
have smoother outlines and restrained branching veins; regular four-leaf rosettes
still look simplified. Grass now bends and includes dry blades but remains angular
at close range. The moss representation is rejected. Its height audit shows
-0.25 to +0.75 mm relative to actual soil and no sampled vertices below stone;
thinness and the ribbon representation, rather than burial, are the evident problem.
Retain these named failures at the two-cycle boundary; no third art cycle occurred.

## Maps and representative transfer

Seven original 512-square leaf/moss color, normal, height and roughness maps are
retained. Leaf shape comes from geometry; tangent normals supply fine vein relief.
Candidate1's external basecolor incorrectly stored linear values in an sRGB PNG.
Candidate2 explicitly encodes sRGB and reloads the saved files for native use.
The center byte sample changed from 6/14/2 to 43/66/24. No scene lighting was used
to author these procedural maps.

A [representative weed export](vegetation/candidate2/transfer/representative-weed.glb)
contains 1,016 triangles, two meshes/materials and three textures, at 2,444,100 bytes.
The [native](vegetation/candidate2/transfer/native.png) and
[fresh import](vegetation/candidate2/transfer/reimport.png) retain visible color/veins.
Mean absolute loaded-pixel difference is 0.0001730, p99 0.003922. Native 2.5% subsurface
does not transfer into this standard glTF material; this limitation was not hidden.
Header/length, embedded image structure and Blender import were checked, not the
full glTF validator or engine. Export/import took 0.589/0.133 seconds; the representative
run took 8.38 seconds. Main final build/capture took 36.21 seconds, excluding authoring
and later diagnostics/reviews.

## Production boundary and next dependency

Vegetation is 6,773 triangles versus the 4,000 target; scene total 633,577 is within
750,000. The new 512-square maps exceed the existing four-pixel grass profile.
These are source-study excesses, not budget changes or QA passes. Ground's prior
115,904-triangle excess is unchanged. Lead verified all 36 frozen inventory files.
Source SHA-256: `04b251ce03a7da9eb2f16ec0df4bf5f5fe964da469dffec733ef713ef9b86297`.

Human review can judge the leaf/grass direction. Moss needs a different, independently
convincing representative construction before further scattering. Production reduction,
texture/material budget decisions, compression/LODs, rights review, full QA and
installed WebGPU verification remain outstanding, alongside the already named paving
repetition/long-joint work. RightsReviewed=false. No public upload, admission, commit
or change to staged cycle11 source/workflow occurred. Native Blender 5.2.1 was used;
game-dev CLI was unavailable and no CLI verification is claimed.
