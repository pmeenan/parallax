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
