# KIT-037 — crank and tackle mechanism details

Status: [Batch 023](../concept-art-batch-023.md) bounded passes complete; crank clarified,
visual direction human-accepted; mechanical-detail acceptance still blocked.
User could not identify the crank in the overall view. These close studies address
actual input-shaft drive, separate brake, rotating mount and tackle topology.
They do not replace structural validation or imply a rated capacity.

Sole input: [crane v2](../concepts/batch-022/kit-037-quay-crane-v2.png), SHA-256
3c109393eaafccc2139102f67956c13ae33b8a9d2d801b4a9f4d4d5956059203.
OpenAI built-in imagegen; seed unavailable; project-generated input and unmodified
originals retained. Rights review pending applicable reference/output terms before
shipping. No runtime admission. Exact prompts in brief. Two independent lanes,
two passes each, 90-minute active-work cap; GPT-6 Astra/low theme and functional
quality reviewers plus root gate revisions/dependent use.

Correct intended drive: handgrip → crank arm → input shaft/pinion → larger drum
gear/output shaft → rope drum. Brake must independently hold/control drum motion.
Correct intended tackle: top becket → lower sheave 1 → upper sheave 1 → lower
sheave 2 → upper sheave 2 → winch; four supporting rope parts, not decorative strands.

## First originals

[Winch v1](../concepts/batch-023/kit-037-winch-detail-v1.png), exact A prompt, sole crane v2 input.
Source C:/Users/patme/.codex/generated_images/01a079a5-5338-7e31-b71d-1034746e8336/exec-08f86354-4437-4559-b24e-4dbfae6b2f4d.png.
UTC 2026-09-07T02:33:58.987Z–02:34:59.496Z; wait 60.509 seconds.
SHA-256 0436251862b09910cf41af54f24e3abf22cf6bb602385e46230cf651e4cdb4a9.

[Tackle v1](../concepts/batch-023/kit-037-tackle-detail-v1.png), exact B prompt, sole crane v2 input.
Source C:/Users/patme/.codex/generated_images/01a079b7-55f6-72c0-8da0-3fb72c4f44bd/exec-39b1ee37-a9d2-4476-914c-20be8061811d.png.
UTC 2026-09-07T02:34:55.154Z–02:35:25.622Z; wait 30.468 seconds.
SHA-256 60696c97ae7b069a0e1ee812bee96ecc0ca968da9c7872a9b8a47532aaa9e607.
Portrait output despite landscape request; retain original dimensions, not resampled.
Initial calls overlap 4.342 seconds; total wait 90.977 seconds over 86.635-second window.

## First-pass screens

Both tavern_theme and fleet_quality (GPT-6 Astra/low) require corrections. Winch:
crank is clear but pinion fails to mesh, isolated lower wheel disconnected, drum
label points at gear. Need actual engagement and holding/braking on drum shaft.
Tackle: five vertical strands, hauling lead at moving block, no clear upper becket;
need single traceable four-part path. Materials pass, functional explanations fail.
Root agrees; final second pass per detail with exact correction prompts in brief.

## Final originals

[Winch v2](../concepts/batch-023/kit-037-winch-detail-v2.png), exact correction A v2,
sole winch v1 input. Source C:/Users/patme/.codex/generated_images/01a079a5-5338-7e31-b71d-1034746e8336/exec-07c9276d-423f-49ef-9dc9-c84de0e10601.png.
UTC 2026-09-07T02:46:01.775Z–02:46:53.027Z; wait 51.252 seconds.
SHA-256 1e3fe6dc654aaf5d9f857fa35d8bef1d5042cb6b3833f56239c849a90977a0fd.

[Tackle v2](../concepts/batch-023/kit-037-tackle-detail-v2.png), exact correction B v2,
sole tackle v1 input. Source C:/Users/patme/.codex/generated_images/01a079b7-55f6-72c0-8da0-3fb72c4f44bd/exec-9c40c693-d2f5-4284-ad9e-f3eb9ca18330.png.
UTC 2026-09-07T02:45:03.258Z–02:45:57.220Z; wait 53.962 seconds.
SHA-256 8150bd576374a4c215cd3bca756cf2736e791ba3a96aa7cc84d0781d141fcff9.
Correction calls did not overlap: 4.555-second gap. Combined correction wait
105.214 seconds; all Batch 023 generation wait 196.191 seconds. All originals
retained with matching hydrated hashes/LFS pointers and embedded gpt-image metadata.

Verified dimensions: both winch PNGs 1536×1024; tackle v1 1086×1448 and v2
1023×1537. Portrait accepted as detail-sheet format, originals not resampled.

## Final screens and root adjudication

Both tavern_theme and fleet_quality (GPT-6 Astra/low) find improved material/assembly
references, but NOT accepted explanatory mechanisms. Winch crank is unmistakable
lower-left arm keyed to input pinion, now visibly meshing with drum gear. Remaining
lower-right wheel disconnected; upper-right arm does not demonstrate brake action.
Positive holding/controlled lowering remain unproven. Tackle has four strands and
upper hauling lead, but becket knot lacks visible continuation and outer rope runs
disappear into frame rather than traceable grooves. Root agrees with these blockers.

Do not use these images to substantiate 4:1 ratios, assumed hand-force calculation,
or working brake. Crank identification is resolved; mechanism acceptance remains
separate future drafting/detail work. No further automatic regeneration this batch.
Two passes each, within 90-minute active-work cap; hashes/LFS/dimensions/model/link
checks and git diff --check passed. No runtime changes or commits.
