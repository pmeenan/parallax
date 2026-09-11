# Spatial audio foundation

The M4.5 foundation is integrated into the ordinary runtime. It supplies a bounded
Web Audio service and game-owned event bindings; the shipped clip bank is empty.
Final SFX/ambience, audio admission, installed encoded-content loading, and human
audition are still required before the route's audio content is complete. Mathematical
test signals belong to the measurement harness, not the game asset library.

## Runtime ownership

`engine/src/audio/` owns a lazily created AudioContext, native equal-power panners,
gain nodes, mono PCM buffers, activation and page lifecycle. The main thread only
controls native nodes. There is no JavaScript sample-processing loop or new worker;
Web Audio owns audio rendering. HRTF, worklets, occlusion/reverb and adaptive music
remain later scoped work, without a claim that the present graph models acoustics.

The game configures 32 simultaneous voices, 32 clips and 16 MiB of retained plus
in-flight PCM. These are initial service capacities, not newly calibrated performance
budgets. Gain and panner nodes are allocated once when the context is created.
Each play creates the native single-use AudioBufferSourceNode; its slot is released
at completion or an explicit stop. Exhaustion drops the incoming request and counts
it. Suspended, hidden, scene-mismatched and listener-less playback is dropped instead
of queued for a later activation burst. No runtime request downloads a missing clip.

`prepareClip` accepts already decoded mono Float32 PCM at 8–96 kHz. It reserves
capacity before allocation, rejects invalid samples, yields between 16,384-frame
copies, and rejects completion after disposal. Its promise must settle before play.
The caller owns its source PCM and must keep it unchanged until preparation settles;
source buffers are not retained after preparation. Service memory counters describe
owned PCM, including reservations, not browser resident memory or caller staging.
`releaseClip` stops users and releases the cached buffer. Scene changes stop voices
but retain this bounded cache for reuse. Published content will need a QA-admitted,
release-bound loader before using this API; accepting PCM is not an admission bypass.

## Presentation and gameplay

The render camera and listener share the same orbit-camera constants and geometry.
World coordinates are metres, Y-up, with +Z forward at zero yaw. The Web Audio
boundary reflects Z for both sources and listener orientation. This follows the
[Web Audio spatialization coordinate contract](https://www.w3.org/TR/webaudio-1.1/#Spatialization).
Reference distance and maximum distance use the native inverse-distance model;
maximum distance clamps attenuation and is not a hard audibility cutoff.

`game/src/audio/gameplay-audio.ts` consumes existing combat attack/hit/defeat and
NPC-interaction events. Bindings and provisional gains/distances live in
`game/src/balance/audio.ts`; no simulation rules or event/save formats change.
The controller reads presented entity positions, deduplicates event sequences,
and clears old voices on authority invalidation and successful load. Missing
emitters stop their attached voices. Flythrough/benchmark ownership, renderer
unavailability and district swaps clear the gameplay audio scene.

Audio is only bound while the resident district matches the simulation's world.
The existing simulation binding is not migrated by this change. Entering another
district therefore cannot play stale actors from the previous world; D2 audio
content and any corresponding simulation handoff remain integration work.

Trusted pointer/key gestures activate audio. Hidden pages disable playback and
clear voices; page exit clears them too. Chrome interruption clears active voices.
Returning to a visible page permits new requests, without replaying missed events.
Native playback failures are recorded by audio rather than failing simulation.

## Evidence and recurring verification

Public telemetry v49 adds `spatialAudio` schema v1: state/failure, scene, fixed
capacities, retained/pending/high-water PCM, voice use, clip hits/misses, dropped
requests, activation attempts, resets, preparation elapsed time, and control-call
high-water duration. Native sample rate/base/output latency are observations, not
proof of physical end-to-end sound latency. Regular harness collection validates
the resource relationships; no new mandatory smoke budget is introduced.

Run `pnpm harness:spatial-audio` when changing this service or its coordinate/lifecycle
contract. It builds the exact candidate, uses the pinned sandboxed Chrome, and
retains JSON in `harness/results/spatial-audio-*/`. Chrome's OfflineAudioContext
renders the production panner graph to verify stereo handedness, listener turning,
and inverse-distance attenuation. A real AudioContext verifies trusted activation,
32-voice capacity and scene/disposal cleanup. The short, zero-output-gain control
window measures API submission only; it does not qualify DSP cost, acoustic quality,
combined game performance or physical presentation. Result identity includes the
build/release, executable hash, and source before/after; drift fails the probe.
The activation check explicitly suspends the native context before a trusted click;
it verifies the resume path, not Chrome's default autoplay policy. The same runner
checks the ordinary app's dormant audio telemetry through the existing privileged
network launch; it does not claim a fresh installed/offline lifecycle qualification.

Unit coverage exercises pending allocation limits, invalid/detached PCM, disposal
during preparation, old completion callbacks, interruption, visibility, missing
emitters, event deduplication and saved-timeline replacement. M4.5 still needs the
QA-gated audio set, surface/underground audition, representative combined workload,
and the final milestone smoke.
