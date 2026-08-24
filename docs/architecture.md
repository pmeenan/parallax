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

D-121 places the production nginx include and the guarded Windows deployment entry
point under `deploy/`. Mutable navigation/build-manifest responses use `no-cache`;
ordinary full-SHA-256 resources under `/immutable/` use a one-year public immutable
policy. D-131 keys that selection on status, request `Range`, and URI: any range request
uses `no-cache`, including a stale-`If-Range` request whose response is a full 200,
while only no-range 200/304 immutable responses use the one-year policy.
COOP/COEP are attached with nginx's `always` behavior so conditional 304s and errors
retain cross-origin isolation. Immutable caching is limited to 200/304; errors
revalidate, and method rejection advertises POST for `/uninstall` or GET/HEAD for other
routes without creating a header inheritance boundary. The deployer has one fixed SSH
host (`plex`) and one fixed webroot (`/var/www/parallax-web.com`). That exact-inventory
root is exclusively Parallax-owned and cannot contain unrelated or ACME HTTP-01
challenge files. It requires owned, non-symlink, non-writable
parent/target directories, stable device/inode identity, no target/descendant mounts,
and an owner-only lock inside the target. Only after explicit destructive confirmation
does it make the webroot owner-only, delete the non-lock children, and recursively copy
a frozen, exact manifest inventory. Before restoring public traversal it rejects
symlinks and normalizes descendant directories/files to 0755/0644. Local source
identity is checked around the copy and every remote mode/path/size/hash plus absence
of extras is checked before success. A post-privatization failure attempts only bounded
model restoration and retains the guarded 0700 root and owned lock for manual recovery;
it never republishes partial bytes. It never reads the frozen `site/` placeholder.
Rollback-safe nginx installation and reload remain a separate human-admin action, and
the installer retains its caller-owned candidate on every failure path.

Privileged smoke, flythrough, and render-recovery runners default to an ephemeral local
target and accept only the explicit alternative `https://parallax-web.com`. Before any
Chrome launch they reject redirects, verify `/` against manifest-listed `index.html`,
hash every manifest artifact under bounded concurrency/time/size limits, and require
correct MIME, strict mutable/immutable cache policy, COOP/COEP, `nosniff`, ETag, and
conditional 304 behavior. The same complete verification runs after the scenario.
Reports retain distinct preflight/postflight state plus compact representation-class
summaries. Target kind and exact origin remain baseline identity; local and production
keys are deliberately incomparable (local ephemeral ports normalize to the canonical
loopback origin class for local-to-local comparison), while legacy three-part local
anchors require explicit migration. Production selection never starts the local
server. Nginx exposes no harness-only counters, so smoke's local request-delta
metric is explicitly `not-applicable` on production while the target preflight remains
mandatory environment evidence.

## Worker topology

On the web, multithreading is an architecture we design, not an engine feature we
inherit. Current runtime topology (revise here as it evolves; requires COOP/COEP for
SAB where noted):

```
main thread        UI shell, input capture, orchestration only. Never blocks.
service worker     Stable root-scope offline-shell authority. Serves the selected
                   release-bound shell generation, preserves exact Range semantics,
                   and is not a dedicated-worker build-manifest entrypoint.
installer worker   Eager app-shell install/repair executor. Owns bounded transfer,
                   verification, and publication operations against the OPFS store.
render worker      Babylon Lite scene + WebGPU device on OffscreenCanvas.
sim worker         Engine-owned 60 Hz fixed-timestep scheduler. Dynamically imports
                   one same-origin, content-addressed game simulation adapter; owns
                   authoritative commands, state, semantic events, and save/load.
AI workers         D-096 wllama/llama.cpp execution + OPFS model cache; wllama creates
                   its own inference worker/pthreads and, for the default D-074 path,
                   a separate WebGPU device.
streaming worker   Owns OPFS handles; schedules nearest-observer loads and proactive
                   evictions against the memory budget; feeds the fixed decode pool.
decode pool (N)    Validates/decompresses schema-v2 cell dependencies, including
                   KTX2/BasisU textures and meshopt meshes; future Rust/WASM hot paths.
                   Sized once at boot to min(4, max(1, hardwareConcurrency - 2)).
wasm-thread worker Mandatory content-addressed build entrypoint used only by the
                   bounded diagnostic thread/SIMD proof. Its short-lived instances
                   terminate before steady-state measurement.
```

D-156 adds the production simulation worker and build-manifest v16 role. The manifest
requires exactly the six dedicated-worker roles
`decode|installer|render|sim|streaming|wasm-thread`; the stable service worker remains
bound separately by `offlineShell.serviceWorkerPath`. The common engine worker never
imports game code statically: the app supplies the exact game-specific simulation
artifact URL, and the worker admits only a same-origin content-addressed production
path (or the exact development source path).

The authoritative sim advances at 60 Hz from integer ticks. Input is an ordered stream
of serializable `{sequence,targetTick,kind,payload}` commands; no game step reads wall
time. The live authority and each replay receive distinct adapter instances from the
admitted game-module factory, preventing adapter-local caches from crossing those
boundaries. A versioned binary save envelope covers the tick, last applied sequence, next
semantic-event sequence, game state, and every queued future command under one SHA-256
binding. Presentation is a non-authoritative 30 Hz view: the sim worker publishes
stable safe-integer entity IDs and transforms through a fixed-at-boot, triple-buffered
SAB (4,096-entity production capacity), while game-payload state hashes, events, and
telemetry use `postMessage`. Per-slot atomic generation markers reject torn reads;
lagged consumers drop overwritten transform publications without discarding their
events or telemetry. Consumers interpolate the two latest successfully read views over
their actual tick interval and never mutate sim state.

D-158's first gameplay consumer keeps browser capture in `engine/input` and game rules
in the dynamically loaded adapter. Keyboard and pointer changes are coalesced to at
most one input frame per main-thread animation callback before `game/` turns them into
ordered commands. The adapter receives only an immutable simulation-world projection
(bounds, collision heightfields/AABBs, and authored markers), not render LODs or GPU
content. Its fixed-step capsule controller samples the collision heightfield, resolves
horizontal AABBs, and emits transition interaction as a semantic event. Controller
distance, collision resolutions, and interaction attempts/activations are public sim
counters.

M3 NPC navigation derives a deterministic 16 m tiled grid from every cell in that same
immutable collision projection. Walkability expands authored AABBs by the NPC capsule
radius, rejects capsule-center boundary samples, sweeps every graph edge against thin
colliders between samples, and admits only heightfield edges within the configured ground-step bound. Stable
A* tie-breaking builds cyclic paths between tagged, authored schedule stops once per
isolated adapter; no render LOD or live GPU resident set becomes simulation authority.
Forty-eight stable-ID agents follow those paths at 60 Hz, dwell at schedule stops, and
apply synchronous pairwise separation against previous-tick crowd poses and the current
tick's post-controller player pose.
The game-payload save schema covers each agent's route/stop/path cursor, dwell, pose, and
crowd counters; load rejects off-mesh or ground-height-inconsistent NPC poses. Navmesh
tile/node/edge counts, owned grid bytes, path queries/nodes/expansions, moving agents,
schedule transitions, avoidance adjustments, and aggregate NPC distance are exported as
game counters, while replay evidence records adapter/nav initialization duration outside
the deterministic state. NPC transforms share the existing triple-buffered presentation SAB; the
render worker maps them onto a fixed 64-mesh placeholder pool while scenario-owned
flythrough presentation suppresses both player and crowd meshes.

The interpolated player transform drives a placeholder capsule and third-person orbit
camera in the render worker. Interactive player position also drives streaming
observers. Flythrough/benchmark preflight and measurement explicitly own camera and
observer presentation while active; gameplay updates remain cached and resume only
after that ownership is released, with the scenario environment sample cleared at the
reset boundary. Render-worker recovery publishes the replacement visible canvas so the
input service rebinds focus/pointer-lock listeners. A save/load boundary publishes the
restored accepted-command sequence; the game bridge rebases scheduling and re-emits
current physical input instead of inheriting a future target tick. Commands are
held behind a load barrier so old-timeline input cannot race into the restored queue;
success discards the held batch before the bridge emits current input against restored
anchors, while failure rebases the batch beyond snapshot-publication lag and applies it
to the unchanged timeline. The app shell wires these public engine/game
services and renders debug status, but contains no command kind, player entity ID, or
interaction-event decoding.

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

D-162 turns that selected backend into the ordinary dialog service. Installed launch
passes the exact D-137 release-bound source to a lazy window-owned controller, which
opens each immutable OPFS shard as a `File` and calls wllama's blob-based load path;
ordinary inference never converts the installed model back into an HTTP URL or creates
a second model cache. The service rechecks each file size, relies on the admitted
verified-object/hash records for integrity, fails terminally for that launch on model
load failure, and never changes WebGPU to CPU/WASM automatically. The game receives a
typed response only after the exact speech/intent/subject object passes the current
persona's finite allowlist. Dialog memory and authored fallback text remain game-owned.

