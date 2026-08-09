# Feature matrix

The project's ambition is to exercise **every major feature surface of a AAA title**, each
in a way that is novel and web-idiomatic — not a downported approximation. This document
tracks that coverage and holds the design constraints of build-later features that
today's code must respect.

**Status legend:** `active` (on the committed mainline plan — see its Milestone column;
not necessarily in progress yet, plan.md tracks that) · `designed` (constraints locked,
build later) · `implemented` (the planned implementation and result contract are
complete; any explicit physical-qualification limits still apply) · `explored` (idea
logged, no constraints yet)

## Matrix

| Feature area | Web-novel angle | Status | Milestone |
| --- | --- | --- | --- |
| Open-world streaming | OPFS sync-access reads in workers feeding GPU under a hard memory budget; D-112 makes the authoritative cohort, residency, storage, latency-stage, queue, and eviction telemetry visible in-game; D-115 defers no-visible-pop visual diff to M5 representative art; hard district swaps | active | M1, M4, M5 visual gate |
| Install/update lifecycle | Multi-GB browser-native installer; D-144 qualifies the asset-only-update warm-launch outcome under the fixed budget while retaining cache attribution as best-effort evidence (D-051); full offline; clean confirmed uninstall with measured full-removal (D-024) | implemented | M2 complete (D-153) |
| High-fidelity rendering | WebGPU-only pipeline, WGSL compute (culling/terrain/VFX), zero runtime PSO compiles via trace-driven warmup | active | M1, M4.5, M5 |
| Lighting, GI & atmosphere | Fully dynamic time-of-day/weather lighting with no ray-tracing extension available — technique selection under that constraint, fire/torch many-light nights, volumetric sky/clouds/fog; the gap analysis is itself a deliverable (D-140) | active | M4.5 |
| Terrain & procedural materials | Instruction-set terrain and generated materials: placements/features authored and deterministic, geometry/textures generated at install or runtime — trading install bytes for compute (M2 research tie-in, D-140) | active | M4.5 |
| Water, vegetation & wind | District-scale vegetation instancing, one shared wind signal driving grass/trees/cloth/smoke/rain, water rendering vs. simulation costed separately (D-140) | active | M4.5 |
| Image pipeline | Hand-built TAA/temporal upscaler (no DLSS/FSR equivalent on the web), HDR canvas output, full post stack (D-140) | active | M4.5 |
| GPU-driven rendering & texture residency | Compute occlusion culling and indirect draws without mesh shaders/bindless; virtual texturing beside the geometry streaming system (D-140) | active | M4.5 |
| NPC navigation & crowds | Navmesh over streamed procedural cells plus village-scale crowd movement under the sim determinism constraints (D-140) | active | M3 |
| Combat, progression & crafting | Full mechanics stack inside the deterministic sim worker — replays double as gameplay regression tests; original slice-scale ruleset, no D&D-protected material (D-141) | active | M3.5 |
| Quests & journal | Quest state as versioned save-schema sim state; the journal is a queryable play-history log feeding Summarizer recaps and localization (D-141) | active | M3.5 |
| Game UI stack | D-160 selects a measured hybrid over the worker-owned WebGPU canvas; D-161 implements the shared framework-free substrate with typed game presentations, keyed DOM/CSS HUD/dialog, fixed render-worker anchor/heavy-screen pools, worker-owned hit testing, recovery replay, a sparse semantic/IME bridge, and harness telemetry. D-143 identified no page-visible cross-thread presentation synchronization/attribution primitive; RE-047 keeps that request open. | implemented (substrate; real screens consume it next) | M3 |
| Music & audio content | Weather/danger/district-adaptive score plus AI-generated music/SFX pipeline; the sim event hooks it consumes are a design-now constraint on M3 — see constraints section below (D-141) | active (hooks designed M3) | M6 |
| Animation content | Retargeted and/or AI-generated locomotion/combat/schedule animation sets across all races/monster body types, QA-gated (D-141) | active | M5 |
| Cinematics & scripted cameras | Undecided: cheap scripted-camera moments vs an explicit rule-out — needs a decision before M6 rather than staying an implicit omission (D-141) | explored | M6 |
| Geometry representation & LOD | D-098 retains classic triangle LOD for the current D1 path because neither bounded challenger supplied fully eligible displacement evidence; this was not a valid triangle-performance win. Representation-agnostic streaming/asset boundaries preserve a future full virtual-geometry, relightable-splat, higher-density-art, or capture-UGC reopening without shipping the closed spike's apparatus. | active | M1 decision, M5 content |
| Conversational NPCs | App-owned on-device Gemma 4 E2B QAT-GGUF on wllama, WebGPU by default with an explicit CPU/WASM headroom mode (D-074/D-096). D-162 adds the ordinary lazy release-bound OPFS-`File` caller, strict finite intent/subject validation, game-owned persona/rolling-memory/fallback policy, dialog UI/input ownership, and padded frame-impact telemetry. D-033's generic knowledge service remains next; the current prompt already reserves its retrieved-context slot. | implemented (first authored NPC; knowledge service next) | M3 |
| Simulation & save | Deterministic fixed-timestep sim worker; input-command log doubles as replay + harness regression format | active | M3 |
| Character & animation | Babylon animation system + AI-generated rigged characters from the assets pipeline; M5 adds explore-and-decide character-surface/dynamics tracks (skin/SSS, eyes, hair/fur, cloth, muscle deformation, IK) at the "NPC ≈ player" visual bar (D-140) | active | M3, M5 |
| Physics | Scoped at M3: likely Havok WASM (Babylon-integrated) in/beside the sim worker; determinism requirement may force alternatives — see P-003 implications. M6 adds ragdoll/rope/buoyancy garnish (D-140); destructible environments are ruled out (D-140) | explored | M3, M6 |
| Spatial audio | WebAudio worklets, HRTF panning, underground/surface acoustic contrast as a showcase | explored (direction sketched; no binding constraints recorded yet — promote to `designed` only with a constraints section like Multiplayer's) | M6 |
| VFX & weather | Full weather system is core creative direction (game-design.md): sun→overcast→storms, lightning, day/night, fire/area lighting; GPU-compute particles. Dynamic-lighting consequence binds the renderer from M1 (architecture.md); fire/torch lighting lands with the M4.5 lighting track and the shared particle/volumetrics substrate at M6 (D-140) | designed (renderer constraint active from M1; full system M6) | M1 constraint, M4.5 lighting, M6 build |
| Photo mode | Cheap, high-value web flex: canvas capture, offline render-quality crank, shareable output | explored | M6 |
| P2P multiplayer | WebRTC data channels; **no game-simulation servers** (peers run the sim). Connection infrastructure is permitted per D-016: self-hosted signaling + STUN, TURN if connectivity data warrants | **designed — constraints below** | M7 |
| Input | Keyboard/mouse (Pointer Lock w/ `unadjustedMovement`, Keyboard Lock for Esc/system keys in fullscreen), Gamepad API incl. haptics, Fullscreen, Screen Wake Lock | active | M3 |
| Accessibility | Remap, subtitles for NPC dialog (free — dialog is text-native), UI scaling | explored | M6 |
| Benchmark mode | Public deterministic front end to canonical scenarios and telemetry without an opaque score. D-105 implements M1's browser-neutral advisory `benchmark-result@1`; privileged harness gates remain separate, and continuous-page versus fresh-profile lineage is explicit. D-115 qualifies the implementation/result contract from complete fail-honest physical exports while preserving their unchanged variance failures; another 30-plus-minute run is not an M1 gate. | implemented; physically exercised | M1+ |
| Live content hooks | Manifest-driven content drops using the update path (no code deploy) | explored | post-M6 |

Anything added to the game that doesn't fit a row: add a row, including its web-novel
angle. A feature with no novel angle should prompt the question of why we're building it.

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
