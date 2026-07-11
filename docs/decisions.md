# Decision log

Append-only (newest first within each status). Every entry: what was decided, why, and
what would reopen it. Reversing a decision gets a *new* entry superseding the old one.
Entries that rest on claims about current technology state (API availability, browser
support, tooling behavior) must be grounded in current sources or local experiments —
not training knowledge — and note what was checked and when (root AGENTS.md rule 9).
Format:

```
## D-NNN: Title  (YYYY-MM-DD, status: accepted | proposed | superseded by D-MMM)
Decision / Context / Consequences / Reopen if
```

---

## D-014: Toolchain  (2026-07-11, accepted)
**Decision:** pnpm workspaces monorepo (`app`, `engine`, `game`, `harness` packages);
TypeScript strict with project references (references enforce the layer import
direction at compile time); Vite for dev server/HMR and app/game builds; the engine
bundle built as a separately versioned library artifact (Rollup or esbuild) as the
target of D-010's double-build hash check; Node LTS + pnpm pinned (`packageManager`
field + `.nvmrc`); Rust pinned via `rust-toolchain.toml` with wasm-bindgen, pinned
binaryen/wasm-opt, and `--remap-path-prefix`; Vitest for unit tests; Playwright
(`channel: 'chrome'` — drives installed stable Chrome per D-013) as the harness browser
driver with raw CDP as the escape hatch; Biome for lint+format.
**Context:** Determinism (D-010) and agent iteration speed drive every pick.
**Consequences:** M0 scaffolds to this shape.
**Reopen if:** any component proves inadequate in practice — swaps are expected to be
cheap early; supersede with a new entry, don't drift silently.

## D-013: Harness targets Chrome stable; Canary only for Chrome-side changes  (2026-07-11, accepted)
**Decision:** All harness runs and budgets target **Chrome stable** (pinned per run,
recorded in results). Canary/dev channels are permitted only when testing Chrome-side
changes (e.g., COS work), always labeled as such and never mixed into stable baselines.
**Context:** Nothing in the current feature matrix requires pre-stable APIs; stable
keeps findings maximally credible/reportable.
**Reopen if:** a committed feature needs an API that hasn't reached stable.

## D-012: App shell lives in top-level `app/`  (2026-07-11, accepted)
**Decision:** The installer/boot/launch shell is a top-level `app/` package — the entry
point that drives install/update UX and boots the engine + game. It imports `engine/`
services (storage, install, telemetry) and may use branded assets from the asset
library, but contains **no gameplay logic or game rules**.
**Context:** The shell is the core loader, not part of the game; it also carries the
lifecycle UX that M2's research lives in, so it deserves first-class structure. Using
game-branded visuals doesn't make it game logic — assets come from the library like any
consumer.
**Consequences:** root AGENTS.md layout table; layer rules extended: `app/` may import
`engine/` (and game manifest/branding data), never `game/` sim internals.

## D-011: Deployment — parallax-web.com on self-controlled nginx; local-first dev  (2026-07-11, accepted)
**Decision:** Production origin is **https://parallax-web.com**, served from
user-controlled hosting (nginx, direct SSH). Additional owned domains are available for
cross-origin work when needed (M8 COS exercise, multi-origin probes). Development runs
fully local against a real local server (never `file://`), with the same header
discipline (COOP/COEP, immutable caching, 304 behavior) as production. Static/
client-side is strongly preferred; the server may exceed static hosting only when a
finding requires it (e.g., signaling for M7), logged here when it happens. Serving
config (nginx + local dev server headers) is versioned in the repo (location settled in
M0). Cloudflare is available but stays **out of the path for cache experiments** unless
it is itself the subject — an intermediary cache would contaminate 304/code-cache
findings.
**Context:** M2's cache research is only credible against real serving infrastructure;
the harness needs both local and production targets.
**Consequences:** M0 builds the local server + header discipline; production serving
lands before M2 cache work; harness runs record which target they measured.
**Reopen if:** hosting constraints prevent required header/protocol control.

## D-010: COS-ready packaging — common/game split, deterministic versioned engine builds  (2026-07-11, accepted)
**Decision:** The isolation model for the north-star platform is **cross-origin
isolation with sharing via Cross-Origin Storage (COS)**: each published game is its own
origin; engine code, shared asset packs, AI models, and (as the platform work matures)
code/Dawn caches are shared across origins by content hash. COS APIs don't exist yet, so
Parallax builds **COS-ready now**:
1. All packaged resources are split into **common** (engine code, shared asset packs,
   kits) and **game-specific** (world data, game logic, unique assets) — separate
   bundles, separately addressed in the manifest — so the common set can move to a
   hash-based COS index without repackaging.
