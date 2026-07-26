# Dependency currency

The operating policy for keeping Parallax's versioned external inputs current without
giving up exact builds or silently changing measured behavior. D-079 governs; D-020's
exact-pin and reproducibility rules remain unchanged.

## Scope and cadence

The source-of-truth inventory is every pin selected by repository configuration or code,
not just package manifests: package manifests/lockfile, `.nvmrc`, browser pin files,
embedded model IDs/revisions/artifact hashes, decoder URLs/assets, and future Rust
toolchain/crate manifests. Start from the prior ledger, then search the repository for
version, revision, digest, and remote-artifact constants and confirm their live consumers;
do not maintain a second hand-copied version inventory here.

A **full currency checkpoint** is required:

- at the start of every milestone;
- every 28 calendar days while a milestone is active, whichever comes first.

A **targeted currency review** is required:

- when a recorded deferral recheck date or trigger becomes due; and
- immediately for a credible security advisory or a release that credibly fixes or
  unblocks an issue affecting planned or implemented work.

Every full checkpoint also reviews the **Tracked upstream workaround removals** table
below. A matching upstream release triggers a targeted review immediately rather than
waiting for the next 28-day checkpoint.

One full checkpoint may satisfy both a milestone exit and the immediately following
milestone entry when both happen in the same transition change. A targeted deferral or
advisory review does not reset the 28-day full-repository cadence unless it actually
covers the full inventory.

Every full checkpoint reviews all direct dependencies and versioned external inputs, plus
transitive packages implicated by advisories or release notes. "Review" does not mean
"upgrade to latest": every candidate ends as **adopted**, **deferred** with evidence and
a recheck trigger/date, or **not applicable**. Exact pins move only in reviewed change
units; no floating ranges, unattended lockfile refreshes, or automatic merges.

## Risk tiers and required gates

| Tier | What belongs here | Upgrade gate |
| --- | --- | --- |
| Runtime/platform critical | Rendering and asset runtimes (Babylon Lite); AI inference runtimes, model/tokenizer/chat-template pins; compression decoders; storage/crypto libraries; Chrome/CfT; future Rust/WASM runtime crates | One component family per change. Read upstream release/migration/security notes, audit affected local APIs and capability gaps, run `pnpm check` and engine repeatability, then run the relevant physical harness and subsystem fixtures against old and new pins. Keep budgets unchanged; record measured regressions as well as wins. |
| Build and measurement critical | Node, pnpm, TypeScript, Rollup, esbuild, Vite, Playwright, Biome, Vitest, future Rust toolchain/wasm-bindgen/binaryen, deployment and measurement tools | Exact-pin change with `pnpm check`, repeatability, and the harness contract tests. Run a physical smoke when emitted bytes, browser launch/trace behavior, serving, or measurement semantics can change. Tool upgrades that change a result schema or baseline require the corresponding docs/decision update. |
| Development/supporting | Types-only packages and tooling that cannot affect shipped artifacts or measurement semantics | May be batched when the diff remains bisectable; exact pins, `pnpm check`, and repeatability are still mandatory. Escalate to a higher tier if emitted artifacts or harness evidence change. |
| Transitive | Lockfile-only packages not directly selected by Parallax | Review through the owning direct dependency. Update independently only for a concrete advisory/bug, with the owning subsystem's tier gate; never refresh the lockfile merely to make it newer. |

An upgrade is not accepted merely because tests compile. Runtime/platform-critical
changes must preserve the relevant worker topology, telemetry identity, feature floor,
and milestone fixtures. Performance-sensitive changes use the same scenario and
registered machine for the before/after comparison; a budget bust is handled through
the normal decision process, never by weakening the check.

## Review procedure

For a full checkpoint, perform every step. A targeted review applies steps 2-6 to the
affected component family and does not reset the full-checkpoint clock.

1. Enumerate current exact pins from every configuration/code source described above and
   query current supported releases and advisories from official sources.
