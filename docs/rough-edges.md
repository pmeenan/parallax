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
- **Status:** open.
- **What we expected / What happened:** Across three fresh and three warm headed-profile
  runs at the declared 3840x2160 smoke viewport, worker `requestAnimationFrame` callback
  spacing p50 was 31.21-31.28 ms and p95 was 31.57-31.71 ms. These are callback
  timestamps, not compositor presentation timestamps, so they do not establish a 32 Hz
  presentation rate and are not compared with the Showcase frame budget. The
  worker's CPU render/submit-duration p95 was 0.69-0.95 ms, main-thread long tasks over
  50 ms were zero, and relative p95 range within fresh and warm groups was below 0.15%.
  Those diagnostics rule out noisy repeats and sustained JS submission cost, but do not
  distinguish Babylon, GPU execution/presentation, worker rAF pacing, or automation.
- **Repro:** build the current tree, set the pinned CfT path and dev-01 identity as in
  `README.md`, then run `pnpm harness:smoke`. The `smoke@1` runner performs three fresh
  profile launches and three warm relaunches after 10-second warm-ups; the generated
  JSON contains each distribution. A standalone WebGPU/worker repro and trace are still
  needed before filing a Chrome issue.
- **Impact on Parallax:** the unexplained pacing and lack of a validated present-to-present
  probe block the M0 Showcase smoke gate and Harness v1; no workaround or budget change
  applied.
- **Proposed improvement:** first add GPU execution/present and Dawn trace attribution,
  then compare worker vs window rAF and Babylon vs a minimal WebGPU loop under the same
  pinned browser. If worker presentation is the cause, expose stable pacing/diagnostic
  signals that let applications distinguish scheduler throttling from GPU backpressure.
