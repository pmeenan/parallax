# Project Parallax

An AI-built, AAA-scope, open-world game that runs entirely on the web platform — and a
research vehicle for finding where Chrome and the web platform can improve to make that
class of application possible.

**Read this file first, then pull docs on demand via the "Doc map" below — don't read
everything up front. Every subdirectory with its own `AGENTS.md` has additional rules
that apply within that directory.**

## The two goals (in priority order)

1. **Platform research / capabilities demo.** Push the newest Chrome releases (WebGPU,
   wasm threads, OPFS, SharedArrayBuffer workers, the built-in AI Prompt API) to their limits
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
  WebGPU-in-worker), and Rust→WASM modules for hot paths. Wasm SIMD (128-bit) + threads
  are baseline machine requirements, and per-subsystem placement is performance-driven
  (D-032): JS/TS is orchestration and glue, with no presumption against wasm or WGSL.
  No Unity, no build-time engine abstraction layers.
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
| `site/`     | Public website: frozen placeholder landing page (D-021/D-022) | no            |

## Doc map — pull what the task needs, not everything

Always read (it's short): [docs/workflow.md](docs/workflow.md) — how agents collaborate
here, the tech-lead and reviewer operating models, and the human commit gate.

Everything else is on demand. Each doc, and the questions it answers:

| Doc | Read when the task needs |
| --- | --- |
| [docs/plan.md](docs/plan.md) | What to work on, milestone scope, exit criteria — what "done" means |
| [docs/architecture.md](docs/architecture.md) | System structure: layers, worker topology, rendering/streaming/storage, lifecycle contracts. Read before building or changing any system that touches another system |
| [docs/vision.md](docs/vision.md) | Why the project exists, success criteria, non-goals. Read when weighing scope or priority trade-offs |
| [docs/decisions.md](docs/decisions.md) | Settled choices (D-NNN). Scan the headings (or grep) and read only the entries your task touches; full read only for structural or cross-cutting changes |
| [docs/features.md](docs/features.md) | Feature matrix + design-now/build-later constraints. Read before structural changes |
| [docs/budgets.md](docs/budgets.md) | Performance budgets and measurement methodology. Read for any perf-relevant change or harness work |
| [docs/game-design.md](docs/game-design.md) | World, districts, tone, content rules. Read for anything touching game content, world, or art |
| [docs/rough-edges.md](docs/rough-edges.md) | Platform findings log. Grep it before adding a finding (avoid duplicates) or debugging platform weirdness (it may be known) |
| [docs/chrome-platform-gaps.md](docs/chrome-platform-gaps.md) | Chrome-facing synthesis of missing capabilities, prioritized asks, evidence, and why each change would help |
| [docs/why-not-unity.md](docs/why-not-unity.md) | The sourced case for Babylon over Unity (evidence pack for D-004/D-046). Read when the engine choice is questioned, or before repeating any "Unity can't do X" claim |

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
9. **Keep the always-loaded context lean.** This file is imported into every
   conversation; every line added here costs every future agent. Detail belongs in
   `docs/` behind the doc map, not here. The same discipline applies to the
   per-directory `AGENTS.md` files.
10. **Ground technology claims in current sources, not training knowledge.** This
   project lives on APIs, browser features, and tooling that change monthly — an
   agent's built-in knowledge about them should be presumed stale. Before making or
   citing a claim about what an API/library/browser supports (in a decision, an
   architecture choice, or a rough-edges write-up), verify against current
   documentation via web search — or better, against a local experiment (root rule 3;
   a measurement beats a search result). Decision-log entries that rest on
   technology-state claims cite what was checked and when. When search and local
   behavior disagree, trust the local behavior and log the discrepancy.

## Current status

Milestone **M0 (harness + skeleton)** — see [docs/plan.md](docs/plan.md) for what is
done vs. open. The build/serve pipeline, walking-skeleton app,
WebGPU-in-worker/OffscreenCanvas go spike (D-056), SAB ring-buffer go spike (D-057),
Prompt API measured no-go spike (D-059/RE-019) and sandboxed branded Prompt
production-install qualification (D-065), Harness v1's sandboxed `smoke@1` replacement
gate, and the qualified OPFS worker spike (D-066/RE-023) are complete. OPFS
repeatability remains an informational platform finding rather than a promoted
baseline; the remaining M0 spikes and exit items remain open.
Keep this paragraph current when plan.md
milestone status changes (root rule 6).
