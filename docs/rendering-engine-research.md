# Rendering engine research

The single home for everything the project knows about rendering-engine and
rendering-representation research: the engine decision itself, the sourced case
against each alternative, Babylon's known weaknesses and where we expect to bypass
or replace it, watch items that could reopen the decision, and the state of the
field for the P-002 geometry-representation exploration (§8). It folds in and supersedes the former `why-not-unity.md`
(D-046's evidence pack; relocated by D-076).

**This is a living doc.** When updated information or a correction lands, the stale
content is deleted, not struck through — git history is the archive (D-076). Every
claim is sourced and dated; **re-verify before leaning on any of it in public**
(root AGENTS.md rule 10). Per-section verification dates are noted inline.

**The discipline that makes this doc usable:** it contains only *differentiators*
and honestly-labeled weaknesses. Limits that are WebGPU spec limits bind every web
engine — Parallax included — and citing them against a competitor is a self-own.
They are quarantined in "Not on this list" under the Unity section. Confidence is
labeled throughout: *confirmed* (primary source / vendor docs), *anecdote* (forum
reports, not reproduced), *vendor claim* (self-reported numbers), *absence
inference* (searched, found nothing — not proof).

---

## 1. The decision (D-004, re-grounded by D-046; core updated by D-078/D-080)

**TypeScript + exactly pinned Babylon Lite as scene/material/animation core; WebGPU
exclusively; Parallax owns scheduling, streaming, memory, the frame loop, and the worker
fabric.** D-078 replaced D-004's classic-Babylon component after a same-gate M0
head-to-head; the rest of D-004 stands. Rejected: Unity, Godot, Bevy, from-scratch
(D-004, 2026-07-11) — and, evaluated post-hoc, three.js (2026-07-19; it was not
considered in the original decision, see §4). D-080 removed the spike's classic
comparison adapter: Lite is the sole maintained renderer, not one interchangeable
implementation behind an engine-neutral layer.

Accepted consequence, unchanged since D-004: we hand-build LOD, occlusion/culling,
streaming, and world partitioning. Those systems had to be browser-custom anyway,
and building them *is* the research. Where Babylon blocks a WebGPU feature: fork
locally or bypass, and log the gap.

**Reopen triggers (consolidated):**

- **Unity:** ships **all three** of Memory64/wasm64, managed C# threads (requires
  multithreaded GC in wasm), and a non-experimental WebGPU backend. Any one alone
  does not reopen; together they would.
- **Babylon Lite** (see §7): a pinned upgrade breaks beyond the bounded interop seam;
  M1 asset fixtures, P-002 native interop, or M3 animation expose an unbounded gap;
  or a measured evaluation shows another web-native core materially better on our
  axes. A challenger is evaluated in a bounded spike and, if selected, through an
  explicit migration—not through continuously maintained backend parity.
- **Bevy:** becomes interesting if/when wasm multithreading lands there.
- **three.js:** WebGPURenderer loses its official "experimental" label **and** a
  supported raw-WGSL/raw-pipeline path outside TSL exists **and** the
  worker/OffscreenCanvas path is officially supported and tested. (Even then, the
  renderer-vs-engine scope gap in §4 still argues for Babylon; this trigger mainly
  guards against citing stale claims publicly.)

## 2. The comparison frame — Parallax's axes

An engine comparison is meaningless without stating the axes. Ours, from the two
project goals (platform research first, the game second):

1. **>4 GB addressable memory** — multi-GB open world; wasm64 must be reachable.
2. **Worker topology we design** — render off-main-thread (D-005/D-056),
   SharedArrayBuffer, OffscreenCanvas, scheduling from anywhere.
3. **OPFS install lifecycle** — worker-side sync access handles (D-003).
4. **WebGPU-only as a production target** — no WebGL2 fallback, no
   dual-backend authoring ceiling (D-002).
5. **Day-one access to new Chrome/WebGPU features** — subgroups, shader-f16,
   timestamp-query, and whatever ships next.
6. **GPU time measurable in the field** — the harness is a first-class
   deliverable; an engine that can't report GPU time can't serve goal #1.
7. **Finding attributability** — a platform problem must reduce to a minimal
   repro filable against Chrome, not vanish into an engine's translation layers.
8. **Agent iteration loop** — TypeScript, hot reload, no editor round-trips,
   everything diffable *(workflow advantage; never sell it as a capability)*.

Axes 1–3 structurally eliminate Unity and don't discriminate among the web-native
options (Babylon, three.js, from-scratch — all inherit the platform directly).
Axes 4–8 are where the web-native comparison actually happens.

## 3. Why not Unity

*Last full verification: 2026-07-14, against Unity 6.5 (6000.5), the current
release. Unity 6.4 shipped 2026-03 and reached end-of-life 2026-06-17, so 6.4-era
claims are already stale. Unity's web capabilities move; re-verify before public
use.*

### Tier 1 — Structural. Unity cannot; we can.

**3.1 Address more than 4 GB of memory**

