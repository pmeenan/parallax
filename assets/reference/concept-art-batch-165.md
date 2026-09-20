# Batch165 — larger human review packet: gameplay notices and recovery

Seven new independent concept images plus previously screened, still-unapproved
Batch162A knack assignment = eight candidates in one human review packet. Do not
pause for human approval after each internal pair. Two generation lanes maximum,
both independent Astra-low reviews/root for each original before revision or use
as a dependent reference. Each new image max2passes/30active minutes; whole packet
initial90active minutes excluding imagegen waiting. No filler/additional alternatives.

Visual family: approved charcoal translucent panels, thin bronze edges, ivory serif,
substantial small illustrated icon. Gameplay overlays, NOT full-screen menu cards:
keep at least two thirds of image unobscured scenery. Anonymous medieval setting,
no invented geography, NPCs/classes/modern fixtures. Minimal otherwise-clean scene;
HUD intentionally omitted to isolate overlay component, not an in-game hiding rule.
Text labels carry meaning alongside icons. Different examples not matched frames.
Fresh text-only generation unless an appearance reference is specified below. No
inherited UI images (avoid accumulated image texture degradation). No runtime actions.

A UI-010 new quest notice. File ui-010-quest-accepted-v1.png. Anonymous sunny dirt/crop
edge soft backdrop. Compact upper-center toast with illustrated grain/brokenarch
symbolic emblem. Exact 'Quest accepted', 'The Undercroft Stirs', 'Signs in the Fields',
'J · Journal'. No XP reward/completecheck/questchoice button. Authored mainquest
acceptance, not newly invented quest. No literal new tunnel geography.

B UI-010 stage completion. File ui-010-stage-complete-v1.png. Anonymous village
plaster/timber lane backdrop. Upper-center toast illustrated scroll/checkseal:
'Stage completed', 'Signs in the Fields', '+150 XP', 'Next: The Sealed Door',
'J · Journal'. This is mainstage1 complete, not entirequest completion. No loot,
levelup claim or choice. Stage150 fromquests.ts.

C UI-010 discovery. File ui-010-discovery-v1.png. Original091 village-waystone
appearance reference only; actualview before generation. Anonymous broader village
backdrop, stonevisible unobscured inworld, no authored town-layout authority.
Upper-center compact toast illustrated small matchingstone badge: 'Landmark discovered',
'Village Square Waystone', '+25 XP'. No fasttravel/unlocked-route button, no Rested
or respawnset claim (discovery doesnot rest). One state, no fullmap.

D FX-024 levelup notice. File fx-024-level-up-v1.png. Anonymous calm village view,
upper-center compact scroll/star emblem and words 'Level up', 'Level 3',
'+1 attribute point', '+1 ability pick', 'Stamina and Aether restored',
'P · Progression'. Small green/blue graphic accents, no redheart/healingwave or
worldexplosion. Health unchanged; no allpoolsrefilled claim. No XPprogressbar needed.

E UI-011 respawn aftermath. File ui-011-respawn-v1.png. Original091waystone
appearance input only; anonymous day setting, no new layout. No dead/injured body.
Compact lower-center notification modest stone/bag emblem:
'Returned to your waystone', 'Your loose materials remain at your fall site.',
'Gear, marks and XP retained.' No Retry/Continue button, timer, revivepurchase or
interactiveblockingdeathmenu. On defeat simrespawns lastwaystone; satchel material
sample assumednonempty. No networkteleportmap. Existingrest/respawn physics notproved.

F UI-011 satchel recovery near prompt. File ui-011-satchel-near-v1.png. Anonymous
forest dirt/stone ground. One modest worn brown leather flap satchel with simple
strap, coherent stitching/closure, resting with contact shadow (NOTglowing treasure).
Cameraclose enough for plausible reach; no people/hands. Small floating mutedivory
bag/diamond marker abovebag, compact lower-center 'Dropped satchel', 'E · Recover'.
No radius numbers, coins, XP/drop raritybeam, magicportal or extra bags. This is
appearanceproposal not a canonical equipmentbag. Universal E interaction pattern.

G UI-011 recovered notification. File ui-011-satchel-recovered-v1.png. Anonymous
forestground background withoutremaining bag (alreadyrecovered), no character.
Compact upper-center notice illustratedclosedbag/check emblem:
'Satchel recovered', 'Grain ×4', 'Salvage iron ×2'. Optional tiny ingredient pictures
must follow original044grain and045salvage appearance (actualviewifused asinputs).
No marks/XP reward or duplicated bag. Quantities sample, notstarterinventory.

H existing carry-forward: concepts/batch-162/ui-008-assign-knack-v1.png. No newimage,
retain its reviewed receipt and humanapprovalpending. Display in packet with label.

Sources: game/src/balance/quests.ts stage150/nextstage; exploration.ts discovery25;
progression.ts levelup1point1pick stamina/aether refill and nohealth; sim/items.ts
materialsatchel drops/recovery notmarks, docs/game-design.md defeat noXPpenalty.
No gameplay/lore additions. D192: no motionboards required for these appearance
choices; production briefs must later test notification timing/stacking/accessibility,
levelup refill behavior and respawn/recovery animation with human acceptance.

Each lane receipt records exactprompt BEFORE builtin, inputsactualview/hashrole,
outputnativecopy/sourceequalSHA bytesdims UTC/tooltime, modelseedunavailable rights
pending. No manual imageediting/compositing, library admission or commit. Root owns
central status/brief/review; generators own assigned lane receipts/images only.
