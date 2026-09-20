# Motion references — production review dispositions

2026-09-17, implementing accepted D192. This is the per-target handoff for the25
MOT catalog entries plus eight motion-only companion targets below, not evidence that any animation/physics target is finished.
No additional standalone concept board is currently required for these motion-only
questions. Existing character, equipment, station, creature and material appearance
references in the [catalog](concept-art-catalog.md) remain binding; their incomplete
appearance profiles are not waived. If a production test exposes a silhouette,
pose or effect-design ambiguity, commission that specific additional reference.

Each row is a brief for the named model/effect production step. Before producing
the clip, cite exact approved appearance images and suitable grounded movement
references; choose metric scale, camera distances, lighting, initial conditions and
explicit physical/gameplay assumptions. Use current game balance/controller contracts
for authored timing, not AI-estimated numbers. No physical values are inferred here.
Deliver playable-speed and diagnostic slow playback, relevant states/failure cases,
independent quality/theme screens and human artistic approval. Runtime QA/performance
and asset-admission gates still apply. Deferred research rows are not implementation
authorization. No motion is approved by this document.

| Target | Production review trigger | Required visible evidence; why a still board is unnecessary |
| --- | --- | --- |
| MOT-001 | First playable-folk rig/locomotion set | Idle/walk/run/sprint and start/stop for each authored folk scale; planted feet, weight transfer, equipment contact. Existing folk appearance supplies identity; gait requires clips. |
| MOT-002 | First controller-driven locomotion blend | Turns, strafe and direction reversal at varied speeds; hips/feet/facing continuity, no skating. Blend behavior is temporal. |
| MOT-003 | First rig on authored stairs/slopes | Uphill/downhill, stop on tread, shallow paving contact; measure penetration and support. Grounding/IK choice remains open; a pose cannot validate traversal. |
| MOT-004 | First sword/axe/spear combat clips | Light/heavy wind-up, contact, recovery and interruption with continuous grip/blade path. Approved weapons supply silhouette; timing/contact need playback. |
| MOT-005 | First guard/dodge animation set | Raise/hold/catch/break/re-raise lockout and dodge recovery, protected-direction readability and foot support. No still can establish active windows. |
| MOT-006 | First bow/catalyst clips | Draw/hold/release, arrow/hand/string continuity, bolt/rite handling and catalyst light matching approved spell palette. Geometry and release require moving models. |
| MOT-007 | First hit-reaction set | Accepted166 Staggered appearance, authored interruption and recovery; contact/weight. Additional knockback displacement is provisional and needs an explicit gameplay decision, not an invented board. |
| MOT-008 | First falling/landing controller presentation | Known-height/speed falls, foot/body contacts and recovery; no new jump mechanic. Set physical assumptions from controller/source evidence before testing. |
| MOT-009 | First voiced NPC conversation rig | Listening/speaking/gaze transitions, expressions and turn-taking at conversation distance across folk. Approved NPCs supply faces; social timing needs clips. |
| MOT-010 | First station/schedule animations | Walk/carry/sit/work cycles with actual station/prop geometry, hand contact and transitions. Approved stations remain construction references. |
| MOT-011 | First village crowd playback | Opposing walkers, queues, passing and conversation space; no intersections or foot sliding. Density/avoidance require multiple moving actors. |
| MOT-012 | First gnawer rig/AI animation | Pack locomotion, bite contact, flee and authored fast wind-up floor. Approved creature appearance retained; no swarm storyboard prerequisite. |
| MOT-013 | First Greymaw rig/AI animation | Circle/flank, planted launch/lunge/pounce/landing and pack spacing; weight and bite contact. Test actual curved trajectories. |
| MOT-014 | First brigand combat/conversation transitions | Sword/block/dodge, parley/yield and de-escalation without stance pops. Approved028/166 identity/cues retained; behavioral transitions require motion. |
| MOT-015 | First skitterling rig/nest playback | Multi-limb ground contacts, bite, swarm spacing and nest emergence without interpenetration. Approved creature/nest appearance supplies form. |
| MOT-016 | First hollow warden combat clips | Maul/slam anticipation, forceful contact, recovery and Exposed opening; preserve Staggered immunity and authored timing. Approved warden supplies mass/silhouette. |
| MOT-017 | First Warden Below encounter animation | Phase transitions, lance/maul/slam/summon/enrage, unchanged wind-up under faster recovery, shared attack limits. Existing boss/effect appearance plus full encounter playback; unresolved lance/summon appearance targets remain open. |
| MOT-018 | If scoped ragdoll research is activated | Standing/falling/stair cases; constraints, contact, settling, penetration/stretch/jitter measurements with declared scale and initial conditions. Still bodies cannot validate solver behavior. |
| MOT-019 | If cloth simulation research is activated | Hanging/run/wind/contact, seam attachment, stretch and collision failures using approved garments. Cloth appearance retained; solver quality needs time. |
| MOT-020 | If rope simulation research is activated | Explicit anchors, slack/tension, swing/contact and settling with measured stretch and loads. Existing rope appearance retained; no still-derived force values. |
| MOT-021 | If chain simulation research is activated | Link scale/orientation, hang/impact/contact and settling without length drift. Model links and joints must be tested in motion. |
| MOT-022 | If loose-object physics research is activated | Known wood/stone/metal objects on slopes/steps; rolling/sliding, contact, restitution/friction assumptions and settling. Grounded reference values required before solver tuning. |
| MOT-023 | If buoyancy research is activated | Floating object and optional rowboat load/rocking/settling with WATER007; waterline/contact, declared mass/scale and failure cases. No playable vehicle authorized. |
| MOT-024 | If deformation/friction research is activated | Mud footprint/track depth, contact/recovery and surface interaction under declared conditions. Material appearance and physical response remain separate; numerical values unmeasured until supported. |
| MOT-025 | First animated streaming/LOD integration | Near/far/depart/return, pose continuity, attachment preservation, no animation reset/pop; stress state restoration and transitions. Requires actual engine clips, not reference stills. |

