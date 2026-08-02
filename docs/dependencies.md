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
| Babylon Lite device-loss seam (D-104) | Pinned 1.12.0 uses the bounded `lite-device-loss.ts` seam to observe and force loss through Lite's private `_device`, while Parallax restarts the complete render/stream/decode cohort. Lite 1.14.0 added public device-loss recovery controls, but its in-place resource rebuild is not equivalent to that product recovery contract and its force-loss test hook is not public. | Review with Lite 1.14.0 or newer as a renderer-family change. Retire or narrow the seam only after public API/source inspection proves equivalent observe/force-loss coverage, render-recovery fixtures pass, and the required same-scenario physical renderer gate passes. The existence of a public in-place recovery API alone is not a retirement trigger. |

## Review ledger

| Review date | Scope and outcome | Next checkpoint |
| --- | --- | --- |
| 2026-08-01 | **Accepted full repository checkpoint for M2 exit and M3 entry (D-149):** adopted Node 24.18.1, CfT Stable 151.0.7922.71 at unchanged revision 1654411, harness-only `sharp` 0.35.3, and transitive PostCSS 8.5.25. The graph clears both prior high advisories; `pnpm audit` reports zero advisories across 211 dependencies. The exact dev-01 `.34`/`.71` transition passed both schema-v62 / metric-set-v28 halves with six launches, three facets, and 30/30 checks. D-152's installed branded-Stable schema-v2 parity result passed the same core while remaining baseline-ineligible, nonpromotable, and not budget-authoritative. The final exact-current `.71` production smoke `smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-02T00-30-12-454Z.{json,md}` passed exact pre/post serving identity, rendered output, all six launches, all three facets, and 30/30 checks; JSON/Markdown SHA-256 are `6028aa225b14e6c32398ead849dc00784f075c4b410e61a336376b970e105a8e` / `1b00d8746308e0297d93f7e68c1c14cb8f0437d2832249efe7029a2328e02a20`. | This checkpoint satisfies M3 entry. Next full checkpoint: M3 exit or 2026-08-29, whichever comes first; relevant security notices and row-specific triggers remain immediate. |
| 2026-07-29 | **D-133 targeted `@noble/hashes` integrity review:** adopted exact 2.2.0 from 2.0.1 after the overdue installer/integrity trigger fired. The signed immutable upstream 2.2.0 release points at commit `81983c2` (2026-04-11); repository and GitHub advisory checks found zero matches. The candidate remains zero-dependency ESM with Node `>=20.19`, `sideEffects: false`, and the consumed `./sha2.js` and `./utils.js` exports unchanged. Isolated npm tarball SHA-256 identities are `638ffb3053a7e7478c9e54a6e297f3601299ee570a41112e501af7050d086a0a` for 2.0.1 and `018b38bd7af36645fa0ece8f89eba21c828f3e4d219da5aacadd78bd0e654606` for 2.2.0. All 480 boundary/chunk comparisons and the 64 MiB comparison were byte-exact; isolated TypeScript compilation, `pnpm check`, and explicit engine/WASM repeatability passed. Only unminified `engine.js` and `installer-worker.js` changed, each by +6,596 bytes; no performance claim is made. The pre-pin and post-pin pinned-Chrome real-OPFS adapter results both passed the same unchanged five lifecycle/lock verdicts and are retained in D-133. | 2026-08-26, M2 exit, a noble-hashes release/advisory, a consumed-export change, or an integrity/OPFS regression. |
| 2026-07-29 | **D-130 targeted GGUF provisioning correction:** retained model revision `66a399f68ddd113b06dff02fca9523e55465d11d` and the exact five generated split hashes/2,620,371,552-byte total. Read-only HEAD/range/If-Range checks proved the five previously constructed Hugging Face split URLs are 404 because that revision contains only the unsplit upstream GGUF. The exact local split outputs remain valid and are now provisioned as fixed same-origin `immutable/model-<sha256>.gguf` install-only resources. No model, runtime, or dependency pin changed. | Run the bounded production source verifier after upload; otherwise 2026-08-23, M2 exit, a selected-model change, or a production transport failure. |
| 2026-07-26 | **Full repository checkpoint for M1 exit and M2 entry:** enumerated every direct external package, Node/pnpm, CfT, Rust/WASM/Cargo pins, the selected GGUF revision and artifact hashes, package-owned decoder binaries, the pinned Khronos glTF Sample Assets fixture, and the registered OS build and reference driver. No pin was adopted in this docs-only checkpoint. Current inputs were retained; newer CfT, Babylon Lite, KTX2 decoder, noble hashes, pnpm, Vite, Rollup, Biome, Playwright, sharp, Rust nightly, and Windows OOB candidates were deferred or found not applicable under the component-family gates below. `pnpm audit` reported two high development-only advisories in direct harness `sharp` and transitive PostCSS; their present trusted-input exposure and near-term remediation are recorded below. | 2026-08-23, M2 exit, a relevant security notice, or any earlier row-specific trigger. This checkpoint satisfies M2 entry. |
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

