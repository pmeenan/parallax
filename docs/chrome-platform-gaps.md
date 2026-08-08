# Chrome platform gaps exposed by Parallax

Chrome-facing synthesis of the platform changes that would most improve AAA-scale web games and
their measurement. Updated 2026-08-08 through the M3 UI-substrate decision from registered physical-console Chrome
for Testing experiments and explicitly labeled CfT/branded-Chrome diagnostics on Parallax's
Windows/D3D12 dev-01 reference machine; each evidence entry states its provenance. D-150 makes
dev-01 the sole required gate, so this synthesis makes no Standard, Metal, or other-hardware
claim.

This is the actionable report; [rough-edges.md](rough-edges.md) remains the evidence source of
truth with exact versions, measurements, reproductions, mitigations, and source links. A request
stays here while the underlying finding is open, even when Parallax has a usable heuristic.

M2 closed under D-153 after the exact-current CfT 151.0.7922.71 production `smoke@1`
passed schema v62 / mandatory metric set v28 with all six launches, all three facets,
30/30 checks, and rendered output on dev-01. D-151 separately accepted the measured
install/launch/update lifecycle. Those outcomes establish the project budgets at that exact
scope; they do not resolve the mechanism-observability requests below.

## Priority model

- **P0 — blocks authoritative measurement or attribution:** Parallax cannot establish a primary
  platform result needed for the research program. This is an eventual research priority, not a
  synonym for the current M0 blocking metric set.
- **P1 — forces privileged or fragile automation:** evidence exists, but collecting it requires
  browser-internals pages, deprecated transport, or an unreliable trace lifecycle.
- **P2 — longer-horizon capability ceiling or attribution improvement:** valuable for scale and
  future research after the core measurement surfaces exist.

## P0 requests

### Expose successful, page-correlated presentation timestamps

**Missing today:** Viz emits `Display::FrameDisplayed` at the sanitized presentation-feedback
timestamp but does not serialize the feedback flags. A failure callback can therefore look like
a regular successful scan-out. The event also lacks a stable page/frame-sink attribution key.

**Why it helps:** frame time is what the player sees, not worker callback spacing or CPU submit
time. Successful present-to-present intervals would let games gate p50/p95/p99.9/hitch budgets,
separate rendering from display failures, and compare manual in-game benchmarks with automated
runs without driver timing.

**Useful minimum change:** add `failed`, `vsync`, `hwClock`, and `hwCompletion` (or the raw
presentation flags) plus a page/frame-sink identifier to a stable Perfetto/CDP event. A web
Performance API that exposes the same successful-presentation timestamps would better support
driver-free benchmark mode.

**Acceptance test:** deliberately force a failed presentation and prove it is distinguishable
from a successful frame; then correlate a page's 120-frame marker window to exactly its own
successful display events.

