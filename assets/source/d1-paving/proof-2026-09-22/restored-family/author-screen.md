# Restored family author screen

All five matched views and the unlit joint diagnostic inspected. The restored
material recovers substantially richer gray/cream mineral regions and pore/grain
identity on all three stones. B/C retain the screened family's remapped broad
placement and existing relief rather than reusing A's unmodified full pattern.
Geometry, object transforms and soil are exactly preserved from family-contact2;
neither sidewall1 nor sidewall2 was consumed.

This restores the better original material baseline. It does not remove original
generated pore lighting: the unlit image still contains strong shaded-looking pore
structure. The smooth exposed sidewall and its dark band remain. Source-only,
rights-unreviewed, and awaiting independent screens and human artistic acceptance.

A numerical Blender5.2.1 fixture caught a color-space implementation error before
final screening: a known128byte sRGB PNG returns0.5019608 from Image.pixels, not
linear0.2158605. B/C raw RGB is therefore explicitly decoded before the exact family2
remap and stored in generated float Non-Color images. Early invalid pale captures
were replaced after that correction; this was not an additional artistic iteration.
The retained verify_color.py reproduces the check.

Build.py appends the original cycle11 material, asserts image-node roles, preserves
the existing B/C height/macro images, imports only the exact pixels/remap/packed
helpers from family/build_family2.py, and packs image dependencies. It records before
and after geometry/transform identities, input/output hashes and seeds787/829. The
unlit override is reset before saving the editable source.
