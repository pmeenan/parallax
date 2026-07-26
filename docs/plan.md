# Plan

**This is a living document.** It will change as the project evolves — milestones will be
re-scoped, re-ordered, split, or added as measurements and findings come in. That churn is
expected and healthy; what is *not* allowed is silent change. Scope changes get a
decision-log entry; progress changes are reflected here by checking boxes and updating
status lines as work lands.

Milestones are ordered by risk: platform substrate before content, greybox before art,
one district before two. Each has exit criteria the harness can verify. Check a box only
when the item is done and verified (per root rule: measured, not asserted); partially
done items stay unchecked, optionally with a note.

**Status legend:** `pending` · `in progress` · `done` · `parked`

Active milestones retain task-level progress notes. Once a milestone is complete, compress
it to its delivered scope, final outcomes, unresolved carry-forwards, and exit evidence;
incremental run history remains in decisions.md, rough-edges.md, dependencies.md, and the
harness result artifacts.

## Standing gate — dependency currency

D-079 and [dependencies.md](dependencies.md) apply to every milestone. Review all direct
dependencies and versioned external inputs at milestone entry and every 28 days while a
milestone is active, whichever comes first; credible security advisories trigger an
immediate review, as do due deferral triggers and releases that credibly fix or unblock
an issue affecting planned or implemented work. Candidates are adopted or explicitly
deferred under risk-tier gates, never auto-updated. A milestone cannot exit with a
currency checkpoint older than 28 days; one full checkpoint may cover an exit and the
immediately following milestone entry in the same transition change. Runtime-critical
upgrades require same-scenario before/after evidence on the relevant registered machine;
exact pins and D-020 repeatability remain mandatory.

## M0 — Harness + skeleton  `done`

The measurement loop everything else depends on, plus the thinnest possible end-to-end
app: a Babylon Lite WebGPU scene in a render worker, served with COOP/COEP, deployed and
measured automatically.

- [x] Build/serve and app skeleton: deterministic separated engine/game bundles under the
      pinned D-014/D-020 toolchain, immutable local serving with COOP/COEP (D-010/D-011),
      and a Babylon Lite WebGPU scene running in the render worker. The frozen public
      placeholder was published once at parallax-web.com (D-021/D-022).
- [x] Harness v1: sandboxed pinned-Chrome fresh/warm `smoke@1`, registered environment
      identity, artifact plus dirty-tree identity, versioned mandatory metrics, diffable
      JSON/Markdown reports, blocking budgets, and explicit informational observability
      gaps (D-051/D-062/D-063). D-087 added the locked machine-local baseline store and
      separate actor/reason promotion transition.
- [x] Worker substrate spikes: dedicated-worker WebGPU + OffscreenCanvas **go** (D-056),
      paired fixed-capacity SPSC SAB rings **go** (D-057), and worker OPFS sync reads a
      **qualified go** for M1's storage boundary (D-058/D-066). D-096 removed the
      standalone microbenchmark after D-091's representative OPFS-to-renderable
      cell-load p95 became mandatory; historical repeatability remains RE-023.
- [x] Browser AI spike: Prompt API is a measured **no-go as a required backend** in
      pinned CfT (D-059/RE-019), while its sandboxed branded-Chrome install,
      restart/resume, post-restart, and offline lifecycle qualified separately (D-065).
      D-096 resolved P-007 in favor of the app-owned backend and removed both closed
      Prompt API harnesses while preserving their decision/finding/result evidence.
- [x] App-owned AI spike: pinned Gemma 4 E2B QAT GGUF on wllama WebGPU qualified with
      structured-output and OPFS lifecycle evidence; CPU/WASM remains measured headroom,
      not an automatic fallback (D-073/D-074; RE-030/RE-031/RE-032). Restart-persistent
      KV snapshots were a measured no-go for this runtime; live idle pre-seeding remains
      the preferred follow-up (D-075/D-084). D-095 removed the superseded ONNX/
      Transformers implementation, dependencies, build worker, and decision-only tests;
      its evidence remains in the decision/finding logs and result history.
- [x] Rendering-core selection: the measured head-to-head selected exactly pinned Babylon
      Lite 1.11.0 (D-077/D-078); D-080 removed classic Babylon and renderer swappability.
      Bounded Lite integration gaps and M1/M3 follow-ups remain in D-078 and
      [rendering-engine-research.md](rendering-engine-research.md) §7.
