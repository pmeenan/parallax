# Decision log

Newest first. Every entry: what was decided, why, and what would reopen it. Existing
entries are never edited into a different decision — reversing or amending one gets a
*new* entry that supersedes it (a status-line annotation on the old entry is fine).
Entries that rest on claims about current technology state (API availability, browser
support, tooling behavior) must be grounded in current sources or local experiments —
not training knowledge — and note what was checked and when (root AGENTS.md rule 10).

**Reading:** scan the D-NNN headings (or grep) and read only the entries your task
touches. Full read is for structural or cross-cutting work.

**Culling (D-023):** the log is periodically pruned — superseded or moot entries whose
context no longer informs anything current are deleted outright; git history is the
archive. D-numbers are never reused, so a citation to a culled entry stays unambiguous
(recover it from git history if needed). One guard: some entries are written as diffs
against the entry they supersede (e.g., D-020 is "as D-014, with refinements") — a
superseded entry whose content a live entry builds on cannot be culled until that
content is folded forward into a self-contained entry.

Format:

```
## D-NNN: Title  (YYYY-MM-DD, status: accepted | proposed | superseded by D-MMM)
Decision / Context / Consequences / Reopen if
```

---

## D-035: Viz presentation-feedback trace is diagnostic, not a presentation gate  (2026-07-13, accepted)
**Decision:** `smoke@1` records GPU-process `Display::FrameDisplayed` intervals as the
explicitly non-gating `vizPresentationFeedbackCallbackIntervalMs` diagnostic. It does not
satisfy budgets.md's compositor-presentation metric, which remains mandatory and invalid.
The collector enables only `disabled-by-default-display.framedisplayed` plus
`blink.user_timing`; renderer `performance.mark()` instants bound the run in Chrome's
shared monotonic trace clock. A usable diagnostic requires no trace loss, exactly one GPU
process/track, and feedback spanning both boundaries. A 100 ms post-marker trace tail sits
outside app/CPU measurement so the final callback can close the boundary interval. Smoke
result schema advances to v3 for the diagnostic and its cross-repeat variance. Trace
end/completion is bounded as one five-second transaction; timeout or CDP disconnect makes
only the diagnostic invalid and always detaches the session.

**Context:** Chromium's Viz `Display::DidReceivePresentationFeedback` sanitizes invalid
feedback to `PresentationFeedback::Failure()`, whose timestamp is the failure time and whose
flags contain `kFailure`, then emits `Display::FrameDisplayed` with only the timestamp/name.
The trace event does not expose that failure flag. Treating every event as successful
scan-out could therefore report a passing cadence when presentation actually failed. A
local diagnostic on branded Chrome Stable 150.0.7871.102, Windows 11, RTX 4080
Super/D3D12, observed one callback track and correlated it with the worker's ~32 Hz pacing;
that validates collection/clock alignment, not display success. RE-005 records the
branded-vs-pinned cadence question and RE-006 the blocking observability gap.

**Consequences:** The harness preserves useful compositor-adjacent evidence without
weakening the true frame gate or substituting worker callbacks. Trace ambiguity/loss makes
only the diagnostic invalid and does not independently fail a run. The mandatory metric's
explicit invalid state continues to fail Harness v1. A browser surface that exposes both
the timestamp and presentation-success flags—or another independently correlated source—is
required before applying frame budgets. External trace markers also remain unsuitable for
D-025's eventual driver-free in-game measurement path.

**Sources checked (2026-07-13):** Chromium
`components/viz/service/display/display.cc` at main (sanitization and trace emission),
`ui/gfx/presentation_feedback.h` at main (`Failure()`, `kFailure`, and timestamp semantics),
`base/trace_event/builtin_categories.h` at main (the dedicated category), and the Chrome
DevTools Protocol Tracing-domain documentation (completion, delivery, and data loss). Local
behavior was checked directly as described above.

**Reopen if:** Chrome exposes the feedback flags in a correlated trace/CDP event, a stable
page-correlated presentation API becomes available, or a separate probe can prove that all
events in the gate window represent successful scan-out.

## D-034: Harness gates versioned observed environments from a physical console  (2026-07-13, accepted)
**Decision:** Reference-machine identities live as versioned descriptors in
`harness/machines/`; `smoke@1` verifies the requested tier against observed state rather
than caller-provided GPU/backend/power/display labels. The initial Windows verifier checks
the exact OS build, CPU topology, minimum RAM, CDP primary-GPU PCI IDs and driver, WebGPU
adapter vendor/architecture/device/driver/backend, active Windows power-scheme GUID, and
display-controller resolution/refresh. Every gate browser launches native fullscreen without
Playwright viewport emulation, ties its own `screen` dimensions at its device-pixel ratio to
the target physical resolution, requires every refresh rate reported by Chrome GPU Internals
to match the tier, and verifies the canvas device-pixel surface equals the tier resolution;
Chrome-internals diagnostics complete before the full warmup, then each measurement browser
samples screen/surface identity at the immediate boundaries of its 120-frame window and
continuously records device-pixel resize events during the window, with any drift invalidating
the result. Windows display adapters are matched to the descriptor by PCI vendor/device IDs,
not mutable display names; any other active adapter is rejected as unregistered. The short-lived
identity browser loads a minimal harness-control document and enables Chrome's WebGPU
developer-features switch solely to read the
non-standard adapter backend and driver;
measurement browsers do not enable that switch. Host identity is sampled before and after
the six measurement launches, and any drift invalidates the result. A remote Windows session,
remote/indirect display adapter, unregistered tier, missing descriptor, or any mismatch makes
the mandatory environment metric `invalid`. Reference gates require advance notice to the
developer and a native local interactive session at the physical machine; remote sessions
remain valid only for explicitly non-gating development diagnostics.

