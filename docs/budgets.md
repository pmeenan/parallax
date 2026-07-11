# Performance budgets

Budgets are enforced by the harness on every measured run; a change that busts a budget
is not done. **No number here is a permanently hard limit** — every value is expected to
be recalibrated (in either direction) as we learn; all values below are **initial
targets** (status `provisional`) until M0/M1 measurements calibrate them. The rule is
about process, not permanence: recalibration happens through a decision-log entry, never
by quietly editing a threshold to make a failing change pass.

**Hardware baseline: a gaming rig** (D-009). This experiment is not concerned with
low-end devices — hardware is an evolving target, and the question is what the *platform*
can do given sufficient hardware. Reference machines are defined in `harness/` (a
current gaming rig as the baseline plus a high-end rig for the showcase tier, Windows,
latest Chrome stable; add machines, don't swap them).

## Quality tiers and resolution

Frame budgets are per-tier, at that tier's resolution on its reference machine — a tier
that misses budget is a violation; "it's fine at 1080p" is not a defense of the 4K tier.

| Tier | Reference machine | Target resolution | Intent |
| --- | --- | --- | --- |
| Showcase | high-end rig | 4K (3840×2160) | Photorealistic target when hardware supports it (D-009) |
| Standard | gaming-rig baseline | 1440p | The default experience; primary regression gate |

## Frame time (during gameplay, measured over scripted runs, per tier)

| Metric | Target | Notes |
| --- | --- | --- |
| Frame time p50 | ≤ 8.3 ms | 120 Hz headroom |
| Frame time p95 | ≤ 16.6 ms | Hard 60 fps floor |
| Frame time p99.9 / max hitch | ≤ 50 ms | Streaming, GC, or pipeline compile spikes |
| Pipeline compiles during gameplay | 0 | All PSOs warmed at boot; any runtime compile is a bug + a finding |
| Main-thread long tasks during gameplay | 0 > 50 ms | Main thread is orchestration-only |

## Memory (high-water marks during the standard flythrough, per tier)

Showcase memory is sized to its reference machine — **16 GB system RAM, 12 GB GPU**
(D-009) — with explicit headroom reserved for OS, browser process overhead, and
compositor. The per-tier **envelopes** (CPU-side total, GPU total) are the hard
constraints; the category split within an envelope may be rebalanced as measurements
come in, with a decision-log note.

| Metric | Standard | Showcase | Notes |
| --- | --- | --- | --- |
| CPU-side envelope (JS + WASM + SAB + staging) | ≤ 5 GB | ≤ 9 GB | Showcase leaves ~7 GB of the 16 GB machine for OS + browser overhead |
| — JS heap (all threads) | ≤ 2 GB | ≤ 3 GB | |
| — WASM linear memory (sum of modules) | ≤ 2 GB | ≤ 4 GB | Per-module tracked; memory64 modules justified individually |
| GPU memory envelope (as attributable) | ≤ 4 GB | ≤ 10 GB | Resident set + transient uploads; showcase leaves ~2 GB of the 12 GB card for OS/compositor/browser |
| SAB pools | Fixed at boot | Fixed at boot | No runtime growth; sizes recorded per build |
| Inter-district transition overlap peak | ≤ 1.25× steady-state GPU budget | ≤ 1.25× steady-state GPU budget | Both resident sets partially live during swap; showcase overlap must still fit the 10 GB envelope |

## Install / launch / update

| Metric | Target | Notes |
| --- | --- | --- |
| Install size (D1+D2 experiment content) | ≤ 12 GB | Excludes Chrome-managed Gemini Nano download (~4.3 GB) |
| Install size (architecture floor) | ≥ 100 GB supported; no designed-in ceiling | The *content* of this experiment is ≤ 12 GB, but the install, manifest, integrity, update, and streaming systems must demonstrably work at 50–100 GB **as a minimum** — the goal is proving the web platform supports at-least-AAA install sizes, with no architectural limit short of disk/OPFS quota. Verified with a synthetic-asset scale test (see below), not left theoretical. Watch OPFS quota (~60% of free disk) and design the pre-install quota check + failure UX for this scale. (D-009) |
| Install wall time | Bandwidth-bound + ≤ 90 s local work | Local work = integrity, unpack, PSO warmup |
| Launch 2+ → interactive gameplay | ≤ 10 s | Fully local; the number the demo lives or dies on |
| Launch 1 (post-install) → gameplay | ≤ 30 s | |
| Asset-only update | Never invalidates V8 code caches | Verified by harness cache probes |
| Offline launch | Identical to online warm launch | Network killed post-install |

**Scale test (M2):** a harness run installs a synthetic manifest of at least 100 GB
(generated filler assets) and exercises install/resume/integrity/update/eviction at that
scale on a machine with adequate disk. Real-content budgets above are unaffected; this
test exists so nothing in the lifecycle architecture quietly assumes "a few GB." If a
larger size finds a platform limit, grow the test until it does — finding the actual
ceiling (if any) is part of the research.

## Streaming and transitions

| Metric | Target | Notes |
| --- | --- | --- |
| Cell load (OPFS → renderable) p95 | ≤ 250 ms | At standard traversal speed |
| Visible pop-in at traversal speed | None at LOD contract distances | Visual diff in harness (later) |
| D1↔D2 hard transition: max hitch | ≤ 100 ms | Single worst frame during swap |
| D1↔D2 hard transition: total swap | ≤ 4 s | Choke-point traversal time hides it |
| Eviction mode | Proactive only | Emergency eviction events = 0 per run |

## NPC AI

| Metric | Target | Notes |
| --- | --- | --- |
| Dialog first-token latency p95 | ≤ 1.5 s | On-device Prompt API |
| Frame-time impact while generating | Within gameplay budgets above | Contention is a research target — measure, log, then budget |