D-084 rejects restart-persistent KV snapshots for the pinned Gemma 4 E2B runtime after
restore recovered just 409 of 914-916 exact reusable tokens. The experiment's store,
runtime patch, and harness were removed after measurement; production has no persistent
KV dependency. The preferred follow-up is a clean live context pre-seeded with static
world knowledge, tools, and the next persona while the model is idle, then consumed by
the next conversation and rebuilt after launch or invalidation. That scheduler remains
measurement-gated and model-specific; this Gemma result does not pre-judge separately
evaluated candidates. Player-derived context remains governed by the save-data
privacy/lifecycle rules.

Communication: SharedArrayBuffer channels for high-rate data (streaming queues,
sim→render presentation snapshots); `postMessage` with transferables for bulk handoffs;
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
`MessageChannel` to the render worker. Current district-index schema v2 extends the
legacy six-key v1 cell index with one exact `resources` table and per-cell dependency
roots. KTX2 plus legacy/versioned meshopt descriptors form a validated acyclic graph;
the worker's reference-counted CPU cache and the renderer's correlated GPU cache share
each dependency across resident cells. Individual dependencies are bounded to 8 MiB
encoded and 32 MiB decoded, and one batch is bounded to 128 MiB staged bytes (D-148).
The procedural-cell decoder is a fixed hardware-sized nested worker pool; every measured movement-triggered path reports attributable
OPFS read, decode, upload, total latency, encoded/GPU bytes, queue high water, and
residency/eviction counters. Districts own separate hashed OPFS subdirectories, so
content-address garbage collection is scoped to one district and remains compatible with
the N>2 streaming design constraint. Load samples carry monotonic sequence numbers so the harness
can derive a measurement-window suffix correctly even after the retained 256-sample ring
wraps. D-137 replaced the pre-M2 HTTP provisioning bridge: ordinary launch now admits
one exact active release and resolves index, cell, and dependency objects directly from
its content-addressed OPFS store. Streamed LOD0 meshes are created on the GPU but
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
adjudicated. No privileged diagnostic path remains in the runtime. At the D-114
boundary, ordinary streaming telemetry was v7 and the public telemetry envelope was v25; the retained
diagnostic evidence and its unsupported observability fields live only in the decision,
findings, and result artifact.
D-124 closes D-122/D-123's temporary direct-port streaming-tail experiment after both
dirty measured sources were reconstructed under D-099. Its protocol authorization,
timestamp/correlation shapes, 16+1 controls, 64-cell ring, worker and telemetry hooks,
public methods, runner, validator, command, and tests are absent from the current
architecture. At the D-124 boundary, ordinary streaming telemetry was v7, the public telemetry envelope
was v25, and smoke was schema v49 / mandatory metric set v25. The retained
D-123 result contains five valid attempts and one null attempt after a misordered
zero-work control. Its valid samples place an illustrative 2.515 ms ordinary
total-p95 cell's 1.770 ms commit round trip in 1.195 ms outbound dispatch plus
0.575 ms acknowledgement/continuation with no worker operation, while direct
OPFS/decode/operation/remainder work stayed small. That is historical application-
boundary localization, not a distinction between browser/OS scheduling, WebGPU queue
completion, or presentation; D-116 remains unchanged and RE-043 remains open. D-124
therefore required the cleaned D-121 candidate to be rebuilt, redeployed, publicly
verified, and run through one final D-097 production smoke.
D-125 retains that final smoke as failed and replaces the application-owned per-cell
render transaction with a batch-atomic boundary. Each scheduler load batch now crosses
the streaming/render port once for ordered upload and once for ordered commit (four
messages total), with exact transaction/member correlation, aggregate encoded-budget
reservation, partial-upload and 5-second uncommitted rollback, and post-commit-only
residency/sample publication. Per-cell OPFS/decode/direct-upload/byte/total evidence
remains; upload RTT includes decoded-peer and peer-upload wait, and shared batch direct
upload plus request/transaction high-water evidence is explicit. At the D-125 boundary,
streaming telemetry was v8, public telemetry v26, smoke v50/v26, flythrough v17/v10,
and recovery v14/v5.
The page benchmark's embedded snapshot shape advances its result/status schemas to
v4/v3 without changing its advisory semantics. This does not observe GPU completion
or close RE-043.
D-126 retains D-125's post-correction smoke as failed after all 30 absolute checks
passed but fresh p95 spread reached 1.250 ms. The render boundary now accepts one
fully prevalidated ordered `render-batch-transaction` and synchronously enqueues one
complete response. A throwing upload cleans its own partial, non-resident member before
the boundary rolls back completed members in reverse. Post-upload accounting or enqueue
failure rolls back the current resident member and completed members in reverse;
successful enqueue leaves no render pending state, commit protocol, or uncommitted
timer. Streaming holds its atomic encoded reservation
through exact response validation and only then publishes residency, accounting, and
samples. Its existing 5-second request timeout still fails the cohort; if a response
is lost after enqueue, renderer teardown contains the otherwise unacknowledged
resources. A disposal request marks the worker as draining rather than already
disposed: any outstanding transaction/scheduler failure latches `failed` and prevents
the ordinary disposed acknowledgement, allowing the app's existing streaming-failure
subscription to tear down the renderer. At the D-126 boundary, streaming telemetry was
v9, public telemetry was v27, smoke was v51/v27, flythrough v18/v11, recovery v15/v5,
and page benchmark result/status was v5/v4. This
still does not observe GPU completion or close RE-043.
D-127 qualifies this exact D-126 architecture on production artifact
`9d4c1be5c290133a58c9ad90327591804121b226be84cae4c333d3442f2dc86b`.
Every one of the six launches retained equal 74-request/74-completed-transaction
counts. Each measurement window contained 48 samples in 16 complete ordered
three-cell batches with exact canonical membership and timing conservation. This
demonstrates the current contract operating under the passing gate; it does not
attribute the result to the two-message transaction, observe GPU completion, or
resolve RE-043. D-116 remains unchanged.
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

### Release-bound PSO warmup trace (D-139, accepted)

Build-manifest v15 adds one content-addressed JSON asset-pack with exact resource ID
`game-specific-pso-warmup-trace`. Its payload contract is
`pso-warmup-trace@1`: exact keys, Babylon Lite 1.12.0 renderer identity, a render-state
compatibility digest, priority-then-ID ordering, and a state digest per logical pipeline
family. The install-manifest v1 document shape and kind vocabulary stay unchanged; the
existing `asset-pack` kind plus exact ID/path/game-specific/OPFS placement identifies
this specialized payload.

Ordinary launch resolves the trace through the admitted active release, reads only its
content-addressed OPFS object, and checks manifest/reference byte and SHA-256 identity
before parsing. The main thread passes the release-bound bundle to the render worker,
which independently revalidates canonical payload and provenance. Privileged
WebDriver-attested legacy runs use the exact embedded payload and say so in telemetry;
there is no ordinary network or embedded fallback.

The render worker owns a boot-only registry. Each cache miss crosses a task boundary,
then the matching Babylon scene registration creates the current pipeline family before
Ready and before the first interactive frame. Repeating the same authoritative request
must hit the registry without invoking the compile callback. Missing, duplicate-pending,
unknown, incompatible, or failed requests fail startup. Public telemetry exposes trace
and release identities, request/compile/deferral and registry hit/miss counts, queue
high-water, per-entry durations/request counts, and typed failure state. This records
application replay behavior; Dawn's backend cache state remains independent harness
evidence.

### Install manifest and production source boundary (D-128/D-132)

`install-manifest.json` v1 is the deterministic install plan. Build-manifest v15 lists
it as a normal exact artifact and references it through
`installManifestEntrypoint`; the install manifest deliberately does not list itself.
The build-manifest SHA-256 remains `artifactDigest`, the compatibility-preserving
serving/entrypoint identity. The listed install-manifest artifact SHA-256 is the
explicit `releaseDigest`; target evidence and current reports preserve and verify both.

Each resource binds exact bytes, semantic ID, kind, scope, SHA-256, source, and target.
Shell resources are same-origin app/engine/game code and runtime binaries. Current OPFS
resources are the generated game-specific district index/world cells plus the five
same-origin, install-only common model shards at
`immutable/model-<sha256>.gguf`. The model objects are served from production but do
not enter `dist` or the build-artifact inventory. IDs are stable semantic names; object
storage is hash-addressed and keeps
common and game-specific namespaces distinct. At the D-128 boundary the installer state
machine did not yet consume this contract and the pre-M2 HTTP streaming bridge remained;
D-137 subsequently moved ordinary runtime consumption to the exact installed OPFS release.

