# Batch 145 B — split HUD direction

UI-001 / DIR-009. First pass; independent quality/readability and theme/rules reviews plus root adjudication pending. Human layout selection pending. No runtime/library admission.

Uses [shared brief](concept-art-batch-145.md). Built-in imagegen, reference-based generation; imagegen model and seed unavailable. Rights review pending for input and output; public-build use not cleared. Input is approved Batch060 courtyard, only a background visibility test, not route geometry.

## Exact prompt (saved before generation)

```text
Use case: ui-mockup
Asset type: Project Parallax UI-001 direction B, a finished high fidelity static core gameplay HUD layout concept. Generate one landscape image matching reference framing.
Input image 1 is the approved sunny courtyard, used ONLY as a background visibility test. Preserve its scene, camera, light, architecture and clear center generally. Its legacy courtyard is not authored-route geometry. Overlay the HUD only. No added characters, creatures or spells.
Style: crisp restrained dark translucent panels, narrow muted bronze edges, warm ivory highly legible type, tiny simple monochrome line icons. World occupies at least 75% of the image.
Composition B: small compact three meter rows in the upper-left corner with a thin XP strip beneath. Four equal active ability slots at bottom-center and two smaller visually separate knack badges just below the active slots. Secondary shortcuts and progression notice at bottom-right. Keep scene center open. Distributed glance, shallow bottom stack. Do not add title or heading.
Exact shared HUD content:
Upper-left meter rows: "Health 84/100", "Stamina 62/100", "Aether 45/60". Health bar muted red roughly 84% full; Stamina muted green roughly 62% full; Aether muted blue roughly 75% full. Clear labels and numbers avoid reliance on color alone.
Thin XP strip beneath the upper-left meter rows, about 40% full, exact text "Level 3 · XP 120/300".
Bottom-center four equally sized active ability slots left to right: "Cleaving Arc", "Aetherpulse", "Mendweave", "Wardlight". Their small monochrome line glyph proposals are respectively slash, pulse ring, woven strands, shield. These are draft glyphs, not final spell icons. No key badges, no cooldowns, no digits on these slots.
Below the four active slots, two smaller visually separate knack badges: "Forager's Eye" and "Wellspring". Make these distinct from active abilities.
Bottom-right, small notice "1 attribute point · 1 ability pick" near the progression shortcut. Small secondary footer "I Inventory · P Progression · J Journal". Use exact text, keep it readable, fit it without overlapping the bottom-center slots.
No quest, minimap, target/enemy bar, interaction marker, debug stats, browser chrome, title banner, scrollwork, skulls, huge ornaments, neon or science-fiction frames. No additional interface text. A restrained fantasy game HUD with strong readability and minimal scene obstruction.
```

## Provenance

- Input role: approved Batch060 background visibility test only; visually inspected before call.
- Input: `D:/src/parallax/assets/reference/concepts/batch-060/light-001-courtyard-sunny-v1.png`.
- Input SHA-256: `23d62504f7ecc206dbf33267cd31c54e9f3d767ecaf58edf4f5ffb7472ff6eec`; 3,337,655 bytes; 1536 × 1024.
- Tool: built-in `image_gen.imagegen`, one reference input; underlying model/version and seed unavailable.
- Generation start: 2026-09-15 23:05:38 UTC; end: 2026-09-15 23:06:15 UTC; observed tool-call interval including timestamp reads: 37.119 seconds.
- Native source: `C:/Users/patme/.codex/generated_images/01a0a750-c9ed-7c80-88e1-6b481e0ee5fa/exec-664a584d-ff31-4115-a9d7-0bf99e461ba8.png`.
- Repository output: [ui-001-hud-split-v1.png](concepts/batch-145/ui-001-hud-split-v1.png).
- Native source and repository copy SHA-256, verified equal: `d51cd02f688d4887ec6916f8530b8291a5c128c62adb5c1f5a3143bb752f3c41`.
- Native source and copy: 2,802,460 bytes each; 1536 × 1024 PNG. Native bytes copied without resize, crop, recompression or compositing. Original retained. Git LFS filter verified.
- Reference-input license/terms inherit Batch060 provenance; not independently cleared here. Output provider terms not independently cleared here. Rights-review flag: pending; no public-build admission.

## First-pass inspection

Generator inspection: upper-left vitals and XP, bottom-center four abilities and separate knacks, lower-right notice/shortcuts are present. All requested words and values appear readable at native size. Center remains clear; broad scene framing preserved. The generated courtyard has some texture drift, as expected for a reference-based concept, and is not a pixel-identical overlay. Iconography and typography remain draft artwork. Independent quality/readability and theme/rules screens plus root adjudication pending; no revision issued. Human selection remains open.

Physical smoke: deferred to M4.5 exit — reference-only concept; native-copy identity, dimensions, LFS attribute and visual inspection verified. No game code changed and no runtime/accessibility or localization-performance claims.