- [x] Rust/WASM capability spikes: reproducible threaded SIMD/atomic modules qualified
  under the mandatory smoke contract (D-085/RE-035), with fail-closed worker-startup
      phase evidence that localized the former intermittent startup stall to the
      wasm-bindgen/Rust allocator overlap fixed by D-093 (D-088/D-092/RE-036). The optional
      memory64 path demonstrated exact beyond-4-GiB access and passed its paired cost gate
      (D-086); D-117 resolved P-001 after M1 selected no production module requiring
      more than one memory32 address space and removed the closed experiment apparatus.
- [x] M0 exit dependency checkpoint completed under D-079. Node 24.18.0 and CfT
      151.0.7922.34 were adopted; bounded deferrals and recheck triggers remain in
      [dependencies.md](dependencies.md).

**Exit evidence:** the historical `pnpm m0:gate` alias produced
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` on registered
dev-01's physical console under pinned Chrome 151 and Node 24.18.0. All three facets,
all six core runs, and all 24 blocking checks passed. The result was explicitly promoted
after comparison with the same-artifact Chrome 150 anchor. RE-008 retains the
intermittent trace-completion failures rather than treating the passing replacement as
erasure; RE-036 retains the historical failures under D-093's corrected toolchain
attribution.

## M1 — Greybox District 1 streaming  `done`

- [x] Procedural greybox content for D1 (cells, LOD tiers, collision) at target world
      scale.
  - Completed (2026-07-24): D-090 fixes the v1 scale, grid, generator, LOD, collision,
    landmark, packaging, preview, telemetry, and acceptance contracts. The deterministic
    generator, generic engine contract, worker-rendered preview, content-addressed cell
    packages, semantic compound-feature LODs, correctly wound non-duplicated mixed-LOD
    edge skirts, asset QA record, mandatory fail-closed visible-pixel and animated-lighting
    smoke evidence, main-thread generation/scene-dispatch and worker timing, and
    automated validation are implemented. Schema-v27/metric-set-v12 physical-console
    artifact `smoke-1-71ce33331758-dev-01-showcase-2026-07-24T21-55-57-222Z.json`
    completed all six core runs and passed environment, mandatory-evidence, and budget
    facets with all 24 checks passing. The unchanged artifact's preceding RE-008 trace
    failure remains retained rather than being erased by the passing replacement.
  - [x] M1 compressed-asset prerequisite: re-ground D-006, adopt and self-host the exact
        KTX2/Draco/meshopt pins, preinstall their globals in the module render worker,
        gate one real fixture per path, and establish the shared validator plus mandatory
        future QA rejection for meshopt's canonical single-buffer constraint (D-078/D-089).
        Qualified by schema-v8 physical artifact
        `040677b31910…` on 2026-07-20.
- [x] Streaming worker + decode pool: OPFS → decode → GPU upload, driven by player
      movement, inside memory budget with proactive eviction.
  - Completed (2026-07-24): D-091 adds the long-lived
    OPFS-owning streaming worker, hardware-sized decode pool, direct render-worker upload
    channel, nearest-nine scheduler, proactive farthest eviction, terminal failure
    behavior, memory/queue/load telemetry, and mandatory p95/evidence checks. Exact
    Node 24.18.0 build, repeatability, unit tests, and a local pinned-Chrome diagnostic
    pass. Physical-console schema-v28/metric-set-v13 runs proved that Chrome exposes all
    seven app realms (window, render worker, streaming worker, and four nested decode
    workers) and that completed runs deliver 48–51 in-window replacements at 8.2–11.8 ms
    p95 with no encoded-budget rejection. A pre-report-wording source state passed all
    three facets and 30 checks in
    `smoke-1-392bec740604-dev-01-showcase-2026-07-25T00-04-07-045Z.json`; the final
    source state then failed closed across retained same-artifact attempts on RE-008
    and the then-misattributed RE-036 startup intermittent. D-092 retained a real
    RE-008 completion just after the former five-second validity boundary and
    localized RE-036 inside `__wbindgen_start`; D-093 fixed the proven
    wasm-bindgen/Rust allocator overlap without changing the memory or timeout
    contracts, and D-094 subsequently made complete lossless trace drains valid
    through ten seconds. Final schema-v29/metric-set-v14 artifact
    `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T00-58-50-184Z.json`
    completed all six core launches and passed environment, mandatory-evidence, and
    budget facets with all 30 checks passing. Its same-artifact confirmation retained
    a late RE-008 failure while all six additional Wasm cohorts completed, so the
    passing qualification and independent platform failure are both preserved. D-094
    confirmation `smoke-1-16ec0e762b84-dev-01-showcase-2026-07-25T01-15-05-125Z.json`
    also passed all 30 checks and accepted a complete lossless 5,020.1 ms V8 trace.
- [x] Geometry-representation spike (P-002): implementation, D-098's incumbent-retention
      decision, tracked evidence, cleanup, adversarial review, and D-097 final
      post-review physical smoke are complete. D-098 retains D-090's triangle-LOD
      incumbent because neither bounded challenger supplied fully eligible displacement
      evidence; the triangle arm
      also lacked a fully valid performance comparison. The dev-01 comparison measured
      Showcase identity while Standard remained advisory, failed closed on CPU/GPU
      eligibility, and yielded no splat visual-parity evidence after post-run
      adjudication rejected its inadequate provisional RMSE gate. RE-039 preserves the
      top-line timing observations but is non-reproducible; D-099 now requires a complete
      source-identity reconstruction bundle for future same-gate experiment cleanup.
      Comparison apparatus stays removed, and generated `@1`/`@5` directories remain
      best-effort machine-local aids. Final report
      `smoke-1-c54679d7b006-dev-01-showcase-2026-07-25T05-39-39-928Z.json` passed all
      three facets and 30/30 checks.
- [x] Scripted harness flythrough as the standard regression run — sweeping
      lighting/weather states, not just geography (binding requirement from
      game-design.md → Design implications; dynamic time-of-day binds the renderer from
      the M1 greybox onward per architecture.md). D-100 implements the versioned
      ten-minute route, render-worker-owned pacing/aggregation, direct sequenced
      streaming observers, visible streamed-residency ownership, six rendered
      environment checkpoints, independent full-scenario attestation, exact cross-port
      final settlement, full-window heap/streaming/Dawn evidence, per-repeat measured
      environment identity, structured failed-attempt evidence, three fresh repeats,
      facets, and explicit budget-scope omissions. Two retained same-artifact physical
      attempts exposed the D-101 payload-scaling and heap-cadence contract defects:
      complete lossless approximately 420 MB traces drained in 19.2–19.5 seconds, and
      one seven-realm heap collection took 169.5 ms and skipped an intermediate
      deadline. The flythrough-only corrected contract uses a 30-second trace validity
      bound and a 200 ms exact-deadline heap cadence. The next retained same-artifact
      physical report completed all three measured repeats with valid environment
      identity, 3,002 heap observations and no missed deadline per repeat, complete
      lossless 19.2–19.8-second trace drains, and all 15 absolute checks under budget,
      but correctly failed the unchanged repeat gate: streaming cell-load p95 was
      23.975/30.820/22.230 ms (38.641% relative range). D-102 retains that failure and
      advances streaming/public/report contracts to v3/v15/v4 with deterministic
      batch identity and bounded OPFS/decode/upload/commit/wait attribution; it does not
      tune scheduling or relax the 250 ms / 10% gates. Final report
      `flythrough-d1-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-07-24-028Z.json`
      passed all three facets and 15/15 evaluated checks across three measured repeats
      on artifact
      `20770c3a4d6dba436a287cb77d60e6842e1c86dd5aa4ac82da3dcfc4b953747e`;
      streaming p95 was 22.810/23.895/22.000 ms with 8.614% relative range.
      D-097's earlier final physical `smoke@1` passed on the reviewed M1 lineage.
      The exact flythrough artifact's follow-up
      `smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-15-06-917Z.json`
      then stopped after 3/6 core runs on a generic streaming-validation failure.
      D-103 retains that failure, corrects an independently proven valid unsettled
      residency rejection, and advances smoke reports to schema v35 with raw invalid
      start/end evidence. Final schema-v35 / metric-set-v18 report
      `smoke-1-20770c3a4d6d-dev-01-showcase-2026-07-25T10-34-23-655Z.json`
      passed the exact artifact across all six runs, all three facets, and 30/30 checks
      with no failure, qualifying the final tree without erasing or reinterpreting the
      retained schema-v34 failure. This does not reopen the passing
      scripted-flythrough item, but that item also does not claim M6
      precipitation/wind/wet-surface VFX, D-025's in-game benchmark lifecycle, or the
      standing budgets explicitly omitted from this gate.
- [x] Render-worker robustness for long runs: WebGPU device-loss handling and a
      restart-after-failure path (the M0 skeleton was deliberately
      failed-is-terminal; flythrough-length sessions need recovery). D-104's qualified
      one-retry whole-cohort implementation now recovers from a generation-tagged
      worker-acknowledged settled checkpoint, gates readiness on both render and
      streaming hydration, propagates failure in both directions, and uses one bounded
      quiesced diagnostic fault boundary. Schema-v4/metric-set-v3 binds the restored
      streaming/SAB/world identity and retained flythrough invalidation to each attempt.
      The dedicated `render-recovery@1` browser qualification is implemented. Its first
      registered physical-console report,
      `render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-21-01-582Z.json`,
      is retained as failed: the environment passed, but a harness-only Playwright
      page-realm closure leak stopped all attempts before the initial evidence boundary,
      so bounded recovery was not evaluated and no platform finding is claimed. The
      report's secondary `contractValidationFailure` exposed a validator/runner mismatch
      over independently valid environment evidence on failed attempts; that is fixed
      without rewriting the retained artifact. The next registered report,
      `render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-37-09-496Z.json`,
      is also retained as failed: its environment and report contract passed, but all
      attempts stopped before the initial boundary because the readiness wait accepted
      a transient streaming snapshot whose counters/residency were settled while its
      concrete recovery checkpoint was still null. This is another harness-only
      failure; recovery was not evaluated and no platform finding is claimed. All
      boundary-producing detached waits now require a non-null checkpoint exactly bound
      to the live generation, counters, observers, and sorted nine-cell residency, with
      null/stale snapshot regressions. The third registered report,
      `render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T13-48-46-809Z.json`,
      is also retained as failed: its environment and report contract passed, but all
      attempts again stopped before the initial boundary because the shared
      `waitForFunction` dispatcher was `async`. Pinned Playwright 1.61.1 treats the
      immediate Promise result as truthy instead of polling its resolved boolean, as a
      controlled local pinned-Chrome test and the installed polling implementation
      confirmed. Recovery was not evaluated and no platform finding is claimed. The
      six waits now use a strictly synchronous detached boolean dispatcher; async page
      actions remain separate, with thenable and call-site regression coverage. These
      fixes kept schema-v3/metric-set-v3 unchanged. The fourth registered report,
      `render-recovery-1-c3ded41419dc-dev-01-showcase-2026-07-25T14-04-02-438Z.json`,
      is retained as failed but is the first to reach recovery behavior: its worker-
      crash attempt moved and evicted in generation 1, recovered the complete cohort as
      generation 2 in 8,528.327 ms, restored the exact moved checkpoint and fresh SAB/
      decoder/world state, and rendered a visible canvas. The validator incorrectly
      demanded positive load/eviction history from the fresh generation-2 hydration
      snapshot, whose counters legitimately reset to zero. Recovery validation is now
      lifecycle-aware while generation-1 movement requires positive observer/load/
      eviction deltas. The other two attempts exposed an app preflight race: capture
      could read the preceding framebuffer before the newly posted camera/environment
      sample rendered. The monitor was also reported asleep during these physical runs,
      so display sleep may have contributed to the observed visual failures without
      negating the independently proven race. The qualifier now sends an inert F15 wake
      key before Chrome launch and requires visible operator confirmation. Capture waits
      for the next rendered frame without relaxing the visual gate. Failed partials
      retain the latest telemetry and checkpoint list,
      and checkpoint errors identify the exact field; this advances only the dedicated
      report schema to v4 (metric set remains v3). The mixed harness-contract/app race
      is not a browser finding and the retained schema-v3 report remains immutable.
      The fifth registered report,
      `render-recovery-1-f0cd7621fca7-dev-01-showcase-2026-07-25T15-58-46-432Z.json`,
      is retained as another application/harness scheduling failure: all three attempts
      captured their initial boundary, then timed out after 180 seconds in flythrough
      preflight with zero checkpoint evidence and no browser errors. The render worker
      had deferred Babylon Lite screenshot registration until after the just-rendered
      frame, then withheld the next frame while awaiting a capture that Lite can service
      only from `renderFrame`. The queue now registers capture synchronously when the
      request arrives, lets the next frame service it, then returns and uses a deferred
      macrotask only to await/publish the already-submitted evidence while withholding
      later frames. Frame-serviced, concurrent/later-request, failed-readback, and pinned
      Lite registration regressions guard that order. Windows display wake now occurs
      immediately before every identity and measured Chrome context launch, not once
      before the multi-minute sequence. Recovery was not evaluated, no platform finding
      is claimed, and schema v4 / metric set v3 remain unchanged.
      The sixth registered physical-console report,
      `render-recovery-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-26-52-162Z.json`,
      qualifies D-104 on artifact
      `7f6f65d9c6fdb6e187ebaccbf547456ae3d767842a9613524034cc527ba1a0a1`.
      Its schema-v4/metric-set-v3 environment, evidence, and three-check bounded-recovery
      facets all passed with no run or contract failure. Device-loss, worker-crash, and
      exhaustion first recovery measured 2,332.244, 5,617.312, and 2,332.155 ms,
      respectively; every attempt restored the exact moved checkpoint as generation 2
      with nine resident cells and 87.502799% visible-canvas coverage. The exhaustion
      attempt's second worker crash left render recovery `exhausted`, streaming `failed`,
      and restart count one as required. Final exact-artifact D-097 report
      `smoke-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-36-37-999Z.json`
      then passed schema v37 / metric set v20 across all six core runs, all three facets,
      and 30/30 checks with no core-run failure. Its warm-repeat-3 trace completed
      losslessly in 5,315.897 ms, within D-094's unchanged ten-second validity bound.
      The converged implementation, dedicated real-fault qualifier, and routine smoke
      gate therefore close this item.
- [x] Benchmark mode (D-025): expose that same versioned flythrough, fixed settings,
      warm-up/repeats, environment identity, and JSON + human-readable result export in
      the game; the complete run and measurement path works from in-game with no
      external driver, non-Chrome results are advisory, and missing capabilities/metrics
      remain explicit rather than gaining compatibility fallbacks.
      D-105 implements the complete lifecycle as `benchmark-result@1`: an accessible
      public panel, two fixed presets, three reset-separated continuous-page repeats,
      in-game environment/metric aggregation, explicit unsupported privileged metrics,
      and equivalent manual/automation start and export paths. The adversarial fix pass
      adds benchmark-exclusive observer ownership, complete engine-side canonical
      flythrough and fixed-pixel attestation, all-boundary environment equality,
      abortable/rerunnable failure cleanup, retained capability evidence, complete
      human-readable checks/failures, and accessible clipboard completion feedback.
      The hardening pass adds acknowledged render/streaming quiescence, cancellable
      never-settling checkpoint readback, distinct cumulative/run-local observer
      sequences with late-generation rejection, shared route-span/render-state
      attestation, awaitable public reset, and cleanup-before-terminal publication.
      D-106 closes the verification races with synchronous reset ownership, a bounded
      reset-acknowledgement recovery path, recovery-consistent cumulative transport
      identity, reset acknowledgement after render-loop resumption, and synchronous
      disposal restoration even when an environment capture never settles. Its final
      closure makes terminal direct-reset publication reentrantly actionable and keeps
      recovery-ready pixel telemetry aligned with an override restored during startup.
      D-107 retains the first failed physical attempt
      `benchmark-result-1-9d5680032be6-dev-01-showcase-2026-07-25T19-09-21-918Z.json`:
      repeat 1's first 3840×2160 capture was incoherent while its remaining five
      captures matched prior evidence. A generation/sample/pixel-size render
      acknowledgement now precedes every checkpoint registration, and a bounded headed
      pinned-Chrome rerun passed all six 4K preflight captures. The full `pnpm check`
      gate passes. The next complete physical run
      `benchmark-result-1-9a218e2fe23a-dev-01-showcase-2026-07-25T19-54-39-399Z.json`
      completed all three ten-minute repeats with exact 4K evidence, no errors, no
      recovery, zero Window Long Tasks, and every individual streaming p95 below
      250 ms. It remains failed evidence because streaming p95 varied
      9.115/28.005/48.025 ms (426.879% relative range). D-108 rules out a suffix error,
      retains RE-042, and changes the long-lived worker from per-load asynchronous
      OPFS lookup/open/close to one size-validated fixed handle set per generation;
      telemetry v7 exposes the exact package/handle count and startup-open duration.
      The next physical attempt,
      `benchmark-result-1-7851397a6f82-dev-01-showcase-2026-07-25T20-35-51-111Z.json`,
      completed repeat 1 with exact 4K evidence and 256/256 handles, then failed because
      raw fullscreen `viewportCssPixels.height` changed 1,586→1,585 while screen/DPR,
      physical estimate, and fixed worker dimensions stayed unchanged. Bounded controls
      disprove a short startup-settling race. D-109 advances the result to schema v3 and
      records `fixed-worker-render-pixels@1`: raw CSS viewport geometry remains in every
      capture but is not comparison identity for this fixed-pixel, checkpoint-attested
      worker workload; every other environment field remains exact.
      Two subsequent complete physical-console reports on artifact
      `ff05ec211444b89d8c706305205cc60908a140be6af2f2e3ed4ba20a31cded7e`
      are retained:
      `benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T21-28-45-673Z.json`
      failed the unchanged 10% gate on streaming p95
      2.265/2.915/2.950 ms (30.243% range), and its one permitted immediate retry
      `benchmark-result-1-ff05ec211444-dev-01-showcase-2026-07-25T22-04-07-075Z.json`
      failed on streaming p95 2.735/3.325/3.075 ms (21.572%) plus render-duration p95
      0.330/0.375/0.310 ms (20.968%). Both completed all three exact ten-minute
      repeats with stable callback pacing, zero Window Long Tasks, exact 92-sample
      suffixes, correct nearest-rank aggregation, and 256/256 fixed handles. The old
      OPFS residual did not recur; remaining variance is distributed across recorded
      decode/upload/commit boundaries and does not justify a Chrome defect claim.
      D-110/RE-043 stopped further full retries and required one privileged
      physical-console single-repeat canonical diagnosis before a concrete fix or
      prospective contract change could trigger another complete public run. D-111's
      first attempt lost its artifact; D-113's one authorized replacement retained
      schema-v1 invalid partial
      `m1-exit-diagnostic-1-12e68fa57ea7-dev-01-showcase-2026-07-26T01-24-11-033Z.json`.
      D-114 adjudicates that evidence and closes the experiment. Its 75 ms positive
      control worked, but only the biased first 41/92 canonical cells retained complete
      stage marks; the roughly 883 MB trace never completed, presentation and
      page-attributed GPU memory remained unsupported, and no additive CPU memory total
      was possible. The result supplies no variance localization, runtime/measurement
      fix, or prospective contract change. The command and apparatus are removed, and
      no further diagnostic or public benchmark was authorized before the explicit
      final-M1 contract decision below.
      D-115 completes the task on implementation and result-contract correctness.
      Producing and exporting a valid failed result is the required fail-honest
      benchmark behavior, not a performance pass: both complete reports retain their
      unchanged 10% failures, the page budget facet remains `not-evaluated`, and neither
      report substitutes for the qualified privileged flythrough. D-115 supersedes
      D-110's requirement that this intentionally advisory contract eventually pass as
      a second M1 qualification. No further 30-plus-minute public benchmark or
      privileged diagnostic is authorized or required for M1.
- [x] Exit: 10-minute flythrough — including lighting/weather-state sweeps — with zero
      budget violations; streaming metrics dashboarded; presentation gating revisited
      per D-051 (see the recorded M1 collision note in budgets.md → Frame time).
      D-112 completes the dashboard subrequirement with an always-visible accessible
      panel over the authoritative public streaming snapshot: cohort/recovery,
      residency and targets, fixed package/handle identity, retained total and stage
      p95s, scoped streamed-byte accounting, queue pressure, encoded-residency
      rejections, and proactive eviction are visible, while unexposed stall/emergency
      counters are explicitly unavailable. Retained live p95s are explicitly
      non-gating. It adds no polling, duplicate metric store, telemetry schema, or
      benchmark control path.
      D-115 defines the exact exit reading: “zero budget violations” means zero
      violations among the evaluated mandatory M1 metrics, not a claim that unsupported
      metrics passed. D-115 uses an explicit versioned evidence bridge rather than
      pretending D-102's passing schema-v4/metric-set-v4 artifact satisfies today's
      schema-v12/metric-set-v6 validator. That registered long-window anchor passed its
      environment, evidence, and budget facets and all 15 evaluated checks. D-104's
      dedicated physical qualifier plus the final current smoke cover the subsequently
      mandatory recovery-checkpoint/settlement contract. Two complete post-D-108 public
      reports physically exercised six current-path ten-minute routes with exact
      checkpoints and 256/256 handles but retain failed advisory variance; only the
      final smoke can carry the current registered short-scenario streaming verdict.
      That verdict does not relabel the ten-minute variance failures. Physical
      presentation, worker long tasks, combined CPU resident memory, and page-attributed
      GPU residency remain enumerated platform gaps and support no budget claim;
      callback cadence and logical allocation sizes never substitute. Standard remains
      explicitly unqualified until its M1 Pro/Metal reference machine is registered.
      Visible-pop visual diff was not its own M1 plan task, although D-102 listed it as
      a later-exit omission; D-115 explicitly supersedes that scope implication and
      defers the check to M5's representative-art streaming swap. D1↔D2 transition
      remains M4.
      The first converged schema-v44 / metric-set-v21 smoke remains immutably failed
      under D-116: all six runs and 30 individual budget checks completed, but D-115's
      new pure-relative short-smoke streaming verdict amplified 0.585/0.480 ms absolute
      spreads into 31.622%/24.427%. D-116 does not relabel that artifact.
      Final registered-dev-01 Showcase report
      `smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T03-19-56-378Z.json`
      (SHA-256
      `b10c83ff0019cd3b332eec322703e2556de4565ba3e01c942154909cfb5508c9`)
      passed schema v45 / mandatory metric set v22 across all six core runs, all three
      facets, and 30/30 evaluated budget checks with no core-run failure. Fresh
      streaming p95s 1.885/2.130/2.500 ms produced a 0.615 ms spread within the 1 ms
      allowance; warm p95s 2.300/2.340/1.810 ms produced a 0.530 ms spread within the
      same allowance. The current-path settlement, fixed-handle streaming, corrected
      all-realm heap sampler, and bounded short-smoke repeatability evidence therefore
      complete D-115's versioned M1 chain without relabeling the failed v44 or public
      ten-minute results.
      Informational `invalid` presentation and `unsupported` GPU memory remain visible
      in the passing report. Worker long tasks, combined CPU resident memory,
      page-attributed GPU residency, and Standard remain unqualified. D-115 explicitly
      supersedes D-108's extra recovery-rerun consequence based on the qualified
      unchanged recovery control path and the later physical 256/256, 204.96 ms
      exercise of the shared generation-initialization path; it does not claim the
      combined fault path was remeasured. The closure claim is the versioned evidence
      chain plus this qualifying-input-tree smoke, not a then-current D-115-era
      schema-v12 ten-minute report. No additional flythrough, render-recovery, public benchmark, diagnostic,
      or physical smoke is an M1 gate.

**Post-M1 candidate evidence:** After D-117's closed memory64 removal, D-118's
fail-closed report finalization, D-120's baseline preflight, and all review fixes
converged, the passing same-artifact classification retry
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
(SHA-256
`ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
passed schema v47 / mandatory metric set v23 across six launches, all three facets,
and 30/30 evaluated checks, with measured post-run identity and report persistence
and no finalization or core-run failure. It was correctly ineligible for comparison
with the older promoted metric-set-v11 anchor and was not promoted automatically.
This evidence qualifies the measured post-M1 runtime artifact without changing or
reopening M1, and no additional post-M1 physical gate is pending.
RE-044 retains the same-artifact first attempt's pre-measurement `Failed to fetch`
startup failure and the one passing classification retry above; the retry does not
relabel the failed report.

