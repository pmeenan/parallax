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

**Known M1 collision (recorded 2026-07-15):** the walking skeleton's render-worker
callback-interval p95 on dev-01 measures 16.72–16.76 ms across passing Harness-v1 runs —
*above* the ≤ 16.67 ms Showcase p95 gate. That signal is a non-gating heuristic under
D-051 (it is callback spacing, not compositor presentation), but M1's mandated revisit of
presentation gating will collide with a real number already over the documented
threshold: either the measurement path must prove true present intervals differ from
callback spacing, or the tolerance needs recalibrating through a decision — wiring the
current threshold to the current signal as-is would fail.

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
| — JS heap (all threads) | ≤ 2 GiB | ≤ 4 GiB | Exact byte limits are 2 × 1024³ and 4 × 1024³ (D-047) |
| — WASM linear memory (sum of modules) | ≤ 2 GB | ≤ 8 GB | Per-module tracked; memory64 modules justified individually (P-001). An aggregate sum proves nothing about memory64 — see the dedicated single-module >4 GiB harness run under P-001 |
| GPU memory envelope (as attributable) | ≤ 4 GB | ≤ 14 GB | Resident set + transient uploads; Showcase leaves ~2 GB of dev-01's 16 GB card for OS/compositor/browser |
| SAB pools | Fixed at boot | Fixed at boot | No runtime growth; sizes recorded per build |
| Inter-district transition overlap peak | ≤ 1.25× steady-state GPU budget | ≤ 1.25× steady-state GPU budget | Both resident sets partially live during swap; overlap must still fit each tier's GPU envelope |

## Install / launch / update

| Metric | Target | Notes |
| --- | --- | --- |
| Install size (D1+D2 experiment content) | ≤ 12 GB | Includes the selected app-owned NPC model's five exact GGUF shards (D-074/D-096) |
| Install size (architecture floor) | ≥ 100 GB supported; no designed-in ceiling | The *content* of this experiment is ≤ 12 GB, but the install, manifest, integrity, update, and streaming systems must demonstrably work at 50–100 GB **as a minimum** — the goal is proving the web platform supports at-least-AAA install sizes, with no architectural limit short of disk/OPFS quota. Verified with a synthetic-asset scale test (see below), not left theoretical. Quota reality: an origin gets up to ~60% of **total** disk size, and `estimate()` can over-report writable space — preflight is best-effort; the real guarantee is `QuotaExceededError`-aware incremental writing with resume (architecture.md). (D-009, install provisions upheld by D-018) |
| Install wall time | Bandwidth-bound + ≤ 90 s local work | Local work = integrity, unpack, PSO warmup |
| Launch 2+ → interactive gameplay | ≤ 10 s | Fully local; the number the demo lives or dies on |
| Launch 1 (post-install) → gameplay | ≤ 30 s | |
| Warm JavaScript code-cache lifecycle | targeted, recorded (non-gating) | Best-effort `harness:smoke:v8-cache` diagnostic: expect 0 rejected and 0 warm re-produced artifacts; every anomaly remains a finding, but mechanism state does not substitute for launch performance (D-051/D-095) |
| Asset-only-update warm launch | ≤ 10 s; pre/post delta recorded | Performance outcome replaces the former “never invalidates V8 code caches” mechanism requirement; M2 measurements calibrate any relative-regression threshold through a new decision |
| Offline launch | ≤ 1.10× warm-launch time (and within the ≤ 10 s budget) | Network killed post-install; served entirely by SW precache + OPFS |

The M0 walking skeleton currently has 5,265,895 decoded JavaScript source code units. Its
render-worker artifact contains 5,257,345 (99.84%), while artifacts with observed launch-2 cache
production contain 7,884 (0.15%). Source share is not a launch-cost proxy: the worker's retained
non-streamed compile-event duration measured 24.4–26.8 ms across fresh/produce/warm launches,
about 0.25% of the ≤10 s budget, with no consistent warm decrease (D-042/RE-010). This raw trace
span is diagnostic rather than proof of cache state or total parse/compile cost; the missing
worker production result remains a Chrome finding but does not fail the performance gate. The broader
worker-startup-to-first-frame component measured 144.2–156.8 ms on warm launches (about 1.6% of
the budget) across three diagnostics. Launch 2 included one 789.5 ms outlier, and the third
diagnostic measured launch 3 slower than launch 2 in two of three lineages. This whole-worker-
path timer therefore neither establishes a consistent launch-2 → launch-3 saving nor assigns
the outlier specifically to V8 cache serialization or consumption (D-043/D-044).

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