2. **Engine builds are deterministic and versioned:** same source + toolchain ⇒
   byte-identical artifacts (pinned toolchain, no embedded timestamps/build paths,
   stable chunking/minification), because hash-based sharing only works if two
   publishers building the same engine version produce the same bytes. Engine artifacts
   carry explicit versions and never mix game code (the existing layer boundary, now
   also a packaging boundary).
**Context:** User's Chrome-side COS work targets exactly this sharing (including code
caches). Parallax is the realistic consumer that proves the packaging discipline and
quantifies the win.
**Consequences:** Build pipeline emits engine and game bundles separately (M0);
manifest schema distinguishes common vs. game-specific from day one (M2); engine/
AGENTS.md build-determinism rules; the other platform-of-games probes (multi-game quota
contention, instant-play, origin-model comparison) are **dropped from scope** — the
origin model is decided by this entry, and the rest isn't needed for this exploration.
**Reopen if:** COS's shipped shape diverges from hash-based content addressing, or
deterministic builds prove impractical for some artifact class (log why — that's a
finding about the sharing model's feasibility).

## D-009: Install scale — 12 GB content, ≥100 GB architecture floor; gaming-rig baseline; 4K showcase tier  (2026-07-11, accepted)
**Decision:** The two-district experiment ships ≤ 12 GB of content, but every lifecycle
system (manifest, resumable install, integrity, update, streaming/eviction) must support
**at least** 50–100 GB installs — a floor, not a ceiling; no architectural limit may
exist short of disk/OPFS quota. Verified by a synthetic-asset scale test in the harness
(M2), grown until it finds a platform limit or proves there isn't one. Hardware baseline
is a **gaming rig** — low-end devices are out of scope for this experiment (hardware is
an evolving target; the question is what the platform supports given sufficient
hardware). Rendering budgets are tiered: Standard (1440p, gaming-rig baseline) and
Showcase (4K photorealistic, high-end rig), each independently held to frame budgets.
Showcase reference machine: **16 GB system RAM, 12 GB GPU**; showcase memory budgets are
envelope-based (CPU-side ≤ 9 GB, GPU ≤ 10 GB, with OS/browser/compositor headroom
reserved), and the category split inside an envelope may be rebalanced as measurements
come in, with a decision-log note.
**Context:** The project must demonstrate that the web can host super-detailed,
photoreal titles at real AAA-and-beyond install sizes, not just that a 12 GB demo fits.
Testing scale synthetically decouples the architecture proof from content production.
**Consequences:** budgets.md hardware-baseline, quality-tier, and scale-test sections;
pre-install quota check and failure UX designed for ≥100 GB against OPFS's
~60%-of-free-disk quota; per-tier harness runs on both reference machines; memory
budgets in budgets.md are calibrated to the gaming-rig baseline, not lowest-common
hardware.
**Reopen if:** OPFS quota or install-time realities cap installs below ~100 GB on a
gaming rig (that outcome is itself a headline rough-edges finding).

## D-008: Two districts, surface + underground, designed for N  (2026-07-11, accepted)
**Decision:** World ships with District 1 (surface) and District 2 (underground),
connected by choke-point hard transitions. All world/streaming/save code treats district
count and topology as data.
**Context:** Two districts are the minimum to exercise inter-district streaming, which
fundamentally shapes asset packaging and the streaming manager. Underground as D2 gives a
natural full-occlusion boundary — the hardest streaming case (total resident-set swap)
without requiring horizon-scale streaming first.
**Consequences:** Transition contract in budgets.md; D2 exercised in greybox (M4) before
any art exists for it.
**Reopen if:** never for the design-for-N property; district count/theme may change freely.

## D-007: NPC dialog via Chrome built-in Prompt API (on-device Gemini Nano)  (2026-07-11, accepted)
**Decision:** NPC conversation uses Chrome's Prompt API; model download is an
install-phase step. Structured-output JSON schemas gate anything that affects game state.
**Context:** Shipped in Chrome 148 for web pages. The ~4.3 GB model download is
disqualifying for normal sites but folds naturally into our install model — and it is
exactly the kind of capability this demo exists to showcase.
**Consequences:** `ai worker` in the topology; inference/render contention is a standing
measurement target; NPC design must tolerate nano-class model quality.
**Reopen if:** quality is unusable for even constrained NPC dialog, or the API's session
limits make per-NPC state impractical (either outcome is itself a finding).

## D-006: Asset formats — glTF/GLB, KTX2 (BasisU), meshopt; content-addressed per-cell bundles  (2026-07-11, accepted)
**Decision:** As stated. Packaging is per streaming cell with shared kits deduplicated.
**Context:** Native Babylon.js support, GPU-friendly transcode in workers, and
content-addressing enables asset-only updates that never touch code caches.
**Reopen if:** harness shows decode/transcode dominating cell-load p95.

## D-005: Multithreading via explicit worker topology (SAB + OffscreenCanvas + WebGPU-in-worker)  (2026-07-11, accepted)
**Decision:** Parallax designs its own thread architecture (see architecture.md) rather
than inheriting an engine's. Rust→WASM modules (with wasm threads) for compute-heavy
paths.
**Context:** No popular engine ships real multithreading on the web today; on this
platform, threading is an application architecture. Owning the topology is also where
much of the platform research lives.
**Consequences:** COOP/COEP required everywhere, including the harness's serving
infrastructure; every queue/boundary instrumented.
**Reopen if:** WebGPU-in-worker or Babylon-in-worker spikes (M0) fail — fallback is
render on main thread with everything else in workers, logged as a major finding.

## D-004: Engine — TypeScript + Babylon.js (WebGPU only); not Unity, Godot, Bevy, or from-scratch  (2026-07-11, accepted)
**Decision:** Babylon.js as scene/material/animation core; Parallax owns scheduling,
streaming, memory, and the worker fabric. WebGPU backend exclusively — no WebGL2 path.
**Context:** Unity's web export blocks the project's core needs (no C# threads on web,
experimental WebGPU backend, unconfirmed wasm64) and hides the platform behind an opaque
layer, breaking finding-attribution. Godot/Bevy web paths are experimental or
single-threaded (as of 2026-07). Babylon has years-mature WebGPU support, is fully
inspectable, and is the strongest AI-agent target (TypeScript, instant iteration, no
editor round-trips). From-scratch rejected: scene graph/materials/animation/glTF are
solved problems that don't advance either goal.
**Consequences:** We hand-build LOD, occlusion/culling, and world partitioning — accepted
because those systems had to be browser-custom anyway and building them *is* the
research. Where Babylon blocks a WebGPU feature: fork locally or bypass, and log the gap.
**Reopen if:** Babylon proves unable to run in a worker or blocks required WebGPU
features at a structural level; Bevy becomes interesting if/when wasm multithreading
lands there.

## D-003: Install/launch/run lifecycle; OPFS as primary asset store  (2026-07-11, accepted)
**Decision:** The game is an installed application: user-initiated multi-GB install into
OPFS, offline-capable, warm-launch optimized. Storage map in architecture.md; placement
is benchmark-driven per asset class.
**Context:** Origin ideation (docs/history/); OPFS gives worker-side sync access handles
and quota headroom for multi-GB installs.
**Reopen if:** harness shows a better-performing store for a given asset class (move it,
log numbers here).

## D-002: Chrome-only, latest stable or newer; no fallbacks  (2026-07-11, accepted)
**Decision:** Target the newest Chrome (including Canary/Origin-Trial features when
needed). No Firefox/Safari support, no WebGL2 fallback, no compat shims. Missing API =
logged finding, not a workaround.
**Context:** The project is partly a Chrome capabilities demo and rough-edges probe;
compatibility layers would blur attribution and cap the ceiling.
**Reopen if:** project goals change to include distribution beyond the demo audience.

## D-001: Working name "Parallax"  (2026-07-11, accepted)
**Decision:** Project/repo name is Parallax.
**Context:** docs/history/name_history.md. Known minor collisions (a Skyrim texture mod,
a small portfolio site) judged negligible.

---

## Proposed / open

*(Move to accepted with a date when resolved; spikes in plan.md M0 feed these.)*

- **P-001: wasm64 (memory64) adoption per module** — which Rust modules, if any, justify
  the pointer-width overhead for >4 GB address space. Decide after M0 spike + M1 memory
  data.
- **P-002: Geometry representation & rendering-scale strategy** — comparative
  exploration of (a) classic triangle LOD chains, (b) meshlet-based virtualized geometry
  (nanite-like: GPU-driven culling, visibility buffer, WGSL compute), and (c) 3D Gaussian
  splats, including hybrids (e.g., splat environments + triangle interactives — splats
  are weak on dynamic relighting, collision, and animation; triangles stay for anything
  interactive). Includes the original question of GPU-driven culling/instancing and
  whether Babylon's frame graph accommodates it or needs bypass. Evaluation axes: frame
  budget at both quality tiers, streaming/storage cost per visual quality (splats are
  storage-heavy — interacts with D-009 scale), asset-pipeline fit (AI generation
  produces meshes; splats come from capture/reconstruction), and WebGPU compute limits.
  M1 runs the comparative spike on representative content; M5 commits per content class.
  The splat branch also gates the scan-your-world UGC feature (features.md).
- **P-003: Multiplayer topology** — pure P2P mesh vs. host-authoritative peer for the
  M7 exploration. Decide when M3 determinism results are in.
- **P-004: Binary asset storage** — git LFS vs. external content store + manifest for
  `assets/source/` and `assets/library/`. Decide when the first real (non-greybox)
  assets exist (M5 at the latest).
*(P-005, toolchain, was accepted as D-014.)*
