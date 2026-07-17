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
- **V8 wasm code cache discipline:** does our immutable-URL + `instantiateStreaming`
  + 304 setup reliably preserve the code cache across launches and asset-only updates?
- **OPFS throughput ceilings:** sync access handle read bandwidth from decode-pool
  workers; contention behavior with N readers; OPFS vs Cache Storage per asset class.
- **wasm64 in anger:** real cost of memory64 (pointer width, perf) in a hot Rust module.
- **Prompt API under load:** inference/render GPU contention; session limits vs.
  many-NPC designs; download/availability UX during install; main-thread cost of the
  window-owned broker (worker unavailability is recorded as RE-016);
  eviction and offline-reavailability behavior.
- **CPU SIMD width ceiling:** wasm tops out at 128-bit vectors (simd128 + relaxed-simd;
  the flexible-vectors proposal for wider/length-agnostic SIMD is still design-stage,
  checked 2026-07-13). The cost is machine-dependent: dev-01's x86 has AVX2-class width
  to lose, while the Standard profile's M1 Pro is itself 128-bit NEON — the gap may be
  near zero there. Measure a representative hot kernel three ways per reference machine
  — native (AVX2/NEON), wasm simd128, WGSL compute — before fixing any CPU/GPU placement
  rule (D-032 treats "wide work moves to WGSL" as a hypothesis); feeds a potential
  spec-gap write-up.
- **App-owned WebGPU LLM inference (P-007):** can a small quantized model run on the
  same GPU without busting frame budgets? Device topology is itself a spike variable —
  WebLLM-class engines create their own logical WebGPU device internally, so own-device
  vs. shared-render-device scheduling, VRAM pressure across two devices, tokens/s vs.
  Prompt API on the same hardware, and OPFS model-load time at launch all need
  measurement.
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
- **Status:** open upstream compatibility gap; narrowly worked around in Parallax.
- **What we expected / What happened:** importing the supported browser
  `pipeline`, `env`, and `TextStreamer` surface into a strict worker should typecheck.
  Instead, TypeScript follows Transformers.js's public declaration graph into broken
  tokenizer aliases and unrelated model declarations, producing errors before any
  Parallax call-site is checked. The runtime bundle succeeds, so this is a declaration
  compatibility failure rather than a browser-runtime failure.
- **Repro:** remove the `@huggingface/transformers` path mapping from
  `engine/tsconfig.json`, import the three symbols used by `engine/src/workers/ai-worker.ts`,
  and run `pnpm typecheck`. With the mapping present, the same strict worker and full
  repository typecheck use the local declaration in
  `engine/src/types/huggingface-transformers.d.ts` and can proceed.
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

- **Date / Chrome version:** 2026-07-16; branded Chrome Stable 150.0.7871.128 on
  Windows 11/dev-01/RTX 4080 Super, physical console. Passing sandboxed schema-v2
  lifecycle result
  `prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json`.
- **Layer:** Prompt API / NPC-dialog latency.
- **Status:** open; carry into P-007's fixed-fixture head-to-head rather than treating
  the production-install qualification as a latency pass.
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
- **Impact on Parallax:** installed-model restart UX cannot equate an initial
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
  Prompt API still remains optional until P-007 compares latency, frame impact, quality,
  and app-owned lifecycle control (including RE-021).
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
- **Status:** open; `prompt-api-spike@1` records normalized download evidence, measures
  component bytes after Chrome exits, and labels forced eviction `unsupported` (D-059).
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
- **Status:** open; inference remains behind the D-017 window-owned broker.
- **What we expected / What happened:** current Chrome documentation says the Prompt API
  is available to top-level windows/same-origin frames but not Web Workers. A clean
  pinned-CfT profile exposed `LanguageModel` in the window, returned `unavailable` from
  `availability()`, and did not expose `LanguageModel` in a dedicated worker.
- **Repro:** launch the pinned browser with a clean external profile, read
  `typeof LanguageModel` and `await LanguageModel.availability()` in the page, then
  create a blob-backed dedicated worker that posts `typeof LanguageModel !==
  "undefined"`. `prompt-api-spike@1` records the two contexts independently and treats
  worker-probe failure as diagnostic rather than blocking the window measurement.
- **Impact on Parallax:** NPC inference orchestration and stream callbacks remain on the
  window main thread, so generation-window long tasks are mandatory budgets while
  marker-aligned render-worker callback pacing remains a non-gating D-051 diagnostic.
  The game cannot place the built-in model behind the normal worker topology.
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
  Chrome for Testing Stable 150.0.7871.115 on dev-01.
- **Layer:** V8 / CDP memory observability.
- **Status:** open; `smoke@1` operationalizes the JS-heap budget as a fixed-deadline 100 ms
  near-concurrent estimate in a dedicated post-trace window (D-047) and records probe duration
  and per-realm CDP response-completion skew.
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
  isolate.
- **Impact on Parallax:** the sampled estimate is diffable and budgetable, but it can under- or
  over-estimate a truly simultaneous total. GC scheduling can move the observed value without a
  change in live retention. Short-lived allocation churn needs separate allocation/GC diagnostics
  before the harness can claim exact peak residency. The harness invalidates missed fixed
  deadlines and ≥100 ms collection duration, response-completion skew, or
  start delay rather than presenting poor temporal coverage as measured evidence.
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
  [why-not-unity.md](why-not-unity.md) and D-046.

## RE-010: Render-worker module exposes no URL-attributed code-cache production event

- **Date / Chrome version:** 2026-07-14; Chrome for Testing Stable 150.0.7871.115;
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
- **Repro:** run `smoke@1` with `v8-code-cache@5` in
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

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115;
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
  deterministic.
- **Repro:** to reproduce the coupling, run a combined trace with
  `disabled-by-default-gpu.dawn`, `disabled-by-default-display.framedisplayed`, `v8`, and
  `blink.user_timing`; keep the measured page alive through `Tracing.end` with the five-second
  completion bound. Maintained `smoke@1` instead traces the first three categories without `v8`
  for its core run, then runs the isolated `v8-code-cache@6` lineages. The v12 result records
  categories, event/chunk/serialized-byte volume, end-command and completion latency, and data
  loss plus recording lifetime, launch ordinal, and elapsed sequence time for both sets. To
  reproduce the lifetime control, launch a fresh pinned browser on `about:blank`, start a
  browser-level `ReportEvents` trace with either the core or `v8` categories, idle for 300 or
  14,100 ms, then end with the same five-second completion bound; repeat each arm at least six
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
  informational failure per D-051; M1 must revisit it before player-visible frame-budget claims.
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
  rounding at the physical-pixel boundary.
- **Repro:** on dev-01's physical console, launch pinned CfT with `--start-fullscreen` and
  no Playwright viewport emulation; observe a fullscreen canvas using
  `ResizeObserver({box: "device-pixel-content-box"})`. `smoke@1` records the value for every
  measurement browser and fails outside the descriptor's ±2-pixel tolerance.
- **Impact on Parallax:** an exact-equality 4K render-surface gate rejects the real native
  4K environment, while accepting the observed one-pixel conversion preserves materially
  identical workload and keeps the discrepancy explicit in every result.
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
