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
      **qualified go** for M1's storage boundary (D-058/D-066). OPFS microbenchmark
      repeatability remains informational (RE-023); M1 owns the representative
      OPFS-to-renderable cell-load p95 gate.
- [x] Browser AI spike: Prompt API is a measured **no-go as a required backend** in
      pinned CfT (D-059/RE-019), while its sandboxed branded-Chrome install,
      restart/resume, post-restart, and offline lifecycle qualified separately (D-065).
- [x] App-owned AI spike: pinned Gemma 4 E2B QAT GGUF on wllama WebGPU qualified with
      structured-output and OPFS lifecycle evidence; CPU/WASM remains measured headroom,
      not an automatic fallback (D-073/D-074; RE-030/RE-031/RE-032). Restart-persistent
      KV snapshots were a measured no-go for this runtime; live idle pre-seeding remains
      the preferred follow-up (D-075/D-084).
- [x] Rendering-core selection: the measured head-to-head selected exactly pinned Babylon
      Lite 1.11.0 (D-077/D-078); D-080 removed classic Babylon and renderer swappability.
      Bounded Lite integration gaps and M1/M3 follow-ups remain in D-078 and
      [rendering-engine-research.md](rendering-engine-research.md) §7.
- [x] Rust/WASM capability spikes: reproducible threaded SIMD/atomic modules qualified
      under the mandatory smoke contract (D-085/RE-035), with fail-closed worker-startup
      phase evidence retained for intermittent Chrome stalls (D-088/RE-036). The optional
      memory64 path demonstrated exact beyond-4-GiB access and passed its paired cost gate
      (D-086); P-001 remains open for representative M1 adoption evidence.
- [x] M0 exit dependency checkpoint completed under D-079. Node 24.18.0 and CfT
      151.0.7922.34 were adopted; bounded deferrals and recheck triggers remain in
      [dependencies.md](dependencies.md).

**Exit evidence:** `pnpm m0:gate` produced
`smoke-1-1e01757c4726-dev-01-showcase-2026-07-21T00-58-13-338Z.json` on registered
dev-01's physical console under pinned Chrome 151 and Node 24.18.0. All three facets,
all six core runs, and all 24 blocking checks passed. The result was explicitly promoted
after comparison with the same-artifact Chrome 150 anchor. RE-008 and RE-036 retain the
intermittent trace-completion and Wasm-instantiation failures rather than treating the
passing replacement as erasure.

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
