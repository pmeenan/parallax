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

- [x] Procedural D1 greybox content completed at target world scale, including cells,
      LOD tiers, collision, deterministic packaging and preview/QA evidence, together
      with the compressed-asset prerequisite: self-hosted exact KTX2/Draco/meshopt pins,
      worker integration, real fixtures, and shared fail-closed validation
      (D-078/D-089/D-090).
- [x] Long-lived OPFS streaming worker and hardware-sized decode pool, with
      player-driven nearest-nine scheduling, direct render-worker GPU upload,
      proactive farthest eviction, terminal failure handling, and mandatory
      queue/load/memory observability and budgets (D-091–D-094).
- [x] Geometry-representation spike P-002 completed and cleaned up. D-098 retains the
      triangle-LOD incumbent because neither bounded challenger produced fully eligible
      displacement evidence; D-099 governs source-identity reconstruction for future
      same-gate experiment cleanup.
- [x] Versioned ten-minute scripted flythrough established as the standard regression
      run, covering geography plus rendered lighting/weather states, deterministic
      streaming observation, environment/checkpoint identity, full-window evidence,
      repeatability, facets, and explicit budget-scope omissions (D-100–D-103).
- [x] Render-worker long-run recovery completed with generation-bound checkpoints,
      one bounded whole-cohort retry for device loss or worker failure, restored
      render/streaming hydration, exhaustion handling, and a dedicated real-fault
      physical qualifier (D-104).
- [x] In-game Benchmark mode completed with the canonical flythrough, fixed presets,
      warm-up and reset-separated repeats, environment identity, fail-honest checks,
      and JSON plus human-readable export without an external driver; unsupported
      capabilities and metrics remain explicit (D-025/D-105–D-115).
- [x] M1 exit and streaming dashboard completed: the authoritative streaming snapshot
      is visible in-game, and the versioned Showcase qualification covers the evaluated
      mandatory flythrough, recovery, settlement, fixed-handle streaming, all-realm
      heap sampling, and short-smoke repeatability contracts (D-112/D-115/D-116).

**Exit evidence:** D-115/D-116 close M1 only for registered dev-01 Showcase and the
evaluated mandatory metrics through an explicitly versioned evidence chain: D-102's
passing schema-v4/metric-set-v4 ten-minute flythrough anchor, D-104's passing
schema-v4/metric-set-v3 render-recovery qualifier, and final schema v45 / mandatory
metric set v22 smoke
`smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T03-19-56-378Z.json`, which passed
all six launches, all three facets, and 30/30 evaluated checks. Standard, physical
presentation, worker long tasks, combined CPU resident memory, and page-attributed GPU
memory remain unqualified. The complete public Benchmark reports remain retained
failures under their unchanged 10% repeat-variance checks and are advisory with budget
facets `not-evaluated`; they are not relabeled as performance passes.

