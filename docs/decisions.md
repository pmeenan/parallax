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

## D-020: Toolchain refinements — Rollup, exact pins, reproducibility levels  (2026-07-11, accepted; supersedes D-014)
**Decision:** As D-014, with three refinements. (1) The engine library bundler is
**Rollup** (chosen over esbuild for deterministic, timestamp-free output; exact version
pinned in the lockfile). (2) Pinning is by **exact version** everywhere (`.nvmrc` +
`packageManager` — "LTS" is a policy, the pin is a version); builds normalize locale,
timezone, and path inputs. (3) Playwright drives the pinned Chrome for Testing binary
for gate runs and `channel: 'chrome'` (installed branded stable) for parity smokes —
see D-019. **Reproducibility levels (ties to D-010):** (1) *repeatable* — same-host
double-build hash check, required from M0; (2) *reproducible* — cross-host
bit-identical builds (dev-01 ↔ mac-01), required before the M8 COS exercise, likely
needing a hermetic/containerized build definition; (3) *canonical* — published engine
artifacts that platform publishers consume rather than rebuild, the end-state COS
actually needs (hash-sharing works even if independent rebuilds don't match, because
nobody rebuilds). Level 3 is the fallback if level 2 proves impractical.
**Context:** Review found D-014 left the bundler ambiguous and "repeatable vs.
reproducible vs. canonical" undefined, which D-010's cross-publisher hash-sharing goal
requires.
**Consequences:** M0 scaffolds to this shape; D-010's hash check targets the Rollup
engine artifact.
**Reopen if:** any component proves inadequate in practice — supersede, don't drift.

## D-019: Chrome pinning mechanism — Chrome for Testing archives  (2026-07-11, accepted; supersedes D-013)
**Decision:** As D-013 (stable-only targeting; Canary solely for Chrome-side changes,
always labeled), with the operational mechanism defined: reproducible runs (budget
gates, cross-machine determinism, baselines) use archived **Chrome for Testing**
binaries pinned to the current stable milestone — versioned, non-auto-updating,
retained per platform so any past result can be re-run. A periodic parity smoke run on
the real installed stable channel guards against CfT-vs-branded divergence (any
divergence found is a finding). **"Same version" across platforms** means same
milestone + V8 revision — platform build/patch numbers may legitimately differ.
**Context:** D-013's "pinned per run" was aspirational: installed branded stable
auto-updates independently and cannot serve reproducible baselines or the M3
cross-machine determinism criterion.
**Consequences:** harness/AGENTS.md rule 1 and machines/README.md updated; budgets.md
baseline-promotion policy operates on CfT milestone advances.
**Reopen if:** a committed feature needs an API that hasn't reached stable, or CfT
proves behaviorally divergent from branded stable in a way that matters to findings.

## D-018: Hardware gates — capable-consumer baseline; Showcase calibrated to dev-01; Standard gate is a target profile  (2026-07-11, accepted; supersedes D-009's hardware/tier provisions)
**Decision:** D-009's install-scale provisions stand unchanged (≤ 12 GB experiment
content; ≥ 100 GB architecture floor, not ceiling; synthetic scale tests). Its hardware
and tier provisions are replaced:
- Hardware baseline is **capable consumer hardware** (not "gaming rig"); low-end and
  mobile stay out of scope.
- **Showcase** — 4K, gated on and **calibrated to dev-01 itself** (i9-14900KF, 128 GB,
  RTX 4080 Super 16 GB, 4K @ 60 Hz display, Chrome/D3D12). The abstract 16 GB RAM /
  12 GB GPU reference machine is retired: envelope enforcement on dissimilar hardware
  cannot prove transfer, and the transfer story belongs to the Standard tier. Showcase
  envelopes: GPU ≤ 14 GB, CPU-side ≤ 16 GB — provisional ceilings, rebalanceable within
  the envelope by decision-log note. (These ceilings do not by themselves exercise
  wasm64 — memory64 adoption remains P-001, proven only by a dedicated harness run in
  which a single module addresses beyond 4 GiB.)
