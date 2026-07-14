# Decision log

Newest first. Every entry: what was decided, why, and what would reopen it. Existing
entries are never edited into a different decision — reversing or amending one gets a
*new* entry that supersedes it (a status-line annotation on the old entry is fine).
Entries that rest on claims about current technology state (API availability, browser
support, tooling behavior) must be grounded in current sources or local experiments —
not training knowledge — and note what was checked and when (root AGENTS.md rule 10).

**Reading:** scan the D-NNN headings (or grep) and read only the entries your task
touches. Full read is for structural or cross-cutting work.

**Culling (D-023):** the log is periodically pruned — superseded or moot entries whose
context no longer informs anything current are deleted outright; git history is the
archive. D-numbers are never reused, so a citation to a culled entry stays unambiguous
(recover it from git history if needed). One guard: some entries are written as diffs
against the entry they supersede (e.g., D-020 is "as D-014, with refinements") — a
superseded entry whose content a live entry builds on cannot be culled until that
content is folded forward into a self-contained entry.

Format:

```
## D-NNN: Title  (YYYY-MM-DD, status: accepted | proposed | superseded by D-MMM)
Decision / Context / Consequences / Reopen if
```

---

## D-044: Keep RE-008 causal attribution open after an active user-timing-only timeout  (2026-07-14, accepted)

**Decision:** Do not attribute RE-008 to enabled GPU-process trace categories, payload volume,
or a particular process failing to acknowledge `Tracing.end`. Keep the maintained core trace
categories because Dawn and presentation evidence require them; a narrower category set is not
a completion workaround.

**Context:** A controlled pinned-CfT 150.0.7871.115 remote diagnostic kept the real app, render
worker, 4K target, 10 s warmup, 120-frame measurement, measured-page lifetime, browser-level
`ReportEvents` transport, and five-second completion bound unchanged, but traced only
`blink.user_timing`. Core traces completed 5/6. Fresh repeat 3 at ordinal 5 held the trace for
14,163.0 ms, acknowledged `Tracing.end` in 2.3 ms, then delivered zero events, zero chunks, and
no `Tracing.tracingComplete` before the 5,006.3 ms invalidation; ordinal 6 recovered. Successful
traces carried only 221–237 events / 34,744–36,798 serialized bytes and completed in
13.0–13.9 ms. All nine isolated short V8 traces completed.

Those unchanged V8 lineages also measured launch-2 worker startup at 148.7, 150.7, and
150.4 ms versus launch-3 at 145.3, 156.8, and 151.4 ms. Launch 3 was slower in two of three
lineages, directly rebutting a consistent launch-2 → launch-3 saving or a measured ≤5 ms V8
cache bound. The worker still emitted no production event on launch 2, and no controlled cache
toggle exists, so the earlier 789.5 ms launch-2 outlier is not evidence of cache serialization.

The result disproves enabled Dawn/presentation categories and multi-megabyte payload as
necessary conditions for the captured failure. It does not identify which browser participant
withheld completion: browser-level tracing may coordinate processes that emit no enabled events.
Together with D-043's 6/6 long blank-page controls, current evidence points to measured-page
activity or workload/process coordination interacting with a roughly 14 s trace, not lifetime,
category payload, or GPU-category emission alone.

**Sources checked (2026-07-14):** local temporary category-control run on dev-01 under RDP
(non-gating), report
`smoke-1-cb961cbc9d86-dev-01-showcase-2026-07-14T18-42-02-841Z.json`; maintained source was
restored after the predeclared timeout falsifier occurred.

**Consequences:** RE-008 remains fail-closed and its Chromium report must present the
user-timing-only failure alongside the core-category failures. The next discriminating
experiment needs a controlled active-workload toggle or traced-process completion visibility;
another category-removal arm cannot establish the responsible process. RE-010 remains an
observability finding with a modest measured warm worker-startup component, not a measured V8
cache-savings claim.

**Reopen if:** an active-workload toggle separates completion from page/process activity, CDP
exposes per-process trace-stop acknowledgement, or a pinned Chrome change removes the failure.

## D-043: Measure worker startup and trace recording lifetime without inferring causes  (2026-07-14, accepted)

**Decision:** The isolated diagnostic advances to `v8-code-cache@5` and records the existing
public `workerStartupToFirstFrameMs` telemetry on fresh, produce, and warm launches. The timer
starts immediately before constructing the module worker and ends when its first-frame message
reaches the window, so it includes worker script startup plus render initialization and first
frame; it is a launch component, not the full launch metric and not a V8-only timer. Result
schema v11 also records trace recording lifetime from acknowledged `Tracing.start` through the
`Tracing.end` request for every core and V8 trace.

Neither diagnostic attributes a cause. A fresh/warm startup difference can include HTTP cache,
worker startup, V8, WebGPU/Babylon initialization, Dawn state, GPU scheduling, and first-frame
delivery. Recording lifetime is correlated with all activity accumulated during that interval;
it must be varied in a controlled arm before being blamed for RE-008.

**Context:** A local pinned-CfT 150.0.7871.115 run measured worker startup-to-first-frame at
191.4–204.8 ms fresh, 146.0–149.0 ms on launch 2, and 146.0–154.5 ms warm. The improvement is
already present on launch 2 even though the worker exposes no cache-production prerequisite, so
the launch-3 result cannot be assigned specifically to code-cache consumption. The warm worker
component is about 1.5% of the 10 s launch budget; it de-escalates RE-010's current launch-cost
risk without resolving its mandatory cache-evidence gap.

A second exact-tree run reproduced the fresh and warm bands at 182.4–206.5 ms and
144.2–150.3 ms. Its launch-2 samples were 152.4 ms, 152.9 ms, and one 789.5 ms outlier. That
outlier is retained rather than assigned to V8: this remote, non-gating timer covers the whole
worker-to-first-frame path, and no controlled cache toggle isolates the cause.

The two maintained runs measured core traces open for 13,190.5–14,187.3 ms and V8 traces
normally open for 288.9–387.9 ms; the launch-2 startup outlier extended one V8 recording to
944.8 ms. Each run lost one of six core traces while all nine V8 traces completed. A controlled
fresh-browser `about:blank` matrix then held traces for either 300 ms or 14,100 ms without page
activity. All arms completed 6/6: short core produced 24–29 events / 3,564–4,262 bytes, long core
80–89 events / 13,496–14,645 bytes, and long V8 43–52 events / 6,949–8,074 bytes. Successful
long-arm drains completed in 8.6–20.0 ms. The maintained active core traces at the same lifetime
carried roughly 24,500–25,000 events / 3.9–4.0 MB. Trace lifetime alone therefore does not
reproduce RE-008; page activity and the resulting event/process/volume regime remain in scope.

