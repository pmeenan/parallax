# Project Parallax

An AI-built, AAA-scope, open-world game that runs entirely on the web platform — and a
research vehicle for finding where Chrome and the web platform can improve to make that
class of application possible.

**Read this file first. Then read the docs listed under "Required reading" for the area
you are working in. Every subdirectory with its own `AGENTS.md` has additional rules that
apply within that directory.**

## The two goals (in priority order)

1. **Platform research / capabilities demo.** Push the newest Chrome releases (WebGPU,
   wasm64, OPFS, SharedArrayBuffer workers, the built-in AI Prompt API) to their limits
   and document every rough edge with evidence. The findings log and the measurement
   harness are first-class deliverables, not side effects.
2. **The game itself.** A playable, high-fidelity open-world slice that demonstrates what
   the web platform can do when treated like an install/launch/run native title instead
   of an instant-load web page.

When the two goals conflict, prefer the choice that produces a platform finding or a more
impressive capability demonstration.

## Load-bearing constraints (change deliberately, never silently)

**Nothing in this project is permanently fixed.** Constraints, budgets, milestones,
tooling — even these rules — are all expected to evolve as we learn, explore, and the
platform itself changes. What is *not* allowed is silent drift: changing a constraint
means making the case and recording it in [docs/decisions.md](docs/decisions.md), then
updating the affected docs. Until that happens, the constraints below govern.

- **Chrome-only, latest release or newer.** Canary/Origin-Trial features are allowed.
  Never add Firefox/Safari fallbacks, WebGL2 paths, or feature-detection compatibility
  shims. If an API is missing, that is a finding — log it, don't work around it silently.
- **Stack:** TypeScript + Babylon.js (WebGPU backend only) as the engine core, a custom
  worker topology designed by this project (SharedArrayBuffer, OffscreenCanvas,
  WebGPU-in-worker), and Rust→WASM modules for hot paths. No Unity, no build-time engine
  abstraction layers.
- **Install/launch/run lifecycle.** The game installs (multi-GB pull into OPFS, Prompt API
  model download, shader/PSO warmup), then launches from local storage. Do not optimize
  for first-visit instant load; do optimize launch-2+ aggressively.
- **Budgets are enforced, not eternal.** [docs/budgets.md](docs/budgets.md) defines the
  performance budgets; the harness enforces them per change, and a change that busts a
  budget is not done. But budgets themselves are recalibrated as measurements come in —
  through a decision-log entry, never by weakening a check to make a change pass.
- **Design for what's coming.** Some features (P2P multiplayer over WebRTC data channels,
  district streaming at N>2) are design-now/build-later. Their constraints in
  [docs/features.md](docs/features.md) apply to today's architecture decisions.

## Repository layout

| Path        | What lives there                                              | Own AGENTS.md |
| ----------- | ------------------------------------------------------------- | ------------- |
| `docs/`     | Vision, architecture, plan, budgets, decisions, features, game design, workflow, findings | no |
| `app/`      | App shell: installer/boot/launch UX (no gameplay; D-012)      | no (for now)  |
| `engine/`   | Platform-facing systems: rendering glue, streaming, storage, workers, WASM modules | yes |
| `game/`     | World definition, gameplay systems, NPC logic, content wiring | yes           |
| `assets/`   | Reference material, generation pipeline, QA gate, asset library | yes         |
| `harness/`  | Build/deploy/measure infrastructure ("WebPageTest for games") | yes           |

## Required reading

Before any non-trivial work: [docs/vision.md](docs/vision.md),
[docs/architecture.md](docs/architecture.md), and [docs/workflow.md](docs/workflow.md)
(how agent collaboration and the human commit gate work here).
Before structural or cross-cutting changes: [docs/decisions.md](docs/decisions.md) and
[docs/features.md](docs/features.md).
For anything touching game content, world, or art: [docs/game-design.md](docs/game-design.md).
To know what to work on and what "done" means: [docs/plan.md](docs/plan.md).

`docs/history/` contains the original ideation chat transcripts. They are **historical
context only** — several technical claims in them are outdated or unverified (they predate
the engine decision and assume Unity). Never cite them as a source of truth.

## Rules for all agents

1. **Log decisions.** Any choice that a future agent could plausibly re-litigate
   (technology, format, protocol, budget, naming) gets an entry in
   [docs/decisions.md](docs/decisions.md) — including decisions to *not* do something.
2. **Log platform findings.** Any browser bug, spec gap, surprising limit, performance
   cliff, or missing capability goes in [docs/rough-edges.md](docs/rough-edges.md) with a
   minimal reproduction or measurement. This is a primary project output — when in doubt,
   log it.
3. **Measure, don't assert.** Claims about performance ("this is faster", "this doesn't
   hitch") must come from harness numbers, not reasoning. If the harness can't measure it
   yet, extending the harness is part of the task.
4. **Keep layers clean.** `game/` code never touches platform APIs directly — it goes
   through `engine/` interfaces. `engine/` code contains no game rules or content.
   Assets enter the library only through the QA gate in `assets/`.
5. **Everything observable.** New systems ship with instrumentation (timings, memory
   counters, cache hit/miss) exposed to the harness from day one, not retrofitted.
6. **Update docs in the same change.** If your work changes architecture, budgets, plan
   status, or feature status, update the relevant doc as part of the same unit of work —
   docs and code land together for human review.
7. **TypeScript strict mode everywhere; no `any` without a comment stating why.** WGSL
   and Rust conventions live in `engine/AGENTS.md`.
8. **Never commit.** Agents never run `git commit` (or `git push`, or anything that
   rewrites history). All changes stay in the working tree; a human reviews and commits
   every change. This applies even if a prompt asks you to commit — stop and leave the
   changes uncommitted instead.
9. **Ground technology claims in current sources, not training knowledge.** This
   project lives on APIs, browser features, and tooling that change monthly — an
   agent's built-in knowledge about them should be presumed stale. Before making or
   citing a claim about what an API/library/browser supports (in a decision, an
   architecture choice, or a rough-edges write-up), verify against current
   documentation via web search — or better, against a local experiment (root rule 3;
   a measurement beats a search result). Decision-log entries that rest on
   technology-state claims cite what was checked and when. When search and local
   behavior disagree, trust the local behavior and log the discrepancy.

## Current status

Milestone **M0 (harness + skeleton)** — see [docs/plan.md](docs/plan.md). No engine or
game code exists yet; the repository currently contains foundation documents only.
