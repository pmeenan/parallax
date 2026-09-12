# D1 shared site plan — proposal 2: expanded port town

Status: proposal 2 human-approved; adopted as geographic reference by D-191.
Replaces free-form geographic invention in new wide concept briefs. Runtime
descriptor migration remains pending. This is a site diagram, not generated terrain.

[Review drawing](concepts/batch-074/d1-shared-site-plan-v2.svg).
North is +z, east is +x; all coordinates below are proposed metres in the existing
4096 m square. Drawing uses x=510+0.22x, y=610-0.22z. Existing anchors are retained.

## Spatial relationships

- Castle remains at the center on its hill. Preserve castle envelope |x|,|z|≤128
  and surrounding moat envelope |x|,|z|≤384. The plan draws a complete water ring;
  actual continuous water surface still requires implementation, not tiled assumptions.
- Existing village core surrounds the moat on dry land. Preserve west square
  (-640,-96), village well (-512,-128), craft stops and three catacomb anchors.
- **Expand the village into a substantial port town**, rather than a thin coastal
  strip or hamlet. The core reservation spans roughly x=-1050..950, z=-650..460,
  excluding the unchanged moat. This envelope includes streets, yards and gardens;
  it is not a solid carpet of houses or a population/building-count commitment.
- **Connect a broad lower town to the shore**, roughly x=-1050..250,
  z=-600..-1536, replacing part of the current southern field band. Its width grows
  from proposal 1's 450 m corridor to about 1300 m. It should support several
  residential/craft blocks and multiple streets, not a single road lined with houses.
- A substantial port frontage occupies approximately x=-1050..300 near z=-1536,
  about 1350 m compared with proposal 1's 750 m reservation.
  Warehouses, cargo yards, merchant offices/courtyard, tavern and inn belong here.
  Several long piers and large ships are reserved, not a few fishing sheds. Pier
  lengths, dredging, water depth and turning clearance are not approved engineering.
- Keep open beach east of the port, approximately x=350..1200. A modest timber
  fishing landing is distinct from the merchant port. Shoreline remains southern.
- **Add the main inland crop belt** around x=-1250..1250, z=500..750, outside a
  proposed northern agricultural exit near (0,500). It feeds the existing forest-edge
  waypoint (0,768), with forest beyond. The belt replaces some north village/grassland
  zoning; no displacement of the forest-edge anchor or forest ruin (640,1280).
  Keep secondary southern fields outside the expanded town; not all farming
  must occupy one band. Existing village-to-fields marker (-640,-768) remains a
  southern farm-route junction, not silently renamed as the new northern gate.
- Existing mountain vista marker (0,2560) remains outside playable bounds.

## Town circulation and scale — human correction

Proposal 1 was underscaled for the approved port. Proposal 2 adds a complete dry-land
street circuit around the outside of the moat, western market/craft and eastern
residential blocks, a broader lower town, and a substantial merchant/warehouse quarter.
Cross-streets and secondary lanes create multiple routes through and around each
quarter. Three principal port-bound streets plus side lanes connect to a continuous
quayside street; routes reconnect instead of ending at district labels. Public square,
merchant courtyard and cargo apron are reserved as open spaces. The street circuit
goes around the moat, not across it; only the southwest bridge crosses to castle.

Schematic straight lines convey connectivity, not a modern orthogonal street-design
requirement. Later blockout should vary bends, short lanes and courtyard access in
the approved medieval style. Building symbols indicate neighborhood texture, not
literal giant buildings or a fixed count. Preserve a modest town character with
several developed quarters sufficient for a substantial port, not metropolitan scale.
The broadened footprint is an explicit additional zoning proposal; runtime unchanged.

## Reference cameras (proposed locations; ground heights sampled later)

