# Development workflow

How AI agents and the human developer collaborate on this repository. Complements the
root `AGENTS.md` rules (especially: agents never commit — rule 8).

This is an MVP/demonstration project — a small number of users, no SLA, reversible
deploys. The process is sized for that: the default path from idea to commit is
**one agent, one pass, one human scan**.

## The loop

1. **Build.** One agent implements the task (scope from [plan.md](plan.md)), runs the
   repo's checks (`pnpm check` — build, Biome lint, Vitest unit tests — plus relevant
   focused or specialized checks), and ends with a short note: what changed, what was
   verified. The exact converged milestone candidate receives one physical
   `pnpm harness:smoke` as the final milestone-exit gate under the
   [physical-gate cadence](#validation-and-physical-gate-cadence) below.
2. **Commit.** The human scans the note and the diff at whatever depth the change
   warrants, and commits. Agents never commit.

That is the whole gate. There are no mandatory review passes, no multi-agent review
structure, and no verification-of-the-verification.

## Ground rules

- **Agents never commit** — even if a prompt asks. The working tree is the handoff.
- **Don't hand off broken.** Checks pass before you end your turn; if they don't, say
  so plainly instead of papering over it.
- **One stream of work at a time.** Check `git status` first; if there are changes you
  didn't make, you're iterating on in-flight work, not starting fresh.
- **Use the main checkout by default.** Do not create worktrees unless the human
  explicitly requests them. If requested, bring the final changes and retained evidence
  back to the main checkout and remove temporary worktrees before handoff. Preserve
  unique work before cleanup; agents still never commit or rewrite history.
- **Scratch files stay out of the tree.** Temporary scripts/outputs go to the session
  scratchpad, not the repo.
- **Fix the docs the change makes wrong** (status paragraph, plan checkbox, affected
  doc) in the same change. Nothing more is owed.

## Bounded visual and research work

D-182 replaces D-180's open-ended convergence rule with agent-owned, bounded iteration.
Before an experiment or visual work package, put a short brief in the active plan note:
the scene/reference and cameras/states, the question, must-fix defects, an initial
allowance, and the decision that ends the work. Default to at most two implementation/
capture/evaluation cycles for an initial experiment; a cycle makes a concrete change,
captures it, and evaluates it. Also state a finite work-session or elapsed-effort limit
appropriate to that package so a cycle cannot hide an unlimited implementation task.
These are planning limits, not runtime performance budgets.

Use established implementations on the exact pin first. A competing implementation or
new evidence tool needs a named visual/capability gap, measured bottleneck, or recurring
workflow need. Inspect actual Chrome output, motion, composition, material integration,
readability, and artifacts against the selected references. Agents fix the brief's
defects autonomously; subjectivity is not an excuse to skip inspection. Integrate the
best supported candidate into the ordinary game before enlarging an isolated spike.

At the allowance boundary, record one outcome: integrate/adopt with measured evidence
and required human artistic acceptance; extend with a specific unresolved question,
expected payoff and a new finite allowance; or defer with the limitation and reopening
trigger. An agent may make a justified extension within authorized scope, but may not
silently reset allowances. An unmet required scene outcome remains open; defer the
technique, not the acceptance requirement. Time expiry never grants quality acceptance.

Human visual verification remains the artistic acceptance boundary for each delivered
effect and visually decided outcome. Handoffs contain representative stills/sequences,
exercised states, measured costs, known compromises, and close alternatives. Fixes from
human feedback begin another bounded work package. An optional further improvement is
backlog work once the agreed outcome is accepted; it is not an automatic reason to
keep iterating. Film-quality references apply to chosen signature moments at the stated
scale, not every possible effect variant before the first playable scene.

## Delivery feedback and tooling cost

During active development, the weekly handoff links the latest playable build and
before/after captures, describes growth or improvement of the finished area, and names
the largest blocker plus actionable platform findings (if any). Keep this in the live
plan note; retain detailed evidence in result artifacts and decision/finding records.
No separate recurring report system or unattended automation is required.

For the first two-week M4.5 trial, sample edit-to-visible-result time across normal
material/lighting/asset changes and record asset throughput as accepted kit pieces or
animations per work session, including rework. Separate build/launch/capture waiting
from implementation and visual inspection. Use the observations to choose the next
tooling improvement and revise the delivery estimate; these are not pass/fail gates.

Reuse deterministic cameras, parameter tuning, capture, timing, and report utilities
across tracks. Keep rapid visual iteration close to production rendering while retaining
exact release/PSO verification for qualified evidence. Build new machinery only when it
answers the active question or saves repeated measured effort. Keep current operating
instructions short and link historical evidence instead of copying run narratives into
each handoff. Decision entries remain for load-bearing choices; routine experiment
briefs and tuning outcomes belong in plan notes/results. D-181's focused-check and
milestone-exit smoke cadence is unchanged.

## Reviews happen on demand, not by default

The human asks for a review when a change warrants one. When asked:

- Read [review.md](review.md) completely before inspecting the change. It is the required
  procedure, not optional advice. The review covers the whole uncommitted unit: tracked,
  staged, deleted, renamed, and untracked files, including unchanged consumers whose
  assumptions the diff may invalidate.
- One agent performs one complete pass by default. “One pass” means one end-to-end
  inventory → contract trace → adversarial analysis → finding verification → corrected-
  diff recheck. It does not mean one visual scan of the hunks.
- Start from intent and contracts: the request, active plan item, applicable decisions,
  architecture, budgets, and directory instructions. Then trace every changed identity,
  schema, tag, event, command, counter, state field, artifact, and public boundary to all
  producers and consumers. A green `pnpm check` is supporting evidence, never a substitute
  for that analysis.
- Hunt concrete defects: data loss/corruption, security or trust-boundary failures,
  wrong behavior, nondeterminism, lifecycle/concurrency faults, invalid evidence, budget
  regressions, leaks, and contract drift. Style, preference, ceremony, speculative
  refactors, and missing decision entries without a present correctness consequence are
  not findings.
- Verify each candidate before reporting it. A finding names the tightest `file:line`,
  precondition or input, execution path, wrong outcome, violated contract, and severity.
  Unproved suspicions go under residual risk/open questions, not into the findings list.
- Findings come first, ordered by severity. A clean review is valid only after the guide's
  completion checklist is satisfied; say “no findings” explicitly and record meaningful
  residual risks or unrun validation. Do not pad a clean result with style comments.
- Fix confirmed findings directly unless the human asked for a report-only review. Add a
  regression test that fails for the identified mechanism, re-read the resulting complete
  diff, and follow the focused/full/physical validation cadence below.

## When to go heavy

Some changes carry real blast radius: anything that can destroy user data, corrupt a
published artifact, or open a security hole. In this repo that means the production
deployer (`deploy/` — the `:apply` commands destructively replace the live webroot
and published model content), the OPFS install/uninstall storage paths that delete or
rewrite a user's multi-GB install, and the harness budget/evidence checks (a weakened
check silently green-lights every later change). For those the human may explicitly
ask for the heavyweight treatment — multi-agent review, an adversarial challenge
pass, fix/verify rounds. That escalation is the human's call to make; agents don't
self-escalate beyond one pass.