**Context:** Machine/backend/power/display fields in the first `smoke@1` report were
declarations and therefore could not establish gate eligibility (D-031). A local CfT
150.0.7871.115 experiment on dev-01 on 2026-07-13 showed why: under RDP, Windows' physical
NVIDIA controller reported 3840×2160 at 59 Hz while Chrome's GPU Internals accessibility
tree reported three remote displays at 32 Hz; Windows also exposed a Microsoft Remote
Display Adapter. The same pinned Chrome, launched separately with
`--enable-webgpu-developer-features`, exposed the selected adapter as NVIDIA Lovelace,
D3D12, driver 32.0.15.9649. Chrome documents the extended `GPUAdapterInfo.backend` and
`driver` fields as developer-only, and CDP documents GPU PCI/driver fields but not the
selected WebGPU backend, so both probes are needed.

The first physical-console verification later on 2026-07-13 found the installed NVIDIA
driver had advanced to 32.0.16.1074; Windows, CDP, and developer-mode WebGPU adapter info
agreed, so that version is the explicitly promoted dev-01 descriptor baseline. The earlier
RDP evidence retains its observed version rather than being rewritten.

**Consequences:** `PARALLAX_GPU_BACKEND` and `PARALLAX_POWER_MODE` are removed; future
machine registrations add descriptors and platform probes instead of trusting labels. OS,
driver, or power-plan promotion is visible in review. The developer-features switch can
change development-only WebGPU behavior, so isolating it to identity inspection avoids
silently changing the measured runtime. The Harness v1 environment probe is implemented,
and its dev-01 native-console measurement was `measured` across all three fresh/warm pairs on
2026-07-13; other mandatory probes still keep Harness v1 incomplete. The smoke result schema advances to v2 for the observed machine,
adapter, browser-display, and pre/post host-identity fields. Result-contract field names remain
browser-neutral (`executableSha256`, `refreshRatesHz`) even where the current privileged probe
is Chrome-specific; probe failures are retained in browser-neutral `probeFailures` evidence
and invalidate the environment so a completed measurement report is still written. Machine
IDs are accepted case-insensitively and persisted using the descriptor's canonical lowercase
ID. Descriptive CPU/WebGPU strings compare case-insensitively with whitespace normalized;
numeric PCI IDs, OS/driver/browser versions, measured dimensions/rates, and power GUIDs
remain strict.
This supersedes D-031's initial fixed-headed-viewport provision: native fullscreen plus an
explicit render-surface assertion makes each measured browser prove its presentation monitor
instead of accepting an emulated `window.screen`.

The native run also established that Chrome's `devicePixelContentBoxSize` is consistently
3841×2161 on dev-01's 3840×2160 display under its fractional Windows scale. The descriptor's
explicit ±2-pixel physical-dimension tolerance therefore applies to both observed screen and
render-surface checks; the actual surface remains recorded per run (RE-003).

**Sources checked (2026-07-13):** local dev-01 experiments described above;
`chromedevtools.github.io/devtools-protocol/tot/SystemInfo/`;
`developer.chrome.com/docs/web-platform/webgpu/developer-features`; and Chromium's
`gpu/config/gpu_switches.cc` definition of `enable-webgpu-developer-features`.

**Reopen if:** Chrome exposes the selected WebGPU backend through a stable, non-mutating
CDP surface; OS display APIs cannot identify the actual presentation display; a remote
transport can prove unmodified physical display timing; or exact OS/driver pins cause more
baseline churn than research value.

## D-033: NPC context is assembled by a knowledge service in engine/ai  (2026-07-13, accepted)
**Decision:** The AI layer gains a **knowledge service** in `engine/ai`: NPC prompts are
assembled as persona card + context retrieved through an explicit interface — never by
hardcoding all world knowledge into the prompt. Three context tiers, each adopting its
own mechanism independently, on evidence:
1. **Structured game-state queries** — quest state, relationships, location/world-graph
   facts answered from the sim's typed state. Deterministic, no embeddings, debuggable;
   the default tool, and it lands with M3.
