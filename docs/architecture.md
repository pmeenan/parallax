# Architecture

High-level system design. Detailed per-system designs live next to the code they
describe; this document is the map. Keep it current — it is required reading for every
agent.

## Layer model

```
┌───────────────────────────────────────────────────────────────┐
│ game/      World definition, gameplay, NPCs, quests, UI logic │  ← no platform APIs
├───────────────────────────────────────────────────────────────┤
│ engine/    Scene & render orchestration (Babylon.js WebGPU),  │
│            streaming, storage, worker fabric, WASM modules,   │
│            audio, input, save, AI-inference services          │  ← all platform APIs
├───────────────────────────────────────────────────────────────┤
│ platform   Chrome ≥ latest stable: WebGPU, wasm64 modules,    │
│            OPFS, Cache Storage, SAB + workers, OffscreenCanvas,│
│            Prompt API (Gemini Nano), WebRTC (future), WebAudio │
└───────────────────────────────────────────────────────────────┘
```

Rules: `game/` imports from `engine/` only. `engine/` never imports from `game/`.
Anything touching a `navigator.*`, `WebAssembly.*`, GPU, storage, or worker API lives in
`engine/`. This boundary is what makes platform findings attributable.

Above both sits **`app/`** (D-012): the shell/entry point that owns the install, update,
and launch UX and boots the engine + game. It imports `engine/` services and game
manifest/branding data, never `game/` sim internals, and contains no gameplay logic.

## Deployment (D-011)

Production origin: **https://parallax-web.com** on user-controlled nginx (additional
owned domains available for cross-origin work, e.g., the M8 COS exercise). Development
is fully local against a real local server — never `file://` — with the same header
discipline as production (COOP/COEP for SAB, immutable caching, correct 304s; localhost
is a secure context, so no local TLS needed). Serving config is versioned in the repo.
Static/client-side strongly preferred; server-side capability exists but each use gets a
decision-log entry. Cloudflare stays out of the path for cache experiments — an
intermediary cache would contaminate 304/code-cache findings.

## Worker topology

On the web, multithreading is an architecture we design, not an engine feature we
inherit. Planned topology (revise here as it evolves; requires COOP/COEP for SAB):

```
main thread        UI shell, input capture, orchestration only. Never blocks.
render worker      Babylon.js scene + WebGPU device on OffscreenCanvas.
streaming worker   Owns OPFS handles; schedules loads/evictions against the
                   memory budget; feeds decode pool.
decode pool (N)    Texture transcode (KTX2/BasisU), mesh decompress (meshopt),
                   Rust/WASM hot paths. Sized to hardwareConcurrency.
sim worker         Fixed-timestep gameplay simulation. Deliberately isolated so a
                   future multiplayer peer can drive it from network input
                   (see features.md → Multiplayer).
ai worker          Prompt API sessions for NPC dialog; decoupled from frame loop.
```

Communication: SharedArrayBuffer ring buffers for high-rate data (streaming queues,
sim→render state snapshots); `postMessage` with transferables for bulk handoffs;
no structured-clone of large objects on hot paths. Every queue instrumented
(depth, stall counts) for the harness.

Open question (M0/M1 to verify): WebGPU-in-worker + OffscreenCanvas maturity in current
Chrome, and whether Babylon.js runs fully inside a worker without main-thread escapes.
Findings go to [rough-edges.md](rough-edges.md).

## Storage map

| Data | Location | Why |
| --- | --- | --- |
| Game assets (meshes, textures, audio, world data) | OPFS | Multi-GB, random-access reads via sync access handles in workers |
| App shell (HTML/JS/WASM binaries) | HTTP cache, immutable URLs, 304-friendly | Preserves V8 code cache (keyed to URL + response state) |
| PSO/shader warmup trace data | OPFS, versioned with the asset build | Drives progressive pipeline warmup at boot |
| Save games / settings | OPFS (`saves/`), versioned schema | Survives cache eviction pressure better than other stores |
| Gemini Nano model | Chrome-managed (Prompt API download) | Triggered during install; not in our quota |

Asset placement is benchmark-driven: if the harness shows a class of data loads better
from Cache Storage than OPFS, move it and record the numbers in the decision log.

## Install / launch / run lifecycle

1. **Install (first visit, user-initiated):** persist-storage permission → manifest fetch
   → parallel asset pull into OPFS with resume support → Prompt API model availability +
   download → PSO warmup pass (see below) → integrity verification. UX: a real installer
   progress screen, not a spinner.
2. **Launch (every boot):** integrity/version check against manifest → progressive PSO
   warmup from trace → resident-set preload for the player's saved location → gameplay.
   Launch 2+ must hit the V8 code cache (wasm via `instantiateStreaming`, stable URLs)
   and Dawn's pipeline cache. The harness measures cold vs. warm launch on every build.