## M2 — Install/launch/run lifecycle + caches  `pending`

The heart of the platform research. Prerequisite: production serving live on
parallax-web.com (D-011) — cache findings measured only against local serving aren't
credible.

- [ ] Production deployment to parallax-web.com with versioned nginx/header config;
      harness can target local and production and labels results accordingly. (The
      replacement landing page must not inherit the frozen placeholder's "WebAssembly
      (threads and memory64)" framing — memory64 is a D-117 reopen-only option, not part of
      the stack; the placeholder itself stays frozen per D-022.)

- [ ] Installer UX: manifest, resumable multi-GB OPFS pull, integrity check,
      persist-storage. Manifest schema distinguishes common (engine, shared packs,
      models) vs. game-specific resources with hash addressing for the common set
      (COS-ready, D-010).
- [ ] PSO trace capture + progressive warmup at boot; verify Dawn cache behavior
      launch-1 vs launch-2.
- [ ] Keep V8 code-cache lifecycle evidence as best-effort attribution
      (`instantiateStreaming`, 304/immutable discipline). For asset-only updates, retain
      paired pre/post evidence, enforce the <=10 s warm launch budget, record the launch
      delta, and calibrate any relative regression threshold through a decision (D-051).
- [ ] Service-worker offline shell (D-015): precache, cache-first navigation, atomic
      activation + rollback, COOP/COEP preserved on cached responses, version
      compatibility checks (shell/engine/manifest/save schema).
