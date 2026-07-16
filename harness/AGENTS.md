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
  cache behavior (launch-1 vs launch-2 compile counts), OPFS read throughput.
- **Lifecycle:** install wall time and phase breakdown, launch-1/launch-2/offline-launch
  to gameplay, update-flow cache preservation.
- **Streaming:** cell load latency distribution, queue depths/stalls, eviction events
  (emergency count must be zero), transition-contract measurements (D1↔D2).
- **Sim:** determinism hash (same command log ⇒ same state hash), step-time distribution.
- **AI:** Prompt API first-token/total latency, frame impact during generation.

Sources: CDP (tracing, Performance domains), in-app telemetry exported by
`engine/telemetry/` on a stable schema, and Chrome internals surfaces where CDP falls
short (each gap in observability is itself a rough-edges finding — log it).

## Standard runs (versioned contracts in `src/runs/`; deterministic by construction)

- `smoke` — boot to first interactive frame, budget snapshot (every change).
- `prompt-api-spike` — activation-bound first download, inference/session pressure,
  generation impact, and offline reavailability (M0 evidence run).
- `flythrough-d1` — the M1 standard 10-minute traversal (regression gate).
- `transition` — repeated D1↔D2 swaps against the transition contract (from M4).
- `lifecycle` — cold install → launch-1 → relaunch → offline relaunch → asset-only
  update → relaunch (from M2).
- `determinism` — replay a canned command log N times, compare state hashes (from M3).

The game-facing benchmark mode (D-025, from M1) is a public runner for these same
versioned scenarios and the same telemetry/result schema. It is not a separate benchmark
implementation. The whole benchmark lifecycle—scenario execution, warm-up, repeats,
measurement windows, aggregation, and export—runs in-game without an external driver.
Automation may only launch it and retrieve the completed result; launcher/collector
activity is outside the measurement window and is not required for a valid manual run.
Manual and non-Chrome results are labeled advisory; only automated Chrome runs on
reference machines gate budgets.

## Rules

1. **Deterministic runs.** Scripted input/camera paths, fixed seeds, pinned Chrome
   version per report — operationally, archived Chrome for Testing binaries at the
   current stable milestone (D-019), so any past result can be re-run; the exact
   version is recorded in every result and a periodic parity smoke runs on installed
   branded stable. Variance across repeats is itself a tracked metric — a noisy metric
   is a broken metric.
2. **Results are diffable artifacts** (JSON + human-readable report), keyed by
   **artifact digest**, not commit: the hash of the exact built artifacts measured,
   plus source identity = last commit + a digest of the dirty working tree (agent work
   is intentionally measured pre-commit — "commit" alone cannot identify what ran).
   Every result also records the full environment identity and per-metric states
   defined in docs/budgets.md → Measurement methodology. Regressions point at the
   metric, the run, and the artifact/source delta.
3. **Budget failures fail the run.** No advisory mode. Changing a threshold happens in
   docs/budgets.md with a decision-log entry, never in harness code. Metrics use the
   `measured | unsupported | invalid | not-applicable` states from budgets.md; a
   milestone-mandatory metric that isn't `measured` is a failure (silence is not a
   pass), and each milestone's mandatory-metric set is versioned here alongside the
   run scripts. Baseline promotion on Chrome-stable updates follows the budgets.md
   policy (explicit promotion, never automatic).
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
