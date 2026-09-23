# Batch 074 — shared geographic site plan

Human requested correction of geographic inconsistencies or a shared plan first.
Current proposal 2: [shared site plan](shared-site-plan.md), deterministic
[SVG source](concepts/batch-074/d1-shared-site-plan-v2.svg). No image-generation
prompt: this is a coordinate-authored diagram, not a generative bitmap illustration.
Existing castle/village/harbor art supplies requirements; no images are composited.

Allowance: two drawing/review passes, 60 minutes active. Pass one caught a 55 m
diagram road gap, ambiguous bridge landing and misdirected C3 arrow; corrected.
Pass two passed independent geography/quality (geography_audit074) and theme/goals
(site_theme074), both GPT-6 Astra/low, plus lead visual inspection. Minor final label
changes move castle label off bridge and add C5 sidebar description.

Render: SVG to PNG using bundled sharp through existing pinned Node 24.18.1.
Chrome-for-Testing 152.0.7977.54 headless diagram capture exited 21 and made no
artifact; in-app file-tab attempt timed out. Deterministic SVG raster export avoids
browser dependence for this diagram. No runtime test or platform-performance claim.

Proposal 2 human-approved; D-191 adopts its geographic reference. World data is not
yet migrated. Dependent wide vistas now use its camera and topology contracts.
Plan explicitly retains authored anchors, distinguishes two zoning changes, and
does not validate port depths or moat/bridge engineering. Authored SVG source is
the diagram authority; the PNG is a faithful deterministic export, retained via LFS.
No third-party art or generative-model output rights involved; public asset admission
still follows the project QA boundary. This is reference-only documentation.

Verified final artifacts: PNG 1400×1180, SHA-256
770f65b648b52f6299738face953a6eb09d78d6964d720b5e17abf5408535505;
hydrated original matches staged Git LFS pointer. SVG SHA-256
87feb30fbcd852fbe48325b7d06a4690b70ca6c8f12b0b457e1308a9a0f1b658.
Local links and git diff --check pass. No commits or runtime changes.

## Human scale correction — proposal 2

User found v1 too small for approved port and requested several streets and routes
through/around village and castle. New two-pass/40-minute drawing review package.
Broadened core and lower town, 1300 m lower-town reservation versus 450 m corridor,
1350 m waterfront versus 750 m; added dry-land moat circuit, multiple neighborhood
street loops, side lanes and three principal port streets. Larger warehouse symbols,
merchant courtyard and cargo space distinguish waterfront functions. All scale
reservations are proposals; no population or final street widths asserted.

Independent site_theme074 (GPT-6 Astra/low) passes scale/theme. Geography_audit074
passes anchors, loops and water exclusion but finds farm route ending 64 m before
moved western field: fixed by extending to SVG(245,846) inside field x125..260.
Lead verifies connection and both appearances. V1 retained; runtime unchanged.
V2 is authored SVG rasterized with sharp, no imagegen edits or third-party assets.
Geography recheck passes corrected field connection. Final v2 PNG 1400×1180,
SHA-256 993dd60514d16b36f8309d1a150cb955ec53e124ecd309c6544acf5b9022f1a8;
hydrated bytes match staged LFS pointer. SVG SHA-256
4ab533d9a8e932cd0643f6d87beab7e9f6f0009268682ba8c992a42dc7384faf.
Links and git diff --check pass. Source SVG is final authority, not the scratch
transformation script used to start this revision.
