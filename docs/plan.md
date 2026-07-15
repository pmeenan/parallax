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

## M0 — Harness + skeleton  `in progress`

The measurement loop everything else depends on, plus the thinnest possible end-to-end
app: a Babylon.js WebGPU scene in a render worker, served with COOP/COEP, deployed and
measured automatically.

- [x] Build/serve pipeline (per D-014/D-020 toolchain) with immutable-URL output and correct
      headers; local server at this stage (D-011).
- [x] Public landing page (`site/`, D-021/D-022): brief project description + link to
      the GitHub repo, published once to parallax-web.com 2026-07-12 and frozen; the
      harness-deployed game landing page replaces it at M2.
- [x] Engine/game bundle separation with deterministic engine builds (D-010): same
      source + pinned toolchain ⇒ byte-identical engine artifacts, verified by a
      double-build hash check in the pipeline.
- [x] Walking-skeleton app: the render-worker Babylon.js WebGPU scene from the preamble,
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
- [ ] Spike: OPFS sync-access-handle read throughput from a worker.
- [ ] Spike: Prompt API — execution contexts (confirm window-only, D-017), user
      activation for download/create, download flow + model-size reporting, eviction
      + offline reavailability behavior, session limits.
- [ ] Spike: app-owned in-browser LLM inference (P-007 phase A) — small open-weight
      model via WebGPU inference in a worker against the walking skeleton, head-to-head
      with the Prompt API spike above on a fixed NPC-dialog prompt fixture set:
      first-token latency p95 vs. the budgets.md dialog budget, tokens/s, frame impact
      during generation, VRAM, OPFS model-load time, structured-output/schema
      compliance, context-window behavior at persona+retrieved-context sizes, baseline
      dialog quality, and model/install size. Device topology (own WebGPU device vs.
      sharing the render device) is an explicit spike variable.
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
- [ ] Exit: one command produces a built, locally served build (local serving only at
      M0 per D-011/D-022 — production deployment is M2) and a budget report; all spike
      results recorded in rough-edges.md or decisions.md.

## M1 — Greybox District 1 streaming  `pending`

- [ ] Procedural greybox content for D1 (cells, LOD tiers, collision) at target world
      scale. Includes re-grounding D-006's asset-format claims (Babylon glTF/KTX2/
      meshopt support) against current sources before the first content lands — the
      entry predates the rule-10 citation requirement and carries none.
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