## Machine-local pinned-tool registry

`.parallax-toolchain.local.json` records where this checkout's manually installed or
downloaded pinned tools and libraries actually live. It is deliberately ignored because
it contains host-specific absolute paths. At the start of work that needs an external
tool, read this file before searching caches or downloading another copy.

The registry is a location cache, not a version manifest. Checked-in sources such as
`.nvmrc`, `package.json`, `rust-toolchain.toml`, Cargo manifests, and
`harness/chrome/stable.json` remain authoritative. Before first use in a chat, confirm
that the recorded path exists and that the executable reports the checked-in version;
do not accept a stale registry entry or change a project pin to match it.

Any agent that downloads, installs, upgrades, relocates, or removes a pinned tool or
library outside the normal reproducible package install must update the registry in the
same turn. Preserve its JSON shape and record the tool ID, exact version, absolute path,
role/status, authoritative pin source, and verification date. Create the file if it is
absent on a new machine. Never put credentials, tokens, environment dumps, or other
secrets in it.

## Production deployment

Production serving/deployment is versioned under `deploy/` (D-121). Run
`pnpm deploy:production` for the default read-only preview: it rebuilds and verifies
`dist`, prints local/remote inventories, and validates the fixed `plex` webroot.
`pnpm deploy:production:apply` is the fixed explicit destructive command. Its package
script launches a fixed no-argument wrapper, which invokes the bounded deployer in the
same PowerShell process with real `Deploy` and disabled `Confirm` switch values. It
uses no pnpm argument forwarding and exposes no remote host, path, or deletion target.
It requires the
documented owner/mode invariant, stable target inode, no webroot/descendant mounts, and
an exclusive lock inside `/var/www/parallax-web.com`; it removes only non-lock children,
preserves the exact D-130 model set inside that private lock, copies the frozen verified
`dist`, restores the model objects, and proves the exact combined remote path/size/hash
inventory before success. It refuses destructive replacement when the pinned model set
is absent, wrong, unsafe, or accompanied by model-prefix extras. The fixed webroot is
exclusively Parallax-owned exact-inventory storage: unrelated and ACME HTTP-01 challenge
files must use another location. A retained deployment lock fails preview with its path;
follow the manual recovery procedure in `deploy/README.md` instead of deleting it.
`pnpm deploy:model-content` is the separate fixed-target read-only preview that
stream-verifies the exact five local model shards; only the fixed
`pnpm deploy:model-content:apply` command uploads missing/wrong objects privately and
publishes them after remote size/hash verification. Its corresponding fixed
no-argument wrapper supplies the same in-process switch values without pnpm argument
forwarding or configurable targets and never deploys the frozen `site/` placeholder.
Review
[`deploy/README.md`](../deploy/README.md) before use.

