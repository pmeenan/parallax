# Rough edges — platform findings log

A primary deliverable of this project: an evidence-backed catalog of where Chrome and the
web platform limit native-class games, plus where they surprised us positively. Audience:
Chrome engineering, standards discussions, and the web-gaming ecosystem.

**Log liberally.** A finding that turns out to be our bug still documents a debugging
blind spot. When in doubt, write it down.

## Entry format

```
## RE-NNN: One-line title
- **Date / Chrome version:** (incl. channel; note OS + GPU — Dawn behavior varies)
- **Layer:** app | Babylon | WebGPU/Dawn | V8/wasm | storage (OPFS/Cache) | scheduler |
  Prompt API | network | other
- **Status:** open | reported (link) | fixed-in-Chrome | our-bug | wontfix | idea
- **What we expected / What happened:** measurements or errors, not adjectives
- **Repro:** minimal steps or a pointer into harness/ (standalone repro preferred —
  reproducing outside Babylon is what makes a finding attributable and reportable)
- **Impact on Parallax:** blocked / worked around (how) / budget cost
- **Proposed improvement:** if this suggests a Chrome/spec change, sketch it
```

Findings that mature into Chrome bugs, spec proposals, or design docs get their status
updated with links. Periodically synthesize clusters of findings into shareable write-ups
(standing workstream in plan.md).

## Pre-seeded research questions

Known unknowns to be answered by M0 spikes and later milestones — convert each to a
numbered finding (or a decisions.md entry) once there's evidence:

- **Dawn pipeline cache observability:** launch-1 vs launch-2 compile behavior; can we
  prove cache hits? The bigger idea: **shippable/distributable PSO caches** so players
  don't each pay warmup once per device (connects to existing COS code-cache work).
- **V8 wasm code cache discipline:** does our immutable-URL + `compileStreaming`
  + 304 setup reliably preserve the code cache across launches and asset-only updates?
- **OPFS throughput ceilings:** sync access handle read bandwidth from decode-pool
  workers; contention behavior with N readers; OPFS vs Cache Storage per asset class.
- **CPU SIMD width ceiling:** wasm tops out at 128-bit vectors (simd128 + relaxed-simd;
  the flexible-vectors proposal for wider/length-agnostic SIMD is still design-stage,
  checked 2026-07-13). The cost is machine-dependent: dev-01's x86 has AVX2-class width
  to lose, while the Standard profile's M1 Pro is itself 128-bit NEON — the gap may be
  near zero there. Measure a representative hot kernel three ways per reference machine
  — native (AVX2/NEON), wasm simd128, WGSL compute — before fixing any CPU/GPU placement
  rule (D-032 treats "wide work moves to WGSL" as a hypothesis); feeds a potential
  spec-gap write-up.
- **App-owned WebGPU LLM under representative game load:** D-074 qualified the selected
  model against the walking skeleton; M3 must measure its independent WebGPU device,
  VRAM pressure, frame contention, scheduling, and OPFS model-load behavior against
  representative game assets and concurrent NPC demand.
- **No built-in Embedding API:** Chrome ships a generation model (Prompt API/Gemini
  Nano) but no embedding counterpart (developer.chrome.com/docs/ai/built-in, checked
  2026-07-13). Impact is limited to **semantic/vector** retrieval — one candidate
  mechanism for D-033 tiers 2–3; tag/world-graph and lexical retrieval (e.g., BM25)
  need no embedder — but choosing it means shipping an app-owned embedder (candidate
  models range from tens to hundreds of MB; size/quality is measured when a candidate
  is picked, not assumed). If built, measure embedder load time, VRAM, and render
  contention. Proposed improvement: an embedding API sharing the already-downloaded
  Nano runtime.
- **Service worker vs. V8 code cache:** does serving the shell's JS/wasm through SW
  Cache Storage preserve code-cache behavior, or must code stay HTTP-cache-served for
  warm-launch compile avoidance? (D-015; measure both arrangements.)
- **Storage truthfulness:** `estimate()` vs. actually-writable space at 100 GB scale;
  `persist()` grant/denial behavior; whether Storage Buckets provide real
  durability separation for saves (P-006).
- **Compute limits:** WebGPU compute dispatch/watchdog limits vs. AAA-scale culling and
  particle workloads.
- **GPU memory attribution:** what can a page actually know about its own GPU memory
  footprint? (Likely a finding: not enough.)

Cross-Origin Storage readiness questions (D-010; exercised for real in plan.md M8 when
COS APIs exist):