2. Read release and migration notes across the full skipped range. Identify API,
   artifact-format, browser-feature, worker, storage, threading, and measurement changes.
3. Classify candidates by the tiers above. Record deferrals before starting upgrades so
   "no diff" cannot erase the review result.
4. Upgrade one runtime-critical component family at a time. Preserve an old-pin build or
   result artifact long enough to run the required same-scenario comparison.
5. Run the tier gate and any milestone-specific fixtures. For Babylon Lite this includes
   the render-worker `smoke@1` gate and, as they exist, M1 compressed assets and M3
   character animation. D-098's closed P-002 native-interop fixture is not a recurring
   gate; a future native consumer must add its own decision-specific proof.
6. Update architecture, plan status, budgets, findings, and decisions in the same change
   wherever behavior or constraints moved. Update the ledger below even when every
   candidate was deferred.

## Tracked upstream workaround removals

| Component | Local workaround and upstream status | Review cadence and retirement gate |
| --- | --- | --- |
| wasm-bindgen threaded-memory layout (RE-036, D-093, UP-004) | Pinned 0.2.126 still reserves its bookkeeping page at allocator-visible `__heap_base`, so `build-wasm.mjs` relocates that page after the module's original initial memory and fails on transform drift. Upstream [issue #5223](https://github.com/wasm-bindgen/wasm-bindgen/issues/5223) records the same Rust dlmalloc 0.2.13 interaction; [PR #5225](https://github.com/wasm-bindgen/wasm-bindgen/pull/5225) merged the equivalent placement fix on 2026-07-08, after the 0.2.126 release. | Check every full currency checkpoint and every wasm-bindgen release. When a release contains PR #5225, review and exact-pin the matching wasm-bindgen crate and CLI together, remove the relocation rewrite, retain the layout/drift assertions for the transition, and require `pnpm check`, byte repeatability, the repeated RE-036 physical-console cohort, and the full physical `smoke@1` gate before retiring the workaround or closing the upstream watch. A Rust-only upgrade is not a retirement trigger unless upstream evidence changes the allocator/layout contract. |

## Review ledger