D-130 owns model-content publication separately from app publication. The model command
validates the exact five local files, uploads only into the D-121 private lock,
remote-verifies bytes and SHA-256, and publishes by content hash. The immutable
directory and final files retain the guarded webroot UID/GID and exact 0755/0644 modes;
both publication paths re-read that identity under the owned lock before mutation.
App publication preserves the exact set across webroot replacement and verifies the
final `dist`+model union, including type, owner, group, and mode. Neither operation can
silently delete unexpected model-prefixed content. The bounded post-upload Node
verifier first uses fixed-target SSH `stat`/`sha256sum` for full remote byte and
filesystem identity, then uses HTTP only for transport evidence: HEAD, range,
unsatisfiable range, and matching/stale `If-Range`. It reads exactly two successful
one-byte bodies per shard, bounds the 416 body, and cancels a stale validator's full 200
body before reading bytes. D-131 makes the HTTP contract response-specific: full 200
requires byte-range advertisement and the complete successful-object headers; 206
allows `Accept-Ranges` to be absent but binds its exact partial representation and
stable strong ETag; 416 binds only the unsatisfied range, bounded body, and no-cache
semantics, preserving nullable or error-specific metadata. This is source/transport
evidence, not an installer, browser, or performance gate. D-132 retains the corrected
production run as passed for all five exact resources and all 25 bounded requests
without downloading a full model representation.

### Crash-safe OPFS release store (D-129)

All installer-owned state is below `parallax-install-v1`; the store never traverses or
removes saves, `parallax-streaming-v1`, or `parallax-model-cache-v1`. Content is
hash-addressed in physically distinct common and `games/parallax` namespaces. Release
directories contain the exact D-128 manifest plus immutable staged/ready/published/abandoned
records. Abandonment is terminal and permitted only before ready; ready, committed,
active, and previous releases reject abandonment. Once abandoned, release-scoped
resource lookup and integrity verification also reject, including stale references
obtained before abandonment. Partial resources retain the two newest append-only offset
checkpoints. Commit records use unique increasing filenames;
active/previous selection is reconstructed from valid eligible commits, not a mutable
pointer. The newest 64 ordinals plus active/previous anchors are retained. An immutable
published marker distinguishes obsolete published releases from ready-but-unpublished
content after older commits are compacted.

One origin-wide exclusive Web Lock serializes every mutation/reconciliation. A partial
append is durable for resume only after its exact bytes are flushed and its schema-v2
checkpoint record validates the exact strong ETag. A legacy v1 checkpoint has
insufficient source identity, is removed, and conservatively truncates the partial to
zero. Recovery truncates beyond the last valid checkpoint. Finalization
incrementally hashes the exact partial, invalidates any prior marker, copies and flushes
the published object, then re-reads and hashes those exact published bytes before
creating its immutable verified marker. A successful returned object reference is
therefore the store's new-object verification boundary. Failed or missing full
verification also removes the marker, so an exact-size interrupted rewrite cannot retain
authorization.
Ready never auto-activates. Rollback is another commit. Bounded,
deterministic garbage collection preserves active, previous, and non-abandoned
in-progress roots. Its entry limit is a mutation budget shared by published-marker
repair, commit pruning, and object/release removal; removal counts/bytes and remaining
work are exact. Reconciliation accepts the same explicit cleanup budget, including
zero, and returns cleanup mutations, removals, bytes, and remaining work. Startup may
trust a valid marker plus exact object size; streaming full verification re-hashes bytes
and reports corruption for the later repair executor.
Repair-eligibility records that bind or purport to bind the unique newest commit remain
strict fail-closed authority, including torn records at that release path; ambiguous
newest-commit authority is retained and rejected. Superseded, orphaned, torn, and
manifest-less non-current repair records are deterministic reconcilable garbage under
that same explicit cleanup budget, with their removals included in its exact counters.
A durable current repair record independently withholds release eligibility before its
verified marker is removed. Reconciliation validates all current-authority claims before
mutation; marker revocation then consumes and reports one removal mutation plus its exact
entry/byte counts. A zero budget retains the marker and reports remaining repair work.

The live inventory is initialized and repaired by a recursive authoritative refresh at
open/restart, explicit reconciliation, garbage collection, and exceptional recovery
boundaries. It is not recomputed after each chunk. While holding the same store lock,
begin/append/discard/finalize update only the affected partial and verified-object
entries and adjust their aggregate byte/resource/checkpoint/ETag counters. Staging and
ready publication similarly update their exact release sets. This makes ordinary
checkpoint and resource finalization work proportional to the local mutation rather
than to accumulated store inventory. Final release verification remains a deliberate
full read and publishes monotonic phase, verified-byte, verified-resource, and exact
total counters; a release cannot become Ready before the phase reaches `complete`.

Ordinary runtime admission is an active-only validation boundary (D-144), not a
rollback-selection refresh. It walks commit ordinals newest-first until one
unambiguous eligible active release is found, validates and caches only that release's
manifest and OPFS objects, and does not overwrite the active/previous telemetry pair
with an incomplete selection. Full active-plus-previous validation remains at
publication, rollback, reconciliation, and garbage-collection boundaries. This removes
the earlier ordinary-launch behavior that repeatedly scanned the complete previous
release solely to rediscover rollback metadata.

This is the OPFS asset-release boundary, not whole-application activation. D-138's
implemented shell/service-worker coordinator establishes exact shell/release
compatibility before ordinary Launch admission. D-129 deliberately does not migrate the pre-M2 streaming/model consumers,
fetch resources, request persistence, or instantiate the store on the app main thread.
D-133's eager dedicated worker now instantiates it. At the D-138 boundary, public
telemetry v33 forwarded live install-store v3 plus installer-transfer v3 snapshots,
including final full-release verification progress.

The separately triggered browser-adapter qualification is
`pnpm harness:opfs-release-store-adapter`. It uses pinned visible Chrome with a fresh
disposable profile and the real release store: small stage, split append/checkpoint,
first finalization, ready, publication, reopen, reconciliation, and full verification
of a synthetic one-resource staged release.
Two worker-owned store instances must also serialize through the adapter's hard-coded
Web Lock, and a queued store must proceed after the owning worker terminates. Each
contender acknowledges immediately after submitting its lock request; the runner waits
for that acknowledgement before its quiet-window assertion or owner termination. The
runner retains pending then passed/failed machine-local JSON plus a human-readable report
with exact browser, imported build-artifact, recorded production build-manifest release,
and source identities. That production release identity is result/build provenance; the
OPFS lifecycle stages only the synthetic one-resource release above. It is adapter
evidence, not a power-loss or D-097 gate.

The retained result
`harness/results/opfs-release-store-adapter/adapter-v2-2026-07-29T03-23-51-061Z.json`
(JSON SHA-256
`370a724f18d9aec361cc9de93636c588b3965e62cd284fdcfe508534a35005fd`;
Markdown SHA-256
`7a8fd5c8f76cc0e8e4d72952ade3e29eb7534b480c2b88bef519800f4d4083c3`)
passed in 1.728 seconds on Chrome 151.0.7922.34. It proves only the small real-OPFS
split-checkpoint/resume lifecycle through first finalization, verification,
ready/publication, reopen/reconciliation/reverification of that synthetic one-resource
release, fixed Web Lock exclusion across workers, and queued progress after owner
termination. The adapter/store implementation was imported from the exact recorded
D-129 build; the recorded production `releaseDigest` is build/result provenance, not
the synthetic staged release's digest. It does not prove
power-loss or browser/OS-crash behavior, torn real writes, multi-GB transfer, network,
quota, persistence, real update/rollback, production behavior, performance,
registered-environment identity, or D-097 qualification.

### Dedicated installer transfer worker (D-133, accepted)

At the D-133 boundary, build-manifest v13 added the exact fifth `installer` worker role. The eager main-thread
service owns only typed request/response correlation and live snapshot forwarding. It
always targets same-origin `/build-manifest.json` and provides no production URL or
transfer-policy injection. Browser network, OPFS, hashing, quota observation/probe, and
the install state machine remain in the dedicated worker; app-shell UI strings remain
outside the engine.

The whole install operation holds `parallax-installer-transfer-v1`. D-129 store calls
continue to acquire `parallax-install-store-v1` only around each short mutation or
inspection. These locks are never nested, and the store lock is never held during a
network wait. A second installer therefore queues without transfer progress while
ordinary store snapshots remain available between mutations. Worker termination
releases the transfer lock through Web Locks' callback/agent lifecycle.

The transfer executor links every bounded-concurrency resource task to one operation
abort signal. A primary resource failure or owner cancellation aborts sibling
fetch/body work and the executor waits for every sibling, including any already-running
short store mutation, to settle before it rethrows or permits the operation lock to
leave scope. Store checkpoints and HTTP resume share one strong-validator predicate:
quoted 1–1,024-character ASCII `qdtext` only, with weak, empty, escaped, `obs-text`, and
overlong validators rejected before body consumption.

The D-133 worker independently fetched and validated build-manifest v13 and the exact
install-manifest v1 bytes/digest. The relative install-manifest entrypoint resolves
beside the fixed root build-manifest URL, never beside the hashed worker URL. The same
canonical build root is the base for every relative transfer source, so
`synthetic/...` and `immutable/...` each resolve from `/` exactly once. The worker then
stages the release, plans missing/reused/partial
resources, performs estimate plus a bounded flushed quota probe, and transfers only
`target: opfs`. Every request is a range request from its durable offset; resume
requires the checkpoint's exact strong `If-Range`. Exact 206 and defensive exact-end
416 are the only accepted representations. For a resumed request, a 200 fallback or an
otherwise strong 206 ETag change is cancelled before body consumption and permits exactly
one stale-partial discard plus restart from zero; another mismatch is terminal. Other 200
fallbacks remain terminal. Complete fixed-size chunks cross D-129 append/flush/checkpoint; cancellation
discards only the in-memory tail and waits for any current store mutation to quiesce.
D-151 removes installer-transfer's redundant immediate `verifyObject` after
`finalizePartial` returns a newly published reference: the sole store has already
validated the exact partial hash, copied and flushed it, reread the published bytes by
exact hash, and written the immutable marker. Preexisting/reused object references still
receive `verifyObject`, and activation still runs complete `verifyRelease` before ready
marking and publication. This narrows duplicate work without weakening either corruption
boundary.

