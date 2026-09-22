# Bounded moss construction — 2026-09-22

The two authorized artistic cycles are complete. Retain [candidate1](moss/candidate1/source.blend)
as the stronger source proposal for human review; do not adopt candidate2's exposed-stem
revision. The original leaf-color/candidate2 input, approved leaf color, stone/soil
contact, and lighting were preserved. No third art cycle was run.

## Evidence and choice

- [Candidate1 close](moss/candidate1/close.png), [opposing light](moss/candidate1/close-opposing.png),
  [unlit](moss/candidate1/close-unlit.png), [gray](moss/candidate1/close-gray.png),
  [walking](moss/candidate1/walking.png), and [overview](moss/candidate1/overview.png)
  show a small, low living colony replacing the rejected smooth ribbons. Lead inspected
  the native contact sheet and transfer pair. The miniature paper-like leaflets and
  crisp patch boundary remain visible close-up.
- [Candidate2 close](moss/candidate2/close.png) and
  [walking](moss/candidate2/walking.png) show narrower curled leaflets and a looser fringe,
  but upright paired-leaf stems make the growth resemble tiny herbs. Both independent
  [quality](quality-moss2.md) and [theme](theme-moss2.md) screens favor candidate1;
  the lead agrees. Candidate2's successful transfer is retained as evidence, not as
  the selected art result.
- Candidate1's representative colony was freshly exported and reimported with
  Blender 5.2.1. [Native](moss/candidate1/transfer/native.png) and
  [reimport](moss/candidate1/transfer/reimport.png) renders visibly match. The
  [receipt](moss/candidate1/transfer/receipt.json) records 13,260 triangles, one
  mesh/material, zero textures and 592,512 GLB bytes. Direct GLB inspection found
  `POSITION`, `NORMAL` and `COLOR_0`. Mean absolute RGB pixel difference is
  0.0001023 on a 0–1 scale; p99 is 0.003922. All four transfer file sizes and SHA-256
  hashes were independently checked. The GLB SHA-256 is
  `a0723746128b7b566c1f2e6c449e31e5fbdfcee68c540f06c57ac3fc088b4be8`.

Candidate1 has 1,434 shoots and 48,756 moss triangles; the whole source scene has
681,469 triangles. It meets the study's 750,000 scene ceiling but exceeds the 4,000
plant-class production target. This is editable source microgeometry, not a shipping
LOD or production budget pass. The native/GLB check is Blender-only; full glTF
validation, engine import, compression, LODs, rights review, QA and installed-game
inspection remain open. The human accepted candidate1's moss appearance on
2026-09-22; preserve this source look during reduction and integration.

The next independent paving work is interruption of long joints and reduction of
recognizable repeated stone patterns. Preserve the approved material and leaf color
while testing those changes. Ground and foliage cost reduction follows a selected
appearance; it does not erase the current production excess.
