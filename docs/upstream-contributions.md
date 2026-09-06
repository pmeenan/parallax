# Upstream contribution ledger

Local integration changes that are plausible upstream pull requests. Entries record the
exact upstream pin, the local regression evidence, and the smallest upstreamable change.
They are proposals until a PR URL replaces the status; do not imply that upstream has
accepted them.

## UP-004: Keep wasm-bindgen thread scratch state outside Rust's allocator region

- **Upstream pins:** wasm-bindgen / wasm-bindgen-cli-support 0.2.127 and Rust
  nightly-2026-07-16's dlmalloc 0.2.13. Upstream
  [PR #5225](https://github.com/wasm-bindgen/wasm-bindgen/pull/5225) shipped in 0.2.127.
- **Local integration:** the binary-rewrite workaround is removed. The deterministic
  build now verifies upstream's exact counter, lock, and temporary-stack placement in
  the appended page, rejects the old allocator-overlapping addresses, and fails on
  layout drift in the optimized shipped module.
- **Upstream resolution:** the threads transform now reserves its internal page after
  the module's original initial memory, outside Rust dlmalloc's linker-visible heap.
  The upstream regression covers threaded allocation during startup.
- **Regression fixture:** Parallax's 12,391-byte threaded module, two module workers,
  one 33-page shared memory, 64 KiB follower stack. The unrelocated artifact
  intermittently ends at `initialization=2, instances=2, allocatorLock=43`; the
  fixed artifact must report `2/2/0` and complete both workers' tasks.
- **Status:** resolved upstream in wasm-bindgen 0.2.127; Parallax's local relocation is
  removed. The M3-exit physical smoke is the final local adoption evidence.

## UP-001: Publish an ESM browser factory from `draco3dgltf`

- **Upstream pin:** Google Draco
  [`draco3dgltf` 1.5.7](https://github.com/google/draco/releases/tag/1.5.7).
- **Local integration:** the render-worker Rollup plugin strips the wrapper's CommonJS/
  AMD trailer, exports `DracoDecoderModule`, and changes its ESM-invalid top-level `this`
  probe to explicit `globalThis`. Parallax injects verified WASM bytes into the factory;
  it does not modify installed package files.
- **Upstream proposal:** ship the glTF decoder factory as a supported ESM export with a
  browser-worker entry point and typed `wasmBinary`/`locateFile` options. Retain existing
  CommonJS artifacts for compatibility.
- **Regression fixture:** Khronos glTF-Sample-Assets `Models/Box/glTF-Draco/Box.bin` at
  commit `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`, SHA-256
  `610dc6e08aba7c2720c8e4ec0578efd91cf2d88a5e638dab7811a22f0235bf2e`;
  the module worker must decode a non-empty mesh without DOM or `importScripts`.
- **Status:** candidate patch; not filed.

## UP-002: Publish the MSC Basis transcoder factory as ESM

- **Upstream pin:** [`@babylonjs/ktx2decoder` 9.17.0](https://github.com/BabylonJS/Babylon.js/releases/tag/9.17.0).
- **Local integration:** the render-worker Rollup plugin strips the generated wrapper's
  CommonJS/AMD trailer and exports `MSC_TRANSCODER`; Parallax assigns it to
  `MSCTranscoder.JSModule` and self-hosts every selected transcoder WASM artifact.
- **Upstream proposal:** export the MSC factory from the package and document direct
  `JSModule` injection for module workers, so consumers need neither a classic-script
  build transform nor the `document`/`importScripts` fallback.
- **Regression fixture:** Khronos glTF-Sample-Assets
  `Models/CarConcept/glTF-KTX-BasisU-Draco/Dot_C.ktx2` at the same commit, SHA-256
  `08968e9d7d9855ae8d201cfaea889e2748fc9049a95838aa18ce689d29c041ca`;
  expected decode is 128×128 through `MSCTranscoder` in a module worker.
- **Status:** candidate patch; not filed.

## UP-003: Add first-class decoder injection to Babylon Lite loaders

- **Upstream pin:** [`@babylonjs/lite` 1.12.0](https://github.com/BabylonJS/Babylon-Lite/releases/tag/npm-lite-v1.12.0).
- **Local integration:** Parallax preinstalls `DracoDecoderModule`, `KTX2DECODER`, and
  `MeshoptDecoder` globals before any asset load. This deliberately prevents Lite's
  loader branches from reaching `document.createElement` in a module worker.
- **Upstream proposal:** add typed factory/module setters for all three decoders and a
  module-worker fixture. Preserve global lookup as a compatibility path, but fail with a
  worker-specific diagnostic instead of referencing `document` when injection is absent.
- **Regression fixture:** UP-001 and UP-002 fixtures plus meshoptimizer 1.2.0's pinned
  85-byte vertex-buffer vector. On 2026-09-05, Chrome 152.0.7977.54 loaded a canonical
  meshopt + KTX2 GLB through unpatched Lite's public `loadGltf` in a module worker
  using the existing bootstrap: one entity, no GPU validation error, no CDN request.
  This verifies asset loading, not visual acceptance or every glTF extension.
  [Evidence and reconstruction](../harness/results/upstream-lite-loader-2026-09-05/summary.md).
- **Status:** not filed. A [minimal diagnostic draft](../harness/results/upstream-lite-loader-2026-09-05/worker-diagnostic.patch)
  adds actionable missing-global errors to three exact-pin loader sources. It has
  not been exercised as a patched upstream build and does not implement the proposed
  typed setters. The existing injected path needs no compatibility shim.

The local `canonicalMeshoptLayoutErrors` gate is intentionally project policy rather
than an upstream patch: Babylon Lite's loader explicitly supports only canonical
single-buffer GLB today, and Parallax's future asset QA gate is required to reject
noncanonical exports before runtime.