- [ ] Installer trust + crash-safety (architecture.md contract): hash verification of
      every bundle, atomic version switch, resume/rollback on interruption,
      repair-by-refetch, persist() denial and QuotaExceededError flows, best-effort
      space preflight with quota-error-aware incremental writes.
- [ ] Offline fault suite: offline hard reload, browser restart offline, corrupt-cache
      recovery, interrupted update, disk-full injection.
- [ ] Uninstall path (D-024): in-shell uninstall behind explicit confirmation with
      save-export offer; both mechanisms (client-side storage teardown, static
      `Clear-Site-Data` endpoint) built and measured for actual coverage — OPFS,
      service worker, code cache, Dawn cache — and quota release; gaps logged in
      rough-edges.md.
- [ ] Scale tests, two corpora (budgets.md, D-009/D-018): (a) ≥100 GB filler lifecycle
      corpus through install/resume/integrity/update/eviction — a floor, not a
      ceiling; grow until a platform limit is found or disproven; (b) representative
      streaming corpus (realistic encoding/entropy/file distribution/dependency
      graphs) exercising decode → GPU upload at scale; best-effort quota preflight +
      failure UX at that scale.
- [ ] Exit: cold-install and warm-launch times within budget, measured across ≥3
      machines; findings written up.

## M3 — Gameplay core + NPC AI  `pending`

