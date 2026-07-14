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

- **WebGPU-in-worker maturity:** does the full Babylon + OffscreenCanvas + device-in-worker
  stack hold up? Where does it leak back to the main thread?
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
  window-owned broker (worker unavailability is itself the first finding here, D-017);
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

## RE-010: Render-worker module exposes no URL-attributed code-cache production event

- **Date / Chrome version:** 2026-07-14; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostic (non-gating).
- **Layer:** V8 / Blink / worker / CDP observability.
- **Status:** open; blocks the mandatory launch-2 V8 code-cache production metric.
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
  requires a finite positive `producedCacheSize`, asserts no fresh production, and fails any
  warm re-production. It retains positive app/engine outcomes even though the missing worker
  outcome makes launch-2 production `invalid`.
- **Impact on Parallax:** the harness proves that main-realm cache production works but cannot
  establish the write prerequisite for the render worker, so it fails the mandatory production
  metric closed and independently prevents a worker cache-hit claim even if RE-009's launch-3
  consumption fields become observable. The measured event is roughly 25 ms, only about 0.25%
  of the current ≤10 s warm-launch budget, and the broader warm worker-startup component has
  measured 144–157 ms (about 1.6%), so 99.84% source share does not make this a dominant measured
  launch-time cost. It is still not evidence that all worker code is reparsed/recompiled on every
  launch: the missing production event may be missing telemetry, and neither timing is an
  authoritative cache outcome.
- **Proposed improvement:** expose a URL-attributed production result for worker modules through
  the existing V8 trace events or a stable CDP/performance API, including a reason when Blink
  deliberately declines to produce cache so tooling can distinguish policy from telemetry loss.

## RE-009: Streamed ES-module traces omit V8 code-cache consumption results

- **Date / Chrome version:** 2026-07-13; Chrome for Testing Stable 150.0.7871.115;
  Windows 11 build 26200.8655; NVIDIA RTX 4080 Super, driver 32.0.16.1074; D3D12;
  dev-01 remote diagnostic (non-gating).
- **Layer:** V8 / Blink / CDP observability.
- **Status:** open; blocks the mandatory warm V8 code-cache metric.
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
  rejection is measured and fails the zero-rejection budget even if its size is degenerate. A
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
  Harness v1 therefore keeps the mandatory V8 metric invalid rather than substituting HTTP-cache
  behavior, metadata delivery, or compile timing. The same diagnostic will become measured if
  Chrome begins emitting the existing consumption fields for these events.
- **Proposed improvement:** populate `V8ConsumeCacheResult` for streamed module compilation and
  serialize it on the existing URL-attributed trace event, or expose equivalent per-resource
  code-cache consume/reject evidence through a stable CDP or performance API.

## RE-001: Render-worker animation callbacks hold near 32 Hz in automated 4K smoke run

- **Date / Chrome version:** 2026-07-12; Chrome for Testing Stable 150.0.7871.115
  (revision 1639810); Windows 11 10.0.26200; NVIDIA RTX 4080 Super, driver
  32.0.15.9649; D3D12; dev-01.
- **Layer:** scheduler / Babylon / WebGPU-Dawn (attribution open).
- **Status:** resolved for the harness on 2026-07-13; Chrome-internals display probing
  must finish before the full warmup.
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
- **Resolution evidence:** after that ordering fix, a physical-console 4K/60 run on the
  same pinned browser produced worker-callback p95 values of 16.775-16.830 ms across all
  three fresh/warm pairs, with zero main-thread long tasks and CPU render/submit p95 of
  0.47-0.57 ms. The prior ~32 Hz result was harness-induced resume/warmup contamination,
  not evidence of a 32 Hz compositor path.
- **Impact on Parallax:** worker callback pacing no longer blocks the Showcase smoke run.
  True compositor presentation timing remains a separate incomplete Harness v1 metric;
  no budget was changed.
- **Proposed improvement:** browser diagnostics that require opening an internal page should
  disclose their foreground/scheduling impact, or CDP should expose the same display data
  without tab activation. Keep privileged diagnostics outside benchmark warmup and
  measurement windows.

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
  could falsely contextualize the near-32 Hz callback pacing in RE-001.
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

## RE-006: Viz trace omits whether a presentation-feedback callback represents failure

- **Date / Chrome version:** source checked 2026-07-13 at Chromium main; locally observed
  event shape on branded Chrome Stable 150.0.7871.102, Windows 11, NVIDIA RTX 4080 Super,
  D3D12.
- **Layer:** WebGPU/Viz compositor observability.
- **Status:** open; blocks the mandatory compositor-presentation metric.
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
  of player-visible present-to-present time. Harness v1 must keep the mandatory metric
  `invalid`; worker rAF and feedback-callback cadence remain diagnostics only.
- **Proposed improvement:** include presentation flags (at minimum `kFailure`, ideally
  `kVSync`/`kHWClock`/`kHWCompletion`) and a page/frame-sink identifier in a stable CDP or
  Perfetto event, or expose successful presentation timing through a web performance API.

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
  completion or prove a GPU-process mechanism.
- **Repro:** to reproduce the coupling, run a combined trace with
  `disabled-by-default-gpu.dawn`, `disabled-by-default-display.framedisplayed`, `v8`, and
  `blink.user_timing`; keep the measured page alive through `Tracing.end` with the five-second
  completion bound. Maintained `smoke@1` instead traces the first three categories without `v8`
  for its core run, then runs the isolated `v8-code-cache@5` lineages. The v11 result records
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
  combination is correlated with missing completion under this remote configuration but no
  enabled GPU category is required. D-039
  removes V8 from the maintained core trace, so a V8 timeout no longer invalidates presentation
  or Dawn. Core completion failure remains fail-closed for those core probes, and an isolated V8
  completion failure remains fail-closed for mandatory V8 evidence.
- **Proposed improvement:** make browser-level `Tracing.end` completion independent of traced
  renderer teardown and trace-category combination, or expose which traced process prevents
  `Tracing.tracingComplete` after `Tracing.end` has acknowledged so harnesses can attribute and
  bound the wait safely.
