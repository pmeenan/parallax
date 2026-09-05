# D1 paving — scanned source comparison, acceptance pending

This is a Blender **5.1.2 source comparison**, not accepted art or an admitted
library/runtime asset. It evaluates Poly Haven's
[cobblestone_pavement](https://polyhaven.com/a/cobblestone_pavement), by Charlotte
Baglioni, under [CC0](https://polyhaven.com/license). Exact downloaded map hashes,
source scale and rights provenance are in [`provenance.json`](provenance.json).
Download map URL template (replace `{map}` with `diff`, `disp`, `nor_gl`, or `rough`):
`https://dl.polyhaven.org/file/ph-assets/Textures/png/2k/cobblestone_pavement/cobblestone_pavement_{map}_2k.png`.
Match the downloaded bytes to the recorded SHA-256 before use.
The original [courtyard reference](../../reference/d1-courtyard-sunny-gloomy.png)
remains the human-endorsed quality benchmark; no reference or kit dimension changed.

## Comparison outcome

The two initial procedural cycles failed visual inspection: regular bevels and
smooth slab surfaces looked manufactured, with implausibly deep empty joints.
Their exact scripts and previews remain in ignored local evidence; the failed
procedural generator is removed from the active source tree.

One recorded 30-minute extension evaluated the scanned material. Inspection of its
diffuse/height inputs and sunny, gloomy and grazing Blender renders found more
credible mineral variation, worn grain, chipped boundaries and filled joints. It
is a materially better source candidate. **Suitability remains unaccepted:** the
scan is darker, smaller-set weathered cobblestone, not declared pale limestone;
the grazing view still reads rather flat under the restrained displacement.
The render does not demonstrate the complete courtyard's reference quality.

The full source scan covers **2.5 × 2.5 m at UV 0–1**, preserving the documented
physical scale. This differs from the proposed 2 m kit panel. A 0.8 UV crop would
not itself be repeatable at panel edges; neither a kit change nor modular seam
acceptance is implied. Source geometry is Blender Z-up.

Actual mesh displacement uses a 15 mm full-range scale; sampled LOD0 relief spans
8.61 mm (Z 0.105829–0.114439 m). OpenGL normal strength is reduced to 0.35 to limit
duplicated relief; this is a preview compromise, not a completed frequency-separated
bake. Color is sRGB; roughness, normal and displacement are Non-Color data.

The three **unqualified source** grids contain 73,728 / 18,432 / 1,152 triangles.
The dense grids exceed the proposed kit budget and are for source comparison only.
LOD appearance, export topology and transitions have not been qualified.

## Evidence and reproduction

Inspect the [sunny preview](../../../harness/results/d1-paving-2026-09-05/scanned-comparison/paving-sunny.png),
[gloomy preview](../../../harness/results/d1-paving-2026-09-05/scanned-comparison/paving-gloomy.png),
and [grazing preview](../../../harness/results/d1-paving-2026-09-05/scanned-comparison/paving-grazing.png).

All binaries remain under ignored `harness/results/d1-paving-2026-09-05/`:

- Initial failed cycle: root `generate-cycle-1.py`, `.blend`, three previews and report.
- Failed cycle 2: `cycle-2/generate-cycle-2.py`, `.blend`, previews and report.
- Scan inputs: `scanned-input/`, four verified 2048×2048 PNGs.
- Current comparison: `scanned-comparison/`, `d1-scanned-source.blend`,
  `paving-sunny.png`, `paving-gloomy.png`, `paving-grazing.png`, `source-report.json`,
  and `evidence-inventory.json` binding generator, provenance, reference and output
  bytes. Exact generator/provenance snapshots are retained there too.

Current generator SHA-256:
`8009ba7ade7f92264287b13f8d7cac836608945bba5a5cd1327e3157905e14ef`.
The source report records Blender version, bounds, topology and timings.
Construction took 1.24 s; three CPU renders took 28.13 s; full script took 29.38 s
(8 threads, Cycles 48 samples, 1280×1024). These are source-preview timings,
**not runtime performance**. The earlier cycles took 36.18 and 32.87 s.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --threads 8 --python-exit-code 1 --python assets/source/d1-paving/generate.py -- --input harness/results/d1-paving-2026-09-05/scanned-input --output harness/results/d1-paving-2026-09-05/new-scanned-attempt
```

Use a fresh result directory for another authorized attempt. The script verifies
all input hashes/dimensions and confines output to this checkout's results tree.
The `.blend` retains external image links to the local input folder. No canonical
package or public distribution is implied.

Before production: decide suitability, settle 2 m kit mapping/seams, derive a
budgeted mesh/LOD representation, qualify material normals and UV density, encode
KTX2/meshopt, activate asset QA, resolve P-004 storage, round-trip through the
shipping worker and obtain human scene acceptance. No library admission, runtime
integration, QA pass or no-visible-pop claim has been made.