D-090 defines standard D1 traversal as 12 m/s and the greybox v1 LOD contract as
320/960/4,096 m maximum distances with 64 m hysteresis. Recalibrating those inputs is a
decision/schema change, not a way to make the outcome thresholds below pass. A schema
migration also advances the smoke result and mandatory-metric-set contracts; the prior
promoted baseline is intentionally incomparable and a reviewed replacement requires
the explicit `--rebaseline` acknowledgement from D-087.

The D-090 smoke correctness gate requires the canvas-visible-pixel ratio to be
`0.35 ≤ ratio < 0.999`, measured against the clear RGB derived from renderer telemetry.
This is a blank/wrong-clear-output detector, not a visual-quality or performance claim.
The synthetic all-clear fixture proves the zero-geometry failure path; the 0.35 floor
remains provisional until the first registered physical run records the real viewport
ratio and review confirms adequate headroom. The exclusive 0.999 ceiling requires more
than 0.1% of the canvas to remain detectably clear rather than relying on equality with
1.0 to catch a mismatched clear color.

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
| Dialog first-token latency p95 | ≤ 1.5 s | Applies to the selected app-owned backend and any future candidate evaluated under D-096's reopen conditions |
| Frame-time impact while generating | Within gameplay budgets above | Worker/GPU contention is a research target — measure, log, then budget |
| App-owned model-load forward-progress gap (M0 spike) | < 120 s | D-073 applies the same evidence-preserving boundary while `loading-model`; a cold stall skips the redundant warm retry. The overall 45-minute ceiling remains for advancing loads and later phases. |

For D-074 qualification, the app-owned backend must retain at least twenty
post-warmup samples of the exact shared gate-watch fixture; first-token p95 remains
gating at 1.5 seconds. Exact output-token counts and decode duration make tokens/s
mandatory evidence but do not yet impose a throughput threshold. Fresh qualifying
WebGPU evidence must hash-verify and write all five pinned `UD-Q4_K_XL` GGUF splits
(2,620,371,552 bytes) to OPFS; the paired browser-restart run must read all five from
OPFS with zero remote misses. Strict JSON-schema constrained decoding is part of the
backend for structured fixtures. D-074's CPU/WASM mode reuses that exact GGUF with
`n_gpu_layers: 0`; it is a measured headroom placement, not an automatic fallback.
D-073's removed ONNX q4 path remains historical missing-CPU-kernel evidence and does
not redefine the qualifying identity.
Structured-output validity, semantic grounding failures, prompt-token counts at every
context tier, raw quality outputs, model-to-session load time, and token-gap scheduling
diagnostics are mandatory evidence. Page-attributable VRAM remains `unsupported` under
D-050 unless Chrome exposes it; a declared model requirement is not measured VRAM.
Render-worker callback pacing during generation is a non-gating D-051 contention
diagnostic until M1 provides the presentation gate. Missing worker Long Tasks
observability is explicit rather than replaced by main-thread observations.

The removed D-075/D-082 experiment required three cold generations, six live
exact-prefix samples, three snapshot saves, a deterministic two-character hot set,
two restart restores, one fresh miss, exact model-cache continuity, and the unchanged
30-generation quality fixture for quantized KV. D-083 defined material restore as OPFS
read plus native restore plus TTFT at no more than 80% of paired same-character cold
TTFT. The 2026-07-19 dev-01 matrix closed that gate as a D-084 no-go. Every stable placement
and cache type restored only 409 of the 914-916-token exact prefix, even though paired
end-to-first-token ratios were 0.516-0.680 and therefore faster than the 0.8 timing
threshold. WebGPU f16 without flash attention aborted on generation after native
restore. F16 snapshots measured 12.04-12.14 MB; q8_0 measured 6.41-6.46 MB and passed
the unchanged 30-generation quality fixture on both placements. Timing, size, and
quality do not override the exact-prefix correctness failure; no baseline is promoted.
The experiment-specific harness and runtime patch were removed after measurement.

## Measurement methodology

Definitions the harness implements; budgets above are meaningless without them.

- **Frame time** = presentation interval (present-to-present), the thing the player
  sees. CPU submission time and GPU execution time are captured as *diagnostic*
  breakdowns, not budget gates. Chrome 150 does not expose presentation success on the
  available Viz callback event (RE-006), so Harness-v1/M0 reports the authoritative metric as
  an informational failure and retains worker-callback/Viz-callback pacing only as heuristics
  (D-051). M1 must revisit the gate before making player-visible frame-budget claims.
