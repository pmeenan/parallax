# Batch 154 A — UI-005 inventory

## Human revision v3 — exact prompt saved before generation

Pass 2 of the bounded human-revision package; both independent screens and root failed v2 for same-hand connectors. Root authorizes correction of card placement/connectors, catalyst glyph and Pack sword proportions. Sole input `concepts/batch-154/ui-005-inventory-v2.png`, actually viewed, is edit target and visual reference; SHA-256 `BE185517355CDFC4B3420EADE75D44138485D606E9A83DF710EA621AA74740ED`. Prior project-generated prop lineage remains as recorded below. No further correction without screens/root.

```text
Use case: precise-object-edit
Asset type: Project Parallax UI-005 inventory v3, corrective layout edit.
Edit the provided inventory screen with ONLY these bounded corrections. Preserve the overall landscape layout, full-body player preview, worn brown three-toggle leather jack over linen sleeves, all text and stats, pack row identities/counts, colors, typography, charcoal/bronze panel styling, environment, selected state, right detail sword and buttons.

Correct the four equipment cards and connectors. Keep Weapon in upper LEFT and Armor in upper RIGHT. SWAP the two LOWER equipment cards: Catalyst must now be lower LEFT, Shield must now be lower RIGHT. Exactly four cards total.
- Upper-left Weapon: keep its dim empty slot glyph and exact words "Weapon", "Empty". Its short connector goes only to the hand/wrist on the LEFT SIDE OF THE IMAGE.
- Upper-right Armor: keep matching jack thumbnail and exact words "Armor", "Leather jack"; short connector to upper torso.
- Lower-right Shield: dim empty shield-outline glyph, exact words "Shield", "Empty"; short connector goes only to the hand/wrist on the RIGHT SIDE OF THE IMAGE, immediately beside this card. This opposite-hand connection is critical.
- Lower-left Catalyst: dim simple straight wand-like catalyst slot silhouette, exact words "Catalyst", "Empty". Replace the previous circle-with-cross/Venus-like glyph completely. Its short connector goes to the LEFT SIDE of the player's WAIST. It must not cross the torso to the other side. All connectors short and noncrossing, all cards outside the visible body silhouette.
No item is held. No new equipment slots or text. Body and both hands remain unobscured.

Correct only the Sword miniature in the selected Pack row: it currently has a shortened blade. Give it the SAME long straight blade-to-hilt proportions as the sword in the right details panel. Shorten its hilt relative to the blade and lengthen its blade, then scale the entire miniature down to fit the same row's illustration area without touching the "Sword" text. Preserve straight symmetrical steel blade/fuller's appearance, simple straight crossguard, brown grip and round pommel. Keep right-panel sword unchanged. Sword remains unequipped.
Everything else stays unchanged, including all four Pack rows, readable labels, "Inventory", "25 marks", "Equipped", "Pack", "Sword", "Hearthloaf ×1", "Dimstone ore ×3", "Hide ×2", "Common · Weapon", "Base damage 10", "Accuracy +1", "No affixes", "Equip", and "Close".
Do not invent mechanics, affixes, stats, extra equipment, captions or decorations.
```

### v3 output receipt

Built-in model identifier and seed unavailable. Project-generated input/output, no external artwork; service terms and reference lineage require rights review before public shipping. Rights-review flag pending, no library/runtime admission.

- Tool: built-in `image_gen.imagegen`, one v3 call (human-revision package pass 2). UTC `2026-09-16T21:33:02.358Z` to `2026-09-16T21:33:32.928Z`; tool wall time 30.6 seconds.
- Native source: `C:/Users/patme/.codex/generated_images/01a0ac08-b64d-77a3-8a87-7d6c60bdb755/exec-c277bb26-cfaa-494e-8b1d-4360522788d0.png`.
- Output: `D:/src/parallax/assets/reference/concepts/batch-154/ui-005-inventory-v3.png`.
- Source and output each PNG 1774 × 887, 1,645,482 bytes; equal SHA-256 `A7BC08470C74193DBA80AD2792028C67730E878794FB9C8565CEED80225925AF`.
- Byte-for-byte native copy, no postprocessing. Actually viewed output: lower cards swapped, Shield connects screen-right hand, Catalyst wand glyph replaces prior symbol with connector reaching screen-left hip/waist, and Pack sword blade proportion improved. Labels/details/full-body preview retained. Independent screens and root adjudication pending; no further revision performed.

## Human revision v2 — exact prompt saved before generation

New bounded package: at most two correction passes / 30 active minutes. This is pass 1. All five inputs actually viewed; v1 is edit target/layout and sword source; other images are object appearance only. This supersedes the original no-paper-doll/no-thumbnail direction. Generic preview does not define named cast or lock a player identity. Independent screens/root required before another pass.

