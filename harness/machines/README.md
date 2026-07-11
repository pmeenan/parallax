# Reference machines

Budget tiers (docs/budgets.md) are defined against budget *envelopes*, not against
whatever hardware happens to run the test. Machines listed here are the physical
fleet; add machines, don't silently swap them (harness rule 4). Chrome channel:
**stable**, version pinned per run and recorded in every result; Canary is permitted
only when testing Chrome-side changes and is always labeled as such (D-013).

## dev-01 — primary dev machine; showcase-tier test host

- CPU: Intel Core i9-14900KF (24 cores)
- RAM: 128 GB
- GPU: NVIDIA GeForce RTX 4080 Super (16 GB)
- Disk: 2× 2 TB NVMe SSD
- Network: 2 Gbps down / 35 Mbps up
- OS: Windows 11

**Note:** this machine substantially exceeds the showcase-tier reference envelope
(16 GB system RAM / 12 GB GPU, D-009). Showcase budgets are enforced by the *envelopes*
in budgets.md, not by this machine's capacity — the harness must flag envelope
violations even when the host has headroom, or results won't transfer to real
16 GB/12 GB machines.

## mac-01 — exploratory (between standard and showcase)

- MacBook Pro, Apple M5 Pro, 24 GB unified memory
- Chrome stable on macOS

**Purpose:** Chrome-on-macOS exploration — Dawn's Metal backend vs. D3D12 on Windows
(pipeline compile behavior, cache behavior, unified vs. discrete memory). Not a budget
gate initially; findings-oriented. Unified memory makes the CPU/GPU envelope split from
budgets.md an interesting research question on this host rather than a hard rule.

## standard-01 — gaming-rig baseline  `TBD`

The Standard-tier (1440p) gate machine. Not yet identified — required before Standard
tier results can be claimed. Until then, Standard-tier runs execute on dev-01 with
envelope enforcement and are labeled provisional.
