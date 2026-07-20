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

## D-085: Pin a nightly Rust build-std pipeline for browser wasm threads  (2026-07-19, accepted; extends D-020/D-032)

**Decision:** Author engine WebAssembly in Rust under an exact dated
`nightly-2026-07-16` toolchain (rustc 1.99.0-nightly `d0babd8b6`), rebuild
`std`/`panic_abort` for `wasm32-unknown-unknown`, pin the crate and CLI sides of
wasm-bindgen to 0.2.126, and optimize with pinned Binaryen 131.0.0. Builds enable
`atomics`, `bulk-memory`, `mutable-globals`, `simd128`, and `relaxed-simd`
unconditionally, remap the repository path, and verify the optimized artifact's feature
section and byte repeatability. The M0 proof uses two dedicated module workers over one
fixed 33-page shared linear memory and a 64 KiB per-worker stack. Rust atomics claim and
reduce 262,144 SIMD tasks; exact completion, checksum, nonzero work on both instances,
worker mask, module/memory bytes, and phase timings are mandatory `smoke@1` evidence.

**Context:** A local 2026-07-19 build with current stable Rust 1.97.1 plus atomic target
features produced a shared-memory module, but wasm-bindgen 0.2.126 rejected its thread
transform for missing `__wasm_init_tls`. Rebuilding the standard library with the same
feature floor on the dated nightly produced the required TLS/thread initialization.
This matches wasm-bindgen's current official threads guide, which states that Rust does
not ship a precompiled threading-enabled web stdlib and prescribes nightly
`-Z build-std`. The current official release surfaces checked the same day listed Rust
1.97.1 stable, wasm-bindgen 0.2.126, and Binaryen `version_131`. The first assembled
in-app-Chromium diagnostic also caught and fixed an async-initializer race before any
result was promoted. The final schema-v25 / metric-set-v11 physical-console `smoke@1`
artifact `smoke-1-9a863a19906d-dev-01-showcase-2026-07-20T01-09-27-205Z.json` then
passed all three facets and 24 budget checks. Across six sandboxed runs, both workers
claimed nonzero work, all 262,144 tasks and checksum `0xb5140000` matched, and total
time ranged from 30.8 to 35.8 ms. Review corrected the parallel-execution endpoint to
the second worker completion, before the coordinator's serial reference checksum;
the replacement artifact measured that phase at 15.9-17.6 ms.

**Consequences:** `pnpm build` now owns Rust compilation, wasm-bindgen generation,
Binaryen optimization, content addressing, and a second output-directory rebuild.
Generated bindings and Cargo targets stay ignored. The engine owns worker orchestration;
the Rust crate forbids unsafe code and exposes numeric/atomic operations only. This is
the first concrete Rust pin under D-020 and a targeted dependency review, not the full
M0 currency checkpoint.

**Reopen if:** Rust ships a supported precompiled atomics-enabled browser target,
stable Cargo can rebuild the required stdlib, wasm-bindgen removes the build-std/TLS
requirement, or a measured production module needs a different fixed pool/stack shape.

---

## D-084: Do not promote restart-persistent NPC KV snapshots  (2026-07-19, accepted; closes D-075 and extends D-082/D-083)

**Decision:** Keep llama.cpp live exact-prefix reuse and make idle pre-seeding the
preferred follow-up: after model load, build a clean resident context containing
static world knowledge, tools, and the next character's persona while inference is
otherwise idle, then consume that staged context when the next conversation starts.
Rebuild it after launch or invalidation rather than persisting its KV bytes. Do not
promote D-075's OPFS slot snapshots for the pinned Gemma 4 E2B hybrid model/runtime
combination into the gameplay architecture. Remove the experiment-only service, store,
harness, fixtures, package/source patches, and custom WASM after recording the durable
results; keep no dormant runtime path. Do not run the optional `q8_0`-K/`q4_0`-V point:
symmetric `q8_0` already cuts
snapshot bytes by about 47%, passes quality, and cannot repair the load-bearing partial
restore. Reopen persistent snapshots only when the pinned runtime can restore the full
exact prefix on the target hybrid model and the WebGPU path is stable with the selected
attention configuration.

**Context:** On 2026-07-19, physical-console `npc-prefill-cache-spike@1` runs used
Chrome 150.0.7871.115 Stable on dev-01 (i9-14900KF, RTX 4080 SUPER, 128 GB class RAM,
3840x2160@60 Hz), the five exact D-074 GGUF shards, the checked D-083 WASM
`7723f56e7eeff507c3db43b5f58791cada24954f9591cf3e7e9a8050ca001382`, and final
artifact prefix `a7c4c4e56ed6`. All stable f16/q8_0 and WebGPU/CPU restore cells reported
only 409 cached tokens against 914-916-token exact reusable prefixes. Live same-session
reuse did preserve 914-916 tokens, so the loss is specific to restart persistence, not
fixture tokenization or cache accounting.

The stable cells were faster despite that incomplete state: end-to-first-token ratios
(OPFS read + native restore + generation TTFT, paired to the same character's cold
prefill) were 0.653/0.680 for WebGPU f16 + flash attention, 0.628/0.655 for WebGPU
q8_0, 0.670/0.643 for CPU f16 + flash attention, 0.543/0.612 for CPU f16 without it,
and 0.516/0.569 for CPU q8_0. Those figures satisfy D-083's timing threshold in
isolation but cannot qualify a cache that fails exact-prefix reuse. WebGPU f16 without
flash attention was worse: native restore returned, then first generation repeatedly
aborted inside the pinned llama.cpp/WebGPU module, so it produced no two-restore
result.

F16 snapshots were 12,039,128-12,137,688 bytes (median 12,867 bytes/token); q8_0
snapshots were 6,405,848-6,458,328 bytes (median 6,846-6,873 bytes/token). OPFS reads
were 10.29-25.12 ms and writes 15.74-53.56 ms in completed cells, so storage I/O was
not the blocker. Both WebGPU and CPU q8_0 cells passed all 30 unchanged D-074 quality
generations. Median aggregate user-agent/WASM-memory estimates were about
5.83/1.99 GB on WebGPU and 57.3-59.6/3.39-3.53 GB on CPU; page-attributable VRAM
remained unsupported under D-050. Render callback maxima were 33.35-50.04 ms on the
stable WebGPU cells and 16.92-17.02 ms on CPU, but remain D-051 diagnostics rather
than presentation evidence.

The six final reports are:
`npc-prefill-cache-spike-1-wllama-webgpu-f16-f16-fa-off-a7c4c4e56ed6-dev-01-2026-07-20T00-02-42-366Z.json`,
`npc-prefill-cache-spike-1-wllama-webgpu-f16-f16-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-06-03-732Z.json`,
`npc-prefill-cache-spike-1-wllama-webgpu-q8_0-q8_0-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-09-44-104Z.json`,
`npc-prefill-cache-spike-1-wllama-wasm-f16-f16-fa-off-a7c4c4e56ed6-dev-01-2026-07-19T23-02-50-702Z.json`,
`npc-prefill-cache-spike-1-wllama-wasm-f16-f16-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-18-48-260Z.json`,
and
`npc-prefill-cache-spike-1-wllama-wasm-q8_0-q8_0-fa-on-a7c4c4e56ed6-dev-01-2026-07-19T23-39-21-313Z.json`.

**Consequences:** D-074 remains the production-direction app-owned LLM baseline with
ordinary live `cache_prompt` reuse. A future scheduler may pre-seed one or more clean
conversation contexts during measured idle headroom, but that work must define
cancellation, character priority, memory bounds, and render contention before it is
promoted. No restart-persistent KV dependency, cache budget, or save-data lifecycle is
added. The experiment-only code, dependency patch, and 7.7 MB custom WASM are removed;
the six ignored raw reports remain local on dev-01 under D-081, while this entry carries
the durable figures. This is deliberately a Gemma 4 E2B result, not a claim that persistent KV state
is impossible for every model architecture; separate model-size/performance evaluation
may revisit it for candidates such as Llama 3 3B. A future persistence attempt starts
from a fresh bounded implementation and must first demonstrate full-prefix restore on its exact pinned
model/runtime, then re-run correctness, timing, quality, memory, and real presentation
gates.

**Reopen if:** upstream llama.cpp/wllama changes hybrid-model sequence-state
serialization, a local reproduction restores all exact prefix tokens after restart, or
a separately evaluated pinned model/runtime (including a Llama 3 3B candidate) supplies
portable full-prefix state with a stable WebGPU restore path.

---

## D-083: Bound D-075 to a minimal wllama slot patch and a 20% restore threshold  (2026-07-19, superseded by D-084; extends D-075/D-082)

**Supersession:** D-084 removed the experimental patch, binary, store, fixtures, and
harness after measurement. The entry below describes the bounded measurement setup,
not the current repository runtime.

**Decision:** Keep D-075 on exactly pinned `@wllama/wllama` 3.5.1 and its pinned
llama.cpp submodule, and carry a repository-owned package patch plus WASM binary that
adds only exact chat tokenization and slot-state save/restore actions. The patch also
fixes the raw-field GLUE deserializer fallthrough exposed by the new binary payload;
it does not add another inference backend or a general cache abstraction. Treat a
persistent snapshot as disposable derived data under an exact identity over model and
all GGUF digests, runtime/llama.cpp build, chat template, common token prefix, context
size, K/V cache types, flash attention, device placement, and template arguments. Keep
an LRU hot set of two character snapshots.

For this spike, “materially faster than fresh prefill” means every paired
restart-restore end-to-first-token sample (OPFS read + native restore + generation
TTFT) is at most 80% of the same character's cold-prefill TTFT. This threshold is a
D-075 promotion criterion, not a production dialog budget. Even a faster result cannot
be promoted from M0 alone because D-051 exposes render-worker callback pacing rather
than compositor presentation.

**Context:** The installed wllama source and exact 3.5.1 checkout were inspected on
2026-07-19. Its public TypeScript surface has live `cache_prompt` reuse but no slot
state binding; the pinned llama.cpp server already carries slot save/restore tasks.
The local extension compiled from wllama commit
`766d28e03eeac044fe055327d06b83d3f9b84544` and llama.cpp commit
`dd4623a74f0c85e6b1dd9ee99a92b9c67cac3708` with Emscripten 4.0.20 and Dawn
`v20260317.182325`; the checked binary identity is recorded beside the artifact. The
native wllama build is not byte-repeatable: repeated clean same-path builds of the
initial extension, including single-job builds, alternated between two 7,675,431-byte
digests (`d3a7fa5e…` and `d940e16e…`). Physical preflight then exposed that wllama's
native-read bridge treats a llama.cpp slot filename as a missing model blob. The
bounded correction uses llama.cpp's in-memory sequence-state API and carries the
slot's token history beside the KV bytes; the checked 7,671,921-byte `7723f56e…`
binary therefore adds no snapshot filesystem dependency. That binary remains an
opaque exact input; D-020
level-1 verifies Parallax's packaging of that input and is not cited as source-build
reproducibility. The
memory probe uses the current experimental
[`Performance.measureUserAgentSpecificMemory()` contract](https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory),
which estimates the whole cross-origin-isolated application rather than attributing
one worker. That is why the report separates user-agent aggregate memory from the
WASM heap and continues to mark page-attributable VRAM unsupported under D-050.

**Consequences:** The custom binary and package patch are runtime-critical dependency
inputs and receive targeted ledger review. D-074 continues to package the unmodified
wllama 3.5.1 WASM; only D-075 resolves the custom superset binary, preserving the
qualified uncached baseline. The versioned `npc-prefill-cache-spike@1`
run cold-installs the model, populates three static game-owned personas, evicts one,
restarts Chrome on the same profile, restores two, fresh-prefills the miss, and reports
raw identity, reuse, storage, timing, memory, quality, and callback evidence. Quantized
KV configurations re-run the unchanged 30-generation D-074 quality fixture. No
player-derived prompt content enters this cache.

**Reopen if:** wllama publishes a compatible stable slot API, llama.cpp changes state
compatibility or server-slot semantics, measurements justify a different hot-set or
materiality threshold, or Chrome adds attributable worker/GPU memory and presentation
evidence that can replace the current diagnostics.

---

## D-082: Add KV-cache-quantization and flash-attention axes to the D-075 prefill spike; TurboQuant is a no-go  (2026-07-19, accepted; extends D-075)

**Decision:** Extend the D-075 spike matrix with two measurement axes on both the
WebGPU and CPU/WASM placements: flash attention off/on, and KV-cache type `f16`
(baseline) vs `q8_0`, with an optional asymmetric `q8_0`-K/`q4_0`-V point if `q8_0`
alone leaves the snapshot budget short. Every quantized-cache configuration must
re-pass the unchanged D-074 schema/grounding/context fixture — a cache type that
degrades those checks is disqualified regardless of its memory win. Snapshot identity
(D-075) explicitly includes the K and V cache types and the flash-attention setting.
Do not adopt TurboQuant or any out-of-tree KV-compression fork.