```text
Use case: ui-mockup
Asset type: Project Parallax UI-005 inventory revision v2, landscape complete game screen.
Rebuild image 1's inventory layout to add a full-body equipment preview and item thumbnails. Preserve its readable warm ivory serif typography, translucent charcoal panels, thin muted bronze borders, softly defocused anonymous medieval stone/timber background, and practical restrained hierarchy. Enlarge Equipped to about 45% width; Pack about 28%; sword details about 27%. Generous spacing, crisp exact text. No ornament, modern/futuristic UI, tiny microtype, or explanatory captions.
Inputs: Image 1 is layout-edit target and sword appearance source. Image 2 is leather-jack garment appearance only. Image 3 hearthloaf, image 4 dimstone ore, image 5 hide are object-appearance references only. Do not copy their tabletop, cutting board, mannequin, studio background or staging.
Top screen heading "Inventory"; top-right "25 marks".
LEFT: heading "Equipped". Center a realistic full-body generic adult Human player preview, front-facing relaxed neutral stance, head and both feet visible, plain base trousers and boots, simple linen sleeves, wearing the brown sleeveless leather jack from image 2: round neck, stitched panels, three brown toggles, short skirt to hips. No sword, shield, catalyst, or other held equipment. Generic unremarkable placeholder, not a new named character or a character-creation screen.
Exactly FOUR equipment cards arranged around the body in the outer margins of the left panel. Leave the entire silhouette and garment unobscured. Practical rectangular cards with short clear connector lines to corresponding body areas. Armor card by torso contains a miniature of the SAME leather jack worn on the body and the exact text "Armor" and "Leather jack". Weapon card near one hand shows dim hollow weapon-slot glyph and "Weapon" and "Empty". Shield card near opposite hand shows dim hollow shield-slot glyph and "Shield" and "Empty". Catalyst card near waist shows dim hollow catalyst-slot glyph and "Catalyst" and "Empty". These three are explicitly empty slot outlines, not equipped objects. No extra head, boot, ring or body slots. Base clothing is appearance only, not extra items. Do not let cards or text cover the face, torso or limbs.
MIDDLE: heading "Pack". Exactly four distinct large rows. Each row has its own clear miniature object illustration at left and exact label to right. First row selected with restrained bronze outline: "Sword", with miniature straight symmetrical sword matching image 1's detailed sword, ordinary steel fuller, straight crossguard, brown grip, round pommel. Second row: "Hearthloaf ×1", rustic whole round loaf with appearance of image 3. Third: "Dimstone ore ×3", dark mineral chunks with muted nonemissive violet inclusions matching image 4. Fourth: "Hide ×2", folded tawny hide matching image 5's material. Illustrations isolated within rows, no reference staging. No inventory grid or capacity limit.
RIGHT: heading "Sword", secondary "Common · Weapon". Small full sword picture matching image 1, no clipping or deformation. Exact three detail lines: "Base damage 10"; "Accuracy +1"; "No affixes". One clear "Equip" button. Sword remains UNEQUIPPED in Pack/details only, not on the player and not in the Weapon slot.
Bottom-right screen button "Close".
All required labels must be clearly readable and accurate. No extra statistics, Sell, price, weight, durability, affixes, comparison, slot count, recipe, socketing, class restrictions, or new mechanics. No watermark. This is a static interface concept, not a implemented contract or starter inventory. Prioritize practical equipment cards around an unobstructed full-body preview, synchronized leather-jack appearance, distinct thumbnail rows, and exact readable copy.
```

### v2 input provenance

All project-generated references; no external art. SHA-256:

- `concepts/batch-154/ui-005-inventory-v1.png` — edit target/layout/sword: `622BDDF4497D03676BB142F47F0E18902907BB55DA6FEF711D4EA0FC43C14713`.
- `concepts/batch-055/item-006-leather-jack-v3.png` — approved garment appearance: `2F203A1F4AD20FBC81032786C96062AC0D36ADBD2F22E17D3C6CE7983A03D7AE`.
- `concepts/batch-039/item-020-hearthloaf-v1.png` — approved loaf appearance: `0A3639D426EB438072543AEF7ACBBD6319C0639BB66CCD04BC933BE49780B363`.
- `concepts/batch-047/item-030-dimstone-ore-v1.png` — approved ore appearance: `D859D4C07510FBC0BC8E110E5A334860778C5EFE962233DA213225C75D819210`.
- `concepts/batch-049/item-028-hide-v1.png` — approved hide appearance: `558260C306ACE7AB3D0E6B60182B9CD8A755106032E278D1005AC702AB13725E`.

### v2 output receipt

Built-in model identifier and seed unavailable. Reference/output service terms and lineage remain subject to rights review; rights-review flag pending before public shipping. No library/runtime admission; appearance synchronization is a static proposal, not runtime-tested behavior.

- Tool: built-in `image_gen.imagegen`, one v2 call (revision package pass 1). UTC `2026-09-16T21:28:01.937Z` to `2026-09-16T21:28:45.938Z`; tool wall time 44.0 seconds.
- Native source: `C:/Users/patme/.codex/generated_images/01a0ac08-b64d-77a3-8a87-7d6c60bdb755/exec-e3c7da13-c478-407e-84cd-a8671340645a.png`.
- Output: `D:/src/parallax/assets/reference/concepts/batch-154/ui-005-inventory-v2.png`.
- Source and output each PNG 1774 × 887, 1,641,380 bytes; equal SHA-256 `BE185517355CDFC4B3420EADE75D44138485D606E9A83DF710EA621AA74740ED`.
- Byte-for-byte native copy, no postprocessing. Output actually viewed. Readable required copy and all four slot cards/pack thumbnails are present, with full unobscured body wearing matching toggled jack. Generator flags for independent screens: Weapon/Shield connectors both approach the screen-left hand rather than opposite hands; Pack sword is shortened relative to details; loaf shows cut face and hide is spread rather than folded. No revision before independent screens and root adjudication.

