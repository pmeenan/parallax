# ENV-033 — tavern interior, Batch 013

Status: B v2 human-selected for quieter corners where secret groups meet away from
crowds. A retained as alternative. Explicit crowd/folk-scale limitations remain;
artistic room selection is not an unqualified full-brief or character pass.
[Bounded brief and exact prompts](../concept-art-batch-013.md).

Input: selected [hospitality courtyard B](../concepts/batch-010/env-033-b-court-v2.png)
for exterior materials, scale and original fantasy daily life. Interior layout is
an interpretation, not evidence of unseen building construction. Human-selected
courtyard/overall port remain intact. No character canon, new classes or map changes.

Provider OpenAI built-in imagegen; seed unavailable. Model metadata, original hashes
and generation timings recorded on completion. Project-generated inputs only; rights
review pending applicable account/output terms before public shipping. No runtime use.

Two independent generation subagents, with separate theme/quality reviewers using
GPT-6 Astra / low; both reviews and lead adjudication before revision/dependent use.
A hall and B connected rooms are one pass each initially; two-pass maximum per subject.


## First-pass originals and timings

- A: [broad hall v1](../concepts/batch-013/env-033-interior-a-hall-v1.png), source
  exec-c5c83d92-08bb-4e4c-91b4-5bacaf511198.png (generation task tavern_gen_a).
  Job 2026-09-06T20:25:40.762Z to 20:26:32.559Z, 51.797 seconds.
- B: [connected rooms v1](../concepts/batch-013/env-033-interior-b-rooms-v1.png), source
  exec-5b89fdc8-e1b2-4402-a7dd-caa359f16262.png (generation task tavern_gen_b).
  Job 2026-09-06T20:26:16.198Z to 20:27:06.093Z, 49.895 seconds.

Both used exact respective prompt from brief and selected courtyard B v2 input.
Summed generation waits 101.692 seconds; first-start to last-finish generation window
85.331 seconds; overlap 16.361 seconds. Agent setup/preparation is outside job waits.
This demonstrates overlap, not a guaranteed 2x end-to-end speedup. Fresh agent startup
staggered first calls; future reused/prepared lanes can reduce that setup imbalance.

## First-pass review and adjudication

Independent tavern_theme and fleet_quality, GPT-6 Astra / low, inspected both originals.
A: room construction, circulation, flame/daylight and tangible magic pass; required
visible Skarn and clearly scaled mature Wickfolk. B: connected rooms/supports and
foreground Skarn/magic pass; required clearly scaled mature Wickfolk. Lead agrees.
Both reviews completed for each image before dispatching its correction. A/B correction
prompts in brief; each uses its own v1 only. Final second pass per subject, parallel.
Doorway glimpses emphasize quay more than selected courtyard: interior layouts remain
interpretations; full courtyard relationship requires later spatial validation.

## Second-pass originals and timings

- A: [hall v2](../concepts/batch-013/env-033-interior-a-hall-v2.png), input A v1 only.
  Source exec-ba2ad13a-58e0-45eb-a6b2-3a9f88f1bc29.png.
  Job 2026-09-06T20:31:32.991Z to 20:33:24.309Z, 111.318 seconds.
- B: [rooms v2](../concepts/batch-013/env-033-interior-b-rooms-v2.png), input B v1 only.
  Source exec-e8f79c8f-79dd-43dc-9e63-61f82171a47f.png.
  Job 2026-09-06T20:32:57.378Z to 20:33:39.129Z, 41.751 seconds.

Correction job waits total 153.069 seconds; generation window 126.138 seconds;
overlap 26.931 seconds. All four job waits total 254.761 seconds, versus 211.469
seconds across the two generation windows. First generation start through final
output spans 478.367 seconds including intermediate review/preparation. Timing is
observed overlap only, not a guaranteed backend speedup or full-batch latency claim.

## Final independent review and lead outcome

Both tavern_theme and fleet_quality (GPT-6 Astra / low) qualify the images for room
layout selection, not full-brief acceptance. A v2: visible Skarn and mature shorter
adult integrated coherently, but height comparison to unusually tall Skarn does not
prove human-relative scale; conversation pair narrows main aisle. B v2: added mature
adult only moderately shorter than nearby human, small-folk requirement unresolved;
room access remains readable with crowd narrowing. Lead agrees. No further automatic
generation after two passes per subject. Preserve unresolved folk/crowd requirements
for later bounded work after artistic layout choice. No structural/character canon claim.

Focused checks: original PNG dimensions/model metadata, SHA-256, matching Git LFS
index pointers and review/provenance links. Physical smoke deferred to M4.5 exit.

## Verified input and output identities

Unmodified 1536 x 1024 PNG originals; embedded model gpt-image 2.0. SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| env-033-b-court-v2.png | d6f5e008d3a54e5a207c8a1a117577a02286b87fe16a61c15035535c691efe2c |
| env-033-interior-a-hall-v1.png | 208457a9bca5e714ae2ed7a75b1b50ca902dcc00995b69e86699f7422c10c37c |
| env-033-interior-a-hall-v2.png | d69229dae67b575e32427b89e7984644675e11519c13d6881b62966acc308a29 |
| env-033-interior-b-rooms-v1.png | 3ccb9de4b776317420267565946b5236315ead5808dad70cf46c6579d3be9d98 |
| env-033-interior-b-rooms-v2.png | 09441ea2aad378c9cf015a458cfacd4c3a264bad7c8bcc4189125284c0cab30f |

Observed batch wall time from lane dispatch preparation through artifact checks:
approximately 883 seconds (14.7 minutes), including generation waits, agent setup,
reviews, lead work and metadata verification. This is below the 90-minute active-work
cap even without subtracting waits; individual job waits are not added to wall time.
