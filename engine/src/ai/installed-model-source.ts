import type {
  InstalledReleaseBinding,
  InstalledReleaseResource,
} from "../storage/installed-release";
import {
  APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS,
  APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
} from "./app-owned-llm-spike-protocol";

export const INSTALLED_MODEL_SOURCE_TELEMETRY_SCHEMA_VERSION = 1;

export interface InstalledModelArtifact {
  readonly bytes: number;
  readonly path: string;
  readonly resourceId: string;
  readonly sha256: string;
}

export interface InstalledModelSourceTelemetrySnapshot {
  readonly expectedArtifactBytes: number;
  readonly expectedArtifactCount: number;
  readonly failureMessage: string | null;
  readonly networkFallbackCount: 0;
  readonly releaseDigest: string | null;
  readonly resolvedArtifactBytes: number;
  readonly resolvedArtifactCount: number;
  readonly schemaVersion: typeof INSTALLED_MODEL_SOURCE_TELEMETRY_SCHEMA_VERSION;
  readonly state: "idle" | "resolving" | "ready" | "failed" | "unavailable";
}

export interface InstalledModelSource {
  artifacts(): readonly InstalledModelArtifact[];
  initialize(): Promise<readonly InstalledModelArtifact[]>;
  snapshot(): InstalledModelSourceTelemetrySnapshot;
  subscribe(listener: (snapshot: InstalledModelSourceTelemetrySnapshot) => void): () => void;
}

export function createInstalledModelSource(
  binding: InstalledReleaseBinding | null,
): InstalledModelSource {
  const listeners = new Set<(snapshot: InstalledModelSourceTelemetrySnapshot) => void>();
  let artifacts: readonly InstalledModelArtifact[] | null = null;
  let initialization: Promise<readonly InstalledModelArtifact[]> | null = null;
  let telemetry = freezeTelemetry({
    expectedArtifactBytes: APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES,
    expectedArtifactCount: APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length,
    failureMessage: null,
    networkFallbackCount: 0,
    releaseDigest: binding?.releaseDigest ?? null,
    resolvedArtifactBytes: 0,
    resolvedArtifactCount: 0,
    schemaVersion: INSTALLED_MODEL_SOURCE_TELEMETRY_SCHEMA_VERSION,
    state: binding === null ? "unavailable" : "idle",
  });
  const publish = (next: InstalledModelSourceTelemetrySnapshot): void => {
    telemetry = freezeTelemetry(next);
    for (const listener of listeners) {
      try {
        listener(telemetry);
      } catch {
        // Model-source observers cannot affect exact release resolution.
      }
    }
  };

  return Object.freeze({
    artifacts(): readonly InstalledModelArtifact[] {
      if (artifacts === null || telemetry.state !== "ready") {
        throw new Error("Installed model source is not ready");
      }
      return artifacts;
    },
    initialize(): Promise<readonly InstalledModelArtifact[]> {
      if (binding === null) {
        return Promise.reject(
          new Error("Installed model source is unavailable in privileged legacy mode"),
        );
      }
      initialization ??= (async () => {
        publish({ ...telemetry, state: "resolving" });
        try {
          const modelResources = binding.manifest.resources.filter(
            (resource) =>
              resource.kind === "model" &&
              resource.scope === "common" &&
              resource.target === "opfs",
          );
          if (modelResources.length !== APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length) {
            throw new Error("Installed release has the wrong pinned model artifact count");
          }
          const resolved: InstalledReleaseResource[] = [];
          for (const resource of modelResources) {
            resolved.push(await binding.getResource(resource.id));
          }
          const expectedBySha = new Map(
            APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.map((artifact) => [artifact.sha256, artifact]),
          );
          const sourceArtifacts = resolved.map(({ manifest, reference }) => {
            const expected = expectedBySha.get(reference.sha256);
            if (
              expected === undefined ||
              expected.bytes !== reference.bytes ||
              manifest.bytes !== reference.bytes ||
              manifest.sha256 !== reference.sha256 ||
              manifest.kind !== "model" ||
              manifest.scope !== "common" ||
              manifest.target !== "opfs"
            ) {
              throw new Error(`Installed model resource ${manifest.id} has wrong identity`);
            }
            return Object.freeze({
              bytes: reference.bytes,
              path: reference.path,
              resourceId: reference.resourceId,
              sha256: reference.sha256,
            });
          });
          const resolvedBytes = sourceArtifacts.reduce(
            (total, artifact) => safeAdd(total, artifact.bytes),
            0,
          );
          if (
            resolvedBytes !== APP_OWNED_LLM_WLLAMA_MODEL_INSTALL_BYTES ||
            new Set(sourceArtifacts.map((artifact) => artifact.sha256)).size !==
              APP_OWNED_LLM_WLLAMA_MODEL_ARTIFACTS.length
          ) {
            throw new Error("Installed model source does not match the exact pinned shard set");
          }
          artifacts = Object.freeze(sourceArtifacts);
          publish({
            ...telemetry,
            resolvedArtifactBytes: resolvedBytes,
            resolvedArtifactCount: sourceArtifacts.length,
            state: "ready",
          });
          return artifacts;
        } catch (error: unknown) {
          const message =
            error instanceof Error && error.message !== "" ? error.message : String(error);
          publish({ ...telemetry, failureMessage: message, state: "failed" });
          throw error;
        }
      })();
      return initialization;
    },
    snapshot(): InstalledModelSourceTelemetrySnapshot {
      return telemetry;
    },
    subscribe(listener: (snapshot: InstalledModelSourceTelemetrySnapshot) => void): () => void {
      listeners.add(listener);
      listener(telemetry);
      return () => listeners.delete(listener);
    },
  });
}

export function unavailableInstalledModelSourceSnapshot(): InstalledModelSourceTelemetrySnapshot {
  return createInstalledModelSource(null).snapshot();
}

function safeAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Installed model artifact total overflow");
  }
  return value;
}

function freezeTelemetry(
  value: InstalledModelSourceTelemetrySnapshot,
): InstalledModelSourceTelemetrySnapshot {
  return Object.freeze({ ...value });
}
