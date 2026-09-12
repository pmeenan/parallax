# ENV-010 / ENV-015 — gate and crop lanes

Status: gate v2 and crop lanes v1 human-approved.
[Exact prompts and allowance](../concept-art-batch-070.md).
Built-in OpenAI imagegen; seed unavailable. Both use approved village B SHA-256
018648eb3a7ead8b69f4863f02c1da39ad8ca12b2c916916b1c59c86e21c8171
and folk B SHA-256 5475b96ff97d8df8a1a1c727e094d391895a8e8ff8e16c4eeba00dc18943dec9.
B also uses approved grain v1 SHA-256
ba864426fb00c22794f353552b4c5ec9b7614eda718f9eed1d7138503f3ae4db.
Original bytes retained. Applicable input/output terms and rights review pending
before public shipping; no runtime library admission.

Setting appearance only: village outside castle/moat, crops beyond village gate,
forest beyond fields. No new coordinates, resource/recipe types, named NPCs or
race/job rules. Metric terrain, castle orientation, gate construction/operation,
crop states, harvest and wind/character motion remain open.

## A — village gate v1

[Original](../concepts/batch-070/env-010-village-gate-v1.png).
Source C:/Users/patme/.codex/generated_images/01a08388-8e3a-77e0-a8dd-bb42e89e45d0/exec-fdedbce1-c9fb-4e8d-81f7-45912f628755.png.
SHA-256 87ee75ef4c78586765bc57e1e589f3677cdd6422a99188d89946d6042eb2f878.
1536×1024, 3,523,760 bytes. UTC 2026-09-09 00:19:57.493–00:20:46.256,
48.763 seconds observed call interval. One exact-prompt pass.
Lead sees supported tiled lintel, two distinct open gate leaves, clear level route,
fields and forest beyond; off-path cart and adult Human/Skarn remain grounded.
Leaves angle inward toward camera rather than lying against walls; traveler remains
at threshold. Acceptable appearance deviations. Actual hinge axes, swing clearance
and cart width need metric validation; this does not settle castle orientation.

## B — crop lanes v1

[Original](../concepts/batch-070/env-015-crop-lanes-v1.png).
Source C:/Users/patme/.codex/generated_images/01a08388-cbba-76b3-9697-894ebb675740/exec-c1aed970-7e79-48bd-a198-3cd9e00354db.png.
SHA-256 823dd35e695fceb6690cda6a47d0be71acaeb6e6b1fd4a4e74c111f1c443ff0e.
1536×1024, 3,779,995 bytes. UTC 2026-09-09 00:20:32.631–00:21:07.799,
35.168 seconds observed call interval. One exact-prompt pass with grain sentence.
Lead sees awned mature grain, separate green herb rows and orange-flowered plot,
clear winding walking path, supported shelter and mature same-ground Human/Wickfolk
pair near approved relative stature. Exact metric ratio still open. Side field gate
reads closed rather than open, basket deep rather than shallow, helper rests on
grounded tool; acceptable setting deviations, not new harvesting behavior. Route
supports pedestrian appearance; cart passing width beside pair remains unverified.

Both unchanged originals match staged Git LFS SHA-256 pointers, 1536×1024 dimensions
and gpt-image metadata. Calls total 83.931 seconds; observed overlap 13.625 seconds,
combined span 70.306 seconds. Tool timing is not provider-only compute measurement.

Independent quality070 and theme070 (GPT-6 Astra/low) both pass both candidates.
Construction confirms supported structures, coherent anatomy and walking access;
theme confirms village craft, mature folk and approved grain family. Lead agrees;
no visible must-fix. Prompt and metric limitations retained above. Right gate-post
foundation contact is partly occluded; no structural/operating proof claimed.
Documentation links and git diff --check pass.

## Human correction — gate v2 paving

User requested cobbled village interior transitioning to dirt beyond gate. V1
retained as lineage; crop lanes unchanged and awaiting approval.
[Revised original](../concepts/batch-070/env-010-village-gate-v2.png).
Source C:/Users/patme/.codex/generated_images/01a0744d-934b-7233-9464-19d574b3e48f/exec-caf3adb3-7aa5-42a0-b432-dff39d95a0a5.png.
SHA-256 5ec1011b43fd6fc9c835e062654b95a53e54e785c8b629a3da94bec72755694c.
Sole input gate v1 hash above; exact correction prompt appended to brief.
UTC 2026-09-09 01:00:50.819–01:01:26.821, 36.002 seconds observed call wait.
One pass of new two-pass/30-minute correction package. Original bytes retained.

Quality070 and theme070 (GPT-6 Astra/low) independently pass v2. Lead agrees:
worn limestone paving fills foreground and threshold, thinning gradually to dirt
just beyond gateway, without step or curb. Stone scale, boot/wheel contacts,
architecture, figures and open travel route remain coherent. Full terrain metrics,
gate motion and contact physics remain open. Hash/LFS, dimensions, gpt-image
metadata, documentation links and git diff --check verified before handoff.
