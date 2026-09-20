# Batch134 B — Skarn conversational face

Status: pass 1 generated and native copy verified; independent reviews and human selection pending.

## Exact prompt (pass 1)

```text
Use case: stylized-concept
Asset type: Project Parallax CHAR-018 conversational face, skin and eye baseline; Batch134 B.
Primary request: Make one new photographic head-and-shoulders close portrait of the exact same sturdy adult Skarn woman in reference Image 1, preserving her recognizable mature identity, facial structure, age, short swept dark hair, robust brow and jaw, nose, lips, ears, and living slate-gray skin. This is a complementary close view of the approved character, not a new character or costume.
Input images: Image 1 is the approved batch-132 char-002-skarn-martial-v2 identity reference; preserve the woman and the incidental upper edge of her brown leather jack and rust-colored collar. Do not copy the full-body framing.
Scene/backdrop: Quiet neutral gray backdrop, ordinary diffuse daylight.
Composition/framing: A single natural conversation-distance head-and-shoulders portrait, mild three-quarter angle with both eyes visible. Show complete hair, ears, chin and neck with comfortable margins. Upper chest and both shoulders terminate deliberately at the lower crop; body below upper chest is out of frame. Natural perspective without wide-angle distortion.
Expression/gaze: Calm attentive expression, amber-brown non-emissive eyes directed toward one interlocutor just off camera. Coherent eye alignment, normal-sized irises, naturally off-white sclera, small plausible soft-light catchlights, understated moist lower lids.
Materials/textures: Photographically natural living skin, eyes and hair. Soft living-flesh shading with natural tonal variation and pores, normal mature creases and subtle mineral coloration consistent with the reference. The slate-gray skin is living flesh rather than rock: no branching fissures, cracked stone, marble veins, etched cells or exaggerated grain. Hair must read as real swept strands, not painted grooves.
Constraints: Keep her strong distinctive robust shape without grotesque caricature or new species anatomy. No glamour, makeup, plastic smoothing, over-sharpened pores, glowing eyes, dollglass stare, exaggerated iris, grain overlay, props, labels, UI, text, watermark, clinical or cutaway anatomy. One portrait only.
```

## Input and scope

- Reference image (identity, not edit target): `concepts/batch-132/char-002-skarn-martial-v2.png`; SHA-256 `1878c77ea39fd77aee70cccf4c48d0d09a3308031b33621c2cd9781f175209bf`. Actual image viewed before generation.
- Brief: [Batch134](concept-art-batch-134.md). One pass now; any revision waits for both independent reviews and lead adjudication.
- Built-in imagegen; exact underlying model and seed unavailable. Reference-input rights and generating-model output terms review pending before public shipping. No library/runtime admission.

## Pass 1 receipt

- Tool: built-in `image_gen.imagegen`; reference supplied using `referenced_image_paths`.
- Generation UTC: `2026-09-15T19:24:16.324Z` to `2026-09-15T19:24:41.967Z`; measured tool-call wall time **25.643 s**.
- Native source: `C:/Users/patme/.codex/generated_images/01a0a686-1ed9-71a1-b89d-a9b16b5a6240/exec-59d2ab70-e6ae-47b4-8ecc-48255f42c969.png`.
- Workspace output: `concepts/batch-134/char-018-skarn-face-v1.png`.
- Both source and output: PNG, **1024 × 1536**, **2,490,292 bytes**, SHA-256 `64bea50ab7e3589a538482d55ea0a9dae01c7f0da859433c71a4008a6f2922a8`.
- Native copy verified by equal SHA-256 and byte counts; no crop, resize, recompression or image postprocessing. Original retained.
- Input: PNG, **1024 × 1536**, **2,471,507 bytes**; hash and role above. Brief text is a specification, not an image input. No third-party reference image was used.
- Generator seed and exact underlying image model unavailable from built-in tool. Input rights/license/terms review and model output-usage terms review remain pending; rights-review flag **pending**, public shipping **not cleared**.

## Generator visual inspection (not acceptance)

Viewed the approved identity reference before generation and the actual saved output afterward. The mature robust face, swept short hair, gray living skin, amber-brown eyes and rust/leather collar remain recognizable. The portrait has natural diffuse light, coherent off-camera gaze, restrained catchlights, readable lower-lid moisture and complete head/chin/neck margins. Skin has soft flesh shading and fine texture rather than branching stone fractures. The far ear is naturally occluded by the three-quarter angle; shoulders exit laterally in this close crop. Forehead creases and mottled gray coloration remain visually strong and should receive the independent material/theme screens. No revision has been attempted. This still establishes no optical constants, facial rig, gaze/blink dynamics or expression range.
