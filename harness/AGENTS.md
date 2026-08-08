# harness/ — build, deploy, measure ("WebPageTest for games")

The project's verification loop and a first-class deliverable in its own right
([docs/vision.md](../docs/vision.md)). Every claim about performance in this repository
is backed by a number the harness produced. Read the root `AGENTS.md` and
[docs/budgets.md](../docs/budgets.md) first.

## What it does

One command: build → serve (COOP/COEP, immutable URLs, correct 304 behavior — the
serving discipline is part of what's under test) → launch Chrome (scripted, fresh
profile *and* warm profile) → drive a deterministic run → collect metrics → diff against
budgets.md → pass/fail with a report.

## Metric surface (grow with the systems; a system without harness coverage is invisible)

- **Frames:** frame-time distribution (p50/p95/p99.9/max), long tasks per thread (today:
  main thread only — the Long Tasks API is a Window-scope observer; worker-side
  long-task observability is an open question to verify and, if confirmed missing, log
  as a rough-edge when worker-heavy milestones land),
  pipeline-compile events during gameplay (must be zero).
- **Memory:** JS heap per thread, WASM linear memory per module, GPU memory as
  attributable, SAB pool sizes, high-water marks per run phase.
- **Caches:** V8 wasm/JS code cache hit evidence, HTTP 304 discipline, Dawn pipeline
  cache behavior (launch-1 vs launch-2 compile counts), and representative streaming
  OPFS read/decode/upload attribution. M1 gates representative cell-load p95.
- **Lifecycle:** install wall time and phase breakdown, launch-1/launch-2/offline-launch
  to gameplay, update-flow cache preservation.
- **Streaming:** cell load latency distribution, queue depths/stalls, eviction events
  (emergency count must be zero), transition-contract measurements (D1↔D2).
- **Sim:** determinism hash (same command log ⇒ same state hash), step-time distribution.
- **AI:** app-owned-model first-token/total latency, throughput, model
  install/cache evidence, structured/context behavior, and frame impact during generation.

Sources: CDP (tracing, Performance domains), in-app telemetry exported by
`engine/telemetry/` on a stable schema, and Chrome internals surfaces where CDP falls
short (each gap in observability is itself a rough-edges finding — log it).

## Run catalog (versioned contracts; deterministic by construction)

