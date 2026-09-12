# Animation source import

The source-candidate path accepts a self-contained skeletal GLB, validates its exact
bytes, and retains a candidate for review. It does not admit characters to the
library, retarget a rig, create animation content, or change gameplay presentation.

From the repository root, after installing the pinned dependencies:

```powershell
pnpm assets:animation:import <source.glb> <profile.json> harness/results/<new-candidate-directory>
pnpm harness:animation-import harness/results/<candidate-directory>
```

The candidate directory must be new and its parent must already exist under
`harness/results/`. Source and profile files are read without modification. Successful
imports contain a hash-named copy of the original GLB, the original profile bytes,
`validation.json`, and a `candidate.json` binding those objects by SHA-256. Failures
leave a failed validation report and no candidate manifest. Existing candidates are
never replaced. The second command rechecks all candidate hashes and reruns static
validation before starting Chrome; its independent result does not modify admission
state. Both commands run TypeScript compilation, including the engine's shared
canonical-buffer-layout validator, before using the source tools.

## Profile

Write an explicit profile alongside the export; replace the example hash with the
SHA-256 of the actual GLB. Names are exact and case-sensitive. Roles are authored
bindings for later content integration; they do not generate gameplay events.

```json
{
  "schemaVersion": 1,
  "assetId": "d1-npc-candidate",
  "rootNode": "Root",
  "clips": [
    { "name": "Idle", "role": "idle", "loop": true, "rootMotion": "in-place" },
    { "name": "Walk", "role": "locomotion", "loop": true, "rootMotion": "in-place" },
    { "name": "Attack", "role": "combat", "loop": false, "rootMotion": "in-place" }
  ],
  "provenance": {
    "sourceSha256": "<64 lowercase hexadecimal characters>",
    "author": "<author or generating agent/model>",
    "license": "<reviewed source/output license or terms>",
    "rightsReviewed": false,
    "references": ["<selected reference and kit IDs>"],
    "lineage": "<source, generation prompt/seed, retargeting/export steps and retained authoring file>"
  }
}
```

Use the reported `rigSha256` as the optional profile `expectedRigSha256` when a new
clip export must match a previously validated rig. The fingerprint includes named
ancestor/joint hierarchy, rest TRS and inverse-bind matrices; joint array reordering
does not change it. Different rest poses or hierarchies require explicit authoring-tool
retargeting and a new export. This is an exact compatibility check, not a promise
that similar skeletons will retarget well. The importer preserves an unreviewed rights
state and cannot turn it into approval.

## Supported source profile and checks

`skeletal-source@1` is deliberately an authoring-export profile. Export core glTF 2.0
as one GLB with embedded resources, one scene and one skin. Use named nodes, dense
accessors, applied object scale/transforms, explicit inverse binds, four skin
influences, and baked LINEAR or STEP clips. Sparse data, extensions/compression,
CUBICSPLINE, animated scale, morph targets, and travelling loops are rejected with an
actionable error; they need their own qualified profile. Compression remains required
at production packaging, as do KTX2, material, LOD and other applicable character QA.
This source profile does not weaken those admission requirements.

The pinned [Khronos validator](https://github.com/KhronosGroup/glTF-Validator) checks
the GLB container, schema, references, binary accessors and animation encoding.
Errors and truncated reports fail import; warnings/hints remain in the report.
Project checks then enforce:

- Unique connected rig hierarchy and a root above every joint; exported rest pose
  consistent with inverse-bind matrices, with identity skinned-mesh object transforms.
- Finite, normalized weights and valid joint indices; explicit clip names/roles.
- Increasing timelines beginning at zero, with each track spanning the full clip.
- Loop endpoint translation/rotation agreement, including equivalent quaternion signs.
  Endpoint agreement does not establish smooth velocity, foot contact or artistic quality.
- In-place root and ancestor transforms staying at their rest pose throughout the clip.
  Authored root travel is allowed only for non-looping clips and is reported; it is not
  applied to simulation or collision. Child-joint motion remains allowed.
- Bounded source bytes and decoded components, node/bone/triangle/clip/key counts,
  and clip duration. Initial ceilings are 64 MiB source, 8 million accessor components,
  256 nodes, 128 bones, 250,000 triangles, 32 clips, 200,000 sampled keys and 120 seconds
  per clip. They bound offline import work and its reports; they are not calibrated
  gameplay budgets. Limits/tolerances and the versioned profile are centralized in
  `animation-policy.ts` and must evolve explicitly with the first approved body types.

## Loader evidence and regression check

```powershell
pnpm harness:animation-import --fixture
```

This builds an original mathematical two-joint fixture under ignored results, runs the
same candidate import, and sends the exact validated bytes to a dedicated Chrome
worker. The engine-owned adapter uses the pinned Babylon Lite loader, verifies bone
names and clip durations, and stops automatic playback. A small diagnostic scene seeks
each clip to 0%, 25%, 50% and 100%, retaining PNGs. The fixture asserts visible skin
deformation, LINEAR progression, STEP hold/change, and identical loop endpoint pixels.
No fixture enters the library, and no third-party artwork or paid generation is used.

Reports bind candidate/source/probe hashes, the renderer package, checked Chrome
executable and browser identity, and source state before/after. External requests are
blocked. Import elapsed time, mesh/joint counts, clip samples and capture hashes are
diagnostic observations. The preview camera fits rest bounds; character-scale motion,
occlusion, animated bounds and deformation quality still need authored scene review.
An import pass alone does not assert that every sampled pose is visible or artistically
correct for an arbitrary candidate. The fixture's additional pixel checks are explicitly
fixture-only. No frame-budget, physical-presentation or installed/offline qualification
is claimed by this source-tool run.

M4.5 remains open for the actual NPC/enemy, full character-class material/mesh/LOD and
compressed worker QA, rights and library admission, installed packaging, gameplay-state
animation bindings, and human inspection of the finished motion in the combined scene.