The deployer cannot install `/etc/nginx` configuration or reload nginx. Those are
separate human-admin actions using the exact rollback-safe installer command in
`deploy/README.md`. The portable unit gate executes the mocked production and model-
content deployment safety suites; optional POSIX semantic fixtures are not required.
For each post-M2 milestone-exit production candidate under D-181, install any changed
versioned config, deploy the exact candidate, and require local plus public
header/artifact checks and the final production-target harness gate to pass before
acceptance. D-153's M2 closure is not reopened by documentation-only work.
D-154 prospectively classifies short-`smoke@1` streaming p95 cross-launch repeatability
as a non-blocking diagnostic. The final production-target gate still requires all six
launches, valid per-launch streaming evidence, all 30 unchanged budget checks, all three
facets, and exact pre/post production identity to pass; the diagnostic's invalid state
must remain visible but cannot withhold the budget verdict.

## Close experiments cleanly

When an experiment has produced a recorded decision and is no longer a selected
implementation, active plan item, platform floor, or recurring qualification gate,
remove its implementation code, dependency chain, build artifacts, fixtures, and
decision-only tests in the same change. Do not keep executable apparatus merely because
it might be convenient to rerun someday; git history can recover it.

Preserve the evidence record: tracked decision and rough-edge entries must contain the
load-bearing measurements and enough version/identity detail to understand the
conclusion. Keep raw result artifacts on their producing machine on D-081's best-effort
basis; they are not the durable record. If a future plan item reopens the question,
recover or rebuild the smallest current experiment against then-current dependencies
rather than carrying dormant code indefinitely.

**Same-gate source-identity reconstruction (D-099):** if an experiment is created and
removed inside one uncommitted human-gate unit, no commit will contain its runnable
source. Before deleting it, export an exact reconstruction bundle into the experiment's
ignored result directory:

1. Record the measured source-identity tuple: base `commit` and `dirtyTreeDigest`.
2. Capture the complete input used by `harness/src/source-identity.ts`, not a
   hand-selected experiment subset: every tracked modification/deletion relative to
   the recorded commit in an exact binary patch or source snapshot, plus every
   non-ignored untracked path returned by
   `git ls-files --others --exclude-standard`. Preserve paths, file modes, and bytes.
3. Add a manifest with every captured file payload's path, size, and SHA-256 plus
   explicit deletion entries; the result artifact digest; environment/tool pins; exact
   run command; and scenario/schema/metric-set identity.
4. In a clean scratch checkout at the recorded base commit, apply the
   bundle, restore its untracked files, and recompute source identity with the same
   harness algorithm used by the measured scenario. Both reconstructed `commit` and
   `dirtyTreeDigest` must exactly equal the measured report before cleanup is allowed.
   A bundle that merely reproduces selected file hashes is insufficient.
5. Quote all load-bearing top-line results in tracked decisions/findings/research docs,
   as D-081 requires.

The bundle is an ignored machine-local rerun aid, not durable evidence and not a reason
to keep the experiment wired into the product. Git history is sufficient without a
bundle only when the measured source identity is clean (`dirtyTreeDigest: null`) and
that commit contains the apparatus. Any non-null measured digest still requires the
complete reconstruction, even if an earlier commit contains some experiment files.
P-002 predated this guard inside the same in-flight change; its exact source was deleted
without a snapshot and cannot be reconstructed retroactively.

The ordinary source-identity algorithm deliberately excludes ignored results, caches,
installed tools, and other ignored machine state. Do not add those to the bundle merely
because they share the working directory; capture them only when the scenario defines a
separate identity contract that includes them. Because the reconstruction bundle lives
under ignored `harness/results/`, creating it does not change the ordinary
`dirtyTreeDigest`.

Apply the same test to routine diagnostics. Keep a check in every-change gates only when
it protects a current contract or budget. Valuable but non-gating investigations belong
behind a clearly named opt-in command with documented triggers. Delete checks that only
answered a settled decision.

## Validation and physical-gate cadence

Routine physical smoke is milestone-scoped, not change-scoped (D-181). It qualifies the
exact exit candidate after all milestone implementation, review corrections, docs, and
standing exit work have converged.

D-184 applies the same restraint to specialized long traversals: an intermediate plan
step does not automatically receive three ten-minute control runs and three candidate
runs. Use focused correctness probes and short representative cost windows first;
label short costs diagnostic. Start full traversal sets only for a named sustained-load
or repeatability decision, or the integrated milestone candidate where required. Add a
control set only when a qualified delta is needed. State the decision and elapsed cost
in the brief; short probes never inherit full-run budget authority or relax its gates.

- During implementation and review correction, run the focused tests, typecheck, and
  lint checks that cover the changed surface. Run `pnpm check` once after implementation
  and review corrections converge. Rerun that full gate only when a later change alters
  a qualifying input after the gate; do not rerun it after every intermediate edit or
  review exchange (D-145).
- Do not run routine `pnpm harness:smoke` for intermediate plan items, review fixes,
  artifact changes, dependency changes, or smoke-contract changes within a milestone.
  Use the narrowest deterministic test, local browser probe, contract fixture, or
  specialized scenario that covers the changed claim.
- After all milestone exit criteria and the standing dependency checkpoint are ready,
  run one physical-console `pnpm harness:smoke` against the exact candidate proposed for
  closure. The milestone cannot close without a passing report whose source/artifact,
  environment, mandatory metric set, and budgets bind that candidate.
- If the exit smoke fails, retain the immutable failed report and keep the milestone
  open. Use at most one immediate same-artifact retry when the failure may be
  intermittent (D-097). Otherwise identify the failing facet, build the narrowest
  reliable reproducer, and bisect the human-reviewed commits between the last passing
  milestone exit and the failed candidate. A physical smoke may run at selected
  bisection points only when no narrower reliable probe reproduces the failure; those
  runs are diagnostic and do not qualify an exit. After fixing the culprit and
  reconverging the exact candidate, rerun the milestone-exit smoke.
