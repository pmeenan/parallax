# Plan

**This is a living document.** It will change as the project evolves — milestones will be
re-scoped, re-ordered, split, or added as measurements and findings come in. That churn is
expected and healthy; what is *not* allowed is silent change. Scope changes get a
decision-log entry; progress changes are reflected here by checking boxes and updating
status lines as work lands.

Milestones are ordered by risk. M0–M4 established platform and greybox foundations;
D-182 now brings representative art into M4.5 to expose content and integration risks
early. Each milestone has measured exit criteria and human visual acceptance where
applicable. Check a box only when the item is done and verified; partially done items
stay unchecked, optionally with a note.

**Status legend:** `pending` · `in progress` · `done` · `parked`

Active milestones retain task-level progress notes. Once a milestone is complete, compress
it to its delivered scope, final outcomes, unresolved carry-forwards, and exit evidence;
incremental run history remains in decisions.md, rough-edges.md, dependencies.md, and the
harness result artifacts.

Physical `smoke@1` qualification is a milestone-exit gate under D-181, not a plan-item
gate. During a milestone, each item uses focused checks and the relevant specialized
scenario; the exact converged milestone candidate receives one Showcase smoke before
the milestone can close. A failed exit report is retained and localized through a
focused reproducer and commit bisection before the corrected exit candidate is rerun.

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

M2 delivered the browser-native installed-product lifecycle and its primary cache,
storage, offline, and production-serving research. D-153 closes the milestone on
registered dev-01 Showcase. Incremental implementation notes and failed-run history
remain in the decisions cited below, [rough-edges.md](rough-edges.md), and the
machine-local harness results.

- [x] Production serving and deployment: versioned nginx/MIME/isolation configuration,
      guarded preview-first deployers for the app and immutable model content, exact
      production inventory/identity checks, and local-versus-production target labeling
      (D-121–D-127).
- [x] Installed release lifecycle: install-manifest v1 and content-addressed common/game
      resources; a Web-Lock-serialized append-only OPFS release store; strong-validator
      resumable Range/If-Range transfer; main-thread persistence request; explicit
      install, progress, cancel, retry, repair, publish, reload discovery, and launch
      admission; and ordinary streaming/model consumers bound to the exact active
      release with no network fallback (D-128–D-138).
- [x] Offline, integrity, and removal: release-bound atomic offline-shell generations,
      bounded corruption/interruption/quota/browser-restart recovery, raw trust and
      crash-safety proofs, plus confirmed in-shell and `Clear-Site-Data` uninstall paths
      with positive quota-release evidence (D-138/D-145–D-147).
- [x] Cache lifecycle: release-owned PSO trace capture and progressive boot warmup
      (D-139), plus an asset-only update qualifier whose warm-launch result passed while
      V8 cache attribution remained explicitly best-effort rather than a cache-hit claim
      (D-144).
- [x] Scale: production manifest parsing and exact summary/identity were exercised with a
      deterministic ≥100 GiB document, while representative physical streaming covered
      a 165,505,371,388-byte / 71,680-resource model through a 2,623,040,066-byte target.
      D-148 deliberately retires a literal 100 GiB write as non-authoritative: actual
      capacity remains quota-, free-space-, and storage-pressure-dependent.
