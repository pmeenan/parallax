# Vision

## Genesis (the north star behind the experiment)

The question that started this project:

> **Could someone build a Roblox-like platform on the web where kids use AI to generate
> high-quality games of every genre — open world, side-scroller, battle — with the web
> platform never being the limiting factor?**

Parallax does not build that platform (the assets, generation tooling, and business are
whoever-builds-it's problem). It exists to de-risk the question: it stresses the
**per-game ceiling** by building the hardest case — one AAA-scope open-world game — on
the theory that if the web can host the worst case, no genre on such a platform is
blocked. Given the trajectory of LLMs, the generation side is assumed to arrive; the
open question is whether the web is ready for what they generate.

For the **platform-of-many-games** dimension, the isolation model is decided (D-010):
each published game is its own origin, with engine code, shared asset packs, and models
shared across origins via **Cross-Origin Storage** — including code and Dawn caches as
that platform work matures. COS APIs don't exist yet, so the mainline milestones build
COS-*ready*: packaged resources split between common and game-specific, and engine
builds deterministic and versioned so they're hash-shareable. The actual cross-origin
exercise is parked as [plan.md](plan.md) M8 until the APIs land. Other many-games
concerns (quota contention, instant-play, alternative origin models) are out of scope
for this exploration (D-010). Note also that the capable-consumer hardware baseline
(D-018) means this experiment answers "given sufficient hardware" — scaling down to
low-end kid hardware is a known-open follow-on, not something this POC settles.

## The immediate question

Project Parallax answers, with evidence rather than opinion:

> **Can the web platform, pushed to the edge of what the newest Chrome ships, host an
> AAA-class open-world game — and where exactly does it fall short?**

It is deliberately a *stacked* experiment: the game is built almost entirely by AI agents,
the assets are AI-generated, and the runtime targets browser capabilities that are weeks
old. Each layer is a bet; the project is structured so that every layer produces value
even if a later layer stalls.

## Deliverables (all three are the product)

1. **The rough-edges report** ([rough-edges.md](rough-edges.md)) — an evidence-backed
   catalog of where Chrome, WebGPU/Dawn, V8/wasm, storage, and the built-in AI APIs
   limit native-class games, with reproductions and proposed improvements. Audience:
   Chrome engineering and the web-gaming ecosystem.
2. **The harness** (`harness/`) — automated build → deploy → launch → measure → diff
   infrastructure for web games ("WebPageTest for games"). Independently useful, and the
   thing that makes AI-agent development converge instead of flail.
3. **The game** — a playable, visually striking open-world slice (two districts: surface
   and underground) demonstrating install/launch/run native-title behavior on the web:
   multi-GB local install, warm-cache boot, seamless streaming, on-device AI NPCs.

## What "AAA-quality" means here

It means a coherent, high-fidelity playable experience: convincing art, lighting,
motion, sound, interaction, and open-world scale working together. D-182 makes a small
finished area the next proof point, then expands its density and coverage. Broad AAA
feature coverage remains the research ambition tracked in [features.md](features.md),
but completing every advanced technique is not a prerequisite for visible progress.

Use established implementations wherever they satisfy the scene. Invent where doing
so demonstrates a meaningful browser capability or resolves a measured limitation.
Novelty can come from the combination, scale, and integration of systems; each component
need not introduce a new technique. Movie-quality references guide selected signature
moments, with explicit scope and human visual acceptance rather than an unbounded
per-feature perfection requirement.

## Success criteria

- **Platform goal:** actionable, evidence-backed findings tied to representative
  workloads, suitable for Chrome bugs, spec proposals, or design docs, with attribution
  to the responsible layer wherever observable. D-182 replaces the ≥20 finding-count
  target: useful browser improvements and demonstrated capability matter, and a
  successful workload need not manufacture a finding to count as progress.
- **Demo goal:** a stranger with latest Chrome can install (~multi-GB), relaunch to
  gameplay in seconds from fully local storage, and play at budget frame rates
  ([budgets.md](budgets.md)) — including offline.
- **Game goal:** District 1 playable end-to-end with final art; District 2 reachable
  through a hard streaming transition that stays inside the transition budget.

Milestone evidence can expose a platform capability as genuinely unobservable. A
decision may accept that documented gap for a research milestone only when the
remaining evaluated mandatory metrics pass and the claim stays narrow: `unsupported`
never means passed, and no proxy is relabeled as the missing outcome. D-115 applies
that rule to M1's Showcase greybox exit. Standard/default-experience transfer and the
unqualified presentation, worker-long-task, combined-memory, and GPU-residency claims
remain open rather than being inferred from dev-01 or callback/logical-size signals.

## Non-goals

- Cross-browser support. Chrome latest+ only, by design (D-002). Advisory benchmark
  runs of the unchanged build in other engines are research inputs, not a support
  commitment or permission to add compatibility paths (D-025).
- Low-end or mobile hardware. The baseline is capable consumer hardware; dev-01 is the
  sole enforced hardware gate. The Standard profile and macOS hardware remain
  aspirational advisory planning/research inputs (D-150); hardware is an evolving
  target and the question is what the platform supports given sufficient hardware.
- First-visit instant load, traditional Core Web Vitals, or SEO. This is an installed
  application that happens to be delivered through a browser.
- Monetization, accounts, or live-ops infrastructure.
- Building a general-purpose reusable engine. `engine/` serves this game and this
  research; generality is incidental.

## Operating philosophy

- **Everything is revisable; nothing drifts.** No constraint, budget, or decision in
  this project is a fixed law — the project exists to learn, and learning changes
  plans. The only invariant is process: changes are argued, recorded in the decision
  log, and reflected in the docs, never made silently.
- **Measure delivery bottlenecks.** Keep every system observable and budgets enforced;
  measure asset throughput and edit-to-visible-result time before investing in more
  tooling. Harness work serves a current claim or repeated development need.
- **Attribution over blame-guessing.** When something is slow or broken, the stack is
  shallow enough (TS → Babylon → WebGPU/Dawn) to prove which layer is at fault. That
  attribution is the research.
- **Greybox foundations, early representative art.** The established mechanics and
  streaming substrate now support a finished area in M4.5. Develop content and its
  rendering technology together; placeholder evidence does not qualify final art.
- **Visible weekly progress.** During active development, show the playable build,
  before/after captures, growth of the finished area, and useful platform findings.
  Completed contracts and test counts alone do not establish visual or playable quality.
- **Design for N, build for 1.** World partitioning, save format, entity identity, and
  simulation/state separation assume multiple districts and future multiplayer from the
  first line of code, even while only one district exists.
