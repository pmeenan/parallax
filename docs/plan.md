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
- [ ] Harness v1: launch Chrome (fresh + warm profile), drive a scripted run, capture
      frame times, JS heap, GPU memory (as measurable), pipeline compile stalls, cache
      hit/miss (V8 code cache, HTTP, Dawn where observable), diff against budgets.md,
      fail on bust. First slice in progress: `smoke@1` now pins/validates CfT, runs three
      fresh/warm pairs, gates main-thread long tasks, and records worker callback pacing,
      window heap, atomic HTTP cache deltas, validated artifact/source identity, plus
      explicit metric states. Registered-machine environment verification now probes the
      exact OS build, CPU/RAM, GPU/driver/WebGPU backend, power scheme, display mode, and
      rejects remote/indirect displays (D-034). Verified `measured` across three native-console
      fresh/warm pairs on dev-01 at 4K/60 on 2026-07-13; RDP remains non-gating (RE-002), and
      the fractional-scale surface discrepancy is recorded as RE-003. Post-review native
      reruns confirmed that moving Chrome diagnostics before the full warmup resolves the
      harness-induced ~32 Hz callback pacing (RE-001). A page-windowed Viz trace now records
      presentation-feedback callback cadence, but Chrome omits the success/failure flag, so
      true presentation remains mandatory/invalid (D-035, RE-006). The D3D12 Dawn probe now
      cross-checks page-windowed pipeline/shader trace events against synchronized GPU-process
      cache histograms (D-036, RE-007): a three-pair remote diagnostic measured fresh launches
      at 6 shader/3 graphics-PSO misses, every warm relaunch at 6/3 hits, and zero pipeline or
      shader compilation overlapping all gameplay windows. A first physical-console rerun measured
      all three fresh launches at 6 shader/3 graphics-PSO misses and warm repeat 1 at 6/3 hits, but
      RE-008 invalidated warm repeats 2 and 3 before their evidence could be retained; a complete
      three-pair native baseline still remains. The V8 JavaScript code-cache trace
      probe now URL-matches every immutable build artifact and requires positive consumed bytes
      with no rejection (D-037/D-038), but Chrome omits that result for the walking skeleton's streamed
      ES-module path; all three warm diagnostics remain mandatory/invalid (RE-009). Wasm cache
      evidence remains for when the first wasm artifact lands. Trace-drain volume, command time,
      completion time, and partial timeout evidence are now part of the result. A remote
      A/B retained exact V8 evidence while replacing `devtools.timeline` with `v8`, reducing
      completed-trace volume from about 5.0 MB/150 ms to 4.1 MB/119 ms (D-038). The narrower
      category still timed out on 3 of 12 traces versus 0 of 6 with no V8 category; captured
      failures acknowledged `Tracing.end` in 1.6–2.1 ms but delivered no event chunks or
      completion within five seconds. `ReturnAsStream` reproduced the failure and was rejected.
      D-039–D-043 now run mandatory V8 evidence in three isolated `v8-code-cache@5`
      fresh/timestamp → produce → warm/consume lineages inside result schema v11. A remote
      diagnostic completed all 9 V8 traces: every produce launch wrote 3,072 app bytes and 6,968
      engine bytes, while the render worker emitted no production event in 3/3 lineages despite
      containing 99.84% of decoded JavaScript (RE-010). Fresh emitted no unexpected production,
      warm re-produced 0/3 cacheable artifacts in every lineage, and every launch-3 cacheable
      artifact still omitted consumption evidence. The no-reproduction control narrows RE-009 to
      an app/engine observability gap without substituting for positive consumption. Core trace
      failures at ordinals 3–5 followed by success at ordinal 6 argue against a simple late-run
      cutoff and extend RE-008; a final-tree rerun then completed all 6 core and 9 V8 traces with
      the same V8 outcomes. Ordinal and elapsed-sequence timing now ship in every trace record.
      Per-artifact compile-event durations are also retained as non-gating diagnostics: the
      non-streamed worker measured 24.4–26.8 ms with overlapping fresh/warm ranges, while streamed
      app/engine spans were only 2–40 µs. These spans constrain current launch-cost risk but do
      not substitute timing inference for cache evidence (D-042). End-to-end worker startup to
      first frame measured 182–207 ms fresh and 144–155 ms warm across two runs, so the current
      warm component is modest but cannot be attributed specifically to V8. Launch 2 was normally
      146–153 ms but retained one 789.5 ms outlier from the whole worker-to-frame path. Core/V8
      recording lifetime is now explicit (normally about 13.2–14.2 s versus 0.29–0.39 s; the
      startup outlier extended one V8 trace to 0.94 s). A controlled
      blank-page matrix completed 6/6 short-core, 6/6 14.1 s core, and 6/6 14.1 s V8 traces;
      lifetime alone does not reproduce RE-008, leaving active-page event/process/volume regime
      as the next controlled variable (D-043). An active 4K app control tracing only
      `blink.user_timing` still timed out once in six launches with zero delivered events/chunks;
      enabled GPU categories and multi-megabyte payload are not necessary, and the responsible
      process remains unproved. The same control's unchanged V8 lineages had launch 3 slower
      than launch 2 in two of three repeats, rebutting a consistent ≤5 ms cache-savings bound
      (D-044). Result schema v12 now separates registered-environment validity, mandatory-evidence
      completeness, and budget evaluation while retaining the fail-closed aggregate `passed` bit
      (D-045). An observed budget bust fails independently, while passing partial checks remains
      explicitly `not-evaluated` whenever mandatory evidence is incomplete; known compositor and
      V8 gaps therefore cannot appear green even when the physical-console environment passes. A
      native schema-v12 dev-01 run verified that exact outcome: environment `passed`, evidence
      completeness `failed`, and budget evaluation `not-evaluated` after 17 executed checks with
      no observed threshold bust. RE-008 additionally invalidated two of six core traces while all
      nine isolated V8 traces completed.
