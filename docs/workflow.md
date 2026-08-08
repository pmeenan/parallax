# Development workflow

How AI agents and the human developer collaborate on this repository. Complements the
root `AGENTS.md` rules (especially: agents never commit — rule 8).

This is an MVP/demonstration project — a small number of users, no SLA, reversible
deploys. The process is sized for that: the default path from idea to commit is
**one agent, one pass, one human scan**.

## The loop

1. **Build.** One agent implements the task (scope from [plan.md](plan.md)), runs the
   repo's checks (`pnpm check` — build, Biome lint, Vitest unit tests — plus one
   physical `pnpm harness:smoke` when the change qualifies under the
   [physical-gate cadence](#validation-and-physical-gate-cadence) below), and ends
   with a short note: what changed, what was verified.
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
- **Scratch files stay out of the tree.** Temporary scripts/outputs go to the session
  scratchpad, not the repo.
- **Fix the docs the change makes wrong** (status paragraph, plan checkbox, affected
  doc) in the same change. Nothing more is owed.

## Reviews happen on demand, not by default

The human asks for a review when a change warrants one. When asked:

- One agent, one pass, over the whole uncommitted diff.
- Hunt real defects — data loss or corruption, security, broken behavior — not style,
  ceremony, or missing log entries.
- Findings are file:line claims ranked by severity. A clean review is a valid result.
- Fix what you find directly unless the human asked for a report only.

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
For each post-M2 production candidate whose standing D-157 impact trigger
fires, install any changed versioned config, deploy the exact candidate, and require
local plus public header/artifact checks and the final production-target harness gate
to pass before acceptance. D-153's M2 closure is not reopened by documentation-only work.
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
4. In a clean scratch checkout or worktree at the recorded base commit, apply the
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

“Per change” means per final reviewable candidate whose changes can affect the selected
scenario's exercised or evaluated surface, not after every edit or review exchange
(D-157).

- During implementation and review correction, run the focused tests, typecheck, and
  lint checks that cover the changed surface. Run `pnpm check` once after implementation
  and review corrections converge. Rerun that full gate only when a later change alters
  a qualifying input after the gate; do not rerun it after every intermediate edit or
  review exchange (D-145).
- Run one physical-console `pnpm harness:smoke` after code and review fixes converge
  only when the candidate can affect a path the current smoke actually executes, a
  value it collects, a validator/report contract it applies, or a smoke-specific
  budget/reference input. Current exercised subsystems are the six-launch boot/launch
  core, greybox rendering, world streaming, simulation replay/save-load, SAB transport,
  Rust/Wasm threads, render callback pacing, all-worker heap, Dawn pipeline cache, PSO
  warmup, serving/environment identity, telemetry, and report finalization.
- A changed build artifact or digest is not sufficient by itself. Changes isolated to
  non-exercised or specialized-scenario-only code use their own focused verification
  and do not require routine smoke. Changes to smoke harness logic, its collector,
  mandatory contract, budget, browser/tool input, or registered-machine descriptor do
  require smoke when they can affect the smoke result.
- Record the impact decision in the handoff as `Physical smoke: required — <affected
  surface>` or `Physical smoke: not required — <why no current smoke surface is
  affected>`. Trace imports, runtime startup, telemetry, validators, and budget
  consumers to decide; do not infer impact solely from filenames or artifact drift.
- After a completed qualifying run, D-119 permits the narrow evidence-only closure
  needed to mechanically record that exact report's path, digest, schema, mandatory
  metric set, and verdict and update status pointers. It requires no new physical run
  only when it changes no built runtime/browser behavior, harness or measurement logic,
  budget/threshold, mandatory evidence contract, runtime/tool/browser pin,
  reference-machine descriptor, or claim beyond the report. The measured identity
  remains the report's own source tuple and runtime artifact; this exception prevents
  an infinite run → document → rerun loop and does not weaken any applicable D-157 gate.
- Keep opt-in diagnostics on their documented triggers. In particular, run the V8
  lifecycle diagnostic only under D-095. Run
  `pnpm harness:branded-parity -- --target https://parallax-web.com` on physical-console
  dev-01 when assessing/adopting a Chrome pin or the browser portion of the standing
  dependency checkpoint, not on an unrelated weekly schedule (D-150). This separate
  opt-in result reuses the exact current six-launch smoke core and mandatory facets with
  the registered installed branded executable, but is baseline-ineligible,
  nonpromotable, and not budget-authoritative; see `harness/AGENTS.md` for its fail-closed
  identity contract.
- D-124 closes D-122/D-123's consumed streaming-tail experiment. Both invalid,
  non-qualifying reports and consumption records remain machine-local evidence, and
  both dirty measured sources have independently verified D-099 bundles. D-123
  retained five valid attempts plus one null fresh-repeat-2 attempt after
  `control 8 timestamps are misordered`; no retry is authorized. The valid observations
  localize application-visible cross-realm waiting but cannot distinguish browser/OS
  scheduling or GPU completion, so D-116 remains unchanged and RE-043 stays open.
- The temporary command, protocol, controls, timing/correlation ring, worker/telemetry
  hooks, public methods, runner, validator, and tests are removed under the closed-
  experiment rule. Rebuild, deploy, and verify the cleaned production artifact after
  review convergence, then run one final D-097 physical-console production smoke.
  That smoke qualifies the converged D-121 candidate; it is not a diagnostic retry.
- D-125 retains that final cleaned-candidate smoke as failed and denies a blind retry.
  Its batch-atomic render transaction correction requires review, deterministic rebuild,
  production deployment/verification, and exactly one post-correction D-097 smoke.
  Any failure is retained and adjudicated before another run.
- D-126 retains D-125's post-correction smoke as failed after all 30 absolute checks
  passed but fresh streaming p95 spread reached 1.250 ms. No retry is authorized.
  The remaining two-phase batch transaction becomes one ordered render
  request/response, with reverse rollback on mutation/enqueue failure and ordinary
  streaming-worker timeout plus renderer teardown after response loss. Review,
  deterministic rebuild, exact production verification, and exactly one post-D-126
  D-097 smoke are required. Any failure is again retained and adjudicated.
- D-127 records that one post-D-126 production smoke as passed under D-119's
  evidence-only closure. Exact pre/post production identity, all six launches, all
  three facets, and 30/30 checks passed; both D-116 cohorts were within the unchanged
  1 ms allowance. The baseline remains untracked. No additional physical, public,
  flythrough, recovery, or V8 run is required for the production item. M2 remains open
  and Installer UX is next.
- D-134 retains D-133's first production smoke as failed after all six mandatory
  all-realm heap checks rejected the eager installer worker as an unknown CDP target.
  This is deterministic harness drift, not an intermittent failure, so no
  same-artifact classification retry is authorized. After the shared exact
  build-manifest-v13 target resolver, deterministic gates, and adversarial review
  converged, exact production identity was verified and the one corrected D-097 smoke
  passed all six launches, all three facets, and 30/30 checks. The baseline remains
  untracked and no retry ran. Final independent review accepted D-133 after
  recomputing the retained hashes, exact identity, raw eight-realm heap samples,
  high-waters, repeatability, and all 30 checks.

D-115 completes M1's public Benchmark mode task on its implementation and fail-honest
result contract. The two complete page-only reports remain failed under their unchanged
10% repeat-variance checks and their budget facets remain `not-evaluated`; neither is a
performance pass. Because the public continuous-page artifact is intentionally advisory
and incomparable with the authoritative fresh-profile flythrough, D-115 supersedes
D-110's requirement that it eventually pass as a second M1 qualification.
D-115's authoritative M1 evidence is explicitly versioned: D-102's passing
schema-v4/metric-set-v4 flythrough is the long-window anchor, not a claimed then-current
schema-v12 pass; D-104's qualifier, post-D-108 physical lifecycle evidence, and the
final current smoke bridge the later mandatory/runtime changes without altering any
retained verdict. D-116 preserves the first schema-v44/metric-set-v21 smoke as failed:
its six runs and 30 individual budget checks completed, but the newly introduced
pure-relative short-smoke streaming verdict was uncalibrated around ~2 ms. The final
schema-v45/metric-set-v22 smoke reuses the same six core-run p95 samples and requires
absolute spread no greater than `max(10% × minimum cohort p95, 1 ms)` separately for
fresh and warm. It adds no launch or measurement time, does not relabel the failed v44
artifact, and does not turn the failed post-D-108 ten-minute variance into a pass.

Do not run another 30-plus-minute public benchmark or privileged M1 diagnostic for this
milestone. The D-110 full reruns and D-111/D-113 diagnostic are consumed, and D-114
removed the closed apparatus. D-116's converged D-097 `smoke@1` completed the final M1
exit action; that milestone completion does not waive an applicable D-157 impact
trigger for a subsequent candidate. Do not rerun the already qualified flythrough or
render-recovery scenario. A future public benchmark invocation
requires an ordinary direct product/research trigger under D-115's reopen conditions,
remains subject to the unchanged schema-v3 metrics, and is not a deferred M1 gate.
Keep sending the ordinary F15 wake immediately before each Windows Chrome launch;
D-114 removed only the broken diagnostic-specific execution-state lease.

D-117's post-M1 cleanup removes the unconsumed memory64 experiment and records the
resulting build/telemetry envelope versions without changing a metric set, budget, or
measurement semantic. Because it changed the built app/engine artifacts and manifest/
telemetry contracts, one ordinary D-097 physical `smoke@1` ran after all D-117,
D-118, D-120, and bulk-review fixes converged. External review then produced one final
runtime/harness fix candidate. Its schema-v47 / metric-set-v23 report
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-39-01-804Z.json`
(SHA-256
`ec70dfdb8a34622641bb976d2e1b41a083653bce87a78ded9c179401842d2f4e`)
passed all six launches, all three facets, and 30/30 checks. No benchmark, flythrough,
recovery, privileged diagnostic, or additional smoke is pending. This is post-M1
candidate qualification and does not reopen M1. A future concrete module
meeting D-117's reopen rule starts a new bounded experiment under the then-current
cadence.

RE-044 retains the preceding same-artifact attempt
`smoke-1-8e932618990f-dev-01-showcase-2026-07-26T12-35-18-277Z.json`
(SHA-256
`91d839dddf16644dafb3576b5f4a06e6551ee06219bb88527423d915caaa5827`),
which failed before the first measured run when streaming provisioning reported
`Failed to fetch`. The one immediate unchanged-artifact classification retry above
passed; it does not relabel or erase the failed attempt.

Every failed report remains evidence. For an intermittent RE-008/RE-036-class failure,
retain it and run one immediate same-artifact retry for classification. The retry is a
separate result, cannot turn the failed report green, and does not justify repeated
passes outside a bounded diagnosis.

Only a pinned-Chrome run on registered dev-01 at its physical console carries a budget
verdict (D-150). Remote and other-machine runs are advisory and cannot replace the final
qualifying dev-01 run or invalidate its acceptance.

Immediately before every Chrome context launch in a Windows physical-console gate,
including identity/reference launches and every measured attempt or repeat, wake the
local display with the harness preflight (`WScript.Shell.SendKeys("{F15}")`) and verify
the monitor is visibly awake. The inert F15 key is sent before Chrome starts so it
cannot affect the scenario. A sleeping display can change presentation timing or make
visual readback evidence unrepresentative even when the session remains locally
interactive; one wake before a multi-minute sequence is insufficient.