- [ ] Sim worker: fixed timestep, input-commands, snapshot interpolation, save/load.
- [ ] Character controller, camera, basic interaction loop in greybox D1.
- [ ] App-owned NPC dialog (D-074/D-096): persona cards, rolling memory, strict
      structured output for state-affecting intents, authored unavailable-model
      fallback, and frame-impact measurement during WebGPU/CPU-WASM inference.
- [ ] NPC knowledge service (D-033): generic retrieval/assembly contract in `engine/ai`
      with `game/`-supplied providers; structured game-state tier implemented;
      prompt/persona schema carries the retrieved-context slot; lore authored
      chunked + tagged in `game/`. Semantic tiers (lore embeddings, episodic memory)
      stay build-later.
- [ ] Exit: playable greybox loop with conversing NPCs (incl. authored-fallback path
      with the model unavailable, D-096); save/reload round-trip; sim determinism check
      (same input log → same state hash) in the harness — **cross-machine**: replays
      must hash-match across dev-01 and mac-01 on the same pinned Chrome version
      (D-016), not just on one host.

## M4 — District 2 (catacombs) + hard transitions  `pending`

- [ ] Greybox catacombs district; multiple entrance choke points with different surface
      contexts, driven by world-graph data (game-design.md).
- [ ] Full resident-set swap meeting the transition contract in budgets.md, per entrance.
- [ ] Calibrate the per-entrance **prefetch trigger** from greybox transition
      measurements and add it to the budgets.md transition contract via a decision-log
      entry (D-055 — the contract element is deliberately undefined until these
      measurements exist).