3. **Run:** streaming manager keeps the resident set inside the memory budget as the
   player moves; eviction is proactive, never emergency.
4. **Update:** manifest diff → fetch changed assets only → invalidate affected warmup
   traces. Design goal: an asset-only update never invalidates the wasm/JS code caches.

## World structure and streaming

The world is partitioned into **districts** (D1 surface, D2 underground; architecture
assumes N). Districts subdivide into **cells** (streaming granularity within a district).
Two streaming regimes, both budget-governed:

- **Intra-district:** distance/visibility-driven cell load/evict with LOD tiers.
- **Inter-district (hard transition):** full resident-set swap through choke points —
  the catacomb entrances (game-design.md), of which there are several with different
  surface contexts; the transition system handles N entrances as data, not one bespoke
  passage. Contract lives in [budgets.md](budgets.md): prefetch trigger, memory
  high-water during overlap, max hitch — applied per entrance. This is deliberately the
  hardest case and is exercised early with greybox content (M4) because it shapes asset
  packaging and the streaming manager's design.

Asset packaging: per-cell bundles, content-addressed, with shared kits/materials
deduplicated across cells. Formats: glTF/GLB, KTX2 (BasisU) textures, meshopt
compression. (Decision D-006.)

**Common vs. game-specific split (D-010):** every packaged resource is classified as
*common* (engine code, shared asset packs/kits, models — shareable across published
games) or *game-specific* (world data, game logic, unique assets), in separate bundles
addressed separately by the manifest. When Cross-Origin Storage ships, the common set
moves to a hash-based COS index without repackaging; until then the split costs nothing
and keeps the packaging honest.

## Rendering

Babylon.js WebGPU backend, treated as a scene/material/animation library — Parallax owns
scheduling, streaming, and memory. Custom passes (culling, terrain, VFX) are WGSL compute
integrated through Babylon's API where possible; where Babylon blocks a needed WebGPU
feature, we fork locally or bypass — and log the gap. Material policy: aggressively
minimize pipeline permutations (uber-shader mindset) to keep Dawn's cache warm; the
harness tracks pipeline-count and compile-stall metrics per build.

**Dynamic lighting is a day-one requirement**, not an optimization decision: the game's
full day/night cycle and weather system (game-design.md) rule out fully-baked lighting.
The renderer is designed around dynamic time-of-day from the M1 greybox onward, and
harness runs sweep lighting/weather states, not just geography.

**Geometry representation is an open exploration (P-002), not a settled choice.** Three
candidates — classic triangle LOD chains, meshlet-based virtualized geometry
(nanite-like, GPU-driven), and 3D Gaussian splats — will be compared on real budgets in
M1, with a likely hybrid outcome (splats for dense static environments, triangles for
anything animated, interactive, or collidable). Streaming, asset packaging, and the QA
gate must therefore stay representation-agnostic: cells may carry payloads of more than
one geometry type, and "mesh" assumptions don't belong in interfaces above the renderer.

## Simulation

Fixed-timestep sim in its own worker, decoupled from render rate; render interpolates
snapshots. State is stored in typed, serializable structures (SAB-friendly), entities
have stable IDs, and player actions flow as explicit input-commands into the sim — not as
direct state mutation. These properties are cheap now and are hard prerequisites for
save/load, replay-driven harness tests, and the future multiplayer model.

## NPC AI

Chrome's built-in Prompt API (on-device Gemini Nano) via the `ai worker`. Persona cards +
rolling summarized memory per NPC; structured-output (JSON schema) for anything that
touches game state, freeform text only for flavor dialog. Inference contends with
rendering for on-device resources — the harness measures frame impact during generation
(likely a rough-edge finding in itself). Model download is an install-phase step.

## Forward-design constraints (build later, respect now)

- **P2P multiplayer (WebRTC data channels):** sim/render separation, input-command
  pattern, stable entity IDs, and a serializable authoritative state are required today.
  See [features.md](features.md) for the full constraint list.
- **N districts:** no code may assume exactly one or two districts; district IDs are data.
- **wasm64:** Rust modules should isolate memory-size assumptions so individual modules
  can move to memory64 when >4 GB address space pays for the pointer-width cost.
- **Cross-Origin Storage readiness (D-010):** the common/game-specific packaging split
  above, plus deterministic, versioned engine builds (byte-identical from same source +
  toolchain; no timestamps/paths in artifacts; stable chunking) so engine bundles are
  hash-shareable across origins. The engine/game layer boundary is also a build and
  packaging boundary: engine artifacts must be buildable, versionable, and loadable
  independent of any game code.
