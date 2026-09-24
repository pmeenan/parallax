# Photoreal paving delivery package — brief (2026-09-24)

Next step in the [M4.5 plan](../../../../docs/plan.md): turn the human-approved
[photoreal `candidate1`](../proof-2026-09-22/photoreal-results.md) into a runtime
representation. Find out what it costs against the current class and streaming limits.

**Input.** Approved `photoreal/candidate1` with the source and map identities in its
[receipt](../proof-2026-09-22/photoreal/candidate1/receipt.json). The source art is not
reopened. Its approved views are the visual baseline. The binding references remain
KIT-001/KIT-003 (batch103), MAT-001/MAT-018 (batch108) and VEG-001 (batch116).

**Representation under test.** One periodic 4 m module:
- **Ground LODs.** Decimate the 16-bit height field with meshoptimizer, locking the border
  vertices. Opposite edges are sampled identically, so seams close by construction.
- **Normals.** Flat vertex normals, with all shading from a full-height normal map. This
  keeps shading identical across LODs and removes the review's boundary-normal mismatch.
- **Maps.** 4096² base colour, normal and ORM with `repeat` addressing, matching the
  district standard of 1024 texels/m.
- **Plants.** One atlased mesh.
- **Pebbles.** Large pebbles as instanced geometry; the rest are drawn into the maps at
  their exact source placements.

**Cameras and states.**
- The source views: walking, walking-matched, 22 cm joint, plant close-up, low opposing
  sun and overcast.
- A four-tile corner under grazing light, for tile joins.
- Matched mid and far LOD views.

**Question.** Does the representation keep candidate1's appearance through export, fresh
import and pinned-Chrome Babylon Lite WebGPU rendering? The Chrome render uses the engine's
own PBR material, lighting, CSM, `repeat` sampler and thin instances. Are tile joins
seamless, and what does the representation cost against the current class and streaming
limits?

**Must-fix defects.**
- Open position, normal or UV seams in any LOD, and visible join lines under grazing light.
- Lost mineral or soil grain, missing or floating pebbles and plants, or lost joint depth,
  at walking distance compared with the source.
- A shading pop between LODs.
- Wrong normal-map handedness or UV orientation in Chrome.

**Allowance.** Two full-quality candidate handoffs within one work session, capped at
4 active hours and 6 elapsed (started 09:48 EDT). Scripted preview passes inside the box
don't count (D-196).

**Ending decision.**
- **Success:** a delivery candidate with measured costs, plus the specific engine and
  limit changes installed integration would need, for a human or decision-log call.
- **Otherwise:** the specific failed fidelity or runtime requirement.

**Out of scope.**
- Rights review, extending the class QA, and library admission.
- Changing streaming limits or placing the module in the game world.
- Installed-game artistic acceptance and physical smoke (deferred to M4.5 exit).

The current streaming path rejects this module's maps: per-resource encoded ≤ 8 MiB,
decoded ≤ 32 MiB, and a 16 MiB resident encoded budget that the current kit already fills.
So the Chrome inspection feeds the production codecs and material directly and states that
boundary; it does not relax a check.