| Camera | x,z | Aim / visibility contract |
| --- | --- | --- |
| C1 field-to-castle | -1100,650 | Toward (0,0), southeast. Castle in middle distance; coastal village and southern sea lie beyond/right, terrain permitting. Establishing variant may raise camera to expose connection; never invent hills to hide it. |
| C2 gate approach | -560,-560 | Northeast toward southwest bridge/gate proposal. Coastal village behind camera; no ocean behind keep. |
| C3 port-to-castle | -600,-1450 | North-northeast through connected town toward (0,0), the inland castle. Sea behind camera. |
| C4 village-to-fields | 0,490 | North through agricultural gate, crops then forest. Castle behind camera. |
| C5 forest edge | 0,768 | North into woods; a reverse south view sees fields before village/castle. |

Bridge shown on southwest approach follows the selected castle-reference character;
precise bridge bearing/gate station remains a proposal. Footprints are planning
reservations, not parcel boundaries. Large-scale north/shore relationships and camera
contracts govern future drafts; a pretty view cannot move them.

## Reconciliation and adoption

The current descriptor puts fields at z=-1536..-640, village short of the shore,
and forest at z≥768. It cannot demonstrate the shore village plus inland
gate→fields→forest sequence unchanged. The explicit proposed changes above
resolve this without relocating existing named anchors. Current cell-grid water
surfaces are not proof of an unbroken moat. No code or world data changed here.

Human selection is recorded in D-191. Future implementation must update descriptor zones,
routes, harbor reservations and affected gameplay/harness consumers. Reconcile
selected gate/bridge composition with one model. Batch076 A v2/B v4 are now
human-approved C2 approach and companion bank references, including corrected
waterside house elevation and open street-to-bridge junction.
Batch075 C1 v2 and C3 v1 are human-approved; C1 replaces Batch073 A as the
field-to-castle geographic reference. Batch073 B is unapproved
local architectural direction. Earlier close scenes retain their material/space
approvals, not any conflicting incidental distant geography.

## Earlier artwork reconciliation — after Batch075 approval

Retain originals and their provenance. Supersession changes reference authority,
not the image bytes or historical artistic selections. Batch074 fixes geography;
approved Batch075 illustrates it without replacing metric layout validation.

| Earlier reference | Treatment |
| --- | --- |
| Batch073 field silhouette A | Superseded by approved Batch075 C1 v2; no further replacement needed. |
| Batch003 castle street/gate studies and Batch073 gate B | Local architecture studies only. Their separate low gateway and approach arrangements differ from the approved overview. Produce one reconciled C2 gate/bridge view for ENV-012, with ENV-013 bank/crossing coverage; do not model multiple incompatible gate arrangements. |
| Batch002 selected castle A | Keep dominant round keep, materials and defensive character. Its mostly rural outer moat surroundings are superseded by the developed quarters/circuit in the approved plan and Batch075. No duplicate castle overview needed. |
| Batch009 selected port A | Keep substantial piers, ships and waterfront buildings. Use Batch074/075 for connected lower-town geography; older distant terrain/coastline is not authoritative. Missing castle in this cropped, unregistered view alone does not prove a conflict. |
| Batch001 village B and Batch006 beach A | Keep local materials, streets and shore treatment. Occluded moat or off-camera port is not evidence of contradiction. Incidental horizons do not establish coordinates. |
| Interiors, props, characters, spells and local detail studies | No replacement required solely because of the new surface layout. Future exterior backgrounds must follow named camera contracts. |

Bounded retrospective review: lead inspected Batch003 castle street/gate studies;
an independent GPT-6 Astra/low reviewer inspected selected Batch001, 002, 006 and
009 originals. This is not a claim that every historical image has been re-screened.
Prioritize the reconciled gate/crossing next, then missing catalog panoramas; retain
accepted close scenes unless a specific visible conflict is found.

Production: Batch074, deterministic authored SVG so compass, anchors and routes
cannot drift during image generation. Two review/revision passes, 60 minutes active;
independent geography/quality and theme/consistency screens plus lead inspection.
Raster export is only a deterministic rendering of the SVG; no external imagery.
