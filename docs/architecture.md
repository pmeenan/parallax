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
│ platform   Chrome ≥ latest stable: WebGPU, OPFS, Cache Storage,│
│            SAB + workers, OffscreenCanvas, app-owned WebGPU/   │
│            WASM AI, WebRTC (future), WebAudio                  │
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

D-086 historically qualified Chrome/Binaryen memory64 feasibility and exact
beyond-4-GiB access without adopting it. D-117 resolved the M1 decision point in favor
of memory32 for every current production module and removed that experiment from the
runtime and build. The exact measurements remain in D-086; current architecture carries
only the module-specific reopen boundary below.

The M0 worker spike is a go (D-056), and D-078's same-boundary head-to-head selected
Babylon Lite: the controlled walking-skeleton run keeps scene
construction, WebGPU device ownership, animation, and render submission in the dedicated
render worker. The window retains only explicit orchestration — worker/canvas setup,
device-pixel resize forwarding, batched telemetry reception, and shell UI. This is the
verified rendering-core boundary, not a blanket claim that DOM-bound engine features are
worker-safe; new input, GUI, accessibility, and loader paths must cross explicit protocols
or be re-verified when they land.

The long-lived streaming worker owns production OPFS handles and queue telemetry. It
opens and size-validates the fixed district index's distinct content-addressed access
handles once after provisioning, retains them for its worker generation, and closes the
complete set on failure or disposal (D-108). Movement reads therefore contain no
asynchronous directory lookup or handle/lock acquisition. Telemetry exposes exact
package/open-handle counts and aggregate startup-open duration. The worker retains the
nearest nine D1 cells across all observers, evicts farthest non-target
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
D-112 presents that existing public snapshot through an always-visible, accessible
in-game dashboard without changing the worker or telemetry schemas. A pure `game/ui`
view model owns labels, formatting, nearest-rank retained-sample p95s, and explicit
unavailable states; the app shell mounts semantic DOM and subscribes to the public
streaming service. There is no polling or separate dashboard cache. State/generation,
residency and observer settlement, OPFS package/open-handle identity, load-stage p95s,
scoped encoded and streamed-buffer byte accounting, queue pressure,
encoded-residency budget rejections, and proactive evictions are visible. Retained live
p95s are descriptive, never budget verdicts.
Worker stalls and emergency evictions stay visibly unavailable because the public
contract does not expose those counters; the UI does not manufacture proxies.
D-104 makes render failure recovery an atomic cohort operation. Device loss, worker
errors, unreadable messages, and a missed three-second render heartbeat tear down the
render worker and the coupled streaming worker/decode pool, then start one replacement
generation with a fresh canvas transfer, direct port, and SAB rings. The streaming
worker publishes a generation-tagged settled checkpoint containing immutable observers,
sorted resident-cell identities, and total/direct observer sequences. Mutable observer
telemetry may advance while scheduling is in flight, but recovery deliberately rolls
back to the latest worker-acknowledged checkpoint and the replacement must rebuild it
exactly. A diagnostic quiesce handshake first stops render-worker observer movement,
waits for that exact streaming checkpoint, and then injects the fault. The window does
not publish recovered state until both the replacement render first frame and streaming
checkpoint hydration complete, regardless of ordering; hydration failure fails render
terminally. Streaming failure, including during the diagnostic quiesce handshake,
fails render terminally and rejects pending boundary requests; the qualifier separately
bounds that handshake so a broken worker-to-worker path cannot hang the runner. Any
second failure is terminal and fails the streaming cohort too. Active flythrough
measurement is invalidated by recovery rather than silently resumed, and asynchronous
final-settlement completion cannot overwrite that invalidation. Registered
physical-console schema-v4/metric-set-v3 report
`render-recovery-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-26-52-162Z.json`
qualifies this whole-cohort policy across real device loss, silent worker failure, and
bounded retry exhaustion. Same-artifact schema-v37/metric-set-v20 report
`smoke-1-7f6f65d9c6fd-dev-01-showcase-2026-07-25T16-36-37-999Z.json`
then passed the final D-097 routine gate across all six runs, all three facets, and
30/30 checks, closing the render-worker robustness plan item.
D-102's streaming telemetry v3 adds deterministic load-batch/cell identity and bounded
stage attribution without changing that scheduler. Ordered timestamps stay entirely on
the streaming-worker clock: OPFS access, decode round trip, render-upload round trip,
render-commit round trip, and post-commit streaming bookkeeping. Nested decode-worker,
sync-read, and render-worker work are duration observations only; derived waits subtract
those durations from their containing round trips and never compare timestamps across
realms. The harness requires every decomposition to agree within 0.1 ms and reports
per-stage p95s alongside the existing OPFS-to-GPU total. It also validates producer
semantics: distinct batches cannot reuse an observer identity, flythrough-observer
progress cannot exceed total-observer progress, and cells/ordinals are unique within a
batch. Recorded identity begins at batch ordinal 2 and positive observer identity
because hydration's ordinal-1 batch is excluded; batch ordinal is bounded by both
observer and sample-sequence progress. Batches are complete unless the supplied snapshots prove a split at an
unsettled start or an active batch newer than the unsettled end's last settled observer;
the end settlement watermark cannot regress, and the first measured batch must be newer
than the start settlement watermark even when the start has zero samples. The last start-boundary batch identity is
retained even when settled to order the first measured batch. Its ordinal successor
requires the boundary batch to be complete and an observer identity strictly newer than
both the retained batch and the start settlement watermark, with valid
flythrough-versus-total observer progress. The retained pre-window prefix is validated
as an ordered, internally consistent batch stream. Stored boundary metadata is
cross-checked against it; completed ID/ordinal pairs match exactly when the full
boundary remains, while a demonstrably truncated raw suffix must be a subset of the
stored facts. The boundary completion count cannot exceed the total start sample count.
A null boundary is valid only for a zero start
cell-load count, so aging that prefix out of the end ring cannot erase ordinal ordering.
The flythrough's settled start and exact settled completion allow no partial batch
exception.
D-114 closes and removes D-111's one-shot diagnostic handshake, worker marks/control,
trace correlation, and privileged public methods after the replacement attempt was
adjudicated. No privileged diagnostic path remains in the runtime. Ordinary streaming
telemetry remains v7 and the public telemetry envelope is now v25; the retained
diagnostic evidence and its unsupported observability fields live only in the decision,
findings, and result artifact.
D-103 distinguishes that flythrough contract from routine smoke's independent short
snapshots. The streaming worker publishes its evict-before-load progress, so an
unsettled smoke boundary may temporarily contain fewer than nine residents. Evidence
requires nine when settled and otherwise requires exact resident conservation across
the window: resident delta equals completed-load delta minus proactive-eviction delta.
Invalid smoke attempts retain the raw start/end streaming snapshots and a localized
validation reason rather than collapsing the failure to one string.
D-100's `flythrough-d1@1` makes that transfer explicit. Game code owns the route and
environment schedule, while an engine service performs preflight checkpoint
orchestration and sends one validated scenario to the render worker. A checkpoint
request synchronously registers Babylon Lite's screenshot readback after the preflight
sample is applied. The next animation frame services that registered request while it
renders the sample. The frame callback claims exactly the requests covered by that frame
and returns before a deferred macrotask awaits and publishes the already-submitted
readback; no subsequent animation frame is requested until that evidence settles. This
removes the screenshot-queue/render-frame circular dependency without allowing a later
frame to replace the stable framebuffer, so message ordering cannot capture the
preceding or a subsequent camera/environment frame. The render worker
then owns elapsed-time sampling, camera/environment application, and full-window
aggregation on its animation loop. It sends throttled, sequenced observer positions
directly to the streaming worker over the existing dedicated channel; neither the window
nor the external harness injects measured per-frame positions. Streamed residents are
visible and the whole-world preview is hidden for every measured flythrough frame.
Completion waits across that channel: the render aggregate is not final telemetry until
the streaming worker has received the render worker's exact last flythrough sequence
and settled the corresponding total observer count. The worker-origin aggregate also
echoes the complete validated scenario so an independent harness contract can detect
same-distance path or environment-state drift.
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
Lite's fallback bootstrap uses `document` and is not worker-safe. Its pinned 1.12.0 generic
compute and raw-device/queue gap was exercised by D-098 through one temporary,
exactly-pinned native-interop adapter with compile/runtime guards and a harness proof.
All six arms proved device access, queue identity, and a buffer round trip. The selected
production path has no native-interop consumer, so the adapter was removed with the
closed experiment; a future consumer must reintroduce and requalify that bounded
surface deliberately. Material policy:
aggressively minimize pipeline permutations (uber-shader mindset) to keep Dawn's cache
warm; the harness tracks pipeline-count and compile-stall metrics per build.

