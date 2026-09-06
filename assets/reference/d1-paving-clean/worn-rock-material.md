# Individual stone material proof

Selected on 2026-09-05 for a bounded hero-stone evaluation after the original
procedural noise material failed the courtyard quality target. This is a material
input, not an accepted paving layout or finished asset.

Source: [Worn Rock Natural 01](https://polyhaven.com/a/worn_rock_natural_01), photography
by Dimitrios Savva, processing by Rob Tuytel. Poly Haven describes weathered sandstone;
its measured surface width is 2 m. We adapt its appearance toward the limestone art
target and do not claim a measured limestone reconstruction. It has no paving joints
or embedded grass geometry; yellow lichen markings remain part of the source color.

[Poly Haven's asset license](https://polyhaven.com/license) states CC0 for its assets,
including commercial use and modification. Reviewed from the primary source on
2026-09-05. Original procedural stone geometry retains project provenance separately;
these sampled surface maps must not be labeled procedural-original or imagegen output.

The files API is `https://api.polyhaven.com/files/worn_rock_natural_01`. Downloaded
2k PNG maps were checked against the API's MD5 values; SHA-256 identities below bind
the consumed files. Machine-local sources and the API response are retained under
`harness/results/d1-individual-stones-2026-09-05/material-sources/`.

| Map suffix | SHA-256 |
| --- | --- |
| diff_2k.png | cca4c9a90319f7169274a24d09113eba3ac7a95f8be4da2df5cf2d78bf8ec2ad |
| nor_gl_2k.png | bf54d704c51f258403f82f499570005af1be936ecca5fc5289148a1bf09a13ac |
| rough_2k.png | 8055f48ebec96ac95a96bbf04a51b71d026f3b0aa1467d9df55f660c574e2aae |
| disp_2k.png | 18f7556d90ea400c180547d74caddfaf8dc6d3fd7ece9061b5544058e2a5f200 |
| ao_2k.png | b08ad1e1194aa30e3f4c77bff9821ba14906ce2a5cbf1935a11faf10649bfd45 |

Keep all maps aligned. Color correction belongs in an explicit material transform;
height comes from the supplied height map, not diffuse brightness. Any altered depth
amplitude is an artistic estimate. Do not bake directional illumination into color.
The original generated courtyard and rough-paving images remain visual references.
