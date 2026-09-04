# Feature matrix

The project's ambition is broad AAA feature coverage in a coherent, high-fidelity
open-world experience. D-182 delivers a representative finished area first and expands
from measured scene needs. Reuse established implementations where they satisfy the
scene; novelty may come from scale and integration rather than every component.
This document tracks coverage and the binding constraints of build-later features.

**Status legend:** `active` (on the committed mainline plan — see its Milestone column;
not necessarily in progress yet, plan.md tracks that) · `designed` (constraints locked,
build later) · `implemented` (the planned implementation and result contract are
complete; any explicit physical-qualification limits still apply) · `explored` (idea
logged, no constraints yet) · `deferred` (retained research ambition; requires a named
scene need, measured bottleneck, or selected platform study before implementation;
not a fixed milestone exit requirement)

## Matrix

| Feature area | Capability / research value | Status | Milestone |
| --- | --- | --- | --- |
| Open-world streaming | OPFS worker streaming under memory budgets; D-112 observability; representative-art no-visible-pop qualification starts on M4.5's route and extends across D1 in M5 (D-115/D-182); hard district swaps | active | M1, M4, M4.5 route, M5 district |
| Install/update lifecycle | Multi-GB browser-native installer; D-144 qualifies the asset-only-update warm-launch outcome under the fixed budget while retaining cache attribution as best-effort evidence (D-051); full offline; clean confirmed uninstall with measured full-removal (D-024) | implemented | M2 complete (D-153) |
| High-fidelity rendering | WebGPU-only pipeline, WGSL compute (culling/terrain/VFX), zero runtime PSO compiles via trace-driven warmup | active | M1, M4.5, M5 |
| Lighting, GI & atmosphere | Dynamic day/night/weather and selected local-light/fire moments in the finished area; advanced GI, many-light shadows, and atmosphere promoted for demonstrated scene needs (D-182) | active; advanced techniques deferred | M4.5 scene, research backlog |
| Terrain & procedural materials | Authored deterministic terrain and representative PBR materials first; extend instruction-set generation and measure generate-vs-bake bytes/compute when real content justifies it. Mud/deformation and friction classification remain triggered research (D-182) | active baseline; extensions deferred | M4.5 scene, research backlog |
| Water, vegetation & wind | Representative foliage and shared wind as consumers land; district instancing/LOD, water and wetness promoted by chosen scenes or density limits; water simulation costed separately (D-182) | active foliage; extensions deferred | M4.5, M5 density, research backlog |
| Image pipeline | Scene-driven AA, tonemapping/grading and bloom; TAA/upscaling, HDR and extended post effects require demonstrated visual/cost need. Reuse pinned implementations; hand-built temporal reconstruction is not presumed necessary (D-182) | active baseline; extensions deferred | M4.5 scene, research backlog |
| GPU-driven rendering & texture residency | Compute culling/occlusion, indirect draws and virtual texturing promoted only by a representative density/residency bottleneck or selected platform study; qualify any required interop (D-182) | deferred | Research backlog; no fixed milestone prerequisite |
| NPC navigation & crowds | Navmesh over streamed procedural cells plus village-scale crowd movement under the sim determinism constraints (D-140) | active | M3 |
| Combat, progression & crafting | Full mechanics stack inside the deterministic sim worker — replays double as gameplay regression tests; D-166 adds authored navigation-aware pack AI and D-167 classless progression; D-168 adds saved gathering/regrowth, the 24-recipe station loop, static vendors, equipment/consumables/upgrades, seeded loot/affixes, and the material satchel; D-172 adds authoritative hybrid-UI consumers, current-level XP/unspent-choice HUD, stamina/aether-only level-up payoff, and Ironset lifecycle telegraph; original slice-scale ruleset, no D&D-protected material (D-141) | implemented | M3.5 |
| Quests & journal | D-170 supplies validated saved one-time landmark discovery and shared progression XP. D-171 adds the data-owned six-stage main arc and eight side quests, semantic-event-only typed objectives, validated intent/delivery commands, bounded encounter-preparation consequences, shared quest XP, and a fail-closed append-only save-schema-v10 journal with paginated localization-ready queries. D-172 consumes quest state and the canonical journal through the hybrid UI. | implemented | M3.5 |
| Game UI stack | D-160 selects a measured hybrid over the worker-owned WebGPU canvas; D-161 implements the shared framework-free substrate with typed game presentations, keyed DOM/CSS HUD/dialog, fixed render-worker anchor/heavy-screen pools, worker-owned hit testing, recovery replay, a sparse semantic/IME bridge, and harness telemetry. D-172 adds the real inventory/crafting, progression/loadout, and quest/journal consumers while preserving simulation command/query authority. D-143 identified no page-visible cross-thread presentation synchronization/attribution primitive; RE-047 keeps that request open. | implemented | M3, M3.5 |
| Music & audio content | First QA-gated spatial SFX/ambience set in M4.5's playable route; district-scale content and weather/danger/district-adaptive score in M6 using existing semantic events (D-141/D-182) | active (planned) | M4.5 first set, M6 expansion |
| Animation content | One rigged NPC and enemy with QA-gated locomotion/idle/combat in M4.5; expand retargeted/AI-generated sets across required body types in M5 (D-141/D-182) | active (planned) | M4.5 first set, M5 expansion |
| Cinematics & scripted cameras | Undecided: cheap scripted-camera moments vs an explicit rule-out — resolve scope before M6 begins (D-141/D-182) | explored | Before M6 |
| Geometry representation & LOD | D-098 retains triangle LOD because challengers lacked eligible displacement evidence, not a proven triangle performance win. Representative M4.5/M5 art can justify a bounded reopening through unchanged representation-agnostic asset/streaming boundaries (D-182) | active | M1 decision, M4.5/M5 content |
| Conversational NPCs | App-owned on-device Gemma 4 E2B QAT-GGUF on wllama, WebGPU by default with an explicit CPU/WASM headroom mode (D-074/D-096). D-162 adds the ordinary lazy release-bound OPFS-`File` caller, strict finite intent/subject validation, game-owned persona/rolling-memory/fallback policy, dialog UI/input ownership, and padded frame-impact telemetry. D-033 now supplies the generic budgeted knowledge service, public retrieval telemetry, a bounded sim-worker state-query seam, an NPC-scoped structured-state/world-fact provider shared with authored fallback, and tagged dormant lore chunks; semantic lore retrieval and episodic memory remain build-later. | implemented (first authored NPC + structured knowledge tier) | M3 |
| Simulation & save | Deterministic fixed-timestep sim worker; input-command logs double as replay and harness regression formats. The game-owned `m35-gameplay-slice@1` log drives fight → loot → trade → craft → level → two multi-objective quest completions through the generic engine replay seam, with repeated hashes, byte-identical saves, live-worker load/re-save, and exact semantic-counter validation in every core smoke launch. | implemented | M3, M3.5 |
| Character & animation | Babylon animation and AI-generated rigged NPC/enemy in M4.5, then multiple body types in M5. Skin/SSS, eyes, hair/fur, cloth, muscle deformation and IK are selected by visible deficiencies, not an exhaustive prerequisite (D-182) | active baseline; advanced techniques deferred | M4.5, M5, research backlog |
| Physics | Scoped at M3: likely Havok WASM (Babylon-integrated) in/beside the sim worker; determinism requirement may force alternatives — see P-003 implications. M6 adds ragdoll/rope/buoyancy garnish (D-140); destructible environments are ruled out (D-140) | explored | M3, M6 |
| Spatial audio | A small surface/underground spatial sound demonstration and QA path in M4.5; expand worklet/HRTF/acoustic coverage in M6 (D-182); no implementation claimed yet | active (planned) | M4.5 first route, M6 expansion |
| VFX & weather | Dynamic daylight/night/storm scene with selected coherent fire illumination and lightning in M4.5. Grow shared wind/particle/volumetric facilities from those consumers; full fire, gas and magic families remain a triggered backlog, with selected content expansion in M6 (D-178 amended by D-182) | active scene; broader technology deferred | M4.5 scene, M6 expansion, research backlog |
| Photo mode | Cheap, high-value web flex: canvas capture, offline render-quality crank, shareable output | explored | M6 |
| P2P multiplayer | WebRTC data channels; **no game-simulation servers** (peers run the sim). Connection infrastructure is permitted per D-016: self-hosted signaling + STUN, TURN if connectivity data warrants | **designed — constraints below** | M7 |
| Input | Keyboard/mouse (Pointer Lock w/ `unadjustedMovement`, Keyboard Lock for Esc/system keys in fullscreen), Gamepad API incl. haptics, Fullscreen, Screen Wake Lock | active | M3 |
| Accessibility | Remap, subtitles for NPC dialog (free — dialog is text-native), UI scaling | explored | M6 |
| Benchmark mode | Public deterministic front end to canonical scenarios and telemetry without an opaque score. D-105 implements M1's browser-neutral advisory `benchmark-result@1`; privileged harness gates remain separate, and continuous-page versus fresh-profile lineage is explicit. D-115 qualifies the implementation/result contract from complete fail-honest physical exports while preserving their unchanged variance failures; another 30-plus-minute run is not an M1 gate. | implemented; physically exercised | M1+ |
| Live content hooks | Manifest-driven content drops using the update path (no code deploy) | explored | post-M6 |