## Original v1

One-pass candidate; pending independent quality/theme screens, root adjudication and human approval. Built-in imagegen; no CLI fallback. Sole reference actually viewed before generation: approved batch-051 sword v2, prop appearance only, no tabletop/background transfer.

## Exact prompt saved before generation

```text
Use case: ui-mockup
Asset type: Project Parallax UI-005 inventory/equipment landscape concept, fresh complete screen.
Create one polished readable landscape medieval-fantasy game inventory interface. Background softly defocused anonymous stone and timber environment, visible quietly around and through large translucent charcoal panels. Thin muted bronze borders, warm ivory serif typography, restrained hierarchy, generous padding. Crisp large text; sober practical interface, no ornate manuscript or futuristic design.
Input image 1 is the sole visual reference, approved sword appearance ONLY: ordinary straight steel symmetrical double-edged blade with fuller, straight simple crossguard, dark brown wrapped grip, round metal pommel. Preserve proportions in a small clear illustration in the right detail panel. Do NOT reproduce the reference tabletop, wood planks, background, composition, or lighting.
Composition: spacious three-column screen. Top heading at upper left reads "Inventory"; upper right currency reads "25 marks". Left column "Equipped", middle "Pack", right selected item details. Exactly four distinct equipment rows, no additional slots. Sword is selected in Pack and UNEQUIPPED: equipped Weapon remains Empty. A restrained bronze outline and slightly lighter charcoal fill show selection of the Sword row. No item grid; no character paper doll. Stack rows are text only, need no new object artwork.
Text (verbatim and legible):
Top: "Inventory" and "25 marks".
Left column heading: "Equipped".
Four left rows: "Weapon — Empty"; "Armor — Leather jack"; "Shield — Empty"; "Catalyst — Empty".
Middle column heading: "Pack".
Four pack rows: "Sword"; "Hearthloaf ×1"; "Dimstone ore ×3"; "Hide ×2".
Right column heading: "Sword".
Secondary line: "Common · Weapon".
Under the modest sword illustration: "Base damage 10"; "Accuracy +1"; "No affixes".
One clearly readable right-panel action button: "Equip".
Bottom-right screen control: "Close".
These are all the words on the screen. Do not add explanatory captions, counts, extra statistics, or labels. No Sell, price, durability, weight, comparison delta, capacity numbers, slot limit, new affixes, recipes, stations, socketing, class restrictions, rarity color-only cues, or new mechanics. No watermark. This is an ordinary sample inventory fixture, not a starter kit. Emphasize faithful exact copy, equipment/pack separation, attractive readable proportions and quiet game-world atmosphere.
```

## Receipt

Reference SHA-256: `EF0F38D5028221E9BD68627C76CEED90DEE52EA7146494AF35448E68B509D34C`. Reference role: sword appearance only; not an edit target. Source: `concepts/batch-051/item-001-sword-v2.png` (project-generated approved reference). No external artwork. Model identifier and seed unavailable through built-in tool. Rights: project-generated reference/output; applicable service output-usage terms and reference lineage require rights review before public shipping. Rights-review flag: pending; no runtime/library admission.

- Tool: built-in `image_gen.imagegen`; one call, pass 1. UTC request window: `2026-09-16T21:04:52.049Z` to `2026-09-16T21:05:28.678Z`; tool-reported wall time 32.3 seconds.
- Native source: `C:/Users/patme/.codex/generated_images/01a0ac08-b64d-77a3-8a87-7d6c60bdb755/exec-334f1043-fbe6-4d65-b7be-e5229f1bf6c6.png`.
- Output: `D:/src/parallax/assets/reference/concepts/batch-154/ui-005-inventory-v1.png`.
- Source and output each: PNG, 1774 × 887 pixels, 1,419,842 bytes; SHA-256 `622BDDF4497D03676BB142F47F0E18902907BB55DA6FEF711D4EA0FC43C14713` (equal).
- Native file copied byte-for-byte; no crop, resize, paint-over, compositing, or other postprocessing.
- Generator inspection: actually viewed output. All requested copy reads correctly; exactly four equipment rows; selected Sword remains in Pack while Weapon reads Empty; required three sword details and Equip/Close present; no extra invented mechanics or tabletop transfer observed. Independent screens and root adjudication remain pending; no revision attempted.

Final: quality154/theme154 Astra-low and root PASS, onepass; human approval pending. [Review](concept-art-batch-154-review.md).

Final v3: both independent quality154/theme154 Astra-low and root PASS; two usercorrectionpasses used. V1/v2 superseded, not approved. V3 human approval pending; see review.

Human approved v3 on2026-09-16; v1/v2 not approved.
