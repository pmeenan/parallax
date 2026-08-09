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

Physical qualification is impact-matched under D-157. A plan item requires Showcase
`smoke@1` only when its candidate can affect a subsystem, measurement, validator, or
budget that smoke explicitly exercises. Items isolated to other surfaces use their
relevant focused or specialized scenario instead; changed artifact identity alone does
not create a smoke requirement.

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

## M3.5 — Gameplay systems  `in progress`

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
