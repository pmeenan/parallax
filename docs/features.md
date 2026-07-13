# Feature matrix

The project's ambition is to exercise **every major feature surface of a AAA title**, each
in a way that is novel and web-idiomatic — not a downported approximation. This document
tracks that coverage and holds the design constraints of build-later features that
today's code must respect.

**Status legend:** `active` (being built per plan.md) · `designed` (constraints locked,
build later) · `explored` (idea logged, no constraints yet)

## Matrix

| Feature area | Web-novel angle | Status | Milestone |
| --- | --- | --- | --- |
| Open-world streaming | OPFS sync-access reads in workers feeding GPU under a hard memory budget; hard district swaps | active | M1, M4 |
| Install/update lifecycle | Multi-GB browser-native installer; asset-only updates that never invalidate code caches; full offline; clean confirmed uninstall with measured full-removal (D-024) | active | M2 |
| High-fidelity rendering | WebGPU-only pipeline, WGSL compute (culling/terrain/VFX), zero runtime PSO compiles via trace-driven warmup | active | M1, M5 |
| Geometry representation & LOD | Open exploration (P-002): classic triangle LOD chains vs. meshlet-based virtualized geometry (nanite-like, GPU-driven culling in WGSL compute) vs. 3D Gaussian splats — likely a hybrid (e.g., splat environments/backdrops + triangle interactives). Splat rendering is compute-native and unusually web-friendly; virtualized geometry stress-tests WebGPU compute limits (finding-rich either way) | active | M1 spike, M5 commit |
| Conversational NPCs | On-device LLM (Prompt API/Gemini Nano) — no server, works offline, downloaded at install. App-owned in-browser model (WebGPU inference in a worker, optionally persona-tuned) is an open challenger: P-007. Prompt context assembled by the engine/ai knowledge service (D-033), structured game-state tier first. Aspiration (game-design.md): NPCs shouldn't be blindingly distinguishable from real players | active | M0 spike (P-007 A), M3 |
| Simulation & save | Deterministic fixed-timestep sim worker; input-command log doubles as replay + harness regression format | active | M3 |
| Character & animation | Babylon animation system + AI-generated rigged characters from the assets pipeline | active | M3, M5 |
| Physics | Scoped at M3: likely Havok WASM (Babylon-integrated) in/beside the sim worker; determinism requirement may force alternatives — see P-003 implications | explored | M3 |
| Spatial audio | WebAudio worklets, HRTF panning, underground/surface acoustic contrast as a showcase | designed | M6 |
| VFX & weather | Full weather system is core creative direction (game-design.md): sun→overcast→storms, lightning, day/night, fire/area lighting; GPU-compute particles. Dynamic-lighting consequence binds the renderer from M1 (architecture.md) | designed (renderer constraint active from M1; full system M6) | M1 constraint, M6 build |
| Photo mode | Cheap, high-value web flex: canvas capture, offline render-quality crank, shareable output | explored | M6 |
| P2P multiplayer | WebRTC data channels; **no game-simulation servers** (peers run the sim). Connection infrastructure is permitted per D-016: self-hosted signaling + STUN, TURN if connectivity data warrants | **designed — constraints below** | M7 |
| Input | Keyboard/mouse (Pointer Lock w/ `unadjustedMovement`, Keyboard Lock for Esc/system keys in fullscreen), Gamepad API incl. haptics, Fullscreen, Screen Wake Lock | active | M3 |
| Accessibility | Remap, subtitles for NPC dialog (free — dialog is text-native), UI scaling | explored | M6 |
| Benchmark mode | Public, deterministic front end to the harness scenarios and telemetry; comparable browser-engine/hardware reports without a single opaque score (D-025) | active | M1+ |
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
| Rich generative NPC dialog | Prompt API (on-device Gemini Nano) | Native games need a shipped model or a server; Chrome ships the model with the browser. Fully offline. (Anchor row — see matrix + M3.) | committed |
| Voice conversations with NPCs | Web Speech `SpeechRecognition` with `processLocally` (on-device, Chrome 139+) for input → Prompt API → `speechSynthesis` TTS out | Speak to NPCs and they answer, offline, no cloud round-trip. TTS voice variety is the known weak point: mitigation candidates are per-NPC pitch/rate styling, and Prompt API audio-input as an alternate STT path. If expressive on-device TTS voices remain unavailable, that's a headline rough-edges finding. | committed (M3, behind dialog) |
| Infinite localization | Language Detector + Translator APIs over NPC dialog, quest text, and UI strings | AAA localization costs millions and ships a fixed language list. Generative dialog + on-device translation = every language, offline, at zero marginal cost. Pairs with subtitles (already free — dialog is text-native). | committed (M3+) |
| "Previously on…" quest recaps | Summarizer API over the player's own event/quest log | Save-game recaps are rare and hand-authored in AAA; here they're generated from the actual play history on-device. | explore (M3+) |
| Built-in highlight capture | WebCodecs rolling replay buffer (encode in a worker) + Web Share / file save | ShadowPlay-style "clip the last 30 seconds" without any installed software; pairs with photo mode. Also exercises WebCodecs/WebGPU interop (finding-rich territory). | explore (M6) |
| Adaptive triggers & rich haptics | Gamepad API haptic actuators; WebHID for DualSense adaptive triggers/LEDs/touchpad | Most native PC games don't even drive DualSense adaptive triggers; a browser game doing it is a statement. WebHID device support doubles as accessibility hardware support. | explore (M6) |
| Self-tuning fidelity | Compute Pressure API + battery state | Games ship static quality presets; a web game can adapt to thermal/power pressure live. Research question: is the signal the web gets actually good enough? (rough-edges either way) | explore (M2+; telemetry first) |
| Companion surfaces | Window Management (map/inventory on a second monitor), Document Picture-in-Picture (minimap/dialog persists while alt-tabbed) | Multi-window companion UX is nearly nonexistent in native games because windowing is painful there; on the web it's the native idiom. | explore (M6) |
| Multi-camera views | Window Management + additional render targets: in-game cameras (deployable drones, security feeds, scenic vistas) rendered to separate OS windows/monitors | Simultaneous independent viewpoints are a luxury even in native titles; a drone feed living on your second monitor while you play on the first is a showcase moment. Platform research bonus: how does one WebGPU device best drive multiple windows (second canvas context vs. frame transport vs. captureStream)? — finding-rich either way. | explore (M6) |
| Install ergonomics | Background Fetch (install continues with the tab closed), PWA install + Badging/Notifications for world events | An installer that outlives the tab, and an app icon whose badge reflects the game world. Extends the M2 lifecycle work. | explore (M2) |
| Web-native modding | File System Access API: user mounts a local mod directory as an overlay asset source (through QA-gate-shaped validation) | Modding on the web with no filesystem hacks — a sandboxed, permissioned mod folder. | explore (post-M6) |
| Scan-your-world UGC | Phone-scanned Gaussian splats (room/object captures) imported as in-game content — file picker / mod-folder overlay in, splat-validation gate, placed in the world | Bring your actual desk, dog statue, or living room into the game. Native AAA has no UGC path this cheap; splat capture apps on phones + a compute-native splat renderer make it a file-import problem. Depends on the splat branch of P-002 landing. | explore (post-M6, gated on P-002) |
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
3. **Determinism-friendly sim.** Same command log ⇒ same state hash — **cross-machine,
   within a pinned Chrome version** (D-016): verified across Windows and macOS hosts
   from M3, since single-host determinism says nothing about cross-peer lockstep
   suitability. No `Math.random()` without a seeded RNG owned by the sim; no wall-clock
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
