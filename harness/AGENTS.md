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

## Standard runs (versioned contracts in `src/runs/`; deterministic by construction)

- `smoke` — boot to first interactive frame and budget snapshot. Run once after the
  final reviewable state of every runtime-affecting candidate, and rerun only when a
  later fix changes a qualifying input (D-097; see `docs/workflow.md`).
- `smoke --include-v8-code-cache` / `pnpm harness:smoke:v8-cache` — the same core
  gate plus the three-lineage, nine-launch V8 lifecycle diagnostic. Run at browser,
  Node, bundler, serving/cache, or lifecycle changes; dependency checkpoints; M2
  install/update work; and explicit V8 investigations, not every change (D-095).
- `app-owned-llm-spike` — exact-manifest cold install into OPFS, browser-restart warm
  load, fixed Gemma dialog/schema/context fixtures, and render-worker impact (M0 P-007
  phase-A evidence run).
- `flythrough-d1` — the M1 standard 10-minute traversal (regression gate).
- `render-recovery` — M1's isolated real device-loss / silent render-worker-crash /
  bounded-retry qualification; never injects faults into routine smoke or flythrough.
- `transition` — repeated D1↔D2 swaps against the transition contract (from M4).
- `lifecycle` — cold install → launch-1 → relaunch → offline relaunch → asset-only
  update → relaunch (from M2).
- `determinism` — replay a canned command log N times, compare state hashes (from M3).

The game-facing benchmark mode (D-025/D-105, from M1) is a public runner for the same
versioned scenarios, subsystem telemetry, metric states, facets, and variance rules. Its
browser-neutral `benchmark-result@1` wrapper is deliberately separate from the
privileged harness report; it embeds the complete flythrough evidence and makes every
unavailable privileged field explicit. It is not a second scenario implementation. The
whole benchmark lifecycle—scenario execution, warm-up, repeats,
measurement windows, aggregation, and export—runs in-game without an external driver.
Automation may only launch it and retrieve the completed result; launcher/collector
activity is outside the measurement window and is not required for a valid manual run.
Current page-only `benchmark-result@1` schema-v3 results use three continuous-page repeats and are labeled advisory
even in Chrome because the page cannot attest the registered host, driver, power,
physical-console session, or standing privileged metrics. They are not comparable with
the harness's independent fresh-profile repeats. Raw CSS viewport geometry remains
recorded but is not comparison identity while the worker render size is fixed and
checkpoint-attested; every other captured environment field remains exact. Only harness-qualified Chrome runs on
reference machines gate budgets.
D-115 completes M1's Benchmark mode task on this implementation and fail-honest result
contract. The retained complete schema-v3 reports still fail their unchanged 10%
scenario checks and still have `not-evaluated` budget facets; correct failed exports
qualify the mode, not the observed performance. They do not duplicate or override the
authoritative privileged flythrough, and no further 30-plus-minute public run is an M1
gate. D-115's final M1 contract uses D-102's schema-v4/metric-set-v4 flythrough as a
versioned long-window anchor rather than claiming it passed the then-current v12/v6
validator; D-104's qualifier, post-D-108 physical lifecycle evidence, and the final
current smoke bridge the later contract/runtime changes. D-116 preserves the first
schema-v44 / metric-set-v21 smoke as failed and advances the final smoke to schema v45 /
mandatory metric set v22. It reuses the six existing core runs to require streaming
cell-load p95 absolute spread no greater than
`max(10% × minimum cohort p95, 1 ms)` independently for fresh and warm. The correction
adds no launch or duration and does not relabel failed ten-minute variance. Final
registered-dev-01 Showcase report
`smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T03-19-56-378Z.json`
(SHA-256
`b10c83ff0019cd3b332eec322703e2556de4565ba3e01c942154909cfb5508c9`)
passed schema v45 / metric set v22 across all six core runs, all three facets, and 30/30
evaluated budget checks. It completes M1's measured-runtime-artifact link without changing the
retained failed v44 or public results and without authorizing another M1 gate.
D-117 subsequently removes the closed memory64 experiment and advances build manifest
to v11, public telemetry to v25, smoke report to v46, flythrough report to v13, and
render-recovery report to v11. Metric sets and measurement semantics are unchanged;
all D-117 and bulk-review runtime fixes converged before the one ordinary D-097 physical
smoke recorded below. No per-fix smoke, benchmark, flythrough, recovery, or privileged
diagnostic was run. The smoke does not reopen M1.
D-118 advances smoke to schema v47 / mandatory metric set v23 and flythrough to
schema v14 / mandatory metric set v7. Both add explicit fail-closed report-finalization
evidence: late build/source drift and Markdown formatter/write failures retain primary
JSON and fail the evidence facet. Flythrough checkpoint validation also requires exact
finite three-component camera/color vectors and finite non-inverted aggregate bounds.
D-120 moves baseline-store loading to preflight and makes malformed selected entries
fail soft without conflating valid older metric sets with corruption. The final
post-review schema-v47 / metric-set-v23 physical smoke
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
(SHA-256
`ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
passed all six launches, all three facets, and 30/30 checks. It was correctly
`ineligible` for comparison with the older promoted metric-set-v11 anchor and was not
promoted automatically. RE-044 retains the same-artifact first attempt's startup fetch
failure; its one classification retry is this passing report. No additional post-M1
physical gate is pending.

## Rules

1. **Deterministic runs.** Scripted input/camera paths, fixed seeds, pinned Chrome
   version per report — operationally, archived Chrome for Testing binaries at the
   current stable milestone (D-019), so any past result can be re-run; the exact
   version is recorded in every result. Installed branded-stable parity runs when a
   Chrome pin is reviewed/adopted and when browser currency is assessed at the standing
   dependency checkpoint (D-097). All launches retain Chrome's process sandbox; an effective
   `--no-sandbox` switch invalidates reference evidence (D-062). Variance across
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
   Under D-097, qualify the converged runtime-affecting candidate once rather than every
   intermediate edit. Documentation-only, test-only, and machine-local tool-location
   changes do not require this gate unless they change a budget, evidence contract, pin,
   qualification claim, or another qualifying input listed in `docs/workflow.md`.
10. **Intermittent failures remain failures.** Retain an RE-008/RE-036-class failed
    report and make one immediate same-artifact retry for classification. The retry is
    a separate result and cannot relabel the failed report; further repetitions require
    an explicit bounded diagnosis (D-097).
