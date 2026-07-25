# Architecture

High-level system design. Detailed per-system designs live next to the code they
describe; this document is the map. Keep it current — any agent building or changing a
system that touches another system reads it first (root doc map, D-023).

## Layer model

```
┌───────────────────────────────────────────────────────────────┐
│ game/      World definition, gameplay, NPCs, quests, UI logic │  ← no platform APIs
├───────────────────────────────────────────────────────────────┤
│ engine/    Scene & render orchestration (Babylon Lite WebGPU),│
│            streaming, storage, worker fabric, WASM modules,   │
│            audio, input, save, AI-inference services          │  ← all platform APIs
├───────────────────────────────────────────────────────────────┤
│ platform   Chrome ≥ latest stable: WebGPU, optional memory64, │
│            OPFS, Cache Storage, SAB + workers, OffscreenCanvas,│
│            app-owned WebGPU/WASM AI, WebRTC (future), WebAudio │
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
render worker      Babylon Lite scene + WebGPU device on OffscreenCanvas.
AI workers         D-096 wllama/llama.cpp execution + OPFS model cache; wllama creates
                   its own inference worker/pthreads and, for the default D-074 path,
                   a separate WebGPU device.
streaming worker   Owns OPFS handles; schedules nearest-observer loads and proactive
                   evictions against the memory budget; feeds the fixed decode pool.
decode pool (N)    M1 v1 validates/decodes cell packages; later texture transcode
                   (KTX2/BasisU), mesh decompress (meshopt), Rust/WASM hot paths.
                   Sized once at boot to min(4, max(1, hardwareConcurrency - 2)).
sim worker         Fixed-timestep gameplay simulation. Deliberately isolated so a
                   future multiplayer peer can drive it from network input
                   (see features.md → Multiplayer).
```

D-096 selects D-074's app-owned backend. It keeps heavy inference off the main thread,
but wllama's small
controller is window-owned because the library resolves resources through
`document.baseURI`; it then creates the llama.cpp inference worker, OPFS worker, and
pthread pool. The measured placements are all-layer WebGPU offload on an independently
created logical device and CPU/WASM with `n_gpu_layers: 0`. D-073's Transformers.js/
ONNX no-go remains in the decision log, findings, and retained results; D-095 removed
its runtime, worker, dependency chain, and tests. “Same physical GPU” is not
shared-device scheduling: a true shared-device branch requires render-worker
colocation and an explicit render-to-inference-engine device handoff, and remains a
measured future variable rather than an assumed capability.

D-084 rejects restart-persistent KV snapshots for the pinned Gemma 4 E2B runtime after
restore recovered just 409 of 914-916 exact reusable tokens. The experiment's store,
runtime patch, and harness were removed after measurement; production has no persistent
KV dependency. The preferred follow-up is a clean live context pre-seeded with static
world knowledge, tools, and the next persona while the model is idle, then consumed by
the next conversation and rebuilt after launch or invalidation. That scheduler remains
measurement-gated and model-specific; this Gemma result does not pre-judge separately
evaluated candidates. Player-derived context remains governed by the save-data
privacy/lifecycle rules.

Communication: SharedArrayBuffer ring buffers for high-rate data (streaming queues,
sim→render state snapshots); `postMessage` with transferables for bulk handoffs;
no structured-clone of large objects on hot paths. Every queue instrumented
(depth, stall counts) for the harness. D-057 makes the base transport a pair of
fixed-capacity SPSC rings, one owner per endpoint and direction; setup/control summaries
stay on `postMessage`, while fixed-width hot records stay in SAB. The M0 implementation
exercises two 256-record x 4-word rings (8,224 bytes total) against the live render
worker and exposes correctness, cooperative round-trip rate, waits/stalls, window pump
duration, and concurrent render-callback diagnostics. The rate includes the bounded
window pump's scheduling cadence and is not raw SAB bandwidth. That pool is fixed at
boot; later channels size their own fixed pools from measured workload requirements
rather than inheriting the spike's test capacity.

The first Rust/WASM threads proof (D-085) is a separate bounded two-worker pool, not the
production decode pool. Both dedicated workers instantiate one content-addressed
Rust-authored module over a fixed 33-page shared linear memory, synchronize through
wasm atomics, and execute an explicit SIMD kernel. It starts after the SAB transport
proof and terminates before OPFS and the gameplay measurement window. Telemetry retains
load/compile, worker-init and parallel-execution timings, exact per-worker participation,
checksum/correctness, module bytes, and the fixed memory allocation. M1 sizes and
assigns production decode workers from representative decode measurements rather than
inheriting two workers or this synthetic task count. D-088 additionally retains
per-worker script-evaluated, initialization-received, instantiated, and ready phase
markers in timeout diagnostics after Chrome 151 exposed intermittent unbounded
instantiation; the timeout and correctness gate remain fail-closed.