2. **Authored lore retrieval** — world backstory chunked + tagged at authoring time,
   shipped as a content-addressed game-specific bundle (D-010). Mechanism open:
   tag/world-graph lookup vs. precomputed embeddings with brute-force similarity (at
   game-scale corpora — thousands of chunks — a linear scan in a wasm simd128 worker
   suffices; no vector database). Build-later.
3. **Episodic memory** — NPC observations embedded at runtime. Requires an app-owned
   embedder: Chrome ships **no built-in Embedding API** (checked 2026-07-13).
   Build-later.
**Ownership (layer rules apply as everywhere):** `engine/ai` owns the *generic
contract* — provider registration, context assembly/ranking/token budgeting, scheduling,
telemetry — and contains no game knowledge. `game/` supplies the providers: game-state
query implementations, retrieval schemas, lore content and its tagging, persona cards.
The tier list above describes what game-supplied providers answer, not what engine code
knows.
Design-now constraints: the M3 prompt/persona-card schema reserves a retrieved-context
slot from day one; lore is authored chunked + tagged in `game/` from the first writing;
embedding precompute, if adopted, is an `assets/` pipeline step. The service is
**backend-independent of D-017/P-007** — whichever generation backend wins, retrieval
infrastructure is app-owned.
**Context:** On-device, prompt-stuffing is triply wrong: prefill cost scales with prompt
length (time-to-first-token is the dialog latency the player feels), Nano session/context
limits are an already-flagged D-017 concern, and small models degrade on long
mostly-irrelevant context. Unlike generic RAG deployments, a game has an authoritative,
queryable ground truth (the sim state and world graph) — so semantic retrieval is the
fallback for freeform lore and memories, not the default mechanism. Persona cards remain
what they always were: curated static context.
**Sources checked (2026-07-13):** developer.chrome.com/docs/ai/built-in lists Prompt,
Summarizer, Translator, Language Detector, Writer, Rewriter, Proofreader — no Embedding
API. App-owned in-browser embedding is feasible today: EmbeddingGemma (~308M on-device
embedder, developers.googleblog.com/en/introducing-embeddinggemma) runs in-browser via
Transformers.js with WebGPU (huggingface.co/docs/transformers.js/guides/webgpu).
**Consequences:** engine/AGENTS.md `ai/` scope; architecture.md NPC AI section and
forward-design constraints; plan.md M3 item; rough-edges.md pre-seeds the missing
Embedding API gap; P-007's "facts stay prompt-context" phrasing refined — facts stay out
of the *weights* and arrive via assembled context.
**Reopen if:** M3 evidence shows persona cards alone suffice at shipped scale (drop the
unused tiers, keep the interface), or a Chrome built-in Embedding API ships (re-evaluate
tier-3 embedder ownership — and update the rough-edges entry).

## D-032: Performance-first technology placement — JS is glue; wasm SIMD/threads baseline  (2026-07-13, accepted)
**Decision:** Per-subsystem language/technology placement is a performance decision made
on harness evidence, with no presumption that TypeScript is the default and wasm/WGSL the
exception. TS/JS is orchestration and glue; compute-heavy paths are presumed Rust→wasm or
WGSL compute until measurement says otherwise — and the reverse presumption is equally
banned: JS↔wasm boundary-crossing cost is real (wasm cannot call WebGPU/OPFS/web APIs
directly; every call bounces through JS glue), so "rewrite it in wasm" is also a claim
the harness must confirm. **Baseline machine/browser requirements:** wasm `simd128` and
threads (atomics + SAB) are required; engine wasm crates enable them unconditionally and
ship no scalar or single-threaded fallback paths. Relaxed-simd is baseline too **except
in crates that feed deterministic simulation state**: relaxed operations are
hardware-dependent by design (FMA contraction, lane-select and min/max edge cases differ
across x86/ARM), which is incompatible with D-016's cross-machine state-hash requirement
— authoritative-sim crates use plain simd128 only. Wasm's SIMD is fixed 128-bit — no
SSE/AVX passthrough, no 256/512-bit path — but what that ceiling costs is
machine-dependent (dev-01's x86 has AVX2-class width to lose; the Standard profile's
M1 Pro is itself 128-bit NEON), and "wider-than-128-bit work moves to WGSL compute" is a
working **hypothesis**, not a placement rule: the standing rough-edges item compares
native (AVX2/NEON), wasm simd128, and WGSL compute on a representative kernel per
reference machine before any rule is fixed. Rust stays the authored language for engine wasm
modules (determinism, D-014/D-020); consuming existing C/C++ libraries compiled to wasm
(e.g., Basis transcoder, meshoptimizer per D-006) is consistent with this.
**Context:** A project-level review against a "maximum performance on the web platform,
JS as glue" principle found the stance already de facto (D-004/D-005 chose Babylon for
AI-iteration speed and attribution, not JS purity; wasm hot paths and custom WGSL passes
were always planned) but nowhere explicit, leaving room for future agents to drift
JS-first out of web idiom. This entry makes the principle a citable rule.
**Sources checked (2026-07-13):** relaxed-simd standardized 2024, shipped in Chrome
(github.com/WebAssembly/relaxed-simd;
platform.uno/blog/the-state-of-webassembly-2025-2026); flexible-vectors (length-agnostic
wider SIMD) still stage-1 design (github.com/WebAssembly/flexible-vectors);
emscripten.org/docs/porting/simd.html (simd128 ↔ SSE/NEON-class mapping).
**Consequences:** engine/AGENTS.md Rust/WASM conventions gain the SIMD/threads baseline,
the no-fallback rule, and the deterministic-sim relaxed-simd carve-out; root AGENTS.md
stack constraint names the baseline; rough-edges.md pre-seeds the CPU SIMD-width-ceiling
measurement (native AVX2/NEON vs. wasm simd128 vs. WGSL compute, per reference machine).
**Reopen if:** flexible-vectors or another wider-SIMD path ships in Chrome (recalibrate
the CPU/GPU split), or measurements show boundary overhead systematically negating wasm
wins for a whole subsystem class (record the placement rule that replaces the
presumption).