- **Standard** — 1440p @ 120 Hz, defined by the **standard-target profile**: M1 Pro
  MacBook Pro (2021), 16 GB unified memory, ProMotion. This is a *profile, not a pinned
  machine*: it registers as `standard-01` only when the physical unit is recorded with
  exact model/size, GPU-core configuration, display mode with verified 120 Hz behavior
  under Chrome, and OS build. Until then Standard runs execute on dev-01 with envelope
  enforcement, labeled provisional, and satisfy no Standard-tier exit criteria.
- The two gates intentionally span Dawn's Metal and D3D12 backends. Quota reality
  (correcting D-009): a Chromium origin may use up to ~60% of **total** disk size, and
  `estimate()` can over-report writable space — preflight is best-effort; the guarantee
  is `QuotaExceededError`-aware incremental writing with resume.
**Context:** Review rounds found D-009's 16/12 reference contradicted by dev-01's
actual hardware, the free-disk quota claim wrong against current docs, and the Standard
machine underspecified.
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (total-disk quota, `estimate()` caveats); user-confirmed machine facts
(dev-01 display 4K @ 60 Hz; Standard profile M1 Pro/120 Hz).
**Consequences:** budgets.md hardware-baseline, quality-tier, frame-gate (per-tier,
refresh-quantized), and memory-envelope sections; harness/machines/README.md.
**Reopen if:** a physical Standard machine is registered (records specs, no new entry
needed); or a mid-range Windows rig joins the fleet and a transfer-focused Showcase
variant becomes worth gating.

## D-017: Prompt API operational model — window broker, activation-correct download, authored fallback  (2026-07-11, accepted; supersedes D-007)
**Decision:** As D-007 (Prompt API for NPC dialog; schema-gated state effects), with
the operational model corrected against current platform behavior:
- The Prompt API is **not available in Web Workers**, so inference runs as a
  **window-owned broker** behind a worker-shaped `engine/ai` interface (migrates when
  worker support lands); broker main-thread impact is a mandatory harness metric.
- Model download starts **directly in the install-button click handler** —
  `LanguageModel.create()` is called within the transient-activation window and
  downloads in parallel with the asset pull (transient activation expires in seconds;
  it does not survive a multi-GB install). Model size varies by version — never
  hardcoded; download requires ~22 GB free on the profile volume.
- **Eviction policy:** Chrome may evict the model under storage pressure. Every NPC
  carries authored fallback dialog; the game stays fully playable offline with reduced
  conversational depth; restoring the model **requires a fresh user gesture** (the
  launch screen offers a "restore AI dialog" action when online — it cannot be
  automatic); evictions are logged as findings.
**Context:** D-007 assumed an `ai worker`, a fixed ~4.3 GB model, and
activation-at-install-time — all contradicted by current documentation and
transient-activation semantics.
**Sources checked (2026-07-11, Chrome 150 era):** developer.chrome.com/docs/ai/prompt-api
(worker unavailability, user activation, 22 GB requirement, variable model size); MDN
transient-activation semantics. M0 spike re-verifies locally.
**Consequences:** no `ai worker` in the topology; fallback lines are part of every
persona card from M3; quest-critical interactions never require the model.
**Reopen if:** worker support lands (move the broker; new entry), quality is unusable
for even constrained NPC dialog, or session limits make per-NPC state impractical
(either outcome is itself a finding).