| Review date | Scope and outcome | Next checkpoint |
| --- | --- | --- |
| 2026-07-25 | **D-117 P-001 closeout:** M1 produced no production module with an unavoidable single address space beyond 4 GiB, so memory32 remains selected and the unconsumed D-086 WAT/runtime/harness apparatus was removed. Binaryen 131.0.0 remains required by the selected Rust/wasm-bindgen pipeline; no dependency pin changed. | No memory64-specific review unless D-117's concrete module-specific reopen condition is met. Normal Binaryen/Rust cadence continues. |
| 2026-07-24 | **D-096 closed-backend cleanup:** removed `@types/dom-chromium-ai` 0.0.17 with the superseded Prompt API engine/harness surface. The selected wllama/GGUF backend and all other direct pins remain unchanged. Lockfile regeneration removed the unused type package; `pnpm check` passed with byte repeatability and 286 tests, and physical schema-v31/metric-set-v15 report `smoke-1-0b65dbea0692-dev-01-showcase-2026-07-25T02-31-34-110Z.json` passed all six launches, three facets, and 30 checks. | None unless a current plan item reopens a built-in Chrome AI API experiment. |
| 2026-07-24 | **Targeted D-095 closed-experiment cleanup:** removed `@huggingface/transformers` 4.2.0, the `onnxruntime-web` 1.27.0 override, blocked `onnxruntime-node`/`protobufjs` build entries, both ONNX model manifests, and their transitive ONNX/`adm-zip` packages. D-073's evidence remains in decisions, findings, results, and git history; D-074's selected `@wllama/wllama`/GGUF path and direct harness-only `sharp` dependency remain. Lockfile regeneration, `pnpm check`, and repeatability passed; routine schema-v30 report `smoke-1-188e456726f4-dev-01-showcase-2026-07-25T02-00-45-198Z.json` and targeted V8 report `smoke-1-188e456726f4-dev-01-showcase-2026-07-25T02-07-11-589Z.json` each passed all facets and 30 checks. | No ONNX/Transformers recheck unless an active plan item reopens that experiment. Normal dependency cadence continues for wllama/GGUF and `sharp`. |
| 2026-07-24 | **Targeted D-092/D-093 Rust/wasm-bindgen compatibility review:** retained nightly-2026-07-16, wasm-bindgen 0.2.126, dlmalloc 0.2.13, and Binaryen 131.0.0. Exact generated-Wasm inspection and three physical failures proved that Rust's pre-existing dlmalloc chunk overlapped wasm-bindgen's thread scratch lock. A deterministic fail-on-drift relocation to wasm-bindgen's already-appended page preserved the 33-page memory contract and passed the schema-v29/metric-set-v14 six-launch physical gate. Upstream wasm-bindgen issue #5223 confirms the same incompatibility and PR #5225 merged the equivalent fix after the latest 0.2.126 release; the tracked-removal table above defines the release watch and retirement gate. No dependency was upgraded speculatively. | 2026-08-17, every wasm-bindgen release until PR #5225 ships, any pinned toolchain change, or a relocated-artifact startup failure. |
| 2026-07-21 | **Targeted D-090 rendered-output observability review:** selected exact `sharp` 0.34.5 as a direct harness-only dependency to decode the canvas-only PNG captured by pinned Playwright/Chrome and make visible-pixel coverage mandatory. The same exact package was already locked transitively through `@huggingface/transformers`, so this adds no version or lockfile package. Local API inspection and the D1 negative visibility fixture establish the bounded use; `pnpm check` and repeatability pass. The required physical `smoke@1` remains the adoption gate, so D-090 and its plan checkbox stay open. This was not a full-repository currency review. | 2026-08-17, a `sharp` advisory/release, a screenshot-format change, or replacement with direct WebGPU readback. |
| 2026-07-20 | **Targeted M1 renderer/decoder review (D-089):** adopted Babylon Lite 1.12.0, `@babylonjs/ktx2decoder` 9.17.0, `draco3dgltf` 1.5.7, and `meshoptimizer` 1.2.0. Official release/specification material and exact installed loader/wrapper source were reviewed. Old-pin artifact `1e01757c4726…`, isolated Lite candidate `23e3b2d0be3c…`, and final decoder/schema-v8 artifact `040677b31910…` each passed the required registered physical-console gate; the final artifact passed all three facets, six runs, 24 checks, and repeatability with unchanged budgets. Two preceding same-artifact failures retain RE-036 and RE-008 evidence. The 1.12.0 release-age exception is exact and bounded to this reviewed pin. Local wrapper adapters and upstream PR candidates are recorded in `upstream-contributions.md`. This was not a full-repository currency review. | 2026-08-17, or earlier on a Lite/decoder release, wrapper-shape change, relevant advisory, or representative KTX2 path addition. |
| 2026-07-20 | **Full repository checkpoint for M0 exit and M1 entry:** adopted Node 24.18.0 because 24.13.1 predates the March and June Node 24 security releases; adopted current Stable CfT 151.0.7922.34 after the required same-artifact Chrome 150→151 physical baseline transition passed and was explicitly promoted; deferred Babylon Lite 1.12.0, `@noble/hashes` 2.2.0, pnpm 11.15.1, Vite 8.1.5, and Biome 2.5.4 to the bounded follow-ups below; retained all other current pins. Model revision heads still equal all three pinned commits. `pnpm audit` found one high transitive `adm-zip` advisory only in blocked `onnxruntime-node` postinstall code; exposure and recheck are recorded below. Full details and official sources are in the dated subsection. | 2026-08-17, or earlier on any listed trigger. This checkpoint also satisfies M1 entry. |
| 2026-07-20 | **Targeted D-086 memory64 review:** retained pinned Binaryen/npm 131.0.0 and added no dependency. Chrome 133 release notes/Blink intent, current V8 wasm limits, the current WebAssembly memory64 proposal, and Rust's current `wasm64-unknown-unknown` Tier-3 page were checked 2026-07-19. Pinned Chrome 150 required no memory64 feature flag and artifact `memory64-spike-1-a05e3d13d506-dev-01-showcase-2026-07-20T12-25-10.882Z.json` passed all six registered physical-console runs, including an exact access at 4 GiB and every blocking paired 10% variance gate; the separate absolute diagnostic was invalid only for fresh memory32 prepare and supports no absolute claim. Rust still distributes no wasm64 target artifact, so the paired WAT apparatus stayed experiment-only and production remained Rust/memory32 by default. This was not a full-repository currency review. | Satisfied by D-117; no memory64-specific recheck unless its module-specific reopen condition is met. |
| 2026-07-19 | **Targeted D-085 Rust/WASM scaffold review:** adopted exact `nightly-2026-07-16` (rustc 1.99.0-nightly `d0babd8b6`) because current stable 1.97.1 cannot supply wasm-bindgen's required threaded stdlib/TLS; adopted current wasm-bindgen crate + CLI 0.2.126 and Binaryen/npm 131.0.0 (`version_131`). Official Rust releases, rustc wasm target docs, wasm-bindgen threads guide/releases, and Binaryen releases were checked 2026-07-19. The exact module is feature-inspected, same-host byte-repeatability gated, and qualified by schema-v25 / metric-set-v11 physical `smoke@1` artifact `smoke-1-9a863a19906d-dev-01-showcase-2026-07-20T01-09-27-205Z.json`. This was not a full-repository currency review. | Recheck at the full repository review by 2026-08-16, or earlier on a Rust/wasm-bindgen release that removes the nightly build-std requirement or reports a relevant advisory. |
| 2026-07-19 | **Targeted D-075 review:** retained stock `@wllama/wllama` 3.5.1 at commit `766d28e03eeac044fe055327d06b83d3f9b84544` and its llama.cpp `dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708`. The measurement temporarily used bounded package/llama.cpp state patches and an Emscripten 4.0.20/Dawn `v20260317.182325` WASM (`7723f56e7eeff507c3db43b5f58791cada24954f9591cf3e7e9a8050ca001382`). D-084 rejected the result and removed the patches and binary, leaving no added runtime dependency. No candidate upgrade was evaluated and this was not a full-repository currency review. | Recheck at the full repository review, or earlier if a future model-specific persistence spike is approved. |
| 2026-07-19 | Babylon Lite-only selection review (D-078): adopted 1.11.0 after a classic/Lite physical-gate comparison. This was not a full-repository currency review. | Full repository review by 2026-08-16 or before M1 starts, whichever comes first. |

