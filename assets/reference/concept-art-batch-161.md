# Batch161 — UI-008 attributes and early loadout

Two complementary first progression screens. Fresh text-only generation, no image
inputs to prevent inherited texture degradation. Charcoal translucent panels, thin
restrained bronze borders, ivory readable serif matching approved UI145B/154/159
textual style. Soft anonymous medieval stone/timber background with natural daylight,
no new characters, fantasy classes, skill trees, architecture or geographical claim.
Simple tiny symbolic line icons are provisional UI glyphs, no spell appearances.

Same valid sample: starter Human profile after reaching level3 with one unspent point
and one ability pick. Might5 Finesse4 Vitality4 Attunement3; only Piercing Lunge learned
and in active slot1, all others empty. Source createInitialProgressionState and
awardExperience; source balance/progression.ts four active/two knack accessible at2.
No actual spend/learn transaction. No contradictory full learned loadout at level3.

A Attributes. Header Progression, Level 3; tabs Attributes (active), Abilities.
Two panels: left Attributes four generous selectable rows Might5 (selected),
Finesse4, Vitality4, Attunement3. Display 'Unspent attribute points: 1'. Right Might
heading, concise text 'Melee power, carry, force checks'. Clearly labeled preview
'Current: 5', 'After spending: 6', 'Cost: 1 attribute point'. Enabled bronze button
'Spend 1 point'. Separate 'Close' footer left. No unintended current6 or transaction
confirmation, no extra derived stats, currency, respec or plus buttons on every row.

B Abilities. Header Progression, Level 3; tabs Attributes, Abilities (active).
Top 'Unspent ability picks: 1'. Left Loadout panel, group 'Active abilities' has exactly
FOUR full rectangular slots in a clear column: '1  Piercing Lunge', '2  Empty',
'3  Empty', '4  Empty'. Lower 'Knacks' group exactlyTWO slots: '1  Empty', '2  Empty'.
These numbers are slot indices, no keyboard-key graphics. Empty slots available,
no padlocks or level gates. Right selected ability detail 'Wellspring', 'Knack',
'Not learned', 'Stamina regeneration +10/s', 'Cost: 1 ability pick', enabled
'Learn ability'. A small simple spring/wave glyph may accompany Wellspring. Separate
Close bottom left. No Equipped badge for unlearned Wellspring, no auto-equip claim,
no saved build slots, no class tree. This is a selected detail/loadout study; complete
14-ability browser/navigation remains open, do not invent full-list or filter UI.

Refs: game/src/balance/progression.ts; sim/progression.ts; balance/combat.ts starting
profile; docs/game-design.md attributes/classless progression. Respec25 atwaystones
and broader states remain a next coverage gap, no wrong global free reset. Art only.
Two independent lanes, two passes/30 active minutes each. Exact prompt saved before
builtin invocation; nativecopy/hash/bytes/dims/UTC/tooltime, modelseed unavailable,
rights pending. Actualview outputs, two independent Astra-low screens/root before
revision, human artistic approval closes. No library admission, runtime change/commit.
[Lane A](concept-art-batch-161-a.md) · [Lane B](concept-art-batch-161-b.md) ·
[Review](concept-art-batch-161-review.md).

## Human-requested illustrated icon revision

User requests icons/graphics for both attributes and abilities to reduce plainness.
V1 not approved; retain as superseded initial direction. New bounded package: up to
two revision passes/30 active minutes per lane, independent reviews/root before
further revision. Use builtin edits of actual-viewed v1, preserve exact text/state
and all slots. Native originals only; no manual overlays. Inspect texture degradation.

A: add substantial consistent square illustrated icons beside all four attribute
rows, preserving label/value space. Might = sturdy worn iron gauntlet/clenched fist
(warm bronze); Finesse = slim dagger with feather (muted teal); Vitality = stylized
warm red heart with oak leaves, non-medical symbolic; Attunement = faceted violet
crystal with restrained silver ring. Cohesive painterly-realistic fantasy inventory
icon family, subdued color and natural material highlights, no neon/cartoony clipart.
Right Might detail gets a larger matching gauntlet vignette; rebalance spacing to
keep description, Current5/After6/cost1/Spend1point andClose readable. No real item,
class exclusivity, armor requirement or new attribute mechanic implied by symbols.

B: Piercing Lunge occupied slot gets a clear square illustrated spear-point/thrust
icon with a restrained directional stroke (symbol only, no new magical effect).
Replace tiny generic Wellspring waves with substantial illustrated vignette of clear
spring water over mossy stones, soft blue-green/bronze palette, suggesting stamina
renewal. Matching small icon beside its heading if helpful, without duplication
clutter. Unlearned detail remains fullcolor preview plus Not learned; NOT equipped.
Keep all4active and2knack slots; Empty slots get faint neutral empty frames only,
not ghost ability pictures, locks or new named abilities. Same family and frame style
as attribute icons. No new spell colors/physical effects; final14-icon family remains
future coverage. Goal is materially more engaging visual content while preserving
state clarity and broad legible shapes at icon scale.
