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

## M0 — Harness + skeleton  `in progress`

The measurement loop everything else depends on, plus the thinnest possible end-to-end
app: a Babylon Lite WebGPU scene in a render worker, served with COOP/COEP, deployed and
measured automatically.

- [x] Build/serve pipeline (per D-014/D-020 toolchain) with immutable-URL output and correct
      headers; local server at this stage (D-011).
- [x] Public landing page (`site/`, D-021/D-022): brief project description + link to
      the GitHub repo, published once to parallax-web.com 2026-07-12 and frozen; the
      harness-deployed game landing page replaces it at M2.
- [x] Engine/game bundle separation with deterministic engine builds (D-010): same
      source + pinned toolchain ⇒ byte-identical engine artifacts, verified by a
      double-build hash check in the pipeline.
- [x] Walking-skeleton app: the render-worker Babylon Lite WebGPU scene from the preamble,
      booting through the real build/serve pipeline with COOP/COEP intact — the target
      the harness and spikes run against (integrated deliverable, not just the
      WebGPU-in-worker spike). Verified locally in the Chromium-based Codex browser on
      2026-07-12 through the assembled server to the first rendered frame with no
      page/worker errors; the pinned-Chrome automated gate is Harness v1 scope below.
- [x] Harness v1: launch pinned Chrome (fresh + warm), drive versioned `smoke@1`,
      capture frame pacing, all-realm JS heap, GPU memory as measurable, pipeline stalls,
      and HTTP/Dawn/V8 cache evidence; diff blocking metrics against budgets.md and fail
      on a bust. Chrome observability gaps remain explicit informational findings and
      launch performance is the outcome gate (D-051). Completed on registered dev-01 at
      4K/60: schema v16 / metric-set v3 passed all three facets and 24 budget checks.
      After D-054's measurement-soundness fixes, a current schema v17 / metric-set v4
      physical-console gate also passed all three facets and 24 checks on 2026-07-15.
      The prior passes inherited Playwright's `--no-sandbox` default and were replaced,
      not promoted (D-062/D-063). After two schema-v20 failures and schema-v21 OPFS
      attribution established RE-023, D-066 separated mandatory per-run OPFS
      correctness/raw evidence from the still-visible informational repeatability
      finding. Physical-console artifact
      `smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T15-00-16-046Z.json` passed the
      production sandbox under schema v22 / metric-set v10: registered environment,
      mandatory evidence, all six core traces, and all 24 budget checks passed.

- [x] Spike: WebGPU-in-worker + OffscreenCanvas with Babylon (go/no-go). **Go** for the
      rendering core (D-056): a schema v17 / metric-set v4 pinned CfT 150 / Babylon
      9.16.1 physical-console run on registered dev-01 passed all facets and 24 budget
      checks across three fresh/warm pairs; the harness verified the exact page +
      dedicated-worker topology and every measurement window recorded zero >50 ms long
      tasks.
      Babylon/WebGPU rendering remains worker-owned; explicit window orchestration and
      DOM-sensitive future features are scoped in D-056.
- [x] Spike: SAB ring buffer main↔worker (D-057). Paired fixed-capacity SPSC transport
      passed the registered dev-01 physical-console gate across three fresh/warm pairs:
      schema v18 / metric-set v5, all three facets and 24 budget checks passed, and every
      run returned 100,000/100,000 records with zero payload/sequence errors. The
      retained concurrent callback maxima overlap RE-001's privileged-diagnostics
      contamination and are not evidence of hitch-free active transport; D-057 scopes
      the go decision accordingly.
- [x] Spike: OPFS sync-access-handle read throughput from a worker (D-058/D-066).
      **Qualified go for the M1 storage boundary; no stable microbenchmark baseline.** After two
      calibration runs exposed first-phase measurement noise, metric-set v8's untimed
      validated preflight passed the registered dev-01 physical-console gate: schema
      v19, all three facets and 24 budget checks passed, all reads validated, and every
      fresh/warm sequential/random cohort stayed within the 10% repeatability limit.
      D-063 reopened the performance qualification under the production sandbox: two
      schema-v20 attempts validated every read but exceeded the unchanged variance
      limit, including one fresh-sequential 3.45 GiB/s outlier against 5.99 and
      6.53 GiB/s peers (RE-023). Schema v21 then retained every sequential pass,
      256-read random batch, and overlapping host-disk sample: it isolated another miss
      to one 4.925 ms random batch without sustained physical I/O. D-066 keeps exact
      per-run lifecycle, validation, and raw timings mandatory, retains the unchanged
      repeatability result as an informational finding, and defers the user-outcome gate
      to M1's representative OPFS-to-renderable cell-load p95. The passing schema-v22
      sandboxed replacement above validated every read; its four cohort ranges happened
      to remain within 1.10-6.58% but do not erase the retained instability.