## Full checkpoint — 2026-08-01 (M2 exit + M3 entry)

This review re-enumerated all 17 unique direct external JavaScript packages across the
five workspace manifests, Node and pnpm, CfT, the Rust/WASM toolchain and resolved Cargo
crates, the selected GGUF revision and five exact artifacts, package-owned decoder
binaries, the Khronos fixture, and the registered OS/driver identity. Official release,
registry, source, feed, and advisory data was checked on 2026-08-01. Four exact
candidates are accepted as current/reference inputs after the dev-01 gates below.
Every other input remains isolated behind its
existing component-family gate.

### Runtime and platform-critical inputs

| Selected input | Candidate checked | Outcome and evidence | Next recheck / required gate |
| --- | --- | --- | --- |
| CfT Stable 151.0.7922.34, revision 1654411 | 151.0.7922.71, same revision | **Adopted and current after D-149.** The official known-good feed identifies `.71` as current Stable at the same base revision. The side-by-side win64 archive SHA-256 was `7ea2e94833ef710026c8cb08d0d2dafcb13f5d304d9c475ac07a3fa8c11d846c`; the downloaded ZIP was removed after extraction. The executable reports `Chrome/151.0.7922.71`, CDP revision `@ef35003457e93c278f911a334b06e4a5f8967e06`, and SHA-256 `112b7b761c1b6cfa898c56e725f87f7a999a16a0d367d5345824d53336f52acc`. The exact `.34` anchor, `.71` transition half, branded parity, and final exact-current `.71` production smoke all passed their D-149/D-152 contracts. `.34` remains intact for reconstruction. | 2026-08-29, M3 exit, a Stable advance, or a release relevant to an open Chrome finding. |
| `@babylonjs/lite` 1.12.0 | 1.15.0 across 1.13.0–1.15.0 | **Deferred.** This remains a renderer-family change; the skipped range includes the previously reviewed recovery controls plus later renderer work. D-104's full-cohort recovery contract and private force-loss seam are not superseded by release availability. | Before M3 renderer-facing work or by 2026-08-08: isolated API/source review, render/recovery fixtures, repeatability, and same-scenario physical renderer gate. |
| `@babylonjs/ktx2decoder` 9.17.0 and package-owned WASM | 9.19.0 across 9.18.0–9.19.0 | **Deferred.** The decoder package, binaries, and Babylon peer range move together and remain runtime-critical; no selected M2 dependency fix requires the move. | Before representative KTX2 content or by 2026-08-08: exact binary hashes, wrapper/API inspection, decoder fixtures, repeatability, and physical decoder/render gate. |
| `draco3dgltf` 1.5.7 | 1.5.7 | **Current.** The package and copied decoder binary remain current. | 2026-08-29, a release/advisory, or representative Draco content. |
| `meshoptimizer` 1.2.0 | 1.2.0 | **Current.** The package and copied decoder binary remain current. | 2026-08-29, a release/advisory, or representative meshopt content. |
| `@noble/hashes` 2.2.0 | 2.2.0 | **Current after D-133.** The exact consumed SHA-256 exports and zero-dependency integrity contract remain unchanged; this checkpoint does not repeat the accepted physical adapter comparison. | 2026-08-29, a release/advisory, a consumed-export change, or an integrity/OPFS regression. |
| `@wllama/wllama` 3.5.1, tag `766d28e03eeac044fe055327d06b83d3f9b84544`, llama.cpp `dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708` | Same release and commits | **Current.** The stock selected runtime remains the latest official release; no rejected experiment patch or binary survives. | 2026-08-29, a release/advisory, or approved model-runtime work. |
| Gemma 4 E2B QAT GGUF revision `66a399f68ddd113b06dff02fca9523e55465d11d`, five exact shard hashes, tokenizer/chat template | Repository head remains the selected revision | **Current.** D-130–D-132 changed provisioning and verified transport, not the model identity or bytes. | 2026-08-29, model/runtime work, or an upstream revision/advisory. |
| Node 24.18.0 | 24.18.1 LTS | **Adopted and current after D-149.** The skipped patch fixes three high, five medium, and three low vulnerabilities. The official Windows x64 ZIP matched `ec56b84a7551893ab2324ebdfdc4ab974a63b4781162600b68a1293cc3e53765`; extracted `node.exe` matched `ac51903c4c111815d52280b1fdcc8da067cbb37e2fe1a765097b85c3292c8582` and reports `v24.18.1`. Node 24.18.0 remains installed for reconstruction. | 2026-08-29, M3 exit, a Node 24 advisory/release, or the Node 26 LTS transition review. |
| Rust `nightly-2026-07-16` (`d0babd8b6`) | nightly channel dated 2026-08-01 | **Deferred.** `build-std` remains nightly-only; a nightly move can change allocator, SIMD, atomics, and generated layout and cannot be batched into this security/browser package checkpoint. | Before M3 Rust/WASM work or by 2026-08-08: skipped-range review, generated-layout assertions, repeatability, repeated RE-036 cohort, and physical `smoke@1`. |
| wasm-bindgen crate + CLI 0.2.126 | 0.2.126 | **Current.** No release contains PR #5225, so the tracked relocation workaround cannot yet retire. | Every wasm-bindgen release and the tracked retirement gate above. |
| Binaryen/npm 131.0.0 (`version_131`) | 131.0.0 | **Current.** The selected transform and local executable remain exact. | 2026-08-29, an advisory/release, or any WASM pipeline change. |
| Resolved Cargo support crates and wasm-bindgen 0.2.126 family | Existing lock resolution | **Retained.** No direct Rust selection moved; the repeatable Wasm build preserved SHA-256 `3be99544a2c15e529d1bd27cd97cf453617d60189a8c61d611862ad504e03fc5`. | A Rust/wasm-bindgen change, relevant advisory, or 2026-08-29. |
| Khronos glTF Sample Assets fixture commit `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf` | Same selected commit | **Current.** No fixture regeneration is part of this checkpoint. | A fixture regeneration or 2026-08-29. |
| Registered dev-01 Windows build 26200.8875 and NVIDIA driver 32.0.16.1074 | Same observed machine state | **Current.** Read-only local inspection still matches the registered descriptor; no OS, driver, display, or power baseline changed. | Before the next registered physical result and whenever machine state changes. |

