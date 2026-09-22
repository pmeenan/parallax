# Candidate 3 author screen

All seven native views inspected against KIT-002 batch104 v4 and MAT-001 batch108.
This is the strongest of these three corrections: continuous gray/tan/cream tones
and compressed source color restore richer mineral interiors and lose much of the
binary painted-map appearance. Geometry is unchanged from candidate2, including the
visible broad corner facet and quieter top plateaus.

The unlit pass is not a clean intrinsic reflectance recovery. Continuous shading-like
transitions remain in the scalar-driven palette, and the original albedo now supplies
bounded chroma/luminance modulation. Original sharp pore lighting is strongly reduced,
but not proven eliminated. At grazing view the side relief still appears uniform and
the material is softer than cycle11/reference. Do not claim completion of the clean
reflectance requirement or final reference match. Independent screens and lead decide
whether this tradeoff is viable; no bake/family expansion has been performed here.

The exact modulation retains55percent of clipped chroma deviations, lowpass luminance
contrast at0.55, and highfrequency luminance deviation at0.12 capped to±0.8 before
scaling (thus at most±9.6percent from that term alone). Combined modulation is clipped
to0.78–1.20 before chroma. This is an artistic compromise, not recovered physical data.

Third stone cycle, fifth overall meaningful proof cycle per lead. Stop at this
candidate; do not silently restart the allowance. Original cycle11 remains available
as the materially richer baseline if the lead rejects this result.

Reproduction: isolated Blender5.2.1 background factory-startup, python-exit-code1,
`stone/build_candidate3.py`. Packed editable source scene `Paving proof stone candidate3`,
object `Paving proof stone candidate3 master`, material
`Original limestone correlated surface cycle103 seed713`. Seven renders use the same
native128sample Cycles/AgX camera/light profile as cycle11, no image edits.