- **Warm-up exclusion:** the first 10 seconds of any run (or until first steady-state
  marker emitted by the app) are excluded from frame statistics; launch metrics have
  their own budgets and are never mixed into gameplay frame stats.
- **SAB transport evidence (D-057):** each `smoke@1` core launch runs 100,000
  deterministic main→render-worker→main records through paired fixed SPSC rings during
  warm-up. The mandatory metric is measured only when every echo returns in order with
  zero payload/sequence errors and elapsed/cooperative-round-trip-rate evidence is
  present. That rate includes the bounded window pump and its scheduling cadence; it is
  not raw SAB bandwidth. Results also retain the fixed pool size, waits/stalls,
  maximum cooperative window-pump duration,
  and concurrent render-worker callback maxima. Those callback timings are diagnostic,
  not compositor-presentation evidence (D-051). In the current launch ordering they also
  overlap RE-001's privileged `chrome://gpu` diagnostic before the harness warm-up, so
  they cannot attribute callback gaps to SAB; a controlled active-transport comparison
  is still required for that claim. The ordinary in-window main-thread and frame gates
  remain authoritative after warm-up.
- **Rust/WASM threads evidence (D-085):** after SAB transport and before OPFS, every
  `smoke@1` core launch compiles one content-addressed Rust module and instantiates it in
  two dedicated workers over one fixed 33-page shared linear memory. Both instances
  must claim nonzero work from the 262,144-task atomic queue, their counts and atomic
  completion must equal the task total, the worker mask must be `0x3`, and the
  order-independent SIMD checksum must match a separately executed reference pass.
  Module bytes, fixed memory bytes, total elapsed time, and load/compile, worker-init,
  and parallel-execution phases are mandatory evidence. The pinned runtime must also
  report shared initialization state `2`, initialized-instance count `2`, and a clear
  allocator lock (`0`) after both workers are ready; a failure snapshots those same
  words before cohort termination (D-092/D-093). This synthetic correctness proof sets
  no throughput budget or production pool size; M1 measures representative decode work.
- **Memory64 evidence (P-001):** the dedicated `memory64-spike@1` scenario runs outside
  `smoke@1` in three fresh/warm profile pairs. A dedicated worker loads content-addressed
  memory32 and memory64 modules, retains one cold, two warm-up, and thirty measured samples
  per variant, and requires identical checksums. Each measured sample times 2,048 synchronous
  module constructions and 32,768 same-memory instances in a short-lived nested worker,
  terminates that worker, then prepares the same 64 MiB working set with eight deterministic
  fill passes and runs sixteen pointer-heavy scans in the outer worker. This keeps load-test
  allocation/GC out of the hot-path phase. Only after that cohort, the memory64 instance grows to
  65,537 pages and round-trips a fixed sentinel at `0x1_0000_0000`. The worker also reads
  that exact offset independently through a JavaScript `DataView`; both observed values are
  mandatory evidence. Logical linear-memory size and sparse grow/touch time are reported
  separately: the 4+ GiB `byteLength` is a reserved address range, not an assertion that
  Chrome committed or made resident that many bytes. This feasibility spike has no
  performance budget or adoption threshold. Each run first computes memory64/memory32 for
  every adjacent measured sample, then p95; those paired p95 ratios and each absolute arm's
  per-run p95 retain separate fresh/warm 10% repeat-variance states. Reports aggregate the
  median and worst repeat p95 rather than pooling samples across launches. The paired ratio
  is the blocking P-001 cost comparison; noisy absolute timing remains explicitly invalid
  diagnostic evidence and cannot support an absolute-cost claim. P-001 remains open until M1
  supplies a representative unavoidable single-module need.

  D-086's accepted physical artifact retained 180 measured samples per variant. Memory32
  versus memory64 median/worst per-run kernel p95 was 116.190/116.815 ms versus
  115.350/117.660 ms; median per-run paired-p95 compile/instantiate/prepare/kernel ratios
  were 1.125x/1.294x/1.002x/1.030x, and module size was 211 versus 294 bytes. Every blocking
  paired cohort passed the 10% gate. The separate absolute diagnostic was invalid only for
  fresh memory32 prepare at 10.98%, so the artifact supports no absolute prepare-cost claim.
  These are feasibility
  observations, not budgets or a general claim about production pointer-width cost;
  memory64's module size and load phases also include its additional high-address proof
  export.