Each full checkpoint adds a dated subsection below this table. For every direct package
or other repository-selected versioned input, record the current pin, candidate checked,
official source/review date, adopted/deferred/not-applicable outcome and reason, relevant
verification or artifact, and next recheck trigger/date. Group unchanged supporting
packages only when they share the same source, outcome, and gate; runtime-critical
components always get individual rows. A targeted review records the same fields for its
affected inputs in a ledger row or dated subsection, explicitly labeled as targeted so it
cannot be mistaken for a full checkpoint.

## Full checkpoint — 2026-07-20 (M0 exit + M1 entry)

This review enumerated every direct package from all four workspace manifests and the
root manifest, the `onnxruntime-web` override, Node/pnpm/Chrome/Rust/WASM pins, and all
three model revisions and artifact manifests. Registry/release/advisory data was read on
2026-07-20. No decoder asset is selected yet; D-078's KTX2/Draco/meshopt decoder selection
therefore remains not applicable until M1's first content task.

### Runtime and platform-critical inputs

| Input | Pin reviewed | Candidate checked | Outcome and evidence | Next recheck |
| --- | --- | --- | --- | --- |
| Chrome for Testing Stable | 150.0.7871.115, revision 1639810 | 151.0.7922.34, revision 1654411 | **Adopted and promoted.** The official last-known-good endpoint changed to 151 on 2026-07-20. The skipped Chrome 150 desktop updates were reviewed: 150.0.7871.124/.125 carried 15 security fixes, including high-severity GPU and V8 fixes, and 150.0.7871.128/.129 carried seven, including critical GPU and high-severity V8 fixes. Chrome 151's official beta notes add optional WebGPU subgroup-size control, relevant to later AI-compute experiments but unused by M0; no removal affects the current worker/WebGPU/OPFS/WASM surface. Under Node 24.18.0, schema-v26 Chrome 150 anchor `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-46-41-973Z.json` passed first and was explicitly promoted. Same-artifact Chrome 151 report `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` then passed all three facets, six core runs, and 24 checks and replaced it through D-087's explicit promotion. Build sizes were unchanged; fresh/warm mean all-realm heap rose 1.84%/2.29%, while all zero-overlap counters remained zero. RE-008 and RE-036 retain the failed transition attempts, with RE-036 subsequently assigned to the toolchain by D-093. | 2026-08-17, the next Stable advance, or a release addressing RE-008. |
| Babylon Lite | 1.11.0 | 1.12.0 (`npm-lite-v1.12.0`, released 2026-07-20) | **Deferred.** Upstream notes add thin-instance LOD/CSM caps, texture arrays, a shadow-only PBR mode, and duplicate-runtime-code reduction. Those touch planned M1 rendering and claimed performance, so D-079 requires their own old/new render-worker fixture, exact bundle audit, repeatability run, and physical smoke rather than coupling the engine change to the Chrome transition. | Before the first M1 content lands, or by 2026-07-27; earlier for a security release or a fix to a recorded Lite gap. |
| `@huggingface/transformers` | 4.2.0 | 4.2.0 | **Removed by D-095 on 2026-07-24.** It was retained at this checkpoint, but D-073 was already negative evidence and no active plan item consumed the implementation. | None unless an active plan item reopens the experiment. |
| `@wllama/wllama` / bundled llama.cpp | 3.5.1 / commits `766d28e03eeac044fe055327d06b83d3f9b84544` / `dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708` | 3.5.1 / same bundled commits | **Retained; current stable.** | 2026-08-17 or a release affecting WebGPU kernels, Gemma 4, JSON constraints, or persistent state correctness. |
| `@noble/hashes` | 2.0.1 | 2.2.0 | **Deferred.** This protects model-install integrity, so the skipped minor needs the M1 OPFS integrity fixture plus check/repeatability; no repository audit advisory implicates 2.0.1. | Before M1 storage implementation, or by 2026-07-27. |
| ONNX Runtime Web override | 1.27.0 | 1.27.0 stable (1.28 development builds only) | **Removed by D-095 on 2026-07-24**, together with the Transformers/optional Node dependency chain. | None unless an active plan item reopens the experiment. |
| Gemma model inputs | ONNX QAT `5cd5514e…`, ONNX WASM `9f4bef82…`, GGUF `66a399f6…`; exact artifact hashes in source at this checkpoint | The Hugging Face API reported the same three repository heads | **GGUF retained; ONNX manifests removed by D-095.** Historical identities remain in the decision/finding/result evidence. | 2026-08-17 for GGUF, or an earlier candidate with a documented quality, kernel, or cache-correctness reason. |
| Rust / wasm-bindgen / Binaryen | nightly-2026-07-16 / 0.2.126 / 131.0.0 | nightly channel dated 2026-07-20 / 0.2.126 / 131.0.0 | **Retained.** wasm-bindgen and Binaryen are current; the four-day nightly move has no identified fix that justifies invalidating D-085's byte and physical evidence. | 2026-08-17, a relevant Rust fix/advisory, or removal of the threaded build-std nightly requirement. |

