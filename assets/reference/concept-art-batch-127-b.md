# Batch127 B — CHAR-007 hearth keeper

One initial built-in imagegen pass, at most two passes / 45 minutes active work.
Revision requires both independent reviews and root adjudication. Human artistic
selection remains pending. Reference only, no library admission.

## References and rights

- `concepts/batch-068/env-008-hearth-kitchen-v1.png`: approved identity and upper clothing reference; SHA256 `EFE4AC87298872A9763B4FA6657F9B943EF502DA1256BDDCB5D2D76A5E322E2D`.
- `concepts/batch-025/dir-006-b-folk-v1.png`: approved supporting living Skarn anatomy/style reference, central male only; SHA256 `5475B96FF97D8DF8A1A1C727E094D391895A8E8FF8E16C4EEBA00DC18943DEC9`.
- Both are project-generated reference inputs. Input licenses/terms and generating tool output-usage terms require rights review before public shipping; rights flag pending. No external franchise material requested.

## Exact prompt — pass 1

Recorded before the tool call. Built-in tool; seed and exact model version unavailable.

```text
Use case: stylized-concept.
Asset type: photographic full-body character appearance reference for Project Parallax, CHAR-007 hearth keeper.
Primary request: Show ONLY the adult male Skarn cook from reference image 1, now standing fully visible head to toe on a quiet warm neutral plaster and earth backdrop. Preserve his recognizable broad face, strong brow and nose, small ears, short dark hair and short chin stubble, sturdy heavy working build, and living slate-gray skin. Keep his muted natural ochre facial markings subtle, non-emissive.
Input images: Image 1 is the approved kitchen reference, authoritative for the cook's identity and oatmeal rolled-sleeve shirt with practical apron; isolate the male cook on the right, do not copy the woman, table, hearth, or kitchen. Image 2 is a supporting living Skarn anatomy and photographic style reference only, specifically the central male's believable flesh and weight; do not copy weapons, armor, robes, flask, or the other people.
Clothing: oatmeal woven linen open-collar shirt, practical rolled sleeves just below elbows; simple dark taupe-brown CLOTH cooking bib apron with fabric shoulder straps and fabric waist ties, broad quiet woven panels falling to below the knees; plain brown trousers and simple closed dark leather work shoes. The apron is soft woven fabric that hangs and folds naturally, never leather. Shirt and apron have restrained real weave, mostly even clean tonal fields, just localized light functional wear at seams and apron lower edge. No all-over grime, mottled patina, stains or crunchy over-texturing.
Composition: a single full-body figure centered in portrait orientation, generous clear space above hair and below shoe soles, both shoes fully visible on ground, natural relaxed stance with plausible weight and slightly separated feet. Both arms relaxed at sides, hands fully visible and separate from torso, natural fingers gently curved, no held object or cooking action. Warm capable, calmly attentive expression, near frontal with very slight three-quarter turn.
Lighting and rendering: believable photographic natural person, soft natural daylight, subtle grounded shadow, neutral color, anatomically credible living flexible skin with modest pores and folds; no stone surface or mannequin finish. Quiet backdrop detail must not compete with character. Detailed enough to understand face, material weave, apron attachment, hands and footwear.
Constraints: no extra people, no extra limbs or fingers, no cropped feet, no heroic glamour pose, no warrior armor, weapons, glowing cracks, rock statue, fantasy effects, modern garments, logos, labels, UI, text or watermark. No new name, narrative or profession tied to the race.
```

## Native receipt

- Tool: built-in `image_gen.imagegen`, one call with the two local reference paths in the order above; no CLI, no postprocessing.
- UTC call bracket: 2026-09-15 14:18:37 to 14:19:24.837 UTC; bracket elapsed 46.985 seconds; tool execution reported 41.0 seconds. Bracket includes dispatch overhead.
- Native source: `C:/Users/patme/.codex/generated_images/01a0a56e-5468-77f3-96eb-24e49623fce6/exec-a6586dca-e9c8-48ee-9f58-8ebb8335fbb3.png`.
- Untouched copy: `concepts/batch-127/char-007-hearth-keeper-v1.png`.
- Source and copy SHA256, verified equal: `57856997C50D38BE117C1E5D820175B757028BB9A988D6B7B1D46C83B8C2138F`.
- Native PNG: 1024 x 1536 pixels, 2,816,196 bytes.
- Seed and exact model version: unavailable from built-in response.