Concept-stage motion disposition: documented for all25 rows. Animated quality status:
all remain open until their production evidence and human acceptance exist. This does
not close non-motion targets, admit models or end the M4.5 concept/appearance gate.

## Motion-only companion targets — catalog audit after Batch170

Accepted D192 also applies to these eight temporal/deformation rows outside the MOT
namespace. No additional standalone still is presently required for these questions.
Existing approved appearance references and incomplete profiles remain binding;
select exact files from their catalog targets in the production brief. Human animated
artistic acceptance, independent screens and runtime QA/performance remain owed.
No optional feature is newly authorized or declared complete by this scheduling.

| Target | Production trigger and required evidence | Existing appearance context / remaining boundary |
| --- | --- | --- |
| VEG-011 | First storm-driven vegetation preview: gust onset/travel, wet weight, varied phase, rooted trunks, recovery and failure cases. | Approved117–119 vegetation and124–125 wind poses; no synchronous whole-scene sway. Wet material appearance gaps remain open. |
| VEG-012 | First body/vegetation contact preview: collision location, bend limits, fixed roots, body clearance and recovery. | Approved plant families; no new harvest/destruction rule. Dynamic response requires clips. |
| VEG-013 | First moving near-to-vista foliage capture: silhouette/shadow stability, density transitions and LOD no-pop. | Approved118 canopy and vegetation catalog; no static board can prove continuity. |
| CHAR-021 | First garment/body rig deformation preview, with MOT019: joint extremes, seams, cloth/body separation and recovery. | Approved131–133 folk/loadouts and055–056 garments; advanced method not mandated. |
| LIGHT-008 | First moving camera/light fine-detail sequence: paving, roof, foliage, highlights, shimmer and ghosting. | Approved103 paving,088 roof,118 canopy,123–124 ground/street appearances; exact metrics and temporal evidence remain open. |
| LIGHT-017 | First optional motion-blur comparison: explicit shutter assumptions, camera/object motion, on/off, telegraph and interaction readability. | Human chooses appearance from moving production previews. No blur implementation or artistic acceptance implied. |
| LIGHT-019 | First density/streaming/occlusion traversal: near/far reveal, residency/LOD transitions and stable lighting/shadows. | Approved dense foliage/street and shared074 geography; no scene appearance gap waived. |
| WATER-007 | First wake/buoyancy physical study with MOT023: grounded initial conditions, water/object contact, displacement/wake/settling. | Approved138–141 water; begin with an existing approved simple object. Optional rowboat appearance remains unselected and must be resolved if selected; incidental harbor boats are not detailed boat designs. |

Mixed appearance-and-motion rows remain open in the catalog. This audit does not
waive cloud depth/ground-light, reflection/layering choices, approaching-storm/flash
appearance, combat cue selection, passive ability UI, lake/underwater/splash/runoff,
dust/debris or cinematic framing. Resolve each through a targeted still or a bounded
human-reviewed production preview as appropriate; do not generate blanket boards.