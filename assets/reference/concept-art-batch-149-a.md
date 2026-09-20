# Batch149 lane A — UI-003 near NPC

First-pass proposal; review and human artistic acceptance pending. Built-in imagegen edit, `precise-object-edit`. Sole input: `concepts/batch-146/ui-002-dialogue-ready-v1.png` (edit target, actually viewed). No other image inputs.

## Exact prompt saved before generation

```text
Use case: precise-object-edit
Asset type: Project Parallax UI-003 close NPC interaction overlay concept.
Input image 1 is the sole edit target: approved UI-002 ready dialogue screenshot. Preserve Mara Venn's exact face, hair, pose, wardrobe, realistic setting, framing, camera, lighting and all three upper-left vitals rows with their existing text and values unchanged.
Change only the conversation overlay into a restrained nearby-interaction marker. Remove the entire large lower conversation panel, its name header, dialogue sentence, reply field, Send button, Leave conversation button, and every associated border and control. Reconstruct the previously covered clothing and background naturally.
Add one small unobtrusive ivory outline conversation-bubble glyph beside and just above Mara's right shoulder (viewer right), without covering her face. This is a flat screen-space UI glyph, not a glowing physical object.
Add only a compact lower-center two-line interaction prompt, approximately 230 pixels wide and 85 pixels tall on this 1536x1024 composition: first line exactly "Mara Venn"; second line exactly "E · Talk". Ivory legible text, dark translucent charcoal backing and a fine restrained bronze edge matching the existing UI. Keep the world and character readable.
No other new text or controls. No reply, quest punctuation, exclamation mark, question mark, new abilities, ability bar, map, distance number, or luminous sign. Maintain the image dimensions and photographic visual quality. This is an isolated interaction-overlay appearance study, not a specification to hide normal exploration HUD.
```

## Receipt

Tool: built-in `image_gen.imagegen`; one call, one output. Start UTC `2026-09-16T19:41:32.628Z`; completion UTC `2026-09-16T19:42:06.130Z`; observed tool interval 33.502 seconds. Model and seed unavailable from built-in tool.

Sole reference/edit-target SHA256: `B7FA98F703C193403EDDCE066D96DFAF92BF2AA36BA557A749849B3876919D39`. Project-generated reference provenance inherited from Batch146; output-usage terms and reference rights require review before public shipping. Rights-review status: pending, not approved for shipping.

Native source: `C:/Users/patme/.codex/generated_images/01a0abbc-9206-7071-b85b-49f5a2ccd346/exec-ddfa2424-e729-41a9-a9ba-7193aa5c7b14.png`.

Retained output: [ui-003-npc-near-v1.png](concepts/batch-149/ui-003-npc-near-v1.png).

Native source and retained output both: SHA256 `8CBCF87089E8C668E0609216FE8EE16FE3F66B61914209EBEB9A90C5262A8496`; 2,156,207 bytes; 1536 × 1024 pixels. Copied unchanged; no crop, rescale, compositing, or retouching. Static concept only; no runtime/library admission.

## First-pass actual-view screen

Large dialogue panel and controls removed. Compact lower-center prompt reads `Mara Venn` and `E · Talk`; ivory speech bubble sits clear of the face beside the shoulder. Mara, setting, framing and three vitals remain recognizable and readable. No new ability bar or quest symbol. Prompt is approximately 265 × 96 pixels rather than the suggested 230 × 85, still compact. Face/clothing reconstruction has minor generative variation, not a pixel-identical preservation claim. No further generation pending both independent reviews and lead adjudication; human artistic approval remains open.

Final screens: quality137/theme149 Astra-low and root PASS; [review](concept-art-batch-149-review.md). Human-approved on 2026-09-16.
