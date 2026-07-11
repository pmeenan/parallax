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

Not "competes with a 500-person studio." It means: **no system is toy-grade.** The
project exercises the full feature surface of a AAA title — streaming open world,
high-fidelity rendering, character animation, spatial audio, physics, conversational
NPCs, save systems, and (later) multiplayer — each implemented in a way that is novel
and idiomatic for the web rather than a downported approximation. The feature matrix in
[features.md](features.md) tracks this coverage explicitly.

## Success criteria

- **Platform goal:** ≥ 20 documented, reproducible rough-edge findings of the quality
  that could become Chrome bugs, spec proposals, or design docs; harness able to attribute
  any regression to a specific layer (app code / Babylon / Dawn / V8 / OS).
- **Demo goal:** a stranger with latest Chrome can install (~multi-GB), relaunch to
  gameplay in seconds from fully local storage, and play at budget frame rates
  ([budgets.md](budgets.md)) — including offline.
- **Game goal:** District 1 playable end-to-end with final art; District 2 reachable
  through a hard streaming transition that stays inside the transition budget.

## Non-goals

- Cross-browser support. Chrome latest+ only, by design (Decision D-002).
- Low-end or mobile hardware. The baseline is capable consumer hardware — an M1-class
  MacBook Pro gates the Standard tier, a high-end Windows rig gates Showcase (D-018);
  hardware is an evolving target and the question is what the platform supports given
  sufficient hardware.
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
- **Verification bandwidth is the bottleneck**, not code generation. Harness first;
  every system observable; budgets enforced mechanically (M0 before anything else).
- **Attribution over blame-guessing.** When something is slow or broken, the stack is
  shallow enough (TS → Babylon → WebGPU/Dawn) to prove which layer is at fault. That
  attribution is the research.
- **Greybox first.** Mechanics, streaming, and budgets are proven with placeholder
  geometry before high-fidelity assets are swapped in.
- **Design for N, build for 1.** World partitioning, save format, entity identity, and
  simulation/state separation assume multiple districts and future multiplayer from the
  first line of code, even while only one district exists.
