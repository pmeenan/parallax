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
   commits. Nothing is ever committed by an agent.

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

- **Scope a commit-sized slice.** Pick the next unblocked plan.md checkbox(es) in
  dependency order — one coherent unit the human can review and commit. Don't sprawl
  the working tree across unrelated items; the human gate closes each slice.
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
- **Adversarial review before handoff.** When you believe the slice is complete, spawn
  a fresh-context reviewer subagent over the full working-tree diff, briefed to find
  problems — correctness, layer violations, missing docs/instrumentation/telemetry,
  rule breaches — not to summarize or approve. Address every finding worth addressing,
  re-verify, and re-review if the fixes were substantial.
- **End with the handoff summary** (rule above): what changed and why, what was
  verified and how, what remains open.

## Review passes: reviewer mode (D-027)

A prompt like "review the current changes" makes you a **review-pass agent** (step 2 of
the loop). The unit under review is the **entire uncommitted working tree** — the diff
against the last commit plus untracked files — including whether the docs that should
have moved with the change actually did.

- **Read-only by default.** You report; the agent that did the work owns the fixes.
  Don't edit the tree unless the human explicitly asks you to fix directly.
- **Review thoroughly, not just for bugs.** Correctness first, then: root and
  directory AGENTS.md rule violations (layers, instrumentation, determinism), missing
  decision-log or rough-edges entries, budget implications — and **better approaches**:
  if you know a simpler, more idiomatic, or measurably better way, report it as a
  suggestion, clearly distinct from a defect.
- **Verify before you report.** Run the cheap checks (typecheck, tests, a harness run
  when measured behavior changed) rather than speculating — root rule 3 applies to
  reviews too. Read-only subagents may be used freely to cover ground.
- **Write findings for handback.** The report goes verbatim to the implementing agent,
  who has the tree but not your conversation — each finding must be self-contained:
  where (file:line), what and why it matters, severity, and a concrete suggested fix,
  phrased as a claim to **verify** ("X appears to break Y when Z — verify and fix, or
  rebut with evidence"), not an order. Rank findings most-severe first.
- **A clean review is a valid result.** If nothing survives verification, say so
  plainly — don't manufacture findings to look thorough.