### Build, measurement, and supporting inputs

| Input group | Pin reviewed | Candidate checked | Outcome and evidence | Next recheck |
| --- | --- | --- | --- | --- |
| Node 24 LTS | 24.13.1 | 24.18.0 | **Adopted.** Node 24.14.1 and 24.17.0 were security releases containing high-severity fixes, so deferral was not acceptable. The official 24.18.0 Windows archive matched SHA-256 `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`. `pnpm check` and repeatability passed under the downloaded runtime; before phase instrumentation, artifact `a05e3d13d506697ed1d864d39fec6ffdc2f01508fc27974da65d2e2f4adc3f6c` and all six engine/WASM hashes matched the 24.13.1 build. The required isolated physical evidence then passed under old Chrome 150 with Node 24.18.0 in same-artifact schema-v26 anchor `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-46-41-973Z.json`; only after that anchor was promoted did the Chrome 151 comparison run. | 2026-08-17 or the next Node 24 security release. |
| pnpm | 11.12.0 | 11.15.1 | **Deferred.** The current pin already includes the earlier 11.4 credential/integrity fixes; the skipped range has no identified project-blocking fix and package-manager movement needs its own frozen-install/lock/repeatability evidence. | 2026-07-27 or a relevant security/integrity release. |
| Vite | 8.1.4 | 8.1.5 | **Deferred.** A build-tool patch can alter app/game bytes and belongs in a small exact-pin/repeatability unit after the M0 Chrome gate. | 2026-07-27. |
| Biome | 2.5.3 | 2.5.4 | **Deferred.** Supporting-tool patch with no shipped-runtime effect; batch with the next supporting-tool checkpoint. | 2026-07-27. |
| TypeScript / Rollup / node-resolve / esbuild / Playwright / Vitest / Binaryen | 7.0.2 / 4.62.2 / 16.0.3 / 0.28.1 / 1.61.1 / 4.1.10 / 131.0.0 | Same stable versions | **Retained; current.** | 2026-08-17 or an advisory/relevant fix. |
| Type packages | `@types/node` 24.13.3 | Same within the selected Node 24 line (`@types/node` 26 is for a different runtime major) | **Retained; current/applicable.** `@types/dom-chromium-ai` was removed by D-096 with the closed Prompt API implementation. | 2026-08-17 or a typing fix for an API Parallax uses. |