- [x] Exit qualification: D-149 accepted the M2-exit/M3-entry dependency checkpoint;
      D-150 made dev-01 the sole required physical gate; D-151 accepted exact
      install/launch/update evidence; D-152 accepted installed branded-Stable parity; and
      D-153 closed M2. The accepted M3-entry set is recorded in
      [dependencies.md](dependencies.md#full-checkpoint--2026-08-01-m2-exit--m3-entry);
      the next full currency checkpoint is M3 exit or 2026-08-29, whichever comes first.

**Exit evidence:** D-151's accepted dev-01 lifecycle pair bound CfT 151.0.7922.71 and the
exact installed release. Initial install completed with 21,286.798 ms of network-active
time and 78,073.157 ms of local critical residual; fresh installed launch was
5,821.355 ms, warm launches were 9,157.250/5,681.140 ms, and the asset-only update delta
was -3,476.110 ms. D-153's exact-current production `smoke@1`
`smoke-1-e4532dcec4d6-dev-01-showcase-2026-08-02T00-30-12-454Z.{json,md}`
passed exact pre/post production identity, all six launches, all three facets, and 30/30
checks under schema v62 / mandatory metric set v28. Deterministic closure gates preserved
repeatable output, linted 422 files, passed 2,274 tests across 172 files with one skip,
and passed `git diff --check`.

**Post-closure qualification:** D-154 prospectively made short-`smoke@1` cross-launch
streaming p95 repeatability an explicit informational diagnostic while preserving valid
per-launch evidence, the 250 ms p95 budget, all 30 checks, and longer-scenario
repeatability gates. The corrected physical-console schema-v64 report
`smoke-1-2404befc4e5d-dev-01-showcase-2026-08-02T21-53-48-499Z.{json,md}`
passed exact production identity, all six launches, all three facets, and 30/30 checks.
Historical failed and environment-invalid attempts remain immutable.

**Scope and carry-forwards:** closure claims only registered dev-01 Showcase—no Standard,
Metal, other-hardware, or promoted-baseline result. A literal 100 GiB transfer was not
executed. Chrome still exposes no origin-scoped proof of HTTP, V8, or Dawn cache
inventory/eviction (RE-046); dedicated workers still cannot request persistence
(RE-045); and worker/GPU-boundary streaming variance remains unattributable (RE-043).
The current platform synthesis and asks are in
[chrome-platform-gaps.md](chrome-platform-gaps.md).

## M3 — Gameplay core + NPC AI  `done`

- [x] Deterministic 60 Hz sim worker, SAB presentation snapshots, semantic events, and
      versioned replay/save/load (D-156).
- [x] Deterministic character controller, third-person camera, interaction input, and
      streaming/recovery integration in greybox D1 (D-158).
- [x] Sim-authoritative tiled navigation, authored schedules, and 48-agent crowd
      avoidance with fixed-pool presentation (D-140/D-159).
- [x] Measured UI substrate spike selected the hybrid DOM/CSS plus render-worker split
      and closed P-008; RE-047 retains the platform gap (D-143/D-160).
- [x] Framework-free typed hybrid UI substrate with semantic/IME controls, recovery,
      input ownership, and harness telemetry (D-141/D-161).
- [x] App-owned wllama/GGUF NPC dialog with bounded memory, strict authored output,
      cancellation, and functional model-unavailable fallback (D-074/D-096/D-162).
- [x] Bounded NPC knowledge retrieval over authoritative sim and authored world state,
      with stable citations, token budgets, cancellation, and telemetry (D-033).
- [x] Exit: the playable Mara Venn fallback conversation, direct save/reload, and
      repeated same-host deterministic replay passed on registered dev-01 (D-150/D-163).

**Closure evidence:** D-164 accepted M3 after the schema-v71 / mandatory-metric-set-v34
local report
`smoke-1-1100d5e4e754-dev-01-showcase-2026-08-09T19-26-30-249Z.{json,md}`
passed six launches, all three facets, and 36/36 checks, followed by exact deployment
and passing production
`branded-parity-v2-2026-08-09T20-45-12-228Z/result.{json,md}`. Local JSON/Markdown
SHA-256 are `843fb1237d668580232aa3e84ae732fd44fa61825eeaf64e7c41c83140c95b00` /
`83724096791a4b2f871120c7da6ba0cf6c441b308f1cd396f624568457ee2822`;
parity JSON/Markdown SHA-256 are
`7220e4ef1ddaefdf11b8974c11a7013c973e847b533fa569e9b4c95ee300c7be` /
`72483ba44e1b0c846ef1d99c07274d4ae309e7346a9a17cedcc01e3300e0a2a4`.
Real inventory/journal/settings screens remain consumer work; semantic lore retrieval,
episodic memory, and cross-machine replay remain build-later.

## M3.5 — Gameplay systems  `complete`

- [x] Original slice-scale ruleset and headless balance model for deliberate-but-
      forgiving combat, magic, progression, loot/economy, crafting, and quests
      (D-142/D-165).
- [x] Deterministic melee/ranged/magic combat, damage/status resolution, equipment,
      abilities, semantic events, and versioned replay/save state.
- [x] Authored navigation-aware creature and pack AI with readable attack/flee/boss
      behaviors and recurring pressure coverage (D-166).
- [x] Classless level-2-to-10 progression, attributes, learned abilities, active/knack
      loadouts, authored XP pacing, and combat consumers (D-167).
- [x] Saved gathering/regrowth, 24-recipe station crafting, vendors, consumables,
      equipment/upgrades, seeded loot/affixes, and bounded inventory economy (D-168).
- [x] One-time landmark discovery, the six-stage main arc, eight side quests,
      semantic objectives, preparation consequences, and append-only queryable journal
      (D-170/D-171).
- [x] Authoritative hybrid-UI inventory/crafting, progression/loadout, and quest/journal
      consumers, plus XP/unspent-choice, level-up payoff, and Ironset feedback (D-172).
- [x] Exit: the game-owned `m35-gameplay-slice@1` command log completes fight → loot →
      trade → craft → level → two multi-objective quests with byte-identical replay,
      save/load, live-worker round-trip, and exact semantic counters (D-150/D-173).

**Closure evidence:** D-173 accepted M3.5 after exact build artifact
`c7054f88eb10976bce076be4819f994be2b2624b5067913d587261ae857be279` /
install release
`15528289e8b0fca4a6e5d2eaa39281814c5f0648311176c94d31c574bce690f3`
passed `pnpm check` (202 files / 2,568 tests, one skipped). Registered dev-01
Showcase report
`smoke-1-c7054f88eb10-dev-01-showcase-2026-08-22T23-28-14-949Z.{json,md}`
passed schema v72 / mandatory metric set v35 on CfT 152.0.7977.54 across all six
launches, all three facets, and 36/36 checks; JSON/Markdown SHA-256 are
`41a50d66aed751725dd7f3cdffa0bad12ff4890b6fedfbbfcb8641cc6302c185` /
`fbe384171c3a94648ab8f13f8af3252fc740e578b1139e876d293a5d64706ff8`.
Every scenario replay/save/load converged on
`8548ffcd21d3217d5fb7643391647a53771e71d6f123a161eda534c238d3b59e`;
the ordinary simulation-step high-water was 0.740 ms. The same artifact also passed
the complete contract on retained CfT 151.0.7922.108 before the Stable transition.

## M4 — District 2 (catacombs) + hard transitions  `done`

- [x] Greybox catacombs district; multiple entrance choke points with different surface
      contexts, driven by world-graph data (D-174).
- [x] Full resident-set swap meeting the transition contract in budgets.md, per entrance
      (D-175/D-176). The game-owned `m4-district-swap@1` scenario derives all six
      directed crossings from the three world-graph edges. The corrected schema-v74
      dev-01/Showcase matrix passed all 36 samples across three fresh and three warm
      launches: worst total 320.4 ms, worst hitch 16.9 ms, logical GPU overlap 1.000×,
      at least seven measured frames, exactly nine proactive evictions, and exclusive
      source/destination resident sets for every crossing. D-175 retains the superseded
      schema-v73 artifact; final corrected evidence identity is recorded in D-176.
- [x] Calibrate the per-entrance **prefetch trigger** from greybox transition
      measurements and add it to the budgets.md transition contract via a decision-log
      entry (D-055 — the contract element is deliberately undefined until these
      measurements exist).
- [x] Exit: repeated D1↔D2 transitions through every entrance in a harness run with no
      contract violations — including the prefetch-trigger element the calibration task
      above adds; the exit cannot be declared against a contract that still lacks it.

**Closure evidence:** D-177 completes D-055 with world-graph schema v2 and exact 6 m
castle / 5 m village / 5 m forest latest-start triggers at 12 m/s. The final
schema-v75 / mandatory-metric-set-v35 dev-01/Showcase report
`smoke-1-e2533f33f051-dev-01-showcase-2026-08-24T01-07-54-872Z.{json,md}` passed
all six launches, all three facets, and 36/36 checks. Across all 36 directed swaps,
worst total was 232.510 ms against its 500.000 ms lead, worst hitch was 16.780 ms,
logical GPU overlap remained 1.000×, every window retained at least five frames, and
every sample proved nine proactive evictions plus exclusive resident sets. JSON/Markdown
SHA-256 are `32d0040621c836b5b2659048e0ce3ade0e7bd7635382747c2f0ac18903a426e3` /
`32f52574ed130c67dc1415211b196d61120f7fe5cf766cacfe3e56d11470ff9d`.
The earlier passing 5 m / 4 m / 4 m schema-v75 candidate is retained as calibration
input only; its near-zero village headroom forced the final outward recalibration.

## M4.5 — First finished playable area  `in progress`

D-182 replaces the all-tracks-first environment program with a representative area in
the existing streamed world. The immediate target is one finished village street or
courtyard, with a distant castle silhouette and a route to an existing catacomb entrance.
Develop art, animation, lighting, and effects together here; use the resulting combined
workload to choose further research. This is a small finished footprint within the
open-world architecture, not a separate showcase scene that bypasses production systems.

The broad rendering ambitions remain in the research backlog below. Only techniques
needed by the selected scene or a measured bottleneck enter the critical path. Reuse
established implementations verified against the exact project pins; custom work needs
a named visual deficiency, capability demonstration, or platform limitation. Dynamic
lighting, worker ownership, deterministic simulation, asset QA, and install/streaming
contracts remain binding.

### Delivery sequence

These are checkpoints within M4.5, not additional milestones or full-smoke gates.
Each uses focused validation, representative captures, and measured combined costs.
Use the bounded visual-work procedure in [workflow.md](workflow.md#bounded-visual-and-research-work).

1. **Finished daylight courtyard.** Establish the asset pipeline and material/shadow
   baseline with final-quality representative content.
2. **The same area at night and in a storm.** Establish dynamic local lighting,
   atmosphere, and selected signature fire/lightning effects in the combined scene.
3. **Five-minute playable route.** Combine animation, encounter readability, NPC
   interaction, spatial sound, and a D1↔D2 crossing using existing gameplay.
4. **Density and coverage expansion.** Exercise the kit at higher density and through
   streamed cells to identify the real bottlenecks and set M5's expansion priorities.

**First two-week trial:** starting with implementation of this revised plan, target CSM
integration, the first reference/kit and binary-asset path, and a before/after courtyard
comparison. This is a planning target, not a completion promise or quality waiver.
At the end of each active development week, link the latest playable build and captures,
state the visible improvement and remaining blocker, and record any actionable platform
finding. At two weeks, assess actual asset throughput and edit-to-visible-result time
and adjust the next work package. No unattended scheduled work is implied.

### Current work and exit checklist

- [ ] Integrate the selected CSM candidate into the shipping render worker, release-owned
      PSO warmup trace, and public telemetry. Measure the standard-flythrough delta
      before expanding the isolated shadow experiment or starting GI comparisons.
      Retain invalid control evidence as invalid; integration is not adoption until
      measured and visually verified.
- [ ] Author sunny and gloomy references and a small modular D1 kit: architecture,
      representative PBR materials, terrain detail, foliage, and the castle silhouette.
      Activate the applicable mesh/UV/texture/LOD/export QA before the first binary
      asset enters the library; resolve P-004 binary storage at that point.
      Preserve authored deterministic terrain, collision, and streamed ownership.
- [ ] Produce one rigged NPC and one enemy with locomotion, idle, and the encounter's
      combat animation through the same provenance and QA path. Use existing gameplay
      and Babylon animation; additional body types remain M5 expansion.
- [ ] Integrate the daylight area in the ordinary installed game, with moving near,
      mid, and vista cameras. Inspect material response, contact/cascade artifacts,
      foliage, character motion, and LOD transitions together. Human visual acceptance
      records the reference, exercised states, known compromises, and captures.
- [ ] Add night/storm presentations: dynamic local lights, readable atmospheric depth,
      a selected torch/fire example, and lightning. Couple visible fire and illumination
      coherently; choose the implementation by observed payoff and cost. More elaborate
      emissive transport and the full fire/smoke range are research options, not
      prerequisites. Share wind across consumers introduced here.
- [ ] Make the five-minute route playable: an existing encounter, NPC conversation,
      and catacomb crossing, with a small QA-gated spatial SFX/ambience set. Validate
      animation/readability, input, save/replay, and the surface/underground contrast.
      Exercise inference while the representative scene renders and streams.
- [ ] Measure the integrated daylight/night/storm workload and a bounded density/
      streamed-cell expansion. Record whole-frame GPU and CPU-submit distributions,
      available memory/allocation evidence, streaming, warmup, and inference impact.
      Document total cost and proposed headroom for remaining content as required by
      [budgets.md](budgets.md#integrated-rendering-planning-d-182); do not infer physical
      presentation or residency from proxy counters.
- [ ] Establish representative-art no-visible-pop evidence at the 12 m/s traversal/
      LOD contract for the finished route, including deterministic visual comparisons
      and motion inspection. M5 extends this evidence across D1; greybox coverage
      never established the claim.
- [ ] Exit: the daylight area, night/storm presentation, and playable route have human
      visual acceptance; adopted features run through the standard flythrough's relevant
      weather/time states; combined costs and calibrated allocations are documented;
      actionable findings feed the Chrome synthesis; the exact converged candidate
      passes applicable budgets and the D-181 milestone-exit smoke. Unaccepted required
      outcomes keep M4.5 open. Backlog completion is not an exit condition.

**Retained shadow evidence (not adoption):** the deterministic solar/sky/ground model
and directional sun are already live and instrumented. The standalone
`m45-directional-shadow-strategies@4` narrowed near/mid/vista coverage to four-cascade
CSM at 4×1024 with 0.12 m world-space bias; faint top-face striping remains.
The amplified native-4K proxy used 425 architectural and 128 curved casters (553 meshes,
about 2.23 million curved-caster triangles before cascades). Confirmation report
`m45-shadow-strategies-2026-09-01T18-53-19-616Z/result.{json,md}`
(JSON SHA-256 `72e00c1d794edbdd6e5cfa0c9fcef08e7788f15ab4edb422b3a3757fa0fa4edf`;
Markdown SHA-256 `4756b04c3331a66adfcb54ef6d3d391140c8e2badac324e7dbf022e1a3281cf4`)
records CSM whole-frame GPU p50 3.412/3.156/3.298 ms (8.1% range), CPU-submit
0.645/0.605/0.640 ms (6.6%), and shadow-task 1.376/1.245/1.311 ms.
The no-shadow arm remained invalid at 143.8% range; no control-relative delta is claimed.

### Rendering research backlog — promote only for a named need

D-182 defers the unselected scope below without claiming it was evaluated or ruled out.
A selected showcase moment or representative-workload limitation is the promotion trigger.
Record the question, bounded allowance, measured conclusion, and implementation outcome;
only load-bearing choices need a decision entry. No exhaustive comparison or
per-row experiment is required to keep a topic deferred.

| Area | Retained ambition and promotion trigger |
| --- | --- |
| Lighting/GI | Fully dynamic indirect lighting, many-light shadows, and emissive transport when the night/interior scene exposes an unacceptable lighting gap or supplies a selected platform study |
| Atmosphere | Volumetric clouds, god rays, and richer aerial perspective when the selected vista/storm needs them |
| Terrain/material generation | Extend deterministic instruction-set terrain and generated stone/wood/brick/mud/clay/straw; compare install/runtime generation with baking when representative content makes the byte/compute trade-off meaningful |
| Vegetation/wind | District-scale instancing, LOD, and richer shared wind when density expansion reveals cost or visual deficiencies |
| Water/reflections | Ocean/lake/moat, wet streets/puddles, SSR/probes; select for a water/wetness scene, and cost simulation separately |
| Dynamic surfaces | Cosmetic mud tracks/footprints, wetness/snow blending, and sim-queryable friction classification when a chosen encounter needs them; destruction remains excluded |
| Fire/smoke | Movie-quality torches through burning buildings, wind-driven plumes and emissive lighting; extend beyond the initial fire only for an authored showcase |
| VFX substrate and magic | Shared GPU particles/volumetrics, gas/steam/mist, electrical arcs, trails, frost/ember responses; grow from selected effects, never build the whole library first |
| Image pipeline | AA, tonemapping/grading, bloom first as the scene requires; TAA/upscaling, HDR, DOF, motion blur and heat refraction require a visual/cost need; custom temporal reconstruction is not presumed necessary |
| Transparency/decals | OIT, puddle edges, moss, wear and mud where demonstrated sorting or dressing needs justify them |
| GPU-driven rendering | Compute culling/occlusion and indirect draws when representative density identifies a bottleneck; qualify any required pinned interop and document encountered platform gaps |
| Texture residency | Virtual texturing or finer residency streaming when the real material working set exceeds the selected streaming approach's measured capacity |

## M5 — District 1 art and density expansion  `pending`

M4.5 establishes the first art, animation, audio, and visual-validation paths (D-182).
M5 scales their accepted output through D1; it does not wait for every rendering
backlog topic to conclude.

- [ ] Expand the validated reference → generation → QA → library pipeline and modular
      kit/trim sheets across D1, measuring throughput and consistency.
- [ ] Expand locomotion, combat, and schedule/idle animation across the required races
      and monster body types. Preserve the established rig/export/retargeting checks.
- [ ] Improve character rendering against chosen in-game references. Skin/SSS, eyes,
      hair/fur, cloth, muscle deformation, and IK are bounded research options selected
      by visible deficiencies, not a mandatory technology checklist before expansion.
- [ ] Extend the finished art and D-115/D-182 visual-pop validation to all representative
      D1 traversal/LOD conditions at 12 m/s without regressing applicable M1/M2 budgets.
- [ ] Promote only rendering backlog work needed by observed density, content, or
      selected showcase requirements; measure it in the integrated scene.
- [ ] Resolve cinematics/scripted-camera scope before entering M6 (D-141).
- [ ] Exit: D1 fully art-passed with human visual acceptance, all applicable budgets
      green, install size within budget, and one exact-candidate milestone-exit smoke.

## M6 — District 2 art, audio, polish  `pending`

- [ ] D2 art pass with a distinct palette/kit.
- [ ] Expand M4.5's spatial audio and QA-gated SFX/ambience pipeline to district scale,
      including HRTF and surface/underground acoustic contrast.
- [ ] Adaptive music (D-141): weather/danger/district-reactive score consuming the
      existing semantic event stream, with AI-generated/sourced content through QA.
- [ ] Expand authored VFX from the accepted M4.5 examples. Select further fire/smoke,
      spell/potion, gas, or burning-building moments for visible payoff; commission
      missing technology through the bounded research backlog as needed. M4.5 does
      not promise every effect substrate is complete.
- [ ] Extend weather and precipitation beyond the accepted storm example as needed
      for D1/D2 presentation; snow accumulation and deformation remain conditional
      research scope, not assumed M4.5 dependencies.
- [ ] Evaluate selected physics garnish (ragdolls, ropes/chains, buoyancy/rowboat) and
      photo mode within bounded allowances; adopt or explicitly defer based on payoff.
- [ ] Resolve and deliver the selected accessibility scope before final handoff.
- [ ] Optional Standard-tier/cross-hardware research (D-150): retain advisory findings
      when hardware is available without adding a milestone gate.
- [ ] Exit: an end-to-end demo a stranger can install and play, visually accepted and
      qualified on the exact dev-01 candidate under D-181. Other-hardware results
      remain advisory.

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
