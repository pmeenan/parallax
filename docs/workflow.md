# Development workflow

How AI agents and the human developer collaborate on this repository. Complements the
root `AGENTS.md` rules (especially: agents never commit — rule 8).

## The loop

1. **Initial work** — one agent implements a task in a **clean working tree** (fresh
   from the last human commit). Scope comes from [plan.md](plan.md) checkboxes.
2. **Review passes** — other agents review and iterate on the in-flight changes,
   **one agent at a time** (serial, never parallel — there is one working tree and
   uncommitted state is shared). Each reviewer either improves the change or reports
   findings for the next iteration.
3. **Human gate** — iteration continues until the developer is satisfied; the developer
   commits. Nothing is ever committed by an agent. The human operates at the level of
   direction: managing agents, making architecture decisions, guiding reviews, and
   scanning changes and results — not reading every line before commit. Line-level
   review is the job of the AI review passes (D-049).

## Rules that make the loop work

- **One stream of work at a time.** Don't start unrelated task B while task A's changes
  are uncommitted, and never assume the tree is clean — check `git status` first; if
  there are changes you didn't make, you are probably an iteration/review agent in step
  2, not the initial agent in step 1.
- **Leave the tree explainable.** Every agent ends its turn with a summary of what
  changed and why, plus what it verified (harness numbers where relevant — root rule 3).
  The next agent (or the human) must be able to pick up from the message alone.
- **Scratch files stay out of the tree.** Temporary scripts/outputs go to the session
  scratchpad, not the repo.
- **Docs move with code** (root rule 6): plan checkboxes, decision log, and affected
  docs are updated within the same in-flight change, so the human commit is coherent.
- **Verification before handoff:** the initial agent runs the relevant harness checks
  before declaring work review-ready; reviewers re-run them when the change affects
  measured behavior.

## Milestone work: tech-lead mode (D-026)

A prompt like "start work on M0" makes you the **tech lead** for that milestone. That
means:

- **Scope a task-sized unit of work (D-049).** Pick the next unblocked plan.md task in
  dependency order and take it whole — a full task is the default unit; a full
  milestone is acceptable when its tasks are tightly coupled. Don't fragment work into
  small chunks to fit a human line-by-line reader (review is AI-led per D-049), and
  don't sprawl the working tree across unrelated tasks; the human gate still closes
  each unit.
- **Delegate deliberately.** Spawn subagents for well-scoped pieces, choosing each
  subagent's model and reasoning effort to match its task. The working tree is shared:
  subagents that write must run serially or own disjoint files; parallelize freely only
  for read-only work (research, code reading, verification).
- **You own acceptance.** Review every subagent's output and don't accept it until it
  meets the bar. Acceptance means evidence, not reading: run the checks yourself —
  typecheck, tests, harness numbers where behavior is measured (root rule 3). A
  subagent reporting success is an assertion, not a measurement.
- **You own the cross-cutting rules.** Decision-log entries, rough-edges findings,
  docs moving with code, budget compliance — delegating work never delegates these.
- **Adversarial review before handoff.** When you believe the unit is complete, run a
  fresh-context review over the full working-tree diff, briefed to find problems —
  correctness, layer violations, missing docs/instrumentation/telemetry, rule breaches
  — not to summarize or approve. For task-sized-or-larger diffs, use the multi-agent
  review structure from reviewer mode below (review lead + piecewise subagents +
  adversarial challenge). Address every finding worth addressing, re-verify, and
  re-review if the fixes were substantial.
- **End with the handoff summary** (rule above): what changed and why, what was
  verified and how, what remains open.

## Review passes: reviewer mode (D-027)

Any prompt requesting a review of uncommitted modifications (e.g., "review the current changes", "take a look at the changes", "review my edits", "check the modifications") triggers **reviewer mode** (step 2 of the loop). The unit under review is the **entire uncommitted working tree** — the diff against the last commit plus untracked files — including whether the docs that should have moved with the change actually did.

