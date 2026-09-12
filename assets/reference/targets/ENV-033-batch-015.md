# ENV-033 — guest accommodation, Batch 015

Status: A human-selected for private-room adventure opportunities (locked doors,
private conversations and stealing); B unselected for this use.
[Brief and exact prompts](../concept-art-batch-015.md). Private and shared lodging may
coexist. Selected open inn hall A combines barkeep and lodging management.

Reference: [inn A](../concepts/batch-014/env-033-inn-a-hall-v1.png). Guest interiors are
proposed interpretations, not measured unseen floorplans. No runtime or gameplay changes.
Provider OpenAI built-in imagegen, seed unavailable. Project-generated input only;
rights review pending applicable account/output terms before public shipping.

Independent generation lanes, both Astra/low theme and quality reviews plus lead
adjudication before any revision/dependent use. At most two passes each. Full character
anatomy, construction and metrics remain open.


## Originals and generation timings

A [private chamber](../concepts/batch-015/env-033-guest-a-private-v1.png), source
exec-2f2b5fd8-1a75-4bc1-835e-bd4b7f66ef32.png. Exact prompt A, selected inn A only.
Job UTC 2026-09-06T23:48:45.870Z to 23:49:27.069Z; 41.199 seconds.
B [shared room](../concepts/batch-015/env-033-guest-b-shared-v1.png), source
exec-6c86cd9f-df5b-4250-b72f-ed6153fa5d56.png. Exact prompt B, selected inn A only.
Job UTC 2026-09-06T23:49:38.586Z to 23:50:23.787Z; 45.201 seconds.

Independent lanes were dispatched, but these generation calls did NOT overlap:
11.517-second gap between A completion and B start. Summed job waits 86.400 seconds;
first-start to last-finish window 97.917 seconds. No parallel speedup claimed for
this batch. Preparation/scheduling offset the benefit; recorded times do not identify
whether agent startup or provider scheduling dominated. Review gates remain unchanged.

## Independent reviews and lead outcome

Both tavern_theme and fleet_quality (GPT-6 Astra / low) pass A and B for room selection;
lead agrees. A: coherent accessible private room, plausible furnishings, mature traveler,
physical catalyst and daylight/candles. Spare chair occupied by washware limits ready
conversation seating. B: broad aisle and usable separate beds, mature varied fantasy
folk, grounded material/frame quality. Five full/partial beds are proposed capacity,
not a four-bed authored requirement. Loose boot relationship to Skarn's legs is ambiguous
and needs close prop reference; no required layout correction. Exact bed clearances,
folk scale and full construction remain open. Two originals, one pass each; no unnecessary
revisions. Both independent reviews completed before handoff; human suitability pending.

## Verified input and output identities

Unmodified 1536 x 1024 PNG originals; embedded model gpt-image 2.0. SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| env-033-inn-a-hall-v1.png | 198be5c1268cb562b1ec199ff4b098325c8fcd134fab624c5e04982a9ec75fc2 |
| env-033-guest-a-private-v1.png | 3fb385c0b74607306aace695f438eb677c08cb3f0054e62ca4bd01d524b5b911 |
| env-033-guest-b-shared-v1.png | 096b69e9ddcf33288cee176e98d150f7f90342b46e921eaf84dc64ead1ee792f |

Batch wall time through focused artifact checks approximately 626 seconds (10.4
minutes), including preparation, waits, reviews and lead verification; below 90-minute
active-work bound. Hash/dimension/metadata/LFS/link checks and diff whitespace check
pass. No runtime changes; physical smoke deferred to M4.5 exit.