### Advisory disposition

At this checkpoint, `pnpm audit --json` reported GHSA-xcpc-8h2w-3j85
(CVE-2026-39244), high severity, for `adm-zip` 0.5.18 under
`@huggingface/transformers` → optional `onnxruntime-node` 1.24.3. D-095 subsequently
removed that complete dependency chain; the regenerated lockfile contains none of
Transformers.js, ONNX Runtime, `adm-zip`, or the associated blocked build entries. The
installation-tree risk and its recheck obligation are therefore closed unless the
experiment is explicitly reopened.

Official sources checked: Chrome for Testing
`googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json`;
the Chrome Releases desktop updates dated 2026-07-14 and 2026-07-16; the official
Chrome 151 beta release notes dated 2026-07-03;
Node release index plus `nodejs.org/en/blog/release/v24.14.1` and
`nodejs.org/en/blog/release/v24.17.0`; npm registry metadata for every JavaScript
package; upstream GitHub releases/changelogs (Babylon-Lite, Transformers.js, wllama,
noble-hashes, pnpm, Vite, Biome, Rollup, esbuild, Playwright, Vitest, Binaryen, and
wasm-bindgen); crates.io's wasm-bindgen record; Rust's official nightly channel
manifest; the Hugging Face API for each exact model repository; and GitHub's reviewed
GHSA-xcpc-8h2w-3j85 advisory.