- [x] Spike: Prompt API — execution contexts (confirm window-only, D-017), user
      activation for download/create, download flow + model-size reporting, eviction
      + offline reavailability behavior, session limits.
      **No-go as a required backend** (D-059/RE-019). The schema-v6 pinned-CfT run on
      registered dev-01 passed the physical environment and launch-contract gates,
      exposed the API in the window but not a dedicated worker, and reported initial
      availability `downloadable`. Activation-backed `create()` then remained in
      `creating` with zero progress events, zero retained samples, and zero installed
      model bytes until the 120,723 ms no-forward-progress watchdog stopped the run.
      Download completion, inference, session pressure, and offline reavailability
      were consequently unmeasurable rather than silently treated as passing. The
      research spike is complete because its delivery prerequisite produced a valid,
      reproducible negative result; the separate branded-Chrome lifecycle was
      demonstrated under schema v1 and qualified under schema v2, while the NPC backend
      choice remains open below.
- [x] Qualify the Prompt API's production install UX in branded Chrome, separately
      from the pinned-CfT evidence gate and before choosing the NPC-model backend.
      Exercise at least two independent fresh branded-Chrome profiles: one uninterrupted
      install and one browser-restart/resume during download. Each starts from a real
      install-page gesture, must leave `LanguageModel.create()`'s progress monitor
      observably live with monotonic 0..1 progress (including at least one intermediate
      update rather than only endpoints), reach `available`, complete the fixed streamed
      NPC-dialog fixture, survive a browser restart, and repeat the fixture offline.
      Record download duration, longest phase-local interval without forward progress,
      the separate observer-free restart interval, availability
      transitions, model status/component size, and every error. A failure to trigger,
      expose actionable progress, resume, or remain available—including 120 seconds
      without forward progress—is backend-selection evidence, not a harness exception,
      and keeps Prompt API from being a required game dependency regardless of the CfT
      research outcome. The 120-second phase-local boundary is calibrated from the
      same-version delivery evidence under D-064/D-065.
      **Passed under schema v2 with the production sandbox (D-065).** Physical-console
      artifact
      `prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json`
      qualified both independent fresh profiles on branded Chrome 150.0.7871.128 with a
      stable executable hash and no `--no-sandbox` switch. Uninterrupted and
      restart/resume delivery completed in 102.6 s and 161.9 s; their true phase-local
      forward-progress gaps were 24.0 s and 17.8 s, and the restart lineage separately
      recorded a 4.7 s observer-free restart window. Both installed 4,269,934,835 bytes,
      completed the exact streamed fixture before and after restart, settled to
      `available` after a transient restart state (RE-020), and repeated the fixture
      offline. Across eight same-version delivering profiles, the 120-second boundary
      is 5.00x the largest observed true gap. First-token samples measured
      3,543.6-3,877.2 ms and remain backend-selection
      evidence (RE-021).
- [x] Spike: app-owned in-browser LLM inference (P-007 phase A) — small open-weight
      model via WebGPU inference in a worker against the walking skeleton, head-to-head
      with the Prompt API spike above on a fixed NPC-dialog prompt fixture set:
      first-token latency p95 vs. the budgets.md dialog budget, tokens/s, frame impact
      during generation, VRAM, OPFS model-load time, structured-output/schema
      compliance, context-window behavior at persona+retrieved-context sizes, baseline
      dialog quality, and model/install size. Device topology (own WebGPU device vs.
      sharing the render device) is an explicit spike variable.
      **Qualified (D-074; ONNX negative evidence retained by D-073/RE-030/RE-031/
      RE-032):** wllama 3.5.1 plus the pinned QAT-derived Gemma 4 E2B `UD-Q4_K_XL`
      GGUF passed the unchanged physical-console gate on WebGPU: 119.64 ms warm TTFT
      p95, 60.27 mean tokens/s, all structured/grounding/context checks, exact five-
      shard cold and restart-warm OPFS evidence, and 16.79 ms render-callback p95.
      Native JSON-schema response constraints are part of the measured backend.
      The same GGUF completed all context tiers on CPU/WASM with no inference GPU and
      383.30 ms TTFT p95, but only 9.60 mean tokens/s and a 311.20 s large-context
      prefill, so CPU is a measured headroom mode rather than an automatic fallback.
      The 120-second no-progress load boundary remains. ONNX's context, missing-kernel,
      and whole-buffer failures remain valid engine/export findings rather than being
      rewritten by the successful GGUF route.