An explicit Repair request additionally carries the exact release digest admitted by
the app shell. After rediscovering the live target, the worker compares that identity
to the request before repair staging, admission, quota work, or transfer. A mismatch is
the typed `repair-target-mismatch` target failure. Operation failure responses and
installer-transfer telemetry bind the expected Repair digest independently of nullable
current-release telemetry and identify whether the failure source is `operation` or
`session`; the app retains Ready authority only for a correlated repairable failure of
the same admitted release.

The request timeout is a bounded network-idle deadline: it spans fetch through the first
body byte, is paused while local checkpoint work runs, and is re-armed for every subsequent
pending body read. Before validating the remaining envelope, the protocol consumes every
readable positive safe request ID and rejects non-increasing IDs within one worker lifetime,
concurrent installs,
stale cancellation, post-disposal requests, and unreadable worker messages. Fetch and
selected transient HTTP failures use three total attempts with fixed bounded delays;
response-contract, validator, encoding, range, and integrity failures are terminal.
InstallerService disposal closes its public work boundary synchronously, rejects callers
already awaiting non-disposal or persistence responses, and retains worker correlations
as draining only until their parsed terminal response or the worker's disposal acknowledgement.
Draining responses remain strictly parsed and correlated but cannot resettle callers or
apply ordinary live-result telemetry checks. Persistence is still invoked synchronously
for user activation; its tracked caller promise absorbs a late platform settlement after
disposal. Repeated disposal shares one promise.
Manifest exact-key validation and durable install-store record canonicalization reject
ill-formed UTF-16, then order valid strings lexicographically by Unicode scalar value.
Production uses concurrency 1 and an 8 MiB checkpoint, selected by D-133's reviewed
nine-cell visible-Chrome calibration. Its predeclared contract used one warmup plus
three round-robin measured trials per cell, rejected a cell above 10%
ready-throughput relative range or with any correctness/protocol failure, and
independently recomputed the lowest-concurrency/smallest-checkpoint selection among
passing cells within 5% of the best median. c1-mib8 measured 16,472,212 B/s median
with 4.12% range and met that rule; concurrency 2/8 MiB and concurrency 4 at 4/8 MiB
failed repeatability despite zero correctness/protocol failures. The result calibrates
only this bounded synthetic transfer policy; browser interruption/lock qualification
remains a separate D-133 gate.

Live installer protocol, installer-transfer telemetry, public telemetry, smoke,
flythrough, and render-recovery versions are defined only by their exported constants
in `engine/src/install/installer-protocol.ts`, `engine/src/telemetry/telemetry-export.ts`,
and the corresponding `harness/src/*-run.ts` contracts. Historical D-NNN paragraphs
below retain the versions at their named decision boundary; they are not live-version
declarations. Mandatory metric sets and thresholds are unchanged.

D-134 adds the eager installer realm to the harness's all-realm JavaScript-heap
topology. At the D-134 boundary, a shared pure resolver consumed build-manifest v13 and required exactly one
distinct `decode|installer|render|streaming|wasm-thread` entrypoint, and supplies the
sampler with exactly installer, render, streaming, and the runtime telemetry-declared
number of decode-worker URLs. The diagnostic wasm-thread entrypoint is validated but
is not a steady-state target. CDP target validation remains exact: any missing,
duplicate, unexpected, or extra page/worker target invalidates the metric. This changes
only smoke/flythrough evidence schemas (v55/v22); the runtime topology and heap budget
are unchanged.

### Installer shell and bounded launch gate (D-135)

The page entrypoint eagerly creates only the installer service and mounts a
dependency-injected shell controller. The prior app startup is a separate
`bootRuntime()` operation; render, streaming, decode, game, benchmark, and public
telemetry services do not start on an ordinary navigation. Install/Retry directly
requests persistence through the main-thread engine service before its first await,
then invokes D-133's installer. Persistence denial is a visible degraded-durability
state, not an install failure.

The shell presents accessible live status, exact byte categories, current resource,
Cancel, Retry/Resume, typed quota/integrity/transport/contract failures, and Launch.
Only an exact `install-complete` result supplies the release digest and unlocks Launch
during the installing page lifetime.

Worker transfer counters are lifetime observability, so the controller captures an
attempt baseline and renders only operation deltas; plan/reuse totals remain zero until
the current attempt reaches its post-plan states. Terminal fail-closed worker or
runtime-boot errors disable retry and expose Reload, while recoverable transfer,
integrity, quota, validator, manifest, and persistence failures retain Retry/Resume.

Privileged runners temporarily preserve the old runtime path with the exact
`parallaxAutomation=runtime` query plus WebDriver attestation. That route is not
accepted for ordinary navigation and is removed or narrowed again when lifecycle
runners drive the real shell.

### Verified release publication and reload discovery (D-136)

The installer worker now closes the durable release transaction while it still owns
the whole-operation transfer lock. It compares transferred byte/resource totals with
the exact install-manifest OPFS summary, re-verifies the complete staged release,
marks it ready, publishes it, and requires exact active-selection identity before
emitting `install-complete` or terminal `ready`. Cancellation is observed before and
after full verification and after ready marking; publication is the final short commit
after those checks. Cancellation that arrives after the commit boundary reports that it
was too late; the shell then reconciles exact target status and preserves typed
publication/status failures. Terminal completion is cross-checked against the same
request's ready counters and the transfer/store active digests. At the D-136 boundary,
installer-transfer telemetry v2 recorded this stronger ready meaning and public telemetry was v30.

At the D-136 boundary, installer protocol v2 added an exact current-target query. It validates the current
same-origin build/install manifests through the same canonical root used for transfer,
then compares their `releaseDigest` with the store's eligible active selection. The
app sends its loaded content-addressed entry-module path with both install and status
requests; production requires the full SHA-256 filename to match the exact artifact in
the target build manifest. A deploy racing an already-open page therefore produces a
terminal shell-incompatible/Reload state rather than mixing old code with a new active
release. The app shell checks current-target status on ordinary reload and unlocks
Launch only for an exact match. Target discovery is bounded to 30 seconds even when its
underlying operation never settles, and transport, response-validator, manifest-shape,
integrity, and loaded-shell failures retain typed recovery.
D-146 makes the two controlled target-document requests network-first with one exact
request marker. The service worker permits fallback to its independently verified
selected shell generation only when the network fetch rejects with `TypeError`; a
network response of any status wins, and every other shell request keeps its existing
cache policy.
This is a fast metadata/eligibility gate, not a multi-GB rehash: consumers validate
exact stored resource references when opening them. The shipped installer repair executor
performs separately authorized resource re-fetch and full-release verification, while
D-137's ordinary runtime consumers use the exact installed OPFS release. At the D-136
boundary, smoke/flythrough/render-recovery reports were v56/v23/v19 with unchanged metric
sets.

### Exact installed runtime consumers (D-137)

Ordinary Launch is a release-coherence boundary, not just a transition from installer
UI to renderer UI. The controller passes D-136's admitted `releaseDigest`; the runtime
requires it to remain the store's exact active selection and completes two preflights
before starting any runtime service:

1. Resolve the exact District 1 index and bind every indexed world-cell source,
   byte length, and SHA-256 to one game-specific immutable object reference.
2. Resolve the five exact pinned model shards to common immutable object references.

Both paths reject missing or mismatched manifest/reference identity and have an
explicit zero network-fallback contract. The object store's verified record and
current file length are validated on reference open; this is intentionally distinct
from the later explicit multi-GB full-release rehash/repair operation.
Initial admission reads the active selection and exact self-authenticating manifest in
one release-store lock operation. Model resolution then completes before streaming
resolution begins; Launch rejection is therefore quiescent, with no sibling OPFS
operation left running before retry. The final main-thread admission check is another
single locked selection-plus-manifest operation. Ordered batch object resolution reads
and validates the manifest and staged record once, indexes its OPFS resources once,
then validates each requested object marker and size without reparsing the manifest.

The streaming worker repeats the active-release and index/cell validation in its own
realm, then creates sync access handles directly for the release-store object paths.
After every handle opens, it performs one final locked active-selection plus manifest
admission before creating the decode pool or scheduling residency. Drift closes all
opened handles and fails the worker. That successful check defines worker launch
admission; a later update may change the active selection without invalidating the
already-running immutable release.
The installed branch cannot call `fetch`, provision content, or touch the legacy
`parallax-streaming-v1` directory. The old build-manifest/index/cell fetch and streaming
cache branch is typed as `privileged-legacy-network` and is reachable only after the app
accepts D-135's WebDriver-attested exact automation query. At the D-137 boundary,
streaming telemetry v10 recorded either an installed digest with positive installed resources and zero legacy
requests, or the privileged legacy mode with no installed identity.