- **Unity:** the heap "can expand up to 4 GB depending on the **Maximum Memory
  Size** set in Player settings" — the wasm32 ceiling. No Memory64/wasm64 support
  is documented anywhere, and a
  [March 2025 request for it](https://discussions.unity.com/t/wasm-64-for-webgl/1615192)
  drew no official Unity response.
- **Us:** Chrome ships Memory64
  ([shipped in Chrome 133](https://chromestatus.com/feature/5070065734516736),
  checked 2026-07-15); wasm64 is ours to target.
- **Say it precisely:** *structurally available to us, structurally closed to
  Unity.* **Not** "we have 16 GB" — P-001 still gates that, and it is proven only
  by a harness run in which a **single module** addresses beyond 4 GiB.
- **Why this is the strongest item:** a multi-GB open world under a 4 GB address
  ceiling is a non-starter, and it is not a backlog item Unity can pick up cheaply.

**3.2 Run the game off the main thread, on a topology we design**

- **Unity:** "Managed (C#) threads aren't supported on the Web platform due to the
  lack of a multithreaded garbage collection feature in WebAssembly." Parallelism
  is limited to Burst-compiled C# jobs and native C/C++ engine threads — and "you
  must schedule all jobs from the main thread." Gameplay C# stays on one thread.
- **Us:** Workers + SharedArrayBuffer, WebGPU-in-worker, OffscreenCanvas, wasm
  threads in Rust hot paths, scheduling from anywhere (D-005).
- **Expect this pushback, and concede it:** *"Unity 6.4 shipped Burst/Job-System
  multithreading on Web."* True. **Do not claim Unity is single-threaded — that is
  now false.** The claim is about *where* threads may run and *who* schedules
  them: gameplay C# is still one thread, and every job originates on it.
- **Root cause worth knowing:** Unity itself attributes the blocker to "the lack
  of a multithreaded garbage collection feature in WebAssembly" — the platform,
  not its backlog. That it is structurally unfixable for Unity (rather than an
  engineering choice — native runtimes do run multithreaded GCs over shared linear
  memory) is our inference layered on Unity's framing (judgment, not a citation).

**3.3 OPFS as the primary asset store**

- **Unity:** `Application.persistentDataPath` "points to a location in the
  browser's IndexedDB file system... `/idbfs/<hash>`". Unity's own `Caching` API
  is unsupported on Web: "Web builds don't support the Unity Cache and Caching
  Scripting API due to restricted access to the filesystem in browsers." Data
  caching "is implemented using the IndexedDB API provided by the browser."
  **OPFS appears nowhere in Unity's Web documentation** — a bounded grep over all
  75 Web-section pages of the 6.5 manual returns zero matches for OPFS, the File
  System Access API, or sync access handles.
- **The escape hatch is closed too.** You could hand-write a `.jslib` plugin,
  except Unity "currently supports ECMAScript 5 (ES5) syntax in .jslib and .jspre
  files. ES6 syntax isn't yet supported" — and OPFS is entirely Promise-based.
  Worse, the fast path you actually want, `createSyncAccessHandle`, is
  **worker-only**, while `.jslib` runs on the main thread.
- **Us:** OPFS with worker-side sync access handles is the foundation of D-003's
  install/launch/run lifecycle.
- **Honest caveat:** cite the *structural* difference (sync handles, worker-side,
  no structured clone), not a throughput number — see
  [rough-edges.md](rough-edges.md) for the current OPFS measurement state.

**3.4 Ship WebGPU-only, as a production target**

- **Unity:** the WebGPU backend is still experimental in 6.5. The manual page is
  titled "**WebGPU (Experimental)**" and reads "WebGPU is experimental and not
  supported by all browsers and devices." It has been experimental continuously
  from 6.1 through 6.5, and Unity still recommends keeping WebGL2 as a fallback.
- **Us:** WebGPU is the only backend (D-002/D-004). No WebGL2 path, no
  dual-backend shader authoring, no lowest-common-denominator ceiling.

### Tier 2 — Chrome ships it; Unity can't use it

| Capability | Chrome | Unity 6.5 |
| --- | --- | --- |
| Subgroups / wave intrinsics (`subgroupBallot/Broadcast/Shuffle/Add`, `quadBroadcast`, `quadSwapX/Y/Diagonal`) | Shipped in **134** | "Wave Intrinsics and QuadShuffle" unsupported |
| 16-bit floats in shaders (`shader-f16`) | Shipped in **120** | "Native16Bit" unsupported |
| Cubemap arrays (`cube-array` views) | Core WebGPU | Unsupported |
| Dynamic resolution scaling | Nothing in WebGPU prevents it | Unsupported |

Babylon's `WebGPUEngineOptions.deviceDescriptor.requiredFeatures` takes a
`GPUFeatureName[]` whose values include **`"subgroups"`, `"shader-f16"`, and
`"timestamp-query"`** by name — these are ours to request.

**The pattern is the argument, more than any single row.** Chrome shipped f16
about two and a half years ago (Chrome 120, December 2023) and subgroups roughly
eighteen months ago (Chrome 134, March 2025), and Unity's current release still
cannot use either. For a project whose first goal is pushing the newest Chrome to
its limits and filing findings against it, an engine trailing the browser by that
margin is the wrong vehicle by construction. When Chrome ships the next thing, we
get it the day it lands; Unity users wait for Unity.

### Tier 3 — Measurement and research fit

**3.5 Measure GPU time at all**

- **Unity:** the GPU Usage Profiler's platform-support table lists **Web | All
  WebGL | Not supported**. `FrameTimingManager` is "**Partial: GPU Frame Time
  measurement is unsupported**" on Web, and the scripting reference states flatly:
  "**On the WebGL platform, no GPU time is provided.**" Unity's docs never mention
  `timestamp-query`, on any platform.
- **Precision matters here.** Unity's tables say *"All WebGL"* and are silent on
  WebGPU specifically. The defensible claim is **"Unity documents no GPU-timing
  path on Web"** — not "Unity cannot measure GPU time on WebGPU," which the docs
  neither confirm nor deny. Don't overreach; the documented version is damning
  enough.
- **Us:** `timestamp-query` is a WebGPU feature we request directly. We are
  cross-origin isolated anyway (D-005's COOP/COEP requirement), which is what
  keeps timer resolution useful.
- **Rule 3 cuts both ways:** we have not yet *measured* GPU time end-to-end.
  Claim the capability, not the result, until the harness proves it.

**3.6 Findings stay attributable** *(judgment, not a citation — label it as such)*

Our stack is TypeScript + WGSL + our own Rust/wasm, so a platform problem reduces
to a minimal repro filable against Chrome. Through Unity, the same finding is
buried under IL2CPP → Emscripten → a monolithic wasm blob → Unity's HLSL-to-WGSL
translation. Producing platform findings *is* goal #1, and Unity degrades every
one of them.

**3.7 Agent iteration loop** *(judgment, not a citation)*

TypeScript, hot reload, no editor round-trips, no C# compile step, everything
diffable and reviewable as text. A real workflow advantage — but don't sell it as
a capability.

### Not on this list — and why

These are **WebGPU** limits. They bind Babylon and Parallax exactly as hard as
they bind Unity. They appear on Unity's WebGPU-limitations page, which is what
makes them tempting — and what makes citing them a self-own:

- **No async compute.** WebGPU exposes one `GPUQueue` per `GPUDevice`;
  multi-queue remains an open working-group investigation
  ([gpuweb#1065](https://github.com/gpuweb/gpuweb/issues/1065)). Logged as
  **RE-011** in [rough-edges.md](rough-edges.md) — a platform finding, not an
  engine one.
- **Read-write storage textures restricted** to `r32float`/`r32sint`/`r32uint`.
  RGBA8 needs the non-core `rw-storage-texture-tier-2` extension.
- **No synchronous GPU readback.** WebGPU maps asynchronously by design; Unity
  pointing you at `AsyncGPUReadback` is Unity adapting correctly, not failing.
- **No `RWBuffer`/texel buffers, no Int64 in WGSL, barriers only from uniform
  control flow.**

Also excluded — real Unity-Web limits that simply don't help the argument:
baked-GI-only and non-directional lightmaps, terrain texture caps, video import,
dynamic font rendering, shader-variant bloat. We hand-build lighting anyway
(D-004).

**And one claim to retire outright:** *"Unity's WebGPU gaps gut GPU-driven
culling"* is **wrong**. Culling needs compute shaders, storage buffers, atomics,
and indirect draw — WebGPU has all four. The pieces that are missing are missing
for us too. This claim was made and withdrawn during the 2026-07-14 review; don't
let it back in.

### Experiments that would settle the absence-based Unity claims

Two claims above rest on *absence* of documentation rather than a positive
statement; both would be settled by a 30-minute experiment rather than another
doc search:

1. **Unity GPU timing on WebGPU** — build a Unity 6.5 Web/WebGPU target, log
   `SystemInfo.supportsGpuRecorder` and `FrameTiming.gpuFrameTime` over ~100
   frames. Unity's own sample code treats `gpuFrameTime == 0` as "platform
   doesn't support GPU time."
2. **Unity OPFS in the emitted runtime** — grep a build's `*.framework.js` /
   `*.loader.js` for `getDirectory|createSyncAccessHandle|opfs`, and watch Chrome
   DevTools → Application → Storage for bytes landing in File System vs
   IndexedDB. That converts "not documented" into "not present."

## 4. Why not three.js

*Researched 2026-07-19 (three.js r185 / `0.185.1`, Babylon `@babylonjs/core`
9.17.0 current at check time). three.js was **not** evaluated in the original
D-004 decision — this section is a post-hoc evaluation (D-076) done because
"why not three.js?" is the first question the choice draws in public. Verdict:
the choice holds, for reasons mostly different from the Unity reasons.*

Three.js is web-native JS, so it shares every Tier-1 structural advantage over
Unity: memory, workers, OPFS, and Chrome features are all directly reachable.
The comparison therefore happens on axes 4–8 (§2) — and on scope: three.js is a
**rendering library**, Babylon is an **engine**.

### Where three.js loses for Parallax

1. **WebGPU is officially still experimental** *(confirmed)*. `WebGPURenderer`
   is a separate opt-in entry point (`import * as THREE from 'three/webgpu'`;
   the main entry still exports WebGLRenderer). The official manual describes it
   as "experimental but improving with each release," lists `ShaderMaterial`,
   `RawShaderMaterial`, `onBeforeCompile()`, and `EffectComposer` as unsupported
   there, and warns of possible missing features or better WebGL performance.
   Community consensus calls it production-ready since ~r171 (Sept 2025), but
   for a WebGPU-*only* project the vendor's own label governs. A closed proposal
   (issue #29899) to brand the WebGPU renderer "three.js v2" is evidence the
   migration is a real API break, not a drop-in. By contrast, Babylon's WebGPU
   backend has been a stable backend of a stable engine since 5.0 (2022), with
   all core shaders native WGSL since 8.0 (March 2025).
2. **Custom shading must go through TSL** *(confirmed)*. TSL — a JavaScript
   node-graph shading language lowered to WGSL (or GLSL on fallback) — is the
   mandatory material-customization path on WebGPURenderer; GLSL-string
   mechanisms don't work there. Raw WGSL exists only as `wgslFn()` nodes
   consumed *inside* the TSL graph; there is no supported path to owning a raw
   `GPURenderPipeline`. For goal #1, an engine-specific shader IR between us and
   WGSL is the same attribution-blurring layer we rejected Unity for, in
   miniature. No API surface for `subgroups` or `shader-f16` was found *(absence
   inference)*.
3. **The worker path is unofficial and demonstrably fragile** *(confirmed)*.
   Our render-in-worker topology (D-056) is core architecture. three.js has no
   official WebGPU-in-worker example, and **r179 (Aug 2025) shipped a regression
   that completely broke WebGPURenderer in workers** (`HTMLVideoElement is not
   defined`, issue #31605; fixed in r180 by guarding browser-only APIs) — direct
   evidence workers are not a tested path. Babylon documents OffscreenCanvas
   support (with caveats, §6) and landed WebGPU+OffscreenCanvas in early 2024.
4. **API churn and JS-with-external-types** *(confirmed)*. Breaking changes
   every release are policy (semver-less rNNN scheme, per-release migration
   guide, deprecations removed ~10 releases later; community guidance is to pin
   exact versions). Written in JavaScript; types are community-maintained
   (`@types/three` via three-ts-types) and lag releases — at check time,
   `@types/three` was at 0.184.1 vs three at 0.185.1. Release cadence has slowed
   from monthly to ~6–9 weeks (npm publish dates). Babylon: TypeScript-native,
   weekly minors, explicit backwards-compat promise (blemish noted in §6).
   For an agent-built project, axis 8 weighs this heavily.
5. **Renderer, not engine** *(confirmed)*. No physics (ecosystem: Rapier et
   al.), no GUI, no first-class particles, no navigation/AI, no frame graph
   *(absence inference)*. Choosing three.js means assembling a mini-engine from
   community parts — drifting toward the from-scratch option D-004 rejected
   because scene graph/materials/animation/glTF are solved problems that advance
   neither goal.
6. **No shipped precedent at our scale** *(absence inference)*. No open-world
   game on WebGPURenderer was found; best documented production uses are a LiDAR
   annotation tool (Segments.ai) and a 1M-particle Expo 2025 installation.

### Where three.js honestly wins

- **Indirect draw is a public, documented API.** `IndirectStorageBufferAttribute`
  (WebGPU-only) is explicitly pitched for compute-populated draw args — GPU
  frustum culling, LOD selection, "millions of instances" — with an official
  example. **Classic Babylon exposes no public indirect-draw API at all** (§6).
  For GPU-driven rendering building blocks, three.js is ahead of classic Babylon
  today. *(confirmed)*
- **Timestamp queries are a one-flag renderer option** (`trackTimestamp: true`,
  per-pass readback via `resolveTimestampsAsync`). *(confirmed)*
- **Compute is supported** (`computeAsync`, storage buffers, workgroup
  barriers). *(confirmed)*
- **Ecosystem gravity:** ~11.6M npm weekly downloads vs ~211K for
  `@babylonjs/core` (~55×); ~114K vs ~26K GitHub stars (measured 2026-07-19 via
  npm/GitHub APIs; a widely-circulated "2.7M weekly" figure is stale — trust the
  API numbers).

### Verdict

For a WebGPU-only, worker-rendered, agent-built platform-research project,
Babylon wins on stable-WebGPU-since-2022, raw WGSL access, documented worker
support, TypeScript, and API stability. three.js's still-experimental WebGPU
renderer, mandatory TSL layer, and untested worker path outweigh its larger
ecosystem and its genuinely better indirect-draw API. The indirect-draw gap cuts
*against Babylon* too — it lands in §6 as a roll-our-own area, not as a reason
to switch.

## 5. Why not Godot, Bevy, or from-scratch

*From D-004 (checked 2026-07-11; re-verify before public use — both projects
move).*

- **Godot:** web export's WebGPU support was experimental behind a flag (Godot
  4.7); the web path generally trails desktop.
- **Bevy:** wasm builds were single-threaded; wasm multithreading not landed.
  Its Rust/WebGPU-native design makes it the most interesting future candidate
  — reopen trigger in §1.
- **From-scratch:** scene graph, materials, animation, and glTF are solved
  problems whose reimplementation advances neither the research goal nor the
  game. The project instead takes "from-scratch where it *is* the research":
  LOD, culling, streaming, world partitioning, and the worker fabric are ours by
  design, on top of Babylon's solved layers.

## 6. Babylon.js — known weaknesses and expected roll-our-own areas

*Researched 2026-07-19 against Babylon 9.x (9.17.0 current). This is the honest
list; each item is a candidate for harness measurement before being cited
anywhere (root rule 3). Forum-sourced numbers are anecdotes until reproduced.*

1. **CPU-per-mesh submission fights GPU-driven rendering** *(confirmed)*. The
   render loop evaluates active meshes in JS and issues one draw per
   submesh/material. **No public indirect-draw API** (`drawIndirect`/
   `drawIndexedIndirect` unexposed; a community WGSL Playground sample drives
   raw WebGPU *alongside* Babylon, not through it). Occlusion culling is
   per-mesh async queries with frame-delayed results (plus WebGPU-specific bugs:
   multi-camera occlusion queries silently no-op on WebGPU). The Frame Graph
   (v1 in 9.0, March 2026) organizes *passes*, not submission — culling remains
   a CPU task node, and its per-feature coverage still has gaps (per the April
   2025 roadmap; re-verify per feature). **Consequence:** the P-002 meshlet/
   visibility-buffer exploration means bypassing Babylon's scene traversal and
   using it as a device/resource manager. Partial interop is real — wrap a
   `StorageBuffer`'s `GPUBuffer` as a `VertexBuffer`, compute shaders run on the
   same device/queue — but injecting raw render passes means reaching into
   `engine._device` internals (fork risk D-004 already accepted), and there is
   no documented way to hand Babylon an externally created `GPUDevice`.
2. **Synchronous pipeline creation** *(confirmed from Babylon's own WebGPU
   status doc)*. `createRenderPipelineAsync` is listed as *future* work — PSO
   compiles happen synchronously on the render thread, so first-render of new
   material/state combinations hitches. Directly threatens the install-time
   shader/PSO-warmup story (D-003); measure in the harness, and snapshot
   rendering (record/replay render bundles, WebGPU-only) only helps
   mostly-static content. Post-load shader-compilation stutter is a recurring
   forum theme *(anecdote)*.
3. **WebGPU scripting-time overhead vs WebGL** *(team-confirmed direction,
   anecdotal magnitude)*. Babylon's own analysis measured WebGPU ~17% slower on
   scripting time (WebGL VAO binding ~2.5× faster than the equivalent
   setIndex/setVertexBuffer sequence); multi-year forum reports of WebGPU
   underperforming WebGL persist into 2025–2026. We are WebGPU-only, so this is
   a cost to measure and attribute (engine vs platform), not a backend choice.
4. **Scale mitigations amount to turning the scene graph off** *(confirmed from
   docs)*. Regular instances cost per-object JS every frame; thin instances
   avoid it but cull all-or-nothing; the documented high-object-count answers
   are `freezeActiveMeshes`, frozen world matrices, mesh merging. An April 2026
   forum thread has the team diagnosing major FPS drops at 2,000+ meshes as
   draw-call count *(anecdote, includes an unreproduced "three.js handled the
   same model better" claim)*.
5. **Large-world support is brand-new** *(confirmed)*. 9.0's
   `useLargeWorldRendering` (engine-wide 64-bit matrices + per-scene floating
   origin, Havok partitioned into local-origin worlds) shipped March 2026,
   announced as experimental, with a caveat trail (shadow bugs since patched,
   billboard/infinite-distance unsupported, WebGPU material bugs) and no
   published CPU-cost benchmark for the double-precision math. Under a year old
   for a feature an open world leans on — measure early. No terrain or
   streaming in core (community extensions only) — consistent with our plan to
   build streaming ourselves.
6. **Worker caveats** *(confirmed from docs)*. No input handling in workers
   (`camera.attachControl()` doesn't work; proxy events via postMessage —
   already our architecture), Babylon GUI hit-testing doesn't work on
   OffscreenCanvas, Spector.js can't debug OffscreenCanvas. WebGPU +
   OffscreenCanvas landed Jan 2024 with early rough edges since worked through.
7. **Bundle size / tree-shaking is mediocre** *(confirmed docs + anecdotes)*.
   Tree-shaking requires careful deep-module imports; real-world reports still
   ship ~0.7–2 MB of engine. WGSL-native shaders since 8.0 claim ~2× smaller
   WebGPU bundles *(vendor claim)*. Matters less under our install lifecycle,
   but it is why Babylon Lite exists (§7).
8. **Governance** *(confirmed)*. Microsoft backing active through mid-2026 (8.0
   and 9.0 both announced on the Windows Developer Blog; Deltakosh still leads).
   Annual majors each spring, roughly weekly minors. Backwards-compat promise is
   explicit — with one real blemish: 9.16.0 (July 2026) bumped the UMD build
   ES5→ES2015 in a minor, breaking ES5 consumers, and the team's response was
   "fix it on your end."
9. **Field GPU timing needs our own path** *(confirmed)*. Babylon Inspector's
   GPU timing requires launching Chrome with
   `--enable-dawn-features=allow_unsafe_apis` (a Chrome restriction on the
   Inspector's approach, not on the feature). We request `timestamp-query` via
   `requiredFeatures` and instrument ourselves — capability confirmed at the API
   level, end-to-end measurement still owed (rule 3).

## 7. Selected core: Babylon Lite (D-078)

*Checked and measured 2026-07-19 against exactly pinned `@babylonjs/lite` 1.11.0,
source tag `npm-lite-v1.11.0`, commit
[`b7993d5`](https://github.com/BabylonJS/Babylon-Lite/commit/b7993d58a709edc4c3299014d300b992ee0b8e7c),
and the [official feature comparison](https://github.com/BabylonJS/Babylon-Lite/blob/npm-lite-v1.11.0/docs/lite/02-feature-comparison.md).
The vendor's headline multipliers were not used for the decision.*

D-077's M0 spike ported the same box-and-light walking skeleton behind one shared worker
protocol/telemetry/RAF core, with only thin classic and Lite backend adapters differing.
Each production build then ran the identical schema-v23 / mandatory-metric-set-v10
physical-console gate on registered dev-01 (Chrome 150.0.7871.115,
3840x2160@60 Hz, production sandbox, three fresh/warm pairs). Both passed the environment
and evidence facets, all six core runs, all 24 budget checks, the exact page+dedicated-
render-worker topology, and the 100,000/100,000 SAB exchange with zero payload/sequence
errors.

| Measured outcome | Classic 9.16.1 | Lite 1.11.0 | Lite delta |
| --- | ---: | ---: | ---: |
| Render-worker artifact | 5,266,167 B | 161,033 B | -96.94% (32.7× smaller) |
| Engine + render worker | 5,686,348 B | 581,214 B | -89.78% (9.78× smaller) |
| Fresh startup, mean | 211.31 ms | 170.87 ms | -19.1% |
| Warm startup, mean | 149.90 ms | 123.24 ms | -17.8% |
| Render CPU p50, mean | 0.246 ms | 0.103 ms | -58.0% |
| Render CPU p95, mean | 0.431 ms | 0.203 ms | -53.0% |
| Render callback p95, mean | 16.762 ms | 16.735 ms | effectively equal |
| All-realm JS heap, mean | 9.37 MB | 3.89 MB | -58.5% |

Lite's internal worker-init-to-first-frame interval was worse (fresh 97.28→149.04 ms;
warm 93.38→112.99 ms), but lower worker-bootstrap overhead made total startup better.
The V8 trace's render-worker compile event was ~1.4–1.9 ms for Lite versus
~23.8–25.4 ms for classic; the wider bootstrap interval is not attributed to compile
alone. Dawn saw
four fresh shader misses and two graphics-PSO misses for Lite against classic's six and
three; both were hits warm. GPU-memory attribution was unsupported for both, so no GPU-
memory advantage is claimed. Evidence artifacts:
`smoke-1-f7e08a362e94-dev-01-showcase-2026-07-19T19-27-01-694Z.json` (Lite) and
`smoke-1-106bd4023874-dev-01-showcase-2026-07-19T19-29-39-539Z.json` (classic).
The spike adapters and selector were then removed by D-080: they remain represented by
the two raw comparison artifacts above, not as a product parity obligation. Final
Lite-only replacement
`smoke-1-a4824e1bef7e-dev-01-showcase-2026-07-19T20-33-11-523Z.json` passed all three
facets, six core runs, and 24 checks at 581,328 combined engine+render-worker bytes
(420,117 + 161,211), 14 fewer than the selector-enabled Lite build.

**Roadmap floor, audited against the exact published package source:**

| Capability | Classification | Evidence / bounded plan |
| --- | --- | --- |
| glTF/GLB | present | Public `loadGltf`; materials, skins, morph targets, animations |
| KTX2/BasisU | partial in worker | Loader and `KHR_texture_basisu` are present, but decoder bootstrap falls back to `document` unless `globalThis.KTX2DECODER` is preinstalled. M1 bundles/installs the pinned decoder and gates a worker fixture; fallback is a patch limited to this bootstrap's dynamic import. |
| Draco | partial in worker | `KHR_draco_mesh_compression` is present, but its bootstrap similarly needs a preinstalled `globalThis.DracoDecoderModule` to avoid `document`. Same M1 fixture and bounded bootstrap-patch plan. |
| meshopt | partial | `EXT_meshopt_compression` needs a preinstalled `globalThis.MeshoptDecoder` in the worker and works only for canonical single-buffer GLB; v1.12.0 rejects other-buffer views. M1 gates the bundled decoder and establishes the shared layout validator; future asset QA must call it. Upstream or patch only if representative content needs a broader path. |
| Thin instances | present | Add/remove/set/flush APIs, dynamic draw count, GPU culling |
| Compute / raw device+queue | partial | Lite uses compute internally but exposes no generic public compute or device/queue API. Before P-002, isolate the pinned internal device access in one guarded native adapter and add a runtime harness probe while seeking an upstream accessor. |
| Indirect draw | present for thin instances; generic path partial | GPU-culling uses `drawIndexedIndirect`; arbitrary submission shares the bounded native adapter above. |
| Skeletal/animation system | partial | GPU bone textures, 4/8-bone skinning, animation groups, interpolation, blending/cross-fade/additive/masks/weights, and VAT are present. Animation events are absent; game events stay in the fixed-timestep sim, and M3 adds a tested engine timestamp-marker utility only if visual callbacks are needed. Morphs are capped at four active targets; asset QA enforces that bound, with skeletal/VAT authoring or a justified shader extension for an over-cap character. |
| Worker ownership | present and measured | Public OffscreenCanvas path; local gate proves dedicated-worker WebGPU ownership and unchanged telemetry/SAB behavior |

**Costs and operating rule:** Lite says its young API is not backward-compatible. The
package is therefore exact-pinned; upgrades are deliberate reviewed changes, Lite calls
remain confined to `engine/`, and compatibility code is limited to the bounded
native-interop adapter. D-080 deliberately removes renderer swappability so streaming,
asset, and render data can use Lite's data-oriented model without a classic-shaped common
denominator. Missing LOD, octree culling, GUI, and related classic systems do
not change the plan because Parallax already owns those browser-specific systems. D-078
selects Lite because the local results are materially better and every roadmap gap has a
bounded plan—not because the vendor says Lite is faster.

## 8. Gaussian splats and dynamic relighting (P-002 evidence)

*Researched 2026-07-19. Feeds the P-002 splat branch and the game-design.md
binding requirement that splats be evaluated under dynamic relighting. This
section tracks a fast-moving research field — expect it to be rewritten, not
appended to.*

**Where the field moved, 2024 → 2026.** In 2024, splat relighting meant offline
inverse rendering: per-object BRDF decomposition at training time with baked
visibility (Relightable 3D Gaussians ECCV 2024, GaussianShader/GS-IR CVPR 2024).
By 2025–26 the field converged on **deferred shading over a splat G-buffer** —
the same architecture a game renderer would use — and produced genuinely dynamic
results: *Real-time GI for Dynamic 3D Gaussian Scenes* (arXiv 2503.17897)
reports **>40 FPS at 1920×1088 on an RTX 3090** with multiple dynamic lights,
stochastic ray-traced shadows, two-bounce GI, and — directly relevant to our
hybrid plan — **mixed splat+mesh scenes with mutual light transport** *(paper
claim)*. Supporting lines: PRT-based transfer (PRTGS, 30+ FPS at 1080p, soft
shadows under *low-frequency* lighting — good for sun/sky time-of-day, weak for
hard local lights), point-light relighting at 90 FPS object-scale (GS³,
SIGGRAPH Asia 2024), outdoor sun/sky decomposition for time-of-day (GaRe,
ROSGS, OSDR-GS — 2025, no game-grade FPS published), and 2026 work on
feed-forward relightable-splat generation (F-RNG) and compact relightable
representations (MCMC-guided, SIGGRAPH Asia 2025). *(all paper claims)*

**What the numbers mean for us.** The best published result spends roughly a
full desktop-GPU frame budget on lighting alone, in native CUDA, at 1080p-class
resolution, on scene-scale (≤ a few million splats) content. Nothing is
benchmarked in a browser, over WebGPU, or at open-world scale *(absence
inference)*. "Relit splats everywhere" is out of reach today; the credible M1
spike candidates are PRT-style transfer for sun/sky, deferred WGSL shading over
a material-carrying splat G-buffer, or Babylon's triangle-splatting path
(opaque triangles = ordinary lit geometry).

**Engine adoption (checked 2026-07-19).** No production engine ships splat
relighting *(absence inference after targeted search)*:

- **Babylon 9.0** *(confirmed)*: loads PLY/.splat/SPZ/SOG, multi-splat
  composition, GPU picking, splats **casting** shadows onto meshes — but not
  receiving dynamic light; also ships initial **Triangle Splatting** (which, as
  plain geometry, inherits normal relighting).
- **three.js / Spark 2.0** (World Labs, Apr 2026) *(confirmed)*: the scale
  champion — continuous-LOD splat tree, 16M-splat GPU virtual-memory pool,
  73–106M-splat streamed worlds incl. mobile — deliberately WebGL2 (not
  WebGPU), and no physically-based relighting.
- **PlayCanvas** *(confirmed)*: compute-based WebGPU splat renderer + SuperSplat
  streaming/LOD; its shipped-game pattern *bakes* light from the splat onto
  dynamic meshes — the inverse of relighting.
- Several WebGPU splat renderers exist (web-splat et al.); **none relights**
  *(absence inference)*.

**The asset-pipeline unlock.** EA SEED's open-source **mesh2splat** converts
glTF meshes to splats in <0.5 ms **preserving PBR material maps**, with a README
that explicitly calls the output "relightable... given a renderer that supports
it," and a demo renderer doing point-light + shadow-mapped splat shading
*(confirmed)*. Since our assets are AI-generated meshes, this retires P-002's
old "splats come from capture/reconstruction" objection: BRDF parameters come
from the source material, not inverse-rendering estimation, and relighting
becomes a WGSL renderer problem we could build. (It also sharpens the P-002
control question: what do splats buy over the source mesh for synthetic
content? Candidate answers: unified backdrop pipeline, LOD/softness
characteristics, and the scan-your-world UGC path where capture-origin splats
are the point.)

**The open gap — and the opportunity.** Large-scale/LOD/streamed splatting
(Octree-GS, CityGaussian lineage, Spark 2.0) and relightable splatting are both
active threads, but **no published system combines them** *(absence inference)*.
A browser-based, WebGPU, streamed, relit splat environment would be a genuine
first — which cuts both ways: high risk for the game, high value for goal #1.
Per the root priority rule, that makes the splat branch *more* interesting for
the M1 spike, not less.

**Standing constraints unchanged:** splats remain weak on collision and
animation (triangles keep everything interactive); relightable variants carry
extra per-splat payload (normals, BRDF params, transfer coefficients — no clean
published bytes-per-splat comparison exists *(absence inference)*), which
interacts with D-009 storage scale; and the game-design.md rule stands — a
splat win measured only under static lighting doesn't count.

## 9. Sources

**Unity — threading, memory, storage, WebGPU status (checked 2026-07-14, Unity 6.5 / 6000.5)**
- [Web technical limitations](https://docs.unity3d.com/6000.5/Documentation/Manual/webgl-technical-overview.html) — managed C# threads; Unity `Caching` API unsupported on Web
- [Multithreading with Burst in Unity Web](https://docs.unity3d.com/6000.5/Documentation/Manual/web-multithreading-burst.html) — jobs scheduled from the main thread
- [Memory in Unity Web](https://docs.unity3d.com/6000.5/Documentation/Manual/webgl-memory.html) — 4 GB heap ceiling; IndexedDB + Cache API data caching
- [`Application.persistentDataPath`](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Application-persistentDataPath.html) — `/idbfs/<hash>`
- [`Caching`](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Caching.html) · [Web caching](https://docs.unity3d.com/6000.5/Documentation/Manual/webgl-caching.html)
- [Interacting with browser JS](https://docs.unity3d.com/6000.5/Documentation/Manual/web-interacting-browser-js.html) — `.jslib` is ES5-only
- [WebGPU (Experimental)](https://docs.unity3d.com/6000.5/Documentation/Manual/WebGPU.html) · [WebGPU limitations](https://docs.unity3d.com/6000.5/Documentation/Manual/WebGPU-limitations.html)
- [wasm64 request thread, Mar 2025](https://discussions.unity.com/t/wasm-64-for-webgl/1615192) — no Unity response
- [Burst/Job System web support in 6.4](https://discussions.unity.com/t/burst-compiler-job-system-multithreading-official-web-support-in-unity-6-4/1716721)
- [GPU Usage Profiler module](https://docs.unity3d.com/6000.5/Documentation/Manual/ProfilerGPU.html) — platform table: Web / All WebGL / Not supported
- [FrameTimingManager (manual)](https://docs.unity3d.com/6000.5/Documentation/Manual/frame-timing-manager.html) · [(scripting)](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/FrameTimingManager.html) — "no GPU time is provided"

**Chrome / WebGPU (checked 2026-07-14)**
- [What's New in WebGPU (Chrome 134)](https://developer.chrome.com/blog/new-in-webgpu-134) — subgroups
- [What's New in WebGPU (Chrome 120)](https://developer.chrome.com/blog/new-in-webgpu-120) — `shader-f16`
- [Multi-Queue Investigation (gpuweb#1065)](https://github.com/gpuweb/gpuweb/issues/1065) — single queue / no async compute
- [WebGPU Compatibility Mode proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md) — cube-array exclusion there; core is what ships
- [WebGPU storage textures](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-textures.html) — r32-only read-write formats

**three.js (checked 2026-07-19, r185 / 0.185.1)**
- [npm registry: three](https://registry.npmjs.org/three) — versions, publish dates, cadence
- [WebGPURenderer manual](https://threejs.org/manual/en/webgpurenderer.html) — official "experimental" status, entry point, unsupported features
- [TSL docs](https://threejs.org/docs/TSL.html) · [TSL wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language) · [Migration Guide wiki](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
- [`IndirectStorageBufferAttribute`](https://threejs.org/docs/pages/IndirectStorageBufferAttribute.html) — public indirect-draw API · [origin issue #28389](https://github.com/mrdoob/three.js/issues/28389)
- [Issue #31605](https://github.com/mrdoob/three.js/issues/31605) — r179 broke WebGPURenderer in workers · [fix PR #31607](https://github.com/mrdoob/three.js/pull/31607)
- [Issue #29899](https://github.com/mrdoob/three.js/issues/29899) — "Threejs V2" rebrand proposal for WebGPURenderer
- [PR #30359](https://github.com/mrdoob/three.js/pull/30359) — TimestampQueryPool
- [three-ts-types](https://github.com/three-types/three-ts-types) · [@types/three](https://www.npmjs.com/package/@types/three) — external types, version lag
- [Release cadence forum thread](https://discourse.threejs.org/t/what-is-threes-release-cadence-and-deprecation-timeline/53186) · [discoverthreejs on versions](https://discoverthreejs.com/book/appendix/threejs-versions/)
- Community state-of-three.js reviews: [utsubo 2026](https://www.utsubo.com/blog/threejs-2026-what-changed) (r171 "production-ready" narrative; Segments.ai, Expo 2025 cases) · [Maxime Heckel's TSL field guide](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)

**Babylon.js (checked 2026-07-19, 9.17.0)**
- [npm registry: @babylonjs/core](https://registry.npmjs.org/@babylonjs/core) — versions, weekly cadence
- [Babylon 9.0 announcement](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/) (+ [part 2, geospatial/large-world](https://blogs.windows.com/windowsdeveloper/2026/03/30/part-2-babylon-js-9-0-tooling-updates-and-new-geospatial-features/)) · [8.0 announcement](https://blogs.windows.com/windowsdeveloper/2025/03/27/announcing-babylon-js-8-0/) — Microsoft backing, WGSL-native shaders
- [WebGPU status doc](https://doc.babylonjs.com/setup/support/webGPU) — incl. `createRenderPipelineAsync` as future work
- [Snapshot rendering](https://doc.babylonjs.com/setup/support/webGPU/webGPUOptimization/webGPUSnapshotRendering)
- [Frame Graph docs](https://doc.babylonjs.com/features/featuresDeepDive/frameGraph/) · [roadmap + gaps](https://forum.babylonjs.com/t/frame-graph-roadmap/58077)
- ["Why WebGPU backend is slower"](https://forum.babylonjs.com/t/why-webgpu-backend-is-slower/24091) — team ~17% scripting-time analysis · [WebGPU first impressions](https://forum.babylonjs.com/t/webgpu-vs-webgl-engines-first-impressions-after-usage/56078)
- [Thin instances docs](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/thinInstances) · [scene optimization docs](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene) · [2,000+ mesh FPS thread, Apr 2026](https://forum.babylonjs.com/t/performance-issue-fps-drops-significantly-when-meshes-count-over-thousand/63196)
- [Indirect drawing WGSL sample (community), Jun 2026](https://forum.babylonjs.com/t/indirect-drawing-sample-using-wgsl/63571)
- [GPUBuffer→VertexBuffer interop](https://forum.babylonjs.com/t/webgpu-use-a-gpubuffer-directly-for-creating-a-vertexbuffer/51684) · [compute→instancing buffers](https://forum.babylonjs.com/t/how-to-keep-buffers-on-the-gpu-when-using-compute-shaders-for-instancing-or-vertex-data-generation/45951)
- [Occlusion query fix PR #14274](https://github.com/BabylonJS/Babylon.js/pull/14274) · [multi-camera occlusion on WebGPU](https://forum.babylonjs.com/t/webgpu-occlusion-query-with-2-cameras/43840)
- [OffscreenCanvas docs](https://doc.babylonjs.com/features/featuresDeepDive/scene/offscreenCanvas) — input/GUI caveats · [WebGPU+OffscreenCanvas thread](https://forum.babylonjs.com/t/babylon-webgpuengine-and-offscreencanvas-roadmap-for-support/47312) · [GUI-in-worker gap](https://forum.babylonjs.com/t/how-to-handle-gui-interactions-pointer-events-in-offscreen-canvas/34221) · [worker 2D canvas request #13647](https://github.com/BabylonJS/Babylon.js/issues/13647)
- [Large World Rendering announcement, Oct 2025](https://forum.babylonjs.com/t/new-large-world-rendering/61114) · [floating origin docs](https://doc.babylonjs.com/features/featuresDeepDive/scene/floating_origin)
- [ES6/tree-shaking docs](https://doc.babylonjs.com/setup/frameworkPackages/es6Support) · size anecdotes: [2.3MB→700KB](https://forum.babylonjs.com/t/es6-modules-and-tree-shaking-bundle-size/22734), [3.6MB→1.9MB](https://forum.babylonjs.com/t/tree-shaking-es6/35049)
- [glTF loader slowness #7312](https://github.com/BabylonJS/Babylon.js/issues/7312) · [shader-compile stutter thread](https://forum.babylonjs.com/t/slow-glb-load-times-shaders-compiling-when-updating-textures/29380) · [KTX2 docs](https://doc.babylonjs.com/features/featuresDeepDive/materials/using/ktx2Compression)
- [Versioning policy](https://doc.babylonjs.com/setup/frameworkPackages/frameworkVers) · [backwards-compat tale](https://babylonjs.medium.com/there-and-back-again-a-tale-of-backwards-compatibility-in-babylon-js-47ffc4f7ed6f) · [9.16 ES5→ES2015 break](https://forum.babylonjs.com/t/breaking-changes-in-version-9-16-x/63772) · [Babylon 10 proposal](https://babylonjs.medium.com/babylon-10-0675f7de54a4)
- [`WebGPUEngineOptions`](https://doc.babylonjs.com/typedoc/interfaces/babylon.webgpuengineoptions) — `requiredFeatures: GPUFeatureName[]`
- [Babylon Lite announcement, Jun 2026](https://forum.babylonjs.com/t/introducing-babylon-lite/63648) · [repo](https://github.com/BabylonJS/Babylon-Lite) · [feature comparison](https://github.com/BabylonJS/Babylon-Lite/blob/master/docs/lite/02-feature-comparison.md)

**Gaussian splats / relighting (checked 2026-07-19; §8)**
- [Real-time GI for Dynamic 3D Gaussian Scenes (arXiv 2503.17897)](https://arxiv.org/abs/2503.17897) — >40 FPS dynamic multi-light GI, mixed splat+mesh
- [PRTGS (arXiv 2408.03538)](https://arxiv.org/abs/2408.03538) · [GS³ (SIGGRAPH Asia 2024)](https://gsrelight.github.io/) · [Relightable 3D Gaussians (ECCV 2024)](https://nju-3dv.github.io/projects/Relightable3DGaussian/) · [GaussianShader (CVPR 2024)](https://openaccess.thecvf.com/content/CVPR2024/html/Jiang_GaussianShader_3D_Gaussian_Splatting_with_Shading_Functions_for_Reflective_Surfaces_CVPR_2024_paper.html) · [GS-IR (CVPR 2024)](https://lzhnb.github.io/project-pages/gs-ir.html) · [GI-GS (ICLR 2025)](https://arxiv.org/abs/2410.02619) · [IRGS (CVPR 2025)](https://fudan-zvg.github.io/IRGS/) · [RNG (CVPR 2025)](https://openaccess.thecvf.com/content/CVPR2025/papers/Fan_RNG_Relightable_Neural_Gaussians_CVPR_2025_paper.pdf) · [LumiGauss (WACV 2025)](https://arxiv.org/abs/2408.04474)
- Outdoor sun/sky: [GaRe](https://baihyyut.github.io/GaRe/) · [ROSGS](https://arxiv.org/abs/2509.11275) · [OSDR-GS (IJCAI 2025)](https://www.ijcai.org/proceedings/2025/111)
- 2026: [SSD-GS (ICLR 2026)](https://arxiv.org/abs/2604.13333) · [F-RNG](https://arxiv.org/abs/2605.25975) · [Relightable GS for Virtual Production](https://arxiv.org/abs/2605.09024) · [MCMC-guided compact relightable 3DGS (SIGGRAPH Asia 2025)](https://dl.acm.org/doi/10.1145/3757376.3771401)
- Large-scale (no relighting): [Octree-GS](https://arxiv.org/html/2403.17898v2) · [CityGaussian](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/02472.pdf) · [CityGS-X](https://arxiv.org/html/2503.23044v1) · [LODGE](https://arxiv.org/pdf/2505.23158) · [BlitzGS](https://arxiv.org/html/2605.13794)
- Engines/tooling: [Babylon 9.0 splat features + shadow casting](https://radiancefields.com/babylon.js-v9.0-3dgs-gets-shadows-sogs-and-triangle-splatting-support-announced) · [Babylon splat docs](https://doc.babylonjs.com/features/featuresDeepDive/mesh/gaussianSplatting/) · [Spark 2.0](https://www.worldlabs.ai/blog/spark-2.0) · [PlayCanvas WebGPU splat renderer](https://blog.playcanvas.com/new-in-supersplat-webgpu-and-streaming-bring-huge-performance-wins/) · [PlayCanvas splat-game lightness-grid workaround](https://blog.playcanvas.com/turning-a-gaussian-splat-into-a-videogame/) · [EA SEED mesh2splat](https://github.com/electronicarts/mesh2splat) · [web-splat (WebGPU, no relighting)](https://github.com/KeKsBoTer/web-splat)

**Ecosystem numbers (measured 2026-07-19 via npm/GitHub APIs)**
- npm weekly downloads: `three` 11.58M · `@babylonjs/core` 211K (+ legacy `babylonjs` 18K)
- GitHub stars: three.js 113.8K · Babylon.js 25.8K
