# Reference machines

Budget tiers (docs/budgets.md) are defined against budget *envelopes*, not against
whatever hardware happens to run the test. Under D-150, dev-01 is the sole required
physical/reference/budget/milestone gate. Other machines and profiles are optional,
findings-oriented research: they require no registration for milestone entry or exit
and cannot invalidate dev-01 acceptance. Machines listed here are the physical fleet;
add machines, don't silently swap registered identities (harness rule 4). Chrome channel:
**stable**, operationally pinned via archived **Chrome for Testing** binaries at the
current stable milestone (installed branded stable auto-updates and can't serve as a
reproducible baseline; a periodic parity smoke run on it guards against divergence).
"Same version" across platforms = same milestone + V8 revision. Canary is permitted
only when testing Chrome-side changes and is always labeled as such (D-019).

The current automation pin is Chrome for Testing **151.0.7922.71**, revision
**1654411** (`harness/chrome/stable.json`, selected 2026-08-01 from the official CfT
known-good feed at the M2-exit/M3-entry dependency checkpoint). Its archived win64
executable SHA-256 is
`112b7b761c1b6cfa898c56e725f87f7a999a16a0d367d5345824d53336f52acc`.
The pin is adopted: D-149 accepted the dev-01 same-source `.34`/`.71` transition,
D-152 accepted installed branded-Stable parity, and D-153 accepted the final physical
production smoke with rendered-output review. The preceding 151.0.7922.34 binary remains
the retained transition and reconstruction anchor. No follow-up adoption gate or other
machine gate is pending. Archived binaries are machine-local and are not checked into
this repository.

## dev-01 — primary dev machine; Showcase-tier gate and calibration reference

- CPU: Intel Core i9-14900KF (24 cores)
- RAM: 128 GB
- GPU: NVIDIA GeForce RTX 4080 Super (16 GB)
- Promoted gate driver: 32.0.16.1074 (verified by Windows, CDP, and WebGPU adapter info
  from the physical console on 2026-07-13)
- Display: 4K @ 60 Hz (Showcase presentation gates are stated for 60 Hz pacing; any
  120 Hz-capability claim requires the dedicated uncapped capability run in budgets.md)
- Disk: 2× 2 TB NVMe SSD
- Network: 2 Gbps down / 35 Mbps up
- OS: Windows 11; Dawn backend: D3D12

The gate identity is machine-readable in `dev-01.json`, including the currently promoted
OS build, GPU driver, display mode, and Windows power scheme. Updating one of those pins
is an explicit reviewed environment-baseline change. A gate must run from the physical
console: RDP/remote display adapters are detected and reported as `invalid` (D-034), even
when the requested viewport and Windows video-controller mode still say 3840×2160.

**Note:** Showcase budgets are **calibrated to this machine** (D-018) — it defines the
platform-ceiling tier and, under D-150, the sole enforced gate. Envelopes (GPU ≤ 14 GB,
CPU-side ≤ 16 GB) are purposeful ceilings, not machine capacity: the harness flags
envelope violations even though the host has far more headroom. Transfer-to-modest-
hardware work remains optional Standard-profile research.

## mac-01 — exploratory (between standard and showcase)

- MacBook Pro, Apple M5 Pro, 24 GB unified memory
- Chrome stable on macOS

**Purpose:** Chrome-on-macOS exploration — Dawn's Metal backend vs. D3D12 on Windows
(pipeline compile behavior, cache behavior, unified vs. discrete memory). Not a budget
gate initially; findings-oriented. Unified memory makes the CPU/GPU envelope split from
budgets.md an interesting research question on this host rather than a hard rule.

## standard-target — advisory Standard-tier planning profile  `not a required pinned machine`

The Standard-tier (1440p @ 120 Hz) envelope is an **advisory target profile**, not a
required registered machine:

- MacBook Pro (2021), Apple **M1 Pro**, 16 GB unified memory, ProMotion display
- Chrome stable on macOS; Dawn backend: Metal

It may register as **standard-01** for repeatable optional research when a physical
unit is recorded here with: exact
model and size (14" vs 16" differ in GPU-core options, thermals, and native
resolution), M1 Pro CPU/GPU core configuration, display mode and **verified 120 Hz
behavior under Chrome** (ProMotion is adaptive — confirm the presentation path actually
paces at 120 Hz), and macOS build. (D-018)

**Notes:**
- **Unified memory:** the Standard tier's CPU/GPU envelope split (budgets.md) is an
  *accounting* split on this profile — both draw from the same 16 GB, alongside macOS
  and Chrome overhead. The combined envelope total is the real constraint; the harness
  reports both views.
- **Deliberately modest:** a 2021-class, widely-owned machine keeps the Standard
  planning envelope useful for the "transfers to hardware people actually have"
  research question.
- Metal/D3D12 comparisons can surface backend-divergent pipeline, cache, and memory
  findings, but only dev-01/D3D12 is gate-level.
- Standard-envelope runs may execute provisionally on dev-01. A later physical
  Standard run can improve transfer evidence, but neither registration nor a result is
  required for a milestone exit (D-150).
