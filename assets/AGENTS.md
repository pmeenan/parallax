# assets/ — reference, generation pipeline, and asset library

AI-generated art at AAA scale fails on **consistency**, not single-asset quality. This
directory's job is to enforce consistency mechanically: reference material in, validated
library assets out. Read the root `AGENTS.md` first.

## Pipeline (every asset follows this path — no exceptions, including "quick tests")

```
reference/  →  generation (Blender agents)  →  qa gate  →  library/  →  packaging
(style      (work from reference sheets      (automated   (the only    (per-cell
 truth)      + kit specs; source .blend       checks +     source       bundles the
             kept)                            visual        engine       engine loads)
                                              review)       sees)
```

1. **Reference** (`reference/`): style bibles, palettes, character sheets, environment
   sheets per district — largely derived from Flow/concept tooling. Reference is the
   single source of visual truth; generation agents must cite which sheet(s) they worked
   from in the asset's metadata.
2. **Generation** (`source/`): Blender-agent working files (.blend) and export scripts.
   Prefer **kit-of-parts**: modular pieces, trim sheets, and shared materials per
   district kit, assembled into variety — over one-off hero assets. Hero assets are
   budgeted exceptions, listed in the kit spec.
3. **QA gate** (`qa/`): automated checks every asset must pass before entering
   `library/`. No human-or-agent judgment call substitutes for the gate.
4. **Library** (`library/`): validated, immutable, content-addressed assets with
   metadata. The engine and packaging consume only this directory.

## QA gate checks (extend this list as the gate is built; keep it in sync with the code)

- Budgets per asset class: triangle count, material count, texture resolution ceilings,
  bone count for rigs (class budgets defined in `qa/` config, versioned with rationale).
- Texel density within tolerance of the district standard; UVs: no overlaps outside
  mirrored sets, no inverted islands.
- Scale sanity against the world's metric reference (a door is a door-sized door).
- Material conformance: uses the district kit's shared materials/trim sheets unless the
  kit spec grants an exception (material proliferation is how pipeline caches die —
  see the PSO budget in docs/budgets.md).
- Naming, pivot, orientation conventions (defined in `qa/` config).
- Export integrity: valid glTF/GLB, KTX2 textures, meshopt-compressed; round-trips
  through the engine's loader in a headless check.
- Meshopt layout: exactly one glTF buffer; every compressed source and uncompressed
  buffer view references buffer 0. The QA implementation must call the engine's
  `canonicalMeshoptLayoutErrors` validator (D-089).
- LOD chain present and within reduction targets for streamable classes.
- Procedural greybox world data: the D-090 schema validator plus deterministic-generation,
  exact-cell-coverage, collision-seam, mixed-LOD-skirt, landmark, N-district packaging,
  and visible-output physical-smoke checks
  documented in `qa/README.md`; binary mesh/UV/texture checks are not applicable until
  a generated primitive descriptor is replaced by a binary asset.

## Rules

1. **Nothing enters `library/` except through the gate.** Engine and game code must
   never load from `source/` or `reference/`.
2. **Reference before generation.** No generation run without a reference sheet + kit
   spec to work from; consistency comes from shared inputs, enforcement from the gate.
3. **Library assets are immutable** — fixes produce a new content-addressed version;
   packaging manifests pin versions.
4. **Track provenance** in asset metadata: generating agent/model, reference sheets
   used, prompt/seed lineage, gate results — and **rights metadata**: license/terms of
   every reference input, the generating model's output-usage terms, and a
   rights-review flag that must be set before an asset ships in a public build. When a
   visual-consistency or rights problem is found later, provenance is how we find its
   siblings. (This includes the game-design licensing rule: nothing derived from
   D&D-protected material.)
5. **Greybox is an asset class too** — placeholder kits go through the same pipeline
   (relaxed visual checks, same structural ones), so the swap to final art (M5) is a
   library substitution, not a code change.
6. **Large binaries don't live in git.** `library/` and `source/` binary storage
   strategy (LFS vs. external store + manifest) is decision P-004 — to be made when the
   first real assets exist. Until then only reference sheets, specs, configs, and
   scripts are committed.