### Build, measurement, and supporting inputs

| Selected input | Candidate checked | Outcome and evidence | Next recheck / required gate |
| --- | --- | --- | --- |
| pnpm 11.12.0 | 11.18.0 across 11.13.0–11.18.0 | **Deferred.** The package-manager move can change lock/install policy and artifact identity. Keeping 11.12.0 isolates the four required adoptions; it is installed under the new Node and reports the exact version. | By 2026-08-08 or before the next dependency update: isolated lock/install comparison, frozen install, full check, repeatability, and physical smoke if bytes move. |
| Vite 8.1.4 in `app/` and `game/` | 8.2.0 across 8.1.5–8.2.0 | **Deferred.** The skipped range can change build lifecycle, module resolution, and emitted launch artifacts. Neither manifest moved for the PostCSS remediation. | By 2026-08-08 or before M3 build changes: isolated build diff, repeatability, targeted diagnostics, and physical smoke if emitted bytes move. |
| Playwright Core 1.61.1 | 1.62.1 across 1.62.0–1.62.1 | **Deferred.** Browser launch, tracing, screenshot, and mandatory-metric collection require their own automation-family review. | With the later physical CfT transition or by 2026-08-08: launch/trace/screenshot fixtures and registered physical smoke. |
| `sharp` 0.34.5 | 0.35.3 | **Adopted and current after D-149.** GitHub marks versions before 0.35.0 affected by inherited libvips vulnerabilities and recommends current 0.35.3/libvips 8.18.3. The exact harness-only API remains local PNG decode; its negative fixture and the final dev-01 rendered-output gate passed. | 2026-08-29, M3 exit, a release/advisory, screenshot-format change, or external image-input proposal. |
| Transitive PostCSS 8.5.17 through Vite/Vitest | 8.5.25 | **Adopted and current after D-149.** GitHub marks versions through 8.5.17 affected by previous-source-map path traversal. Existing Vite `^8.5.16` ownership permits 8.5.25; pnpm resolved it lockfile-only with no Vite/Vitest manifest change and no override. That owning resolution also selects compatible package-owned `nanoid` 3.3.16 from 3.3.15; it is not a direct repository selection. | 2026-08-29, M3 exit, a release/advisory, or any untrusted CSS/source-map input. |
| `@biomejs/biome` 2.5.3 | 2.5.6 across 2.5.4–2.5.6 | **Deferred.** Parser, formatter, lint, and type-aware changes remain a separate supporting-tool review. | By 2026-08-08: isolated diagnostics/format diff and full check; no physical smoke if outputs remain unchanged. |
| `@types/node` 24.13.3 | 24.13.3 on the selected Node 24 line; 26.1.2 is a different runtime major | **Current for the selected runtime line.** | With a Node-major transition, advisory, or 2026-08-29. |
| Rollup 4.62.2 | 4.62.4 across 4.62.3–4.62.4 | **Deferred.** The 4.62.3 preserved-modules input-base fix is irrelevant to the current configuration, which has no `preserveModules` path. Version 4.62.4 fixes an older-Linux regression introduced by 4.62.3. Neither change justifies coupling a separate build-tool move to this checkpoint. | By 2026-08-08 or before the next build-tool change: isolated skipped-range review, frozen install, full check, repeatability, and artifact-byte comparison. |
| TypeScript 7.0.2; Vitest 4.1.10; `@rollup/plugin-node-resolve` 16.0.3; esbuild 0.28.1 | Same releases | **Current.** Registry checks found no newer release for these selected inputs. | A release/advisory or 2026-08-29. |