**Dynamic lighting is a day-one requirement**, not an optimization decision: the game's
full day/night cycle and weather system (game-design.md) rule out fully-baked lighting.
The renderer is designed around dynamic time-of-day from the M1 greybox onward, and
harness runs sweep lighting/weather states, not just geography.
The first binding is D-100's M1 environment-state sweep: fixed clear, overcast, and
storm-labelled lighting/environment configurations across dawn/daylight/dusk/night.
It deliberately does not implement or claim M6 weather VFX such as precipitation, wind,
wet surfaces, or particles.

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

**Geometry representation for the current D1 path is triangle LOD (D-098).** The
bounded P-002 meshlet/GPU-driven and material-carrying Gaussian-splat challengers did
not supply fully eligible displacement evidence; triangle itself also lacked a fully
valid performance comparison, so D-098 is incumbent retention rather than a measured
speed win. No hybrid ships from the spike. Streaming, asset packaging, collision, and
the QA gate remain representation-agnostic so representative higher-density art,
capture-origin UGC, or a full virtual-geometry/relightable-splat proposal can reopen the
choice without changing interfaces above the renderer.

## In-game benchmark mode

D-105 implements D-025's public benchmark as a cross-layer composition without moving
game content into the engine. `game/benchmark` owns `m1-benchmark@1`, the canonical
`flythrough-d1@1` reference, fixed D1 seed, Showcase/Standard presentation presets,
user copy, and human-readable formatting. `engine/benchmark` owns lifecycle,
measurement boundaries, environment capture, metric aggregation, repeat variance,
facets, and the browser-neutral `benchmark-result@1` schema. The app shell only
renders accessible controls and calls the same public telemetry methods available to
automation.