- [ ] Exit: repeated D1↔D2 transitions through every entrance in a harness run with no
      contract violations — including the prefetch-trigger element the calibration task
      above adds; the exit cannot be declared against a contract that still lacks it.

## M5 — Art pipeline + District 1 art pass  `pending`

- [ ] assets/ pipeline live: Flow-derived reference sheets → Blender-agent generation →
      QA gate → library; kit-of-parts + trim sheets for D1's style.
- [ ] Swap greybox D1 to final art without regressing M1/M2 budgets (the real test of
      the pipeline). Add D-115's deferred deterministic visual-diff gate for no visible
      pop at the 12 m/s traversal/LOD contract against representative art; M1
      checkpoints established streamed ownership/non-blank output, not this claim.
- [ ] Exit: D1 fully art-passed, all budgets green, install size within budget.

## M6 — District 2 art, audio, polish  `pending`

- [ ] D2 art pass (distinct palette/kit).
- [ ] Spatial audio (WebAudio worklets).
- [ ] VFX and weather pass.
- [ ] Photo mode (a cheap, high-value capabilities showcase).
- [ ] Exit: end-to-end demo build a stranger can install and play.

## M7 — P2P multiplayer exploration  `parked (design constraints active now)`

- [ ] WebRTC data channels, 2–4 players, D1: presence/co-exploration first, shared sim
      second. Scope decided when M3 determinism results are in. Infrastructure per
      D-016: self-hosted signaling + STUN; TURN permitted if direct connectivity
      failure rates warrant it.