Anything added to the game that doesn't fit a row: add a row with its playable or
research value. A conventional implementation is appropriate when it serves the scene.
The plan's triggered research backlog governs unselected advanced techniques; listing
one here does not require an experiment or implementation before M4.5/M5 can exit.

## Beyond AAA: features even native AAA titles don't usually ship

The matrix above covers matching AAA feature surfaces on the web. This section is the
offensive play: capabilities the web platform makes cheap that are rare-to-nonexistent
even in native AAA games. These are prime capabilities-demo material — each one should
produce either a showcase moment or a rough-edges finding (ideally both).

**Priority legend:** `committed` (on the plan) · `explore` (prototype when its milestone
area is active) · `stretch` (only if a cheap opportunity appears) · `parked`

| Feature | Web APIs | Why even AAA doesn't usually have it | Priority |
| --- | --- | --- | --- |
| Rich generative NPC dialog | App-owned on-device Gemma 4 model | Native-class local inference with a game-owned, hash-verified model and no server. Fully offline. (Anchor row — see matrix + M3.) | committed |
| Voice conversations with NPCs | Web Speech `SpeechRecognition` with `processLocally` (on-device, Chrome 139+) for input → app-owned dialog model → `speechSynthesis` TTS out | Speak to NPCs and they answer offline with no cloud round-trip. TTS voice variety is the known weak point; mitigation candidates are per-NPC pitch/rate styling. If expressive on-device TTS voices remain unavailable, that's a headline rough-edges finding. | committed (M3, behind dialog) |
| Infinite localization | Language Detector + Translator APIs over NPC dialog, quest text, and UI strings | Research target: determine which language pairs can be model-ready and work offline over generated dialog and authored UI. D-160 found only English→Spanish `downloadable`; it produced no translation output and establishes no offline, coverage, or cost claim. | explore (M3+; qualify before commitment) |
| "Previously on…" quest recaps | Summarizer API over the player's own event/quest log | Save-game recaps are rare and hand-authored in AAA; here they're generated from the actual play history on-device. | explore (M3+) |
| Built-in highlight capture | WebCodecs rolling replay buffer (encode in a worker) + Web Share / file save | ShadowPlay-style "clip the last 30 seconds" without any installed software; pairs with photo mode. Also exercises WebCodecs/WebGPU interop (finding-rich territory). | explore (M6) |
| Adaptive triggers & rich haptics | Gamepad API haptic actuators; WebHID for DualSense adaptive triggers/LEDs/touchpad | Most native PC games don't even drive DualSense adaptive triggers; a browser game doing it is a statement. WebHID device support doubles as accessibility hardware support. | explore (M6) |
| Self-tuning fidelity | Compute Pressure API + battery state | Games ship static quality presets; a web game can adapt to thermal/power pressure live. Research question: is the signal the web gets actually good enough? (rough-edges either way) | explore (unscheduled; new plan item required) |
| Companion surfaces | Window Management (map/inventory on a second monitor), Document Picture-in-Picture (minimap/dialog persists while alt-tabbed) | Multi-window companion UX is nearly nonexistent in native games because windowing is painful there; on the web it's the native idiom. | explore (M6) |
| Multi-camera views | Window Management + additional render targets: in-game cameras (deployable drones, security feeds, scenic vistas) rendered to separate OS windows/monitors | Simultaneous independent viewpoints are a luxury even in native titles; a drone feed living on your second monitor while you play on the first is a showcase moment. Platform research bonus: how does one WebGPU device best drive multiple windows (second canvas context vs. frame transport vs. captureStream)? — finding-rich either way. | explore (M6) |
| Install ergonomics | Background Fetch (install continues with the tab closed), PWA install + Badging/Notifications for world events | An installer that outlives the tab, and an app icon whose badge reflects the game world. Extends the completed M2 lifecycle work. | explore (unscheduled; new plan item required) |
| Web-native modding | File System Access API: user mounts a local mod directory as an overlay asset source (through QA-gate-shaped validation) | Modding on the web with no filesystem hacks — a sandboxed, permissioned mod folder. | explore (post-M6) |
| Scan-your-world UGC | Phone-scanned Gaussian splats (room/object captures) imported as in-game content — file picker / mod-folder overlay in, splat-validation gate, placed in the world | Bring your actual desk, dog statue, or living room into the game. Native AAA has no UGC path this cheap. D-098 did not ship a splat renderer: capture-origin content is a distinct future workload that must reopen the representation choice with its own dynamic-relighting, validation, storage, and performance evidence. | explore (post-M6, new decision required) |
| Proximity voice chat | `getUserMedia` + WebRTC audio, spatialized through the WebAudio graph | Ties into M7 multiplayer; browser-native voice with positional audio, no third-party overlay. | parked (M7) |
| Webcam body-lean / peek | `getUserMedia` + on-device pose estimation (WebGPU/WASM) mapped to camera lean or duck | Physical lean-to-peek without VR hardware. Judged likely not worth the cycles for the core game — strictly opt-in, strictly on-device, only as a demo vignette. | stretch |
| Biometric-reactive world | Web Bluetooth (heart-rate monitor) modulating audio/pacing/encounters | Genuinely novel and memorable in demos; niche hardware keeps it a vignette, not a system. | stretch |
| NPCs notice your absence | Idle Detection API (permissioned) → sim event | Cheap, charming, and web-idiomatic ("you were gone a while — the market closed"). | stretch |
| Room-aware presentation | Ambient Light Sensor driving exposure/atmosphere | The underground district getting scarier in a dark room. Sensor is behind a flag — acceptable for this project; finding either way. | stretch |
| VR pass | WebXR reusing the WebGPU renderer | One API away instead of a separate SKU — but a large rendering-budget commitment. | parked |

