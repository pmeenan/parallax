import {
  type AppOwnedLlmFixtureSet,
  type AppOwnedLlmInferenceDevice,
  type AppOwnedLlmSpikeTelemetrySnapshot,
  type AppOwnedLlmWorkerResponse,
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

const WORKER_ARTIFACT = "./__AI_WORKER_ARTIFACT__";

interface DevelopmentImportMeta extends ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

function aiWorkerUrl(): URL {
  const development = (import.meta as DevelopmentImportMeta).env?.DEV === true;
  return development
    ? new URL("../workers/ai-worker.ts", import.meta.url)
    : new URL(WORKER_ARTIFACT, import.meta.url);
}

export function createAppOwnedLlmSpikeService(): AppOwnedLlmSpikeService {
  let telemetry = createInitialAppOwnedLlmTelemetry();
  let worker: Worker | null = null;
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
    if (worker !== null) {
      worker.onmessage = null;
      worker.onmessageerror = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
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
      device: AppOwnedLlmInferenceDevice = "webgpu",
      modelUrl?: string,
    ): void {
      if (telemetry.state !== "idle")
        throw new Error("App-owned LLM spike can only be started once");
      publish({ ...telemetry, fixtureSetId: fixtureSet.id, state: "loading-model" });
      if (device === "wllama-webgpu" || device === "wllama-wasm") {
        const abortController = new AbortController();
        wllamaAbortController = abortController;
        void runWllamaSpike(
          {
            device,
            fixtureSet,
            kind: "start",
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
        return;
      }
      try {
        const aiWorker = new Worker(aiWorkerUrl(), { name: "parallax-ai", type: "module" });
        worker = aiWorker;
        aiWorker.onmessage = (event: MessageEvent<AppOwnedLlmWorkerResponse>): void => {
          if (telemetry.state === "disposed" || telemetry.state === "failed") return;
          if (event.data.kind === "failure") {
            fail(event.data.message);
            return;
          }
          publish(event.data.snapshot);
          if (event.data.snapshot.state === "completed") terminate();
        };
        aiWorker.onmessageerror = (): void => fail("AI worker message failed to deserialize");
        aiWorker.onerror = (event): void => {
          fail(
            event instanceof ErrorEvent && event.message !== ""
              ? event.message
              : "AI worker script failed to load",
          );
        };
        aiWorker.postMessage({
          device,
          fixtureSet,
          kind: "start",
          ...(modelUrl === undefined ? {} : { modelUrl }),
        });
      } catch (error: unknown) {
        fail(error instanceof Error ? error.message : String(error));
      }
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
