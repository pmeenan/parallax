import type {
  RenderStreamingFlythroughObservers,
  RenderStreamingFlythroughResetRequest,
  StreamingRenderFlythroughResetResponse,
} from "./streaming-protocol";

export interface FlythroughObserverProtocol {
  acceptObserver(message: RenderStreamingFlythroughObservers): number;
  settleReset(
    message: RenderStreamingFlythroughResetRequest,
  ): StreamingRenderFlythroughResetResponse;
  snapshot(): Readonly<{
    readonly flythroughGeneration: number;
    readonly runSequence: number;
    readonly transportSequence: number;
  }>;
}

export function createFlythroughObserverProtocol(
  initialTransportSequence: number,
): FlythroughObserverProtocol {
  if (!nonNegativeInteger(initialTransportSequence)) {
    throw new Error("Initial flythrough observer transport sequence is invalid");
  }
  let flythroughGeneration = 0;
  let runSequence = 0;
  let transportSequence = initialTransportSequence;

  return Object.freeze({
    acceptObserver(message: RenderStreamingFlythroughObservers): number {
      if (
        message.flythroughGeneration !== flythroughGeneration ||
        !positiveInteger(message.sequence) ||
        message.sequence !== runSequence + 1 ||
        !positiveInteger(message.transportSequence) ||
        message.transportSequence !== transportSequence + 1
      ) {
        throw new Error("Render worker flythrough observer sequence is invalid");
      }
      runSequence = message.sequence;
      transportSequence = message.transportSequence;
      return transportSequence;
    },

    settleReset(
      message: RenderStreamingFlythroughResetRequest,
    ): StreamingRenderFlythroughResetResponse {
      const recoveryResynchronization =
        runSequence === 0 &&
        message.completedRunSequence === null &&
        message.flythroughObserverUpdateCount === null;
      if (
        !positiveInteger(message.requestId) ||
        (!recoveryResynchronization &&
          message.completedFlythroughGeneration !== flythroughGeneration) ||
        !Number.isSafeInteger(message.nextFlythroughGeneration) ||
        message.nextFlythroughGeneration <= message.completedFlythroughGeneration ||
        (message.completedRunSequence !== null && message.completedRunSequence !== runSequence) ||
        (message.flythroughObserverUpdateCount !== null &&
          message.flythroughObserverUpdateCount !== transportSequence)
      ) {
        throw new Error("Render worker flythrough reset boundary is invalid");
      }
      flythroughGeneration = message.nextFlythroughGeneration;
      runSequence = 0;
      return Object.freeze({
        flythroughObserverUpdateCount: transportSequence,
        kind: "flythrough-reset-settled",
        nextFlythroughGeneration: flythroughGeneration,
        requestId: message.requestId,
      });
    },

    snapshot: () =>
      Object.freeze({
        flythroughGeneration,
        runSequence,
        transportSequence,
      }),
  });
}

function nonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