`pnpm audit --json` now reports zero critical, high, moderate, low, or informational
advisories across 211 total dependencies (7 production, 204 development, and 138
optional counts are overlapping audit metadata categories). The prior two high findings
are removed by the exact `sharp` and PostCSS resolutions; no suppression or audit ignore
was added.

The deterministic prequalification gate used Node 24.18.1 and pnpm 11.12.0. Frozen install,
production build, engine/WASM repeatability, typecheck, 20 targeted dependency/browser/
build-contract tests, and the full 168-file unit run passed (2,171 passed, one skipped).
After all review corrections, the final closure gate preserved repeatable build output,
linted 422 files, passed 2,274 tests across 172 files with one skip, and passed
`git diff --check`.
Final build-manifest/artifact SHA-256 is
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b`;
install-manifest/release SHA-256 is
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`.
No performance claim follows from deterministic tests. D-149 accepts the exact
dev-01 old-`.34`/new-`.71` transition, D-152's installed branded-Stable parity, and the
final exact-current `.71` production smoke. The passing branded result is
baseline-ineligible, nonpromotable, and not budget-authoritative; the final smoke
baseline remains untracked. The production artifact was deployed with its exact model
inventory preserved and the versioned nginx config installed.

Closed experiments remain **not applicable**: D-095's Transformers/ONNX inputs, D-096's
Prompt API surface, D-117's memory64 apparatus, and D-148's retired physical 100 GiB
lifecycle runner are not reopened by dependency currency.

