import {
  gameplayCameraPose,
  type SimulationPresentationSnapshot,
  type SimulationService,
  type SpatialAudioService,
  type WorldStreamingService,
} from "@parallax/engine";
import { GAMEPLAY_AUDIO_CUES } from "../balance/audio";
import { PLAYER_ENTITY_ID } from "../sim/m3-simulation";

export interface GameplayAudioController {
  dispose(): void;
  update(
    presentation: SimulationPresentationSnapshot | null,
    pitchRadians: number,
    enabled: boolean,
  ): void;
}

export function createGameplayAudioController(
  audio: SpatialAudioService,
  simulation: SimulationService,
  streaming: WorldStreamingService,
  worldId: string,
): GameplayAudioController {
  let disposed = false;
  let lastEventSequence = -1;
  let observedLoadCount = simulation.snapshot().loadCount;
  let presentation: SimulationPresentationSnapshot | null = null;
  let enabled = false;
  const available = (): boolean => {
    const world = streaming.snapshot();
    const state = audio.snapshot().state;
    return (
      !disposed &&
      enabled &&
      presentation !== null &&
      state !== "failed" &&
      state !== "disposed" &&
      simulation.snapshot().state === "running" &&
      world.state === "streaming" &&
      !world.districtSwapInProgress &&
      world.districtId === worldId
    );
  };
  const clear = (): void => {
    presentation = null;
    const state = audio.snapshot().state;
    if (state !== "disposed" && state !== "failed") audio.setScene(null);
  };
  const unsubscribeAuthority = simulation.subscribeAuthorityChanges(() => {
    lastEventSequence = -1;
    clear();
  });
  const unsubscribeSimulation = simulation.subscribe((snapshot) => {
    if (snapshot.loadCount !== observedLoadCount) {
      observedLoadCount = snapshot.loadCount;
      lastEventSequence = -1;
      clear();
    }
    if (snapshot.state !== "running") clear();
  });
  const unsubscribeStreaming = streaming.subscribe(() => {
    if (!available()) clear();
  });
  const unsubscribeEvents = simulation.subscribeEvents((events) => {
    for (const event of events) {
      if (event.sequence <= lastEventSequence) continue;
      lastEventSequence = event.sequence;
      if (!available()) continue;
      const cue = GAMEPLAY_AUDIO_CUES.find((candidate) => candidate.eventKind === event.kind);
      if (cue === undefined || event.payload.byteLength !== cue.payloadBytes) continue;
      const entityId = new DataView(
        event.payload.buffer,
        event.payload.byteOffset,
        event.payload.byteLength,
      ).getUint32(cue.entityByteOffset, true);
      // Events arrive with a newly published presentation; sample it before the next RAF.
      const entity = simulation
        .samplePresentation()
        ?.entities.find((candidate) => candidate.id === entityId);
      if (entity === undefined) continue;
      audio.play({
        clipId: cue.clipId,
        emitterId: entityId,
        gain: cue.gain,
        maximumDistance: cue.maximumDistance,
        position: entity.position,
        referenceDistance: cue.referenceDistance,
        sceneId: worldId,
      });
    }
  });
  return {
    dispose(): void {
      if (disposed) return;
      clear();
      disposed = true;
      unsubscribeAuthority();
      unsubscribeSimulation();
      unsubscribeStreaming();
      unsubscribeEvents();
    },
    update(next, pitchRadians, active): void {
      if (disposed) return;
      enabled = active;
      presentation = next;
      const player = next?.entities.find((entity) => entity.id === PLAYER_ENTITY_ID);
      if (!available() || player === undefined || next === null) {
        clear();
        return;
      }
      audio.setScene(worldId);
      audio.setListener(gameplayCameraPose(player.position, player.yawRadians, pitchRadians));
      audio.updateEmitters(next.entities);
    },
  };
}
