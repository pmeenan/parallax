# Batch146 A — UI-002 conversation ready state

First pass. Built-in imagegen, reference-based generation. Independent quality/readability and theme/identity/rules screens plus root actual-image review pending; no revision before those screens. Human appearance approval pending. No runtime or library admission.

## Exact prompt (saved before generation)

```text
Use case: ui-mockup
Asset type: Project Parallax UI-002 ready-to-type NPC conversation concept. Generate ONE landscape screenshot-like image, 1536 by 1024 composition, crisp game interface over photographic character and context.
Input image 1: selected Batch145 B HUD, UI STYLE REFERENCE ONLY. Match its restrained dark translucent charcoal panels, narrow muted bronze edges, warm ivory readable type, compact upper-left vital meter styling. Do not copy its courtyard, castle, coastal geography or world composition.
Input image 2: selected Batch126 A Mara Venn, CHARACTER IDENTITY REFERENCE ONLY. Preserve this exact mature Human woman's facial identity, natural tied brown hair with loose strands, mild weathering, blue-gray scarf and wool clothing, practical worn brown padded watch vest. Do not redesign or glamorize her. No new identity, rank, badge, insignia, weapon, biography or faction.
Scene: Mara in a natural attentive medium upper-body view facing the player, softly focused plain plaster-and-timber village wall behind her. Her entire head and face remain clearly visible above the lower dialogue panel. Natural anatomy, hair, face and fabric joins, ordinary soft daylight, photographic realism. Enough surrounding world stays visible; no gate, castle, siteplan, map or geographic illustration.
UI layout: same compact upper-left three vital meters as image 1, with exact labels and values "Health 84/100", "Stamina 62/100", "Aether 45/60". Use muted red Health at 84 percent, muted green Stamina at 62 percent, muted blue Aether at 75 percent, labels and values legible without relying on colors. No XP strip, ability cards, knacks, notices or shortcuts during this conversation.
A single wide compact dialogue panel across the lower portion, generous inner padding, quietly translucent dark background, narrow muted bronze edges. Crisp generously sized ivory typography. Exact heading: "Mara Venn".
Exact authored opening beneath heading, on one comfortably readable line: "Mara Venn, east-gate watch. What do you need?"
Below the opening, clearly separate empty player text entry field with exact placeholder "Type your reply…" and a clearly distinct button "Send" at its right. A secondary button "Leave conversation" positioned separately below and away from Send. Clear text and controls with generous spacing, no overlap.
This is a ready-to-type empty-input state, with no busy indicator, generated reply, error, completed action, canned response choices, quest acceptance, or keyboard key hints. Only the exact specified UI text may appear. No currency, quest, minimap, debug/provider/model labels, browser chrome, title banner, watermark, huge ornaments or science-fiction frames. Single image, not a presentation sheet or multi-panel board. Layout and sample data are concept proposals; do not add explanatory text to the image.
```

## Reference roles and provenance

- Both inputs actually viewed before generation. Input 1 is selected145 B UI style only; Input 2 is selected126 A exact Mara appearance only. Neither input is an edit target.
- Input 1: `D:/src/parallax/assets/reference/concepts/batch-145/ui-001-hud-split-v1.png`.
- Input 2: `D:/src/parallax/assets/reference/concepts/batch-126/char-004-mara-venn-v1.png`.
- Input license/terms inherit project-generated source receipts [145 B](concept-art-batch-145-b.md) and [126 A](concept-art-batch-126-a.md); not independently cleared here. Output provider usage terms not independently cleared here. Rights-review flag: pending before public shipping.
- Tool: built-in `image_gen.imagegen`. Underlying model/version and seed unavailable.

## Generation receipt

- Reference 1 SHA-256: `d51cd02f688d4887ec6916f8530b8291a5c128c62adb5c1f5a3143bb752f3c41`; 2,802,460 bytes; 1536 × 1024.
- Reference 2 SHA-256: `54a3844e1ac01078179aad2faa0db3bbb2f787fe85209a60dbd4dc7fe3e3eac6`; 2,730,552 bytes; 1024 × 1536.
- UTC bracket: 2026-09-15 23:25:29–23:26:06; 37 seconds including timestamp reads; orchestration tool result reports 37.1 seconds, not provider-only compute time.
- Native source: `C:/Users/patme/.codex/generated_images/01a0a762-c36f-71a0-8772-fff88e76642d/exec-7a8648a1-197a-4a68-a6be-3facf4216294.png`.
- Output: `D:/src/parallax/assets/reference/concepts/batch-146/ui-002-dialogue-ready-v1.png`.
- Source/output equal SHA-256: `b7fa98f703c193403eddce066d96dfaf92bf2aa36ba557a749849b3876919d39`.
- Source/output each 2,028,406 bytes, 1536 × 1024 PNG. Native byte copy without resize, crop, recompression or compositing; original retained. Git LFS filter verified.

## Generator first-pass inspection

Actual output viewed. Mature Human appearance, brown tied hair, blue-gray scarf and brown padded vest remain recognizable against a soft plaster/timber background. Face is unobscured above the panel. All three meters and the exact authored opening are readable. Text field is empty with the requested placeholder; Send and Leave conversation are visibly separated. No XP, abilities, quests, geographic scene, busy indicator or debug labels. Placeholder is deliberately dimmer than dialogue text; contrast/accessibility still needs implementation validation. Panel occupies approximately the lower third, with character/world visible through and above it. No generator blocker found; independent screens and root review pending. One pass used; no revision issued.

Physical smoke: deferred to M4.5 exit — reference-only concept; native-copy identity, dimensions, LFS attribute and actual-image inspection verified. No runtime/accessibility, waiting/fallback, localization or voice claims.