- **JavaScript used-heap high-water estimate (D-047):** after the primary frame/trace
  measurement completes, run a dedicated steady-state window over the same 120-frame workload.
  Issue near-concurrent `Runtime.getHeapUsage.usedSize` requests for every required
  window/worker isolate on fixed 100 ms start deadlines; sum realms within each sample,
  then gate the largest observed aggregate. `usedSize` is current V8 heap occupancy, including
  objects that are unreachable but have not yet been collected, so it is GC-phase-sensitive and
  must not be described as retained live data. The requests are not atomic, so the result can
  under- or over-estimate a coexisting total. Per-realm CDP response-completion timing,
  total/embedder/backing-store values, collection duration, start delay, and missed deadlines
  remain evidence even when a cadence gate invalidates the metric; experimental diagnostic fields
  are `null` when absent. Response-completion skew is transport arrival skew observed by the Node
  collector; it does not bound when V8 read each realm. Response-completion skew, start delay, or
  collection duration reaching 100 ms, or any deadline due before the sampling boundary without
  a periodic sample or the substituting boundary sample, makes the mandatory metric invalid.
  Chrome exposes no continuous cross-isolate live-retention peak (RE-012).
- **GPU memory (D-050):** the tier envelope means page-attributed resident GPU allocation plus
  transient peaks, not GPU-process private memory or the sum of logical WebGPU resource sizes.
  Chrome 150 exposes neither that total nor per-page/per-device attribution (RE-014). `smoke@1`
  requests a GPU-process memory-infra dump and retains its allocator inventory as diagnostic
  evidence, but reports the envelope metric `unsupported` and runs no GPU budget check. A future
  counter becomes gate-eligible only after allocation controls establish scope, residency,
  attribution, aliasing/shared-image accounting, and D3D12/Metal parity.
- **Repeats and aggregation:** a budget verdict comes from ≥ 3 runs of the scripted
  scenario. Percentiles are computed per run over all in-window frames; the *worst* run
  must pass (no averaging away a bad run).
- **Qualification cadence (D-097):** run one physical-console `smoke@1` after the final
  reviewable state of each runtime-affecting candidate, and rerun after a later change
  to the built runtime, browser-facing behavior, measurement path, runtime pins,
  reference-machine descriptor, budgets, or mandatory evidence contract. Documentation-
  only, test-only, and machine-local tool-location changes that leave those inputs
  unchanged do not require a physical run. An intermittent failure remains a failed
  report; retain it and use at most one immediate same-artifact retry for routine
  classification. Additional repetitions are an explicit diagnostic exercise.
- **JavaScript code-cache lifecycle (D-040–D-042, D-051, D-095):** the targeted
  `pnpm harness:smoke:v8-cache` command gives each repeat one persistent profile for
  fresh/timestamp, produce, and warm/consume launches. Fresh must expose no production, every
  cacheable required immutable script should expose a positive URL-attributed `producedCacheSize`
  on launch 2, and warm should expose consumption without re-production. Production, absence of
  re-production, and consumption remain separate evidence; none can substitute for another.
  Missing, untrustworthy, or negative cache evidence is informational. Routine
  `pnpm harness:smoke` does not launch this nine-run diagnostic; use it for browser,
  Node, bundler, serving/cache, dependency-checkpoint, M2 lifecycle, and explicit V8
  investigations. The expected
  zero rejection/re-production checks remain in each result as diagnostics. M2 gates the
  user-visible outcome instead: warm and asset-only-update launches must remain within 10 s, and
  the paired pre/post-update delta is recorded. M2 measurements calibrate any future relative-
  regression threshold through the normal decision process.
- **Variance gate:** if p95 varies more than 10% across the repeats, the result is
  `invalid` (fix the noise before trusting the number) — a noisy metric is a broken
  metric, not a passing one.
- **Metric states:** every metric in a result is `measured`, `unsupported` (platform
  provides no way to observe it — itself a rough-edges candidate), `invalid` (observed
  but untrustworthy, with reason), or `not-applicable`. Budget gating fails on a busted
  `measured` value **and** on any metric that is mandatory for the current milestone
  but not `measured` — silence is not a pass. The mandatory set per milestone is
  defined in `harness/` alongside the runs.