- [x] Spike: Babylon Lite vs. classic Babylon.js for the rendering core (D-077/D-078).
      **Switch to Lite.** Both schema-v23 / metric-set-v10 production-sandbox gates on
      registered dev-01 passed all six core runs and 24 budget checks. Against classic,
      Lite's render worker was 96.94% smaller, combined engine+worker bytes were 89.78%
      smaller, mean fresh/warm startup improved 19.1%/17.8%, mean render CPU p95 improved
      53.0%, and mean all-realm JS heap improved 58.5%; callback pacing was equal.
      GPU-memory attribution remained unsupported for both rather than being counted as
      a win. The exact v1.11.0 source audit found bounded gaps: compressed-asset decoder
      bootstrap is DOM-based unless pinned globals are preinstalled in the render worker,
      meshopt additionally assumes a single-buffer GLB, animation events are absent and
      morphs capped at four, and generic compute/raw-device/queue access is not public.
      Their M1 worker-fixture/asset-QA and M3/P-002 adapter plans are recorded in D-078
      and [rendering-engine-research.md](rendering-engine-research.md) §7. D-080 then
      removed the comparison-only classic dependency, selector, backend abstraction, and
      renderer identity contract; classic is not a maintained engine path. Final Lite-only
      artifact `smoke-1-a4824e1bef7e-dev-01-showcase-2026-07-19T20-33-11-523Z.json`
      passed all three facets, six core runs, and 24 checks at 581,328 combined
      engine+render-worker bytes. The historical A/B artifacts remain the selection
      evidence.
- [x] Spike: app-owned NPC context-prefill caching (P-007 optimization,
      D-075), kept as
      a distinct post-qualification task so D-074's uncached baseline remains
      comparable. First measure wllama/llama.cpp live exact-prefix reuse with a shared
      world/persona prefix and changing user suffixes, reporting cold-prefill and
      warm-prefix TTFT separately plus reused-token evidence. Then qualify restart-
      persistent, per-character KV snapshots through OPFS, adding only the minimal
      wllama state/slot binding needed for the experiment. Measure snapshot bytes per
      token, save/restore latency, JS/WASM/GPU memory and transfer behavior, render
      contention, and a bounded multi-character hot-set/eviction policy against fresh
      prefill on both WebGPU and CPU/WASM. Include the D-082 axes: flash attention
      off/on (its own before/after column against D-074's FA-off baseline) and
      KV-cache type f16 vs q8_0 (optionally q8_0-K/q4_0-V), with every quantized
      configuration re-passing the unchanged D-074 quality fixture. Cache identity
      must bind the exact model and
      GGUF digest, runtime/llama.cpp build, tokenizer/chat template, token prefix, and
      context/KV parameters including cache types and the flash-attention setting;
      mismatches invalidate the disposable derived cache. Do
      not promote persistent caching unless restore is materially faster than fresh
      prefill without violating gameplay frame budgets, and retain player-derived
      context under save-data privacy/lifecycle rules rather than shared static-cache
      rules.
      D-084 closes this as a measured no-go for restart persistence. The complete
      physical Chrome 150 matrix found that stable configurations restored only 409 of
      914-916 exact reusable tokens; WebGPU f16 without flash attention additionally
      aborted on first generation after native restore. Symmetric q8_0 cut snapshot
      bytes about 47% and passed all 30 quality cases on both placements, but could not
      fix correctness. Live same-session exact-prefix reuse remains viable; the
      experiment-only store, harness, runtime patches, fixtures, and custom WASM were
      removed after measurement. The preferred follow-up is model-specific idle pre-seeding of a
      clean resident world/tool/persona context for the next conversation; separate
      model evaluation may revisit persistence for other architectures rather than
      generalizing this Gemma 4 E2B result.
- [ ] Spike: Rust→WASM module with wasm threads (includes scaffolding the
      `rust-toolchain.toml` + pinned wasm-bindgen/binaryen shape D-014/D-020 specify —
      deferred until this first Rust code exists).
- [ ] Spike: memory64 module load and cost; this validates the optional last-resort path
      in P-001, not a default wasm64 target.
- [ ] Harness result contract implemented (budgets.md → Measurement methodology):
      metric states, environment identity, artifact digest + dirty-tree identity,
      per-milestone mandatory-metric sets, variance gate, baseline-promotion policy.
      *Note (2026-07-15): everything except the baseline-promotion policy is
      implemented and exercised by the checked Harness v1 item above; only baseline
      promotion (budgets.md → "Baseline promotion") remains, so don't rebuild the rest.*
- [ ] Run the first full-repository dependency currency checkpoint (D-079), including
      runtime/model/browser inputs as well as npm tooling. Record adopted and deferred
      candidates in dependencies.md. Due before M0 exit and no later than 2026-08-16.
- [ ] Exit: one command produces a built, locally served build (local serving only at
      M0 per D-011/D-022 — production deployment is M2) and a budget report; all spike
      results recorded in rough-edges.md or decisions.md.

## M1 — Greybox District 1 streaming  `pending`

- [ ] Procedural greybox content for D1 (cells, LOD tiers, collision) at target world
      scale. Includes re-grounding D-006's asset-format claims (Babylon Lite glTF/KTX2/
      meshopt support) against current sources before the first content lands — the
      entry predates the rule-10 citation requirement and carries none. Before content
      lands, bundle and preinstall the pinned KTX2/Draco/meshopt decoder globals in the
      module render worker and gate one fixture per compression path plus meshopt's
      canonical single-buffer constraint (D-078).