## D-031: Harness smoke gates an exact external Chrome for Testing pin  (2026-07-12, accepted)
**Decision:** The first Harness v1 scenario is versioned as `smoke@1` and is driven by
exact-pinned `playwright-core`. Gate runs require `PARALLAX_CHROME_PATH` to name an
externally archived Chrome for Testing executable whose full version matches
`harness/chrome/stable.json` and whose executable SHA-256 matches the platform pin; the
runner never downloads a moving browser or silently falls back to installed branded
Chrome. Each of three repeat lineages starts with an
empty persistent profile and is relaunched once warm. Both launches exclude 10 seconds,
then record 120 recent render-worker frames. Worker animation-callback spacing is a
nearest-rank diagnostic, not a presentation-budget metric; true compositor
present-to-present timing stays mandatory and invalid until a validated probe exists,
and callback p95 variance above 10% makes that diagnostic invalid. The versioned
scenario, tier profiles, and single mandatory/incomplete metric registry live together
in `harness/src/runs/`.
As amended by D-034, the requested tier fixes a verified native-fullscreen display and
device-pixel render surface rather than a Playwright-emulated headed viewport. Reports are local ignored artifacts
and fail on measured budgets, browser errors, version mismatch, unverified gate identity,
or any other unfinished Harness-v1-mandatory probe.

**Context:** D-019 requires archived CfT rather than auto-updating branded Chrome, and
D-020 chose Playwright. Playwright's official browser documentation confirms that it
can drive branded Chrome and that browser channels differ from its default Chromium;
Chrome's official CfT documentation provides versioned downloads and JSON endpoints.
On 2026-07-12 the official last-known-good endpoint reported Stable 150.0.7871.115,
revision 1639810; that exact version was downloaded and locally verified before the
first run. The run produced stable callback-pacing evidence recorded as RE-001 and
exposed that callback timestamps cannot satisfy the presentation metric.

**Consequences:** Updating the pin is an explicit baseline-promotion action, not a
package update side effect. Machine-local browser archives stay outside git. Installed
branded Stable remains reserved for D-019 parity smoke work. The overall Harness v1
checkbox remains open until presentation, environment, Dawn/V8 cache, and pipeline
probes land; missing mandatory metrics are explicit invalid states rather than passing
by omission. Local-server metrics exclude their own endpoint and atomically publish
only completed-request deltas, so observation neither contaminates nor blocks a run.
Artifact, executable, tracked-diff, and untracked-file hashes stream rather than buffer
multi-GB inputs. This M0 driver-run window is not a D-025 benchmark result; M1 still moves
scenario boundaries, aggregation, and export in-game before exposing benchmark mode.

**Sources checked (2026-07-12):**
`playwright.dev/docs/browsers` and
`developer.chrome.com/blog/chrome-for-testing/`; the live pin came from
`googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json`.

**Reopen if:** CfT archives cannot reproduce branded Chrome behavior, external browser
bootstrap is too error-prone, or the smoke scene needs an in-app measurement window to
keep later D-025 manual and automated paths identical.

## D-030: Findings handback runs in fix-pass and verify-pass modes  (2026-07-12, accepted)
**Decision:** Two more kickoff prompts get encoded operating models in workflow.md,
completing the review loop started by D-026/D-027. Handing an agent review results or
findings ("here are the review findings — address them") invokes **fix-pass mode**: the
agent independently verifies each finding before acting (findings are claims per D-027,
not orders), fixes confirmed ones at root cause with docs-with-code and re-verification,
rebuts unconfirmed ones with concrete evidence, and ends with a self-contained
per-finding disposition report. Asking an agent to "verify the fixes" invokes
**verify-pass mode**: given the original findings and the fix agent's dispositions, the
agent verifies each fix against the working tree rather than trusting the report,
independently adjudicates each pushback, stays read-only by default (like reviewer
mode), and reports a per-finding verdict (fix verified / fix incomplete / pushback
accepted / pushback rejected).
**Context:** Same motivation as D-026/D-027 — the human was restating these two process
descriptions in every handback and fix-verification prompt. Encoding them makes the full
loop (review → fix or push back → verify) invocable with short prompts, and makes
independent re-verification the default at both steps instead of prompt-dependent.
**Consequences:** workflow.md gains "Findings handback: fix-pass mode" and
"Fix verification: verify-pass mode"; handback and verification prompts need no process
language; fix-pass agents are expected to push back rather than blindly apply findings.
**Reopen if:** the disposition/verdict categories prove too coarse in practice, or the
verify pass consistently finds nothing and becomes ceremony worth dropping.

