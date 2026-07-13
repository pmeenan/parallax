# Performance budgets

Budgets are enforced by the harness on every measured run; a change that busts a budget
is not done. **No number here is a permanently hard limit** — every value is expected to
be recalibrated (in either direction) as we learn; all values below are **initial
targets** (status `provisional`) until M0/M1 measurements calibrate them. The rule is
about process, not permanence: recalibration happens through a decision-log entry, never
by quietly editing a threshold to make a failing change pass.

**Hardware baseline: capable consumer hardware, not low-end** (D-018). This experiment
is not concerned with low-end devices — hardware is an evolving target, and the question
is what the *platform* can do given sufficient hardware. Reference machines are defined
in `harness/machines/`: the **standard-target profile** (M1 Pro MacBook Pro, 16 GB
unified, 120 Hz — the Standard gate, deliberately a widely-owned 2021-class machine;
registers as standard-01 once the physical unit is pinned) and **dev-01** (i9-14900KF /
128 GB / RTX 4080 Super, 4K @ 60 Hz — the Showcase gate and its calibration reference,
D-018). Chrome stable on both, pinned via Chrome for Testing archives (D-019); the two
span Dawn's Metal and D3D12 backends, so backend divergence is surfaced by ordinary
tier runs. Add machines, don't swap them.

## Quality tiers and resolution

Frame budgets are per-tier, at that tier's resolution on its reference machine — a tier
that misses budget is a violation; "it's fine at 1080p" is not a defense of the 4K tier.

| Tier | Gate machine | Target resolution / refresh | Intent |
| --- | --- | --- | --- |
| Showcase | dev-01 (i9-14900KF / 128 GB / RTX 4080 Super, D3D12) | 4K @ 60 Hz (its display) | Platform-ceiling target, calibrated to dev-01 itself (D-018); transfer-to-modest-hardware is Standard's job |
| Standard | standard-target profile (M1 Pro MacBook Pro 16 GB, 120 Hz, Metal — pending physical registration) | 1440p @ 120 Hz | The default experience; primary regression gate; the "hardware people actually own" story |

## Frame time (during gameplay, measured over scripted runs, per tier)

Presentation intervals quantize to the gate display's refresh period, so gates are
expressed per tier with rounding tolerance included (a 60 Hz interval is ~16.667 ms; a
gate of "16.6" would fail perfect vsync — thresholds below use x.x̄4 tolerances).

| Metric | Standard (120 Hz) | Showcase (4K @ 60 Hz) | Notes |
| --- | --- | --- | --- |
| Present interval p50 | ≤ 8.34 ms | ≤ 16.67 ms | Standard paces at 120 Hz; Showcase is vsync-locked at its display's 60 Hz |
| Present interval p95 | ≤ 16.67 ms | ≤ 16.67 ms | ≥95% of frames within the vsync deadline (one 120 Hz miss allowed on Standard) |
| Present interval p99.9 | ≤ 33.34 ms | ≤ 33.34 ms | Tail stays under two 60 Hz intervals |
| Max single frame (hitch) | ≤ 50 ms | ≤ 50 ms | Streaming, GC, or pipeline compile spikes; worst frame in the run |
| CPU frame time (submit), distribution | recorded | recorded | **Non-gating diagnostic** — full distribution (p50/p95/p99.9), never summed with GPU time (the two are pipelined; their sum is not the bottleneck) |
| GPU frame time (execute), distribution | recorded | recorded | **Non-gating diagnostic** — full distribution, same caveat |
| Pipeline compiles during gameplay | 0 | 0 | All PSOs warmed at boot; any runtime compile is a bug + a finding |
| Main-thread long tasks during gameplay | 0 > 50 ms | 0 > 50 ms | Main thread is orchestration-only |

Any claim that Showcase content is "120 Hz-capable" requires a dedicated
**uncapped-presentation capability run** (vsync off or a ≥120 Hz display) gated at
present-interval p95 ≤ 8.34 ms — CPU/GPU diagnostics on a 60 Hz vsynced run cannot
establish it.