- **DO NOT simply summarize the changes.** The user is not asking for a diff description. You must perform an active, critical code review looking for correctness, logic errors, code quality issues, and rule compliance.
- **Read-only by default.** You report; the agent that did the work owns the fixes. Don't edit the tree unless the human explicitly asks you to fix directly.
- **Structure the review as a team (D-049).** Work units are task-sized or larger, so a
  single context reading the whole diff is not the model. You are the **review lead**:
  1. Partition the diff into pieces sized for one subagent to review deeply — by
     subsystem, file cluster, or concern; you judge what is bite-sized.
  2. Spawn a reviewer subagent per piece. They are read-only, so run them in parallel.
  3. Merge and deduplicate their findings, then **verify each surviving finding
     yourself** before it enters the report — subagent findings are claims, not facts.
  4. Spawn an **adversarial challenge subagent** against the merged review, briefed to
     attack it from both sides: refute findings that don't hold up, and hunt for what
     the piecewise reviewers missed — especially cross-cutting issues that span piece
     boundaries (interface mismatches, duplicated logic, inconsistent conventions,
     docs/decision entries the whole change should have produced).
  5. Fold the challenge results in (dropping refuted findings, verifying new ones)
     before writing the final report.

  A diff small enough for one deep read may skip the fan-out (steps 1–3) but never the
  adversarial challenge.
- **Review thoroughly, not just for bugs.** Correctness first, then check:
  - Root and directory `AGENTS.md` rule violations (e.g., layer violations, lack of instrumentation/telemetry, determinism).
  - Missing decision-log entries ([decisions.md](decisions.md)) or rough-edges entries ([rough-edges.md](rough-edges.md)).
  - Budget implications ([budgets.md](budgets.md)).
  - **Better approaches**: If there is a simpler, more idiomatic, or measurably better way, report it as a suggestion, clearly distinct from a defect.
- **Verify before you report.** Run the verification checks to validate behavior instead of guessing:
  - Run `pnpm check` (which builds, lints via Biome, and runs unit tests via Vitest).
  - Or run individual checks: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`.
  - Run the harness via `pnpm harness:smoke` when measured performance or runtime behavior has changed.
- **Write findings for handback.** The report goes verbatim to the implementing agent, who has the tree but not your conversation — each finding must be self-contained:
  - **Location**: Specific file and line number range.
  - **Details**: What the issue is, why it matters, and severity.
  - **Suggestion**: A concrete suggested fix, phrased as a claim to **verify** ("X appears to break Y when Z — verify and fix, or rebut with evidence"), not a command.
  - **Priority**: Rank findings most-severe first.
- **A clean review is a valid result.** If nothing survives verification, say so plainly — don't manufacture findings to look thorough.

## Findings handback: fix-pass mode (D-030)

A prompt that hands you review results or findings ("here are the review findings —
address them") makes you the **fix-pass agent**: the findings came from a reviewer
(step 2), and you now own the tree.

- **Verify independently before fixing.** Each finding is a claim to verify, not an
  order (that's how reviewer mode phrases them). Confirm the problem yourself — read
  the code, run the check — before changing anything.
- **Fix what's confirmed** at the root cause, with docs moving alongside (root rule 6),
  and re-run the relevant checks afterward.
- **Push back where appropriate.** A finding that doesn't survive your verification
  gets a rebuttal with concrete evidence (code reading, test, measurement), not a
  grudging fix or a bare disagreement. "Won't fix" carries the same burden of proof
  as a fix.
- **End with a per-finding disposition:** fixed (what changed, how verified) or
  rebutted (the evidence). Write it self-contained — it goes verbatim to a
  verification pass that has the tree and your report but not your conversation.

## Fix verification: verify-pass mode (D-030)

Any prompt requesting to check or verify fixes (e.g., "verify the fixes", "check the fixes", "verify fixes", "verify the resolved issues") triggers **verify-pass mode**. The verification agent evaluates a fix-pass agent's changes and disposition report against the current working tree.

- **Retrieve the context first.** If the original findings and disposition report are not fully detailed in the current prompt, retrieve them from whatever session/conversation logs your agent runner keeps (runners differ — some expose transcript files, some don't); if you can't recover them, ask the human for the findings rather than guessing.
- **Verify each fix against the tree, not the report.** Run actual tests and compilation commands (`pnpm check`, `pnpm typecheck`, or `pnpm harness:smoke`) to confirm the change actually resolves the finding and didn't introduce a regression.
- **Adjudicate each pushback independently.** Evaluate the rebuttal's evidence on the merits; accept it, or make the evidence-backed case for why the finding stands.
- **Read-only by default,** like reviewer mode — report, don't fix, unless the human explicitly asks you to fix directly.
- **Report a per-finding verdict:**
  - `fix verified`
  - `fix incomplete or wrong (with evidence)`
  - `pushback accepted`
  - `pushback rejected (why the finding stands)`
  - All verdicts positive is a valid result — don't manufacture disputes.