Rules of engagement for this list: each item, when picked up, gets a matrix row (with
status/milestone) or is dropped with a decision-log entry; nothing here may compromise
the offline single-player experience — on-device variants only, and **offline
single-player requires zero server infrastructure** (multiplayer is inherently
networked and may use the D-016-permitted connection infrastructure, nothing more); and
permission-gated hardware features (camera, mic, HID, Bluetooth, idle) are always opt-in
with in-fiction framing, never required to play.

## Design-now constraints: P2P multiplayer (build at M7)

The multiplayer bet is WebRTC data channels between browsers — no game-simulation
servers; connection infrastructure (self-hosted signaling, STUN, TURN if warranted) per
D-016. It is **not** implemented until M7, but the following are load-bearing
architectural requirements **now** (violations are M7 rewrites):

1. **Sim/render separation.** Gameplay simulation runs in its own worker at a fixed
   timestep; rendering interpolates snapshots. A remote peer must be able to drive the
   sim exactly as local input does.
2. **Input-command pattern.** All player intent enters the sim as serializable commands
   (timestamped, ordered). No gameplay code mutates sim state directly from UI/input
   handlers.
3. **Determinism-friendly sim.** Same command log ⇒ same state hash — required through
   repeated same-host replay on pinned dev-01 from M3 (D-150). Cross-machine Windows /
   macOS comparison remains an aspirational, advisory design objective for future P2P;
   it can produce findings but cannot block a milestone. No `Math.random()` without a
   seeded RNG owned by the sim; no wall-clock
   reads inside the sim step; no iteration-order-dependent logic over unordered
   collections; no wasm paths sensitive to NaN bit patterns. The harness checks this
   from M3 (it's also what makes replays a regression tool).
4. **Stable entity identity.** Every entity has a persistent, serializable ID assigned
   deterministically — never object references or array indices as identity.
5. **Snapshot + delta serializability.** Sim state must serialize to a compact binary
   snapshot with delta encoding in mind (this also serves save games — one format, two
   uses).
6. **Interest management hooks.** The streaming system's spatial cell structure doubles
   as the interest-management partition later; don't design cell logic that assumes a
   single observer.

Topology (P2P mesh vs. host-authoritative peer), rollback vs. lockstep, and scale are
deliberately **not** decided — see decision P-003. The constraints above keep every
option open.

## Design-now constraints: N districts

District count/topology is data. No system may hard-code district identity; transitions
are described by the world graph, not by code paths.

## Design-now constraints: adaptive audio event hooks (build at M6)

The adaptive music system (M6) reacts to gameplay state; retrofitting events into a
finished sim is a rewrite. Binding from M3 (D-141): the sim worker's event stream is a
first-class, serializable, observable output — combat state changes, danger/aggro
transitions, district/weather/time-of-day transitions, quest beats — consumable by any
listener without reaching into sim internals. The replay log already requires most of
this; audio adds only the requirement that events are *semantic* (named transitions,
not frame diffs) and stable across save-schema versions. The quest/journal system
(M3.5) and Summarizer recaps consume the same stream.
