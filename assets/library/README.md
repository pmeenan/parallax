# Generated library outputs

Generated library binaries and cell bundles do not live in git (assets rule 6 / D-186).
`d1-paving.json` binds the admitted photoreal paving module (`d1-photoreal-paving`, a
periodic 4 m surface module); ignored `objects/` contains its immutable hash-named GLBs,
meshopt streams and KTX2 maps. The build rechecks all hashes and packages 26 runtime
resources through the ordinary install index. The ground, pebble and plant parts each have
three LODs, with vertex and index streams per LOD, and share eight maps. Three canonical
GLBs complete the 29 immutable library objects. They remain export evidence and are not
duplicate runtime bytes. Every texel and vertex is procedural-original project output
([provenance](../source/d1-paving/proof-2026-09-24/provenance.json)). Admission does not
grant final artistic acceptance of installed game views.
For D1 greybox v1, `pnpm build` validates the generator and emits one immutable,
content-addressed JSON bundle per cell plus a content-addressed district index under
`dist/immutable/`. The build manifest classifies the index as `game-specific`.

Only those validated build outputs are loadable package artifacts; files under
`assets/source/` are provenance metadata and are never runtime inputs.
