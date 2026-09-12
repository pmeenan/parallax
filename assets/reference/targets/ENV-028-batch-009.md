# ENV-028 — substantial port revision, Batch 009

Status: A human-selected for greater port scale and scenario/interaction potential; B unselected as too small and village-like. All Batch 008 options were rejected by the human for insufficient port scale. This revision follows [the bounded brief](../concept-art-batch-009.md).

## B — broad cargo apron and social street

Original: [B v1](../concepts/batch-009/env-028-b-port-v1.png).
Source tool file: exec-32a5a653-7e4a-48ea-8e90-2dc72736e8ad.png.
Inputs: selected village B and shore A, same originals as A.

Exact prompt:

```text
Use case: stylized-concept. Project Parallax ENV-028 SUBSTANTIAL REAL PORT DISTRICT option B, BROAD OPEN L-SHAPED QUAY WITH FIVE LONG PIERS. Single 1536x1024 landscape AAA photoreal movie-quality concept, bright afternoon sunlight. Supplied village B and beach A are MATERIAL references only, never limits on size. Human explicitly demands real port scale: MULTIPLE LONG PIERS, MANY LARGE SHIPS, TAVERN, INN, MERCHANT OFFICES. Wide elevated oblique view of a developed multi-block medieval waterfront district occupying left and upper frame, open deep-looking sea lower/right. Broad L-shaped stone working quay along shore, FIVE LONG BRACED TIMBER FINGER PIERS extending into open water from its outer edge, roomy spaces between berths; not an enclosed basin, no breakwater. Four LARGE merchant sailing ships with hulls several ordinary house widths long and three distinct substantial seagoing fishing ships with working nets and sober smaller rigs; separate recognizable hulls afloat beside piers, NO overlapping ships, NO pier inside hull, supported boarding gangways. Two fishing piers at far end, three merchant piers in foreground. Broad cargo yards and five weathered stone/timber warehouses form industrial waterfront. A clearly separated social street and square behind yards: distinctive TWO-STOREY TAVERN fronting square with timber porch, outdoor benches and tankard-shaped sign; separate LARGE THREE-STOREY modest courtyard INN with archway, many windows and balcony; row of FOUR SMALLER MERCHANT OFFICE buildings, separate doors/trade signs, facing quay street. At least 20 buildings total over several blocks, varied footprint and roof height, no repetitive copied facades. Open inland supply road exits toward existing inland castle outside frame. Neutral tiny sailors/dockworkers for convincing scale; cart lanes, 2-3 simple wooden hand cranes, cargo stacks, rope/wood/iron fittings. Weathered modest medieval village material language, rough irregular plaster and timber with terracotta roofs, sunny readable shadows, realistic water. No pristine luxury, no modern gutters/electric lamps/cranes, no cannons or gilded fantasy galleons, no text labels. Sandy coast continues outside far end but small fishing landing is independent and outside frame. Must feel like a FULL PORT DISTRICT able to support nearby castle and sailor/captain/pirate interactions, not a tiny fishing village. Maintain generous maneuvering water around ships. Geography/berth depths/building roles proposed, not engineering or new gameplay. Make the hospitality street legible within overall port composition.
```

Provider: OpenAI built-in imagegen; embedded model gpt-image 2.0; seed unavailable. Original PNG bytes retained. Reference inputs are project-generated village B and shore A, used for materials and quality only. Rights review remains pending applicable account/output terms before public shipping. No third-party image inputs.

## A — long quay

Original: [A v1](../concepts/batch-009/env-028-a-port-v1.png).
Source tool file: exec-da95f467-ba07-48df-badf-8736b8700589.png.

Exact prompt:

```text
Use case: stylized-concept. Project Parallax ENV-028 SUBSTANTIAL REAL PORT DISTRICT option A, LONG QUAY AND FOUR LONG PIERS. One landscape 1536x1024 AAA photoreal movie-quality environment. IMPORTANT HUMAN CORRECTION: earlier attempts were far too small. This must be a DEVELOPED MULTI-BLOCK WORKING PORT, NOT 2 warehouses and 3 tiny jetties. Supplied selected village B and beach A are MATERIAL/QUALITY references ONLY; do not copy their small-scale composition. Elevated 35-degree oblique overview looking along a long working stone quay, with FOUR LONG BROAD BRACED TIMBER FINGER PIERS extending out into open sea and generous navigable gaps. SEVEN LARGE wooden ships clearly afloat at separate berths: four substantial merchant cargo sailing ships, three big seagoing fishing ships. Each large hull is several ordinary house-widths long, with sober original medieval rigs/furled canvas, no gilded fantasy galleons/cannons. Visible supported gangways, pile/bracing support, no hull/pier collisions. Behind quay show a COMPLETE PORT DISTRICT of roughly 20 weathered timber/plaster/stone terracotta buildings across several blocks: 5 large warehouses directly facing broad cargo aprons; a distinct generous two-storey TAVERN with open ground-level frontage, benches and tankard-shaped sign on a side social square; separate substantial three-storey courtyard INN with many modest windows and ground archway; a ROW OF FOUR MERCHANT OFFICES with separate doors and modest hanging trade signs overlooking quay. Show clearly readable streets connecting these buildings, pedestrian social spaces set behind loading areas, cargo stacks and 2-3 simple medieval hand cranes, inland supply road leaving frame toward existing castle. Tiny neutral dockworker/sailor figures for scale, no detailed character portraits. Keep original weathered grounded medieval character, no luxury pristine waterfront, modern cranes/electricity, plastic, steel ships or text labels. Open sandy shoreline continues beyond port at one edge, with small fishing landing only a minor distant feature or outside frame; accepted beach dock remains independent. Bright warm sunlight/cool shadows, natural blue-green sea with dark water at large berths, high material fidelity, believable human/ship/building ratios. DO NOT shrink the port to fit a village postcard. This is substantial local waterfront district, not necessarily entire world city. Geometry/depth/building roles proposed, no fixed map, new sailing mechanics or inland castle relocation.
```


A v1 screening: harbor_theme (GPT-6 Astra / low) conditional pass and harbor_quality
(GPT-6 Astra / low) composition/scale pass, both before the next image. Developed
blocks, many substantial piers and large ships now meet scale brief. No required
composition correction. Lead agrees. Required caption condition: building uses are
proposed roles, not visually proven functions. Proposed key: large arched three-storey
building in upper-left quarter = inn; lower two-storey gabled building immediately
right of it facing small square = tavern; repeating narrow fronts just behind the
upper quay = merchant offices; large foreground quay buildings = warehouses.
Close hospitality/business views remain ENV-033/034, not covered by this overview.
Berth maneuvering/depth, gangways obscured by hulls, rigging and structural capacity
remain unverified. Small selected beach landing is outside this view.

## Verified input and output identities

| Artifact | SHA-256 |
| --- | --- |
| assets/reference/concepts/batch-001/dir-002-b-sunny-v1.png | 018648eb3a7ead8b69f4863f02c1da39ad8ca12b2c916916b1c59c86e21c8171 |
| assets/reference/concepts/batch-006/env-020-a-sand-v1.png | be5633c9e42593e8358a131b664dfaea46831282faf51c7c1fcf01a467f098c8 |
| assets/reference/concepts/batch-009/env-028-a-port-v1.png | 8758ffc0f25134e9a205b1b26441c4b52809fd172f6a0cb7c31765ecc2ee75d4 |
| assets/reference/concepts/batch-009/env-028-b-port-v1.png | b5e75ad5fa494e8f0a599fd44ee55697a8721d552ed765e9d0a25e6a3fef0887 |

## B v1 screening and batch outcome

harbor_theme and harbor_quality, both GPT-6 Astra / low: pass for expanded scope,
medieval theme and composition. Lead agrees. Connected supported piers, large ships,
warehouses, developed blocks and generous aprons satisfy the corrected scope brief.
Tavern porch/tables read clearly; inn and merchant-office uses remain proposed key
assignments in the comparison. No mandatory composition correction. Foreground
boarding link reaches hull but bulwark passage remains unclear. Rigging, berth/depth,
maneuvering and load engineering remain open; no unmistakable hull/pier collision.
Ship silhouettes do not complete fishing/merchant KIT-035/036 references.

Two images, one generation/review pass each; no rejected Batch 009 originals.
Both reviewers inspected A before B generation. Approximately 115 seconds of image
generation waits, separate from active work (under the 90-minute cap). Human artistic
selection: A. Full profiles, building-role details and map relationships remain
open. Physical smoke deferred to M4.5 exit; reference-only change.