**Context:** All claims checked 2026-07-19. The pinned `@wllama/wllama` 3.5.1 already
exposes `cache_type_k`/`cache_type_v` (`f16`/`q8_0`/`q5_x`/`q4_x`) and `flash_attn`
in `LoadModelConfig`, wired to llama.cpp context params (verified in the installed
package source). llama.cpp requires flash attention for a quantized V cache, and the
ggml WebGPU backend's `supports_op` accepts `FLASH_ATTN_EXT` with K/V in exactly
`f16`/`q4_0`/`q8_0` — no `q5` variants — per
[ggml-webgpu.cpp on master](https://github.com/ggml-org/llama.cpp/blob/master/ggml/src/ggml-webgpu/ggml-webgpu.cpp);
the CPU backend covers quantized KV via a dequantize-then-dot fallback. The pinned
wllama wasm binary embeds the WebGPU flash-attention shader family including
block-quantized-KV variants (`flash_attn_vec_blk` et al.) and contains the
`llama_state_seq_save_file`/`load_file` symbols unexposed by the JS action surface,
consistent with D-075. `llama_kv_cache::state_write_data`
([llama-kv-cache.cpp](https://github.com/ggml-org/llama.cpp/blob/master/src/llama-kv-cache.cpp))
serializes K/V rows at the cache's native storage row size and embeds the type ids,
so `q8_0` roughly halves and `q4_0` roughly quarters OPFS snapshot bytes versus
`f16`, and restore requires identical cache types. TurboQuant (Zandieh et al., ICLR
2026): upstream [PR #21089](https://github.com/ggml-org/llama.cpp/pull/21089)
(`tbq3_0`/`tbq4_0`, CPU kernels only) was closed unmerged 2026-06-02 with
maintainers unconvinced it beats existing types at equal bitwidth
([tracking discussion #20969](https://github.com/ggml-org/llama.cpp/discussions/20969));
community forks target CUDA/Metal/ROCm only, so adoption would mean maintaining a
patched llama.cpp inside a custom wllama build for a marginal gain over `q4_0`.

**Consequences:** The spike gains a cheap, fork-free lever that directly reduces the
persistent-cache memory footprint and OPFS transfer volume D-075 measures. Flash
attention is itself a new variable — D-074's 119.64 ms warm-TTFT baseline was
measured without it — so it gets its own before/after column prior to any quantized
run. Community measurements warn that `q4_0` K-cache hurts quality (K is more
sensitive than V) and that dequant overhead can slow long-context attention; both
are measurement targets at our fixture sizes, not assumptions. Uncached and
`f16`-cache controls remain so D-074 comparability is preserved.

**Reopen if:** TurboQuant or a comparable sub-4-bit KV method lands in upstream
llama.cpp and ships in a pinned wllama release, the WebGPU backend's supported
flash-attention cache types change, or spike measurements show quantized KV
regressing TTFT or fixture quality with no acceptable configuration.

---

## D-081: Raw harness result artifacts stay out of version control  (2026-07-19, accepted)
**Decision:** `harness/results/` stays untracked, and no tracked evidence mirror is
added. The doc that cites a result — decision entry, finding, budgets baseline,
research doc — must itself record the load-bearing numbers and context, because the
documented top-line results are the durable record. Raw result JSONs and report files
are per-machine byproducts; recovering raw detail means re-running the pinned scenario
(harness rule 1: pinned Chrome, versioned run contracts, recorded environment), not
consulting an archive.

**Context:** A 2026-07-19 review found that every doc-cited artifact (27 files,
~14 MB, spanning the spike evidence through D-080) existed only on dev-01 and was one
`git clean` from loss; a tracked `harness/evidence/` mirror with a citation contract
test was prototyped in-tree. Pat rejected it: planned write-ups need only the
documented top-line results, and multi-megabyte measurement JSONs (a single
app-owned-LLM run reaches 6.6 MB) would grow the repository indefinitely for data
nobody re-reads. This is a deliberate decision *not* to preserve raw artifacts (root
rule 1), so the gap is not rediscovered and the mirror re-added.

**Consequences:** Losing a machine's results directory loses raw detail but not the
record. The citation discipline carries the weight: an entry that leans on a
measurement must quote the figures it relies on (as D-056 through D-080 already do)
rather than deferring to the raw file; a bare filename citation identifies the run but
is not, by itself, durable evidence. Local results directories are still kept on the
machines that produced them on a best-effort basis.

**Reopen if:** an external consumer (a Chrome bug report, fact-checking a publication)
needs raw artifacts the docs did not capture, a disputed result can no longer be
reproduced by re-running its pinned scenario, or low-cost external archival (LFS, an
artifact store keyed by the recorded digests) becomes worth the setup.

## D-080: Commit exclusively to Babylon Lite; remove renderer swappability  (2026-07-19, accepted; supersedes D-078's retained classic comparison path)
**Decision:** Babylon Lite is Parallax's sole rendering core. Remove the classic Babylon
dependency and adapter, the `PARALLAX_RENDERER` build/development selector, the
engine-neutral `RenderWorkerBackend` interface, and the manifest/telemetry identity
contract that existed only to verify a selected backend. Rendering code may use Lite's
data structures and APIs directly inside `engine/`; it does not preserve parity with a
hypothetical second engine. Keep the game-facing render service, worker message protocol,
frame/telemetry loop, and SAB transport because those are Parallax subsystem and process
boundaries, not renderer-swapping abstractions.

**Context:** D-078's classic adapter was a useful controlled-spike instrument: it let the
same walking skeleton measure Lite and classic at the same worker boundary. It is not a
sustainable product architecture. M1's Lite-specific decoder bootstrap and data flow,
P-002's native WebGPU interop, and later streaming/render data structures would either
grow a common-denominator interface or require a second implementation and fixture
matrix for a renderer that never ships. That cost would also work against the root
constraint forbidding build-time engine abstraction layers. The local D-078 comparison
already supplied the evidence needed to select Lite; preserving its two raw result
artifacts preserves the finding without preserving the tested implementations.

**Consequences:** The render worker is one Lite-specific entrypoint. The preexisting
manifest v4 and telemetry v5 contracts remain sufficient; `smoke@1` still records exact
engine/render-worker artifact paths and bytes, but no longer negotiates or cross-checks a
renderer identity. Future Lite capabilities go directly into the `engine/render` and
render-worker implementation while game code continues to depend only on Parallax
services and typed snapshots. A future Chrome issue that needs cross-engine isolation
gets a bounded reproduction built for that finding; it does not make the product carry a
permanent second backend. If the engine choice itself must be revisited, make a new
measured migration decision rather than maintaining speculative compatibility today.

The final Lite-only production build passed `smoke@1` schema v24 / mandatory-metric-set
v10 on registered dev-01 under Chrome 150.0.7871.115 and the production sandbox: all
three facets, six core runs, and 24 budget checks passed. Artifact
`smoke-1-a4824e1bef7e-dev-01-showcase-2026-07-19T20-33-11-523Z.json` records 581,328
combined engine+render-worker bytes (420,117 + 161,211), 14 fewer than the final
selector-enabled Lite build. One same-artifact schema-v23 attempt was invalidated when
one warm trace produced no chunks before the existing five-second drain bound; its exact
rerun and the final schema-v24 run completed normally. The existing informational
V8-code-cache, compositor,
GPU-memory-attribution, OPFS-repeatability, and trace-drain limitations remain
non-blocking; no new platform finding arose.

**Reopen if:** Lite develops an unbounded roadmap blocker or a measured challenger is
materially better enough to justify an engine migration. Reopening selects or migrates
the rendering core; it does not reinstate standing multi-engine parity by default.

## D-079: Review all versioned dependencies at milestone boundaries and every 28 days  (2026-07-19, accepted)
**Decision:** Generalize D-078's deliberate Babylon Lite upgrade rule to every versioned
external input selected or pinned by the repository: direct and security-relevant
transitive packages, browser/CfT pins, models and their tokenizer/chat-template identity,
decoder/WASM assets, and future Rust toolchains/crates. Run a repository-wide currency
checkpoint at each milestone entry and every 28 calendar days during an active milestone,
whichever comes first; credible security advisories, due deferral triggers/dates, and
releases that credibly fix or unblock an issue affecting planned or implemented work
trigger an immediate review. Exact pins remain mandatory. Each candidate is adopted,
explicitly deferred with evidence plus a recheck trigger/date, or marked not applicable;
nothing auto-merges or refreshes the lockfile unattended. The complete tiering, procedure,
and living review ledger are in [dependencies.md](dependencies.md).

**Context:** D-020 made builds repeatable by exact-pinning dependencies, but defined no
currency mechanism. D-078 similarly said Lite upgrades must be deliberate reviewed
changes without ensuring that a review would recur. Over a multi-month project, those
rules prevent silent drift but can silently fossilize the engine, inference stack,
browser/toolchain, and asset decoders. A calendar-only cadence can interrupt milestone
work, while milestone-only reviews can be months apart; the earlier-of rule bounds both
failure modes. The policy covers non-package inputs because model revisions, decoder
binaries, CfT, and future wasm tooling can change runtime behavior as materially as an
npm package.

**Consequences:** Runtime/platform-critical component families upgrade one at a time
with upstream-note/API review, `pnpm check`, repeatability, relevant subsystem fixtures,
and same-scenario physical-harness comparison against the old pin when performance or
runtime behavior can move. Build/measurement tooling uses a proportionate gate but must
run a physical smoke whenever emitted bytes, browser launch/tracing, serving, or metric
semantics may change. Supporting tools may batch only while bisectable. Transitive pins
move through their owning direct dependency unless a concrete advisory/bug justifies an
isolated change. Every milestone exit requires a checkpoint no more than 28 days old;
one full checkpoint may cover both an exit and the immediately following milestone entry
when they occur in the same transition change. A targeted trigger review does not reset
the full-repository cadence. M0 gains the first full review, due by 2026-08-16. Reviews
and deferrals update the dependency ledger; behavior/constraint changes still update
decisions, architecture, budgets, plan, or findings under the existing rules.

**Reopen if:** the cadence produces churn without catching meaningful changes, a class
of external inputs needs a different interval, official release channels cannot support
same-scenario old/new evaluation, or project automation can safely prepare evidence-
complete upgrade changes without weakening the human commit gate.

## D-078: Adopt Babylon Lite as the rendering core  (2026-07-19, accepted; supersedes D-004's classic-Babylon component choice and concludes D-077; retained classic path superseded by D-080; recurring upgrade cadence generalized by D-079)
**Decision:** Make exactly pinned `@babylonjs/lite` 1.11.0 the default
scene/material/animation core. Keep Parallax's render service, worker protocol, frame
loop, scheduling, streaming, memory ownership, and telemetry boundary unchanged. Retain
the classic-Babylon adapter and exact dependency only as an explicitly selected
comparison path (`PARALLAX_RENDERER=babylon-classic`) in production builds or Vite
development; it is not in the default shipped render worker. The build manifest and
runtime telemetry name the selected renderer, and
`smoke@1` rejects a mismatch.

**Context — measured gate:** Both implementations ran the same schema-v23 / mandatory-
metric-set-v10 production-sandbox physical-console gate on registered dev-01, Chrome
150.0.7871.115 at 3840x2160@60 Hz, three fresh/warm pairs each. Both passed environment,
evidence-completeness, all six core runs, all 24 budget checks, the exact dedicated-
worker topology, and the 100,000/100,000 SAB exchange with zero payload or sequence
errors. Lite's render worker was 161,033 bytes against classic's 5,266,167 (96.94%
smaller); combined engine+render-worker bytes were 581,214 against 5,686,348 (89.78%
smaller). Across the six core runs, Lite reduced mean fresh startup 211.31→170.87 ms
(19.1%), mean warm startup 149.90→123.24 ms (17.8%), mean render CPU p95
0.431→0.203 ms (53.0%), and mean all-realm JS heap 9.37→3.89 MB (58.5%). Render-
callback p95 was effectively equal (16.762 vs. 16.735 ms). Lite's internal worker-init
interval was slower (fresh 97.28→149.04 ms; warm 93.38→112.99 ms), but its much smaller
worker-bootstrap overhead still produced the better end-to-end startup outcome. GPU-memory
attribution remained unsupported for both and is not claimed as a Lite win. Raw
artifacts: `smoke-1-f7e08a362e94-dev-01-showcase-2026-07-19T19-27-01-694Z.json`
(Lite) and `smoke-1-106bd4023874-dev-01-showcase-2026-07-19T19-29-39-539Z.json`
(classic). After the renderer selector was also wired through Vite development, final
default-build replacement artifact
`smoke-1-9f1b9ff3f0f3-dev-01-showcase-2026-07-19T20-10-32-910Z.json` passed the same
three-facet, six-run, 24-check gate at 581,342 combined bytes; the Lite render-worker
artifact remained unchanged.

**Context — roadmap floor:** The official repository/docs and the exact published
package source at tag `npm-lite-v1.11.0` / commit
`b7993d58a709edc4c3299014d300b992ee0b8e7c` were checked 2026-07-19. Uncompressed
glTF/GLB, thin instances (including GPU-culling indirect draw), skeletal animation,
morphs, and animation groups are present. KTX2 (`KHR_texture_basisu`), Draco, and
meshopt decode paths are partial in the selected worker topology: their decoder
bootstraps fall back to `document`, which is absent in a module worker, unless the
expected `KTX2DECODER`, `DracoDecoderModule`, or `MeshoptDecoder` global is already
installed. M1 therefore bundles and preinstalls the pinned decoders before loading one
fixture of each type; if a decoder cannot initialize that way, the bounded fallback is
to patch only its bootstrap to use a worker-safe dynamic import. Meshopt also handles
only canonical single-buffer GLB; M1's exporter/QA gate constrains and fixtures that path,
with upstreaming or a local loader patch if multi-buffer content becomes necessary.
Compute is used internally, but a generic public compute/raw-device/queue API is absent.
Before P-002 needs it, one pinned, isolated native-interop adapter will expose
the internal device with compile-time and runtime guards plus a harness probe while we
seek an upstream supported accessor. Thin-instance indirect draw is present; arbitrary
custom indirect submission shares that bounded native-interop seam. Skeletal animation
is present, but animation events are absent and morph targets are capped at four. Game-
state events remain fixed-timestep simulation data; M3 adds a representative character
fixture and, if visual-only clip callbacks are needed, a small engine-owned timestamp-
marker utility with loop/seek/cross-fade tests. Asset QA enforces the four-active-morph
limit; a character that exceeds it must use skeletal/VAT animation or first justify a
bounded shader-path extension. No required roadmap capability is absent without a
bounded plan.

**Consequences:** D-004's rejection of Unity, Godot, Bevy, and from-scratch and its
ownership boundary still stand; only the classic-Babylon component is superseded. Lite's
unstable API is a real maintenance cost: exact version only, upgrades reviewed as explicit
changes, all Lite calls confined to `engine/`, and no compatibility wrapper beyond the
small renderer/native-interop adapters. The much smaller default artifact is a measured
structural advantage for launch-2+ as well as a CPU/heap win. No Chrome rough-edge entry
is added: the unresolved items here are library API gaps, while the equal GPU-memory
attribution limitation is already represented by the harness's informational evidence.

**Reopen if:** a pinned Lite upgrade breaks outside the bounded adapters, the M1 asset
fixture or P-002 interop probe cannot be supported with a spike-sized patch, M3 animation
requirements expose an unbounded gap, or a same-gate comparison shows classic Babylon or
another web-native core materially better on Parallax's axes.

## D-077: Pull the Babylon Lite evaluation forward into M0 as the next task  (2026-07-19, accepted; concluded by D-078)
**Decision:** Do not wait for D-076's Babylon Lite reopen trigger (API stability + feature
floor) to fire on its own. M0 gains a go/no-go spike, ordered as the next task: port the
walking skeleton to Babylon Lite behind the unchanged `engine/` boundary, run the identical
`smoke@1` physical-console gate on both implementations, audit Lite's feature floor against
the roadmap (M1 asset path: glTF/KTX2/Draco/meshopt, thin instances, compute; M3+: skeletal
animation; interop: raw device/queue access, indirect-draw prospects), and switch the
platform to Lite only if it passes the same gate with materially better or
equal-with-structural-advantage measurements **and** no roadmap feature is absent without a
bounded build-it-ourselves plan. Full criteria in plan.md M0; verdict lands as its own
decision entry either way.
**Context:** Lite's design goals line up with this project's axes point-for-point —
WebGPU-exclusive (D-002/D-004), data-oriented/CPU-lean and tree-shakable (the top classic-
Babylon weaknesses in rendering-engine-research.md §6), OffscreenCanvas-in-worker as a
design goal (D-056 topology) — and its missing systems (LOD, octree culling, particles,
GUI) overlap almost entirely with what we hand-build or cannot use in a worker anyway. The
deciding argument for *now* rather than *later*: switching cost is at its lifetime minimum
at the walking-skeleton stage and grows with every milestone. Known risks the spike must
price rather than assume away: Lite declares its APIs unstable (exact-version pinning, no
compat promise — a real cost against classic Babylon's compat policy), its feature floor
for M3+ animation is unverified, and all headline performance multipliers are vendor
self-reported (root rule 3: the harness decides). Checked 2026-07-19:
github.com/BabylonJS/Babylon-Lite (v1.11.0, Apache-2.0), its feature-comparison doc, and
the June 2026 announcement — full sourcing in rendering-engine-research.md §7.
**Consequences:** plan.md M0 gains the spike (scope change logged per plan.md's own rule);
rendering-engine-research.md §1/§7 updated — the passive watch item becomes an active M0
evaluation. D-075's KV-prefill spike and the remaining M0 items queue behind it.
**Reopen if:** the spike stalls on Lite immaturity for more than a spike-sized effort —
then revert to the passive D-076 trigger and record what blocked it.

## D-076: Consolidate rendering-engine research into rendering-engine-research.md; three.js evaluated post-hoc, choice stands  (2026-07-19, accepted)
**Decision:** All rendering-engine-choice knowledge lives in one living doc,
[rendering-engine-research.md](rendering-engine-research.md), which folds in and replaces
`why-not-unity.md` (D-046's evidence pack) and adds three new sections: a post-hoc three.js
evaluation, an honest Babylon weaknesses / roll-our-own list, and a Babylon Lite watch item.
The doc is maintained by deletion — stale content is removed when corrections or newer
information land; git history is the archive (same model as decision-log culling, D-023).
**Context:** three.js was never considered in D-004 (it appears nowhere in the repo,
including the ideation history) — a real gap, since it is the most popular web 3D library by
~55x npm downloads and "why not three.js?" is the first public question the engine choice
draws. Researched 2026-07-19 (three.js r185, Babylon 9.17.0): the choice stands. three.js
shares all of Babylon's Tier-1 structural advantages over Unity, but loses on our axes —
WebGPURenderer officially "experimental" and opt-in, custom shading locked behind TSL with
no raw-pipeline path, worker/OffscreenCanvas unofficial and broken for a full release in
r179 (issue #31605), breaking changes every release, JS with lagging external types, and
renderer-not-engine scope. It genuinely beats classic Babylon on one axis — a public
indirect-draw API (`IndirectStorageBufferAttribute`) — which is recorded as a Babylon
weakness (roll-our-own area, P-002), not a switch reason. The same research surfaced
**Babylon Lite** (June 2026, verified: WebGPU-exclusive, data-oriented, tree-shakable,
pixel-parity goal, v1.11.0, APIs unstable) — added as a new D-004 reopen trigger with a
harness-measured head-to-head as the gate.
**Consequences:** `why-not-unity.md` is deleted; AGENTS.md doc map and RE-011's reference
updated to point at the new doc. D-004/D-046 status lines annotated. Future engine-state
research (re-verifications, new alternatives, Babylon Lite tracking) updates the doc in
place rather than spawning new files.
**Reopen if:** the doc grows past usefulness as a single file (split by vendor then), or a
future engine decision (e.g., adopting Babylon Lite) warrants its own evidence pack.

## D-075: Measure NPC KV-prefix reuse and OPFS persistence as a separate optimization spike (2026-07-17, accepted)

**Decision:** Keep D-074's app-owned backend qualification unchanged and schedule
context-prefill caching as a distinct M0 optimization spike. The spike first measures
in-process exact-prefix reuse for shared world/persona tokens, with cold-prefill and
warm-prefix TTFT reported separately. It then tests restart-persistent per-character
KV snapshots in OPFS through the smallest practical wllama state/slot extension. A
snapshot is disposable derived data, never authoritative NPC or player state, and is
valid only for an exact model/GGUF, runtime, tokenizer/chat-template, token-prefix,
context, and KV-configuration identity.

**Context:** The pinned `@wllama/wllama` 3.5.1 package exposes `cache_prompt` for live
reuse but its public action surface does not expose llama.cpp state or slot
save/restore, and the current wrapper configures one parallel slot; these points were
verified against the installed source on 2026-07-17. Upstream llama.cpp documents
largest-prefix prompt reuse and server slot save/restore, while its public API exposes
state size/get/set and file save/load operations; the official
[server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
and [`llama.h`](https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h) were
checked the same day. Those capabilities establish feasibility, not a Parallax result:
snapshot size, OPFS transfer behavior, GPU rehydration, multi-character residency, and
render contention remain measurement targets.

**Consequences:** The optimization is not folded into the current D-074 change or its
119.64 ms short-fixture / 15,653.09 ms large-context baseline. The follow-up must retain
uncached controls, measure WebGPU and CPU/WASM placements, and test a bounded hot set
rather than assume every character context can remain resident. Player-derived prompt
content follows save-data privacy and lifecycle rules if it is ever persisted; only
static, non-private character prefixes are candidates for install-time prebuilding.

**Reopen if:** wllama exposes stable persistent-slot APIs before the spike, llama.cpp
changes state compatibility or streaming semantics, exact-prefix reuse does not reduce
the representative prefill outcome, or saved-state restoration costs more than fresh
prefill once storage and graphics contention are included.

---

## D-074: Qualify Gemma 4 E2B QAT GGUF on wllama WebGPU; retain CPU/WASM as a headroom mode (2026-07-17, accepted)

**Decision:** Select `@wllama/wllama` 3.5.1 with Unsloth's QAT-derived Gemma 4 E2B
`UD-Q4_K_XL` GGUF as P-007 phase A's qualifying app-owned backend. Pin
`unsloth/gemma-4-E2B-it-qat-GGUF` at revision
`66a399f68ddd113b06dff02fca9523e55465d11d`. The 2,620,370,976-byte source GGUF has
SHA-256 `e531007218dfab990486a5de7676a6932d6ea8dea233d1f698d7c21cf8a16889`.
`llama-gguf-split` from llama.cpp b10064 deterministically produces five exact-manifest
shards totaling 2,620,371,552 bytes; the largest is 1,321,205,952 bytes, below
wllama's 2 GiB per-file ceiling.

Use all-layer WebGPU offload as the qualifying placement and retain `n_gpu_layers: 0`
as an explicit CPU/WASM measurement mode, never an automatic fallback. wllama's
controller remains window-owned because its URL resolver reads `document.baseURI`;
llama.cpp execution, WebGPU, OPFS access, and pthread work remain in wllama-created
workers. Structured cases use wllama/llama.cpp's native strict JSON-schema response
constraint. D-073's 120-second no-forward-progress load boundary remains unchanged.

**Context / evidence:** Physical-console artifact
`app-owned-llm-spike-1-fd85032d3831-dev-01-2026-07-17T18-57-21-704Z.json` passed the
full unchanged fixture on sandboxed Chrome for Testing 150.0.7871.115. Warm TTFT p95
was 119.64 ms across twenty samples; mean decode throughput across all thirty
generations was 60.27 tokens/s. All schema, grounding, and short/medium/large context
checks passed. The 4,805-token GGUF-tokenized large case completed with 15,653.09 ms
TTFT. Cold and restart-warm model loads were 9,319.87 ms and 3,996.48 ms, with exact
five-shard OPFS write/read evidence. The concurrent render-worker callback diagnostic
retained 2,580 samples at 16.79 ms p95.

The CPU/WASM artifact
`app-owned-llm-spike-1-4e24f4809c68-dev-01-2026-07-17T18-39-34-316Z.json` proved that
the same GGUF loads and completes every context tier without an inference GPU. Warm
TTFT p95 was 383.30 ms and mean decode throughput was 9.60 tokens/s, but the 4,805-token
large-context prefill took 311,200.58 ms. That artifact predates the JSON-schema
constraint and therefore remains a non-qualifying topology measurement rather than a
second pass artifact.

This reverses only D-073's backend-selection conclusion, not its ONNX findings. The
ONNX mobile-QAT graph still fails at its 6,456-token tier on WebGPU, and ORT WASM still
lacks `GatherBlockQuantized`. The GGUF route succeeds because it uses a different model
container and llama.cpp kernels, not because those ONNX gaps disappeared. The current
[wllama documentation](https://github.ngxson.com/wllama/docs/) confirms WebGPU,
CPU-only `n_gpu_layers: 0`, split GGUF, OPFS-backed model management, and the per-file
limit. The pinned
[Unsloth QAT GGUF repository](https://huggingface.co/unsloth/gemma-4-E2B-it-qat-GGUF)
provided the exact source identity; both were checked 2026-07-17 and the local run is
the controlling evidence.

**Consequences:** P-007 phase A now has a qualifying app-owned backend without
weakening the 1.5-second TTFT, structured-output, context, exact-cache, or render
diagnostics. It outperforms the measured Prompt API TTFT and the ONNX E2B TTFT on
dev-01, but page-attributable VRAM remains unavailable, and the walking skeleton is
not evidence of contention against final game assets. WebGPU is the current default
candidate; CPU/WASM is a deliberate graphics-headroom option whose long-context cost
must be acceptable to the calling gameplay system.

**Reopen if:** an official Google GGUF or another quant materially improves quality or
memory at the same fixture, wllama removes its window-bound controller, a later game
workload reveals unacceptable GPU contention, Chrome exposes attributable VRAM, or an
ONNX/LiteRT/WebNN route passes the same gate with a better measured tradeoff.

---

## D-073: Bound app-owned model-load stalls; published Gemma 4 CPU/WASM quantizations are a no-go (2026-07-17, superseded by D-074)

**Decision:** Apply the Prompt spike's fail-closed loading discipline to the app-owned
runner: while `loading-model`, abort after 120 seconds without a strictly higher
aggregate progress value, retain the partial cache/model telemetry, close the browser,
and skip the warm phase when the cold load stalls. The existing 45-minute completion
ceiling remains for phases that continue making load progress or have advanced to
warmup/generation.

Close the published Gemma 4 E2B WASM/CPU experiment as a measured no-go. Preserve a
reproducible CPU diagnostic using the standard repository's smaller q4 graph, pinned at
D-072's revision with nine exact artifacts totaling 3,646,892,071 bytes. It is not a
qualification candidate and is never an automatic fallback. WebGPU remains on D-071's
mobile-QAT q2f16 graph.

**Context / evidence:** The q8 physical-console artifact
`app-owned-llm-spike-1-a6ea4cbdc9e6-dev-01-2026-07-17T17-31-17-052Z.json` stopped at
0.6205 progress after `Array buffer allocation failed`, with 10/12 artifacts verified,
1,797,484,666 bytes written, and zero integrity failures. Its published embedding
external-data shard is 2,348,810,240 bytes. Transformers.js 4.2.0's browser
`readResponse()` preallocates `new Uint8Array(total)` and returns each complete model
file as one buffer; this makes the export's shard size and concurrent model loading a
browser/library allocation problem rather than an OPFS streaming or hash failure. The
120,569 ms watchdog then ended the run and correctly skipped the warm retry.

The smaller-shard q4 artifact
`app-owned-llm-spike-1-5aa7eed16ab4-dev-01-2026-07-17T17-36-44-003Z.json` got past
that allocation cliff but failed session creation in both phases: ORT's WASM CPU
provider has no implementation for `GatherBlockQuantized(1)` in
`/model/embed_tokens/Gather_Quant`. D-071's mobile q2f16 graph fails on the same missing
CPU kernel. The repository's published q4 files top out at 1,864,102,912 and
1,762,656,256 bytes; the file listing and Transformers.js usage surface were checked on
2026-07-17 at
https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/tree/main/onnx.

**Consequences:** M0 has a bounded, evidence-preserving failure path instead of waiting
45 minutes on a dead model load. The CPU topology would need a CPU-specific ONNX export
using supported operators, or an ORT WASM kernel for `GatherBlockQuantized`; QAT itself
is not the blocker. P-007 phase A is a valid negative spike result: E2B WebGPU is fast
but fails the unchanged 6,456-token context, while all tested published CPU
quantizations fail before inference. No backend is selected by this decision.

**Reopen if:** ORT adds the missing WASM kernel, a CPU-targeted Gemma export appears,
Transformers.js gains a path-based/streaming external-data handoff that avoids whole-
file buffers, or a new app-owned candidate can satisfy the unchanged fixture and
budgets.

---

## D-072: Add a CPU/WASM E2B q8 topology branch and a context-first diagnostic (2026-07-17, superseded by D-073)

**Decision:** Keep D-071's E2B mobile-QAT q2f16 graph as the WebGPU branch and add an
explicit WASM/CPU branch using the standard E2B ONNX export's q8 files. Pin
`onnx-community/gemma-4-E2B-it-ONNX` at revision
`9f4bef82ea6e296bc69f8a2f5939f73af81b07a6`, dtype `q8`, with an exact twelve-file
text manifest of 6,240,975,994 bytes and per-file SHA-256. Device selection is part of
the worker request and telemetry; it is never an automatic fallback.

Add a reproducible, explicitly non-gating context-first fixture order. It uses the same
cases and repetitions, but a 256-token short context supplies the excluded warmup and
the unchanged 6,456-token large case runs first. The runner injects a permanent error
for this order so its artifact cannot pass qualification even if all metrics complete.

**Context / evidence:** D-071's normal-order E2B WebGPU artifact
`app-owned-llm-spike-1-2b912b1a0d56-dev-01-2026-07-17T16-39-02-164Z.json` completed
28 generations per phase and then lost a WebGPU buffer on the large case. Context-first
artifact `app-owned-llm-spike-1-767efbd56b0d-dev-01-2026-07-17T16-43-05-283Z.json`
failed the same case immediately after short warmup in both phases, ruling out retained
state from the prior 28 generations. The pinned tokenizer measured short/medium/large
inputs at 256/1,656/6,456 tokens.

Trying the mobile-QAT graph unchanged on WASM was also fail-closed: ONNX Runtime 1.27's
CPU execution provider has no kernel for its custom `com.microsoft.GatherBlockQuantized`
operator. The current Transformers.js guidance identifies q8 as the usual WASM dtype;
the standard E2B repository supplies a `quantized` graph for that path. Its substantially
larger install is recorded rather than hidden behind the mobile model's size.

**Consequences:** the CPU branch can answer whether preserving GPU headroom is worth
CPU/system-memory/latency costs, but it must first prove operator compatibility and the
6,456-token diagnostic before a full cohort. WebGPU and WASM cache evidence are checked
against different pinned identities. E2B WebGPU remains fast at 206.90 ms warm TTFT p95
but cannot qualify at the current context tier.

**Reopen if:** ORT adds a WASM kernel for the mobile operator, a smaller CPU-compatible
QAT export appears, context behavior changes in Chrome/ORT, or measured q8 CPU costs make
the branch clearly nonviable.

---

## D-071: Test Gemma 4 E2B mobile-QAT for game GPU headroom (2026-07-17, superseded by D-072)

**Decision:** Move the P-007 phase-A candidate from E4B to the smaller Gemma 4 E2B
mobile-QAT q2f16 export while retaining ONNX Runtime Web 1.27.0, the standalone-template
adapter, all fixtures, thresholds, topology, and fail-closed cache/result contracts.
Pin `onnx-community/gemma-4-E2B-it-qat-mobile-ONNX` at revision
`5cd5514efd375abf2801c856a3936b259cc00133` and its exact nine-file text manifest:
2,324,194,278 bytes with per-file SHA-256.

**Context / evidence:** the corrected E4B run on ORT 1.27 and the pinned template
completed 28 generations in both phases, measured warm TTFT p95 at 250.95 ms over
twenty samples, and proved all ten 3.36 GB cold writes and warm reads. Both phases then
failed the large-context case with ONNX Runtime `std::bad_alloc`; the warm phase also
reported a render-worker failure after the allocation event. Artifact
`app-owned-llm-spike-1-172a264d5607-dev-01-2026-07-17T16-33-33-429Z.json` is the valid-
environment failed cohort. This directly confirms the GPU/memory-headroom concern that
motivated the user's E2B suggestion; no threshold or context case is being reduced.

The pinned [E2B mobile-QAT ONNX repository](https://huggingface.co/onnx-community/gemma-4-E2B-it-qat-mobile-ONNX/tree/5cd5514efd375abf2801c856a3936b259cc00133)
uses the same q2f16/runtime/template family at 1.04 GB fewer installed bytes. The
repository API tree supplied sizes and LFS SHA-256 values; the small Git-backed files
were downloaded and hashed locally.

**Consequences:** E4B remains strong latency evidence but is not safe for the complete
game-concurrent workload on dev-01. E2B must earn selection on the unchanged grounding,
JSON, context, raw-quality, throughput, cache, and render-impact contract. Its lower
published capability is not assumed acceptable.

**Reopen if:** E2B fails quality or context, a browser/runtime fix makes E4B allocation
stable with sufficient render headroom, or measured shared-device scheduling changes
the memory tradeoff.

---

## D-070: Pin and install Gemma 4 mobile-QAT's standalone chat template (2026-07-17, superseded by D-071)

**Decision:** Extend D-069's exact E4B mobile-QAT install manifest with the ONNX
repository's `chat_template.jinja` at the same pinned revision: 17,336 bytes,
SHA-256 `2f1b4d75d067bae3fe44e676721c7f077d243bc007156cb9c2f8b5836613d082`.
The exact ten-file install is 3,361,444,702 bytes. Cold install fetches, hashes, and
publishes the template through the same OPFS cache; warm launch must read it from OPFS.
After pipeline creation, the worker assigns those verified template bytes to the
tokenizer before warmup or measured generation.

**Context / evidence:** D-069's physical-console ORT 1.27 run proved that the 2-bit
embed and decoder sessions now create: all nine prior artifacts were verified on cold
write and warm read. Both phases then failed before warmup because
`tokenizer.chat_template` was unset. The pinned ONNX repository contains a standalone
[chat_template.jinja](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX/blob/4d18aa8b54e354bec4705e4a4894f5bbf8956c3d/chat_template.jinja),
and the official parent checkpoint uses the same standalone-file layout. Python's
current processor loads that repository file, while Transformers.js 4.2.0 only exposed
the tokenizer without attaching it. Artifact
`app-owned-llm-spike-1-e7e0cdf0b1ac-dev-01-2026-07-17T16-24-33-709Z.json` retains the
fail-closed cold/warm error and complete cache evidence.

**Consequences:** the template is model data, not hand-written application prompt
logic. It is revision-pinned, hash-verified, offline-reavailable, and included in install
size/cache qualification. A future Transformers.js version that loads the standalone
file itself must produce the same bytes or trigger an explicit manifest/decision update.

**Reopen if:** Transformers.js natively loads the pinned template, the ONNX export
embeds it in tokenizer metadata, or a different runtime removes this adapter boundary.

---

## D-069: Retest mobile-QAT Gemma 4 E4B on its required ONNX Runtime 1.27 (2026-07-17, superseded by D-070)

**Decision:** Restore D-067's pinned E4B mobile-QAT q2f16 text manifest and override
Transformers.js's older ONNX Runtime Web dependency with pinned `onnxruntime-web`
1.27.0. The exact nine-file install is 3,361,427,366 bytes. Keep D-067's dedicated
worker, OPFS-integrity, fixture, telemetry, and gate contracts unchanged. Keep E2B
mobile-QAT as the next candidate if E4B fails the complete context run or leaves
impractical GPU headroom; do not switch merely to make this run pass.

**Context / evidence:** the ONNX Community
[mobile-QAT E4B model card](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX)
explicitly requires ONNX Runtime 1.27.0 or newer and shows the q2f16 graphs with the
WebGPU execution provider. The underlying official Google
[mobile-QAT checkpoint](https://huggingface.co/google/gemma-4-E4B-it-qat-mobile-transformers)
describes its custom `wNa8o8` layout as intentionally using targeted two-bit decoder
layers, optimized KV caches, and static activations. The built Parallax AI worker
identified its Transformers.js-supplied runtime as
`1.26.0-dev.20260416-b7804b056c`; that predates the model's stated runtime floor and
explains RE-026's explicit 4/8-bit kernel rejection. ONNX Runtime Web 1.27.0 is now a
published stable browser package, so a pinned override is narrower and more faithful
to the requested model than abandoning mobile-QAT.

The intervening D-068 q4f16 run remains useful evidence. On a valid physical-console
environment it completed all nine cold OPFS writes and nine browser-restart OPFS reads,
measured warm gate-watch TTFT p95 at 302.79 ms over twenty samples, and retained 4,980
render-worker callback intervals at 16.74 ms p95. It failed exact JSON (the model added
Markdown fences in all five cases) and deterministically invalidated a WebGPU buffer
on the large context after completing the 1,656-token medium context. Artifact
`app-owned-llm-spike-1-48812e6c72bd-dev-01-2026-07-17T15-55-10-760Z.json` is a failed
cohort, not a promoted baseline.

**Consequences:** P-007 again tests the user's preferred 3.36 GB mobile export, now on
the runtime version its publisher requires. The dependency override and runtime version
are part of the result identity. If 1.27 still rejects or loses the device, that is
stronger export/runtime evidence and triggers the smaller E2B candidate rather than a
silent fallback.

**Reopen if:** Transformers.js publishes a release on an equal/newer compatible runtime,
the override breaks its public pipeline contract, E4B fails the full gate, or E2B's
measured game-headroom tradeoff is superior.

---

## D-068: P-007 switches Gemma 4 E4B from q2f16 mobile-QAT to q4f16 (2026-07-17, superseded by D-069)

**Decision:** Keep Gemma 4 E4B, Transformers.js 4.2.0, the dedicated AI-worker
topology, fixtures, and fail-closed OPFS contract selected by D-067, but replace the
incompatible mobile-QAT q2f16 export with the standard export's q4f16 text path. Pin
`onnx-community/gemma-4-E4B-it-ONNX` at revision
`843f250f23bc91754def1e0f0db390dacd1e6b05`, dtype `q4f16`, and its exact nine-file
text-only manifest: 4,924,946,442 bytes with a SHA-256 for every file.

**Context / evidence:** the first physical-console diagnostic used pinned Chrome for
Testing 150.0.7871.115 and the normal browser sandbox. ONNX Runtime rejected session
creation for the q2f16 graph at `gather_block_quantized.h:55`: its WebGPU kernel
requires `bits == 4 || bits == 8`. Artifact
`app-owned-llm-spike-1-4ae4fc26627f-dev-01-2026-07-17T15-44-56-168Z.json` retains the
exact error from both the fresh and browser-restart phases. The q2 attempt verified
eight cache entries without hash failures before the session error, but produced no
inference samples and is not qualification evidence. The same run exposed a harness
omission: unlike `smoke@1`, this new runner had not enabled Chrome's WebGPU developer
identity fields, so the environment gate was independently invalid. The runner now
uses the same identity flag; no machine labels or thresholds were relaxed.

The pinned [standard E4B ONNX repository](https://huggingface.co/onnx-community/gemma-4-E4B-it-ONNX/tree/843f250f23bc91754def1e0f0db390dacd1e6b05/onnx)
contains the q4f16 embed and decoder graphs selected here. Its API tree supplied the
LFS object SHA-256 and exact sizes for large files; the three small non-LFS JSON files
were downloaded and SHA-256 hashed locally. q4f16 is the narrowest model-preserving
response to the observed 4-or-8-bit runtime constraint, but it remains a candidate
until the full gate succeeds.

**Consequences:** the exact install grows from 3.36 GB to 4.92 GB. The first q4f16 run
must still prove every runtime, cache, quality, latency, and contention requirement;
selection does not imply compatibility or a pass. The q2f16 failure is RE-026 rather
than hidden by an automatic runtime fallback.

**Reopen if:** q4f16 fails session creation, exceeds practical memory/install costs, or
cannot meet the existing latency/quality contract. In that case test the predeclared
E2B branch or a different measured runtime/export through another decision.

---

## D-067: P-007 phase A starts with mobile-QAT Gemma 4 E4B in a dedicated WebGPU worker (2026-07-17, superseded by D-068)

**Decision:** Run P-007 phase A first with the instruction-tuned Gemma 4 E4B mobile-QAT
text path, converted to ONNX and executed by `@huggingface/transformers` 4.2.0 over
ONNX Runtime Web/WebGPU in a dedicated AI worker. Pin model
`onnx-community/gemma-4-E4B-it-qat-mobile-ONNX` at revision
`4d18aa8b54e354bec4705e4a4894f5bbf8956c3d`, dtype `q2f16`, and the exact nine-file
text-only manifest: 3,361,427,366 bytes with a SHA-256 for every file. The first install
streams each artifact through an incremental hash into an OPFS temporary file and only
publishes the verified cache entry after an OPFS-local move. Warm runs must read all
nine artifacts from OPFS with zero remote misses.

The experiment uses greedy decoding with thinking disabled for performance/schema
samples, twenty repetitions of the exact branded-Prompt gate-watch fixture for a real
nearest-rank p95, plus fixed grounding, JSON-intent, context-size, and raw dialog-quality
cases. Raw outputs and exact input/output token counts remain result evidence. The model
is an install resource, not a multi-gigabyte build artifact; its revision, manifest, and
OPFS evidence are part of the result contract. The engine build gains a content-addressed
AI worker, advancing the build manifest to v4 and the additive telemetry envelope to v5.

Treat device topology honestly. The initial branch is an AI-worker-owned logical
`GPUDevice`, separate from Babylon's render-worker device. A true shared-device branch
requires colocating inference with rendering and assigning Babylon's device to ONNX
Runtime before session creation. A second device on the same adapter is not “shared.” If
Babylon cannot expose the device through a supported boundary, phase A records that
branch as unsupported and scopes the integration/fork rather than fabricating a
comparison.

**Context / evidence checked 2026-07-17:** Google's current
[Gemma 4 documentation](https://ai.google.dev/gemma/docs/core) identifies E4B as the
4.5B-effective/8B-total, 128K-context on-device member and lists mobile/text-only
memory variants. The official
[Gemma 4 E4B model card](https://huggingface.co/google/gemma-4-E4B-it) uses Apache-2.0.
The pinned [mobile-QAT ONNX repository](https://huggingface.co/onnx-community/gemma-4-E4B-it-qat-mobile-ONNX)
is public and reports 3.65 GB including unused audio/vision files; its API manifest and
Transformers.js `ModelRegistry` locally identified the nine text-generation files and
the exact 3,361,427,366-byte total recorded above. Transformers.js 4.1 added Gemma 4;
4.2 exposes worker-compatible WebGPU execution and a custom Cache-like backend. Current
ONNX Runtime Web documentation exposes an existing-device setter, but WebGPU objects do
not cross the current worker boundary.

Chrome's current [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api)
still names a browser-selected Gemini Nano and explicitly leaves exact model size/version
under browser control. Gemma 4 E4B is therefore a comparable Google on-device
size/capability class and a user-selected challenger, **not** claimed to be Chrome's
exact checkpoint.

**Consequences:** P-007 remains open until physical-console fresh/warm evidence exists;
this decision selects the experiment, not its winner. E4B is tested first as requested.
If it misses memory, frame, or first-token constraints, E2B is the predeclared smaller
candidate; changing model/runtime/quantization or weakening a budget requires another
decision. `onnxruntime-node`, `sharp`, and `protobufjs` install scripts remain disabled:
the browser worker uses their web/runtime artifacts and needs none of those native
postinstall paths.

**Reopen if:** the pinned export is corrupt/incompatible, the mobile quantization loses
required dialog/schema quality, a supported Gemma 4 WebLLM build becomes materially
simpler, Transformers.js gains an app-owned OPFS/integrity contract that supersedes the
adapter, or shared-device evidence changes the preferred placement.

---

## D-066: OPFS spike closes on capability evidence, not a stable microbenchmark baseline  (2026-07-17, accepted)

**Decision:** Close the M0 worker-owned OPFS spike as a qualified go for the planned M1
storage boundary. Every launch must still complete the exact fixture lifecycle, return
every requested byte, validate every word, retain finite read-call and wall timings, and
publish the per-run raw throughput; those checks remain mandatory. Keep the existing
10% cross-repeat throughput calculation unchanged, but classify its result as an
informational platform-research metric in `smoke@1` metric-set v10. An invalid
repeatability result is reported, never converted to measured, trimmed, or promoted as
a baseline. M1's representative OPFS-to-renderable cell-load p95 is the user-outcome
gate.

Advance the public telemetry envelope to v4 and the smoke report to schema v22. Retain
each of the twelve sequential-pass timings, each 256-operation random-read batch, and a
one-second Windows physical-disk activity sample overlapping every OPFS window. The
host sample is attribution-only and non-mandatory because it is currently Windows-
specific and coarser than the sub-second micro-workload.

**Context / evidence:** D-063 correctly refused to promote two sandboxed schema-v20
cohorts that missed the then-mandatory 10% gate, including a 3.45 GiB/s fresh-
sequential outlier. Retrying that unchanged contract until it happened to pass would
have selected a favorable sample. Instead, schema-v21 physical-console artifact
`smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T14-53-51-392Z.json` added the
attribution RE-023 requested. All six sandboxed core runs completed, all reads validated,
all traces drained, the registered environment passed, and all 24 budget checks passed.
Five OPFS cohorts stayed within 3.30-6.03%; warm-random spanned 5.25-5.81 GiB/s and
missed the variance limit at 10.62%.

The low warm-random run was not a sustained storage slowdown: one 256-read batch took
4.925 ms while its other batches took 2.565-3.305 ms; its sequential phase remained
normal at 6.71 GiB/s. The overlapping host sample measured 32,259 B/s physical reads,
88,712 B/s physical writes, zero disk queue, and 1.161 ms average physical-read latency.
Across all six windows, physical reads were only 16-109 KiB/s while the worker reported
5.25-7.15 GiB/s, confirming the intended warm-cache scope and excluding sustained
physical I/O as the attribution for this cohort. The experiment still cannot distinguish
browser broker/service scheduling from other sub-millisecond host scheduling, which is
the platform observability gap RE-023 records.

**Consequences:** M0 no longer claims a stable OPFS throughput baseline. It does claim,
with sandboxed evidence, that a dedicated worker can own a sync access handle, preserve
fresh/warm lifecycle semantics, and deliver validated warm-cache reads with multi-GiB/s
raw throughput under the live renderer. OPFS repeatability remains visible in every
report and in RE-023 without indefinitely blocking unrelated Harness-v1 evidence. The
next sandboxed schema-v22 run must pass every still-mandatory facet before replacing the
unsandboxed aggregate gate; D-066 does not retroactively promote schema v20/v21.

That replacement subsequently passed in physical-console artifact
`smoke-1-7d4974355d92-dev-01-showcase-2026-07-17T15-00-16-046Z.json`: schema v22 /
metric-set v10 passed the registered environment, mandatory evidence, and all 24 budget
checks. Every read validated and every trace drained. Its four OPFS repeatability ranges
were 6.58%, 1.10%, 2.64%, and 2.21%; this favorable cohort does not erase RE-023's
retained invalid cohorts or create a throughput baseline.

**Reopen if:** per-run correctness or throughput evidence becomes invalid; representative
M1 cell-load p95 misses its budget; the batch/host attribution identifies a controlled
project-side source; or Chrome exposes operation/service-queue telemetry that supports a
stable attribution-aware baseline.

---

## D-065: Sandboxed schema-v2 branded Prompt lifecycle qualifies production install  (2026-07-16, accepted)

**Decision:** Accept physical-console artifact
`prompt-api-branded-1-8b5f1c1df68b-dev-01-2026-07-17T02-23-55-286Z.json` as the
current branded-Chrome production-install qualification and close that M0 plan item.
Both independent fresh-profile lineages passed the schema-v2 contract with the normal
Chrome sandbox, measured registered-machine environment, consistent Chrome
150.0.7871.128 identity/hash, exact online/restart/offline fixture, settled availability,
and nonzero privileged model-component evidence.

**Context / evidence:** the uninterrupted profile downloaded in 102.6 s, observed 852
progress events, and measured a 24.0 s longest phase-local forward-progress gap. The
restart/resume profile downloaded in 161.9 s, observed 1,045 progress events, measured a
17.8 s longest phase-local gap, and separately recorded a 4.7 s restart observation
window. Each profile installed 4,269,934,835 bytes across six files, initially reported
`downloading` after the post-install browser restart, settled to `available` after the
fixture, and streamed the same fixture offline with availability `available`. The known
exact `chrome://debug-webuis-disabled` redirect remained explicit `unsupported`
diagnostic evidence under D-061.

The four first-token samples were 3,543.6, 3,682.8, 3,877.2, and 3,603.2 ms. They all
exceed the 1.5 s dialog target and remain RE-021/P-007 backend-selection evidence; this
lifecycle qualification is not a latency pass. Adding this cohort expands the
same-version delivery calibration to eight profiles with true phase-local gaps of
16.7-24.0 s, leaving the unchanged 120-second boundary at 5.00x the largest observation.

**Consequences:** the Prompt production-install checkbox is complete. Schema-v1
artifacts remain diagnostic history, while this schema-v2 artifact is the current
qualification. The OPFS and aggregate smoke gates remain independently open under
D-063/RE-023; this run exercises neither and does not re-qualify them.

**Reopen if:** a later branded-Chrome lifecycle fails the schema-v2 contract, delivery
approaches the 120-second phase-local boundary, model bytes/availability cease to
survive restart/offline use, or the exact internal status page becomes available and
can replace the current unsupported diagnostic.

---

## D-064: Branded Prompt schema v2 separates measured progress from restart observability  (2026-07-16, accepted; qualification fulfilled by D-065)

**Decision:** Advance `prompt-api-branded@1` to report schema v2. Gate the 120-second
download liveness boundary only on the engine's phase-local forward-progress timer,
which advances on every strictly larger normalized progress value. Do not reconstruct
silence from the engine's retained samples: those samples are deliberately quantized at
roughly one-percent progress increments and their spacing is not a no-progress measure.
Record the interval from the last retained pre-restart sample to the first retained
post-restart sample separately as `restartObservationGapMs`. That interval includes
browser shutdown, relaunch, environment probes, and time during which no page observer
exists, so it is a non-gating observability upper bound rather than a Chrome stall.

Schema v2 also records aggregate post-run identity failures without discarding completed
profiles, types and retains every availability phase even when availability is null,
adds the target display mode to branded environment identity, restricts the known
internal-page exception to the exact redirect, and rejects invalid Chrome-version and
availability values. Restart interruption requires the current normalized maximum to
remain strictly between 0 and 1, rather than accepting a historical intermediate sample
after delivery has reached 1. Browser close now detaches live error listeners and escalates to a
browser close on context-close failure. Profile cleanup is non-gating post-measurement
housekeeping, with a guarded startup sweep for stale `run-*` children older than one day.

**Context / evidence:** Review of the four schema-v1 artifacts exposed the retained-
sample error. Across the six same-version profiles used for calibration, it overstated
the engine's actual no-forward-progress maxima by 7.6-10.1 seconds. In the sandboxed lifecycle artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T01-16-45-160Z.json`, the report
claimed 26.3 s and 25.3 s while raw phase-local telemetry measured 16.7 s and 17.1 s.
Across all six same-version delivering profiles in the `00-31-55`, `00-38-47`, and
`01-16-45` artifacts, phase-local maxima were 16.7-17.3 s and total delivery durations
were 101.3-263.7 s. The 120-second boundary is therefore 6.92x the largest observed
true forward-progress gap. The 263.7-second delivery came from a profile that failed a
separate settled-availability criterion; excluding its valid delivery telemetry would
be selection on an unrelated outcome.

The same review reproduced a false `Infinity` restart gap when the first resumed sample
was already 1, showed that schema-v1 artifacts predated current settled-availability
evidence while retaining the same version stamp, and identified failure paths that
could discard completed evidence or freeze arrays still referenced by page listeners.
Local unit tests now cover the corrected timing semantics, completed-on-resume case,
terminal failure propagation, exact redirect, primitive availability values, nonempty
version floors, and stale-profile pruning.

**Consequences:** schema-v1 artifacts remain raw lifecycle, latency, and browser-
behavior evidence, but none is a current production-install qualification for the
schema-v2 contract. Reopen that plan item until a physical-console schema-v2 sandboxed
run passes both fresh-profile lineages. D-061's 120-second value remains calibrated, but
its rationale and multiplier are corrected here. D-060's result-shape and restart-gap
language are amended by this decision.

**Reopen if:** Chrome exposes a persistent delivery job with timestamps across browser
lifetimes, allowing restart delivery silence to be measured rather than bounded by an
observer-free wall-clock interval; or additional valid delivery profiles approach the
120-second phase-local threshold.

---

## D-063: Sandboxed smoke evidence replaces, rather than inherits, the unsandboxed gate  (2026-07-16, accepted; amended by D-066)

**Decision:** Do not promote the earlier schema-v19 `smoke@1` pass as the reference
result after D-062 changed the browser process topology. The replacement must be a
sandbox-verified schema-v20 run that passes the unchanged metric-set-v8 contract. Two
physical-console schema-v20 attempts are retained as negative evidence rather than
retried until one happens to pass: both verified the sandbox and registered environment,
but both failed mandatory OPFS repeatability; the second also reproduced RE-008. Reopen
the Harness-v1 aggregate gate and OPFS performance qualification in `plan.md`. Do not
change the 10% variance limit or the five-second trace transaction bound to accept this
cohort.

**Context / evidence:** Artifact
`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-06-27-753Z.json` completed all six
core runs and all trace drains, but fresh-random OPFS read-call throughput varied 10.30%
and warm-sequential varied 10.61%. The unchanged confirmation artifact
`smoke-1-2296afdeaa23-dev-01-showcase-2026-07-17T01-09-09-623Z.json` recorded a fresh
sequential outlier at 3.45 GiB/s versus 5.99 and 6.53 GiB/s (89.44% relative range),
fresh-random variance of 30.84%, and one core trace that acknowledged `Tracing.end` in
2.5 ms but delivered zero events/chunks before the 5,001.6 ms timeout. All reads in both
runs validated, the environment facet passed, `sandboxVerified` was true, and the
effective command line omitted `--no-sandbox`.

**Consequences:** the sandboxed core measurements remain useful subsystem data: WebGPU
rendering, SAB transport, JS heap, Dawn cache behavior in measured traces, and HTTP
serving completed. They are not an aggregate budget pass. RE-023 tracks the new OPFS
instability and RE-008 retains the trace failure. Further work must isolate whether the
OPFS outliers arise from sandbox topology, storage scheduling, or an uncontrolled host
factor before a replacement baseline is promoted.

**Reopen if:** a controlled cause is identified, or a sandbox-verified schema-v20 run
passes the unchanged contract after that cause is addressed.

---

## D-062: Reference Chrome launches keep the process sandbox enabled  (2026-07-16, accepted)

**Decision:** Every Parallax Playwright Chrome launch sets `chromiumSandbox: true`.
The shared launcher rejects caller-supplied `--no-sandbox`; Prompt API launch-contract
inspection also rejects the switch if it appears in Chrome's effective command line.
`smoke@1` schema v20 records that effective command line and a sandbox-verification
field in the environment identity. Sandboxing is part of the measured browser contract,
not an optional automation convenience.

**Context:** Playwright 1.61.1 defaults `chromiumSandbox` to false and consequently
added `--no-sandbox` to every shared harness launch. Branded Chrome surfaced its
unsupported-flag warning, revealing that all prior CfT and branded measurements used a
different child-process security topology from ordinary production Chrome (RE-022).
Chromium's Windows sandbox requires neither elevation nor a special driver, and current
Chromium source assigns the on-device-model execution utility an AppContainer sandbox.
A local disposable probe on dev-01 successfully launched and controlled both ordinary
and persistent branded Chrome 150.0.7871.128 contexts with `chromiumSandbox: true`.

**Sources checked (2026-07-16):** Playwright's current
[BrowserType API](https://playwright.dev/docs/api/class-browsertype) documents the
`chromiumSandbox` option and its false default. Chromium's
[sandbox design](https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md)
documents that the Windows sandbox works without administrator privileges and that
`--no-sandbox` removes renderer target-process isolation. Chromium's
[Windows sandbox launcher](https://chromium.googlesource.com/chromium/src/+/main/sandbox/policy/win/sandbox_win.cc)
shows that the switch bypasses sandbox policy, disables CET compatibility for child
processes, and that on-device-model execution normally selects an AppContainer.

**Consequences:** lifecycle evidence from earlier unsandboxed runs remains useful as
diagnostic history. D-061 now records the passing sandboxed branded-Chrome production
qualification, while D-063 retains two failed sandboxed schema-v20 smoke attempts and
reopens the aggregate/OPFS baseline instead of inheriting its unsandboxed predecessor.
A sandbox-related failure becomes measured platform evidence; it is not bypassed by
restoring `--no-sandbox`.

**Reopen if:** Chrome cannot exercise a required web-platform capability under its
normal Windows sandbox. Any exception requires a new decision, isolated diagnostic
scenario, and explicit non-production label.

---

## D-061: Web-visible availability plus component bytes gate branded model status  (2026-07-16, accepted; amended by D-064)

**Decision:** Refine D-060's model-status requirement after the first physical-console
qualification. `chrome://on-device-internals` remains recorded, but an exact redirect
to `chrome://debug-webuis-disabled/?host=chrome://on-device-internals/` is
`unsupported` diagnostic evidence rather than a production-UX failure. A branded
profile gates model readiness on the web-visible lifecycle instead: `available` after
install, successful streamed inference after browser restart followed by `available`,
and a successful exact-fixture repeat while network-isolated. Chrome 150 may initially
report transient `downloading` immediately after restart even though the installed
session then creates successfully (RE-020); that transition is retained and does not
substitute for the required settled `available`. Post-shutdown privileged
inspection must independently measure nonzero `OptGuideOnDeviceModel` bytes/files.
Other internal-page failures remain invalid; arbitrary or label-only status text never
passes.

The same-version delivery cohorts calibrate and retain the 120-second
no-forward-progress boundary. Raw phase-local telemetry from all six delivering
profiles in the `00-31-55`, `00-38-47`, and sandboxed `01-16-45` artifacts measured
true forward-progress maxima of 16.7-17.3 s while total deliveries ranged from
101.3-263.7 s. The existing threshold is 6.92x the largest observed gap, leaving ample
delivery jitter while still rejecting the 120-second silence reproduced by the CfT
spike. D-064 corrects the schema-v1 retained-sample calculation and changes the
threshold from provisional to calibrated without changing its value.

**Context / evidence:** Sandboxed schema-v1 physical-console lifecycle artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T01-16-45-160Z.json` installed
4,269,934,835 bytes (6 files) in each independent fresh profile, captured 1,041 and 1,489
normalized progress events, completed initial and post-restart NPC fixtures, and
repeated the fixture offline with settled availability `available`. Both profiles used
branded Chrome 150.0.7871.128 with the same executable hash, and every effective command
line omitted `--no-sandbox`. The initial post-restart availability was transiently
`downloading` before successful inference and a settled `available` check (RE-020). The
internal debug URL was disabled in both automation sessions, matching the already-recorded
RE-018 behavior. Its four first-token samples measured 3,382.3-3,514.5 ms (RE-021).

The earlier unsandboxed schema-v1 passing artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T00-38-47-623Z.json` remains useful
diagnostic history but is superseded for production qualification by the sandboxed
schema-v1 artifact above. D-064 subsequently reopens production qualification for the
corrected schema-v2 contract.

The earlier diagnostic artifact
`prompt-api-branded-1-2296afdeaa23-dev-01-2026-07-17T00-23-02-899Z.json` installed
4,269,934,835 bytes in each independent branded profile, captured 913 and 747 normalized
progress events, completed the initial and post-restart NPC fixtures, and repeated the
fixture offline with availability `available`. The internal debug URL was disabled in
both automation sessions, matching the already-recorded RE-018 behavior. The overall
artifact failed both because Chrome auto-updated from 150.0.7871.115 to 150.0.7871.128
during the run and because both internal-page redirects were then classified `invalid`.
D-061 deliberately changes the latter exact automation redirect to `unsupported`; it
does not characterize model-status relaxation as unrelated to that failed result.

**Consequences:** the branded runner preserves the internal-page reason in JSON and
Markdown, but does not require a debug-only Chrome surface unavailable to its launch
environment. `budgets.md` records the now-calibrated 120-second boundary. D-060's
same-version/hash rule and all web-visible restart/offline/component requirements remain
unchanged. D-064 later advances the report contract and reopens the branded
production-install plan item; the schema-v1 first-token measurements remain open
backend-selection evidence under RE-021.

**Reopen if:** Chrome enables the internal page under automation (promote it back to a
measured diagnostic), or additional valid installs show a legitimate phase-local
progress gap near 120 seconds.

---

## D-060: Branded Prompt qualification is a two-profile lifecycle scenario  (2026-07-16, accepted; amended by D-064)

**Decision:** Implement the production-install qualification required by D-059 as the
separate versioned scenario `prompt-api-branded@1`. It launches the installed branded
Chrome executable against two independent disposable profiles outside the repository:
one uninterrupted install and one install deliberately interrupted only after a live
intermediate progress update, then resumed with the same profile after browser restart.
Both profiles run the same game-owned NPC-dialog prompt during initial creation, close
and relaunch Chrome after installation, repeat that prompt, isolate the browser from the
network, and repeat the exact prompt again offline. The runner records each availability
transition, phase-local progress telemetry, total download duration across restart, the
  longest phase-local interval without forward progress, the separately labeled
  observer-free restart interval,
the effective Chrome launch contract, `chrome://on-device-internals` status text, and
  post-shutdown `OptGuideOnDeviceModel` bytes/files/versions. It attempts non-gating
  cleanup of each exact child profile only after privileged inspection and writes JSON
  plus Markdown evidence; a guarded later-run sweep removes stale children.
Every browser launch re-hashes the installed executable, the two profiles must retain
the same version/hash, and each profile carries the registered-machine host, GPU,
driver, power, display, remote-session, and post-run identity gate used by the standard
harness. Caller-supplied machine/tier labels cannot make an indirect session valid.

Progress is evaluated per browser lifetime before aggregation: a resumed monitor may
legitimately begin again at normalized 0, so that phase-local reset is not called a
cross-restart regression. The combined evidence still requires a 0 endpoint, at least
one intermediate update, a 1 endpoint, no invalid/regressive event within either
  phase, and the D-059 120-second phase-local liveness bound. The restart profile is not
valid unless the first browser was closed after observable intermediate progress and
the second phase completed. This scenario is backend-selection and production-UX
evidence, not a pinned-CfT performance gate; it still records artifact/source identity
and fails closed on missing lifecycle evidence. The plan checkbox stays open until two
physical-console results exist and the successful-run timings either recalibrate or
confirm the provisional stall threshold through a follow-up decision.

**Context:** Reusing `prompt-api-spike@1` would delete its fresh CfT profile after one
browser lifetime and would either lose restart evidence or weaken that research gate's
digest-pinned environment contract. A manual checklist would also fail the project's
requirement that performance and lifecycle claims land as diffable artifacts. Phase-
aware aggregation is necessary because the browser, page, engine service, and progress
monitor are all recreated at the restart boundary while Chrome-managed model delivery
persists in the profile.

**Sources checked (2026-07-16):** Chrome's current
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) requires a
user-activation-backed `LanguageModel.create()` and documents normalized progress
monitoring. Chrome's
[model-management guide](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
states that download continues after a tab closes and resumes after a browser restart
within 30 days. The
[built-in AI setup guide](https://developer.chrome.com/docs/ai/get-started) documents
offline inference after initial delivery, variable model size, the 22 GB free-space
precondition, and `chrome://on-device-internals` as the exact-size/status surface.

**Consequences:** `harness:prompt-api-branded` is the operator command; D-064 advances
its harness result to schema v2, independently of `prompt-api-spike@1` schema v6.
Its branded-only offline fixture intentionally equals its online NPC fixture so "repeat
offline" measures the same workload without changing `prompt-api-spike@1`'s versioned
sentinel fixture. A failure to trigger, expose actionable progress, resume,
remain available after restart, expose model status, or stream offline is retained as
negative backend-selection evidence rather than bypassed.

**Reopen if:** Chrome exposes a supported persistent download job/status API that spans
browser lifetimes, making page-monitor phase aggregation unnecessary; or successful
qualification data requires a different interruption point or liveness threshold.

---

## D-059: Prompt API M0 evidence is a standalone, activation-driven run  (2026-07-16, accepted)

**Decision:** Implement the M0 Prompt API spike as versioned scenario
`prompt-api-spike@1`, separate from `smoke@1`, with a window-owned engine service and
real app buttons for both creation and the offline follow-up. The fixed NPC-dialog
fixture is game-owned and exported for reuse by P-007. Prompt telemetry is an additive
section with its own schema v3 under the existing aggregate telemetry envelope v3, so
the temporary spike does not invalidate unrelated smoke history. The launch-evidence
and progress-liveness shape advances the standalone result schema to v6.

The evidence runner uses the exact digest-gated Chrome for Testing pin and the common
registered-machine environment gate. Every execution creates a distinct temporary
profile under a dedicated external root, records lineage `fresh`, measures the model
component after Chrome exits, then removes that exact child profile. This prevents both
permanent warm-run failures and multi-gigabyte profile accumulation. A run must observe
normalized progress endpoints 0 and 1, at least one intermediate update, monotonic
forward motion, and no invalid events. The recorder retains timestamped samples,
maximum progress, the longest interval between advances, and exact invalid/regressive
event counts while coalescing UI publication. Model bytes are labeled privileged
evidence, never web-visible telemetry.

Prompt model delivery requires three Playwright defaults to be absent (background
networking, component updates, and component-extension background-page suppression)
and requires `OptimizationHints` to remain enabled. Because Playwright combines
`OptimizationHints` with 15 unrelated disabled features, the runner replaces that one
combined switch with the same list minus `OptimizationHints`; it does not re-enable
`PaintHolding`, `RenderDocument`, `DestroyProfileOnBrowserClose`, or the other
automation suppressions. Before measurement it reads the effective command line from
`chrome://version`, records it plus the disabled-feature set in result schema v6, and
fails closed if a model-delivery switch reappears or any preserved suppression is
missing. This runtime assertion detects private Playwright-default churn independently
of the copied exact string.

The Prompt context also enables `--enable-webgpu-developer-features`, the same switch
used by `smoke@1`'s environment inspection, so `GPUAdapter.info` exposes the registered
device, description, backend, and driver fields instead of Chrome's sanitized blanks.
The runner validates and records that effective switch; Parallax requests no
developer-only GPU capability. Adapter identity is read from the inert
`/__parallax/identity` control page rather than the already-running app, while the
unchanged registered-machine comparisons remain authoritative.

The inference window ends before session-pressure probing. The pressure probe attempts
at most eight clones, reports the actual attempt/success counts, and destroys the
primary and every clone before the offline probe. Eight is a bounded M0 pressure sample,
not a claimed platform limit. The run allows 30 minutes for a first model download only
while forward progress remains live. A provisional 120-second watchdog starts at the
activation click and resets only when normalized progress increases; endpoints,
duplicates, invalid values, and regressions do not mask a stall. On expiry the runner
closes Chrome early but preserves the partial telemetry and an exact stall reason in the
failure artifact. The threshold lives in `budgets.md` and is recalibrated from successful
fresh-profile downloads rather than weakened in harness code. The run
gates the existing 1.5 s dialog first-token and main-thread long-task budgets. Render-
worker callback pacing is marker-aligned but remains a **non-gating heuristic** under
D-051: it is not compositor presentation, and dev-01's known idle p95 already exceeds
the presentation threshold. The short generation scenario cannot supply the 1,000
samples needed to distinguish nearest-rank p99.9 from maximum, so it reports p50, p95,
and maximum and explicitly declares p99.9 inapplicable. A full telemetry-batch guard
band prevents pre-inference callbacks entering the window; if it consumes the whole
short window, the metric is invalid with the observed and excluded frame counts.
At least 30 retained marker-aligned intervals are required before callback pacing is
labeled a distribution; smaller samples remain an explicit invalid diagnostic rather
than presenting one or two observations as p50/p95/max evidence.
The main-thread long-task observer attaches before navigation and is valid only when
Chrome advertises `longtask` support, observer installation succeeds, and inference
start/end markers are all verified. Dedicated-worker exposure is evidence,
not a requirement that today's expected `false` remain true. Forced eviction is
`unsupported`: neither the Prompt API surface nor the automation contract provides a
non-destructive eviction control, so offline reavailability is measured after network
isolation while browser-managed deletion remains a separate manual exercise. Engine
compilation pins `@types/dom-chromium-ai@0.0.17`; adapter fakes and all repository tests
are included in a typechecked test project.

The pinned-CfT run is research evidence, not by itself a production-install
qualification. Before resolving P-007 or making Prompt API a required game dependency,
M0 separately exercises the real install UX in at least two independent fresh
branded-Chrome profiles: one uninterrupted download and one browser-restart/resume.
Both must provide actionable monotonic progress with an intermediate update, reach an
available model, stream the shared NPC fixture, survive restart, and repeat offline.
Silent or untriggered delivery is negative backend-selection evidence even if the CfT
gate passes.

**Context:** Folding this into the already dense `smoke@1` contract would make a
potentially multi-gigabyte, activation-bound download part of every change and couple
its profile history to unrelated baselines. Review also found that retaining the online
session cohort contaminated the offline result, a worker diagnostic could block the
primary probe, measured budgets were advisory, download evidence silently vanished on
warm profiles, callback pacing was incorrectly made a presentation gate, and the first
draft advanced the global telemetry schema for an additive field. The standalone
contract isolates those concerns while still sharing Chrome launch, digest,
environment, browser-probe, telemetry-read, and file-walk code with the harness.

**Sources and evidence checked (2026-07-16):** Chrome's current
[Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api) documents
window exposure, current worker unavailability, user-activation-bound `create()`, and
the recommended ambient types. Chrome's
[built-in AI setup guide](https://developer.chrome.com/docs/ai/get-started) documents
the 22 GB free-space precondition, variable model size, `chrome://on-device-internals`
as the exact-size surface, and removal below 10 GB free. Chrome's
[model-management guide](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
also documents deletion after 30 days without meeting eligibility, deletion at any time
including mid-session, and application-triggered redownload through a new `create()`
call rather than automatic recovery. The Prompt API page separately documents that
`create()` must be called under user activation.
The WICG [Prompt API proposal](https://github.com/webmachinelearning/prompt-api)
specifies normalized 0..1 progress, mandatory 0/1 events, no exact byte exposure,
session destruction, and current worker scope.

A local investigation found those initial `unavailable` results were invalidated by
Playwright defaults on both launches: `chrome://version` showed component updates,
background networking, component-extension background pages, and `OptimizationHints`
disabled. `chrome://policy` showed no configured policy, `chrome://flags` contributed
no command-line switches, and `chrome://on-device-internals` reported that internal
debug pages were disabled. With the four contaminating defaults removed, an otherwise
equivalent new branded-Chrome 150 profile returned `downloadable` immediately and in
13 consecutive checks over about one minute. RE-018 records this as our harness bug.
The Prompt runner now opts out of only those Prompt-incompatible Playwright defaults,
restores the other disabled features, and verifies the effective command line before
measurement; ordinary smoke launches retain their existing automation contract. The
three necessary service-level switch differences are reported environment evidence,
so Prompt callback diagnostics are not directly comparable with `smoke@1` results as
if their launch environments matched. A local corrected-launch check read back all 15
preserved suppressions, no disabled `OptimizationHints`, a verified model-delivery
switch contract, and fresh-profile availability `downloadable`. At that point these
remained local diagnostics, not the required physical-console evidence run.

The first schema-v5 physical-console attempt then exercised the liveness contract:
fresh-profile availability was `downloadable`, but activation-backed `create()` stayed
pending for 120,683 ms with zero progress events and zero model-component bytes. The
watchdog retained that exact partial state and closed Chrome instead of waiting 30
minutes (RE-019). The run is not promotable M0 evidence because the separate environment
facet was invalid: the Prompt runner's main-window WebGPU adapter probe returned blank
identity fields. That first artifact remains explicitly labeled local diagnostic
evidence; it is not substituted for the corrected environment run below.
The environment root cause was harness placement, not a relaxed machine contract:
`smoke@1` probes WebGPU on the inert `/__parallax/identity` control page before workload
navigation, while the Prompt runner queried the live app after its render worker had
already acquired WebGPU. The Prompt runner now uses the same isolated control-page
probe, enables and validates the same developer identity switch as `smoke@1`, and
retains every existing adapter comparison.

The corrected schema-v6 physical-console run
`prompt-api-spike-1-b68bd86a977a-dev-01-2026-07-16T23-41-28-710Z.json` passed the
registered dev-01 environment gate with the full RTX 4080 Super D3D12 adapter/driver
identity and verified the effective Prompt launch contract. It again began from a fresh
profile with availability `downloadable`; activation-backed `create()` remained
`creating` for 120,723 ms with zero progress events, zero retained samples, and zero
files/bytes under the model-component root. The liveness abort preserved that evidence.
Because model delivery never began, inference, session pressure, and offline
reavailability were invalid or not run; these are explicit downstream consequences of
the failed prerequisite, not passing results.

**Consequences:** the Prompt API research-spike plan item is complete with a measured
no-go for use as a required backend: the valid physical run could neither start
observable delivery nor reach the later inference/session/offline checks. The separate
branded-Chrome production-UX qualification remains open because it tests the actual
player install path rather than CfT automation; it must pass before Prompt API can be a
required game dependency. The P-007 comparison imports the same game fixture and treats
a branded-install failure as evidence favoring the app-owned model.

**Reopen if:** worker exposure lands; the platform exposes attributable byte progress or
a supported eviction test/control; eight clones no longer provide useful pressure
evidence; successful first-download event timing shows the provisional 120-second stall
threshold or 30-minute completion ceiling is inadequate; or Playwright/Chrome changes
the component-delivery launch requirements.

## D-058: Isolate the M0 OPFS sync-read spike and advance worker contracts  (2026-07-15, accepted)

**Decision:** Measure worker-owned OPFS synchronous reads with a dedicated, temporary
storage worker under the live walking-skeleton renderer. `smoke@1` finishes its
privileged display diagnostics and mandatory SAB transport before explicitly starting
the OPFS phase; continuous rendering is the only intentional concurrent workload. A
fresh profile provisions one deterministic 64 MiB fixture, and its paired warm profile
must reuse that exact file. Each launch first performs one untimed, fully validated
sequential preflight, then reads it sequentially twelve measured times in 1 MiB
operations and performs 4,096 deterministic random 64 KiB reads. The fixture stores an
absolute-position `Uint32` pattern, so every returned word is checked against its
requested offset. Short reads, corruption, lifecycle drift, or missing timings make the
mandatory evidence invalid.

Time summed directly around `FileSystemSyncAccessHandle.read()` is the primary API-path
throughput metric and must stay within the existing 10% repeat-variance policy for all
fresh/warm × sequential/random cohorts. Validation-inclusive worker wall throughput and
fixture-provisioning time are retained as diagnostics, not variance gates. The probe is
explicitly a warm OS-cache microbenchmark; cold-disk behavior, N-reader contention, and
representative cell-load latency remain M1 questions.

This change advances the public engine telemetry schema from v2 to v3, `smoke@1`'s
mandatory metric set from v5 to v8, and the result schema from v18 to v19. Metric-set
v6 was the first physical calibration attempt; v7 lengthened only the sequential sample
after v6 showed that three passes produced too little timed work for the unchanged 10%
repeatability gate. Metric-set v8 adds the explicit preflight after v7 isolated the
remaining outlier to the first measured sequential phase. It also
advances build-manifest v2 (D-048) to v3: v3 requires exactly one distinct `render` and
one distinct `storage` worker entrypoint. The storage worker terminates before the
post-measurement all-realm JS-heap window, whose required live topology remains the page
plus render worker.

**Context:** The production streaming worker is planned to own sync access handles, so
testing OPFS in the render worker would validate the wrong ownership boundary. Starting
the first implementation automatically at render-ready also overlapped the privileged
`chrome://gpu` display probe and the SAB spike; review rejected that contaminated timing
before any reference result was retained. Build-manifest v2 deliberately limited its
role vocabulary to the then-only render worker and required an explicit contract change
when topology expanded.

**Evidence checked (2026-07-15):** the assembled local app in the Chromium-based Codex
browser successfully created the worker-only sync access handle, completed the
position-validated fixture reads, and reported no page/worker errors. That is a
compatibility diagnostic only.

The first registered dev-01 physical-console calibration (`smoke@1`, schema v19,
metric-set v6, artifact `9f5107d155d0`, Chrome 150) completed all six fresh/warm core
runs with no OPFS payload errors and would have passed all 24 budget checks. It correctly
failed mandatory-evidence completeness because the fresh sequential read-call cohort
spanned 5.90-6.75 GiB/s, a 14.42% relative range. The three-pass sample accumulated only
about 30 ms inside `read()`, so v7 increases it to twelve passes without changing the
10% variance policy. Fresh random and both warm cohorts were repeatable (1.94%, 3.11%,
and 3.87% relative range respectively).

The second physical calibration (`smoke@1`, schema v19, metric-set v7, artifact
`4dab6c1f7e1b`, Chrome 150) again completed every core run without payload errors and
would have passed all 24 budget checks. Its twelve-pass fresh sequential cohort was
5.92, 6.59, and 6.63 GiB/s (12.03% relative range), while fresh random and both warm
cohorts remained repeatable at 3.11%, 3.98%, and 3.50%. Because only the first measured
sequential phase remains low, v8 adds one untimed, fully validated sequential preflight
to every launch. This preserves the twelve-pass measured workload and existing 10%
gate while making the stated warm-path scope explicit. The registered schema-v19 / v8
rerun was therefore required before accepting the decision.

The final registered dev-01 physical-console gate (`smoke@1`, schema v19, metric-set
v8, artifact `bf83d4c84358`, exact CfT Stable 150.0.7871.115) passed environment,
mandatory-evidence, and budget facets with all 24 checks passing. All six OPFS phases
completed with zero validation errors. Read-call throughput ranged 6.65-6.72 GiB/s for
fresh sequential, 5.48-5.68 GiB/s for fresh random, 6.50-6.69 GiB/s for warm sequential,
and 5.58-5.64 GiB/s for warm random; their relative ranges were 1.08%, 3.62%, 2.95%,
and 1.21% respectively. Fresh fixture provisioning took 40.5-53.9 ms. Two immediately
preceding runs of the unchanged artifact were invalidated only by the existing RE-008
Chrome trace-completion gap; both still completed every OPFS phase without validation
errors and kept every OPFS cohort below 5% relative range. This is a go for
the worker-owned sync-access-handle boundary, within the explicitly limited warm-cache
micro-workload scope.

**Consequences:** Ordinary app and V8-diagnostic launches do not run the destructive
microbenchmark; the harness starts it through the public telemetry control surface after
the contaminating probes finish, waits up to 17 seconds for an explicit completed/failed
state, and still preserves a 10-second warm-up floor before gameplay measurement.
The isolated V8 lifecycle diagnostic advances to `v8-code-cache@6` and excludes the
core-only storage entrypoint, which is intentionally not started during that diagnostic;
all scripts expected there must belong to active realms. Manifest-v2 consumers must
reject v3 rather than
silently interpreting its expanded role vocabulary. The observed reference range is
evidence for this micro-workload, not an M1 minimum-throughput budget; representative
cell bundles still require their own measured latency and contention gates.

**Reopen if:** the physical gate cannot complete within the 17-second completion window,
read-call variance is too noisy to trust, representative M1 bundles require a materially
different operation shape, or controlled cold-cache/multi-reader experiments reverse
the storage placement.

## D-057: Use paired fixed-capacity SPSC SAB rings for high-rate worker transport  (2026-07-15, accepted)

**Decision:** The worker fabric's high-rate primitive is a pair of fixed-capacity,
single-producer/single-consumer `SharedArrayBuffer` rings, one per direction. Setup and
one final result summary use `postMessage`; every workload record uses the rings. Each
ring uses a power-of-two capacity and stores fixed-width `Int32` records behind unsigned
monotonic read/write sequences, uses atomic reads/writes for both control and payload
words, and applies bounded
backpressure rather than allocating or growing. Waiters use atomic wait/notify without
ever synchronously blocking the window.

The M0 spike fixes its test pool at two 256-record x 4-word rings (8,224 bytes total)
and sends 100,000 deterministic command/echo round trips through the existing render
worker while it continues rendering. Telemetry schema v2 exposes allocation size,
elapsed time, cooperative round-trip rate, main/worker stalls and waits, correctness
errors, the maximum window pump duration, and concurrent render-worker callback
diagnostics. The rate includes the bounded window pump's scheduling cadence and is not
raw SAB bandwidth. `smoke@1` result schema v18 / mandatory metric-set v5 requires a
completed, corruption-free SAB
measurement on every core run; missing or corrupt transport evidence fails closed.

**Context:** D-005 selected SAB channels but did not define or test their protocol.
The implementation has unit coverage for ordering, full-queue backpressure, descriptor
validation, asynchronous wakeups, lifecycle cancellation, and unsigned 32-bit sequence
wrap. Power-of-two capacity is enforced because a wrapped unsigned sequence used
directly as a slot cursor aliases records at arbitrary capacities. Exact browser
performance and concurrent-render numbers are deliberately not adopted from development
diagnostics: the registered physical-console result required below is the first retained,
source-identified evidence eligible to support those claims. Worker callback timing in
that result remains diagnostic rather than presentation proof under D-051.

The retained physical-console result is
`smoke-1-04d5015a975e-dev-01-showcase-2026-07-15T23-21-50-551Z.json`: result schema v18,
mandatory metric-set v5, artifact digest
`04d5015a975e31b54f03598558cc99796772a68939740eaaeee96221e1bd558b`, source commit
`2fbcb768873f34f22b982088c3ff418809c6c71b` plus dirty-tree digest
`9dbf35e5054112a133d2b25b67048d0db588726c65a72a633ab9543cae841ad6`, exact pinned CfT
Stable 150.0.7871.115 (executable SHA-256
`c55dc23c0d6c2b87cf3d056959eb1e351bc98dfb3e5fa5d53aff86a25f1b32c5`), Windows
26200.8875, and RTX 4080 Super / D3D12 driver 32.0.16.1074 at the registered
3840x2160@60 Hz target. Environment, mandatory evidence, and all 24 budget checks passed
across three fresh/warm pairs. Every run returned 100,000/100,000 validated echoes with
zero payload and sequence errors from the fixed 8,224-byte pool. Cooperative end-to-end
rate was 45,132-46,708 round trips/s over 2,141-2,216 ms; maximum window pump duration
was 0.58-1.01 ms, and every gameplay measurement window recorded zero main-thread tasks
over 50 ms.

The during-spike render-worker callback maximum was 133.29-166.72 ms even though the
corresponding render/submit maximum was only 2.73-2.92 ms. This does **not** establish
SAB-caused frame impact: the app starts the spike immediately after its first frame, while
`smoke@1` performs the privileged `chrome://gpu` refresh-rate probe before its 10-second
warm-up. RE-001 already measures that probe producing 166.6-216.6 ms launch callback
gaps. The retained SAB interval is therefore attribution-contaminated and remains a
workload-presence diagnostic only, not presentation evidence or a hitch-free claim. After
warm-up, callback maxima were 16.78-17.07 ms with p95 16.72-16.80 ms, but the spike had
already completed, so those values likewise do not establish active-transport impact.

**Consequences:** The paired SPSC abstraction is now the substrate for later input,
streaming-queue, and sim-to-render channels. MPMC needs are represented as multiple
owned SPSC lanes or get a separately measured design; this primitive does not silently
grow into a contended multi-producer queue. The M0 plan item was held open until a
registered physical-console `smoke@1` run proved mandatory SAB evidence across all
fresh/warm repeats without regressing the existing environment, evidence, or budget
facets. The retained result above satisfies that gate, so the M0 SAB spike is a **go**
for transport correctness, fixed-pool behavior, and cooperative main-thread scheduling.
It is not a raw-bandwidth result or proof of hitch-free active transport.

Worker-side spike failures use a dedicated control-plane response and transition SAB
telemetry to `failed`; they do not masquerade as render-worker failures or tear down a
render service that remains healthy.

**Reopen if:** a real channel requires variable-width records or unavoidable multiple
producers/consumers, measured atomic payload access is a bottleneck, sequence-wrap
testing fails under a browser worker, or a controlled active-transport measurement
without RE-001's privileged-diagnostics overlap shows unacceptable frame/main-thread
impact.

## D-056: Keep Babylon WebGPU rendering in the dedicated render worker  (2026-07-15, accepted)

**Decision:** The M0 WebGPU-in-worker spike is a **go**. Parallax keeps the D-005
topology: Babylon.js owns the scene in a dedicated module worker, creates its WebGPU
device there, and renders to an `OffscreenCanvas` transferred from the window. This is
evidence for the rendering core exercised by the walking skeleton, not a claim that
every Babylon subsystem is worker-safe. DOM-bound input, GUI, accessibility, and future
asset-loader paths must cross the engine's explicit protocols or be re-verified when
introduced; they do not move Babylon rendering back to the window implicitly.

The accepted main-thread boundary is narrow and observable: the app shell creates the
worker, transfers the canvas, forwards device-pixel resizes, receives 60-frame telemetry
batches, and updates boot/status UI. Babylon/WebGPU scene construction, frame scheduling,
animation, render submission, and their JavaScript heap remain in the dedicated worker.
These orchestration messages are not treated as a zero-work claim: the budget remains
zero main-thread tasks longer than 50 ms during gameplay.

**Context:** The controlled evidence is retained physical-console result
`smoke-1-56bc808071f1-dev-01-showcase-2026-07-15T15-00-29-040Z.json`: schema v17,
mandatory metric-set v4, exact CfT Stable 150.0.7871.115 (revision 1639810 and executable
SHA-256 pinned), Windows 26200.8875, RTX 4080 Super / D3D12 driver 32.0.16.1074, and the
registered 3840x2160@60 Hz target. The result's source identity and artifact digest tie it
to the exact build; its engine manifest and lockfile pin Babylon.js 9.16.1. Windows
observed the display at 3840x2160/59 Hz, Chrome reported 60 Hz, and the 3841x2161 render
surface passed the descriptor's explicit +/-2-pixel tolerance (RE-003). Its three fresh
and three warm launches passed environment, evidence, and all 24 budget checks. Across
those six launches:

- worker callback-interval p95 was 16.740-16.860 ms and worker render/submit CPU p95 was
  0.480-0.610 ms (callback pacing is a heuristic, not presentation proof per D-051);
- worker-local initialization to first frame was 78.905-85.460 ms; and
- the main thread recorded zero tasks over 50 ms in every measurement window.

The harness did not infer placement from those timings. Its all-realm heap probe required
the browser context to contain exactly the app page and the manifest-declared render-worker
target, attached to both isolates, and retained separately attributed window and
dedicated-worker samples. The first-frame telemetry could therefore arrive only after
Babylon's worker-owned `WebGPUEngine` initialized and submitted the walking-skeleton scene.
The assembled build keeps Babylon imports in the separately built worker artifact; the
window-side render service imports only the worker protocol and owns orchestration.

Current platform documentation agrees with the measured path: MDN's `WorkerNavigator.gpu`
page documents WebGPU as a worker entry point, and Babylon's current `WebGPUEngine`
constructor accepts `HTMLCanvasElement | OffscreenCanvas` (checked 2026-07-15:
`developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu` and
`doc.babylonjs.com/typedoc/classes/BABYLON.WebGPUEngine`). The local result is the deciding
evidence; the documentation is corroboration.

**Consequences:** D-005 stays accepted, architecture.md's M0 open question is closed,
and the worker topology remains the basis for the SAB and later streaming spikes. No new
Chrome rough edge was found in this tested slice. M1 still owns long-run device-loss and
restart handling, and each newly adopted DOM-sensitive Babylon feature must demonstrate a
worker-safe path rather than silently escaping to the main thread.

**Reopen if:** representative M1 content or a required Babylon subsystem cannot run behind
the worker boundary, a pinned-Chrome run produces main-thread long tasks attributable to
rendering, or worker/device-loss behavior makes the topology unreliable over flythrough-
length sessions.

## D-055: Transition-contract prefetch trigger is defined at M4, not before  (2026-07-15, accepted)

**Decision:** The inter-district transition contract in budgets.md deliberately omits
its **prefetch trigger** element (when a transition preload must start, per entrance)
until M4. Defining it is an explicit M4 task: calibrate from greybox transition
measurements, add the element to budgets.md through the normal decision process, and
only then evaluate the M4 exit ("no contract violations") against the completed
contract — the exit cannot be declared against a contract that still lacks the element.

**Context:** architecture.md promised a prefetch trigger "in budgets.md" that budgets.md
never defined — an unverifiable contract element a 2026-07-15 review flagged. Inventing
a threshold now would violate root rule 3 (measure, don't assert): the honest trigger
depends on cell sizes, OPFS read throughput, and traversal speeds that only exist once
M4 greybox content and the M1 streaming path are measurable. plan.md M4 carries the
calibration task and the qualified exit criterion.

**Consequences:** Until M4, the enforced transition contract is: overlap memory peak
(≤ 1.25× steady-state GPU budget), max hitch (≤ 100 ms), total swap (≤ 4 s), proactive
eviction only — all per entrance. The prefetch trigger is the one deferred element.

**Reopen if:** M1 streaming measurements already force a prefetch policy (then define it
early through a decision), or M4 measurements show a per-entrance trigger is the wrong
shape (e.g., it belongs to the streaming manager's budget governor instead).

## D-054: Harness measurement-soundness fixes — schema v17, metric-set v4  (2026-07-15, accepted)

**Decision:** A holistic multi-agent review of the completed Harness v1 found and fixed
several measurement-soundness defects; the result contract advances to **schema v17**
and **mandatory metric-set v4**. The changes:

1. **Deterministic frame window.** Frame statistics previously came from
   `recentFrames.slice(-120)` on a snapshot read *after* the end marker, so the analyzed
   span slid with CDP latency and differed from the trace-marker window used by the
   blocking pipeline/shader checks. The harness now selects exactly frames
   `(start, start+120]` by index (`harness/src/frame-window.ts`, unit-tested); engine
   telemetry retention widens from 120 to 240 recent frames (amends D-029; telemetry
   schema shape and version unchanged) so the window survives snapshot latency, and
   eviction of any in-window frame is a loud measurement-invalid error. Because
   frameCount publishes only per 60-frame batch (`TELEMETRY_FRAME_BATCH_FRAMES`, now an
   exported telemetry-contract constant), the start marker is placed *before* the
   telemetry read and the window begins one full batch after the observed count — every
   counted frame is provably rendered inside the trace-marker window, so pipeline
   activity on counted frames cannot escape the marker-windowed trace gates.
2. **Long-task counter drains pending records.** The injected observer's `count()` now
   folds `takeRecords()` into the total, closing a false-pass window on the zero-limit
   blocking `mainThreadLongTasksOver50Ms` budget (a >50 ms task ending just before the
   read could previously go uncounted).
3. **A core-run failure still produces artifacts.** One failed launch previously aborted
   the process with no JSON/markdown result, discarding completed runs (violating
   harness rules 2/5). Failures are now captured as top-level `coreRunFailure`, the V8
   diagnostic phase is skipped with the reason recorded, and a **mandatory** "core
   measurement run completion" evidence check fails the evidence facet — report written,
   exit code still 1.
4. **Mandatory-metric registry is the single source of truth.** Callback-pacing variance
   was enforced as mandatory but absent from the declared registry; it is now registered,
   and every evidence-check mandatory flag is derived from the registry by name (loud
   failure on an unregistered name). Metric-set v4 = v3 + render-worker callback-pacing
   variance (mandatory), core measurement run completion (mandatory), HTTP serving
   evidence (non-mandatory).
5. **HTTP serving evidence is evaluated and reported** (informational only). The local
   server's metrics endpoint advances to **schema v2** (amends D-028) with per-path-class
   status and byte counters — the v1 aggregate counters could not prove the claims (an
   unrelated 304 could satisfy the document-revalidation check; document bytes could
   satisfy the immutable-body check). Checks: fresh runs fetch every immutable artifact
   as a 200 with bytes; warm runs reach the server with zero immutable requests and at
   least one document request, all revalidated 304 (zero observed documents is a failed
   observation, not a pass); ≥400 statuses flagged. Calibrated against the retained
   passing results; nothing enters the budget facet.
6. **Late page errors fail the run.** Errors raised between the in-window check and the
   JS-heap window (trace end, memory dump, histogram probes) were previously dropped
   silently; they now fail the run through the core-run-failure path (artifacts still
   written, exit code 1), upholding the README/D-031 fail-on-browser-error contract.
   Errors during the JS-heap window itself continue to invalidate only that metric
   (D-047), unchanged.
7. **Run-scoped server metrics.** The before/after server-metric snapshots now bracket
   launch and full context close, so late requests can't bleed into the next run's delta.
8. **Bounded variance values, full repeats required.** `relativeP95Range` is `null`
   (with an explicit reason) instead of `Infinity` when the minimum repeat p95 is 0, so
   JSON and report agree. Variance verdicts also require the full `SMOKE_REPEATS`
   sample count: fewer completed repeats (e.g., after a captured core-run failure) is
   `invalid`, never `measured` — a single run's zero range is not evidence of
   stability.
9. **Served tree must match the manifest.** Manifest validation fails on files present
   in the served dist tree but not listed (allowlist: `build-manifest.json`), so the
   artifact digest cannot silently stamp unlisted bytes.
10. **Repeatability gate covers shipped bytes.** `verify:repeatable` now hashes the
    actual `engine/dist` artifacts the assembler consumes and compares them against one
    independent temp-dir rebuild (previously two throwaway builds whose digests were
    never tied to the shipped artifact) — one fewer build per `pnpm check`, same-host
    level-1 scope per D-020 unchanged. The dirty-tree diff digest is also pinned against
    user git config (`--no-color --no-ext-diff --no-renames --diff-algorithm=myers`,
    neutralized attribute and order files — an empty `diff.orderfile=` is fatal on
    Windows git, so the documented `/dev/null` cancellation value is used; determinism
    verified byte-identical under renames/orderfile/attributesfile config toggles in a
    fixture repo).

**Context:** Found by the 2026-07-15 tech-lead review (six-agent fan-out plus adversarial
challenge, findings verified against code and the retained result JSONs). Items 1–3 were
false-pass or lost-evidence paths inside the checked Harness v1 deliverable; the rest are
declared-surface vs. implementation gaps. Engine-side robustness landed in the same
change: `onmessageerror` handling, per-listener telemetry-publish isolation covering
the initial subscribe delivery too (the D-029 surface is externally consumed), received
frame samples re-frozen at the main-thread boundary (structured clone strips the
worker-side freeze), an explicit failed-is-terminal M0 comment (M1 owns device-loss
recovery — plan.md M1 item), and `engineStrict: true` in `pnpm-workspace.yaml` so the
D-020 Node pin hard-fails on mismatch (a root `.npmrc` `engine-strict` flag is ignored
by pnpm 11 — verified via `pnpm config get` before and after).

**Consequences:** `pnpm check` green (134 unit tests, up from 106; lint clean; shipped
engine bytes verified). No numeric threshold changed; the only informational signal
promoted to blocking is late browser errors (item 6), which restores an already
documented contract. The next dev-01 physical-console `smoke@1` run will emit schema
v17 and is not directly comparable to v16 results on window placement (the frame window
no longer slides), which is a correctness fix, not a regression.

**Reopen if:** telemetry gains per-frame identity/timestamps (making index-based
selection unnecessary), M1 promotes presentation gating (revisit what the frame window
gates), or HTTP evidence proves stable enough to graduate from informational to a
mandatory evidence check.

## D-053: Repository license is Apache-2.0  (2026-07-15, accepted)

**Decision:** The whole repository — code, harness, docs, and generated assets that land
in-tree — is licensed **Apache License 2.0**. The root `LICENSE` file is authoritative;
every `package.json` declares `"license": "Apache-2.0"`, and the README states it. New
packages and the M2+ public game/site deliverables inherit this unless a future decision
says otherwise.

**Context:** The repo has shipped with an Apache-2.0 `LICENSE` since the initial
scaffold, but no decision recorded the choice and no manifest declared it. The license
choice is load-bearing for D-010's Cross-Origin Storage story: shared engine bundles are
consumed (and at level 3, *not* rebuilt) by other publishers, so a permissive license
with an explicit patent grant is the deliberate pick over MIT (no patent grant) or a
copyleft license (would encumber consumers of shared artifacts). Confirmed by the
project owner 2026-07-15.

**Consequences:** `license` fields added to all five package manifests; README notes the
license. Third-party code brought into the tree must be Apache-2.0-compatible.

**Reopen if:** the COS sharing model or a publication decision requires different terms
for some artifact class (e.g., game content vs. engine code).

## D-052: TypeScript 7 (native compiler) is the pinned type toolchain  (2026-07-15, accepted)

**Decision:** The repository pins TypeScript **7.0.2** — the natively-compiled compiler
("tsgo" lineage) — as the type-checking and build toolchain, continuing D-014/D-020's
strict-mode + project-references setup unchanged.

**Context:** D-014 chose "TypeScript strict with project references" in the 5.x era; the
7.x native compiler is a materially different toolchain component (different binary,
different performance characteristics), and it was adopted during M0 without a log
entry — exactly the silent-drift root rule 1 exists to prevent. Recording it
retroactively: the pin has been in `package.json` through the completed Harness v1 work,
`pnpm check` (build, lint, 106 unit tests, engine repeatability gate) is green on it
(verified locally 2026-07-15), and no compiler-attributable issue has surfaced.

**Consequences:** Version selection stays under D-020's exact-pin policy; this entry
exists so the 5.x→7.x toolchain-generation jump is a recorded choice, not drift. The
engine repeatability gate already covers the compiler's contribution to artifact bytes.

**Reopen if:** tsc-native behavior ever affects build determinism or emits differently
across hosts (relevant to D-020 level 2), or a project-references/strict-mode regression
forces a downgrade.

## D-051: Harness-v1 presentation and V8 gaps are informational, not M0 gates  (2026-07-14, accepted; result schema and mandatory metric-set advanced to v17/v4 by D-054)

**Decision:** `smoke@1` mandatory metric-set v3 makes the authoritative compositor-presentation
metric and V8 JavaScript code-cache lifecycle explicitly informational for Harness v1. Their
probes, metric states, raw evidence, repeat contracts, and expected-zero rejection/re-production
diagnostic checks remain intact. Missing, untrustworthy, or negative lifecycle evidence is
emitted in result schema v16's
`informationalFailures` list and in the detailed Markdown sections, but does not affect the
evidence-completeness facet, budget-evaluation facet, aggregate `passed` bit, or process exit
code. V8's former zero-rejection and zero-warm-reproduction budget checks are renamed diagnostic
checks and remain attached to each V8 run; they no longer enter the blocking budget facet.
An auxiliary V8 launch/navigation/telemetry/trace failure is converted into a structured invalid
diagnostic run so it cannot suppress the blocking core report or change the exit code.

This is an M0 scope decision, not a claim that the underlying budgets are satisfied. M1 must
revisit authoritative presentation gating before using the flythrough for player-visible frame
budget claims, and M2 must implement the complete launch/update performance gate when cache
preservation becomes milestone scope. The current signals may be used only as heuristics: render-worker callback
pacing and Viz feedback-callback cadence for presentation behavior; and URL-attributed
production, absence of warm re-production, compile spans, HTTP cache behavior, and worker-startup
timing for V8 behavior. Reports must not relabel those heuristics as successful scan-out or code-
cache consumption. Cache behavior is best-effort: a rejection matters to the gate only when it
causes a user-visible launch/update performance budget to fail. The existing ≤10 s warm-launch
budget remains authoritative; M0's worker-startup timer is only a component diagnostic, while M2
owns the complete in-app launch measurement and asset-only-update comparison. The former
“asset-only update never invalidates V8 code caches” mechanism target is replaced by a
performance contract: post-update warm launch must remain within the existing 10 s ceiling and
record its paired delta from the pre-update warm launch. M2 measurements calibrate any relative-
regression threshold through a new decision rather than inventing one before the lifecycle exists.

**Context:** Chrome 150 exposes regular, page-windowed `Display::FrameDisplayed` callback
timestamps but omits the `PresentationFeedback.kFailure` flag needed to prove successful scan-out
(RE-006). Its ES-module trace path also omits authoritative cache-consumption results, and the
render-worker module exposes no URL-attributed production result (RE-009/RE-010). The maintained
diagnostics already capture the best available signals and bound the current walking-skeleton
cost: warm worker startup normally measured about 144–157 ms against the provisional 10 s launch
budget, while app/engine launch 3 emitted no observed cache re-production. Keeping Harness v1
permanently red cannot create the missing Chrome evidence and obscures regressions in the metrics
the platform does expose. The project therefore accepts visible, non-blocking platform findings
as the correct M0 outcome and gates the eventual cache outcome on performance rather than an
internal mechanism.

**Sources checked (2026-07-14):** local pinned-CfT 150.0.7871.115 remote diagnostics and the
schema-v16 physical-console `smoke@1` run on dev-01; current Chromium
[`Display::DidReceivePresentationFeedback`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/viz/service/display/display.cc),
Blink
[`v8_script_runner.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc),
and the detailed source/reproduction records in RE-006, RE-009, and RE-010.

Mandatory gates remain unchanged for registered physical-console environment identity,
render-worker callback-pacing variance, all-realm JS heap, Dawn pipeline/cache evidence,
main-thread long tasks, and runtime pipeline/shader compilation. Attributable GPU memory remains
the pre-existing non-mandatory `unsupported` metric from D-050. No numeric performance threshold
is changed. The V8 zero-artifact targets are deliberately reclassified from budgets to expected
diagnostic outcomes, so the harness rule that every actual budget bust fails remains intact.

The Chrome-side requests exposed by these and other findings are synthesized in
[chrome-platform-gaps.md](chrome-platform-gaps.md); [rough-edges.md](rough-edges.md) remains the
evidence and reproduction source of truth.

**Consequences:** Harness v1 can complete on a verified physical-console run when all remaining
M0 gates pass, while the report still calls out every compositor/V8 informational failure. Result
consumers gain a stable top-level list instead of having to infer non-blocking problems from deep
diagnostic structures. D-031/D-035 and D-037–D-045 remain historical rationale but are superseded
where they require these two metrics to block Harness v1.

**Reopen if:** Chrome exposes trustworthy page-correlated presentation success or per-artifact
V8 cache lifecycle outcomes; M1 promotes presentation or M2 defines a stronger cache-performance
contract; the heuristics stop correlating with
the intended behavior; or informational failures become too noisy to be actionable.

## D-050: Retain GPU-process memory dumps without treating them as page VRAM  (2026-07-14, accepted)
**Decision:** `smoke@1` now requests one background global memory dump after its primary gameplay
window and retains the GPU-process allocator inventory, request GUID/duration, exported dump
name/ID, and any Dawn/WebGPU-named allocator paths. The Harness-v1 `attributable GPU memory`
probe is implemented but reports `unsupported`: its evidence is diagnostic and produces no GPU
envelope budget check. Result schema advances from v14 to v15. The metric remains non-mandatory
for M0, so an honest platform `unsupported` result is visible without making the already
fail-closed compositor/V8 evidence state more restrictive.
The top-level metric contract remains provider-neutral and supports all four metric states;
Chrome's CDP/memory-infra request and inventory live in a named, optional provider diagnostic, so
a future non-Chrome benchmark does not need to fabricate Chrome fields.

**Context:** Chrome for Testing 150.0.7871.115 on dev-01 successfully accepted the dump request in
all six core launches, but the walking skeleton's GPU-process dumps exposed no allocator covering
the web-created WebGPU device's buffers or textures. A controlled single-launch detailed dump
showed WebGPU shader-cache and shared-image plumbing, proving that the GPU process and active
WebGPU workload were present, while still exposing no page-device resource total (RE-014). Chromium's
current `gpu/dawn` memory-dump provider calls Dawn's estimated resource-size API for a
`DawnSharedContext`; the web WebGPU decoder owns a separate set of wire-server devices and has no
corresponding memory-dump provider. Even if `gpu/dawn` were present, Dawn's estimate is live
logical buffer/texture bytes, not page-attributed resident VRAM or transient allocator pressure,
so it could not honestly gate budgets.md's resident GPU envelope.

The same experiment found that CDP returned request GUID `0x2`/`0x3`, while JSON trace export
labeled the sole allocator-bearing dump `periodic_interval` with ID `0x0`. The harness therefore
requires exactly one allocator-bearing GPU-process dump and retains both identities rather than
claiming GUID equality that Chrome does not provide (RE-015).

**Sources checked (2026-07-14):** pinned local Chrome runtime traces; CDP
[Tracing.requestMemoryDump](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/);
Chromium's current
[graphics-memory metrics guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/memory/graphics_metrics.md),
[GPU memory tracing guide](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/memory-infra/probe-gpu.md),
[`DawnSharedContext` memory-dump implementation](https://chromium.googlesource.com/chromium/src/gpu/+/bf2b35ebcf902cda172ffaa4faffca8affc539f7/command_buffer/service/dawn_context_provider.cc),
and current Chromium
[`webgpu_decoder_impl.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/command_buffer/service/webgpu_decoder_impl.cc)
device ownership; pinned Chrome 150.0.7871.115
[`DEPS`](https://chromium.googlesource.com/chromium/src/+/25f5b661e5b08141ec24b17d1ce96c5ceb5828da/DEPS)
mapping to Dawn revision `01249a97332468dbdd6cf5edb8dd7bae77875de5`; and that exact Dawn
[`DeviceBase::ComputeEstimatedMemoryUsage`](https://dawn.googlesource.com/dawn/+/01249a97332468dbdd6cf5edb8dd7bae77875de5/src/dawn/native/Device.cpp)
implementation, which sums texture estimated byte sizes and buffer allocated sizes.

**Consequences:** Harness results distinguish three facts that were previously easy to conflate:
Chrome accepted a GPU-process dump, Chrome exposed some GPU-process allocator data, and Chrome did
not expose page-attributed resident WebGPU memory. Adding memory-infra to the core trace also makes
its event/byte/drain cost visible in the existing trace diagnostics. A future Chrome allocator or
WebGPU API can promote this metric only after a controlled allocation test proves its scope,
residency semantics, attribution, and cross-backend behavior; merely finding a byte counter is not
enough.

**Reopen if:** WebGPU exposes memory budgets/usage, Chrome adds per-web-device memory-infra
allocators with documented semantics, or OS/ETW tooling can attribute resident allocations to the
page's WebGPU device across the D3D12 and Metal reference backends.

## D-049: Task-sized work units; AI-led multi-agent review  (2026-07-14, accepted)
**Decision:** Two linked amendments to the D-026/D-027 operating models. (1) The
tech-lead unit of work grows from a commit-sized slice to a **full plan.md task** by
default — a full milestone when its tasks are tightly coupled. Work is no longer
fragmented to fit a human line-by-line reader. (2) The human gate is restated to match
how it actually operates: the human manages agents, makes architecture decisions,
guides reviews, gives feedback, and scans changes and results — delegating most
line-level reviewing to AI. To hold review quality at the larger unit size, reviewer
mode becomes **multi-agent**: the reviewing agent acts as review lead — partitioning
the diff into subagent-sized pieces (the lead judges what is bite-sized), spawning
parallel read-only reviewer subagents, merging/deduplicating their findings and
verifying each one itself, then spawning an adversarial challenge subagent briefed to
refute weak findings and hunt for cross-piece misses before the final report. The
tech-lead pre-handoff adversarial review uses the same structure for
task-sized-or-larger diffs. The human commit gate itself is unchanged (root rule 8:
agents never commit).

**Context:** M0 Harness v1 ran for seven commit-sized chunks without completing, each
chunk paying a full review-loop round trip (review → fix-pass → verify-pass → human
gate). The small iterations surfaced real issues, but the human's judgment is that
comparable issues would have surfaced in larger reviews with far fewer interruptions —
and the premise behind commit-sized slices ("one coherent unit the human can review
and commit") no longer holds, because the human is not reading every line before
commit.

**Consequences:** workflow.md's loop, tech-lead mode, and reviewer mode sections are
updated. D-026 and D-027 remain in force except where amended here (unit sizing;
single-context review). Individual review passes cost more (subagent fan-out) but run
far less often. Fix-pass and verify-pass modes (D-030) are unchanged; they operate on
the larger units' findings. Uncommitted working-tree state now lives longer between
commits, raising the stakes on the existing one-stream-of-work and serial-writers
rules.

**Reopen if:** larger units measurably let defects slip through that small-slice
reviews would have caught, long-lived uncommitted trees prove fragile in practice
(lost work, unexplainable state), or the adversarial challenge pass consistently finds
nothing and becomes ceremony.

## D-048: Declare runtime worker entrypoints semantically in build-manifest v2  (2026-07-14, accepted; manifest format advanced to v3 by D-058)
**Decision:** build-manifest schema v2 adds `workerEntrypoints`, whose records name the artifact
path, target type, and runtime role. The walking skeleton declares its one dedicated `worker`
entrypoint with role `render`; harness code consumes that declaration instead of inferring engine
ownership from a `render-worker-*` filename prefix. Manifest validation requires every entrypoint
to name a hashed artifact in the same manifest.

**Context:** the JS-heap gate must compare observed worker targets with a declared runtime topology
without depending on `engine/` bundler naming. Artifact paths and hashes alone do not express which
files create target realms. A semantic entrypoint list is also the place to enumerate planned
decode, streaming, simulation, shared, and service workers as they become launch-required.

**Consequences:** renaming a worker artifact no longer changes harness discovery. The current heap
collector scopes discovery to the app page's browser-context ID and requires its observed target
set to equal the declared page-plus-render-worker topology both before and after sampling. The
page target ID and browser-context ID come directly from that page's CDP session, so another
browser context visiting the same URL cannot be mistaken for the app. Any
additional target—including dedicated/shared/service workers, worklets, OOPIFs, `other`, or future
target types—invalidates the metric instead of being silently omitted. Expanding the topology
requires expanding the manifest role vocabulary and collector aggregation in the same change. The
build-manifest format advances from v1 to v2; this is an explicit contract change, not a silent
filename convention.

**Reopen if:** runtime telemetry can provide a cryptographically tied worker-realm registry that is
more authoritative than the assembled build manifest, or workers are created dynamically from
non-artifact URLs that require a different declaration model.

## D-047: Gate JS used heap as a fixed-deadline cross-isolate estimate  (2026-07-14, accepted)
**Decision:** `smoke@1` replaces its renderer-page-only `Performance.getMetrics`
snapshot with a 100 ms sampler in a dedicated post-trace steady-state window over both current
JavaScript isolates: the
window and the exact immutable render-worker target named by the validated build manifest. Each
sample issues near-concurrent `Runtime.getHeapUsage` requests for both targets. The tier budget
gates the maximum observed sum of `usedSize`; the report retains every isolate's `usedSize`,
`totalSize`, `embedderHeapUsedSize`, and `backingStorageSize`, plus per-realm CDP
response-completion timing,
collection duration, deadline, and start delay. Missing, duplicate, detached, malformed, or
cadence-invalid worker evidence makes this mandatory Harness-v1 metric `invalid` rather than
silently falling back to the window. Cadence-invalid results retain their collected evidence and
reason; experimental diagnostic fields are nullable when Chrome omits them. The mandatory metric
set advances to v2.

`usedSize` is V8 heap occupancy, including unreachable objects awaiting garbage collection; it is
therefore GC-phase-sensitive and is not a retained-live-data measurement. Chrome does not expose a
continuous live-retention high-water counter (RE-012), so "high-water" in this gate means the
largest observed 100 ms used-heap estimate, now stated explicitly in budgets.md. The two CDP
requests are not atomic: the estimate can miss a shorter-lived peak or combine values that did not
coexist. It is neither a guaranteed lower nor upper bound on exact peak residency.

**Context:** CDP defines `Runtime.getHeapUsage` as total usage of the corresponding V8 isolate,
not a value scoped to one execution context. The old `Performance.getMetrics` call therefore
measured only the page session even though 99.84% of decoded JavaScript runs in the dedicated
render worker. A single end snapshot also did not implement budgets.md's high-water definition.
Summing each realm's independent maximum would create an even less time-correlated result, so
aggregation happens per near-concurrent sample before selecting the maximum. `usedSize` alone maps
to the JS-heap sub-budget;
embedder and backing-store bytes remain diagnostics for later CPU-envelope accounting and are not
double-counted here. Result schema advances from v12 to v14: v13 introduced per-sample heap
evidence, and v14 retains that evidence on the invalid metric variant.
The enforced Standard and Showcase ceilings are exactly 2 × 1024³ and 4 × 1024³ bytes; budgets.md
uses GiB so the documented units and byte comparisons cannot drift.

Playwright exposes page and browser CDP sessions but no public child-target session constructor.
The pinned implementation therefore attaches the exact worker target and uses CDP's nested-session
message path inside one small collector. That transport is explicitly contained because CDP marks
`Target.sendMessageToTarget` deprecated in favor of flat session routing, which Playwright's public
`CDPSession.send` surface does not expose.

**Sources checked (2026-07-14):** Chrome DevTools Protocol tip-of-tree `Runtime.getHeapUsage`
(`chromedevtools.github.io/devtools-protocol/tot/Runtime/`) and Target domain
(`chromedevtools.github.io/devtools-protocol/tot/Target/`),
[HeapProfiler domain](https://chromedevtools.github.io/devtools-protocol/tot/HeapProfiler/), and
[Memory domain](https://chromedevtools.github.io/devtools-protocol/tot/Memory/); pinned local
`playwright-core@1.61.1` type declarations for `CDPSession` and `newBrowserCDPSession`; current
[V8 inspector implementation](https://chromium.googlesource.com/v8/v8/+/b339cf019df6e238d0bf5e970e513e941dc6d563/src/inspector/v8-runtime-agent-impl.cc),
which maps `usedSize` to `v8::HeapStatistics::used_heap_size()`.

**Consequences:** the all-worker JS-heap registry entry is implemented, mandatory, and measured
failures can bust the Standard 2 GiB or Showcase 4 GiB limit. Sampling uses fixed start deadlines;
it skips rather than overlaps an overrun, then invalidates any deadline due through the periodic
sampling boundary that lacks a sample. Response-completion skew, sampling start delay, or
collection duration at least as large as the 100 ms interval also invalidates the metric.
The forced measurement-end sample substitutes for the latest deadline at the boundary; any
earlier missing deadline still invalidates the metric. Sampling runs only after trace and primary
frame/Dawn/presentation evidence collection so the CDP requests cannot perturb those zero-tolerance
gates. Realm response-completion skew is Node-side CDP arrival skew only; it is a transport-health
diagnostic and cannot prove or bound V8 read-time simultaneity. The current exact app-context
target-set assertion rejects every unexpected isolate-bearing or unknown target type and is a
walking-skeleton contract, not a permanent topology assumption: when streaming/decode/sim workers
land, the build/run contract must enumerate every required worker target and this metric must sum
all of them. Sampling cost and non-atomic response timing are visible in each result. A
pinned-Chrome remote diagnostic on 2026-07-14 measured both realms in the dedicated post-trace
window across all six core launches: 28 samples per launch, 8.28–12.04 MB aggregate observed
peaks, 13.2–15.7 ms maximum fixed-deadline start delay, 0.0 ms maximum response-completion skew at
report precision, and 1.1–16.2 ms slowest collection. Every launch returned measured cadence evidence and no
heap budget bust. The environment remained invalid under RDP, as required; this validates the
collector integration, not a promoted gate baseline or exact live-retention coverage.

Browser errors raised only during the dedicated heap workload invalidate the heap metric while
retaining any samples already collected; they do not abort report generation or discard the
completed primary trace/frame evidence. CDP session creation, commands, responses, and teardown
are all timeout-bounded, and partial setup detaches any session already acquired.

The required nested-session transport is itself a platform/tooling exposure (RE-013). The pinned
Chrome executable/digest plus mandatory runtime smoke is the version tripwire: a Chrome update that
removes non-flat routing produces explicit invalid evidence and cannot be promoted silently.

**Reopen if:** CDP exposes an aggregate origin/page memory counter with per-isolate attribution,
Playwright exposes flat child sessions, sampling cost affects the measured workload, or the M0 SAB
and wasm spikes require separating backing stores/linear memories from the JS-heap sub-budget.

## D-046: Engine choice re-grounded against Unity 6.5; two D-004/D-005 claims corrected  (2026-07-14, accepted; comparison remains current, while D-004's classic-Babylon component was superseded by D-078; evidence folded into rendering-engine-research.md by D-076)
**Decision:** D-004 stands — TypeScript + Babylon.js, WebGPU-only. Its supporting technology
claims are re-verified against **Unity 6.5 (6000.5)**, the current release, and two of them are
corrected. The sourced differentiator list now lives in
why-not-unity.md (since folded into rendering-engine-research.md by D-076), which at the
time was the canonical artifact for defending the engine
choice; this entry records what changed and why the verdict didn't.
**Context — two corrections, both against us:**
1. **D-005's "No popular engine ships real multithreading on the web today" is wrong as
   written.** Unity 6.4 shipped official Web support for Burst-compiled C# jobs and native
   C/C++ engine threads. The accurate claim is narrower and still decisive: *managed* C#
   threads remain unsupported ("due to the lack of a multithreaded garbage collection feature
   in WebAssembly"), gameplay C# is main-thread-only, and "you must schedule all jobs from the
   main thread." Never assert that Unity is single-threaded on the web — it isn't, and the
   overstatement is trivially refuted.
2. **A WebGPU-limitations argument was raised and withdrawn.** Several headline items on Unity's
   WebGPU-limitations page — no async compute, r32-only read-write storage textures, no
   synchronous readback, no `RWBuffer`, no Int64, uniform-control-flow barriers — are **WebGPU
   spec limits, not Unity gaps**. They bind Parallax exactly as hard. Citing them against Unity
   is a self-own, and the related claim that they "gut GPU-driven culling" is false (culling
   needs compute, storage buffers, atomics, and indirect draw; WebGPU has all four). The
   single-queue/no-async-compute gap is a *platform* finding and is logged as RE-011.
**Context — claims that hardened:** D-004's "unconfirmed wasm64" is now confirmed adverse — the
Unity heap tops out at 4 GB (wasm32), with no Memory64 support and no roadmap commitment.
Unity's WebGPU backend is still labelled Experimental in 6.5 (continuously so since 6.1).
Two new structural gaps were established: Unity Web storage is IndexedDB (`persistentDataPath`
→ `/idbfs/<hash>`; Unity's `Caching` API unsupported on Web; OPFS absent from all 75 Web-section
manual pages; the `.jslib` escape hatch is ES5-only while `createSyncAccessHandle` is
worker-only) — directly against D-003 — and Unity documents **no GPU-timing path on Web** (GPU
Usage Profiler: "Web | All WebGL | Not supported"; FrameTimingManager: "no GPU time is
provided"), which is disqualifying for a project whose harness is a first-class deliverable.
Unity exposes neither WebGPU subgroups (Chrome 134) nor `shader-f16` (Chrome 120).
**Sources checked (2026-07-14):** Unity 6.5 manual + scripting reference (Web technical
limitations, Burst web multithreading, Web memory, Web caching, `Application.persistentDataPath`,
`Caching`, browser-JS interop, WebGPU + WebGPU-limitations, GPU Usage Profiler,
FrameTimingManager); Unity release/EOL data (6.4 EOL 2026-06-17); Chrome WebGPU release notes
(134 subgroups, 120 f16); gpuweb#1065 (multi-queue); Babylon `WebGPUEngineOptions` typedoc
(`requiredFeatures` includes `subgroups`, `shader-f16`, `timestamp-query`). Full URL list in
why-not-unity.md. Two claims rest on *absence* of documentation (Unity GPU timing on WebGPU
specifically; OPFS in the emitted runtime) and are flagged there for a local experiment to
settle — root rule 3 prefers a measurement over a doc search.
**Consequences:** why-not-unity.md is maintained alongside D-004 and re-verified before any
public use; D-004/D-005 status lines are annotated to point here. Any future "Unity can't do X"
claim gets checked against that doc's "Not on this list" section first.
**Reopen if:** Unity ships **all three** of Memory64/wasm64, managed C# threads (which requires
multithreaded GC in wasm), and a non-experimental WebGPU backend. Any one alone does not reopen
D-004; together they would.

## D-045: Split harness verdicts into environment, evidence, and budget facets  (2026-07-14, accepted; partially superseded by D-051 — the compositor-presentation and V8 lifecycle gaps are non-mandatory informational failures, no longer blocking Harness v1)

**Decision:** Result schema v12 exposes three independently named facets while retaining the
fail-closed aggregate `passed` bit:

- `environment` is `passed` only when the registered-machine gate identity is measured;
- `evidenceCompleteness` is `passed` only when every mandatory non-environment metric has
  trustworthy evidence; and
- `budgetEvaluation` is `passed` only when evidence is complete, at least one budget check ran,
  and every executed check passes; it is `failed` when any observed check busts its limit, and
  otherwise `not-evaluated` when mandatory evidence is incomplete or no checks ran.

The aggregate passes only when all three facets pass. An observed budget violation takes
precedence over `not-evaluated`, so partial evidence cannot hide a known regression; conversely,
passing the subset of checks that could execute never produces a green budget facet.

**Context:** Harness v1 intentionally fails on the known compositor-presentation and V8
code-cache observability gaps. The single aggregate bit correctly prevented false success but
could not distinguish a valid physical-console environment from complete evidence or an actual
threshold violation. That made a known evidence gap look the same as an invalid environment and
made the passing subset of `budgetChecks` easy for result consumers to misread as a complete
budget verdict.

**Consequences:** JSON and Markdown reports can now show environment validity, evidence coverage,
and evaluated budgets without weakening any gate. The Markdown failure list is derived from the
same facet reasons as the JSON contract. Schema consumers must move from v11 to v12; the top-level
`passed` field remains as the strict automation exit verdict.

**Reopen if:** a result needs per-metric budget eligibility rather than scenario-level mandatory
evidence, advisory/non-reference results require a fourth comparison-eligibility facet, or a
future result store replaces the aggregate bit with a richer state machine.

## D-044: Keep RE-008 causal attribution open after an active user-timing-only timeout  (2026-07-14, accepted; partially superseded by D-051 where it requires V8/presentation metrics to block Harness v1)

**Decision:** Do not attribute RE-008 to enabled GPU-process trace categories, payload volume,
or a particular process failing to acknowledge `Tracing.end`. Keep the maintained core trace
categories because Dawn and presentation evidence require them; a narrower category set is not
a completion workaround.

**Context:** A controlled pinned-CfT 150.0.7871.115 remote diagnostic kept the real app, render
worker, 4K target, 10 s warmup, 120-frame measurement, measured-page lifetime, browser-level
`ReportEvents` transport, and five-second completion bound unchanged, but traced only
`blink.user_timing`. Core traces completed 5/6. Fresh repeat 3 at ordinal 5 held the trace for
14,163.0 ms, acknowledged `Tracing.end` in 2.3 ms, then delivered zero events, zero chunks, and
no `Tracing.tracingComplete` before the 5,006.3 ms invalidation; ordinal 6 recovered. Successful
traces carried only 221–237 events / 34,744–36,798 serialized bytes and completed in
13.0–13.9 ms. All nine isolated short V8 traces completed.

Those unchanged V8 lineages also measured launch-2 worker startup at 148.7, 150.7, and
150.4 ms versus launch-3 at 145.3, 156.8, and 151.4 ms. Launch 3 was slower in two of three
lineages, directly rebutting a consistent launch-2 → launch-3 saving or a measured ≤5 ms V8
cache bound. The worker still emitted no production event on launch 2, and no controlled cache
toggle exists, so the earlier 789.5 ms launch-2 outlier is not evidence of cache serialization.

The result disproves enabled Dawn/presentation categories and multi-megabyte payload as
necessary conditions for the captured failure. It does not identify which browser participant
withheld completion: browser-level tracing may coordinate processes that emit no enabled events.
Together with D-043's 6/6 long blank-page controls, current evidence points to measured-page
activity or workload/process coordination interacting with a roughly 14 s trace, not lifetime,
category payload, or GPU-category emission alone.

**Sources checked (2026-07-14):** local temporary category-control run on dev-01 under RDP
(non-gating), report
`smoke-1-cb961cbc9d86-dev-01-showcase-2026-07-14T18-42-02-841Z.json`; maintained source was
restored after the predeclared timeout falsifier occurred.

**Consequences:** RE-008 remains fail-closed and its Chromium report must present the
user-timing-only failure alongside the core-category failures. The next discriminating
experiment needs a controlled active-workload toggle or traced-process completion visibility;
another category-removal arm cannot establish the responsible process. RE-010 remains an
observability finding with a modest measured warm worker-startup component, not a measured V8
cache-savings claim.

**Reopen if:** an active-workload toggle separates completion from page/process activity, CDP
exposes per-process trace-stop acknowledgement, or a pinned Chrome change removes the failure.

## D-043: Measure worker startup and trace recording lifetime without inferring causes  (2026-07-14, accepted; partially superseded by D-051 where it requires V8/presentation metrics to block Harness v1)

**Decision:** The isolated diagnostic advances to `v8-code-cache@5` and records the existing
public `workerStartupToFirstFrameMs` telemetry on fresh, produce, and warm launches. The timer
starts immediately before constructing the module worker and ends when its first-frame message
reaches the window, so it includes worker script startup plus render initialization and first
frame; it is a launch component, not the full launch metric and not a V8-only timer. Result
schema v11 also records trace recording lifetime from acknowledged `Tracing.start` through the
`Tracing.end` request for every core and V8 trace.

Neither diagnostic attributes a cause. A fresh/warm startup difference can include HTTP cache,
worker startup, V8, WebGPU/Babylon initialization, Dawn state, GPU scheduling, and first-frame
delivery. Recording lifetime is correlated with all activity accumulated during that interval;
it must be varied in a controlled arm before being blamed for RE-008.

**Context:** A local pinned-CfT 150.0.7871.115 run measured worker startup-to-first-frame at
191.4–204.8 ms fresh, 146.0–149.0 ms on launch 2, and 146.0–154.5 ms warm. The improvement is
already present on launch 2 even though the worker exposes no cache-production prerequisite, so
the launch-3 result cannot be assigned specifically to code-cache consumption. The warm worker
component is about 1.5% of the 10 s launch budget; it de-escalates RE-010's current launch-cost
risk without resolving its mandatory cache-evidence gap.

A second exact-tree run reproduced the fresh and warm bands at 182.4–206.5 ms and
144.2–150.3 ms. Its launch-2 samples were 152.4 ms, 152.9 ms, and one 789.5 ms outlier. That
outlier is retained rather than assigned to V8: this remote, non-gating timer covers the whole
worker-to-first-frame path, and no controlled cache toggle isolates the cause.

The two maintained runs measured core traces open for 13,190.5–14,187.3 ms and V8 traces
normally open for 288.9–387.9 ms; the launch-2 startup outlier extended one V8 recording to
944.8 ms. Each run lost one of six core traces while all nine V8 traces completed. A controlled
fresh-browser `about:blank` matrix then held traces for either 300 ms or 14,100 ms without page
activity. All arms completed 6/6: short core produced 24–29 events / 3,564–4,262 bytes, long core
80–89 events / 13,496–14,645 bytes, and long V8 43–52 events / 6,949–8,074 bytes. Successful
long-arm drains completed in 8.6–20.0 ms. The maintained active core traces at the same lifetime
carried roughly 24,500–25,000 events / 3.9–4.0 MB. Trace lifetime alone therefore does not
reproduce RE-008; page activity and the resulting event/process/volume regime remain in scope.

**Sources checked (2026-07-14):** local render-service timer boundary, pinned CfT
150.0.7871.115 `v8-code-cache@5`/schema-v11 runs, and the three-arm local CDP experiment above on
dev-01 under RDP (all non-gating). Current V8 documentation confirms that post-execution code
caches can contain functions compiled lazily during execution, but does not make either Parallax
timer an authoritative cache result
([V8 code-caching documentation](https://v8.dev/blog/improved-code-caching)).

**Consequences:** Parallax measures the end-to-end worker-startup component it already waited for
and knows the actual recording lifetime of every trace. RE-010 no longer carries an unmeasured
dominant-launch-cost implication, and RE-008 investigation shifts from duration alone toward the
active-page event/process/volume regime. Neither cache nor trace gates are weakened.

**Reopen if:** worker startup becomes a calibrated launch sub-budget, a controlled cache toggle
can isolate its V8 share, or an active-page trace matrix separates event volume, process set, and
category interaction.

## D-042: Retain V8 compile-event duration as a diagnostic, not cache proof  (2026-07-14, accepted; startup and trace-lifetime diagnostics added by D-043; V8 checks made non-blocking by D-051)

**Decision:** The isolated diagnostic advances to `v8-code-cache@4` and retains the finite,
nonnegative `dur` from every attributed complete `v8.compile`/`v8.compileModule` event as
`compileDurationUs`, both per event and summed per artifact. Missing or malformed duration
invalidates the same attribution transaction as missing URL or streaming state. The report emits
raw per-run, per-artifact microsecond values and the result schema advances to v10.

Compile-event duration is a non-gating diagnostic. A shorter warm event may motivate a controlled
reproduction, but does not prove cache consumption; a flat event does not prove reparsing or
cache absence. Streamed compilation overlaps other work, three lineages are a small sample, and
the trace span is not an authoritative cache outcome. D-037/D-041's production, re-production,
and positive consume/reject evidence remain the cache gates.

**Context:** A local pinned-CfT 150.0.7871.115 run retained one compile event per artifact per
launch. The non-streamed render worker measured 24,862–25,262 µs fresh, 25,083–26,496 µs on the
produce launch, and 24,415–26,758 µs warm: overlapping ranges with no consistent warm decrease.
That is consistent with repeated full compile work but does not identify the mechanism. It also
puts the observed event near 25 ms—roughly 0.25% of the 10 s launch budget—so the worker's 99.84%
source-code share is not evidence of proportional launch cost. Streamed app events measured
37–40 µs fresh and 26–30 µs warm; streamed engine events were 3–8 µs in both phases. Those tiny,
overlapping/confounded spans do not turn RE-009 into functional cache proof.

The same run captured one core trace timeout at launch ordinal 5 followed by recovery at ordinal
6. Combined with the prior three-failure ordinal-3–5 burst and other isolated failures, RE-008
can be described as burst-capable with recovery, but the samples do not distinguish transient
shared state from chance clustering.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115
`v8-code-cache@4`/schema-v10 diagnostic on dev-01 under RDP (non-gating), with raw durations
retained in the result; current Chromium DevTools trace-event types, which declare complete-event
`dur` in microseconds
([source](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/front_end/models/trace/types/TraceEvents.ts)).

**Consequences:** Parallax no longer discards already-captured compile spans, and can correlate
them with future artifact growth or controlled cache experiments. The duration diagnostic cannot
make a red cache gate green or replace authoritative cache outcome fields.

**Reopen if:** a controlled micro-repro establishes a calibrated relationship between this trace
span and cache consumption, Chrome documents stronger event semantics, or enough samples support
a variance-aware duration budget.

## D-041: Assert production phase boundaries and measure warm re-production  (2026-07-14, accepted; compile-duration diagnostics added by D-042; zero-count budget gates reclassified as diagnostic checks by D-051)

**Decision:** The isolated diagnostic advances to `v8-code-cache@3` and evaluates
URL-attributed code-cache production on every launch. Fresh launches must emit no production
events; any positive event invalidates the timestamp → produce → consume model directly.
Produce launches retain D-040's requirement that every cacheable required artifact emit positive
production. Warm launches record every positive re-production and gate the count at zero
artifacts. Missing warm production is a measured absence, not proof of consumption; D-037's
positive consume/reject requirement remains independently mandatory. Result schema v9 also adds
an ordinal and elapsed measurement-sequence time to every core and V8 launch so RE-008 samples
can be checked for temporal clustering.

**Context:** `v8-code-cache@2` inspected production only on launch 2, leaving two ambiguity gaps.
An unexpected launch-1 production would contradict the lifecycle but escape direct detection,
and repeated app/engine production on launch 3 would show that their launch-2 cache was not used
as expected rather than merely consumed without trace fields. A three-lineage local CfT
150.0.7871.115 diagnostic with the new assertions observed zero fresh production events and zero
warm re-production events in all repeats. Launch 2 again produced exactly 3,072 app bytes and
6,968 engine bytes while exposing no render-worker production (RE-010). The warm result therefore
does not support repeated production as the explanation for app/engine's missing consumption
fields; it is consistent with silent consumption but cannot prove it, so RE-009 remains open.

The same run's core trace failures occurred at launch ordinals 3, 4, and 5, approximately 30,
50, and 70 seconds after the measurement sequence began; launch 6 completed at approximately
90 seconds. Together with earlier warm-repeat-1 failures, this first timed sample argues against
a simple monotonic late-session cutoff while leaving RE-008's intermittent mechanism open. A
final-tree rerun then repeated the same fresh/produce/warm V8 outcomes with 9/9 completed traces
and completed all 6 core traces, further demonstrating intermittency rather than an ordinal
cutoff.

**Sources checked (2026-07-14):** local pinned CfT 150.0.7871.115 `v8-code-cache@3`/schema-v9
diagnostic on dev-01 under RDP (non-gating), plus the Blink source and Chromium three-fetch test
recorded by D-040.

**Consequences:** the existing nine V8 launches now test all three production phase boundaries
without adding launches. A reported warm re-production is measured negative evidence and fails
the gate even when consumption fields remain unavailable. An absence of re-production narrows
the functional hypotheses but never substitutes for positive consumption evidence. Trace
failures retain their order and elapsed position without inferring that either causes the issue.

**Reopen if:** Blink changes its production lifecycle, repeated production proves compatible
with a valid consumed cache, or temporal fields identify a better boundary than sequence start.

## D-040: V8 code-cache diagnostics use the timestamp/produce/consume lifecycle  (2026-07-14, accepted; production phase assertions amended by D-041; V8 checks made non-blocking by D-051)

**Decision:** The isolated V8 diagnostic advances to `v8-code-cache@2` and gives each of its
three persistent-profile lineages three launches: `fresh` establishes Blink's hot-resource
timestamp, `produce` must emit a URL-attributed `v8.produceCache` or `v8.produceModuleCache`
event with positive `producedCacheSize` for every cacheable immutable JavaScript artifact, and
`warm` is the first launch on which the zero-rejection budget requires URL-attributed cache
consumption. Fresh and produce launches reject unexpected consumption results. The enclosing
result schema advances to v8 and preserves per-artifact production outcomes even when another
artifact makes the aggregate production metric invalid.

**Context:** D-037/D-039 incorrectly modeled the second profile launch as a consumption launch.
Current Blink source selects `kSetTimeStamp` when no hot timestamp exists, selects
`kProduceCodeCache` after that timestamp exists, and only enters the consume path after code
cache exists. Chromium's own module cache test correspondingly loads a module three times and
states that the second fetch produces cache while the third consumes it. A corrected local
three-lineage diagnostic on pinned CfT 150.0.7871.115 then measured the same launch-2 production
in every lineage: 3,072 bytes for the app and 6,968 bytes for the engine. The game module was
below Chrome 150's 1,024-code-unit external-script threshold. The 5,257,345-code-unit render
worker compiled on launch 2 but emitted no URL-attributed production event in any lineage
(RE-010), so production correctly remained mandatory/invalid while retaining the two positive
outcomes. Launch-3 consumption still omitted a usable result for all cacheable artifacts,
strengthening RE-009 now that the maintained harness reaches the correct consumption launch.

**Sources checked (2026-07-14):** current Blink
[`v8_code_cache.cc`](https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/bindings/core/v8/v8_code_cache.cc),
Chromium's
[three-fetch module cache test](https://chromium.googlesource.com/chromium/src/+/3188edc14a270a65297865a82af20bf4e3c57563%5E%21/),
and the local pinned-CfT diagnostic above on dev-01 under RDP (non-gating).

**Consequences:** each V8 lineage costs one additional short launch. The harness now proves the
cache-write prerequisite independently of cache consumption and cannot mistake a launch-2
production for a missing launch-2 hit. Worker production and warm consumption remain fail-closed
platform findings rather than being hidden behind one aggregate invalid state.

**Reopen if:** Blink changes the code-cache lifecycle, Chrome exposes an authoritative cache
state that removes a launch, or the extra launch becomes a measured throughput problem.

## D-039: Isolate mandatory V8 evidence from the core smoke trace  (2026-07-14, accepted; diagnostic lifecycle amended by D-040; partially superseded by D-051 — an invalid V8 diagnostic result no longer fails the overall verdict)
**Decision:** Harness v1 collects V8 code-cache evidence in the versioned
`v8-code-cache@1` diagnostic rather than co-locating `v8` with the core `smoke@1`
presentation/Dawn trace. The diagnostic owns three independent fresh/warm persistent-profile
lineages, traces only `v8` from before navigation through render readiness, and runs against the
same validated artifact, pinned Chrome executable, inspected environment, and before/after
source identity as the enclosing report. `smoke@1` still runs its three core fresh/warm lineages
with presentation, Dawn, and user-timing categories. Both sets and their trace-drain diagnostics
are emitted in one result; the schema advances to v7.

V8 code-cache evidence remains mandatory for Harness v1. An invalid `v8-code-cache@1` result
still fails the overall verdict; isolation narrows the damage of its trace failure rather than
turning the metric advisory. A V8 timeout can no longer invalidate core presentation or Dawn
evidence, and a core timeout cannot erase V8 attribution.

**Context:** D-038 measured that merely narrowing `devtools.timeline` to `v8` reduced ordinary
collection cost without materially changing the intermittent combined-trace failure rate. A
follow-up `ReturnAsStream` experiment also reproduced two timeouts in six launches: both
acknowledged `Tracing.end` in 1.8–1.9 ms, then never emitted `Tracing.tracingComplete`, so Chrome
never supplied an IO stream handle. The four successes completed in 116–125 ms. Changing the
transfer path therefore did not bypass the captured missing-completion failure and was not kept.

Two unchanged integrated isolation diagnostics then completed 12/12 core traces and 12/12
V8-only traces. Every core launch retained the expected Dawn evidence: fresh 6 shader/3 graphics-
PSO misses, warm 6/3 hits, and zero gameplay-overlap compilation. Core traces delivered
3,915,274–4,013,410 locally reserialized bytes in 111.3–121.3 ms. V8-only traces still attributed
all four immutable JavaScript artifacts while delivering just 173–177 events /
26,434–27,708 bytes in 11.0–12.3 ms. Warm V8 consumption remained invalid for the independent
RE-009 observability reason; isolation fixes evidence coupling, not Chrome's missing cache result.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 `ReturnAsStream` and integrated
isolation diagnostics above on dev-01 under RDP (non-gating); local Playwright 1.61.1 CDP
protocol declarations for `Tracing.tracingComplete`, `IO.read`, and `IO.close`.

**Consequences:** the report adds six short browser launches for V8's three paired lineages, but
protects the longer core runs and their valid Dawn evidence from a V8-correlated trace failure.
Artifact and source identity are rechecked only after both sets finish, so the shared report
cannot combine different builds. Profile histories remain explicit and are never compared
across the core/V8 boundary. The physical-console Dawn calibration can now obtain a complete
core evidence set even while the mandatory V8 metric remains invalid and keeps Harness v1 red.

**Reopen if:** isolated V8 traces become unreliable, Chrome exposes a stable non-trace
page-correlated cache result, combined tracing becomes reliable on the physical-console gate, or
the additional launches become a measured throughput problem.

## D-038: Narrow V8 tracing and measure trace completion as a first-class diagnostic  (2026-07-14, accepted; shared-trace placement superseded by D-039; V8 checks made non-blocking by D-051)
**Decision:** `smoke@1` enables the `v8` trace category, not the broader
`devtools.timeline` category, for D-037's `v8.compile`/`v8.compileModule` evidence. The
shared presentation/Dawn/V8 trace records its exact categories, event and CDP data-chunk counts,
locally reserialized UTF-8 event bytes, `Tracing.end` command latency, command-to-completion and
total completion latency, configured timeout, and Chrome's data-loss result for every started
trace. Partial diagnostics survive a timeout and appear in both JSON and the human report. The
result schema advances to v6. The five-second completion bound remains unchanged; a timeout
invalidates every probe that depends on the shared trace.

**Context:** A pinned-CfT 150.0.7871.115 remote A/B on the same artifact measured three
six-launch configurations. With `devtools.timeline`, three traces timed out; the three completed
traces delivered 29,383–29,914 events / 5,000,116–5,091,624 serialized bytes and completed in
149.2–152.1 ms. With `v8`, one trace timed out; the five completed traces still attributed every
immutable JavaScript artifact and retained the required compile fields while delivering
25,703–26,095 events / 4,088,465–4,151,565 bytes in 117.4–120.1 ms. With no V8 category, all six
traces completed with 24,770–25,036 events / 3,954,012–3,982,554 bytes in 112.7–117.3 ms. A
second `v8` diagnostic timed out twice; on both failures `Tracing.end` returned in 1.6–2.1 ms,
then Chrome delivered neither `Tracing.tracingComplete` nor any data chunk during the remaining
five-second bound. Its completed traces took 116.8–119.1 ms total. A separate 20-second broad-
category diagnostic completed 6/6, but every completion was still fast (146.5–153.3 ms); it did
not capture a delayed completion and therefore does not establish that a larger bound repairs
the intermittent failure.

These samples correlate V8 tracing with the completion failure, but they do not establish a
volume-driven flush mechanism: completed drains are two orders of magnitude below the bound,
while failures begin only after the end command returns and deliver zero chunks. Narrowing is
still the correct maintained configuration because it preserves the probe with measurably less
trace traffic. Splitting the shared trace would require another navigation/launch and would
change the fresh/warm profile lineage whose atomic evidence the harness is measuring, so that is
not adopted without a replacement lifecycle design.

**Sources checked (2026-07-14):** local CfT 150.0.7871.115 diagnostics above on dev-01 under
RDP (non-gating); exact trace configuration and partial completion diagnostics recorded by
`smoke@1` v6.

**Consequences:** ordinary trace completion cost and failure mode are now observable per run.
The narrower V8 category reduces collection overhead but does not eliminate RE-008, and one
completion failure still invalidates presentation, Dawn, and V8 evidence together. The retained
diagnostics distinguish a `Tracing.end` command stall, missing completion event, data loss, and
large/slow payload if Chrome's behavior changes.

**Reopen if:** `v8` stops carrying the D-037 fields, the trace completion failure reproduces on a
physical-console gate, `ReturnAsStream` or another collection mode proves more reliable, or a
separate-navigation design can preserve the required profile lineage and atomic measurement
contract.

## D-037: Streamed-module V8 cache traces are diagnostic, not cache-hit evidence  (2026-07-13, accepted; trace category amended by D-038, collection isolated by D-039, launch lifecycle corrected by D-040/D-041, duration retained by D-042; zero-rejection budget reclassified as a diagnostic by D-051)
**Decision:** `smoke@1` implements its V8 code-cache probe with URL-attributed
`v8.compile`/`v8.compileModule` events from Chrome's `devtools.timeline` trace category.
Every launch-required immutable JavaScript artifact in the validated build manifest must have at
least one compilation event before any cache outcome is evaluated. Multiple events for one URL
are valid when the same artifact compiles in multiple renderer processes, workers, threads, or
realms; the result retains each event's process/thread identity and requires trustworthy evidence
from every compilation. On a warm profile, a successful consumption requires a positive
`consumedCacheSize` and `cacheRejected: false`; an explicit `cacheRejected: true` is measured
negative evidence even if its size is zero or absent, and fails the zero-rejection budget. A
missing/ambiguous result is `invalid`, while artifacts below Chrome 150's
1,024-decoded-source-code-unit threshold and cold-profile consumption are explicitly
`not-applicable`. If no artifact is cacheable, the aggregate mandatory metric is also
`not-applicable` and fails the gate. The overall smoke result schema advances to v5.

**Context:** All four current Parallax JavaScript artifacts compile as ES modules. In pinned CfT
150.0.7871.115, the three window modules stream and the render-worker module currently reports
non-streamed compilation. Chromium's non-streaming `V8ScriptRunner::CompileModule` branch
serializes a `V8ConsumeCacheResult`, but its `ScriptStreamer` branch does not populate that
result. A local persistent-profile experiment captured the four exact Parallax URLs on each of
five launches; their compile events never included `consumedCacheSize` or `cacheRejected`.
The second launch instead reported producing 3,072 bytes of app cache and 6,968 bytes of engine
cache, so at least those two artifacts demonstrably did not consume code cache on launch 2.
Blink's process-wide `WebCore.Scripts.V8CodeCacheMetadata.Get` histogram later contained four
code-cache-metadata reads, but that surface requires the subprocess-importing Histograms
Internals page and cannot correlate a read, V8 acceptance, or rejection to a page URL. Treating
it as a hit would violate the project's measure-don't-assert rule.

The first maintained six-launch remote diagnostic completed all combined traces within D-035's
bound, attributed all fresh artifacts, and left the already-validated Dawn
fresh-miss/warm-hit evidence unchanged. Two post-review six-launch reruns continued to attribute
all four artifacts in every completed fresh trace and all three cacheable artifacts in each
completed warm trace, but one and then three combined traces exceeded the existing five-second
completion bound. Across these three maintained diagnostics, 14 of 18 traces completed and four
timed out with the measured page kept alive, extending RE-008. No completed trace reported CDP
buffer data loss. Every completed warm V8 result correctly remained `invalid`, so these
diagnostics do not promote a V8 gate baseline. RE-009 records the code-cache observability gap.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `third_party/blink/renderer/bindings/core/v8/v8_script_runner.cc`,
`v8_code_cache.cc`, `inspector_trace_events.cc`, and
`tools/metrics/histograms/metadata/v8/enums.xml`; pinned V8 revision
`ce0af5c0d181678bcda077c68d4beaec2854ad16` via Chromium's `DEPS`.

**Follow-up checked (2026-07-14):** the third maintained local CfT 150.0.7871.115 diagnostic
above; three of its six combined traces timed out and none reported trace-buffer data loss.

**Consequences:** the V8 probe is implemented but its mandatory warm metric remains invalid on
the walking skeleton. The trace diagnostic is kept because it is exact, page-correlated, and
will turn measured without a schema change when Chrome exposes successful streamed consumption.
Process-wide metadata-read counts remain supporting diagnostics only. The probe must be extended
separately when a wasm artifact exists; this decision covers JavaScript code caching.
Decoded source length is read from the validated built files before launching Chrome so non-ASCII
bundles use the same UTF-16-code-unit quantity as Blink rather than response byte length; a
leading BOM is removed to match browser decoding. The M0 manifest currently contains only
launch-required JavaScript. Before lazy scenario-specific JavaScript chunks enter it, the build
contract must classify scenario participation so `smoke@1` can keep zero compilation events
invalid for required code without demanding unrelated lazy chunks.

**Reopen if:** Chrome adds consumption/rejection data to streamed-module trace events, exposes a
stable page-correlated code-cache API, changes the pinned cacheability threshold, or Parallax
adds wasm and needs `v8.wasm.moduleCacheHit` evidence.

## D-036: D3D12 Dawn gates combine page-windowed traces with subprocess cache histograms  (2026-07-13, accepted)
**Decision:** `smoke@1` implements the mandatory Dawn pipeline compile/cache metric on the
registered D3D12 gate by combining two independent Chrome surfaces. One browser-wide trace,
started before navigation, adds `disabled-by-default-gpu.dawn` to the D-035 categories.
Renderer user-timing markers bound gameplay; any overlapping synchronous render/compute
pipeline creation, asynchronous `CreatePipelineAsyncEvent::InitializeImpl`, or D3D12 shader
compiler event fails the zero-gameplay-compile budget. After the trace and measurement end,
the harness opens `chrome://histograms/` outside the measurement window while the trace remains
active, synchronizes subprocess counters, then ends the trace and synchronizes them again. It reads
the exact `GPU.WebGPU.D3D12` shader, graphics-PSO, and compute-PSO hit/miss histograms through
CDP. Shader request/miss trace counts must agree exactly with the histogram operation counts;
PSO histogram operations are bounded by the trace's synchronous API requests plus actual
asynchronous initializations, and must cover every traced asynchronous initialization (a
synchronous API request can be an in-device cache hit and therefore have no backend PSO
histogram). Graphics and compute counts also have independent upper bounds: their matching
synchronous requests plus the generic async-initialization count, so one path cannot explain
contradictory evidence from the other. Each synchronization itself uses two stable reads, and the snapshots immediately
before and after trace completion must also match; any late change makes the metric `invalid`.
Any other trace/histogram contradiction does likewise.
Missing hit or miss sides count as zero only when the counterpart proves that cache path was
exercised. Non-D3D12 backends remain explicit `unsupported` for this probe rather than
borrowing D3D12 semantics.

**Context:** Dawn emits page-windowable pipeline/compiler work into Chrome's disabled Dawn
trace category, but its exact backend cache results are GPU-process UMA histograms. A direct
`Browser.getHistograms` call returned no `GPU.WebGPU` entries because CDP reads the browser
process's statistics recorder. Chrome's Histograms Internals page imports shared-memory
subprocess histograms and requests remaining child-process deltas; after that synchronization,
the same CDP call returned Dawn's exact counters. Keeping the trace active through the first
import makes any deferred app Dawn work visible to both surfaces; the stable post-trace snapshot
then establishes their shared observation boundary. The internals tab opens only after the
presentation tail and gameplay marker, so its focus/GPU work cannot contaminate measured
timings, and filtering to Dawn's `GPU.WebGPU` events/counters excludes unrelated diagnostics
work. Each `measureRun` launches a new
browser process, so counters are per launch even though the persistent profile deliberately
survives for its paired warm relaunch.

A non-gating remote diagnostic with pinned CfT 150.0.7871.115 on dev-01 measured the same
result across all three lineages: each fresh launch recorded 6 shader-cache and 3 graphics-PSO
misses; each warm relaunch recorded 6 shader-cache and 3 graphics-PSO hits; compute PSOs were
not exercised; all six marked gameplay windows had zero overlapping pipeline initialization
and zero shader compiler events. The environment correctly remained `invalid` under RDP, so a
physical-console rerun is still required before baseline promotion.

**Consequences:** smoke result schema advances to v4. Harness reports whole-launch cache counts
and durations while using trace markers—not end-of-run UMA—for gameplay-window attribution.
Synchronous API creation is conservatively budgeted even if Dawn could satisfy it from an
in-device cache; Parallax's warmup contract forbids requesting new pipelines during gameplay
regardless. `smoke@1` now marks the D3D12 Dawn metric implemented and continues to fail when the
probe is unsupported, internally inconsistent, or missing. RE-007 records the Chrome
observability gap and internals-page synchronization cost. Each PSO cache subpath carries its
own metric state; an unexercised compute or render path is `not-applicable`, never a measured
zero-hit result.

**Sources checked (2026-07-13):** local CfT 150.0.7871.115 experiments above; Chromium tag
150.0.7871.115 `content/browser/metrics/histograms_internals_ui.cc`,
`content/browser/resources/histograms/histograms_internals.html` and
`histograms_internals.ts`, `content/browser/devtools/protocol/browser_handler.cc`,
`gpu/command_buffer/service/dawn_platform.cc`, and
`gpu/command_buffer/service/webgpu_decoder_impl.cc`; pinned Dawn revision
`01249a97332468dbdd6cf5edb8dd7bae77875de5` `native/d3d12/RenderPipelineD3D12.cpp`,
`native/CacheRequest.h`, and `native/CreatePipelineAsyncEvent.cpp`. A local attempted
page-close boundary was rejected after two of six browser traces exceeded D-035's five-second
completion bound; keeping the app target alive preserved the already-validated bound.

**Reopen if:** Chrome exposes page-correlated Dawn cache events directly, CDP gains a safe
subprocess-histogram option, Dawn trace/histogram semantics change, or another backend is
promoted to a mandatory gate and needs its own verified mapping.

## D-035: Viz presentation-feedback trace is diagnostic, not a presentation gate  (2026-07-13, accepted; partially superseded by D-051 — the authoritative presentation metric is informational and no longer fails Harness v1)
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

## D-031: Harness smoke gates an exact external Chrome for Testing pin  (2026-07-12, accepted; fixed-headed-viewport provision superseded by D-034; partially superseded by D-051 — the presentation metric no longer stays mandatory-and-blocking)
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

## D-029: M0 in-app telemetry export surface  (2026-07-12, accepted; recent-frame retention widened 120 → 240 by D-054, schema shape unchanged)
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

## D-028: M0 local artifact and serving contract  (2026-07-12, accepted; metrics endpoint schema advanced to v2 — per-path-class counters — by D-054)
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

## D-027: Review passes run in reviewer mode  (2026-07-12, accepted; amended by D-049 — review is multi-agent)
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

## D-026: Milestone work runs in tech-lead mode  (2026-07-12, accepted; amended by D-049 — unit of work is task-sized, not commit-sized)
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

## D-020: Toolchain refinements — Rollup, exact pins, reproducibility levels  (2026-07-11, accepted; supersedes D-014; currency cadence added by D-079)
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

## D-009: Install scale — 12 GB content, ≥100 GB architecture floor; gaming-rig baseline; 4K showcase tier  (2026-07-11, hardware/tier provisions superseded by D-018; install-scale provisions remain in force per D-018)
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

## D-005: Multithreading via explicit worker topology (SAB + OffscreenCanvas + WebGPU-in-worker)  (2026-07-11, accepted; the "no engine ships web multithreading" claim below is corrected by D-046 — Unity 6.4 ships Burst/Job-System threads; the decision is unaffected)
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

## D-004: Engine — TypeScript + Babylon.js (WebGPU only); not Unity, Godot, Bevy, or from-scratch  (2026-07-11, accepted except classic-Babylon component superseded by D-078; technology claims re-grounded by D-046 and evidence consolidated by D-076)
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
  remain weak on collision and animation, so triangles stay for anything interactive;
  dynamic relighting, formerly listed alongside those as a static weakness, is now a
  fast-moving research front — see rendering-engine-research.md §8 for the sourced
  2026-07-19 state: research prototypes demonstrate real-time relit splats at desktop-GPU
  rates, no engine or WebGPU renderer ships it, and the game-design.md requirement that
  the splat branch be evaluated *under dynamic relighting* stands unchanged). Includes
  the original question of GPU-driven culling/instancing and whether Babylon's frame
  graph accommodates it or needs bypass. Evaluation axes: frame budget at both quality
  tiers, streaming/storage cost per visual quality (splats are storage-heavy, and
  relightable variants more so — interacts with D-009 scale), asset-pipeline fit
  (AI generation produces meshes; the former "splats come from capture/reconstruction"
  objection is retired — EA SEED's open-source mesh2splat converts glTF meshes to
  PBR-material-carrying, explicitly relightable splats in <0.5 ms, checked 2026-07-19,
  github.com/electronicarts/mesh2splat — making splat relighting a renderer problem
  rather than a reconstruction problem for our synthetic assets), and WebGPU compute
  limits. M1 runs the comparative spike on representative content; M5 commits per
  content class. The splat branch also gates the scan-your-world UGC feature
  (features.md).
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
