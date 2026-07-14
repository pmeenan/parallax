# Why not Unity

The engine decision is [D-004](decisions.md); this doc is its evidence pack — the list of
things Parallax can do on Babylon (or straight against WebGPU) that Unity's web export
cannot. Use it when the engine choice gets questioned.

**Every claim here is sourced and dated.** Unity's web capabilities move; re-verify before
leaning on any of this in public (root AGENTS.md rule 10). Last full verification:
**2026-07-14, against Unity 6.5 (6000.5)** — the current release. Unity 6.4 shipped
2026-03 and reached end-of-life 2026-06-17, so 6.4-era claims are already stale.

**The discipline that makes this list usable:** it contains only *differentiators*. Several
of the most quotable limits on Unity's own WebGPU-limitations page are **WebGPU spec limits
that bind Parallax exactly as hard**. Citing those against Unity is a self-own. They are
listed at the bottom under "Not on this list," and the fact that they're excluded is what
makes the rest safe to lean on.

---

## Tier 1 — Structural. Unity cannot; we can.

### 1. Address more than 4 GB of memory

- **Unity:** the heap "can expand up to 4 GB depending on the **Maximum Memory Size** set in
  Player settings" — the wasm32 ceiling. No Memory64/wasm64 support is documented anywhere,
  and a [March 2025 request for it](https://discussions.unity.com/t/wasm-64-for-webgl/1615192)
  drew no official Unity response.
- **Us:** Chrome ships Memory64; wasm64 is ours to target.
- **Say it precisely:** *structurally available to us, structurally closed to Unity.* **Not**
  "we have 16 GB" — P-001 still gates that, and it is proven only by a harness run in which a
  **single module** addresses beyond 4 GiB.
- **Why this is the strongest item:** a multi-GB open world under a 4 GB address ceiling is a
  non-starter, and it is not a backlog item Unity can pick up cheaply.

### 2. Run the game off the main thread, on a topology we design

- **Unity:** "Managed (C#) threads aren't supported on the Web platform due to the lack of a
  multithreaded garbage collection feature in WebAssembly." Parallelism is limited to
  Burst-compiled C# jobs and native C/C++ engine threads — and "you must schedule all jobs
  from the main thread." Gameplay C# stays on one thread.
- **Us:** Workers + SharedArrayBuffer, WebGPU-in-worker, OffscreenCanvas, wasm threads in Rust
  hot paths, scheduling from anywhere ([D-005](decisions.md)).
- **Expect this pushback, and concede it:** *"Unity 6.4 shipped Burst/Job-System multithreading
  on Web."* True. **Do not claim Unity is single-threaded — that is now false.** The claim is
  about *where* threads may run and *who* schedules them: gameplay C# is still one thread, and
  every job originates on it.
- **Root cause worth knowing:** the blocker is the absence of multithreaded GC in WebAssembly,
  not a Unity backlog item. Unity cannot ship its way out of it.

### 3. OPFS as the primary asset store

- **Unity:** `Application.persistentDataPath` "points to a location in the browser's IndexedDB
  file system... `/idbfs/<hash>`". Unity's own `Caching` API is unsupported on Web: "Web builds
  don't support the Unity Cache and Caching Scripting API due to restricted access to the
  filesystem in browsers." Data caching "is implemented using the IndexedDB API provided by the
  browser." **OPFS appears nowhere in Unity's Web documentation** — a bounded grep over all 75
  Web-section pages of the 6.5 manual returns zero matches for OPFS, the File System Access API,
  or sync access handles.
- **The escape hatch is closed too.** You could hand-write a `.jslib` plugin, except Unity
  "currently supports ECMAScript 5 (ES5) syntax in .jslib and .jspre files. ES6 syntax isn't yet
  supported" — and OPFS is entirely Promise-based. Worse, the fast path you actually want,
  `createSyncAccessHandle`, is **worker-only**, while `.jslib` runs on the main thread.
- **Us:** OPFS with worker-side sync access handles is the foundation of [D-003](decisions.md)'s
  install/launch/run lifecycle.
- **Honest caveat:** cite the *structural* difference (sync handles, worker-side, no structured
  clone), not a throughput number. "OPFS throughput ceilings" is still an open research question
  in [rough-edges.md](rough-edges.md) — we have not run it.

### 4. Ship WebGPU-only, as a production target

- **Unity:** the WebGPU backend is still experimental in 6.5. The manual page is titled
  "**WebGPU (Experimental)**" and reads "WebGPU is experimental and not supported by all browsers
  and devices." It has been experimental continuously from 6.1 through 6.5, and Unity still
  recommends keeping WebGL2 as a fallback.
- **Us:** WebGPU is the only backend ([D-002](decisions.md)/[D-004](decisions.md)). No WebGL2
  path, no dual-backend shader authoring, no lowest-common-denominator ceiling.

---

## Tier 2 — Chrome ships it; Unity can't use it

| Capability | Chrome | Unity 6.5 |
| --- | --- | --- |
| Subgroups / wave intrinsics (`subgroupBallot/Broadcast/Shuffle/Add`, `quadBroadcast`, `quadSwapX/Y/Diagonal`) | Shipped in **134** | "Wave Intrinsics and QuadShuffle" unsupported |
| 16-bit floats in shaders (`shader-f16`) | Shipped in **120** | "Native16Bit" unsupported |
| Cubemap arrays (`cube-array` views) | Core WebGPU | Unsupported |
| Dynamic resolution scaling | Nothing in WebGPU prevents it | Unsupported |

Babylon's `WebGPUEngineOptions.deviceDescriptor.requiredFeatures` takes a `GPUFeatureName[]`
whose values include **`"subgroups"`, `"shader-f16"`, and `"timestamp-query"`** by name — these
are ours to request.

**The pattern is the argument, more than any single row.** Chrome shipped f16 roughly two years
ago and subgroups roughly eighteen months ago, and Unity's current release still cannot use
either. For a project whose first goal is pushing the newest Chrome to its limits and filing
findings against it, an engine trailing the browser by that margin is the wrong vehicle by
construction. When Chrome ships the next thing, we get it the day it lands; Unity users wait for
Unity.

---

## Tier 3 — Measurement and research fit

### 5. Measure GPU time at all

- **Unity:** the GPU Usage Profiler's platform-support table lists **Web | All WebGL | Not
  supported**. `FrameTimingManager` is "**Partial: GPU Frame Time measurement is unsupported**"
  on Web, and the scripting reference states flatly: "**On the WebGL platform, no GPU time is
  provided.**" Unity's docs never mention `timestamp-query`, on any platform.
- **Precision matters here.** Unity's tables say *"All WebGL"* and are silent on WebGPU
  specifically. The defensible claim is **"Unity documents no GPU-timing path on Web"** — not
  "Unity cannot measure GPU time on WebGPU," which the docs neither confirm nor deny. Don't
  overreach; the documented version is damning enough.
- **Us:** `timestamp-query` is a WebGPU feature we request directly. We are cross-origin isolated
  anyway (D-005's COOP/COEP requirement), which is what keeps timer resolution useful.
- **Rule 3 cuts both ways:** we have not yet *measured* GPU time end-to-end. Claim the
  capability, not the result, until the harness proves it.
- **Why it matters:** the measurement harness is a first-class deliverable, not a side effect. An
  engine that cannot report GPU time cannot serve goal #1.

### 6. Findings stay attributable *(judgment, not a citation — label it as such)*

Our stack is TypeScript + WGSL + our own Rust/wasm, so a platform problem reduces to a minimal
repro filable against Chrome. Through Unity, the same finding is buried under IL2CPP → Emscripten
→ a monolithic wasm blob → Unity's HLSL-to-WGSL translation. Producing platform findings *is*
goal #1, and Unity degrades every one of them.

### 7. Agent iteration loop *(judgment, not a citation)*

TypeScript, hot reload, no editor round-trips, no C# compile step, everything diffable and
reviewable as text. A real workflow advantage — but don't sell it as a capability.

---

## Not on this list — and why

These are **WebGPU** limits. They bind Babylon and Parallax exactly as hard as they bind Unity.
They appear on Unity's WebGPU-limitations page, which is what makes them tempting — and what
makes citing them a self-own:

- **No async compute.** WebGPU exposes one `GPUQueue` per `GPUDevice`; multi-queue remains an
  open working-group investigation ([gpuweb#1065](https://github.com/gpuweb/gpuweb/issues/1065)).
  Logged as **RE-011** in [rough-edges.md](rough-edges.md) — it is a platform finding, not an
  engine one.
- **Read-write storage textures restricted** to `r32float`/`r32sint`/`r32uint`. RGBA8 needs the
  non-core `rw-storage-texture-tier-2` extension.
- **No synchronous GPU readback.** WebGPU maps asynchronously by design; Unity pointing you at
  `AsyncGPUReadback` is Unity adapting correctly, not failing.
- **No `RWBuffer`/texel buffers, no Int64 in WGSL, barriers only from uniform control flow.**

Also excluded — real Unity-Web limits that simply don't help the argument: baked-GI-only and
non-directional lightmaps, terrain texture caps, video import, dynamic font rendering,
shader-variant bloat. We hand-build lighting anyway (D-004).

**And one claim to retire outright:** *"Unity's WebGPU gaps gut GPU-driven culling"* is **wrong**.
Culling needs compute shaders, storage buffers, atomics, and indirect draw — WebGPU has all four.
The pieces that are missing are missing for us too. This claim was made and withdrawn during the
2026-07-14 review; don't let it back in.

---

## Re-check triggers

Revisit this doc — and [D-004](decisions.md) — if Unity ships **all three** of: Memory64/wasm64,
managed C# threads (which requires multithreaded GC in WebAssembly), and a non-experimental
WebGPU backend. Any one alone does not reopen the engine decision; together they would.

Two claims here rest on *absence* of documentation rather than a positive statement, and both
would be settled definitively by a 30-minute experiment rather than another doc search:

1. **Unity GPU timing on WebGPU** — build a Unity 6.5 Web/WebGPU target, log
   `SystemInfo.supportsGpuRecorder` and `FrameTiming.gpuFrameTime` over ~100 frames. Unity's own
   sample code treats `gpuFrameTime == 0` as "platform doesn't support GPU time."
2. **Unity OPFS in the emitted runtime** — grep a build's `*.framework.js` / `*.loader.js` for
   `getDirectory|createSyncAccessHandle|opfs`, and watch Chrome DevTools → Application → Storage
   for bytes landing in File System vs IndexedDB. That converts "not documented" into "not
   present."

---

## Sources (checked 2026-07-14, Unity 6.5 / 6000.5)

**Unity — threading, memory, storage, WebGPU status**
- [Web technical limitations](https://docs.unity3d.com/6000.5/Documentation/Manual/webgl-technical-overview.html) — managed C# threads; Unity `Caching` API unsupported on Web
- [Multithreading with Burst in Unity Web](https://docs.unity3d.com/6000.5/Documentation/Manual/web-multithreading-burst.html) — jobs scheduled from the main thread
- [Memory in Unity Web](https://docs.unity3d.com/Manual/webgl-memory.html) — 4 GB heap ceiling; IndexedDB + Cache API data caching
- [`Application.persistentDataPath`](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Application-persistentDataPath.html) — `/idbfs/<hash>`
- [`Caching`](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/Caching.html) · [Web caching](https://docs.unity3d.com/6000.5/Documentation/Manual/webgl-caching.html)
- [Interacting with browser JS](https://docs.unity3d.com/6000.5/Documentation/Manual/web-interacting-browser-js.html) — `.jslib` is ES5-only
- [WebGPU (Experimental)](https://docs.unity3d.com/6000.5/Documentation/Manual/WebGPU.html) · [WebGPU limitations](https://docs.unity3d.com/6000.5/Documentation/Manual/WebGPU-limitations.html)
- [wasm64 request thread, Mar 2025](https://discussions.unity.com/t/wasm-64-for-webgl/1615192) — no Unity response
- [Burst/Job System web support in 6.4](https://discussions.unity.com/t/burst-compiler-job-system-multithreading-official-web-support-in-unity-6-4/1716721)

**Unity — GPU timing**
- [GPU Usage Profiler module](https://docs.unity3d.com/6000.5/Documentation/Manual/ProfilerGPU.html) — platform table: Web / All WebGL / Not supported
- [FrameTimingManager (manual)](https://docs.unity3d.com/6000.5/Documentation/Manual/frame-timing-manager.html) · [(scripting)](https://docs.unity3d.com/6000.5/Documentation/ScriptReference/FrameTimingManager.html) — "no GPU time is provided"

**Chrome / WebGPU**
- [What's New in WebGPU (Chrome 134)](https://developer.chrome.com/blog/new-in-webgpu-134) — subgroups
- [What's New in WebGPU (Chrome 120)](https://developer.chrome.com/blog/new-in-webgpu-120) — `shader-f16`
- [Multi-Queue Investigation (gpuweb#1065)](https://github.com/gpuweb/gpuweb/issues/1065) — single queue / no async compute
- [WebGPU Compatibility Mode proposal](https://github.com/gpuweb/gpuweb/blob/main/proposals/compatibility-mode.md) — why cube-array is excluded there, and that core is what ships
- [WebGPU storage textures](https://webgpufundamentals.org/webgpu/lessons/webgpu-storage-textures.html) — r32-only read-write formats

**Babylon**
- [`WebGPUEngineOptions`](https://doc.babylonjs.com/typedoc/interfaces/babylon.webgpuengineoptions) — `deviceDescriptor.requiredFeatures: GPUFeatureName[]`
