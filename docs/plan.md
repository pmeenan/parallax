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

**Repository lint cleanup (2026-09-23):** all 117 outstanding diagnostics are resolved:
114 JSON formatting fixes (including the ignored machine-local tool registry) and
accessible titles for three SVG reference plans. Retained asset metadata preserves its
measurements; hash/size references were refreshed for the new serialization. Earlier
handoff reports describing lint blockers are historical. Physical smoke remains deferred
to M4.5 exit; this cleanup changes no runtime code or artwork.
`pnpm check` passes build/repeatability, lint (757 files) and unit tests (221 files;
2,697 passed, one existing skip). A separate data comparison verifies that only formatting
and dependent file identities changed across the 121 affected JSON files.

### Delivery sequence

These are checkpoints within M4.5, not additional milestones or full-smoke gates.
Each uses focused validation, representative captures, and measured combined costs.
Use the bounded visual-work procedure in [workflow.md](workflow.md#bounded-visual-and-research-work).

0. **Concept direction collection — accepted2026-09-20 (D-195).** The
   [selected collection](../assets/reference/concept-art-collection-review.md) supplies
   the production baseline. Supplementary static views/choices are listed and reviewed
   per production subject; motion/courtyard/shore obligations follow D-192–194.
   This closes the collection prerequisite, not unfinished profile or runtime acceptance.
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

**Next up (2026-09-24):** engine package 2, render-path geometry for the paving. The ordered
list of front-loaded [engine packages](#engine-packages) gives its starting numbers and target.
Packages 3–5 follow it: texture compression A/B, then lighting balance with AO, then
small-scale shadows. The flythrough harness repair is a separate task.

**Spatial-audio foundation (2026-09-11; parallel technical work):** implement bounded
positional playback and clip memory, shared gameplay-camera listener geometry,
semantic-event routing, and cleanup on district/authority/presentation changes. Use
synthetic measurement signals only in focused tests; no sound asset is admitted and
the concept-art gate stays open. Verify stereo orientation/attenuation in pinned
Chrome, activation and resource lifecycle, and game-event integration. Allow two
implementation/verification cycles within one two-hour work session. End with a
tested service integrated into the ordinary runtime and explicit remaining content
work; final SFX/ambience, acoustics, and artistic acceptance remain M4.5 work. Full
physical smoke stays at milestone exit.

Foundation implementation and focused Chrome verification are complete. The
[service contract](spatial-audio.md)
describes the empty shipped bank and remaining audio QA/content/installed-loading work.
Pinned Chrome 152.0.7977.54 verified stereo handedness, listener rotation and the
expected 10:1 amplitude ratio at 1 m versus 10 m. A forced-suspended native context
resumed on a trusted click; 32 voices, capacity rejection and scene/disposal cleanup
passed. The 120-frame zero-gain control window measured p50/p95/max
0.105/0.220/0.290 ms (diagnostic submission cost only). The ordinary network-authorized
runtime reached render/simulation/streaming readiness with telemetry v49, no audio
content and no browser errors. Evidence:
`harness/results/spatial-audio-2026-09-11T18-47-23-268Z/result.json`, binding artifact
`eabe0ba8ef461d090db58e085dac46d1e67e74442f724c157980cb6f55101a70` and release
`edfa1c9d7194de314a278cc189cc30e43f2d52301678076d67d7488471bb0875`.
The installer-repair fixture is rebound under semantic contract v14; its verification
rules and resource identities remain exact. The exact-artifact production replay passed:
`harness/results/installer-repair-production-replay/installer-repair-production-replay-v4-2026-09-11T18-49-18-246Z.json`
(SHA-256 `0e91f159c7f1b03a4dacedf4a66ce9ee993f6136ea99adc28045484bfecf6f12`).
Build/repeatability, TypeScript, focused audio tests and the final full unit run passed
(219 files; 2,674 passed, one skipped). Earlier source-identity test mismatches did not
recur in the final full run. At that handoff, `pnpm check` reached lint and was blocked by missing
accessible titles in the concurrently authored
`assets/reference/concepts/batch-074/d1-shared-site-plan-v1.svg` and `v2.svg`.
The repository lint cleanup above resolves those diagnostics. No artistic or milestone
acceptance is claimed.

**Animation import/validation work brief (2026-09-11, human requested):** implement
the source-candidate path while concept production continues. Use an original,
procedural two-joint test fixture, not a new character asset. Answer whether exact
GLB source bytes can pass Khronos validation, class-specific rig/skin/clip checks,
and pinned Babylon Lite loading in a Chrome worker. Reject malformed data,
incompatible rigs, broken loop endpoints and unintended root travel. Preserve source
bytes and provenance in an immutable candidate report; library admission, compressed
packaging, final NPC/enemy content and motion/artistic acceptance remain separate.
Allow two implementation/verification cycles within a two-hour session. End with
the usable import command, exercised rejection cases and retained worker evidence.
No milestone smoke is due for this source-tool change.

The first native probe exposed the lazy capture-service boundary; the corrected
frame pump then loaded all clips but produced black captures. Retain the failed
attempts. Extend by one bounded
45-minute implementation/verification cycle to give the mathematical fixture an
explicit matte material and explicit scene-camera binding, prove visible deformation
and finish the source-tool checks. Source inspection identified the missing camera
assignment in the diagnostic (the generic add helper did not register it).
This corrects the diagnostic; it does not select character art or change runtime lighting.

**Outcome:** the source import command, strict TypeScript QA package, compatibility
fingerprint and pinned-loader worker check are implemented. Final evidence:
`harness/results/animation-import-2026-09-11T19-31-00-835Z/result.json`
(SHA-256 `ed5dc21e1100b7c386128ee712b610ed8129a87362803cfe632f36a5c779da55`).
The exact fixture GLB `d6282c6d035577b5e6167351135af215ec2663ef84fb87b7073158c51a36fb93`
loaded one mesh, two named joints and three clips in sandboxed Chrome 152.0.7977.54 /
Babylon Lite 1.12.0. Twelve pose captures prove visible deformation, LINEAR progression,
STEP timing and identical loop endpoint pixels, with no browser errors, external
requests or source drift. Representative rest/midpoint captures were visually inspected.
The standalone import command also passed. Build/repeatability, type checks and all
2,697 unit tests passed (221 files; one skipped). Repository-wide `pnpm check` stops
at the same two reference-SVG accessibility errors recorded above; new/changed source
lint passes. Existing tool advisories found during dependency audit are triaged in
[dependencies.md](dependencies.md), without a clean-audit claim. Shipped engine/WASM
bytes are unchanged. [Usage and supported scope](../assets/qa/animation-import.md)
document the still-pending character content, full admission/packaging and installed
motion acceptance. All changes remain uncommitted.

**Latest human approval (2026-09-22):** the procedural, periodic
[photoreal paving rebuild](../assets/source/d1-paving/proof-2026-09-22/photoreal-results.md)
`photoreal/candidate1` is the visual baseline. It supersedes `production/candidate3` and
keeps its smaller cobble scale, with a new layout, stones, joints, grit and plants.
D-196 makes its script-first method the standing
[asset production workflow](../assets/production-workflow.md). Next: a bounded delivery
package for this source. Scope: decimated heightfield LODs plus the authored
albedo/normal/roughness/height maps as KTX2, runtime grit/plant instancing, export
validation, installed Babylon/WebGPU inspection and measured costs against the class
budgets. Rights, QA and admission remain open. Review found up to 4.083 mm open
position seams in candidate1's clamped displacement. The corrected builder wraps
the height map; preserve the approved snapshot as evidence and qualify rebuilt
boundary positions, boundary normals and grazing-light joins before delivery.
**Closed brief (2026-09-24):** the [delivery package brief](../assets/source/d1-paving/proof-2026-09-24/delivery-brief.md)
tests a periodic 4 m module in candidate1's views and in pinned-Chrome Babylon Lite:
- border-locked decimated LODs with flat normals and a full-height normal map
- 4096² repeat-addressed maps
- an atlased plant mesh
- large pebbles instanced, the rest drawn into the maps

Allowance: two candidate handoffs within 4 active hours. The package measures costs
against the current class and streaming limits; it neither changes those limits nor
admits the asset.

**Outcome:** [delivery candidate 2](../assets/source/d1-paving/proof-2026-09-24/delivery-results.md)
used both handoffs.
- **Look.** It matches the approved look through fresh import and pinned Chrome.
- **Candidate 1.** The screens found folded decimation triangles, which candidate 2 prevents
  by construction.
- **Cost.** 88.8 MB of runtime resources and 210 MB of RGBA8 textures. At 4K the isolated
  GPU time is 4.8 ms p50.
- **Engine gaps.** The largest remaining gaps are in the engine: lighting balance, no ambient
  occlusion, no small-scale shadows, and an install path that rejects the maps.

The human directed that engine work proceed alongside assets, and that self-imposed caps
not limit quality (D-197). The next package is the
[installation brief](../assets/source/d1-paving/proof-2026-09-24/install-brief.md), then
lighting/AO, then small-scale shadows. RE-050 records Chrome's missing zstd Compression
Streams. The human accepted the delivered look on 2026-09-24.

**Installation outcome (2026-09-24):** the [install result](../assets/source/d1-paving/proof-2026-09-24/install-results.md).
- **What ships.** The ordinary build, install, stream and render path carries delivery
  candidate 4, which is candidate 2 plus a pebble LOD2 and a plain RGBA8 normal. D-186 admits
  it to the library, and the D1 courtyard places it as 4 × 4 tiles. The individual-stone kit
  and its QA are removed.
- **Engine changes.** zstd and uncompressed RGBA8 KTX2 decode in the decode worker, a
  periodic-surface-module packaging mode, and D-197 telemetry rails in place of the caps.
- **Verification.** The installer-repair replay was rebound and passes, and the installed
  scale-streaming run passes, and so does `pnpm check`.
- **Cost.** At 4K near the paving, GPU time is 4.9–5.6 ms p50. The cell's GPU residency is
  237 MB.
- **Attributed budget bust.** The paving cell loads in 367 ms against the 250 ms p95 budget,
  and its RGBA8 upload stalls the render worker for 146 ms against the 50 ms hitch budget.

The human reviewed and approved the installed views and the rights review on 2026-09-24.
`pnpm harness:scale-streaming` then passed in an installer-provisioned profile, with a
traversal cell-load p95 of 1.8 ms and paving hydration matching the runtime route.
Four stale parts had to be fixed first:
- dev-01's OS pin, refreshed by D-198
- the streaming worker's installed-resource telemetry, stuck at 0 since the M4 district swap
- the harness's expected D1 sample, which predated D2 and D1's asset dependencies
- its liveness validator, which required integer milliseconds from the monotonic clock

Next engine packages: GPU-compressed textures, then lighting balance with ambient occlusion,
then small-scale shadows.

**Closed brief (2026-09-24):** the [GPU-compressed texture brief](../assets/source/d1-paving/proof-2026-09-24/texture-brief.md).
- UASTC transcodes to BC7 in the decode worker, and descriptors declare their GPU format.
- `texture-compression-bc` becomes required.
- The UASTC maps are re-encoded above libktx's default `LEVEL_FASTEST`.
- The ground normal's 1 byte per texel form is chosen by measured error and a Chrome A/B.

BC5 normals are out: Lite 1.12's PBR shader reads the normal's `.rgb` and has no hook to
rebuild Z. Allowance: two cycles within 4 active hours.

**Texture outcome (2026-09-24):** [BC7 adopted](../assets/source/d1-paving/proof-2026-09-24/texture-results.md) (D-199).
- **Asset.** Candidate 5 re-encodes every paving map, the ground normal included, as UASTC
  `LEVEL_SLOWER`. The Web-libktx binding had silently kept candidates 1–4 at
  `LEVEL_FASTEST`. An in-game A/B found the BC7 normal indistinguishable from the lossless one.
- **Cost.** The paving cell loads in 230 ms (was 367), with 80 MB of GPU memory (was 237) and
  65 MB read (was 132). Captures match the RGBA8 build to within 0.4/255 mean.
- **Verification.** The installed scale-streaming run passed, with a traversal p95 of 2.2 ms.
  The replay was rebound and passes, and so does `pnpm check`.
- **Remaining stall.** The render-worker stall is 90 ms against the 50 ms hitch budget. It is
  now mesh construction on the render thread, which fell from 110 to 85 ms once per-vertex
  views were removed.

Human visual acceptance of candidate 5 is pending.

<a id="engine-packages"></a>The human directed (2026-09-24) that engine and optimization work be front-loaded while assets
are built, not deferred once assets are workable. The aim is the most compression and the
least render-path work at materially similar quality, not merely workable assets: move work off
the render thread, and make the work that stays there fast. A slight, disclosed quality loss is
accepted for a significant performance or memory gain (D-200). Engine packages, in order; each
starts by writing its bounded brief ([workflow](workflow.md#bounded-visual-and-research-work)):
1. **Renderer-family upgrade — done 2026-09-24.** Lite 1.12.0 → 1.31.1 and decoder
   9.17.0 → 9.27.1 (outcome below). The decoder 9.28.0 is a minor release, eligible from
   2026-09-25T07:43Z. Take it as a short targeted review at the start of package 3, which
   exercises the decoder.
2. **Render-path geometry — next.** Starting point on 1.31.1 (installed paving capture,
   `lite1311`): the paving cell loads in 218 ms against the 250 ms cell-load p95 budget. Of that,
   96 ms is dependency decode, 21 ms is the read, and the render-thread batch upload stalls the
   render worker for 86 ms against the 50 ms hitch budget. That stall is mostly mesh
   construction.
   - Move vertex preparation, validation and bounds into the decode worker.
   - Make the render thread's remaining work fast, not just smaller. Candidates include Lite
     1.29's partial geometry uploads and 1.31's storage-backed geometry and GPU-buffer wrapping.
   - Simplify the pebble geometry itself, and instance it. Each 4 m module carries 3,927
     unique merged pebble shells: 251,328 LOD0 triangles at 64 each, 77% of the geometry bytes,
     and about 20 ms of render-thread construction on their own
     ([delivery results](../assets/source/d1-paving/proof-2026-09-24/delivery-results.md)).
     Options to A/B:
     - fewer triangles per pebble, with normals carrying the rounding
     - a higher size cut-off for 3D pebbles (9 mm today), leaving more to the maps, which
       already draw all 29,204
     - a small library of pebble shapes, instanced with per-instance transform, scale and
       colour (about 0.1 MB instead of about 9.7 MB)
     - dropping pebbles hidden in joints or under plants
     - tighter pebble LOD distances (6/12 m today)

     Judge each option under D-200 in the 22 cm joint and close views, where screens already
     flag faceted angular pebbles and lost grain, and at walking distance. Weigh the look
     against bytes, triangles and render-thread time.
   - Spread uploads across frames if the stall still exceeds 50 ms.
   - Target: the paving cell's render-worker stall within the 50 ms hitch budget, with the
     cell-load p95 no worse and materially similar quality (D-200). Captures stay the regression
     check: an unexplained pixel change from an engine-only change is investigated. Pebble
     changes alter the asset, so they ship as a new paving candidate through the QA gate and
     human visual acceptance.
3. **Texture compression A/B set** (highest compression at acceptable quality, lossy included).
   Today every paving map is BC7 from UASTC `LEVEL_SLOWER`: 65 MB read and 80 MB GPU (D-199).
   - BC1 base colour.
   - BC4 ORM channels and BC5 normals, rebuilding Z in the shader. First try Lite 1.31's public
     `MaterialPlugin` (WGSL injection, extra samplers). Use a local test patch of Lite's shader
     only if the plugin cannot reach the sampling.
   - 2048² maps.
   - A UASTC RDO download compressed with HTTP zstd.
   - Each option is judged under D-200: an in-game A/B against the current build for
     materially similar quality, weighed against its measured download, GPU memory and
     cell-load gain.
   - Outside the A/B set: loading the top mip levels only for near cells. This is an
     architecture change, not an asset setting. Scope it separately once many resident cells
     make texture memory the bottleneck.
4. **Lighting balance with ambient occlusion.**
5. **Small-scale shadows.** Candidates include Lite 1.18's screen-space lighting.

Candidate 5's human visual acceptance (above) remains open. It gates the asset, not these
engine packages.

**Renderer-family upgrade brief (2026-09-24, closed).**
- **Why.** The pins are 19 Lite releases and 11 decoder releases behind (ledger recheck was due
  2026-09-19). The skipped range adds partial geometry uploads (1.29), storage-backed geometry
  and GPU buffer wrapping (1.31), screen-space lighting and CSM caching (1.18), and async
  pipeline compilation (1.22). All of these bear on the packages above.
- **Question.** Does the ordinary game run unchanged or better on the new pins? What moves in
  frame time, streaming and recovery?
- **Scope.** Audit our 58 Lite exports and the private internals: `_device`, CSM shadow task
  state, the PSO-warmup observer and thin-instance buffers. Adapt to breaking changes. Re-verify
  D-104's device-loss seam and D-183's CSM and warmup bindings.
- **Old-pin baselines**, then the same scenarios on the new pins:
  - render recovery
  - the D1 flythrough
  - the courtyard capture
  - the installed scale-streaming run

  Then `pnpm check` and engine repeatability.
- **Must fix.** Any rendering, recovery or streaming regression, and any GPU validation error.
- **Allowance.** Two implementation, capture and evaluation cycles within one work session.
- **Ending decision.** Adopt with measured before/after evidence, or defer with the named
  blocking change.
- **Out of scope.** Adopting new Lite features; that belongs to the packages above.

**Upgrade outcome (2026-09-24): adopted Lite 1.31.0 and decoder 9.27.1, then Lite 1.31.1.**
1.31.1 is a patch, which the tiered release-age policy allows at any age. It was taken as its own
review: two PBR WGSL pins moved for a `let`→`var` change, scene pixels are identical, and every
gate passed. The decoder 9.28.0 is a minor release, eligible from 2026-09-25. Details are in the
[dependency ledger](dependencies.md#review-ledger).
- **Adaptations.**
  - The PSO-warmup observer checks the 1.20/1.22 opt-in material fields.
  - Seven composed-WGSL pins were recaptured from pinned Chrome; the pipeline structure is
    unchanged.
  - `@types/webxr` was added for Lite's typings.
  - The engine-owned RGBA8 KTX2 reader was retired in favour of the decoder's own path. Its
    header and mip byte-range checks still run before decoding.
- **Evidence.** Courtyard renders are pixel-identical. The paving load is 218 ms (was 231) and
  GPU time is unchanged. CPU submit rose about 0.1 ms per frame, a Lite-side regression to
  watch. The installed scale-streaming run, installer replay, animation import and `pnpm check`
  all pass.
- **Found while baselining.**
  - Both remaining renderer harnesses were already failing on the old pin.
    - **Render recovery: repaired as `render-recovery@2`** (report schema 34, metric set 6).
      The harness now resets the recovery-invalidated flythrough and previews the exact
      pre-fault observer through a fixed view. It checks the render worker's readback (streamed
      meshes, none preview-drawn) and a later compositor screenshot of the same fixed view, and requires
      unchanged residency. Its validators accept the current Chrome-pin and streaming telemetry
      fields. The engine gains a public `resetFlythrough()` diagnostic.

      **Passed on dev-01's physical console** (build `4ea1b8c6`, Lite 1.31.1): the environment,
      evidence and bounded-recovery facets all passed, and so did the report contract. Each
      recovered view drew 24 streamed meshes, with 86.4% readback coverage and 91.6% compositor
      coverage. First recoveries took 2.9 s
      (device loss), 6.2 s (worker crash, including the 3 s heartbeat) and 2.8 s.

      Two defects surfaced once the environment facet passed and validation reached the
      streaming samples:
      - The result validator predated per-cell shared-dependency timing. It now accepts the
        seven `dependency*` fields as a complete group, each finite and non-negative.
      - An engine telemetry bug. When render recovery was exhausted, the streaming service
        terminated the streaming worker but republished that worker's last snapshot, so the
        failed state still reported 285 open OPFS access handles. Terminating the worker
        releases them: every recovery terminates generation 1, and generation 2 reacquires all
        285. Both service-side failure paths now report zero handles.

      An independent review then tightened the recovered-view check: it now rebuilds the
      camera position, target and environment from the pre-fault observer, and requires
      consistent pixel counts. The same review fixed the texture cache key (it omitted the GPU
      format), restored the raw-KTX2 header and mip-range checks, and admitted lossless zstd
      RGBA8 maps in packaging. On the resulting build `d98b6c89`, physical `render-recovery@2`
      passed again (first recoveries 2.9 / 6.1 / 2.9 s), and so did installed scale-streaming
      (cell-load p95 2.1 ms) and the installer-repair replay.

      The earlier remote-session run (build `2f504301`) failed the environment facet as
      expected.
    - Flythrough: failing since 2026-09-05, filed as a separate task.
  - A real gameplay bug is fixed. When a flythrough or benchmark released the camera and the
    player stood still, streaming kept loading around the scenario's last position. Gameplay now
    re-presents and re-targets observers on release.
- **New capabilities** for the next packages:
  - partial geometry uploads (1.29) and storage-backed geometry (1.31) for the render-path
    geometry package
  - public material plugins with WGSL injection and extra samplers (1.31), a likely patch-free
    route to BC5 normals and BC4 roughness
  - screen-space lighting (1.18) for small-scale shadows

*Superseded baseline history:* `production/candidate3` had been approved after
`cobble-study/candidate1`. Its [shared-resource and LOD delivery proof](../assets/source/d1-paving/proof-2026-09-22/delivery-brief.md):
two cycles in a two-hour active session, preserving approved LOD0 appearance while
measuring exports and compression. Existing QA ceilings and runtime acceptance stay open.
Its [two-cycle result](../assets/source/d1-paving/proof-2026-09-22/delivery-results.md)
retains three shared materials, explicit LODs and exact meshopt roundtrips, but fails
soil-grain fidelity before export. Leaf/grit colors are corrected and survive import;
both independent screens reject the remaining soil mismatch. Shared KTX2 maps cost
63,718,441 bytes; no budget change or admission is justified. Next isolate soil bake
evaluation versus physical sampling in a small contact coupon before runtime work.
That soil-bake follow-up is moot for the photoreal source, whose maps are authored at
delivery resolution. This history supersedes the larger-slab direction below; the 111/131-stone studies are
earlier comparisons. The broad-family
source and failed bake controls remain diagnostic evidence, not delivery inputs.

The [smaller-stone continuation](../assets/source/d1-paving/proof-2026-09-22/cobble-results.md)
now retains a 137-stone native patch with approved leaf color and moss integrated.
The longest modeled joint falls from 16 to 10 planning cells; long visible runs
and three repeated mineral identities remain. Saved-source checks preserve the
stone/plant artwork, and the newly fitted moss colony passes a fresh representative
Blender transfer. The human approved the presented candidate with these disclosed
appearance limits. Further seam/material refinement is optional backlog work,
not a prerequisite for production delivery. Next: preserve this approved look
through material/resource sharing, LODs/compression,
rights review, full QA and installed-game verification. Production acceptance
and M4.5 closure remain open.

The [production reduction proof](../assets/source/d1-paving/proof-2026-09-22/production-results.md)
now has human approval for candidate3 with 48,720 ground / 32,481 native plant
triangles (58.4% / 40.6% reductions), exact stone artwork/placements and representative leaf, moss
and grit Blender transfers. Strict-budget collapse visibly damaged the approved
art; the retained reduction still exceeds the old 8,192 / 4,000 class ceilings.
Do not force further blind collapse or waive QA. Next is shared materials, LODs
and compressed resource/runtime measurements for deliberate class calibration,
then rights, full QA/admission and installed-game proof. The reduced source is the
approved visual baseline; the ordinary game asset and all production ceilings
remain unchanged.

**Continuation evidence (2026-09-22):** the [latest paving continuation](../assets/source/d1-paving/proof-2026-09-22/results.md)
rejected two sidewall revisions. A matched material control exposed loss of cycle11
mineral detail from the earlier normalization. Both independent screens retain the
restored family with corrected sRGB transfer, earlier geometry and distinct remaps.
The human approved the soil-to-stone edge on 2026-09-22; preserve its geometry and
soil placement. The [24-frame moving-light test](../assets/source/d1-paving/proof-2026-09-22/relighting-results.md)
found no concrete directional conflict; both reviewers withdraw the unlit-only blocker.
The [fresh transfer](../assets/source/d1-paving/proof-2026-09-22/transfer-results.md)
now provides three 3,900-triangle restored-material exports with focused roundtrip
checks and conditional visual passes. The 4 m repetition/plant study is captured;
raw size overages and a small C shading artifact remain delivery work.
The human subsequently approved lighting and authorized the
[4 m paving patch](../assets/source/d1-paving/proof-2026-09-22/patch-brief.md).
The [two-cycle result](../assets/source/d1-paving/proof-2026-09-22/patch-results.md)
retains a 131-stone native patch for human review. Continuous soil and framing are
improved; long joints, repeated mineral identities and simplified foliage remain
unmet criteria. Ground geometry exceeds its production target. Preserve approved
lighting/contact; full assembly acceptance, production QA and runtime proof remain open.
Human feedback next authorizes a [focused vegetation revision](../assets/source/d1-paving/proof-2026-09-22/vegetation-brief.md):
varied weeds, grass, moss and seedlings with leaf color/relief maps. The
[two-cycle result](../assets/source/d1-paving/proof-2026-09-22/vegetation-results.md)
retains improved leaves/grass/seedlings and representative weed transfer for human
review. Moss remains rejected as flat green ribbons; plant geometry/maps exceed
production targets. Stone/soil/lighting are preserved; full vegetation acceptance remains open.
Human feedback then requests less uniform leaf color; the
[color-only package](../assets/source/d1-paving/proof-2026-09-22/leaf-color-brief.md)
preserves shape/relief and tests within-leaf and between-leaf variation through export.
Its [two-cycle result](../assets/source/d1-paving/proof-2026-09-22/leaf-color-results.md)
now has clearer interveinal color variation and corrected COLOR_0 export retention;
both screens support human review. The human subsequently accepted this leaf-color
revision ("much better, thank you"); preserve it while the other proof criteria remain open.
The human authorized continuation; a [bounded moss construction](../assets/source/d1-paving/proof-2026-09-22/moss-brief.md)
now tests small leafy shoots in irregular low joint patches, replacing rejected ribbons.
Its [two-cycle result](../assets/source/d1-paving/proof-2026-09-22/moss-results.md)
retains the denser first candidate after both independent screens and lead comparison;
the second exposes herb-like stems. Candidate1's representative Blender transfer
passes a focused roundtrip. The human accepted candidate1's moss appearance on
2026-09-22. Stone repetition, long joints and production reduction remain open.
The [bounded mixed-layout study](../assets/source/d1-paving/proof-2026-09-22/layout-results.md)
reduced the longest modeled joint from 28 to 16 cells without stone AABB overlaps.
Both native screens still find long registered runs and three repeated mineral
identities; a continuous-warp second cycle did not close them. The layout scenes
contain provisional plants, so accepted leaf color/moss integration remains open.
The follow-on [larger-slab study](../assets/source/d1-paving/proof-2026-09-22/large-slab-results.md)
reduced the source field to 58 stones and the longest modeled joint to 14 cells.
Both independent screens and lead find improved broad-slab cadence but remaining
orthogonal seams, narrow-strip pockets and magnified repeated mineral landmarks.
Candidate2 is retained as layout-only evidence. Its proposed broad-scale source
follow-up was tested below and is superseded by the latest smaller-stone direction.
The [bounded broad-source family result](../assets/source/d1-paving/proof-2026-09-22/broad-family-results.md)
retains four physical-scale sources after two cycles. Candidate2 restores limestone
identity and avoids the obvious enlarged repeated islands, but remains too marbled
and lacks quiet wear regions. Its 3,900-triangle representative exports/reimports
consistently, yet matched walking/grazing captures expose source-to-bake color/detail
differences that two technical controls did not resolve. Source fidelity, contact,
layout/vegetation integration and artistic acceptance remain open; no new game asset
is admitted. Current class width and raw resource limits also exclude this export.
The [previous bounded source proof](../assets/source/d1-paving/proof-2026-09-21/results.md)
now contains a revised three-stone family, compacted soil-contact sample and three
3900-triangle bake/reimport checks. Broader human review remains open; source color
is not certified intrinsic albedo, but is not a demonstrated relighting failure. Earlier contact
reservations are superseded by the latest human edge approval.
Two profile-fitted soil cycles failed to close appearance; the higher collar reintroduced
bevel clipping. Neutral/semantic diagnostics identify most of the dark band as exposed
shadowed stone sidewall, not a continuous void. Retain family-contact2 geometry in the
restored family; further sidewall tuning or blanket soil raising is unnecessary.
The [overall continuation](../assets/source/d1-paving/paving-proof-followup-2026-09-21.md)
still needs the 4 m assembly with joint plants, shared-material/compressed LOD packaging,
QA admission and installed-game evidence. The old gray-only gate and requirement to
change authoring model are superseded. Helpful engine changes remain in scope;
artistic, rights, QA and runtime gates remain open.

Earlier progression (human approval2026-09-20, D-195): resume the
[bounded4×4m paving proof](../assets/source/d1-paving/proof-2026-09-20.md) against
selected103/104/108/116 references. The collection baseline is accepted; each
production package retains its unresolved profile views and human artistic gate.
The initial two-cycle proof is now complete with no viable visual result: contact
improved, but the limestone material and worn shoulders still miss the selected target.
Further full-assembly tuning is deferred; the proposed next package isolates one
stone and soil joint before repeating it. Paving acceptance remains open.
The human has authorized the [fresh stone geometry master](../assets/source/d1-paving/master-2026-09-20.md):
new construction in live Blender, plain-gray multi-angle review before materials,
two cycles and 90 active minutes. This geometry checkpoint does not close the
end-to-end installed-game proof.
That master package has now ended without a passing candidate: both initial cycles
and one explicitly recorded connected-fracture extension failed lead and independent
geometry reviews. The source authoring approach remains the blocker; material work
and broader production stay on hold. See the brief's final disposition before reopening.
The [2026-09-21 production diagnosis](../assets/source/d1-paving/diagnosis-2026-09-21.md)
cross-checks the live Blender master, scripts and saved renders. It proposes joint
shape/material development, more local previews and a controlled author comparison;
this investigation creates no accepted asset or automatic experiment extension.
Human authorization2026-09-21 starts the [complete stone surface study](../assets/source/d1-paving/surface-study-2026-09-21.md):
joint shape/material development with six bounded preview cycles, 90 active minutes
and a three-hour elapsed ceiling. Use selected103/104/108, fixed-camera relighting,
gray/material comparison and distinct variants if viable; document the reproducible
method. Prior failed masters remain rejected; new source and runtime acceptance stay open.
The study now retains cycle11 as its best experimental source after eleven bounded
authoring cycles and two explicit allowance extensions. Native multi-view and unlit
inspection, a three-stone soil-contact scene, and a3900-triangle textured GLB with a
fresh Blender import establish a useful authoring/transfer path. Residual source-image
lighting, pervasive grain, shared variant patterns and unfinished joints prevent a
claim of full reference matching. See the [tested asset workflow](../assets/source/d1-paving/asset-creation-workflow.md)
and focused verification. Human artistic acceptance, library QA and installed-game
acceptance remain open; source iteration is no longer blocked on constructing a
usable mesh, and there is no automatic broader rollout.
Human follow-up explicitly includes helpful engine changes in the next proof:
[procedural variation and engine-support scope](../assets/source/d1-paving/proof-2026-09-20.md#follow-up-scope--engine-support-explicitly-included).
Author-time, install-time and runtime generation remain candidates to compare; the
proof must survive the actual installed rendering path before broader production.
Old individual-stone assembly previews remain rejected despite historical folder
names. No library expansion or runtime visual acceptance follows from concept approval.
Creative originals remain in Git LFS under D-190; rights/QA and milestone gates stand.

Completed direction-selection brief: [Batch 001 — coastal village direction](../assets/reference/concept-art-batch-001.md)
addressed DIR-002 with three sunny/overcast alternatives (six initially planned images), up to
two generation/review passes per image and 90 minutes active work, with generation
waiting separate. Subagents inspect each image before the next generation; the batch
ends at human direction selection. Theme, construction, material quality, traversal
readability and paired-state consistency are the must-fix criteria. At A overcast's
two-pass boundary, both attempts were rejected for paving/plaster drift. The batch
finished three sunny alternatives; matched overcast coverage remains open for
the selected direction's next batch, avoiding weather work on discarded alternatives.
The [comparison board](../assets/reference/concept-art-batch-001-review.md) presents
A plaster-led, B timber-led and C limestone-led candidates, all passed for human
review. The human chose B; A's plaster and C's pristine/high-end walls and gutter
treatment are not selected. Preserve B's weathered character, exclude electric lamps,
and resolve candle/oil-flame construction in the next detail references. Seven
originals, prompts, hashes and critiques are retained; reviews now
explicitly use GPT-6 Astra / low under human direction. No concept target is closed.

- [ ] Complete the [concept-art program and coverage/selection gate](../assets/reference/concept-art-program.md#exit-checklist)
      [Batch 002 comparison](../assets/reference/concept-art-batch-002-review.md) is
      completed castle-direction selection: the human chose A's classic castle and
      large round tower. Ten originals across six subjects stayed within two passes
      each / 90 minutes; all received sequential GPT-6 Astra / low reviews. Facade and
      candle-lantern drafts passed; both B overcast attempts failed surface correspondence.
      Matched weather and remaining kit/scene views stay open. Continue from the castle
      choice to its detailed views and underground alternatives; no asset iteration yet.
      [Batch 003 comparison](../assets/reference/concept-art-batch-003-review.md) is ready:
      castle eye-level/gate drafts and three catacomb directions, six originals across
      five subjects within two passes each / 90 minutes. Sequential GPT-6 Astra / low
      reviews caught and corrected an unsupported chamber roof. The human selected
      underground B for its creepy atmosphere; arena/entrances, construction and matched-weather coverage
      remain open. Complete the reference gate before resuming cobblestone iteration.
      [Batch 004](../assets/reference/concept-art-batch-004-review.md) has five originals
      across four subjects, reviewed sequentially with GPT-6 Astra / low. Passage
      junction passed; arena B is human-selected for its carved-earth character. A's vent
      state was corrected; B vent details and C fill-light source remain open.
      [Batch 005](../assets/reference/concept-art-batch-005-review.md): seven originals
      across six entrance subjects reviewed with fresh GPT-6 Astra / low agents.
      Castle/well pairs and corrected forest pair are all human-accepted. Forest
      fork was corrected; stair/headroom, mechanisms and transition traversal remain open.
      [Batch 006](../assets/reference/concept-art-batch-006-review.md): three south-shore
      surface treatments passed sequential low reviews; A is human-selected for open
      beach interactions and dock transitions.
      Full water/weather/motion/assembly coverage remains open.
      [Batch 007](../assets/reference/concept-art-batch-007-review.md): three working-dock
      assemblies preserve selected open beach and passed sequential low reviews.
      A is human-selected for the simple fishing landing; joinery, tide/foundation/load
      and traversal remain open. Plan a separate substantial merchant/fishing port
      supporting castle supplies and sailor/captain/pirate interaction contexts, with
      placement/depth/berth validation before implementation and no inferred sailing mechanic.
      [Harbor reference plan](../assets/reference/harbor-art-plan.md) adds 14 targets.
      [Batch 008](../assets/reference/concept-art-batch-008-review.md) has five originals:
      A/C passed fresh low reviews; B rejected after failed circulation correction.
      Human rejected all Batch 008 layouts as underscaled; expand to a substantial
      port district with multiple long piers, large ships, tavern, inn and merchant offices.
      [Batch 009](../assets/reference/concept-art-batch-009-review.md): A is human-selected
      for greater scale and interaction potential; B feels too small and village-like.
      [Batch 010](../assets/reference/concept-art-batch-010-review.md) adds merchant
      boarding v2 and two hospitality frontages, corrected for the human's fantasy-world
      direction. B courtyard is human-selected for stories/chance encounters; anatomy and crowd coverage
      remain open. Screen for varied folk, wizard/knight/rogue roles and catalyst magic.
      [Batch 011](../assets/reference/concept-art-batch-011-review.md) has three originals:
      fish-exchange A v2 and net-repair B v1 passed fresh low theme/quality reviews;
      B human-selected for varied port uses beyond fishing. Adult folk/catalyst corrections retained.
      [Batch 012](../assets/reference/concept-art-batch-012-review.md) has two office
      frontage originals passing both low reviews; both waterfront offices and shared
      merchant courtyard are human-selected as complementary settings.
      Human workflow update: Batch 013 onward uses two independent generation lanes;
      both reviews remain required before revision or dependent generation. Batch 012
      finishes sequentially. See concept program for scheduling and provenance rules.
      [Batch 013](../assets/reference/concept-art-batch-013-review.md) has four tavern
      interior originals from two overlapping generation waves. Both reviews qualify
      room layouts; B human-selected for secret meetings away from crowds. Crowd route/folk-scale gaps remain at the
      two-pass boundary. Full interior/character profiles remain open.
      [Batch 014](../assets/reference/concept-art-batch-014-review.md) has three inn
      arrival originals; A selected for combined barkeep/lodging management.
      Guest rooms, stair geometry and character metrics remain open.
      [Batch 015](../assets/reference/concept-art-batch-015-review.md) has reviewed
      private/shared guest-room proposals; A selected for locked doors/private conversations/theft; full
      profiles remain open. Lanes dispatched independently but job calls did not overlap.
      [Batch 016](../assets/reference/concept-art-batch-016-review.md) has three corridor
      originals; corrected B bend selected for extra hall privacy. Prepared lanes
      still showed no overlapping job interval; no speedup claimed.
      [Batch 017](../assets/reference/concept-art-batch-017-review.md) has two reviewed
      port-end supply-yard alternatives; A selected for port character without fortress treatment; full route open.
      Generation calls overlapped by 27.066 seconds; no correction required.
      [Batch 018](../assets/reference/concept-art-batch-018-review.md) has two reviewed
      dockside conversation spaces; both selected as complementary examples; metrics/characters open.
      Generation calls overlapped 11.605 seconds; no correction required.
      [Batch 019](../assets/reference/concept-art-batch-019-review.md) has screened
      complementary sailor/captain costumes, both human-accepted; anatomy/full
      profiles remain open. Generation overlapped 99.920 seconds; no correction required.
      [Batch 020](../assets/reference/concept-art-batch-020-review.md) has screened
      pirate-costume/merchant-vessel directions, both human-accepted; full profiles and
      engineering open. Generation overlapped 4.463 seconds; no correction required.
      [Batch 021](../assets/reference/concept-art-batch-021-review.md) fishing vessel
      screened; fixed cargo hoist human-rejected for lacking ship-transfer reach.
      [Batch 022](../assets/reference/concept-art-batch-022.md) redesign adds a quay
      crane, rotating winch and hand-power mechanical-advantage screening; engineering open.
      V2 passed overall direction screening. [Batch 023](../assets/reference/concept-art-batch-023-review.md)
      clarified crank after two detail passes each, but brake/auxiliary wheel and tackle
      continuity remain blockers to exact-mechanism acceptance.
      Human accepted Batch 023 visual direction; the listed mechanical blockers remain open.
      [Batch 024](../assets/reference/concept-art-batch-024-review.md) stone-quay and
      timber pier: human rejects widened pier v9; v8/v9 passes withdrawn. V4 pier
      reference preserved in v11: ship moved closer and ramp landing corrected;
      BOTH stone quay v1 and timber pier v11 are human-accepted. History is in KIT-038.
      Exact motion/tide joints and foundations remain open.
      [Batch 025](../assets/reference/concept-art-batch-025-review.md) provides
      parallel Human/Skarn/Wickfolk direction proposals; B selected for realism.
      [Batch 026](../assets/reference/concept-art-batch-026-review.md) compares existing
      and smaller adult Wickfolk stature; existing B selected. Exact metric heights
      and full character profiles remain open.
      [Batch 027](../assets/reference/concept-art-batch-027-review.md) begins DIR-007
      with Burrow-gnawer and Greymaw, both human-accepted; remaining four archetypes
      and full comparative/motion profiles remain open.
      [Batch 028](../assets/reference/concept-art-batch-028-review.md) adds brigand
      and Skitterling appearances, both human-accepted; full profiles remain open.
      [Batch 029](../assets/reference/concept-art-batch-029-review.md) proposes elite
      and boss warden appearances; Hollow warden v1 and red-tinted boss v2 approved.
      Scale/phase/motion profiles remain open.
      [Batch 030](../assets/reference/concept-art-batch-030-review.md) proposes
      catalyst/Aetherspark appearances; B wand shape selected. Effect/channel/tier/
      timing coverage remains open.
      [Batch 031](../assets/reference/concept-art-batch-031-review.md) proposes
      Emberlash/Frostbind appearances, both approved; impact/status/timing remain open.
      [Batch 032](../assets/reference/concept-art-batch-032-review.md) proposes
      Aetherpulse/Mendweave appearances; Aetherpulse v1 and corrected Mendweave v2
      approved. Temporal/full profiles remain open.
      [Batch 033](../assets/reference/concept-art-batch-033-review.md) proposes
      Wardlight and Ashwood Focus detail, both approved; lighting/full profiles remain open.
      [Batch 034](../assets/reference/concept-art-batch-034-review.md) proposes Glazed
      and Resonant Focus construction, both approved; attunements open.
      [Batch 035](../assets/reference/concept-art-batch-035-review.md) proposes three
      Resonant channel appearances; all approved, timing open.
      [Batch 036](../assets/reference/concept-art-batch-036-review.md) proposes Vigor
      and Stone Tonics; both approved, handling open.
      [Batch 037](../assets/reference/concept-art-batch-037-review.md) proposes
      Clearing Draught/Aether Salts; both approved, use open.
      [Batch 038](../assets/reference/concept-art-batch-038-review.md) proposes
      Emberdust/Frostglass Oil pots and applicators; both approved, application open.
      [Batch 039](../assets/reference/concept-art-batch-039-review.md) proposes
      Hearthloaf/Waybread; both approved, handling open.
      [Batch 040](../assets/reference/concept-art-batch-040-review.md) proposes
      Fisher's Stew/Tidebroth; both approved, handling open.
      [Batch 041](../assets/reference/concept-art-batch-041-review.md) proposes
      Hunter's Roast/Mulled Cordial; corrected roast v3 and cordial v1 approved,
      handling open. Roast v1 rejected for overly clean cuts.
      Planned content correction: retain fruit-based Orchard Preserve (human
      direction); replace the current grain/emberpetal recipe after defining its
      fruit resource/source and costs. Update gathering/economy coverage together;
      no new orchard region or runtime change authorized by the concept alone.
      [Batch 042](../assets/reference/concept-art-batch-042-review.md) proposes
      Bittergreen/Emberpetal; both approved, harvest open.
      [Batch 043](../assets/reference/concept-art-batch-043-review.md) proposes
      Orchard Preserve v2/harvested herbs v1 approved; full profiles open.
      [Batch 044](../assets/reference/concept-art-batch-044-review.md) proposes
      mature grain/sea salt; both approved, full profiles open.
      [Batch 045](../assets/reference/concept-art-batch-045-review.md) proposes
      fresh fish/salvage iron; both approved; source/full profiles open.
      [Batch 046](../assets/reference/concept-art-batch-046-review.md) proposes
      harvested grain/timber; A v1/B v2 approved; full profiles open.
      [Batch 047](../assets/reference/concept-art-batch-047-review.md) proposes
      dimstone ore/relic fragments; both approved; venom/full profiles open.
      [Batch 048](../assets/reference/concept-art-batch-048-review.md) proposes
      Greymaw pelt/Skitterling venom sacs; both approved; full profiles open.
      [Batch 049](../assets/reference/concept-art-batch-049-review.md) proposes
      hide/sinew; both approved; meat/full profiles open.
      [Batch 050](../assets/reference/concept-art-batch-050-review.md) proposes
      game meat v2/marks v1; both approved; rarity/full profiles open.
      [Batch 051](../assets/reference/concept-art-batch-051-review.md) proposes
      base sword v2/axe v4 approved; upgrades/full profiles open.
      [Batch 052](../assets/reference/concept-art-batch-052-review.md) proposes
      tempered sword/axe v2 approved after v1 weak distinction rejected;
      full profiles open.
      [Batch 053](../assets/reference/concept-art-batch-053-review.md) proposes
      base spear v2/bow v1 approved; upgrades/full profiles open.
      [Batch 054](../assets/reference/concept-art-batch-054-review.md) proposes
      tempered spear/laminated bow approved; full profiles open.
      [Batch 055](../assets/reference/concept-art-batch-055-review.md) proposes
      cloth garb v1/leather jack v3 approved; all-folk fit/full profiles open.
      [Batch 056](../assets/reference/concept-art-batch-056-review.md) proposes
      scale coat/reinforced buckler approved; reverse/handling/fit open.
      [Batch 057](../assets/reference/concept-art-batch-057-review.md) proposes
      whetting v2/armor fitting v1 approved; operation/all-folk fit open.
      [Batch 058](../assets/reference/concept-art-batch-058-review.md) proposes
      sword scabbard/buckler reverse v2 approved; suspension/hand sizing open.
      [Batch 059](../assets/reference/concept-art-batch-059-review.md) proposes
      arrows/quiver and unstrung bow approved; draw/suspension/handling open.
      [Batch 060](../assets/reference/concept-art-batch-060-review.md) proposes
      sunny v1/overcast v2 courtyard approved; measured/temporal profiles open.
      [Batch 061](../assets/reference/concept-art-batch-061-review.md) proposes
      dawn/dusk courtyard approved; solar/temporal/full profiles open.
      [Batch 062](../assets/reference/concept-art-batch-062-review.md) proposes
      night v2/rainstorm v1 approved; lamp/face/rain/flash/temporal open.
      [Batch 063](../assets/reference/concept-art-batch-063-review.md) proposes
      lightning v1/wet paving v2 approved; recovery/wetness/motion open.
      [Batch 064](../assets/reference/concept-art-batch-064-review.md) proposes
      torch-only v2 versus approved Wardlight; comparison approved, overlap/motion open.
      [Batch 065](../assets/reference/concept-art-batch-065-review.md) proposes
      torch/Wardlight overlap approved; photometric/flicker/motion open.
      [Batch 066](../assets/reference/concept-art-batch-066-review.md) proposes
      Human sunlight/Wickfolk lantern portraits approved; calibrated/motion open.
      [Batch 067](../assets/reference/concept-art-batch-067-review.md) proposes
      forge/apothecary v1 approved; station/interaction open.
      [Batch 068](../assets/reference/concept-art-batch-068-review.md) proposes
      residential lane/hearth kitchen v1 approved; full profiles open.
      [Batch 069](../assets/reference/concept-art-batch-069-review.md) proposes
      square/waystone v2 with requested canopy tree/shaded seating and dock trader v1,
      both approved; full profiles open.
      [Batch 070](../assets/reference/concept-art-batch-070-review.md) proposes
      village gate v2 (cobble-to-dirt correction)/crop lanes v1,
      both approved; full profiles open.
      [Batch 071](../assets/reference/concept-art-batch-071-review.md) proposes
      crop cellar v2 (crop color/readability)/forest edge v1,
      both approved; full profiles open.
      [Batch 072](../assets/reference/concept-art-batch-072-review.md) proposes
      woodland clearing/ruin approach v1 approved; full profiles open.
      [Batch 073](../assets/reference/concept-art-batch-073-review.md) proposes
      castle silhouette/gate v1; human geography review requires silhouette correction
      and village/fields/coast reconciliation before further wide vistas. Gate remains
      unapproved local appearance; shared layout/full profiles open.
      [Batch 074 shared site plan](../assets/reference/concept-art-batch-074-review.md)
      proposes connected coastal village/port and northern crop belt, preserves named
      anchors and fixes camera contracts. Independent screens and human selection
      complete; D-191 adopts the reference. Descriptor migration remains pending.
      V2 expands the underscaled town into several quarters with cross-streets,
      port routes and a complete outer-moat circuit; human-approved.
      [Batch 075](../assets/reference/concept-art-batch-075-review.md) replaces the
      inconsistent vista with C1 v2 and C3 street v1, both human-approved after
      geography/theme screens; exact gate/bridge and cart-route profiles remain open.
      [Batch076](../assets/reference/concept-art-batch-076-review.md) coordinates C2
      gate A v2 and moat-bank B v4; both human-approved after house elevation/terrace
      and junction correction. Shared metric model and full cart circulation remain open.
      [Batch077](../assets/reference/concept-art-batch-077-review.md) adds undercroft
      utility approach and bridge-abutment detail, both human-approved.
      [Batch078](../assets/reference/concept-art-batch-078-review.md) adds C4
      northbound fields and C5 reverse castle vista; A v1/B v2 human-approved.
      [Batch079](../assets/reference/concept-art-batch-079-review.md) adds shore-to-world
      A v2 and northern mountain layers B v1, both human-approved.
      [Batch080](../assets/reference/concept-art-batch-080-review.md) adds square
      activity A v2 and ordinary chamber B v1, both human-approved.
      [Batch081](../assets/reference/concept-art-batch-081-review.md) adds sentinel
      space and Skitterling nest context, both human-approved.
      [Batch082](../assets/reference/concept-art-batch-082-review.md) adds resource
      context/dormant vent, both approved; floor/torch deviations recorded.
      [Batch083](../assets/reference/concept-art-batch-083-review.md) adds matched
      active/quenched vent details, both approved; warning/action
      and full prepared arena remain open.
      [Batch084](../assets/reference/concept-art-batch-084-review.md) adds warning
      appearance approved; dousing v1 rejected for depth/reach, close v2 human-approved. Timing and full-arena phases remain open.
      [Batch085](../assets/reference/concept-art-batch-085-review.md) opening-phase A
      human-approved; clutch B v4 human-approved with disclosed material softness,
      Bv5 rejected for paving/light drift; bounded recovery closed.
      [Batch086](../assets/reference/concept-art-batch-086-review.md) active/prepared
      final phase human-approved after matching vent positions/rims.
      [Batch087](../assets/reference/concept-art-batch-087-review.md) wall family A v3
      and oak corner B v2 human-approved after construction corrections.
      [Batch088](../assets/reference/concept-art-batch-088-review.md) sloped terracotta
      roof/eave studies human-approved, addressing rain-drainage clarification.
      [Batch089](../assets/reference/concept-art-batch-089-review.md) foundations
      and low garden walls human-approved; hidden/metric profiles open.
      [Batch090](../assets/reference/concept-art-batch-090-review.md) door/window
      details human-approved; keeper/reverse/kinematic profiles remain open.
      [Batch091](../assets/reference/concept-art-batch-091-review.md) courtyard well
      A v2 and village waystone B v1 both human-approved.
      [Batch092](../assets/reference/concept-art-batch-092-review.md) stone A v1
      approved; timber closed-door B v6 approved; full profiles open.
      [Batch093](../assets/reference/concept-art-batch-093-review.md) castle wall walk
      and bridge arch detail human-approved; full profiles open.
      [Batch094](../assets/reference/concept-art-batch-094-review.md) catacomb arch
      and stone steps human-approved; full profiles open.
      [Batch095](../assets/reference/concept-art-batch-095-review.md) arena pillar
      A v2 and forest wall B v1 human-approved; full profiles open.
      [Batch096](../assets/reference/concept-art-batch-096-review.md) dock support
      B v1 approved; A v6 matching pile joints approved; grain softness noted.
      Berth/depth/ship engineering and role details remain open.
      [Batch097](../assets/reference/concept-art-batch-097-review.md) forge A v3
      and idle alembic B v1 human-approved; full profiles open.
      [Batch098](../assets/reference/concept-art-batch-098-review.md) hearth A v2
      and trader counter B v2 human-approved; full profiles open.
      [Batch099](../assets/reference/concept-art-batch-099-review.md) table/seating
      A v1 and containers B v1 human-approved; full profiles open.
      [Batch100](../assets/reference/concept-art-batch-100-review.md) harvest tools
      A v1 and wall torch B v2 human-approved; full profiles open.
      [Batch101](../assets/reference/concept-art-batch-101-review.md) closed satchel
      A v1 and Mythic core B v1 human-approved; full profiles open.
      [Batch102](../assets/reference/concept-art-batch-102-review.md) forge sign A v3 (raised for headroom)
      and gnawed stores B v1 human-approved; full profiles open.
      [Batch103](../assets/reference/concept-art-batch-103-review.md) paving assembly
      A v1 and earth edge B v1 human-approved; full profiles open.
      [Batch104](../assets/reference/concept-art-batch-104-review.md) stone family
      A v4 and plaster B v1 human-approved; full profiles open.
      [Batch105](../assets/reference/concept-art-batch-105-review.md) oak A v5 (peg/joint correction)
      and terracotta B v1 human-approved; full profiles open.
      [Batch106](../assets/reference/concept-art-batch-106-review.md) iron A v1
      and corrected leather B v2 human-approved. Full profiles open.
      [Batch107](../assets/reference/concept-art-batch-107-review.md) dock timber A v2
      and canvas B v1 human-approved. Full profiles open.
      [Batch108](../assets/reference/concept-art-batch-108-review.md) limestone A v1
      and joint soil B v1 human-approved. Full profiles open.
      [Batch109](../assets/reference/concept-art-batch-109-review.md) field earth A v1
      and gravel B v2 human-approved. Full profiles open.
      [Batch110](../assets/reference/concept-art-batch-110-review.md) armor A v3
      and glass B v1 human-approved. Full profiles open.
      [Batch111](../assets/reference/concept-art-batch-111-review.md) castle masonry A v4
      face correction and catacomb B v1 human-approved;
      full profiles open.
      [Batch112](../assets/reference/concept-art-batch-112-review.md) sand A v1
      and lichen B v3 human-approved. Full profiles open.
      [Batch113](../assets/reference/concept-art-batch-113-review.md) dark shore rock A v2
      and moss B v1 human-approved. Full profiles open.
      [Batch114](../assets/reference/concept-art-batch-114-review.md) matched wet shore
      rock v2 human-approved. Dynamic wetness/full profiles open.
      [Batch115](../assets/reference/concept-art-batch-115-review.md) buff and gray
      limestone v3 studies human-approved; full profiles open.
      [Batch116](../assets/reference/concept-art-batch-116-review.md) red limestone
      A3 and courtyard joint plants B1 pass both reviews and lead inspection;
      both human-approved; full profiles open.
      [Batch117](../assets/reference/concept-art-batch-117-review.md) courtyard shrubs
      and meadow/verge grasses pass both reviews and lead inspection;
      both human-approved; full profiles open.
      [Batch118](../assets/reference/concept-art-batch-118-review.md) canopy tree and
      forest understory: B1 human-approved, A2 human-rejected as synthetic;
      replacement A3 human-approved; full profiles open.
      [Batch119](../assets/reference/concept-art-batch-119-review.md) coastal vegetation
      and forest rock pass both reviews and root inspection; both human-approved, full profiles open.
      [Batch120](../assets/reference/concept-art-batch-120-review.md) ceramic glaze
      and shore salt proposal: B3 human-approved; A3 fails glaze
      realism after its named extension. Glaze gap and full profiles remain open.
      [Batch121](../assets/reference/concept-art-batch-121-review.md) glaze surface-only
      sample and dormant crystal detail pass both screens/root and are human-approved; full profiles open.
      [Batch122](../assets/reference/concept-art-batch-122-review.md) weapon steel
      and garment cloth A1/B2 pass both screens/root and are human-approved; full profiles open.
      [Batch123](../assets/reference/concept-art-batch-123-review.md) courtyard and forest
      ground extent A2/B2 pass both screens/root and are human-approved; temporal/full profiles open.
      [Batch124](../assets/reference/concept-art-batch-124-review.md) street ground and
      grass wind key poses A1/B2 pass both screens/root and are human-approved; temporal/full profiles open.
      [Batch125](../assets/reference/concept-art-batch-125-review.md) shrub/tree wind
      key poses: A2 shrub approved, B2 tree human-rejected as artificial; full-size B3
      replacement appearance accepted; generated recovery rejected. Screened calm/gust/reused-calm settled endpoint human-approved. Intermediate recovery and matched
      tree states and combined temporal/full profiles open.
      [Batch126](../assets/reference/concept-art-batch-126-review.md) Mara Venn and
      Skarn smith appearances A1/B2 pass both screens/root and are human-approved; full profiles open.
      [Batch127](../assets/reference/concept-art-batch-127-review.md) apothecary and
      hearth keeper appearances A1/B2 pass both screens/root and are human-approved.
      [Batch128](../assets/reference/concept-art-batch-128-review.md) dock trader and
      salvager A1/B2 pass both screens/root and are human-approved; full profiles open.
      [Batch129](../assets/reference/concept-art-batch-129-review.md) Human/Wickfolk
      field-worker A3/B4 farmer-costume corrections pass both screens/root and are human-approved; full profiles open.
      [Batch130](../assets/reference/concept-art-batch-130-review.md) forest/harvest
      carrying variants A2/B2 pass both screens/root and are human-approved; motion profiles open.
      [Batch131](../assets/reference/concept-art-batch-131-review.md) Human player
      loadout variation A1/B2 passes both screens/root and is human-approved. CHAR-011 quest persona assignments still open.
      [Batch132](../assets/reference/concept-art-batch-132-review.md) Skarn player
      variation screened; full profiles open.
      A2/B2 pass both independent screens/root and are human-approved.
      [Batch133](../assets/reference/concept-art-batch-133-review.md) adult Wickfolk
      player variation A2/B2 passes both screens/root and is human-approved; metrics/full profiles open.
      [Batch134](../assets/reference/concept-art-batch-134-review.md) Human/Skarn close
      faces reviewed: facial quality/theme pass, root accepts wider crop despite framing
      screen failure. Both human-approved on 2026-09-15; Wickfolk and motion/lighting range open.
      [Batch135](../assets/reference/concept-art-batch-135.md) Wickfolk neutral face in
      review: v1 passes both independent screens/root, one pass used; human-approved on 2026-09-15.
      [Batch136](../assets/reference/concept-art-batch-136.md) Greymaw fur close view
      reviewed; reuse134/135 for hair. Both independent screens/root PASS, one pass used;
      human-approved on 2026-09-15. Motion/full profiles open.
      [Batch137](../assets/reference/concept-art-batch-137-review.md) overcast pair
      rejected/deferred after three passes each: persistent synthetic surfaces,
      DIR-005 quality still open. [Batch138](../assets/reference/concept-art-batch-138.md)
      fresh calm/chop water v1 pair passes both independent screens/root, one pass
      each; both human-approved on 2026-09-15. Storm/motion/full profiles remain open.
      [Batch139](../assets/reference/concept-art-batch-139-review.md) storm sea/moat
      edge v1 pair passes both independent screens/root, one pass each; both
      human-approved on 2026-09-15. Static appearance only, full water profiles open.
      [Batch140](../assets/reference/concept-art-batch-140-review.md) sand break/retreat
      v1 pair passes both independent screens/root, one pass each; both human-approved
      on 2026-09-15. Deferred effect appearance only, not matched motion.
      [Batch141](../assets/reference/concept-art-batch-141-review.md) dark rock/surf v2
      passes both independent screens/root, two passes used; human-approved on 2026-09-15.
      Distant landmarks removed, minor fine texture drift; still appearance only.
      [Batch142](../assets/reference/concept-art-batch-142-review.md) clear/overcast
      skies v1 pair passes both independent screens/root, one pass each; both human-approved
      on 2026-09-15. Full sky profiles open.
      [Batch143](../assets/reference/concept-art-batch-143-review.md) storm sky v1
      passes both independent screens/root, one pass used; human-approved on 2026-09-15.
      Motion/celestial/horizon profiles open.
      [Batch144](../assets/reference/concept-art-batch-144-review.md) moonlit sky v1
      passes both independent screens/root, one pass used; human-approved on 2026-09-15.
      Slightly larger moon/full cloud bands retained; celestial/horizon/motion open.
      [Batch145](../assets/reference/concept-art-batch-145-review.md) HUD grouped/split
      v1 pair reviewed, B split human-selected on 2026-09-15. B passes both screens; root accepts
      A height deviation for layout choice, content/readability pass. Runtime unchanged.
      [Batch146](../assets/reference/concept-art-batch-146-review.md) Mara ready v1
      passes both independent screens/root, one pass used; human-approved on 2026-09-15.
      Runtime/full conversation states open.
      [Batch147](../assets/reference/concept-art-batch-147-review.md) waiting/fallback
      v1 pair passes both independent screens/root, one pass each; both human-approved
      on 2026-09-16. Static appearance only; runtime/further states remain open.
      [Batch148](../assets/reference/concept-art-batch-148.md) longer reply fixture reviewed; both independent screens/root PASS, human-approved on 2026-09-16; two passes/30 active minutes, independent screens/root before revision
      and human approval to close. Runtime/localization/fullstates open.
      [Batch149](../assets/reference/concept-art-batch-149.md) close NPC/distant waystone marker v1 pair passes both independent screens/root; both human-approved on 2026-09-16; two lanes, two passes/30 active minutes each, both screens/root before revision and human approval to close. Runtime/full states open.
      [Batch150](../assets/reference/concept-art-batch-150-review.md) gathering/entrance marker v3 pair passes both independent screens/root; v1/v2 rejected for surface artifacts, named one-pass fresh-background extension succeeds, root B generation fallback after agent thread limit. Both human-approved on 2026-09-16 with mineral prompt E · Mine; runtime/full states open.
      [Batch151](../assets/reference/concept-art-batch-151-review.md) Greymaw soft-target/pounce v1 pair passes both independent screens/root; both human-approved on 2026-09-16; two lanes, two passes/30 active minutes each, both screens/root before revisions and human approval to close. Runtime/full states open.
      [Batch152](../assets/reference/concept-art-batch-152-review.md) Hollow Warden Exposed v1 passes both independent screens/root; human-approved on 2026-09-16; one lane two passes/30 active minutes, both screens/root before revision and human approval to close. Runtime/full states open.
      [Batch153](../assets/reference/concept-art-batch-153-review.md) boss phase v2 reviewed: visual quality passes, exact tick geometry fails; root submits layout-only with explicit deviation, human layout-approved on2026-09-16; one lane two passes/30 active minutes, both screens/root before revision and human approval to close. Isolated UI fixture; runtime/full phases open.
      [Batch154](../assets/reference/concept-art-batch-154-review.md) inventory/equipment v3 paper doll and item thumbnails pass both independent screens/root; human-approved on2026-09-16; one lane two passes/30 active minutes, both screens/root before revision and human approval to close. Runtime/full inventory states open.
      [Batch155](../assets/reference/concept-art-batch-155-review.md) equipped Fine sword/affix v2 passes both independent screens/root; human-approved on2026-09-16; one lane two passes/30 active minutes, both screens/root before revision and human approval to close. Runtime/full inventory states open.
      [Batch156](../assets/reference/concept-art-batch-156-review.md) Hearthloaf ready/missing v1 pair passes both independent screens/root; both human-approved on2026-09-16; two lanes two passes/30 active minutes each, both screens/root before revision and human approval to close. Runtime/full crafting states open.
      [Batch157](../assets/reference/concept-art-batch-157-review.md) Tinker's Thrift v3 passes both independent screens/root; human-approved on2026-09-16; v1/v2 surface failures resolved by named fresh whole-loaf extension; one lane two passes/30 active minutes, both screens/root before revision and human approval to close. Runtime/full crafting states open.
      [Batch158](../assets/reference/concept-art-batch-158-review.md) Forge v1/Alembic v3 pass both independent Astra-low screens and root; both human-approved on 2026-09-16. Alembic v1/v2 rejected for herb identity; one fresh-pass/15-minute extension resolved it. Runtime/full crafting states open.
[Batch159](../assets/reference/concept-art-batch-159-review.md) vendor Buy v1/Sell v1 pass both independent Astra-low reviews and root; both human-approved on 2026-09-16. One generation pass each; full unavailable-action/list/accessibility states remain open.
[Batch160](../assets/reference/concept-art-batch-160-review.md) insufficient-funds/equipped-item trade v1 screens pass both independent Astra-low reviews and root; both human-approved on 2026-09-16. One pass each; other unavailable/full-list/accessibility states remain open.
[Batch161](../assets/reference/concept-art-batch-161-review.md) illustrated Attributes v3/Abilities v2 pass both independent Astra-low reviews and root; both human-approved on 2026-09-16. V1 superseded, Attributes v2 rejected for overlap/anatomical heart. Full browser/respec/runtime states remain open.
[Batch162](../assets/reference/concept-art-batch-162-review.md) reshape open B v2 and closed B v3 human-approved; assignment A v1 approved in Batch165; full browser/other-state/runtime coverage remains open.
[Batch163](../assets/reference/concept-art-batch-163-review.md) main/side quest journal v1 previews pass both independent Astra-low reviews/root; both human-approved on 2026-09-17. One pass each; history/full-list/preparation/runtime coverage remains open.
[Batch164](../assets/reference/concept-art-batch-164-review.md) journal history/preparation v1 previews pass both independent Astra-low reviews/root; both human-approved on 2026-09-17. One pass each; full navigation/state/runtime coverage remains open.
[Batch165](../assets/reference/concept-art-batch-165-review.md) eight-candidate packet human-approved on 2026-09-17: seven new UI010/UI011/FX024 notices and now-approved162A assignment. All PASS both independent Astra-low screens/root. D/G v2 correct background artifacts; other new candidates v1. Motion implementation review per D192.
[Batch166](../assets/reference/concept-art-batch-166-review.md) eight combat-condition appearance candidates human-approved on2026-09-17. A/C/D/E/F/G/H v1 and corrected B Chilled v2 PASS both independent Astra-low screens/root. Motion validation remains production work under D192.
[Batch167](../assets/reference/concept-art-batch-167-review.md) seven fire/atmosphere images human-approved on2026-09-17 after both independent screens/root PASS; hearth Bv2 fixes framing. Heat-refraction still rejected; specific animated production review under D192 replaces further still attempts. Advanced effects remain deferred research.
[Batch168](../assets/reference/concept-art-batch-168-review.md) five voice-conversation UI states D–H human-approved. Batch169 corrected creation A1/B1/C2 passed joint layout/content/stature screens and is human-approved; prior168 screens missed cross-image layout drift. No runtime feature claims.
[Batch170](../assets/reference/concept-art-batch-170-review.md) eight deferred material studies human-approved. A1/B1/C2/D1/E1/F1/G1/H1 pass both independent screens/root; straw framing corrected. No new mandatory kit, snow biome or motion/implementation approval.

[Batch185](../assets/reference/concept-art-batch-185-review.md) supplies six matched entrance exterior overcast/night states and day/overcast fantasy merchant-berth population. A–F v1 human-approved; G1/H1 boarding geometry rejected despite prior passes. Latest G4/H3 direct deck boarding, removable gangplank bearing ends, close-alongside fenders and visible mooring are human-approved. Batch185 appearance selection complete. G2/H2 endpoints and G3 wide berth were rejected. Hidden entrance continuity and full engineering/production profiles remain open.

[Batch184](../assets/reference/concept-art-batch-184-review.md) adds seven static references (garment reverse construction, Skarn/Wickfolk cloth and scale fits, moat-pier water contact) and re-presents existing021 fishing vessel in one eight-subject packet. All eight human-approved; full production profiles remain open.

[Batch183](../assets/reference/concept-art-batch-183-review.md) restores an eight-subject human packet: six rear loadout views plus ordinary/Mythic gear-overflow notices. A1/B2/C1/G1/H1 pass both Astra-low screens/root; D3/E2/F2 retained disclosed material mismatches after bounded corrections. All eight are now human-approved, including those three; no further texture correction pending. Full static/fit/motion profiles open. Previously presented030B Aetherspark bolt is human-approved; trajectory/timing remain implementation obligations.

[Batch182](../assets/reference/concept-art-batch-182-review.md) depleted shore-salt appearance passed both independent Astra-low screens/root and is human-approved. Remaining-reference audit identifies unresolved source-node/bolt/cinematic choices and required static views/fit/lighting; D192 does not waive those profiles. No program-completion claim.

[Batch181](../assets/reference/concept-art-batch-181-review.md) all five rarity/loot/overflow/anchor/fire appearance candidates v1 passed both independent Astra-low screens/root and are human-approved. Fire uses a documented bounded new interior-flame approach after180 failed eave filaments. Completion audit separates remaining appearance choices from production motion/state obligations; no program-completion claim.

[Batch180](../assets/reference/concept-art-batch-180-review.md) proposes consumable activation/food feedback, boss lance charge/projectile and intact-building fire. Seven consumable/lance candidates A2/B1/C1/D1/E1/F1/G1 passed both independent quality/theme screens and root and are human-approved. Two fire attempts fail root/quality despite theme passes and remain rejected; fire appearance gap retained. No runtime motion or full-profile closure.

[Batch179](../assets/reference/concept-art-batch-179-review.md) corrected ordinary/keen pair A1/B1 passes both Astra-low screens/root: actual lower-edge contact and coherent fullarm view. Distal-tipprojection framing variance explicitly accepted; A2 airgap rejected. Both179 candidates human-approved; approved178C–H stand. Motion/gameplay production obligations remain.

[Batch178](../assets/reference/concept-art-batch-178-review.md) physical contact/guard/material-impact packet revised after human rejection: wood F3 and soil H2 now show penetration and pass both screens/root; A/B cutting-edge strike remains unresolved after rejected anatomy/contact corrections. C/D/E/G v1 plus F3/H2 human-approved; A/B remain unapproved. Ordinary/keen, deflected/caught, open guard with Exposed and wood/stone/soil arrow contact. Pose/scale/contact-angle limitations explicit; timing, motion, arrow guard response and full effect profiles remain open.

[Batch177](../assets/reference/concept-art-batch-177-review.md) completes proposed matching ability cards and adds grain/ore/relic/timber/shore-salvage depletion appearances; all eight final candidates passed both Astra-low screens/root and are human-approved. Redundant available-timber F rejected for split geometry; approved046v2 reused. Boss audit reconciles accepted085/086 phase appearances to remaining impact/onset/opening/lance and production-motion obligations, avoiding duplicate arena paintings.

[Batch176](../assets/reference/concept-art-batch-176-review.md) eight illustrated ability cards passed both Astra-low screens/root for scoped UI use; all eight human-approved. D2 restores Frostbind cost; G2 removes Wardlight's misleading physical lantern. Shared layout screened jointly. H is generic gathering symbolism, explicitly not exact Bittergreen identity. Motion/gameplay cues and Wellspring/Tinker's Thrift matching cards remain open.

[Batch175](../assets/reference/concept-art-batch-175-review.md) eight gathering/ability-reference candidates passed both Astra-low screens/root; all eight human-approved. Shared card layout jointly reviewed; two boot-sole corrections, ore image retained for shimmer placement only with original082 material authority. Crafting/weather/overlap partial coverage reconciled to specific remaining production and cue-selection obligations, not full completion.

[Batch174](../assets/reference/concept-art-batch-174-review.md) eight deferred lighting/character-response/residue candidates passed both Astra-low screens/root; all eight human-approved. Mara identity retained against original126. Frost accepted by screens for material appearance only: cropped newer termination remains open. SDR highlight study makes no HDR claim; full temporal/optical profiles remain open.

[Batch173](../assets/reference/concept-art-batch-173-review.md) eight deferred water/rain/lighting first passes passed both Astra-low screens and root; all eight human-approved. Lake, underwater, splash, runoff, indirect light, two-flame overlap, optional focus and glass/leaf layering are appearance studies with explicit remaining motion/continuity/coverage obligations.

[Batch172](../assets/reference/concept-art-batch-172-review.md) eight affix, optional UI and effect candidates passed both Astra-low screens/root and are human-approved. Controller background corrected once; other first passes passed. Existing route/lighting coverage reconciled without closing continuity or production gates.

[Batch171](../assets/reference/concept-art-batch-171-review.md) eight optional UI studies passed both screens/root and are human-approved: accessibility scale pair, recap ready/unavailable, photo, highlights, companion dialogue and scenic views. Paired layouts checked; exact scaling/runtime behavior remain open. Eight additional motion-only companion catalog targets now have explicit later production-review obligations under D192; no animation approval or appearance waiver.


[Motion dispositions](../assets/reference/motion-production-dispositions.md) now bind all25 MOT targets to per-model/effect animated review under D192; no blanket motionboards required and no motion quality claimed complete.
      Include the whole game's visual scope,
      all planned rendered effects and physics behavior targets, with deferred work
      labeled separately from current implementation obligations.

**Accepted paving integration brief (2026-09-05):** the human accepts the scan-driven
source as the starting point for the game asset and authorizes integration. Preserve
the worn relief, matching PBR response and small joint plants in a 2 m module. Export
three source-derived LODs, implement paving-class QA and immutable binary storage,
and use the existing installed dependency/decode path in the ordinary render worker.
Inspect sunny/overcast/grazing and short motion/LOD/stream-return captures against the
accepted Blender preview. Allow two integration/capture/correction cycles within
three hours; extend only for a named observed defect. End with the actual game
candidate and short costs/limits. No milestone closure or full traversal is implied.

**Paving integration outcome (2026-09-05):** one QA-admitted 2 m module now renders
through the ordinary installed dependency/decode path, with three LODs, complete PBR
mips and modeled joint plants. Integration corrected dependency loss in privileged
and scale-corpus composition, ordinary-game visibility, full-mip GPU accounting, and
the missing glTF-to-Lite coordinate conversion. The corrected candidate passes build,
repeatability, lint and 2,636 tests (one existing skip), six-state preflight, LOD
hysteresis and unload/re-entry with a pixel-identical returned view. Short combined
GPU EMA medians are 3.56–3.64 ms, diagnostic only. Physical smoke is deferred to M4.5
exit. See [installed captures, costs and limits](../harness/results/d1-paving-integration-2026-09-05/summary.md).
Runtime artistic acceptance remains open: lighting is darker than the source,
surroundings are greybox, and the human reports grass-like marks on stone faces.
Inspection separates scanned leaf litter from modeled blades and finds some narrow
joints bridged by the reduced mesh. The human identifies the marks as probable scanned
grass and requests a cleaner generated or sourced starting texture.
Do not enlarge this paving patch before resolving the joint/vegetation presentation.

**Grass-feedback correction extension:** allow one adaptive-mesh candidate experiment
within 30 minutes. The observed defect is up to 32.54 mm of root burial where the
uniform LOD0 grid bridges source joints. Test source-derived adaptive reduction within
the same 32,768-triangle limit; compare root/surface error and inspect the candidate
before changing admitted bytes. Do not remove scanned litter without identifying the
reported spot. End with adoption evidence or a specific retained limitation.

The adaptive LOD0 candidate preserves the accepted source appearance at the same
triangle ceiling and retains all 2,048 boundary vertices. Surface RMS error falls
from 1.684 to 0.970 mm; worst blade-root burial falls from 32.54 to 17.88 mm, with the
remaining extreme also present in the dense source. Adoption was paused before
exporter/library changes when the human requested a cleaner starting texture.
Retain the experiment as evidence; the existing admitted asset remains active.

**Clean-source correction (2026-09-05):** compare clean scanned alternatives and up to
two imagegen candidates within 30 minutes against the courtyard's pale irregular
rectangular blocks. Must fix baked vegetation/litter on stone faces. Deliver a concrete
reference candidate; material preparation and installed visual acceptance remain open.
The first built-in imagegen candidate is retained at
`assets/reference/d1-paving-clean/limestone-v1.png`, with prompt and limitations in its
README. Inspection finds clean worn faces and irregular rectangular fitting; seamless
tiling and matched physical maps are not yet validated. It is a reference/color starting
point, not an admitted PBR material. Scanned alternatives are cleaner but more polygonal.
Human feedback found v1 too smooth. The second imagegen cycle retains its layout while
adding pronounced pits, flakes and chipped relief: `limestone-v2-rough.png` beside v1.
See `rough-v2.md` for prompt and inspection. This closes the two-image reference batch;
artistic acceptance and material preparation remain open, with no runtime substitution.

**Accepted rough-reference integration (2026-09-05):** the human accepts rough v2 and
requests continuation. Build aligned stone/joint geometry and material maps from this
reference, with separate joint-rooted vegetation. Initial allowance: two source/render
cycles within 90 minutes, followed by one QA/install/capture cycle within 60 minutes.
Must fix smooth faces, baked litter and misplaced roots; inspect overhead and grazing
views in sunny and overcast states. Preserve the existing library until candidate QA
passes. Generated/inferred maps must be identified as authored estimates, not measured
scan data; do not interpret base-color brightness directly as physical height. End with
an installed candidate and evidence, or a specific retained limitation and next step.
Palette follow-up: the human asks about yellow/red/gray stone variants and procedural
color variation. Proposed direction is authored regional stone palettes with restrained
per-stone variation masked away from dirt and vegetation. Different close-up stone
types eventually need distinct grain/erosion/roughness, not only tint. Finish baseline
limestone evaluation before adding variants or a new material mask channel.

Baseline integration outcome: final candidate `340834a6…7ff926` admitted after
structural QA and 18 production-worker decodes. Ordinary installed Chrome captures
are in `harness/results/d1-paving-clean-integration-2026-09-05/`: sunny, overcast,
overhead and grazing, with no render/streaming failures. Settled LOD checks show
37,264 → 9,188 → 2,826 → 37,264 visible asset triangles. Build/repeatability/lint pass;
after updating the exact materialized-inventory fixture, 2,638 tests pass with one
existing skip. A 660-frame sunny diagnostic gives GPU EMA p50/p95 3.62/4.27 ms,
not milestone qualification. See the result summary for exact build/release identities.
The human asks whether it tiles: it does not. Edge continuity across color/layout/
height/normals is the next asset step before expansion or palette variants. Some fine
relief remains baked source shading; runtime artistic acceptance stays open. No full
physical smoke or physical repair replay is claimed.

**Individual-stone quality reference (2026-09-05):** the human authorizes replacing
the repeated panel strategy with reusable individually modeled stones, controlled
placement and terrain fitting. This first asset must establish the game's quality
bar. Reference remains the paired courtyard; evaluate a nonrepeating 4×4 m section
and a sloped diagnostic overhead and at walking height in sunny/overcast light.
Must fix repeated face stamps and courses, uniformly corrugated tops, pale flat joints,
and rigid patch terrain fit. Preserve broad worn tops, localized chips/pits, varied
quarried outlines, narrow earthy aggregate joints and restrained joint vegetation.
Initial allowance: two source/render/evaluation cycles within 90 minutes, concurrent
bounded renderer/QA implementation, then one installed evaluation/check cycle within
60 minutes. Extend only with a specific remaining defect/payoff and finite allowance;
elapsed limits do not accept deficient art. End with the best supported installed
candidate and human artistic review, or retain the prior baseline with a named blocker.
Use an initial eight closed stone variants with shared original procedural PBR maps,
preserving variant geometry and rigid instance transforms separately. Native Lite
thin instancing is verified in the exact installed source; group by variant/material
and LOD, with game-owned placement and terrain samples. Add explicit pitch/roll and
instance-aware PSO warmup, lifecycle and measurement coverage. Existing runtime
budgets and the asset admission boundary remain unchanged. Palette expansion waits
for a convincing limestone baseline.
Contact-light diagnostic within this package: the retained CSM uses 0.12 m caster
bias, exceeding the proposed stone height; the earlier 0.01 m/1024 trial caused
terrain acne. Allow one scratch configuration comparison within 20 minutes to test
higher shadow resolution with 0.01–0.02 m bias on shallow geometry and slopes under
several sun angles. Keep the measured shipping shadow configuration unchanged until
visual evidence supports an improvement; record logical memory/cost and inspect the
installed scene before adopting any change. This does not repeat engine selection or
relax the existing shadow acceptance and frame budgets.
Scratch outcome: six Lite worker captures compare 1024/0.12 m with 4096/0.015 m.
The latter improves contact but both show low-sun self-shadow striping; logical
shadow storage rises from 16 to 256 MiB. Reject this simple configuration change.
Evidence: `harness/results/csm-shallow-stone-2026-09-05/`; the simplified boxes/slope
fixture is diagnostic only and does not supersede installed CSM acceptance.
One additional 20-minute slope-bias diagnostic found that slope scale 2 with
1024/0.015 m removes visible dawn striping in the controlled fixture, unlike slope
scale 1. Nine GPU-valid views and actual depth-state descriptors are retained under
`harness/results/csm-slope-caster-2026-09-05/`. Allow a bounded 30-minute production
caster integration, using Lite's existing ShaderMaterial path with explicit preload,
guarded caster hookup and registered warmup states, followed by installed inspection;
this is a candidate, not yet adopted shadow evidence.
Source cycles 1 and 2 fail artistic evaluation: pillow-like initial forms become
manufactured concrete with overly uniform faces/joints. Do not export or admit them.
Extend by one focused hero-stone cycle within 45 minutes: asymmetric intermediate
fractures and variable worn shoulders on one original mesh, then apply a photo-based
CC0 rock material before expanding to the courtyard. The generic procedural-noise
surface is deferred. Poly Haven Worn Rock Natural 01 is sandstone reference data
adapted to the desired limestone appearance, not a measured limestone reconstruction.
Its color/normal/roughness/height/AO inputs must retain source hashes and mixed
provenance; generated reference pixels remain unsampled. Require another explicit
outcome at this extension boundary; the first-asset excellence requirement stays open.
Human steering explicitly reiterates imagegen. Add one built-in generated limestone
surface comparison within the hero extension, with a 30-minute allowance for generation
and matched-mesh inspection if required. Ask for even illumination and no joints,
vegetation or stone boundary; retain prompt/output identity. Compare on the same mesh
against the scanned surface. An image is not automatically calibrated PBR data; do not
mix unrelated scan normals with generated features or label shading-free output proven.
Hero outcome: corrected original geometry with imagegen's single limestone surface
is selected for courtyard reconstruction after matched-camera inspection; it is warmer
and less veined than the sandstone arm. Scan maps are not selected runtime inputs.
Retain restrained original procedural fine normals and authored macro relief; generated
diffuse is not calibrated height. One assembly/export cycle within 40 minutes now
rebuilds the eight variants around this shape/material direction, before QA and the
previously allocated installed evaluation. This selection is not final artistic acceptance.
Human feedback identifies apparent surface noise in previews. Within the assembly
cycle, compare the same source camera with fine bump disabled before freezing maps;
the current direct Cycles PNGs precede compression, so KTX2 cannot explain their noise.
Then inspect compressed/runtime output at matched distances and during motion, using
the existing full mip chain and anisotropic filtering. Preserve calm worn areas and
localized larger wear; do not solve noisy detail by flattening all geometric relief.
The human subsequently identifies the bright tilted **in-game green-background**
preview, which still uses the old periodic resource. Source bump-off/256-sample
comparisons are retained diagnostics; they do not diagnose that installed image.
Match its camera for the new asset and inspect movement before attributing its noise
to compression or antialiasing.
Installed contact-candidate outcome: dawn terrain still stripes in the ordinary
game. Reject 0.015 m/slope 2 and remove its caster/warmup machinery; restore 0.12 m
and the five required pipelines. Evidence and short cost samples are retained in
`harness/results/d1-contact-shadow-integration-2026-09-05/summary.md`.
The same check exposes ambient-dominated PBR lighting. Allow one 30-minute shared
ambient-only calibration and installed comparison: clear noon 0.25 instead of 0.88,
scaling existing weather/night fill consistently while leaving direct sun unchanged.
Inspect Standard terrain and PBR stones in daylight/dawn/overcast/night; retain the
candidate only if the actual game improves without unacceptable darkness. This does
not establish solved shallow contact shadows or relax frame budgets.
The original eight-variant/generated-surface candidate passes the separate asset
gate and all 69 production-worker decodes with zero external requests. Final admitted
identity is `37981b52cdce6a3b11cc0e37771832b3c6d0a26bf2b614c6ad768b7bc6f444b6`;
72 immutable objects include 69 runtime streams/maps totaling 16,096,163 bytes.
Source has 153 courtyard stones and 150 grass roots checked against all LOD hulls,
with at least 1.06049 mm extra clearance. Each stone uses 3,900/1,150/380 triangles;
the explicit scene asset proposal is now 750k near triangles to preserve this shape,
with eight shared variants and existing runtime/encoded-byte budgets unchanged.
Ordinary content activation includes those stones, substrate/grass and 24 separate
stone-only slope placements (179 total). Courtyard anchor remains [6,6]; the slope
diagnostic at [198,198] follows actual collision triangles with 57 mm nominal burial.
It does not claim terrain-conforming substrate or grass outside the flat courtyard.
Installed visual and lighting evaluation remains pending at this point.
The first installed attempt is not accepted: completion triggers an installer
protocol relationship error after the page reports 400/400 resources verified.
Reload discovers the committed install, but launch then rejects projected streaming
staging above 128 MiB before any dependency decode. Retain both failures and repair
their causes within the installed evaluation allowance; do not bypass protocol checks
or raise the staging budget to obtain an image. The final source previews remain
available for artistic feedback while actual runtime validation is blocked.
Human artistic outcome: the individual-stone previews are rejected as far below the
paired courtyard reference. They read as uniform pale slabs with continuous exposed
shoulders, flat joints and weak vegetation. Do not treat technical admission as the
quality benchmark. The human now requests a pause after installer/streaming fixes and
visible-path verification, before any further asset work, to restart with Blender MCP
available. A proposed small assembled art correction is stopped; resume it only after
that restart/user continuation. No additional asset generation is authorized in this
technical closure stage.

**Periodic paving integration (2026-09-05):** user requests continuation after the
tileability discussion. Preserve accepted rough pale stone character; make color,
height, normals and every LOD boundary continuous, without mirrored repetition or a
visible square border gutter. Initial allowance: two image/source/evaluation cycles
within 90 minutes and one QA/install/capture cycle within 60 minutes. Inspect a 3×3
module patch overhead and at grazing angles under sunny/overcast lighting, plus
numerical seam checks. Adopt the best supported periodic candidate or retain the
finite baseline with a specific limitation; do not label approximate edges seamless.
Palette variants follow a successful periodic baseline.
The six-metre patch exposes 120 mm of existing ground variation at [6,6]. Deliberately
author a local level courtyard pad, keeping render terrain and collision in agreement,
rather than burying or floating the paving. Preserve the current anchor elevation;
measure and record the actual affected extent of the terrain sample grid. This is a
local content adjustment for the finished courtyard, not a change to world scale.
Measured pad implementation: [0,16]² is level at 18.97375 m; interpolation support
extends to [-32,48]² with unchanged outer samples. Sixteen grid samples change, and
four cells retain stride-1 terrain at every LOD so visual terrain matches collision
(1,920 additional far surface triangles, excluding skirts). Twelve world tests and
engine/game typecheck pass; the existing single placement remains active until the
periodic material passes its seam and worker gates (subsequently passed below).
The generated v3 repeat failed visual joins. The first atlas repeat exposed empty
notches from isolated L-shaped stones and stretched samples. Extend by one bounded
30-minute source correction within the overall 90-minute allowance: use complete
stone samples and fitted subdivisions with preserved proportions, then evaluate the
repeat before exporting. No further image generation is needed for this correction.
Contour follow-up: the human asks whether paving can follow the ground. Current
modules are rigid and use the local level pad. Future paths should place/tilt whole
stones from terrain samples while fitting joint substrate/vegetation continuously;
do not bend broad stones or imply periodic texturing implements terrain conformance.
Retain source stone IDs/contours for that placement work before extending along slopes.
Human feedback rejects atlas-cycle2's linear courses and similar blocks. New bounded
layout correction: two layout/render evaluations within 45 minutes, preserving the
accepted rough material while mixing block sizes/orientations and infill, with no
continuous row across the tile. Keep toroidal joins, avoid mirrored symmetry and
stretched source samples, and inspect the 2×2 layout before geometry/compression.
The row-based candidate remains diagnostic only and must not be admitted.
The first courseless correction uses 19 mixed rectangular footprints, quarter-turns
and small infill stones. Agent inspection of the flat 2×2 and shaded geometry repeat
finds the continuous courses resolved sufficiently for QA and installed evaluation;
repeated source faces and pale joints remain visible limitations, not final artistic
acceptance. Evidence: `harness/results/d1-paving-periodic-2026-09-05/courseless-shaded1/`.
Integrated outcome: candidate `0650525cd2139ef2257afc669a5dcb2a489f19e5448a93c11f9e33630a755e01`
passed all 18 production-worker decodes and 2,322 all-LOD seam comparisons with zero
height mismatch. Nine modules now form a 6 m patch; texture repeat sampling and shared
height anchoring are active. A fresh ordinary installed launch was inspected overhead,
grazing, sunny and overcast with no browser/render/streaming failures. The two-metre
motif remains recognizable, and joint substrate is pale/uniform; further source/layout
variation and joint art remain open for human acceptance before palette expansion.
Full `pnpm check` passes: 214 test files, 2,647 tests, one existing skip. A 660-frame
sunny diagnostic gives GPU EMA p50/p95 3.91/4.51 ms, not milestone qualification.
Logical GPU resource residency is 51,965,592 bytes with 18 stone/grass placements;
near/mixed/far selections were exercised. Exact identities, captures and limitations:
`harness/results/d1-paving-periodic-integration-2026-09-05/summary.md`.
Physical smoke remains deferred to M4.5 exit; no physical repair replay was run.

**Paving correction brief (2026-09-05, human rejection):** the shader slab prototype
is substantially below the supplied courtyard reference. Rebuild a small source patch
with closely fitted, weathered limestone blocks, shallow irregular relief, narrow
filled joints and restrained vegetation. Direct Blender modeling and scanned material
techniques are authorized; compact shader geometry is not an artistic constraint.
Compare sunny and overcast walking-height views against the endorsed courtyard image.
Allow two modeling/render/inspection cycles within 90 minutes. End with a materially
better modeled candidate and explicit runtime handoff, or identify the remaining
visual blocker. Do not expand the patch or call source renders game captures.

The two authored-block attempts still look manufactured, even with scanned grain.
The selected scan's full displacement/material pairing is visibly stronger. Allow
one focused 15-minute source correction to add restrained living plants in its joints;
retain the scan-driven source rather than continue synthetic block recipes.

**Source correction outcome:** the selected scan now drives a real 2 m relief mesh,
matching material maps and 26 small modeled grass clumps. Sunny/overcast/grazing
Blender inspection shows substantially more credible wear and surface variation than
the rejected shader slabs. Retain this source candidate; the original reference's
greener joints, palette and scene-level integration remain artistic targets. Source
LOD0 is 524,288 triangles plus 3,980 plant triangles and is not a runtime budget
proposal. Three renders take about 37 seconds on the local Blender setup, not a game
performance result. See the [source comparison](../harness/results/d1-paving-rework-2026-09-05/summary.md).
The next runtime package needs a baked PBR module, paving-class library QA and installed
asset loading with material/pipeline ownership; the existing compressed transport does
not yet bind PBR maps. No source render is presented as an integrated game result.

**Shader-shaped pathway brief (2026-09-05):** the human rejects the regular scanned
cobblestones and selects the irregular structure of Poly Haven `stone_pathway_02`,
with brighter stones and live-looking plants in recessed gaps, under the courtyard's
photorealistic reference. Build a compact, deterministic per-stone descriptor and a
shared mesh deformed by WGSL in the ordinary streamed render worker. Inspect a small
village patch at walking height, grazing angle and overhead in sunny/overcast and
low-angle sunlight, plus a short camera-motion sequence. Must fix flat-looking relief,
regular rows, floating plants, incorrect deformed normals/shadows, bounds/disposal
faults, and unregistered pipeline creation. Allow two implementation/capture/evaluation
cycles within a two-hour work session. Use short combined-scene cost windows and
six-state preflight; no full traversal or milestone smoke. End with an integrated
candidate and explicit visual/performance limits, or record the specific blocker;
human finished-area acceptance remains open. No final-art binary admission is implied
by the procedural descriptor. The earlier material-choice question is superseded.

**Pathway integration finding and bounded extension:** the first GPU execution exposed
receiver/depth texture aliasing in Lite's default custom-material caster view (RE-049).
Descriptor identity alone had allowed a black frame to reach Ready; actual GPU
validation and sampler-free caster bindings now cover that failure. The first valid
Chrome capture proves relief but fails the visual brief: sparse thick blocks, green
placeholder ground and spike-like plants. Allow one additional correction/capture
cycle, at most 60 minutes, for denser irregular packing, thinner exposed slabs,
terrain-conforming soil and lower tufts. Test 0.01 m CSM world-space bias against the
previous 0.12 m setting for contact definition and six-state acne; do not silently
replace the previously measured shadow evidence or claim finished-art acceptance.

**Pathway outcome (2026-09-05):** retain the compact shared geometry mechanism
(D-185), but defer the synthetic-only finish as final art: manufactured surfaces,
simple vegetation and weak near-contact lighting still miss the reference. The
90-stone patch runs in the ordinary streamed worker; unload/re-entry restored a
pixel-identical view, and all six lighting preflight checkpoints passed. The 0.01 m
shadow bias produced terrain acne and was rejected; 0.12 m remains. Build and lint
passed; the final unit run passed 2,637 tests with one skipped. Short combined-scene
GPU EMA medians were 3.83–4.21 ms, diagnostic only. See the
[captures, measurements and limitations](../harness/results/d1-pathway-2026-09-05/summary.md).
This bounded prototype is closed; M4.5 artistic acceptance remains open. The next
art package needs scan-derived surface detail, convincing chips/vegetation and
contact lighting before this patch can represent the finished courtyard.

**Reference/kit brief (2026-09-05):** prepare an original paired sunny/overcast
reference for the village-well courtyard, looking toward the central hilltop castle,
plus a small modular kit specification. Keep the same camera, buildings, materials,
and traversable route in both states. Question: can a compact shared kit carry the
bright coastal-village identity and gloomy-weather contrast without changing authored
terrain, collision, or transition locations? Must fix unreadable route, inconsistent
architecture between states, and missing material/scale guidance. Allow two reference
generation/inspection cycles within 45 minutes; deliver references and an implementation
spec for human artistic acceptance before deriving final library art. Pipeline readiness
inspection runs alongside this work. No runtime or milestone acceptance is claimed.

The human endorsed the first paired image as the quality benchmark: AAA-quality,
photorealistic movie-style visuals. Bright readability must not become cartoon or
toy-like graphics. The [reference/provenance](../assets/reference/d1-courtyard.md)
and [kit specification](../assets/reference/d1-courtyard-kit.md) retain the direction.
Proceed to one source-only limestone paving candidate using installed Blender 5.1.2:
two model/render/inspection cycles within 45 minutes, sunny/gloomy grazing views,
with believable joints, scale and surface roughness as must-fix requirements.
Keep generated binaries in ignored results pending P-004 and full admission QA;
this preview does not claim worker integration, baked export, or finished-area acceptance.

Both procedural previews were rejected by the lead: regular courses, manufactured
edges and empty joints miss the endorsed reference. Extend by one material-source
comparison cycle within 30 minutes: evaluate Poly Haven's CC0 Cobblestone Pavement
maps on a metric source surface with restrained displacement, using the same sunny,
gloomy and grazing views. The question is whether scanned surface detail resolves
the demonstrated realism gap; it does not authorize changing the reference or
claiming the material is limestone. Retain provenance and exact downloaded hashes;
no library admission or public deployment. End with visual evaluation and the
remaining export/QA requirements, not another automatic modeling cycle.

**Source-stage outcome:** reference and kit brief delivered; the human endorsed the
reference quality target. Two procedural paving attempts were rejected. The scanned
comparison improves surface variation and filled joints, but uses smaller/darker
cobblestones and remains flat at grazing angles. Its 2.5 m source tile and
73,728 / 18,432 / 1,152 source triangles do not satisfy the proposed 2 m kit module
or its production limits. No art was admitted to the library (accepted kit throughput:
zero), no runtime behavior changed, and M4.5 remains open. See the
[source comparison and captures](../assets/source/d1-paving/README.md).
The next human input is artistic selection of this cobblestone material direction
versus pursuing the reference's larger/paler stone; the reference quality bar remains
binding in either case. Then implement production geometry/maps, binary QA and the
worker instance/material path, resolving P-004 before library admission.

Repository validation: build and repeatability checks, Biome, and 209 unit suites
pass (2,620 tests, one existing skip). The initial check exposed the corpus validator's
unintended KTX2 CDN dependency; a network-blocked regression reproduced the same error
and now passes with the installed pinned UASTC sRGB WASM. The old error discarded its
underlying cause, so the initial failure cannot be attributed retrospectively with
certainty. This repair and the reference stage were committed separately under the
human's explicit authorization for this session. No physical smoke or traversal gate
was run; those remain milestone-scoped. Blender preview timing is not game performance.

- [x] Integrate the selected CSM candidate into the shipping render worker, release-owned
      PSO warmup trace, and public telemetry (D-183; implementation only).
- [x] Human visual verification of the integrated CSM candidate: explicitly accepted
      in this task, including the delivered contact shadows and bounded distance fade.
- [x] Localize and fix the integrated candidate's intermittent checkpoint failure;
      verify the corrected six-state preflight and regression coverage. D-184 defers
      full integrated traversal qualification to the M4.5 candidate. Retain the failed
      reports as invalid and make no qualified CSM control-relative cost claim.
- [ ] Author sunny and gloomy references and a small modular D1 kit: architecture,
      representative PBR materials, terrain detail, foliage, and the castle silhouette.
      Paving-class mesh/UV/texture/LOD/export QA is active and the first module is
      admitted; D-186 resolves P-004 binary storage. Extend class QA for the rest of
      the kit before admission.
      Preserve authored deterministic terrain, collision, and streamed ownership.
- [ ] Produce one rigged NPC and one enemy with locomotion, idle, and the encounter's
      combat animation through the same provenance and QA path. Use existing gameplay
      and Babylon animation; additional body types remain M5 expansion.
      Source import/rig/skin/clip validation and pinned-worker diagnostics are now
      implemented; character production and admission remain open.
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

**Checkpoint localization follow-up (2026-09-05):** reopen the intermittent
all-nonbackground checkpoint using the same six preflight cameras/states. Retain exact
readback pixels, clear color, and camera state from up to six fresh launches; fix a
demonstrated capture/state defect without changing visibility thresholds. Allow two
implementation/capture/evaluation cycles and 90 minutes for localization and checks.
If localized, run one matched three-repeat control and candidate set (a further
90-minute measurement allowance); otherwise retain the failure and name the unresolved
mechanism. This is performance evidence work, with no new artistic acceptance claim.
The first six short launches passed all checkpoints with identical coverage. Extend
localization by one six-launch set within the same 90-minute allowance, reproducing
the standard runner's host/display identity collection before preflight; the initial
probe omitted that sequence and therefore did not reproduce its startup timing.

Localization outcome: extended launch five reproduced the historical failing RGBA
hash `5331e8cd34720fef29c46000dc916b3b7eae4aba828db5f0758d5a179d605798`.
Exact pixels show stale preview terrain covering the sky, with the correct camera and
clear color; this is not a corrupt readback. Direct `mesh.visible` assignments bypassed
Lite 1.12.0's draw-bundle visibility epoch. Use the public `setSubtreeVisible` API for
flythrough ownership and player/crowd visibility changes. Six corrected fresh launches
passed all 36 checkpoints; first-checkpoint coverage was identically 0.8666023484889465.
The regression test observes the actual pinned cache epoch, including no invalidation
for unchanged presentation. Before/fixed pixels and exact verified reconstruction
bundles live in `harness/results/checkpoint-localization-2026-09-05T02-21-47-133Z/`
and `checkpoint-localization-2026-09-05T02-26-16-408Z/`. Temporary pixel retention is
removed before measurement. The initially planned comparison prepared pre-CSM commit
`54bc7c2` with the same visibility fix and explicit 1 GiB collector buffer. It was stopped
on human feedback about development latency (D-184), without a qualifying report; no
candidate traversal set was started. The localization step is complete, and the next
work is the sunny/gloomy references and modular D1 kit. Full integrated traversal
qualification remains at M4.5 exit; a qualified CSM control-relative cost delta remains
unavailable.
`pnpm check` passes (2,620 tests, one existing skip). The new regression test fails
against the reconstructed original source because the draw-cache epoch stays unchanged.
The installer replay fixture is rebound to the corrected artifact under semantic
contract v11, preserving its exact identities, publication hashes, and rejection checks.
Physical smoke is deferred to M4.5 exit; this work uses the focused real-worker
preflight, regression test, standard checks, and exact installer replay
`installer-repair-production-replay-v4-2026-09-05T02-34-38-887Z.json` (passed).

**Historical CSM integration brief (2026-09-04; follow-up above, cadence amended by D-184):** use the ordinary streamed D1
flythrough's six daylight/overcast/dusk/night/dawn states, plus its installed renderer
and gameplay camera, against the retained near/mid/vista CSM captures. Question: does
the selected 4×1024, 180 m, 0.12 m world-bias candidate preserve coverage and residency
when integrated, at an acceptable combined cost? Must fix missing warmup states,
stale/hidden/evicted casters, retained caster-material references, and rendering errors.
Initial allowance: two implementation/capture/evaluation cycles in one work session,
with a two-hour elapsed-effort limit. Measure the unchanged standard flythrough before
and after; existing worker render-duration distributions provide the comparable CPU
signal. New candidate GPU/task diagnostics have no historical no-shadow counterpart,
so do not invent a GPU control delta. Integrate the best supported candidate, record
costs/limitations, and leave artistic adoption open for human visual acceptance. The
full M4.5 exit smoke remains deferred under D-181.

Extension after cycle two: one additional implementation/capture/evaluation cycle,
within the original two-hour session. The first candidate omitted default-visible
meshes from its caster list (fixed); the second exposed last-cascade edge shadowing
on the kilometer-scale terrain. Exercise Lite's public frustum-edge falloff and
retain the result. The unchanged baseline also failed its third preflight checkpoint
(`visiblePixelRatio=1`), so its two completed traversals are diagnostic evidence only;
do not present them as a qualified three-run control or relax the checkpoint gate.

Cycle three outcome: integrate with `frustumEdgeFalloff: 0.1`; the gameplay dark band
is absent and all six preflight states plus the short motion sequence complete without
browser errors in `harness/results/m45-csm-integration-2026-09-04/after-falloff/`.
Near player contact is visible; distant shadows fade at the bounded cascade footprint.
The standard measured candidate traversal and repository checks close this work package;
qualified before/after comparison and human artistic acceptance remain explicit until
their evidence is available. No additional visual cycle is authorized by this outcome.

Measurement follow-up (one rerun of the standard three-repeat command, within the
original two-hour session): the candidate's first ten-minute traversal reported trace
data loss after 4,329,014 events / 710,956,503 serialized bytes (RE-008). Preserve that
invalid attempt. Retain raw gameplay snapshots before trace finalization, and test an
explicit 1 GiB requested trace buffer against the same route, categories, timeouts, and
loss checks. The buffer is a collector configuration, not game GPU memory or a budget
increase. Stop at this rerun's terminal outcome; if evidence remains invalid, defer
adoption and name the exact reopening work rather than silently retrying.

**Work-package outcome (2026-09-04):** implementation integrated and visually accepted
by the human; performance qualification remains open. Acceptance covers the delivered
integrated CSM captures, including the 180 m cascade footprint and edge fade; it does
not close the later finished-area, night/storm, or milestone-exit requirements.
`pnpm check` passes (2,619 tests, one existing skip), and exact production installer
replay `installer-repair-production-replay-v4-2026-09-05T01-18-40-642Z.json` passes.
Physical smoke: deferred to M4.5 exit — those checks, real-worker captures, and the
specialized flythrough cover this intermediate work. The final candidate report is
`harness/results/flythrough-d1-1-3e610c0328fe-dev-01-showcase-2026-09-05T01-58-31-402Z.json`
(schema 37 / metric set 11; SHA-256
`8b50944a06521f7ce77ec727668f645e70402a807c333c7ba6b9e3cac347b11d`).
It binds artifact `3e610c0328febe0113c648852af3a0d15c891811236751b183160e7f20201fb3`,
release `5bb59a456b8eb15e29d756a321f44b51ff100bc273d30b0e61d92590b1cbf8d0`,
base `54bc7c2c332f0285a47a2e4eb13e1cd51bb65c3f` and measured dirty-tree digest
`118964b08a20587c867fc105a26a618d69cbf03e39cf8cf7625f4fd277d7fdaf`.
The source tuple matched before this evidence-only status update.

Two candidate repeats completed with 36,002 frames and 92 in-window cell loads each:
render-worker p95 **0.600 / 0.535 ms**, CPU-submit p95 **0.530 / 0.475 ms**, GPU
frame-EMA p95 **3.515 / 3.591 ms**, shadow-task GPU p95 **0.131 / 0.131 ms**.
Both recorded zero in-window pipeline creation/shader compilation and zero main-thread
long tasks. At completion, each retained 18 caster materials for 18 live casters after
83 / 81 membership updates. The shadow array is 16 MiB logical allocation; this is not
attributed GPU residency. The trace-capacity follow-up was lossless in both repeats
(RE-008). Repeat three failed checkpoint zero with `visiblePixelRatio=1`, as the clean
pre-CSM control did. The report remains **FAIL**, 2/3 complete, budget **not-evaluated**;
the two-run observations do not qualify a before/after delta. The old control's
render-worker p95 was 0.340 / 0.285 ms, with a different trace-capacity configuration.

Review [the before/after captures and measurement summary](../harness/results/m45-csm-integration-2026-09-04/summary.md).
The initial allowance plus one visual extension produced three capture cycles; no
binary kit assets were authored. This session measured renderer integration and
collector cost, not normal art-edit throughput. **Then-next action (localization now
resolved above; full comparison deferred by D-184):** capture the exact first
checkpoint pixels/clear-color/camera state to localize the intermittent all-nonbackground
readback, then obtain complete control and candidate sets with matched collector
configuration. Human artistic acceptance is recorded above; near contact is improved, and
distant shadows fade at the 180 m cascade footprint. No further retry or visual cycle
is pending from this work package.

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
| Water/reflections | Ocean/lake/moat, wet streets/puddles, SSR/probes; select for a water/wetness scene, and cost simulation separately. See the [water/ocean research lead](#waterocean-research-lead) below |
| Dynamic surfaces | Cosmetic mud tracks/footprints, wetness/snow blending, and sim-queryable friction classification when a chosen encounter needs them; destruction remains excluded |
| Fire/smoke | Movie-quality torches through burning buildings, wind-driven plumes and emissive lighting; extend beyond the initial fire only for an authored showcase |
| VFX substrate and magic | Shared GPU particles/volumetrics, gas/steam/mist, electrical arcs, trails, frost/ember responses; grow from selected effects, never build the whole library first |
| Image pipeline | AA, tonemapping/grading, bloom first as the scene requires; TAA/upscaling, HDR, DOF, motion blur and heat refraction require a visual/cost need; custom temporal reconstruction is not presumed necessary |
| Transparency/decals | OIT, puddle edges, moss, wear and mud where demonstrated sorting or dressing needs justify them |
| GPU-driven rendering | Compute culling/occlusion and indirect draws when representative density identifies a bottleneck; qualify any required pinned interop and document encountered platform gaps |
| Texture residency | Virtual texturing or finer residency streaming when the real material working set exceeds the selected streaming approach's measured capacity |

#### Water/ocean research lead

Retain [Brandon DeRosier's (@algebrandon) beach-demo thread](https://x.com/algebrandon/status/2099481040540897553)
(2026-09-14; supplied by the human) for the future water work package. The opening
post describes a Flutter Scene prototype coupling an FFT ocean spectrum to a
shallow-water solver in the surf zone, with breaking waves and water color derived
from published ocean-optics tables. The opening post was retrieved through
[FxTwitter](https://api.fxtwitter.com/algebrandon/status/2099481040540897553);
replies, video behavior, implementation sources, and performance remain unverified.

When a selected water/shoreline scene promotes this work, revisit the full thread
and any linked code/papers, identify the optics tables, and assess the approach for
Parallax's Babylon Lite/WebGPU stack. Questions to carry into the bounded brief:
offshore-to-shore coupling, breaking/foam and shoreline interaction, optical
appearance, and simulation cost measured separately from rendering. This is a
deferred research lead; no technique has been adopted or capability demonstrated
in Parallax by retaining it.

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
- [x] Resolve optional epilogue framing: human selected normal gameplay/dialogue on 2026-09-19; no dedicated scripted-camera sequence. Other cinematic work needs a separate named scene requirement (D-141 scope disposition).
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

Concept-art progress audit2026-09-17: [inventory and workflow correction](../assets/reference/concept-art-progress-2026-09-17.md). Restore planned6–12-image human review packets while preserving two-lane generation, independent screens and bounded iteration. Remaining118 missing targets plus partial-profile gaps require finite closure planning; no scope change or milestone closure.

Human confirmation2026-09-17: next concept review packets target8–12 images; all appearance, lighting and motion artistic decisions remain with the human after independent agent screening. Motion change subsequently accepted as D-192: boards only where needed for appearance decisions; animated evidence and human acceptance during relevant model/effect production. Other D187/catalog requirements remain unchanged.

Resource-source selection2026-09-19: fish uses fishing; game meat, hides and sinew use hunting. [Source brief disposition](../assets/reference/targets/REMAINING-choices-after-185.md). Current generic nodes remain implemented behavior; source art and subsequent acquisition integration must reconcile handling, yields, cooldowns and saves before gameplay changes. No runtime change in this art packet.

[Batch186](../assets/reference/concept-art-batch-186-review.md) fishing/hunting source proposals: all fourv1 passed both independent screens/root; all four appearances human-approved on 2026-09-19. Existing inventory art retained. Optional epilogue cinematic-art gap closed by human normal-gameplay/dialogue framing choice; source acquisition implementation remains separate.

Batch186 approval2026-09-19: human approved all four v1 images (shore fishing, landed catch, live deer-like prey, hunting recovery). Plain-pole fishing and this unnamed animal appearance are selected. Existing inventory art retained; acquisition implementation and full production evidence remain open.

[Batch187](../assets/reference/concept-art-batch-187-review.md) six-subject packet human-approved: shared village-well courtyard footprint, four construction states and existing lantern. Original reference brief already locates courtyard at village well; proposed layout preserves transition/square/D191 anchors and does not move castle-origin prototype or change runtime terrain. Reverse art follows layout selection; shared blockout still must prove heights, sightlines and traversal.

Batch187 approval2026-09-19: human approved all six subjects: shared village-welllayout, B1closeddoor, C1closedshutters, D1opencrate, E2opensatchel and original002lanternv2. These no longer await artisticselection. Further courtyard views use the selected footprint; runtime/metric/motion obligations remain open.

Batch188 outcome2026-09-19: shared sampled-terrain Blender layout passed both independent screens/root, but all three arrival paintings failed required geometry correspondence. A3 improved building framing but replaced the separate stair trench with a solid masonry form; both Astra-low reviewers and root reject it as a registered scene source. B–H were not generated. Painting retries stopped at the documented allowance. [Method result and two concrete next-work choices](../assets/reference/concept-art-batch-188-review.md): recommended textured reference-only shared scene, or human-approved deferral of matching finished views into production. Historical choice pending at this point; superseded by the D-193 human decision below.
Human decision2026-09-19 — D-193: matching Batch188 courtyard views are deferred to asset production. The approved187 footprint and screened188 shared scene supply geometry; existing approved art supplies appearance. Produce the eight matching camera/light captures during courtyard production, with both independent screens, lead inspection and human artistic acceptance. This resolves the workflow choice and concept-stage disposition for these views, not their finished acceptance. No further painting retry or separate textured reference phase is scheduled. Other concept/route/QA obligations remain open. See [accepted disposition](../assets/reference/concept-art-batch-188-review.md).


2026-09-19 final-coverage reconciliation: [current audit](../assets/reference/concept-art-progress-2026-09-19.md) records324 targets with coverage/dispositions and no explicit Missing rows. [Per-effect production briefs](../assets/reference/effect-production-dispositions.md) schedule live cues under D-192; character identity records reconcile later approved baselines. Batch189 addresses remaining palette and UND-007 selection. Whole-collection review, rights and production acceptance remain open.


Batch189: [seven-image review](../assets/reference/concept-art-batch-189-review.md) passed both independent Astra-low screens/root and awaits human selection. Two new field-light studies, four approved forest/underground references reused for palette consolidation, and existing004 passage study. Both shore relights failed engraved surface fidelity and are withheld; that single paired-light gap remains open. Four native attempts retained, bringing the measured concepts image inventory to709 files (including rejected candidates and authored renders).


Human approval2026-09-20: all seven displayed189 subjects A–G approved: new field sunny/overcast pair, existing forest sunny/overcast palette pair, existing underground torch/Wardlight comparison, and004 passage construction study. Both withheld189 shore relights remain rejected; this approval does not cover them or defer their outstanding paired-light requirement. Full production and whole-collection acceptance remain separate.
Human decision2026-09-20 — D-194: defer the remaining shore sunny/overcast comparison to asset production. Approved rock/sand/wetness/water references remain binding; both rejected189 relights remain unselected. First shore assembly/material production must deliver matched dry sunny/overcast captures and a separate wet-state comparison, followed by both independent screens, lead inspection and human artistic acceptance. No further prerequisite shore painting is scheduled. This closes the scheduling decision, not finished visual acceptance or whole-collection review. See [accepted shore production handoff](../assets/reference/shore-lighting-production-proposal.md).


2026-09-20 collection handoff: [final reference review](../assets/reference/concept-art-collection-review.md) assembles the324-target corpus, accepted189 palette/passage selections, D-192–194 dispositions and exact first-paving reference bundle. Both bounded coverage audits find no new named painting to commission automatically, but unfulfilled static profile requirements remain in D-187. Human decision is required to move those supplementary views/details into per-subject production review with explicit preflight and artistic acceptance. Modeling remains paused pending that sequencing choice; no full-program or runtime completion claimed.