Evidence: [RE-006](rough-edges.md#re-006-viz-trace-omits-whether-a-presentation-feedback-callback-represents-failure),
[D-035](decisions.md#d-035-viz-presentation-feedback-trace-is-diagnostic-not-a-presentation-gate--2026-07-13-accepted-partially-superseded-by-d-051--the-authoritative-presentation-metric-is-informational-and-no-longer-fails-harness-v1),
and Chromium's current
[`Display::DidReceivePresentationFeedback`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display/display.cc).

### Provide page-visible frame locking and correlation for DOM overlays and worker canvases

**Observed gap:** D-143's bounded apparatus identified and used no page-visible way to associate a
main-thread DOM commit with a particular worker-owned OffscreenCanvas/WebGPU frame, request that
they enter one compositor transaction, or observe when the two layers were composed and
successfully presented together. This is not an exhaustive audit of Chrome-internal or proposed
facilities. In the APIs exercised by the probe, application frame IDs and absolute monotonic
timestamps stopped at the renderer/compositor boundary.

**Why it helps:** native-class games need crisp world-space nameplates, interaction prompts, and
other accessible DOM overlays while rendering WebGPU from a worker. Without synchronization and
attribution, application latency, cross-thread scheduling, compositor skew, and capture timing
cannot be separated. Parallax's registered 12 m/s probe measured DOM staleness at p95 2 frames
and 5.028–10.616 px of captured detachment, forcing world anchors in-canvas even though DOM passed
the separate event-rate HUD criterion.

**Useful minimum change:** provide a page-scoped composition token accepted by a worker canvas
submission and main-thread DOM commit, then expose the composed and successfully presented token
with timestamps. A DevTools/Perfetto-only first step that correlates DOM commit, canvas frame,
surface aggregation, and presentation under one page identity would at least make the delay
attributable.

**Acceptance test:** animate one worker-canvas marker and one DOM marker from the same world point
while the main thread is variably loaded. Every accepted token must identify whether both updates
shared a composition and presentation; deliberately delaying either side must be attributed to
that stage rather than appearing as an unexplained pixel offset.

Evidence: [RE-047](rough-edges.md#re-047-d-143-found-no-page-visible-frame-lock-or-presentation-attribution-across-dom-and-worker-webgpu)
and [D-160](decisions.md#d-160-resolve-p-008-with-a-per-surface-hybrid-ui-substrate-2026-08-08-accepted).

### Expose the JavaScript code-cache lifecycle per resource and execution context

**Missing today:** streamed ES-module compilation omits usable `consumedCacheSize` and
`cacheRejected` results. Parallax's large render-worker module also emits an attributed compile
event but no attributed cache-production event. Process-wide metadata histograms can show that
some cache data was read, but cannot prove which URL/context produced or accepted it.

**Why it helps:** install/launch/run applications need to verify that immutable app, engine, and
worker artifacts survive warm launches and asset-only updates without silently reparsing. Exact
outcomes also distinguish a browser regression from application cache invalidation. M0 correctly
makes this mechanism evidence informational; M2 gated launch and asset-only-update performance
at the user-visible boundaries while retaining mechanism evidence as non-gating.
The request remains P0 for the platform-research goal: without resource-level outcomes, a
warm-launch regression cannot be attributed to V8 cache behavior versus HTTP delivery, worker
startup, or another layer.

**Useful minimum change:** for every external classic or module script in windows and workers,
emit URL- and execution-context-attributed outcomes for timestamp establishment, cache
production, consume accepted/rejected, rejection reason, consumed/produced bytes, and warm
re-production. Extending the existing V8 trace events is sufficient if the schema becomes stable;
a CDP resource-cache domain would be easier for automation.

**Acceptance test:** three loads of the same immutable window and worker modules must show
timestamp → positive production → positive consumption with no re-production. Mutating one byte
must report a rejection for only that resource.

Evidence: [RE-009](rough-edges.md#re-009-streamed-es-module-traces-omit-v8-code-cache-consumption-results),
[RE-010](rough-edges.md#re-010-module-workers-expose-incomplete-url-attributed-v8-code-cache-events),
and Blink's current
[`v8_code_cache.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/v8_code_cache.cc)
and
[`v8_script_runner.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc).

### Expose page-attributed resident WebGPU memory and transient peaks

**Missing today:** Chrome exposes neither a per-page/per-`GPUDevice` resident WebGPU total nor
the transient allocator peak needed for a VRAM envelope. GPU-process private memory is shared
with browser/compositor work. Current memory-infra dumps do not expose allocators for the web
device's buffers/textures, and logical resource byte sums would not establish residency.

**Why it helps:** a streaming game must know whether steady state and district-transition overlap
fit the GPU memory envelope before the OS/driver starts paging or evicting. Page/device
attribution is also necessary when multiple tabs or devices share the GPU process.

**Useful minimum change:** expose current and peak logical allocation, resident allocation, and
transient allocator usage per `GPUDevice`, categorized at least by buffers, textures, pipelines,
shared images, and staging/transient work. Document suballocation, aliasing, shared-resource
charging, and cross-backend semantics.

**Acceptance test:** controlled buffer/texture allocations and destruction must move the correct
page/device counters by a predictable amount on D3D12 and Metal; a second page must not be charged
to the first; a transient upload must raise the peak without becoming permanent resident usage.

Evidence: [RE-014](rough-edges.md#re-014-chrome-exposes-no-page-attributed-webgpu-resident-memory-total),
[D-050](decisions.md#d-050-retain-gpu-process-memory-dumps-without-treating-them-as-page-vram--2026-07-14-accepted),
and Chromium's
[graphics-memory metrics guidance](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/memory/graphics_metrics.md).

## P1 requests

### Expose origin-scoped browser-cache inventory and eviction completion

Parallax's accepted M2 uninstall qualifier proved that both app teardown paths removed unique
nonempty OPFS, service-worker, Cache Storage, and IndexedDB sentinels and released quota. Chrome
exposed no origin-scoped proof for HTTP cache, V8 code cache, or Dawn pipeline/shader cache
eviction: available CDP flags, trace events, and GPU histograms are cumulative, process-scoped,
or omit an inventory/deletion result. Add a privileged origin-scoped diagnostic returning the
affected entry/byte counts and exact completion identity for those browser-managed caches. The
production page need not receive cache contents. Evidence:
[RE-046](rough-edges.md#re-046-chrome-exposes-no-origin-scoped-proof-of-http-v8-or-dawn-cache-eviction).

### Expose Prompt API model bytes and a deterministic lifecycle test hook

Prompt API download progress is normalized to 0..1 and intentionally omits exact bytes; Chrome
documents the exact installed size only through `chrome://on-device-internals`. The model may be
removed for low space, enterprise policy, or 30 days without meeting eligibility, and Chrome says
deletion can happen even mid-session; related LoRA weights are purged after a 30-day grace period.
Neither the web API nor automation exposes a supported,
non-destructive way to force and attribute those transitions. Add downloaded/total byte counters,
an observable lifecycle reason, and a DevTools/CDP deletion test hook. This would let install UX
report truthful progress and make offline recovery a repeatable gate without granting production
pages a deletion control. Evidence:
[RE-017](rough-edges.md#re-017-prompt-api-download-telemetry-omits-bytes-and-has-no-eviction-test-control).

A fresh CfT 150 physical-console run passed its registered-machine environment and launch-contract
gates, then reached `downloadable` but left activation-backed `create()` pending for 120,723 ms
with zero progress events and zero installed model bytes. Add a machine-readable delivery
state/reason that distinguishes eligibility work, queueing, fetch, verification, unpack, and a
stalled component, and reject promptly when delivery cannot advance. A separate sandboxed
branded-Chrome schema-v2 cohort subsequently passed on two fresh profiles, demonstrating that
this remains a CfT/branded delivery divergence rather than a player-facing install blocker. That cohort also found
transient `downloading` immediately after restart despite successful session creation and four
first-token samples of 3.54–3.88 seconds, all more than twice the 1.5-second dialog target. An
earlier same-digest sandbox/unsandbox cohort measured a 2.15x mean correlation, which does not
establish sandbox causation. Expose a distinct installed-model
rehydration/verification state and session-readiness diagnostics. Evidence:
[RE-019](rough-edges.md#re-019-prompt-api-creation-can-remain-pending-without-download-progress-or-model-bytes),
[RE-020](rough-edges.md#re-020-installed-prompt-api-model-reports-transient-downloading-after-browser-restart),
and [RE-021](rough-edges.md#re-021-branded-prompt-api-first-token-samples-exceed-the-dialog-target).

### Make browser trace completion reliable and diagnosable

`Tracing.end` can be acknowledged in roughly 2 ms while no chunks and no
`Tracing.tracingComplete` arrive before the former five-second collection boundary. D-092
retained one such trace through a diagnostic window: completion arrived at 5.306
seconds with 70,985 events and no data loss, immediately after Perfetto's internal
five-second data-source forced-stop threshold. The failure reproduces across category
sets and transport modes, can occur in bursts, and can recover on the next launch.
Expose per-process/data-source stop acknowledgements, forced-stop state, and bounded
read/final-stat completion so the responsible participant and time spent after forced
stop are identifiable. Evidence:
[RE-008](rough-edges.md#re-008-browser-trace-completion-becomes-intermittently-unbounded-across-category-sets).
Parallax now accepts complete lossless drains through ten seconds (D-094); the Chrome
ask is attribution and a terminal contract, not a shorter timeout.

### Let CDP synchronize and query subprocess histograms directly

Dawn's useful shader/PSO cache histograms live in the GPU process, but CDP omits them until
automation opens `chrome://histograms/` and activates subprocess import. Add an
`includeSubprocesses`/synchronize option with process attribution to `Browser.getHistograms`, or
expose page-correlated Dawn cache events directly. Evidence:
[RE-007](rough-edges.md#re-007-cdp-omits-gpu-process-dawn-histograms-until-chrome-internals-imports-subprocesses).

### Provide a supported flat CDP session for child workers

The heap collector needs `Runtime.getHeapUsage` in the render-worker isolate. Playwright cannot
publicly attach to that flat child target, so the harness uses CDP's deprecated nested-session
transport and raw `Target.sendMessageToTarget`. A supported flat child-session API would remove a
version-fragile dependency and make all-worker telemetry ordinary tooling. This may require a
Playwright surface as well as preserving the underlying CDP capability. Evidence:
[RE-013](rough-edges.md#re-013-playwright-cannot-publicly-address-a-flat-child-target-cdp-session).

### Expose selected WebGPU backend/driver without changing runtime behavior

CDP reports GPU devices but not the backend selected by the page's `GPUAdapter`. Chrome exposes
backend/driver strings only behind the WebGPU developer-features switch, which can itself change
behavior, so Parallax launches a separate identity browser. Add stable read-only backend, adapter,
driver, and feature identity through CDP or standard `GPUAdapterInfo`. Evidence:
[RE-004](rough-edges.md#re-004-cdp-cannot-identify-the-selected-webgpu-backend).

### Add continuous, attributable memory high-water telemetry

`Runtime.getHeapUsage` is an isolate snapshot. Near-concurrent 100 ms sampling across window and
worker realms is GC-phase-sensitive and cannot prove a continuous coexisting peak. A low-overhead
origin/page high-water counter with per-isolate breakdown and explicit JS/Wasm/SAB/backing-store
semantics would make memory budgets substantially more credible. Evidence:
[RE-012](rough-edges.md#re-012-cdp-exposes-isolate-used-heap-snapshots-but-no-continuous-live-retention-high-water).

## P2 requests

### Allow user-activated persistent-storage requests from dedicated workers

The M2 installer worker could own OPFS sync access handles, quota estimation, persistence-state
observation, and Web Locks, but `navigator.storage.persist()` was absent. Parallax therefore
keeps transfer and storage work in the worker while brokering the user-gesture persistence
request through the window. Expose `persist()` to dedicated workers under an explicit delegated
user-activation/permission contract so a native-class installer can keep one lifecycle owner.
This is a capability request matching the checked API split, not a Chrome/spec discrepancy.
Evidence:
[RE-045](rough-edges.md#re-045-dedicated-workers-can-observe-but-cannot-request-persistent-storage).

### Expose Prompt API sessions in dedicated workers

The window-only API keeps model orchestration and streaming callbacks on the main thread while the
rest of Parallax's high-rate platform work is worker-owned. Define the worker's responsible
document/permissions-policy relationship and expose the existing session/streaming shape in
dedicated workers. Evidence:
[RE-016](rough-edges.md#re-016-prompt-api-remains-window-only-in-chrome-150) and
[D-017](decisions.md#d-017-prompt-api-operational-model--window-broker-activation-correct-download-authored-fallback--2026-07-11-superseded-by-d-096-supersedes-d-007).

### Preserve memory-dump request identity in trace export

`Tracing.requestMemoryDump` returns a GUID, while the allocator-bearing JSON event can export as
`periodic_interval`/`0x0`; a physical-console run also exported two allocator-bearing dumps after
one explicit request in 2/6 launches. Preserve the request GUID/trigger or return a correlatable
event timestamp/packet sequence so automatic and multiple phase-specific dumps are safe. Evidence:
[RE-015](rough-edges.md#re-015-cdp-memory-dump-request-guid-is-not-preserved-in-json-trace-export).

### Make physical display identity and scaling machine-readable

RDP can replace Chrome's effective display timing while Windows still reports the physical
controller, and fractional scaling can produce a fullscreen WebGPU surface one device pixel
larger than the nominal mode. Expose the actual presentation display, remote/indirect status,
device-pixel transform, and effective refresh path through a stable browser API. Evidence:
[RE-002](rough-edges.md#re-002-rdp-makes-chrome-display-timing-disagree-with-windows-physical-mode),
[RE-003](rough-edges.md#re-003-native-fullscreen-webgpu-surface-is-one-pixel-larger-than-the-4k-display-mode),
and [RE-005](rough-edges.md#re-005-branded-stable-viz-feedback-pacing-diverges-from-the-current-cft-callback-baseline).

### Explore multiple WebGPU queues or latency-tolerant asynchronous compute

WebGPU exposes one queue per device, preventing applications from expressing independent compute
work that native APIs may overlap with graphics. Multiple queues—or a narrower latency-tolerant
compute hint with explicit synchronization—would expand the scheduling experiments available to
browser games. This needs measurement before it becomes a Parallax architecture rule. Evidence:
[RE-011](rough-edges.md#re-011-webgpu-exposes-a-single-queue-per-device--async-compute-is-unavailable-to-any-web-engine).

## Resolved locally, still useful context

[RE-001](rough-edges.md#re-001-render-worker-animation-callbacks-hold-near-32-hz-in-automated-4k-smoke-run)
was an RDP-session artifact (settled 2026-07-15): the ~32 Hz pacing was the remote session's
32 Hz display, confirmed by the retained result JSONs — 31.6 ms runs carry the RDP display
fingerprint on both driver versions, console runs pace at 60 Hz, and a falsification run ruled
out the harness's probe ordering (see RE-001/RE-002). The ordering fix was kept anyway: probing
chrome://gpu near the measurement window injects a 167-217 ms transient hitch. Together with
RE-002 it demonstrates why measurement environments need positive identification and why
privileged diagnostics need explicit measurement boundaries and observable cost.

## Chrome-side workflow

When an item is filed upstream, add the issue URL to its RE status and this document. Keep the
minimal reproduction in the harness or `harness/probes/`; do not replace measured evidence with
an issue summary. When a Chrome change lands, record the first version containing it, rerun the
acceptance test on an exact pin, and only then promote the corresponding metric or close the
finding.