## Initial self-inspection

Recognizable broad face/hair and complete body with visible relaxed hands and shoes;
apron seams and ties read as cloth. Residual concern: extensive tonal mottling on the
apron and shirt exceeds the requested quiet weave/local wear, and the expression
leans stern. Root inspection and both independent reviews pending before any revision.

## Pass 2 — final authorized material correction

Root reports both independent Astra low screens and root inspection fail v1 for
material realism only. Final second pass authorized; preserve expression and all
character/garment structure. Edit target is v1, SHA256 above. Same rights status.

### Exact prompt

Recorded before call.

```text
Use case: identity-preserve.
Edit target: the supplied full-body male Skarn hearth keeper image. Make one targeted MATERIAL TEXTURE CORRECTION to clothing only. Preserve exactly the existing face, facial structure, expression, short dark hair, skin color, skin markings, living skin texture, sturdy build, anatomy, hands, fingers, pose, framing, background, lighting, garment cuts, shirt collar/buttons, rolled cuffs, apron shape and length, seams, cloth shoulder straps, attachment buttons, waist ties, trousers silhouette and footwear.
Correct the apron, shirt and trousers surface textures: remove the blanket brown mottling, scattered stain patterns, all-over pale crackle, and distressed leather-like patina. Give the cooking apron a mostly uniform DARK TAUPE-BROWN woven CLOTH surface, soft matte fabric, very fine subtle weave at close inspection, broad quiet color fields shaped only by natural fold shadows, with only a little localized wear along the actual seams and hem. The apron remains clearly fabric with its original soft folds, seams and ties, never leather. Give the shirt clean OATMEAL LINEN with mostly uniform light oatmeal color, subtle fine weave, original fabric folds and collar, slight localized wear at cuff edge only; do not replace its natural fabric appearance with featureless plastic. Give trousers simple matte BROWN CLOTH with quiet, near-uniform color, original folds and seams, and very modest wear at hems only.
Crucial: preserve the original garment geometry while eliminating noisy surface mottling throughout the broad panels. No new decorations, patterns, stains, armor, accessories, labels or text. Do not change the man's skin, face, hair, markings, expression, hands, pose, shoes or setting. Keep original full-body portrait composition and margins.
```

### Native receipt

- Tool: built-in `image_gen.imagegen`, one edit call using v1 as sole target; no postprocessing.
- UTC bracket: 2026-09-15 14:28:50 to 14:29:39.995 UTC; bracket elapsed 49.434 seconds; measured tool call 41.827 seconds.
- Native source: `C:/Users/patme/.codex/generated_images/01a0a56e-5468-77f3-96eb-24e49623fce6/exec-2b525e35-6e96-45ec-89b9-748f66ee559c.png`.
- Untouched copy: `concepts/batch-127/char-007-hearth-keeper-v2.png`.
- Source and copy SHA256, verified equal: `28F52B2A8522E77B4EB392813E8057276A647A4F7B69C95CC971CA1C7597FB40`.
- Native PNG: 1024 x 1536 pixels, 2,452,770 bytes.
- Seed and exact model version unavailable; rights review still pending public shipping.

### Self-inspection and limit

Blanket mottling markedly reduced across apron/shirt/trousers. Broad cloth panels,
soft folds, seams and ties are legible. Face, markings, expression, stance, hands,
full-body margins and clothing construction remain recognizable. Fine residual
surface grain remains visible on apron; final material acceptance belongs to the
independent screens/root and human selection. Two of two passes used; no further
generation authorized. Active lane work remained within 45 minutes.
