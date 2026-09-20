# Batch162 — UI-008 assigning a knack and waystone reshaping

A follows illustrated161 Abilities v2: builtin edit with actual-view input, preserve
all icons/style/slot count. State after learning Wellspring, before equipping it.
Header Progression Level3, Abilities active. Change to Unspent ability picks: 0.
Left4active rows: 1 Piercing Lunge with existing spear icon; 2/3/4 Empty. Two Knacks
rows both Empty. Highlight knack slot1 with bronze border (selected destination,
not occupied); slot2 neutral. Right Wellspring spring illustration, Knack, Learned,
Stamina regeneration +10/s. Replace cost and learning action with
'Choose a knack slot' and enabled 'Equip to knack slot 1'. Close separate. No Learn
button, no pick cost for equipping, no lock, no automatic equip or duplicate assignment.
This is selection BEFORE action; destination remains Empty. Plain slot indices,
not hotkeys. Only visualstate concept; no runtime action.

B fresh reshaping confirmation at waystone. Original091 village-waystone-v1 stone
appearance reference only, no inherited UI screen. Simple substantial illustrated
waystone medallion/vignette beside title, consistent illustrative bronze/charcoal/
ivory UI. Background anonymous softly blurred outdoor stone/greenery, NOT new town
layout. No character/class tree or itempaperdoll. Calm readable confirmation panel.
Exact text:
Reshape at Waystone
Level 3
Your marks: 40
After reshaping
Unspent attribute points: 1
Unspent ability picks: 1
Starter attributes restored
Piercing Lunge retained
Other learned abilities cleared
Level and XP retained
Cost: 25 marks
Marks remaining: 15
Cancel
Reshape
Clear hierarchy preview vs cost. Enabled bronze Reshape and separate Cancel. This
is pre-action confirmation, not completion. Sample character has spent the level3
attribute point and learned/equipped Wellspring, so reset changes build and charges25.
Initial starter profile, starter PiercingLunge and active slot1 retained; other
learned abilities reset and knack slots emptied. Text summarizes existing simulation,
not free all-points refund to character creation. No gear/inventory loss or race change.

Source: sim/progression.ts learnAbility/equipAbility/reshapeProgression; balance/
progression.ts cost25/slotaccess; sim/m3-simulation.ts funds+nearWaystone and changed
build guard. Reshape retains level/experience. Two independent lanes, each2passes/
30active minutes; both independent Astra-low reviews/root before any correction.
Exact prompts before builtin; actualview inputs/outputs; nativecopies/hash/bytes/dims/
UTC/tooltime inputrole/hash no modelseed available rights pending before shipping.
Human approval closes; no runtime edits, library admission or commit. Full14-ability
browser, other assignments/passives, unavailable respec, interaction/accessibility open.
[Lane A](concept-art-batch-162-a.md) · [Lane B](concept-art-batch-162-b.md) ·
[Review](concept-art-batch-162-review.md).

## Human-requested reshaping information control

Add a small circled i button beside Reshape at Waystone; show help expanded for
review. Builtin edit of actual-viewed Bv1, retain exact right-hand reset preview,
40/25/15 prices, Cancel/Reshape. Reflow title slightly if needed. Use existing left
illustration area for an opaque charcoal/bronze help popover/card; it may cover or
reduce the stone vignette, never overlap reset/cost/actions. Readable ivory text,
heading 'About reshaping', small close X for help. Exact explanation:
'Reshaping lets you rebuild your character’s attributes and abilities. It restores
your starter build and returns points and ability picks earned afterward. Your level,
XP, gear, and inventory stay unchanged. It costs 25 marks.'
Natural line wrapping, no extra rules. Small surviving waystone illustration is
welcome only if space permits. Info button visually active with help open.
Implementation intent: click/tap or keyboard focus exposes the information, not
hover-only; accessible name About reshaping, dismissible without confirmation or
loss of underlying state. Static art does not validate accessibility/behavior.
User requested B change only; A remains awaiting approval, no automatic approval.
New bounded revision package two passes/30active minutes. Both independent Astra-low
screens/root before revision; human acceptance. Native files, provenance, rights and
no runtime/library/commit rules retained.

## Matching closed information state

User approved Bv2 expanded help and explicitly requests pre-click version with the
waystone illustration visible. Create Bv3-closed from actual-viewed v1 and v2: use
v2 exact outer panel/title/info-button/right reset preview/cost/buttons positions,
replace left help card with original v1 illustrated stone vignette. No help heading,
body or X in closed state. Keep circled i beside title, restrained inactive bronze
(no bright active halo). All exact right-hand text/40/25/15 remains. This and v2-open
are complementary states, not alternatives. Screen matched layout/no text/stone
regressions. Two passes/30 active minutes, independent Astra-low screens/root before
revision, native-copy receipts and human approval. Bv2 open approved; A assignment
still not explicitly approved. No runtime implementation implied.