## Memory (high-water marks during the standard flythrough, per tier)

Showcase memory is calibrated to **dev-01 itself** (128 GB RAM, 16 GB VRAM — D-018):
it is the platform-ceiling tier; its envelopes are provisional ceilings, not usage
requirements. Standard is calibrated to the standard-target profile's 16 GB unified
memory. The per-tier **envelopes** (CPU-side total, GPU total) are the enforced
constraints; the category split within an envelope may be rebalanced as measurements
come in, with a decision-log note. Note: these aggregate budgets say nothing about
memory64 — the wasm64 exercise is a dedicated harness run with a single module
addressing beyond 4 GiB, gated on P-001.

| Metric | Standard | Showcase | Notes |
| --- | --- | --- | --- |
| CPU-side envelope (JS + WASM + SAB + staging) | ≤ 5 GB | ≤ 16 GB | Standard's gate profile has 16 GB *unified* memory: the CPU/GPU split is accounting there — combined CPU+GPU envelope (≤ 9 GB) plus macOS/Chrome overhead must fit in 16 GB, which is the real gate. Showcase's ≤ 16 GB is a purposeful provisional ceiling on a 128 GB host — an upper limit, not a usage target |
| — JS heap (all threads) | ≤ 2 GB | ≤ 4 GB | |
| — WASM linear memory (sum of modules) | ≤ 2 GB | ≤ 8 GB | Per-module tracked; memory64 modules justified individually (P-001). An aggregate sum proves nothing about memory64 — see the dedicated single-module >4 GiB harness run under P-001 |
| GPU memory envelope (as attributable) | ≤ 4 GB | ≤ 14 GB | Resident set + transient uploads; Showcase leaves ~2 GB of dev-01's 16 GB card for OS/compositor/browser |
| SAB pools | Fixed at boot | Fixed at boot | No runtime growth; sizes recorded per build |
| Inter-district transition overlap peak | ≤ 1.25× steady-state GPU budget | ≤ 1.25× steady-state GPU budget | Both resident sets partially live during swap; overlap must still fit each tier's GPU envelope |

## Install / launch / update

| Metric | Target | Notes |
| --- | --- | --- |
| Install size (D1+D2 experiment content) | ≤ 12 GB | Excludes the Chrome-managed Gemini Nano download (size varies by version — never hardcode it; download requires ~22 GB free on the profile volume) |
| Install size (architecture floor) | ≥ 100 GB supported; no designed-in ceiling | The *content* of this experiment is ≤ 12 GB, but the install, manifest, integrity, update, and streaming systems must demonstrably work at 50–100 GB **as a minimum** — the goal is proving the web platform supports at-least-AAA install sizes, with no architectural limit short of disk/OPFS quota. Verified with a synthetic-asset scale test (see below), not left theoretical. Quota reality: an origin gets up to ~60% of **total** disk size, and `estimate()` can over-report writable space — preflight is best-effort; the real guarantee is `QuotaExceededError`-aware incremental writing with resume (architecture.md). (D-009, install provisions upheld by D-018) |
| Install wall time | Bandwidth-bound + ≤ 90 s local work | Local work = integrity, unpack, PSO warmup |
| Launch 2+ → interactive gameplay | ≤ 10 s | Fully local; the number the demo lives or dies on |
| Launch 1 (post-install) → gameplay | ≤ 30 s | |
| Asset-only update | Never invalidates V8 code caches | Verified by harness cache probes |
| Offline launch | ≤ 1.10× warm-launch time (and within the ≤ 10 s budget) | Network killed post-install; served entirely by SW precache + OPFS |

**Scale tests (two corpora, M2):** proving "the web supports 100 GB games" requires
more than proving OPFS holds 100 GB:

1. **Lifecycle corpus** — a synthetic manifest of at least 100 GB (generated filler)
   exercising install/resume/integrity/update/eviction mechanics at scale. If a larger
   size finds a platform limit, grow the test until it does — finding the actual
   ceiling (if any) is part of the research.
2. **Representative streaming corpus** — procedurally generated content with realistic
   properties: real KTX2/meshopt encoding at production-like compression entropy,
   realistic file counts and size distribution, per-cell dependency graphs, and full
   decode → GPU-upload work during streaming runs. This is what makes the scale claim
   about *running* a 100 GB-class game, not merely storing one.

Real-content budgets above are unaffected; these tests exist so nothing in the
lifecycle or streaming architecture quietly assumes "a few GB."

## Streaming and transitions

| Metric | Target | Notes |
| --- | --- | --- |
| Cell load (OPFS → renderable) p95 | ≤ 250 ms | At standard traversal speed |
| Visible pop-in at traversal speed | None at LOD contract distances | Visual diff in harness (later) |
| D1↔D2 hard transition: max hitch | ≤ 100 ms | Single worst frame during swap |
| D1↔D2 hard transition: total swap | ≤ 4 s | Choke-point traversal time hides it |
| Eviction mode | Proactive only | Emergency eviction events = 0 per run |

## NPC AI

| Metric | Target | Notes |
| --- | --- | --- |
| Dialog first-token latency p95 | ≤ 1.5 s | On-device Prompt API |
| Frame-time impact while generating | Within gameplay budgets above | Contention is a research target — measure, log, then budget; inference broker runs on the main thread (D-017), so main-thread long-task metrics apply to it |

## Measurement methodology

Definitions the harness implements; budgets above are meaningless without them.

- **Frame time** = presentation interval (present-to-present), the thing the player
  sees. CPU submission time and GPU execution time are captured as *diagnostic*
  breakdowns, not budget gates.
- **Warm-up exclusion:** the first 10 seconds of any run (or until first steady-state
  marker emitted by the app) are excluded from frame statistics; launch metrics have
  their own budgets and are never mixed into gameplay frame stats.
- **Repeats and aggregation:** a budget verdict comes from ≥ 3 runs of the scripted
  scenario. Percentiles are computed per run over all in-window frames; the *worst* run
  must pass (no averaging away a bad run).
- **Variance gate:** if p95 varies more than 10% across the repeats, the result is
  `invalid` (fix the noise before trusting the number) — a noisy metric is a broken
  metric, not a passing one.
- **Metric states:** every metric in a result is `measured`, `unsupported` (platform
  provides no way to observe it — itself a rough-edges candidate), `invalid` (observed
  but untrustworthy, with reason), or `not-applicable`. Budget gating fails on a busted
  `measured` value **and** on any metric that is mandatory for the current milestone
  but not `measured` — silence is not a pass. The mandatory set per milestone is
  defined in `harness/` alongside the runs.
- **Environment identity:** every result records machine ID, OS build, GPU driver
  version, browser name/engine/version/channel, GPU backend, power mode, display mode/refresh,
  run-script version, profile lineage (fresh vs. warm and its history), and the
  artifact digest of the exact build measured (see harness/AGENTS.md — includes
  dirty-tree identity, since agent work is measured pre-commit).
- **Comparison eligibility (D-025):** benchmark results are directly comparable only
  when artifact digest, scenario version, quality/resolution, warm-up/repeat policy, and
  relevant environment fields match. Chrome reference-machine runs alone carry budget
  verdicts; other-browser runs are advisory, preserve `unsupported` metrics, and never
  substitute estimates for unavailable measurements. The benchmark is executed and
  measured in-game; optional launcher/collector automation is outside the measurement
  window and does not supply scenario pacing, metric aggregation, or result timings.
- **Baseline promotion:** when Chrome stable advances, the first run on the new version
  is compared against the old baseline but does not replace it until explicitly
  promoted (a human or lead-agent action recorded in the result store); regressions
  attributable to the Chrome update are rough-edges findings, not build regressions.