The P-001 memory64 proof is a separate on-demand worker and versioned harness scenario,
not an ordinary launch phase. Paired Binaryen-built modules use the same 64 MiB working set,
eight-fill prepare, and sixteen-scan functions, changing their linear-memory addresses from
i32 to i64. Compile/instantiate batches run in short-lived nested copies of the same
content-addressed worker so their allocation garbage is destroyed before the outer worker's
prepare/kernel phase. Only the memory64 module also owns a proof export that reserves 65,537 pages and
touches a single sentinel at byte address `0x1_0000_0000`; after the Wasm load returns it,
the worker independently reads that exact exported-memory offset through a JavaScript
`DataView`. This isolates pointer width for the prepare/kernel phases, avoids committing a
multi-gigabyte fixture, and keeps the large logical reservation out of `smoke@1`;
module-size and compile/instantiate ratios include the proof export and are reported only
as end-to-end apparatus observations. Per-ordinal memory64/memory32 ratios are aggregated
before the repeat-variance gate; absolute-arm p95s retain separate diagnostic variance states.
The dedicated app mode suppresses unrelated synthetic spikes during this scenario, while
rendering remains live and D-034 surface/display checks remain mandatory. The WAT pair is
measurement apparatus; production
engine modules remain Rust-authored and memory32 by default. D-086's six-run registered
physical-console gate qualified this path in pinned Chrome 150, including the exact
`0x1_0000_0000` access; it did not adopt wasm64 for a production module.

The M0 worker spike is a go (D-056), and D-078's same-boundary head-to-head selected
Babylon Lite: the controlled walking-skeleton run keeps scene
construction, WebGPU device ownership, animation, and render submission in the dedicated
render worker. The window retains only explicit orchestration — worker/canvas setup,
device-pixel resize forwarding, batched telemetry reception, and shell UI. This is the
verified rendering-core boundary, not a blanket claim that DOM-bound engine features are
worker-safe; new input, GUI, accessibility, and loader paths must cross explicit protocols
or be re-verified when they land.

The long-lived streaming worker owns production OPFS handles and queue telemetry. It
retains the nearest nine D1 cells across all observers, evicts farthest non-target
residents before replacement loads, and sends decoded cells over a dedicated
`MessageChannel` to the render worker. The v1 procedural-cell decoder is a fixed
hardware-sized nested worker pool; every measured movement-triggered path reports attributable
OPFS read, decode, upload, total latency, encoded/GPU bytes, queue high water, and
residency/eviction counters. Districts own separate hashed OPFS subdirectories, so
content-address garbage collection is scoped to one district and remains compatible with
the N>2 streaming design constraint. Load samples carry monotonic sequence numbers so the harness
can derive a measurement-window suffix correctly even after the retained 256-sample ring
wraps. A pre-M2 provisioning bridge verifies HTTP packages before
placing content-addressed files in OPFS; the installer will assume that responsibility
before launch-2+ becomes a product gate. Streamed LOD0 meshes are created on the GPU but
remain hidden until the scripted flythrough transfers visible ownership from D-090's
qualified whole-world preview (D-091).
D-096 removed D-066's superseded standalone OPFS microbenchmark and storage worker
after D-091's representative OPFS-to-renderable cell-load evidence became the outcome
gate. The historical sandbox-sensitive repeatability result remains RE-023.

## Storage map