Installed index parsing accepts only ordered finite positive district bounds, positive
cell size, canonical unique material records with normalized finite RGB, exact cell
entry keys and identities, and unique non-negative coordinates whose derived X/Z cell
extent remains inside the district. Resource source/size/hash binding is applied only
after that structural validation. The schema-v2 index has exactly seven top-level keys:
`bounds`, `cellSizeMeters`, `cells`, `districtId`, `materials`, `resources`, and
`schemaVersion`. Engine-owned identity helpers bind each `[x,z]` to its padded coordinate
token, generator cell ID, content-hashed immutable filename, and install resource ID. Build
generation/classification, independent manifest/benchmark validation, and the runtime
consumer use that helper so a same-length swap cannot preserve semantic identity.

The installed model source resolves and reports the exact shard set during Launch.
D-162's ordinary lazy dialog caller consumes that release-bound source through wllama's
blob API; D-096's URL-driven runner remains privileged measurement apparatus and is not
the game path. Authored non-AI behavior remains the game-design fallback for an optional
AI feature; it never substitutes network or stale cache content for a failed installed
model contract. The model-source snapshot remains public alongside the streaming source
identity, and D-162 adds a direct ordinary-dialog snapshot without changing the combined
public envelope.

**Quota reality (checked 2026-07-11, web.dev/articles/storage-for-the-web + MDN):** a
Chromium origin may use up to ~60% of **total** disk size (not free space), and
`navigator.storage.estimate()` can report quota exceeding actually-writable free space.
The installer treats space checks as **best-effort preflight** (estimate + a small
probe). No probe proves the ≥100 GiB architecture floor: D-148 accepts that boundary
through a size-independent manifest/data-contract model, not a completed install.
Actual writes remain incremental, resumable, and `QuotaExceededError`-aware; quota
errors and `persist()` denial are designed flows, not unexpected failures.

### Offline shell generations (D-138)

The install/launch promise requires offline navigation, which the HTTP cache does not
guarantee. The stable root-scope module service worker owns cache-first shell delivery,
but its browser lifecycle is deliberately separate from the release transaction:
`install` only calls `skipWaiting`, `activate` only claims clients, and ordinary
app-shell target refresh/install completion explicitly requests generation preparation.
The privileged automation branch never registers the worker. The worker itself grants
no authority from the automation query or client URL: an already-controlled automation
page may receive exact selected shell resources, while non-shell legacy runtime
requests fall through normally.
Explicit preparation checks the current target when reachable, while an initial network
failure can reuse only the fully reverified active generation matching the loaded app;
a reachable invalid target fails instead of falling back.

A generation contains exact artifact/release digests, app/engine/service-worker
identities, build/install/save schema versions, the two manifests, and every
install-manifest `shell` target. OPFS targets never enter Cache Storage. A dedicated
prepare-owner Web Lock serializes complete preparations, while the origin-wide
selection Web Lock protects only short plan, candidate-metadata, activation, and
rollback transactions. Network transfer, Cache Storage population, and full-generation
verification run outside the selection lock, so existing-generation dispatch remains
live. Candidate metadata precedes population; final activation revalidates the planned
active/previous identities, exact candidate identity, and verified bytes before one
strict-durability IndexedDB commit. A target already authorized as active or previous
is verified and reused without deletion or repopulation. Failure cleanup deletes only
an unselected transaction-owned generation after revalidation. Third-generation
selection durably commits C/B before best-effort obsolete-A cache deletion; selection
failure preserves B/A, while GC failure leaves an unreachable orphan. Fetch never
searches across caches.
Destructive uninstall acquires install-store, prepare-owner, then selection authority
and holds all three across the complete teardown, so it cannot interleave cache or
IndexedDB removal with an initial fetch, population, verification, or activation.
Missing/corrupt active responses
trigger exact compatible-previous verification and atomic rollback; incompatible or
unavailable rollback fails closed.

Installer transfer requests are distinguished by the existing strict same-origin GET
plus `Range` contract. The service worker sends those requests directly to the network
so a selected cached shell `200` cannot replace the installer's required `206` or
completed `416`; ordinary non-Range shell requests retain exact cache-first delivery.
The original manifest source URL, release identity, Range, and If-Range headers remain
unchanged across that pass-through.

Navigation maps to the selected generation's `index.html`. Every cached response is
same-origin and bound to exact path, length, SHA-256, MIME, cache policy, COOP, COEP,
and `nosniff`. Cached build/install manifests keep D-136 target discovery available
offline; Launch still requires that selected shell release, target release, and
D-137's exact active OPFS release match. Ready binds the exact shell generation and is
invalidated by exact-worker cross-client selection notifications. Launch re-queries the
active target without another full shell pass; runtime performs OPFS preflight and one
locked full `admit(expected)`. That successful admit is the immutable loaded page's
boundary. Pre-admit authority remains abortable across the whole OPFS preflight and
locked admit, and the boundary is published only after both complete while that
authority is current. A later selection affects the next navigation and does not revoke
running code; `runtimeStarted` is only a local marker. Registration explicitly awaits
`registration.update()` within the request bound while online. An offline network
`TypeError` may reuse only the exact activated root worker when it is already the
registration's active worker and the page's controller; every other update failure,
pending replacement, or control mismatch fails closed. Registration waits for the
newest worker's exact activation and exact identity as the page controller, installs
permanent exact-source/state/controller listeners before its final checks, and
invalidates stale endpoints plus Ready/pre-admit Launch authority on controller/state
change. Each endpoint also synchronously checks exact current control immediately
before posting and accepting a response, so a queued controller-change event cannot
create an authority window. Successful locked admission remains the immutable-page
boundary, so later controller replacement applies only to the next navigation.
Per-request IDs, timers, and ports isolate overlapping requests. Offline-shell
telemetry v2 makes cumulative verified bytes/time and verification-duration high water
observable through public telemetry. The separate fresh-profile visible-Chrome adapter
requires exact fresh idle, drives ordinary Install through real transfer, verification,
install-store publication, terminal ready, and UI states, binds the manifest-declared worker and
canonical generation to the UI's enabled Launch state online and after offline reload,
and then performs the bounded offline/isolation checks. Its exact local transport
preserves original manifest paths/digests while supplying strict Range/If-Range
responses. Result JSON and Markdown are reserved together as create-only,
token-owned placeholders under a bounded timestamp-suffix search. A partial pair is
never path-deleted: each still-owned member becomes `reservation-abandoned` evidence
through its retained handle and is closed, while a replaced path is untouched and fails
the reservation. The owned record is constructed immediately after `wx+`, before the
first handle stat, so even identity-construction failure retains truthful abandoned
evidence and a closeable handle. Partial close retries are bounded to still-open handles,
retain every failure, and keep the owners reachable through a final direct close.
One exhausted invocation retains at most 100 such bounded orphans.
Every subsequent write verifies the same token on its retained create-exclusive handle.
The pair records distinct BigInt
`dev`/`ino` identities and requires each handle and pathname to remain the exact same
regular, non-symbolic, single-link file before and after every write. Only create-time
`EEXIST` advances the suffix; other create failures stop immediately, and partial
cleanup aggregates the primary plus all cleanup failures. Partial terminal publication
restores both owned
artifacts to a matching `finalization-failed` state before failed-result publication,
while an unrecoverable ownership-state write identifies its logical result path and
never modifies unrelated bytes. Handle close is tracked independently for both files;
all still-open handles are attempted on every close, failed closes alone are retried,
and a reopened handle is never dropped when validation and close both reject.
`passed` returns only after both closes succeed. A close failure restores
`finalization-failed` while recoverable identity-bound handles remain, and the runner
unconditionally closes in `finally`. Pending/failed setup
records exact model validation/link counts and bytes and cannot claim
`hard-linked-exact`; that state is pass-only after complete serving setup. Failure
evidence preserves one bounded/redacted primary item, every cleanup item with operation
and logical path, and all possibly remaining logical paths identically in JSON and
Markdown. Cleanup still attempts the server, serving tree, and profile independently.
The adapter is not part of deterministic or D-097 gates.
Interplay with the V8 code cache remains measured rather than assumed.