- **Deterministic-build feasibility per artifact class:** which parts of the toolchain
  (TS bundling/minification, Rust/wasm, asset packing) resist byte-reproducibility, and
  at what cost is it enforced? (M0's double-build hash check produces the evidence.)
- **COS sharing in practice:** does hash-keyed COS make a many-games platform's
  per-game cost content-only — and how far does sharing extend beyond bytes (V8 code
  cache via the in-flight COS code-cache work; Dawn/PSO caches as a further step)?
- **Common/game split pressure:** where does the packaging split leak (assets that are
  almost-common, engine patches that are game-driven), and what does that imply for a
  hash-based sharing index?

## Findings

## RE-048: CDP attributes Chrome-owned omnibox targets to the app browser context

- **Date / Chrome version:** 2026-08-09; Chrome for Testing Stable 151.0.7922.108,
  revision `@4744b886309d987d292e43232776d2206cccb13d`, Windows 11 dev-01 / RTX 4080
  SUPER / physical 3840x2160@60 console.
- **Layer:** CDP target topology / V8 heap attribution.
- **Status:** open; bounded in Parallax's all-realm heap collector.
- **What we expected / What happened:** `Target.getTargets` previously exposed exactly
  the app page plus its eight long-lived dedicated workers under the page's
  `browserContextId`. Chrome 151.0.7922.108 additionally exposed two Chrome-owned
  `browser_ui` targets under that same ID:
  `chrome://omnibox-popup.top-chrome/` and
  `chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html`. The exact app-realm
  topology gate therefore invalidated all six heap measurements even though the M3
  core and every other mandatory surface completed.
- **Repro:** run the registered physical `smoke@1` with the .108 pin and inspect the
  `Target.getTargets` identities captured by the all-realm sampler. Failed report
  `smoke-1-1100d5e4e754-dev-01-showcase-2026-08-09T19-12-39-211Z.{json,md}` has
  JSON/Markdown SHA-256
  `3d52c3b35f4ae9171b0bf5a44982f56d039e772722f216b0d376dd8a7d032ef9` /
  `8039daa4e46e670d5908f5137f1f879a4b37b2d698bbf7225c688d5148522423`.
- **Impact on Parallax:** browser-owned UI is not an application realm and cannot be
  charged to page-attributed heap. The collector now excludes only targets whose type
  is exactly `browser_ui` and whose URL uses `chrome://`; the app page, every expected
  dedicated worker, and the absence of any other same-context target remain exact and
  fail closed. Positive and negative topology fixtures cover that boundary.
- **Proposed improvement:** CDP should either keep browser-owned UI out of a web page's
  browser-context target set or expose an explicit ownership/attribution field so
  collectors do not infer ownership from target type and privileged URL scheme.

## RE-047: D-143 found no page-visible frame lock or presentation attribution across DOM and worker WebGPU

- **Date / Chrome version:** 2026-08-08; pinned Chrome for Testing 151.0.7922.71 on
  Windows 11 dev-01, RTX 4080 SUPER, physical 3840x2160@60 console; executable SHA-256
  `112b7b761c1b6cfa898c56e725f87f7a999a16a0d367d5345824d53336f52acc`.
- **Layer:** DOM / OffscreenCanvas / WebGPU / compositor observability.
- **Status:** open.
- **What we expected / What happened:** D-143 needed to decide whether main-thread DOM
  could remain visually attached to a moving point rendered by a worker-owned WebGPU
  canvas. The bounded apparatus identified and used neither a transaction that
  associates a DOM update with a particular worker canvas frame nor a page API that
  reports when both layers were composed and presented. This is an experiment-bounded
  observation, not an exhaustive current-Chrome source audit. The best available
  correlation in the probe was an absolute monotonic timestamp plus frame-ID
  acknowledgement round trip, checked against captured pixels.
  On the registered ten-minute 12 m/s route, DOM round-trip staleness was p95 2 frames
  and maximum 4 across 36,063 worker frames, while the in-canvas marker remained at
  p95 0. Captures at 60, 300, and 540 seconds measured 10.616, 5.028, and 9.722 px of
  centroid separation against a predeclared 4 px visual-detachment limit.
- **Repro:** the consumed `ui-substrate-probe@1` report is
  `ui-substrate-probe-1-a41718b70818-dev-01-2026-08-08T23-08-45-806Z.json` (SHA-256
  `32b6bd7678b98b9217c8115935ddd544ed76fbb96b91b6b2e7f0d63df40d13b1`), source commit
  `d27adb41164a6bb14a1533ceca76d6450fd6aca2`, dirty-tree digest
  `a2442e785bdeea2521fc06508e15c13c502a338c3d78b28c1100713abe160515`.
  D-099's verified ignored reconstruction bundle preserves the exact apparatus after
  closed-experiment cleanup. The worker rendered a cyan marker and published the
  moving world point's normalized screen-space projection; the main thread transformed
  a magenta DOM marker and
  acknowledged the source frame after application. The harness sampled the worker's
  last acknowledged source frame and captured both marker colors at three fixed route
  checkpoints. The raw scenario mistakenly labeled threshold-exceeding captures
  `invalid`; D-160 adjudicates that harness schema defect using an independent
  Python/Pillow scan of the immutable PNGs that exactly reproduced their hashes,
  pixel counts, and centroid distances.
- **Impact on Parallax:** D-160 places world-anchored UI in-canvas. DOM remains eligible
  for the measured HUD and inferred dialog surfaces, but Parallax cannot authoritatively
  distinguish DOM scheduling delay, compositor-layer skew, canvas presentation delay,
  or capture timing. Any future substrate rerun must retain round trips and screenshots
  as approximations until a suitable boundary is identified or exposed.
- **Proposed improvement:** expose a frame transaction/token that lets a worker canvas
  submission and main-thread DOM update target the same composition, plus page-visible
  composed/presented IDs and timestamps for both layers. At minimum, DevTools/Perfetto
  should correlate the DOM commit, canvas frame, compositor frame, and successful
  presentation under one page-attributed identity.

## RE-046: Chrome exposes no origin-scoped proof of HTTP, V8, or Dawn cache eviction

- **Date / Chrome version:** 2026-07-31; pinned Chrome for Testing 151.0.7922.34 on
  Windows 11 dev-01; executable SHA-256
  `409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`.
- **Layer:** uninstall lifecycle / cache observability.
- **Status:** open.
- **What we expected / What happened:** D-024 requires measured full-removal coverage.
  Both client-side teardown and the direct-network `Clear-Site-Data` path could prove
  that unique nonempty OPFS, service-worker, Cache Storage, and IndexedDB sentinels were
  gone and that quota usage fell. The available cache probes could not prove the same
  for the origin's HTTP cache, V8 code cache, or Dawn GPU caches. CDP response cache
  flags and GPU histograms are cumulative/process-level signals, and V8 trace events do
  not expose an origin-scoped code-cache inventory or deletion operation.
- **Repro:** run the D-147 `uninstall-verification@1` physical qualifier in two fresh
  profiles. It records before/after CDP network-cache flags, V8 trace event counts, and
  D3D12/Dawn histogram probes around each destructive path while separately proving the
  four observable storage surfaces. The accepted primary result is
  `uninstall-verification-v3-2026-08-01T01-42-43-231Z.json` (SHA-256
  `3a4f177af4d6b12dce9b2063ef09c9f1b75e2485751c236487c9f24864d32e9b`).
- **Impact on Parallax:** the uninstall UI and evidence can truthfully claim removal of
  app-owned origin storage plus positive quota release, and the header can request
  storage/cache clearing, but Parallax cannot independently verify complete eviction of
  those three browser-managed caches. They remain explicit `unobservable` facets rather
  than inferred successes.
- **Proposed improvement:** expose a privileged, origin-scoped cache-inventory and
  eviction-result diagnostic covering HTTP resources, V8 code artifacts, and WebGPU
  pipeline/shader caches, with attribution strong enough for an installed web
  application's uninstall verifier. A production app need not receive cache contents;
  exact affected-entry/byte counts and completion identity would be sufficient.

## RE-045: Dedicated workers can observe but cannot request persistent storage

- **Date / Chrome version:** 2026-07-29; pinned Chrome for Testing 151.0.7922.34 on
  Windows 11 dev-01; executable SHA-256
  `409805a16d6416087e6b2f778df1cf8f7bbb267d6b99f6b5bb0a618eace234f2`.
- **Layer:** storage / worker API surface.
- **Status:** open.
- **What we expected / What happened:** D-133 needs its installer worker to own OPFS,
  quota observation, and network transfer without main-thread work. A fresh-profile
  visible-Chrome `DedicatedWorkerGlobalScope` exposed working
  `navigator.storage.getDirectory()`, `estimate()`, and `persisted()` plus OPFS sync
  access handles and Web Locks. `persisted()` returned `false`, but
  `navigator.storage.persist` was `undefined`. The one-byte sync write/flush/size/read
  boundary and exclusive-lock query succeeded. The ignored schema-v1 result SHA-256 is
  `abf808f0ab4fffc00e4ae71b431fe240e77ee0d5d95986b3dd5eea18dabe2d6b`.
- **Repro:** launch pinned visible Chrome at a fresh localhost profile, create a
  dedicated worker, enumerate the four `StorageManager` methods, call
  estimate/persisted/getDirectory, create and flush a sync access handle, and acquire
  and query one exclusive Web Lock. The exact disposable probe is retained under
  `harness/results/d133-surface-probe/`.
- **Impact on Parallax:** installer transfer, quota estimation, OPFS writes, and lock
  ownership remain correctly worker-owned, but the meaningful user-gesture persistence
  request must cross a separate main-thread UX boundary. D-133 observes persistence
  state and deliberately does not attempt a worker fallback.
- **Proposed improvement:** expose `StorageManager.persist()` to dedicated workers when
  a user-activation token or explicitly delegated permission is available, so a
  long-running native-class installer can keep its complete storage lifecycle in one
  realm. The checked 2026-07-29 Storage/File System/Web Locks specifications match the
  observed split; this is a capability request, not a Chrome/spec discrepancy.

## RE-044: A localhost worker fetch rejected opaquely before streaming provisioning

- **Date / Chrome version:** 2026-07-26; pinned Chrome for Testing 151.0.7922.34,
  Windows 11/dev-01 physical console, Chromium/Dawn D3D12, NVIDIA GeForce RTX 4080
  SUPER.
- **Layer:** network / dedicated streaming worker / harness observability; exact cause
  unresolved.
- **Status:** open observability finding; not a Chrome defect claim.
- **What we expected / What happened:** the final post-review `smoke@1` candidate
  should provision the fixed D1 packages from the harness's live localhost server
  before its first fresh measurement. The first attempt instead completed zero of six
  runs after the streaming cohort surfaced only `Failed to fetch`. Environment
  validation, post-run source identity, and report persistence still measured
  successfully. The one immediate unchanged-artifact classification retry then
  completed all six launches and passed all three facets and 30/30 checks.
- **Evidence / repro:** failed report
  `smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-35-18-277Z.json`
  (SHA-256
  `91d839dddf16644dafb3576b5f4a06e6551ee06219bb88527423d915caaa5827`)
  and passing retry
  `smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
  (SHA-256
  `ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
  share artifact
  `8e932618990f1c6d1fb8aaab2db2bbba016c7b2c21e41eda32d375798d51d87d`
  and source dirty-tree digest
  `5c9052b43203032b2049a547ff55fe532dbd087f03ed645f5149dc2846955c8f`.
  Run pinned `pnpm harness:smoke` on registered dev-01 Showcase; the failure has
  occurred once and is not yet a deterministic reproduction.
- **Impact on Parallax:** the failed result remains immutable and cannot carry a
  budget verdict. Its one same-artifact retry supplies the final qualification without
  erasing the failure. Further blind retries are not authorized.
- **Proposed improvement:** on recurrence, retain the exact provisioning fetch phase
  and resolved URL plus the localhost server's request/status counters inside the
  core-run failure. Use that evidence to distinguish a missing request, client abort,
  server response, or worker-side network rejection before reducing this to a
  standalone Chrome reproduction or filing a browser defect.

## RE-043: Public benchmark p95 variance remains unattributable across worker and GPU boundaries

- **Date / Chrome version:** 2026-07-25; pinned Chrome for Testing 151.0.7922.34,
  Windows 11/dev-01 physical console, Chromium/Dawn D3D12, NVIDIA GeForce RTX 4080
  SUPER.
- **Layer:** application measurement / cross-realm scheduler / WebGPU queue; exact cause
  unresolved.
- **Status:** open research and observability gap; not a Chrome defect claim.
- **What we expected / What happened:** after D-108 removed per-load asynchronous OPFS
  lookup/open/close, three continuous-page repeats of the exact 4K ten-minute route
  should still keep each relied-on p95 within the unchanged 10% relative-range limit.
  The first complete post-D-109 run measured streaming p95 at
  2.265/2.915/2.950 ms (30.243%); its one permitted same-artifact retry measured
  2.735/3.325/3.075 ms (21.572%) and render-duration p95 at
  0.330/0.375/0.310 ms (20.968%). Every individual streaming p95 passed 250 ms,
  callback p95 was stable in both runs, and both recorded zero Window Long Tasks, but
  the repeatability failures correctly invalidated scenario evidence.
- **Evidence / repro:** retained reports
  `harness/results/benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T21-28-45-673Z.json`
  and
  `harness/results/benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T22-04-07-075Z.json`
  (`benchmark-result@1` schema v3, artifact
  `ff05ec211444b89d8c706305205cc60908a140be6af2f2e3ed4ba20a31cded7e`).
  Both completed three exact 600,000 ms `flythrough-d1@1` repeats. Replay selects 92
  contiguous samples per repeat at sequences 64–155, 219–310, and 374–465 and
  reproduces the stored nearest-rank p95s. Every measurement boundary records 256/256
  packages/open handles.
- **Current localization:** OPFS-wait p95 was only 0.080–0.140 ms. Decode-round-trip,
  render-upload-round-trip, and render-commit-round-trip p95s each moved between
  repeats, with no stable replacement for the old OPFS residual as a dominant cause.
  Page-owned timestamps measure the application boundaries but cannot separate worker
  dispatch, browser/OS service, and GPU queue activity inside or between them. The
  reports establish neither a code/aggregation defect nor a generic Chrome defect.
- **D-113 privileged result:** retained invalid-partial report
  `m1-exit-diagnostic-1-12e68fa57ea7-dev-01-showcase-2026-07-26T01-24-11-033Z.json`
  proved its 75 ms worker control as a 75.083 ms mark inside one 75.338 ms task, but
  correlated only the biased first 41/92 canonical cells (sequences 64–104, batches
  9–30). All 306 expected stage marks for the later 51 cells were absent. The prefix
  cannot compare repeats or localize their variance; full-window worker long tasks,
  GPU queue completion, and successful presentation remain unsupported. D-114 closes
  the apparatus without a variance fix or a new Chrome-defect claim.
- **Impact on Parallax:** D-115 completes the M1 Benchmark mode implementation task
  from its complete fail-honest lifecycle/results while leaving both 10% failures
  unchanged. The page artifact is advisory and intentionally incomparable with the
  authoritative fresh-profile flythrough, so it is no longer a duplicate M1
  performance qualification. D-110's full retries and D-111/D-113's one-shot
  diagnostic are consumed; no further diagnostic or complete public benchmark is
  authorized or required for M1. The variance remains an open research/observability
  gap for a future directly triggered investigation, not a passing metric or a Chrome
  defect claim. Recovery, smoke, bulk review, and unrelated gates do not rerun it.
- **Research boundary:** D-114 removed the closed privileged correlation path. Any
  future attempt to separate worker dispatch, OPFS/decode work, WebGPU
  submission/completion, and render-loop activity needs a new bounded experiment and
  explicit decision against then-current Chrome evidence; do not restore D-111's
  apparatus wholesale. Only evidence that isolates a browser/platform boundary should
  mature this into a Chrome-facing claim.
- **D-122 trigger and malformed result:** D-121's production smoke and its one permitted
  same-artifact retry both completed six launches, target pre/post verification, and
  30/30 absolute checks, but respectively exceeded D-116's fresh+warm and warm-only
  1 ms repeatability floor. The slow cells again concentrate outside direct OPFS work,
  in render upload/commit round-trip wait. D-122 authorized one smaller direct-port
  diagnostic to separate request preparation, streaming-to-render dispatch,
  render-worker operation and bookkeeping, and acknowledgement plus streaming
  continuation. It cross-checks those components against the unchanged ordinary
  upload/commit round-trip samples and preserves the existing render-worker `uploadMs`
  endpoint.
- **D-122 retained invalid evidence:** D-122's only invocation is consumed and retained
  at
  `harness/results/streaming-tail-diagnostic-1-bb200ab2c331-dev-01-showcase-2026-07-26T20-22-38.699Z.json`
  (SHA-256
  `75165f270397e89f064763159e96823b3df3354524eecc114c8a800ceccd6bd3`;
  source commit `7fdc5465b5903751301a4e319a160848eacefac6`, dirty-tree digest
  `68ae52d5d89b3c40dd51096acf989ca9e77cc06676fda3f043421fe9845aaa6a`).
  Its production preflight/postflight and registered physical dev-01/Showcase
  environment gate were valid, but the result remained invalid with six null evidence
  fields: every attempt stopped at the first readiness predicate because its serialized
  page callback referenced the unavailable Node-module
  `TELEMETRY_SCHEMA_VERSION`. It produced no timing, controls, correlation, runtime,
  or platform evidence and does not change RE-043's attribution status.
- **D-123 replacement / D-124 closure:** the exact no-retry replacement was consumed
  against the same verified `bb200ab2c331...` production artifact and is retained at
  `harness/results/streaming-tail-diagnostic-1-bb200ab2c331-dev-01-showcase-2026-07-26T20-47-12.563Z.json`
  (SHA-256
  `69e5af5598b06ca5eea99b649049d1d2803ef8638ae2d74cc0c9e886e0c9c4a6`;
  source commit `7fdc5465b5903751301a4e319a160848eacefac6`, dirty-tree digest
  `aae43b0e5ba3e8531acf386a5ea09b44edb5e6f4abe1dec695dcd97f04489f8f`;
  consumption-record SHA-256
  `44558176c73a60f21aca9dff9d9cb154dc7a0868731e4bead017b2cea148a74f`).
  Production preflight/postflight and the registered physical dev-01/Showcase
  environment passed with pinned Chrome for Testing 151.0.7922.34. The result remains
  `invalid`, `qualifies: false`: exactly five attempts have valid evidence and fresh
  repeat 2 is null because `control 8 timestamps are misordered`; GPU completion is
  unsupported and no retry is authorized.
- Across the valid attempts, ordinary total p95s were 2.010, 1.515, 2.065, 1.700, and
  2.515 ms. The illustrative warm-repeat-3 nearest-rank total-p95 cell measured
  2.515 ms; its 1.770 ms commit round trip consisted of 1.195 ms outbound dispatch,
  0 ms worker operation/bookkeeping, and 0.575 ms acknowledgement/continuation, while
  direct OPFS access/read, decode, upload operation, and streaming-worker remainder
  stayed small. This localizes application-visible waiting across the streaming/render
  realm boundary but cannot identify browser versus OS scheduling and does not observe
  GPU completion or presentation. It supports no Chrome defect claim, runtime
  scheduling prescription, metric deletion, or D-116 change.
- D-124 leaves this entry open, preserves both retained results/consumption records and
  verified D-099 bundles, and removes the complete closed experiment. A future
  investigation requires a new directly triggered bounded decision; do not restore the
  D-122/D-123 apparatus wholesale.
- **D-125 bounded product correction:** the final cleaned D-121 production smoke is
  retained failed at
  `smoke-1-8e932618990f-dev-01-showcase-2026-07-27T00-17-19-184Z.json`
  (SHA-256
  `dbc45ae35014b9010f3c84e7ca56c8288756a5b91d6327a324b3f722d9ba061b`).
  All absolute checks passed; fresh repeatability passed, while warm
  3.380/2.055/2.730 ms p95s spread 1.325 ms. D-125 removes the application-owned
  per-cell message amplification by making each scheduler load batch one atomic upload
  plus commit transaction. It does not change D-116, claim GPU completion, or identify
  browser versus OS scheduling. RE-043 therefore remains open.
- **D-126 bounded product correction:** D-125's exact production artifact
  `d6ed5d3560c498f62071d6f235baec32191ad7b0cac4172908919159144a7189`
  is retained failed in
  `smoke-1-d6ed5d3560c4-dev-01-showcase-2026-07-27T01-43-29-439Z.json`
  (SHA-256
  `ec93b944b8ca296f4462f389cef806939d036a3b0fc76463aa0e6803ce27fd7f`).
  All 30 absolute checks passed. Warm 3.170/3.515/4.140 ms p95s passed at
  0.970 ms spread; fresh 4.245/3.585/2.995 ms failed at 1.250 ms. D-125's
  three-cell batching had reduced twelve messages to four (3×); D-126 removes
  the remaining commit crossing and uses one request/response with reverse rollback.
  It still does not observe GPU completion or distinguish browser from OS scheduling,
  so D-116 is unchanged and RE-043 remains open.
- **D-127 qualification boundary:** the one authorized post-D-126 production report
  `smoke-1-9d4c1be5c290-dev-01-showcase-2026-07-27T02-43-18-518Z.json`
  (SHA-256
  `ca7a7288ecf6d44787ed1a2f685459c3e81a364cc3d1218adc91dd4d97d681b9`)
  passed all six launches, all three facets, and 30/30 checks on exact artifact
  `9d4c1be5c290133a58c9ad90327591804121b226be84cae4c333d3442f2dc86b`.
  Fresh p95s 1.980000019/2.024999976/2.314999938 ms spread
  0.334999919 ms; warm p95s 1.639999986/1.694999933/2.375 ms spread
  0.735000014 ms. Both passed D-116's unchanged 1 ms arm. Every launch retained
  74 requests and 74 completed transactions, but one passing short-smoke cohort
  supplies no causal distinction between browser, OS scheduler, or GPU completion.
  RE-043 therefore remains open.

## RE-042: Continuous-page 4K streaming exposes unstable asynchronous OPFS access residuals

- **Date / Chrome version:** 2026-07-25; pinned Chrome for Testing 151.0.7922.34,
  Windows 11/dev-01 physical console, Dawn D3D12, NVIDIA GeForce RTX 4080 SUPER,
  driver 32.0.16.1074.
- **Layer:** application-observed OPFS access / browser scheduling under the full 4K
  workload; browser-internal cause unresolved.
- **Status:** application boundary removed by D-108 and physically exercised with
  256/256 open handles; the old residual did not recur. Not a Chrome defect claim.
- **What we expected / What happened:** three continuous-page repeats of the same
  ten-minute route should keep streaming cell-load p95 within 10%. Individual totals
  passed at 9.115/28.005/48.025 ms, but their 426.879% relative range failed.
  OPFS-access p95 rose from 7.405 to 25.780 to 46.155 ms while actual synchronous read
  p95 stayed at 0.040/0.045/0.045 ms. High values clustered within particular load
  batches and the same cells were fast in other repeats; this was not a monotonic read
  slowdown.
- **Evidence / repro:** retained
  `harness/results/benchmark-result-1-9a218e2fe23a-dev-01-showcase-2026-07-25T19-54-39-399Z.json`
  (`benchmark-result@1` schema v2, exact 3840×2160, 92 contiguous measurement samples
  per repeat). The pre-measurement 63-load windows also shifted from
  10.360/10.110 ms OPFS-access p95 to 28.170 ms before repeat 3. Run the complete
  in-game Showcase benchmark in one physical-console page lineage and inspect
  `opfsAccessRoundTripMs`, `opfsReadMs`, and `opfsWaitMs`.
- **Bounded control:** an otherwise-idle headed pinned-CfT probe over 256 4 KiB OPFS
  files measured lookup/open/read/close total p95 at 0.605/0.540/0.540 ms for three
  155-operation repeats, so the retained result does not establish a generic
  access-handle lock leak. Holding all 256 handles succeeded; open p95 was 0.080 ms and
  cached-read p95 was 0.270/0.310/0.240 ms.
- **Impact / mitigation:** D-108 opens and validates the fixed district handle set once
  per streaming-worker generation and makes measured reads synchronous through those
  handles. Telemetry exposes exact package/handle count and startup-open duration.
  D-110's two later full runs retained 256/256 handles and OPFS-wait p95 no greater
  than 0.140 ms, so this former dominant residual did not recur. Their separate
  distributed repeatability failure is RE-043. The 10% rule remains unchanged, and the
  failed advisory reports remain evidence. D-115 supersedes the former extra
  recovery-rerun requirement based on later physical exercise of the shared 256-handle
  generation initializer; it does not claim the combined post-D-108 fault path was
  remeasured.
- **Remaining platform ask:** expose OPFS directory lookup, access-handle lock/service,
  and completion-dispatch phases on a low-overhead performance timeline so a full-app
  residual can be attributed without changing the application boundary.

## RE-041: Failed smoke streaming validation discarded the snapshots needed to identify a reachable transient state

- **Date / Chrome version:** 2026-07-25; pinned Chrome for Testing 151.0.7922.34
  (`@782af9cb30a53f54487e5d2e44738645a8ec457c`), Windows 11/dev-01 physical console,
  Dawn D3D12, NVIDIA GeForce RTX 4080 SUPER, driver 32.0.16.1074.
- **Layer:** Parallax harness evidence retention and streaming snapshot validation; no
  Chrome defect is established.
- **Status:** harness defect corrected by D-103; exact-artifact schema-v35 physical
  confirmation passed. No Chrome defect is established.
- **What we expected / What happened:** final exact-artifact routine smoke should have
  retained enough evidence to explain any invalid core attempt. Instead,
  `smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-15-06-917Z.json`
  on artifact
  `20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`
  passed environment identity and its first three core runs, then stopped at warm
  repeat 2 / launch 4 with only the aggregate error
  `World-streaming telemetry does not satisfy the M1 streaming contract`. Schema v34
  retained neither the start nor end streaming snapshot for that attempt, so the exact
  failed predicate cannot be reconstructed.
- **Evidence / repro:** the streaming producer evicts scheduled residents before
  awaiting replacement loads and publishes telemetry after both operations. The short
  `smoke@1` measurement takes independent snapshots without a settlement wait.
  Therefore an unsettled snapshot with fewer than nine residents is reachable, but the
  former validator unconditionally required nine. A deterministic model reproduces the
  producer-valid shape with non-flythrough observer sequence 0, a complete prior
  boundary, an unsettled start, a short non-full-ring window, and an active partial end
  batch with eight residents. A settled variant returns to nine residents.
- **Impact on Parallax:** the original launch-4 cause remains unknown and retained.
  The later schema-v35 pass qualifies the exact artifact's final D-097 smoke without
  reinterpreting that failure. The flythrough qualification is unaffected.
- **Resolution:** D-103 advances `smoke@1` report schema to v35 while keeping mandatory
  metric set v18. Invalid streaming attempts retain a localized validation reason and
  complete raw start/end snapshots; successful values retain the measured start
  resident count for stored-report revalidation. Unsettled residency may be below nine
  only when exact resident/load/eviction conservation holds; settled snapshots still
  require nine. Batch identity and completion rules are unchanged. Exact-artifact
  report
  `smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-34-23-655Z.json`
  then passed all six runs, all environment/evidence/budget facets, and 30/30 checks
  with no failure under schema v35 / metric set v18.
- **Reopen if:** schema-v35 physical evidence rejects a conserved producer-valid state,
  a settled producer snapshot contains fewer than nine residents, or the retained
  payload identifies a separate recurring defect.

## RE-040: Ten-minute streaming cell-load p95 tail is not attributable with direct-work timings

- **Date / Chrome version:** 2026-07-25; pinned Chrome for Testing 151.0.7922.34
  (`@782af9cb30a53f54487e5d2e44738645a8ec457c`), Windows 11/dev-01 physical console,
  Dawn D3D12, NVIDIA GeForce RTX 4080 SUPER, driver 32.0.16.1074.
- **Layer:** storage / scheduler; resolved to the application-observed OPFS-access wait
  boundary, without finer browser/OS-internal causal attribution.
- **Status:** resolved at D-102's bounded application-stage granularity; not a Chrome
  defect claim.
- **What we expected / What happened:** D-101's corrected `flythrough-d1@1` physical
  run completed all three ten-minute repeats on one artifact and every individual
  streaming observation remained under the 250 ms absolute budget. Cell-load p95 was
  23.975, 30.820, and 22.230 ms, however, so the 38.641% relative range correctly
  failed the unchanged 10% repeatability rule. Each repeat contained 92 samples.
  Medians, means, and p90s varied by only about 7.5–8.8%; the divergence appears only
  in the upper tail.
- **Evidence / repro:** retained report
  `harness/results/flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T08-17-32-898Z.json`
  (`flythrough-d1@1`, report schema v3/metric set v3, artifact
  `68c66fccf453fcbe5451f1c68ad5a755d97afe644ecae16b80c1921dcaa0803d`).
  Direct-work p95s were 0.100–0.105 ms for OPFS reads, 0.140–0.195 ms for decode, and
  1.500–1.915 ms for render upload, leaving 21.550–29.945 ms of p95
  schedule-to-commit time outside those fields. The flythrough report is schema v3 and
  embeds streaming telemetry v2; neither contains batch IDs. Deterministic replay of
  its recorded cell sequence through the unchanged scheduler, rather than recorded
  report evidence, partitions repeat 2, when viewed as the two nine-sequence windows,
  as 3/1/3/1/(a two-cell batch crossing the window boundary) for sequences 82–90 and
  1/3/1/3 for sequences 91–99. The inferred tail clusters are the three-cell batches at
  86–88 and 97–99, with 33.385 and 31.120 ms peaks. Run
  `pnpm harness:flythrough-d1` on the registered physical console and inspect each
  repeat's retained streaming samples and p95 variance.
- **Resolution evidence:** retained report
  `harness/results/flythrough-d1-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-07-24-028Z.json`
  (schema v4/metric set v4, artifact
  `20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`)
  passed all three facets and 15 checks across three measured repeats. Streaming
  cell-load p95 was 22.810/23.895/22.000 ms and its 8.614% relative range passed.
  OPFS-access wait dominated component p95 at 17.635–18.025 ms; decode wait was
  1.835–2.180 ms, render-upload wait 1.595–1.770 ms, render-commit round trip
  1.975–2.205 ms, and streaming-worker remainder 0.010–0.015 ms. All three
  traces were complete and lossless, and each repeat retained 3,002 heap samples with
  zero missed deadlines.
- **Impact on Parallax:** the final D-102 report qualifies the scripted flythrough
  without a scheduling change or relaxed gate. It identifies the bounded stage that
  owns most of the observed p95, but does not distinguish handle acquisition,
  filesystem service work, or other browser/OS activity inside the OPFS-access round
  trip. D-115 later accepts the runner's platform-unobservable omissions as enumerated
  M1 coverage gaps without counting them as passes; visible-pop and district-transition
  checks remain their documented M5/M4 scope.
- **Current instrumentation:** D-102's streaming telemetry v3 adds deterministic batch
  identity and same-streaming-worker OPFS/decode/upload/commit round trips plus derived
  waits and worker remainder. The harness validates the decomposition within 0.1 ms
  and retains component p95s. It exchanges only local durations across workers, never
  realm-local timestamps.
- **Remaining platform ask:** expose low-overhead OPFS operation phases correlated with
  Performance Timeline so a measured access round trip can be separated into browser
  scheduling, handle acquisition, and filesystem-service work without application
  guesswork.

## RE-039: Non-reproducible P-002 CPU and WebGPU timestamp p95 instability record

- **Date / Chrome version:** 2026-07-25; pinned Chrome for Testing 151.0.7922.34
  (`@782af9cb30a53f54487e5d2e44738645a8ec457c`), Windows 11/dev-01 physical console,
  Dawn D3D12, NVIDIA GeForce RTX 4080 SUPER, driver 32.0.16.1074.
- **Layer:** scheduler / WebGPU-Dawn timestamp queries / harness observation; causal
  attribution is unresolved.
- **Status:** non-reproducible machine-local measurement record; causal attribution is
  unresolved and this is not yet a reportable platform defect.
- **What we expected / What happened:** `geometry-representation@5` kept candidate,
  profile, fixed worker workload, render surface, source D1 geometry, and light state
  constant within each arm. After a fixed 1,200-frame warmup, GPU p95 had three to six
  sequential 600-frame windows to stabilize at a 10% relative-range limit; each light
  state then had three 1,800-frame measured repeats. All 18 captures completed without a
  worker failure or console error, RAF p95 passed the repeat gate, and timestamp queries
  were supported, but CPU and GPU p95 eligibility was not stable enough for a complete
  candidate comparison.

  CPU repeat relative range exceeded 10% for triangle/Showcase storm (10.526%) and
  triangle/Standard clear, overcast, and storm (10.638%, 14.000%, 25.455%);
  meshlet/Showcase overcast (16.438%) and meshlet/Standard storm (17.187%); and
  splat/Showcase clear and storm (18.868%, 15.385%) plus splat/Standard clear and
  overcast (24.074%, 24.561%). GPU repeat relative range exceeded 10% for
  meshlet/Showcase storm (24.468%), meshlet/Standard clear (35.294%),
  splat/Showcase clear (29.508%), and splat/Standard overcast (50.000%).
  Triangle/Standard storm, meshlet/Showcase clear, and splat/Standard overcast also
  failed the unchanged GPU stabilization gate after 3,600 frames.
- **Evidence / reproducibility:** the best-effort machine-local raw samples, repeat
  p95s, stabilization windows, environment identity, and eligibility reasons remain in
  `harness/results/geometry-comparison-p002/dev-01-2026-07-25T04-15-34-944Z/report.json`
  (`geometry-representation@5`, report schema 5, metric set 5; artifact
  `82e2c3f434d39b49ad9e2eb528e18c9bc8787cb1c9b3031d3daf95951724e2ce`,
  source commit `6f2fb1e9814904c733a64b4a629051c46c3fe145`, dirty-tree digest
  `31dfd73f73fd32f0b3239393a28323bba6caa067b3c0e1c449bfd504b72bb8d5`).
  D-081 keeps this directory ignored, and the comparison source was created and deleted
  before any human commit. Searches of tracked files, git history, and the available
  temporary tree found no exact source patch or snapshot. The commit and dirty-tree
  digests identify but do not reconstruct the source. Exact rerun from tracked state is
  impossible; the raw report is therefore an evidence aid, not a durable reproduction.
  D-099 adds a complete source-identity reconstruction guard for future same-gate
  experiments, but it was not met here and cannot repair P-002 retroactively. The
  earlier rejected `geometry-representation@1` directory is not performance evidence.
- **Impact on Parallax:** P-002's aggregate evidence failed closed and cannot rank any
  candidate on performance. D-098 retains the already-qualified triangle incumbent
  because no challenger supplied valid displacement evidence. No standing budget is
  changed or claimed failed.
- **Proposed improvement:** build a fresh, source-snapshotted raw-WebGPU timestamp-query
  and CPU-submit probe with scheduling/thermal/clock telemetry, then run it on dev-01
  and the registered Standard/Metal target. Only that new experiment can attribute the
  unstable component and decide whether Chrome, Dawn, the timestamp-query surface, or
  the harness needs a concrete change.

This finding is deliberately limited to pinned Chrome 151/Dawn D3D12 on dev-01. The
Standard-profile render size measured on dev-01 is advisory and says nothing about the
registered Standard M1 Pro/Metal target. The data does not establish a browser defect,
driver defect, thermal cause, timestamp-quantization cause, or general WebGPU limit.

## RE-038: TypeScript's WebAssembly declarations omit the standardized memory64 descriptor

- **Date / Chrome version:** 2026-07-19; TypeScript 7.0.2 typecheck and pinned Chrome for
  Testing 150.0.7871.115 runtime on Windows 11/dev-01.
- **Layer:** TypeScript DOM/WebWorker declarations for the WebAssembly JavaScript API.
- **Status:** open ecosystem typing gap; historical local workaround removed with the
  closed experiment under D-117.
- **What we expected / What happened:** current WebAssembly JS API memory64 construction uses
  `{ address: "i64", initial: 1n, maximum: ...n }`, and Chrome 150 accepts it without a flag.
  TypeScript's `WebAssembly.MemoryDescriptor` still requires Number-valued `initial` and
  `maximum`; strict typecheck rejected both BigInts (`TS2322: Type 'bigint' is not assignable
  to type 'number'`).
- **Repro:** recover D-086's removed worker from git history, remove its documented
  `unknown as WebAssembly.MemoryDescriptor` boundary, and run `pnpm typecheck`. Runtime
  behavior was qualified by D-086. The WebAssembly JS API memory/address conversions
  were checked 2026-07-19 at webassembly.github.io/spec/js-api/#memories.
- **Impact on Parallax:** D-117 selected memory32 for every current module, so the gap
  has no live runtime impact. A future JS-created memory64 path would need the same
  audited cast until the library declaration catches up.
- **Proposed improvement:** add the address-width discriminator and BigInt-valued memory64
  descriptor/grow overloads to TypeScript's WebAssembly declarations.

## RE-037: In-process load churn contaminated later Wasm hot-path measurements

- **Date / Chrome version:** 2026-07-19; pinned Chrome for Testing 150.0.7871.115 on the
  dev-01 physical console.
- **Layer:** harness / V8 Wasm compilation, instantiation, tiering, and garbage collection.
- **Status:** our-bug measurement design, fixed in historical `memory64-spike@1`; the
  apparatus was removed by D-117 and the lesson remains rather than being attributed
  to a Chrome defect.
- **What we expected / What happened:** batching thousands of module constructions and
  instances inside the same long-lived worker made the later prepare/kernel cohort vary with
  allocation and tiering state. One rejected artifact reported a repeatable 85 ms memory32
  kernel beside 30 ms memory64; after moving each load batch into a disposable nested worker,
  the same paired kernels returned to near-unity. Dividing independently aggregated arm p95s
  also lost ordinal pairing and amplified unrelated outliers.
- **Repro:** compare invalid artifact
  `memory64-spike-1-f47c8305d390-dev-01-showcase-2026-07-20T01-56-02.743Z.json` with accepted
  `memory64-spike-1-a05e3d13d506-dev-01-showcase-2026-07-20T12-25-10.882Z.json`. The accepted
  runner constructs/instantiates in a nested copy of the content-addressed worker, terminates
  it before prepare/kernel, computes a memory64/memory32 ratio for each adjacent sample, then
  applies p95 and the 10% repeat gate. Raw absolute-arm p95/variance remains separate.
- **Impact on Parallax:** no production path changed. The corrected gate prevents GC/tiering
  garbage and cross-ordinal aggregation from becoming false pointer-width claims.
- **Proposed improvement:** keep disposable-isolate load probes and paired-first aggregation
  as the default pattern for future sub-millisecond or allocation-heavy Wasm comparisons.

## RE-036: Rust/Wasm module-worker initialization intermittently stalls until timeout

- **Date / Chrome version:** 2026-07-19 through 2026-07-25 UTC; pinned Chrome for Testing
  150.0.7871.115 and candidate Stable 151.0.7922.34 on the dev-01 physical console.
- **Layer:** Rust/wasm-bindgen threaded-runtime transform / allocator layout.
- **Status:** fixed upstream in wasm-bindgen 0.2.127 by PR #5225. Parallax removed
  D-093's local binary relocation and retained exact generated-layout guards. No
  timeout was raised and no retry or Chrome-side workaround was added.
- **What we expected / What happened:** the first three six-launch memory64 attempts each had
  one app launch fail before memory64 began. After the runner exposed terminal telemetry, one
  retained failure was the already-qualified D-085 Rust/WASM synthetic worker exceeding its
  10,000 ms service timeout. The memory64 worker itself had not started. Both memory64 query
  modes now leave that unrelated synthetic spike idle while rendering stays live; later
  memory64 attempts reached 6/6 launch eligibility. D-117 later removed both query modes
  with the closed experiment.
- **Original memory64-isolation repro:** artifact
  `memory64-spike-1-484004247a41-dev-01-showcase-2026-07-20T01-58-04.766Z.json`, warm repeat 3.
  The accepted D-086 artifact uses `?memory64Spike=dedicated` and verifies the unrelated
  telemetry section remained idle; the former `?memory64Spike=auto` mode applied the
  same isolation for manual reproductions. Recover that measured source from git
  history if this historical isolation needs inspection.
- **Chrome 151 transition evidence:** the first exact-artifact/same-Node Chrome 150 anchor
  passed 6/6. Of the next five Chrome 151 gates, three stopped at the 10,000 ms Wasm service
  boundary and two completed all six Wasm workloads but failed independently on RE-008. A
  no-tracing isolation completed 4/4 new-profile launches in 32.7–34.6 ms, while one of four
  sequential relaunches of an already-warmed profile timed out after the 12,680-byte module
  compiled in 2.43 ms but before either worker reported ready; later relaunches recovered.
  This falsifies a one-time browser install or first-profile warmup explanation.
- **Phase isolation:** schema-v26 report
  `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-49-36-294Z.json` retained worker
  phases `[0:ready,1:initialize-received]`: both module scripts evaluated and received
  initialization, one instance became ready, and the peer never completed the generated
  binding's synchronous `initSync` call. At the time this was labeled
  `WebAssembly.Instance`; D-092 source inspection established that the same call also
  executes `__wbindgen_start`, so the old phase cannot distinguish those boundaries.
  Independently compiling the same bytes in each worker did not fix
  the boundary: one of eight no-tracing retained-profile relaunches stalled after the peer
  reported `module-compiled`. Serial initialization failed both attempted relaunches with the
  second worker stuck after `initialize-received`, so it was rejected rather than promoted as
  a workaround. D-088 retains concurrent startup, the unchanged timeout, no within-run retry,
  and the phase markers.
- **Qualification/recovery:** exact-artifact Chrome 150 anchor
  `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-46-41-973Z.json` and Chrome 151
  candidate `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` each
  passed all six core launches, all three facets, and 24 checks under Node 24.18.0. The
  Chrome 151 result is promoted; the passing sample qualifies M0 but does not erase the
  intermittent failure or establish that Chrome 151 increased its underlying rate.
  The final D-089 artifact reproduced the same stall on warm repeat 2 in
  `smoke-1-040677b31910-dev-01-showcase-2026-07-21T02-23-23-644Z.json`: the 12,680-byte
  module compiled in 2.365 ms, one worker remained at `initialize-received`, and the
  service failed closed at 10,000 ms. The exact artifact later passed 6/6 in
  `smoke-1-040677b31910-dev-01-showcase-2026-07-21T02-28-50-631Z.json`.
  D-091's final-source schema-v28 attempts reproduced the stall three more times:
  warm repeat 3 in
  `smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-10-12-735Z.json`, then warm
  repeat 1 in both the `00-10-59-880Z` and `00-12-01-644Z` reports. Each compiled the
  same 12,680-byte module in 1.655–3.450 ms, left one worker at `ready` and its peer at
  `initialize-received`, completed zero tasks, and failed closed at 10,000 ms. The
  immediately preceding report-only source state had completed all six workloads,
  reinforcing the existing intermittent classification without qualifying the final
  source state.
- **D-092 attribution probe:** the exact wasm-bindgen 0.2.126 binding constructs the
  instance and then synchronously calls `__wbindgen_start`. Disassembly of the pinned
  optimized fixture found unbounded `memory.atomic.wait32` paths around its shared
  initialization state and allocator lock. Schema v29 therefore records separate
  `module-instantiation-started`, `module-instantiated`,
  `runtime-startup-started`, `runtime-started`, and `ready` phases. Before terminating a
  failed cohort it also snapshots the exact fixture's shared initialization state,
  initialized-instance count, and allocator lock. The deterministic build validates
  those runtime operations and fails if their offsets drift. This instrumentation
  preserves D-088's unchanged 10-second boundary, concurrent startup, and no-retry
  behavior.
- **Measured attribution:** unrelocated schema-v29 artifacts
  `smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-43-30-949Z.json`,
  `smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-46-00-971Z.json`, and
  `smoke-1-2902f53d2fd4-dev-01-showcase-2026-07-25T00-51-29-864Z.json`
  each constructed both instances and stopped with phases
  `[ready,runtime-startup-started]`. All three failure snapshots were
  `sharedInitializationState=2`, `initializedInstanceCount=2`,
  `allocatorLock=43`; the last artifact's preceding successful launch recorded the
  healthy post-initialization control `2/2/0`. The repeated non-lock value is therefore
  corrupted shared runtime state, not a slow compile, module transfer, or instance
  construction.
- **Root cause and local fix:** exact generated-Wasm disassembly showed Rust
  nightly-2026-07-16's dlmalloc 0.2.13 treating
  `[__heap_base, __heap_end)` (1,050,048–2,097,152) as an allocator chunk while
  wasm-bindgen 0.2.126 placed its thread counter at 1,050,048 and lock at 1,050,052.
  Leader startup could write dlmalloc metadata value `43` into the lock before the
  follower's compare-exchange; the follower then waited indefinitely for a lock value
  of `1` to change. D-093 deterministically relocates only wasm-bindgen's scratch state
  into its already-appended page at 2,097,152, explicitly preserves dlmalloc's four
  linker-heap references, and fails the build if either layout drifts. Relocated
  artifact `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T00-58-50-184Z.json`
  passed all six core launches and 30 checks; every cohort recorded `2/2/0` and
  completed in 31.9–39.3 ms with unchanged 33-page memory and 10-second boundary.
  Same-artifact confirmation
  `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-05-37-290Z.json`
  failed independently on RE-008 while all six additional Wasm cohorts again
  recorded `2/2/0` and completed in 33.3–40.2 ms.
- **Current smoke/relaunch repro:** run `pnpm harness:smoke` repeatedly, or launch the built app without tracing in four
  distinct temporary profiles followed by four sequential relaunches of one retained profile;
  wait for `__PARALLAX_TELEMETRY__.snapshot().wasmThreadSpike` to become terminal and retain its
  phase timings. Representative Chrome 151 failed artifacts
  `smoke-1-a05e3d13d506-dev-01-showcase-2026-07-21T00-22-43-440Z.json` and
  `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-49-36-294Z.json` retain the
  coarse and exact-phase gate failures; schema v26 includes terminal subsystem and worker
  phase evidence.
- **Upstream retirement:** wasm-bindgen 0.2.127 places its thread counter, lock, and
  temporary stack at 2,097,152 / 2,097,156 / 2,162,688, outside the original
  allocator-visible range. Parallax's build verifies exact reference counts and rejects
  the legacy overlapping operations without rewriting the generated module. UP-004 is
  closed as shipped upstream.
- **Impact on Parallax:** D-085 remains valid. The local workaround is gone; exact
  layout guards and the ordinary six-cohort smoke remain the regression boundary.

## RE-035: Rust browser threads still require a nightly rebuilt standard library

- **Date / Chrome version:** 2026-07-19; toolchain reproduction on Windows 11/dev-01;
  final browser evidence from pinned Chrome for Testing 150.0.7871.115 on the dev-01
  physical console.
- **Layer:** Rust/LLVM/wasm-bindgen toolchain for V8/wasm threads.
- **Status:** open ecosystem/toolchain limitation; worked around with an exact dated
  nightly under D-085.
- **What we expected / What happened:** current stable Rust 1.97.1 accepted
  `+atomics,+bulk-memory,+mutable-globals,+simd128,+relaxed-simd` and emitted a shared
  memory, but wasm-bindgen 0.2.126 could not prepare the module for threading because
  the precompiled web standard library omitted threaded TLS initialization
  (`failed to find __wasm_init_tls`). The current official wasm-bindgen guide confirms
  that browser threads require rebuilding `std` with atomic features on nightly.
- **Repro:** build `engine/wasm/thread-spike` on stable with the repository's encoded
  Rust flags but without `-Z build-std`; then run wasm-bindgen 0.2.126 with target
  `web`. The command fails before binding generation. The repository build succeeds
  with pinned `nightly-2026-07-16` and `-Z build-std=std,panic_abort`, then Binaryen's
  feature printer confirms threads, SIMD, relaxed SIMD, and bulk memory.
- **Qualification evidence:** schema-v25 / metric-set-v11 artifact
  `smoke-1-9a863a19906d-dev-01-showcase-2026-07-20T01-09-27-205Z.json` passed all
  three facets and 24 checks. Six production-sandbox runs completed all 262,144 tasks
  with both workers active and an exact checksum in 30.8-35.8 ms total; the parallel
  worker phase alone measured 15.9-17.6 ms.
- **Impact on Parallax:** the first Rust module adds a nightly toolchain and a costly
  stdlib rebuild to clean/repeatability builds. Exact pins and path remapping keep the
  output repeatable, but every Rust toolchain upgrade is build/measurement-critical.
- **Proposed improvement:** Rust should ship a maintained threading-enabled browser
  target/stdlib, or stabilize the build-std path needed to construct one. wasm-bindgen
  should retain its explicit diagnostic and ideally identify the required target recipe.

## RE-034: Pinned Gemma 4 sequence snapshots restore only part of an exact prefix

- **Date / Chrome version:** 2026-07-19; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 SUPER, physical console, normal Chrome sandbox;
  wllama 3.5.1 / llama.cpp b9640-dd4623a / Gemma 4 E2B QAT GGUF.
- **Layer:** wllama/llama.cpp state serialization / WebGPU and WASM inference.
- **Status:** open upstream-runtime limitation; D-084 measured no-go for this exact
  model/runtime, not attributed to Chrome and not generalized to other model families.
- **What we expected / What happened:** three live same-session generations reused
  each character's 914-916-token exact common prefix. After exporting the idle slot to
  bytes, writing it to OPFS, restarting Chrome on the same profile, and restoring into
  an identical context, every stable WebGPU/CPU and f16/q8_0 cell reused exactly 409
  tokens. Native restore itself returned successfully in 1.00-2.85 ms. WebGPU f16
  without flash attention was less stable: native restore returned in 5.29 ms, then
  first generation repeatedly aborted inside the pinned module. With flash attention,
  WebGPU generation remained stable but retained the same 409-token ceiling.
- **Repro:** the completed D-082 matrix's final source-identity reports have artifact
  prefix `a7c4c4e56ed6`; D-084 records all six filenames and durable top-line
  measurements. The now-removed experiment used
  llama.cpp's in-memory `llama_state_seq_get_data`/`set_data` path, carried the slot's
  exact token history beside the opaque state, bound model/runtime/context parameters
  into the cache identity, and verified the same five GGUF shards before and after the
  browser restart. Reopening requires a fresh bounded implementation; no dormant
  package patch or harness command remains in the tree.
- **Impact on Parallax:** restart-persistent KV snapshots are not viable for the pinned
  Gemma 4 E2B stack despite materially lower partial-prefill TTFT. Symmetric q8_0 cuts
  snapshot size about 47% and passes all 30 quality cases, but cannot repair missing
  prefix state. Parallax will prefer clean live world/tool/persona pre-seeding during
  idle headroom and evaluate other models separately.
- **Proposed improvement:** llama.cpp/wllama should expose a portable-state capability
  check and either preserve all prompt-reusable state for hybrid-memory models or
  return the exact restorable token span before export. A WebGPU restore should fail
  explicitly before generation when its attention configuration cannot consume the
  restored state. Re-test separately evaluated model families rather than assuming
  this hybrid-model result is universal.

## RE-033: wllama inference is worker-hosted but its controller requires a Window

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  wllama 3.5.1.
- **Layer:** wllama integration / worker topology.
- **Status:** library limitation; worked around by supported window-controller
  placement, with heavy execution still worker-hosted.
- **What we expected / What happened:** Parallax initially constructed wllama inside
  its existing dedicated AI worker because wllama documents worker-hosted inference.
  Both cold and warm attempts failed immediately with `ReferenceError: document is not
  defined`. wllama's `absoluteUrl()` resolves its WASM path against
  `document.baseURI`; the controller therefore assumes a Window even though it creates
  workers for llama.cpp, OPFS downloads, and pthread execution.
- **Repro:** instantiate `new Wllama(...)` from a dedicated worker and call
  `loadModelFromUrl`; D-074's first artifact
  `app-owned-llm-spike-1-36a921860759-dev-01-2026-07-17T18-11-24-086Z.json` retains the
  two exact failures. The relevant current source was checked in the pinned npm
  package and is also documented at https://github.ngxson.com/wllama/docs/.
- **Impact on Parallax:** the engine service must keep a small asynchronous wllama
  controller on the window rather than using the uniform Parallax AI-worker entrypoint.
  Inference still runs off-thread, and D-074's successful artifact measured healthy
  render-worker callback pacing, but the topology exception is permanent until the
  library accepts a worker-safe base URL.
- **Proposed improvement:** accept already-absolute resource URLs without consulting
  `document`, or resolve relative URLs against `globalThis.location.href` when running
  in a worker. Document controller-realm requirements separately from inference-worker
  behavior.

> **Historical ONNX apparatus:** RE-025 through RE-032 retain the evidence behind
> D-073's no-go decision. D-095 removed the Transformers/ONNX implementation,
> dependency chain, model manifests, worker, and tests. Reproduction paths in these
> entries describe the pre-D-095 tree; use the cited result artifacts and git history
> if the experiment is deliberately reopened.

## RE-032: Browser model loaders materialize multi-gigabyte ONNX shards as single buffers

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / ONNX Runtime Web 1.27.0.
- **Layer:** Transformers.js / V8 allocation / OPFS model loading.
- **Status:** confirmed browser/library allocation cliff; q8 CPU profile superseded by
  D-073's smaller failure reproducer.
- **What we expected / What happened:** the streaming OPFS cache was expected to keep
  a 6.24 GB q8 install off the JS heap until ORT consumed it. Both cold attempts emitted
  `Array buffer allocation failed` near 62% load progress. The final bounded run stopped
  after 120,569 ms at 0.6205 with 10/12 artifacts verified, 1,797,484,666 bytes written,
  and zero integrity failures. The two missing artifacts were the export's largest
  external-data shards, including one 2,348,810,240-byte file. Transformers.js 4.2.0
  preallocates `new Uint8Array(total)` in browser `readResponse()` and model components
  load concurrently, defeating streaming at the consumer boundary.
- **Repro:** run the D-072 q8 WASM profile on a fresh persistent profile; artifact
  `app-owned-llm-spike-1-a6ea4cbdc9e6-dev-01-2026-07-17T17-31-17-052Z.json`. The
  official file sizes are visible at
  https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/tree/main/onnx.
- **Impact on Parallax:** OPFS can store and stream the bytes, but the JS model-loading
  API still imposes a multi-gigabyte contiguous-allocation peak before session creation.
  Export sharding therefore becomes a browser compatibility constraint independent of
  total model size.
- **Proposed improvement:** let ORT Web consume external data from streams, OPFS handles,
  or range-readable blobs without first constructing one `Uint8Array` per shard; publish
  browser-safe maximum shard guidance and make loaders serialize large allocations.

## RE-031: Gemma 4 mobile-QAT has no ONNX Runtime WASM CPU kernel

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / ONNX Runtime Web 1.27.0.
- **Layer:** ONNX Runtime Web / WASM CPU execution provider.
- **Status:** confirmed ONNX operator gap across mobile q2f16 and standard q4; D-074's
  GGUF/llama.cpp CPU route bypasses rather than fixes it.
- **What we expected / What happened:** moving the E2B mobile-QAT pipeline from WebGPU
  to Transformers.js's WASM device was expected to trade speed for graphics headroom.
  Session creation failed instead because the CPU provider has no kernel for
  `com.microsoft.GatherBlockQuantized(1)` in the embedding graph.
- **Repro:** set `PARALLAX_APP_OWNED_LLM_DEVICE=wasm`. The D-071 mobile manifest and
  D-073 standard-q4 artifact
  `app-owned-llm-spike-1-5aa7eed16ab4-dev-01-2026-07-17T17-36-44-003Z.json` both retain
  the exact kernel error; q4 fails both cold and restart-warm session creation.
- **Impact on Parallax:** one compact 2.32 GB ONNX install cannot serve as both GPU and
  CPU fallback. The standard export's q4 graph also uses the custom embedding operator,
  so smaller shards and a 3.65 GB install do not produce a CPU-compatible ORT session.
  D-074 qualifies a separately pinned 2.62 GB split GGUF on both placements.
- **Proposed improvement:** implement the mobile quantization operator for the WASM CPU
  provider, or publish a small cross-provider export and machine-readable execution-
  provider compatibility metadata.

## RE-030: E2B WebGPU fails at 6,456 tokens independent of prior generations

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / ONNX Runtime Web 1.27.0.
- **Layer:** ONNX Runtime Web / WebGPU context allocation.
- **Status:** confirmed context-size failure; root allocation/validation error remains
  opaque.
- **What we expected / What happened:** E2B's smaller weights were expected to leave
  enough GPU headroom for all fixed context tiers. It completed 256 and 1,656 tokens in
  normal order but lost an invalid GPU buffer at 6,456. A context-first run then failed
  at the same 6,456-token case immediately after the excluded 256-token warmup in both
  cold and warm phases. This rules out cumulative retention from the 28 earlier
  generations as the necessary cause.
- **Repro:** normal artifact
  `app-owned-llm-spike-1-2b912b1a0d56-dev-01-2026-07-17T16-39-02-164Z.json`; non-gating
  context-first artifact
  `app-owned-llm-spike-1-767efbd56b0d-dev-01-2026-07-17T16-43-05-283Z.json`.
- **Impact on Parallax:** E2B WebGPU meets the latency target (206.90 ms warm TTFT p95)
  and saves model bytes, but cannot satisfy the unchanged retrieved-context tier.
  D-074's wllama/GGUF route passes its same-content 4,805-token tokenizer rendering;
  this does not identify or repair ORT's invalid-buffer cause.
- **Proposed improvement:** surface the first WebGPU validation/allocation failure,
  publish session memory estimates by input shape, and allow applications to query a
  safe allocation limit before invalidating a buffer/device.

## RE-029: Gemma 4 E4B mobile-QAT exhausts allocation at the large context tier

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / pinned ONNX Runtime Web 1.27.0.
- **Layer:** ONNX Runtime Web / WebGPU memory and cross-device contention.
- **Status:** confirmed for E4B own-device topology; E2B headroom branch selected by
  D-071.
- **What we expected / What happened:** ORT 1.27 plus the model-owned chat template
  allowed the 3.36 GB E4B mobile graph to complete 28 generations, including the
  1,656-token medium context. Both cold and restart-warm phases failed the next large-
  context generation with `std::bad_alloc`. During the warm failure the render worker,
  which owns a separate logical `GPUDevice` on the same adapter, also reported a
  JavaScript failure. The web platform exposes no allocation total to distinguish
  model weights, KV cache, transient buffers, and Babylon allocations (RE-014).
- **Repro:** artifact
  `app-owned-llm-spike-1-172a264d5607-dev-01-2026-07-17T16-33-33-429Z.json` retains the
  valid environment, complete ten-artifact OPFS lifecycle, 28 generations per phase,
  E4B latency/throughput/callback evidence, and both allocation failures.
- **Impact on Parallax:** E4B's fast first token does not compensate for failing the
  unchanged context workload and threatening the concurrently rendering game. D-071
  tests the 2.32 GB E2B mobile export to recover roughly 1.04 GB of installed/model
  headroom without weakening the workload.
- **Proposed improvement:** expose per-device and per-origin live/peak WebGPU allocation,
  return an attributable allocation failure before device collateral damage, and make
  logical-device competition on one physical adapter observable.

## RE-028: Gemma 4 E4B q4f16 loses its WebGPU buffer at the large context tier

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / its bundled ONNX Runtime Web 1.26 development build.
- **Layer:** ONNX Runtime Web / WebGPU resource management.
- **Status:** open; failed diagnostic cohort retained, mobile-QAT/ORT-1.27 branch now
  tests whether the issue reproduces with lower model pressure.
- **What we expected / What happened:** the q4f16 E4B branch completed 28 generations,
  including a 1,656-token medium-context case, then failed deterministically in both
  fresh and browser-restart phases when starting the large-context case. ONNX Runtime
  reported an invalid GPU buffer while downloading output through `mapAsync`. The
  advertised model context is much larger, but this result does not yet distinguish a
  context allocation limit from cumulative resource retention across prior generations.
- **Repro:** artifact
  `app-owned-llm-spike-1-48812e6c72bd-dev-01-2026-07-17T15-55-10-760Z.json` retains
  both failures, 28 raw generation records per phase, and the complete OPFS lifecycle.
- **Impact on Parallax:** q4f16 is not a qualifying fallback despite excellent TTFT;
  its 4.92 GB install and lost-device behavior threaten game GPU headroom. D-069/D-070
  return to the smaller mobile-QAT graph on the publisher-required runtime; E2B is the
  next declared headroom candidate.
- **Proposed improvement:** report the WebGPU validation error that first invalidated
  the buffer, expose live session/device allocation telemetry, and make resource release
  across sequential generations observable.

## RE-027: Transformers.js misses Gemma 4's standalone chat template

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / ONNX Runtime Web 1.27.0.
- **Layer:** model packaging / Transformers.js tokenizer loading.
- **Status:** open ecosystem gap; revision-pinned OPFS adapter added by D-070.
- **What we expected / What happened:** after ORT 1.27 successfully created the q2f16
  sessions, the model's tokenizer was expected to format its documented chat messages.
  Both cold and warm phases instead failed before warmup because
  `tokenizer.chat_template` was unset. The repository contains
  `chat_template.jinja`, but the JavaScript loader did not attach it; the small
  `tokenizer_config.json` intentionally does not embed a duplicate.
- **Repro:** run D-069's nine-file model manifest. Artifact
  `app-owned-llm-spike-1-e7e0cdf0b1ac-dev-01-2026-07-17T16-24-33-709Z.json` proves all
  nine cold writes and warm reads, followed by the exact `apply_chat_template()` error.
- **Impact on Parallax:** no token can be generated without loading a model-owned
  template. D-070 adds the tenth repository artifact to the same integrity/offline
  contract and assigns its verified text to the tokenizer.
- **Proposed improvement:** Transformers.js should implement the same standalone
  `chat_template.jinja` discovery as the current Python processor and include that file
  in its progress/cache lifecycle automatically.

## RE-026: Pre-1.27 ONNX Runtime WebGPU rejects Gemma 4's 2-bit mobile-QAT graph

- **Date / Chrome version:** 2026-07-17; Chrome for Testing Stable 150.0.7871.115,
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox;
  Transformers.js 4.2.0 / bundled ONNX Runtime Web
  1.26.0-dev.20260416-b7804b056c.
- **Layer:** ONNX Runtime Web / WebGPU inference tooling.
- **Status:** confirmed version mismatch; required 1.27.0 retest selected by D-069.
- **What we expected / What happened:** the public mobile-QAT Gemma 4 E4B export and
  its advertised `q2f16` text path were expected to create a WebGPU session. Both a
  fresh-profile attempt and a browser-restart attempt failed session creation at ONNX
  Runtime's `GatherBlockQuantized` kernel because it accepts only 4- or 8-bit weights.
  No inference token was produced.
- **Repro:** run `PARALLAX_MACHINE_ID=dev-01`, `PARALLAX_TIER=showcase`, then
  `pnpm harness:app-owned-llm` with D-067's pinned q2f16 manifest. Result artifact
  `app-owned-llm-spike-1-4ae4fc26627f-dev-01-2026-07-17T15-44-56-168Z.json` records
  `bits_ == 4 || bits_ == 8 was false` from
  `onnxruntime/contrib_ops/webgpu/quantization/gather_block_quantized.h:55` in both
  phases. The fresh phase hash-verified eight entries with zero integrity failures
  before session creation failed; this was a diagnostic failure, not a valid budget
  cohort.
- **Impact on Parallax:** the smaller 3.36 GB E4B mobile export cannot be the app-owned
  WebGPU candidate with Transformers.js's bundled runtime. The model card explicitly
  requires ONNX Runtime 1.27.0 or newer; D-069 pins that now-published browser runtime
  and reruns the same export before falling back to E2B.
- **Proposed improvement:** ONNX export catalogs should publish execution-provider
  compatibility per quantization, and the JS runtime should reject an unsupported
  graph before multi-gigabyte artifact delivery when the kernel constraint is known.

## RE-025: Transformers.js 4.2 declarations do not typecheck under TypeScript 7

- **Date / versions:** 2026-07-17; `@huggingface/transformers` 4.2.0,
  `@huggingface/tokenizers` 0.1.3, and TypeScript 7.0.2 on Windows 11.
- **Layer:** third-party web inference tooling / TypeScript declarations.
- **Status:** archived upstream compatibility gap; the narrow Parallax workaround and
  its dependency were removed by D-095.
- **What we expected / What happened:** importing the supported browser
  `pipeline`, `env`, and `TextStreamer` surface into a strict worker should typecheck.
  Instead, TypeScript follows Transformers.js's public declaration graph into broken
  tokenizer aliases and unrelated model declarations, producing errors before any
  Parallax call-site is checked. The runtime bundle succeeds, so this is a declaration
  compatibility failure rather than a browser-runtime failure.
- **Repro:** in the pre-D-095 tree, remove the `@huggingface/transformers` path mapping
  from `engine/tsconfig.json`, import the three worker symbols, and run
  `pnpm typecheck`. Git history retains that worker and its narrow local declaration;
  the current tree intentionally contains neither.
- **Impact on Parallax:** P-007 cannot consume the package's published declarations
  directly under the pinned compiler. Parallax uses a narrow, strict declaration of
  only the exercised API instead of enabling `skipLibCheck`, which would hide errors
  across the entire dependency graph.
- **Proposed improvement:** publish a TypeScript-7-compatible declaration graph and a
  small stable public worker-inference surface that does not pull every model family
  into consumers' typechecking.

## RE-024: Retained Prompt progress samples overstated no-progress time

- **Date / Chrome version:** 2026-07-16; branded Chrome Stable 150.0.7871.128 on
  Windows 11/dev-01/RTX 4080 Super. Review of all four schema-v1 branded artifacts.
- **Layer:** harness aggregation / Prompt API progress telemetry.
- **Status:** our-bug; fixed in `prompt-api-branded@1` report schema v2 (D-064).
- **What we expected / What happened:** the branded report labeled wall-clock spacing
  between retained progress samples as its longest no-forward-progress gap. The engine
  intentionally retains samples only after roughly one percentage point of additional
  progress, while its separate timer advances on every strictly larger normalized
  value. Across the six same-version calibration profiles, schema-v1 reports therefore
  overstated true gaps by 7.6-10.1 s. The sandboxed
  artifact reported 26.3 s and 25.3 s although its raw engine telemetry measured 16.7 s
  and 17.1 s. A slow but continuously advancing link could falsely fail the 120-second
  boundary merely because one percent of a multi-gigabyte model took that long.
- **Repro:** compare each schema-v1 profile's aggregate
  `download.value.longestProgressGapMs` with the maximum
  `segments[].telemetry.download.longestProgressGapMs`. Across the six same-version
  delivering profiles in the `00-31-55`, `00-38-47`, and `01-16-45` artifacts, the
  phase-local values were 16.7-17.3 s while total delivery lasted 101.3-263.7 s.
  A synthetic schema-v2 test spaces retained samples by 60 s while preserving a 17 s
  engine gap and verifies that the result reports 17 s.
- **Impact on Parallax:** prior lifecycle and latency observations remain useful, but
  schema-v1 download-gap fields are not performance evidence. Schema v2 gates only the
  phase-local engine timer and records the observer-free restart interval separately as
  a non-gating upper bound. Production-install qualification is reopened for a schema-v2
  physical-console run. D-065's passing schema-v2 artifact subsequently measured true
  phase-local gaps of 24.0 s and 17.8 s plus a separately labeled 4.7 s restart
  observation window, closing the qualification without reviving the conflated metric.
- **Proposed improvement:** none platform-side. Keep raw-event progress timing and
  downsampled report/UI samples as explicitly separate contracts.

## RE-023: Sandboxed OPFS read-call throughput misses the repeatability gate

- **Date / Chrome version:** 2026-07-16 through 2026-07-17; Chrome for Testing Stable 150.0.7871.115 on
  Windows 11/dev-01/RTX 4080 Super, physical console, normal Chrome sandbox. Schema-v20
  results
  `smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-06-27-753Z.json` and
  `smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-09-09-623Z.json`, plus
  attribution schema-v21 result
  `smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T14-53-51-392Z.json` and passing
  schema-v22 replacement
  `smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T15-00-16-046Z.json`.
- **Layer:** OPFS / storage worker / browser process topology / host scheduling.
- **Status:** confirmed platform-observability/repeatability gap; no longer blocks M0
  after D-066's qualified capability decision, but remains open for M1 outcome and
  queue/service attribution.
- **What we expected / What happened:** each fresh/warm sequential/random read-call
  cohort must remain within 10% relative range after an untimed validated preflight.
  The first sandboxed run completed every read and all six core traces but measured
  fresh-random variance of 10.30% and warm-sequential variance of 10.61%. An unchanged
  confirmation run again validated every read but measured fresh-sequential values of
  5.99, 6.53, and 3.45 GiB/s (89.44% range) and fresh-random values of 5.35, 5.50, and
  4.20 GiB/s (30.84% range). Warm cohorts in the confirmation stayed within 4.04% and
  3.47%. The effective command lines omitted `--no-sandbox`; both registered
  environment facets passed.
  Schema v21 retained per-batch and host-disk attribution. Five cohorts stayed within
  3.30-6.03%, while warm-random missed narrowly at 10.62% (5.25-5.81 GiB/s). The low
  run contained one 4.925 ms 256-read batch among 2.565-3.305 ms peers, with normal
  sequential throughput. Its overlapping one-second host sample measured only 32,259
  B/s physical reads, 88,712 B/s writes, zero disk queue, and 1.161 ms average read
  latency; all six host samples were similarly far below the worker's multi-GiB/s
  warm-cache throughput.
  The subsequent schema-v22 cohort passed the revised aggregate contract and also kept
  all four OPFS ranges within 1.10-6.58%. That favorable sample does not supersede the
  prior invalid cohorts and is not promoted as a throughput baseline.
  The D-090 schema-v27/metric-set-v12 physical-console pass
  `smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json` again reproduced
  the split: fresh sequential/random relative ranges were 20.73%/16.36%, while warm
  sequential/random stayed within 7.75%/4.89%. All reads completed with zero validation
  errors, host samples showed no material physical-disk traffic, and the aggregate gate
  passed because D-066 keeps repeatability informational while retaining raw correctness
  evidence.
- **Repro:** at the dev-01 physical console run `PARALLAX_MACHINE_ID=dev-01`,
  `PARALLAX_TIER=showcase`, then `pnpm harness:smoke`. Schema v20 records the sandbox
  contract, twelve-pass sequential and 4,096-operation random read-call samples, full
  validation counts, per-profile variance, per-batch timings, and overlapping host
  physical-disk activity.
- **Impact on Parallax:** worker-owned synchronous OPFS remains functional and fast in
  most samples, but the current harness cannot promote a stable production-sandbox
  throughput baseline. Retrying until a favorable three-sample cohort appears would
  conceal the instability. D-066 therefore closes the capability spike without
  promoting a repeatability baseline: exact per-run lifecycle/correctness/raw evidence
  stays mandatory, the unchanged variance result stays visible but informational, and
  M1 gates representative OPFS-to-renderable cell-load p95.
- **Proposed improvement:** expose OPFS operation latency and queue/service attribution
  through DevTools tracing or a performance surface. Parallax now retains per-batch and
  host-disk attribution, but the browser/broker scheduling layer remains opaque.

## RE-022: Playwright disabled Chrome's process sandbox in reference launches

- **Date / versions:** 2026-07-16; Playwright 1.61.1 with branded Chrome Stable
  150.0.7871.128 and pinned CfT 150.0.7871.115 on Windows 11/dev-01.
- **Layer:** harness automation / browser process topology.
- **Status:** our-bug; fixed in the shared launcher (D-062). The sandboxed Prompt
  schema-v2 qualification passed under D-065, and the schema-v22 aggregate smoke
  replacement passed under D-066. Earlier sandboxed failures remain retained evidence.
- **What we expected / What happened:** reference automation was expected to preserve
  production Chrome's process topology. Playwright's `chromiumSandbox` option defaults
  to false, so its generated arguments silently added `--no-sandbox` to every shared
  persistent-context launch. Branded Chrome exposed the unsupported-flag warning. The
  effective command lines retained in the Prompt artifacts confirm the switch was
  present; ordinary and persistent local probes both launched successfully after
  setting `chromiumSandbox: true`.
- **Repro:** call Playwright 1.61.1 `launchPersistentContext()` without setting
  `chromiumSandbox`, then inspect `chrome://version`; `--no-sandbox` is present. Repeat
  with `chromiumSandbox: true`; Chrome launches without the switch. The shared Parallax
  launcher now forces the latter and rejects an effective Prompt command line if the
  switch returns. `smoke@1` schema v20 and later persist the effective command line and
  verified sandbox state.
- **Impact on Parallax:** prior download/restart/offline results remain diagnostic
  history, but the on-device-model utility, renderer, GPU, and other child processes
  did not use the same security topology as production Chrome. The sandboxed branded
  schema-v2 artifact now qualifies the production-sandbox lifecycle; the two sandboxed
  smoke artifacts preserve their failures rather than inheriting the old aggregate pass.
- **Proposed improvement:** Playwright should enable the sandbox by default for
  installed Windows Chrome, or make the security/topology change prominent when it
  injects `--no-sandbox`.
- **Sources checked:** Playwright
  [BrowserType API](https://playwright.dev/docs/api/class-browsertype), Chromium
  [sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md),
  and Chromium's
  [Windows sandbox launcher](https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/win/sandbox_win.cc),
  checked 2026-07-16.

## RE-021: Branded Prompt API first-token samples exceed the dialog target

**Archive note (D-096):** RE-016 through RE-021 preserve the measured built-in-AI
findings, artifact names, and original repro procedures. D-096 selected the app-owned
backend and removed the Prompt API runners, service, and launch utilities; those
commands and source paths are intentionally historical and can be recovered from git
history if a current plan item reopens the comparison.

- **Date / Chrome version:** 2026-07-16; branded Chrome Stable 150.0.7871.128 on
  Windows 11/dev-01/RTX 4080 Super, physical console. Passing sandboxed schema-v2
  lifecycle result
  `prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json`.
- **Layer:** Prompt API / NPC-dialog latency.
- **Status:** open platform finding; D-074's completed head-to-head and D-096 selected
  the faster app-owned backend.
- **What we expected / What happened:** the backend-neutral dialog target is first-token
  latency p95 <= 1.5 s. The branded qualification was scoped to install lifecycle, but
  retained four exact-fixture latency samples under the production sandbox: 3543.6 ms
  and 3682.8 ms in the uninterrupted profile, and 3877.2 ms and 3603.2 ms in the
  restart/resume profile. Every observed sample exceeded 1.5 s; the range was
  3543.6-3877.2 ms. The earlier same-digest schema-v1 sandbox/unsandbox comparison
  remains the controlled topology correlation: its unsandboxed cohort ranged
  1575.1-1650.8 ms, so the sandboxed mean was 2.15x higher. This is a strong correlation
  with the topology correction, not yet causal attribution; four samples per cohort
  are not a sufficient p95 population.
- **Repro:** from a physical console run `PARALLAX_MACHINE_ID=dev-01`,
  `PARALLAX_TIER=showcase`, then `pnpm harness:prompt-api-branded`. Inspect each
  profile's initial and post-restart `firstChunkLatencyMs` values.
- **Impact on Parallax:** D-065's schema-v2 cohort qualifies reliable branded delivery.
  The production-sandbox samples fail to establish acceptable NPC
  dialog responsiveness and strengthen the case for P-007. A controlled sandbox A/B
  may isolate the 2.15x correlation, but backend selection must use the production
  topology regardless of its cause.
- **Proposed improvement:** expose lower-overhead session warmup/preparation and
  inference diagnostics so applications can distinguish model/session initialization
  from generation latency and schedule readiness before dialog begins.

## RE-020: Installed Prompt API model reports transient `downloading` after browser restart

- **Date / Chrome version:** 2026-07-16; branded Chrome Stable 150.0.7871.128 on
  Windows 11/dev-01/RTX 4080 Super, physical console. Passing sandboxed schema-v2
  same-version result
  `prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json`.
- **Layer:** Prompt API / Chrome model lifecycle.
- **Status:** open; production UX must preserve and tolerate the transition while
  requiring settled `available` before declaring readiness.
- **What we expected / What happened:** after each fresh profile installed the
  4,269,934,835-byte model, completed streamed inference, and restarted Chrome, the
  first `LanguageModel.availability()` returned `downloading` rather than `available`.
  Activation-backed `create()` nevertheless completed the same NPC fixture, the next
  availability check settled to `available`, and the exact fixture then streamed again
  offline with availability `available`. The behavior reproduced in both the
  uninterrupted and restart/resume profiles and also appeared in the earlier
  cross-version diagnostic.
- **Repro:** run `PARALLAX_MACHINE_ID=dev-01`, `PARALLAX_TIER=showcase`, then
  `pnpm harness:prompt-api-branded`. Inspect each profile's availability transitions:
  the post-install browser restart records `downloading`, followed by successful
  inference and settled `available`.
- **Impact on Parallax:** this invalidated treating the built-in model as a durable
  application install bit. D-096 selected an app-owned OPFS model, so current product
  UX no longer consumes this transition. Historical built-in-model restart UX could not equate an initial
  `downloading` response with a new multi-gigabyte install or a failed persistence
  check. The branded schema-v2 contract records the transition, exercises `create()`
  from a real gesture, and gates the settled post-fixture `available` state plus offline
  success and component bytes. A state that never settles still fails the existing
  liveness/completion contract.
- **Proposed improvement:** distinguish model rehydration/verification from network
  download, or make an already-installed model report `available` when a session can be
  created without new delivery.

## RE-019: Prompt API creation can remain pending without download progress or model bytes

- **Date / Chrome version:** 2026-07-16; Chrome for Testing Stable 150.0.7871.115 on
  Windows 11/dev-01/RTX 4080 Super, physical console. Result schema v6 artifact
  `prompt-api-spike-1-b68bd86a977a-dev-01-2026-07-16T23-41-28-710Z.json`; the registered
  environment gate was measured and passed with full D3D12 adapter/driver identity.
- **Layer:** Prompt API / Chrome model delivery.
- **Status:** open; CfT reproduction confirmed. The independent branded-Chrome
  schema-v2 cohort passed production qualification under D-065, proving the
  player-facing delivery path while preserving this CfT/branded divergence as a
  platform finding.
- **What we expected / What happened:** a fresh-profile, activation-backed
  `LanguageModel.create()` should begin observable model delivery. The API reported
  `downloadable`, the window exposed `LanguageModel`, the dedicated worker did not, and
  the effective Chrome command line passed D-059's model-delivery contract with all 15
  unrelated Playwright feature suppressions retained. After the real click, `create()`
  remained in `creating` for 120,723 ms while the monitor received exactly zero
  `downloadprogress` events. The profile's `OptGuideOnDeviceModel` component still
  contained zero files and zero bytes; the developer also observed no corresponding
  sustained router traffic.
- **Repro:** from a physical console run `PARALLAX_MACHINE_ID=dev-01`,
  `PARALLAX_TIER=showcase`, then `pnpm harness:prompt-api`. Schema v6 polls the exported
  progress maximum and fails after the `budgets.md` 120-second no-forward-progress
  limit while preserving partial telemetry. This run stopped at 120,723 ms with max
  progress null, zero valid/invalid/regressive events, zero retained samples, initial
  availability `downloadable`, and final state `creating`.
  An earlier schema-v5 reproduction had the same delivery outcome but an invalid
  environment facet because the runner queried adapter identity on the already-running
  app page after its render worker acquired WebGPU. The schema-v6 rerun uses the inert
  `/__parallax/identity` control-page probe and validated WebGPU developer-identity
  switch, and passed every registered-machine identity comparison.
- **Impact on Parallax:** the documented trigger/progress surface did not provide a
  usable install experience in a valid CfT run. The M0 research spike is therefore
  complete as a measured no-go for a required backend. The independent fresh
  branded-Chrome qualification subsequently demonstrated reliable trigger, actionable
  progress, resume, restart, and offline reuse; D-065's schema-v2 result formally clears
  that production-lifecycle capability.
  D-074 completed that comparison and D-096 selected the app-owned backend.
- **Proposed improvement:** when an eligible `create()` cannot start or advance model
  delivery, reject it promptly with a machine-readable delivery/eligibility reason.
  Expose a stable download state that distinguishes queued, resolving eligibility,
  fetching, verifying, unpacking, and stalled component delivery; progress events
  should remain live while bytes or local installation work advances.

## RE-018: Playwright defaults disabled Prompt API component delivery in fresh Chrome profiles

- **Date / Chrome version:** 2026-07-16; Chrome for Testing Stable 150.0.7871.115 and
  exact-version branded Chrome 150.0.7871.115 on Windows 11/dev-01/RTX 4080 Super.
  Local compatibility diagnostics only; no physical-console evidence claim.
- **Layer:** harness automation / Prompt API component delivery.
- **Status:** our-bug; fixed in the working-tree `prompt-api-spike@1` launcher (D-059).
- **What we expected / What happened:** fresh exact-version CfT and branded Chrome
  profiles exposed `LanguageModel` but initially returned only `unavailable`, despite
  dev-01 meeting the documented OS/CPU/RAM/GPU/storage requirements. Inspection then
  showed both launches inherited Playwright defaults for `--disable-component-update`,
  `--disable-background-networking`,
  `--disable-component-extensions-with-background-pages`, and a
  `--disable-features` list containing `OptimizationHints`. An equivalent new branded
  profile with those four defaults removed returned `downloadable` immediately and in
  13 consecutive checks over about one minute.
- **Repro:** launch a fresh profile with Playwright's ordinary defaults, navigate to the
  localhost app, and observe `availability() === "unavailable"`; inspect
  `chrome://version` for the disabling switches. Repeat while using
  `ignoreDefaultArgs` for those exact defaults and observe `downloadable`.
  `chrome://policy` showed no configured policy entries; `chrome://flags` contributed
  no switches (`--flag-switches-begin --flag-switches-end` was empty); and
  `chrome://on-device-internals` reported that internal debug pages were disabled for
  the automation session, so it supplied no component state.
  The physical-console `prompt-api-branded@1` result
  `prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T00-23-02-899Z.json` reproduced
  that redirect after both profiles had installed and streamed successfully. It recorded
  initial post-restart `downloading` and offline `available`, but did not yet record the
  later settled-availability transition added to the runner. The sandboxed `01-16-45`
  schema-v1 artifact subsequently recorded post-fixture `available`; post-shutdown
  inspection measured 4,269,934,835 component bytes in every cited profile.
  D-061 therefore keeps the debug page explicit but non-gating rather than mistaking an
  automation restriction for failed player-facing model status.
- **Impact on Parallax:** the earlier availability blocker and proposed P1 eligibility
  ask were false. The first fix also ignored Playwright's whole combined
  `--disable-features` switch, unintentionally re-enabling 15 unrelated features; the
  corrected runner restores all 15 and enables only `OptimizationHints`. It records
  the effective `chrome://version` command line and disabled-feature set, then fails
  closed if model-delivery switches reappear or preserved render/navigation/profile
  suppressions disappear. Ordinary `smoke@1` launches retain standard Playwright
  defaults. The corrected schema-v6 physical-console run verified all 15 preserved
  suppressions and returned `downloadable`; RE-019 records the subsequent delivery
  stall.
- **Proposed improvement:** none platform-side from this result. The launch switches
  are now part of result schema v6 and fail closed at runtime if component delivery or
  Playwright-default matching regresses.
- **Sources checked:** Chrome
  [Prompt API requirements](https://developer.chrome.com/docs/ai/prompt-api),
  [built-in AI setup](https://developer.chrome.com/docs/ai/get-started), and
  [model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management),
  checked 2026-07-16; local exact-version diagnostics above.

## RE-017: Prompt API download telemetry omits bytes and has no eviction test control

- **Date / Chrome version:** 2026-07-16; current Prompt API documentation/proposal and
  Chrome for Testing Stable 150.0.7871.115 on Windows 11/dev-01/RTX 4080 Super. A same-version branded
  Chrome profile contained a 4,269,934,835-byte `OptGuideOnDeviceModel` component; this
  profile inspection was a local diagnostic, not the registered spike gate.
- **Layer:** Prompt API / Chrome model lifecycle.
- **Status:** open platform finding; the removed `prompt-api-spike@1` recorded normalized
  download evidence, component bytes after Chrome exited, and unsupported forced
  eviction (D-059/D-096).
- **What we expected / What happened:** an install UI and lifecycle harness need exact
  downloaded/total bytes and a reproducible eviction transition. The web API exposes
  only aggregate `ProgressEvent.loaded` values from 0 to 1 (`total` is 1), explicitly
  omits byte counts, and exposes no supported control for forcing the documented
  model deletion. Chrome documents the exact installed size only through
  `chrome://on-device-internals`; deletion can follow low free space, enterprise policy,
  or 30 days without meeting other eligibility criteria, and can occur at any time —
  even during an active session and prompt.
- **Repro:** create a fresh Prompt API session with a `downloadprogress` monitor and
  inspect every event; then compare the API fields with the component directory and
  `chrome://on-device-internals`. The versioned repro lives in
  `harness/src/prompt-api-spike-run.ts`; its post-shutdown profile scan is explicitly
  privileged evidence.
- **Impact on Parallax:** the installer cannot report truthful model byte progress from
  web content, and CI cannot deterministically exercise eviction/recovery without a
  destructive machine-level setup. An install-once/launch-many game must also treat
  model presence as revocable during launch and mid-session rather than a durable
  install bit. Parallax must keep model bytes separate from app telemetry and retain
  authored offline dialog fallback; recovery requires a new application `create()`
  call and is not an automatic browser redownload. Related LoRA weights are removed
  with the base model after a documented 30-day grace period.
- **Proposed improvement:** expose downloaded and total byte counters with resource
  categories, plus a DevTools/CDP test hook and observable lifecycle reason for model
  eviction. The production web surface need not permit eviction itself.
- **Sources checked:** Chrome
  [built-in AI setup](https://developer.chrome.com/docs/ai/get-started),
  [model management](https://developer.chrome.com/docs/ai/understand-built-in-model-management),
  and the WICG
  [Prompt API proposal](https://github.com/webmachinelearning/prompt-api), checked
  2026-07-16.

## RE-016: Prompt API remains window-only in Chrome 150

- **Date / Chrome version:** 2026-07-16; Chrome for Testing Stable 150.0.7871.115 on
  Windows 11/dev-01/RTX 4080 Super. Local result is a compatibility diagnostic; the registered
  physical-console M0 evidence run is pending.
- **Layer:** Prompt API / workers.
- **Status:** open platform finding; D-096 removed the superseded D-017 broker from
  Parallax's current runtime.
- **What we expected / What happened:** current Chrome documentation says the Prompt API
  is available to top-level windows/same-origin frames but not Web Workers. A clean
  pinned-CfT profile exposed `LanguageModel` in the window, returned `unavailable` from
  `availability()`, and did not expose `LanguageModel` in a dedicated worker.
- **Repro:** launch the pinned browser with a clean external profile, read
  `typeof LanguageModel` and `await LanguageModel.availability()` in the page, then
  create a blob-backed dedicated worker that posts `typeof LanguageModel !==
  "undefined"`. `prompt-api-spike@1` records the two contexts independently and treats
  worker-probe failure as diagnostic rather than blocking the window measurement.
- **Impact on Parallax:** the game could not place the built-in model behind the normal
  worker topology. D-096 selected app-owned inference whose heavy execution runs in
  wllama-created workers, so the current product no longer carries this exception.
- **Proposed improvement:** expose the API in dedicated workers with a defined
  responsible-document/permissions-policy relationship; preserving the session and
  streaming shape would let the broker migrate without changing game consumers.
- **Sources checked:** Chrome
  [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) and the
  WICG [Prompt API proposal](https://github.com/webmachinelearning/prompt-api), checked
  2026-07-16.

## RE-015: CDP memory-dump request GUID is not preserved in JSON trace export

- **Date / Chrome version:** 2026-07-14; Chrome for Testing Stable 150.0.7871.115 on
  Windows 11/dev-01/D3D12 (remote diagnostic; display invalidity is irrelevant to this trace
  identity result).
- **Layer:** CDP Tracing / Perfetto JSON export.
- **Status:** open; `smoke@1` retains both identities and requires one unambiguous GPU-process dump
  instead of asserting equality (D-050).
- **What we expected / What happened:** `Tracing.requestMemoryDump` returned success with GUID
  `0x2` or `0x3`, but the sole allocator-bearing dump exported as event name
  `periodic_interval`, ID `0x0`. Waiting one second after the successful request and explicitly
  supplying `memoryDumpConfig` did not change the exported identity. The final physical-console
  schema-v16 run extended the ambiguity: one explicit request per launch produced two allocator-
  bearing GPU-process dumps in 2/6 core traces, so those provider diagnostics were invalid because
  neither exported dump could be correlated to the returned `0x3` request GUID.
- **Repro:** start a CDP trace with `disabled-by-default-memory-infra`, load the walking skeleton,
  call `Tracing.requestMemoryDump`, wait for its successful response, stop the trace, and compare
  the returned `dumpGuid` with allocator-bearing `ph: "v"` events. `smoke@1` retains these fields
  in every core-run result.
- **Impact on Parallax:** dump attribution is safe only while the harness requests exactly one dump
  and observes exactly one allocator-bearing GPU-process event. Multiple phase-specific dumps
  cannot be correlated through the documented GUID in current JSON export, and Chrome can
  nondeterministically violate the single-observed-dump condition even when Parallax issues only
  one request.
- **Proposed improvement:** preserve the CDP request GUID and explicit trigger name in exported
  events, or return an event timestamp/trace packet sequence that clients can correlate without
  relying on a single-dump invariant.

## RE-014: Chrome exposes no page-attributed WebGPU resident-memory total

- **Date / Chrome version:** 2026-07-14; Chrome for Testing Stable 150.0.7871.115 on
  Windows 11/dev-01/RTX 4080 Super/D3D12 (remote diagnostic; six core runs plus controlled
  background/detailed single-launch dumps).
- **Layer:** WebGPU/Dawn / CDP memory-infra.
- **Status:** open; Harness v1 reports the GPU-envelope metric `unsupported` and retains the
  GPU-process allocator inventory (D-050).
- **What we expected / What happened:** a WebGPU game needs attributable resident and transient
  GPU bytes. Successful Chrome GPU-process memory dumps exposed general GPU, shader-cache,
  shared-image, transfer, and Skia allocators; a detailed dump also exposed
  `gpu/shader_cache/webgpu_cache_0x1`. Neither background nor detailed dumps exposed an allocator
  for the web-created Dawn device's buffers/textures, and CDP/WebGPU expose no alternative
  page-attributed resident total. The similarly named Chromium `gpu/dawn` provider covers a
  separate shared/Graphite Dawn context, not devices owned by `WebGPUDecoderImpl`.
- **Repro:** run `smoke@1` and inspect each run's `gpuMemory` evidence. For the controlled variant,
  request a detailed memory-infra dump after `__PARALLAX_TELEMETRY__` reports the render worker
  ready; inspect the GPU-process allocator names while the animated Babylon WebGPU scene is live.
- **Impact on Parallax:** the 4 GB/14 GB GPU envelopes cannot be automatically evaluated from
  page-attributed evidence. Process private memory and Windows per-process GPU counters are not
  substitutes: Chrome's GPU process is shared with compositor/browser work and Chromium documents
  platform-dependent graphics-memory accounting. Logical resource-size estimates, if later
  exposed, still would not establish residency or transient allocator peaks.
- **D-113 physical observation:** the one-shot CfT 151 diagnostic accepted memory dump
  request `0x20` in 113.1782 ms but retained zero allocator-bearing GPU-process dumps.
  Page-attributed GPU residency therefore remained `unsupported`; the successful CDP
  request alone is not usable allocator evidence and does not establish a new Chrome
  defect beyond this existing gap.
- **Proposed improvement:** expose per-`GPUDevice` current/peak logical allocation and resident
  allocator usage with buffer/texture/transient categories, or add an origin/page attribution key
  to Chrome's GPU memory-infra provider. Document whether shared images and aliased/suballocated
  heaps are charged once and how multi-device workloads are aggregated.
- **Sources checked:** CDP
  [Tracing domain](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/), Chromium
  [graphics memory metrics](https://chromium.googlesource.com/chromium/src/+/main/docs/memory/graphics_metrics.md)
  and [GPU memory tracing](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/memory-infra/probe-gpu.md),
  Chromium
  [`DawnSharedContext`](https://chromium.googlesource.com/chromium/src/gpu/+/bf2b35ebcf902cda172ffaa4faffca8affc539f7/command_buffer/service/dawn_context_provider.cc)
  and
  [`WebGPUDecoderImpl`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/command_buffer/service/webgpu_decoder_impl.cc)
  source, and pinned local traces.

## RE-013: Playwright cannot publicly address a flat child-target CDP session

- **Date / versions:** checked 2026-07-14 against CDP tip-of-tree, pinned Chrome for Testing
  150.0.7871.115, and local `playwright-core@1.61.1` declarations. OS/GPU: n/a
  (protocol/library declarations only — no Dawn/display dependence).
- **Layer:** CDP Target domain / Playwright transport.
- **Status:** open; the all-realm heap collector uses the deprecated non-flat nested-session path
  and fails closed if it stops working (D-047).
- **What we expected / What happened:** CDP recommends flat sessions and says non-flat mode will
  eventually be retired, but Playwright's public `CDPSession` API does not expose a constructor or
  send method for a child session ID. The collector must use `Target.attachToTarget({flatten:false})`,
  `Target.sendMessageToTarget`, and `Target.receivedMessageFromTarget` to reach the render worker.
- **Repro:** create a browser CDP session through Playwright, attach a worker with flat mode, and
  attempt to send `Runtime.getHeapUsage` through the public `CDPSession.send` API. There is no
  session-ID parameter. Non-flat routing works on the pinned Chrome and is covered by a runtime
  diagnostic plus attachment/session unit tests.
- **Impact on Parallax:** this deprecated transport is mandatory for the current cross-isolate heap
  gate. Every Chrome promotion runs the pinned mandatory smoke, so removal becomes explicit invalid
  evidence rather than a silent pass, but it can block the harness until Playwright exposes flat
  child sessions or the collector adopts another supported transport.
- **Proposed improvement:** expose a public Playwright child-session API backed by flat CDP routing,
  or add a first-class CDP aggregate memory surface that does not require per-worker attachment.
- **Sources checked:** [CDP Target domain](https://chromedevtools.github.io/devtools-protocol/tot/Target/)
  and pinned local Playwright type declarations.

## RE-012: CDP exposes isolate used-heap snapshots but no continuous live-retention high-water

- **Date / Chrome version:** protocol source and remote runtime diagnostic checked 2026-07-14;
  long-window physical evidence checked 2026-07-25; Chrome for Testing Stable
  150.0.7871.115 and 151.0.7922.34 on dev-01.
- **Layer:** V8 / CDP memory observability.
- **Status:** open; `smoke@1` operationalizes the JS-heap budget as a fixed-deadline 100 ms
  near-concurrent estimate in a dedicated post-trace window (D-047) and records probe duration
  and per-realm CDP response-completion skew. D-101 uses a fixed 200 ms interval for
  `flythrough-d1@1`'s seven-realm ten-minute window.
- **What we expected / What happened:** a game memory gate needs the peak simultaneously retained
  JavaScript heap across the window and every worker. `Runtime.getHeapUsage` returns current totals
  for one isolate. `HeapProfiler.startSampling` samples allocations, optionally including objects
  later collected, while `Memory.startSampling` profiles native allocations; neither surface
  reports the continuous cross-isolate retained-size high-water. Polling can therefore miss a
  short-lived residency peak between samples, while summing independent per-isolate maxima can
  invent a peak that never coexisted. The protocol's `usedSize` is V8 heap occupancy, including
  unreachable objects awaiting garbage collection, so snapshots are also GC-phase-sensitive and
  cannot establish live retention.
- **Repro:** attach CDP sessions to a window and dedicated worker, issue near-concurrent
  `Runtime.getHeapUsage` calls around a shorter-than-poll-interval allocation/free burst, and
  compare the returned snapshots with the allocation profiler. The maintained collector and its
  exact sampling contract live in `harness/src/js-heap.ts`. A post-review six-launch remote
  diagnostic measured both realms in the dedicated post-trace window in all 168 samples (28 per
  launch): aggregate observed peaks were 8.28–12.04 MB, maximum fixed-deadline start delay was
  13.2–15.7 ms, maximum Node-observed response-completion skew was 0.0 ms at report precision, and
  the slowest collection per launch was 1.1–16.2 ms. Every launch returned measured cadence evidence. This
  validates the collector integration, not exact peak coverage or a reference-machine budget
  result. Response-completion timing is CDP arrival timing and cannot bound when V8 read each
  isolate. D-113's seven-realm physical invalid partial observed a synchronized
  used-plus-reported-backing high-water of 89,593,455 bytes and independent used/backing
  maxima of 43,119,472/71,505,215 bytes. Separately identified Wasm/SAB ownership was
  2,170,912 bytes, but CDP did not establish whether those bytes were absent, present,
  or duplicated in reported backing storage. D-114 therefore retains no additive CPU
  resident total. The attempt also exposed a harness start-scheduling defect: one
  periodic sample began before its nominal deadline. The maintained sampler now
  schedules before capture and preserves any exact negative delay as invalid evidence;
  this fixes collection semantics without changing the platform limitation.
  D-100's second retained physical attempt
  (`flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T07-25-16-847Z.json`)
  recorded one whole-topology collection at 478,100 ms whose seven responses completed
  after 139.1–169.5 ms; the next-slowest collection was 14.5 ms and fixed-deadline
  start delay remained at most 15.9 ms. The sampler skipped the 478,200 ms deadline
  rather than overlapping requests. D-101 makes that long run's cadence 200 ms and
  corrects exact scheduled-deadline accounting; it does not claim continuous peak
  coverage.
- **Impact on Parallax:** the sampled estimate is diffable and budgetable, but it can under- or
  over-estimate a truly simultaneous total. GC scheduling can move the observed value without a
  change in live retention. Short-lived allocation churn needs separate allocation/GC diagnostics
  before the harness can claim exact peak residency. The harness invalidates missed fixed
  deadlines and collection duration, response-completion skew, or start delay at least
  as large as the scenario's configured interval rather than presenting poor temporal
  coverage as measured evidence.
- **Proposed improvement:** expose a resettable per-isolate retained-JS-heap high-water counter and
  a page/origin aggregation surface that includes dedicated/shared/service workers, with timestamped
  breakdowns for JS heap, embedder heap, backing stores, wasm memories, and SABs.
- **Sources checked:** [CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/),
  [HeapProfiler](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/),
  [Memory](https://chromedevtools.github.io/devtools-protocol/tot/Memory/), and the current
  [V8 inspector implementation](https://chromium.googlesource.com/v8/v8/+/b339cf019df6e238d0bf5e970e513e941dc6d563/src/inspector/v8-runtime-agent-impl.cc).

## RE-011: WebGPU exposes a single queue per device — async compute is unavailable to any web engine

- **Date / Chrome version:** 2026-07-14. Spec-level, not version-specific — the constraint is in
  the WebGPU API shape, not in a Chrome build. (Confirmed present in Chrome for Testing Stable
  150.x, the `smoke@1` pin.)
- **Layer:** WebGPU/Dawn.
- **Status:** open (spec gap — not a bug).
- **What we expected / What happened:** native engines fill idle GPU occupancy by submitting
  compute work on a separate compute-only queue while graphics work proceeds. WebGPU exposes
  exactly one `GPUQueue` per `GPUDevice` (`device.queue`, readonly), with no API to create
  another. Multi-queue has been under working-group investigation since 2020 and is not in the
  spec ([gpuweb#1065](https://github.com/gpuweb/gpuweb/issues/1065)). Overlapping compute and
  graphics on independent queues is therefore not expressible on the web at all.
- **Repro:** any WebGPU context — `const d = await (await navigator.gpu.requestAdapter()).requestDevice();`
  then observe that `d.queue` is the only queue and `GPUDevice` has no queue-creation method.
  Nothing to file: the API simply has no surface for it.
- **Impact on Parallax:** **cost unquantified — do not claim one yet.** Independent work on a
  single queue can still be interleaved or reordered by the hardware scheduler, so the loss is
  not automatically the naive "serialized" worst case. What is certain is that we cannot
  *express* the overlap, which constrains GPU-driven culling and streaming-transcode scheduling
  to a single submission timeline. Quantifying the gap (measured occupancy during a culling
  dispatch overlapping a render pass) is the follow-up, and is a prerequisite for citing this
  anywhere.
- **Proposed improvement:** multi-queue support, or a narrower async-compute hint that lets an
  application mark a compute pass as latency-tolerant so the implementation may overlap it with
  graphics work. Either would need a story for cross-queue synchronization.
- **Note — why this is logged here and nowhere else:** Unity's WebGPU-limitations page lists
  "Async compute" as unsupported, which reads like an engine gap and is not one. This is a
  *platform* limit binding every web engine, Babylon and Parallax included. It must never be
  cited as an argument against Unity — see the "Not on this list" section of
  [rendering-engine-research.md](rendering-engine-research.md) and D-046.

## RE-010: Module workers expose incomplete URL-attributed V8 code-cache events

- **Date / Chrome version:** 2026-07-14 and 2026-07-20; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostic (non-gating).
- **Layer:** V8 / Blink / worker / CDP observability.
- **Status:** open; Harness-v1 records the missing launch-2 evidence and any negative cache
  outcome as non-blocking informational failures per D-051; M2 will gate launch/update performance.
- **What we expected / What happened:** On the second launch of each persistent-profile
  lineage, every cacheable immutable JavaScript artifact must expose a URL-attributed
  `v8.produceCache` or `v8.produceModuleCache` event with positive `producedCacheSize`.
  Three corrected timestamp → produce → consume lineages each measured exactly 3,072 produced
  bytes for the 1,586-code-unit app module and 6,968 bytes for the 6,298-code-unit engine module.
  The 5,257,345-code-unit render-worker module emitted its URL-attributed non-streamed
  `v8.compileModule` event on every produce launch but no matching production event in 3/3
  lineages. This establishes an artifact- and worker-specific observability or production gap;
  it does not distinguish cache production being skipped from production occurring without a
  trace event. The worker is 99.84% of the build's 5,265,895 decoded JavaScript code units;
  artifacts with observed production account for only 0.15%. D-042's retained non-streamed
  compile-event duration measured 24.862–25.262 ms fresh, 25.083–26.496 ms on launch 2, and
  24.415–26.758 ms warm. The overlapping ranges show no consistent warm reduction but do not
  identify whether caching, parsing, or another mechanism produced the span. D-043's broader
  worker-startup-to-first-frame timer measured 182.4–206.5 ms fresh and 144.2–154.5 ms warm
  across two runs. Launch 2 was normally 146.0–152.9 ms but included one retained 789.5 ms
  outlier. The improvement appeared on launch 2 in the first run, before launch 3, while the
  outlier confirms that this whole-worker-path timer is not a controlled V8 cache proxy. The
  unchanged V8 lineages in D-044's category control provided a direct counterexample to a
  consistent launch-2 → launch-3 saving: launch 2 measured 148.7/150.7/150.4 ms and launch 3
  145.3/156.8/151.4 ms, with launch 3 slower in two lineages. The data therefore cannot bound
  V8 cache savings or assign the 789.5 ms spike to cache serialization.
  The schema-v25 physical-console gate added a small dedicated module worker for the
  Rust/WASM proof. Across all three V8 diagnostic lineages Chrome emitted zero
  URL-attributed compilation events for that worker, while the same worker executed and
  completed mandatory telemetry in every core run. Launch-2 production therefore also
  remained unobservable. This broadens the finding from the large render worker's missing
  production event to a second, independently bundled module worker and an earlier
  compilation-attribution gap; worker size is not a sufficient explanation.
- **Repro:** run `smoke@1` with `v8-code-cache@6` in
  `harness/src/v8-code-cache-trace.ts`. For each of three fresh-profile directories, let launch 1
  establish the hot-resource timestamp, inspect URL-attributed production events on launch 2,
  and retain the same profile for launch 3. The v8 result records each matching process/thread,
  requires a finite positive `producedCacheSize`, asserts no fresh production, and flags any
  warm re-production. It retains positive app/engine outcomes even though the missing worker
  outcome makes launch-2 production `invalid`.
- **Impact on Parallax:** the harness proves that main-realm cache production works but cannot
  establish the write prerequisite for the render worker, so Harness v1 reports an informational
  limitation and prevents a worker cache-hit claim even if RE-009's launch-3 consumption fields
  become observable. The measured event is roughly 25 ms, only about 0.25%
  of the current ≤10 s warm-launch budget, and the broader warm worker-startup component has
  measured 144–157 ms (about 1.6%), so 99.84% source share does not make this a dominant measured
  launch-time cost. It is still not evidence that all worker code is reparsed/recompiled on every
  launch: the missing production event may be missing telemetry, and neither timing is an
  authoritative cache outcome.
- **Proposed improvement:** expose a URL-attributed production result for worker modules through
  the existing V8 trace events or a stable CDP/performance API, including a reason when Blink
  deliberately declines to produce cache so tooling can distinguish policy from telemetry loss.

## RE-009: Streamed ES-module traces omit V8 code-cache consumption results

- **Date / Chrome version:** 2026-07-13–14; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostics plus a physical-console gate reproduction.
- **Layer:** V8 / Blink / CDP observability.
- **Status:** open; Harness-v1 records missing or negative warm cache evidence as a non-blocking
  informational failure per D-051; M2 will gate launch/update performance instead.
- **What we expected / What happened:** Chrome's `v8.compileModule` trace schema can report
  `consumedCacheSize` and `cacheRejected`, which would provide exact URL-attributed cache-hit
  evidence. Across a persistent-profile five-launch diagnostic, every launch emitted compilation
  events for all four immutable Parallax module URLs, but none carried either consumption field.
  The window modules reported `streamed: true`; the render-worker module reported non-streamed
  compilation but likewise lacked consumption fields. The second launch instead emitted exact
  cache-production events for the app (3,072 bytes) and engine (6,968 bytes), so those artifacts
  demonstrably did not consume cached code on launch 2. A corrected maintained diagnostic then
  reached launch 3 in three independent lineages; every cacheable module still omitted a usable
  consumption result. A further `v8-code-cache@3` control observed zero app/engine
  re-production events on launch 3 in all three lineages. That result does not prove cache
  consumption, but it fails to support repeated production as the functional explanation and
  leaves the streamed app/engine result as an observability gap. The non-streamed render worker
  is not attributed to this streamed-module gap because RE-010 has not established its launch-2
  production prerequisite. On an established profile, the
  process-wide `WebCore.Scripts.V8CodeCacheMetadata.Get` histogram contained four code-cache
  metadata reads, but it cannot identify the page URL or prove that V8 accepted the metadata.
  Chromium's pinned source confirms that the module `ScriptStreamer` branch does not populate the
  optional consume result that the non-streaming branch passes to the trace event.
  D-042 retained the streamed compile-event spans: app measured 37–40 µs fresh versus 26–30 µs
  warm, while engine measured 3–8 µs in both phases. These tiny spans are diagnostic and do not
  prove cache consumption or absence.
- **Repro:** run `smoke@1` with the isolated `v8-code-cache@5` collector (D-039–D-043) in
  `harness/src/v8-code-cache-trace.ts`. The collector matches each compile event to the validated
  build manifest, uses decoded source-code-unit length for Chrome's cacheability threshold, and
  retains every process/thread compilation when one URL appears in multiple realms. Successful
  consumption requires positive consumed bytes plus `cacheRejected: false`; an explicit
  rejection is measured and flags the expected-zero diagnostic even if its size is degenerate. A
  missing result is invalid. Each lineage uses launch 1 for Blink's hot timestamp, requires
  positive URL-attributed production on launch 2, checks consumption on launch 3, and separately
  requires zero launch-3 re-production. A three-lineage remote diagnostic attributed every
  artifact; all three launch-3 consumption results remained `invalid` while re-production was
  measured at zero. For supporting process-wide evidence, import
  subprocess metrics through `chrome://histograms/` and inspect
  `WebCore.Scripts.V8CodeCacheMetadata.Get`; do not interpret its code-cache bucket as a
  page-specific hit.
- **Impact on Parallax:** the harness can prove which Parallax artifacts compiled and can detect
  a reported rejection, but it cannot prove that warm streamed modules consumed cached code.
  Harness v1 therefore retains an explicit informational failure rather than substituting HTTP-
  cache behavior, metadata delivery, or compile timing. The same diagnostic will become measured
  if Chrome begins emitting the existing consumption fields for these events; a measured
  rejection remains a finding and diagnostic signal rather than a product-performance verdict.
- **Proposed improvement:** populate `V8ConsumeCacheResult` for streamed module compilation and
  serialize it on the existing URL-attributed trace event, or expose equivalent per-resource
  code-cache consume/reject evidence through a stable CDP or performance API.

## RE-008: Browser trace completion becomes intermittently unbounded across category sets

- **Date / Chrome version:** 2026-07-13 through 2026-07-25; Chrome for Testing Stable
  150.0.7871.115 and candidate Stable 151.0.7922.34;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostic (non-gating).
- **Layer:** CDP tracing / browser-renderer-GPU process coordination.
- **Status:** open platform issue; D-039 mitigates its harness impact by isolating V8 from the
  maintained core trace.
- **What we expected / What happened:** To give the Dawn trace and process-wide UMA an
  atomic app-lifetime boundary, the harness opened a blank keepalive tab, closed the measured
  app page, waited for a quiescence tail, and called `Tracing.end`. Four of six traces completed
  within D-035's five-second transaction bound, but warm repeats 1 and 3 never delivered
  `Tracing.tracingComplete` before the timeout. The same combined trace completed reliably
  when the measured renderer remained alive in the original D-036 rerun. Follow-up after D-037
  added `devtools.timeline`: the first six-launch diagnostic completed all traces, while second,
  third, and instrumented fourth diagnostics timed out on one, three, and three traces
  respectively even with the measured renderer alive (17/24 completed at the five-second bound).
  D-038's A/B then replaced the broad category with `v8`: across two diagnostics, 9/12 traces
  completed, versus 6/6 in a no-V8 arm. Successful broad-category drains delivered roughly
  5.0 MB in 149–152 ms; successful `v8` drains delivered roughly 4.1 MB in 117–120 ms. Every
  instrumented timeout delivered zero events/chunks. In two timed-out `v8` traces, `Tracing.end`
  returned in 1.6–2.1 ms but no completion event arrived during the remaining five seconds. No
  completed trace reported CDP buffer data loss. A 20-second broad-category arm completed 6/6,
  but all completions remained fast at 146–153 ms, so it did not capture evidence of a slow
  flush. V8 tracing is correlated with the failure in these small remote samples; payload drain,
  buffer overflow, and `Tracing.end` command latency do not explain the captured timeouts.
  A `ReturnAsStream` arm reproduced the same signature twice in six launches: `Tracing.end`
  returned in 1.8–1.9 ms, but no completion event arrived to provide a stream handle. D-039 then
  isolated `v8`; two integrated diagnostics completed 12/12 core traces and 12/12 V8-only
  traces, preserving all Dawn evidence while keeping V8's independent RE-009 invalid results.
  A final-tree D-040 diagnostic completed 9/9 isolated V8 traces, but core fresh/warm repeat 3
  both acknowledged `Tracing.end` in 1.8–2.1 ms and then delivered zero events or chunks before
  the five-second timeout (4/6 core traces completed). Isolation therefore prevents cross-probe
  evidence loss, but a core-only category set does not eliminate the underlying completion gap.
  A subsequent schema-v9 run recorded ordinal and elapsed-sequence position: core launches 3,
  4, and 5 failed at approximately +30 s, +50 s, and +70 s, then launch 6 completed at +90 s.
  Alongside earlier warm-repeat-1 failures, this argues against a simple monotonic late-session
  cutoff. The earlier V8-category correlation remains descriptive small-sample evidence, not a
  causal attribution; the failure now reproduces without V8 tracing. The next final-tree run
  completed all six core traces at ordinals 1–6, confirming that failure at a given ordinal is
  not deterministic. A later run failed only at ordinal 5 and recovered at ordinal 6. The
  captured consecutive-failure sample therefore establishes that failures can occur in a burst
  and recover, but one burst cannot distinguish transient shared state from chance clustering.
  D-043 measured the maintained recording lifetimes directly across two runs: core traces were
  open 13,190.5–14,187.3 ms and isolated V8 traces normally 288.9–387.9 ms, with one 944.8 ms
  V8 trace extended by the retained worker-startup outlier. A controlled fresh-browser
  `about:blank` matrix held the same category sets for 300 or 14,100 ms with no measured-page
  activity. Short core, long core, and long V8 arms each completed 6/6. Long core carried only
  80–89 events / 13,496–14,645 bytes and long V8 43–52 events / 6,949–8,074 bytes, versus roughly
  25,000 events / 4 MB for the active core run. Recording lifetime alone therefore does not
  reproduce the gap; active-page event volume, process participation, and their interaction with
  categories remain candidates. D-044 then kept the active app, render worker, 4K target,
  warmup, measurement window, page lifetime, and completion bound unchanged while tracing only
  `blink.user_timing`. That control still failed at ordinal 5 (5/6 completed): `Tracing.end`
  returned in 2.3 ms, but zero events/chunks and no completion arrived before invalidation at
  5,006.3 ms; ordinal 6 recovered. Successful traces carried only 221–237 events /
  34,744–36,798 bytes and completed in 13.0–13.9 ms. Enabled GPU categories and multi-megabyte
  payload are therefore not necessary conditions. Browser-level tracing can still coordinate a
  process that emits no enabled events, so the failed arm does not identify which process withheld
  completion or prove a GPU-process mechanism. The first physical-console schema-v12 gate then
  reproduced the maintained core failure on warm repeats 2 and 3 (ordinals 4 and 6). Both traces
  were open for 12,828.8–12,845.0 ms, acknowledged `Tracing.end` in 1.9–2.1 ms, delivered zero
  events/chunks, and had no completion after 5,009.1–5,013.3 ms. The other four core traces
  delivered 40,793–41,583 events / 6.80–6.93 MB and completed 179.0–185.9 ms after the end
  command; all nine isolated V8 traces completed. The registered environment was `measured`
  (`remoteSession: false`, native 3840×2160 at observed 59 Hz), so remote display/session state is
  not necessary for RE-008 and the issue can invalidate a real reference gate. The D-058 final
  artifact (`bf83d4c84358`) then reproduced the same gap in two consecutive physical-console
  gates: the first lost core ordinal 5, and the second lost ordinals 2 and 5. Each acknowledged
  `Tracing.end` in 1.8–2.4 ms, delivered zero events/chunks, and timed out after 5,003.7–5,009.8
  ms; the unchanged artifact's third attempt completed all six core traces in 231.9–235.7 ms and
  passed. This adds both a consecutive-gate burst and unchanged-artifact recovery to the finding.
  D-063's sandboxed schema-v20 confirmation artifact
  (`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-09-09-623Z.json`) reproduced the
  same signature at fresh core ordinal 1: the trace was open for 15,749.9 ms,
  `Tracing.end` returned in 2.5 ms, zero events/chunks arrived, and completion timed out
  after 5,001.6 ms. The other five core traces and all nine isolated V8 traces completed.
  The immediately preceding sandboxed run
  (`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-06-27-753Z.json`) completed every
  trace, so retaining Chrome's normal sandbox neither removes the failure nor makes it
  deterministic. The M0 Chrome 151 candidate artifact
  `smoke-1-a05e3d13d506-dev-01-showcase-2026-07-21T00-25-46-151Z.json` reproduced the same
  signature on physical-console fresh repeat 2: `Tracing.end` returned in 2.4 ms, then zero
  events/chunks and no completion arrived during 5,013.4 ms. The other five core traces
  completed in 287.2–296.2 ms, all six Wasm workloads completed, and the exact Chrome 150
  anchor had passed immediately beforehand. RE-008 therefore survives the Chrome 151
  transition and remains independently nondeterministic rather than a Chrome 150-only issue.
  A second same-artifact attempt,
  `smoke-1-a05e3d13d506-dev-01-showcase-2026-07-21T00-34-57-688Z.json`, repeated the
  signature at fresh repeat 3: `Tracing.end` returned in 1.8 ms, no events/chunks or
  completion followed for 5,011.2 ms, and all six Wasm workloads had completed. The final
  phase-instrumented Chrome 151 candidate
  `smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` then completed all
  six core traces in 286.2–309.1 ms and was promoted after passing all facets and budgets.
  Recovery qualifies the artifact; it does not close this burst-capable finding.
  D-089's final artifact reproduced the signature twice in one otherwise complete
  six-run gate: warm repeats 1 and 2 acknowledged `Tracing.end` in 2.9/2.1 ms, delivered
  zero events/chunks, and timed out at five seconds in
  `smoke-1-040677b31910-dev-01-showcase-2026-07-21T02-26-10-634Z.json`. The unchanged
  artifact then passed every trace and all 24 checks in the 02:28:50 replacement above.
  D-090's schema-v27/metric-set-v12 physical-console attempt
  `smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-52-32-648Z.json` reproduced the
  same signature immediately: fresh ordinal 1 acknowledged `Tracing.end` in 2.1 ms,
  delivered zero events/chunks, and timed out after 5,015.4 ms. The unchanged artifact
  then completed all six core traces in 282.5–291.6 ms and passed all three facets and
  24 checks in
  `smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json`.
  D-091's final-source schema-v28/metric-set-v13 attempts reproduced the same signature
  on warm repeat 2, fresh repeat 3, and fresh repeat 1 in
  `smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-08-06-593Z.json`,
  `smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-10-12-735Z.json`, and
  `smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-12-01-644Z.json`. The end
  commands returned in 2.0–2.3 ms, but zero events/chunks and no completion arrived
  during 5,002.9–5,014.1 ms. A report-only source state immediately before those
  attempts completed all six traces and passed all 30 checks in the `00-04-07-045Z`
  report; the final source state remains unqualified rather than using that near-match.
- **D-092 source attribution and probe:** VM Chromium checkout `4dc95450a818a` shows
  `Tracing.end` acknowledging before the asynchronous Perfetto stop callback, trace read,
  final statistics request, and `Tracing.tracingComplete`. Perfetto's default
  data-source-stop timeout is 5,000 ms, exactly matching the previous harness deadline.
  The outer timer could therefore detach as Perfetto's forced-stop path became eligible,
  before its later read/stat/completion work reached CDP. Schema v29 initially kept the
  five-second validity rule but remained attached for a further ten-second diagnostic
  window, retaining late completion as explicitly invalid or recording that completion
  stayed absent for the full 15 seconds. The earlier 20-second arm happened to complete all six
  samples quickly and did not observe this failure path. `ReturnAsStream` already
  reproduced the signature, so event-based delivery is not treated as causal; protobuf
  and controller-owned file capture remain conditional controls if a retained failure
  reaches the read/serialization phase.
- **D-092 measured result:** physical-console schema-v29 artifact
  `smoke-1-8d18fd6125cd-dev-01-showcase-2026-07-25T00-43-30-949Z.json`
  captured the previously lost terminal path. Fresh repeat 1 acknowledged
  `Tracing.end` in 2.5 ms, crossed the unchanged five-second validity boundary, then
  delivered `Tracing.tracingComplete` 5,305.5 ms after the command (5,308.0 ms total
  observation). The retained trace contained 70,985 events in 400 chunks /
  11,649,521 serialized bytes with `dataLoss=false`. The run remained invalid. This
  confirms that the old outer timeout raced Perfetto's internal five-second
  data-source forced-stop boundary; it was not evidence of an indefinitely missing
  completion. A later relocated final artifact completed all six traces normally in
  299.1–301.6 ms. Its same-artifact confirmation
  `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-05-37-290Z.json`
  reproduced the late path on fresh repeat 1: 70,711 events / 406 chunks /
  11,801,838 bytes, `dataLoss=false`, and completion 5,301.8 ms after the end
  command (5,303.7 ms total). Both late samples cluster immediately after the
  internal forced-stop threshold and retain the intermittent classification.
- **D-094 gate policy:** future complete, readable traces with `dataLoss=false` are
  valid through 10,000 ms. The collector retains a further 10,000 ms diagnostic window
  and still fails closed for later/missing completion, unreadable data, or trace loss.
  This makes RE-008 a measured trace-drain latency finding at the observed 5.3-second
  path instead of treating Perfetto's internal timeout as Parallax's correctness
  deadline. Physical-console report
  `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-15-05-125Z.json`
  passed all three facets and 30 checks while exercising the new range: isolated V8
  fresh repeat 2 retained 285 events / 45,205 bytes with `dataLoss=false` and accepted
  completion at 5,020.1 ms. D-095's targeted schema-v30 confirmation
  `smoke-1-188e456726f4-dev-01-showcase-2026-07-25T02-07-11-589Z.json`
  passed the same facets/checks and accepted another complete core trace at 5,307.5 ms
  with 69,983 events / 398 chunks / 11,627,977 serialized bytes and `dataLoss=false`.
  Final D-104 exact-artifact smoke report
  `smoke-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-36-37-999Z.json`
  likewise passed all three facets and 30/30 checks while accepting warm-repeat-3
  completion at 5,315.897 ms with 71,365 events / 404 chunks / 11,729,783 serialized
  bytes and `dataLoss=false`. This is another instance of the existing D-094/RE-008
  path, not a separate finding.
- **D-101 long-window payload scaling:** the first two physical-console
  `flythrough-d1@1` attempts on artifact `68c66fccf453` retained complete lossless
  traces that exceeded D-094's smoke-sized ten-second validity bound. Report
  `flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T07-13-41-667Z.json`
  delivered 2,511,021 events in 14,058 chunks / 419,019,736 serialized bytes and
  completed in 19,484.2 ms after a 0.3 ms `Tracing.end` command. Report
  `flythrough-d1-1-68c66fccf453-dev-01-showcase-2026-07-25T07-25-16-847Z.json`
  delivered 2,527,527 events in 14,209 chunks / 428,288,884 bytes and completed in
  19,208.2 ms after a 0.2 ms end command. Both reported `dataLoss=false`; their
  approximately 21.5–22.3 MB/s serialized delivery and steadily populated chunks
  distinguish this payload-bound long-window path from the historical zero-chunk
  intermittent stall. D-101 gives only this ten-minute flythrough a 30-second validity
  deadline plus the existing ten-second invalid diagnostic window. The routine smoke
  contract remains 10 + 10 seconds.
- **D-113 larger-payload observation:** the one-shot privileged canonical trace had
  delivered 4,190,120 events in 30,433 chunks / 878,610,107 serialized bytes when its
  40,000.7 ms observation bound expired. The retained invalid partial ultimately held
  4,221,682 events in 30,589 chunks / 883,071,678 bytes after 165,167.074 ms, still
  without `Tracing.tracingComplete`; `dataLoss` remained unknown. This is a steadily
  populated, approximately 883 MB payload observation, not the historical zero-chunk
  intermittent signature and not evidence of a separate zero-chunk bug. D-114 closes
  the one-shot apparatus; the result changes neither routine smoke nor flythrough
  deadlines.
- **M4.5 integrated CSM, 2026-09-04:** physical dev-01 / Chrome for Testing Stable
  152.0.7977.54 / Windows 11 26200.9168 / RTX 4080 Super driver 32.0.16.1074,
  D3D12, completed the standard ten-minute route but reported `dataLoss=true` in
  `flythrough-d1-1-3e610c0328fe-dev-01-showcase-2026-09-05T01-31-08-959Z.json`.
  The narrow Dawn/user-timing trace delivered 4,329,014 events in 24,766 chunks /
  710,956,503 serialized bytes; `Tracing.end` acknowledged in 0.246 ms and completion
  arrived in 17,933.7 ms. This is reported data loss, not a completion timeout. Capacity
  was unspecified (the pinned CDP protocol documents a 200 MB default); the actual
  loss location is not established. No budget or zero-gameplay-compile claim survives.
  The pre-CSM control separately failed its third clear-daylight checkpoint, so it is
  also invalid. Flythrough v37 now preserves raw gameplay telemetry before trace
  finalization and requests/records 1,048,576 KiB; a bounded rerun tests that capacity
  hypothesis without changing categories, route, repeats, loss checks, or deadlines.
  The bounded same-artifact rerun
  `flythrough-d1-1-3e610c0328fe-dev-01-showcase-2026-09-05T01-58-31-402Z.json`
  completed two lossless traces: 6,626,049 / 6,624,862 events and 1,093,350,490 /
  1,092,301,292 serialized bytes, draining in 28,120.3 / 28,822.3 ms within the unchanged
  30-second deadline. This supports explicit capacity as a mitigation for this workload;
  it does not identify the internal loss location or qualify larger workloads. Repeat
  three failed its initial rendered checkpoint before tracing, exactly as the pre-CSM
  control did. The overall report remains failed and its budget facet not evaluated.
- **Repro:** to reproduce the coupling, run a combined trace with
  `disabled-by-default-gpu.dawn`, `disabled-by-default-display.framedisplayed`, `v8`, and
  `blink.user_timing`; keep the measured page alive through `Tracing.end` with the ten-second
  completion bound. Maintained `smoke@1` instead traces the first three categories without `v8`
  for its core run; `pnpm harness:smoke:v8-cache` opts into the isolated
  `v8-code-cache@6` lineages. The v30 result records whether that diagnostic was
  requested, plus
  categories, event/chunk/serialized-byte volume, end-command and completion latency, and data
  loss plus recording lifetime, launch ordinal, elapsed sequence time, and whether completion
  arrived only during D-092's invalid diagnostic window for both sets. To
  reproduce the lifetime control, launch a fresh pinned browser on `about:blank`, start a
  browser-level `ReportEvents` trace with either the core or `v8` categories, idle for 300 or
  14,100 ms, then end with the same ten-second completion bound; repeat each arm at least six
  times. To reproduce the active category control, keep the maintained app run unchanged but
  replace the core category list with only `blink.user_timing`; the recorded 2026-07-14 arm
  completed 5/6. The non-gating diagnostic
  reports were generated locally on 2026-07-13 and 2026-07-14 and intentionally remain ignored.
  The original renderer-teardown variant remains useful for reproducing the earlier, more
  frequent form of the failure.
- **Impact on Parallax:** renderer teardown is not a reliable trace/UMA boundary, and category
  combination is correlated with missing completion across remote diagnostics, but no enabled GPU
  category or remote session is required. D-039
  removes V8 from the maintained core trace, so a V8 timeout no longer invalidates presentation
  or Dawn. Core completion failure remains fail-closed for those core probes, and an isolated V8
  completion failure is retained as a non-blocking informational failure per D-051.
- **Proposed improvement:** make browser-level `Tracing.end` completion independent of traced
  renderer teardown and trace-category combination, or expose which traced process prevents
  `Tracing.tracingComplete` after `Tracing.end` has acknowledged so harnesses can attribute and
  bound the wait safely.

## RE-007: CDP omits GPU-process Dawn histograms until Chrome Internals imports subprocesses

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostic (non-gating).
- **Layer:** CDP / Chrome metrics / WebGPU-Dawn observability.
- **Status:** open; Harness v1 synchronizes through `chrome://histograms/` after the
  measurement window (D-036).
- **What we expected / What happened:** Dawn records exact shader and D3D12 PSO cache
  hit/miss UMA in the GPU process, but `Browser.getHistograms` initially returned no
  `GPU.WebGPU` entries. Loading Histograms Internals with its subprocess checkbox enabled
  imports shared-memory child-process histograms into the browser statistics recorder;
  the same CDP query then returned `CompileShader` and `CreateGraphicsPipelineState`
  hit/miss counts and durations. CDP offers no direct include-subprocesses parameter.
- **Repro:** launch pinned Chrome with a fresh profile, run the walking skeleton, and call
  `Browser.getHistograms({query: "GPU.WebGPU.", delta: false})` (empty). Then open
  `chrome://histograms/#GPU.WebGPU.`, refresh with `#subprocess_checkbox` checked, and
  repeat the CDP call. The maintained reproduction is the D-036 probe in
  `harness/src/smoke-run.ts`; the six-launch diagnostic consistently observed fresh
  6-shader/3-PSO misses and paired warm 6/3 hits.
- **Impact on Parallax:** exact Dawn cache evidence is obtainable, but only through a
  privileged Chrome-specific page that creates another tab and synchronously coordinates
  subprocess metrics. The first synchronization runs after the gameplay marker while tracing
  remains active; a second stable synchronization after trace completion must match it, so
  deferred Dawn work cannot fall between the two evidence surfaces. The internals tab cannot
  contaminate measured focus or pacing and unrelated GPU work is excluded by the Dawn-specific
  trace/histogram filter, but the mechanism remains unsuitable as a browser-neutral telemetry
  contract.
- **Proposed improvement:** let CDP request subprocess histogram synchronization directly,
  or expose page/origin-correlated WebGPU pipeline-cache hit/miss events through tracing or
  a stable diagnostics API.

## RE-006: Viz trace omits whether a presentation-feedback callback represents failure

- **Date / Chrome version:** source checked 2026-07-13 at Chromium main; locally observed
  event shape on branded Chrome Stable 150.0.7871.102, Windows 11, NVIDIA RTX 4080 Super,
  D3D12.
- **Layer:** WebGPU/Viz compositor observability.
- **Status:** open; Harness-v1 records the missing authoritative metric as a non-blocking
  informational failure per D-051. D-115's M1 revisit retains it as an explicit
  unsupported coverage gap and makes no player-visible frame-budget claim.
- **What we expected / What happened:** `Display::FrameDisplayed` is emitted at Viz's
  sanitized presentation-feedback timestamp, but carries no success/failure field.
  Chromium converts invalid feedback to `PresentationFeedback::Failure()`, timestamped at
  failure time with `kFailure`; `Display::DidReceivePresentationFeedback` then emits the
  same trace event without serializing the flag. A callback-time distribution can therefore
  look regular even if one or more buffers were never scanned out.
- **Repro:** inspect Chromium
  `components/viz/service/display/display.cc` (`SanitizePresentationFeedback` and
  `DidReceivePresentationFeedback`) with `ui/gfx/presentation_feedback.h` (`Failure()` and
  `kFailure`), then capture `disabled-by-default-display.framedisplayed`. The maintained
  `smoke@1` collector records the resulting timestamp cadence as the explicitly non-gating
  `vizPresentationFeedbackCallbackIntervalMs` diagnostic.
- **D-113 physical shape:** CfT 151 emitted 13,892
  `Display::FrameDisplayed` phase-`I` events in one GPU-process group. The three bounded
  argument samples were empty objects and the observed shape carried neither a
  page/frame-sink identity nor presentation success. D-114 therefore records
  presentation as explicitly `unsupported`; callback timestamps cannot be promoted.
- **Impact on Parallax:** Chrome's available trace cannot satisfy budgets.md's definition
  of player-visible present-to-present time. Harness v1 keeps the metric visibly `invalid` but
  non-blocking; worker rAF and feedback-callback cadence remain diagnostics only and are not a
  passing presentation-budget result.
- **Proposed improvement:** include presentation flags (at minimum `kFailure`, ideally
  `kVSync`/`kHWClock`/`kHWCompletion`) and a page/frame-sink identifier in a stable CDP or
  Perfetto event, or expose successful presentation timing through a web performance API.

## RE-005: Branded Stable Viz-feedback pacing diverges from the current CfT callback baseline

- **Date / Chrome version:** 2026-07-13; branded Chrome Stable 150.0.7871.102;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 physical console at 3840×2160/59 Hz.
- **Layer:** scheduler / compositor / release-channel parity (attribution open).
- **Status:** open; compare the new presentation probe on exact-pinned CfT
  150.0.7871.115, then run the D-019 branded-Stable parity smoke on a promoted matching
  release.
- **What we expected / What happened:** The D-035 diagnostic recorded one GPU-process
  Viz presentation-feedback callback track during a 120-worker-callback window. It saw
  107 callbacks over 3.323 seconds, with p50 31.225 ms and p95 31.593 ms. The 120 callback
  samples immediately before tracing were already at p50 31.180 ms and p95 31.615 ms, so
  enabling the dedicated presentation trace category did not introduce the ~32 Hz pacing.
  In contrast, the current CfT 150.0.7871.115 callback-only baseline in RE-001 holds near
  60 Hz after the harness warmup-order fix. Because the browser patch/build differs and
  the CfT baseline lacks presentation timestamps, this is divergence evidence, not yet an
  attribution to branded Chrome or successful display presentation (RE-006).
- **Repro:** Build and serve the walking skeleton, launch branded Stable with a fresh
  persistent profile and native fullscreen, allow the full 10-second warmup, then trace
  only `disabled-by-default-display.framedisplayed` and `blink.user_timing`. Bound 120
  worker callbacks with user-timing markers and aggregate the intervening GPU-process
  `Display::FrameDisplayed` timestamps. The maintained implementation is
  `harness/src/presentation-trace.ts` plus `smoke@1` orchestration.
- **Impact on Parallax:** The callback diagnostic is locally validated but cannot implement
  the compositor metric because Chrome omits feedback success/failure (RE-006). A
  branded/CfT difference at the same promoted version would become a browser parity
  finding.
- **Proposed improvement:** expose page-correlated presentation timestamps through a
  stable CDP or web performance API, and make Chrome/CfT variant differences machine-
  readable so automation can attribute pacing changes without relying on build branding.

## RE-004: CDP cannot identify the selected WebGPU backend

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115
  (revision 1639810); Windows 11 build 26200.8655; NVIDIA RTX 4080 Super; dev-01.
- **Layer:** WebGPU / CDP observability.
- **Status:** open; the gate uses an isolated developer-mode identity browser per D-034.
- **What we expected / What happened:** `SystemInfo.getInfo` identifies the physical GPU
  and driver but does not identify the backend selected for the page's WebGPU adapter.
  Standard `GPUAdapterInfo` likewise omitted backend and driver. A separate Chrome launch
  with `--enable-webgpu-developer-features` exposed `GPUAdapterInfo.backend` as D3D12 and
  the matching driver, but that switch is inappropriate for the measured browser because
  it changes the runtime configuration under test.
- **Repro:** launch pinned CfT normally and compare `SystemInfo.getInfo` plus
  `navigator.gpu.requestAdapter().info` with a second launch using
  `--enable-webgpu-developer-features`. The versioned `smoke@1` identity probe performs
  this comparison against the registered machine descriptor.
- **Impact on Parallax:** a gate cannot prove the selected WebGPU backend from stable CDP
  alone. The harness needs a second short-lived browser, increasing probe cost and leaving
  backend identity dependent on a non-standard developer feature.
- **Proposed improvement:** expose the selected adapter's backend and driver through a
  stable, page-correlated CDP/WebGPU diagnostics API without changing WebGPU behavior.

## RE-003: Native fullscreen WebGPU surface is one pixel larger than the 4K display mode

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 physical console at 3840×2160/59 Hz.
- **Layer:** CSS/device-pixel conversion / fullscreen canvas sizing.
- **Status:** open; measured surface is retained and the registered ±2-pixel display
  tolerance is applied per D-034.
- **What we expected / What happened:** In six native-fullscreen fresh/warm launches,
  `ResizeObserver.devicePixelContentBoxSize` consistently reported the full-window canvas
  as 3841×2161 although Windows reported a 3840×2160 display. Chrome exposed fractional
  `devicePixelRatio` 1.3625000715 with a 2819×1586 CSS-pixel screen, whose products require
  rounding at the physical-pixel boundary. A later pinned-CfT 151 in-game benchmark
  retained another boundary manifestation: after an exact 3840×2160 ten-minute repeat,
  `innerHeight` was 1,585 rather than its initial 1,586 while screen geometry, DPR,
  physical-pixel estimate, and worker pixel size stayed unchanged. The retained report is
  `benchmark-result-1-7851397a6f82-dev-01-showcase-2026-07-25T20-35-51-111Z.json`.
  Bounded blank-page (31 seconds) and production-app (through preflight plus 109 measured
  seconds) controls stayed at 1,586, so the observation does not support a short
  fullscreen-settling explanation or a finer generic Chrome defect claim.
- **Repro:** on dev-01's physical console, launch pinned CfT with `--start-fullscreen` and
  no Playwright viewport emulation; observe a fullscreen canvas using
  `ResizeObserver({box: "device-pixel-content-box"})`. `smoke@1` records the value for every
  measurement browser and fails outside the descriptor's ±2-pixel tolerance.
- **Impact on Parallax:** an exact-equality 4K render-surface gate rejects the real native
  4K environment, while accepting the observed one-pixel conversion preserves materially
  identical workload and keeps the discrepancy explicit in every result. D-109 likewise
  retains raw CSS viewport geometry but excludes it from the in-game benchmark's
  fixed-worker comparison identity; exact worker checkpoint dimensions and all remaining
  captured environment fields stay strict.
- **Proposed improvement:** expose a deterministic way for fullscreen content to request
  the display's exact native pixel extent, or document the rounding contract applications
  should use when CSS dimensions and fractional device scale do not multiply to the mode.

## RE-002: RDP makes Chrome display timing disagree with Windows' physical mode

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115
  (revision 1639810); Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver
  32.0.15.9649; dev-01 over RDP.
- **Layer:** display/compositor observability / automation environment.
- **Status:** open; remote sessions are non-gating per D-034.
- **What we expected / What happened:** Windows `Win32_VideoController` reported the
  physical NVIDIA controller at 3840×2160 and 59 Hz, but Chrome GPU Internals' accessibility
  tree reported three displays at 32 Hz with remote-session bounds/scaling. Windows also
  exposed an active `Microsoft Remote Display Adapter`; a native-fullscreen browser reported
  a 6017×3386 device-pixel screen/render surface rather than 3840×2160. A declared 4K@60
  label or emulated viewport would therefore misidentify the presentation environment and
  could falsely contextualize the near-32 Hz callback pacing in RE-001. (Confirmed
  2026-07-15: this is exactly what happened — RE-001's 32 Hz pacing was RDP-session
  display timing; see RE-001's resolution evidence.)
- **Repro:** connect to dev-01 over RDP; launch pinned CfT headed; read
  `SystemInfo.getInfo`, the `chrome://gpu` accessibility tree, and
  `Win32_VideoController`. The versioned `smoke@1` environment probe is the maintained
  reproduction: it records the observations and marks remote/indirect-display runs invalid.
- **Impact on Parallax:** reference-machine gates cannot run through the convenient RDP
  workflow. The developer must switch to the physical console before a gating smoke run,
  and automation must distinguish diagnostic remote runs from budget evidence.
- **Proposed improvement:** expose the active presentation display, refresh behavior, and
  remote/virtual-display status through a stable CDP or web diagnostics surface tied to the
  browser window being measured. Today the harness must combine OS-specific probes with
  browser evidence and reject the ambiguous case.

## RE-001: Render-worker animation callbacks hold near 32 Hz in automated 4K smoke run

- **Date / Chrome version:** 2026-07-12; Chrome for Testing Stable 150.0.7871.115
  (revision 1639810); Windows 11 10.0.26200; NVIDIA RTX 4080 Super, driver
  32.0.15.9649; D3D12; dev-01.
- **Layer:** scheduler / Babylon / WebGPU-Dawn (attribution open).
- **Status:** our-bug (measurement environment: the runs were driven over RDP, and the
  ~32 Hz pacing was the remote session's 32 Hz display honestly reflected by worker rAF
  spacing — confirmed 2026-07-15 by cross-referencing the retained result JSONs; see
  resolution evidence. This is RE-002's mechanism and the origin of the
  physical-console rule, D-034/harness rule 9).
- **What we expected / What happened:** Across three fresh and three warm headed-profile
  runs in a native-fullscreen browser on the dev-01 3840×2160 display, worker
  `requestAnimationFrame` callback
  spacing p50 was 31.21-31.28 ms and p95 was 31.57-31.71 ms. These are callback
  timestamps, not compositor presentation timestamps, so they do not establish a 32 Hz
  presentation rate and are not compared with the Showcase frame budget. The
  worker's CPU render/submit-duration p95 was 0.69-0.95 ms, main-thread long tasks over
  50 ms were zero, and relative p95 range within fresh and warm groups was below 0.15%.
  Those diagnostics rule out noisy repeats and sustained JS submission cost, but do not
  distinguish Babylon, GPU execution/presentation, worker rAF pacing, or automation.
- **Repro:** the original harness opened and polled `chrome://gpu` after its 10-second
  warmup, briefly backgrounding the fullscreen app, then allowed only two animation frames
  before beginning measurement. In the corrected runner, Chrome-internals probing completes
  first and the app receives the full warmup afterward. Run `pnpm harness:smoke` with the
  pinned CfT and dev-01 identity from `README.md`; the JSON retains every distribution.
- **Resolution evidence (settled 2026-07-15; supersedes the earlier "harness-induced"
  and interim "driver-update" attributions):** the cause was the **RDP session**, per
  the developer's recollection and confirmed against the retained result JSONs, which
  correlate perfectly across every run lineage:
  - Every ~31.6 ms run — on **both** drivers (32.0.15.9649 and 32.0.16.1074), across
    result schemas 1-13 — carries the remote-session display fingerprint wherever the
    environment fields exist: browser refresh probe `[32]` Hz, screen 2760×1553 at
    devicePixelRatio 2.18 (RDP-scaled 4K). New-driver RDP runs from 2026-07-14 still
    pace at p95 ≈ 31.6 ms, which eliminates the driver hypothesis directly.
  - Every ~16.8 ms run carries the physical-console fingerprint: refresh `[60]`,
    screen 2819×1586 at dpr 1.363 (the physical 3840×2160 display under Windows
    scaling). The first such runs (2026-07-13T16, driver 32.0.16.1074) are the original
    "resolution" — which coincided with moving to the physical console, not with the
    warmup-ordering fix or the driver update that landed in the same interval.
  - A **falsification run (2026-07-15, physical console, CfT 150.0.7871.115, driver
    32.0.16.1074, Windows 26200.8875)** temporarily restored the old contaminated
    ordering (chrome://gpu probed after the full warmup): all six runs paced at native
    60 Hz (p50 16.665-16.670 ms, p95 16.755-16.830 ms), ruling out warmup ordering as
    a cause of the 32 Hz pacing. The probe did inject a transient hitch at measurement
    start (max single frame 166.6-216.6 ms per run), so keeping privileged diagnostics
    outside the warmup/measurement window remains correct — it just wasn't the cause
    here. Artifact: `smoke-1-dfa4afe02c16-…-2026-07-15T13-28-39` (schema v17,
    non-gating; its environment facet failed on OS-build drift 26200.8655 → 26200.8875,
    since refreshed in `harness/machines/dev-01.json`).

  The original entry's "native-fullscreen browser on the dev-01 3840×2160 display"
  framing was itself the error RE-002 later exposed: an RDP session can present as a
  fullscreen 4K surface while presenting at the remote session's 32 Hz. The lasting
  fixes are environmental, not code: remote/indirect-display sessions invalidate the
  environment identity (D-034, harness rule 9), which the harness has enforced since.
- **Impact on Parallax:** worker callback pacing no longer blocks the Showcase smoke run.
  True compositor presentation timing remains a separate incomplete Harness v1 metric;
  no budget was changed.
- **Proposed improvement:** browser diagnostics that require opening an internal page should
  disclose their foreground/scheduling impact, or CDP should expose the same display data
  without tab activation. Keep privileged diagnostics outside benchmark warmup and
  measurement windows.