## D-016: Multiplayer infrastructure and determinism scope  (2026-07-11, accepted)
**Decision:** M7 multiplayer means **reliable internet co-play**: self-hosted signaling
on the D-011 host and STUN are permitted; TURN relay is permitted if measured direct-
connectivity failure rates warrant it. "Serverless" in project language means **no
game-simulation servers** — peers run the sim; infrastructure is limited to connection
establishment/relay. **Determinism scope:** cross-machine within a pinned Chrome
version — same command log ⇒ same state hash across OS/CPU (dev-01 Windows ↔ mac-01
macOS), verified by the harness from M3. Chrome-only helps: one engine (V8), one wasm
runtime; the sim additionally avoids known nondeterminism sources (unseeded RNG,
wall-clock, iteration-order, NaN-bit-pattern-sensitive wasm paths).
**Context:** Real-world WebRTC requires signaling and frequently TURN
(webrtc.org/getting-started/turn-server, checked 2026-07-11); a single-host determinism
check says nothing about cross-peer lockstep suitability.
**Consequences:** features.md multiplayer wording qualified; M3 determinism exit
criterion is cross-machine; offline single-player continues to require zero server
infrastructure.
**Reopen if:** cross-machine determinism proves unachievable at reasonable cost (then
choose rollback/authoritative-state sync over lockstep at M7 — log the evidence).

## D-015: Service worker owns the offline app shell  (2026-07-11, accepted)
**Decision:** A service worker precaches the app shell and serves navigations offline,
with atomic activation + rollback and boot-time version-compatibility checks
(shell/engine/manifest/save schema). Cached navigation responses must preserve
COOP/COEP (verified by harness) or SAB dies offline.
**Context:** The HTTP cache alone does not guarantee offline navigation — eviction is
permitted and navigation needs a controlled response source
(web.dev/articles/service-worker-caching-and-http-caching, checked 2026-07-11). The
offline-launch budget was unimplementable without this.
**Consequences:** SW lifecycle in architecture.md; M2 offline fault suite (offline hard
reload, restart, corrupt cache, interrupted update, disk-full); SW-vs-V8-code-cache
interplay pre-seeded as a rough-edges question (wasm/JS should stay HTTP-cache-served
for code-cache friendliness where possible — measure, don't assume).
**Reopen if:** SW-served responses measurably break V8 code caching for the shell and
no split-serving arrangement resolves it (that's a headline finding).

## D-014: Toolchain  (2026-07-11, superseded by D-020)
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

## D-013: Harness targets Chrome stable; Canary only for Chrome-side changes  (2026-07-11, superseded by D-019)
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

## D-009: Install scale — 12 GB content, ≥100 GB architecture floor; gaming-rig baseline; 4K showcase tier  (2026-07-11, superseded by D-018)
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

## D-007: NPC dialog via Chrome built-in Prompt API (on-device Gemini Nano)  (2026-07-11, superseded by D-017)
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
**Sources checked (2026-07-11):** Unity web technical limitations (docs.unity3d.com —
no managed C# threads on web), Bevy wasm multithreading tracking issue
(github.com/bevyengine/bevy/issues/4078), Godot web export docs; M0 spikes re-verify
WebGPU-in-worker and SAB channels locally.
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
**Sources checked (2026-07-11):** Unity WebGPU manual (experimental status), Unity web
technical limitations, Godot 4.7 web export status (WebGPU experimental behind flag),
Bevy WebGPU/wasm-threading issues, Babylon.js WebGPU support docs
(doc.babylonjs.com/setup/support/webGPU).
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
**Sources checked (2026-07-11):** web.dev/articles/storage-for-the-web + MDN storage
quota docs (~60% of total disk per origin; `estimate()` caveats; `persist()` semantics
— protects the origin, not specific files). Offline shell requires a service worker on
top of this — see D-015. M0 OPFS throughput spike verifies read performance locally.
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
  data. Note: aggregate memory budgets prove nothing about memory64 (multiple memory32
  modules can sum past 4 GB); the actual exercise is a dedicated harness run in which a
  single module addresses data beyond 4 GiB.
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
- **P-006: Storage Buckets for saves vs. assets** — whether separating critical saves
  from replaceable assets into distinct buckets (with different eviction/durability
  characteristics) buys real protection beyond origin `persist()`, or is complexity
  without benefit. Decide during M2 with measurements; interim protection is origin
  persistence + explicit save export (architecture.md).
*(P-005, toolchain, was accepted as D-014 and refined by D-020.)*