## M8 — Cross-Origin Storage exercise  `parked (blocked on COS API availability)`

The isolation/sharing model is decided (D-010: origin-per-game, sharing via COS) and
mainline work is COS-ready from M0/M2 (common/game packaging split, deterministic
versioned engine builds, hash-addressed manifest). This milestone runs the actual
exercise once COS APIs exist — it can be pulled forward whenever the Chrome-side work
wants a real-world consumer:

- [ ] Serve Parallax's common set (engine bundles, shared packs, models) from two
      "published game" origins via COS hash index; measure per-game download and
      launch delta vs. unshared.
- [ ] Validate deterministic-build discipline end-to-end: independently built engine
      bundles hash-match and share.
- [ ] Exercise code-cache (and, if available, Dawn/PSO-cache) sharing across origins;
      log findings.

*(Dropped per D-010: multi-game quota-contention, instant-play, and origin-model
comparison probes — the origin model is decided, and the rest isn't needed for this
exploration.)*

## Standing workstreams (no milestone; always on)

- **Rough-edges log:** every milestone feeds it; periodically synthesize into shareable
  write-ups.
- **Harness evolution:** new system → new metrics, same change.
- **Chrome coordination:** findings that suggest browser changes (e.g., shippable PSO
  caches, COS code-cache work) tracked in rough-edges.md with status.