Each run fixes the render worker's pixel size, then performs three `continuous-page`
repeats. A repeat awaits an explicit FIFO reset spanning render and streaming, reuses the
flythrough service's six streamed GPU-backbuffer checkpoints and 10-second
stabilization, and starts the existing worker-owned 600-second route. The worker owns
camera/environment pacing and full-window render distributions; the engine reads the
corresponding streaming boundary suffix and observes Window Long Tasks. It never
accepts frame pacing or measurements from a launcher.

Each checkpoint also crosses D-107's worker-rendered preflight boundary. The worker
applies the exact sample and renders one frame, then acknowledges its scenario,
environment, elapsed time, generation, and actual pixel size. The engine validates
that acknowledgement before registering the screenshot, so the next frame's readback
cannot be the first frame after a benchmark resize or sample transition. Reset and
recovery cancel both halves of this two-frame protocol.

Benchmark execution exclusively owns the flythrough and observer-control surfaces.
Start and public reset publish `resetting` synchronously before crossing any worker
acknowledgement, so duplicate starts, configuration, and standalone controls reject
during that boundary. An already-running synthetic traversal is stopped before
preflight, and exact total/flythrough observer deltas prove that no other producer
entered the measured window. Engine-side validation also
requires the canonical route and phase order, full streamed-presentation ownership,
valid worker distributions, complete checkpoint evidence, and exact worker-rendered
checkpoint dimensions for the selected preset. Timeout and runtime failure abort
outstanding waits and preflight/route work, close the Window Long Tasks observer,
restore the prior pixel-size override, and retain an invalid attempt/report. Reset
cancels pending and already-submitted checkpoint readbacks, stops route emission, waits
for any active deferred readback flush to schedule the next render-worker animation
frame, and then crosses a direct-port boundary that acknowledges only after all earlier
route traffic and streaming scheduling settle. The acknowledgement is bounded to 15
seconds; timeout rejects reset and enters the existing one-retry whole-cohort recovery.
Run-local observer numbering is separate from the cumulative transport sequence, and
generation tags make late traffic inert. A replacement cohort starts flythrough
generation zero on its new ports and receives the acknowledged recovery checkpoint's
cumulative transport sequence. A replacement render attempt retains its latest
requested pixel size, so override restoration queued during initialization and late
ready telemetry cannot disagree. Active, failed, and completed flythroughs do not expose
aborted/idle until acknowledgement arrives. Direct benchmark reset clears its matching
in-flight ownership before terminal `idle`/`failed` publication, making synchronous
subscriber actions consistent with the published state. Service disposal synchronously
restores the generation-owned render-pixel override before publishing `disposed`;
because it destroys the service, it does not synthesize a reusable benchmark report.