**Post-M1 candidate evidence:** After D-117/D-118/D-120 and review fixes, final
schema v47 / mandatory metric set v23 report
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
(SHA-256 `ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
passed six launches, all three facets, and 30/30 evaluated checks. It qualifies that
post-M1 runtime artifact without reopening M1. RE-044 retains the preceding
same-artifact pre-measurement `Failed to fetch` startup failure; the one passing
classification retry does not relabel the failed attempt, and no additional post-M1
physical gate is pending.

## M2 — Install/launch/run lifecycle + caches  `done`

The heart of the platform research. Prerequisite: production serving live on
parallax-web.com (D-011) — cache findings measured only against local serving aren't
credible.

M2-exit/M3-entry dependency checkpoint (2026-08-01, accepted by D-149): the full D-079
currency review and deterministic plus dev-01 gates are complete. Node 24.18.1, CfT
Stable 151.0.7922.71, `sharp` 0.35.3, and transitive PostCSS 8.5.25 are current/reference
inputs; the graph clears the two prior high advisories and every other candidate has an
explicit disposition and recheck trigger in
[dependencies.md](dependencies.md#full-checkpoint--2026-08-01-m2-exit--m3-entry).
The dev-01 `.34`/`.71` same-scenario transition, D-152 installed branded-Stable parity,
and final exact-current `.71` production smoke all passed. D-150 makes dev-01 the sole
physical gate; no other machine is required for this checkpoint or M2 exit. The next
full checkpoint is M3 exit or 2026-08-29, whichever comes first.

- [x] Production deployment to parallax-web.com with versioned nginx/header config;
      harness can target local and production and labels results accordingly. (The
      replacement landing page must not inherit the frozen placeholder's "WebAssembly
      (threads and memory64)" framing — memory64 is a D-117 reopen-only option, not part of
      the stack; the placeholder itself stays frozen per D-022.) D-121 prepares the
      reviewed nginx config, guarded preview-first deployer, and fail-closed harness
      target identity. The human corrected and read-only verification confirmed the
      deployer's owner/non-symlink/0755 prerequisite. The corrected deploy completed
      exact remote inventory verification and independent public-origin validation
      passed. Two production smoke attempts then failed only D-116 streaming
      repeatability. D-122's consumed diagnostic was invalid before readiness because
      of a serialized-callback scope defect. D-123's exact no-retry replacement was
      consumed and retained invalid with five valid attempts and one null attempt after
      a misordered zero-work control. D-124 records the bounded cross-realm
      localization without prescribing a runtime or budget change, verifies both D-099
      reconstructions, and removes the closed apparatus. D-124 left the item unchecked
      until the cleaned candidate was rebuilt, redeployed, publicly verified, and
      reached its final D-097 production-smoke disposition. That cleaned-artifact report is
      retained failed (D-125): all absolute checks and fresh repeatability passed,
      while warm streaming p95 spread 1.325 ms. D-125 denies a blind retry and
      implements one batch-atomic render upload/commit transaction per scheduler load
      batch without changing D-116. Its post-correction smoke passed all 30 absolute
      checks and warm repeatability but failed fresh repeatability at 1.250 ms spread.
      D-126 retains that report, denies a retry, and collapses the remaining two-phase
      transaction to one ordered render request/response with reverse rollback and
      fail-closed renderer teardown after response loss. D-127 retains the one
      authorized post-D-126 production report: exact pre/post serving identity, all six
      launches, all three facets, and 30/30 checks passed under schema v51 / metric set
      v27. Both fresh and warm D-116 cohorts passed. The baseline remains untracked,
      D-116 is unchanged, and RE-043 stays open. This closed only the production item
      at D-127; the later checked items and D-153 closure evidence below complete M2.

- [x] Installer UX: manifest, resumable multi-GB OPFS pull, integrity check,
      persist-storage. Manifest schema distinguishes common (engine, shared packs,
      models) vs. game-specific resources with hash addressing for the common set
      (COS-ready, D-010). D-128 completes the first bounded project: deterministic
      install-manifest v1/build-manifest v12, exact local classification, the five
      pinned model shards, independent fail-closed validation, dual
      build-artifact/release identity, and scope/target summaries. The checkbox remains
      open. D-129 completes the next bounded project: a Web-Lock-serialized,
      content-addressed OPFS release store with flushed immutable checkpoints,
      incremental exact verification, append-only active/previous commits, rollback,
      crash reconciliation, bounded GC, deterministic fault injection, and
      install-store telemetry v1. Its retained fresh-profile Chrome adapter result
      `adapter-v2-2026-07-29T03-23-51-061Z.json` (SHA-256
      `370a724f18d9aec361cc9de93636c588b3965e62cd284fdcfe508534a35005fd`)
      passes the bounded small real-OPFS lifecycle and fixed-lock cross-worker tests on
      a synthetic one-resource staged release using the implementation imported from
      the exact D-129 build. The recorded production `releaseDigest` is result/build
      identity, not the staged fixture's release identity. It is not power-loss,
      browser/OS-crash, torn-real-write, multi-GB, network, quota, persistence, real
      update/rollback, production,
      performance, registered-environment, or D-097 evidence. The checkbox and M2 remain
      open. D-130 corrects the first executor-blocking provisioning defect: the five
      generated split shards are exact same-origin install-only immutable objects,
      with fixed-target guarded content publication, app-deploy preservation, and a
      bounded fail-closed source-evidence command that binds full remote bytes and
      filesystem identity over fixed-target SSH before probing public HTTP
      range/validator behavior. The five shards were subsequently published, but the
      first retained source-evidence command failed on a blanket 206 header check.
      D-131 corrects the nginx cache map to distinguish range-request responses and
      makes the verifier's 200/206/416 contracts response-specific; the failed result
      remains evidence. D-132 retains the corrected production source-evidence run as
      passed: the exact installed include, five regular non-symlink objects and
      2,620,371,552 bytes passed the fixed SSH boundary, and all 25 bounded HTTP
      requests passed while reading only 10 successful model bytes plus 985 bounded
      416 bytes. No production app deployment or full HTTP model download is claimed.
      D-133 is the accepted worker/network transfer-resume project. It adds the eager
      fifth worker, separate whole-operation transfer lock, checkpoint-v2 strong ETag
      binding, exact Range/If-Range/206/416 handling, bounded retry/cancel, plan/quota
      APIs, and live install-store v2/installer-transfer v1 telemetry. Its pinned-Chrome
      worker surface probe passed and confirmed that `persist()` is absent in a
      dedicated worker. Deterministic gates passed with exact `@noble/hashes` 2.2.0,
      and the retained pre/post-pin real-OPFS adapter results passed the same unchanged
      bounded lifecycle/lock verdicts. The visible-Chrome policy calibration passed:
      all 36 trials transferred the exact 128 MiB set with zero
      correctness/protocol/retry/reuse/transport/validator failures, six of nine cells
      passed the predeclared <=10% repeatability gate, and independent schema-v1
      recomputation selected concurrency 1 / 8 MiB at 16,472,212 B/s median and 4.12%
      range. The ignored result JSON SHA-256 is
      `9afbc10aecda989883883ff499841444b399c14d7dd30c0b4600f8073a357e9e`;
      its D-099 reconstruction passed and calibration-only apparatus is removed. The
      first production-path installer qualification failed before resource transfer
      because the hashed worker used its own URL as the relative install-manifest base;
      that result remains failed. The corrected single rerun passed exact 8 MiB
      interruption/resume and two-client transfer-lock/reuse evidence, and both dirty
      sources have verified D-099 bundles. The qualification apparatus is removed.
      The first D-097 production smoke is retained failed under D-134: all six launches,
      all 24 executed absolute checks, and repeatability passed, but all six mandatory
      heap checks were withheld because the v54 runner omitted the eager installer
      worker from its otherwise exact CDP target topology. The shared smoke/flythrough
      resolver now consumes exact build-manifest v13 roles and includes installer,
      render, streaming, and the telemetry-declared decode multiplicity without
      weakening unknown-target rejection; smoke/flythrough advance to v55/v22 with
      metric sets v27/v11 unchanged. The single corrected production smoke then passed
      all six launches, all three facets, and 30/30 checks against exact pre/post
      production identity; all six heap checks measured the page plus installer,
      render, streaming, and four decode workers. Both streaming-repeatability cohorts
      remained within the unchanged 1 ms allowance, and the baseline remains
      untracked. Final independent review accepted D-133 after recomputing the
      retained hashes, exact production identity, all six raw heap
      topologies/high-waters, repeatability, and 30/30 checks. D-133 stops at ready
      and adds no UI,
      publication, consumer migration, persistence request, deployment, update, or
      offline behavior.
      D-135 is the accepted bounded app-shell interaction project: ordinary navigation
      starts only the installer service; explicit Install/Retry directly requests
      main-thread persistence and then starts transfer; denial continues with a
      degraded-durability warning; accessible telemetry exposes total/planned/downloaded/
      reused/resumed/verified/current-resource and completed-resource progress plus
      cancellation and typed recovery copy; and Launch unlocks only after the current
      page observes the exact target release completion. Retry progress is scoped to
      the current operation, and terminal worker/runtime failures require Reload rather
      than entering a dead retry loop. Its corrected final gate passed 91 files / 854
      tests after the first review rejected those recovery/progress defects. A
      WebDriver-plus-exact-query route preserves existing
      smoke, flythrough, recovery, and app-owned-LLM automation without exposing a
      query-only user bypass. D-135 does not publish/activate the ready release or
      migrate current streaming/model consumers, so the checkbox remains open.
      D-136 is the accepted publication/reload-discovery project: exact transfer totals
      and a complete release verification precede ready marking and active publication;
      installer protocol v2 binds both install/status to the loaded full-SHA
      content-addressed app entrypoint and exposes a fail-closed exact current-target
      query; ordinary reload unlocks Launch only for that active target. Completion is
      cross-validated against ready counters plus transfer/store publication identity;
      late cancellation either wins before commit or reconciles the exact target while
      preserving typed failures; and target discovery has a fail-closed 30-second bound.
      Installer-transfer/public
      telemetry advance to v2/v30 and smoke/flythrough/recovery reports to v56/v23/v19
      with metric sets unchanged. It does not yet migrate consumers, add offline shell
      compatibility/update/rollback/corruption repair, deploy, or provide physical
      evidence, so the checkbox remains open. Its corrected final gate passed 95 files /
      880 tests, and final independent review found no remaining defects.
      D-137 is the accepted consumer-migration project: ordinary Launch carries the
      exact admitted active `releaseDigest` and completes fail-closed model plus
      streaming preflight before exposing runtime UI. District index/cells resolve
      directly from immutable release-store objects with no ordinary fetch,
      provisioning, pruning, or legacy streaming cache; the streaming worker
      independently revalidates the same release and opens those exact objects. The
      five pinned model shards resolve through a zero-network-fallback installed-source
      contract; no ordinary inference UI is added, and authored non-AI gameplay is not
      a storage/network fallback. Only the exact WebDriver-attested automation route
      retains legacy network consumers for existing harnesses. Streaming/public
      telemetry advance to v10/v31 and smoke/flythrough/recovery reports to v57/v24/v20
      with metric sets unchanged. The first independent review rejected per-resource
      manifest reparsing, non-quiescent parallel Launch preflight, split/final admission
      races, and permissive index materials/bounds. The corrected candidate uses one
      manifest/staged read per ordered batch, sequential quiescent preflight, atomic
      initial and post-handle worker admission with cleanup, and strict canonical index
      validation. Its corrected deterministic gate passes 99 files / 896 tests; D-137
      remained proposed for independent re-review. That re-review rejected missing
      semantic binding among cell ID/coordinate/source/resource ID and permissive
      top-level index keys. The second correction centralizes the existing schema-v1 cell
      naming contract across generator/build/validators/consumer and requires exactly
      the six runtime index keys, with hostile swap/extra/missing fixtures. Its
      build/repeatability, type, lint, diff, and full unit gates pass (100 files / 900
      tests); final independent re-review traced the identity through generated `dist`
      and every validation layer and accepted it without further findings. D-137 adds
      no repair, offline shell, update/rollback, deployment, physical gate, or ordinary
      model invocation and does not yet close Installer UX. D-138 is the accepted
      bounded offline-shell project:
      build-manifest v14 binds one stable service-worker artifact and exact generation/
      save compatibility; ordinary explicit preparation fully validates and atomically
      selects a release-bound shell generation with one verified rollback generation;
      cache-first delivery preserves isolation headers and never places OPFS targets in
      Cache Storage; Launch requires shell/target/active-OPFS release equality; and
      offline-shell telemetry v2 and current store/transfer telemetry v3 advance public
      telemetry/reports to v33 and v59/v26/v22 with metric sets unchanged. The first
      fresh-profile Chrome adapter v1
      result is retained failed: its split control wait/inspection evaluations created
      a TOCTOU, and why the later evaluation saw a null controller is underdetermined.
      It makes no Chrome rough-edge claim. First review rejected unsafe pre-commit GC, URL-only worker
      authority, stale Ready admission, old-worker endpoint selection, and mutable
      request correlation; the corrected candidate commits before best-effort GC,
      removes worker URL authority, invalidates stale Ready and admits at runtime,
      waits for the newest worker, and isolates overlapping requests. Second review
      rejected missing explicit stable-worker update, unbound notifications, an
      incorrect `runtimeStarted` boundary, redundant uninstrumented Launch verification,
      and non-truthful admission failures. The current candidate explicitly updates and
      source-binds the worker, defines locked `admit` as the immutable-page boundary,
      performs one instrumented Launch shell pass, and makes failure responses match
      durable telemetry exactly. The controller-continuity correction additionally
      requires the exact activated candidate to control the page, invalidates Ready and
      pre-admit Launch authority on control loss/replacement, preserves the successful
      locked-admit immutable-page boundary, and advances the adapter to schema v2 with
      one captured-controller transaction plus durable bounded diagnostics.
      Controller-continuity re-review then rejected unconditional online worker update
      on offline reload, authority revocation that did not span OPFS preflight,
      endpoint checks dependent on queued controller-change delivery, and an adapter
      that did not bind the manifest worker/canonical generation to ordinary Ready.
      The fifth correction permits only exact active-controller reuse after an offline
      network `TypeError`, synchronously checks control at endpoint post/response,
      carries abortable authority through preflight and locked admit, and requires
      exact online/offline Ready/Launch authority in the fresh-profile adapter.
      Adapter re-review then rejected missing Range transport, cached-shell
      interception, acceptance of preexisting Ready, and setup outside retained-failure
      cleanup. The sixth correction preserves every exact current-release source/digest
      while serving strict `206`/If-Range/completed-`416`, passes same-origin Range GETs
      through the service worker, requires fresh idle plus real UI/transfer/
      store-publication/ready transitions, and protects pending evidence and all temporary
      setup/cleanup. Evidence-lifecycle re-review then rejected timestamp-collision
      overwrite risk, collapsed cleanup failures, and premature exact-link setup claims.
      The seventh correction reserves JSON/Markdown create-only under bounded suffixes,
      retains structured primary plus every cleanup failure and possible remaining
      logical path in both formats, and records validated/linked file-and-byte progress
      with `hard-linked-exact` reserved for a complete pass. Final owned-pair re-review
      then found the Markdown path remained unreserved until terminal publication. The
      eighth correction reserves both create-only placeholders before returning a
      stem, verifies their shared ownership token on every opened write handle, cleans
      only verified partial reservations, and restores both owned artifacts to
      `finalization-failed` after partial terminal publication without touching
      unrelated bytes. Filesystem-identity re-review then found copied-token/hardlink
      path replacement and non-`EEXIST` create-error masking. The ninth correction
      retains the original handles, binds distinct BigInt `dev`/`ino`, regular direct
      type, and link count one to each pathname around every write, treats only
      create-time `EEXIST` as a suffix collision, and retains the original create error
      plus every partial-cleanup failure. Final re-review then found a remaining
      validate/delete pathname race and pass-before-close contradiction. The tenth
      correction never deletes result paths, retains bounded `reservation-abandoned`
      partial evidence, closes both handles independently and unconditionally, retries
      only failed closes, and restores `finalization-failed` before reporting any
      terminal close failure. Descriptor-lifetime re-review then found an unguarded
      first stat, suppressed reopen-validation close failure, and one-shot partial
      abandonment close. The eleventh correction registers ownership immediately after
      `wx+`, aggregates validation plus close while retaining the open handle, and
      boundedly retries only still-open partial handles through a final owned close.
      The retained schema-v2 run then failed deterministically before transfer because
      generation descriptors required `application/javascript` while the ordinary
      local server sent `text/javascript; charset=utf-8` for the first app module.
      D-138 records the exact retained hashes; this is project serving drift, not a
      Chrome finding. The twelfth correction pins `application/javascript` across
      nginx, local transport, deployment validation, generation/cache validation, and
      exact-dist composition coverage; only MIME parameters are normalized. Adapter
      schema v3 adds exact-keyed, bounded, redacted, semantically cross-validated
      UI/telemetry/controller/registration/server/page/service-worker diagnostics,
      partitioned rolling failure/control/lifecycle/network retention, a complete
      canonical server response population plus full path sets for all 283 install
      resources, and one canonical JSON/Markdown terminal binding over state plus every
      diagnostic surface. `passed` requires the derived complete/no-failure projection.
      Unknown, oversized, or
      contradictory observations fail as typed diagnostic-collection errors while
      preserving the accepted result-pair ownership lifecycle. Exactly one
      corrected-artifact schema-v3 adapter run was eligible after
      deterministic gates and independent review converge; no adapter run is part of
      that correction. D-138 adds no repair, update UI, uninstall, deployment,
      production or physical qualification. Its ordering-corrected deterministic
      build/repeatability, lint, and unit gate passes 114 files / 1081 tests; it does not
      close Installer UX or M2.
      State-contract re-review further splits failures into exact offline-shell,
      installer, runner-online, and offline-reload branches, pins every diagnostic
      protocol enum independently, binds runner-online and offline-reload validation to
      the exact pre-offline Ready UI/button/store/transfer/shell/release/generation
      authority, and derives server completeness, populations, path sets, tails,
      counts, and digests as exact projections rather than summary claims. Offline
      failure requires an immediately adjacent, failure-free checking edge with the
      same strictly positive attempt and generation; attempt zero is pre-attempt only.
      Complete monotonic response/Range/failure sequences make every rolling tail an
      exact ordered suffix, including duplicates.
      The retained schema-v3 run then reached its fixed 600-second Ready timeout while
      still live: 253/262 resources and 2,621,395,425/2,621,430,227 planned bytes were
      complete, leaving 34,802 bytes with zero transport, validator, integrity, server,
      or app-reported failure. D-138 retains its exact JSON/Markdown/binding hashes and
      adjudicates this as project O(chunks × inventory + resources × inventory) store
      bookkeeping, not a Chrome finding. The thirteenth correction replaces per-chunk
      recursive store scans with lock-held affected-entry inventory updates, retains
      authoritative open/reconcile/GC refresh, and exposes monotonic final-release
      verification progress through install-store/installer-transfer v3. Adapter schema
      v4 replaces the fixed wait with a 120-second monotonic-progress watchdog and a
      30-minute absolute correctness ceiling, retains terminal causes and exact
      persistence-denial semantics, and binds the liveness evidence in JSON/Markdown.
      The ceiling is not performance allowance; bandwidth plus at most 90 seconds local
      work remains the install budget. At that correction boundary one
      corrected-artifact schema-v4 run was eligible only after deterministic gates and
      independent review; no adapter run was part of the correction. The fourteenth
      correction makes each nonsettling observation
      independently deadline-bounded, canonicalizes and revalidates cause redaction,
      caches the exact immutable manifest/resource map across hot-path mutations,
      derives `adapter-v4-*` stems from schema, repairs live inventory/selection before
      surfacing exceptional failures, and requires exact store/transfer/UI
      final-verification equality plus release-total-complete Ready. Actual-operation
      stress gates cover 400 checkpoints and 200 resources without hot-path manifest
      validation or recursive inventory scans. No browser run is part of this
      correction. The retained schema-v4 run completed ordinary Ready plus online/
      offline lifecycle inspection but failed result finalization because the generic
      POSIX local-path redactor rejected typed leading-slash server-response URL paths;
      its duplicate cleanup item came from a second diagnostics close. The fifteenth
      correction adds a field-scoped canonical same-origin pathname sanitizer/validator
      without weakening generic redaction and makes diagnostics close single-attempt
      with only distinct actual cleanup failure retained. The one post-review
      corrected-artifact pair
      `adapter-v4-2026-07-30T00-02-06-305Z.{json,md}` passed with JSON/Markdown
      SHA-256
      `10b5ad394182d6114e99e0eb0cc4347735fc5854dff0cb84ff178b0812f9c1af`/
      `3177e40fff6118a81ea3a69be11bb1304a636ddf056443c32ae56dcc769f4cc2`
      and canonical binding
      `09027941aaafde516ee6d9f70bf96cb3d80c33bafc8ac4da43cb5fd19d6de3f3`.
      The 142,089 ms lifecycle reached ordinary Ready in 131,945 ms, with a 27,299 ms
      maximum progress gap and 4,009 ms terminal gap; exact final verification covered
      all 2,621,430,227 bytes and 262 resources. All 283 server paths were covered
      across 297 responses, including 262 Range responses and zero failures; exact
      online/offline Ready, generation, release, shell-cache, control, manifest, and
      isolation authority matched. Persistence was denied and the UI truthfully
      continued in degraded-durability mode without a durability claim. Independent
      final review accepted D-138; every failed v1-v4 pair and adjudication remains
      immutable. The current build/repeatability, type, lint, diff, and unit gates pass
      115 files / 1105 tests. D-138 closes only the separate service-worker offline-shell
      checkbox below. D-145 and D-146 subsequently complete the repair/update,
      persistence/quota-failure, browser-restart-offline, and interrupted-update
      qualification that kept this umbrella item open. Installer UX is complete; the
      independently listed scale and M2 exit gates remain open.
- [x] PSO trace capture + progressive warmup at boot; verify Dawn cache behavior
      launch-1 vs launch-2. Accepted D-139 implements the deterministic product and
      evidence contracts: build-manifest v15 binds one content-addressed
      `pso-warmup-trace@1` asset-pack in the exact installed release; ordinary launch
      verifies it from OPFS; the render worker independently revalidates and replays it
      progressively before Ready/first frame; and telemetry v34 records compile,
      deferral, registry hit/miss, identity, duration, queue, and failure evidence.
      Smoke schema v60 / mandatory metric set v28 makes exact replay mandatory, while
      the separately triggered `pso-warmup-launch-pair@1` consumer independently binds
      exact report/build/source/browser/machine/target/trace identity and requires three
      ordered fresh/warm D3D12 lineages with conserved fresh misses/warm hits and zero
      measurement-window overlap. The final deterministic gate passes 123 files / 1233
      tests. Registered dev-01 Showcase smoke
      `smoke-1-8f3ae8585efe-dev-01-showcase-2026-07-30T04-17-04-822Z.json`
      (SHA-256
      `1ec8212e2c5ef332dcdfdb6415b50cde03f4b0f28226be561d82433eee9f2562`)
      passed exact artifact/release identity, all six launches, all three facets, and
      30/30 checks. Its retained launch-pair JSON/Markdown passed with SHA-256
      `d63fb00c0a5b8752f017085a3fd2ac7fc5c9645d9b9974167af677121d521fb8`/
      `c464f51bb74edfd9c7e701524ae61eca4dc359615967481682134149b81f9237`.
      Each fresh lineage had 2 graphics-PSO and 4 shader misses; each paired warm launch
      had the conserved 2/4 hits, with zero opposite counts and zero gameplay overlap.
      Independent review recomputed every identity and accepted the evidence. The two
      earlier qualifier failures remain immutable and are adjudicated as one invocation
      error and one corrected render-surface-tolerance contract defect. D-139 adds no
      production deployment or Standard/Metal claim; Installer UX and M2 remain open.
- [x] Keep V8 code-cache lifecycle evidence as best-effort attribution
      (current `compileStreaming`, 304/immutable discipline; retained D-144 evidence
      used `instantiateStreaming`). D-144 accepts
      `asset-update-v8-lifecycle@2`: on one persistent dev-01 Showcase profile the exact
      two-resource, non-executable update downloaded 72,759 bytes, preserved executable
      identity, verified all 263 resources / 2,621,434,134 bytes, and retained exact
      store/shell/Ready/Launch authority. Fresh, pre-warm, and post-warm launches measured
      6,098.435/5,831.760/5,748.105 ms; both paired warm launches passed the unchanged
      <=10 s gate and signed post-minus-pre delta was -83.655 ms. The relative threshold
      remains explicitly unset. Best-effort traces were lossless and measured zero
      pre/post re-production across six cacheable scripts plus exact
      `instantiateStreaming` use, but do not prove cache hits. The final schema-v61 /
      metric-set-v28 production smoke passed all six launches, all three facets, and
      30/30 checks. This closes only the V8/asset-update item; Installer UX and M2 remain
      open.
- [x] Service-worker offline shell (D-015): precache, cache-first navigation, atomic
      activation + rollback, COOP/COEP preserved on cached responses, version
      compatibility checks (shell/engine/manifest/save schema). Accepted D-138 and its
      passing schema-v4 browser-adapter evidence close this bounded project without
      closing Installer UX or M2; the retained failed v1-v4 evidence remains immutable.
- [x] Installer trust + crash-safety (architecture.md contract): hash verification of
      every bundle, atomic version switch, resume/rollback on interruption,
      repair-by-refetch, persist() denial and QuotaExceededError flows, best-effort
      space preflight with quota-error-aware incremental writes.
      D-145 replaces the active trust-fault qualifier's exact internal-event topology
      with bounded ordered raw browser telemetry plus claim-relevant semantic outcome,
      authority, resource, accounting, recovery, and cleanup invariants. Schema v12
      retains the accepted raw prefix and one separately bounded rejected sample with
      trusted production provenance and canonical JSON/Markdown evidence; schema v5
      success evidence is unchanged and schemas through v11 remain backward-only. The
      retained schema-v11 physical pair remains failed because a legitimate equivalent
      planning publication was rejected by the old proof model, not because of a
      product or Chrome fault (JSON/Markdown SHA-256
      `df4b0eec4bffca1a8c5df7090950bc497b8fc0a01ada1129bc1f148b019ecb98`/
      `1cd11af1a69a5c1140fd076172d3a7bc2488fd9a0512079a8b0915e42a157697`;
      canonical binding
      `6c8d1421623dd1e042c58ea9facdb5b79546217bae08db16e67f159c4acf34d6`).
      The first schema-v12 physical pair remains failed before cell 1 because an
      unexpected qualifier queue exception escaped without setting structured state
      and the barrier discarded that exception while relaying `null`; no product cell
      or Chrome behavior was evaluated (JSON/Markdown SHA-256
      `735e5538670810fee79849a5635b9d49e643ad41cacea62daefcfbe651ecb0ca`/
      `46372de222531f8a0181544129ee0bb7386cd1bbf1608e10e1231a4409669843`;
      canonical payload SHA-256
      `aeaa68f1e92f02d62e07c89042112f30f379b920f44695a84b196a08aa066535`).
      The reviewed correction makes malformed binding outcomes typed and preserves a
      bounded/redacted queue-internal cause instead of losing it.
      The corrected schema-v12 pair also remains failed before cell 1, now localizing
      the defect to the structured page↔Node acknowledgement envelope at seed order 6;
      the Node recorder accepted the raw observation, so no product or Chrome fault was
      evaluated (JSON/Markdown SHA-256
      `edc1177d8056f38507b3b36baba65a6bc6f2055306b9a10933f215525e30b769`/
      `074d1a018249c71dced756e707d7c3da621f97dfa0a5a0b74d66a64e9af3abb6`;
      canonical payload SHA-256
      `1f5c0652eafba0987fdf9f90907b61d0f15258a721db8aa19c3d2c06f864c7e6`).
      The boolean-only follow-up pair also remains failed before cell 1 at the same seed
      order 6 after order 5 was accepted, proving that the live per-event callback
      acknowledgement itself—not its structured envelope—was the wrong boundary; it
      evaluated no product or Chrome behavior (JSON/Markdown SHA-256
      `36548dea73d28443045b24acd2f5d55797dcf55f15a9d672aa7330593129b5b8`/
      `7de009806d2d70a1f190cfd6f76325770ec3e22d080e5689fe1990c9445cd092`;
      canonical payload SHA-256
      `0b1730306f5f19f674b1e045042b3e2b6f64cf70769fadb2cbcae2927bb1204b`).
      The active correction removes the callback and acknowledgement entirely: the page
      retains aligned raw observations and projected transitions, and the existing
      clear/phase/seal barrier atomically hands each batch to the authoritative Node
      recorder before milestones or progression. Capture failures remain typed and fail
      closed; no replacement event topology or publication count is introduced.
      The first barrier-batch pair remains failed before cell 1 because its deferred
      durability-warning DOM capture failed at `retain-seed-transitions`; this is
      qualifier capture drift, not a product or Chrome result (JSON/Markdown SHA-256
      `235469d11cfc84d35c872e807c7afed2a23d320d95ab7dc18ad326a2a5684a85`/
      `0820d1cac262adee3d8afea352f22175df025c67fdf9880aec1390225b0320d8`;
      canonical payload SHA-256
      `2deae28de4209518625df2955d1acfd15a7737d37b8b7448619f00764c3b640d`).
      The correction removes that deferred layer: the transition stream records the
      event-time persistence classification synchronously, while the existing dedicated
      persistence recorder remains the sole verifier of the actual rendered warning.
      There is no pending queue, timer, later DOM read, or product-byte change.
      The next synchronous-capture pair validated 168 ordered seed observations and then
      failed only the 450,535-byte accepted-prefix ceiling before cell 1; no product or
      Chrome behavior failed (JSON/Markdown SHA-256
      `5ffb2bfeaefdad2810d00717d07e9b19897132a399a44eae987b8a4f590cada8`/
      `10267bf69d8cb3c3ee4380765450bd0591cdad6949374d88e1153e28cac9cb4f`;
      canonical payload SHA-256
      `331dfd2435c2fa2e596faa1d336686ca1066a94b8b3734388ddd757dde42a899`).
      The attempted larger envelope then retained a `finalization-failed` partial
      reservation after 750 seed observations because its 6.5 MiB JSON exceeded the
      shared writer's 4 MiB readback boundary; it is not a terminal pair (JSON/Markdown
      SHA-256
      `3c368febc1ba8d6597abe06aac4ce4bd29136f9e813f9c87d559c9f518fa045d`/
      `1e773d08d4359d38323dae99ec9f741120cf7a755d395faa017f82854eaedf6a`).
      The active correction restores the original 524,288/450,535-byte bounds and
      retains a bounded exact store/publication and transfer/failure projection; the
      measured 750-event seed compactly occupies 341,088 bytes. Full cell/terminal
      snapshots and historical full-telemetry evidence remain independently valid. The
      shared immutable writer's readback ceiling now matches the pre-existing 8 MiB
      trust-report limit; no product predicate, publication count, or product byte
      changes.
      The compact-retention pair then validated 990 ordered seed observations for the
      first `reused-object-corruption` cell and reached the unchanged accepted-prefix
      ceiling; no cell invariant or Chrome behavior failed (JSON/Markdown SHA-256
      `fa1eee3253eef4bace71c15d58dfd34026b9123b8c5c258029f81c5b6ded2709`/
      `2be6d17a840d2916bc7f6dbb0833ff32919552b4ae783aaa01636f75c683ecb9`;
      canonical payload SHA-256
      `c1b47f2710339f66f8ac6d0ac548fe1082c74f6057f9939d41796e6183719c33`).
      The reviewed bounded-evidence correction advances only the nested raw-observation
      evidence to schema v3 while leaving the outer schema-v12 result and schema-v5
      success contracts unchanged. Complete ordered validation, transition-proof
      accounting, and full-stream SHA-256 now continue through all accepted observations;
      failure diagnostics retain a byte-bounded prefix, rolling immediate-predecessor
      tail, exact accepted count, retained-window digest, full-stream commitment, and one
      separately bounded rejected sample. Historical raw-evidence schema v2 remains
      backward-valid. Focused adversarial coverage passes beyond the former 990-event
      ceiling and still rejects a later semantic violation. The converged deterministic
      gate passed 149 files / 1,863 tests (one skipped). The first bounded-evidence
      physical pair then retained 5,785 valid seed observations and rejected only the
      exact verified-store publication handoff before the worker/UI Ready acknowledgement;
      direct product tracing confirms `verifyRelease` → `markReleaseReady` → atomic
      `publishRelease` → worker Ready, so this is another qualifier ordering defect, not
      a product or Chrome failure (JSON/Markdown SHA-256
      `738d2597af2e2af916ea79cd70ca63a1fb498d268f9569f4615e610a1a532bb2`/
      `11ab8cf6b9fe4cd6a30a966429fd3513f7cbc0b12a6744e1e69a17d6d964385b`;
      canonical payload SHA-256
      `3c54f908bec1885ee5e80c246cc35e21ff53a544505089ca008bb37ec4298374`).
      The reviewed correction permits only that exact handoff—store Ready, exact active
      release, transfer verifying, UI installing, and no shell/UI release authority—while
      still rejecting premature/wrong publication and every failure-phase publication.
      Its corrected deterministic gate passed 149 files / 1,864 tests (one skipped). The
      next physical pair completed the first five cells, then the active raw validator
      accepted the next typed quota failure while the legacy aggregate finalizer rejected
      the safely idle store as a contradictory transfer failure. This again evaluates no
      product/Chrome defect (JSON/Markdown SHA-256
      `573824c6517c5e5c78db3a0376114942c4d5bd7d2e048527805bcb8945826f01`/
      `226beac9b3b3260f4061dacc8d43c715cf7acae907be977fddf7f8756614020b`;
      canonical payload SHA-256
      `29f87eceacf25e67c2bc3700102cd2e30bb7294a0157e1a34a563bb6b47a907e`).
      The reviewed redesign keeps schemas through v11 on their historical topology
      validator but routes active schema-v12 raw proofs through structural/hash/accounting,
      authority, phase, typed-outcome, and terminal-verdict semantics without reimposing
      incidental store states or planning milestones. Independent review is clean and the
      retained failed pair validates under the corrected code.
      The next physical pair completed six cells, then rejected a legitimate mixed-time
      attempt-2 handoff while the UI requested persistence and worker/store telemetry
      still exposed the exact attempt-1 quota failure. This is a qualifier snapshot
      defect, not a product/Chrome failure (JSON/Markdown SHA-256
      `dc62c17f9f5eb3cf1e7d4ce220c0493bed190243615929628c75c5706b64875c`/
      `084c6d19ec362def7d53528f33e252ab9cfb84677a2cc6a53b75cf0d0a5a1402`;
      canonical payload SHA-256
      `1b426e3a3aab2d9c47890f94058c37715ac28fc463d7190d48b6e385140006df`).
      The reviewed redesign validates telemetry-native publication and exact structured
      fault safety on every sample, but defers cross-clock UI/worker equality and phase
      outcome to explicit barriers. New active proofs are schema v3 with exact
      phase-final barrier witnesses; current schema-v12 passing evidence cannot downgrade
      to v2, while the exact immutable failed 18:44 pair has a closed historical
      validator. Exact prior-attempt quota telemetry remains diagnostic only until the
      next barrier; every state/authority/fault mutation and stale Ready barrier fails.
      Independent correction review is clean. The converged deterministic gate passed
      repeatable build, typecheck, Biome over 367 files, 149 test files / 1,901 passing
      tests (one skipped), and `git diff --check`.
      The resulting physical pair again completed six cells and retained the exact
      mid-append attempt-2 sample, proving the remaining rejection was a qualifier
      semantic error: transfer `activeReleaseDigest` was the exact operation target
      while store publication remained null, but the harness required both to be null
      (JSON/Markdown SHA-256
      `fcbffb29215727a5ade03f2d695718bb0217881ece4e08c1483960d99857a969`/
      `b51586b9b0b81a99bbf2efea950b5de80fc22bb967c2858249baced7841c68ac`;
      canonical payload SHA-256
      `1df333d70c1f988d10f7416d17c6c7633389cc496999e54335ab5caab029c7fe`).
      Authoritative worker source confirms transfer identity names the operation target;
      store identity alone names publication. The reviewed correction requires exact
      transfer target, null store publication, both failed states, and the exact quota
      tuple, while every identity/state/diagnostic mutation and stale Ready barrier
      rejects. The corrected deterministic gate passed repeatable build, typecheck,
      Biome over 367 files, 149 test files / 1,902 passing tests (one skipped), and
      `git diff --check`. The corrected physical pair passed all eight cells with exact
      artifact/release/browser/source identity, proof-v3 phase barriers, complete cleanup,
      and no failure (JSON/Markdown SHA-256
      `7cc0cbaf170d11c1444016c07b8059eecdfde8d1b7c7b9de02cbdcf620e797d4`/
      `df0014b4c5245ea1f38efcb35d3234bcbe7610b3302333f88a982d58c7bfae8e`;
      canonical payload SHA-256
      `fa641190100ef324eb60c4ca8e6a7834b1cbdfe95effbe4ea2ddc516e80c7ff4`).
      Independent evidence review is clean. This closes only Installer trust +
      crash-safety; remaining M2 items stay open.
      The runtime correction required by the later offline suite changed shipped bytes,
      so one exact-current-artifact trust refresh passed all eight cells under schema
      v12 (D-146; JSON/Markdown SHA-256
      `7316cab2603750f4a25108d848640ca1e1fbe52b81647b5a360c17a6cb992637`/
      `75b3dca9cf2ed9568382897b1ec337b045d56da05f680e1ba7d2347c1a20adf4`,
      canonical payload
      `1db69917ce7963f05b0c95ddc1dfa10debb7cc9d4dc4753d9ced13ed86769e8c`).
- [x] Offline fault suite: offline hard reload, browser restart offline, corrupt-cache
      recovery, interrupted update, disk-full injection. D-138 supplies the accepted
      hard-reload evidence and D-145 supplies the accepted disk-full/quota cells. D-146
      adds the bounded three-cell `offline-fault-lifecycle@1` qualifier and corrects a
      real controlled-client split-authority defect with exact network-first installer
      target discovery plus verified offline fallback. Five immutable failed attempts
      distinguish four qualifier defects from that product defect. The single post-fix
      physical pair passed interrupted update with exact 8 MiB resume, a separate-process
      stopped-origin restart with zero network requests, and fail-closed corrupt-cache
      rollback followed by exact online refetch/recovery. It binds current artifact/release
      `29616033e34061fa9da270bd99aae657c392e1bf34d154de2574ce6bde7d5179`/
      `2dc78203a4fa1cf7ae6e9f2a131507b4db113f90d7b7e1c00e1fa68855f15914`;
      JSON/Markdown SHA-256 are
      `7f55441d0c57972941746f321683d82c71407c527846b41ec7cea18d928a965e`/
      `233aac8c2ca6a292ce0ce6331fee74acbf57ad3d2bd0d5f888a3ccc8cd318adf`.
      Exact post-validation and cleanup passed. D-147 completes Uninstall next; M2
      remains open.
- [x] Uninstall path (D-024/D-147): in-shell uninstall behind explicit confirmation with
      save-export offer; both mechanisms (client-side storage teardown, static
      `Clear-Site-Data` endpoint) built and measured for actual coverage — OPFS,
      service worker, code cache, Dawn cache — and quota release; gaps logged in
      rough-edges.md. The save control truthfully reports that no save subsystem or
      exportable progress exists yet. The accepted schema-v3 physical pair uses distinct
      Chrome processes/profiles, clears unique nonempty OPFS, service-worker, Cache
      Storage, and IndexedDB sentinels in both arms, and proves positive quota release.
      The static arm binds a completed direct-network status-200 `POST /uninstall` with
      exact `Clear-Site-Data: "storage", "cache"`; the stable worker deliberately does
      not mediate that endpoint. Artifact/release are
      `b4085ad29b37afe696653687d7433f1de7ab21380e8fc86748fcd209f8d06544` /
      `1b20e95ee4b28a968c077f11b73f36077b66258c0df07556e7a06bd7bee81a14`;
      JSON/Markdown SHA-256 are
      `3a4f177af4d6b12dce9b2063ef09c9f1b75e2485751c236487c9f24864d32e9b` /
      `63be4b24077caebd6b89fcdbf78598f94763b396c4a77a2c497ed8eb131606a4`.
      HTTP, V8, and Dawn cache eviction was probed but remains unobservable (RE-046),
      not falsely claimed cleared. Scale tests close below; M2 remains open.
- [x] Scale tests, two corpora (budgets.md, D-009/D-018/D-148): the deterministic
      model generates a ≥100 GiB document that the production install-manifest parser
      accepts; the parser summary supplies its exact resource count and byte total,
      while the document hash supplies manifest-level release identity. Comparisons
      describe a one-resource update and a source rotation at the manifest level only;
      they execute no 100 GiB transfer, integrity, update, cleanup, or eviction path.
      Actual installer mechanisms retain their separate bounded M2 evidence. The
      accepted representative stream model covers
      165,505,371,388 bytes / 71,680 resources and its physical target materializes
      2,623,040,066 bytes; accepted JSON/Markdown SHA-256 are
      `e2a2028b548e27934ea5a6365cb4f9ce690dca8b7a9bcf5cf8b4fb2dbd5833b2` /
      `243c31b2e430cc7db720257b8d2b592ed7ab6ff0611bffef38ac73ccd1def910`.
      Current Chromium source and the local 1,998,819,684,352-byte C: volume imply a
      nominal ~1.199 TB per-storage-key ceiling before storage pressure/free-space
      effects, so D-148 retires the literal physical 100 GiB write qualifier. This
      closes the size-independent install-manifest architecture floor and
      representative-streaming scale item, not literal 100 GiB execution or guaranteed
      capacity on every machine: reported quota is not admission authority, and actual
      bounded transfers—not the model—remain resumable and `QuotaExceededError`-aware.
- [x] Exit lifecycle evidence (D-150/D-151): the accepted dev-01 Showcase
      `asset-update-v8-lifecycle@3` pair
      `asset-update-v8-v3-2026-08-01T19-10-36-547Z.{json,md}` binds CfT
      151.0.7922.71 and exact artifact/release
      `e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
      `be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`.
      Its 99,359.9553 ms initial install comprised 21,286.798001527786 ms exact
      installer-worker network-active union and 78,073.15729847222 ms local critical
      residual, within the unchanged 90-second allowance; final-verification's
      first-observed span was 16,232.9675 ms at 20 ms polls. Fresh installed launch was
      5,821.355 ms (≤30 s); pre/post warm launches were 9,157.250/5,681.140 ms (both
      ≤10 s), with signed delta −3,476.110 ms. JSON/Markdown SHA-256 are
      `a7060701006fbcea03b26dd6281eee4d2e9d0b66fd176d4766a3e716489a83d6` /
      `c9e1d7723e9c83149bb43136dbb598a77d048b6bfc5a378deccfea5b0f868ee8`;
      exact authority and post-validation passed. V8 diagnostics remain non-gating and
      make no cache-hit claim. This closes the exact-candidate dev-01 lifecycle evidence
      clause. At the D-151 boundary the independent D-149 transition, final production
      smoke, branded-Stable parity, and nginx/deployment gates remained open; D-149,
      D-152, and D-153 now record their completion. Other-machine lifecycle results are
      exploratory (D-150).

**M2 closure evidence (D-153):** every checkbox above is complete. The final exact-current
CfT 151.0.7922.71 production report
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-02T00-30-12-454Z.{json,md}`
binds source `7fdc5465b5903751301a4e319a160848eacefac6` /
`95a0fa40b928d2a2ba5a98b8481a66a1d174925a8399d5dd0a9b722fe707a48e`,
artifact/release
`e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
`be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`,
and JSON/Markdown SHA-256
`6028aa225b14e6c32398ead849dc00784f075c4b410e61a336376b970e105a8e` /
`1b00d8746308e0297d93f7e68c1c14cb8f0437d2832249efe7029a2328e02a20`.
Exact pre/post production identity, versioned MIME/isolation, registered dev-01 physical
and sandbox identity, rendered output, all six launches, all three facets, and 30/30
checks passed under schema v62 / mandatory metric set v28. D-149 retains the passing
same-source `.34`/`.71` transition; D-152 retains the passing branded schema-v2 parity
result and both immutable v1 harness-contract failures. The baseline is untracked, the
branded result is ineligible/nonpromotable/not budget-authoritative, and no
other-hardware claim is made. The exact production artifact is deployed with the five
model objects preserved and the versioned nginx config installed (`image/ktx2` for
KTX2). Final deterministic closure gates preserved repeatable build output, linted 422
files, passed 2,274 tests across 172 files with one skip, and passed
`git diff --check`. This evidence-only closure changes no runtime, harness, budget, pin,
or evidence contract and requires no new physical run (D-119).

**Post-closure M2 process correction (D-154):** `smoke@1` schema v64 / mandatory
metric set v29 prospectively retains the bounded three-fresh/three-warm streaming
cell-load p95 range as an informational diagnostic rather than mandatory evidence.
The diagnostic calculation, validation, and report visibility are unchanged. Every
launch still requires valid finite streaming evidence and the unchanged 250 ms p95
budget, all 30 budget checks remain, and flythrough/public-benchmark repeatability is
unchanged. The immutable schema-v63 production attempt
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-26-10-326Z.{json,md}`
completed all six launches with verified production pre/post identity but failed only
because fresh/warm diagnostic spreads of 1.1499998569488525/1.2650001049041748 ms
exceeded the 1 ms allowance; it remains failed evidence and is not relabeled. A new
schema-v64 production-target gate is required before accepting a later candidate under
the corrected prospective contract.

The first schema-v64 production attempt is retained failed after the host changed during
the run to a remote display session; it is environment-invalid evidence, not a candidate
failure. After the physical console was restored, the one adjudicated corrected report
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-53-48-499Z.{json,md}` passed with
JSON/Markdown SHA-256
`fa88dcb2f14d4608e02a53dbc5bb7951508a79670aa418eaba755c64e21ac9b0` /
`71fa1951e038968a9216bab1e64a5883e42dbb43918a9371669534cb1560e990`.
It binds source `7fdc5465b5903751301a4e319a160848eacefac6` /
`e007e3389eea6f26d4f3e498360683fda9de47dc766a1db235bc0e89fe9164a1`,
artifact/release `2404befc4e5d0e2faa0c75c8e9893fe0c5c93ba57589698b4edf648525c1e9bb` /
`61d3c12f08737f3dae8756da14c2d7e1b1191e249a5a9005500af34c69e5e785`,
exact production pre/post identity, registered dev-01 Showcase and CfT 151.0.7922.71.
All six launches, all three facets, and 30/30 checks passed under schema v64 / mandatory
metric set v29. D-119 makes this an evidence-only recording with no further physical run.

## M3 — Gameplay core + NPC AI  `pending`

- [ ] Sim worker: fixed timestep, input-commands, snapshot interpolation, save/load.
- [ ] Character controller, camera, basic interaction loop in greybox D1.
- [ ] NPC navigation and crowds (D-140): navmesh generation over streamed district
      geometry, pathfinding, and avoidance movement adequate for village NPC schedules
      (game-design.md); runs in/beside the sim worker under the same determinism
      constraints as all sim state.
- [ ] UI substrate spike (resolves P-008): measure whether main-thread DOM/CSS over
      the worker-owned WebGPU canvas can carry each UI surface class — world-anchored
      elements, event-rate HUD, heavy screens — against an in-canvas comparison arm,
      with predeclared per-surface verdict criteria and a hybrid split as a
      first-class outcome. D-143 is the binding experiment contract (probes,
      thresholds, bounds, cleanup). **Unblocked now:** no dependency on other M3 work;
      it may run as its own work unit before this milestone formally opens (once the
      in-flight M2 unit commits — one stream of work at a time), and must conclude
      before the dialog-presentation work below starts.
- [ ] UI technology stack (D-141): build the shared UI substrate the spike verdict
      selects, before the first real screens exist. The DOM bet's payoff — free
      accessibility, IME, subtitles, and the translation surface infinite
      localization needs — applies wherever DOM wins the per-surface verdict. HUD,
      dialog presentation, journal, inventory, and settings/remap all consume the
      outcome.
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
      (same input log → same state hash) by repeated same-host replay on pinned dev-01.
      Cross-machine replay remains advisory research for future P2P and cannot block
      exit (D-150).

## M3.5 — Gameplay systems  `pending`

The mechanics that make the slice a game (D-141): game-design.md promises D&D-tradition
combat, magic, monsters, progression, crafting, and quests, and vision.md's bar is "no
system is toy-grade" — but none of it existed as plan items before this milestone. Same
working model as M4.5: heavily iterative human+agent exploration, greybox-first
(capsule monsters and placeholder effects before art), with every system living in the
deterministic sim worker so the M3 replay/determinism checks extend to all of it. Scope
is slice-scale: deep enough that each system is real, small enough for a two-district
demo. The detailed ruleset is designed as this milestone's first track and recorded in
game-design.md — not invented ad hoc inside each system.

- [ ] Ruleset design pass: expand game-design.md from one genre paragraph into the
      slice-scale mechanics spec — combat loop shape, magic model, stat/ability/
      progression scope, crafting depth, loot/economy scale, quest structure — with
      original names and mechanics text throughout (no D&D-protected material).
      *Note: ruleset v1 was drafted 2026-07-29 ahead of M3 (D-142) because the M3 sim
      data model depends on it; the box stays unchecked until M3.5's iterative
      balancing has actually consumed and validated it.*
- [ ] Combat foundation: melee/ranged/magic resolution, hit detection, damage/status
      model — all sim-worker state under the M3 determinism constraints, with player
      intent flowing through the input-command pattern like everything else.
- [ ] Creature/monster AI: perception, aggro, combat and flee behaviors layered on the
      M3 navigation work — the behavior tier, distinct from LLM dialog. Monster body
      types also feed requirements to the M5 character pipeline (game-design.md
      implication #5).
- [ ] Progression: stats, abilities, leveling on the sim data model — save-schema
      versioned like all sim state.
- [ ] Items, crafting, economy, loot: the systems on top of the M3 item/economy data
      model (game-design.md implication #4).
- [ ] Quests and journal: quest state machine (main arc + side quests) and the journal
      as a queryable play-history log — the same log that feeds the Summarizer-recap
      feature and subtitles/localization.
- [ ] Exit: the greybox loop is a game — fight, loot, craft, level, and complete a
      multi-step quest end-to-end; all new state survives save/reload and hash-matches
      under the deterministic same-host dev-01 replay check; the harness gains
      gameplay-scenario coverage (extend the flythrough or add a scripted combat
      scenario — extending the harness is part of the task). Cross-machine comparison
      is advisory research, not an exit gate (D-150).

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

## M4.5 — Environment rendering technology  `pending`

The rendering-feature research program (D-140): build — or rule out — each
environment-scale rendering technology the M5 art pass and M6 VFX pass will stand on.
This milestone is deliberately different in texture from M0–M4. Each track below is a
**heavily iterative exploration, humans and agents working together**: prototype
competing approaches, measure what they actually cost, weigh cost against visual payoff
and both project goals, and converge on a conclusion. Tracks are bounded spikes in the
P-002 tradition — each ends in a decision-log entry that adopts an approach (with
harness-measured cost), rules it out, or defers it, usually with rough-edges findings,
since most tracks press directly on WebGPU gaps (no ray tracing, no mesh shaders, no
bindless, no platform upscaler — goal-1 territory).

**No pre-set budgets (D-140).** Unlike prior milestones, these tracks do not start from
budgets.md allocations. Costs are discovered first; budgets are calibrated afterward
through decision entries (the existing budgets.md recalibration model, run in discovery
order). A track is not done until its adopted approach has measured cost and a recorded
conclusion, but no track fails merely for busting a number that was never set.

Ordering is dependency-driven: lighting first (everything else is lit by it), then
terrain/materials (everything sits on them), then the rest as capacity allows; tracks
may run concurrently where they don't share substrate.

- [ ] Lighting foundation: dynamic time-of-day sun/sky lighting, shadow strategy
      (cascades plus local-light shadows), and a global-illumination approach that
      works under fully dynamic lighting (game-design.md implication #1). Includes
      local dynamic lights — fire, torches, magic — whose flicker, range, and
      shadow interplay are signature moments and a known hard problem at
      many-lights-at-night scale. WebGPU has no ray-tracing extension; whatever
      technique survives here, the gap analysis is a headline finding.
- [ ] Sky and atmosphere: day/night sky, volumetric clouds, height/distance fog, god
      rays, aerial perspective for the mountain vista — driven by the weather states
      already bound at M1.
- [ ] Terrain: instruction-set-driven procedural terrain — placements and features are
      authored and deterministic while the terrain itself is generated rather than
      fully modeled (install-size research angle: generate at install/runtime instead
      of downloading; ties to M2). Includes terrain materials/splatting and integration
      with the streaming-cell and collision contracts (D-090).
- [ ] Procedural materials: generated stone, wood, brick, mud, clay, straw — plus
      metals through the standard PBR path; the generate-vs-bake trade-off is measured
      against both install size and frame cost.
- [ ] Vegetation at district scale: trees, plants, grass instancing/LOD — including the
      shared wind system that must later also drive cloth, smoke, flags, and rain slant
      (one signal, many consumers; designed here, not per-feature).
- [ ] Water: rendering first (ocean waves, lake/moat surfaces, rain, puddles,
      wet-surface response), with simulation (buoyancy, splashes, flow) scoped as
      explicit options costed separately — rendering and simulation are different cost
      classes and may reach different verdicts.
- [ ] Reflections: SSR and/or probe strategy for water, wet streets, and metals;
      interacts with the lighting track.
- [ ] Post-processing and image pipeline: TAA and a temporal upscaler (no DLSS/FSR
      equivalent exists on the web — building one is both necessary and finding-rich),
      bloom, depth of field, motion blur, tonemapping/color grading, HDR canvas output.
- [ ] Transparency/OIT and decals (puddle edges, mud, moss, wear).
- [ ] GPU-driven rendering: compute culling and occlusion (the castle-on-a-hill vistas
      make occlusion pay), indirect draws; document the mesh-shader/bindless gaps.
- [ ] Virtual texturing / texture-residency streaming alongside the geometry streaming
      system.
- [ ] Exit: every track has a recorded adopt/rule-out/defer decision with measured
      costs; adopted features run in the standard flythrough across the
      weather/time-of-day states; budgets.md is recalibrated from the measured results;
      rough-edges captures each platform gap encountered.

## M5 — Art pipeline + District 1 art pass  `pending`

- [ ] assets/ pipeline live: Flow-derived reference sheets → Blender-agent generation →
      QA gate → library; kit-of-parts + trim sheets for D1's style.
- [ ] Character rendering and dynamics tracks (same explore-and-decide model as M4.5,
      D-140): skin shading with subsurface scattering, eyes, hair and fur, cloth,
      muscle/skin deformation, and movement (IK and procedural animation layered on the
      Babylon animation system). Sets the visual bar for multiple rigged body types
      (game-design.md implication #5) and the "NPCs not blindingly distinguishable from
      players" aspiration.
- [ ] Animation content pipeline (D-141): locomotion, combat, and schedule/idle
      animation sets across the multiple races/monsters body types — retargeting
      and/or AI-generated motion through a QA gate; a distinct toolchain problem from
      mesh/texture generation. M3.5 combat runs on placeholder animation until this
      lands.
- [ ] Swap greybox D1 to final art without regressing M1/M2 budgets (the real test of
      the pipeline). Add D-115's deferred deterministic visual-diff gate for no visible
      pop at the 12 m/s traversal/LOD contract against representative art; M1
      checkpoints established streamed ownership/non-blank output, not this claim.
- [ ] Exit: D1 fully art-passed, all budgets green, install size within budget.

## M6 — District 2 art, audio, polish  `pending`

- [ ] D2 art pass (distinct palette/kit).
- [ ] Spatial audio: WebAudio worklets, HRTF panning, underground/surface acoustic
      contrast as a showcase.
- [ ] Adaptive music system (D-141): weather/danger/district-reactive score consuming
      the sim's semantic event stream (the event hooks are a design-now constraint on
      M3 — see features.md); AI-generated music fits the project's stacked-AI bet.
- [ ] SFX and ambience content at scale, plus the audio asset pipeline `assets/` never
      had (its current pipeline is visual-only): AI-generated/sourced audio through a
      QA gate like every other asset.
- [ ] GPU-compute particle and volumetrics substrate shared by fire, smoke, snow, and
      precipitation — built once, consumed by every VFX track below (D-140; same
      explore-and-decide model as M4.5).
- [ ] Fire and smoke: volumetric/particle rendering coupled to the M4.5 fire/torch
      light sources — the illumination and shadow interplay is both the hard problem
      and the showcase.
- [ ] Precipitation pass: rain and snow fall, accumulation, and wet/snow surface
      response, completing the M4.5 water/wet-surface work.
- [ ] Physics garnish: ragdolls, ropes/chains, and buoyancy with a usable rowboat off
      the shore (cheap, high-impact water showcase).
- [ ] Photo mode (a cheap, high-value capabilities showcase).
- [ ] Optional Standard-tier/cross-hardware research (D-150; supersedes D-141's gate
      provision): exercise the Standard planning profile or macOS/Metal when hardware
      is available, retain findings, and compare with dev-01 without creating a
      milestone gate or registration prerequisite.
- [ ] Exit: end-to-end demo build a stranger can install and play, qualified on the
      exact dev-01 candidate. Other-hardware results are advisory (D-150).

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

- **Rough-edges log:** every milestone feeds it. D-141 adds the forcing function the
  goal-1 deliverable was missing: every milestone exit includes a synthesis
  checkpoint — update [chrome-platform-gaps.md](chrome-platform-gaps.md) from the
  milestone's findings and queue/publish the shareable write-ups the milestone earned,
  rather than deferring synthesis indefinitely.
- **Harness evolution:** new system → new metrics, same change.
- **Chrome coordination:** findings that suggest browser changes (e.g., shippable PSO
  caches, COS code-cache work) tracked in rough-edges.md with status.