| Data | Location | Why |
| --- | --- | --- |
| Game assets (meshes, textures, audio, world data) | OPFS | Multi-GB, random-access reads via sync access handles in workers |
| App shell (HTML/JS/WASM binaries) | HTTP cache (immutable URLs, 304-friendly) **plus service-worker precache** | HTTP cache preserves the V8 code cache; the service worker guarantees offline navigation (HTTP cache alone doesn't — see below) |
| PSO/shader warmup trace data | OPFS, versioned with the asset build | Drives progressive pipeline warmup at boot |
| Save games / settings | OPFS (`saves/`), versioned schema | Worker sync-handle access; **protection comes from origin persistence + explicit export, not from OPFS itself** — all origin storage shares one quota/eviction policy. Storage Buckets as a saves/assets separation is open (P-006) |
| App-owned NPC model | OPFS, hash-addressed GGUF shards | A normal verified install artifact under the same resume/update/uninstall contract as game content (D-074/D-096) |

**Quota reality (checked 2026-07-11, web.dev/articles/storage-for-the-web + MDN):** a
Chromium origin may use up to ~60% of **total** disk size (not free space), and
`navigator.storage.estimate()` can report quota exceeding actually-writable free space.
The installer treats space checks as **best-effort preflight** (estimate + a small
probe — no probe can prove 100 GB of writable space without writing it) and relies on
`QuotaExceededError`-aware incremental writes with resume for the real guarantee;
quota errors and `persist()` denial are designed flows, not errors.

### Offline shell: service worker

The install/launch promise requires offline navigation, which the HTTP cache does not
guarantee. A **service worker** owns the app shell offline story:

- Precaches the shell (HTML/JS/WASM bootstrap) at install; serves navigations
  cache-first once installed.
- **Atomic activation:** a new shell version activates all-or-nothing, with rollback to
  the previous known-good version on failure; shell, engine bundle, asset manifest, and
  save-schema versions are checked for compatibility at boot.
- **COOP/COEP preservation:** cached navigation responses must carry the isolation
  headers or SAB dies offline — verified by an explicit harness check.
- Interplay between SW-served responses and the V8 code cache is a pre-seeded
  rough-edges question — measure it, don't assume it.

Asset placement is benchmark-driven: if the harness shows a class of data loads better
from Cache Storage than OPFS, move it and record the numbers in the decision log.

## Install / launch / run lifecycle

1. **Install (first visit, user-initiated):** the install-button click handler
   requests persist-storage (denial is a handled
   flow with degraded-durability warning) → best-effort space preflight (estimate +
   small probe; see quota reality above — the real protection is
   `QuotaExceededError`-aware incremental writing throughout) → manifest fetch →
   parallel asset and model-shard pull into OPFS with resume support → PSO warmup pass
   (see below) → integrity verification. UX: a real installer progress screen, not a
   spinner.

   **Trust and crash-safety contract:** the manifest is served over TLS from the origin
   and pins SHA-256 content hashes for every bundle (the same content addressing COS
   wants); every fetched byte is verified against its hash before commit; version
   switches are atomic (new version fully staged, then flipped; interrupted
   installs/updates resume or roll back, never half-apply); corruption detected at load
   repairs by re-fetch-by-hash; saves are never touched by asset reclamation, and the
   player can export saves before any destructive storage operation. Disk-full and
   interrupted-update fault injection are harness lifecycle tests (M2).
2. **Launch (every boot):** integrity/version check against manifest → progressive PSO
   warmup from trace → resident-set preload for the player's saved location → gameplay.
   Warm-launch performance is gated on the outcome, not the cache mechanism (D-051):
   warm launch must land within the budgets.md ≤ 10 s budget, with the complete in-app
   cold/warm launch measurement being M2 scope. The evidence classes differ and must not
   be conflated: **V8 code-cache lifecycle** (wasm via `instantiateStreaming`, stable
   URLs) is best-effort, non-gating diagnostics — anomalies are findings, not gates —
   while **Dawn pipeline/cache evidence stays mandatory** in the smoke metric registry,
   and zero runtime pipeline/shader compiles during measurement remain blocking budget
   gates (D-051 kept both).
3. **Run:** streaming manager keeps the resident set inside the memory budget as the
   player moves; eviction is proactive, never emergency.
4. **Update:** manifest diff → fetch changed assets only → invalidate affected warmup
   traces. The former "asset-only update never invalidates the wasm/JS code caches"
   mechanism goal was replaced by a performance contract (D-051): post-update warm
   launch stays within the ≤ 10 s budget and the paired pre/post delta is recorded;
   cache-lifecycle evidence remains best-effort diagnostics.
5. **Uninstall (user-initiated, D-024):** a native-title lifecycle removes cleanly, not
   just installs. The shell offers uninstall behind an **explicit confirmation** that
   states what is deleted (installed assets, caches, service worker, saves) and offers
   save export first (per the trust contract above). Two mechanisms, both built and
   measured in M2: (a) client-side teardown — service-worker unregister, OPFS clear,
   Cache Storage + IndexedDB deletion, then quota-release verification via
   `navigator.storage.estimate()`; (b) navigation to a static `/uninstall` endpoint
   whose response carries `Clear-Site-Data: "storage", "cache"` (an nginx location
   block — stays within D-011's static-serving preference). What each actually clears
   (OPFS? V8 code cache? Dawn/shader caches? HTTP cache?) is measured, not assumed —
   gaps go to rough-edges.md. The app-owned model is part of Parallax's OPFS install and
   is removed by this lifecycle.

## World structure and streaming

The world is partitioned into **districts** (D1 surface, D2 underground; architecture
assumes N). Districts subdivide into **cells** (streaming granularity within a district).
Two streaming regimes, both budget-governed:

**D1 greybox v1 (D-090):** the playable surface is a Y-up, metre-scaled 4,096 m square
centered at the origin and divided row-major into a 16 × 16 grid of 256 m cells. Fixed
seed `0x5eedD101` and generator/schema v1 produce stable canonical ordering and one
content-addressed JSON build artifact per cell. A versioned game-owned data descriptor
contains D1's terrain layers, zones, feature rules, and graph markers; a district-agnostic
seeded generator interprets it. Each cell carries a collection of representation-tagged
render payloads, LOD-independent collision data (a 17 × 17 heightfield at 16 m spacing
plus static AABBs), and generic topology/transition metadata. No engine interface names
D1 or assumes triangle meshes, exactly 256 cells, or a single observer. Feature LOD
selection operates on tagged authored groups, so compound features remain intact and
far-tier landmark selection cannot accidentally select an unrelated primitive from
another tag in the same cell. Mixed-stride terrain edges receive single-sided downward
skirts whose triangle winding matches the terrain front-face convention; equal-stride
interior neighbors do not duplicate those skirts.

- **Intra-district:** distance/visibility-driven cell load/evict with LOD tiers.
- **Inter-district (hard transition):** full resident-set swap through choke points —
  the catacomb entrances (game-design.md), of which there are several with different
  surface contexts; the transition system handles N entrances as data, not one bespoke
  passage. Contract lives in [budgets.md](budgets.md): memory high-water during overlap,
  max hitch, and total swap time — applied per entrance. The prefetch-trigger element
  (when a transition preload must start, per entrance) is deliberately not yet defined
  (D-055): it needs M4 greybox measurements to set honestly; calibrating and adding it
  to budgets.md is an explicit plan.md M4 task, and the M4 exit cannot be declared
  against a contract that still lacks it. This is deliberately the
  hardest case and is exercised early with greybox content (M4) because it shapes asset
  packaging and the streaming manager's design.

Asset packaging: per-cell bundles, content-addressed, with shared kits/materials
deduplicated across cells. Formats: glTF/GLB, KTX2 (BasisU) textures, meshopt
compression. (Decision D-006.) D-090's procedural descriptors are game world data; the
build-generated canonical cell JSON files are validated greybox library/package output.
Their structural QA gate replaces only Blender-binary-specific checks until M5, not the
asset gate itself. The later streaming task installs and reads these bundles through
OPFS; generating and packaging them does not by itself claim an OPFS cell-load result.

**Common vs. game-specific split (D-010):** every packaged resource is classified as
*common* (engine code, shared asset packs/kits, models — shareable across published
games) or *game-specific* (world data, game logic, unique assets), in separate bundles
addressed separately by the manifest. When Cross-Origin Storage ships, the common set
moves to a hash-based COS index without repackaging; until then the split costs nothing
and keeps the packaging honest.

## Rendering

Babylon Lite's WebGPU-only core is treated as a scene/material/animation library —
Parallax owns scheduling, streaming, memory, and the frame loop (D-078/D-080). Lite is
the sole renderer: code inside `engine/` uses its data structures and APIs directly, with
no engine selector or common-denominator backend interface. Game code still crosses the
Parallax render-service, worker-protocol, and typed-snapshot boundaries; those isolate
processes and layers rather than engines. Custom passes (culling, terrain, VFX) use Lite's
public surface where possible. M1's asset path must preinstall pinned KTX2/Draco/meshopt
decoder globals in the module worker and pass compressed fixtures before content lands;
Lite's fallback bootstrap uses `document` and is not worker-safe. Its v1.11.0 generic
compute and raw-device/queue gap is bounded to one exactly pinned native-interop adapter
with compile/runtime guards and a harness probe before P-002 needs it. Material policy:
aggressively minimize pipeline permutations (uber-shader mindset) to keep Dawn's cache
warm; the harness tracks pipeline-count and compile-stall metrics per build.

**Dynamic lighting is a day-one requirement**, not an optimization decision: the game's
full day/night cycle and weather system (game-design.md) rule out fully-baked lighting.
The renderer is designed around dynamic time-of-day from the M1 greybox onward, and
harness runs sweep lighting/weather states, not just geography.

For the D-090 M1 preview, the render worker materializes terrain directly from the
LOD-independent collision samples at strides 1, 2, and 4 and batches triangle-box
features by material. Single-sided downward skirts are emitted at outer/cull boundaries
and on both sides of mixed-stride seams; equal-stride interior neighbors emit none. The
generic selector chooses the nearest of one or more observers,
uses prior-tier state across the 64 m hysteresis bands around the 320 m and 960 m
thresholds, and culls cells beyond 4,096 m. Collision remains a separate world payload
and is not inferred from whichever visual LOD is active. Per-frame phase and intensity
samples make lighting animation observable to the harness; a post-measurement canvas PNG
hash and bounded visible-pixel ratio, derived from the telemetry clear color, make
rendered output itself mandatory. Separate terrain-patch, box-feature, triangle,
main-thread world-generation, synchronous scene-`postMessage`, and
worker-materialization fields keep the costs interpretable. The build packages
every descriptor in the N-district registry under a distinct normalized artifact scope,
although this first M1 gate intentionally validates D1's exact target-scale contract.
The standard target-scale traversal used by validation is 12 m/s.

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

D-096 selects D-074's app-owned Gemma 4 E2B QAT-GGUF model on wllama. WebGPU is the
default placement; CPU/WASM remains an explicit graphics-headroom mode. Persona cards +
rolling summarized memory per NPC use strict JSON-schema output for anything that
touches game state and freeform text only for flavor dialog. Inference contends with
rendering for on-device resources, so the harness measures frame impact during
generation.

The completed D-075 optimization spike measured live exact-prefix reuse and
restart-persistent per-character KV snapshots separately from D-074's uncached
qualification. D-084 records the persistent-cache no-go and removal of its experimental
implementation. Live same-session prefix reuse remains the viable result and supports
the idle pre-seeding direction.

**Knowledge & retrieval (D-033):** NPC prompts are assembled by a **knowledge service**
in `engine/ai` — persona card + context retrieved through an explicit interface, never
all-lore-in-prompt (on-device prefill cost and small-model
context-following all punish long prompts). Tier 1 is structured game-state queries
against the sim's typed state and world graph — deterministic, no embeddings, lands
with M3. Tier 2 (authored-lore retrieval; mechanism open — tag/graph lookup vs.
precomputed embeddings with a brute-force wasm scan) and tier 3 (episodic memory;
needs an app-owned embedder — Chrome ships no built-in Embedding API, checked
2026-07-13) are build-later. Ownership follows the layer rules: `engine/ai` owns the
generic contract (provider registration, context assembly/budgeting, telemetry) and
contains no game knowledge; `game/` supplies the providers, query schemas, and content.
The prompt schema reserves a retrieved-context slot from day one, and the service is
independent of the selected model placement.

**Model lifecycle (D-074/D-096):** the five exact GGUF shards are ordinary
hash-verified OPFS install artifacts with the same resume, update, repair, and uninstall
contract as other game content. The engine never assumes availability: every NPC
carries authored fallback dialog, the game remains fully playable with reduced
conversational depth, and quest-critical state changes never depend on inference.

## Forward-design constraints (build later, respect now)

- **P2P multiplayer (WebRTC data channels):** sim/render separation, input-command
  pattern, stable entity IDs, and a serializable authoritative state are required today.
  See [features.md](features.md) for the full constraint list.
- **N districts:** no code may assume exactly one or two districts; district IDs are data.
- **wasm64 (P-001):** Rust modules isolate memory-size assumptions so an individual
  module *can* move to memory64, but memory32 remains the default. A switch requires an
  unavoidable measured single-module >4 GiB need after partitioning/streaming/resident-
  set alternatives fail. The M0 dedicated scenario qualifies browser/toolchain feasibility
  and cost only; M1 representative module data still decides whether any real module has that
  need. Memory64 is therefore a last resort rather than a scale target.
- **NPC knowledge retrieval (D-033):** the prompt/persona-card schema carries a
  retrieved-context slot from M3 even while only tier-1 (structured state queries)
  exists; lore is authored chunked + tagged in `game/` from the first writing; embedding
  precompute, if adopted, is an `assets/` pipeline step.
- **Cross-Origin Storage readiness (D-010):** the common/game-specific packaging split
  above, plus deterministic, versioned engine builds (byte-identical from same source +
  toolchain; no timestamps/paths in artifacts; stable chunking) so engine bundles are
  hash-shareable across origins. The engine/game layer boundary is also a build and
  packaging boundary: engine artifacts must be buildable, versionable, and loadable
  independent of any game code.