The public telemetry snapshot envelope is v25, benchmark section telemetry is v2, and
flythrough telemetry is v3, including the explicit aborted state. The envelope exposes benchmark lifecycle plus
configure/start/reset/result JSON/text methods; reset is awaitable through the public
surface. The completed result embeds the exact
scenario, complete flythrough snapshots, and every environment capture; all captures
retain raw CSS viewport geometry. `benchmark-result@1` schema v3 identifies
`fixed-worker-render-pixels@1` as its comparison policy: viewport geometry is a recorded
diagnostic, while browser, adapter, capabilities, screen/DPR, artifact, and the remaining
environment identity must match exactly. Each accepted repeat independently proves the
selected worker-render pixel size at every checkpoint, so no CSS-layout value substitutes
for workload identity. Privileged harness evidence remains a
separate contract: CDP/Dawn traces, authoritative compositor presentation, all-realm
heap, attributable GPU memory, worker long tasks, registered-host/driver/power, and
physical-console state are explicitly unsupported in the page result. Consequently
the current in-game result is advisory and never substitutes for D-097. Its
continuous-page repeats are also intentionally incomparable with the harness's
independent fresh-profile lineage unless a future version aligns the repeat policy.
D-115 completes the M1 Benchmark mode task on that implementation/result-contract
boundary. The retained complete schema-v3 reports correctly fail their 10% scenario
checks and keep their budget facets `not-evaluated`; that fail-honest export behavior
qualifies the mode, not its observed performance. The authoritative D-102 flythrough
remains the M1 performance gate, and no further 30-plus-minute public run is required
or authorized for the milestone.

## M1 exit evidence boundary

D-115 scopes M1's registered physical exit to Showcase on dev-01 and defines it as a
versioned evidence chain, not a claim that D-102's schema-v4/metric-set-v4 result passed
the then-current D-115-era flythrough schema v12 / metric set v6. D-102 supplies the privileged ten-minute
anchor; D-104's dedicated qualifier and the final current smoke cover the subsequently
mandatory settlement/recovery-checkpoint contract. Post-D-108 public reports retain
failed advisory variance but physically prove six complete current-path routes and the
fixed 256-handle workload. D-116 preserves the first schema-v44/metric-set-v21 smoke as
failed and makes the final schema-v45/metric-set-v22 smoke carry the registered
current-path short-scenario verdict. Fresh and warm independently require cell-load p95
absolute spread no greater than `max(10% × minimum cohort p95, 1 ms)`. It does not
claim that the current ten-minute route passed repeatability. Standard has no
registered M1 Pro/Metal machine and remains unqualified; dev-01's Standard preset
cannot establish transfer or 120 Hz behavior. The final physical action completed as
schema-v45/metric-set-v22 report
`smoke-1-cf1a0420d451-dev-01-showcase-2026-07-26T03-19-56-378Z.json`
(SHA-256
`b10c83ff0019cd3b332eec322703e2556de4565ba3e01c942154909cfb5508c9`):
all six core runs, all three facets, and 30/30 evaluated budget checks passed. Fresh
and warm streaming p95 spreads were 0.615 and 0.530 ms, each within the 1 ms allowance.
This qualifying-input-tree smoke completes the versioned M1 evidence chain without
rerunning or relabeling the already-qualified flythrough or render-recovery scenarios
or the failed public benchmark. D-115
supersedes D-108's extra recovery-rerun consequence without claiming a post-D-108
combined fault measurement: the recovery control path is unchanged, while later
physical public evidence opened the same generation-initialization path's 256 handles
in 204.96 ms. A change to either path reopens the dedicated qualifier.

The qualified flythrough gates the complete canonical route, streamed-residency
ownership, environment sequence, synchronized all-realm V8 used-heap high-water,
main-thread Long Tasks, representative streaming p95/repeatability, and overlapping
Dawn/D3D12 pipeline compilation. Physical presentation remains unqualified because
current CfT exposes neither success nor page attribution: smoke records informational
`invalid`, while D-114's provider inventory records `unsupported`; callback cadence is
not a substitute. Worker long tasks, combined resident CPU memory, and page-attributed GPU
residency likewise remain explicit unsupported platform gaps. Smoke's fixed synthetic
threaded-Wasm memory and SAB transport sizes are bootstrap invariants, not
representative flythrough memory and not additive with V8 backing storage. Logical
streaming byte counters are not physical residency.

The M1 contract therefore permits exit with zero violations among evaluated mandatory
metrics while retaining those gaps as unqualified, never passed. Visible-pop visual
diff moves to M5's representative-art streaming swap. D1↔D2 remains M4, where the
transition and prefetch-trigger contract is defined and measured.

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
- **Wasm address width (D-117):** Rust modules isolate memory-size assumptions, but
  memory32 is selected for every current module. Memory64 reopens only for a concrete,
  unavoidable measured single-module >4 GiB need after partitioning, streaming,
  multiple memory32 modules, and resident-set reduction fail; it is not a scale target.
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
