# KIT-037 — ship-to-quay crane redesign

Status: v2 visual direction screened; human direction review and mechanical details open. [Exact brief/prompt](../concept-art-batch-022.md).
Replaces [rejected fixed-frame work](KIT-036-037.md). Function must visibly include
ship hatch, lift over rail, reachable shore landing and unobstructed swing path.
This records the human's correction and root's missed functional screening.

Inputs: accepted project-generated merchant hull and supply yard, paths in brief.
OpenAI built-in imagegen; seed unavailable; unmodified originals retained. Rights
review pending applicable reference/output terms before shipping. No runtime admission.
Load ratings, anchor construction, rigging and metric/ship-layout validation remain open.
One generation lane, two passes maximum, 90-minute active-work cap. Both theme and
functional quality reviewers GPT-6 Astra/low plus root gate revisions/dependent use.

## First original

[Quay crane v1](../concepts/batch-022/kit-037-quay-crane-v1.png), exact Batch 022
prompt and both listed references. Source C:/Users/patme/.codex/generated_images/01a079a5-5338-7e31-b71d-1034746e8336/exec-7d2ae79b-cf6e-47c9-be25-43172b6a6592.png.
UTC 2026-09-07T02:15:01.259Z–02:17:42.030Z; wait 160.771 seconds.
SHA-256 dcca095c513435658f1d77445dfb4f4399ca441abc8558fbe74e26f97882c0e0.
Input merchant SHA-256 7fb7d7a8005134494b54ffa33dea76802ca57d77ddd3e4cb3af86ff40e2ef4e6;
input supply yard 27792a8b5c7a19d79f67ce7e68d80f97c94e8165264002fb7a8e6d971c3d9d41.

## First-pass screens and root adjudication

Theme tavern_theme (GPT-6 Astra/low) passes the ship-loading purpose and medieval
materials. Quality fleet_quality (same model/thinking) passes hatch reach, rail
lifting headroom, shore landing and jib braces attached to post. Must correct:
winch appears stationary beside rotating post, with off-axis hauling rope that
cannot clearly follow swing. Root agrees. Final pass attaches winch and footboard
visibly to rotating post above bearing, with gap from fixed masonry. Both reviews
repeat after correction; capacity and exact swept clearances remain unvalidated.

## Human-powered lift screening target

User also requires useful hand-powered mechanical advantage. The final-pass brief
adds a four-part block and tackle, 4:1 geared drum and load-holding brake/pawl, all
on the rotating assembly. A fixed pulley alone redirects force; supporting rope
parts provide ideal tackle advantage. See [OpenStax simple machines](https://openstax.org/books/physics/pages/9-3-simple-machines).
Lifting also needs a mechanism that holds/controls descent, separate from merely
pulling; [brake-winch manufacturer guidance](https://www.dutton-lainson.com/frequently-asked-questions/)
supports that requirement, not this fictional crane's construction or historical style.

Proposed screening assumptions, NOT a working-load rating: 500 kg gross suspended
mass including sling/block, four supporting parts, 4:1 gear reduction, 0.45 m crank
radius, 0.12 m maximum wound drum radius and assumed combined efficiency 60%.
Hand force = m g r_drum / (parts × gear × r_crank × efficiency) = 136.25 N
(about 14 kg-force), with about 21.22 crank turns per metre lifted. This is a
quasi-static feasibility estimate; efficiency is assumed, not measured. Rope layers
must not exceed the assumed radius. It does not prove structural strength, rope/
brake ratings, stability, dynamic loads or sustainable operator effort. Image must
visibly suggest these mechanisms; exact reeving/gearing must be checked separately.

Quality reviewer independently verified arithmetic: 136.25 N, 21.22 crank turns/m;
maximum wound radius gives highest hand force/lowest turns per metre. Assumptions
exclude acceleration, snagging and ship motion; no rated capacity inferred.

## Final bounded pass

[Quay crane v2](../concepts/batch-022/kit-037-quay-crane-v2.png), exact two-paragraph
correction prompt including human mechanical-advantage requirement, sole input v1.
Source C:/Users/patme/.codex/generated_images/01a079a5-5338-7e31-b71d-1034746e8336/exec-c979b3c5-0193-44f1-80a5-64df827531ec.png.
UTC 2026-09-07T02:25:47.374Z–02:28:13.151Z; wait 145.777 seconds.
SHA-256 3c109393eaafccc2139102f67956c13ae33b8a9d2d801b4a9f4d4d5956059203.
Combined generation wait 306.548 seconds. One lane, two passes; within 90-minute
active-work allowance. Originals 1536×1024, embedded gpt-image model metadata,
hydrated hashes matching staged LFS pointers verified. Links/whitespace checked.

Theme tavern_theme (GPT-6 Astra/low): v2 passes human-powered ship-loading direction,
geared winch/tackle and port materials. Quality fleet_quality (same model/thinking):
direction pass, mechanical acceptance open. Winch/platform now read with rotating
post but lower brace touches masonry ambiguously; detail view must establish gap
or bearing. Multiple strands/gears do not prove either 4:1 ratio; holding brake/pawl
is not clearly identifiable. Root accepts visual direction only and retains all
three as required future mechanism-detail work before mechanical acceptance.
No further automatic overall regeneration at this two-pass boundary. Do not use
this painting as evidence of the effort estimate, rated lift capacity or rotation
clearance. No runtime changes; physical smoke remains at M4.5 exit.

Human follow-up: gearing/brake may read, but no unmistakable crank is visible.
Root agrees the operator-side handle cannot be confidently identified as crank.
[Batch 023](../concept-art-batch-023.md) creates new close mechanism views: crank/
gear/drum/brake/rotating bracket and separate four-part tackle topology. Do not
claim the overall image resolves a control or ratio just because prompt requested it.