- [ ] Spike: WebGPU-in-worker + OffscreenCanvas with Babylon (go/no-go). The walking
      skeleton is positive integration evidence; controlled pinned-Chrome maturity,
      main-thread-escape, and environment-identified measurements remain before the
      spike can produce its finding/decision write-up.
- [ ] Spike: SAB ring buffer main↔worker.
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
- [ ] Spike: Rust→WASM module with wasm threads.
- [ ] Spike: memory64 module load and cost; this validates the optional last-resort path
      in P-001, not a default wasm64 target.
- [ ] Harness result contract implemented (budgets.md → Measurement methodology):
      metric states, environment identity, artifact digest + dirty-tree identity,
      per-milestone mandatory-metric sets, variance gate, baseline-promotion policy.
- [ ] Exit: one command produces a built, locally served build (local serving only at
      M0 per D-011/D-022 — production deployment is M2) and a budget report; all spike
      results recorded in rough-edges.md or decisions.md.

## M1 — Greybox District 1 streaming  `pending`

- [ ] Procedural greybox content for D1 (cells, LOD tiers, collision) at target world
      scale.
- [ ] Streaming worker + decode pool: OPFS → decode → GPU upload, driven by player
      movement, inside memory budget with proactive eviction.
- [ ] Geometry-representation spike (P-002): triangle LOD vs. meshlet-virtualized vs.
      Gaussian splats on representative content, harness-measured at both quality tiers;
      results recorded in decisions.md + rough-edges.md.
- [ ] Scripted harness flythrough as the standard regression run.
- [ ] Benchmark mode (D-025): expose that same versioned flythrough, fixed settings,
      warm-up/repeats, environment identity, and JSON + human-readable result export in
      the game; the complete run and measurement path works from in-game with no
      external driver, non-Chrome results are advisory, and missing capabilities/metrics
      remain explicit rather than gaining compatibility fallbacks.
- [ ] Exit: 10-minute flythrough with zero budget violations; streaming metrics
      dashboarded.

## M2 — Install/launch/run lifecycle + caches  `pending`

The heart of the platform research. Prerequisite: production serving live on
parallax-web.com (D-011) — cache findings measured only against local serving aren't
credible.

- [ ] Production deployment to parallax-web.com with versioned nginx/header config;
      harness can target local and production and labels results accordingly.

- [ ] Installer UX: manifest, resumable multi-GB OPFS pull, integrity check,
      persist-storage. Manifest schema distinguishes common (engine, shared packs,
      models) vs. game-specific resources with hash addressing for the common set
      (COS-ready, D-010).
- [ ] PSO trace capture + progressive warmup at boot; verify Dawn cache behavior
      launch-1 vs launch-2.
- [ ] V8 code-cache validation (instantiateStreaming, 304/immutable discipline); update
      flow that preserves code caches on asset-only changes.
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
- [ ] Exit: repeated D1↔D2 transitions through every entrance in a harness run with no
      contract violations.

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