**Sources checked (2026-07-14):** local render-service timer boundary, pinned CfT
150.0.7871.115 `v8-code-cache@5`/schema-v11 runs, and the three-arm local CDP experiment above on
dev-01 under RDP (all non-gating). Current V8 documentation confirms that post-execution code
caches can contain functions compiled lazily during execution, but does not make either Parallax
timer an authoritative cache result
([V8 code-caching documentation](https://v8.dev/blog/improved-code-caching)).

**Consequences:** Parallax measures the end-to-end worker-startup component it already waited for
and knows the actual recording lifetime of every trace. RE-010 no longer carries an unmeasured
dominant-launch-cost implication, and RE-008 investigation shifts from duration alone toward the
active-page event/process/volume regime. Neither cache nor trace gates are weakened.

**Reopen if:** worker startup becomes a calibrated launch sub-budget, a controlled cache toggle
can isolate its V8 share, or an active-page trace matrix separates event volume, process set, and
category interaction.

## D-042: Retain V8 compile-event duration as a diagnostic, not cache proof  (2026-07-14, accepted; startup and trace-lifetime diagnostics added by D-043)

**Decision:** The isolated diagnostic advances to `v8-code-cache@4` and retains the finite,
nonnegative `dur` from every attributed complete `v8.compile`/`v8.compileModule` event as
`compileDurationUs`, both per event and summed per artifact. Missing or malformed duration
invalidates the same attribution transaction as missing URL or streaming state. The report emits
raw per-run, per-artifact microsecond values and the result schema advances to v10.

Compile-event duration is a non-gating diagnostic. A shorter warm event may motivate a controlled
reproduction, but does not prove cache consumption; a flat event does not prove reparsing or
cache absence. Streamed compilation overlaps other work, three lineages are a small sample, and
the trace span is not an authoritative cache outcome. D-037/D-041's production, re-production,
and positive consume/reject evidence remain the cache gates.

**Context:** A local pinned-CfT 150.0.7871.115 run retained one compile event per artifact per
launch. The non-streamed render worker measured 24,862–25,262 µs fresh, 25,083–26,496 µs on the
produce launch, and 24,415–26,758 µs warm: overlapping ranges with no consistent warm decrease.
That is consistent with repeated full compile work but does not identify the mechanism. It also
puts the observed event near 25 ms—roughly 0.25% of the 10 s launch budget—so the worker's 99.84%
source-code share is not evidence of proportional launch cost. Streamed app events measured
37–40 µs fresh and 26–30 µs warm; streamed engine events were 3–8 µs in both phases. Those tiny,
overlapping/confounded spans do not turn RE-009 into functional cache proof.

The same run captured one core trace timeout at launch ordinal 5 followed by recovery at ordinal
6. Combined with the prior three-failure ordinal-3–5 burst and other isolated failures, RE-008
can be described as burst-capable with recovery, but the samples do not distinguish transient
shared state from chance clustering.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115
`v8-code-cache@4`/schema-v10 diagnostic on dev-01 under RDP (non-gating), with raw durations
retained in the result; current Chromium DevTools trace-event types, which declare complete-event
`dur` in microseconds
([source](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/front_end/models/trace/types/TraceEvents.ts)).

**Consequences:** Parallax no longer discards already-captured compile spans, and can correlate
them with future artifact growth or controlled cache experiments. The duration diagnostic cannot
make a red cache gate green or replace authoritative cache outcome fields.

**Reopen if:** a controlled micro-repro establishes a calibrated relationship between this trace
span and cache consumption, Chrome documents stronger event semantics, or enough samples support
a variance-aware duration budget.

## D-041: Assert production phase boundaries and measure warm re-production  (2026-07-14, accepted; compile-duration diagnostics added by D-042)

**Decision:** The isolated diagnostic advances to `v8-code-cache@3` and evaluates
URL-attributed code-cache production on every launch. Fresh launches must emit no production
events; any positive event invalidates the timestamp → produce → consume model directly.
Produce launches retain D-040's requirement that every cacheable required artifact emit positive
production. Warm launches record every positive re-production and gate the count at zero
artifacts. Missing warm production is a measured absence, not proof of consumption; D-037's
positive consume/reject requirement remains independently mandatory. Result schema v9 also adds
an ordinal and elapsed measurement-sequence time to every core and V8 launch so RE-008 samples
can be checked for temporal clustering.

**Context:** `v8-code-cache@2` inspected production only on launch 2, leaving two ambiguity gaps.
An unexpected launch-1 production would contradict the lifecycle but escape direct detection,
and repeated app/engine production on launch 3 would show that their launch-2 cache was not used
as expected rather than merely consumed without trace fields. A three-lineage local CfT
150.0.7871.115 diagnostic with the new assertions observed zero fresh production events and zero
warm re-production events in all repeats. Launch 2 again produced exactly 3,072 app bytes and
6,968 engine bytes while exposing no render-worker production (RE-010). The warm result therefore
does not support repeated production as the explanation for app/engine's missing consumption
fields; it is consistent with silent consumption but cannot prove it, so RE-009 remains open.

The same run's core trace failures occurred at launch ordinals 3, 4, and 5, approximately 30,
50, and 70 seconds after the measurement sequence began; launch 6 completed at approximately
90 seconds. Together with earlier warm-repeat-1 failures, this first timed sample argues against
a simple monotonic late-session cutoff while leaving RE-008's intermittent mechanism open. A
final-tree rerun then repeated the same fresh/produce/warm V8 outcomes with 9/9 completed traces
and completed all 6 core traces, further demonstrating intermittency rather than an ordinal
cutoff.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115 `v8-code-cache@3`/schema-v9
diagnostic on dev-01 under RDP (non-gating), plus the Blink source and Chromium three-fetch test
recorded by D-040.

**Consequences:** the existing nine V8 launches now test all three production phase boundaries
without adding launches. A reported warm re-production is measured negative evidence and fails
the gate even when consumption fields remain unavailable. An absence of re-production narrows
the functional hypotheses but never substitutes for positive consumption evidence. Trace
failures retain their order and elapsed position without inferring that either causes the issue.

**Reopen if:** Blink changes its production lifecycle, repeated production proves compatible
with a valid consumed cache, or temporal fields identify a better boundary than sequence start.

## D-040: V8 code-cache diagnostics use the timestamp/produce/consume lifecycle  (2026-07-14, accepted; production phase assertions amended by D-041)

**Decision:** The isolated V8 diagnostic advances to `v8-code-cache@2` and gives each of its
three persistent-profile lineages three launches: `fresh` establishes Blink's hot-resource
timestamp, `produce` must emit a URL-attributed `v8.produceCache` or `v8.produceModuleCache`
event with positive `producedCacheSize` for every cacheable immutable JavaScript artifact, and
`warm` is the first launch on which the zero-rejection budget requires URL-attributed cache
consumption. Fresh and produce launches reject unexpected consumption results. The enclosing
result schema advances to v8 and preserves per-artifact production outcomes even when another
artifact makes the aggregate production metric invalid.

**Context:** D-037/D-039 incorrectly modeled the second profile launch as a consumption launch.
Current Blink source selects `kSetTimeStamp` when no hot timestamp exists, selects
`kProduceCodeCache` after that timestamp exists, and only enters the consume path after code
cache exists. Chromium's own module cache test correspondingly loads a module three times and
states that the second fetch produces cache while the third consumes it. A corrected local
three-lineage diagnostic on pinned CfT 150.0.7871.115 then measured the same launch-2 production
in every lineage: 3,072 bytes for the app and 6,968 bytes for the engine. The game module was
below Chrome 150's 1,024-code-unit external-script threshold. The 5,257,345-code-unit render
worker compiled on launch 2 but emitted no URL-attributed production event in any lineage
(RE-010), so production correctly remained mandatory/invalid while retaining the two positive
outcomes. Launch-3 consumption still omitted a usable result for all cacheable artifacts,
strengthening RE-009 now that the maintained harness reaches the correct consumption launch.

**Sources checked (2026-07-14):** current Blink
[`v8_code_cache.cc`](https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/bindings/core/v8/v8_code_cache.cc),
Chromium's
[three-fetch module cache test](https://chromium.googlesource.com/chromium/src/+/3188edc14a270a65297865a82af20bf4e3c57563%5E%21/),
and the local pinned-CfT diagnostic above on dev-01 under RDP (non-gating).

**Consequences:** each V8 lineage costs one additional short launch. The harness now proves the
cache-write prerequisite independently of cache consumption and cannot mistake a launch-2
production for a missing launch-2 hit. Worker production and warm consumption remain fail-closed
platform findings rather than being hidden behind one aggregate invalid state.

**Reopen if:** Blink changes the code-cache lifecycle, Chrome exposes an authoritative cache
state that removes a launch, or the extra launch becomes a measured throughput problem.

## D-039: Isolate mandatory V8 evidence from the core smoke trace  (2026-07-14, accepted; diagnostic lifecycle amended by D-040)
**Decision:** Harness v1 collects V8 code-cache evidence in the versioned
`v8-code-cache@1` diagnostic rather than co-locating `v8` with the core `smoke@1`
presentation/Dawn trace. The diagnostic owns three independent fresh/warm persistent-profile
lineages, traces only `v8` from before navigation through render readiness, and runs against the
same validated artifact, pinned Chrome executable, inspected environment, and before/after
source identity as the enclosing report. `smoke@1` still runs its three core fresh/warm lineages
with presentation, Dawn, and user-timing categories. Both sets and their trace-drain diagnostics
are emitted in one result; the schema advances to v7.

V8 code-cache evidence remains mandatory for Harness v1. An invalid `v8-code-cache@1` result
still fails the overall verdict; isolation narrows the damage of its trace failure rather than
turning the metric advisory. A V8 timeout can no longer invalidate core presentation or Dawn
evidence, and a core timeout cannot erase V8 attribution.

**Context:** D-038 measured that merely narrowing `devtools.timeline` to `v8` reduced ordinary
collection cost without materially changing the intermittent combined-trace failure rate. A
follow-up `ReturnAsStream` experiment also reproduced two timeouts in six launches: both
acknowledged `Tracing.end` in 1.8–1.9 ms, then never emitted `Tracing.tracingComplete`, so Chrome
never supplied an IO stream handle. The four successes completed in 116–125 ms. Changing the
transfer path therefore did not bypass the captured missing-completion failure and was not kept.

Two unchanged integrated isolation diagnostics then completed 12/12 core traces and 12/12
V8-only traces. Every core launch retained the expected Dawn evidence: fresh 6 shader/3 graphics-
PSO misses, warm 6/3 hits, and zero gameplay-overlap compilation. Core traces delivered
3,915,274–4,013,410 locally reserialized bytes in 111.3–121.3 ms. V8-only traces still attributed
all four immutable JavaScript artifacts while delivering just 173–177 events /
26,434–27,708 bytes in 11.0–12.3 ms. Warm V8 consumption remained invalid for the independent
RE-009 observability reason; isolation fixes evidence coupling, not Chrome's missing cache result.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 `ReturnAsStream` and integrated
isolation diagnostics above on dev-01 under RDP (non-gating); local Playwright 1.61.1 CDP
protocol declarations for `Tracing.tracingComplete`, `IO.read`, and `IO.close`.

**Consequences:** the report adds six short browser launches for V8's three paired lineages, but
protects the longer core runs and their valid Dawn evidence from a V8-correlated trace failure.
Artifact and source identity are rechecked only after both sets finish, so the shared report
cannot combine different builds. Profile histories remain explicit and are never compared
across the core/V8 boundary. The physical-console Dawn calibration can now obtain a complete
core evidence set even while the mandatory V8 metric remains invalid and keeps Harness v1 red.

**Reopen if:** isolated V8 traces become unreliable, Chrome exposes a stable non-trace
page-correlated cache result, combined tracing becomes reliable on the physical-console gate, or
the additional launches become a measured throughput problem.

## D-038: Narrow V8 tracing and measure trace completion as a first-class diagnostic  (2026-07-14, accepted; shared-trace placement superseded by D-039)
**Decision:** `smoke@1` enables the `v8` trace category, not the broader
`devtools.timeline` category, for D-037's `v8.compile`/`v8.compileModule` evidence. The
shared presentation/Dawn/V8 trace records its exact categories, event and CDP data-chunk counts,
locally reserialized UTF-8 event bytes, `Tracing.end` command latency, command-to-completion and
total completion latency, configured timeout, and Chrome's data-loss result for every started
trace. Partial diagnostics survive a timeout and appear in both JSON and the human report. The
result schema advances to v6. The five-second completion bound remains unchanged; a timeout
invalidates every probe that depends on the shared trace.

**Context:** A pinned-CfT 150.0.7871.115 remote A/B on the same artifact measured three
six-launch configurations. With `devtools.timeline`, three traces timed out; the three completed
traces delivered 29,383–29,914 events / 5,000,116–5,091,624 serialized bytes and completed in
149.2–152.1 ms. With `v8`, one trace timed out; the five completed traces still attributed every
immutable JavaScript artifact and retained the required compile fields while delivering
25,703–26,095 events / 4,088,465–4,151,565 bytes in 117.4–120.1 ms. With no V8 category, all six
traces completed with 24,770–25,036 events / 3,954,012–3,982,554 bytes in 112.7–117.3 ms. A
second `v8` diagnostic timed out twice; on both failures `Tracing.end` returned in 1.6–2.1 ms,
then Chrome delivered neither `Tracing.tracingComplete` nor any data chunk during the remaining
five-second bound. Its completed traces took 116.8–119.1 ms total. A separate 20-second broad-
category diagnostic completed 6/6, but every completion was still fast (146.5–153.3 ms); it did
not capture a delayed completion and therefore does not establish that a larger bound repairs
the intermittent failure.

These samples correlate V8 tracing with the completion failure, but they do not establish a
volume-driven flush mechanism: completed drains are two orders of magnitude below the bound,
while failures begin only after the end command returns and deliver zero chunks. Narrowing is
still the correct maintained configuration because it preserves the probe with measurably less
trace traffic. Splitting the shared trace would require another navigation/launch and would
change the fresh/warm profile lineage whose atomic evidence the harness is measuring, so that is
not adopted without a replacement lifecycle design.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 diagnostics above on dev-01 under
RDP (non-gating); exact trace configuration and partial completion diagnostics recorded by
`smoke@1` v6.

**Consequences:** ordinary trace completion cost and failure mode are now observable per run.
The narrower V8 category reduces collection overhead but does not eliminate RE-008, and one
completion failure still invalidates presentation, Dawn, and V8 evidence together. The retained
diagnostics distinguish a `Tracing.end` command stall, missing completion event, data loss, and
large/slow payload if Chrome's behavior changes.

**Reopen if:** `v8` stops carrying the D-037 fields, the trace completion failure reproduces on a
physical-console gate, `ReturnAsStream` or another collection mode proves more reliable, or a
separate-navigation design can preserve the required profile lineage and atomic measurement
contract.

## D-037: Streamed-module V8 cache traces are diagnostic, not cache-hit evidence  (2026-07-13, accepted; trace category amended by D-038, collection isolated by D-039, launch lifecycle corrected by D-040/D-041, duration retained by D-042)
**Decision:** `smoke@1` implements its V8 code-cache probe with URL-attributed
`v8.compile`/`v8.compileModule` events from Chrome's `devtools.timeline` trace category.
Every launch-required immutable JavaScript artifact in the validated build manifest must have at
least one compilation event before any cache outcome is evaluated. Multiple events for one URL
are valid when the same artifact compiles in multiple renderer processes, workers, threads, or
realms; the result retains each event's process/thread identity and requires trustworthy evidence
from every compilation. On a warm profile, a successful consumption requires a positive
`consumedCacheSize` and `cacheRejected: false`; an explicit `cacheRejected: true` is measured
negative evidence even if its size is zero or absent, and fails the zero-rejection budget. A
missing/ambiguous result is `invalid`, while artifacts below Chrome 150's
1,024-decoded-source-code-unit threshold and cold-profile consumption are explicitly
`not-applicable`. If no artifact is cacheable, the aggregate mandatory metric is also
`not-applicable` and fails the gate. The overall smoke result schema advances to v5.

**Context:** All four current Parallax JavaScript artifacts compile as ES modules. In pinned CfT
150.0.7871.115, the three window modules stream and the render-worker module currently reports
non-streamed compilation. Chromium's non-streaming `V8ScriptRunner::CompileModule` branch
serializes a `V8ConsumeCacheResult`, but its `ScriptStreamer` branch does not populate that
result. A local persistent-profile experiment captured the four exact Parallax URLs on each of
five launches; their compile events never included `consumedCacheSize` or `cacheRejected`.
The second launch instead reported producing 3,072 bytes of app cache and 6,968 bytes of engine
cache, so at least those two artifacts demonstrably did not consume code cache on launch 2.
Blink's process-wide `WebCore.Scripts.V8CodeCacheMetadata.Get` histogram later contained four
code-cache-metadata reads, but that surface requires the subprocess-importing Histograms
Internals page and cannot correlate a read, V8 acceptance, or rejection to a page URL. Treating
it as a hit would violate the project's measure-don't-assert rule.

The first maintained six-launch remote diagnostic completed all combined traces within D-035's
bound, attributed all fresh artifacts, and left the already-validated Dawn
fresh-miss/warm-hit evidence unchanged. Two post-review six-launch reruns continued to attribute
all four artifacts in every completed fresh trace and all three cacheable artifacts in each
completed warm trace, but one and then three combined traces exceeded the existing five-second
completion bound. Across these three maintained diagnostics, 14 of 18 traces completed and four
timed out with the measured page kept alive, extending RE-008. No completed trace reported CDP
buffer data loss. Every completed warm V8 result correctly remained `invalid`, so these
diagnostics do not promote a V8 gate baseline. RE-009 records the code-cache observability gap.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc`,
`v8_code_cache.cc`, `inspector_trace_events.cc`, and
`tools/metrics/histograms/metadata/v8/enums.xml`; pinned V8 revision
`ce0af5c0d181678bcda077c68d4beaec2854ad16` via Chromium's `DEPS`.

**Follow-up checked (2026-07-14):** the third maintained local CfT 150.0.7871.115 diagnostic
above; three of its six combined traces timed out and none reported trace-buffer data loss.

**Consequences:** the V8 probe is implemented but its mandatory warm metric remains invalid on
the walking skeleton. The trace diagnostic is kept because it is exact, page-correlated, and
will turn measured without a schema change when Chrome exposes successful streamed consumption.
Process-wide metadata-read counts remain supporting diagnostics only. The probe must be extended
separately when a wasm artifact exists; this decision covers JavaScript code caching.
Decoded source length is read from the validated built files before launching Chrome so non-ASCII
bundles use the same UTF-16-code-unit quantity as Blink rather than response byte length; a
leading BOM is removed to match browser decoding. The M0 manifest currently contains only
launch-required JavaScript. Before lazy scenario-specific JavaScript chunks enter it, the build
contract must classify scenario participation so `smoke@1` can keep zero compilation events
invalid for required code without demanding unrelated lazy chunks.

**Reopen if:** Chrome adds consumption/rejection data to streamed-module trace events, exposes a
stable page-correlated code-cache API, changes the pinned cacheability threshold, or Parallax
adds wasm and needs `v8.wasm.moduleCacheHit` evidence.

## D-036: D3D12 Dawn gates combine page-windowed traces with subprocess cache histograms  (2026-07-13, accepted)
**Decision:** `smoke@1` implements the mandatory Dawn pipeline compile/cache metric on the
registered D3D12 gate by combining two independent Chrome surfaces. One browser-wide trace,
started before navigation, adds `disabled-by-default-gpu.dawn` to the D-035 categories.
Renderer user-timing markers bound gameplay; any overlapping synchronous render/compute
pipeline creation, asynchronous `CreatePipelineAsyncEvent::InitializeImpl`, or D3D12 shader
compiler event fails the zero-gameplay-compile budget. After the trace and measurement end,
the harness opens `chrome://histograms/` outside the measurement window while the trace remains
active, synchronizes subprocess counters, then ends the trace and synchronizes them again. It reads
the exact `GPU.WebGPU.D3D12` shader, graphics-PSO, and compute-PSO hit/miss histograms through
CDP. Shader request/miss trace counts must agree exactly with the histogram operation counts;
PSO histogram operations are bounded by the trace's synchronous API requests plus actual
asynchronous initializations, and must cover every traced asynchronous initialization (a
synchronous API request can be an in-device cache hit and therefore have no backend PSO
histogram). Graphics and compute counts also have independent upper bounds: their matching
synchronous requests plus the generic async-initialization count, so one path cannot explain
contradictory evidence from the other. Each synchronization itself uses two stable reads, and the snapshots immediately
before and after trace completion must also match; any late change makes the metric `invalid`.
Any other trace/histogram contradiction does likewise.
Missing hit or miss sides count as zero only when the counterpart proves that cache path was
exercised. Non-D3D12 backends remain explicit `unsupported` for this probe rather than
borrowing D3D12 semantics.

**Context:** Dawn emits page-windowable pipeline/compiler work into Chrome's disabled Dawn
trace category, but its exact backend cache results are GPU-process UMA histograms. A direct
`Browser.getHistograms` call returned no `GPU.WebGPU` entries because CDP reads the browser
process's statistics recorder. Chrome's Histograms Internals page imports shared-memory
subprocess histograms and requests remaining child-process deltas; after that synchronization,
the same CDP call returned Dawn's exact counters. Keeping the trace active through the first
import makes any deferred app Dawn work visible to both surfaces; the stable post-trace snapshot
then establishes their shared observation boundary. The internals tab opens only after the
presentation tail and gameplay marker, so its focus/GPU work cannot contaminate measured
timings, and filtering to Dawn's `GPU.WebGPU` events/counters excludes unrelated diagnostics
work. Each `measureRun` launches a new
browser process, so counters are per launch even though the persistent profile deliberately
survives for its paired warm relaunch.

A non-gating remote diagnostic with pinned CfT 150.0.7871.115 on dev-01 measured the same
result across all three lineages: each fresh launch recorded 6 shader-cache and 3 graphics-PSO
misses; each warm relaunch recorded 6 shader-cache and 3 graphics-PSO hits; compute PSOs were
not exercised; all six marked gameplay windows had zero overlapping pipeline initialization
and zero shader compiler events. The environment correctly remained `invalid` under RDP, so a
physical-console rerun is still required before baseline promotion.

**Consequences:** smoke result schema advances to v4. Harness reports whole-launch cache counts
and durations while using trace markers—not end-of-run UMA—for gameplay-window attribution.
Synchronous API creation is conservatively budgeted even if Dawn could satisfy it from an
in-device cache; Parallax's warmup contract forbids requesting new pipelines during gameplay
regardless. `smoke@1` now marks the D3D12 Dawn metric implemented and continues to fail when the
probe is unsupported, internally inconsistent, or missing. RE-007 records the Chrome
observability gap and internals-page synchronization cost. Each PSO cache subpath carries its
own metric state; an unexercised compute or render path is `not-applicable`, never a measured
zero-hit result.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `content/browser/metrics/histograms_internals_ui.cc`,
`content/browser/resources/histograms/histograms_internals.html` and
`histograms_internals.ts`, `content/browser/devtools/protocol/browser_handler.cc`,
`gpu/command_buffer/service/dawn_platform.cc`, and
`gpu/command_buffer/service/webgpu_decoder_impl.cc`; pinned Dawn revision
`01249a97332468dbdd6cf5edb8dd7bae77875de5` `native/d3d12/RenderPipelineD3D12.cpp`,
`native/CacheRequest.h`, and `native/CreatePipelineAsyncEvent.cpp`. A local attempted
page-close boundary was rejected after two of six browser traces exceeded D-035's five-second
completion bound; keeping the app target alive preserved the already-validated bound.

**Reopen if:** Chrome exposes page-correlated Dawn cache events directly, CDP gains a safe
subprocess-histogram option, Dawn trace/histogram semantics change, or another backend is
promoted to a mandatory gate and needs its own verified mapping.

## D-035: Viz presentation-feedback trace is diagnostic, not a presentation gate  (2026-07-13, accepted)
**Decision:** `smoke@1` records GPU-process `Display::FrameDisplayed` intervals as the
explicitly non-gating `vizPresentationFeedbackCallbackIntervalMs` diagnostic. It does not
satisfy budgets.md's compositor-presentation metric, which remains mandatory and invalid.
The collector enables only `disabled-by-default-display.framedisplayed` plus
`blink.user_timing`; renderer `performance.mark()` instants bound the run in Chrome's
shared monotonic trace clock. A usable diagnostic requires no trace loss, exactly one GPU
process/track, and feedback spanning both boundaries. A 100 ms post-marker trace tail sits
outside app/CPU measurement so the final callback can close the boundary interval. Smoke
result schema advances to v3 for the diagnostic and its cross-repeat variance. Trace
end/completion is bounded as one five-second transaction; timeout or CDP disconnect makes
only the diagnostic invalid and always detaches the session.

**Context:** Chromium's Viz `Display::DidReceivePresentationFeedback` sanitizes invalid
feedback to `PresentationFeedback::Failure()`, whose timestamp is the failure time and whose
flags contain `kFailure`, then emits `Display::FrameDisplayed` with only the timestamp/name.
The trace event does not expose that failure flag. Treating every event as successful
scan-out could therefore report a passing cadence when presentation actually failed. A
local diagnostic on branded Chrome Stable 150.0.7871.102, Windows 11, RTX 4080
Super/D3D12, observed one callback track and correlated it with the worker's ~32 Hz pacing;
that validates collection/clock alignment, not display success. RE-005 records the
branded-vs-pinned cadence question and RE-006 the blocking observability gap.

**Consequences:** The harness preserves useful compositor-adjacent evidence without
weakening the true frame gate or substituting worker callbacks. Trace ambiguity/loss makes
only the diagnostic invalid and does not independently fail a run. The mandatory metric's
explicit invalid state continues to fail Harness v1. A browser surface that exposes both
the timestamp and presentation-success flags—or another independently correlated source—is
required before applying frame budgets. External trace markers also remain unsuitable for
D-025's eventual driver-free in-game measurement path.

**Sources checked (2026-07-13):** Chromium
`components/viz/service/display/display.cc` at main (sanitization and trace emission),
`ui/gfx/presentation_feedback.h` at main (`Failure()`, `kFailure`, and timestamp semantics),
`base/trace_event/builtin_categories.h` at main (the dedicated category), and the Chrome
DevTools Protocol Tracing-domain documentation (completion, delivery, and data loss). Local
behavior was checked directly as described above.

**Reopen if:** Chrome exposes the feedback flags in a correlated trace/CDP event, a stable
page-correlated presentation API becomes available, or a separate probe can prove that all
events in the gate window represent successful scan-out.

## D-034: Harness gates versioned observed environments from a physical console  (2026-07-13, accepted)
**Decision:** Reference-machine identities live as versioned descriptors in
`harness/machines/`; `smoke@1` verifies the requested tier against observed state rather
than caller-provided GPU/backend/power/display labels. The initial Windows verifier checks
the exact OS build, CPU topology, minimum RAM, CDP primary-GPU PCI IDs and driver, WebGPU
adapter vendor/architecture/device/driver/backend, active Windows power-scheme GUID, and
display-controller resolution/refresh. Every gate browser launches native fullscreen without
Playwright viewport emulation, ties its own `screen` dimensions at its device-pixel ratio to
the target physical resolution, requires every refresh rate reported by Chrome GPU Internals
to match the tier, and verifies the canvas device-pixel surface equals the tier resolution;
Chrome-internals diagnostics complete before the full warmup, then each measurement browser
samples screen/surface identity at the immediate boundaries of its 120-frame window and
continuously records device-pixel resize events during the window, with any drift invalidating
the result. Windows display adapters are matched to the descriptor by PCI vendor/device IDs,
not mutable display names; any other active adapter is rejected as unregistered. The short-lived
identity browser loads a minimal harness-control document and enables Chrome's WebGPU
developer-features switch solely to read the
non-standard adapter backend and driver;
measurement browsers do not enable that switch. Host identity is sampled before and after
the six measurement launches, and any drift invalidates the result. A remote Windows session,
remote/indirect display adapter, unregistered tier, missing descriptor, or any mismatch makes
the mandatory environment metric `invalid`. Reference gates require advance notice to the
developer and a native local interactive session at the physical machine; remote sessions
remain valid only for explicitly non-gating development diagnostics.

**Context:** Machine/backend/power/display fields in the first `smoke@1` report were
declarations and therefore could not establish gate eligibility (D-031). A local CfT
150.0.7871.115 experiment on dev-01 on 2026-07-13 showed why: under RDP, Windows' physical
NVIDIA controller reported 3840×2160 at 59 Hz while Chrome's GPU Internals accessibility
tree reported three remote displays at 32 Hz; Windows also exposed a Microsoft Remote
Display Adapter. The same pinned Chrome, launched separately with
`--enable-webgpu-developer-features`, exposed the selected adapter as NVIDIA Lovelace,
D3D12, driver 32.0.15.9649. Chrome documents the extended `GPUAdapterInfo.backend` and
`driver` fields as developer-only, and CDP documents GPU PCI/driver fields but not the
selected WebGPU backend, so both probes are needed.

The first physical-console verification later on 2026-07-13 found the installed NVIDIA
driver had advanced to 32.0.16.1074; Windows, CDP, and developer-mode WebGPU adapter info
agreed, so that version is the explicitly promoted dev-01 descriptor baseline. The earlier
RDP evidence retains its observed version rather than being rewritten.

**Consequences:** `PARALLAX_GPU_BACKEND` and `PARALLAX_POWER_MODE` are removed; future
machine registrations add descriptors and platform probes instead of trusting labels. OS,
driver, or power-plan promotion is visible in review. The developer-features switch can
change development-only WebGPU behavior, so isolating it to identity inspection avoids
silently changing the measured runtime. The Harness v1 environment probe is implemented,
and its dev-01 native-console measurement was `measured` across all three fresh/warm pairs on
2026-07-13; other mandatory probes still keep Harness v1 incomplete. The smoke result schema advances to v2 for the observed machine,
adapter, browser-display, and pre/post host-identity fields. Result-contract field names remain
browser-neutral (`executableSha256`, `refreshRatesHz`) even where the current privileged probe
is Chrome-specific; probe failures are retained in browser-neutral `probeFailures` evidence
and invalidate the environment so a completed measurement report is still written. Machine
IDs are accepted case-insensitively and persisted using the descriptor's canonical lowercase
ID. Descriptive CPU/WebGPU strings compare case-insensitively with whitespace normalized;
numeric PCI IDs, OS/driver/browser versions, measured dimensions/rates, and power GUIDs
remain strict.
This supersedes D-031's initial fixed-headed-viewport provision: native fullscreen plus an
explicit render-surface assertion makes each measured browser prove its presentation monitor
instead of accepting an emulated `window.screen`.

The native run also established that Chrome's `devicePixelContentBoxSize` is consistently
3841×2161 on dev-01's 3840×2160 display under its fractional Windows scale. The descriptor's
explicit ±2-pixel physical-dimension tolerance therefore applies to both observed screen and
render-surface checks; the actual surface remains recorded per run (RE-003).

**Sources checked (2026-07-13):** local dev-01 experiments described above;
`chromedevtools.github.io/devtools-protocol/tot/SystemInfo/`;
`developer.chrome.com/docs/web-platform/webgpu/developer-features`; and Chromium's
`gpu/config/gpu_switches.cc` definition of `enable-webgpu-developer-features`.

**Reopen if:** Chrome exposes the selected WebGPU backend through a stable, non-mutating
CDP surface; OS display APIs cannot identify the actual presentation display; a remote
transport can prove unmodified physical display timing; or exact OS/driver pins cause more
baseline churn than research value.

## D-033: NPC context is assembled by a knowledge service in engine/ai  (2026-07-13, accepted)
**Decision:** The AI layer gains a **knowledge service** in `engine/ai`: NPC prompts are
assembled as persona card + context retrieved through an explicit interface — never by
hardcoding all world knowledge into the prompt. Three context tiers, each adopting its
own mechanism independently, on evidence:
1. **Structured game-state queries** — quest state, relationships, location/world-graph
   facts answered from the sim's typed state. Deterministic, no embeddings, debuggable;
   the default tool, and it lands with M3.
2. **Authored lore retrieval** — world backstory chunked + tagged at authoring time,
   shipped as a content-addressed game-specific bundle (D-010). Mechanism open:
   tag/world-graph lookup vs. precomputed embeddings with brute-force similarity (at
   game-scale corpora — thousands of chunks — a linear scan in a wasm simd128 worker
   suffices; no vector database). Build-later.
3. **Episodic memory** — NPC observations embedded at runtime. Requires an app-owned
   embedder: Chrome ships **no built-in Embedding API** (checked 2026-07-13).
   Build-later.
**Ownership (layer rules apply as everywhere):** `engine/ai` owns the *generic
contract* — provider registration, context assembly/ranking/token budgeting, scheduling,
telemetry — and contains no game knowledge. `game/` supplies the providers: game-state
query implementations, retrieval schemas, lore content and its tagging, persona cards.
The tier list above describes what game-supplied providers answer, not what engine code
knows.
Design-now constraints: the M3 prompt/persona-card schema reserves a retrieved-context
slot from day one; lore is authored chunked + tagged in `game/` from the first writing;
embedding precompute, if adopted, is an `assets/` pipeline step. The service is
**backend-independent of D-017/P-007** — whichever generation backend wins, retrieval
infrastructure is app-owned.
**Context:** On-device, prompt-stuffing is triply wrong: prefill cost scales with prompt
length (time-to-first-token is the dialog latency the player feels), Nano session/context
limits are an already-flagged D-017 concern, and small models degrade on long
mostly-irrelevant context. Unlike generic RAG deployments, a game has an authoritative,
queryable ground truth (the sim state and world graph) — so semantic retrieval is the
fallback for freeform lore and memories, not the default mechanism. Persona cards remain
what they always were: curated static context.
**Sources checked (2026-07-13):** developer.chrome.com/docs/ai/built-in lists Prompt,
Summarizer, Translator, Language Detector, Writer, Rewriter, Proofreader — no Embedding
API. App-owned in-browser embedding is feasible today: EmbeddingGemma (~308M on-device
embedder, developers.googleblog.com/en/introducing-embeddinggemma) runs in-browser via
Transformers.js with WebGPU (huggingface.co/docs/transformers.js/guides/webgpu).
**Consequences:** engine/AGENTS.md `ai/` scope; architecture.md NPC AI section and
forward-design constraints; plan.md M3 item; rough-edges.md pre-seeds the missing
Embedding API gap; P-007's "facts stay prompt-context" phrasing refined — facts stay out
of the *weights* and arrive via assembled context.
**Reopen if:** M3 evidence shows persona cards alone suffice at shipped scale (drop the
unused tiers, keep the interface), or a Chrome built-in Embedding API ships (re-evaluate
tier-3 embedder ownership — and update the rough-edges entry).

## D-032: Performance-first technology placement — JS is glue; wasm SIMD/threads baseline  (2026-07-13, accepted)
**Decision:** Per-subsystem language/technology placement is a performance decision made
on harness evidence, with no presumption that TypeScript is the default and wasm/WGSL the
exception. TS/JS is orchestration and glue; compute-heavy paths are presumed Rust→wasm or
WGSL compute until measurement says otherwise — and the reverse presumption is equally
banned: JS↔wasm boundary-crossing cost is real (wasm cannot call WebGPU/OPFS/web APIs
directly; every call bounces through JS glue), so "rewrite it in wasm" is also a claim
the harness must confirm. **Baseline machine/browser requirements:** wasm `simd128` and
threads (atomics + SAB) are required; engine wasm crates enable them unconditionally and
ship no scalar or single-threaded fallback paths. Relaxed-simd is baseline too **except
in crates that feed deterministic simulation state**: relaxed operations are
hardware-dependent by design (FMA contraction, lane-select and min/max edge cases differ
across x86/ARM), which is incompatible with D-016's cross-machine state-hash requirement
— authoritative-sim crates use plain simd128 only. Wasm's SIMD is fixed 128-bit — no
SSE/AVX passthrough, no 256/512-bit path — but what that ceiling costs is
machine-dependent (dev-01's x86 has AVX2-class width to lose; the Standard profile's
M1 Pro is itself 128-bit NEON), and "wider-than-128-bit work moves to WGSL compute" is a
working **hypothesis**, not a placement rule: the standing rough-edges item compares
native (AVX2/NEON), wasm simd128, and WGSL compute on a representative kernel per
reference machine before any rule is fixed. Rust stays the authored language for engine wasm
modules (determinism, D-014/D-020); consuming existing C/C++ libraries compiled to wasm
(e.g., Basis transcoder, meshoptimizer per D-006) is consistent with this.
**Context:** A project-level review against a "maximum performance on the web platform,
JS as glue" principle found the stance already de facto (D-004/D-005 chose Babylon for
AI-iteration speed and attribution, not JS purity; wasm hot paths and custom WGSL passes
were always planned) but nowhere explicit, leaving room for future agents to drift
JS-first out of web idiom. This entry makes the principle a citable rule.
**Sources checked (2026-07-13):** relaxed-simd standardized 2024, shipped in Chrome
(github.com/WebAssembly/relaxed-simd;
platform.uno/blog/the-state-of-webassembly-2025-2026); flexible-vectors (length-agnostic
wider SIMD) still stage-1 design (github.com/WebAssembly/flexible-vectors);
emscripten.org/docs/porting/simd.html (simd128 ↔ SSE/NEON-class mapping).
**Consequences:** engine/AGENTS.md Rust/WASM conventions gain the SIMD/threads baseline,
the no-fallback rule, and the deterministic-sim relaxed-simd carve-out; root AGENTS.md
stack constraint names the baseline; rough-edges.md pre-seeds the CPU SIMD-width-ceiling
measurement (native AVX2/NEON vs. wasm simd128 vs. WGSL compute, per reference machine).
**Reopen if:** flexible-vectors or another wider-SIMD path ships in Chrome (recalibrate
the CPU/GPU split), or measurements show boundary overhead systematically negating wasm
wins for a whole subsystem class (record the placement rule that replaces the
presumption).

## D-031: Harness smoke gates an exact external Chrome for Testing pin  (2026-07-12, accepted)
**Decision:** The first Harness v1 scenario is versioned as `smoke@1` and is driven by
exact-pinned `playwright-core`. Gate runs require `PARALLAX_CHROME_PATH` to name an
externally archived Chrome for Testing executable whose full version matches
`harness/chrome/stable.json` and whose executable SHA-256 matches the platform pin; the
runner never downloads a moving browser or silently falls back to installed branded
Chrome. Each of three repeat lineages starts with an
empty persistent profile and is relaunched once warm. Both launches exclude 10 seconds,
then record 120 recent render-worker frames. Worker animation-callback spacing is a
nearest-rank diagnostic, not a presentation-budget metric; true compositor
present-to-present timing stays mandatory and invalid until a validated probe exists,
and callback p95 variance above 10% makes that diagnostic invalid. The versioned
scenario, tier profiles, and single mandatory/incomplete metric registry live together
in `harness/src/runs/`.
As amended by D-034, the requested tier fixes a verified native-fullscreen display and
device-pixel render surface rather than a Playwright-emulated headed viewport. Reports are local ignored artifacts
and fail on measured budgets, browser errors, version mismatch, unverified gate identity,
or any other unfinished Harness-v1-mandatory probe.

**Context:** D-019 requires archived CfT rather than auto-updating branded Chrome, and
D-020 chose Playwright. Playwright's official browser documentation confirms that it
can drive branded Chrome and that browser channels differ from its default Chromium;
Chrome's official CfT documentation provides versioned downloads and JSON endpoints.
On 2026-07-12 the official last-known-good endpoint reported Stable 150.0.7871.115,
revision 1639810; that exact version was downloaded and locally verified before the
first run. The run produced stable callback-pacing evidence recorded as RE-001 and
exposed that callback timestamps cannot satisfy the presentation metric.

**Consequences:** Updating the pin is an explicit baseline-promotion action, not a
package update side effect. Machine-local browser archives stay outside git. Installed
branded Stable remains reserved for D-019 parity smoke work. The overall Harness v1
checkbox remains open until presentation, environment, Dawn/V8 cache, and pipeline
probes land; missing mandatory metrics are explicit invalid states rather than passing
by omission. Local-server metrics exclude their own endpoint and atomically publish
only completed-request deltas, so observation neither contaminates nor blocks a run.
Artifact, executable, tracked-diff, and untracked-file hashes stream rather than buffer
multi-GB inputs. This M0 driver-run window is not a D-025 benchmark result; M1 still moves
scenario boundaries, aggregation, and export in-game before exposing benchmark mode.

**Sources checked (2026-07-12):**
`playwright.dev/docs/browsers` and
`developer.chrome.com/blog/chrome-for-testing/`; the live pin came from
`googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json`.

**Reopen if:** CfT archives cannot reproduce branded Chrome behavior, external browser
bootstrap is too error-prone, or the smoke scene needs an in-app measurement window to
keep later D-025 manual and automated paths identical.

## D-030: Findings handback runs in fix-pass and verify-pass modes  (2026-07-12, accepted)
**Decision:** Two more kickoff prompts get encoded operating models in workflow.md,
completing the review loop started by D-026/D-027. Handing an agent review results or
findings ("here are the review findings — address them") invokes **fix-pass mode**: the
agent independently verifies each finding before acting (findings are claims per D-027,
not orders), fixes confirmed ones at root cause with docs-with-code and re-verification,
rebuts unconfirmed ones with concrete evidence, and ends with a self-contained
per-finding disposition report. Asking an agent to "verify the fixes" invokes
**verify-pass mode**: given the original findings and the fix agent's dispositions, the
agent verifies each fix against the working tree rather than trusting the report,
independently adjudicates each pushback, stays read-only by default (like reviewer
mode), and reports a per-finding verdict (fix verified / fix incomplete / pushback
accepted / pushback rejected).
**Context:** Same motivation as D-026/D-027 — the human was restating these two process
descriptions in every handback and fix-verification prompt. Encoding them makes the full
loop (review → fix or push back → verify) invocable with short prompts, and makes
independent re-verification the default at both steps instead of prompt-dependent.
**Consequences:** workflow.md gains "Findings handback: fix-pass mode" and
"Fix verification: verify-pass mode"; handback and verification prompts need no process
language; fix-pass agents are expected to push back rather than blindly apply findings.
**Reopen if:** the disposition/verdict categories prove too coarse in practice, or the
verify pass consistently finds nothing and becomes ceremony worth dropping.

## D-029: M0 in-app telemetry export surface  (2026-07-12, accepted)
**Decision:** Engine telemetry is exposed on the window as a non-writable
`globalThis.__PARALLAX_TELEMETRY__` object with a versioned snapshot/subscribe contract.
Schema v1 begins with render lifecycle state, initialization-to-first-frame time,
failure detail, engine/game version identity, total frame count, and a fixed 120-sample
recent-frame window; the render worker sends 60-frame batches so instrumentation does
not add per-frame main-thread messages. Initialization has two explicit phases: end-to-end worker startup
(immediately before construction through first frame, including module load/evaluation)
and worker-local initialization (start message through first frame). The harness
consumes only this public surface, never engine internals. Full result aggregation and
mandatory metrics remain Harness v1 scope.
**Context:** The walking skeleton introduces the first runtime subsystem, and project
rules require instrumentation and a harness-facing export from day one. A fixed sample
window prevents telemetry memory from growing during long runs while subscriptions let
the harness collect every batch during a measurement window.
**Consequences:** Changes to the global name or schema are versioned contract changes.
The app installs the export explicitly from the render service; the engine does not use
an implicit main-thread singleton.
**Reopen if:** CDP bindings or another measured transport proves more reliable without
making the harness depend on engine internals.

## D-028: M0 local artifact and serving contract  (2026-07-12, accepted)
**Decision:** The M0 build assembles a static `dist/` tree with an unhashed `index.html`
and all executable modules under `dist/immutable/`. Engine and game
package builds retain stable, independently loadable entry names; the assembler gives
their served copies SHA-256-derived names and connects them to the app with an import
map, so Vite cannot fold either boundary back into the app bundle. The version-controlled
local server lives in `harness/`, uses Node's HTTP implementation, applies
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to every response (including 304s), serves
content-addressed modules with a one-year immutable policy, and requires revalidation
for unhashed files. Strong SHA-256 ETags drive conditional requests using RFC 9110's
weak comparison, wildcard, and list semantics for `If-None-Match`; the static server
rejects unsupported methods. The generated
`build-manifest.json` records sorted paths, byte counts, and full SHA-256 digests for
the exact assembled artifacts. Served module filenames include the full SHA-256 digest.
The engine's separately built render-worker URL uses the build-time
`__RENDER_WORKER_ARTIFACT__` token: the assembler hashes and writes the worker first,
replaces that token in `engine.js` while retaining its `./` sibling-URL prefix, then
hashes the rewritten engine artifact. The build-contract test gates this two-sided
engine/assembler contract.
The local server caches validated ETag metadata across requests and exposes versioned
request/cache counters at `/__parallax/metrics`; conditional 304 responses therefore do
not reread or rehash unchanged artifacts.
**Context:** D-011 deliberately left the local serving-config location to M0. D-010
requires a real packaging boundary, not merely separate source directories, and the
harness must be able to identify exact bytes. Automated local tests on 2026-07-12
verified isolation/cache headers on 200 and 304 responses and the conditional-request
cases defined by RFC 9110 (`datatracker.ietf.org/doc/html/rfc9110`, checked 2026-07-12);
the assembled-build contract gate verified references and content digests, and a
same-host double build verified identical engine bytes. Dependency versions were checked against the npm
registry on 2026-07-12; Node 24's LTS status was checked against the official Node.js
release table (`nodejs.org/en/about/previous-releases`, checked 2026-07-12) the same
day.
**Consequences:** `pnpm start` is the local build-and-serve entry point, and `pnpm build`
includes the same-host engine repeatability gate. Production
nginx remains deferred to M2 per D-011/D-022, and `site/` remains untouched. The M0
repeatability gate covers engine artifact bytes; cross-host reproducibility remains the
later D-020 level-2 gate.
**Reopen if:** the local server diverges from production semantics, import maps prevent
a required cache/code-cache experiment, or the assembled artifact contract cannot
represent a new common/game-specific resource class without ambiguity.

## D-027: Review passes run in reviewer mode  (2026-07-12, accepted)
**Decision:** A kickoff prompt asking for a review of current changes ("review the
current changes") invokes the **reviewer operating model** in workflow.md: the unit
under review is the entire uncommitted working tree (diff against last commit plus
untracked files, including docs-moved-with-code); the reviewer is **read-only by
default** (the implementing agent owns fixes; the reviewer edits only when the human
says to fix directly); review scope covers correctness, AGENTS.md rule compliance,
missing decision/rough-edges entries, budget implications, and better-approach
suggestions clearly labeled as suggestions rather than defects; findings are verified
with cheap checks before being reported (root rule 3); and the report is written for
verbatim handback to the implementing agent — self-contained findings (file:line, what,
why, severity, suggested fix) phrased as claims to verify or rebut with evidence,
ranked most-severe first. A clean review is a valid result.
**Context:** Companion to D-026 — the human runs review passes from separate agent
sessions (workflow step 2) and was specifying the process in each prompt; encoding it
makes "review the current changes" sufficient. Read-only-by-default keeps the handback
loop clean: one agent's understanding of the change stays authoritative for fixes.
**Consequences:** workflow.md gains "Review passes: reviewer mode"; review kickoff
prompts need no process language; findings-as-verifiable-claims matches tech-lead
mode's duty to address or rebut every finding.
**Reopen if:** the handback loop proves slower than reviewers fixing in place — then
define when a reviewer may fix directly (and how the implementing agent is informed).

## D-026: Milestone work runs in tech-lead mode  (2026-07-12, accepted)
**Decision:** A kickoff prompt naming a milestone ("start work on M0") invokes the
**tech-lead operating model** defined in workflow.md: the lead agent scopes a
commit-sized slice from plan.md in dependency order; delegates well-scoped pieces to
subagents with per-task model/reasoning-effort choices; serializes writing subagents
(shared working tree) while parallelizing read-only work; owns acceptance with evidence
(runs the checks itself — subagent success reports are assertions, not measurements);
retains the cross-cutting duties (decision log, rough-edges, docs-with-code, budgets)
regardless of delegation; and, once it believes the slice complete, spawns a
fresh-context **adversarial reviewer** over the full working-tree diff briefed to find
problems, addressing findings before handoff.
**Context:** The human was pasting this operating model into every milestone kickoff
prompt; encoding it in workflow.md (universally required reading, D-023) reduces the
prompt to naming the milestone and makes the collaboration contract reviewable and
evolvable like everything else.
**Consequences:** workflow.md gains the "Milestone work: tech-lead mode" section;
kickoff prompts need no process language.
**Reopen if:** orchestration tooling changes materially (e.g., per-subagent isolated
worktrees become standard, relaxing the serial-writers rule).

## D-025: In-game benchmark mode is a public front end to the harness  (2026-07-12, accepted)
**Decision:** Parallax ships a benchmark mode that runs the same versioned,
deterministic scenarios and consumes the same telemetry/result schema as the automated
harness. It is launched and run **entirely in-game**: scenario control, warm-up,
repeats, measurement-window boundaries, metric collection, aggregation, environment
capture, and result export require no external automation. It provides fixed
quality/resolution controls, seed and camera/input path, warm-up and repeat policy, and
exports both machine-readable JSON and a human-readable summary. Results identify the
exact game artifact, scenario, browser/engine version, OS, GPU/driver, display/power
state, and metric support. It reports distributions and phase timings, not a synthetic
single score. External automation may navigate to or start benchmark mode and collect
the finished artifact for CI, but stays outside the measured path; a manually launched
run is equally valid under the same eligibility rules. The mode is usable in other
browsers for engine comparisons, but Chrome on the reference machines remains the only
budget gate; non-Chrome runs are advisory. Benchmark mode adds no compatibility paths:
an unchanged build either runs, marks individual metrics `unsupported`, or produces a
capability-failure result identifying the missing surface.
**Context:** The harness is already an independently useful deliverable and the game
already needs deterministic flythroughs, stable telemetry, environment identity, and
repeat/variance rules. Exposing those through the game makes Parallax useful for
comparing browser engines and hardware without building a second measurement system.
A single score would conceal whether a difference came from presentation pacing, CPU,
GPU, streaming, compilation, or unsupported observability, undermining the project's
attribution goal. Cross-browser measurement is not cross-browser support (D-002).
**Consequences:** the M0 result contract stays browser-engine-neutral even though the
automation initially drives Chrome; its schema includes provenance distinguishing
in-game measurements from optional launcher/collector timings. M1 exposes the canonical
D1 flythrough as a self-contained in-game benchmark; later canonical scenarios join it
as they land. Public results are comparable only when artifact, scenario, settings, and
environment fields match, and unsupported metrics remain visible rather than being
imputed.
**Reopen if:** the in-game runner cannot reproduce harness scenario semantics closely
enough to compare results; keep the export/telemetry UI but label manual runs separately.

## D-024: Uninstall joins the lifecycle — confirmed, dual-mechanism, measured  (2026-07-12, accepted)
**Decision:** The install/launch/run/update lifecycle gains a fifth stage, **uninstall**,
in scope for M2. The app shell (D-012) offers user-initiated uninstall behind an
**explicit confirmation** that states what will be deleted (installed assets, caches,
service worker, saves) and offers save export first (architecture.md's
export-before-destructive-storage-op rule). Two mechanisms are built and measured
against each other: (1) **client-side teardown** — service-worker unregister, OPFS
clear, Cache Storage + IndexedDB deletion, quota-release verification via
`navigator.storage.estimate()`; (2) a **`Clear-Site-Data` endpoint** — a static nginx
location (`/uninstall`) attaching `Clear-Site-Data: "storage", "cache"`, within D-011's
static-serving preference. Actual coverage of each is a measurement, not an assumption:
does `"storage"` clear OPFS; does `"cache"` clear the V8 code cache and GPU/shader
caches (which would also make the endpoint a useful harness "reset origin to cold"
primitive); asymmetries go to rough-edges.md. The Gemini Nano model is Chrome-managed
and browser-wide, not origin storage (D-017): uninstall does not remove it, and the
confirmation UX must not imply it does.
**Context:** A native-title lifecycle demo is incomplete if the only removal path is
digging through browser settings. Checked 2026-07-12 (MDN Clear-Site-Data reference;
web.dev OPFS article): MDN lists `"storage"` as clearing DOM storage incl. IndexedDB
and service-worker registrations — OPFS not explicitly named — and `"cache"` as
clearing cached data incl. script and shader caches; web.dev states OPFS is deleted
when site data is cleared. That documentation gap is itself why coverage gets measured
locally (root rules 3/10) rather than trusted.
**Consequences:** architecture.md lifecycle stage 5; plan.md M2 uninstall item;
features.md install-lifecycle row includes uninstall; harness gains an
uninstall-verification check (storage actually released).
**Reopen if:** measurement shows one mechanism strictly dominates — collapse to it then
and record the numbers.

## D-023: Context-lean doc policy — on-demand doc map, scan-first logs, decision culling  (2026-07-12, accepted)
**Decision:** Agent context is managed pull-based, not push-based. (1) Root AGENTS.md's
"required reading" mandate (vision + architecture + workflow before any non-trivial
work) is replaced by a **doc map**: workflow.md stays universally required (~30 lines);
every other doc is read on demand, routed by a one-line "read when the task needs"
description. (2) decisions.md and rough-edges.md are **scan-first** documents: grep or
scan headings, read only relevant entries; full reads reserved for structural or
cross-cutting work. (3) decisions.md drops strict append-only in favor of **periodic
culling**: superseded or moot entries that no longer inform anything current are
deleted; git history is the archive; D-numbers are never reused. (4) New root rule 9:
root AGENTS.md is the only always-loaded file, so it stays lean — detail belongs in
docs/ behind the map.
**Context:** Every conversation pays for what's mandated up front. The old blanket
mandate cost ~300 lines/~23 KB per task, mostly unread-in-anger; decisions.md (400+
lines, growing weekly) made "read it before structural changes" increasingly expensive.
**Consequences:** Root AGENTS.md restructured (doc map section, new rule 9, later rules
renumbered — the technology-claims rule is now rule 10); decisions.md header documents
the reading and culling policy; architecture.md's "required reading for every agent"
self-description softened to match.
**Reopen if:** on-demand reading measurably causes agents to miss constraints they'd
have caught under mandatory reading — tighten the map's routing lines first, the
mandate only as a last resort.

## D-022: Publish script retired; placeholder landing page frozen as published  (2026-07-12, accepted; amends D-021)
**Decision:** The machine-local `publish.ps1` from D-021 is deleted (along with the
`.gitignore` whose only entry it was). The static landing page was published once to
parallax-web.com (2026-07-12) and is intentionally **frozen** — it will not be updated
(not even milestone status) between now and M2. `site/` stays in the repo as the
versioned source of what is live. When M2's harness-owned production deployment lands
(D-011), the game's own landing page replaces the placeholder, and the harness pipeline
becomes the origin's only publish path — no separate site-publishing mechanism returns.
Should the placeholder need an emergency fix before then (broken link), that's an ad-hoc
manual `scp` to `/var/www/parallax-web.com`, acceptable at its expected frequency of
approximately zero.
**Context:** Maintaining a machine-specific deploy script for a page that will never
change is upkeep with no benefit, and keeping it invited scope creep (publishing
in-progress game builds through it, which would bypass the versioned, measured deploy
path the M2 research requires — deploying the game *is* the experiment, so it must go
through the harness).
**Consequences:** `publish.ps1` and `.gitignore` deleted; plan.md M0 item reworded.
D-021's publish-script provisions no longer apply; its `site/` placement and
distinct-from-`app/` framing stand.
**Reopen if:** the placeholder turns out to need recurring updates before M2 exists.

## D-021: Public landing page in top-level `site/`; machine-local publish script  (2026-07-12, accepted; publish-script provisions amended by D-022)
**Decision:** The project gets a public face in M0: a static landing page (what Parallax
is + a link to the GitHub repo, https://github.com/pmeenan/parallax) living in a new
top-level `site/` directory. `site/` carries project-facing web content only — plain
static HTML/CSS with no build step, no engine or game code — and is distinct from the
app shell (`app/`, D-012), which is the installer/boot/launch entry point of the game
itself. Publishing to production (`/var/www/parallax-web.com` over SSH per D-011
hosting) is done by a machine-local `publish.ps1` at the repo root that copies `site/`
via OpenSSH `scp` (key-based auth through a local `parallax` SSH host alias). The script
is **gitignored**: it encodes one machine's SSH configuration, not project
infrastructure. It is an explicit stopgap — when M2's production-deployment work lands
(versioned nginx config, harness-driven deploys, D-011), site publishing folds into that
pipeline.
**Context:** A public description of the project is wanted before M2's production
serving exists. `scp` over the Windows built-in OpenSSH client was chosen over
WSL-hosted `rsync` to avoid a WSL dependency for a copy of a handful of static files
(verified working against the server on 2026-07-12).
**Consequences:** Root AGENTS.md layout table gains `site/`; plan.md M0 gains a
landing-page item; `.gitignore` created with `publish.ps1`. The landing page is
plain static content — the header discipline / COOP-COEP requirements of D-011 apply to
the game's serving, and are unaffected by it.
**Reopen if:** the site needs a build step or more than a few pages, or when the M2
deployment pipeline exists — supersede with a unified publish path then.

## D-020: Toolchain refinements — Rollup, exact pins, reproducibility levels  (2026-07-11, accepted; supersedes D-014)
**Decision:** As D-014, with three refinements. (1) The engine library bundler is
**Rollup** (chosen over esbuild for deterministic, timestamp-free output; exact version
pinned in the lockfile). (2) Pinning is by **exact version** everywhere (`.nvmrc` +
`packageManager` — "LTS" is a policy, the pin is a version); builds normalize locale,
timezone, and path inputs. (3) Playwright drives the pinned Chrome for Testing binary
for gate runs and `channel: 'chrome'` (installed branded stable) for parity smokes —
see D-019. **Reproducibility levels (ties to D-010):** (1) *repeatable* — same-host
double-build hash check, required from M0; (2) *reproducible* — cross-host
bit-identical builds (dev-01 ↔ mac-01), required before the M8 COS exercise, likely
needing a hermetic/containerized build definition; (3) *canonical* — published engine
artifacts that platform publishers consume rather than rebuild, the end-state COS
actually needs (hash-sharing works even if independent rebuilds don't match, because
nobody rebuilds). Level 3 is the fallback if level 2 proves impractical.
**Context:** Review found D-014 left the bundler ambiguous and "repeatable vs.
reproducible vs. canonical" undefined, which D-010's cross-publisher hash-sharing goal
requires.
**Consequences:** M0 scaffolds to this shape; D-010's hash check targets the Rollup
engine artifact.
**Reopen if:** any component proves inadequate in practice — supersede, don't drift.

## D-019: Chrome pinning mechanism — Chrome for Testing archives  (2026-07-11, accepted; supersedes D-013)
**Decision:** As D-013 (stable-only targeting; Canary solely for Chrome-side changes,
always labeled), with the operational mechanism defined: reproducible runs (budget
gates, cross-machine determinism, baselines) use archived **Chrome for Testing**
binaries pinned to the current stable milestone — versioned, non-auto-updating,
retained per platform so any past result can be re-run. A periodic parity smoke run on
the real installed stable channel guards against CfT-vs-branded divergence (any
divergence found is a finding). **"Same version" across platforms** means same
milestone + V8 revision — platform build/patch numbers may legitimately differ.
**Context:** D-013's "pinned per run" was aspirational: installed branded stable
auto-updates independently and cannot serve reproducible baselines or the M3
cross-machine determinism criterion.
**Consequences:** harness/AGENTS.md rule 1 and machines/README.md updated; budgets.md
baseline-promotion policy operates on CfT milestone advances.
**Reopen if:** a committed feature needs an API that hasn't reached stable, or CfT
proves behaviorally divergent from branded stable in a way that matters to findings.

## D-018: Hardware gates — capable-consumer baseline; Showcase calibrated to dev-01; Standard gate is a target profile  (2026-07-11, accepted; supersedes D-009's hardware/tier provisions)
**Decision:** D-009's install-scale provisions stand unchanged (≤ 12 GB experiment
content; ≥ 100 GB architecture floor, not ceiling; synthetic scale tests). Its hardware
and tier provisions are replaced:
- Hardware baseline is **capable consumer hardware** (not "gaming rig"); low-end and
  mobile stay out of scope.
- **Showcase** — 4K, gated on and **calibrated to dev-01 itself** (i9-14900KF, 128 GB,
  RTX 4080 Super 16 GB, 4K @ 60 Hz display, Chrome/D3D12). The abstract 16 GB RAM /
  12 GB GPU reference machine is retired: envelope enforcement on dissimilar hardware
  cannot prove transfer, and the transfer story belongs to the Standard tier. Showcase
  envelopes: GPU ≤ 14 GB, CPU-side ≤ 16 GB — provisional ceilings, rebalanceable within
  the envelope by decision-log note. (These ceilings do not by themselves exercise
  wasm64 — memory64 adoption remains P-001, proven only by a dedicated harness run in
  which a single module addresses beyond 4 GiB.)
- **Standard** — 1440p @ 120 Hz, defined by the **standard-target profile**: M1 Pro
  MacBook Pro (2021), 16 GB unified memory, ProMotion. This is a *profile, not a pinned
  machine*: it registers as `standard-01` only when the physical unit is recorded with
  exact model/size, GPU-core configuration, display mode with verified 120 Hz behavior
  under Chrome, and OS build. Until then Standard runs execute on dev-01 with envelope
  enforcement, labeled provisional, and satisfy no Standard-tier exit criteria.
- The two gates intentionally span Dawn's Metal and D3D12 backends. Quota reality
  (correcting D-009): a Chromium origin may use up to ~60% of **total** disk size, and
  `estimate()` can over-report writable space — preflight is best-effort; the guarantee
  is `QuotaExceededError`-aware incremental writing with resume.
**Context:** Review rounds found D-009's 16/12 reference contradicted by dev-01's
actual hardware, the free-disk quota claim wrong against current docs, and the Standard
machine underspecified.
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (total-disk quota, `estimate()` caveats); user-confirmed machine facts
(dev-01 display 4K @ 60 Hz; Standard profile M1 Pro/120 Hz).
**Consequences:** budgets.md hardware-baseline, quality-tier, frame-gate (per-tier,
refresh-quantized), and memory-envelope sections; harness/machines/README.md.
**Reopen if:** a physical Standard machine is registered (records specs, no new entry
needed); or a mid-range Windows rig joins the fleet and a transfer-focused Showcase
variant becomes worth gating.

## D-017: Prompt API operational model — window broker, activation-correct download, authored fallback  (2026-07-11, accepted; supersedes D-007)
**Decision:** As D-007 (Prompt API for NPC dialog; schema-gated state effects), with
the operational model corrected against current platform behavior:
- The Prompt API is **not available in Web Workers**, so inference runs as a
  **window-owned broker** behind a worker-shaped `engine/ai` interface (migrates when
  worker support lands); broker main-thread impact is a mandatory harness metric.
- Model download starts **directly in the install-button click handler** —
  `LanguageModel.create()` is called within the transient-activation window and
  downloads in parallel with the asset pull (transient activation expires in seconds;
  it does not survive a multi-GB install). Model size varies by version — never
  hardcoded; download requires ~22 GB free on the profile volume.
- **Eviction policy:** Chrome may evict the model under storage pressure. Every NPC
  carries authored fallback dialog; the game stays fully playable offline with reduced
  conversational depth; restoring the model **requires a fresh user gesture** (the
  launch screen offers a "restore AI dialog" action when online — it cannot be
  automatic); evictions are logged as findings.
**Context:** D-007 assumed an `ai worker`, a fixed ~4.3 GB model, and
activation-at-install-time — all contradicted by current documentation and
transient-activation semantics.
**Sources checked (2026-07-11, Chrome 150 era):** developer.chrome.com/docs/ai/prompt-api
(worker unavailability, user activation, 22 GB requirement, variable model size); MDN
transient-activation semantics. M0 spike re-verifies locally.
**Consequences:** no `ai worker` in the topology; fallback lines are part of every
persona card from M3; quest-critical interactions never require the model.
**Reopen if:** worker support lands (move the broker; new entry), quality is unusable
for even constrained NPC dialog, or session limits make per-NPC state impractical
(either outcome is itself a finding).

## D-016: Multiplayer infrastructure and determinism scope  (2026-07-11, accepted)
**Decision:** M7 multiplayer means **reliable internet co-play**: self-hosted signaling
on the D-011 host and STUN are permitted; TURN relay is permitted if measured direct-
connectivity failure rates warrant it. "Serverless" in project language means **no
game-simulation servers** — peers run the sim; infrastructure is limited to connection
establishment/relay. **Determinism scope:** cross-machine within a pinned Chrome
version — same command log ⇒ same state hash across OS/CPU (dev-01 Windows ↔ mac-01
macOS), verified by the harness from M3. Chrome-only helps: one engine (V8), one wasm
runtime; the sim additionally avoids known nondeterminism sources (unseeded RNG,
wall-clock, iteration-order, NaN-bit-pattern-sensitive wasm paths).
**Context:** Real-world WebRTC requires signaling and frequently TURN
(webrtc.org/getting-started/turn-server, checked 2026-07-11); a single-host determinism
check says nothing about cross-peer lockstep suitability.
**Consequences:** features.md multiplayer wording qualified; M3 determinism exit
criterion is cross-machine; offline single-player continues to require zero server
infrastructure.
**Reopen if:** cross-machine determinism proves unachievable at reasonable cost (then
choose rollback/authoritative-state sync over lockstep at M7 — log the evidence).

## D-015: Service worker owns the offline app shell  (2026-07-11, accepted)
**Decision:** A service worker precaches the app shell and serves navigations offline,
with atomic activation + rollback and boot-time version-compatibility checks
(shell/engine/manifest/save schema). Cached navigation responses must preserve
COOP/COEP (verified by harness) or SAB dies offline.
**Context:** The HTTP cache alone does not guarantee offline navigation — eviction is
permitted and navigation needs a controlled response source
(web.dev/articles/service-worker-caching-and-http-caching, checked 2026-07-11). The
offline-launch budget was unimplementable without this.
**Consequences:** SW lifecycle in architecture.md; M2 offline fault suite (offline hard
reload, restart, corrupt cache, interrupted update, disk-full); SW-vs-V8-code-cache
interplay pre-seeded as a rough-edges question (wasm/JS should stay HTTP-cache-served
for code-cache friendliness where possible — measure, don't assume).
**Reopen if:** SW-served responses measurably break V8 code caching for the shell and
no split-serving arrangement resolves it (that's a headline finding).

## D-014: Toolchain  (2026-07-11, superseded by D-020)
**Decision:** pnpm workspaces monorepo (`app`, `engine`, `game`, `harness` packages);
TypeScript strict with project references (references enforce the layer import
direction at compile time); Vite for dev server/HMR and app/game builds; the engine
bundle built as a separately versioned library artifact (Rollup or esbuild) as the
target of D-010's double-build hash check; Node LTS + pnpm pinned (`packageManager`
field + `.nvmrc`); Rust pinned via `rust-toolchain.toml` with wasm-bindgen, pinned
binaryen/wasm-opt, and `--remap-path-prefix`; Vitest for unit tests; Playwright
(`channel: 'chrome'` — drives installed stable Chrome per D-013) as the harness browser
driver with raw CDP as the escape hatch; Biome for lint+format.
**Context:** Determinism (D-010) and agent iteration speed drive every pick.
**Consequences:** M0 scaffolds to this shape.
**Reopen if:** any component proves inadequate in practice — swaps are expected to be
cheap early; supersede with a new entry, don't drift silently.

## D-013: Harness targets Chrome stable; Canary only for Chrome-side changes  (2026-07-11, superseded by D-019)
**Decision:** All harness runs and budgets target **Chrome stable** (pinned per run,
recorded in results). Canary/dev channels are permitted only when testing Chrome-side
changes (e.g., COS work), always labeled as such and never mixed into stable baselines.
**Context:** Nothing in the current feature matrix requires pre-stable APIs; stable
keeps findings maximally credible/reportable.
**Reopen if:** a committed feature needs an API that hasn't reached stable.

## D-012: App shell lives in top-level `app/`  (2026-07-11, accepted)
**Decision:** The installer/boot/launch shell is a top-level `app/` package — the entry
point that drives install/update UX and boots the engine + game. It imports `engine/`
services (storage, install, telemetry) and may use branded assets from the asset
library, but contains **no gameplay logic or game rules**.
**Context:** The shell is the core loader, not part of the game; it also carries the
lifecycle UX that M2's research lives in, so it deserves first-class structure. Using
game-branded visuals doesn't make it game logic — assets come from the library like any
consumer.
**Consequences:** root AGENTS.md layout table; layer rules extended: `app/` may import
`engine/` (and game manifest/branding data), never `game/` sim internals.

## D-011: Deployment — parallax-web.com on self-controlled nginx; local-first dev  (2026-07-11, accepted)
**Decision:** Production origin is **https://parallax-web.com**, served from
user-controlled hosting (nginx, direct SSH). Additional owned domains are available for
cross-origin work when needed (M8 COS exercise, multi-origin probes). Development runs
fully local against a real local server (never `file://`), with the same header
discipline (COOP/COEP, immutable caching, 304 behavior) as production. Static/
client-side is strongly preferred; the server may exceed static hosting only when a
finding requires it (e.g., signaling for M7), logged here when it happens. Serving
config (nginx + local dev server headers) is versioned in the repo (location settled in
M0). Cloudflare is available but stays **out of the path for cache experiments** unless
it is itself the subject — an intermediary cache would contaminate 304/code-cache
findings.
**Context:** M2's cache research is only credible against real serving infrastructure;
the harness needs both local and production targets.
**Consequences:** M0 builds the local server + header discipline; production serving
lands before M2 cache work; harness runs record which target they measured.
**Reopen if:** hosting constraints prevent required header/protocol control.

## D-010: COS-ready packaging — common/game split, deterministic versioned engine builds  (2026-07-11, accepted)
**Decision:** The isolation model for the north-star platform is **cross-origin
isolation with sharing via Cross-Origin Storage (COS)**: each published game is its own
origin; engine code, shared asset packs, AI models, and (as the platform work matures)
code/Dawn caches are shared across origins by content hash. COS APIs don't exist yet, so
Parallax builds **COS-ready now**:
1. All packaged resources are split into **common** (engine code, shared asset packs,
   kits) and **game-specific** (world data, game logic, unique assets) — separate
   bundles, separately addressed in the manifest — so the common set can move to a
   hash-based COS index without repackaging.
2. **Engine builds are deterministic and versioned:** same source + toolchain ⇒
   byte-identical artifacts (pinned toolchain, no embedded timestamps/build paths,
   stable chunking/minification), because hash-based sharing only works if two
   publishers building the same engine version produce the same bytes. Engine artifacts
   carry explicit versions and never mix game code (the existing layer boundary, now
   also a packaging boundary).
**Context:** User's Chrome-side COS work targets exactly this sharing (including code
caches). Parallax is the realistic consumer that proves the packaging discipline and
quantifies the win.
**Consequences:** Build pipeline emits engine and game bundles separately (M0);
manifest schema distinguishes common vs. game-specific from day one (M2); engine/
AGENTS.md build-determinism rules; the other platform-of-games probes (multi-game quota
contention, instant-play, origin-model comparison) are **dropped from scope** — the
origin model is decided by this entry, and the rest isn't needed for this exploration.
**Reopen if:** COS's shipped shape diverges from hash-based content addressing, or
deterministic builds prove impractical for some artifact class (log why — that's a
finding about the sharing model's feasibility).

## D-009: Install scale — 12 GB content, ≥100 GB architecture floor; gaming-rig baseline; 4K showcase tier  (2026-07-11, superseded by D-018)
**Decision:** The two-district experiment ships ≤ 12 GB of content, but every lifecycle
system (manifest, resumable install, integrity, update, streaming/eviction) must support
**at least** 50–100 GB installs — a floor, not a ceiling; no architectural limit may
exist short of disk/OPFS quota. Verified by a synthetic-asset scale test in the harness
(M2), grown until it finds a platform limit or proves there isn't one. Hardware baseline
is a **gaming rig** — low-end devices are out of scope for this experiment (hardware is
an evolving target; the question is what the platform supports given sufficient
hardware). Rendering budgets are tiered: Standard (1440p, gaming-rig baseline) and
Showcase (4K photorealistic, high-end rig), each independently held to frame budgets.
Showcase reference machine: **16 GB system RAM, 12 GB GPU**; showcase memory budgets are
envelope-based (CPU-side ≤ 9 GB, GPU ≤ 10 GB, with OS/browser/compositor headroom
reserved), and the category split inside an envelope may be rebalanced as measurements
come in, with a decision-log note.
**Context:** The project must demonstrate that the web can host super-detailed,
photoreal titles at real AAA-and-beyond install sizes, not just that a 12 GB demo fits.
Testing scale synthetically decouples the architecture proof from content production.
**Consequences:** budgets.md hardware-baseline, quality-tier, and scale-test sections;
pre-install quota check and failure UX designed for ≥100 GB against OPFS's
~60%-of-free-disk quota; per-tier harness runs on both reference machines; memory
budgets in budgets.md are calibrated to the gaming-rig baseline, not lowest-common
hardware.
**Reopen if:** OPFS quota or install-time realities cap installs below ~100 GB on a
gaming rig (that outcome is itself a headline rough-edges finding).

## D-008: Two districts, surface + underground, designed for N  (2026-07-11, accepted)
**Decision:** World ships with District 1 (surface) and District 2 (underground),
connected by choke-point hard transitions. All world/streaming/save code treats district
count and topology as data.
**Context:** Two districts are the minimum to exercise inter-district streaming, which
fundamentally shapes asset packaging and the streaming manager. Underground as D2 gives a
natural full-occlusion boundary — the hardest streaming case (total resident-set swap)
without requiring horizon-scale streaming first.
**Consequences:** Transition contract in budgets.md; D2 exercised in greybox (M4) before
any art exists for it.
**Reopen if:** never for the design-for-N property; district count/theme may change freely.

## D-007: NPC dialog via Chrome built-in Prompt API (on-device Gemini Nano)  (2026-07-11, superseded by D-017)
**Decision:** NPC conversation uses Chrome's Prompt API; model download is an
install-phase step. Structured-output JSON schemas gate anything that affects game state.
**Context:** Shipped in Chrome 148 for web pages. The ~4.3 GB model download is
disqualifying for normal sites but folds naturally into our install model — and it is
exactly the kind of capability this demo exists to showcase.
**Consequences:** `ai worker` in the topology; inference/render contention is a standing
measurement target; NPC design must tolerate nano-class model quality.
**Reopen if:** quality is unusable for even constrained NPC dialog, or the API's session
limits make per-NPC state impractical (either outcome is itself a finding).

## D-006: Asset formats — glTF/GLB, KTX2 (BasisU), meshopt; content-addressed per-cell bundles  (2026-07-11, accepted)
**Decision:** As stated. Packaging is per streaming cell with shared kits deduplicated.
**Context:** Native Babylon.js support, GPU-friendly transcode in workers, and
content-addressing enables asset-only updates that never touch code caches.
**Reopen if:** harness shows decode/transcode dominating cell-load p95.

## D-005: Multithreading via explicit worker topology (SAB + OffscreenCanvas + WebGPU-in-worker)  (2026-07-11, accepted)
**Decision:** Parallax designs its own thread architecture (see architecture.md) rather
than inheriting an engine's. Rust→WASM modules (with wasm threads) for compute-heavy
paths.
**Context:** No popular engine ships real multithreading on the web today; on this
platform, threading is an application architecture. Owning the topology is also where
much of the platform research lives.
**Sources checked (2026-07-11):** Unity web technical limitations (docs.unity3d.com —
no managed C# threads on web), Bevy wasm multithreading tracking issue
(github.com/bevyengine/bevy/issues/4078), Godot web export docs; M0 spikes re-verify
WebGPU-in-worker and SAB channels locally.
**Consequences:** COOP/COEP required everywhere, including the harness's serving
infrastructure; every queue/boundary instrumented.
**Reopen if:** WebGPU-in-worker or Babylon-in-worker spikes (M0) fail — fallback is
render on main thread with everything else in workers, logged as a major finding.

## D-004: Engine — TypeScript + Babylon.js (WebGPU only); not Unity, Godot, Bevy, or from-scratch  (2026-07-11, accepted)
**Decision:** Babylon.js as scene/material/animation core; Parallax owns scheduling,
streaming, memory, and the worker fabric. WebGPU backend exclusively — no WebGL2 path.
**Context:** Unity's web export blocks the project's core needs (no C# threads on web,
experimental WebGPU backend, unconfirmed wasm64) and hides the platform behind an opaque
layer, breaking finding-attribution. Godot/Bevy web paths are experimental or
single-threaded (as of 2026-07). Babylon has years-mature WebGPU support, is fully
inspectable, and is the strongest AI-agent target (TypeScript, instant iteration, no
editor round-trips). From-scratch rejected: scene graph/materials/animation/glTF are
solved problems that don't advance either goal.
**Sources checked (2026-07-11):** Unity WebGPU manual (experimental status), Unity web
technical limitations, Godot 4.7 web export status (WebGPU experimental behind flag),
Bevy WebGPU/wasm-threading issues, Babylon.js WebGPU support docs
(doc.babylonjs.com/setup/support/webGPU).
**Consequences:** We hand-build LOD, occlusion/culling, and world partitioning — accepted
because those systems had to be browser-custom anyway and building them *is* the
research. Where Babylon blocks a WebGPU feature: fork locally or bypass, and log the gap.
**Reopen if:** Babylon proves unable to run in a worker or blocks required WebGPU
features at a structural level; Bevy becomes interesting if/when wasm multithreading
lands there.

## D-003: Install/launch/run lifecycle; OPFS as primary asset store  (2026-07-11, accepted)
**Decision:** The game is an installed application: user-initiated multi-GB install into
OPFS, offline-capable, warm-launch optimized. Storage map in architecture.md; placement
is benchmark-driven per asset class.
**Context:** Origin ideation (docs/history/); OPFS gives worker-side sync access handles
and quota headroom for multi-GB installs.
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (~60% of total disk per origin; `estimate()` caveats; `persist()` semantics
— protects the origin, not specific files). Offline shell requires a service worker on
top of this — see D-015. M0 OPFS throughput spike verifies read performance locally.
**Reopen if:** harness shows a better-performing store for a given asset class (move it,
log numbers here).

## D-002: Chrome-only, latest stable or newer; no fallbacks  (2026-07-11, accepted)
**Decision:** Target the newest Chrome (including Canary/Origin-Trial features when
needed). No Firefox/Safari support, no WebGL2 fallback, no compat shims. Missing API =
logged finding, not a workaround.
**Context:** The project is partly a Chrome capabilities demo and rough-edges probe;
compatibility layers would blur attribution and cap the ceiling.
**Reopen if:** project goals change to include distribution beyond the demo audience.

## D-001: Working name "Parallax"  (2026-07-11, accepted)
**Decision:** Project/repo name is Parallax.
**Context:** docs/history/name_history.md. Known minor collisions (a Skyrim texture mod,
a small portfolio site) judged negligible.

---

## Proposed / open

*(Move to accepted with a date when resolved; spikes in plan.md M0 feed these.)*

- **P-001: wasm64 (memory64) adoption per module** — which Rust modules, if any, justify
  the pointer-width overhead for >4 GB address space. Decide after M0 spike + M1 memory
  data. Note: aggregate memory budgets prove nothing about memory64 (multiple memory32
  modules can sum past 4 GB); the actual exercise is a dedicated harness run in which a
  single module addresses data beyond 4 GiB. **Compatibility gate:** adopting memory64
  currently makes that module unloadable in Safari (MDN browser-compat-data
  `webassembly/memory64`, checked 2026-07-12:
  github.com/mdn/browser-compat-data/blob/main/webassembly/memory64.json — Chrome 133+,
  Firefox 134+, Safari false).
  Therefore memory64 is a last resort: adopt it only when measurements show an
  unavoidable single-module >4 GiB requirement and memory32 alternatives (partitioning
  data/modules, streaming, or reducing the resident set) cannot meet the same requirement
  within budget. Record that evidence when resolving P-001.
- **P-002: Geometry representation & rendering-scale strategy** — comparative
  exploration of (a) classic triangle LOD chains, (b) meshlet-based virtualized geometry
  (nanite-like: GPU-driven culling, visibility buffer, WGSL compute), and (c) 3D Gaussian
  splats, including hybrids (e.g., splat environments + triangle interactives — splats
  are weak on dynamic relighting, collision, and animation; triangles stay for anything
  interactive). Includes the original question of GPU-driven culling/instancing and
  whether Babylon's frame graph accommodates it or needs bypass. Evaluation axes: frame
  budget at both quality tiers, streaming/storage cost per visual quality (splats are
  storage-heavy — interacts with D-009 scale), asset-pipeline fit (AI generation
  produces meshes; splats come from capture/reconstruction), and WebGPU compute limits.
  M1 runs the comparative spike on representative content; M5 commits per content class.
  The splat branch also gates the scan-your-world UGC feature (features.md).
- **P-003: Multiplayer topology** — pure P2P mesh vs. host-authoritative peer for the
  M7 exploration. Decide when M3 determinism results are in.
- **P-004: Binary asset storage** — git LFS vs. external content store + manifest for
  `assets/source/` and `assets/library/`. Decide when the first real (non-greybox)
  assets exist (M5 at the latest).
- **P-006: Storage Buckets for saves vs. assets** — whether separating critical saves
  from replaceable assets into distinct buckets (with different eviction/durability
  characteristics) buys real protection beyond origin `persist()`, or is complexity
  without benefit. Decide during M2 with measurements; interim protection is origin
  persistence + explicit save export (architecture.md).
- **P-007: App-owned in-browser NPC model vs. Prompt API** — challenger to D-017, which
  stays authoritative until there is spike evidence. Hypothesis: a small open-weight
  model running on WebGPU under the app's control beats browser-managed Gemini Nano for
  this game's NPC dialog on some combination of: **placement** (WebLLM-class engines run
  in a Web Worker; the Prompt API is window-only per D-017 — this would retire the
  main-thread broker exception), **lifecycle** (the model becomes a normal hash-verified
  OPFS install artifact under our install/update/uninstall contract instead of a
  Chrome-managed, silently-evictable blob — retiring most of D-017's eviction machinery),
  **contention attributability** (inference runs on the same physical GPU under app
  control — but note current WebLLM-class engines create their own logical WebGPU device
  internally, and same GPU ≠ same device/queue, so **device topology — own device vs.
  shared render device — is an explicit phase-A spike variable**, and true shared-device
  scheduling may require integration or fork work, to be scoped by the spike), and — with
  fine-tuning — **persona/format quality**. Two phases, cheapest risk first:
  **(A)** M0 spike: off-the-shelf small open-weight model (~1–4B, Q4) via in-browser
  WebGPU inference in a worker against the walking skeleton, measured on a fixed
  NPC-dialog prompt fixture set head-to-head with the Prompt API spike: first-token
  latency p95 against the budgets.md dialog budget, tokens/s, frame impact during
  generation, VRAM, OPFS model-load time, structured-output/schema compliance,
  context-window behavior at persona+retrieved-context sizes, baseline dialog quality,
  and model/install size — throughput alone does not pass the spike. **(B)** only if A
  is viable: LoRA-tune for voice, dialog format, and schema compliance, and compare
  constrained-dialog quality. Scope note:
  fine-tuning reliably shifts style/format, not factual knowledge — retrieval/context
  beats fine-tuning for facts (arxiv.org/pdf/2312.05934, checked 2026-07-13) — so world
  lore and live game state stay out of the weights under either backend, arriving via
  context assembled by the engine/ai knowledge service (D-033); general language
  competence, not lore volume, sets the model-size floor. The training pipeline lives
  outside the browser (an assets/-adjacent workstream, not engine/). D-010 note: a
  world-tuned model is **game-specific**, not common/COS-shareable (unlike Nano, which
  is browser-wide). Sources checked 2026-07-13: github.com/mlc-ai/web-llm +
  webllm.mlc.ai/docs (worker support, structured output, ~8B-param practical ceiling
  quantized), arxiv.org/abs/2412.15803 (up to ~80%-of-native throughput). Resolve after
  phase A (and phase B if reached): supersede D-017 or close this and keep it.
*(P-005, toolchain, was accepted as D-014 and refined by D-020.)*