The shell-serving JavaScript representation is exactly
`application/javascript` across the pinned nginx types table, ordinary local server,
deployment verifier, generated resource descriptors, and cache validator. Validation
compares the lower-cased MIME essence, so parameters such as `charset=utf-8` do not
create false drift, but another JavaScript alias does. The retained adapter-v2 failure
proved why these surfaces must compose. Adapter schema v4 exact-validates and
cross-validates the failure-time UI, raw installer/store/transfer/offline-shell
snapshots, transitions, service-worker requests, controller/registration, page, and
best-effort service-worker diagnostics under explicit byte/redaction bounds. Unknown,
oversized, or contradictory observations become typed collection failures. Its
partitioned rolling event capture preserves late failures, controller changes, and
terminal checkpoints under request volume. The server journal retains a complete
canonical response population with multiplicity and full expected/observed/missing/
unexpected path sets for all 283 install resources. Range/failure populations,
status/count summaries, path-set digests, and truncation are exact projections of that
retained population. A separately retained monotonic full response sequence and
canonical order digest produce exact filtered Range/failure subsequences; every
rolling tail must be the exact ordered suffix of its sequence, including duplicates.
`passed` requires complete exact coverage with no missing, extra, or failed response.
Terminal Markdown carries and
independently validates one canonical base64url/SHA-256 binding over terminal state,
diagnostics, failure diagnostics, and server journal.
Failure evidence is a phase-discriminated union rather than one assumed app state:
offline-shell preparation/control failures bind reload-only shell telemetry; installer
failures bind exact transfer/store/persistence telemetry and retry/reload button
authority; runner-online inspection failures retain the exact preceding Ready
authority without inventing an app failure; and offline-reload validation failures
bind that Ready UI/button/store/transfer/shell/release/generation projection plus the
current controller/shell snapshot. Offline reload must either preserve the exact Ready
projection or retain a failed transition immediately preceded by a failure-free
checking transition with the next sequence number, the same strictly positive adapter
attempt, and the exact generation. Attempt zero remains pre-attempt context only.
Intervening or cross-attempt state, arbitrary checking, and
unavailable state are rejected. The harness pins the wire enums independently of
producers.

The retained schema-v3 run stopped at its fixed 600-second Ready bound while ordinary
installer counters still advanced and transport remained error-free. Schema v4
therefore observes one monotonic progress tuple spanning downloaded, checkpointed,
verified, completed-resource, and final-release-verification counters. A strict
120-second gap without tuple progress fails as stalled; duplicate events, state churn,
and regression do not reset it. A separate 30-minute absolute ceiling fails even under
continuous progress, and a terminal app failure fails immediately with bounded
sanitized cause evidence. Persistence denial remains eligible only with the exact
degraded-durability warning and no durable-state claim. Both result formats bind the
configured bounds, observed maximum and last gaps, final tuple, and terminal
classification. This is an adapter correctness/evidence boundary, not added install
budget: actual bandwidth plus at most 90 seconds local work remains the performance
contract.

Schema-v4 observation reads are themselves part of that boundary: each read races
independent stall and absolute timers, exact-boundary completion loses to the deadline,
and timeout aborts/ignores the late evaluation with all listeners/timers removed.
Failure causes share one canonical sanitizer that removes local paths, URL
credentials/query data, and secret/token/user fields; retained validation recomputes
the sanitized form. The install store keeps one session-scoped exact-digest validated
manifest/resource map under its existing lock, so checkpoint/finalization work does
not reread, hash, parse, or linearly search the manifest. Reconcile, selection change,
GC, exceptional recovery, and reopen invalidate it. Exceptional integrity or durable
mutation failure authoritatively refreshes live inventory and active/previous
selection before failure is exposed. Installer protocol and adapter diagnostics also
require the store and transfer to agree on all five final-verification fields; Ready
requires their complete byte/resource totals to equal the release totals.

The retained schema-v4 lifecycle reached exact Ready and completed online/offline
inspection, but terminal evidence validation failed because a typed leading-slash
same-origin server-response URL path flowed through generic POSIX local-path redaction.
That field now has one narrow shared sanitizer/validator: only a bounded canonical
same-origin pathname without authority, credentials, query/fragment, backslash,
controls, dot/encoded traversal, unsafe decoded separators, or noncanonical encoding
is retained verbatim. Every other event field remains generic-redacted, and arbitrary
fields cannot use the exception. Terminal validation reapplies the same field-aware
contract. Diagnostic recorder close is single-attempt even when the first close fails;
the primary is retained once and only a distinct actual cleanup-close failure is added.

Asset placement is benchmark-driven: if the harness shows a class of data loads better
from Cache Storage than OPFS, move it and record the numbers in the decision log.

## Install / launch / run lifecycle

The M2 shell makes lifecycle authority and timing explicit. `launch-lifecycle.ts` owns
one launch attempt and records ordered installed-release preflights, shell admission,
streaming-worker request/Ready, the first rendered frame, and the final interactive
duration. `shell-launch-authority.ts` brackets the final locked offline-shell admission
with revocation checks, so a controller or generation change cannot complete a stale
launch. `destructive-lifecycle-gate.ts` is the shared one-way page-lifetime lock: once
uninstall starts, install, retry, launch, and another uninstall remain disabled until
reload.

The engine uninstall service supplies the client-side destructive operation. It
requires one controlled client while holding install-store, shell-prepare, and shell
selection authority; inventories and removes service workers, Cache Storage, IndexedDB,
and OPFS; performs two stable-empty rechecks; and reports before/after quota observations
plus typed failures. The separately confirmed `POST /uninstall` path remains the direct
network `Clear-Site-Data` mechanism. D-147 accepts both mechanisms and explicitly leaves
HTTP, V8, and Dawn cache eviction unproven where Chrome supplies no origin-scoped
observation.

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
   repairs by re-fetch-by-hash; saves are never touched by asset reclamation. Save export
   remains an explicit unshipped limitation and its uninstall control stays disabled;
   destructive confirmation therefore does not claim an export was made. Disk-full and
   interrupted-update fault injection are harness lifecycle tests (M2).
2. **Launch (every boot):** integrity/version check against manifest → progressive PSO
   warmup from trace → resident-set preload for the player's saved location → gameplay.
   Warm-launch performance is gated on the outcome, not the cache mechanism (D-051):
   warm launch must land within the budgets.md ≤ 10 s budget, with the complete in-app
   lifecycle measured by `launch-to-interactive@3`. That boundary requires the
   simulation worker to be requested and running in addition to shell admission,
   streaming readiness, and the first rendered frame. The evidence classes differ and
   must not be conflated: **V8 code-cache lifecycle** (wasm via the current
   `compileStreaming`-then-worker-transfer path and stable URLs) is best-effort,
   non-gating diagnostics —
   anomalies are findings, not gates, and absence of re-production is not proof of a
   cache hit — while **Dawn pipeline/cache evidence stays mandatory** in the smoke
   metric registry, and zero runtime pipeline/shader compiles during measurement remain
   blocking budget gates (D-051 kept both).
3. **Run:** streaming manager keeps the resident set inside the memory budget as the
   player moves; eviction is proactive, never emergency.
4. **Update:** manifest diff → fetch changed assets only → invalidate affected warmup
   traces. The former "asset-only update never invalidates the wasm/JS code caches"
   mechanism goal was replaced by a performance contract (D-051): post-update warm
   launch stays within the ≤ 10 s budget and the paired pre/post delta is recorded;
   cache-lifecycle evidence remains best-effort diagnostics. D-151's accepted
   `asset-update-v8-lifecycle@3` runs initial install, fresh/produce/pre-warm,
   publication and transfer of an exact non-executable-only diff, post-warm, and
   post-update diagnostics in one persistent profile. It requires unchanged executable
   identity, exact changed/unchanged resource sets, exact download/reuse and complete
   final-verification totals, and matching target/store/offline-shell/Ready/Launch
   authority before passing. Against exact base artifact/release
   `e4532dcec4d615501d2130425571c5d3e1128331187dcfd7ef92f99e4f44351b` /
   `be1a7f53c1b74a1aad1638cab5291fdc95bc7fdcba27f63604111efb4469a96e`,
   initial install took 99,359.9553 ms. Its 21,286.798001527786 ms exact installer-worker
   network-active union leaves 78,073.15729847222 ms of local critical-path residual,
   within the unchanged 90-second allowance; final-verification's first-observed span
   was 16,232.9675 ms under 20 ms polling. Fresh launch measured 5,821.355 ms, and
   pre/post warm launches measured 9,157.250/5,681.140 ms (−3,476.110 ms). No relative
   threshold was calibrated, so it remains unset. V8 trace, cache, and production
   diagnostics retain their exact measured/invalid states; they remain best-effort
   observations, not cache-hit proof.
   New runs use `asset-update-v8-lifecycle@4`, whose fresh/pre/post launch records
   embed `launch-to-interactive@3` and the six-role release topology. The validator
   retains D-151's v3 artifact only through an exact v3 / launch-v2 / five-role path;
   historical evidence is never upgraded in place.