- `pnpm harness:smoke` — boot to first interactive frame and collect the mandatory
  budget snapshot. Run once for a converged candidate that can affect this scenario's
  exercised/evaluated surface under D-157 and
  [the physical-gate cadence](../docs/workflow.md#validation-and-physical-gate-cadence).
- `pnpm harness:smoke:v8-cache` — the smoke core plus the opt-in multi-lineage V8
  lifecycle diagnostic. Run only for browser, Node, bundler, serving/cache, lifecycle,
  dependency-checkpoint, or explicit V8 investigations under D-095.
- `pnpm harness:branded-parity -- --target https://parallax-web.com` — opt-in
  installed branded-Stable parity on physical-console dev-01/Showcase against
  production. The fail-closed runner binds the registered executable's path, version,
  digest, Google product/signature metadata, checked-in Chrome pin, launch channel, and
  CDP browser identity. Every attempt is immutable; results are comparison-only,
  baseline-ineligible, nonpromotable, and never pinned-CfT budget-authoritative (D-150).
- `pnpm harness:app-owned-llm` — exact-manifest cold OPFS install, browser-restart
  warm load, fixed dialog/schema/context fixtures, and render-worker impact.
- `pnpm harness:flythrough-d1` — the standard ten-minute District 1 traversal.
- `pnpm harness:render-recovery` — isolated real device-loss, silent render-worker
  crash, and bounded-retry qualification; never injects faults into routine runs.
- `pnpm harness:opfs-release-store-adapter` — fresh-profile browser adapter for the
  crash-safe OPFS release-store contract.
- `pnpm harness:installer-trust-faults` — bounded installer integrity, publication,
  repair, quota, and typed-fault matrix.
- `pnpm harness:installer-repair-production-replay` — exact retained production repair
  replay against the current validator contract.
- `pnpm harness:asset-update:v8` — same-profile install, warm-launch, asset-only update,
  post-update launch, and best-effort V8 lifecycle diagnostic.
- `pnpm harness:model-source-verification` — post-upload verification of the five fixed
  production-source/install-only model objects through the local `model-content.json`
  contract, SSH-side remote identity, and production HTTP delivery.
- `pnpm harness:pso-warmup:qualify` — separately triggered release-bound PSO warmup
  launch-pair qualifier; its source entry point defines required input paths.
- `pnpm harness:uninstall-verification` — fresh-process qualification of the confirmed
  client-side and direct-network uninstall mechanisms.
- `pnpm harness:scale-streaming` — representative schema-v2 compressed dependency,
  decode, cache-ownership, and GPU-upload scale qualifier.
- `pnpm harness:baseline:promote` — guarded offline baseline-store promotion utility,
  not a browser scenario or automatic post-run action.
- `transition` — repeated D1↔D2 swaps against the transition contract.
- `lifecycle` — cold install, launch, relaunch, offline relaunch, asset-only update,
  and relaunch.
- `determinism` — replay a fixed command log and compare state hashes.

The specialized opt-in adapters and qualifiers above use package scripts whose source
entry points are the binding contracts; consult
[docs/plan.md](../docs/plan.md), [docs/decisions.md](../docs/decisions.md), and retained
results for triggers, exact schemas, identities, and accepted evidence. Do not infer a
milestone gate or authorize a rerun from historical result prose.
Closed D-133 installer-transfer calibration and qualification have no runner or package
command. Later closed-experiment cleanup (root rule 11) removed both validator/test pairs completely, leaving
only ignored retained results, reconstruction records, and documented hashes and
conclusions.
Closed D-138 offline-shell adapter and D-146 offline-fault lifecycle qualification also
have no runner or package command. Later closed-experiment cleanup (root rule 11) removed their qualifier-
only sources, tests, and routine source assertions while preserving generic result-pair,
progress-liveness, diagnostic-redaction, and exact-range utilities used by active gates.

The game-facing benchmark mode (D-025/D-105) is the public runner for the same versioned
scenarios, telemetry, metric states, facets, and variance rules. It keeps its portable
result wrapper separate from privileged harness reports and represents unavailable
privileged fields explicitly. Scenario execution, warm-up, repeats, measurement
windows, aggregation, and export remain in-game; automation may only launch and collect
outside the measurement window. Page-owned reports cannot attest the registered host,
power, physical-console session, or privileged metrics and are advisory rather than
comparable to independent fresh-profile harness repeats.

Current milestone state and closure evidence live only in
[docs/plan.md](../docs/plan.md). Current schema and metric-set constants live in source;
accepted decisions and evidence identities live in
[docs/decisions.md](../docs/decisions.md) and retained `harness/results/` artifacts.

## Rules

1. **Deterministic runs.** Scripted input/camera paths, fixed seeds, pinned Chrome
   version per report — operationally, archived Chrome for Testing binaries at the
   current stable milestone (D-019), so any past result can be re-run; the exact
   version is recorded in every result. Under D-150, installed branded-stable parity
   runs when a Chrome pin is reviewed/adopted and when browser currency is assessed at
   the standing dependency checkpoint. All launches retain Chrome's process sandbox;
   an effective `--no-sandbox` switch invalidates reference evidence (D-062). Variance across
   repeats is itself a tracked metric — a noisy metric is a broken metric.
2. **Results are diffable artifacts** (JSON + human-readable report), keyed by
   **artifact digest**, not commit: the hash of the exact built artifacts measured,
   plus source identity = last commit + a digest of the dirty working tree (agent work
   is intentionally measured pre-commit — "commit" alone cannot identify what ran).
   Every result also records the full environment identity and per-metric states
   defined in docs/budgets.md → Measurement methodology. Regressions point at the
   metric, the run, and the artifact/source delta. JSON is the primary artifact:
   persist it in a pending/fail-closed state before formatting or writing the
   human-readable report, then advance it only after that secondary artifact succeeds.
   Late build/source drift and human-readable formatter/write failures remain explicit
   failed evidence in retained JSON rather than preventing persistence.
3. **Budget failures fail the run.** No advisory mode. Changing a threshold happens in
   docs/budgets.md with a decision-log entry, never in harness code. Metrics use the
   `measured | unsupported | invalid | not-applicable` states from budgets.md; a
   milestone-mandatory metric that isn't `measured` is a failure (silence is not a
   pass), and each milestone's mandatory-metric set is versioned here alongside the
   run scripts. Baseline promotion on Chrome-stable updates follows the budgets.md
   policy (explicit promotion, never automatic). `harness:smoke` only writes
   `untracked`, `current`, `candidate`, or `ineligible` comparison evidence; promotion
   is the separate actor/reason-bearing `harness:baseline:promote` command. It rejects
   stale observed-anchor digests under the store lock; an intentional incomparable
   anchor also requires `--rebaseline`. Candidate
   eligibility includes the exact Node collector version and executable digest as well
   as artifact, metric-set, and registered-machine identity.