## D-029: M0 in-app telemetry export surface  (2026-07-12, accepted)
**Decision:** Engine telemetry is exposed on the window as a non-writable
`globalThis.__PARALLAX_TELEMETRY__` object with a versioned snapshot/subscribe contract.
Schema v1 begins with render lifecycle state, initialization-to-first-frame time,
failure detail, engine/game version identity, total frame count, and a fixed 120-sample
recent-frame window; the render worker sends 60-frame batches so instrumentation does
not add per-frame main-thread messages. Initialization has two explicit phases: end-to-end worker startup
(immediately before construction through first frame, including module load/evaluation)
and worker-local initialization (start message through first frame). The harness
consumes only this public surface, never engine internals. Full result aggregation and
mandatory metrics remain Harness v1 scope.
**Context:** The walking skeleton introduces the first runtime subsystem, and project
rules require instrumentation and a harness-facing export from day one. A fixed sample
window prevents telemetry memory from growing during long runs while subscriptions let
the harness collect every batch during a measurement window.
**Consequences:** Changes to the global name or schema are versioned contract changes.
The app installs the export explicitly from the render service; the engine does not use
an implicit main-thread singleton.
**Reopen if:** CDP bindings or another measured transport proves more reliable without
making the harness depend on engine internals.

## D-028: M0 local artifact and serving contract  (2026-07-12, accepted)
**Decision:** The M0 build assembles a static `dist/` tree with an unhashed `index.html`
and all executable modules under `dist/immutable/`. Engine and game
package builds retain stable, independently loadable entry names; the assembler gives
their served copies SHA-256-derived names and connects them to the app with an import
map, so Vite cannot fold either boundary back into the app bundle. The version-controlled
local server lives in `harness/`, uses Node's HTTP implementation, applies
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to every response (including 304s), serves
content-addressed modules with a one-year immutable policy, and requires revalidation
for unhashed files. Strong SHA-256 ETags drive conditional requests using RFC 9110's
weak comparison, wildcard, and list semantics for `If-None-Match`; the static server
rejects unsupported methods. The generated
`build-manifest.json` records sorted paths, byte counts, and full SHA-256 digests for
the exact assembled artifacts. Served module filenames include the full SHA-256 digest.
The engine's separately built render-worker URL uses the build-time
`__RENDER_WORKER_ARTIFACT__` token: the assembler hashes and writes the worker first,
replaces that token in `engine.js` while retaining its `./` sibling-URL prefix, then
hashes the rewritten engine artifact. The build-contract test gates this two-sided
engine/assembler contract.
The local server caches validated ETag metadata across requests and exposes versioned
request/cache counters at `/__parallax/metrics`; conditional 304 responses therefore do
not reread or rehash unchanged artifacts.
**Context:** D-011 deliberately left the local serving-config location to M0. D-010
requires a real packaging boundary, not merely separate source directories, and the
harness must be able to identify exact bytes. Automated local tests on 2026-07-12
verified isolation/cache headers on 200 and 304 responses and the conditional-request
cases defined by RFC 9110 (`datatracker.ietf.org/doc/html/rfc9110`, checked 2026-07-12);
the assembled-build contract gate verified references and content digests, and a
same-host double build verified identical engine bytes. Dependency versions were checked against the npm
registry on 2026-07-12; Node 24's LTS status was checked against the official Node.js
release table (`nodejs.org/en/about/previous-releases`, checked 2026-07-12) the same
day.
**Consequences:** `pnpm start` is the local build-and-serve entry point, and `pnpm build`
includes the same-host engine repeatability gate. Production
nginx remains deferred to M2 per D-011/D-022, and `site/` remains untouched. The M0
repeatability gate covers engine artifact bytes; cross-host reproducibility remains the
later D-020 level-2 gate.
**Reopen if:** the local server diverges from production semantics, import maps prevent
a required cache/code-cache experiment, or the assembled artifact contract cannot
represent a new common/game-specific resource class without ambiguity.

