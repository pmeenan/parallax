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
   the render-worker `smoke@1` gate and, as they exist, M1 compressed assets, P-002 native
   WebGPU interop, and M3 character animation.
6. Update architecture, plan status, budgets, findings, and decisions in the same change
   wherever behavior or constraints moved. Update the ledger below even when every
   candidate was deferred.

## Review ledger

| Review date | Scope and outcome | Next checkpoint |
| --- | --- | --- |
| 2026-07-20 | **Targeted D-086 memory64 review:** retained pinned Binaryen/npm 131.0.0 and added no dependency. Chrome 133 release notes/Blink intent, current V8 wasm limits, the current WebAssembly memory64 proposal, and Rust's current `wasm64-unknown-unknown` Tier-3 page were checked 2026-07-19. Pinned Chrome 150 required no memory64 feature flag and artifact `memory64-spike-1-a05e3d13d506-dev-01-showcase-2026-07-20T12-25-10.882Z.json` passed all six registered physical-console runs, including an exact access at 4 GiB and every blocking paired 10% variance gate; the separate absolute diagnostic was invalid only for fresh memory32 prepare and supports no absolute claim. Rust still distributes no wasm64 target artifact, so the paired WAT apparatus stays experiment-only and production remains Rust/memory32 by default. This was not a full-repository currency review. | Recheck at the full repository review by 2026-08-16, or earlier if Rust promotes/distributes wasm64, V8 changes its limits, or P-001 receives representative M1 adoption evidence. |
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