4. **Reference machines are pinned** (specs recorded in `machines/`); add machines,
   don't silently swap them.
5. **The harness may not depend on `engine/` or `game/` internals** — only on the
   telemetry export schema and public URLs. It must be able to measure a broken build.
6. **Attribution first.** When a metric regresses, the harness should help prove which
   layer (app / Babylon / Dawn / V8 / storage / OS) — prefer adding a probe or a
   standalone micro-repro (`probes/`) over speculation. Micro-repros double as
   rough-edges reproductions.
7. **Portable result contract, Chrome-first automation.** Browser-driving and privileged
   probes may initially be Chrome/CDP-specific, but scenario definitions, in-app
   telemetry, environment identity, metric states, and result JSON may not encode Chrome
   as the only possible engine. Other engines report unsupported probes explicitly; do
   not add runtime fallbacks merely to obtain a benchmark result (D-002/D-025).
8. **No driver in the benchmark measurement path.** A D-025 benchmark result is produced
   by the game itself. WebDriver/CDP/Playwright may open the URL, request a run, wait for
   completion, and copy its exported artifact, but may not pace frames, inject the
   scenario step-by-step, define measurement boundaries, aggregate metrics, or contribute
   timings to the in-game result. This keeps manual and automated invocations equivalent
   and removes driver overhead/variability from browser-engine comparisons.
9. **Reference gates run from the machine's physical console.** Before starting a
   reference-machine budget gate, tell the developer that direct local access is needed
   and wait for confirmation that the browser will run in a native local interactive
   session. RDP, remote/indirect display adapters, virtual displays, and remotely altered
   display timing make the environment identity `invalid`; they are allowed for
   development and explicitly non-gating diagnostics only. Never promote a remote-session
   result by copying declared display, power, GPU, or machine labels into the report.
   On Windows, wake the physical display immediately before every Chrome context launch,
   including identity/reference and measured launches, with the scoped F15 preflight and
   confirm the monitor is visibly awake; one wake before a multi-minute sequence or a
   later browser action is not an acceptable wake boundary.
   Under D-157, qualify the converged candidate once when it can affect a subsystem,
   measurement, validator, or budget actually exercised by smoke, rather than after
   every intermediate edit. Artifact identity drift alone is not a trigger. Record the
   affected smoke surface—or the reason none is affected—as required by
   `docs/workflow.md`.
10. **Intermittent failures remain failures.** Retain an RE-008/RE-036-class failed
    report and make one immediate same-artifact retry for classification. The retry is
    a separate result and cannot relabel the failed report; further repetitions require
    an explicit bounded diagnosis (D-097).