## D-027: Review passes run in reviewer mode  (2026-07-12, accepted)
**Decision:** A kickoff prompt asking for a review of current changes ("review the
current changes") invokes the **reviewer operating model** in workflow.md: the unit
under review is the entire uncommitted working tree (diff against last commit plus
untracked files, including docs-moved-with-code); the reviewer is **read-only by
default** (the implementing agent owns fixes; the reviewer edits only when the human
says to fix directly); review scope covers correctness, AGENTS.md rule compliance,
missing decision/rough-edges entries, budget implications, and better-approach
suggestions clearly labeled as suggestions rather than defects; findings are verified
with cheap checks before being reported (root rule 3); and the report is written for
verbatim handback to the implementing agent — self-contained findings (file:line, what,
why, severity, suggested fix) phrased as claims to verify or rebut with evidence,
ranked most-severe first. A clean review is a valid result.
**Context:** Companion to D-026 — the human runs review passes from separate agent
sessions (workflow step 2) and was specifying the process in each prompt; encoding it
makes "review the current changes" sufficient. Read-only-by-default keeps the handback
loop clean: one agent's understanding of the change stays authoritative for fixes.
**Consequences:** workflow.md gains "Review passes: reviewer mode"; review kickoff
prompts need no process language; findings-as-verifiable-claims matches tech-lead
mode's duty to address or rebut every finding.
**Reopen if:** the handback loop proves slower than reviewers fixing in place — then
define when a reviewer may fix directly (and how the implementing agent is informed).

## D-026: Milestone work runs in tech-lead mode  (2026-07-12, accepted)
**Decision:** A kickoff prompt naming a milestone ("start work on M0") invokes the
**tech-lead operating model** defined in workflow.md: the lead agent scopes a
commit-sized slice from plan.md in dependency order; delegates well-scoped pieces to
subagents with per-task model/reasoning-effort choices; serializes writing subagents
(shared working tree) while parallelizing read-only work; owns acceptance with evidence
(runs the checks itself — subagent success reports are assertions, not measurements);
retains the cross-cutting duties (decision log, rough-edges, docs-with-code, budgets)
regardless of delegation; and, once it believes the slice complete, spawns a
fresh-context **adversarial reviewer** over the full working-tree diff briefed to find
problems, addressing findings before handoff.
**Context:** The human was pasting this operating model into every milestone kickoff
prompt; encoding it in workflow.md (universally required reading, D-023) reduces the
prompt to naming the milestone and makes the collaboration contract reviewable and
evolvable like everything else.
**Consequences:** workflow.md gains the "Milestone work: tech-lead mode" section;
kickoff prompts need no process language.
**Reopen if:** orchestration tooling changes materially (e.g., per-subagent isolated
worktrees become standard, relaxing the serial-writers rule).

## D-025: In-game benchmark mode is a public front end to the harness  (2026-07-12, accepted)
**Decision:** Parallax ships a benchmark mode that runs the same versioned,
deterministic scenarios and consumes the same telemetry/result schema as the automated
harness. It is launched and run **entirely in-game**: scenario control, warm-up,
repeats, measurement-window boundaries, metric collection, aggregation, environment
capture, and result export require no external automation. It provides fixed
quality/resolution controls, seed and camera/input path, warm-up and repeat policy, and
exports both machine-readable JSON and a human-readable summary. Results identify the
exact game artifact, scenario, browser/engine version, OS, GPU/driver, display/power
state, and metric support. It reports distributions and phase timings, not a synthetic
single score. External automation may navigate to or start benchmark mode and collect
the finished artifact for CI, but stays outside the measured path; a manually launched
run is equally valid under the same eligibility rules. The mode is usable in other
browsers for engine comparisons, but Chrome on the reference machines remains the only
budget gate; non-Chrome runs are advisory. Benchmark mode adds no compatibility paths:
an unchanged build either runs, marks individual metrics `unsupported`, or produces a
capability-failure result identifying the missing surface.
**Context:** The harness is already an independently useful deliverable and the game
already needs deterministic flythroughs, stable telemetry, environment identity, and
repeat/variance rules. Exposing those through the game makes Parallax useful for
comparing browser engines and hardware without building a second measurement system.
A single score would conceal whether a difference came from presentation pacing, CPU,
GPU, streaming, compilation, or unsupported observability, undermining the project's
attribution goal. Cross-browser measurement is not cross-browser support (D-002).
**Consequences:** the M0 result contract stays browser-engine-neutral even though the
automation initially drives Chrome; its schema includes provenance distinguishing
in-game measurements from optional launcher/collector timings. M1 exposes the canonical
D1 flythrough as a self-contained in-game benchmark; later canonical scenarios join it
as they land. Public results are comparable only when artifact, scenario, settings, and
environment fields match, and unsupported metrics remain visible rather than being
imputed.
**Reopen if:** the in-game runner cannot reproduce harness scenario semantics closely
enough to compare results; keep the export/telemetry UI but label manual runs separately.

## D-024: Uninstall joins the lifecycle — confirmed, dual-mechanism, measured  (2026-07-12, accepted)
**Decision:** The install/launch/run/update lifecycle gains a fifth stage, **uninstall**,
in scope for M2. The app shell (D-012) offers user-initiated uninstall behind an
**explicit confirmation** that states what will be deleted (installed assets, caches,
service worker, saves) and offers save export first (architecture.md's
export-before-destructive-storage-op rule). Two mechanisms are built and measured
against each other: (1) **client-side teardown** — service-worker unregister, OPFS
clear, Cache Storage + IndexedDB deletion, quota-release verification via
`navigator.storage.estimate()`; (2) a **`Clear-Site-Data` endpoint** — a static nginx
location (`/uninstall`) attaching `Clear-Site-Data: "storage", "cache"`, within D-011's
static-serving preference. Actual coverage of each is a measurement, not an assumption:
does `"storage"` clear OPFS; does `"cache"` clear the V8 code cache and GPU/shader
caches (which would also make the endpoint a useful harness "reset origin to cold"
primitive); asymmetries go to rough-edges.md. The Gemini Nano model is Chrome-managed
and browser-wide, not origin storage (D-017): uninstall does not remove it, and the
confirmation UX must not imply it does.
**Context:** A native-title lifecycle demo is incomplete if the only removal path is
digging through browser settings. Checked 2026-07-12 (MDN Clear-Site-Data reference;
web.dev OPFS article): MDN lists `"storage"` as clearing DOM storage incl. IndexedDB
and service-worker registrations — OPFS not explicitly named — and `"cache"` as
clearing cached data incl. script and shader caches; web.dev states OPFS is deleted
when site data is cleared. That documentation gap is itself why coverage gets measured
locally (root rules 3/10) rather than trusted.
**Consequences:** architecture.md lifecycle stage 5; plan.md M2 uninstall item;
features.md install-lifecycle row includes uninstall; harness gains an
uninstall-verification check (storage actually released).
**Reopen if:** measurement shows one mechanism strictly dominates — collapse to it then
and record the numbers.

## D-023: Context-lean doc policy — on-demand doc map, scan-first logs, decision culling  (2026-07-12, accepted)
**Decision:** Agent context is managed pull-based, not push-based. (1) Root AGENTS.md's
"required reading" mandate (vision + architecture + workflow before any non-trivial
work) is replaced by a **doc map**: workflow.md stays universally required (~30 lines);
every other doc is read on demand, routed by a one-line "read when the task needs"
description. (2) decisions.md and rough-edges.md are **scan-first** documents: grep or
scan headings, read only relevant entries; full reads reserved for structural or
cross-cutting work. (3) decisions.md drops strict append-only in favor of **periodic
culling**: superseded or moot entries that no longer inform anything current are
deleted; git history is the archive; D-numbers are never reused. (4) New root rule 9:
root AGENTS.md is the only always-loaded file, so it stays lean — detail belongs in
docs/ behind the map.
**Context:** Every conversation pays for what's mandated up front. The old blanket
mandate cost ~300 lines/~23 KB per task, mostly unread-in-anger; decisions.md (400+
lines, growing weekly) made "read it before structural changes" increasingly expensive.
**Consequences:** Root AGENTS.md restructured (doc map section, new rule 9, later rules
renumbered — the technology-claims rule is now rule 10); decisions.md header documents
the reading and culling policy; architecture.md's "required reading for every agent"
self-description softened to match.
**Reopen if:** on-demand reading measurably causes agents to miss constraints they'd
have caught under mandatory reading — tighten the map's routing lines first, the
mandate only as a last resort.

## D-022: Publish script retired; placeholder landing page frozen as published  (2026-07-12, accepted; amends D-021)
**Decision:** The machine-local `publish.ps1` from D-021 is deleted (along with the
`.gitignore` whose only entry it was). The static landing page was published once to
parallax-web.com (2026-07-12) and is intentionally **frozen** — it will not be updated
(not even milestone status) between now and M2. `site/` stays in the repo as the
versioned source of what is live. When M2's harness-owned production deployment lands
(D-011), the game's own landing page replaces the placeholder, and the harness pipeline
becomes the origin's only publish path — no separate site-publishing mechanism returns.
Should the placeholder need an emergency fix before then (broken link), that's an ad-hoc
manual `scp` to `/var/www/parallax-web.com`, acceptable at its expected frequency of
approximately zero.
**Context:** Maintaining a machine-specific deploy script for a page that will never
change is upkeep with no benefit, and keeping it invited scope creep (publishing
in-progress game builds through it, which would bypass the versioned, measured deploy
path the M2 research requires — deploying the game *is* the experiment, so it must go
through the harness).
**Consequences:** `publish.ps1` and `.gitignore` deleted; plan.md M0 item reworded.
D-021's publish-script provisions no longer apply; its `site/` placement and
distinct-from-`app/` framing stand.
**Reopen if:** the placeholder turns out to need recurring updates before M2 exists.

## D-021: Public landing page in top-level `site/`; machine-local publish script  (2026-07-12, accepted; publish-script provisions amended by D-022)
**Decision:** The project gets a public face in M0: a static landing page (what Parallax
is + a link to the GitHub repo, https://github.com/pmeenan/parallax) living in a new
top-level `site/` directory. `site/` carries project-facing web content only — plain
static HTML/CSS with no build step, no engine or game code — and is distinct from the
app shell (`app/`, D-012), which is the installer/boot/launch entry point of the game
itself. Publishing to production (`/var/www/parallax-web.com` over SSH per D-011
hosting) is done by a machine-local `publish.ps1` at the repo root that copies `site/`
via OpenSSH `scp` (key-based auth through a local `parallax` SSH host alias). The script
is **gitignored**: it encodes one machine's SSH configuration, not project
infrastructure. It is an explicit stopgap — when M2's production-deployment work lands
(versioned nginx config, harness-driven deploys, D-011), site publishing folds into that
pipeline.
**Context:** A public description of the project is wanted before M2's production
serving exists. `scp` over the Windows built-in OpenSSH client was chosen over
WSL-hosted `rsync` to avoid a WSL dependency for a copy of a handful of static files
(verified working against the server on 2026-07-12).
**Consequences:** Root AGENTS.md layout table gains `site/`; plan.md M0 gains a
landing-page item; `.gitignore` created with `publish.ps1`. The landing page is
plain static content — the header discipline / COOP-COEP requirements of D-011 apply to
the game's serving, and are unaffected by it.
**Reopen if:** the site needs a build step or more than a few pages, or when the M2
deployment pipeline exists — supersede with a unified publish path then.

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
  single module addresses data beyond 4 GiB. **Compatibility gate:** adopting memory64
  currently makes that module unloadable in Safari (MDN browser-compat-data
  `webassembly/memory64`, checked 2026-07-12:
  github.com/mdn/browser-compat-data/blob/main/webassembly/memory64.json — Chrome 133+,
  Firefox 134+, Safari false).
  Therefore memory64 is a last resort: adopt it only when measurements show an
  unavoidable single-module >4 GiB requirement and memory32 alternatives (partitioning
  data/modules, streaming, or reducing the resident set) cannot meet the same requirement
  within budget. Record that evidence when resolving P-001.
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
- **P-007: App-owned in-browser NPC model vs. Prompt API** — challenger to D-017, which
  stays authoritative until there is spike evidence. Hypothesis: a small open-weight
  model running on WebGPU under the app's control beats browser-managed Gemini Nano for
  this game's NPC dialog on some combination of: **placement** (WebLLM-class engines run
  in a Web Worker; the Prompt API is window-only per D-017 — this would retire the
  main-thread broker exception), **lifecycle** (the model becomes a normal hash-verified
  OPFS install artifact under our install/update/uninstall contract instead of a
  Chrome-managed, silently-evictable blob — retiring most of D-017's eviction machinery),
  **contention attributability** (inference runs on the same physical GPU under app
  control — but note current WebLLM-class engines create their own logical WebGPU device
  internally, and same GPU ≠ same device/queue, so **device topology — own device vs.
  shared render device — is an explicit phase-A spike variable**, and true shared-device
  scheduling may require integration or fork work, to be scoped by the spike), and — with
  fine-tuning — **persona/format quality**. Two phases, cheapest risk first:
  **(A)** M0 spike: off-the-shelf small open-weight model (~1–4B, Q4) via in-browser
  WebGPU inference in a worker against the walking skeleton, measured on a fixed
  NPC-dialog prompt fixture set head-to-head with the Prompt API spike: first-token
  latency p95 against the budgets.md dialog budget, tokens/s, frame impact during
  generation, VRAM, OPFS model-load time, structured-output/schema compliance,
  context-window behavior at persona+retrieved-context sizes, baseline dialog quality,
  and model/install size — throughput alone does not pass the spike. **(B)** only if A
  is viable: LoRA-tune for voice, dialog format, and schema compliance, and compare
  constrained-dialog quality. Scope note:
  fine-tuning reliably shifts style/format, not factual knowledge — retrieval/context
  beats fine-tuning for facts (arxiv.org/pdf/2312.05934, checked 2026-07-13) — so world
  lore and live game state stay out of the weights under either backend, arriving via
  context assembled by the engine/ai knowledge service (D-033); general language
  competence, not lore volume, sets the model-size floor. The training pipeline lives
  outside the browser (an assets/-adjacent workstream, not engine/). D-010 note: a
  world-tuned model is **game-specific**, not common/COS-shareable (unlike Nano, which
  is browser-wide). Sources checked 2026-07-13: github.com/mlc-ai/web-llm +
  webllm.mlc.ai/docs (worker support, structured output, ~8B-param practical ceiling
  quantized), arxiv.org/abs/2412.15803 (up to ~80%-of-native throughput). Resolve after
  phase A (and phase B if reached): supersede D-017 or close this and keep it.
*(P-005, toolchain, was accepted as D-014 and refined by D-020.)*