5. **Uninstall (user-initiated, D-024):** a native-title lifecycle removes cleanly, not
   just installs. The shell offers uninstall behind an **explicit confirmation** that
   states what is deleted (installed assets, caches, service worker, saves). Save export
   is deliberately unavailable in the current shell, and its disabled control makes that
   limitation explicit. Two mechanisms, both built and
   measured in M2: (a) client-side teardown — service-worker unregister, OPFS clear,
   Cache Storage + IndexedDB deletion, then quota-release verification via
   `navigator.storage.estimate()`; (b) an explicitly confirmed same-origin `POST`
   navigation to the static `/uninstall` endpoint, which the service worker must leave
   unhandled and whose response carries `Clear-Site-Data: "storage", "cache"` (an nginx
   location block — stays within D-011's static-serving preference). What each actually clears
   (OPFS? V8 code cache? Dawn/shader caches? HTTP cache?) is measured, not assumed —
    gaps go to rough-edges.md. The app-owned model is part of Parallax's OPFS install and
    is removed by this lifecycle.

D-145 defines the qualifier boundary around product invariants and bounded raw
observations; it does not turn diagnostic event topology into product architecture.
D-146 accepts the network-first/offline-fallback target authority described above, and
D-148 accepts modeled manifest scale plus the representative compressed-streaming
workload described below. The M2 exit uses D-149's exact dependency/browser checkpoint,
D-150's dev-01-only physical gate, and D-152's comparison-only branded-Chrome parity;
D-153 closes M2 on that bounded evidence without changing these runtime contracts.

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

**D2 greybox v1 (D-174):** the underground district is a Y-up, metre-scaled 1,024 m
square divided row-major into an 8 × 8 grid of 128 m cells. Fixed seed `0x5eedD201`
produces 16 connected traversable cells and 48 sealed-rock cells. A generic repeated
cell-box feature rule supplies corridor shells, the forest turn, arena pillars, ceilings,
and collision AABBs without placing catacomb logic in the generator. Its three LOD
distances are 256/640/1,024 m with 32 m hysteresis; collision uses a 17 × 17 heightfield
per cell at 8 m spacing and does not change with visual LOD. The same N-district build
loop emits D2's 64 cell artifacts and independent content-addressed index.

**World graph v2 (D-174/D-177):** game-owned data registers the surface and underground
districts and three undirected hard-transition edges for castle, village, and forest
contexts. Each edge references two authored transition markers and carries arrival
headings. Build-time validation rejects unknown/duplicate districts, same-district
edges, non-transition or reused endpoints, context/marker disagreement, and any authored
transition marker not owned by exactly one edge. Schema v2 adds a required positive
finite prefetch-trigger distance to every hard edge: 6 m for castle and 5 m for village
and forest at the standard 12 m/s traversal speed (D-177).

- **Intra-district:** distance/visibility-driven cell load/evict with LOD tiers.
- **Inter-district (hard transition):** full resident-set swap through choke points —
  the catacomb entrances (game-design.md), of which there are several with different
  surface contexts; the transition system handles N entrances as data, not one bespoke
  passage. Contract lives in [budgets.md](budgets.md): memory high-water during overlap,
  max hitch, total swap time, and the D-177 measurement-calibrated prefetch trigger —
  applied per entrance. The trigger is the latest preload start before the authored
  boundary, and every measured total must fit inside its distance/speed lead window.
  This is deliberately the
  hardest case and is exercised early with greybox content (M4) because it shapes asset
  packaging and the streaming manager's design.

  D-175 implements the resident transaction as an explicit render/streaming boundary.
  The streaming worker may resolve the destination and open its immutable OPFS handles
  while source handles remain live, but it proactively evicts all nine source cells and
  drains both dependency caches before any destination decode/GPU upload. The render
  worker installs the destination's validated material registry inside the same
  correlated frame window; conflicting shared material IDs fail closed. Normal nearest-
  observer scheduling then establishes exactly nine exclusive destination residents,
  source-only handles close, and telemetry records per-entrance source/destination IDs,
  logical GPU high-water, evictions, total time, frame count, and maximum hitch. The
  game-owned `m4-district-swap@1` scenario is derived from the world graph and exercises
  all three edges in both directions; no engine branch names either district or entrance.

  D-176 makes the transaction boundary race-free and its measurements non-vacuous.
  Admission closes and any executing schedule drains before source residency is
  captured. Completion is an explicit request-correlated worker response rather than a
  telemetry-history side effect. The render worker samples logical GPU high-water on
  every publication inside the frame window, clamps the first interval to window open,
  and reports zero frames as insufficient measurement evidence rather than a protocol
  failure. World-graph resolution, arrival placement, and the one-transition-at-a-time
  guard live in the game runtime; the app shell remains presentation-only.

  D-177 completes D-055's deferred contract element. World-graph schema v2 carries the
  trigger as data; `m4-district-swap@1` v2 models crossing that trigger by starting each
  directed transaction and carries distance plus standard traversal speed into public
  evidence. The engine evaluator fails a sample whose total duration exceeds the
  resulting lead time, independently of the looser 4 s absolute ceiling.

Asset packaging: per-cell bundles, content-addressed, with shared kits/materials
deduplicated across cells. Formats: glTF/GLB, KTX2 (BasisU) textures, meshopt
compression. (Decision D-006.) D-090's procedural descriptors are game world data; the
build-generated canonical cell JSON files are validated greybox library/package output.
Their structural QA gate replaces only Blender-binary-specific checks until M5, not the
asset gate itself. The later streaming task installs and reads these bundles through
OPFS; generating and packaging them does not by itself claim an OPFS cell-load result.

The shipped compressed-streaming layer consumes schema-v2 dependency descriptors from
the exact installed release. Decode workers turn KTX2 into bounded RGBA8 texture data
through Babylon's worker-safe transcoder path and meshopt payloads into finite vertex or
in-range index buffers; malformed size, graph, numeric, or index contracts fail closed.
The streaming worker reference-counts decoded dependency cache keys across resident
cells, while the render worker correlates GPU ownership so a shared resource uploads
once and releases after its last consumer. Encoded/decoded bytes, decode time, cache
ownership, batching, and upload targets remain observable. D-148's scale qualifier uses
this production path and its bounded representative corpus; it is not a literal whole-
inventory materialization claim.

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

D-140 places the post-M2 environment-rendering program behind iterative,
measure-before-adopt tracks rather than preselecting GI, terrain/material, vegetation,
water, post-processing, GPU-driven, or virtual-texturing techniques. An adopted track
must update this architecture and its calibrated budget; the program itself is not an
implemented renderer claim.

**Dynamic lighting is a day-one requirement**, not an optimization decision: the game's
full day/night cycle and weather system (game-design.md) rule out fully-baked lighting.
The renderer is designed around dynamic time-of-day from the M1 greybox onward, and
harness runs sweep lighting/weather states, not just geography.
The first binding is D-100's M1 environment-state sweep: fixed clear, overcast, and
storm-labelled lighting/environment configurations across dawn/daylight/dusk/night.
It deliberately does not implement or claim M6 weather VFX such as precipitation, wind,
wet surfaces, or particles.

M4.5's lighting foundation evaluates one deterministic solar/sky/ground irradiance
sample for the active authored phase and weather state. The render worker applies its
sky and ground irradiance through a world-up hemispheric light and its direct irradiance
through a separate directional sun whose vector records the world-space direction the
light rays travel. A horizon-anchored smoothstep fades direct intensity continuously to
zero while the wider twilight curve continues to drive ambient, sky, and ground color.
The sun remains resident with zero intensity at and below the horizon so
the scene light topology and Standard-material PSO family do not change across the day
cycle. Public frame telemetry exposes the applied sun direction and intensity, and the
greybox-world evidence names the exact no-shadow lighting model; this is an observable
directional-light foundation, not a shadow-strategy or global-illumination verdict.
Directional PCF/ESM, cascaded shadows, local-light shadows, many-light clustering, and
GI remain measured M4.5 candidates.

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

At the D-115 boundary, the public telemetry snapshot envelope was v25, benchmark
section telemetry was v2, and flythrough telemetry was v3, including the explicit
aborted state. The envelope exposes benchmark lifecycle plus
configure/start/reset/result JSON/text methods; reset is awaitable through the public
surface. The completed result embeds the exact
scenario, complete flythrough snapshots, and every environment capture; all captures
retain raw CSS viewport geometry. The retained `benchmark-result@1` schema v3 identifies
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
boundary. D-126 advances the current result/status envelopes to v5/v4 only for their
embedded streaming-v9 snapshot shape. The retained complete schema-v3 reports correctly fail their 10% scenario
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

D-141 makes semantic, serializable sim events the shared boundary for gameplay, UI,
audio, journal, and recap consumers. D-142 binds rules to versioned game-owned data,
randomness to named seeded streams, and state-changing LLM output to validated intents.
The M3.5 combat foundation (D-165) adds a pure integer-math combat core plus a
world-binding combat system inside the game simulation adapter: contested checks on
the named `combat` RNG stream, committed wind-up/active/recovery actions, conditions
and the thermal-shock interactions, monster entities from authored kit data, soft-lock
hit detection, and waystone respawn. The game save schema is v5 and the player input
command is `player.input-axes@3` (movement plus block-held and combat press-edge
bits); monsters publish through the same presentation SAB inside the existing 64-entry
crowd capacity. The same core drives the headless balancer
(`game/src/balance/headless-balancer.ts`), which sweeps reference loadouts × levels ×
bestiary kits over seeded duels in the ordinary unit gate and asserts the
game-design.md balance bands. D-166 advances the game save schema to v6 and replaces
the combat dummy with navigation-aware deterministic creature AI. Versioned kit
profiles and district spawn/pack data drive sight, pack aggro, leashes, synchronous
avoidance/steering, flank/flee/return/yield modes, defender reactions, and boss phases;
all modes, home/pack identity, decision clocks, and boss state serialize with the
combat roster. Existing serialized yaw and vent-cooldown fields also supply bounded
turn/facing commitment and warned vent pulses without a schema change. An encounter
group derived from stable entity/pack identity unifies the boss with its summons,
limits concurrent wind-up/active attackers, and supplies stable authored-rank flank
angles without new per-creature state. The same semantic event stream publishes aggro,
behavior, boss, spawn, hazard-warning, and hazard transitions, while public counters
expose decisions and movement. Slot contention and hazard warnings are explicit
semantic events; a recurring four-creature pressure fixture turns them into slot-wait,
overlap, histogram, and concurrent-attacker measurements for the group dynamics that
the seeded-duel balancer cannot observe. Authored D1 spawns plus the 12-live cap keeps
player + 48 scheduled NPCs + monsters within the existing 64-entry presentation pool.
D-167 advances the game save schema to v7 with classless progression, and D-168 appends
the v8 inventory/crafting/economy block. D-170 advances that payload to v9 with a
canonical named-landmark discovery block. Stable game-owned landmark data resolves to
authored world markers once at adapter creation. Module-load vocabulary checks enforce
the 31-bit capacity, unique IDs/marker bindings, registered districts, and positive
radius/reward values; adapter creation requires exact `landmark` tag parity and a
walkable navigation projection. The fixed step performs squared-distance proximity
discovery, awards each identity once through the shared progression boundary, and emits
both `landmark.discovered` and `progression.experience-gained`. The saved bitset, rules
version, nominal-award counter, `landmarks.snapshot@1` query, and public telemetry are
the exploration foundation that the quest state machines and append-only journal consume.
D-171 advances the payload to v10 by appending a fixed quest block. Stable game-owned
quest, stage, objective, and intent order is persisted identity; a typed reducer advances
reach/collect/defeat/talk/craft/deliver objectives only from validated semantic sim
events and reconciles already-held items or already-discovered landmarks when a stage is
entered. Quest acceptance and state-changing dialog outcomes use the fixed
`quests.command@1` boundary. Stage XP calls the same D-167 progression award path, while
three bounded preparation flags suppress boss vents, yield the authored forest brigands,
or record reliquary insight. The 256-entry append-only journal stores canonical quest
beats and landmark discoveries with localization keys and paginates through
`journal.snapshot@1`; `quests.snapshot@1`, public counters, exact journal/state
reconstruction checks, and landmark-history parity keep the system observable and make
corrupt or drifted saves fail closed.
D-160 resolves D-143's measured UI-substrate spike with a per-surface hybrid. The render
worker owns frame-coherent world anchors and heavy-screen visuals/interactions; the main
thread owns DOM/CSS HUD and dialog. In-canvas screens may use a sparse DOM semantic,
focus, and IME bridge, but never a duplicate visual tree. Sim events and commands remain
the shared authority boundary, so neither UI substrate mutates game state directly.
D-161 implements that split as one typed presentation model: the engine's main-thread UI
service performs keyed DOM reconciliation and owns native form/focus events, while the
render service replays the latest revision to fixed-capacity, tone-partitioned Babylon
Lite mesh pools after initial Ready and recovery. Pointer hit testing and directional
focus for heavy screens stay in render-worker authority; the main thread mirrors the
bounded focus/hit-test state and admits only the exact topmost action expected for the
oldest outstanding input, presentation revision, and monotonically ordered worker
response. The topmost primitive always occludes lower layers, including decorative and
disabled primitives, while only an enabled primitive with an action ID can activate.
Retained presentations are queued to a fresh worker before the main-thread service
publishes Ready, so synchronous Ready listeners cannot overtake recovery replay.
Heavy-screen visibility switches gameplay input into an explicit suppressed
context even before interactive input starts and releases pointer lock; canvas controls
are inert while the render worker is recovering. The sparse DOM bridge reconciles stable
semantic actions, live-region messages, and text-entry forms in place, preserving focus,
selection, unpublished text, and IME composition without creating canvas visual
duplicates. Closing a focused DOM surface returns keyboard focus to the active canvas,
and non-composing Escape remains a worker-owned cancel input from inside the heavy-screen
semantic bridge without intercepting main-thread dialog controls. A failed retryable boot
attempt disposes every created runtime service in reverse order, removes mounted/global
handlers and the telemetry export, restores pristine hidden runtime surfaces (including a
fresh canvas after transfer), and permits a new measured launch attempt before releasing
the latch. UI telemetry
records DOM mutation/node high water, forwarded and completed actions, worker pool counts,
presentation revisions, and update/hit-test duration high water through the public
harness export.
D-172 supplies the first gameplay-system consumers without moving authority out of the
sim worker. The DOM HUD reads public pool/progression counters and makes current-level XP,
unspent choices, and Ironset's planted trade-off visible. Worker-owned heavy screens query
`inventory.snapshot@1`, `progression.snapshot@1`, `quests.snapshot@1`, and paginated
`journal.snapshot@1`; their sparse semantic actions enqueue the existing item,
progression, and quest commands through the gameplay runtime's shared command-sequence
allocator. Successful and rejected semantic events trigger authoritative refreshes.
Because HUD meters and messages revise the presentation continuously (level XP, regen,
the Ironset countdown), a worker action pinned to an older presentation revision is
accepted when the heavy screen it was hit-tested against is action-identical (same
cancel action, primitives, action IDs, and disabled states) to the current one; a
changed or closed screen still drops the stale action silently. Without this rule,
HUD-only churn during the input round trip silently eats heavy-screen activations.
Level gains deterministically refill stamina/aether but not health and emit a dedicated
payoff event; Ironset start/end events make its bounded lifecycle presentable. All four
active and both knack slots are available from level 2 as a level-derived rule with no
additional saved state.
The M3.5 exit follow-through adds a game-owned `m35-gameplay-slice@1` regression
scenario without making the engine aware of game content. The app registers the frozen
version/seed/tick/command-log definition through the generic telemetry export; the
harness retrieves it by ID and sends its ordinary serializable commands through the
existing replay service. Every core smoke launch runs the 8,000-tick slice twice,
requires equal state hashes and save bytes, then loads and re-saves the result through
the live simulation worker. Exact semantic counters prove three monster defeats and
loot awards, vendor inputs, one craft, level 3, and two completed multi-objective quests
before the probe restores the pre-scenario live save. The scenario is correctness
evidence rather than a performance workload; the existing deterministic 120-tick
character/crowd sample remains the simulation-step budget authority.
D-143 identified no application-facing frame transaction or attributed presentation
primitive between the DOM overlay and worker-owned WebGPU canvas; RE-047 keeps the
request open without claiming an exhaustive Chrome capability audit.

## NPC AI

D-096 selects D-074's app-owned Gemma 4 E2B QAT-GGUF model on wllama. WebGPU is the
default placement; CPU/WASM remains an explicit graphics-headroom mode. Persona cards +
rolling summarized memory per NPC use strict JSON-schema output for anything that
touches game state and freeform text only for flavor dialog. Inference contends with
rendering for on-device resources, so the harness measures frame impact during
generation.

D-162 implements the first ordinary caller and conversational greybox seam. One
authored crowd member exposes a persona card, bounded extractive rolling summary plus
four recent turns, deterministic keyword fallback, and a finite intent/subject
allowlist. Interact selects the nearest authored conversational entity in sim authority
and emits only its stable entity ID; the main-thread game controller owns conversation
presentation and publishes validated intents without applying them directly to state.
The engine request reserves an explicit retrieved-context slot ahead of D-033. Dialog
owns gameplay input while visible. Generation telemetry records load, TTFT, token
counts, rejected output, and conservative render-frame batches padded at both edges so
short generations do not disappear between the render worker's 60-frame telemetry
publications. Frame-impact percentiles and maxima describe the latest generation window;
lifetime request/generation/token/failure counters remain cumulative.

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
with M3. The implemented service validates bounded provider output, ranks it
deterministically, admits whole cited entries under the persona's token budget, cancels
with the conversation, and exposes request/candidate/selection/failure/duration telemetry.
The game-owned M3 provider issues a bounded generic query to the sim worker for each
turn. The game adapter answers from authoritative NPC schedule/location state plus
district-keyed, NPC-scoped world-fact data; save/load therefore changes the same state
retrieval reads. Load initiation, terminal sim-authority loss, and service disposal
invalidate in-flight queries and dialog generation; the app closes the conversation and
clears its unsaved rolling memory so a restored timeline cannot inherit future turns.
Persona cards define only query scope and budget, and authored fallback uses the
successfully retrieved structured fact when model inference is unavailable.
Tier 2 (authored-lore retrieval; mechanism open — tag/graph lookup vs.
precomputed embeddings with a brute-force wasm scan) and tier 3 (episodic memory;
needs an app-owned embedder — Chrome ships no built-in Embedding API, checked
2026-07-13) are build-later. Ownership follows the layer rules: `engine/ai` owns the
generic contract (provider registration, context assembly/budgeting, telemetry) and
contains no game knowledge; `game/` supplies the providers, query schemas, and content.
Authored lore already lives as independently addressable tagged game chunks, but no
tier-2 provider is registered. The prompt schema's retrieved-context slot is now filled
by the assembled context, and the service is independent of the selected model placement.

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
