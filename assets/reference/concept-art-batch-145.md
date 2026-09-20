# Batch145 — core HUD layout directions

DIR-009 P0 / UI-001 P1. First two alternative static HUD directions, human chooses
layout. Same sample content and visual palette, not different game systems. Authority:
game/src/ui/m3-hybrid-ui.ts M3HudStatus/hudMeters and progression.ts four active/two
knack slots; shortcuts I inventory/craft, P progression, J journal. No game code edit.
Sample numbers/layout/icons are presentation proposals, not balance or bindings.

Both use approved060 `concepts/batch-060/light-001-courtyard-sunny-v1.png` as a
background visibility test ONLY. Its legacy courtyard is not authored-route geometry
or new layout. Preserve scene generally, no added characters, creatures or spells.
Overlay crisp restrained dark translucent panels, narrow muted bronze edges, warm
ivory highly legible type. Tiny simple icons, no scrollwork/skulls/huge ornaments,
neon/sci-fi frame, browser chrome or title banner. World occupies at least75% view.

Exact shared HUD content: Health 84/100, Stamina 62/100, Aether 45/60.
Bars filled corresponding roughly84%,62%,75%; muted red/green/blue respectively,
text labels and numbers avoid reliance on color alone. Four equal active slots,
labels Cleaving Arc, Aetherpulse, Mendweave, Wardlight. No key badges or cooldowns;
monochrome small line glyph proposals (slash, pulse ring, woven strands, shield),
not final spell icons. Two smaller visually separate knack badges below active
slots: Forager's Eye and Wellspring. Thin XP strip "Level 3 · XP 120/300" about40%.
Small notice "1 attribute point · 1 ability pick" near progression shortcut.
Small secondary footer "I Inventory · P Progression · J Journal". No quest/minimap,
target/enemy bar, interaction marker or debug stats in this basic noncombat study.

A: bottom-center grouped panel: compact three meter rows directly above four
active slots, two knack badges and thin XP strip. Secondary shortcuts/notice bottom
right. Keep clear scene center and edges, avoid enormous panel. Consolidated glance.
B: small compact three meter rows upper-left with thin XP strip beneath; same
four active slots and separate two knack badges bottom-center. Secondary shortcuts/
notice bottom-right. Leave scene center open. Distributed glance, less bottom stack.

Two independent generation lanes, max two passes/30 active minutes. View background
first, exact prompt saved before builtin imagegen reference call. Native source/output
equal hashes, bytes/dims/UTC/tooltime, input role/hash, model/seed unavailable and
rights pending. No runtime/library admission. Independent Astra/low quality/readability
and theme/rules screens plus root before revisions; human layout selection ends.
Imagegen typography/icons are draft artwork, not accessible runtime UI or measured
screen-size/localization performance. Combat, dialogue and further UI states open.

[A receipt](concept-art-batch-145-a.md) · [B receipt](concept-art-batch-145-b.md).

V1 pair reviewed, one pass each; B split layout human-selected on 2026-09-15. Both content/theme
and readability pass. A quality flags generator-added bottom-quarter limit (30%
height); root accepts for layout choice because >75% scene remains visible. B PASS.
Sizing/glyphs/final trim open; [review](concept-art-batch-145-review.md).
