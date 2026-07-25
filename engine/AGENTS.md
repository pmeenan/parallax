# engine/ — Parallax engine layer

Everything platform-facing lives here: this is the only directory allowed to touch
browser APIs (`navigator.*`, WebGPU, OPFS, workers, `WebAssembly.*`,
WebAudio, and later WebRTC). Read the root `AGENTS.md` and
[docs/architecture.md](../docs/architecture.md) before working here — the layer rules and
worker topology defined there govern this directory.

## Scope

**In:** render orchestration (Babylon Lite WebGPU), worker fabric (SAB channels,
lifecycle), streaming manager, storage (OPFS/Cache/manifest/install), Rust→WASM modules,
sim-runtime scaffolding (scheduler, snapshots, command transport), audio, input, save
serialization, AI services (inference sessions, knowledge/retrieval context assembly —
D-033), instrumentation.

**Out:** game rules, content, world data, NPC personas, UI layouts — those are `game/`.
If you're writing a string a player will see or a rule a designer would tune, you're in
the wrong directory.

## Planned structure (create directories as their milestone starts; update this list)

Source lives under `engine/src/`. Directories marked ✅ exist (M0 walking skeleton);
the rest are created as their milestone starts.

```
engine/src/
  core/        types, ids, math, time, event/command plumbing
  workers/     worker entrypoints + SAB channel library                    ✅ (render worker + SPSC rings)
  render/      Babylon Lite integration, pipeline warmup, custom WGSL passes ✅ (service + protocol)
  streaming/ ✅ cell scheduler, memory budget governor, eviction
  storage/     OPFS, manifest, install/update, integrity                    ✅
  wasm/        Rust crates (one per module) + JS bindings                    ✅ (M0 threads proof)
  ai/          app-owned inference (D-074/D-096), knowledge service /       ✅
               retrieval context assembly (D-033), schema-constrained output
  audio/       WebAudio graph + worklets
  input/       keyboard/mouse/gamepad → command stream
  save/        snapshot/delta serialization
  telemetry/   counters, timings, harness export surface                   ✅ (export surface)
```

## Rules

1. **Every subsystem is a service with an explicit interface** consumed by `game/` or
   other engine services. No reaching into another service's internals.
2. **Main thread is sacred.** Nothing here may block or do sustained work on the main
   thread. Long tasks > 50 ms on main during gameplay are budget violations.
3. **Memory is budgeted, never assumed.** Allocations on hot paths come from pools sized
   at boot; SAB sizes are boot-time constants recorded in telemetry.
4. **Instrument as you build** (root rule 5): a subsystem without telemetry counters is
   incomplete. Telemetry is exported through `telemetry/` in the harness's format.
5. **Babylon Lite is a dependency, not a framework.** Parallax owns the loop, scheduling,
   and memory. If Lite blocks a needed feature, bypass or patch locally and record the
   library gap in rendering-engine-research.md plus any resulting decision. Reserve
   [docs/rough-edges.md](../docs/rough-edges.md) for browser/platform gaps.
6. **Failed platform experiments are findings.** If an API can't do what we need, write
   the rough-edges entry with the repro before working around it.
7. **Engine artifacts are shareable by hash (D-010).** Engine bundles build
   deterministically — same source + pinned toolchain ⇒ byte-identical output (no
   timestamps, build paths, or nondeterministic ordering in artifacts). The pipeline's
   double-build hash check enforces D-020 **level 1** (same-host repeatability): it
   varies the output directory but builds from the same source path and environment, so
   it cannot detect source-path or env embedding — those are covered by the D-020
   level-2 cross-host gate (pre-M8), not by this check. Don't cite the M0 gate as proof
   of more than same-host repeatability. Engine bundles carry explicit versions,
   contain zero game code or game data, and must load/initialize without any
   game-specific bundle present. This is what lets engine code move to a Cross-Origin
   Storage hash index and be shared across published games.

## Language conventions

- **TypeScript:** strict mode; no `any` without a justifying comment; no implicit
  main-thread singletons (everything must know which worker it lives in).
- **WGSL:** one entrypoint per file; constants via pipeline-overridable constants or a
  generated constants header — never string-spliced shader source; every pipeline
  creation goes through the warmup-aware pipeline registry in `render/`.
- **Rust/WASM:** one crate per module under `wasm/`; `#![forbid(unsafe_code)]` unless the
  module's README justifies it; explicit about memory32 vs memory64 (see decision P-001);
  bindings expose typed-array views, never copies, on hot paths; `simd128` and threads
  (atomics) are baseline target features (D-032) — enabled unconditionally, no scalar or
  single-threaded fallback paths; relaxed-simd is baseline too **except** in crates
  feeding deterministic simulation state (relaxed ops are hardware-dependent and break
  D-016's cross-machine state hashes — plain simd128 only there); moving
  wider-than-128-bit work to WGSL compute is a D-032 hypothesis the harness confirms
  per kernel, not a standing rule.
