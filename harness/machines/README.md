# Reference machines

Budget tiers (docs/budgets.md) are defined against budget *envelopes*, not against
whatever hardware happens to run the test. Machines listed here are the physical
fleet; add machines, don't silently swap them (harness rule 4). Chrome channel:
**stable**, operationally pinned via archived **Chrome for Testing** binaries at the
current stable milestone (installed branded stable auto-updates and can't serve as a
reproducible baseline; a periodic parity smoke run on it guards against divergence).
"Same version" across platforms = same milestone + V8 revision. Canary is permitted
only when testing Chrome-side changes and is always labeled as such (D-019).

The current M0 automation pin is Chrome for Testing **150.0.7871.115**, revision
**1639810** (`harness/chrome/stable.json`, promoted 2026-07-12 from the official CfT
Stable availability endpoint). Archived binaries are machine-local and are not checked
into this repository.

## dev-01 — primary dev machine; Showcase-tier gate and calibration reference

- CPU: Intel Core i9-14900KF (24 cores)
- RAM: 128 GB
- GPU: NVIDIA GeForce RTX 4080 Super (16 GB)
- Display: 4K @ 60 Hz (Showcase presentation gates are stated for 60 Hz pacing; any
  120 Hz-capability claim requires the dedicated uncapped capability run in budgets.md)
- Disk: 2× 2 TB NVMe SSD
- Network: 2 Gbps down / 35 Mbps up
- OS: Windows 11; Dawn backend: D3D12

**Note:** Showcase budgets are **calibrated to this machine** (D-018) — it defines the
platform-ceiling tier; the transfer-to-modest-hardware story belongs to the Standard
tier. Envelopes (GPU ≤ 14 GB, CPU-side ≤ 16 GB) are purposeful ceilings, not machine
capacity: the harness flags envelope violations even though the host has far more
headroom.

## mac-01 — exploratory (between standard and showcase)

- MacBook Pro, Apple M5 Pro, 24 GB unified memory
- Chrome stable on macOS

**Purpose:** Chrome-on-macOS exploration — Dawn's Metal backend vs. D3D12 on Windows
(pipeline compile behavior, cache behavior, unified vs. discrete memory). Not a budget
gate initially; findings-oriented. Unified memory makes the CPU/GPU envelope split from
budgets.md an interesting research question on this host rather than a hard rule.

## standard-target — Standard-tier profile  `not yet a pinned machine`

The Standard-tier (1440p @ 120 Hz) gate is currently a **target profile**, not a
registered machine:

- MacBook Pro (2021), Apple **M1 Pro**, 16 GB unified memory, ProMotion display
- Chrome stable on macOS; Dawn backend: Metal

It registers as **standard-01** when the physical unit is recorded here with: exact
model and size (14" vs 16" differ in GPU-core options, thermals, and native
resolution), M1 Pro CPU/GPU core configuration, display mode and **verified 120 Hz
behavior under Chrome** (ProMotion is adaptive — confirm the presentation path actually
paces at 120 Hz), and macOS build. (D-018)

**Notes:**
- **Unified memory:** the Standard tier's CPU/GPU envelope split (budgets.md) is an
  *accounting* split on this profile — both draw from the same 16 GB, alongside macOS
  and Chrome overhead. The combined envelope total is the real constraint; the harness
  reports both views.
- **Deliberately modest:** a 2021-class, widely-owned machine keeps the Standard tier
  honest — this is the "transfers to hardware people actually have" gate.
- With the Standard gate on Metal and dev-01 on D3D12, **both Dawn backends are
  gate-level**; backend-divergent behavior (pipeline compile, cache, memory) is
  automatically surfaced by tier runs and feeds rough-edges.
- Until registration, Standard-tier runs execute on dev-01 with envelope enforcement
  and are labeled **provisional** (envelope enforcement does not reproduce real memory
  pressure, bandwidth, or GPU-performance behavior — provisional results never satisfy
  a Standard-tier exit criterion).