Official sources checked on 2026-08-01: the
[Node 24.18.1 security release and checksums](https://nodejs.org/en/blog/release/v24.18.1),
[CfT known-good feed](https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json),
[npm registry](https://registry.npmjs.org/),
[sharp 0.35.3 release](https://github.com/lovell/sharp/releases/tag/v0.35.3),
[sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj),
[PostCSS 8.5.25 release](https://github.com/postcss/postcss/releases/tag/8.5.25),
[PostCSS advisory](https://github.com/advisories/GHSA-r28c-9q8g-f849),
[Rollup 4.62.3 release](https://github.com/rollup/rollup/releases/tag/v4.62.3),
[Rollup 4.62.4 release](https://github.com/rollup/rollup/releases/tag/v4.62.4),
[Babylon Lite releases](https://github.com/BabylonJS/Babylon-Lite/releases),
[Babylon.js releases](https://github.com/BabylonJS/Babylon.js/releases),
[Rust nightly manifests](https://static.rust-lang.org/dist/),
[wasm-bindgen releases](https://github.com/wasm-bindgen/wasm-bindgen/releases),
[Binaryen releases](https://github.com/WebAssembly/binaryen/releases), and the prior
checkpoint's unchanged model, fixture, OS, and driver sources.

## Targeted checkpoint — 2026-07-29 (`@noble/hashes` for D-133)

D-133 made integrity hashing load-bearing and triggered the deferred 2.0.1→2.2.0
runtime-critical review. The official
[2.2.0 release](https://github.com/paulmillr/noble-hashes/releases/tag/2.2.0) is signed
and immutable at commit `81983c2`, dated 2026-04-11. The
[published package](https://www.npmjs.com/package/@noble/hashes/v/2.2.0) preserves the
consumed zero-dependency ESM contract: Node `>=20.19`, `sideEffects: false`, and exports
for `./sha2.js` and `./utils.js`. Repository-local audit and GitHub Advisory Database
queries found no advisory matching either selected or candidate package. Independently
downloaded npm tarballs hashed to
`638ffb3053a7e7478c9e54a6e297f3601299ee570a41112e501af7050d086a0a`
for 2.0.1 and
`018b38bd7af36645fa0ece8f89eba21c828f3e4d219da5aacadd78bd0e654606`
for 2.2.0.

An isolated old/new comparison passed 480 exact boundary/chunk cases plus an exact
64 MiB comparison and TypeScript compilation. The repository then changed only the
engine package's exact pin and the corresponding lockfile resolution. `pnpm check`
passed with 756 tests, and an additional explicit repeatability gate passed for the
engine and Wasm. The unminified output comparison changed only `engine.js` and
`installer-worker.js`, each by +6,596 bytes; this is an identity/size observation, not a
performance claim.

The same unchanged real-OPFS adapter gate passed before and after the pin move. The
2.0.1 result is
`adapter-v2-2026-07-29T12-05-01-406Z.json` (SHA-256
`6b050ffc44cec855146bc31e53f22b1fe8fe97e146ecd1ca235e779d731de08b`;
Markdown SHA-256
`d1bf4147a308a0199b1a5a31e60471931db5d48a210b32517092a806b97f3289`);
the 2.2.0 result is
`adapter-v2-2026-07-29T12-07-25-730Z.json` (SHA-256
`215efc51e710a349acb693234514cf4ea036052e7589c1267310dec06d16002f`;
Markdown SHA-256
`64c0af9beba33b2aed2f26da8b35cbfdff9150f8ea5aefbbbfb63f75f28a8e58`).
Both used visible pinned CfT 151.0.7922.34 (executable SHA-256
`409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`)
and passed `blockedBeforeRelease`, `firstFinalization`, `lifecycle`,
`reopenReconciliation`, and `terminatedOwnerReleasedLock`. They are bounded synthetic
store-adapter evidence, not installer transfer qualification, a performance result,
production evidence, or D-097 smoke.

## Full checkpoint — 2026-07-26 (M1 exit + M2 entry)

This review enumerated all 17 unique direct external JavaScript packages from the root
and four workspace manifests, Node and pnpm, CfT, the Rust/WASM toolchain and resolved
Cargo crates, the selected GGUF revision and five artifact hashes, package-owned decoder
WASM assets, the pinned Khronos glTF Sample Assets fixture, and the registered OS build
and reference driver.
Official registry, release, source, and advisory data was checked on 2026-07-26. No pin
was adopted: current inputs remain exact, while every newer candidate is isolated behind
the gate appropriate to the component family.

### Runtime and platform-critical inputs

| Selected input | Candidate checked | Outcome and evidence | Next recheck / required gate |
| --- | --- | --- | --- |
| CfT Stable 151.0.7922.34, revision 1654411 | 151.0.7922.47, same revision | **Deferred.** The official last-known-good feed and Chrome early-stable notice moved after M1's final baseline. No security fix is listed, but changing the pinned browser can move every runtime and measurement result. | By 2026-07-29 or before the first production M2 baseline: update all platform URLs/hashes, repeatability, and the same-scenario registered physical Chrome transition. |
| `@babylonjs/lite` 1.12.0 | 1.14.0 across 1.13.0–1.14.0 | **Deferred.** The skipped range adds device-loss recovery controls and material renderer/loader features and fixes. Public recovery does not yet prove equivalence to Parallax's full-cohort restart or replace the private force-loss seam recorded above. | By 2026-08-02 or before M2 renderer/cache work: isolated API/source review, renderer and recovery fixtures, repeatability, and same-scenario physical renderer gate. |
| `@babylonjs/ktx2decoder` 9.17.0 and its package-owned WASM | 9.18.0 | **Deferred.** The candidate changes the decoder package, binaries, and peer relationship to `@babylonjs/core`; the 9.18 release notes identify no KTX2-specific fix that justifies mixing it with this status-only change. | By 2026-08-02 or before representative KTX2 content: exact binary hashes, wrapper/API inspection, decoder fixtures, repeatability, and physical decoder/render gate. |
| `draco3dgltf` 1.5.7 | 1.5.7 | **Not applicable — current.** The selected package and copied decoder binary remain current. | 2026-08-23, a release/advisory, or representative Draco content. |
| `meshoptimizer` 1.2.0 | 1.2.0 | **Not applicable — current.** The selected package and copied decoder binary remain current. | 2026-08-23, a release/advisory, or representative meshopt content. |
| `@noble/hashes` 2.0.1 | 2.2.0 across 2.1.0–2.2.0 | **Deferred.** The skipped range includes audited fixes, SHA-3 performance work, and TypeScript/tree-shaking changes. M2 will make integrity hashing load-bearing, so the candidate needs an isolated OPFS/integrity review before that path is built. | By 2026-07-29 or before the first M2 installer/integrity implementation: integrity fixtures, repeatability, and physical smoke if emitted runtime bytes move. |
| `@wllama/wllama` 3.5.1, tag commit `766d28e03eeac044fe055327d06b83d3f9b84544`, llama.cpp `dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708` | Same package release, tag, and submodule | **Not applicable — current.** The stock selected runtime remains the latest official release; no rejected D-075 patch or binary survives. | 2026-08-23, a release/advisory, or an approved model-runtime change. |
| Gemma 4 E2B QAT GGUF revision `66a399f68ddd113b06dff02fca9523e55465d11d`, five exact shard hashes, embedded tokenizer/chat template | Repository head remains the exact selected revision | **Not applicable — current.** The official model API still reports the selected commit; the manifest continues to bind every shard's byte length and SHA-256. | 2026-08-23, model/runtime work, or an upstream revision/advisory. |
| Node 24.18.0 | 24.18.0 on the selected LTS line; Node 26 remains the non-LTS current line | **Not applicable — current for the selected LTS contract.** The root engine, `.nvmrc`, and local registry agree. No later Node 24 security release exists. | A Node 24 advisory/release, Node 26 LTS transition review, or 2026-08-23. |
| Rust `nightly-2026-07-16` (`d0babd8b6`) | `nightly-2026-07-26` (`008fa22ce3`) | **Deferred.** `build-std` remains nightly-only and the ten-day range contains 1,049 commits, including allocator-feature and SIMD changes relevant to the threaded module. This is not safe to batch with milestone docs. | By 2026-08-02 or before Rust/WASM work: isolated skipped-range review, generated-layout assertions, byte repeatability, repeated RE-036 cohort, and physical `smoke@1`. |
| wasm-bindgen crate + CLI 0.2.126 | 0.2.126 | **Not applicable — current.** PR #5225 merged after the latest release, so no shippable candidate can retire the relocation workaround. | Every wasm-bindgen release and the tracked retirement gate above. |
| Binaryen/npm 131.0.0 (`version_131`) | 131.0.0 | **Not applicable — current.** The selected transform tool and verified local executable match the latest release. | 2026-08-23, an advisory/release, or any WASM pipeline change. |
| Resolved Cargo support crates: `bumpalo` 3.20.3, `cfg-if` 1.0.4, `once_cell` 1.21.4, `proc-macro2` 1.0.107, `quote` 1.0.47, `rustversion` 1.0.23, `syn` 2.0.119, `unicode-ident` 1.0.24, and the wasm-bindgen 0.2.126 family | Same current compatible releases; `syn` 3.0.3 is outside wasm-bindgen's selected major line | **Not applicable — current.** Crates.io and the GitHub advisory records show no advisory affecting the resolved versions. | A Rust/wasm-bindgen change, relevant advisory, or 2026-08-23. |
| Khronos glTF Sample Assets fixture commit `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf` | Upstream `main` remains the exact commit | **Not applicable — current.** The generated embedded fixtures still identify the official upstream head exactly. | A fixture regeneration or 2026-08-23. |
| Registered dev-01 Windows 11 25H2 build 26200.8875 | 26200.8894, optional OOB KB5121767 | **Not applicable — OOB target condition absent.** Microsoft recommends the OOB update only for the limited devices affected by an Intel Innovation Platform Framework driver issue and says unaffected devices require no action. Read-only local inspection found dev-01 is an MSI MS-7D91 desktop with zero PnP devices or signed drivers matching Intel IPF or Dynamic Tuning; the registry and machine record both report build 26200.8875. | Before the next physical baseline if Windows Update, OS build, machine, or Intel driver state changes; otherwise 2026-08-23. Any adopted OS build must update the registered machine identity and pass the relevant physical smoke before new results qualify. |
| Registered dev-01 NVIDIA driver file version 32.0.16.1074 | NVIDIA 610.74 WHQL remains current | **Not applicable — current.** This is recorded machine state, not a repository-installed dependency. | Before the next registered physical baseline if machine state changes. |

### Build, measurement, and supporting inputs

| Selected input | Candidate checked | Outcome and evidence | Next recheck / required gate |
| --- | --- | --- | --- |
| pnpm 11.12.0 | 11.17.0 across 11.13.0–11.17.0 | **Deferred.** 11.17.0 supersedes a range whose published packages were missing compiled files and adds auth-response hardening. A package-manager move can change the lock/install graph and emitted artifacts. | By 2026-07-29 or before any dependency update: frozen install, lockfile/repeatability, `pnpm check`, and physical smoke if built bytes move. |
| Vite 8.1.4 in `app/` and `game/` | 8.1.5 | **Deferred.** The patch contains build lifecycle, dependency, module-runner, and CJS interop fixes; it can alter launch artifacts and D-020 evidence. | By 2026-08-02 or before M2 build/cache changes: isolated build diff, repeatability, targeted diagnostics, and physical smoke. |
| Playwright Core 1.61.1 | 1.62.0 | **Deferred.** The release changes automation APIs and its bundled browser matrix; Parallax uses it for launch, tracing, screenshots, and mandatory metrics against a separately pinned CfT. | By 2026-08-02 or with the CfT transition: launch/trace/screenshot fixtures and registered physical smoke. |
| `sharp` 0.34.5 | 0.35.3; advisory fixed in 0.35.0+ | **Deferred — high advisory, bounded current exposure.** [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) affects untrusted image processing. Parallax currently decodes only its own pinned-browser, locally captured canvas PNG, but the harness dependency must not remain behind a security fix. | By 2026-07-27 or before accepting any external screenshot: isolated upgrade, rendered-output negative fixture, repeatability, `pnpm check`, and registered physical smoke because a mandatory metric depends on decode. |
| Transitive PostCSS 8.5.17 through Vite/Vitest | 8.5.18 security fix | **Deferred — high advisory, bounded current exposure.** [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) requires crafted CSS/source-map input; builds currently consume only repository-controlled CSS. Transitive pins normally move through their owner, but this concrete advisory warrants a lock-owner remediation review. | By 2026-07-27 or before accepting untrusted CSS: resolve through Vite/Vitest or a justified isolated lock change, then frozen install, build/repeatability, `pnpm check`, and physical smoke if bytes move. |
| `@biomejs/biome` 2.5.3 | 2.5.5 across 2.5.4–2.5.5 | **Deferred.** The patches change parser, formatter, lint, and type-aware behavior. They are supporting-tool changes, not M2 entry requirements. | By 2026-08-02: isolated diagnostics/format diff and `pnpm check`; no physical smoke if repository outputs are unchanged. |
| `@types/node` 24.13.3 | 24.13.3 on the selected Node 24 line; 26.1.1 is for a different runtime major | **Not applicable — current for the selected runtime line.** | With a Node-major transition, advisory, or 2026-08-23. |
| Rollup 4.62.2 | 4.62.3, released 2026-07-26 at 15:00 UTC | **Deferred.** The release sanitizes illegal characters in preserved-modules input bases. Repository-wide configuration inspection found no `preserveModules` or `preserveModulesRoot`; engine builds use explicit entry inputs and default bundling, so the fixed path is not currently exercised. | By 2026-07-29 or before the next build-tool/dependency change: isolated pin/lock update, frozen install, `pnpm check`, repeatability, and artifact-byte comparison; physical smoke if emitted bytes move. |
| TypeScript 7.0.2; Vitest 4.1.10; `@rollup/plugin-node-resolve` 16.0.3; esbuild 0.28.1 | Same releases | **Not applicable — current.** Registry checks found no newer release for these four direct supporting inputs. | A release/advisory or 2026-08-23. |

`pnpm audit --json` reported two high advisories and no critical, moderate, or low
advisories: the direct harness-only `sharp` case and transitive PostCSS case above. Their
current trusted-input topology limits exploitability; it does not waive the dated
remediation triggers. No emergency batch upgrade was made because each owner can affect
mandatory output or emitted artifacts and therefore needs its own verification.

Closed experiment inputs are **not applicable**: D-095 removed Transformers.js,
ONNX Runtime, both ONNX model manifests, and their transitive package exceptions; D-096
removed the Prompt API type/runtime surface; D-117 removed the memory64 experiment
apparatus. This checkpoint does not reopen any of those selections.

Official sources checked on 2026-07-26: the [npm registry](https://registry.npmjs.org/),
[Node release index](https://nodejs.org/dist/index.json),
[CfT last-known-good feed](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json),
[Chrome Releases](https://chromereleases.googleblog.com/),
[Rust nightly manifest](https://static.rust-lang.org/dist/2026-07-26/channel-rust-nightly.toml),
[Cargo `build-std` status](https://doc.rust-lang.org/cargo/reference/unstable.html#build-std),
[Rust skipped-range comparison](https://github.com/rust-lang/rust/compare/d0babd8b6...008fa22ce3),
[crates.io](https://crates.io/), [GitHub Advisory Database](https://github.com/advisories),
[wasm-bindgen releases](https://github.com/wasm-bindgen/wasm-bindgen/releases),
[Binaryen releases](https://github.com/WebAssembly/binaryen/releases),
[Babylon Lite releases](https://github.com/BabylonJS/Babylon-Lite/releases),
[Babylon.js releases](https://github.com/BabylonJS/Babylon.js/releases),
[noble-hashes releases](https://github.com/paulmillr/noble-hashes/releases),
[wllama releases](https://github.com/ngxson/wllama/releases),
[model metadata](https://huggingface.co/api/models/unsloth/gemma-4-E2B-it-qat-GGUF),
[Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets),
[Microsoft KB5121767](https://support.microsoft.com/en-us/help/5121767),
[pnpm releases](https://github.com/pnpm/pnpm/releases),
[Vite releases](https://github.com/vitejs/vite/releases),
[Biome releases](https://github.com/biomejs/biome/releases),
[Playwright releases](https://github.com/microsoft/playwright/releases),
[Rollup 4.62.3](https://github.com/rollup/rollup/releases/tag/v4.62.3),
[sharp releases](https://github.com/lovell/sharp/releases), and
[NVIDIA driver results](https://www.nvidia.com/download/find.aspx).

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
