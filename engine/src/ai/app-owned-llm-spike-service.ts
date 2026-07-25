import {
  type AppOwnedLlmFixtureSet,
  type AppOwnedLlmInferenceDevice,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  createInitialAppOwnedLlmTelemetry,
} from "./app-owned-llm-spike-protocol";
import { runWllamaSpike } from "./app-owned-llm-wllama-runner";

export type AppOwnedLlmSpikeListener = (snapshot: AppOwnedLlmSpikeTelemetrySnapshot) => void;

export interface AppOwnedLlmSpikeService {
  dispose(): void;
  snapshot(): AppOwnedLlmSpikeTelemetrySnapshot;
  start(
    fixtureSet: AppOwnedLlmFixtureSet,
    device?: AppOwnedLlmInferenceDevice,
    modelUrl?: string,
  ): void;
  subscribe(listener: AppOwnedLlmSpikeListener): () => void;
}

export function createAppOwnedLlmSpikeService(): AppOwnedLlmSpikeService {
  let telemetry = createInitialAppOwnedLlmTelemetry();
  let wllamaAbortController: AbortController | null = null;
  const listeners = new Set<AppOwnedLlmSpikeListener>();

  const publish = (next: AppOwnedLlmSpikeTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("App-owned LLM telemetry listener failed", error);
      }
    }
  };

  const terminate = (): void => {
    wllamaAbortController?.abort();
    wllamaAbortController = null;
  };

  const fail = (message: string): void => {
    if (
      telemetry.state === "completed" ||
      telemetry.state === "failed" ||
      telemetry.state === "disposed"
    )
      return;
    terminate();
    publish({ ...telemetry, activeFixtureId: null, failureMessage: message, state: "failed" });
  };

  return Object.freeze({
    dispose(): void {
      if (telemetry.state === "disposed") return;
      terminate();
      publish({ ...telemetry, activeFixtureId: null, state: "disposed" });
    },
    snapshot(): AppOwnedLlmSpikeTelemetrySnapshot {
      return telemetry;
    },
    start(
      fixtureSet: AppOwnedLlmFixtureSet,
      device: AppOwnedLlmInferenceDevice = "wllama-webgpu",
      modelUrl?: string,
    ): void {
      if (telemetry.state !== "idle")
        throw new Error("App-owned LLM spike can only be started once");
      publish({ ...telemetry, fixtureSetId: fixtureSet.id, state: "loading-model" });
      const abortController = new AbortController();
      wllamaAbortController = abortController;
      void runWllamaSpike(
        {
          device,
          fixtureSet,
          ...(modelUrl === undefined ? {} : { modelUrl }),
        },
        (snapshot): void => {
          if (
            telemetry.state === "completed" ||
            telemetry.state === "failed" ||
            telemetry.state === "disposed"
          )
            return;
          publish(snapshot);
        },
        abortController.signal,
      )
        .then(() => {
          if (wllamaAbortController === abortController) wllamaAbortController = null;
        })
        .catch((error: unknown) => {
          if (wllamaAbortController === abortController) wllamaAbortController = null;
          fail(error instanceof Error ? error.message : String(error));
        });
    },
    subscribe(listener: AppOwnedLlmSpikeListener): () => void {
      listeners.add(listener);
      try {
        listener(telemetry);
      } catch (error: unknown) {
        console.error("App-owned LLM telemetry listener failed", error);
      }
      return () => listeners.delete(listener);
    },
  });
}

function freezeTelemetry(
  snapshot: AppOwnedLlmSpikeTelemetrySnapshot,
): AppOwnedLlmSpikeTelemetrySnapshot {
  return Object.freeze({
    ...snapshot,
    cache: Object.freeze({ ...snapshot.cache }),
    generations: Object.freeze(
      snapshot.generations.map((generation) =>
        Object.freeze({
          ...generation,
          semanticValidationFailures: Object.freeze([...generation.semanticValidationFailures]),
        }),
      ),
    ),
  });
}
