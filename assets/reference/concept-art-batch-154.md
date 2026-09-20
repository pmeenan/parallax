# Batch154 — inventory and equipment layout

UI-005 P2 first readable inventory/equipment screen, one landscape UI concept.
Fresh interface over softly defocused anonymous medieval stone/timber background;
large translucent charcoal panels, thin muted bronze borders, warm ivory serif text,
restrained charcoal/ivory hierarchy from145/149. No ornate manuscript, futuristic UI,
unreadable microtype, full character paper doll or new body slots. Large readable
three-column layout with generous padding. Isolated screen proposal, not implemented
UI contract. Sole image input approved051 item-001-sword-v2.png sword appearance
only, actually view it; do not copy tabletop/background. Small clear sword illustration
in selected details; straight symmetrical blade/crossguard proportion maintained.

Top heading Inventory; top-right25 marks. Left column heading Equipped, exactly
four distinct rows: Weapon — Empty; Armor — Leather jack; Shield — Empty;
Catalyst — Empty. These are the four authored slots, not class restrictions.
Middle column heading Pack, four rows: Sword (selected), Hearthloaf ×1,
Dimstone ore ×3, Hide ×2. Sword is unequipped; do not duplicate sword in equipped
slot. Stack rows need no new object art. No capacity numbers or inventory grid
pretending to establish a slot limit. Ordinary sample fixture, not starter inventory.
Right detail panel: Sword heading, Common · Weapon secondary; sword illustration;
Base damage 10; Accuracy +1; No affixes. One clear Equip button. Bottom-right
Close. No Sell/price, durability, weight, comparison delta, affixes on Common,
rarity color-only cue, recipes/station actions, socketing or mechanic inventions.

Source game/src/balance/items.ts: sword baseDamage10 accuracy1 slotweapon.
Game-design: four equipment slots weapon/armor/shield/catalyst, Common0affixes,
stack materials/consumables, currency marks. This finite selected-sword fixture
covers equipment/pack separation and baseline details only. Other rarities/affixes,
equippeditem actions, satchel, sorting/controller/keyboard/accessibility/localization
remain open. No gamecode/runtime/library change or authored starter-kit change.

One lane max two passes/30 active minutes. Exactprompt saved before builtinimagegen;
actualview imageinput; native-copy provenance equalSHA source/output bytes/dimensions
UTC/tooltime inputroles/hash seedmodelunavailable rights pending shipping. Two
independent Astra-low quality/theme screens plus root before revision. Humanapproval
closes. No external art or commit.
[Prompt/receipt](concept-art-batch-154-a.md) · [Review](concept-art-batch-154-review.md).

## Human revision — paper doll and pack thumbnails

User rejects text-only equipped/pack representation. This supersedes original
no-paper-doll/no-extra-thumbnail directions. New bounded package max two correction
passes/30 active minutes, same independent screens/root before revisions. Produce
v2 with wider Equipped column (~45%), Pack (~28%), selected details (~27%). Keep
legible exact labels/counts/stats/25marks/Equip/Close and charcoal/bronze/ivory style.

Equipped: full-body realistic generic adult Human player preview, neutral stance,
plain base trousers/boots, visibly wearing approved055 leather-jack-v3 toggled
brown leather vest over simple linen sleeves. No held weapon/shield/focus. This is
preview placeholder, not new named cast/locked sex/race choice. Four distinct slot
cards positioned around body with short unambiguous connectors: Armor at torso
shows matching leather jack thumbnail and Leather jack; Weapon near one hand,
Shield near other hand, Catalyst near waist each shows dim slot-outline glyph and
Empty. Exactly four functional slots, no helmet/boot/ring slots. Head/feet visible,
no card hides face/body/garment. Empty slots remain obviously empty. Base clothes
are appearance, not extra equipped items. Body carries same armor as slot thumbnail.

Pack: four large rows each with readable miniature picture at left, name and count:
selected Sword (matching original sword thumbnail), Hearthloaf ×1 (rustic wholeloaf),
Dimstone ore ×3 (dark mineral chunks with nonemissive muted violet inclusions),
Hide ×2 (folded tawny hide). Each row clearly separate. Approved039 hearthloaf,
047dimstone and049hide are appearance refs; not invented objects. Right details
retain selected unequipped Sword, Common · Weapon, full swordpicture, Base damage10,
Accuracy+1, No affixes, Equip. Sword appears only in Pack/details, not on body.

Inputs actualview154v1 layout/sword,055jackv3 garment,039loaf,047ore,049hide thumbnails.
New user request requires layout reconstruction; preserve readable visual language
not exact column widths. Native-copy source/output receipt per original workflow.
No code/runtime changes; all equipment appearance synchronization remains untested.

Revision pass2: swap lower Shield/Catalyst cards and connectors to distinct hands/waist, catalyst empty glyph wand-shaped, Pack sword proportions match detail. Bothscreens/root completed before revision.