- **Result facets (D-045):** reports separate registered-environment validity, mandatory
  evidence completeness, and budget evaluation. A budget facet is `passed` only when
  mandatory evidence is complete, at least one check ran, and every executed check
  passes; it is `failed` when any observed value busts its limit, and otherwise
  `not-evaluated` when evidence is incomplete or no checks ran. The aggregate result
  passes only when all three facets pass. Thus a valid environment remains visible
  through a platform evidence gap, but neither missing evidence nor a passing subset
  of checks can appear green. D-051 deliberately classifies the M0 compositor/V8 observability
  gaps as non-mandatory informational failures; this rule continues to apply to every metric in
  the current mandatory metric-set (v15, which retains measured D-090 greybox-world content,
  observed lighting ranges, and hashed canvas-visible-pixel coverage in every core run,
  adds D-091 world-streaming telemetry with at least ten OPFS-to-GPU samples, exactly nine
  residents, bounded encoded-package residency and decode-pool/queue shape, positive GPU
  attribution, proactive eviction, zero encoded-budget rejections, and a representative cell-load p95 no
  greater than 250 ms (D-090/D-091). D-096 removed the superseded standalone OPFS
  throughput/repeatability checks; per-cell OPFS read timing remains mandatory inside
  the representative streaming evidence. D-092 additionally requires the mandatory Rust/WASM
  evidence to distinguish module construction from Rust/wasm-bindgen startup and retain
  the exact pinned fixture's shared initialization state on failure. The corresponding
  `smoke@1` report schema is v31. Build-manifest v10 requires the five current workers,
  and the report records whether the targeted V8 diagnostic was requested (D-095/D-096).
  Initial streaming residency completes before traversal, and the
  streaming p95/proactive-eviction verdict uses
  only the telemetry delta inside the ordinary presentation measurement window. That
  window requires at least ten contiguous sequenced replacements; the deterministic
  12 m/s diagonal corner-crossing stress path completes at least five target transitions
  per second, with three replacements per transition, at both 60 Hz and 120 Hz.
  Measurement snapshots may bisect the worker's evict-before-load phase, so eviction
  and completion deltas may differ by at most the nine-cell residency bound; exact
  equality is not required.
  V8 lifecycle checks are diagnostics, not budget checks.
- **Trace completion validity versus observation (D-092/D-094):** a complete, readable,
  lossless trace is valid when `Tracing.end` and `Tracing.tracingComplete` finish within
  10 seconds. The collector remains attached for a further 10 seconds solely to
  distinguish late completion from no completion and to retain any resulting trace
  chunks/data-loss state; that diagnostic window is not budget headroom and cannot
  convert an invalid trace into measured evidence.
- **Environment identity:** every result records machine ID, OS build, GPU driver
  version, browser name/engine/version/channel, GPU backend, power mode, display mode/refresh,
  run-script version, profile lineage (fresh vs. warm and its history), and the
  artifact digest of the exact build measured (see harness/AGENTS.md — includes
  dirty-tree identity, since agent work is measured pre-commit). Reference Chrome launches retain the process sandbox; an
  effective `--no-sandbox` switch invalidates production qualification and performance
  evidence. `smoke@1` schema v22 records the effective command line and verified
  sandbox state under D-062/D-066.
- **Comparison eligibility (D-025):** benchmark results are directly comparable only
  when artifact digest, scenario version, quality/resolution, warm-up/repeat policy, and
  relevant environment fields match. Chrome reference-machine runs alone carry budget
  verdicts; other-browser runs are advisory, preserve `unsupported` metrics, and never
  substitute estimates for unavailable measurements. The benchmark is executed and
  measured in-game; optional launcher/collector automation is outside the measurement
  window and does not supply scenario pacing, metric aggregation, or result timings.
  In particular, Prompt callback-pacing diagnostics are not directly comparable with
  `smoke@1` pacing unless their recorded launch-switch environments also match.
- **Baseline promotion (D-087):** `smoke@1` keeps one promoted machine-local result-store
  record per scenario/registered-machine/tier. Promotion is a separate explicit human
  or lead-agent command, accepts only an aggregate pass with all three facets passing,
  and records actor, reason, report digest, artifact/source/browser identity, result and
  metric-set versions, exact Node collector identity, and comparison environment. A
  Chrome advance is labeled `candidate` only when the artifact digest, Node executable
  and version, registered host/GPU/display identity, and mandatory metric set match; its
  fresh/warm mean budget observations and build byte totals are compared with the prior
  snapshot. It never replaces that snapshot automatically. Promotion rechecks the
  report's observed anchor digest under the store lock, so a stale report cannot replace
  a newer promotion. Environment or metric-set drift is `ineligible`, not a comparison;
  intentionally starting a new incomparable anchor additionally requires `--rebaseline`.
  Chrome-attributable regressions become rough-edges findings; unchanged budget failures
  remain ordinary blocking failures. The command is
  `pnpm harness:baseline:promote <report.json> --actor <name> --reason <reason> [--rebaseline]`.