- [ ] Streaming worker + decode pool: OPFS → decode → GPU upload, driven by player
      movement, inside memory budget with proactive eviction.
- [ ] Geometry-representation spike (P-002): triangle LOD vs. meshlet-virtualized vs.
      Gaussian splats on representative content, harness-measured at both quality tiers
      and **under dynamic relighting** (game-design.md binding implication — a
      splat-representation win measured only under static lighting doesn't count);
      results recorded in decisions.md + rough-edges.md.
- [ ] Scripted harness flythrough as the standard regression run — sweeping
      lighting/weather states, not just geography (binding requirement from
      game-design.md → Design implications; dynamic time-of-day binds the renderer from
      the M1 greybox onward per architecture.md).
- [ ] Render-worker robustness for long runs: WebGPU device-loss handling and a
      restart-after-failure path (the M0 skeleton is deliberately
      failed-is-terminal; flythrough-length sessions need recovery).
- [ ] Benchmark mode (D-025): expose that same versioned flythrough, fixed settings,
      warm-up/repeats, environment identity, and JSON + human-readable result export in
      the game; the complete run and measurement path works from in-game with no
      external driver, non-Chrome results are advisory, and missing capabilities/metrics
      remain explicit rather than gaining compatibility fallbacks.
- [ ] Exit: 10-minute flythrough — including lighting/weather-state sweeps — with zero
      budget violations; streaming metrics dashboarded; presentation gating revisited
      per D-051 (see the recorded M1 collision note in budgets.md → Frame time).

## M2 — Install/launch/run lifecycle + caches  `pending`

The heart of the platform research. Prerequisite: production serving live on
parallax-web.com (D-011) — cache findings measured only against local serving aren't
credible.

- [ ] Production deployment to parallax-web.com with versioned nginx/header config;
      harness can target local and production and labels results accordingly. (The
      replacement landing page must not inherit the frozen placeholder's "WebAssembly
      (threads and memory64)" framing — memory64 is a P-001 last resort, not part of
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
- [ ] Prompt API NPC dialog: persona cards, rolling memory, structured output for
      state-affecting intents; frame-impact measurement during inference.
- [ ] NPC knowledge service (D-033): generic retrieval/assembly contract in `engine/ai`
      with `game/`-supplied providers; structured game-state tier implemented;
      prompt/persona schema carries the retrieved-context slot; lore authored
      chunked + tagged in `game/`. Semantic tiers (lore embeddings, episodic memory)
      stay build-later.
- [ ] Exit: playable greybox loop with conversing NPCs (incl. authored-fallback path
      with the model unavailable, D-017); save/reload round-trip; sim determinism check
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
      the pipeline).
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