- Preserve reviewable human commits throughout the milestone so the last passing exit
  and each landed work unit form usable bisection boundaries. Agents still leave every
  work unit uncommitted for the human gate and never manipulate history themselves.
- Record ordinary handoffs as `Physical smoke: deferred to <milestone> exit — <focused
  verification>`. The milestone-closing handoff records `Physical smoke: required —
  <milestone> exit`; a failed gate also records the retained report and current
  localization or bisection status.
- After a completed qualifying run, D-119 permits the narrow evidence-only closure
  needed to mechanically record that exact report's path, digest, schema, mandatory
  metric set, and verdict and update status pointers. It requires no new physical run
  only when it changes no built runtime/browser behavior, harness or measurement logic,
  budget/threshold, mandatory evidence contract, runtime/tool/browser pin,
  reference-machine descriptor, or claim beyond the report. The measured identity
  remains the report's own source tuple and runtime artifact; this exception prevents
  an infinite run → document → rerun loop and does not weaken the D-181 exit gate.
- Keep opt-in diagnostics on their documented triggers. In particular, run the V8
  lifecycle diagnostic only under D-095. Run
  `pnpm harness:branded-parity -- --target https://parallax-web.com` on physical-console
  dev-01 when assessing/adopting a Chrome pin or the browser portion of the standing
  dependency checkpoint, not on an unrelated weekly schedule (D-150). This separate
  opt-in result reuses the exact current six-launch smoke core and mandatory facets with
  the registered installed branded executable, but is baseline-ineligible,
  nonpromotable, and not budget-authoritative; see `harness/AGENTS.md` for its fail-closed
  identity contract.

### Closed qualification history

M0–M4 and the post-M1 cleanup are closed. Their run-by-run histories are not current
run instructions. Use [plan.md](plan.md) for milestone closure pointers and
[decisions.md](decisions.md) for D-115–D-120 (M1 and cleanup), D-124–D-127 (streaming
and production corrections), and D-133/D-134 (installer-worker qualification).
[rough-edges.md](rough-edges.md) preserves the corresponding failures, including RE-044.
Reports remain immutable; this compression neither relabels failures nor authorizes
retries. Closed diagnostics remain consumed. Public Benchmark retains D-115's advisory,
fail-honest contract and requires a direct product/research reopening trigger; no old
benchmark, flythrough, recovery, or smoke rerun is pending merely from historical prose.
Current work follows the focused/specialized triggers and D-181 exit cadence above.

### Physical-console execution

Only a pinned-Chrome run on registered dev-01 at its physical console carries a budget
verdict (D-150). Remote and other-machine runs are advisory and cannot replace the final
qualifying dev-01 run or invalidate its acceptance.

dev-01 is no longer accessed through RDP. Under D-179, an agent may start a qualifying
physical-console gate without asking the developer to confirm native local access and
without waiting for a human acknowledgment. The harness-observed environment identity,
not a human attestation, remains authoritative and fails closed for remote sessions,
remote/virtual display adapters, or other registered-environment mismatches. If that
observation is invalid or ambiguous, retain the evidence and ask the developer to
restore or inspect the environment. A legacy `--physical-console-confirmed` command
token is an operator acknowledgment that this policy applies, not a claim that a human
separately confirmed the session.

Immediately before every Chrome context launch in a Windows physical-console gate,
including identity/reference launches and every measured attempt or repeat, wake the
local display with the harness preflight (`WScript.Shell.SendKeys("{F15}")`). This is an
agent-owned preflight and requires no developer acknowledgment. The inert F15 key is
sent before Chrome starts so it cannot affect the scenario; the resulting environment
and presentation evidence must still validate. A sleeping display can change
presentation timing or make visual readback evidence unrepresentative even when the
session remains locally interactive; one wake before a multi-minute sequence is
insufficient.
