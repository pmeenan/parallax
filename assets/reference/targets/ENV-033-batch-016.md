# ENV-033 — private-room corridor, Batch 016

Status: B v2 human-selected for the bent corridor's extra hall privacy; A remains an alternative.
[Brief and exact prompts](../concept-art-batch-016.md).
Sole input [private chamber A](../concepts/batch-015/env-033-guest-a-private-v1.png).
Original hallway layouts are proposals; no actual floorplan or gameplay changes.
Provider OpenAI built-in imagegen; seed unavailable; project-generated input only.
Rights review pending applicable account/output terms before public shipping.
Both theme and quality Astra/low reviewers plus lead adjudication precede revisions
or dependent use. At most two passes per subject. Parent owns metadata; lanes own PNGs.


## Originals and timing

A [straight v1](../concepts/batch-016/env-033-corridor-a-straight-v1.png), source
exec-0cdcb47b-3ba0-419a-bf22-8d6e0b929bab.png. Exact A prompt, selected private room A.
Job UTC 2026-09-07T00:31:45.180Z to 00:32:27.236Z, 42.056 seconds.
B [bend v1](../concepts/batch-016/env-033-corridor-b-bend-v1.png), source
exec-28dbd0a7-4a2b-4708-bab7-2f96bb8a5e63.png. Exact B prompt, same reference.
Job UTC 2026-09-07T00:32:42.416Z to 00:33:21.309Z, 38.893 seconds.
Both agents reported READY after loading prompts/references before GO dispatch.
Despite prepared lanes, job intervals did not overlap: 15.180-second gap. Total job
wait 80.949 seconds; generation window 96.129 seconds. No measured speedup claimed.
Timing alone cannot identify agent/tool/provider scheduling cause; retain workflow
and measure overlap rather than assuming two agents guarantees simultaneous jobs.

## First-pass independent reviews

Both tavern_theme and fleet_quality (GPT-6 Astra / low) pass A: private doors/iron
hardware, level thresholds and open positions, clear route, grounded supports and
flame/daylight. Long sightline makes arrivals visible; exact swings/clearances open.
Both require B to show an unmistakable walkable right-angle continuation. Existing
B is a straight corridor with a wall bay; other materials/fixtures/figures pass.
Lead agrees. Both reviews completed before one targeted B correction; A not regenerated.
Neither concept establishes implemented locks, theft mechanics or a measured floorplan.

## B v2 correction

[Original](../concepts/batch-016/env-033-corridor-b-bend-v2.png), sole input B v1.
Exact correction prompt in brief. Source exec-c5ebfcc3-dc00-4bf0-9595-989a19e4b6d3.png.
Job UTC 2026-09-07T00:43:39.320Z to 00:44:09.522Z; 30.202 seconds.
Total waits across three originals 111.151 seconds. No unnecessary A revision.

## Final reviews and lead outcome

Both tavern_theme and fleet_quality, GPT-6 Astra / low: B v2 passes corridor selection.
Solid corner/continuous floor/turning runner establish distinct bend; open chamber
and supports remain coherent. Lead agrees. Conversing guests narrow continuation;
passing widths, swings and mechanical lock details need later layout references.
A passed first image; B corrected after both reviews, then received both re-reviews.
Three originals retained; B v2 selected for hall privacy. No runtime changes.

## Verified identities

Unmodified 1536 x 1024 originals; embedded model gpt-image 2.0. SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| env-033-guest-a-private-v1.png | 3fb385c0b74607306aace695f438eb677c08cb3f0054e62ca4bd01d524b5b911 |
| env-033-corridor-a-straight-v1.png | 17432e89c6b9ff99f8b38d59673c2a03c8f37224e3b15bb2c8b27c1c5df2b8b6 |
| env-033-corridor-b-bend-v1.png | 7592e295e422c566363c9c42b0b9a8748eecd4794e02983f32e2870838351e6a |
| env-033-corridor-b-bend-v2.png | a98602223e60c9fdd9c5d177507cc5dfc2c3ba0ad5d6f7af0ed89b4c303f0d04 |

Batch wall time through artifact checks approximately 1430 seconds (23.8 minutes),
including preparation, waits, reviews and lead work; below 90-minute active-work cap.
Focused hash/dimension/model/LFS/link and whitespace checks pass. Physical smoke
is deferred to M4.5 exit. Job waits alone do not represent total cycle latency.
