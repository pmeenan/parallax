# Code review guide

How to run the on-demand review described in [workflow.md](workflow.md#reviews-happen-on-demand-not-by-default).
Read this when the human asks for a review; the workflow doc holds the rules for *when*
reviews happen (on demand, one agent, one pass) and this doc holds *how* to do one well.

A green `pnpm check` proves only that the current tests and happy paths pass. A review
is a hunt for what the tests do not exercise. Follow the procedure in order — it is
designed so that each step produces concrete leads for the next — then work the
checklist against every changed function. Reading the diff once and reporting what
"looks off" is not a review.

## Review contract

A complete review must:

1. cover every tracked, staged, deleted, renamed, and untracked file in the review unit;
2. recover intended behavior from the request, plan, decisions, architecture, budgets,
   directory instructions, and established sibling behavior;
3. inventory changed contracts and trace every producer and consumer across the repo;
4. attack boundaries, malformed state, repeat use, failures, retries, concurrency, and
   teardown rather than checking only the ordinary success path;
5. verify each candidate with a concrete execution path and observable wrong outcome;
6. inspect tests for missing mechanisms and for assertions that repeat the implementation;
7. if fixes are authorized, add regression coverage and review the corrected whole diff; and
8. finish with findings ordered by severity, or an explicit evidence-backed clean result.

Do not narrow the review to files named in the prompt. Do not assume a changed literal,
tag, type, table row, counter, or artifact is inert. Do not stop after the first defect.

## Output contract

Use the lowest severity that matches the demonstrated impact:

| Level | Meaning | Typical examples |
| --- | --- | --- |
| **P0 — critical** | Immediate broad or irreversible harm; release must stop | arbitrary destructive target, credential disclosure, remote code execution, widespread unrecoverable user-data loss |
| **P1 — high** | Serious correctness, security, persistence, or gate-integrity failure in a realistic path | save corruption, bypassed trust boundary, deterministic startup crash, deployer escaping its fixed scope, harness falsely passing a broken candidate |
| **P2 — medium** | User-visible wrong behavior, nondeterminism, leak, or budget regression under a plausible condition | duplicate reward, broken retry, stale response mutating replacement state, launch-to-launch leak, incorrect gameplay predicate |
| **P3 — low** | Narrow present defect with limited impact, or concrete hygiene problem that creates likely drift | misleading persisted/telemetry semantics, dead export that is already dual authority, validation failing too late |

Style preferences, naming taste, optional abstractions, speculative future needs, and
“add more tests” without an underlying missing behavior are not findings.

Each finding must contain:

```text
[P1] Imperative, mechanism-specific title
Location: path/to/file.ts:123
Precondition/input: exact state, value, ordering, or environment needed
Execution path: producer → changed code → consumer/failure path
Wrong outcome: observable crash, corruption, wrong state/event/value, leak, or false verdict
Contract: code/doc/decision/test/sibling invariant that requires different behavior
Fix direction: smallest credible repair (optional in report-only mode)
```

Point at the line that introduces the defect, not an entire file. Combine cases that share
one mechanism and fix; split independent impacts. Use these confidence states in scratch:

- **Confirmed:** exact path and wrong outcome established — report it.
- **Needs experiment:** material ambiguity remains — run the smallest focused probe.
- **Open question/residual risk:** evidence needs human/product input or unavailable state —
  state it separately, not as a defect.
- **Rejected:** guarded, unreachable, intended, or stylistic — drop it.

“No findings” is sufficient only after the completion checklist below. Follow it with
meaningful residual risks or unrun validation; never invent low-value comments to avoid a
clean result.

## Procedure

1. **Establish authority, scope, and intent.** Read root and applicable nested
   `AGENTS.md` files. Identify the base (`HEAD` unless specified), active request/plan
   item, claimed acceptance criteria, applicable decisions/architecture/budgets, review
   mode (report-only or fix-authorized), and verification already performed.
2. **Enumerate the complete review unit.** Run the commands below. `git diff` does not
   show untracked contents, so open every untracked file explicitly. Read deleted or
   heavily rewritten old files with `git show HEAD:path`. Distinguish unrelated in-flight
   user edits, preserve them, and account for them when they affect the built/measured tree.

   ```powershell
   git status --short
   git diff --name-status HEAD
   git diff --stat HEAD
   git diff --cached --name-status
   git ls-files --others --exclude-standard
   ```

3. **Build the change inventory.** Read every modified/new file in full, not just hunks.
   Record additions, removals, and reorderings of exports/types; constants/capacities/
   thresholds; IDs/tags/paths/commands/events/counters; state fields/transitions; schemas/
   versions/layouts/hashes; data rows; platform/worker/storage operations; fixtures/
   goldens; and doc claims. For each write **old behavior → new behavior → intended reason
   → affected boundary**.
4. **Assign risk routes.** Mark persistence/destructive, security/trust, protocol/schema,
   concurrency/lifecycle, deterministic-sim, performance/hot-path, harness/evidence,
   content/data-graph, UI/input, and build/tooling changes. Apply every matching routed
   checklist below; most changes have more than one route.
5. **Write an invariant ledger.** For each changed boundary answer: accepted inputs,
   outputs/errors, durable identity/version, legal state transitions, ownership/lifetime,
   ordering/concurrency, failure atomicity/retry, trust boundary, observability, and cost.
   Turn prose into testable invariants such as “count changes 0→1 and never 1→2” or
   “missing mandatory evidence cannot yield a passing facet.”
6. **Trace every inventory item to consumers.** Search the whole repo (`game/`, `engine/`,
   `harness/`, `app/`, `deploy/`, `docs/`) for both old and new symbols, raw strings,
   numeric codes, serialized fields, tags, paths, and derived artifacts. Follow calls in
   both directions until reaching an external input, durable state, user-visible effect,
   platform operation, or harness verdict.
7. **Read neighbors and history.** Compare with the closest mature sibling (other table,
   save block, worker protocol, validator, storage transaction, harness facet). Missing
   guards, versions, cleanup, telemetry, and shared helpers are leads. Use `git blame`/
   `git log -p` and applicable decisions to recover intent, not to excuse current behavior.
8. **Attack boundaries and lifecycle.** For each changed function/state edge, evaluate
   empty, first, typical, last, `N−1/N/N+1`, malformed, duplicate, stale, future-version,
   repeated, partial-failure, retry, cancel, timeout, teardown, concurrent, and reversed-
   completion cases. Use the checklist below and trace exact branches; “looks handled” is
   not evidence.
9. **Audit tests against invariants.** Map every changed invariant/failure mechanism to an
   exact assertion. Reject tautological expected values, mocks that bypass the boundary,
   broad non-throw/shape assertions, and fixtures that never reach the changed branch.
10. **Verify candidate findings.** Locate the tight defect line and every guard; construct
    the smallest valid precondition; trace the wrong outcome; check whether a decision
    intentionally accepts it; inspect contradicting tests; run a focused probe if material
    ambiguity remains. Report confirmed findings only.
11. **Report, fix, and re-review.** Order findings P0→P3. Unless report-only, add a test
    for the demonstrated mechanism, make the smallest coherent fix, rerun focused checks,
    re-read the complete cumulative diff, repeat stale-name/authority searches, run
    `git diff --check`, then follow the full/physical
    [validation cadence](workflow.md#validation-and-physical-gate-cadence).

Useful search recipes:

```powershell
rg -n --fixed-strings 'exact.changed.literal' .
rg -n 'ChangedType|changedFunction|changed_field' game engine app harness deploy docs
rg -n 'switch|case|Record<|satisfies|parse|serialize|deserialize' relevant/path
rg -n 'TODO|FIXME|HACK|for now|assume|should never|unreachable' changed/paths
rg -n 'any|@ts-ignore|@ts-expect-error|biome-ignore' changed/paths
```

## Risk routes

| Route | Trigger | Required focus |
| --- | --- | --- |
| Persistence/data | saves, OPFS, manifests, caches, migrations | version/length, atomicity, crash consistency, stale data, migration/rejection policy |
| Destructive operation | delete, replace, deploy, uninstall, garbage collection | resolved target, containment, symlink/mount races, partial failure, recovery, idempotency |
| Security/trust | external input, network, path, manifest, process launch, origin boundary | canonicalize then validate, authorization, injection, confused-deputy paths, secrets |
| Protocol/schema | commands, events, workers, queries, telemetry, binary layouts | producer/consumer parity, versioning, unknown fields, ordering, exact length, errors |
| Concurrency/lifecycle | async work, workers, queues, locks, cancel/teardown | double completion, stale response, lost wakeup, ownership, cleanup on every exit |
| Deterministic simulation | fixed-step state, replay, seeded RNG, authored order | authoritative inputs, stable iteration, save/load continuation, exact event order |
| Performance/hot path | per-frame/per-tick loops, streaming, render, allocations | maximum-scale cost, steady-state allocation, cache validity, instrumentation/budgets |
| Harness/evidence | collectors, validators, budgets, reports, baselines, identity | fail-closed completeness, no weakened check, exact source/artifact, honest verdict |
| Content/data graph | tables, tags, IDs, markers, district references | uniqueness, capacity, referential integrity, parity, reachability, hidden predicates |
| UI/input | DOM/canvas state, focus, IME, commands, recovery | authority, stale presentation, duplicate input, semantics/accessibility, recovery |
| Build/tooling | bundling, pins, generated artifacts, scripts | reproducibility, quoting, pin/cache identity, exact outputs consumed by runtime/gates |

## Checklist — apply to every changed function

- **Boundaries and numerics.** Capacities at `0, 1, N−1, N, N+1`; JS bit ops use
  signed 32-bit intermediates (`1 << 31` is negative, shifts wrap modulo 32, a full
  uint32 mask needs an explicit special case, and persisted masks commonly need `>>> 0`);
  verify the declared capacity against the actual representation and make popcount match
  any stored count. Floats: `NaN`, `±0`, `Infinity`,
  equality vs tolerance, inclusive vs exclusive radius, distance vs distance-squared;
  clamps and caps (level cap, stack size, ring buffers) at exactly the cap and one past
  it; byte layouts: offsets, block sizes, endianness, total length, and what happens
  with trailing bytes.
- **Constraints are enforced, not trusted.** Every constraint stated in a decision,
  comment, doc, or type name must be enforced by code at a boundary (module load,
  adapter/district init, save load, query) with a throw. Validation must fail closed:
  unknown bits, unexpected lengths, unregistered IDs, inconsistent derived totals, and
  unsupported versions are rejected, not skipped or clamped. Validate everything before
  mutating anything — an error mid-way must not leave partial state.
- **Cross-subsystem effects.** For every consumer found in step 6: gameplay predicates
  on tags, replay/golden event sequences, save-schema readers, harness validators and
  semantic-contract digests, telemetry and budget checks, docs that quote the value.
  Events: emitted exactly once, in a documented order relative to related events, with a
  payload every consumer can read.
- **Determinism and replay.** Fixed-step simulation may depend only on its
  authoritative inputs: no `Date.now`, `performance.now`, `Math.random`, or wall-clock
  in `game/src/sim`; no dependence on `Map`/`Set`/object-key iteration order that isn't
  itself deterministic; sort comparators are total; float accumulation is done the same
  way on every path. Save → load → continue must produce the same state and events as
  running straight through.
- **Save contracts and tuning resilience.** A layout change bumps the schema version;
  load validates version and length; ordering that is save identity is append-only and
  documented as such; validation that assumes a balance constant (XP per award, radius,
  stack size) will corrupt saves the next time tuning changes unless the rule set is
  versioned alongside; check nominal-vs-net semantics at caps; a round-trip test exists.
- **Sibling parity and idioms.** Neighboring systems' guards (walkability, unique-ID
  checks at load, district registration, shared math/bitmask/seeded-RNG helpers) apply
  here too unless there is a stated reason; error handling and message shape match.
- **Simulation hot-path discipline.** Nothing per tick that can be resolved at init:
  no allocations, closures, array-callback methods, string building, table scans, or
  revalidation on steady-state/no-op frames. Assertions belong at load/save/query/
  creation boundaries, not inside the 60 Hz step.
- **Layering and observability.** `game/` reaches platform APIs only through `engine/`
  interfaces; `engine/` carries no game rules or content; content lives in data tables,
  not branches. A new system with no counters/timings visible to the harness
  (`AGENTS.md` rule 5) is a finding. Worker/SAB code: message ordering under teardown,
  detached buffers after transfer, `Atomics` wait/notify pairing, and in-flight
  responses arriving after the peer is gone.
- **Type and lint escapes.** Each `any` without a stated reason, `as` cast, non-null
  `!`, `@ts-ignore`/`@ts-expect-error`, or `biome-ignore` hides a possible mismatch —
  open it and check. `switch` over a union must be exhaustive; a new member of an
  enum/union must be handled everywhere the old members are.
- **Tests.** Do the new tests assert the behavior, or only that the code runs? Do they
  cover the boundary table, or only the middle? Are they deterministic (no timers,
  ordering, or real clocks)? A test that recomputes the same constant the same way as
  the implementation proves nothing. Every changed fixture, golden, snapshot, digest,
  or expected count must be individually intentional and explained in the handoff.
- **Dead code and dual authority.** New exports have callers; new tags/IDs/constants
  are not unconsumed duplicates of an existing authority; the same identity is not
  defined in two places (a table and authored world data, two constants) without an
  exact-parity check that decides which one wins.
- **Docs consistency.** Plan checkbox, status paragraph, `AGENTS.md` trees, decision
  entry, and quoted numbers (counts, hashes, versions) match what the code does now.

## Mandatory adversarial case matrix

For each changed boundary, mark cases applicable/not-applicable and evaluate the exact
branch and post-state. Do not merely mention the category.

### Values and identities

- empty/missing/null/undefined where representable;
- first valid, ordinary, last valid, `N−1`, `N`, and `N+1`;
- `-1`, `0`, `1`, maximum encoded/safe value, one past it, and fractional values;
- `NaN`, `Infinity`, `-Infinity`, and `-0` for number inputs;
- exactly at, just below, and just above every threshold/radius/timeout;
- duplicate IDs/keys/tags, alias/case/Unicode-normalization variations;
- unknown, stale, future-version, out-of-district, out-of-bounds, or unreachable IDs;
- truncated, oversized, trailing-byte, extra-field, wrong-endian, and wrong-version payloads;
- fields that are individually valid but invalid in combination; and
- integer wrap, shift indices 30/31/32, `~mask`, signed/unsigned conversion, counter wrap.

### State and lifecycle

- first use, repeated use, already-applied, already-complete, and already-closed;
- duplicate request/event and idempotent retry;
- failure before mutation, during partial mutation, and after mutation before response;
- cancel/timeout/peer teardown before start, queued, active, and just after completion;
- two concurrent callers, reversed completion order, and stale response after replacement;
- cold/fresh, warm/cached, restored, corrupted, unsupported-version, and partially written state;
- initialization failure and cleanup failure, including which error/result becomes authoritative;
- save → load → continue versus uninterrupted execution; and
- success/failure followed by another attempt to expose leaked reservations or stale flags.

For a state machine, enumerate legal states and edges. Every input in every state must take
one legal edge or fail without mutation. Look for impossible combinations represented by
independent booleans/nullables and for terminal states that still accept mutation.

## Routed deep checks

### Validation, mutation, and errors

- Validate the entire request/state before the first mutation or external effect.
- Canonicalize once, validate that canonical value, and use the same value; avoid
  validate-one-path/use-another TOCTOU and normalization bugs.
- Unknown identities, bits, enum members, fields, versions, lengths, and states fail closed.
- Recompute/cross-check derived count, total, checksum, mask, hash, and index fields.
- A rejected operation leaves state unchanged unless it writes a documented recovery record.
- Retry is explicitly idempotent or has identity/sequence protection against double apply.
- Synchronous throw, async rejection, timeout, abort, and peer-loss paths receive equivalent
  cleanup and preserve the primary failure.
- Error categories distinguish corruption, unsupported version, invalid input, and transient
  failure when callers react differently; messages do not leak secrets.

### Serialization, persistence, and migration

- Layout/schema/rules changes bump the correct version and every reader/writer agrees.
- Offsets, block sizes, alignment, signedness, endianness, exact/trailing length, and header/
  payload totals agree at all nesting levels.
- Stable array order and numeric codes cannot move silently; capacity is enforced at module
  load or deserialize/init, not only by a type, comment, or test.
- Old state has an explicit migrate/reject/read policy and errors name the actual mismatch.
- Validation that depends on a balance/tuning constant persists a compatible rules version or
  enough canonical data to avoid treating future tuning as corruption.
- Writes are crash-consistent: staged/temp data, sync/close, atomic publication, rollback, and
  garbage collection preserve at least one authoritative version.
- A round trip is not enough: load malformed, stale, boundary, future, and semantically
  inconsistent state, then inspect state after rejection.
- Nominal/requested, net credited, clamped, measured, estimated, and cumulative values are
  named and reported consistently.

### Async work, workers, queues, and resources

- Each request receives exactly one completion bound to request/generation identity.
- Teardown/cancellation prevents late messages from mutating replacement state.
- Cancel removes queued work, releases capacity/locks, and resolves or rejects every waiter.
- Success, error, timeout, abort, device loss, and peer loss release ports, listeners, timers,
  buffers, GPU objects, file handles, locks, and temporary storage.
- Transferred buffers are not read after detachment; ownership is explicit on both sides.
- `Atomics.wait`/`notify`, ring indices, and sequence counters cannot lose a wakeup, confuse full
  with empty, wrap incorrectly, or publish readiness before payload bytes.
- Reentrancy/callbacks cannot observe half-mutated state; sync throw and promise rejection have
  the same cleanup semantics.
- Queue limits apply to every producer and include reserved/in-flight work, not only enqueued
  entries.

### Filesystem, OPFS, deploy, and destructive paths

- Resolve and verify exact absolute targets before deletion/replacement/recursive traversal.
- Prove containment after canonicalization; examine symlink/reparse-point, mount, inode-swap,
  case, prefix, and encoded-path traps where applicable.
- Avoid broad roots, empty variables, globs, and cross-shell path construction.
- Revalidate target identity at the last responsible moment before mutation.
- Partial copy/upload/delete failure cannot publish incomplete data and leaves a recoverable
  prior/staged state.
- Locks have ownership, stale-lock, and manual-recovery semantics; cleanup cannot remove another
  process's lock or outputs.
- Preview/apply paths share validation; apply cannot accept an unpreviewed target or bypass the
  fixed scope.
- Cleanup removes only operation-owned artifacts and preserves unrelated user data.

### Security and trust boundaries

- Enumerate network, manifest, path, URL, environment, browser-message, save, query, process-
  output, and authored-content inputs.
- Validate type, length, range, encoding, canonical form, and allowlisted identity before use.
- Check shell/process/URL/path construction for injection, traversal, argument-boundary loss,
  encoded separators, Unicode/case/default-port confusion, and confused-deputy behavior.
- Authenticate/authorize at the operation boundary, not only when a session/token was created.
- Hash/signature checks bind the exact bytes consumed and occur before publication/use.
- Logs/errors/reports/telemetry do not expose credentials, secrets, private paths, or user data.
- Fallback cannot fail open unless an accepted decision explicitly permits it.

### Deterministic simulation and authored data

- Fixed-step state depends only on authoritative inputs and seeded streams: no wall clock,
  `Math.random`, completion timing, or unstable external ordering.
- Iteration order is explicit; comparators are total with deterministic tie-breakers.
- Command/event order is deterministic and semantic events/rewards occur exactly once.
- Float precision, operation order, and rounding are identical on replay/live/hash paths.
- IDs, tags, marker references, and table order are unique, registered, capacity-bounded, and
  cross-checked against the authored graph.
- Gameplay positions are in bounds and navigable/reachable when the mechanic requires it.
- Trace new rows/tags through spawn, trade, reshape, interaction, transition, schedule,
  rendering, query, save, and telemetry predicates.
- Save/load/replay and uninterrupted execution match; repeat discovery/reward/loot/quest actions
  cannot double apply.

### Performance, rendering, and memory

- Per-tick/per-frame code avoids work resolvable at init: allocation, closure creation, string
  building, array callbacks, sorting, table scan, validation, and lookup construction.
- Evaluate complexity at configured capacity/target scale, not only the current fixture size.
- Cache keys include all result-changing inputs and invalidation cannot retain stale world/GPU/
  schema/release state.
- GPU buffers/textures/pipelines have correct usage, bounds, alignment, format, and destruction;
  device/context loss and teardown cannot use destroyed resources or wedge recovery.
- Worker/main frame ordering prevents stale presentation and use-after-destroy.
- New systems expose required timing/count/memory/hit-miss/rejection/queue-high-water evidence;
  unsupported measurement is explicit, never silently zero.
- Harness/budget changes cannot omit a mandatory sample, weaken a threshold, average away a
  failure, or turn `invalid`/`unsupported` into `passed`.

### TypeScript, APIs, and layering

- Inspect every `any`, `unknown` narrowing, `as` cast, non-null `!`, ignore directive, and lint
  suppression against the runtime value it claims.
- Union/enum additions are handled in switches, maps, serializers, UI, telemetry, and tests.
- Optional fields distinguish absent, unavailable, invalid, zero, and false when meanings differ.
- Public APIs do not expose mutable arrays/maps/typed buffers behind immutable invariants.
- New exports have consumers; speculative helpers and dead paths are removed.
- `game/` uses `engine/` interfaces for platform access; `engine/` has no game content/rules;
  assets enter only through their QA gate.
- Two representations of an ID/radius/version/path/count have one authority plus an exact parity
  check, rather than silent dual authority.

### Browser/platform behavior

- The project is latest-Chrome-only: do not hide a missing API behind compatibility fallback.
- Check current primary sources or local behavior for fast-moving APIs; training memory is not
  authority, and measured local behavior wins on disagreement.
- Secure-context/isolation, permissions/user activation, worker exposure, transfer, and device-
  loss assumptions match the actual execution realm.
- Unsupported/unavailable/denied remain distinct in runtime, UI, telemetry, and verdicts.
- A platform quirk that cost meaningful debugging time is checked against and, when warranted,
  added to `rough-edges.md` with evidence rather than silently worked around.

### Build, manifests, dependencies, and evidence

- Independent builds reproduce generated artifacts; source, exact pins, lockfile, local tool
  registry, generated code, and runtime agree.
- Manifest paths/sizes/hashes/entrypoints/scopes/MIME/cache/isolation/release records bind the
  exact produced bytes.
- Artifact and semantic-contract digests are recomputed, never copied/guessed; version bumps
  reflect semantic changes rather than artifact identity alone.
- Harness validators require complete mandatory evidence and exact pre/post identity; report
  persistence/finalization failure cannot leave a passing verdict.
- Baseline eligibility/promotion is explicit; local/mismatched results cannot become authoritative
  through prose.
- Evidence docs quote the report's own source tuple, artifact/release, schema, metric set, verdict,
  and immutable hashes without claiming a later checkout was measured.

### Tests and fixtures

- Map every changed invariant and demonstrated failure mechanism to an exact assertion.
- Establish that the regression test would fail on the buggy implementation when practical.
- Do not compute expected masks/hashes/counts with the same expression as production.
- Test failure post-state, not only `toThrow`; cover repeat/retry/cancel/teardown/stale/concurrent
  behavior for routed changes.
- Keep tests deterministic: inject/fake time, seed randomness, control ordering, avoid sleeps.
- Do not update snapshots/goldens/digests/counts merely to pass; trace each delta to intent.
- Mocks must not replace the boundary whose semantics the test claims to verify.

## Review routing by repository area

| Changed area | Minimum additional inspection |
| --- | --- |
| `game/src/sim/` | `game/AGENTS.md`, balance/world producers, replay/save, command/event/query consumers, harness simulation evidence |
| `game/src/world/`, `balance/` | game design when behavior changes, raw tag/ID consumers, capacity/referential validators, generated world/build inputs |
| `engine/` workers/services | `engine/AGENTS.md`, both protocol ends, startup/teardown, transfer ownership, telemetry/recovery |
| installer/storage/OPFS | architecture/decisions, manifests, transaction/retry/crash/GC/uninstall behavior, evidence consumers |
| `harness/` | `harness/AGENTS.md`, budgets, mandatory metrics, source/artifact identity, result schema/finalizer, fail-closed tests |
| `deploy/` | `deploy/README.md`, fixed target, preview/apply parity, containment/lock/rollback tests |
| `app/` or UI | authority and input/focus/recovery boundaries, installer lifecycle, semantic/accessibility state, UI evidence |
| Rust/Wasm/WGSL | applicable `AGENTS.md`, ABI/alignment/overflow, threads/atomics, shader bounds, JS↔Wasm↔WGSL parity |
| docs-only evidence | D-119 limits, report identity/hashes, whether prose merely records evidence or changes a contract |
| dependency/pin | `docs/dependencies.md`, manifests/lockfile, registry, primary release sources, risk-tier gate |

## Finding verification examples

Good:

> A 32nd row makes `1 << 32` wrap to bit 0, the known mask becomes zero, and the first
> discovery throws during tick 1. The data table has no capacity guard.

Not a finding:

> This bit-mask code feels brittle and could perhaps use a helper.

Good:

> Adding `waystone` to these markers makes the existing `nearWaystone` predicate accept
> reshape at two new locations; the economy behavior changed without documentation or a
> regression test.

Not a finding:

> These tags may be used somewhere else.

Good:

> After timeout, the request remains in `pendingById`; a late response then resolves the
> already-rejected operation and mutates the replacement generation because the handler
> checks request ID but not generation ID.

Not a finding:

> Async code is hard and might race.

Before reporting, always locate all guards, construct the smallest valid precondition,
trace exact branches/state changes, check whether an accepted contract intentionally permits
the outcome, inspect any contradicting test to confirm it reaches the same mechanism, and run
a focused probe when material ambiguity remains.

## Common review failures

- reading only highlighted hunks or only files named in the request;
- ignoring untracked, deleted, generated, staged, or concurrently edited files;
- trusting types, comments, docs, tests, or a green build without runtime enforcement;
- searching symbols only and missing raw strings, numeric codes, paths, tags, serialized names;
- checking success but not repeat/failure/cancel/teardown/stale/concurrent behavior;
- considering current fixture size rather than configured capacity;
- reporting theory without a valid precondition and observable wrong outcome;
- stopping after one serious finding;
- changing expected values, snapshots, hashes, validators, or budgets before proving why;
- treating unsupported/missing evidence as zero or success;
- confusing nominal, requested, credited, measured, estimated, and cumulative values;
- recommending abstraction/cleanup without a present correctness or drift mechanism;
- silently reverting unrelated user work; and
- declaring “no findings” because time or context ran low.

## Completion checklist

A review is complete only when every answer is yes:

- [ ] Did I read all applicable instructions and recover the intended contract?
- [ ] Did I account for every tracked/staged/deleted/renamed/untracked file in scope?
- [ ] Did I read each changed/new file in full and inspect relevant unchanged context?
- [ ] Did I inventory changed identities, schemas, values, transitions, and claims?
- [ ] Did I trace every item to all producers/consumers, including raw literals?
- [ ] Did I compare with mature siblings, applicable decisions, and old behavior?
- [ ] Did I evaluate boundary, malformed, repeat, failure, retry, and lifecycle cases?
- [ ] Did I apply every relevant risk-route and repository-area checklist?
- [ ] Did I map each changed invariant to a real, non-tautological assertion?
- [ ] Did I verify every finding with a concrete path and wrong outcome?
- [ ] Did I separate confirmed findings from residual risks/open questions?
- [ ] If I fixed issues, did I add coverage and review the complete corrected diff?
- [ ] Did I run proportionate focused/full/physical validation after convergence?
- [ ] Does the response lead with severity-ordered findings or explicitly say no findings?

## Where defects hide

Unchanged lines next to changed ones; the last third of a large diff; anything
annotated "for now", "assume", "should never", or `TODO`; validation that lives in a
test instead of the code; and any place the handoff note says "unchanged" without a
diff to prove it.

## Heavyweight reviews

Blast-radius changes (production deployer, OPFS install/uninstall paths, harness
budget/evidence checks) may get multi-agent or adversarial treatment at the human's
request — see [workflow.md](workflow.md#when-to-go-heavy). The procedure above is
still the per-agent unit of work inside that escalation; the escalation adds independent
passes and challenge rounds, not a different checklist.
